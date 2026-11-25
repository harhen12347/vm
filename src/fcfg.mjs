// FlashPrint .fcfg (QSettings INI) document model.
//
// Design rule: every line keeps its ORIGINAL text. A line is re-encoded only when its value is
// explicitly changed through set(). Unknown keys, empty values, arrays, quoting, comments, blank
// lines, odd spacing, section order and line endings therefore survive import -> export untouched.

import {
  QtVariantError, isVariantText, parseVariantText, decodeVariantBytes, encodeVariantBytes,
  variantBytesToText, stripQuotes, unescapeIni, escapeIniBytes, formatFloat32,
} from './qt-variant.mjs';

export class FcfgParseError extends Error {
  constructor(message, line) { super(line ? `line ${line}: ${message}` : message); this.name = 'FcfgParseError'; this.line = line; }
}

const VARIANT_KINDS = new Set(['float32', 'float64', 'int32', 'uint32', 'qbool', 'raw']);

/* ---------- plain (non-variant) value helpers ---------- */

function needsQuoting(str) { return /[,;=]/.test(str) || /^\s|\s$/.test(str); }

function encodePlainString(str) {
  // control chars and backslash/quote escaped like QSettings; printable & non-ASCII text left as-is
  let out = '';
  for (const ch of str) {
    const c = ch.codePointAt(0);
    if (c < 0x20 || c === 0x7f || ch === '\\' || ch === '"') out += escapeIniBytes([c]).text;
    else out += ch;
  }
  return needsQuoting(str) ? `"${out}"` : out;
}

function decodePlain(raw) {
  if (raw === '') return { kind: 'empty', value: '' };
  if (raw === 'true' || raw === 'false') return { kind: 'bool', value: raw === 'true' };
  if (/^-?\d+$/.test(raw) && Number.isSafeInteger(Number(raw))) return { kind: 'int', value: Number(raw) };
  let text = raw;
  try {
    const { inner } = stripQuotes(raw);
    text = inner.includes('\\') ? String.fromCharCode(...unescapeIni(inner)) : inner;
  } catch { return { kind: 'string', value: raw, lossy: true }; }
  if (text.startsWith('[')) {
    try { const arr = JSON.parse(text); if (Array.isArray(arr)) return { kind: 'array', value: arr }; } catch { /* plain string */ }
  }
  return { kind: 'string', value: text };
}

function decodeValue(raw) {
  if (isVariantText(raw)) {
    const { bytes } = parseVariantText(raw);
    return decodeVariantBytes(bytes);
  }
  return decodePlain(raw);
}

/** decoded value -> exact INI value text */
export function encodeValue(d) {
  if (VARIANT_KINDS.has(d.kind)) return variantBytesToText(d.kind === 'raw' ? d.bytes : encodeVariantBytes(d.kind, d.value));
  switch (d.kind) {
    case 'empty': return '';
    case 'bool': return d.value ? 'true' : 'false';
    case 'int': return String(d.value);
    case 'array': return encodePlainString(JSON.stringify(d.value));
    case 'string': return encodePlainString(d.value);
    default: throw new FcfgParseError(`cannot encode kind "${d.kind}"`);
  }
}

/** After encoding, variants are re-decoded from their own bytes so entry.value is always what a re-parse would give. */
function settle(d) { return VARIANT_KINDS.has(d.kind) ? decodeVariantBytes(parseVariantText(encodeValue(d)).bytes) : d; }

/** Build a decoded value for set(): keep the existing kind unless `as` is given. */
function coerce(existing, value, as) {
  let kind = as ?? existing?.kind;
  if (kind === 'empty') kind = typeof value === 'string' ? 'string' : undefined;
  if (kind === 'raw') throw new FcfgParseError('this value has an unrecognised Qt type; pass { as: ... } to replace it explicitly');
  if (!kind) throw new FcfgParseError('value type unknown: pass { as: "float32" | "float64" | "int32" | "uint32" | "qbool" | "bool" | "int" | "string" | "array" }');
  switch (kind) {
    case 'float32': return { kind, value: Math.fround(Number(value)) };
    case 'float64': case 'int32': case 'uint32': return { kind, value: Number(value) };
    case 'qbool': case 'bool': return { kind, value: Boolean(value) };
    case 'int': if (!Number.isSafeInteger(Number(value))) throw new FcfgParseError('int value must be an integer'); return { kind, value: Number(value) };
    case 'string': return { kind, value: String(value) };
    case 'array': if (!Array.isArray(value)) throw new FcfgParseError('array value must be an Array'); return { kind, value };
    default: throw new FcfgParseError(`unknown kind "${kind}"`);
  }
}

const sameDecoded = (a, b) =>
  a.kind === b.kind && (VARIANT_KINDS.has(a.kind) ? encodeValue(a) === encodeValue(b) : JSON.stringify(a.value) === JSON.stringify(b.value));

/* ---------- document ---------- */

export class FcfgDocument {
  constructor(nodes, { eol = '\r\n', encoding = 'utf-8', warnings = [] } = {}) {
    this.nodes = nodes; this.eol = eol; this.encoding = encoding; this.warnings = warnings;
  }

  sections() { return [...new Set(this.nodes.filter((n) => n.type === 'section').map((n) => n.name))]; }
  entries(section) { return this.nodes.filter((n) => n.type === 'entry' && n.section === section); }
  keys(section) { return [...new Set(this.entries(section).map((e) => e.key))]; }
  #find(section, key) { let hit; for (const n of this.nodes) if (n.type === 'entry' && n.section === section && n.key === key) hit = n; return hit; }

