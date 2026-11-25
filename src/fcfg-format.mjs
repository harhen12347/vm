const VARIANT_TYPE_FLOAT32 = 0x87;
const FORMAT_VERSION = 1;

export function decodeFCFG(text) {
  if (typeof text !== 'string' || text.trim() === '') throw new Error('FCFG file is empty.');
  const lineEnding = text.includes('\r\n') ? '\r\n' : text.includes('\r') ? '\r' : '\n';
  const sourceLines = text.split(/\r\n|\n|\r/);
  const trailingNewline = /(?:\r\n|\n|\r)$/.test(text);
  const lines = [];
  const sectionKeys = new Map();
  let section = null;

  for (const sourceLine of sourceLines) {
	const trimmed = sourceLine.trim();
	const sectionMatch = trimmed.match(/^\[([^\]\r\n]+)\]$/);
	if (sectionMatch) {
	  section = sectionMatch[1];
	  lines.push({ kind: 'section', section, raw: sourceLine });
	  if (!sectionKeys.has(section)) sectionKeys.set(section, new Set());
	  continue;
	}
	if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) {
	  lines.push({ kind: 'raw', raw: sourceLine });
	  continue;
	}
	const assignment = sourceLine.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
	if (!assignment || section === null) {
	  throw new Error(`Unsupported FCFG line: ${trimmed.slice(0, 100)}`);
	}
	const [, key, rawValue] = assignment;
	const keys = sectionKeys.get(section);
	if (keys.has(key)) throw new Error(`FCFG contains a duplicate ${key} field in [${section}].`);
	keys.add(key);
	const parsed = parseValue(rawValue.trim());
	lines.push({
	  kind: 'entry', section, key, raw: sourceLine, rawValue: rawValue.trim(),
	  value: parsed.value, valueType: parsed.type
	});
  }

  const sections = [...sectionKeys.keys()];
  if (!sections.includes('Custom') || !sections.includes('General')) {
	throw new Error('This is not a supported FlashPrint profile: [Custom] and [General] sections are required.');
  }
  return { version: FORMAT_VERSION, lineEnding, trailingNewline, lines, sections };
}

export function encodeFCFG(document) {
  assertDocument(document);
  const text = document.lines.map((line) => line.raw).join(document.lineEnding);
  return document.trailingNewline ? text + document.lineEnding : text;
}

export function canExportFCFG(profile) {
  const document = profile?.sourceData?.fcfg?.document;
  return Boolean(document && document.version === FORMAT_VERSION
    && Array.isArray(document.lines) && Array.isArray(document.sections)
    && document.sections.includes('Custom') && document.sections.includes('General')
    && hasEntry(document, 'Custom', 'machineId')
    && hasEntry(document, 'Custom', 'profileName')
    && hasEntry(document, 'Custom', 'nozzleSize'));
}

