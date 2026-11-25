import {
  FILAMENTS, NOZZLES, PRESET_TYPES, PRINTERS, SETTING_DEFAULTS, SETTING_GROUPS,
  applyPreset, canExportFCFG, compareFCFGProfiles, compareProfiles, createProfile, generateSettings, isValidAcceleration, parseProfile,
  profileFromGX, roundAcceleration, saveProfileCollection, loadProfileCollection, serializeProfile, validateProfile
} from './printer-config-core.mjs';
import { GX_PROFILE_HANDOFF_KEY, parseGXProfileHandoff } from './printer-profile-contract.mjs';
import { nativeComparisonHTML } from './printer-config-fcfg-compare.mjs';

const STORAGE_KEY = 'aether-printer-profile-studio-v1';
const content = document.querySelector('#content');
const statusBar = document.querySelector('#status');
const pageTitle = document.querySelector('#page-title');
const app = {
  page: 'dashboard',
  activeId: null,
  profiles: [],
  printers: [],
  filaments: {},
  editorTab: 'Quality',
  settingsSearch: '',
  compareIds: [],
  generatorExplanations: []
};

const pageNames = {
  dashboard: 'Dashboard', editor: 'Configuration editor', presets: 'Preset library',
  printers: 'Printer database', filaments: 'Filament database', compare: 'Compare profiles'
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function validateCurrent(profile) {
  return validateProfile(profile, printerFor(profile), { ...FILAMENTS, ...app.filaments });
}

function activeProfile() {
  return app.profiles.find((profile) => profile.id === app.activeId) || app.profiles[0] || null;
}

function persist() {
  try {
    saveProfileCollection(localStorage, STORAGE_KEY, {
      profiles: app.profiles, printers: app.printers, filaments: app.filaments, activeId: app.activeId
    });
  } catch (error) {
    notify(`Could not save profiles in this browser: ${error.message}`, true);
  }
}

function notify(message, error = false) {
  statusBar.textContent = message;
  statusBar.classList.toggle('error', error);
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => { statusBar.textContent = ''; }, 5000);
}

function allPrinters() {
  return [...PRINTERS, ...app.printers];
}

function printerFor(profile) {
  return allPrinters().find((printer) => printer.id === profile?.printerId);
}

function printerOptions(selected) {
  return allPrinters().map((printer) =>
    `<option value="${esc(printer.id)}" ${printer.id === selected ? 'selected' : ''}>${esc(printer.manufacturer)} ${esc(printer.model)}</option>`
  ).join('');
}

function filamentOptions(selected) {
  return Object.keys({ ...FILAMENTS, ...app.filaments }).map((name) =>
    `<option ${name === selected ? 'selected' : ''}>${esc(name)}</option>`
  ).join('');
}

function createNewProfile(preset = 'Balanced') {
  const printer = allPrinters()[0];
  const profile = createProfile({ printerId: printer.id, nozzle: 0.4, filament: 'PLA', name: `${printer.model} · PLA · ${preset}`, preset });
  app.profiles.unshift(profile);
  app.activeId = profile.id;
  persist();
  return profile;
}

function render() {
  pageTitle.textContent = pageNames[app.page];
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.page === app.page);
  });
  if (app.page === 'dashboard') renderDashboard();
  else if (app.page === 'editor') renderEditor();
  else if (app.page === 'presets') renderPresets();
  else if (app.page === 'printers') renderPrinters();
  else if (app.page === 'filaments') renderFilaments();
  else if (app.page === 'compare') renderCompare();
}

function renderDashboard() {
  const profile = activeProfile();
  const printer = printerFor(profile);
  content.innerHTML = `
    <div class="welcome"><div><h2>Make a profile that fits your printer.</h2><p>Build and keep editable starting profiles in this browser. Check all settings against your hardware and filament.</p></div>
      <button class="button primary" data-action="new">＋ Create configuration</button></div>
    <div class="grid cards-4">
      <article class="stat-card"><span>MY PROFILES</span><b>${app.profiles.length}</b><span>Saved on this device</span></article>
      <article class="stat-card"><span>PRINTERS</span><b>${allPrinters().length}</b><span>Included and custom profiles</span></article>
      <article class="stat-card"><span>FILAMENTS</span><b>${Object.keys({ ...FILAMENTS, ...app.filaments }).length}</b><span>General starting ranges</span></article>
      <article class="stat-card"><span>ACTIVE PRINTER</span><b class="small">${esc(printer ? printer.model : 'None selected')}</b><span>${esc(profile ? `${profile.nozzle} mm nozzle · ${profile.filament} · ${profile.name}` : 'Create a profile to begin')}</span></article>
    </div>
    <div class="section-heading"><h2>Current configuration</h2>${profile ? '<button class="button" data-action="edit">Open editor →</button>' : ''}</div>
    ${profile ? `<div class="panel">
      <div class="selector-grid">
        <div class="field"><label for="dash-printer">Printer</label><select id="dash-printer">${printerOptions(profile.printerId)}</select></div>
        <div class="field"><label for="dash-nozzle">Nozzle diameter</label><select id="dash-nozzle">${nozzleOptions(profile, printer)}</select></div>
        <div class="field"><label for="dash-filament">Filament</label><select id="dash-filament">${filamentOptions(profile.filament)}</select></div>
      </div>
      <div class="section-heading"><h2>${esc(profile.name)}</h2><div class="toolbar">
        <button class="button" data-action="rename">Rename</button><button class="button" data-action="duplicate">Duplicate</button>
        <button class="button" data-action="export-json">Download JSON</button><button class="button danger" data-action="delete">Delete</button>
      </div></div>
      ${validationHTML(profile)}
      <p class="small muted">Printer facts are marked verified only when a source is recorded. Recommendations are starting points, not guaranteed manufacturer settings.</p>
    </div>` : '<div class="panel empty">No saved profile yet. Create a configuration to get started.</div>'}
    <div class="section-heading"><h2>My configurations</h2><button class="button" data-page="presets">Explore preset library →</button></div>
    <div class="panel">${app.profiles.length ? app.profiles.map(profileRow).join('') : '<div class="empty">Your saved configurations will appear here.</div>'}</div>
    <div class="section-heading"><h2>Format support</h2></div>
    <div class="info-box">Generic JSON, CSV, TXT, INI, and CFG import/export are supported. Imported FCFG files retain a parsed native document; only edited, mapped values change during export, while unrecognized keys and raw bytes are preserved. Round-trips byte-exact with 33 genuine files; not yet tested in FlashPrint itself. New FCFG settings are never guessed. OrcaSlicer, Cura, PrusaSlicer, and Bambu Studio native exports are not implemented.</div>`;
}

