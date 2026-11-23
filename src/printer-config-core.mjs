export const NOZZLES = [0.2, 0.25, 0.4, 0.6, 0.8, 1.0];

export const PRINTERS = [
  {
    id: 'flashforge-adventurer-5m', manufacturer: 'Flashforge', model: 'Adventurer 5M',
    buildVolume: { x: 220, y: 220, z: 220 }, nozzleDiameters: [0.25, 0.4, 0.6, 0.8],
    maxNozzleTemperature: null, maxBedTemperature: null, supportedMaterials: [],
    technology: 'FFF', verified: ['buildVolume', 'nozzleDiameters'],
    source: 'https://github.com/FlashForge/Orca-Flashforge/tree/c45cc8216c184574c36873314ae7caea67c7a1ad/resources/profiles/Flashforge'
  },
  {
    id: 'flashforge-adventurer-5m-pro', manufacturer: 'Flashforge', model: 'Adventurer 5M Pro',
    buildVolume: { x: 220, y: 220, z: 220 }, nozzleDiameters: [0.25, 0.4, 0.6, 0.8],
    maxNozzleTemperature: null, maxBedTemperature: null, supportedMaterials: [],
    technology: 'FFF', verified: ['buildVolume', 'nozzleDiameters'],
    source: 'https://github.com/FlashForge/Orca-Flashforge/tree/c45cc8216c184574c36873314ae7caea67c7a1ad/resources/profiles/Flashforge'
  },
  ...[
    ['creality-ender-3-v2-neo', 'Creality', 'Ender 3 V2 Neo'],
    ['creality-ender-3-v3', 'Creality', 'Ender 3 V3'],
    ['bambu-a1', 'Bambu Lab', 'A1'],
    ['bambu-p1s', 'Bambu Lab', 'P1S'],
    ['prusa-mk4', 'Prusa Research', 'MK4']
  ].map(([id, manufacturer, model]) => ({
    id, manufacturer, model, buildVolume: null, nozzleDiameters: [],
    maxNozzleTemperature: null, maxBedTemperature: null, supportedMaterials: [],
    technology: null, verified: [], source: null
  }))
];

export const FILAMENTS = {
  PLA: { nozzle: [190, 220], bed: [0, 60], cooling: 'High cooling after the first layers; reduce for layer bonding.', retraction: [0.5, 1.5], speed: [30, 80], enclosure: 'Not usually required', drying: 'Dry if damp or stringing; follow spool maker guidance.' },
  'PLA+': { nozzle: [195, 225], bed: [0, 65], cooling: 'Moderate to high cooling; tune for layer adhesion.', retraction: [0.5, 1.5], speed: [30, 70], enclosure: 'Not usually required', drying: 'Follow the filament maker; formulation varies.' },
  PETG: { nozzle: [220, 250], bed: [60, 85], cooling: 'Low to moderate cooling; tune to avoid weak layers.', retraction: [0.5, 2], speed: [25, 60], enclosure: 'Not required for most grades', drying: 'Moisture-sensitive; dry according to spool maker.' },
  ABS: { nozzle: [230, 260], bed: [90, 110], cooling: 'Low cooling; avoid drafts.', retraction: [0.5, 2], speed: [25, 60], enclosure: 'Recommended; ventilate appropriately.', drying: 'Dry according to spool maker.' },
  ASA: { nozzle: [230, 260], bed: [90, 110], cooling: 'Low cooling; avoid drafts.', retraction: [0.5, 2], speed: [25, 60], enclosure: 'Recommended; ventilate appropriately.', drying: 'Dry according to spool maker.' },
  TPU: { nozzle: [210, 240], bed: [30, 60], cooling: 'Low to moderate cooling.', retraction: [0.2, 1], speed: [15, 35], enclosure: 'Not usually required', drying: 'Moisture-sensitive; dry according to spool maker.' },
  Nylon: { nozzle: [240, 280], bed: [70, 100], cooling: 'Low cooling.', retraction: [0.5, 2], speed: [20, 50], enclosure: 'Recommended for many grades.', drying: 'Strongly moisture-sensitive; follow spool maker.' },
  PC: { nozzle: [260, 300], bed: [90, 120], cooling: 'Low cooling.', retraction: [0.5, 2], speed: [20, 50], enclosure: 'Recommended; check printer capability.', drying: 'Moisture-sensitive; follow spool maker.' }
};

