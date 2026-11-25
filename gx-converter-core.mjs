const textDecoder = new TextDecoder('latin1');

function decimal(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function commentValue(lines, patterns) {
  for (const line of lines) {
	const clean = line.replace(/^\s*[;#]\s*/, '');
	for (const pattern of patterns) {
	  const match = clean.match(pattern);
	  if (match) {
		const value = decimal(match[1]);
		if (value !== null) return value;
		return match[1].trim();
	  }
	}
  }
  return null;
}

export function extractGXText(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 64) throw new Error('The GX file is too small or damaged.');

  const decoded = textDecoder.decode(bytes);
  const normalized = decoded.replace(/\r/g, '');
  const prefix = normalized.slice(0, 32).toLowerCase();
  let payload = normalized;

  if (prefix.includes('xgcode')) {
	const candidates = [];
	const linePattern = /(?:^|\n)([;GgMmTt][^\n]*)/g;
	let match;
	while ((match = linePattern.exec(normalized)) !== null) {
	  candidates.push(match.index + (normalized[match.index] === '\n' ? 1 : 0));
	}
	let bestStart = -1;
	let bestCommands = 0;
	let windowEnd = 0;
	for (let index = 0; index < candidates.length; index += 1) {
	  const start = candidates[index];
	  while (windowEnd < candidates.length && candidates[windowEnd] < start + 1024 * 1024) windowEnd += 1;
	  const commands = windowEnd - index;
	  if (commands > bestCommands) {
		bestStart = start;
		bestCommands = commands;
	  }
	}
	if (bestStart >= 0) payload = normalized.slice(bestStart);
  }

  payload = payload.replace(/^\x00+/, '').trim();
  if (!payload) throw new Error('No readable G-code was found in this GX file.');

  const commandCount = (payload.match(/(?:^|\n)\s*(?:G|M|T)\d+/gi) || []).length;
  if (commandCount < 2) throw new Error('The GX file has no valid G-code payload.');
  return payload;
}

export function parseGX(buffer) {
  const gcode = extractGXText(buffer);
  const lines = gcode.split('\n');
  const printer = {};
  const model = {};
  const metadata = {};
  for (const line of lines) {
	const clean = line.replace(/^\s*[;#]\s*/, '').trim();
	const separator = clean.indexOf('=');
	if (separator > 0) {
	  const key = clean.slice(0, separator).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
	  const value = clean.slice(separator + 1).trim();
	  if (key) metadata[key] = value;
	}
  }

  const aliases = {
	'printer_model': 'Printer model', 'printer': 'Printer model', 'machine': 'Printer model',
	'nozzle_diameter': 'Nozzle size', 'nozzle_size': 'Nozzle size',
	'bed_size_x': 'Bed X dimension', 'bed_width': 'Bed X dimension',
	'bed_size_y': 'Bed Y dimension', 'bed_depth': 'Bed Y dimension',
	'nozzle_temperature': 'Nozzle temperature', 'first_layer_temperature': 'Nozzle temperature',
	'bed_temperature': 'Bed temperature', 'first_layer_bed_temperature': 'Bed temperature',
	'machine_max_speed_x': 'Print speed', 'print_speed': 'Print speed',
	'layer_height': 'Layer height', 'filament_diameter': 'Filament diameter',
	'retraction_distance': 'Retraction distance', 'retract_length': 'Retraction distance',
	'retraction_speed': 'Retraction speed', 'retract_speed': 'Retraction speed'
  };
  for (const [key, label] of Object.entries(aliases)) {
	if (metadata[key] !== undefined) {
	  const numeric = Number(metadata[key]);
	  printer[label] = Number.isFinite(numeric) ? numeric : metadata[key];
	}
  }

  const modelAliases = {
	'infill_density': 'Infill', 'fill_density': 'Infill',
	'infill_pattern': 'Infill pattern', 'fill_pattern': 'Infill pattern',
	'wall_thickness': 'Wall thickness', 'outer_wall_line_width': 'Wall thickness',
	'wall_loops': 'Wall count', 'wall_count': 'Wall count',
	'generate_supports': 'Supports', 'support_enable': 'Supports',
	'layer_height': 'Layer height',
	'print_orientation': 'Print orientation', 'orientation': 'Print orientation',
	'top_solid_layers': 'Top layers', 'top_layers': 'Top layers',
	'bottom_solid_layers': 'Bottom layers', 'bottom_layers': 'Bottom layers'
  };
  for (const [key, label] of Object.entries(modelAliases)) {
	if (metadata[key] !== undefined) {
	  const numeric = Number(metadata[key]);
	  model[label] = Number.isFinite(numeric) ? numeric : metadata[key];
	}
  }

  const fields = [
	['Printer model', ['printer_model\s*=\s*(.+)', 'printer\s*=\s*(.+)', 'machine\s*=\s*(.+)']],
	['Nozzle size', ['nozzle[_ ](?:diameter|size)\s*=\s*([0-9.]+)', 'nozzle[_ ]diameter\s*[:=]\s*([0-9.]+)']],
	['Bed X dimension', ['bed[_ ]size[_ ]x\s*=\s*([0-9.]+)', 'bed_width\s*=\s*([0-9.]+)', 'bed[_ ]x\s*=\s*([0-9.]+)']],
	['Bed Y dimension', ['bed[_ ]size[_ ]y\s*=\s*([0-9.]+)', 'bed_depth\s*=\s*([0-9.]+)', 'bed[_ ]y\s*=\s*([0-9.]+)']],
	['Nozzle temperature', ['nozzle_temperature\s*=\s*([0-9.]+)', 'first_layer_temperature\s*=\s*([0-9.]+)', 'M104\s+S([0-9.]+)']],
	['Bed temperature', ['bed_temperature\s*=\s*([0-9.]+)', 'first_layer_bed_temperature\s*=\s*([0-9.]+)', 'M140\s+S([0-9.]+)']],
	['Print speed', ['machine_max_speed_x\s*=\s*([^\n,]+)', 'print_speed\s*=\s*([0-9.]+)', 'speed\s*=\s*([0-9.]+)']],
	['Layer height', ['layer_height\s*=\s*([0-9.]+)', 'layer height[:=]\s*([0-9.]+)']],
	['Filament diameter', ['filament_diameter\s*=\s*([0-9.]+)']],
	['Retraction distance', ['retraction_distance\s*=\s*([0-9.]+)', 'retract_length\s*=\s*([0-9.]+)']],
	['Retraction speed', ['retraction_speed\s*=\s*([0-9.]+)', 'retract_speed\s*=\s*([0-9.]+)']]
  ];
  for (const [label, patterns] of fields) {
	const value = commentValue(lines, patterns.map(p => new RegExp(p, 'i')));
	if (value !== null && value !== '') printer[label] = value;
  }

  for (const line of lines) {
	const clean = line.trim();
	let match = clean.match(/^M104\s+S([0-9.]+)/i) || clean.match(/^M109\s+S([0-9.]+)/i);
	if (match && printer['Nozzle temperature'] === undefined) printer['Nozzle temperature'] = Number(match[1]);
	match = clean.match(/^M140\s+S([0-9.]+)/i) || clean.match(/^M190\s+S([0-9.]+)/i);
	if (match && printer['Bed temperature'] === undefined) printer['Bed temperature'] = Number(match[1]);
	match = clean.match(/^G92\s+E([0-9.-]+)/i);
	if (match) printer['Extruder position reset'] = Number(match[1]);
	match = clean.match(/^G[01]\b[^;]*\bF([0-9.]+)/i);
	if (match && printer['Maximum or configured feedrate'] === undefined) printer['Maximum or configured feedrate'] = Number(match[1]);
  }

  const modelFields = [
	['Infill', ['infill_density\s*=\s*([0-9.]+)', 'fill density\s*=\s*([0-9.]+)']],
	['Infill pattern', ['infill_pattern\s*=\s*(.+)', 'fill_pattern\s*=\s*(.+)']],
	['Wall thickness', ['wall_thickness\s*=\s*([0-9.]+)', 'outer_wall_line_width\s*=\s*([0-9.]+)']],
	['Wall count', ['wall_loops\s*=\s*([0-9.]+)', 'wall_count\s*=\s*([0-9.]+)']],
	['Supports', ['support\w*\s*=\s*(.+)', 'generate_supports\s*=\s*(.+)']],
	['Layer height', ['layer_height\s*=\s*([0-9.]+)']],
	['Print orientation', ['print_orientation\s*=\s*(.+)', 'orientation\s*=\s*(.+)']],
	['Top layers', ['top_solid_layers\s*=\s*([0-9.]+)', 'top_layers\s*=\s*([0-9.]+)']],
	['Bottom layers', ['bottom_solid_layers\s*=\s*([0-9.]+)', 'bottom_layers\s*=\s*([0-9.]+)']]
  ];
  for (const [label, patterns] of modelFields) {
	const value = commentValue(lines, patterns.map(p => new RegExp(p, 'i')));
	if (value !== null && value !== '') model[label] = value;
  }

  const printTime = commentValue(lines, [/estimated printing time[^=]*=\s*(.+)/i]);
  const filament = commentValue(lines, [/filament used[^=]*=\s*(.+)/i]);
  if (printTime !== null) model['Estimated print time'] = printTime;
  if (filament !== null) model['Filament used'] = filament;

  return { gcode, printer, model, format: 'xgcode-gcode' };
}

export function makeModelMetadata(sourceName, printer, model) {
  const payload = {
	format: 'AETHER_GX_METADATA_EXPORT',
	version: 1,
	source: sourceName,
	generatedBy: 'Aether GX File Converter',
	nativeFCFGSupported: false,
	notice: 'Settings are extracted only from metadata present in the source GX file. This JSON file is not a proprietary FlashPrint FCFG profile and must not be renamed as one.',
	printer,
	model
  };
  return JSON.stringify(payload, null, 2);
}

export function validatePrinterConfiguration(printer) {
  if (!printer || typeof printer !== 'object' || Array.isArray(printer)) {
	throw new Error('Printer configuration is missing or invalid.');
  }
  return JSON.stringify(printer).length > 2;
}

export function validateBinarySTL(stl) {
  if (!stl || stl.byteLength < 84) throw new Error('The STL output is empty or damaged.');
  const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
  const triangleCount = view.getUint32(80, true);
  const expectedLength = 84 + triangleCount * 50;
  if (triangleCount < 1 || stl.byteLength !== expectedLength) {
	throw new Error('The STL output has an invalid binary STL structure.');
  }
  return true;
}

export function makeBinarySTL(gcode, options = {}) {
  const width = options.width || 0.42;
  const layerHeight = options.layerHeight || 0.20;
  const maxSegments = options.maxSegments || 120000;
  let x = 0, y = 0, z = 0, e = 0;
  let absoluteXYZ = true, absoluteE = true;
  const segments = [];
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];

  for (const raw of gcode.split('\n')) {
	if (segments.length >= maxSegments) break;
	const line = raw.replace(/\s*;.*$/, '').trim();
	if (!line) continue;
	const command = line.match(/^([GMT]\d+)/i)?.[1].toUpperCase();
	if (command === 'G90') { absoluteXYZ = true; continue; }
	if (command === 'G91') { absoluteXYZ = false; continue; }
	if (command === 'M82') { absoluteE = true; continue; }
	if (command === 'M83') { absoluteE = false; continue; }
	if (command === 'G92') {
	  const reset = {};
	  for (const match of line.matchAll(/([XYZE])\s*(-?[0-9]*\.?[0-9]+)/gi)) reset[match[1].toUpperCase()] = Number(match[2]);
	  if (reset.X !== undefined) x = reset.X;
	  if (reset.Y !== undefined) y = reset.Y;
	  if (reset.Z !== undefined) z = reset.Z;
	  if (reset.E !== undefined) e = reset.E;
	  continue;
	}
	if (command !== 'G0' && command !== 'G1' && command !== 'G2' && command !== 'G3') continue;

	const params = {};
	for (const match of line.matchAll(/([XYZEFIJKR])\s*(-?[0-9]*\.?[0-9]+)/gi)) params[match[1].toUpperCase()] = Number(match[2]);
	const nx = params.X !== undefined ? (absoluteXYZ ? params.X : x + params.X) : x;
	const ny = params.Y !== undefined ? (absoluteXYZ ? params.Y : y + params.Y) : y;
	const nz = params.Z !== undefined ? (absoluteXYZ ? params.Z : z + params.Z) : z;
	const ne = params.E !== undefined ? (absoluteE ? params.E : e + params.E) : e;
	const de = ne - e;

	if (de > 0.0001) {
	  const motionSegments = [];
	  if ((command === 'G2' || command === 'G3') && params.I !== undefined && params.J !== undefined) {
		const cx = x + params.I, cy = y + params.J;
		const startAngle = Math.atan2(y - cy, x - cx);
		const endAngle = Math.atan2(ny - cy, nx - cx);
		let sweep = command === 'G2' ? startAngle - endAngle : endAngle - startAngle;
		if (sweep < 0) sweep += Math.PI * 2;
		if (command === 'G2' && sweep === 0) sweep = -Math.PI * 2;
		if (command === 'G3' && sweep === 0) sweep = Math.PI * 2;
		const radius = Math.hypot(x - cx, y - cy);
		const steps = Math.max(4, Math.min(64, Math.ceil(Math.abs(sweep) * radius / 0.5)));
		let px = x, py = y, pz = z;
		for (let step = 1; step <= steps; step++) {
		  const fraction = step / steps;
		  const angle = command === 'G2' ? startAngle - sweep * fraction : startAngle + sweep * fraction;
		  const qx = cx + Math.cos(angle) * radius;
		  const qy = cy + Math.sin(angle) * radius;
		  const qz = z + (nz - z) * fraction;
		  motionSegments.push([px, py, pz, qx, qy, qz]);
		  px = qx; py = qy; pz = qz;
		}
	  } else if (Math.hypot(nx - x, ny - y) > 0.001) {
		motionSegments.push([x, y, z, nx, ny, nz]);
	  }
	  for (const segment of motionSegments) {
		segments.push(segment);
		const [ax, ay, az, bx, by, bz] = segment;
		min = [Math.min(min[0], ax - width / 2, bx - width / 2), Math.min(min[1], ay - width / 2, by - width / 2), Math.min(min[2], az - (options.layerHeight || 0.20) / 2, bz - (options.layerHeight || 0.20) / 2)];
		max = [Math.max(max[0], ax + width / 2, bx + width / 2), Math.max(max[1], ay + width / 2, by + width / 2), Math.max(max[2], az + (options.layerHeight || 0.20), bz + (options.layerHeight || 0.20))];
	  }
	}
	x = nx; y = ny; z = nz; e = ne;
  }

  if (!segments.length) throw new Error('No extruding toolpaths were found, so a 3D STL could not be reconstructed.');

  const triangleCount = segments.length * 12;
  const buffer = new ArrayBuffer(84 + triangleCount * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triangleCount, true);
  let offset = 84;
  const addTriangle = (a, b, c) => {
	view.setUint32(offset, 0, true); view.setUint32(offset + 4, 0, true); view.setUint32(offset + 8, 0, true); offset += 12;
	for (const point of [a, b, c]) { view.setFloat32(offset, point[0], true); view.setFloat32(offset + 4, point[1], true); view.setFloat32(offset + 8, point[2], true); offset += 12; }
	view.setUint16(offset, 0, true); offset += 2;
  };
  const boxForSegment = (s) => {
	const [ax, ay, az, bx, by, bz] = s;
	const dx = bx - ax, dy = by - ay;
	const length = Math.hypot(dx, dy) || 1;
	const px = -dy / length * width / 2, py = dx / length * width / 2;
	const z0 = az - layerHeight / 2, z1 = Math.max(az + layerHeight, bz + layerHeight);
	const a0 = [ax + px, ay + py, z0], b0 = [ax - px, ay - py, z0];
	const c0 = [bx - px, by - py, z0], d0 = [bx + px, by + py, z0];
	const a1 = [ax + px, ay + py, z1], b1 = [ax - px, ay - py, z1];
	const c1 = [bx - px, by - py, z1], d1 = [bx + px, by + py, z1];
	addTriangle(a0,b0,c0); addTriangle(a0,c0,d0); addTriangle(a1,c1,b1); addTriangle(a1,d1,c1);
	addTriangle(a0,d0,d1); addTriangle(a0,d1,a1); addTriangle(b0,b1,c1); addTriangle(b0,c1,c0);
	addTriangle(a0,a1,b1); addTriangle(a0,b1,b0); addTriangle(d0,c0,c1); addTriangle(d0,c1,d1);
  };
  for (const segment of segments) boxForSegment(segment);
  const stl = new Uint8Array(buffer, 0, offset);
  return { stl, segments: segments.length, dimensions: { x: max[0] - min[0] + width, y: max[1] - min[1] + width, z: max[2] - min[2] + layerHeight } };
}
