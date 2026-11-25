import test from 'node:test'; import assert from 'node:assert/strict';
import { parseFcfg, parseFcfgBytes, FcfgParseError, encodeValue } from '../../src/index.mjs';
import { corpus, load, dec } from './helpers.mjs';

const PLA = () => load('0.40mm', 'Flashforge-PLA.fcfg');

/* ---------- genuine-file facts ---------- */
test('genuine PLA 0.40: sections, identity fields and independently decoded values', () => {
  const d = parseFcfgBytes(PLA());
  assert.deepEqual(d.sections(), ['Custom', 'General']);
  assert.equal(d.get('Custom', 'machineId'), 33);
  assert.equal(d.get('Custom', 'profileName'), 'Flashforge-PLA');
  assert.equal(d.get('Custom', 'materialName0'), 'Flashforge-PLA');
  assert.equal(d.get('Custom', 'materialName1'), '');
  assert.equal(d.getEntry('Custom', 'materialName1').value.kind, 'empty');
  const f = Math.fround;
  const expect = { nozzleSize: 0.4, materialDensity0: 1.24, materialDensity1: 0 };
  for (const [k, v] of Object.entries(expect)) assert.equal(d.get('Custom', k), f(v), k);
  const g = { extruderTemp0: 225, extruderTemp1: 210, platformTemp: 55, chamberTemp: 0, layerHeight: 0.2, firstLayerHeight: 0.3,
    baseSpeed: 300, travelSpeed: 500, shellCnt: 2, fillDensity: 0.15, accelerationGeneral: 10000, accelerationOuterShell: 3000, retractLen0: 1.2 };
  for (const [k, v] of Object.entries(g)) assert.equal(d.get('General', k), f(v), k);
  assert.notEqual(d.get('General', 'layerHeight'), f(0.05));       // the handover's earlier claim was wrong
});

test('plain values: booleans, ints, empty arrays, quoted arrays', () => {
  const d = parseFcfgBytes(PLA());
  assert.equal(d.get('General', 'layerTempsEnable'), true);
  assert.equal(d.get('General', 'vaseMode'), false);
  assert.equal(d.get('General', 'fillPattern'), 4);
  assert.deepEqual(d.get('General', 'layerExtruderTemps0'), []);
  assert.equal(d.getRaw('General', 'layerExtruderTemps0'), '[]');
  assert.deepEqual(d.get('General', 'fanLayerSpeeds0'), [[3, 3, 60], [4, 9999, 100]]);
  assert.equal(d.getRaw('General', 'fanLayerSpeeds0'), '"[[3,3,60],[4,9999,100]]"');
});

test('every key is present once per file, in the same order (corpus invariant)', () => {
  const order = (b) => parseFcfgBytes(b).nodes.filter((n) => n.type === 'entry').map((n) => `${n.section}/${n.key}`);
  const ref = order(PLA());
  assert.equal(ref.length, 207); assert.equal(new Set(ref).size, 207);
  for (const f of corpus()) assert.deepEqual(order(f.bytes), ref, `${f.dir}/${f.file}`);
});

test('nozzle size in each file matches its folder (0.25/0.40/0.60/0.80)', () => {
  const seen = new Set();
  for (const f of corpus()) {
    const d = parseFcfgBytes(f.bytes);
    assert.equal(d.get('Custom', 'nozzleSize'), Math.fround(f.nozzle), `${f.dir}/${f.file}`); seen.add(f.nozzle);
  }
  assert.deepEqual([...seen].sort(), [0.25, 0.4, 0.6, 0.8]);
});

test('every genuine variant is Qt type 135 = 4-byte big-endian float32, finite', () => {
  let n = 0;
  for (const f of corpus()) for (const e of parseFcfgBytes(f.bytes).nodes) if (e.type === 'entry' && e.value.bytes) {
    assert.equal(e.value.typeId, 135); assert.equal(e.value.bytes.length, 8); assert.ok(Number.isFinite(e.value.value)); n++;
  }
  assert.equal(n, 5148);
});

/* ---------- round trip / exporter ---------- */
test('byte-exact round trip of all 33 genuine files', () => {
  const files = corpus(); assert.equal(files.length, 33);
  for (const f of files) assert.equal(Buffer.compare(Buffer.from(parseFcfgBytes(f.bytes).serializeBytes()), f.bytes), 0, `${f.dir}/${f.file}`);
});

test('encoder reproduces FlashPrint text for every one of the 5148 genuine variants and all plain values', () => {
  for (const f of corpus()) for (const n of parseFcfgBytes(f.bytes).nodes) if (n.type === 'entry') assert.equal(encodeValue(n.value), n.raw, `${f.file}:${n.key}`);
});

test('set() to the same value is a no-op; exporter output stays byte-identical', () => {
  const b = PLA(), d = parseFcfgBytes(b);
  assert.equal(d.set('General', 'layerHeight', 0.2), false);
  assert.equal(d.set('General', 'shellCnt', 2), false);
  assert.equal(d.set('General', 'vaseMode', false), false);
  assert.equal(Buffer.compare(Buffer.from(d.serializeBytes()), b), 0);
});