export const SETTING_GROUPS = {
  Quality: {
    layerHeight: { label: 'Layer height', unit: 'mm', min: 0.04, max: 1, step: 0.01, explanation: 'Vertical layer thickness; smaller layers improve detail and increase print time.' },
    initialLayerHeight: { label: 'Initial layer height', unit: 'mm', min: 0.04, max: 1, step: 0.01, explanation: 'Thickness of the first layer; tune to the printer’s bed leveling and nozzle.' },
    lineWidth: { label: 'Line width', unit: 'mm', min: 0.1, max: 2, step: 0.01, explanation: 'Extrusion track width; a starting point is near the nozzle diameter.' },
    wallGenerator: { label: 'Wall generator', type: 'select', options: ['Classic', 'Arachne'], explanation: 'Wall-generation strategy. Availability depends on slicer.' },
    seamPosition: { label: 'Seam position', type: 'select', options: ['Aligned', 'Rear', 'Random', 'Sharpest corner'], explanation: 'Where perimeters start and stop.' },
    ironing: { label: 'Ironing', type: 'checkbox', explanation: 'Adds a finishing pass over selected top surfaces; increases time.' },
    resolution: { label: 'Resolution', unit: 'mm', min: 0.01, max: 2, step: 0.01, explanation: 'Tolerance used when approximating curves with toolpath segments.' }
  },
  Strength: {
    wallCount: { label: 'Wall count', min: 1, max: 20, step: 1, explanation: 'Number of perimeter walls; more walls generally improve shell strength.' },
    topLayers: { label: 'Top layers', min: 0, max: 30, step: 1, explanation: 'Solid layers closing the top of the model.' },
    bottomLayers: { label: 'Bottom layers', min: 0, max: 30, step: 1, explanation: 'Solid layers forming the bottom of the model.' },
    infillPercentage: { label: 'Infill', unit: '%', min: 0, max: 100, step: 1, explanation: 'Internal material density; strength depends on geometry and material too.' },
    infillPattern: { label: 'Infill pattern', type: 'select', options: ['Grid', 'Gyroid', 'Lines', 'Cubic', 'Triangles'], explanation: 'Internal structure pattern; options vary by slicer.' },
    infillOverlap: { label: 'Infill overlap', unit: '%', min: 0, max: 50, step: 1, explanation: 'Overlap between infill and perimeter to improve bonding.' }
  },
  Speed: {
    outerWallSpeed: { label: 'Outer wall speed', unit: 'mm/s', min: 1, max: 1000, step: 1, explanation: 'Speed of visible outer perimeters; lower can improve surface finish.' },
    innerWallSpeed: { label: 'Inner wall speed', unit: 'mm/s', min: 1, max: 1000, step: 1, explanation: 'Speed of internal perimeters.' },
    infillSpeed: { label: 'Infill speed', unit: 'mm/s', min: 1, max: 1000, step: 1, explanation: 'Speed of internal infill structures.' },
    travelSpeed: { label: 'Travel speed', unit: 'mm/s', min: 1, max: 1000, step: 1, explanation: 'Non-extruding move speed; hardware/firmware limit is printer-specific.' },
    firstLayerSpeed: { label: 'First layer speed', unit: 'mm/s', min: 1, max: 500, step: 1, explanation: 'Slower first-layer motion can improve bed adhesion.' },
    acceleration: { label: 'Acceleration', unit: 'mm/s²', min: 1, max: 100000, step: 10, explanation: 'Motion acceleration. This generic editor does not verify firmware limits.' },
    jerk: { label: 'Jerk / junction speed', unit: 'mm/s', min: 0, max: 1000, step: 1, explanation: 'Motion cornering parameter; interpretation depends on firmware.' }
  },
  Temperature: {
    nozzleTemperature: { label: 'Nozzle temperature', unit: '°C', min: 0, max: 500, step: 1, explanation: 'Steady-state nozzle target; verify against filament and hotend limits.' },
    initialNozzleTemperature: { label: 'Initial nozzle temperature', unit: '°C', min: 0, max: 500, step: 1, explanation: 'Nozzle target for the first layer.' },
    bedTemperature: { label: 'Bed temperature', unit: '°C', min: 0, max: 200, step: 1, explanation: 'Steady-state build plate target; verify the printer’s bed limit.' },
    initialBedTemperature: { label: 'Initial bed temperature', unit: '°C', min: 0, max: 200, step: 1, explanation: 'Build plate target for the first layer.' }
  },
  Cooling: {
    fanSpeed: { label: 'Fan speed', unit: '%', min: 0, max: 100, step: 1, explanation: 'Part cooling fan setting for regular layers.' },
    initialFanSpeed: { label: 'Initial fan speed', unit: '%', min: 0, max: 100, step: 1, explanation: 'Part cooling fan setting on the first layer.' },
    fanActivationLayer: { label: 'Fan activation layer', min: 0, max: 100, step: 1, explanation: 'Layer number when regular cooling begins.' },
    minimumLayerTime: { label: 'Minimum layer time', unit: 's', min: 0, max: 600, step: 1, explanation: 'Minimum duration for a layer before speed reduction or cooling moves.' }
  },
  Retraction: {
    retractionDistance: { label: 'Retraction distance', unit: 'mm', min: 0, max: 50, step: 0.1, explanation: 'Filament pullback during travel; tune for the extruder and filament.' },
    retractionSpeed: { label: 'Retraction speed', unit: 'mm/s', min: 1, max: 200, step: 1, explanation: 'Filament pullback speed.' },
    zHop: { label: 'Z-hop', unit: 'mm', min: 0, max: 10, step: 0.1, explanation: 'Lift nozzle while traveling after retraction; can increase print time.' },
    retractionOnLayerChange: { label: 'Retract on layer change', type: 'checkbox', explanation: 'Retract filament when moving to a new layer.' }
  },
  Supports: {
    supportsEnabled: { label: 'Enable supports', type: 'checkbox', explanation: 'Generate support structures for overhangs.' },
    supportType: { label: 'Support type', type: 'select', options: ['Normal', 'Tree'], explanation: 'Support geometry style; availability varies across slicers.' },
    supportDensity: { label: 'Support density', unit: '%', min: 0, max: 100, step: 1, explanation: 'Density of support infill.' },
    supportAngle: { label: 'Support angle', unit: '°', min: 0, max: 90, step: 1, explanation: 'Overhang angle threshold for creating supports.' },
    supportInterface: { label: 'Support interface layers', min: 0, max: 20, step: 1, explanation: 'Dense interface layers between support and model.' }
  },
  'Build plate adhesion': {
    adhesion: { label: 'Adhesion type', type: 'select', options: ['None', 'Skirt', 'Brim', 'Raft'], explanation: 'Auxiliary geometry used to prime or improve bed adhesion.' },
    skirtLoops: { label: 'Skirt loops', min: 0, max: 50, step: 1, explanation: 'Number of perimeter lines in the skirt.' },
    brimWidth: { label: 'Brim width', unit: 'mm', min: 0, max: 100, step: 1, explanation: 'Width of the brim around the part.' }
  }
};

