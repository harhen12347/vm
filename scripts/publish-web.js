const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const output = path.join(root, 'dist');
const build = spawnSync(process.execPath, [path.join(__dirname, 'build-web.js')], {
  cwd: root,
  stdio: 'inherit'
});

if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status || 1);
const files = [
  'gx-converter.html', 'gx-converter.css',  'gx-converter.js', 'gx-converter-core.mjs',
  'gx-converter-worker.js', 'printer-config.html', 'printer-config.css', 'printer-config.js',
  'printer-config-core.mjs', 'printer-profile-contract.mjs', 'printer-database.json',
  'qt-variant.mjs', 'fcfg.mjs', 'compare.mjs', 'index.mjs',
  'printer-fcfg-profile.mjs', 'printer-config-fcfg-compare.mjs',
  'vendor/three/three.module.js', 'vendor/three/three.core.js',
  'vendor/three/addons/loaders/STLLoader.js', 'vendor/three/addons/libs/fflate.module.js'
];
for (const file of files) {
  const source = path.join(output, file);
  if (!fs.existsSync(source)) throw new Error('Browser build is missing a required tool asset: ' + file);
  const destination = path.join(root, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}
console.log('Published Printer Profile Studio and GX File Converter assets to the repository root for GitHub Pages.');
