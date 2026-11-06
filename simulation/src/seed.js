import { readFileSync } from 'node:fs';
import { upsertSite, setActiveSites } from './db.js';

export function loadSites(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function seed(db, sites) {
  for (const site of sites) upsertSite(db, site);
  setActiveSites(db, sites.map(s => s.slug));
}
