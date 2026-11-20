export const PRINTER_DATABASE_SCHEMA_VERSION = 1;

export const OUTPUT_FORMATS = Object.freeze({
  gcode: { label: 'G-code', extension: 'gcode', kind: 'machine', exporter: true },
  g: { label: 'FlashForge G', extension: 'g', kind: 'machine', exporter: false },
  gx: { label: 'FlashForge GX', extension: 'gx', kind: 'machine', exporter: false },
  ufp: { label: 'UltiMaker UFP', extension: 'ufp', kind: 'machine', exporter: false },
  gz: { label: 'G-code (gzip)', extension: 'gz', kind: 'machine', exporter: false },
  fpp: { label: 'FlashPrint project', extension: 'fpp', kind: 'project', exporter: false },
  '3mf-project': { label: '3MF project', extension: '3mf', kind: 'project', exporter: false },
  prism: { label: 'Prism project', extension: 'prism', kind: 'project', exporter: true }
});

const CURA_ENGINE_FLAVORS = new Set([
  'RepRap (Marlin/Sprinter)', 'RepRap (Volumetric)', 'RepRap (RepRap)',
  'UltiGCode', 'Griffin', 'Makerbot', 'BFB', 'MACH3', 'Repetier'
]);

export function profileErrors(profile) {
  const errors = [];
  if (!profile || typeof profile !== 'object') return ['Profile must be an object.'];
  for (const field of ['id', 'manufacturer', 'series', 'model']) {
    if (typeof profile[field] !== 'string' || !profile[field].trim()) errors.push(`${field} is required.`);
  }
  for (const axis of ['x', 'y', 'z']) {
    const raw = profile.buildVolume?.[axis];
    const dimension = Number(raw);
    if (raw != null && (!Number.isFinite(dimension) || dimension < 10 || dimension > 3000)) {
      errors.push(`buildVolume.${axis} must be between 10 and 3000 mm.`);
    }
  }
  if (!Array.isArray(profile.nozzleDiameters) ||
      profile.nozzleDiameters.some((value) => !Number.isFinite(Number(value)) || Number(value) < 0.1 || Number(value) > 5)) {
    errors.push('nozzleDiameters must contain valid nozzle sizes.');
  }
  if (profile.filamentDiameter != null && (!Number.isFinite(Number(profile.filamentDiameter)) || Number(profile.filamentDiameter) <= 0)) {
    errors.push('filamentDiameter must be a positive number.');
  }
  if (profile.extruderCount != null && (!Number.isInteger(Number(profile.extruderCount)) || Number(profile.extruderCount) < 1)) {
    errors.push('extruderCount must be a positive integer.');
  }
  if (!Array.isArray(profile.outputFormats) ||
      profile.outputFormats.some((format) => !Object.hasOwn(OUTPUT_FORMATS, format))) {
    errors.push('outputFormats must contain known format identifiers.');
  }
  if (profile.source && profile.source.url !== null && typeof profile.source.url !== 'string') {
    errors.push('source.url must be a URL string or null.');
  }
  return errors;
}

export function profileWarnings(profile) {
  const warnings = [];
  for (const axis of ['x', 'y', 'z']) {
    if (!Number.isFinite(Number(profile.buildVolume?.[axis])) || Number(profile.buildVolume[axis]) <= 0) {
      warnings.push(`Build volume ${axis.toUpperCase()} is not specified.`);
    }
  }
  if (!profile.nozzleDiameters?.length) warnings.push('Nozzle diameter options are not specified.');
  if (profile.filamentDiameter == null) warnings.push('Filament diameter is not specified.');
  if (profile.extruderCount == null) warnings.push('Extruder count is not specified.');
  if (typeof profile.relativeExtrusion !== 'boolean') warnings.push('Extrusion mode is not specified.');
  if (typeof profile.originAtCenter !== 'boolean') warnings.push('Printer coordinate origin is not specified.');
  if (!profile.heatedBed && profile.heatedBed !== false) warnings.push('Heated-bed support is not specified.');
  if (profile.maxNozzleTemperature == null || !Number.isFinite(Number(profile.maxNozzleTemperature))) warnings.push('Maximum nozzle temperature is not specified.');
  if (profile.maxBedTemperature == null || !Number.isFinite(Number(profile.maxBedTemperature))) warnings.push('Maximum bed temperature is not specified.');
  if (!profile.printHeadConfiguration) warnings.push('Print-head configuration is not specified.');
  if (!profile.firmwareType) warnings.push('Firmware type is not specified.');
  if (!profile.startGcode) warnings.push('Start G-code is not specified.');
  if (!profile.endGcode) warnings.push('End G-code is not specified.');
  if (!profile.retraction || !Number.isFinite(Number(profile.retraction.distance))) warnings.push('Retraction settings are not specified.');
  if (!Array.isArray(profile.materials) || !profile.materials.length) warnings.push('Supported materials are not specified.');
  if (!profile.outputFormats?.length) warnings.push('Compatible output formats are not specified.');
  if (!profile.source?.url) warnings.push('No authoritative source is recorded.');
  if (!profile.tested) warnings.push('This profile has not been tested on the physical printer.');
  const unsupported = unsupportedGcodeTokens(profile);
  if (unsupported.length) warnings.push(`Unsupported printer G-code tokens: ${unsupported.join(', ')}.`);
  return warnings;
}