export function importFCFGProfile(text, fallbackName = 'Imported FlashPrint profile') {
  const document = decodeFCFG(text);
  const custom = valuesFor(document, 'Custom');
  const general = valuesFor(document, 'General');
  if (!hasEntry(document, 'Custom', 'machineId') || !hasEntry(document, 'Custom', 'profileName')
    || !hasEntry(document, 'Custom', 'nozzleSize')) {
    throw new Error('The FCFG is missing required FlashPrint machine, profile-name, or nozzle metadata.');
  }
  const name = stringValue(custom.profileName) || fallbackName;
  const nozzle = numberValue(custom.nozzleSize);
  const filamentName = stringValue(custom.materialName0) || '';
  const filament = inferFilament(filamentName) || 'PLA';
  const settings = {};
  const mapNumber = (nativeKey, profileKey, transform = (value) => value) => {
	const value = numberValue(general[nativeKey]);
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

  for (const [nativeKey, value] of Object.entries(general)) {
	if (nativeKey !== 'accelerationGeneral' && /^acceleration[A-Za-z0-9_]*$/i.test(nativeKey)) {
	  const acceleration = numberValue(value);
	  if (acceleration !== null) settings[nativeKey] = acceleration;
	}
  }

  const nativeMachineId = custom.machineId;
  return {
	name: String(name).slice(0, 100),
	printerId: 'flashprint-machine-' + String(nativeMachineId ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, ''),
	nozzle: nozzle ?? 0.4,
	filament,
	settings,
	sourceData: {
	  format: 'FlashPrint FCFG',
	  fcfg: {
		document,
		nativeMachineId: nativeMachineId ?? null,
		nativeProfileName: name,
		nativeMaterialName: filamentName || null,
		nativeNozzleSize: nozzle,
		filamentWasInferred: Boolean(inferFilament(filamentName))
	  }
	}
  };
}

export function updateFCFGFromProfile(profile) {
  if (!canExportFCFG(profile)) throw new Error('Import a FlashPrint .fcfg profile first; a compatible printer template is required for native export.');
  const document = structuredClone(profile.sourceData.fcfg.document);
  setExistingValue(document, 'Custom', 'profileName', String(profile.name).slice(0, 100));
  setExistingValue(document, 'Custom', 'nozzleSize', Number(profile.nozzle));

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
	if (Object.hasOwn(settings, profileKey) && hasEntry(document, 'General', nativeKey)) {
	  setExistingValue(document, 'General', nativeKey, transform(Number(settings[profileKey])));
	}
  }
  for (const [nativeKey, value] of Object.entries(settings)) {
	if (nativeKey !== 'accelerationGeneral' && /^acceleration[A-Za-z0-9_]*$/i.test(nativeKey)
	  && hasEntry(document, 'General', nativeKey)) {
	  setExistingValue(document, 'General', nativeKey, Number(value));
	}
  }
  return encodeFCFG(document);
}

export function inspectFCFG(document) {
  assertDocument(document);
  return document.lines
	.filter((line) => line.kind === 'entry')
	.map(({ section, key, value, valueType }) => ({ section, key, value, valueType }));
}