export const SETTING_DEFAULTS = {
  layerHeight: 0.2, initialLayerHeight: 0.2, lineWidth: 0.4, wallGenerator: 'Classic', seamPosition: 'Aligned', ironing: false, resolution: 0.1,
  wallCount: 3, topLayers: 5, bottomLayers: 4, infillPercentage: 20, infillPattern: 'Gyroid', infillOverlap: 15,
  outerWallSpeed: 45, innerWallSpeed: 80, infillSpeed: 100, travelSpeed: 150, firstLayerSpeed: 25, acceleration: 3000, jerk: 8,
  nozzleTemperature: 210, initialNozzleTemperature: 210, bedTemperature: 55, initialBedTemperature: 55,
  fanSpeed: 100, initialFanSpeed: 0, fanActivationLayer: 3, minimumLayerTime: 8,
  retractionDistance: 0.8, retractionSpeed: 35, zHop: 0, retractionOnLayerChange: true,
  supportsEnabled: false, supportType: 'Normal', supportDensity: 15, supportAngle: 50, supportInterface: 2,
  adhesion: 'Skirt', skirtLoops: 2, brimWidth: 5
};

export const PRESET_TYPES = ['Quality', 'Balanced', 'Fast', 'Draft', 'Strong', 'Fine Detail', 'Lightweight', 'Functional Parts'];

