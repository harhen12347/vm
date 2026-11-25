// Qt QSettings @Variant codec (pure JS, no dependencies).
//
// VERIFIED against 5148 variants in 33 genuine FlashPrint .fcfg files:
//   wire layout = u32 big-endian type id (always 135 in the corpus) + big-endian float32.
//   No isNull byte (QSettings streams variants with QDataStream::Qt_4_0), 8 bytes total.
// NOT verified by any sample (implemented from Qt's documented stream format):
//   Bool(1) Int(2) UInt(3) Double(6). Any other type id is preserved losslessly as 'raw'.

export class QtVariantError extends Error {
  constructor(message) { super(message); this.name = 'QtVariantError'; }
}

export const QT_TYPE = Object.freeze({ Bool: 1, Int: 2, UInt: 3, Double: 6, Float: 135 });

const isHex = (c) => /^[0-9a-fA-F]$/.test(c);
const SIMPLE_ESCAPES = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, '"': 34, "'": 39, '?': 63, '\\': 92 };

/** Undo QSettings INI escaping. Returns an array of UTF-16 code units. */
export function unescapeIni(s) {
  const out = [];
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (c !== '\\') { out.push(s.charCodeAt(i)); i++; continue; }
    if (i + 1 >= s.length) throw new QtVariantError('dangling backslash at end of value');
    const e = s[i + 1];
    if (e === 'x') {                       // \xH... : Qt reads ALL following hex digits
      let j = i + 2;
      while (j < s.length && isHex(s[j])) j++;
      if (j === i + 2) throw new QtVariantError('\\x escape without hex digits');
      out.push(parseInt(s.slice(i + 2, j), 16) & 0xffff);
      i = j;
    } else if (e >= '0' && e <= '7') {     // \ooo : up to 3 octal digits
      let j = i + 1;
      while (j < s.length && j < i + 4 && s[j] >= '0' && s[j] <= '7') j++;
      out.push(parseInt(s.slice(i + 1, j), 8));
      i = j;
    } else if (e in SIMPLE_ESCAPES) {
      out.push(SIMPLE_ESCAPES[e]); i += 2;
    } else {
      throw new QtVariantError(`unknown escape sequence \\${e}`);
    }
  }
  return out;
}

const NAMED = { 7: '\\a', 8: '\\b', 12: '\\f', 10: '\\n', 13: '\\r', 9: '\\t', 11: '\\v', 34: '\\"', 92: '\\\\' };
// NB: Qt does NOT zero-pad \x escapes (byte 0x03 is written \x3). Corpus-verified (12 occurrences).
const hexEsc = (n) => '\\x' + n.toString(16);

/**
 * Escape bytes the way Qt's QSettings does for @Variant payloads.
 * Rules (all reproduced byte-for-byte by the corpus tests unless marked):
 *  - NUL -> \0 ; bytes <0x20 or >=0x7f -> \xH or \xHH (lowercase, unpadded) ; \a\b\f\n\r\t\v ; \\ ; \"
 *  - after \0 or \xHH, a following hex-digit character is itself written as \xHH, because the
 *    reader consumes every hex digit after \x. (corpus-verified for \x...; the \0 + hex-digit
 *    case and \" never occur in the corpus -> recalled from Qt source, self-checked below.)
 * Returns { text, needsQuotes } where needsQuotes is set if any source byte is , ; =
 */
export function escapeIniBytes(bytes) {
  let text = '', needsQuotes = false, escapeNext = false;
  for (const b of bytes) {
    if (b === 0x2c || b === 0x3b || b === 0x3d) needsQuotes = true;
    if (escapeNext) {
      escapeNext = false;
      const ch = String.fromCharCode(b);
      if (isHex(ch)) { text += hexEsc(b); escapeNext = true; continue; }
    }
    if (b === 0) { text += '\\0'; escapeNext = true; }
    else if (b in NAMED) text += NAMED[b];
    else if (b < 0x20 || b >= 0x7f) { text += hexEsc(b); escapeNext = true; }
    else text += String.fromCharCode(b);
  }
  return { text, needsQuotes };
}

/** Split an optionally "quoted" INI value into its inner text. */
export function stripQuotes(raw) {
  if (raw[0] !== '"') return { quoted: false, inner: raw };
  if (raw.length < 2 || raw[raw.length - 1] !== '"') throw new QtVariantError('unterminated quoted value');
  const inner = raw.slice(1, -1);
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '\\') { i++; continue; }
    if (inner[i] === '"') throw new QtVariantError('unescaped quote inside quoted value');
  }
  if (/\\$/.test(inner.replace(/\\\\/g, ''))) throw new QtVariantError('quote escaped by trailing backslash');
  return { quoted: true, inner };
}