function nozzleOptions(profile, printer) {
  const options = NOZZLES;
  const known = printer?.nozzleDiameters;
  const hasVerifiedNozzles = printer?.verified?.includes('nozzleDiameters');
  return options.map((nozzle) => {
    const listed = known?.includes(nozzle);
    const qualifier = hasVerifiedNozzles && !listed ? ' · not listed'
      : !hasVerifiedNozzles ? ' · unverified' : '';
    const label = `${nozzle.toFixed(nozzle % 1 ? 2 : 1).replace(/0+$/, '').replace(/\.$/, '')} mm${qualifier}`;
    return `<option value="${nozzle}" ${Number(profile.nozzle) === nozzle ? 'selected' : ''}>${label}</option>`;
  }).join('');
}

function profileRow(profile) {
  const printer = printerFor(profile);
  return `<div class="profile-row"><div class="profile-info"><b>${esc(profile.name)}</b><small>${esc(printer?.model || 'Custom printer')} · ${esc(profile.nozzle)} mm · ${esc(profile.filament)} · ${esc(profile.preset)}</small></div>
    <div class="row-actions"><button data-action="select-profile" data-id="${esc(profile.id)}">Select</button><button data-action="rename" data-id="${esc(profile.id)}">Rename</button><button data-action="duplicate" data-id="${esc(profile.id)}">Duplicate</button><button data-action="export-json" data-id="${esc(profile.id)}">JSON</button><button data-action="delete" data-id="${esc(profile.id)}">Delete</button></div></div>`;
}