  has(section, key) { return !!this.#find(section, key); }
  getEntry(section, key) { return this.#find(section, key); }
  /** decoded JS value (number / boolean / string / array), or undefined */
  get(section, key) { return this.#find(section, key)?.value.value; }
  getRaw(section, key) { return this.#find(section, key)?.raw; }

  toObject() {
    const o = {};
    for (const s of this.sections()) { o[s] = {}; for (const k of this.keys(s)) o[s][k] = this.get(s, k); }
    return o;
  }

  /** Change (or add) a value. Returns false (and touches nothing) if the value is unchanged. */
  set(section, key, value, { as } = {}) {
    const e = this.#find(section, key);
    if (e) {
      const next = coerce(e.value, value, as);
      if (sameDecoded(e.value, next)) return false;
      e.value = settle(next); e.raw = encodeValue(next); e.dirty = true; return true;
    }
    if (!as) throw new FcfgParseError(`"${key}" does not exist in [${section}]; pass { as: <kind> } to add a new setting`);
    const next = coerce(undefined, value, as);
    const entry = { type: 'entry', section, key, raw: encodeValue(next), value: settle(next), line: null, eol: this.eol, dirty: true };
    let at = -1;
    this.nodes.forEach((n, i) => { if ((n.type === 'entry' && n.section === section) || (n.type === 'section' && n.name === section)) at = i; });
    if (at < 0) {
      const last = this.nodes[this.nodes.length - 1];
      if (last && last.eol === '') last.eol = this.eol;
      this.nodes.push({ type: 'section', name: section, line: null, eol: this.eol, dirty: true });
      this.nodes.push(entry);
    } else {
      if (this.nodes[at].eol === '') this.nodes[at].eol = this.eol;
      this.nodes.splice(at + 1, 0, entry);
    }
    return true;
  }

  remove(section, key) {
    const before = this.nodes.length;
    this.nodes = this.nodes.filter((n) => !(n.type === 'entry' && n.section === section && n.key === key));
    return this.nodes.length !== before;
  }

  serialize() {
    return (this.hadBom ? '\uFEFF' : '') + this.nodes.map((n) => {
      if (n.type === 'section') return (n.line ?? `[${n.name}]`) + n.eol;
      if (n.type === 'entry') return (n.dirty || n.line === null ? `${n.key}=${n.raw}` : n.line) + n.eol;
      return n.text + n.eol;
    }).join('');
  }

  serializeBytes() {
    const text = this.serialize();
    if (this.encoding === 'latin1') return Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);
    return new TextEncoder().encode(text);
  }
}

/** Parse .fcfg text. strict (default): any malformed line throws FcfgParseError with its line number.
 *  strict:false keeps malformed lines verbatim (so they still round-trip) and records a warning. */
export function parseFcfg(text, { strict = true } = {}) {
  if (typeof text !== 'string') throw new FcfgParseError('parseFcfg expects a string; use parseFcfgBytes for bytes');
  const bom = text.startsWith('\uFEFF'); if (bom) text = text.slice(1);
  const nodes = [], warnings = [];
  let section = null, eolSeen = null, lineNo = 0;
  const bad = (msg, line, eol) => {
    if (strict) throw new FcfgParseError(msg, lineNo);
    warnings.push({ line: lineNo, message: msg }); nodes.push({ type: 'raw', text: line, eol, malformed: true });
  };
  const re = /([^\r\n]*)(\r\n|\n|\r|$)/y;
  for (let pos = 0; pos < text.length; ) {
    re.lastIndex = pos; const m = re.exec(text); const [whole, line, eol] = m;
    pos += whole.length; lineNo++; if (eol && !eolSeen) eolSeen = eol;
    const t = line.trim();
    if (t === '' || t.startsWith(';')) { nodes.push({ type: 'raw', text: line, eol }); continue; }
    const sec = /^\[(.*)\]$/.exec(t);
    if (sec) { section = sec[1]; nodes.push({ type: 'section', name: section, line, eol }); continue; }
    if (t.startsWith('[')) { bad('unterminated section header', line, eol); continue; }
    const eq = line.indexOf('=');
    if (eq < 0) { bad('expected "key=value" or "[section]"', line, eol); continue; }
    const key = line.slice(0, eq).trim(), raw = line.slice(eq + 1).trim();
    if (!key) { bad('empty key', line, eol); continue; }
    if (section === null) warnings.push({ line: lineNo, message: `"${key}" appears before any [section]` });
    let value;
    try { value = decodeValue(raw); }
    catch (err) {
      if (!(err instanceof QtVariantError)) throw err;
      if (strict) throw new FcfgParseError(`${key}: ${err.message}`, lineNo);
      warnings.push({ line: lineNo, message: `${key}: ${err.message}` });
      value = { kind: 'string', value: raw, malformed: true };
    }
    nodes.push({ type: 'entry', section, key, raw, value, line, eol, dirty: false });
  }
  if (!nodes.some((n) => n.type === 'section')) {
    if (strict) throw new FcfgParseError('no [section] found: not an .fcfg file');
    warnings.push({ line: 0, message: 'no [section] found' });
  }
  const doc = new FcfgDocument(nodes, { eol: eolSeen ?? '\r\n', warnings });
  doc.hadBom = bom;
  return doc;
}

/** Parse raw file bytes: UTF-8 (BOM stripped & remembered), falling back to latin1 so bytes always round-trip. */
export function parseFcfgBytes(bytes, opts) {
  let text, encoding = 'utf-8';
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { text = Array.from(bytes, (b) => String.fromCharCode(b)).join(''); encoding = 'latin1'; }
  const doc = parseFcfg(text, opts); doc.encoding = encoding;
  return doc;
}

export { formatFloat32 };
