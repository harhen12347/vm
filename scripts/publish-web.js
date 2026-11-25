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
const files = ['gx-converter.html', 'gx-converter.css', 'gx-converter.js', 'gx-converter-core.mjs', 'gx-converter-worker.js'];
for (const file of files) {
  const source = path.join(output, file);
  if (!fs.existsSync(source)) throw new Error(`GX converter build is missing: ${file}`);
  fs.copyFileSync(source, path.join(root, file));
}
console.log('Published the GX File Converter to the repository root for GitHub Pages.');
