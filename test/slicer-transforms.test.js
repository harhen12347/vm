const test = require('node:test');
const assert = require('node:assert/strict');
const { dimensionsFromScale, normalizePositionsAtPlate, scaleForDimensions } = require('../src/slicer-transforms.mjs');

test('reports resized model dimensions from its base geometry and scale', () => {
  assert.deepEqual(dimensionsFromScale([20, 10, 5], [2, 2, 2]), [40, 20, 10]);
});

test('centers imported vertices on the plate and keeps their original dimensions', () => {
  const normalized=normalizePositionsAtPlate([[10,20,5],[14,20,5],[10,26,9]]);
  assert.deepEqual(normalized, [[-2,-3,0],[2,-3,0],[-2,3,4]]);
});

test('resizes proportionally from the edited axis', () => {
  assert.deepEqual(scaleForDimensions([20, 10, 5], [40, 20, 10], true, 0), [2, 2, 2]);
  assert.deepEqual(scaleForDimensions([20, 10, 5], [40, 99, 99], true, 0), [2, 2, 2]);
});

test('resizes each local axis independently when proportions are unlocked', () => {
  assert.deepEqual(scaleForDimensions([20, 10, 5], [40, 15, 2.5], false, 1), [2, 1.5, 0.5]);
});

test('rejects empty, non-finite, or non-positive dimensions', () => {
  assert.throws(() => scaleForDimensions([20, 10, 5], [40, 0, 10], false, 1), /positive finite size/);
  assert.throws(() => dimensionsFromScale([20, NaN, 5], [1, 1, 1]), /positive finite values/);
  assert.throws(() => normalizePositionsAtPlate([[1, 2, Infinity]]), /finite XYZ vertices/);
});
