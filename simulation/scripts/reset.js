import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rmSync } from 'node:fs';
import { openDb } from '../src/db.js';
import { loadSites, seed } from '../src/seed.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'data');
rmSync(dataDir, { recursive: true, force: true });
const db = openDb(join(dataDir, 'test.db'));
seed(db, loadSites(join(root, 'sites.json')));
db.close();
console.log('TEST DB reset:', join(dataDir, 'test.db'));