function parseValue(rawValue) {
  const unquoted = rawValue.length >= 2 && ((rawValue.startsWith('"') && rawValue.endsWith('"'))
	|| (rawValue.startsWith("'") && rawValue.endsWith("'")))
	? rawValue.slice(1, -1) : rawValue;
  const variant = unquoted.match(/^@Variant\(([\s\S]*)\)$/);
  if (variant) {
	const bytes = decodeEscapedBytes(variant[1]);
	if (bytes && bytes.length === 8 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === VARIANT_TYPE_FLOAT32) {
	  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	  return { value: view.getFloat32(4, false), type: 'variant-float32' };
	}
	return { value: unquoted, type: 'opaque-variant' };
  }
  if (unquoted === 'true') return { value: true, type: 'boolean' };
  if (unquoted === 'false') return { value: false, type: 'boolean' };
  if (/^-?\d+$/.test(unquoted)) return { value: Number(unquoted), type: 'integer' };
  if (/^-?(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(unquoted)) return { value: Number(unquoted), type: 'number' };
  if (unquoted.startsWith('[') && unquoted.endsWith(']')) {
	try { return { value: JSON.parse(unquoted), type: 'array' }; }
	catch { return { value: rawValue, type: 'raw' }; }
  }
  return { value: unquoted, type: rawValue.startsWith('"') || rawValue.startsWith("'") ? 'string' : 'raw' };
}

function decodeEscapedBytes(text) {
  const bytes = [];
  for (let index = 0; index < text.length; index += 1) {
	const character = text[index];
	if (character !== '\\') {
	  const code = text.charCodeAt(index);
	  if (code > 0xff) return null;
	  bytes.push(code);
	  continue;
	}
	index += 1;
	if (index >= text.length) return null;
	const escape = text[index];
	if (escape === '0') bytes.push(0);
	else if (escape === 'f') bytes.push(12);
	else if (escape === 'n') bytes.push(10);
	else if (escape === 'r') bytes.push(13);
	else if (escape === 't') bytes.push(9);
	else if (escape === 'v') bytes.push(11);
	else if (escape === '\\' || escape === '"' || escape === "'") bytes.push(escape.charCodeAt(0));
	else if (escape === 'x') {
	  const match = text.slice(index + 1).match(/^[0-9a-fA-F]{1,2}/);
	  if (!match) return null;
	  bytes.push(Number.parseInt(match[0], 16));
	  index += match[0].length;
	} else return null;
  }
  return Uint8Array.from(bytes);
}

function encodeVariantFloat(value) {
  if (!Number.isFinite(value)) throw new Error('FCFG values must be finite numbers.');
  const bytes = new Uint8Array(8);
  bytes[3] = VARIANT_TYPE_FLOAT32;
  new DataView(bytes.buffer).setFloat32(4, value, false);
  const escaped = [...bytes].map((byte) => byte === 0 ? '\\0'
	: byte >= 0x20 && byte <= 0x7e && byte !== 0x5c && byte !== 0x29 ? String.fromCharCode(byte)
	  : `\\x${byte.toString(16).padStart(2, '0')}`).join('');
  return `@Variant(${escaped})`;
}

function setExistingValue(document, section, key, value) {
  const line = document.lines.find((candidate) => candidate.kind === 'entry' && candidate.section === section && candidate.key === key);
  if (!line) return false;
  if (Object.is(line.value, value)
    || (typeof line.value === 'number' && typeof value === 'number'
      && numberValue(line.value) === numberValue(value))) return false;
  const encoded = line.valueType === 'variant-float32' || typeof value === 'number'
	? encodeVariantFloat(value)
	: encodeScalar(value, line.valueType);
  line.value = value;
  line.rawValue = encoded;
  line.raw = `${key}=${encoded}`;
  return true;
}

function encodeScalar(value, type) {
  if (type === 'boolean' || typeof value === 'boolean') return value ? 'true' : 'false';
  if (type === 'integer' && Number.isInteger(value)) return String(value);
  if (typeof value === 'string') {
	if (/[\r\n]/.test(value)) throw new Error('FCFG text values cannot contain line breaks.');
	return value;
  }
  throw new Error('Cannot safely encode this value using the original FCFG value type.');
}

function valuesFor(document, section) {
  const result = {};
  for (const line of document.lines) {
	if (line.kind === 'entry' && line.section === section) result[line.key] = line.value;
  }
  return result;
}

function hasEntry(document, section, key) {
  return document.lines.some((line) => line.kind === 'entry' && line.section === section && line.key === key);
}

function stringValue(value) {
  return typeof value === 'string' ? value : null;
}

function numberValue(value) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(number) ? Math.round(number * 1000000) / 1000000 : null;
}

function inferFilament(name) {
  const value = name.toUpperCase().replace(/[^A-Z0-9+]/g, ' ');
  return ['PLA+', 'PETG', 'ABS', 'ASA', 'TPU', 'PVA', 'PLA'].find((type) =>
    new RegExp('(?:^|\\s)' + type.replace('+', '\\+') + '(?=$|\\s)').test(value)
  ) || null;
}

function assertDocument(document) {
  const validLines = Array.isArray(document?.lines) && document.lines.every((line) => {
    if (!line || typeof line !== 'object' || typeof line.raw !== 'string' || /[\r\n]/.test(line.raw)) return false;
    if (line.kind === 'raw') return true;
    if (line.kind === 'section') return typeof line.section === 'string';
    return line.kind === 'entry' && typeof line.section === 'string'
      && /^[A-Za-z_][A-Za-z0-9_]*$/.test(line.key) && typeof line.rawValue === 'string';
  });
  if (!document || document.version !== FORMAT_VERSION || !validLines
    || !Array.isArray(document.sections) || !['\n', '\r\n', '\r'].includes(document.lineEnding)) {
    throw new Error('The saved FCFG template is invalid or unsupported. Re-import the original .fcfg file.');
  }
}
