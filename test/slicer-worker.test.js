const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'slicer-worker.js'), 'utf8');

function cubeTriangles(size = 10, height = 5) {
  const x = size / 2, y = size / 2, z = height;
  const faces = [
    [[-x,-y,0],[x,-y,0],[x,y,0],[-x,y,0]],
    [[-x,-y,z],[-x,y,z],[x,y,z],[x,-y,z]],
    [[-x,-y,0],[-x,-y,z],[x,-y,z],[x,-y,0]],
    [[x,-y,0],[x,-y,z],[x,y,z],[x,y,0]],
    [[x,y,0],[x,y,z],[-x,y,z],[-x,y,0]],
    [[-x,y,0],[-x,y,z],[-x,-y,z],[-x,-y,0]]
  ];
  return faces.flatMap(([a,b,c,d])=>[a,b,c,a,c,d]);
}

function runWorker(triangles, overrides = {}) {
  let handler;
  const messages = [];
  const context = {
    self: {
      addEventListener(_type, callback) { handler = callback; },
      postMessage(message) { messages.push(message); }
    },
    Math,
    Number,
    Array,
    Error
  };
  vm.runInNewContext(source, context);
  handler({data:{
    triangles,
    settings:{
      layerHeight:0.2,lineWidth:0.4,wallCount:1,infillDensity:0,infillPattern:'Grid',
      nozzleTemperature:205,bedTemperature:60,printSpeed:40,flowRate:100,
      filamentDiameter:1.75,buildVolume:{x:220,y:220,z:250},
      ...overrides
    }
  }});
  return messages.at(-1);
}

test('slices a closed mesh into layers and emits extrusion and travel moves', () => {
  const result = runWorker(cubeTriangles());
  assert.equal(result.type, 'complete');
  assert.ok(result.layers.length > 1);
  assert.ok(result.filamentMm > 0);
  assert.match(result.gcode, /G0 X/);
  assert.match(result.gcode, /G1 X.* E/);
});

test('rejects models outside the selected printer build volume', () => {
  const result = runWorker(cubeTriangles(300));
  assert.equal(result.type, 'error');
  assert.match(result.message, /outside the 220 × 220 × 250 mm build volume/);
});

test('rejects temperatures above the selected printer profile limits', () => {
  const result = runWorker(cubeTriangles(), { maxNozzleTemperature: 200 });
  assert.equal(result.type, 'error');
  assert.match(result.message, /exceeds the printer profile maximum/);
});

test('uses printer-specific start and end G-code when supplied', () => {
  const result = runWorker(cubeTriangles(), {
    startGcode: '; custom start\nG21',
    endGcode: '; custom end\nM84'
  });
  assert.equal(result.type, 'complete');
  assert.match(result.gcode, /^; custom start\nG21/);
  assert.match(result.gcode, /; custom end\nM84$/);
});

test('emits centered XY coordinates for printers whose origin is the bed center', () => {
  const result = runWorker(cubeTriangles(), { originAtCenter: true });
  assert.equal(result.type, 'complete');
  assert.match(result.gcode, /G0 X-/);
});

test('rejects printer G-code containing unresolved placeholders', () => {
  const result = runWorker(cubeTriangles(), { startGcode: 'M900 K[pressure_advance]' });
  assert.equal(result.type, 'error');
  assert.match(result.message, /unsupported placeholders: pressure_advance/);
});

test('emits incremental extrusion values for relative-extrusion printers', () => {
  const result = runWorker(cubeTriangles(), { relativeExtrusion: true, startGcode: 'G28' });
  assert.equal(result.type, 'complete');
  assert.match(result.gcode, /M83 ; relative extrusion/);
  const extrusionValues = [...result.gcode.matchAll(/^G1 .* E([\d.]+)/gm)].map((match) => Number(match[1]));
  assert.ok(extrusionValues.length > 1);
  assert.ok(extrusionValues.every((value) => value < 100));
});

test('estimates a small cube in minutes rather than multiplying time by sixty', () => {
  const result = runWorker(cubeTriangles(10, 6), { printSpeed: 50, infillDensity: 20 });
  assert.equal(result.type, 'complete');
  assert.ok(result.estimatedMinutes > 0);
  assert.ok(result.estimatedMinutes < 10, `expected under 10 minutes, got ${result.estimatedMinutes}`);
});

test('adds solid infill to top and bottom layers when sparse infill is disabled', () => {
  const result = runWorker(cubeTriangles(10, 6), { infillDensity: 0, solidLayerCount: 2 });
  assert.equal(result.type, 'complete');
  assert.ok(result.layers[0].moves.some((move) => move.kind === 'infill'));
  assert.ok(result.layers.at(-1).moves.some((move) => move.kind === 'infill'));
});

test('applies profile retraction on travel moves for absolute and relative extrusion', () => {
  for (const relativeExtrusion of [false, true]) {
    const result = runWorker(cubeTriangles(), {
      relativeExtrusion,
      retraction: { distance: 0.8, speed: 30, minimumTravel: 1 }
    });
    assert.equal(result.type, 'complete');
    assert.match(result.gcode, /G1 E(?:-0\.80000|[\d.-]+) F1800/);
  }
});
