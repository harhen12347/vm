const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { convertSldprtToStl } = require('../src/cad-converter');

const converterRoot = path.dirname(path.dirname(require.resolve('sldprt')));
const samplePart = path.join(converterRoot, 'samples', 'sw2022', 'C00_cube_10mm.SLDPRT');

test('converts a SolidWorks part to a valid binary STL', async () => {
  const stl = await convertSldprtToStl(fs.readFileSync(samplePart));
  const triangleCount = stl.readUInt32LE(80);

  assert.ok(triangleCount > 0);
  assert.equal(stl.length, 84 + triangleCount * 50);
});

test('reports invalid part files as conversion errors', async () => {
  await assert.rejects(convertSldprtToStl(Buffer.from('not an SLDPRT file')));
});
