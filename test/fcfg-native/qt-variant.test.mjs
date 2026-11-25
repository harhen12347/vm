import test from 'node:test'; import assert from 'node:assert/strict';
import { decodeVariantText, parseVariantText, decodeVariantBytes, encodeVariantBytes, variantBytesToText,
  unescapeIni, escapeIniBytes, formatFloat32, QtVariantError } from '../../src/index.mjs';

const V = (payload) => `@Variant(${payload})`;
const hex = (b) => Buffer.from(b).toString('hex');

test('decodes genuine FlashPrint float variants (hex checked independently)', () => {
  // [text, expected IEEE-754 big-endian hex, expected value]
  const cases = [
    ['\\0\\0\\0\\x87>L\\xcc\\xcd', '3e4ccccd', 0.2],          // layerHeight  (NOT 0.05)
    ['\\0\\0\\0\\x87>\\x99\\x99\\x9a', '3e99999a', 0.3],      // firstLayerHeight
    ['\\0\\0\\0\\x87>\\xcc\\xcc\\xcd', '3ecccccd', 0.4],      // nozzleSize
    ['\\0\\0\\0\\x87\\x43\\x61\\0\\0', '43610000', 225],      // extruderTemp0
    ['\\0\\0\\0\\x87\\x42\\\\\\0\\0', '425c0000', 55],        // platformTemp (escaped backslash = 0x5c)
    ['\\0\\0\\0\\x87\\x46\\x1c@\\0', '461c4000', 10000],      // accelerationGeneral
    ['\\0\\0\\0\\x87\\0\\0\\0\\0', '00000000', 0],            // zero
    ['\\0\\0\\0\\x87\\xc2\\xc8\\0\\0', 'c2c80000', -100],     // negative
  ];
  for (const [payload, h, val] of cases) {
    const d = decodeVariantText(V(payload));
    assert.equal(d.typeId, 135); assert.equal(d.kind, 'float32');
    assert.equal(hex(d.bytes.subarray(4)), h);
    assert.equal(d.value, Math.fround(val), payload);
  }
});

test('decoder handles C-style escapes and quoting seen in real files', () => {
  assert.equal(decodeVariantText('"@Variant(\\0\\0\\0\\x87>\\xd7\\n=)"').value, Math.fround(0.42));   // pathWidth: \n and '=' => quoted
  assert.equal(hex(parseVariantText(V('\\0\\0\\0\\x87\\a\\0\\0\\0')).bytes), '0000008707000000');     // \a
  assert.equal(hex(parseVariantText(V('\\0\\0\\0\\x87\\f\\0\\0\\0')).bytes), '000000870c000000');     // \f
  assert.equal(parseVariantText('"@Variant(\\0\\0\\0\\x87?\\x80\\0\\0)"').quoted, true);
});

test('\\x escapes are greedy: Qt re-escapes hex-digit characters that follow one', () => {
  assert.deepEqual(unescapeIni('\\x43\\x61'), [0x43, 0x61]);
  assert.deepEqual(unescapeIni('\\x87>'), [0x87, 0x3e]);
  assert.deepEqual(unescapeIni('\\x4a'), [0x4a]);                 // greedy: one byte, not 0x4 then 'a'
  const { text } = escapeIniBytes([0x87, 0x43, 0x61, 0x00, 0x00]);
  assert.equal(text, '\\x87\\x43\\x61\\0\\0');
});

test('\\x escapes are not zero-padded (corpus: shrinkageOffset = \\x3 not \\x03)', () => {
  assert.equal(escapeIniBytes([0x03]).text, '\\x3');
  assert.equal(variantBytesToText(Uint8Array.from([0, 0, 0, 0x87, 0x3b, 0x03, 0x12, 0x6f])), '"@Variant(\\0\\0\\0\\x87;\\x3\\x12o)"');
});

test('quotes are used exactly when payload contains , ; =', () => {
  assert.equal(variantBytesToText(encodeVariantBytes('float32', 3000)), '"@Variant(\\0\\0\\0\\x87\\x45;\\x80\\0)"'); // 0x3b ';'
  assert.equal(variantBytesToText(encodeVariantBytes('float32', 0.2)), '@Variant(\\0\\0\\0\\x87>L\\xcc\\xcd)');
});