export const isVariantText = (raw) => /^"?@Variant\(/.test(raw);

/** '@Variant(...)' or '"@Variant(...)"' -> { quoted, bytes } */
export function parseVariantText(raw) {
  const { quoted, inner } = stripQuotes(raw);
  if (!inner.startsWith('@Variant(') || !inner.endsWith(')')) throw new QtVariantError('not a @Variant(...) value');
  const units = unescapeIni(inner.slice(9, -1));
  if (units.some((u) => u > 0xff)) throw new QtVariantError('variant payload contains a value above 0xFF');
  return { quoted, bytes: Uint8Array.from(units) };
}

/** bytes -> '@Variant(...)' text, quoted exactly when Qt would quote it. Self-verifying. */
export function variantBytesToText(bytes) {
  const { text, needsQuotes } = escapeIniBytes(bytes);
  const body = `@Variant(${text})`;
  const out = needsQuotes ? `"${body}"` : body;
  const back = parseVariantText(out).bytes;                       // safety net for unverified escape rules
  if (back.length !== bytes.length || back.some((v, i) => v !== bytes[i])) {
    throw new QtVariantError('internal error: encoded variant does not decode to the same bytes');
  }
  return out;
}

const dv = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** Decode raw variant bytes. Malformed length for a KNOWN type throws; unknown types stay raw. */
export function decodeVariantBytes(bytes) {
  if (bytes.length < 4) throw new QtVariantError(`variant too short (${bytes.length} bytes, need >= 4)`);
  const v = dv(bytes), typeId = v.getUint32(0, false), need = (n, name) => {
    if (bytes.length !== 4 + n) throw new QtVariantError(`${name} variant must be ${4 + n} bytes, got ${bytes.length}`);
  };
  switch (typeId) {
    case QT_TYPE.Float:  need(4, 'float');  return { kind: 'float32', typeId, value: v.getFloat32(4, false), bytes };
    case QT_TYPE.Double: need(8, 'double'); return { kind: 'float64', typeId, value: v.getFloat64(4, false), bytes };
    case QT_TYPE.Int:    need(4, 'int');    return { kind: 'int32',   typeId, value: v.getInt32(4, false),   bytes };
    case QT_TYPE.UInt:   need(4, 'uint');   return { kind: 'uint32',  typeId, value: v.getUint32(4, false),  bytes };
    case QT_TYPE.Bool:   need(1, 'bool');
      if (bytes[4] > 1) throw new QtVariantError('bool variant payload must be 0 or 1');
      return { kind: 'qbool', typeId, value: bytes[4] === 1, bytes };
    default: return { kind: 'raw', typeId, value: undefined, bytes };
  }
}

export function decodeVariantText(raw) { return { quoted: undefined, ...decodeVariantBytes(parseVariantText(raw).bytes) }; }

export function encodeVariantBytes(kind, value) {
  const num = typeof value === 'number' && Number.isFinite(value);
  const mk = (typeId, n, fill) => { const b = new Uint8Array(4 + n), d = dv(b); d.setUint32(0, typeId, false); fill(d); return b; };
  switch (kind) {
    case 'float32': if (!num) throw new QtVariantError('float32 needs a finite number'); return mk(QT_TYPE.Float, 4, (d) => d.setFloat32(4, value, false));
    case 'float64': if (!num) throw new QtVariantError('float64 needs a finite number'); return mk(QT_TYPE.Double, 8, (d) => d.setFloat64(4, value, false));
    case 'int32':   if (!num || !Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw new QtVariantError('int32 out of range'); return mk(QT_TYPE.Int, 4, (d) => d.setInt32(4, value, false));
    case 'uint32':  if (!num || !Number.isInteger(value) || value < 0 || value > 4294967295) throw new QtVariantError('uint32 out of range'); return mk(QT_TYPE.UInt, 4, (d) => d.setUint32(4, value, false));
    case 'qbool':   return mk(QT_TYPE.Bool, 1, (d) => d.setUint8(4, value ? 1 : 0));
    default: throw new QtVariantError(`cannot encode variant kind "${kind}"`);
  }
}

/** Shortest decimal string that round-trips through float32 (0.2 instead of 0.20000000298023224). */
export function formatFloat32(x) {
  if (!Number.isFinite(x)) return String(x);
  for (let p = 1; p <= 9; p++) { const s = Number(x.toPrecision(p)); if (Math.fround(s) === x) return String(s); }
  return String(x);
}
