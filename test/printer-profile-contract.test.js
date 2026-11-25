const test = require('node:test');
const assert = require('node:assert/strict');
const { createGXProfileHandoff, GX_PROFILE_HANDOFF_KEY, parseGXProfileHandoff } = require('../src/printer-profile-contract.mjs');

test('GX handoff shares only the versioned extracted settings contract', () => {
  const handoff = createGXProfileHandoff('part.gx', { 'Printer model': 'FlashForge Adventurer 5M' }, { Infill: 20 });
  assert.equal(GX_PROFILE_HANDOFF_KEY, 'aether-printer-profile-studio-gx-import-v1');
  assert.deepEqual(parseGXProfileHandoff(handoff), handoff);
  assert.throws(() => parseGXProfileHandoff({ ...handoff, version: 2 }), /not a supported/);
  assert.throws(() => parseGXProfileHandoff({ ...handoff, model: [] }), /missing its extracted settings/);
});
