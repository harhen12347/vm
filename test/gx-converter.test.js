const test = require('node:test');
const assert = require('node:assert/strict');

(async () => {
  const { parseGX, makeBinarySTL, makeModelMetadata, validatePrinterConfiguration, validateBinarySTL } = await import('../src/gx-converter-core.mjs');

  test('extracts metadata and G-code from an xgcode wrapper', () => {
	const bmp = Buffer.alloc(14512);
	const gcode = Buffer.from(';FLAVOR:Marlin\n; layer_height = 0.20\n; nozzle_diameter = 0.4\nG90\nG1 X10 Y10 Z0.2 E1\nG1 X20 Y10 E2\n; Executable_block_start\n');
	const binary = Buffer.concat([Buffer.from('xgcode 1.0\n\0'), Buffer.alloc(44), bmp, gcode]);
	const parsed = parseGX(binary);
	assert.match(parsed.gcode, /G1 X20 Y10/);
	assert.equal(parsed.printer['Layer height'], 0.20);
  });

  test('scans large xgcode payloads without quadratic candidate rescans', () => {
	const commands = Array.from({ length: 20000 }, (_, index) => 'G1 X' + index + ' Y1 E' + (index + 1)).join('\n');
	const wrapper = Buffer.concat([Buffer.from('xgcode 1.0\n\0'), Buffer.alloc(14512), Buffer.from(commands)]);
	const parsed = parseGX(wrapper);
	assert.match(parsed.gcode, /G1 X19999 Y1 E20000/);
  });

  test('creates a non-empty binary STL from extrusion moves', () => {
	const gcode = 'G90\nM82\nG1 X0 Y0 Z0.2 E0\nG1 X10 Y0 Z0.2 E1\nG1 X10 Y10 Z0.2 E2';
	const result = makeBinarySTL(gcode, { width: 0.42, layerHeight: 0.20 });
	assert.ok(result.stl.length > 84);
	assert.ok(result.segments >= 2);
	assert.ok(result.dimensions.x > 0 && result.dimensions.y > 0);
	assert.doesNotThrow(() => validateBinarySTL(result.stl));
  });

  test('does not invent model settings', () => {
	const padding = '; padding\n'.repeat(20);
	const parsed = parseGX(Buffer.from(padding + 'G90\nG1 X0 Y0 Z0.2 E0\nG1 X10 Y0 Z0.2 E1\n'));
	assert.deepEqual(parsed.model, {});
  });

  test('writes a clearly identified JSON metadata export rather than an FCFG', () => {
	const metadata = makeModelMetadata('sample.gx', { 'Nozzle size': 0.4 }, {});
	const value = JSON.parse(metadata);
	assert.equal(value.format, 'AETHER_GX_METADATA_EXPORT');
	assert.equal(value.nativeFCFGSupported, false);
	assert.equal(value.source, 'sample.gx');
	assert.doesNotThrow(() => validatePrinterConfiguration(value.printer));
  });

  test('supports G-code in compressed decompression results', () => {
	const padding = '; padding\n'.repeat(20);
	const parsed = parseGX(Buffer.from(padding + 'G90\nM82\nM104 S210\nM140 S60\nG1 X5 Y5 Z0.2 E1 F1200\nG1 X15 Y5 E2'));
	assert.equal(parsed.printer['Nozzle temperature'], 210);
	assert.equal(parsed.printer['Bed temperature'], 60);
  });
})();