test('editing one value changes exactly that line', () => {
  const b = PLA(), d = parseFcfgBytes(b);
  assert.equal(d.set('General', 'layerHeight', 0.28), true);
  const a = dec(b).split('\r\n'), c = dec(d.serializeBytes()).split('\r\n');
  assert.equal(a.length, c.length);
  const diff = a.map((l, i) => [l, c[i]]).filter(([x, y]) => x !== y);
  assert.equal(diff.length, 1);
  assert.match(diff[0][0], /^layerHeight=/);
  const re = parseFcfg(d.serialize());
  assert.equal(re.get('General', 'layerHeight'), Math.fround(0.28));
});

test('editing booleans / ints / arrays / strings keeps their kind and formatting rules', () => {
  const d = parseFcfgBytes(PLA());
  d.set('General', 'vaseMode', true); d.set('General', 'fillPattern', 2);
  d.set('General', 'fanLayerSpeeds0', [[2, 2, 50], [3, 9999, 100]]); d.set('General', 'fanLayerSpeeds1', []);
  d.set('Custom', 'materialName1', 'Support, PVA');
  const r = parseFcfg(d.serialize());
  assert.equal(r.getRaw('General', 'vaseMode'), 'true');
  assert.equal(r.getRaw('General', 'fillPattern'), '2');
  assert.equal(r.getRaw('General', 'fanLayerSpeeds0'), '"[[2,2,50],[3,9999,100]]"');
  assert.equal(r.getRaw('General', 'fanLayerSpeeds1'), '[]');
  assert.equal(r.getRaw('Custom', 'materialName1'), '"Support, PVA"');
  assert.equal(r.get('Custom', 'materialName1'), 'Support, PVA');
});

test('changing nozzle size reproduces the genuine encodings for every nozzle', () => {
  for (const nz of [0.25, 0.4, 0.6, 0.8]) {
    const d = parseFcfgBytes(PLA()); d.set('Custom', 'nozzleSize', nz);
    const genuine = parseFcfgBytes(load(nz.toFixed(2) + 'mm', 'Flashforge-PLA.fcfg'));
    assert.equal(d.getRaw('Custom', 'nozzleSize'), genuine.getRaw('Custom', 'nozzleSize'), String(nz));
  }
});

test('setting a stored-float to a number encodes float32, never a guessed type', () => {
  const d = parseFcfgBytes(PLA()); d.set('General', 'travelSpeed', 123.4);
  assert.equal(d.getEntry('General', 'travelSpeed').value.typeId, 135);
  assert.equal(d.get('General', 'travelSpeed'), Math.fround(123.4));
});

test('a new setting needs an explicit type; existing unknown-type values need explicit replacement', () => {
  const d = parseFcfgBytes(PLA());
  assert.throws(() => d.set('General', 'brandNewKey', 1), FcfgParseError);
  assert.equal(d.set('General', 'brandNewKey', 1.5, { as: 'float32' }), true);
  assert.equal(parseFcfg(d.serialize()).get('General', 'brandNewKey'), 1.5);
  const t = parseFcfg('[General]\r\nx=@Variant(\\0\\0\\x3\\xe7\\x1\\x2)\r\n');
  assert.throws(() => t.set('General', 'x', 5), FcfgParseError);
});

test('remove() deletes only the named key', () => {
  const d = parseFcfgBytes(PLA()); assert.equal(d.remove('General', 'vaseMode'), true); assert.equal(d.remove('General', 'vaseMode'), false);
  assert.equal(parseFcfg(d.serialize()).has('General', 'vaseMode'), false);
  assert.equal(parseFcfg(d.serialize()).keys('General').length, 199);   // 200 -> 199 ([Custom] holds the other 7 of 207)
});

/* ---------- unknown setting preservation ---------- */
test('unknown settings, odd values, comments and unknown sections survive an edit untouched', () => {
  const src = [
    '[Custom]', 'machineId=33', 'futureThing=@Variant(\\0\\0\\x3\\xe7\\x1\\x2\\x3)', 'weird =  spaced value', '; a comment', '',
    '[General]', 'layerHeight=@Variant(\\0\\0\\0\\x87>L\\xcc\\xcd)', 'newArray="[[1,2],[3,4]]"', 'emptyOne=', 'newBool=true',
    'quotedStr="a;b"', 'unicode=Zażółć',
    '[FutureSection]', 'k=v', ''].join('\r\n');
  const d = parseFcfg(src);
  d.set('General', 'layerHeight', 0.3);
  const out = d.serialize().split('\r\n'), orig = src.split('\r\n');
  for (let i = 0; i < orig.length; i++) if (!orig[i].startsWith('layerHeight=')) assert.equal(out[i], orig[i]);
  assert.equal(d.getEntry('Custom', 'futureThing').value.kind, 'raw');
  assert.deepEqual(d.sections(), ['Custom', 'General', 'FutureSection']);
  assert.equal(d.get('General', 'unicode'), 'Zażółć');
});