export function unsupportedGcodeTokens(profile) {
  const supported = new Set([
    'material_bed_temperature', 'material_bed_temperature_layer_0', 'bed_temperature_initial_layer_single',
    'material_print_temperature', 'material_print_temperature_layer_0', 'material_initial_print_temperature',
    'material_final_print_temperature', 'nozzle_temperature_initial_layer', 'layer_height', 'layer_height_0',
    'machine_nozzle_size', 'retraction_amount', 'retraction_speed'
  ]);
  const tokens = new Set();
  for (const code of [profile.startGcode, profile.endGcode]) {
    if (typeof code !== 'string') continue;
    if (/^\s*(?:START|END)_GCODE\s*$/im.test(code)) tokens.add('unexpanded G-code macro');
    if (/\s+if\s+.+\s+else\s+/s.test(code)) tokens.add('unresolved Cura setting expression');
    for (const match of code.matchAll(/\{([^}]+)\}|\[([^\]]+)\]/g)) {
      const token = (match[1] || match[2]).trim();
      if (!supported.has(token) && !(profile.extruderCount === 1 && ['initial_extruder', 'initial_no_support_extruder'].includes(token))) {
        tokens.add(token);
      }
    }
  }
  return [...tokens];
}

export function availableOutputFormats(profile) {
  if (!profile || unsupportedGcodeTokens(profile).length || typeof profile.relativeExtrusion !== 'boolean' ||
      typeof profile.originAtCenter !== 'boolean' || Number(profile.extruderCount) !== 1 ||
      !Array.isArray(profile.nozzleDiameters) || !profile.nozzleDiameters.length ||
      !Number.isFinite(Number(profile.filamentDiameter)) || Number(profile.filamentDiameter) <= 0 ||
      ['x', 'y', 'z'].some((axis) => !Number.isFinite(Number(profile.buildVolume?.[axis])) || Number(profile.buildVolume[axis]) <= 0)) return [];
  if (profile.manufacturer !== 'Custom' &&
      (!CURA_ENGINE_FLAVORS.has(profile.firmwareType) || profile.buildPlateShape !== 'rectangular' ||
       !profile.startGcode?.trim() || !profile.endGcode?.trim())) return [];
  return (profile.outputFormats || []).filter((id) =>
    OUTPUT_FORMATS[id]?.kind === 'machine' && OUTPUT_FORMATS[id].exporter);
}

export function validateDatabase(database) {
  if (database?.schemaVersion !== PRINTER_DATABASE_SCHEMA_VERSION || !Array.isArray(database.profiles)) {
    throw new Error(`Unsupported printer database schema; expected version ${PRINTER_DATABASE_SCHEMA_VERSION}.`);
  }
  const ids = new Set();
  for (const profile of database.profiles) {
    const errors = profileErrors(profile);
    if (errors.length) throw new Error(`${profile?.id || 'Printer profile'}: ${errors.join(' ')}`);
    if (ids.has(profile.id)) throw new Error(`Duplicate printer profile id: ${profile.id}.`);
    ids.add(profile.id);
  }
  return database;
}