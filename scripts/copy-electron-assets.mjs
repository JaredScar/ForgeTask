import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const destDir = path.join(root, 'dist-electron', 'db');
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(path.join(root, 'electron', 'db', 'schema.sql'), path.join(destDir, 'schema.sql'));
