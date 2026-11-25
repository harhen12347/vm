// Profile comparison. Works on FcfgDocument objects (see fcfg.mjs).
import { formatFloat32 } from './qt-variant.mjs';

/** Display grouping by KEY PREFIX only (names observed in genuine files). This is a UI convenience,
 *  not a claim about FlashPrint semantics. Anything unmatched is 'other' and is still preserved. */
const CATEGORY_RULES = [
  ['identity', /^(machineId|nozzleSize|profileName|material\w*)$/],
  ['layer', /^(layerHeight|firstLayerHeight|layerLHeights\w*|layerPauses)$/],
  ['temperature', /^(extruderTemp|platformTemp|chamber|layerTempsEnable|layerExtruderTemps|layerPlatTemps|layerChamberTemps|idleExtruderTemp)/],
  ['speed', /^(baseSpeed|travelSpeed|minSpeed|firstLayerMax|firstFew|overhangSpeed|decelerate|delay|primeTowerSpeed)/],
  ['acceleration', /^acceleration/],
  ['retraction', /^retract/],
  ['shell', /^shell/],
  ['infill', /^(fill|vaseMode)/],
  ['support', /^support/],
  ['raft', /^raft/],
  ['brim', /^brim/],
  ['wall', /^wall/],
  ['cooling', /^(fan|extraFan|auxFan)/],
  ['extrusion', /^(extrusionRatio|firstExtrusionRatio|pathWidth|pathPrecision|preExtrude|bridge)/],
  ['advanced', /^(linearAdvance|zHop|zTranslate|maxVolumeSpeed|voltage|shrinkage|offset|fuzzy|ironing|sequentialPrinting)/],
];
export function categorizeKey(key) {
  for (const [name, re] of CATEGORY_RULES) if (re.test(key)) return name;
  return 'other';
}

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
function signature(e) {
  const v = e.value;
  if (v.bytes) return `variant:${hex(v.bytes)}`;               // exact bytes: NaN-safe, type-aware
  return `${v.kind}:${JSON.stringify(v.value)}`;
}
function display(e) {
  if (!e) return undefined;
  const v = e.value;
  if (v.kind === 'float32') return formatFloat32(v.value);
  if (v.kind === 'raw') return `<Qt type ${v.typeId}, ${v.bytes.length - 4} bytes>`;
  return v.kind === 'array' ? JSON.stringify(v.value) : String(v.value);
}

const IDENTITY_KEYS = ['machineId', 'nozzleSize', 'profileName', 'materialName0', 'materialName1', 'materialDensity0', 'materialDensity1'];

/** compareProfiles(a, b) -> { identity, printerDiffers, nozzleDiffers, materialDiffers, changed, added, removed, unchangedCount, sectionsOnlyInA/B } */
export function compareProfiles(a, b) {
  const row = (doc, s, k) => doc.getEntry(s, k);
  const idRow = (k) => {
    const ea = row(a, 'Custom', k), eb = row(b, 'Custom', k);
    return { a: display(ea), b: display(eb), equal: (ea ? signature(ea) : null) === (eb ? signature(eb) : null) };
  };
  const identity = Object.fromEntries(IDENTITY_KEYS.map((k) => [k, idRow(k)]));
  const sa = new Set(a.sections()), sb = new Set(b.sections());
  const changed = [], added = [], removed = []; let unchangedCount = 0;
  for (const s of new Set([...sa, ...sb])) {
    for (const k of new Set([...a.keys(s), ...b.keys(s)])) {
      const ea = row(a, s, k), eb = row(b, s, k);
      const meta = { section: s, key: k, category: categorizeKey(k) };
      if (ea && !eb) removed.push({ ...meta, value: display(ea), raw: ea.raw });
      else if (!ea && eb) added.push({ ...meta, value: display(eb), raw: eb.raw });
      else if (signature(ea) !== signature(eb)) changed.push({ ...meta, a: display(ea), b: display(eb), aRaw: ea.raw, bRaw: eb.raw });
      else unchangedCount++;
    }
  }
  return {
    identity,
    printerDiffers: !identity.machineId.equal,
    nozzleDiffers: !identity.nozzleSize.equal,
    materialDiffers: ['materialName0', 'materialName1', 'materialDensity0', 'materialDensity1'].some((k) => !identity[k].equal),
    changed, added, removed, unchangedCount,
    sectionsOnlyInA: [...sa].filter((s) => !sb.has(s)), sectionsOnlyInB: [...sb].filter((s) => !sa.has(s)),
  };
}
