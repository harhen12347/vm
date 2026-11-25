import {
  FcfgDocument, compareProfiles as compareFcfgDocuments, formatFloat32, parseFcfgBytes
} from './index.mjs';

function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof input === 'string') return new TextEncoder().encode(input);
  throw new TypeError('FCFG import expects file bytes or text.');
}

function numberValue(value) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(number) ? Math.round(number * 1000000) / 1000000 : null;
}

function stringValue(value) {
  return typeof value === 'string' ? value : null;
}

export function getFCFGDocument(profile) {
  const saved = profile?.sourceData?.fcfg?.document;
  if (!saved || !Array.isArray(saved.nodes)) return null;
  if (saved instanceof FcfgDocument) return saved;
  const nodes = structuredClone(saved.nodes).map((node) => {
    if (node.type === 'entry' && node.value?.bytes && !(node.value.bytes instanceof Uint8Array)) {
      node.value.bytes = Uint8Array.from(Object.values(node.value.bytes));
    }
    return node;
  });
  const document = new FcfgDocument(nodes, {
	eol: saved.eol,
	encoding: saved.encoding,
	warnings: structuredClone(saved.warnings || [])
  });
  document.hadBom = Boolean(saved.hadBom);
  return document;
}

export function canExportFCFG(profile) {
  const document = getFCFGDocument(profile);
  return Boolean(document && document.sections().includes('Custom') && document.sections().includes('General')
	&& ['machineId', 'profileName', 'nozzleSize'].every((key) => document.has('Custom', key)));
}

export function importFCFGProfile(input, fallbackName = 'Imported FlashPrint profile') {
  const bytes = asBytes(input);
  if (bytes.length === 0 || bytes.every((byte) => byte === 9 || byte === 10 || byte === 13 || byte === 32)) {
    throw new Error('FCFG file is empty.');
  }
  const document = parseFcfgBytes(bytes);
  if (!document.sections().includes('Custom') || !document.sections().includes('General')) {
	throw new Error('This is not a supported FlashPrint profile: [Custom] and [General] sections are required.');
  }
  if (!['machineId', 'profileName', 'nozzleSize'].every((key) => document.has('Custom', key))) {
	throw new Error('The FCFG is missing required machine, profile-name, or nozzle metadata.');
  }

  const machineId = document.get('Custom', 'machineId');
  const name = stringValue(document.get('Custom', 'profileName'));
  const nozzle = numberValue(document.get('Custom', 'nozzleSize'));
  if (!name?.trim()) throw new Error('The FCFG profileName is empty or not a plain string; it cannot safely be used for profile export.');
  if (nozzle === null) throw new Error('The FCFG nozzleSize is not a readable number; it cannot safely be edited or exported.');
  const materialName = stringValue(document.get('Custom', 'materialName0')) || '';
  const filament = inferFilament(materialName) || 'PLA';
  const settings = {};
  const mapNumber = (nativeKey, profileKey, transform = (value) => value) => {
	const value = numberValue(document.get('General', nativeKey));
	if (value !== null) settings[profileKey] = transform(value);
  };

  mapNumber('layerHeight', 'layerHeight');
  mapNumber('firstLayerHeight', 'initialLayerHeight');
  mapNumber('shellCnt', 'wallCount');
  mapNumber('shellOuterMaxSpeed', 'outerWallSpeed');
  mapNumber('shellVisibleInnerMaxSpeed', 'innerWallSpeed');
  mapNumber('travelSpeed', 'travelSpeed');
  mapNumber('fillDensity', 'infillPercentage', (value) => value * 100);
  mapNumber('fillTopSolidCnt', 'topLayers');
  mapNumber('fillBottomSolidCnt', 'bottomLayers');
  mapNumber('extruderTemp0', 'nozzleTemperature');
  mapNumber('platformTemp', 'bedTemperature');
  mapNumber('retractLen0', 'retractionDistance');
  mapNumber('retractInSpeed0', 'retractionSpeed');
  mapNumber('accelerationGeneral', 'acceleration');
  mapNumber('fanSpeed0', 'fanSpeed');
  mapNumber('extrusionRatio', 'flowRate', (value) => value * 100);

  for (const entry of document.entries('General')) {
	if (entry.key !== 'accelerationGeneral' && /^acceleration[A-Za-z0-9_]*$/i.test(entry.key)) {
	  const acceleration = numberValue(entry.value.value);
	  if (acceleration !== null) settings[entry.key] = acceleration;
	}
  }

  return {
	name: String(name).slice(0, 100),
	printerId: 'flashprint-machine-' + String(machineId ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, ''),
	nozzle: nozzle ?? 0.4,
	filament,
	settings,
	sourceData: {
	  format: 'FlashPrint FCFG',
	  fcfg: {
		document,
		nativeMachineId: machineId ?? null,
		nativeProfileName: name,
		nativeMaterialName: materialName || null,
		nativeNozzleSize: nozzle,
		filamentWasInferred: Boolean(inferFilament(materialName))
	  }
	}
  };
}

