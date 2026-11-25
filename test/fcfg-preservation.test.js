const test = require('node:test');
const assert = require('node:assert/strict');

let core;
test.before(async () => {
  core = await import('../src/printer-config-core.mjs');
});

test('editing mapped FCFG settings preserves unknown metadata and CRLF line order', () => {
  const lines = [
	'; exported profile note',
	'[Custom]',
	'machineId=9',
	String.raw`nozzleSize=@Variant(\0\0\0\x87>\xcc\xcc\xcd)`,
	'profileName=Standard PLA',
	'materialName0=Flashforge-PLA-1',
	String.raw`futureCustomValue=@Variant(\0\0\0\x01future-type)`,
	'',
	'[General]',
	String.raw`layerHeight=@Variant(\0\0\0\x87>\x4c\xcc\xcd)`,
	String.raw`fillDensity=@Variant(\0\0\0\x87>\x19\x99\x9a)`,
	String.raw`accelerationGeneral=@Variant(\0\0\0\x87\x44\xfa\0\0)`,
	'futureGeneralValue=keep=all=characters',
	String.raw`futureGeneralVariant=@Variant(\0\0\x03\xe7unrecognized)`,
	'; end of profile'
  ];
  const source = lines.join('\r\n');
  const profile = core.parseProfile(source, 'fcfg');
  profile.name = 'Edited profile';
  profile.settings.infillPercentage = 25;
  profile.settings.acceleration = 2500;

  const exported = new TextDecoder().decode(core.serializeProfile(profile, 'fcfg'));
  const outputLines = exported.split('\r\n');
  const mutableLines = ['profileName=', 'fillDensity=', 'accelerationGeneral='];
  const isMutable = (line) => mutableLines.some((prefix) => line.startsWith(prefix));

  assert.deepEqual(outputLines.filter((line) => !isMutable(line)), lines.filter((line) => !isMutable(line)));
  assert.equal(outputLines.length, lines.length);
  assert.equal(profile.sourceData.fcfg.nativeMachineId, 9);
  assert.equal(profile.sourceData.fcfg.nativeMaterialName, 'Flashforge-PLA-1');
  const reimported = core.parseProfile(exported, 'fcfg');
  assert.equal(reimported.settings.infillPercentage, 25);
  assert.equal(reimported.settings.acceleration, 2500);
});
