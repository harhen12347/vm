import { compareFCFGProfiles } from './printer-fcfg-profile.mjs';

export function nativeComparisonHTML(profiles, escapeHTML) {
  const result = compareFCFGProfiles(profiles);
  const identityKeys = ['machineId', 'nozzleSize', 'materialName0', 'materialName1', 'materialDensity0', 'materialDensity1'];
  const identity = identityKeys.map((key) => {
	const item = result.identity[key];
	return `<tr class="${item.equal ? '' : 'changed'}"><th>${escapeHTML(key)}</th><td>${escapeHTML(item.a ?? '—')}</td><td>${escapeHTML(item.b ?? '—')}</td></tr>`;
  }).join('');
  const changes = result.changed.map((item) => `<tr class="changed"><th>${escapeHTML(item.section)}.${escapeHTML(item.key)} <small>(${escapeHTML(item.category)})</small></th><td>${escapeHTML(item.a ?? '—')}</td><td>${escapeHTML(item.b ?? '—')}</td></tr>`);
  const additions = result.added.map((item) => `<tr class="changed"><th>${escapeHTML(item.section)}.${escapeHTML(item.key)} <small>(added)</small></th><td>—</td><td>${escapeHTML(item.value)}</td></tr>`);
  const removals = result.removed.map((item) => `<tr class="changed"><th>${escapeHTML(item.section)}.${escapeHTML(item.key)} <small>(removed)</small></th><td>${escapeHTML(item.value)}</td><td>—</td></tr>`);
  const differences = [...changes, ...additions, ...removals].join('');
  return `<div class="section-heading"><h2>Native FCFG comparison</h2></div><div class="panel" style="overflow:auto"><p class="small">Printer ID differs: ${result.printerDiffers ? 'yes' : 'no'} · Nozzle differs: ${result.nozzleDiffers ? 'yes' : 'no'} · Material differs: ${result.materialDiffers ? 'yes' : 'no'}</p><table class="compare-table"><thead><tr><th>Native field</th><th>${escapeHTML(profiles[0].name)}</th><th>${escapeHTML(profiles[1].name)}</th></tr></thead><tbody>${identity}${differences || '<tr><td colspan="3">No native FCFG differences.</td></tr>'}</tbody></table><p class="small muted">Float values use shortest float32 round-trip formatting. Unknown keys are included in changed, added, and removed rows.</p></div>`;
}