const PRESET_FACTORS = {
  Quality: { layer: 0.7, speed: 0.7, walls: 1, infill: 1, strength: 1 },
  Balanced: { layer: 1, speed: 1, walls: 1, infill: 1, strength: 1 },
  Fast: { layer: 1.35, speed: 1.45, walls: 0.9, infill: 1, strength: 0.9 },
  Draft: { layer: 1.6, speed: 1.65, walls: 0.8, infill: 0.7, strength: 0.8 },
  Strong: { layer: 1, speed: 0.8, walls: 1.5, infill: 1.8, strength: 1.5 },
  'Fine Detail': { layer: 0.45, speed: 0.55, walls: 1, infill: 0.9, strength: 1 },
  Lightweight: { layer: 1, speed: 1, walls: 0.8, infill: 0.35, strength: 0.8 },
  'Functional Parts': { layer: 1, speed: 0.85, walls: 1.5, infill: 1.4, strength: 1.3 }
};

export function createProfile({ printerId = PRINTERS[0].id, nozzle = 0.4, filament = 'PLA', name = 'Adventurer 5M · PLA', preset = 'Balanced' } = {}) {
  const printer = PRINTERS.find((item) => item.id === printerId) || PRINTERS[0];
  const settings = { ...SETTING_DEFAULTS };
  settings.lineWidth = nozzle;
  settings.layerHeight = Math.round(nozzle * 0.5 * 100) / 100;
  settings.initialLayerHeight = settings.layerHeight;
  const ranges = FILAMENTS[filament] || FILAMENTS.PLA;
  settings.nozzleTemperature = Math.round((ranges.nozzle[0] + ranges.nozzle[1]) / 2);
  settings.initialNozzleTemperature = settings.nozzleTemperature;
  settings.bedTemperature = Math.round((ranges.bed[0] + ranges.bed[1]) / 2);
  settings.initialBedTemperature = settings.bedTemperature;
  settings.retractionDistance = Math.round(((ranges.retraction[0] + ranges.retraction[1]) / 2) * 10) / 10;
  const profile = { id: cryptoId(), name, printerId: printer.id, nozzle, filament, preset, settings, updatedAt: new Date().toISOString() };
  return applyPreset(profile, preset);
}

export function applyPreset(profile, preset) {
  const factor = PRESET_FACTORS[preset] || PRESET_FACTORS.Balanced;
  const nozzle = Number(profile.nozzle) || 0.4;
  const settings = { ...SETTING_DEFAULTS, ...profile.settings };
  const maxLayer = Math.max(0.06, nozzle * 0.8);
  const baseLayer = Math.min(maxLayer, Math.max(0.06, nozzle * 0.5));
  settings.layerHeight = round(Math.min(maxLayer, baseLayer * factor.layer), 0.01);
  settings.initialLayerHeight = settings.layerHeight;
  settings.lineWidth = round(nozzle, 0.01);
  const machineFactor = ({
    'flashforge-adventurer-5m': 1.25,
    'flashforge-adventurer-5m-pro': 1.2,
    'creality-ender-3-v2-neo': 0.85,
    'creality-ender-3-v3': 1,
    'bambu-a1': 1.35,
    'bambu-p1s': 1.4,
    'prusa-mk4': 1.15
  })[profile.printerId] || 1;
  const filamentFactor = profile.filament === 'TPU' ? 0.55 : ['ABS', 'ASA', 'Nylon', 'PC'].includes(profile.filament) ? 0.75 : 1;
  const rate = factor.speed * machineFactor * filamentFactor * (0.4 / nozzle) ** 0.25;
  settings.outerWallSpeed = round(45 * rate);
  settings.innerWallSpeed = round(80 * rate);
  settings.infillSpeed = round(100 * rate);
  settings.travelSpeed = round(150 * machineFactor);
  settings.firstLayerSpeed = round(Math.max(12, 25 * Math.min(rate, 1)));
  settings.wallCount = Math.max(1, round(3 * factor.walls));
  settings.infillPercentage = Math.min(100, round(20 * factor.infill));
  settings.topLayers = Math.max(3, round(5 * factor.strength));
  settings.bottomLayers = Math.max(3, round(4 * factor.strength));
  settings.acceleration = round(3000 * machineFactor * Math.min(factor.speed, 1.5), 10);
  settings.retractionDistance = Number((FILAMENTS[profile.filament]?.retraction[0] ?? 0.5).toFixed(1));
  if (preset === 'Fine Detail') settings.ironing = true;
  if (preset === 'Strong' || preset === 'Functional Parts') settings.infillPattern = 'Gyroid';
  return { ...profile, preset, settings, updatedAt: new Date().toISOString() };
}

