const test = require('node:test');
const assert = require('node:assert/strict');

let core;
let codec;
const fcfgText = (output) => output instanceof Uint8Array ? new TextDecoder().decode(output) : output;
test.before(async () => {
  core = await import('../src/printer-config-core.mjs');
  codec = await import('../src/fcfg-format.mjs');
});

const referenceProfile = String.raw`[Custom]
machineId=9
nozzleSize=@Variant(\0\0\0\x87>\xcc\xcc\xcd)
profileName=Standard PLA
materialName0=Flashforge-PLA-1
materialName1=

[General]
layerHeight=@Variant(\0\0\0\x87>\x4c\xcc\xcd)
firstLayerHeight=@Variant(\0\0\0\x87>\x80\0\0)
shellCnt=@Variant(\0\0\0\x87@@\0\0)
shellOuterMaxSpeed=@Variant(\0\0\0\x87\x42\x20\0\0)
shellVisibleInnerMaxSpeed=@Variant(\0\0\0\x87\x42\xa0\0\0)
travelSpeed=@Variant(\0\0\0\x87\x42\xc8\0\0)
fillDensity=@Variant(\0\0\0\x87>\x19\x99\x9a)
fillTopSolidCnt=@Variant(\0\0\0\x87@\xa0\0\0)
fillBottomSolidCnt=@Variant(\0\0\0\x87@\x80\0\0)
extruderTemp0=@Variant(\0\0\0\x87\x43\x52\0\0)
platformTemp=@Variant(\0\0\0\x87\x42\x5c\0\0)
retractLen0=@Variant(\0\0\0\x87@\xa0\0\0)
retractInSpeed0=@Variant(\0\0\0\x87\x41\xc8\0\0)
accelerationGeneral=@Variant(\0\0\0\x87\x44\xfa\0\0)
accelerationTravel=@Variant(\0\0\0\x87\x44\xfa\0\0)
fanSpeed0=@Variant(\0\0\0\x87\x42\xc8\0\0)
extrusionRatio=@Variant(\0\0\0\x87?\x80\0\0)
unknownBoolean=true
unknownList=[]
unknownString=Keep this value`;

test('decodes an FCFG template, maps profile settings, and round-trips all native fields', () => {
  const profile = core.parseProfile(referenceProfile, 'fcfg', 'fallback');
  assert.equal(profile.name, 'Standard PLA');
  assert.equal(profile.printerId, 'flashprint-machine-9');
  assert.equal(profile.nozzle, 0.4);
  assert.equal(profile.filament, 'PLA');
  assert.equal(profile.settings.layerHeight, 0.2);
  assert.equal(profile.settings.infillPercentage, 15);
  assert.equal(profile.settings.wallCount, 3);
  assert.equal(profile.settings.acceleration, 2000);
  assert.equal(profile.settings.accelerationTravel, 2000);
  assert.equal(core.canExportFCFG(profile), true);

  const exported = fcfgText(core.serializeProfile(profile, 'fcfg'));
  const before = codec.inspectFCFG(codec.decodeFCFG(referenceProfile));
  const after = codec.inspectFCFG(codec.decodeFCFG(exported));
  assert.deepEqual(after, before);
  assert.match(exported, /machineId=9/);
  assert.match(exported, /unknownString=Keep this value/);
  assert.match(exported, /profileName=Standard PLA/);
});

test('edits mapped values in an imported FCFG template without replacing native metadata', () => {
  const profile = core.parseProfile(referenceProfile, 'fcfg');
  profile.name = 'Custom reviewed profile';
  profile.settings.infillPercentage = 25;
  profile.settings.acceleration = 503;
  assert.throws(() => core.serializeProfile(profile, 'fcfg'), /acceleration.*increments of 10/i);
  profile.settings.acceleration = 2500;
  profile.settings.accelerationTravel = 1500;
  profile.settings.nozzleTemperature = 215;

  const exported = fcfgText(core.serializeProfile(profile, 'fcfg'));
  const updated = core.parseProfile(exported, 'fcfg');
  assert.equal(updated.name, 'Custom reviewed profile');
  assert.equal(updated.settings.infillPercentage, 25);
  assert.equal(updated.settings.acceleration, 2500);
  assert.equal(updated.settings.accelerationTravel, 1500);
  assert.equal(updated.settings.nozzleTemperature, 215);
  assert.equal(updated.sourceData.fcfg.nativeMachineId, 9);
  assert.match(exported, /unknownString=Keep this value/);
  assert.match(exported, /materialName0=Flashforge-PLA-1/);
});

test('rejects malformed or incomplete FCFG and requires a native template for export', () => {
  assert.throws(() => core.parseProfile('', 'fcfg'), /empty/);
  assert.throws(() => core.parseProfile('[General]\nlayerHeight=0.2', 'fcfg'), /\[Custom\] and \[General\]/);
  assert.throws(() => core.parseProfile('[Custom]\nprofileName=Missing machine\nnozzleSize=0.4\n[General]', 'fcfg'), /machine.*metadata/);
  assert.throws(() => codec.decodeFCFG('[Custom]\nmachineId=9\nmachineId=10\n[General]'), /duplicate/);
  assert.throws(() => core.serializeProfile(core.createProfile(), 'fcfg'), /native template is required/);
  assert.throws(() => core.parseProfile('not an fcfg', 'fcfg'), /line 1/);
});

test('opaque variants and unchanged native fields are preserved verbatim', () => {
  const text = String.raw`[Custom]
machineId=9
profileName=Literal template
nozzleSize=@Variant(\0\0\0\x87>\xcc\xcc\xcd)
opaque=@Variant(\0\0\0\x01future-type)
[General]
layerHeight=@Variant(\0\0\0\x87>\x5\x1e\xb8)
unknown=unchanged`;
  const profile = core.parseProfile(text, 'fcfg');
  const output = fcfgText(core.serializeProfile(profile, 'fcfg'));
  assert.match(output, /opaque=@Variant\(\\0\\0\\0\\x01future-type\)/);
  assert.match(output, /layerHeight=@Variant\(\\0\\0\\0\\x87/);
  assert.match(output, /unknown=unchanged/);
});
