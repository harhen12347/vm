const test = require('node:test');
const assert = require('node:assert/strict');

let core;
test.before(async () => {
  core = await import('../src/printer-config-core.mjs');
});

test('creates nozzle-aware full profiles and distinct complete printer presets', () => {
  const narrow = core.createProfile({ nozzle: 0.4, printerId: 'flashforge-adventurer-5m' });
  const wide = core.createProfile({ nozzle: 0.6, printerId: 'flashforge-adventurer-5m' });
  assert.equal(narrow.settings.lineWidth, 0.4);
  assert.equal(narrow.settings.layerHeight, 0.2);
  assert.equal(wide.settings.lineWidth, 0.6);
  assert.equal(wide.settings.layerHeight, 0.3);
  for (const preset of core.PRESET_TYPES) {
    const result = core.applyPreset(narrow, preset);
    assert.deepEqual(Object.keys(result.settings).sort(), Object.keys(core.SETTING_DEFAULTS).sort());
  }
  assert.notEqual(core.applyPreset(narrow, 'Fast').settings.outerWallSpeed, core.applyPreset(narrow, 'Fine Detail').settings.outerWallSpeed);
  assert.notEqual(
    core.applyPreset(narrow, 'Balanced').settings.outerWallSpeed,
    core.applyPreset({ ...narrow, printerId: 'creality-ender-3-v2-neo' }, 'Balanced').settings.outerWallSpeed
  );
  const configuredMachineSpeeds = ['flashforge-adventurer-5m', 'flashforge-adventurer-5m-pro', 'creality-ender-3-v2-neo', 'bambu-a1', 'prusa-mk4'].map((printerId) =>
    core.applyPreset({ ...narrow, printerId }, 'Balanced').settings.outerWallSpeed
  );
  assert.equal(new Set(configuredMachineSpeeds).size, configuredMachineSpeeds.length);
  assert.deepEqual(core.PRINTERS.find((printer) => printer.id === 'bambu-a1').buildVolume, null);
  assert.deepEqual(core.PRINTERS.find((printer) => printer.id === 'bambu-a1').nozzleDiameters, []);
});

test('generator responds to quality, speed, and strength targets', () => {
  const profile = core.createProfile({ nozzle: 0.4, filament: 'PLA' });
  const detailed = core.generateSettings(profile, { quality: 100, speed: 0, strength: 0 });
  const quickStrong = core.generateSettings(profile, { quality: 0, speed: 100, strength: 100 });
  assert.ok(detailed.settings.layerHeight < quickStrong.settings.layerHeight);
  assert.ok(detailed.settings.outerWallSpeed < quickStrong.settings.outerWallSpeed);
  assert.ok(detailed.settings.wallCount < quickStrong.settings.wallCount);
  assert.ok(detailed.explanations.length >= 3);
});

test('filament choices produce their own starting temperatures and nozzle changes update line widths', () => {
  const pla = core.createProfile({ nozzle: 0.4, filament: 'PLA' });
  const petg = core.createProfile({ nozzle: 0.6, filament: 'PETG' });
  assert.equal(pla.settings.lineWidth, 0.4);
  assert.equal(petg.settings.lineWidth, 0.6);
  assert.notEqual(pla.settings.nozzleTemperature, petg.settings.nozzleTemperature);
  assert.notEqual(pla.settings.bedTemperature, petg.settings.bedTemperature);
});

test('generic JSON, CSV, TXT, INI, and CFG export/import preserve profile metadata and settings', () => {
  const original = core.createProfile({
    printerId: 'flashforge-adventurer-5m', nozzle: 0.6, filament: 'PETG', name: 'Bracket, PETG'
  });
  for (const format of ['json', 'csv', 'txt', 'ini', 'cfg']) {
    const imported = core.parseProfile(core.serializeProfile(original, format), format, 'fallback');
    assert.equal(imported.name, original.name, format);
    assert.equal(imported.printerId, original.printerId, format);
    assert.equal(imported.nozzle, original.nozzle, format);
    assert.equal(imported.filament, original.filament, format);
    assert.deepEqual(imported.settings, original.settings, format);
  }
  assert.throws(() => core.serializeProfile(original, 'fcfg'), /native template is required/);
  assert.throws(() => core.parseProfile('not a profile', 'fcfg'), /line 1/);
});

test('validation reports missing fields, filament temperature warnings, and unsupported nozzle sizes', () => {
  const profile = core.createProfile({ printerId: 'flashforge-adventurer-5m', nozzle: 0.4, filament: 'PLA' });
  profile.settings.nozzleTemperature = 250;
  profile.settings.travelSpeed = '';
  profile.settings.layerHeight = 0.123;
  profile.nozzle = 1;
  const { errors, warnings } = core.validateProfile(profile);
  assert.ok(errors.some((item) => item.includes('Travel speed is required')));
  assert.ok(errors.some((item) => item.includes('increments of 0.01')));
  assert.ok(warnings.some((item) => item.includes('not listed')));
  assert.ok(warnings.some((item) => item.includes('outside the PLA')));
});

