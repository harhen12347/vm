const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const output = path.join(root, 'dist');
const library = path.join(root, 'node_modules', 'sldprt', 'src');

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(path.join(output, 'vendor', 'container'), { recursive: true });
fs.mkdirSync(path.join(output, 'vendor', 'three'), { recursive: true });

for (const [source, destination] of [
  ['src/slicer.html', 'index.html'],
  ['src/slicer.css', 'slicer.css'],
  ['src/slicer.js', 'slicer.js'],
  ['src/slicer-worker.js', 'slicer-worker.js'],
  ['src/cad.html', 'cad.html'],
  ['src/cad.css', 'cad.css'],
  ['src/cad-page.js', 'cad-page.js'],
  ['src/cad-worker.js', 'cad-worker.js']
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

console.log(`Built browser 3D slicer in ${path.relative(root, output)}/`);