export function generateSettings(profile, { quality = 50, speed = 50, strength = 50 } = {}) {
  const generated = applyPreset(profile, 'Balanced');
  const q = clamp(Number(quality) / 100, 0, 1);
  const s = clamp(Number(speed) / 100, 0, 1);
  const st = clamp(Number(strength) / 100, 0, 1);
  const nozzle = Number(profile.nozzle) || 0.4;
  const machineFactor = ({
    'flashforge-adventurer-5m': 1.15,
    'flashforge-adventurer-5m-pro': 1.1,
    'creality-ender-3-v2-neo': 0.8,
    'creality-ender-3-v3': 0.95,
    'bambu-a1': 1.2,
    'bambu-p1s': 1.25,
    'prusa-mk4': 1.1
  })[profile.printerId] || 1;
  const filamentFactor = profile.filament === 'TPU' ? 0.55 : ['ABS', 'ASA', 'Nylon', 'PC'].includes(profile.filament) ? 0.8 : 1;
  const speedFactor = machineFactor * filamentFactor * (0.4 / nozzle) ** 0.25;
  generated.settings.layerHeight = round(clamp(nozzle * (0.7 - 0.35 * q + 0.35 * s), 0.04, nozzle * 0.8), 0.01);
  generated.settings.initialLayerHeight = generated.settings.layerHeight;
  generated.settings.outerWallSpeed = round((20 + 70 * s) * speedFactor);
  generated.settings.innerWallSpeed = round((35 + 105 * s) * speedFactor);
  generated.settings.infillSpeed = round((40 + 120 * s) * speedFactor);
  generated.settings.wallCount = 2 + round(st * 3);
  generated.settings.infillPercentage = round(8 + st * 52);
  generated.settings.topLayers = Math.max(3, 4 + round(st * 4));
  generated.settings.bottomLayers = Math.max(3, 3 + round(st * 3));
  generated.settings.firstLayerSpeed = round(18 + 15 * (1 - s));
  const printerName = PRINTERS.find((item) => item.id === profile.printerId)?.model || 'custom printer';
  const machineNote = `${printerName} starting heuristic (not a verified capability)`;
  const filamentNote = profile.filament === 'TPU' ? 'flexible TPU' : profile.filament;
  const explanations = [
    `Layer height ${generated.settings.layerHeight} mm and initial layer height ${generated.settings.initialLayerHeight} mm balance the selected detail and speed, capped at 80% of the ${nozzle} mm nozzle.`,
    `Outer wall speed ${generated.settings.outerWallSpeed} mm/s prioritizes surface quality while accounting for the requested speed and ${machineNote}; the printer limit is not verified.`,
    `Inner wall speed ${generated.settings.innerWallSpeed} mm/s and infill speed ${generated.settings.infillSpeed} mm/s are faster than outer walls to reduce time while respecting the selected speed, ${filamentNote} flow factor, and ${nozzle} mm nozzle.`,
    `${generated.settings.wallCount} walls follow the strength target; ${generated.settings.infillPercentage}% infill adds internal support for that same target.`,
    `${generated.settings.topLayers} top layers and ${generated.settings.bottomLayers} bottom layers scale solid shell thickness with the strength target.`,
    `First layer speed ${generated.settings.firstLayerSpeed} mm/s stays conservative to support bed adhesion; temperatures remain at the selected filament's current starting values.`
  ];
  return { ...generated, settings: { ...generated.settings }, explanations };
}