export function updateFCFGFromProfile(profile) {
  if (!canExportFCFG(profile)) throw new Error('Import a FlashPrint .fcfg profile first; a native template is required for export.');
  const saved = profile.sourceData.fcfg.document;
  const document = new FcfgDocument(structuredClone(getFCFGDocument(profile).nodes), {
	eol: saved.eol,
	encoding: saved.encoding,
	warnings: structuredClone(saved.warnings || [])
  });
  document.hadBom = Boolean(saved.hadBom);
  document.set('Custom', 'profileName', String(profile.name).slice(0, 100));
  document.set('Custom', 'nozzleSize', Number(profile.nozzle));

  const settings = profile.settings || {};
  const mappings = [
	['layerHeight', 'layerHeight', (value) => value],
	['initialLayerHeight', 'firstLayerHeight', (value) => value],
	['wallCount', 'shellCnt', (value) => value],
	['outerWallSpeed', 'shellOuterMaxSpeed', (value) => value],
	['innerWallSpeed', 'shellVisibleInnerMaxSpeed', (value) => value],
	['travelSpeed', 'travelSpeed', (value) => value],
	['infillPercentage', 'fillDensity', (value) => value / 100],
	['topLayers', 'fillTopSolidCnt', (value) => value],
	['bottomLayers', 'fillBottomSolidCnt', (value) => value],
	['nozzleTemperature', 'extruderTemp0', (value) => value],
	['bedTemperature', 'platformTemp', (value) => value],
	['retractionDistance', 'retractLen0', (value) => value],
	['retractionSpeed', 'retractInSpeed0', (value) => value],
	['acceleration', 'accelerationGeneral', (value) => value],
	['fanSpeed', 'fanSpeed0', (value) => value],
	['flowRate', 'extrusionRatio', (value) => value / 100]
  ];
  for (const [profileKey, nativeKey, transform] of mappings) {
	if (Object.hasOwn(settings, profileKey) && document.has('General', nativeKey)) {
	  document.set('General', nativeKey, transform(Number(settings[profileKey])));
	}
  }
  for (const [nativeKey, value] of Object.entries(settings)) {
	if (nativeKey !== 'accelerationGeneral' && /^acceleration[A-Za-z0-9_]*$/i.test(nativeKey)
	  && document.has('General', nativeKey)) document.set('General', nativeKey, Number(value));
  }
  return document.serializeBytes();
}

export function compareFCFGProfiles(profiles) {
  if (!Array.isArray(profiles) || profiles.length !== 2) throw new Error('Compare exactly two profiles.');
  const [a, b] = profiles.map(getFCFGDocument);
  if (!a || !b) throw new Error('Both profiles must retain imported FCFG documents.');
  return compareFcfgDocuments(a, b);
}

export { formatFloat32 };

function inferFilament(name) {
  const value = name.toUpperCase().replace(/[^A-Z0-9+]/g, ' ');
  return ['PLA+', 'PETG', 'ABS', 'ASA', 'TPU', 'PVA', 'PLA'].find((type) =>
	new RegExp('(?:^|\\s)' + type.replace('+', '\\+') + '(?=$|\\s)').test(value)
  ) || null;
}
