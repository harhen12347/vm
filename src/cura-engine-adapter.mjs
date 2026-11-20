const INFILL_PATTERNS = Object.freeze({ Grid: 'grid', Lines: 'lines', Triangles: 'triangles' });

export function buildCuraOverrides(profile, settings) {
  const overrides = [];
  const add = (key, value, scope) => {
    if (value === undefined || value === null) return;
    const override = { key, value: String(value) };
    if (scope) override.scope = scope;
    overrides.push(override);
  };

  add('machine_width', profile.buildVolume.x);
  add('machine_depth', profile.buildVolume.y);
  add('machine_height', profile.buildVolume.z);
  add('machine_center_is_zero', profile.originAtCenter);
  add('machine_name', profile.model);
  add('machine_gcode_flavor', profile.firmwareType || 'RepRap (Marlin/Sprinter)');
  add('machine_heated_bed', profile.heatedBed === true);
  add('machine_start_gcode', profile.startGcode);
  add('machine_end_gcode', profile.endGcode);
  add('machine_nozzle_size', settings.nozzleDiameter, 'e0');
  add('material_diameter', profile.filamentDiameter, 'e0');
  add('relative_extrusion', profile.relativeExtrusion);
  add('layer_height', settings.layerHeight);
  add('line_width', settings.lineWidth);
  add('wall_line_count', settings.wallCount);
  add('top_layers', settings.solidLayerCount);
  add('bottom_layers', settings.solidLayerCount);
  add('infill_sparse_density', settings.infillDensity);
  add('infill_pattern', INFILL_PATTERNS[settings.infillPattern] || 'grid');
  add('speed_print', settings.printSpeed);
  add('material_flow', settings.flowRate);
  add('material_print_temperature', settings.nozzleTemperature);
  add('material_print_temperature_layer_0', settings.nozzleTemperature);
  add('material_bed_temperature', settings.bedTemperature);
  add('material_bed_temperature_layer_0', settings.bedTemperature);
  add('adhesion_type', settings.adhesion === 'none' ? 'none' : settings.adhesion);
  add('support_enable', settings.supports);
  if (profile.retraction) {
    add('retraction_enable', Number(profile.retraction.distance) > 0);
    add('retraction_amount', profile.retraction.distance);
    add('retraction_speed', profile.retraction.speed);
  } else {
    add('retraction_enable', false);
  }
  return overrides;
}

export function trianglesToBinaryStl(triangles) {
  if (!Array.isArray(triangles) || triangles.length < 3 || triangles.length % 3 !== 0 ||
      triangles.some((point) => !Array.isArray(point) || point.length !== 3 || point.some((value) => !Number.isFinite(value)))) {
    throw new Error('The model has invalid triangle data.');
  }
  const triangleCount = triangles.length / 3;
  const buffer = new ArrayBuffer(84 + triangleCount * 50);
  const view = new DataView(buffer);
  const header = new TextEncoder().encode('Prism CuraEngine mesh');
  new Uint8Array(buffer, 0, header.length).set(header);
  view.setUint32(80, triangleCount, true);

  for (let index = 0; index < triangleCount; index++) {
    const [a, b, c] = triangles.slice(index * 3, index * 3 + 3);
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const normal = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0]
    ];
    const length = Math.hypot(...normal) || 1;
    const offset = 84 + index * 50;
    normal.forEach((value, axis) => view.setFloat32(offset + axis * 4, value / length, true));
    [a, b, c].forEach((point, vertex) => point.forEach((value, axis) =>
      view.setFloat32(offset + 12 + vertex * 12 + axis * 4, value, true)));
    view.setUint16(offset + 48, 0, true);
  }
  return buffer;
}

function parseAxis(line, axis) {
  const match = line.match(new RegExp(`(?:^|\\s)${axis}([-+]?(?:\\d*\\.)?\\d+(?:[eE][-+]?\\d+)?)`));
  return match ? Number(match[1]) : null;
}

export function parseCuraGcode(gcode, profile) {
  const text = typeof gcode === 'string' ? gcode : new TextDecoder().decode(gcode);
  if (!/^;FLAVOR:/m.test(text) || !/^G[01]\b/m.test(text)) {
    throw new Error('CuraEngine returned invalid or empty G-code.');
  }
  const layers = [];
  let layerIndex = 0;
  let x = 0, y = 0, z = 0, e = 0;
  let relativeExtrusion = false;
  let moveType = 'wall';
  for (const line of text.split(/\r?\n/)) {
    const layerMatch = line.match(/^;LAYER:(\d+)/);
    if (layerMatch) layerIndex = Number(layerMatch[1]);
    const typeMatch = line.match(/^;TYPE:(.+)/);
    if (typeMatch) moveType = typeMatch[1].toLowerCase();
    if (/^M83\b/i.test(line)) relativeExtrusion = true;
    if (/^M82\b/i.test(line)) relativeExtrusion = false;
    if (/^G92\b/i.test(line)) {
      const reset = parseAxis(line, 'E');
      if (reset !== null) e = reset;
      continue;
    }
    const command = line.match(/^(G0|G1)\b/i)?.[1]?.toUpperCase();
    if (!command) continue;
    const nextX = parseAxis(line, 'X');
    const nextY = parseAxis(line, 'Y');
    const nextZ = parseAxis(line, 'Z');
    const nextE = parseAxis(line, 'E');
    if (nextZ !== null) z = nextZ;
    if (nextX === null && nextY === null) {
      if (nextE !== null) e = relativeExtrusion ? e + nextE : nextE;
      continue;
    }
    const targetX = nextX === null ? x : nextX;
    const targetY = nextY === null ? y : nextY;
    const extrusionDelta = nextE === null ? 0 : relativeExtrusion ? nextE : nextE - e;
    if (nextE !== null) e = relativeExtrusion ? e + nextE : nextE;
    if (targetX !== x || targetY !== y) {
      if (!layers[layerIndex]) layers[layerIndex] = { z, moves: [] };
      const offsetX = profile.originAtCenter ? 0 : profile.buildVolume.x / 2;
      const offsetY = profile.originAtCenter ? 0 : profile.buildVolume.y / 2;
      let kind = command === 'G0' || extrusionDelta <= 0 ? 'travel' : 'wall';
      if (kind !== 'travel' && /infill|fill|skin/i.test(moveType)) kind = 'infill';
      if (kind !== 'travel' && /support/i.test(moveType)) kind = 'support';
      layers[layerIndex].moves.push({
        kind,
        x1: x - offsetX, y1: y - offsetY,
        x2: targetX - offsetX, y2: targetY - offsetY, z
      });
    }
    x = targetX;
    y = targetY;
  }
  const printableLayers = layers.filter((layer) => layer?.moves.length);
  if (!printableLayers.length) throw new Error('CuraEngine returned no printable toolpaths.');
  return printableLayers;
}

export function curaMetadataToStats(metadata, filamentDiameter, density = 1.24) {
  if (!metadata || !Number.isFinite(metadata.printTime) || !Number.isFinite(metadata.filamentUsage)) {
    return { estimatedMinutes: null, filamentMm: null, filamentGrams: null };
  }
  const filamentArea = Math.PI * (filamentDiameter / 2) ** 2;
  const filamentMm = metadata.filamentUsage / filamentArea;
  return {
    estimatedMinutes: metadata.printTime / 60,
    filamentMm,
    filamentGrams: metadata.filamentUsage * density / 1000
  };
}