test('profile collection persistence round-trips and rejects malformed stored data', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  const collection = { profiles: [core.createProfile()], activeId: 'active' };
  assert.equal(core.loadProfileCollection(storage, 'profiles'), null);
  core.saveProfileCollection(storage, 'profiles', collection);
  assert.deepEqual(core.loadProfileCollection(storage, 'profiles'), collection);
  values.set('bad', '{');
  assert.throws(() => core.loadProfileCollection(storage, 'bad'));
});

test('profile comparison only returns changed settings with descriptive labels', () => {
  const first = core.createProfile({ name: 'A' });
  const second = { ...first, settings: { ...first.settings, layerHeight: 0.12, infillPercentage: 50 } };
  const differences = core.compareProfiles([first, second]);
  assert.deepEqual(differences.map((row) => row.key).sort(), ['infillPercentage', 'layerHeight']);
  assert.equal(differences.find((row) => row.key === 'layerHeight').label, 'Layer height');
});

test('acceleration validation accepts only finite increments of ten', () => {
  for (const value of [100, 250, 500, 1000, 1500, 2000, '250']) assert.equal(core.isValidAcceleration(value), true, String(value));
  for (const value of [503, 1001, '', '  ', -10, 0, 12.5, 100010, NaN, Infinity]) assert.equal(core.isValidAcceleration(value), false, String(value));
  assert.equal(core.roundAcceleration(503), 500);
  assert.equal(core.roundAcceleration(1001), 1000);
  assert.throws(() => core.roundAcceleration(''), /finite/);
});

test('every acceleration field is validated after profile import', () => {
  const profile = core.createProfile();
  profile.settings.acceleration = 1001;
  profile.settings.travelAcceleration = 503;
  const imported = core.parseProfile(JSON.stringify(profile), 'json', 'fallback');
  const errors = core.validateProfile(imported).errors;
  assert.ok(errors.some((message) => message.includes('Acceleration') && message.includes('increments of 10')));
  assert.ok(errors.some((message) => message.includes('travelAcceleration') && message.includes('increments of 10')));
  imported.settings.acceleration = 1000;
  imported.settings.travelAcceleration = 500;
  assert.equal(core.validateProfile(imported).errors.some((message) => message.includes('increments of 10')), false);
});

test('all requested filament types and named presets provide editable settings', () => {
  for (const filament of ['PLA', 'PLA+', 'PETG', 'ABS', 'ASA', 'TPU', 'PVA']) {
    assert.ok(core.FILAMENTS[filament], filament);
    const profile = core.createProfile({ filament });
    assert.ok(Number.isFinite(profile.settings.nozzleTemperature), filament);
    assert.ok(Number.isFinite(profile.settings.bedTemperature), filament);
    assert.ok(Number.isFinite(profile.settings.retractionDistance), filament);
  }
  const base = core.createProfile({ preset: 'Custom' });
  for (const preset of ['Draft', 'Balanced', 'Quality', 'High Quality', 'Fast', 'Strong']) {
    const result = core.applyPreset(base, preset);
    assert.notDeepEqual(result.settings, base.settings, preset);
    assert.equal(result.preset, preset);
  }
  assert.deepEqual(core.applyPreset(base, 'Custom').settings, base.settings);
});

test('GX settings map only source values and leave unknown printer specifications unset', () => {
  const handoff = {
    format: 'AETHER_GX_PROFILE_HANDOFF', version: 1, sourceName: 'sample.gx',
    printer: { 'Printer model': 'FlashForge Adventurer 5M', 'Nozzle size': '0.4', 'Nozzle temperature': '215', 'Bed temperature': '60' },
    model: { 'Layer height': '0.16', Infill: '25', Supports: 'true' }
  };
  const known = core.profileFromGX(handoff);
  assert.equal(known.profile.printerId, 'flashforge-adventurer-5m');
  assert.equal(known.profile.settings.nozzleTemperature, 215);
  assert.equal(known.profile.settings.layerHeight, 0.16);
  assert.equal(known.profile.settings.infillPercentage, 25);
  assert.equal(known.profile.settings.supportsEnabled, true);
  assert.ok(known.profile.sourceData.missing.includes('Retraction distance'));

  const unknown = core.profileFromGX({ ...handoff, printer: { 'Printer model': 'Unlisted machine' } });
  assert.equal(unknown.profile.printerId, unknown.printerRecord.id);
  assert.equal(unknown.printerRecord.buildVolume, null);
  assert.deepEqual(unknown.printerRecord.nozzleDiameters, []);
});