function validationHTML(profile) {
  const result = validateCurrent(profile);
  if (!result.errors.length && !result.warnings.length) return '<div class="info-box">No validation issues found. This does not certify printer or slicer compatibility.</div>';
  return `${result.errors.length ? `<div class="warning-box"><b>Errors — fix before exporting</b><ul>${result.errors.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></div>` : ''}
    ${result.warnings.length ? `<div class="warning-box"><b>Warnings — verify before printing or exporting</b><ul>${result.warnings.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></div>` : ''}`;
}

function settingDefinitions(tab, settings) {
  const definitions = { ...(SETTING_GROUPS[tab] || {}) };
  if (tab === 'Speed') {
    for (const key of Object.keys(settings)) {
      if (/acceleration/i.test(key) && !definitions[key]) {
        definitions[key] = { label: key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase()), min: 10, max: 100000, step: 10, unit: 'mm/s²', explanation: 'Imported acceleration setting. Values must be multiples of 10; verify this field against the printer firmware.' };
      }
    }
  }
  return definitions;
}

function sourceDataHTML(profile) {
  if (!profile.sourceData) return '';
  if (profile.sourceData.format === 'FlashPrint FCFG' && canExportFCFG(profile)) {
    const metadata = profile.sourceData.fcfg;
    const preserved = metadata.document.nodes.filter((node) => node.type === 'entry').length;
    return '<div class="info-box"><b>Imported FlashPrint FCFG template</b><p>Machine ID ' + esc(metadata.nativeMachineId ?? '(missing)') + ' and ' + preserved + ' native fields are preserved. Mapped settings can be edited; unknown fields remain untouched. Studio printer/material selections do not rewrite native machine/material IDs because no verified mapping is assumed. Round-trips byte-exact with 33 genuine files; not yet tested in FlashPrint itself.</p><details><summary>Review preserved native metadata</summary><pre>' + esc(JSON.stringify({ machineId: metadata.nativeMachineId, profileName: metadata.nativeProfileName, materialName: metadata.nativeMaterialName, nozzleSize: metadata.nativeNozzleSize, inferredFilament: metadata.filamentWasInferred ? profile.filament : null }, null, 2)) + '</pre></details></div>';
  }
  if (profile.sourceData.format !== 'GX extracted settings') return '';
  const missing = profile.sourceData.missing || [];
  const source = JSON.stringify({ printer: profile.sourceData.printer, model: profile.sourceData.model }, null, 2);
  return '<div class="info-box"><b>GX source data from ' + esc(profile.sourceData.sourceName || 'unknown file') + '</b><p>Only values shown below were extracted. Other profile values are generic starting points, not values recovered from the GX file. ' +
    (missing.length ? missing.length + ' expected source fields were not present: ' + esc(missing.join(', ')) + '.' : 'The mapped source fields were found.') +
    '</p><details><summary>Review extracted fields</summary><pre>' + esc(source) + '</pre></details></div>';
}

function renderEditor() {
  let profile = activeProfile();
  if (!profile) profile = createNewProfile();
  const printer = printerFor(profile);
  const validation = validateCurrent(profile);
  const definitions = settingDefinitions(app.editorTab, profile.settings);
  const search = app.settingsSearch.toLowerCase();
  const rows = Object.entries(definitions).filter(([key, definition]) =>
    !search || key.toLowerCase().includes(search) || definition.label.toLowerCase().includes(search) || definition.explanation.toLowerCase().includes(search)
  ).map(([key, definition]) => settingCard(key, definition, profile.settings[key])).join('');

  content.innerHTML = `
    <div class="welcome"><div><h2>Configuration editor</h2><p>Each value is editable, validated, and individually resettable or regeneratable.</p></div>
      <div class="toolbar"><button class="button" data-action="reset-all">Reset settings</button><button class="button" data-action="duplicate">Duplicate</button><button class="button primary" data-action="export-json">Export JSON</button></div></div>
    <div class="panel">
      <div class="selector-grid">
        <div class="field"><label for="edit-name">Profile name</label><input id="edit-name" type="text" maxlength="100" value="${esc(profile.name)}"></div>
        <div class="field"><label for="edit-printer">Printer</label><select id="edit-printer">${printerOptions(profile.printerId)}</select></div>
        <div class="field"><label for="edit-nozzle">Nozzle diameter</label><select id="edit-nozzle">${nozzleOptions(profile, printer)}</select></div>
        <div class="field"><label for="edit-filament">Filament</label><select id="edit-filament">${filamentOptions(profile.filament)}</select></div>
        <div class="field"><label for="edit-preset">Starting preset</label><select id="edit-preset">${PRESET_TYPES.map((preset) => `<option ${profile.preset === preset ? 'selected' : ''}>${esc(preset)}</option>`).join('')}</select><small>Selecting applies the complete preset settings.</small></div>
        <div class="field"><label for="settings-search">Search settings</label><input id="settings-search" type="search" placeholder="Search label or explanation…" value="${esc(app.settingsSearch)}"></div>
      </div>
    </div>
    <div class="section-heading"><h2>Generate starting configuration</h2><span class="small muted">Regenerate any one setting below without changing the others.</span></div>
    <div class="panel">
      <div class="quality-controls">
        ${['quality', 'speed', 'strength'].map((key) => `<div class="field"><label for="generator-${key}">${key[0].toUpperCase()}${key.slice(1)} <span id="${key}-value">50</span>%</label><input id="generator-${key}" type="range" min="0" max="100" value="50"></div>`).join('')}
      </div>
      <div class="toolbar" style="margin-top:14px"><button class="button primary" data-action="generate">Generate configuration</button></div>
      <div class="small muted" style="margin-top:10px">Generated values are generic starting points. Printer movement limits are unknown unless verified in the database.</div>
      ${app.generatorExplanations.length ? `<div class="info-box"><b>Why these settings were chosen</b><ul>${app.generatorExplanations.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></div>` : ''}
    </div>
    ${sourceDataHTML(profile)}
    ${validationHTML(profile)}
    <div class="tabs">${Object.keys(SETTING_GROUPS).map((tab) => `<button class="tab-button ${tab === app.editorTab ? 'active' : ''}" data-tab="${esc(tab)}">${esc(tab)}</button>`).join('')}</div>
    <div class="setting-grid">${rows || '<div class="panel empty">No settings match this search in the selected category.</div>'}</div>
    <div class="section-heading"><h2>Save or export</h2></div>
    <div class="panel toolbar"><select id="export-format" aria-label="Export format"><option value="json">Generic JSON</option><option value="csv">Generic CSV</option><option value="txt">Generic TXT</option><option value="ini">Generic INI</option><option value="cfg">Generic CFG</option><option value="fcfg" ${canExportFCFG(profile) ? '' : 'disabled'}>FlashPrint FCFG ${canExportFCFG(profile) ? '(imported template)' : '(import a template first)'}</option></select>
      <button class="button" data-action="download">Download configuration</button><button class="button" data-action="copy">Copy configuration</button>
      <span class="small muted">FCFG preserves the imported template; FlashPrint compatibility is not verified.</span></div>`;
}

function settingCard(key, definition, value) {
  let control;
  if (definition.type === 'checkbox') {
    control = '<input type="checkbox" data-setting="' + esc(key) + '" ' + (value === true ? 'checked' : '') + ' aria-label="' + esc(definition.label) + '">';
  } else if (definition.type === 'select') {
    control = '<select data-setting="' + esc(key) + '" aria-label="' + esc(definition.label) + '">' + definition.options.map((option) => '<option ' + (value === option ? 'selected' : '') + '>' + esc(option) + '</option>').join('') + '</select>';
  } else {
    control = '<input type="number" data-setting="' + esc(key) + '" value="' + (value === undefined ? '' : esc(value)) + '" min="' + definition.min + '" max="' + definition.max + '" step="' + definition.step + '" aria-label="' + esc(definition.label) + '" ' + (/acceleration/i.test(key) && !isValidAcceleration(value) ? 'aria-invalid="true"' : '') + '>';
  }
  const known = Object.values(SETTING_GROUPS).some((group) => Object.hasOwn(group, key));
  const isAcceleration = /acceleration/i.test(key);
  const accelerationError = isAcceleration && !isValidAcceleration(value);
  const actions = (known ? '<button data-action="reset-setting" data-key="' + esc(key) + '">Reset</button><button data-action="regenerate-setting" data-key="' + esc(key) + '">Regenerate</button>' : '') +
    (isAcceleration ? '<button data-action="round-acceleration" data-key="' + esc(key) + '" ' + (accelerationError ? '' : 'hidden') + '>Round to nearest 10</button>' : '');
  const validation = isAcceleration ? '<div class="setting-validation" data-validation-for="' + esc(key) + '" aria-live="polite">' + (accelerationError ? 'Use a finite value from 10 to 100000 in increments of 10.' : '') + '</div>' : '';
  return '<article class="setting-card"><div><label>' + esc(definition.label) + '</label><small class="setting-help">' + esc(definition.explanation) + '</small></div>' +
    '<div class="control">' + control + (definition.unit ? '<span class="unit">' + esc(definition.unit) + '</span>' : '') + '</div>' +
    '<div class="setting-actions">' + actions + '</div>' + validation + '</article>';
}

function renderPresets() {
  const profile = activeProfile();
  const target = profile || createProfile();
  content.innerHTML = `
    <div class="welcome"><div><h2>Preset library</h2><p>Each preset generates a complete settings set for the selected printer, nozzle, and filament.</p></div>
      <button class="button primary" data-action="new">＋ Create configuration</button></div>
    <div class="panel"><div class="selector-grid"><div class="field"><label>Selected profile</label><select id="preset-profile">${app.profiles.map((item) => `<option value="${esc(item.id)}" ${item.id === target.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Printer</label><select id="preset-printer">${printerOptions(target.printerId)}</select></div>
      <div class="field"><label>Nozzle</label><select id="preset-nozzle">${nozzleOptions(target, printerFor(target))}</select></div>
      <div class="field"><label>Filament</label><select id="preset-filament">${filamentOptions(target.filament)}</select></div></div>
      <p class="small muted">Selecting a preset creates and saves a new profile with the complete preset settings. The existing profile is not overwritten.</p></div>
    <div class="grid cards-3" style="margin-top:14px">${PRESET_TYPES.map((preset) => `<article class="panel preset-card"><h3>${esc(preset)}</h3><p>${esc(presetDescription(preset))}<br><br>Adjusts layer height, speeds, walls, infill, and strength using the current nozzle and printer class. Values are generic starting points, not verified machine profiles.</p><button class="button" data-action="create-preset" data-preset="${esc(preset)}">Create ${esc(preset)} profile</button></article>`).join('')}</div>
    <div class="info-box">The current Printer Studio does not serialize native FlashPrint/Orca/Cura/Prusa/Bambu profiles. Export generic JSON for conversion in a supported slicer.</div>`;
}

function presetDescription(preset) {
  return ({
    Draft: 'Uses coarse layers and faster movement for quick prototypes.',
    Balanced: 'A practical starting point balancing detail, print time, and strength.',
    Quality: 'Prioritizes surface finish with reduced layer height and motion.',
    'High Quality': 'Uses finer layers and slower movement than Quality for added surface detail.',
    Fast: 'Increases layer height and movement rates for quicker prints.',
    Strong: 'Adds perimeter walls, top/bottom layers, and infill.',
    Custom: 'Keeps the current settings unchanged so you can create a custom profile.',
    'Fine Detail': 'Uses small layers and slower movement for detail work.',
    Lightweight: 'Reduces infill and shell count to conserve material.',
    'Functional Parts': 'Favors more walls and infill for practical part strength.'
  })[preset];
}

function renderPrinters() {
  const rows = allPrinters().map((printer) => {
    const volume = printer.buildVolume ? `${printer.buildVolume.x} × ${printer.buildVolume.y} × ${printer.buildVolume.z} mm` : 'Not verified';
    const verifiedNozzles = printer.verified?.includes('nozzleDiameters') ? printer.nozzleDiameters.join(', ') + ' mm (profile)' : 'Not verified';
    const maxTemp = printer.maxNozzleTemperature ?? 'Not verified';
    const maxBed = printer.maxBedTemperature ?? 'Not verified';
    const materials = printer.supportedMaterials?.length ? printer.supportedMaterials.join(', ') : 'Not verified';
    const verified = printer.verified || [];
    return `<tr><td><b>${esc(printer.manufacturer)} ${esc(printer.model)}</b>${printer.source ? `<br><a class="small" href="${esc(printer.source)}" target="_blank" rel="noreferrer">Source profile ↗</a>` : '<br><span class="unverified small">User-supplied</span>'}</td>
      <td class="${verified.includes('buildVolume') ? 'verified' : 'unverified'}">${esc(volume)}</td><td class="${verified.includes('nozzleDiameters') ? 'verified' : 'unverified'}">${esc(verifiedNozzles)}</td>
      <td class="unverified">${esc(maxTemp)} / ${esc(maxBed)} °C</td><td class="unverified">${esc(materials)}</td><td class="${verified.includes('technology') ? 'verified' : 'unverified'}">${esc(printer.technology || 'Not verified')}</td></tr>`;
  }).join('');
  content.innerHTML = `<div class="welcome"><div><h2>Printer database</h2><p>Unknown facts stay explicitly unknown. Verify all specs against the exact machine revision and manufacturer documentation.</p></div><button class="button primary" data-action="add-printer">＋ Add custom printer</button></div>
    <div class="info-box">The Adventurer 5M and 5M Pro build dimensions and nozzle sizes below are from the bundled FlashForge Orca profiles. Max temperatures and supported materials were not provided in those records. The other catalog models are listed as requested; their technical specifications are unverified.</div>
    <div class="panel" style="overflow:auto"><table class="database-table"><thead><tr><th>Printer</th><th>Build volume (X × Y × Z)</th><th>Nozzle options</th><th>Max nozzle / bed temp</th><th>Supported materials</th><th>Technology</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderFilaments() {
  const records = { ...FILAMENTS, ...app.filaments };
  const rows = Object.entries(records).map(([name, data]) =>
    `<tr><td><b>${esc(name)}</b>${app.filaments[name] ? '<br><span class="unverified small">Custom profile</span>' : '<br><span class="unverified small">General, non-manufacturer-specific starting range</span>'}</td>
      <td>${data.nozzle[0]}–${data.nozzle[1]} °C</td><td>${data.bed[0]}–${data.bed[1]} °C</td><td>${data.speed[0]}–${data.speed[1]} mm/s</td>
      <td>${esc(data.cooling)}<br><span class="muted">Retraction ${data.retraction[0]}–${data.retraction[1]} mm</span></td><td>${esc(data.enclosure)}<br><span class="muted">${esc(data.drying)}</span></td></tr>`
  ).join('');
  content.innerHTML = `<div class="welcome"><div><h2>Filament database</h2><p>Temperature and speed ranges are generic starting references, not manufacturer guarantees. Follow the exact spool label and data sheet.</p></div><button class="button primary" data-action="add-filament">＋ Add custom filament</button></div>
    <div class="panel" style="overflow:auto"><table class="database-table"><thead><tr><th>Material</th><th>Nozzle range</th><th>Bed range</th><th>Typical speed</th><th>Cooling / retraction</th><th>Enclosure / drying</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderCompare() {
  content.innerHTML = `<div class="welcome"><div><h2>Compare configurations</h2><p>Choose two or more saved profiles to highlight settings that differ.</p></div></div>
    <div class="panel"><div class="compare-controls">${app.profiles.map((profile) => `<label class="compare-item"><input type="checkbox" data-compare="${esc(profile.id)}" ${app.compareIds.includes(profile.id) ? 'checked' : ''}>${esc(profile.name)}</label>`).join('') || '<span class="muted small">Create profiles first to compare them.</span>'}</div></div>
    ${comparisonContent()}`;
}

function comparisonContent() {
  const profiles = app.compareIds.map((id) => app.profiles.find((profile) => profile.id === id)).filter(Boolean);
  if (profiles.length < 2) return '<div class="panel empty" style="margin-top:14px">Select at least two profiles. Material usage and print time cannot be estimated without model geometry and slicer calculations.</div>';
  const rows = compareProfiles(profiles);
  const labels = rows.map((row) => `<tr class="${row.changed ? 'changed' : ''}"><th>${esc(row.label)}</th>${row.values.map((value) => `<td>${esc(value)}</td>`).join('')}</tr>`).join('');
  const native = profiles.slice(0, 2).every(canExportFCFG) ? nativeComparisonHTML(profiles.slice(0, 2), esc) : '';
  return `<div class="panel" style="margin-top:14px;overflow:auto"><table class="compare-table"><thead><tr><th>Setting</th>${profiles.map((profile) => `<th>${esc(profile.name)}</th>`).join('')}</tr></thead><tbody>${labels || '<tr><td colspan="3">No differences in shared settings.</td></tr>'}</tbody></table>
    <p class="small muted" style="margin-bottom:0">Temperature, speed, layer height, and strength-related settings are shown together; differing rows are highlighted. Material and time estimates require a model and actual slicer.</p></div>${native}`;
}

function defaultFor(profile, key) {
  if (key === 'layerHeight' || key === 'initialLayerHeight') return Math.round(Number(profile.nozzle) * 0.5 * 100) / 100;
  if (key === 'lineWidth') return Number(profile.nozzle);
  const ranges = app.filaments[profile.filament] || FILAMENTS[profile.filament] || FILAMENTS.PLA;
  if (key === 'nozzleTemperature' || key === 'initialNozzleTemperature') return Math.round((ranges.nozzle[0] + ranges.nozzle[1]) / 2);
  if (key === 'bedTemperature' || key === 'initialBedTemperature') return Math.round((ranges.bed[0] + ranges.bed[1]) / 2);
  if (key === 'retractionDistance') return Number(((ranges.retraction[0] + ranges.retraction[1]) / 2).toFixed(1));
  return SETTING_DEFAULTS[key];
}

function regenerateValue(profile, key) {
  const definition = Object.values(SETTING_GROUPS).flatMap((group) => Object.entries(group)).find(([name]) => name === key)?.[1];
  const current = profile.settings[key];
  if (!definition) return current;
  if (definition.type === 'checkbox') return !current;
  if (definition.type === 'select') {
    const index = definition.options.indexOf(current);
    return definition.options[(index + 1) % definition.options.length];
  }
  const min = definition.min;
  const max = definition.max;
  const step = definition.step;
  const base = Number.isFinite(Number(current)) ? Number(current) : defaultFor(profile, key);
  const delta = Math.max(step, (max - min) * 0.1);
  const next = Math.max(min, Math.min(max, base + (base + delta <= max ? delta : -delta)));
  return Number((Math.round(next / step) * step).toFixed(String(step).split('.')[1]?.length || 0));
}

function saveAndRenderEditor(message) {
  persist();
  render();
  if (message) notify(message);
}

function selectProfile(id) {
  if (!app.profiles.some((profile) => profile.id === id)) return;
  app.activeId = id;
  persist();
}

function profileForAction(button) {
  return app.profiles.find((profile) => profile.id === button.dataset.id) || activeProfile();
}

function download(profile, format) {
  const validation = validateCurrent(profile);
  if (validation.errors.length) {
    notify(`Export blocked: ${validation.errors[0]}`, true);
    return;
  }
  if (validation.warnings.length && !window.confirm(`Warnings:\n${validation.warnings.join('\n')}\n\nExport this generic configuration anyway?`)) return;
  const output = serializeProfile(profile, format);
  const blob = new Blob([output], { type: format === 'json' ? 'application/json' : 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${profile.name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'printer-profile'}.${format}`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify(format === 'fcfg'
    ? 'Downloaded template-backed FCFG. Import it into FlashPrint and verify machine compatibility; this export is not FlashPrint-tested.'
    : `Downloaded generic ${format.toUpperCase()} profile. It is not a slicer-native file.`);
}

async function copyProfile(profile, format) {
  const validation = validateCurrent(profile);
  if (validation.errors.length) {
    notify('Copy blocked: ' + validation.errors[0], true);
    return;
  }
  if (validation.warnings.length && !window.confirm('Warnings:\n' + validation.warnings.join('\n') + '\n\nCopy this generic configuration anyway?')) return;
  try {
    const output = serializeProfile(profile, format);
    const text = output instanceof Uint8Array ? new TextDecoder().decode(output) : output;
    await navigator.clipboard.writeText(text);
    notify(`Generic ${format.toUpperCase()} profile copied.`);
  } catch (error) {
    notify(`Clipboard access failed: ${error.message}. Use the download option instead.`, true);
  }
}

function changePrinter(profile, printerId) {
  profile.printerId = printerId;
  const printer = printerFor(profile);
  if (printer?.verified?.includes('nozzleDiameters') && !printer.nozzleDiameters.includes(Number(profile.nozzle))) {
    notify(`Nozzle ${profile.nozzle} mm is not listed for this printer. Select a listed size or verify compatibility.`);
  } else if (!printer?.verified?.includes('nozzleDiameters')) {
    notify('Printer changed. Existing print settings were preserved; nozzle compatibility and printer limits are unverified.');
  } else notify('Printer changed. Existing print settings were preserved; verify printer limits.');
  persist();
}

function changeNozzle(profile, nozzle) {
  profile.nozzle = Number(nozzle);
  profile.settings.lineWidth = Number(nozzle);
  profile.settings.layerHeight = Math.round(Number(nozzle) * 0.5 * 100) / 100;
  profile.settings.initialLayerHeight = profile.settings.layerHeight;
  persist();
  notify('Nozzle changed. Line width and layer heights were updated; other settings were preserved.');
}

function changeFilament(profile, filament) {
  profile.filament = filament;
  const data = app.filaments[filament] || FILAMENTS[filament] || FILAMENTS.PLA;
  profile.settings.nozzleTemperature = Math.round((data.nozzle[0] + data.nozzle[1]) / 2);
  profile.settings.initialNozzleTemperature = profile.settings.nozzleTemperature;
  profile.settings.bedTemperature = Math.round((data.bed[0] + data.bed[1]) / 2);
  profile.settings.initialBedTemperature = profile.settings.bedTemperature;
  profile.settings.retractionDistance = Number(((data.retraction[0] + data.retraction[1]) / 2).toFixed(1));
  persist();
  notify('Filament changed. Its generic temperature and retraction starting points were applied.');
}

function createPresetProfile(preset) {
  const selected = app.profiles.find((profile) => profile.id === document.querySelector('#preset-profile')?.value) || activeProfile();
  const printerId = document.querySelector('#preset-printer')?.value || selected?.printerId || PRINTERS[0].id;
  const nozzle = Number(document.querySelector('#preset-nozzle')?.value || selected?.nozzle || 0.4);
  const filament = document.querySelector('#preset-filament')?.value || selected?.filament || 'PLA';
  const printer = allPrinters().find((item) => item.id === printerId);
  const profile = createProfile({
    printerId, nozzle, filament,
    name: `${printer?.model || 'Custom printer'} · ${filament} · ${preset}`,
    preset
  });
  const customFilament = app.filaments[filament];
  if (customFilament) {
    profile.settings.nozzleTemperature = Math.round((customFilament.nozzle[0] + customFilament.nozzle[1]) / 2);
    profile.settings.initialNozzleTemperature = profile.settings.nozzleTemperature;
    profile.settings.bedTemperature = Math.round((customFilament.bed[0] + customFilament.bed[1]) / 2);
    profile.settings.initialBedTemperature = profile.settings.bedTemperature;
    profile.settings.retractionDistance = Number(((customFilament.retraction[0] + customFilament.retraction[1]) / 2).toFixed(1));
  }
  app.profiles.unshift(profile);
  app.activeId = profile.id;
  persist();
  app.page = 'editor';
  render();
  notify(`${preset} preset created with complete settings.`);
}

function addCustomPrinter() {
  const manufacturer = window.prompt('Manufacturer name:')?.trim();
  if (!manufacturer) return;
  const model = window.prompt('Printer model:')?.trim();
  if (!model) return;
  const volumeText = window.prompt('Build volume X,Y,Z in mm (leave blank if unknown):')?.trim() || '';
  let buildVolume = null;
  if (volumeText) {
    const values = volumeText.split(',').map(Number);
    if (values.length !== 3 || values.some((value) => !Number.isFinite(value) || value <= 0)) {
      notify('Build volume must be three positive numbers separated by commas.', true);
      return;
    }
    buildVolume = { x: values[0], y: values[1], z: values[2] };
  }
  const nozzleText = window.prompt('Supported nozzle diameters in mm (comma separated; optional):', '0.4,0.6') || '';
  const nozzleDiameters = nozzleText ? nozzleText.split(',').map(Number) : [];
  if (nozzleDiameters.some((value) => !NOZZLES.includes(value))) {
    notify('Nozzle options must be selected from 0.2, 0.25, 0.4, 0.6, 0.8, or 1.0 mm.', true);
    return;
  }
  const optionalLimit = (label) => {
    const raw = window.prompt(`${label} °C (leave blank if unknown):`)?.trim();
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive number or blank.`);
    return value;
  };
  let maxNozzleTemperature;
  let maxBedTemperature;
  try {
    maxNozzleTemperature = optionalLimit('Maximum nozzle temperature');
    maxBedTemperature = optionalLimit('Maximum bed temperature');
  } catch (error) {
    notify(error.message, true);
    return;
  }
  const supportedMaterials = (window.prompt('Supported materials (comma separated; optional):') || '')
    .split(',').map((material) => material.trim()).filter(Boolean);
  const technology = window.prompt('Printing technology (for example FFF; leave blank if unknown):')?.trim() || null;
  const id = `custom-${Date.now()}`;
  app.printers.push({ id, manufacturer, model, buildVolume, nozzleDiameters, maxNozzleTemperature, maxBedTemperature, supportedMaterials, technology, verified: [], source: null });
  persist();
  render();
  notify(`${manufacturer} ${model} added. Specs are user-supplied and unverified.`);
}

function addCustomFilament() {
  const name = window.prompt('Custom filament name:')?.trim();
  if (!name) return;
  const askRange = (promptText, initial) => {
    const value = window.prompt(promptText, initial)?.trim();
    if (value === undefined || value === null || !value) return null;
    const range = value.split(',').map(Number);
    return range.length === 2 && range.every(Number.isFinite) && range[0] <= range[1] ? range : null;
  };
  const nozzle = askRange('Nozzle range °C (min,max):', '200,220');
  const bed = askRange('Bed range °C (min,max):', '40,60');
  if (!nozzle || !bed) { notify('Temperature ranges need two numbers in ascending order.', true); return; }
  const retraction = askRange('Retraction distance range mm (min,max):', '0.5,1.5');
  const speed = askRange('Typical speed range mm/s (min,max):', '20,60');
  if (!retraction || !speed) { notify('Retraction and speed ranges need two numbers in ascending order.', true); return; }
  const cooling = window.prompt('Cooling recommendation:')?.trim();
  const enclosure = window.prompt('Enclosure requirements:')?.trim();
  const drying = window.prompt('Drying recommendation:')?.trim();
  if (!cooling || !enclosure || !drying) { notify('Cooling, enclosure, and drying recommendations are required.', true); return; }
  app.filaments[name] = {
    nozzle, bed, cooling, retraction, speed, enclosure, drying
  };
  persist();
  render();
  notify(`${name} added. The profile is user-supplied, not manufacturer-verified.`);
}

async function importFile(file) {
  if (!file) return;
  try {
    const ext = file.name.split('.').pop()?.toLowerCase();
    const input = ext === 'fcfg' ? new Uint8Array(await file.arrayBuffer()) : await file.text();
    const profile = parseProfile(input, ext, file.name.replace(/\.[^.]+$/, ''));
    if (profile.sourceData?.format === 'FlashPrint FCFG' && !allPrinters().some((printer) => printer.id === profile.printerId)) {
      app.printers.push({
        id: profile.printerId, manufacturer: 'FlashPrint',
        model: 'Unidentified machine (FCFG ID ' + (profile.sourceData.fcfg.nativeMachineId ?? 'unknown') + ')',
        buildVolume: null, nozzleDiameters: [], maxNozzleTemperature: null, maxBedTemperature: null,
        supportedMaterials: [], technology: null, verified: [], source: null
      });
    }
    app.profiles.unshift(profile);
    app.activeId = profile.id;
    persist();
    app.page = 'editor';
    render();
    const validation = validateCurrent(profile);
    notify(validation.errors.length ? `Imported profile; ${validation.errors.length} required settings need attention.` : 'Profile imported. Verify its warnings before exporting or printing.');
  } catch (error) {
    notify(`Could not import profile: ${error.message}`, true);
  }
}

document.querySelector('#navigation').addEventListener('click', (event) => {
  const button = event.target.closest('[data-page]');
  if (!button) return;
  app.page = button.dataset.page;
  render();
});

document.querySelector('#theme-toggle').addEventListener('click', () => {
  document.body.classList.toggle('light');
  try { localStorage.setItem(`${STORAGE_KEY}-theme`, document.body.classList.contains('light') ? 'light' : 'dark'); }
  catch (error) { notify(`Could not save theme preference: ${error.message}`, true); }
});

document.querySelector('#import-file').addEventListener('change', (event) => {
  void importFile(event.target.files?.[0]);
  event.target.value = '';
});

content.addEventListener('input', (event) => {
  if (event.target.matches('[data-setting]') && /acceleration/i.test(event.target.dataset.setting)) {
    const input = event.target;
    const profile = activeProfile();
    const key = input.dataset.setting;
    if (profile) { profile.settings[key] = input.value === '' ? '' : Number(input.value); persist(); }
    const valid = isValidAcceleration(input.value);
    input.setAttribute('aria-invalid', String(!valid));
    const card = input.closest('.setting-card');
    const message = card.querySelector('[data-validation-for]');
    if (message) message.textContent = valid ? '' : 'Use a finite value from 10 to 100000 in increments of 10.';
    const correction = card.querySelector('[data-action="round-acceleration"]');
    if (correction) correction.hidden = valid;
  }
  if (event.target.id === 'settings-search') {
    app.settingsSearch = event.target.value;
    const input = event.target;
    const start = input.selectionStart;
    renderEditor();
    const next = document.querySelector('#settings-search');
    next.focus();
    next.setSelectionRange(start, start);
  }
  if (event.target.matches('#generator-quality, #generator-speed, #generator-strength')) {
    const key = event.target.id.replace('generator-', '');
    document.querySelector(`#${key}-value`).textContent = event.target.value;
  }
});

content.addEventListener('change', (event) => {
  const target = event.target;
  const profile = activeProfile();
  if (target.matches('[data-setting]') && profile) {
    const key = target.dataset.setting;
    const def = Object.values(SETTING_GROUPS).flatMap((group) => Object.entries(group)).find(([name]) => name === key)?.[1];
    profile.settings[key] = def?.type === 'checkbox' ? target.checked : def?.type === 'select' ? target.value : target.value === '' ? '' : Number(target.value);
    persist();
    renderEditor();
  } else if ((target.id === 'dash-printer' || target.id === 'edit-printer') && profile) {
    changePrinter(profile, target.value);
    render();
  } else if ((target.id === 'dash-nozzle' || target.id === 'edit-nozzle') && profile) {
    changeNozzle(profile, target.value);
    render();
  } else if ((target.id === 'dash-filament' || target.id === 'edit-filament') && profile) {
    changeFilament(profile, target.value);
    render();
  } else if (target.id === 'edit-name' && profile) {
    profile.name = target.value.trim() || 'Untitled profile';
    persist();
  } else if (target.id === 'edit-preset' && profile) {
    Object.assign(profile, applyPreset(profile, target.value));
    persist();
    render();
    notify(`${target.value} settings applied to the current profile.`);
  } else if (target.matches('[data-compare]')) {
    app.compareIds = target.checked ? [...new Set([...app.compareIds, target.dataset.compare])] : app.compareIds.filter((id) => id !== target.dataset.compare);
    renderCompare();
  }
});

content.addEventListener('click', async (event) => {
  const tab = event.target.closest('[data-tab]');
  if (tab) { app.editorTab = tab.dataset.tab; renderEditor(); return; }
  const pageButton = event.target.closest('[data-page]');
  if (pageButton && !pageButton.closest('#navigation')) { app.page = pageButton.dataset.page; render(); return; }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const profile = profileForAction(button);
  const action = button.dataset.action;
  if (action === 'round-acceleration' && profile) {
    const key = button.dataset.key;
    try {
      profile.settings[key] = roundAcceleration(profile.settings[key]);
      persist(); renderEditor();
      notify(key + ' was rounded to the nearest multiple of 10. Review the corrected value before exporting.');
    } catch (error) { notify('Could not round ' + key + ': ' + error.message, true); }
  } else if (action === 'new') { createNewProfile(); app.page = 'editor'; render(); notify('New configuration created.'); }
  else if (action === 'edit') { app.page = 'editor'; render(); }
  else if (action === 'select-profile') { selectProfile(button.dataset.id); render(); notify('Configuration selected.'); }
  else if (action === 'rename' && profile) {
    const name = window.prompt('Profile name:', profile.name);
    if (name?.trim()) { profile.name = name.trim().slice(0, 100); persist(); render(); notify('Profile renamed.'); }
  } else if (action === 'duplicate' && profile) {
    const copy = { ...profile, id: `profile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: `${profile.name} copy`, settings: { ...profile.settings }, updatedAt: new Date().toISOString() };
    app.profiles.unshift(copy); app.activeId = copy.id; persist(); render(); notify('Configuration duplicated.');
  } else if (action === 'delete' && profile) {
    if (window.confirm(`Delete "${profile.name}"? This cannot be undone.`)) {
      app.profiles = app.profiles.filter((item) => item.id !== profile.id);
      app.compareIds = app.compareIds.filter((id) => id !== profile.id);
      app.activeId = app.profiles[0]?.id || null;
      persist(); render(); notify('Configuration deleted.');
    }
  } else if (action === 'export-json' && profile) download(profile, 'json');
  else if (action === 'download' && profile) {
    try { download(profile, document.querySelector('#export-format').value); }
    catch (error) { notify(error.message, true); }
  } else if (action === 'copy' && profile) {
    const format = document.querySelector('#export-format').value;
    try { await copyProfile(profile, format); } catch (error) { notify(error.message, true); }
  } else if (action === 'reset-all' && profile) {
    if (window.confirm('Reset every editable setting to the current generic default recommendations?')) {
      const defaults = createProfile({ printerId: profile.printerId, nozzle: profile.nozzle, filament: profile.filament, name: profile.name, preset: 'Balanced' });
      profile.settings = defaults.settings; profile.preset = 'Balanced'; persist(); render(); notify('All settings reset to generic recommendations.');
    }
  } else if (action === 'reset-setting' && profile) {
    profile.settings[button.dataset.key] = defaultFor(profile, button.dataset.key);
    persist(); renderEditor(); notify(`${button.dataset.key} reset.`);
  } else if (action === 'regenerate-setting' && profile) {
    const key = button.dataset.key;
    profile.settings[key] = regenerateValue(profile, key);
    persist(); renderEditor(); notify(`${key} regenerated; other settings were unchanged.`);
  } else if (action === 'generate' && profile) {
    const generated = generateSettings(profile, {
      quality: document.querySelector('#generator-quality').value,
      speed: document.querySelector('#generator-speed').value,
      strength: document.querySelector('#generator-strength').value
    });
    profile.settings = generated.settings; profile.preset = 'Generated'; persist();
    app.generatorExplanations = generated.explanations;
    renderEditor();
    notify('Configuration generated. See the explanations above the settings tabs.');
  } else if (action === 'create-preset') createPresetProfile(button.dataset.preset);
  else if (action === 'add-printer') addCustomPrinter();
  else if (action === 'add-filament') addCustomFilament();
});

function consumeGXHandoff() {
  if (new URLSearchParams(location.search).get('importGX') !== '1') return false;
  const raw = localStorage.getItem(GX_PROFILE_HANDOFF_KEY);
  if (raw === null) return false;
  const handoff = parseGXProfileHandoff(JSON.parse(raw));
  const imported = profileFromGX(handoff);
  if (imported.printerRecord) app.printers.unshift(imported.printerRecord);
  app.profiles.unshift(imported.profile);
  app.activeId = imported.profile.id;
  app.page = 'editor';
  localStorage.removeItem(GX_PROFILE_HANDOFF_KEY);
  persist();
  history.replaceState(null, '', location.pathname);
  const missing = imported.profile.sourceData.missing.length;
  notify('GX settings imported for review. ' + missing + ' source fields were missing; other values are generic starting points.');
  return true;
}

function load() {
  try {
    const saved = loadProfileCollection(localStorage, STORAGE_KEY);
    if (saved) {
      if (Array.isArray(saved.profiles)) app.profiles = saved.profiles;
      if (Array.isArray(saved.printers)) app.printers = saved.printers;
      if (saved.filaments && typeof saved.filaments === 'object') app.filaments = saved.filaments;
      app.activeId = saved.activeId;
    }
    if (!app.profiles.length) createNewProfile();
    if (!app.profiles.some((profile) => profile.id === app.activeId)) app.activeId = app.profiles[0]?.id || null;
    if (localStorage.getItem(`${STORAGE_KEY}-theme`) === 'light') document.body.classList.add('light');
  } catch (error) {
    notify(`Could not load saved profile data: ${error.message}`, true);
    app.profiles = [createProfile()];
    app.activeId = app.profiles[0].id;
  }
  try { consumeGXHandoff(); }
  catch (error) { notify('Could not import GX settings: ' + error.message, true); }
}

load();
render();
