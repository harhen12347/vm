const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const databasePath = path.join(root, 'src', 'printer-database.json');
const reservedDefinitionKeys = new Set(['version', 'name', 'inherits', 'metadata', 'settings', 'overrides']);

function readDefinitions(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter((file) => file.endsWith('.def.json')).map((file) => ({
    id: file.slice(0, -'.def.json'.length),
    value: JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))
  }));
}

function mergeSettings(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    target[key] = { ...(target[key] || {}), ...value };
  }
}

function flattenSettingTree(tree, target = {}) {
  for (const [key, value] of Object.entries(tree || {})) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    if (value.children && typeof value.children === 'object') {
      flattenSettingTree(value.children, target);
    } else if (['default_value', 'value', 'maximum_value', 'minimum_value'].some((field) => Object.hasOwn(value, field))) {
      target[key] = { ...(target[key] || {}), ...value };
    }
  }
  return target;
}

function resolveDefinitions(definitions) {
  const byId = new Map(definitions.map((entry) => [entry.id, entry.value]));
  const resolved = new Map();
  function resolve(id, chain = new Set()) {
    if (resolved.has(id)) return resolved.get(id);
    const definition = byId.get(id);
    if (!definition) return { metadata: {}, settings: {} };
    if (chain.has(id)) throw new Error(`Cura definition inheritance cycle at ${id}.`);
    const nextChain = new Set(chain).add(id);
    const parent = typeof definition.inherits === 'string'
      ? resolve(definition.inherits, nextChain)
      : { metadata: {}, settings: {} };
    const metadata = { ...parent.metadata, ...(definition.metadata || {}) };
    const settings = { ...parent.settings };
    mergeSettings(settings, flattenSettingTree(definition.settings));
    const directSettings = Object.fromEntries(Object.entries(definition)
      .filter(([key, value]) => !reservedDefinitionKeys.has(key) && value && typeof value === 'object' && !Array.isArray(value)));
    mergeSettings(settings, directSettings);
    mergeSettings(settings, definition.overrides);
    const result = { metadata, settings };
    resolved.set(id, result);
    return result;
  }
  return { byId, resolve };
}

function literal(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(text)) return Number(text);
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === 'true';
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === 'string') return parsed;
    } catch {}
    return null;
  }
  if (/^'[^'\n]*'$/.test(text)) {
    return text.slice(1, -1);
  }
  if (/\s+if\s+.+\s+else\s+/s.test(text) ||
      /^[\w.]+\s*(?:[+*/-]\s*[\w.]+)+$/.test(text) ||
      /^(?:math\.)?\w+\(/.test(text)) return null;
  return value;
}

function settingValue(settings, key, field = 'default_value') {
  const setting = settings[key];
  if (!setting || typeof setting !== 'object') return null;
  if (Object.hasOwn(setting, field)) return literal(setting[field]);
  return field === 'default_value' && Object.hasOwn(setting, 'value') ? literal(setting.value) : null;
}

function outputFormats(fileFormats) {
  const formats = Array.isArray(fileFormats) ? fileFormats : String(fileFormats || '').split(';');
  const ids = new Set();
  for (const format of formats) {
    if (format === 'text/x-gcode') ids.add('gcode');
    if (format === 'application/x-ufp') ids.add('ufp');
  }
  return [...ids];
}

function printerSeries(manufacturer, model) {
  if (!/flashforge/i.test(manufacturer)) return 'Unspecified';
  return model.match(/^(Adventurer|Creator|Guider|Finder|Dreamer|Inventor)\b/i)?.[1] || 'Other';
}

