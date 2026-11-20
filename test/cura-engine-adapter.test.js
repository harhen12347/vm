const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCuraOverrides, curaMetadataToStats, parseCuraGcode, trianglesToBinaryStl } = require('../src/cura-engine-adapter.mjs');

const profile = {
  buildVolume: { x: 220, y: 210, z: 250 },
  model: 'Test Printer',
  originAtCenter: false,
  firmwareType: 'RepRap (Marlin/Sprinter)',
  heatedBed: true,
  startGcode: 'G28',
  endGcode: 'M84',
  nozzleDiameters: [0.4],
  filamentDiameter: 1.75,
  relativeExtrusion: false,
  retraction: { distance: 0.8, speed: 30 }
};

const settings = {
  nozzleDiameter: 0.4,
  layerHeight: 0.2,
  lineWidth: 0.4,
  wallCount: 2,
  solidLayerCount: 3,
  infillDensity: 20,
  infillPattern: 'Grid',
  printSpeed: 50,
  flowRate: 100,
  nozzleTemperature: 205,
  bedTemperature: 60,
  adhesion: 'none',
  supports: true
};

test('maps printer and print settings to CuraEngine overrides', () => {
  const overrides = buildCuraOverrides(profile, settings);
  const value = (key, scope) => overrides.find((item) => item.key === key && item.scope === scope)?.value;
  assert.equal(value('machine_width', undefined), '220');
  assert.equal(value('machine_start_gcode', undefined), 'G28');
  assert.equal(value('machine_nozzle_size', 'e0'), '0.4');
  assert.equal(value('layer_height', undefined), '0.2');
  assert.equal(value('infill_pattern', undefined), 'grid');
  assert.equal(value('material_print_temperature_layer_0', undefined), '205');
  assert.equal(value('retraction_amount', undefined), '0.8');
  assert.equal(value('support_enable', undefined), 'true');
});

test('serializes transformed triangles to valid binary STL records', () => {
  const buffer = trianglesToBinaryStl([[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
  const view = new DataView(buffer);
  assert.equal(buffer.byteLength, 134);
  assert.equal(view.getUint32(80, true), 1);
  assert.equal(view.getFloat32(92, true), 1);
});

test('parses Cura layers and classifies extrusion and travel paths in centered viewport coordinates', () => {
  const gcode = [
    ';FLAVOR:Marlin', ';LAYER:0', ';TYPE:WALL-OUTER', 'M82',
    'G1 X110 Y110 Z0.2 E1', 'G0 X112 Y110', ';TYPE:FILL', 'G1 X112 Y112 E2',
    ';LAYER:1', 'G1 X114 Y112 Z0.4 E3'
  ].join('\n');
  const layers = parseCuraGcode(gcode, profile);
  assert.equal(layers.length, 2);
  assert.deepEqual(layers[0].moves.map((move) => move.kind), ['wall', 'travel', 'infill']);
  assert.deepEqual([layers[0].moves[0].x2, layers[0].moves[0].y2], [0, 5]);
  assert.equal(layers[1].moves.length, 1);
});

test('converts Cura metadata to time and filament estimates using selected filament diameter', () => {
  const result = curaMetadataToStats({ printTime: 240, filamentUsage: 572 }, 2.85);
  assert.equal(result.estimatedMinutes, 4);
  assert.ok(result.filamentMm > 89 && result.filamentMm < 90);
  assert.ok(result.filamentGrams > 0);
});

test('rejects invalid Cura output instead of marking a slice complete', () => {
  assert.throws(() => parseCuraGcode('not gcode', profile), /invalid or empty G-code/);
});
