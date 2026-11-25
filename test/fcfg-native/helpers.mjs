import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
export const corpus = () => fs.readdirSync(FIXTURES).flatMap((d) =>
  fs.readdirSync(path.join(FIXTURES, d)).map((f) => ({ dir: d, file: f, nozzle: parseFloat(d), bytes: fs.readFileSync(path.join(FIXTURES, d, f)) })));
export const load = (dir, file) => fs.readFileSync(path.join(FIXTURES, dir, file));
export const dec = (b) => Buffer.from(b).toString('latin1');