function profileFromDefinition(id, definition, resolved, resolver, commit) {
  const { metadata, settings } = resolved;
  const trainIds = Object.values(metadata.machine_extruder_trains || {});
  const trainSettings = trainIds.map((trainId) => resolver.resolve(trainId).settings);
  const nozzleDiameters = [...new Set(trainSettings.map((train) => settingValue(train, 'machine_nozzle_size'))
    .filter((size) => Number.isFinite(size) && size >= 0.1 && size <= 5))];
  const filamentDiameters = [...new Set(trainSettings.map((train) => settingValue(train, 'material_diameter'))
    .filter((diameter) => Number.isFinite(diameter) && diameter > 0))];
  const machineWidth = settingValue(settings, 'machine_width');
  const machineDepth = settingValue(settings, 'machine_depth');
  const machineHeight = settingValue(settings, 'machine_height');
  const shape = settingValue(settings, 'machine_shape');
  const startGcode = settingValue(settings, 'machine_start_gcode');
  const endGcode = settingValue(settings, 'machine_end_gcode');
  const retractionDistance = settingValue(settings, 'retraction_amount');
  const retractionSpeed = settingValue(settings, 'retraction_speed');
  const retraction = Number.isFinite(retractionDistance) && Number.isFinite(retractionSpeed)
    ? { distance: retractionDistance, speed: retractionSpeed }
    : null;
  const nozzleLimits = trainSettings.map((train) => settingValue(train, 'material_print_temperature', 'maximum_value'))
    .filter((temperature) => Number.isFinite(temperature));
  const bedLimit = settingValue(settings, 'material_bed_temperature', 'maximum_value');
  const extruderCount = settingValue(settings, 'machine_extruder_count') || trainIds.length || null;
  const printerName = definition.name || settingValue(settings, 'machine_name') || id;

  return {
    id: `cura-${id}`,
    manufacturer: metadata.manufacturer || 'Unspecified',
    series: metadata.series || printerSeries(metadata.manufacturer || '', definition.name || id),
    model: printerName,
    buildVolume: { x: machineWidth, y: machineDepth, z: machineHeight },
    nozzleDiameters,
    filamentDiameter: filamentDiameters.length === 1 ? filamentDiameters[0] : null,
    extruderCount,
    relativeExtrusion: typeof startGcode === 'string' && /(?:^|\n)\s*M83\b/i.test(startGcode)
      ? true : typeof startGcode === 'string' && /(?:^|\n)\s*M82\b/i.test(startGcode) ? false : null,
    heatedBed: settingValue(settings, 'machine_heated_bed'),
    maxNozzleTemperature: nozzleLimits.length ? Math.min(...nozzleLimits) : null,
    maxBedTemperature: Number.isFinite(bedLimit) ? bedLimit : null,
    buildPlateShape: shape === 'elliptic' ? 'circular' : shape || null,
    originAtCenter: settingValue(settings, 'machine_center_is_zero'),
    printHeadConfiguration: settingValue(settings, 'machine_head_with_fans_polygon'),
    firmwareType: settingValue(settings, 'machine_gcode_flavor'),
    startGcode: typeof startGcode === 'string' ? startGcode : null,
    endGcode: typeof endGcode === 'string' ? endGcode : null,
    retraction,
    materials: [],
    outputFormats: outputFormats(metadata.file_formats),
    source: {
      kind: 'cura-definition',
      author: metadata.author || null,
      url: `https://github.com/Ultimaker/Cura/blob/${commit}/resources/definitions/${id}.def.json`,
      commit
    },
    tested: false
  };
}

function buildDatabase(sourcePath) {
  const definitionsPath = path.join(sourcePath, 'resources', 'definitions');
  const extrudersPath = path.join(sourcePath, 'resources', 'extruders');
  const definitions = readDefinitions(definitionsPath);
  const extruders = readDefinitions(extrudersPath);
  if (!definitions.length) throw new Error(`No Cura definitions found under ${definitionsPath}.`);
  const resolver = resolveDefinitions([...definitions, ...extruders]);
  const commit = execFileSync('git', ['-C', sourcePath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const profiles = [];

  for (const { id, value } of definitions) {
    const resolved = resolver.resolve(id);
    const { metadata } = resolved;
    if (metadata.visible === false) continue;
    profiles.push(profileFromDefinition(id, value, resolved, resolver, commit));
  }

  const current = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
  const retainedProfiles = current.profiles.filter((profile) => profile.source?.kind !== 'cura-definition');
  return {
    schemaVersion: 1,
    databaseVersion: `cura-${commit.slice(0, 12)}${current.sources?.some((source) => source.name === 'FlashForge Orca') ? `+flashforge-${current.sources.find((source) => source.name === 'FlashForge Orca').commit.slice(0, 12)}` : ''}`,
    sources: [
      ...(current.sources || []).filter((source) => source.name !== 'UltiMaker Cura'),
      { name: 'UltiMaker Cura', url: 'https://github.com/Ultimaker/Cura', commit }
    ],
    profiles: [...retainedProfiles, ...profiles]
  };
}

if (require.main === module) {
  const sourcePath = process.argv[2];
  if (!sourcePath) throw new Error('Usage: npm run import:cura-printers -- /path/to/Cura');
  const database = buildDatabase(path.resolve(sourcePath));
  fs.writeFileSync(databasePath, `${JSON.stringify(database, null, 2)}\n`);
  console.log(`Imported ${database.profiles.filter((profile) => profile.source?.kind === 'cura-definition').length} visible Cura printer definitions from ${database.databaseVersion}.`);
}

module.exports = { buildDatabase, flattenSettingTree, literal, outputFormats, printerSeries, profileFromDefinition, resolveDefinitions };