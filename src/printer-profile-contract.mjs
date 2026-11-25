export const GX_PROFILE_HANDOFF_KEY = 'aether-printer-profile-studio-gx-import-v1';

export function createGXProfileHandoff(sourceName, printer, model) {
  return {
	format: 'AETHER_GX_PROFILE_HANDOFF',
	version: 1,
	sourceName: String(sourceName || 'GX import'),
	printer: normalizeSettings(printer),
	model: normalizeSettings(model)
  };
}

export function parseGXProfileHandoff(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
	|| value.format !== 'AETHER_GX_PROFILE_HANDOFF' || value.version !== 1) {
	throw new Error('The saved GX settings are not a supported Profile Studio handoff.');
  }
  return {
	format: value.format,
	version: value.version,
	sourceName: String(value.sourceName || 'GX import'),
	printer: normalizeSettings(value.printer),
	model: normalizeSettings(value.model)
  };
}

function normalizeSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
	throw new Error('The GX handoff is missing its extracted settings.');
  }
  return Object.fromEntries(Object.entries(settings).filter(([, value]) =>
	['string', 'number', 'boolean'].includes(typeof value) || value === null
  ));
}