test('encoder: float32 round-trips and matches FlashPrint bytes', () => {
  assert.equal(variantBytesToText(encodeVariantBytes('float32', 0.2)), '@Variant(\\0\\0\\0\\x87>L\\xcc\\xcd)');
  assert.equal(variantBytesToText(encodeVariantBytes('float32', 0)), '@Variant(\\0\\0\\0\\x87\\0\\0\\0\\0)');
  assert.equal(variantBytesToText(encodeVariantBytes('float32', 225)), '@Variant(\\0\\0\\0\\x87\\x43\\x61\\0\\0)');
  for (const x of [0, 0.05, 0.2, 0.25, 0.4, 0.6, 0.8, 1.75, 225, 10000, -100, 1e-7, 123456.78]) {
    const back = decodeVariantText(variantBytesToText(encodeVariantBytes('float32', x)));
    assert.equal(back.value, Math.fround(x));
  }
});

test('encoder output always decodes to identical bytes for every byte value (escape self-check)', () => {
  for (let b = 0; b < 256; b++) for (const next of [0, 0x30, 0x41, 0x66, 0x22, 0x5c, 0x3b, 0xff]) {
    const bytes = Uint8Array.from([0, 0, 0, 0x87, b, next, b, 0]);
    assert.deepEqual([...parseVariantText(variantBytesToText(bytes)).bytes], [...bytes], `${b},${next}`);
  }
});

test('other Qt types per documented stream format (NOT corpus-verified)', () => {
  assert.equal(decodeVariantBytes(encodeVariantBytes('int32', -5)).value, -5);
  assert.equal(decodeVariantBytes(encodeVariantBytes('uint32', 4000000000)).value, 4000000000);
  assert.equal(decodeVariantBytes(encodeVariantBytes('float64', 0.1)).value, 0.1);
  assert.equal(decodeVariantBytes(encodeVariantBytes('qbool', true)).value, true);
  assert.equal(decodeVariantBytes(encodeVariantBytes('qbool', false)).value, false);
});

test('unknown Qt type ids are preserved as raw, not guessed', () => {
  const d = decodeVariantBytes(Uint8Array.from([0, 0, 3, 0xe7, 1, 2, 3]));
  assert.equal(d.kind, 'raw'); assert.equal(d.typeId, 999); assert.equal(d.value, undefined);
});

test('malformed variants are rejected', () => {
  const bad = [
    ['too short', V('\\0\\0')],
    ['float with 3 payload bytes', V('\\0\\0\\0\\x87>L\\xcc')],
    ['float with 5 payload bytes', V('\\0\\0\\0\\x87>L\\xcc\\xcd\\0')],
    ['double with float length', V('\\0\\0\\0\\6>L\\xcc\\xcd')],
    ['bool payload 2', V('\\0\\0\\0\\1\\2')],
    ['unknown escape', V('\\0\\0\\0\\x87\\q')],
    ['dangling backslash', V('\\0\\0\\0\\x87>L\\xcc\\')],
    ['\\x with no digits', V('\\0\\0\\0\\x87\\xzz')],
    ['value above 0xFF', V('\\0\\0\\0\\x87\\x1234')],
    ['not a variant', 'hello'],
    ['missing close paren', '@Variant(\\0\\0\\0\\x87>L\\xcc\\xcd'],
    ['unterminated quote', '"@Variant(\\0\\0\\0\\x87>L\\xcc\\xcd)'],
    ['stray inner quote', '"@Variant(\\0\\0\\0\\x87>"L)"'],
  ];
  for (const [name, text] of bad) assert.throws(() => decodeVariantText(text), QtVariantError, name);
});

test('encoder rejects unencodable input', () => {
  assert.throws(() => encodeVariantBytes('float32', NaN), QtVariantError);
  assert.throws(() => encodeVariantBytes('float32', Infinity), QtVariantError);
  assert.throws(() => encodeVariantBytes('int32', 2 ** 31), QtVariantError);
  assert.throws(() => encodeVariantBytes('uint32', -1), QtVariantError);
  assert.throws(() => encodeVariantBytes('string', 'x'), QtVariantError);
});

test('formatFloat32 gives the human value', () => {
  assert.equal(formatFloat32(Math.fround(0.2)), '0.2');
  assert.equal(formatFloat32(Math.fround(1.24)), '1.24');
  assert.equal(formatFloat32(225), '225');
});
