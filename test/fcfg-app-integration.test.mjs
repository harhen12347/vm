import test from 'node:test';
import assert from 'node:assert/strict';
import { compareFCFGProfiles, parseProfile, serializeProfile } from '../src/printer-config-core.mjs';
import { getFCFGDocument } from '../src/printer-fcfg-profile.mjs';
import { corpus, load } from './fcfg-native/helpers.mjs';

test('all 33 genuine fixtures use the Studio import and export paths byte-exactly', () => {
  const files = corpus();
  assert.equal(files.length, 33);
  for (const fixture of files) {
	const profile = parseProfile(fixture.bytes, 'fcfg', fixture.file);
	const exported = serializeProfile(profile, 'fcfg');
	assert.ok(exported instanceof Uint8Array, `${fixture.dir}/${fixture.file} returns native bytes`);
	assert.equal(Buffer.compare(Buffer.from(exported), Buffer.from(fixture.bytes)), 0, `${fixture.dir}/${fixture.file}`);
  }
});

test('Studio export changes only an edited mapped line and retains injected unknown settings', () => {
  const original = load('0.40mm', 'Flashforge-PLA.fcfg');
  const profile = parseProfile(original, 'fcfg');
  const document = getFCFGDocument(profile);
  document.set('General', 'appInjectedUnknown', 123, { as: 'float32' });
  profile.settings.layerHeight = 0.28;

  const exported = serializeProfile(profile, 'fcfg');
  const before = new TextDecoder().decode(original).split('\r\n');
  const after = new TextDecoder().decode(exported).split('\r\n');
  const changedBefore = before.find((line) => line.startsWith('layerHeight='));
  const changedAfter = after.find((line) => line.startsWith('layerHeight='));
  assert.notEqual(changedAfter, changedBefore);
  assert.deepEqual(
    after.filter((line) => !line.startsWith('layerHeight=') && !line.startsWith('appInjectedUnknown=')),
    before.filter((line) => !line.startsWith('layerHeight='))
  );
  assert.equal(after.filter((line) => line.startsWith('appInjectedUnknown=')).length, 1);
  const reimported = parseProfile(exported, 'fcfg');
  assert.equal(reimported.settings.layerHeight, 0.28);
  assert.equal(getFCFGDocument(reimported).get('General', 'appInjectedUnknown'), Math.fround(123));
});

test('Studio native comparison reports nozzle and material differences', () => {
  const pla = parseProfile(load('0.40mm', 'Flashforge-PLA.fcfg'), 'fcfg');
  const petg = parseProfile(load('0.60mm', 'Flashforge-PETG.fcfg'), 'fcfg');
  const result = compareFCFGProfiles([pla, petg]);
  assert.equal(result.printerDiffers, false);
  assert.equal(result.nozzleDiffers, true);
  assert.equal(result.materialDiffers, true);
  assert.deepEqual(result.identity.nozzleSize, { a: '0.4', b: '0.6', equal: false });
  assert.equal(result.identity.materialName0.a, 'Flashforge-PLA');
  assert.equal(result.identity.materialName0.b, 'Flashforge-PETG');
  assert.equal(result.changed.find((item) => item.key === 'layerHeight').a, '0.2');
});

test('Studio profile persistence rehydrates its FCFG document before export', () => {
  const fixture = load('0.40mm', 'Flashforge-PLA.fcfg');
  const imported = parseProfile(fixture, 'fcfg');
  const restored = JSON.parse(JSON.stringify(imported));
  assert.equal(Buffer.compare(Buffer.from(serializeProfile(restored, 'fcfg')), Buffer.from(fixture)), 0);
});

test('Studio import refuses missing profile identity instead of inventing metadata', () => {
  const nozzle = String.raw`@Variant(\0\0\0\x87>\xcc\xcc\xcd)`;
  const emptyName = '[Custom]\r\nmachineId=33\r\nprofileName=\r\nnozzleSize=' + nozzle + '\r\n[General]\r\nlayerHeight=0.2';
  const invalidNozzle = '[Custom]\r\nmachineId=33\r\nprofileName=PLA\r\nnozzleSize=unknown\r\n[General]\r\nlayerHeight=0.2';
  assert.throws(() => parseProfile(emptyName, 'fcfg'), /profileName is empty/);
  assert.throws(() => parseProfile(invalidNozzle, 'fcfg'), /nozzleSize is not a readable number/);
});
