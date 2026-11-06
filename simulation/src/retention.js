// Retention purge (compliance ENG-002/004): deletes feedback rows and their recordings
// older than the retention period. Runs at server start and once a day.
import { rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { deleteFeedbackBefore } from './db.js';

export function removeAudioFiles(audioDir, audioPaths) {
  for (const p of audioPaths) {
    if (p) rmSync(join(audioDir, basename(p)), { force: true });
  }
}

export function purgeExpired(db, { audioDir, days, now = Date.now() }) {
  const cutoff = new Date(now - days * 86400000).toISOString();
  const { deleted, audioPaths } = deleteFeedbackBefore(db, cutoff);
  removeAudioFiles(audioDir, audioPaths);
  return { deleted, cutoff };
}
