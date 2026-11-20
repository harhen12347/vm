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