test('unknown-key preservation on real files: inject unknown keys, edit, re-export, keys still there', () => {
  const d = parseFcfgBytes(PLA());
  d.set('General', 'someFutureSetting', 7, { as: 'float32' });
  d.set('General', 'layerHeight', 0.15);
  const r = parseFcfg(d.serialize());
  assert.equal(r.get('General', 'someFutureSetting'), 7);
  assert.equal(r.keys('General').length, 201);                          // 200 genuine + 1 injected
  for (const n of parseFcfgBytes(PLA()).nodes) if (n.type === 'entry' && n.key !== 'layerHeight') assert.equal(r.getRaw(n.section, n.key), n.raw, n.key);
});

/* ---------- structure & formatting edge cases ---------- */
test('line endings: LF, CRLF, mixed and missing final newline are preserved', () => {
  for (const src of ['[A]\nx=1\n', '[A]\r\nx=1\r\n', '[A]\r\nx=1\ny=2\r\n', '[A]\nx=1', '[A]\r\nx=1']) assert.equal(parseFcfg(src).serialize(), src);
  const d = parseFcfg('[A]\nx=1'); d.set('A', 'y', 2, { as: 'int' }); assert.equal(d.serialize(), '[A]\nx=1\ny=2\n');
});

test('empty values, multiple sections, duplicate sections and duplicate keys', () => {
  const d = parseFcfg('[A]\nk=\n[B]\nk=@Variant(\\0\\0\\0\\x87?\\x80\\0\\0)\n[A]\nj=2\nk=3\n');
  assert.equal(d.get('B', 'k'), 1); assert.deepEqual(d.sections(), ['A', 'B']);
  assert.equal(d.get('A', 'k'), 3);                                   // last wins, like QSettings
  assert.equal(d.serialize(), '[A]\nk=\n[B]\nk=@Variant(\\0\\0\\0\\x87?\\x80\\0\\0)\n[A]\nj=2\nk=3\n');
});

test('BOM and non-UTF-8 bytes round-trip', () => {
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('[A]\r\nx=1\r\n')]);
  assert.equal(Buffer.compare(Buffer.from(parseFcfgBytes(bom).serializeBytes()), bom), 0);
  const l1 = Buffer.from([...Buffer.from('[A]\r\nname='), 0xe9, 0x0d, 0x0a]);
  const d = parseFcfgBytes(l1); assert.equal(d.encoding, 'latin1');
  assert.equal(Buffer.compare(Buffer.from(d.serializeBytes()), l1), 0);
});

test('a document can be built from nothing', () => {
  const d = parseFcfg('', { strict: false });
  d.set('Custom', 'machineId', 33, { as: 'int' }); d.set('Custom', 'nozzleSize', 0.6, { as: 'float32' }); d.set('General', 'layerHeight', 0.2, { as: 'float32' });
  assert.equal(d.serialize(), '[Custom]\r\nmachineId=33\r\nnozzleSize=@Variant(\\0\\0\\0\\x87?\\x19\\x99\\x9a)\r\n[General]\r\nlayerHeight=@Variant(\\0\\0\\0\\x87>L\\xcc\\xcd)\r\n');
});

/* ---------- malformed files ---------- */
test('malformed input: strict mode throws with a line number', () => {
  const cases = {
    'garbage line': ['[A]\nthis is not a setting\n', /line 2/],
    'empty key': ['[A]\n=5\n', /line 2/],
    'unterminated section': ['[A\nx=1\n', /line 1/],
    'bad variant length': ['[A]\nx=@Variant(\\0\\0\\0\\x87>L)\n', /line 2.*x/],
    'bad escape': ['[A]\nx=@Variant(\\q)\n', /line 2/],
    'no sections': ['x=1\n', /section/],
    'not text at all': ['hello world', /line 1/],
  };
  for (const [name, [src, re]] of Object.entries(cases)) assert.throws(() => parseFcfg(src), (e) => e instanceof FcfgParseError && re.test(e.message), name);
});

test('malformed input: lenient mode keeps every byte and reports warnings', () => {
  const src = '[A]\ngarbage\nx=@Variant(\\0\\0\\0\\x87>L)\ny=1\n';
  const d = parseFcfg(src, { strict: false });
  assert.equal(d.serialize(), src); assert.equal(d.warnings.length, 2); assert.equal(d.get('A', 'y'), 1);
});

test('empty and whitespace-only input', () => {
  assert.throws(() => parseFcfg(''), FcfgParseError);
  assert.throws(() => parseFcfg('\r\n\r\n'), FcfgParseError);
  assert.equal(parseFcfg('', { strict: false }).serialize(), '');
});
