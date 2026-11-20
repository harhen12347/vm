const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const output = path.join(root, 'dist');

if (!fs.existsSync(path.join(output, 'index.html'))) {
  throw new Error('Static site build is missing. Run npm run build:web first.');
}

fs.cpSync(output, root, { recursive: true, force: true });
console.log('Published static slicer and CAD converter files to the repository root.');
