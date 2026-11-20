const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const database = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'printer-database.json'), 'utf8'));
const { availableOutputFormats, profileErrors, profileWarnings, unsupportedGcodeTokens, validateDatabase } = require('../src/printer-database.mjs');
const { literal, printerSeries, profileFromDefinition, resolveDefinitions } = require('../scripts/import-cura-printers');
const { profileFromModel } = require('../scripts/import-flashforge-printers');

test('bundled printer database validates and keeps its geometry-only templates untested', () => {
  assert.equal(validateDatabase(database), database);
  assert.deepEqual(availableOutputFormats(database.profiles[0]), ['gcode']);
  assert.ok(profileWarnings(database.profiles[0]).some((warning) => warning.includes('not been tested')));
});

test('rejects invalid dimensions and unknown output format identifiers', () => {
  const invalid = {
    ...database.profiles[0],
    buildVolume: { x: 0, y: 220, z: 250 },
    outputFormats: ['gx']
  };
  const errors = profileErrors(invalid);
  assert.ok(errors.some((error) => error.includes('buildVolume.x')));
  assert.deepEqual(availableOutputFormats(invalid), []);
});

test('rejects duplicate profile ids in a database', () => {
  assert.throws(() => validateDatabase({
    ...database,
    profiles: [database.profiles[0], { ...database.profiles[0] }]
  }), /Duplicate printer profile id/);
});

test('resolves inherited Cura machine and extruder settings without evaluating expressions', () => {
  const definitions = [
    { id: 'fdmprinter', value: { overrides: {
      machine_width: { default_value: 100 }, machine_depth: { default_value: 90 },
      machine_height: { default_value: 70 }, machine_heated_bed: { default_value: true },
      machine_extruder_count: { default_value: 1 }, machine_center_is_zero: { default_value: true },
      material_bed_temperature: { maximum_value: 100 }
    } } },
    { id: 'fdmextruder', value: { overrides: {
      machine_nozzle_size: { default_value: 0.4 }, material_diameter: { default_value: 1.75 },
      material_print_temperature: { maximum_value: 260 }
    } } },
    { id: 'test-printer', value: { name: 'Test Machine', inherits: 'fdmprinter', metadata: {
      visible: true, manufacturer: 'Test Maker', machine_extruder_trains: { 0: 'test-extruder' },
      file_formats: 'text/x-gcode;application/x-ufp'
    }, overrides: { machine_width: { default_value: 120 } } } },
    { id: 'test-extruder', value: { inherits: 'fdmextruder', overrides: {} } }
  ];
  const resolver = resolveDefinitions(definitions);
  const printer = profileFromDefinition('test-printer', definitions[2].value,
    resolver.resolve('test-printer'), resolver, 'fixture-commit');
  assert.equal(printer.buildVolume.x, 120);
  assert.equal(printer.buildVolume.y, 90);
  assert.equal(printer.buildVolume.z, 70);
  assert.deepEqual(printer.nozzleDiameters, [0.4]);
  assert.equal(printer.filamentDiameter, 1.75);
  assert.equal(printer.extruderCount, 1);
  assert.equal(printer.originAtCenter, true);
  assert.equal(printer.relativeExtrusion, null);
  assert.deepEqual(printer.outputFormats, ['gcode', 'ufp']);
  assert.equal(printer.tested, false);
  assert.match(printer.source.url, /fixture-commit/);
  assert.equal(printerSeries('Flashforge', 'Adventurer 3'), 'Adventurer');
  assert.equal(literal('machine_width / 2'), null);
});

test('builds FlashForge profiles from vendor model and machine data', () => {
  const model = {
    name: 'Flashforge Test Printer', model_id: 'Flashforge-Test-Printer', family: 'Flashforge',
    nozzle_diameter: '0.4;0.6', default_materials: 'Flashforge PLA'
  };
  const machineEntries = [
    { file: 'common.json', value: { name: 'common', printable_area: ['-50x-40','50x-40','50x40','-50x40'], printable_height: '160' } },
    { file: 'machine.json', value: { name: 'Test Printer 0.4 Nozzle', printer_model: model.name,
      inherits: 'common', nozzle_diameter: ['0.4'], extruder_offset: ['0x0'], gcode_flavor: 'marlin',
      machine_start_gcode: 'G28', machine_end_gcode: 'M84', retraction_length: ['0.8'], retraction_speed: ['30'],
      use_relative_e_distances: '1' } }
  ];
  const filamentEntries = [{ file: 'pla.json', value: { name: 'Flashforge PLA', filament_diameter: ['1.75'] } }];
  const profile = profileFromModel(model, machineEntries, filamentEntries, 'fixture-commit', '/no-images');
  assert.deepEqual(profile.buildVolume, { x: 100, y: 80, z: 160 });
  assert.deepEqual(profile.nozzleDiameters, [0.4, 0.6]);
  assert.equal(profile.filamentDiameter, 1.75);
  assert.equal(profile.originAtCenter, true);
  assert.deepEqual(profile.outputFormats, ['gcode']);
  assert.equal(profile.firmwareType, 'marlin');
  assert.equal(profile.relativeExtrusion, true);
  assert.equal(profile.tested, false);
});

test('does not advertise a printer output when machine G-code contains unknown placeholders', () => {
  const profile = {
    ...database.profiles[0],
    startGcode: 'M900 K[pressure_advance]'
  };
  assert.deepEqual(unsupportedGcodeTokens(profile), ['pressure_advance']);
  assert.deepEqual(availableOutputFormats(profile), []);
});