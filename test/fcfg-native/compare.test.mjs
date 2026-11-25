import test from 'node:test'; import assert from 'node:assert/strict';
import { parseFcfgBytes, parseFcfg, compareProfiles, categorizeKey } from '../../src/index.mjs';
import { load } from './helpers.mjs';

const P = (d, f) => parseFcfgBytes(load(d, f));

test('identical profiles: no differences', () => {
  const r = compareProfiles(P('0.40mm', 'Flashforge-PLA.fcfg'), P('0.40mm', 'Flashforge-PLA.fcfg'));
  assert.deepEqual([r.changed.length, r.added.length, r.removed.length, r.printerDiffers, r.nozzleDiffers, r.materialDiffers], [0, 0, 0, false, false, false]);
  assert.equal(r.unchangedCount, 207);
});

test('PLA 0.40 vs PETG 0.60: nozzle + material differences, readable values', () => {
  const r = compareProfiles(P('0.40mm', 'Flashforge-PLA.fcfg'), P('0.60mm', 'Flashforge-PETG.fcfg'));
  assert.equal(r.printerDiffers, false); assert.equal(r.nozzleDiffers, true); assert.equal(r.materialDiffers, true);
  assert.deepEqual(r.identity.nozzleSize, { a: '0.4', b: '0.6', equal: false });
  assert.equal(r.identity.materialName0.b, 'Flashforge-PETG'); assert.equal(r.identity.materialDensity0.a, '1.24');
  const lh = r.changed.find((c) => c.key === 'layerHeight');
  assert.deepEqual([lh.a, lh.b, lh.category], ['0.2', '0.3', 'layer']);
  assert.equal(r.changed.find((c) => c.key === 'extruderTemp0').b, '250');
});

test('changed / added / removed / printer difference', () => {
  const a = parseFcfg('[Custom]\nmachineId=33\nnozzleSize=@Variant(\\0\\0\\0\\x87>\\xcc\\xcc\\xcd)\n[General]\nlayerHeight=@Variant(\\0\\0\\0\\x87>L\\xcc\\xcd)\nonlyA=1\nsame=true\n');
  const b = parseFcfg('[Custom]\nmachineId=34\nnozzleSize=@Variant(\\0\\0\\0\\x87>\\xcc\\xcc\\xcd)\n[General]\nlayerHeight=@Variant(\\0\\0\\0\\x87>\\x99\\x99\\x9a)\nonlyB=@Variant(\\0\\0\\0\\x87?\\x80\\0\\0)\nsame=true\n[Extra]\nz=1\n');
  const r = compareProfiles(a, b);
  assert.equal(r.printerDiffers, true); assert.equal(r.nozzleDiffers, false);
  assert.deepEqual(r.changed.map((c) => c.key).sort(), ['layerHeight', 'machineId']);
  assert.deepEqual(r.removed.map((c) => c.key), ['onlyA']);
  assert.deepEqual(r.added.map((c) => c.key).sort(), ['onlyB', 'z']);
  assert.deepEqual(r.sectionsOnlyInB, ['Extra']);
  assert.equal(r.unchangedCount, 2);
});

test('same decoded value written differently (quoted vs unquoted) is not a difference; a type change is', () => {
  const a = parseFcfg('[G]\nv=@Variant(\\0\\0\\0\\x87?\\x80\\0\\0)\ns=a\n'), b = parseFcfg('[G]\nv="@Variant(\\0\\0\\0\\x87?\\x80\\0\\0)"\ns="a"\n');
  assert.equal(compareProfiles(a, b).changed.length, 0);
  const c = parseFcfg('[G]\nv=@Variant(\\0\\0\\0\\2\\0\\0\\0\\1)\ns=a\n');   // int 1 vs float 1
  assert.equal(compareProfiles(a, c).changed.length, 1);
});

test('empty-string value vs missing key are distinguished', () => {
  const r = compareProfiles(parseFcfg('[A]\nk=\n'), parseFcfg('[A]\n'));
  assert.equal(r.removed.length, 1);
});

test('all 207 genuine keys fall in a named category (none "other")', () => {
  for (const k of P('0.40mm', 'Flashforge-PLA.fcfg').keys('General')) assert.notEqual(categorizeKey(k), 'other', k);
  assert.equal(categorizeKey('somethingNew'), 'other');
});
