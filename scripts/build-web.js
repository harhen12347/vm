const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const output = path.join(root, 'dist');
const library = path.join(root, 'node_modules', 'sldprt', 'src');

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(path.join(output, 'vendor', 'container'), { recursive: true });
fs.mkdirSync(path.join(output, 'vendor', 'three'), { recursive: true });
fs.mkdirSync(path.join(output, 'vendor', 'cura-wasm'), { recursive: true });
fs.mkdirSync(path.join(output, 'desktop'), { recursive: true });

for (const [source, destination] of [
  ['src/launcher.html', 'index.html'],
  ['src/launcher.css', 'launcher.css'],
  ['src/slicer.html', 'slicer.html'],
  ['src/slicer.css', 'slicer.css'],
  ['src/slicer.js', 'slicer.js'],
  ['src/printer-database.mjs', 'printer-database.mjs'],
  ['src/cura-engine-adapter.mjs', 'cura-engine-adapter.mjs'],
  ['src/printer-database.json', 'printer-database.json'],
  ['src/slicer-worker.js', 'slicer-worker.js'],
  ['src/cad.html', 'cad.html'],
  ['src/cad.css', 'cad.css'],
  ['src/cad-page.js', 'cad-page.js'],
  ['src/cad-worker.js', 'cad-worker.js'],
  ['src/printer-config.html', 'printer-config.html'],
  ['src/printer-config.css', 'printer-config.css'],
  ['src/printer-config.js', 'printer-config.js'],
  ['src/printer-config-core.mjs', 'printer-config-core.mjs'],
  ['src/gx-converter.html', 'gx-converter.html'],
  ['src/gx-converter.css', 'gx-converter.css'],
  ['src/gx-converter.js', 'gx-converter.js'],
  ['src/gx-converter-core.mjs', 'gx-converter-core.mjs'],
  ['src/gx-converter-worker.js', 'gx-converter-worker.js'],
  ['src/site-login.html', 'site-login.html'],
  ['src/site-login.css', 'site-login.css'],
  ['src/site-login.js', 'site-login.js'],
  ['src/site-shell.css', 'site-shell.css'],
  ['src/site-shell.js', 'site-shell.js'],
  ['src/index.html', 'desktop/index.html'],
  ['src/styles.css', 'desktop/styles.css'],
  ['src/renderer.js', 'desktop/renderer.js']
]) {
  fs.copyFileSync(path.join(root, source), path.join(output, destination));
}

for (const [source, destination] of [
  ['container/modern.js', 'vendor/container/modern.js'],
  ['container/ole.js', 'vendor/container/ole.js'],
  ['display.js', 'vendor/display.js'],
  ['inflate.js', 'vendor/inflate.js'],
  ['convert.js', 'vendor/convert.js'],
  ['../LICENSE', 'vendor/LICENSE'],
  ['../NOTICE', 'vendor/NOTICE']
]) {
  fs.copyFileSync(path.join(library, source), path.join(output, destination));
}

fs.copyFileSync(
  path.join(root, 'node_modules', 'three', 'build', 'three.module.js'),
  path.join(output, 'vendor', 'three', 'three.module.js')
);
fs.copyFileSync(
  path.join(root, 'node_modules', 'three', 'build', 'three.core.js'),
  path.join(output, 'vendor', 'three', 'three.core.js')
);
fs.copyFileSync(
  path.join(root, 'node_modules', '@toybox-labs', 'cura-wasm', 'dist', 'es.js'),
  path.join(output, 'vendor', 'cura-wasm', 'es.js')
);
fs.copyFileSync(
  path.join(root, 'node_modules', '@toybox-labs', 'cura-wasm', 'LICENSE'),
  path.join(output, 'vendor', 'cura-wasm', 'LICENSE')
);
fs.cpSync(
  path.join(root, 'node_modules', 'three', 'examples', 'jsm'),
  path.join(output, 'vendor', 'three', 'addons'),
  { recursive: true }
);

console.log(`Built the Aether browser tools in ${path.relative(root, output)}/`);