export function validateProfile(
  profile,
  printer = PRINTERS.find((item) => item.id === profile?.printerId),
  filamentDatabase = FILAMENTS
) {
  const errors = [];
  const warnings = [];
  if (!profile || !profile.settings || typeof profile.settings !== 'object') return { errors: ['Configuration is missing settings.'], warnings };
  if (!NOZZLES.includes(Number(profile.nozzle))) errors.push('Nozzle diameter must be one of the supported options: 0.2, 0.25, 0.4, 0.6, 0.8, or 1.0 mm.');
  if (!printer) warnings.push('Printer specification is unknown; printer-specific compatibility is not verified.');
  else if (printer.verified?.includes('nozzleDiameters') && !printer.nozzleDiameters.includes(Number(profile.nozzle))) {
    warnings.push(`${profile.nozzle} mm nozzle is not listed in the printer profile.`);
  }
  for (const [group, definitions] of Object.entries(SETTING_GROUPS)) {
    for (const [key, definition] of Object.entries(definitions)) {
      if (!(key in profile.settings)) {
        errors.push(`Missing required setting: ${definition.label}.`);
        continue;
      }
      const value = profile.settings[key];
      if (typeof value === 'string' && value.trim() === '') {
        errors.push(`${definition.label} is required.`);
      } else if (definition.type === 'checkbox') {
        if (typeof value !== 'boolean') errors.push(`${definition.label} must be enabled or disabled.`);
      } else if (definition.type === 'select') {
        if (!definition.options.includes(value)) errors.push(`${definition.label} has an unsupported value.`);
      } else if (!Number.isFinite(Number(value)) || Number(value) < definition.min || Number(value) > definition.max) {
        errors.push(`${definition.label} must be between ${definition.min} and ${definition.max}${definition.unit ? ` ${definition.unit}` : ''}.`);
      } else if (Math.abs((Number(value) - definition.min) / definition.step - Math.round((Number(value) - definition.min) / definition.step)) > 1e-7) {
        errors.push(`${definition.label} must use increments of ${definition.step}.`);
      }
    }
  }
  const material = filamentDatabase[profile.filament] || profile.filamentProfile;
  if (material) {
    for (const [key, range, label] of [
      ['nozzleTemperature', material.nozzle, 'Nozzle temperature'],
      ['initialNozzleTemperature', material.nozzle, 'Initial nozzle temperature'],
      ['bedTemperature', material.bed, 'Bed temperature'],
      ['initialBedTemperature', material.bed, 'Initial bed temperature']
    ]) {
      const value = Number(profile.settings[key]);
      if (Number.isFinite(value) && (value < range[0] || value > range[1])) {
        warnings.push(`${label} ${value}°C is outside the ${profile.filament} general starting range (${range[0]}–${range[1]}°C); check the filament maker's guidance.`);
      }
    }
  }
  if (printer?.maxNozzleTemperature) {
    for (const key of ['nozzleTemperature', 'initialNozzleTemperature']) {
      if (Number(profile.settings[key]) > printer.maxNozzleTemperature) warnings.push(`${key} exceeds the listed printer maximum of ${printer.maxNozzleTemperature}°C.`);
    }
  }
  if (printer?.maxBedTemperature) {
    for (const key of ['bedTemperature', 'initialBedTemperature']) {
      if (Number(profile.settings[key]) > printer.maxBedTemperature) warnings.push(`${key} exceeds the listed printer maximum of ${printer.maxBedTemperature}°C.`);
    }
  }
  return { errors, warnings };
}

export function serializeProfile(profile, format = 'json') {
  const normalized = { ...profile, settings: { ...profile.settings } };
  if (format === 'json') return JSON.stringify(normalized, null, 2);
  const entries = Object.entries(normalized.settings);
  if (format === 'csv') return [
    'setting,value',
    ...[['profile.name', normalized.name], ['profile.printerId', normalized.printerId], ['profile.nozzle', normalized.nozzle], ['profile.filament', normalized.filament], ['profile.preset', normalized.preset], ...entries]
      .map(([key, value]) => `${csvEscape(key)},${csvEscape(value)}`)
  ].join('\r\n');
  if (format === 'txt') return [
    `# Generic printer profile: ${normalized.name}`,
    `# Not a slicer-native configuration`,
    `name: ${normalized.name}`,
    `printerId: ${normalized.printerId}`,
    `nozzle: ${normalized.nozzle}`,
    `filament: ${normalized.filament}`,
    `preset: ${normalized.preset}`,
    '[settings]',
    ...entries.map(([key, value]) => `${key}: ${String(value)}`)
  ].join('\n');
  if (format === 'ini' || format === 'cfg') return [
    `; Generic profile; not a slicer-native configuration`,
    `[profile]`,
    `name=${iniEscape(normalized.name)}`,
    `printerId=${iniEscape(normalized.printerId)}`,
    `nozzle=${normalized.nozzle}`,
    `filament=${iniEscape(normalized.filament)}`,
    `preset=${iniEscape(normalized.preset)}`,
    '',
    '[settings]',
    ...entries.map(([key, value]) => `${key}=${String(value)}`)
  ].join('\n');
  throw new Error(`Export format "${format}" is not supported. Use JSON, CSV, TXT, INI, or CFG.`);
}

