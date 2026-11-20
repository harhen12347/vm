const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const databasePath = path.join(root, 'src', 'printer-database.json');

function readJsonFiles(directory) {
  return fs.readdirSync(directory).filter((file) => file.endsWith('.json')).map((file) => ({
    file,
    value: JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))
  }));
}

function resolveMachine(machine, byName, chain = new Set()) {
  if (!machine || chain.has(machine.name)) throw new Error(`FlashForge profile inheritance cycle at ${machine?.name}.`);
  const nextChain = new Set(chain).add(machine.name);
  const parent = machine.inherits ? byName.get(machine.inherits) : null;
  return { ...(parent ? resolveMachine(parent, byName, nextChain) : {}), ...machine };
}

function firstNumber(value) {
  const candidate = Array.isArray(value) ? value[0] : value;
  const number = Number(candidate);
  return Number.isFinite(number) ? number : null;
}

function booleanSetting(value) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === true || candidate === 1 || candidate === '1' || candidate === 'true') return true;
  if (candidate === false || candidate === 0 || candidate === '0' || candidate === 'false') return false;
  return null;
}

function volumeFromArea(area) {
  if (!Array.isArray(area) || area.length < 3) return { buildVolume: { x: null, y: null, z: null }, centered: false, rectangular: false };
  const points = area.map((point) => String(point).split('x').map(Number));
  if (points.some((point) => point.length !== 2 || point.some((value) => !Number.isFinite(value)))) {
    return { buildVolume: { x: null, y: null, z: null }, centered: false, rectangular: false };
  }
  const xs = points.map(([x]) => x), ys = points.map(([, y]) => y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const corners = new Set(points.map(([x, y]) => `${x},${y}`));
  const rectangular = corners.size === 4 &&
    [[minX,minY],[minX,maxY],[maxX,minY],[maxX,maxY]].every(([x,y])=>corners.has(`${x},${y}`));
  return {
    buildVolume: { x: maxX - minX, y: maxY - minY, z: null },
    centered: Math.abs(minX + maxX) < 0.01 && Math.abs(minY + maxY) < 0.01,
    rectangular
  };
}

function profileFromModel(model, machineEntries, filamentEntries, commit, profileDirectory) {
  const machineModels = new Map(machineEntries.map(({ value }) => [value.name, value]));
  const variants = machineEntries.map(({ value }) => value)
    .filter((machine) => machine.printer_model === model.name);
  const resolvedVariants = variants.map((machine) => resolveMachine(machine, machineModels));
  const settings = resolvedVariants[0] || {};
  const area = volumeFromArea(settings.printable_area);
  area.buildVolume.z = firstNumber(settings.printable_height);
  const modelNozzles = String(model.nozzle_diameter || '').split(';')
    .map((value) => Number.parseFloat(value)).filter((value) => Number.isFinite(value) && value >= 0.1 && value <= 5);
  const variantNozzles = resolvedVariants.flatMap((variant) => Array.isArray(variant.nozzle_diameter)
    ? variant.nozzle_diameter.map(Number) : []);
  const nozzleDiameters = [...new Set(modelNozzles.length ? modelNozzles : variantNozzles)]
    .filter((value) => Number.isFinite(value) && value >= 0.1 && value <= 5);
  const filamentByName = new Map(filamentEntries.map(({ value }) => [value.name, value]));
  const materials = String(model.default_materials || '').split(';').map((name) => name.trim()).filter(Boolean);
  const filamentDiameters = new Set();
  for (const name of materials) {
    const material = filamentByName.get(name);
    if (material) {
      const diameter = firstNumber(material.filament_diameter);
      if (diameter) filamentDiameters.add(diameter);
    }
  }
  const retractionDistance = firstNumber(settings.retraction_length);
  const retractionSpeed = firstNumber(settings.retraction_speed);
  const coverName = `${model.name}_cover.png`;
  const hasImage = fs.existsSync(path.join(profileDirectory, coverName));
  const profileSlug = model.model_id || model.name.replace(/[^a-z0-9]+/gi, '-');

  return {
    id: `flashforge-${profileSlug.toLowerCase()}`,
    manufacturer: model.family || 'Flashforge',
    series: model.name.match(/\b(Adventurer|Creator|Guider|Finder|Dreamer|Inventor)\b/i)?.[1] || 'Other',
    model: model.name.replace(/^Flashforge\s+/i, ''),
    buildVolume: area.buildVolume,
    nozzleDiameters,
    filamentDiameter: filamentDiameters.size === 1 ? [...filamentDiameters][0] : null,
    extruderCount: Array.isArray(settings.extruder_offset) ? settings.extruder_offset.length : null,
    relativeExtrusion: booleanSetting(settings.use_relative_e_distances),
    heatedBed: typeof settings.heated_bed === 'boolean' ? settings.heated_bed :
      typeof settings.machine_heated_bed === 'boolean' ? settings.machine_heated_bed : null,
    maxNozzleTemperature: firstNumber(settings.max_nozzle_temperature),
    maxBedTemperature: firstNumber(settings.max_bed_temperature),
    buildPlateShape: area.rectangular ? 'rectangular' : 'custom',
    originAtCenter: area.centered,
    printHeadConfiguration: null,
    firmwareType: settings.gcode_flavor || null,
    startGcode: typeof settings.machine_start_gcode === 'string' ? settings.machine_start_gcode : null,
    endGcode: typeof settings.machine_end_gcode === 'string' ? settings.machine_end_gcode : null,
    retraction: Number.isFinite(retractionDistance) && Number.isFinite(retractionSpeed)
      ? { distance: retractionDistance, speed: retractionSpeed }
      : null,
    materials,
    outputFormats: settings.printable_area && settings.printable_height && settings.machine_start_gcode && settings.machine_end_gcode
      ? ['gcode'] : [],
    image: hasImage
      ? `https://raw.githubusercontent.com/FlashForge/Orca-Flashforge/${commit}/resources/profiles/Flashforge/${encodeURIComponent(coverName)}`
      : null,
    source: {
      kind: 'flashforge-orca-profile',
      url: `https://github.com/FlashForge/Orca-Flashforge/blob/${commit}/resources/profiles/Flashforge/machine/${encodeURIComponent(variants[0]?.name || `${model.name}.json`)}`,
      commit
    },
    tested: false
  };
}

function buildDatabase(sourcePath) {
  const profileDirectory = path.join(sourcePath, 'resources', 'profiles', 'Flashforge');
  const manifestPath = path.join(sourcePath, 'resources', 'profiles', 'Flashforge.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const machineEntries = readJsonFiles(path.join(profileDirectory, 'machine'));
  const filamentEntries = readJsonFiles(path.join(profileDirectory, 'filament'));
  const commit = execFileSync('git', ['-C', sourcePath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const profiles = manifest.machine_model_list.map((model) =>
    profileFromModel(model, machineEntries, filamentEntries, commit, profileDirectory));
  const current = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
  const retainedProfiles = current.profiles.filter((profile) => profile.source?.kind !== 'flashforge-orca-profile');
  const otherSources = (current.sources || []).filter((source) => source.name !== 'FlashForge Orca');
  const curaSource = otherSources.find((source) => source.name === 'UltiMaker Cura');
  const curaVersion = curaSource ? `cura-${curaSource.commit.slice(0, 12)}+` : '';
  return {
    schemaVersion: 1,
    databaseVersion: `${curaVersion}flashforge-${commit.slice(0, 12)}`,
    sources: [...otherSources, {
      name: 'FlashForge Orca', url: 'https://github.com/FlashForge/Orca-Flashforge', commit
    }],
    profiles: [...retainedProfiles, ...profiles]
  };
}

if (require.main === module) {
  const sourcePath = process.argv[2];
  if (!sourcePath) throw new Error('Usage: npm run import:flashforge-printers -- /path/to/Orca-Flashforge');
  const database = buildDatabase(path.resolve(sourcePath));
  fs.writeFileSync(databasePath, `${JSON.stringify(database, null, 2)}\n`);
  console.log(`Imported ${database.profiles.filter((profile) => profile.source?.kind === 'flashforge-orca-profile').length} FlashForge printer profiles.`);
}

module.exports = { buildDatabase, firstNumber, profileFromModel, resolveMachine, volumeFromArea };