export function parseProfile(text, format, fallbackName = 'Imported profile') {
  let profile;
  if (format === 'json') {
    profile = JSON.parse(text);
  } else if (format === 'csv') {
    const rows = parseCsv(text);
    if (rows[0]?.[0] !== 'setting' || rows[0]?.[1] !== 'value') throw new Error('CSV must have setting,value columns.');
    const values = Object.fromEntries(rows.slice(1).filter((row) => row.length >= 2).map(([key, value]) => [key, parseScalar(value)]));
    profile = {
      name: values['profile.name'] || fallbackName,
      printerId: values['profile.printerId'],
      nozzle: values['profile.nozzle'],
      filament: values['profile.filament'],
      preset: values['profile.preset'],
      settings: Object.fromEntries(Object.entries(values).filter(([key]) => !key.startsWith('profile.')))
    };
  } else if (format === 'ini' || format === 'cfg' || format === 'txt') {
    profile = parseKeyValue(text, format, fallbackName);
  } else {
    throw new Error(`Import format "${format}" is not supported. FCFG and slicer-native files are not implemented.`);
  }
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('The imported file must contain one profile object.');
  const settings = profile.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('The imported profile has no settings object.');
  const result = {
    id: cryptoId(),
    name: String(profile.name || fallbackName).slice(0, 100),
    printerId: String(profile.printerId || PRINTERS[0].id),
    nozzle: Number(profile.nozzle || 0.4),
    filament: String(profile.filament || 'PLA'),
    preset: String(profile.preset || 'Imported'),
    settings: { ...settings },
    updatedAt: new Date().toISOString()
  };
  const known = new Set(Object.values(SETTING_GROUPS).flatMap((group) => Object.keys(group)));
  for (const key of Object.keys(result.settings)) if (!known.has(key)) delete result.settings[key];
  return result;
}

export function compareProfiles(profiles) {
  const definitions = Object.entries(SETTING_GROUPS).flatMap(([, group]) => Object.entries(group));
  return definitions.map(([key, definition]) => ({
    key,
    label: definition.label,
    values: profiles.map((profile) => profile.settings[key]),
    changed: new Set(profiles.map((profile) => String(profile.settings[key]))).size > 1
  })).filter((row) => row.changed);
}

function parseKeyValue(text, format, fallbackName) {
  const profile = { name: fallbackName, printerId: PRINTERS[0].id, nozzle: 0.4, filament: 'PLA', preset: 'Imported', settings: {} };
  let section = '';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    if (/^\[.+\]$/.test(line)) { section = line.slice(1, -1).toLowerCase(); continue; }
    const match = line.match(/^([^:=]+)\s*[:=]\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = parseScalar(match[2].trim());
    if (section === 'settings' || format === 'txt' && Object.hasOwn(SETTING_DEFAULTS, key)) profile.settings[key] = value;
    else if (['name', 'printerId', 'nozzle', 'filament', 'preset'].includes(key)) profile[key] = value;
  }
  return profile;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted && char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (!quoted && char === ',') { row.push(field); field = ''; }
    else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += char;
  }
  row.push(field);
  if (row.some(Boolean)) rows.push(row);
  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  return rows;
}

function parseScalar(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value !== '' && Number.isFinite(Number(value))) return Number(value);
  return value;
}
function csvEscape(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function iniEscape(value) { return String(value).replace(/[\r\n]/g, ' '); }
function round(value, precision = 1) { return Math.round(value / precision) * precision; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function cryptoId() {
  return globalThis.crypto?.randomUUID?.() || `profile-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function saveProfileCollection(storage, key, value) {
  storage.setItem(key, JSON.stringify(value));
}

export function loadProfileCollection(storage, key) {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Saved profile data must be an object.');
  return value;
}
