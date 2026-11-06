// Guard: the raw-data notebook must be stored without outputs, so transcripts / ids from the TEST DB never reach git.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'notebooks', 'raw_data.ipynb');
const nb = JSON.parse(readFileSync(path, 'utf8'));

test('raw_data.ipynb is valid nbformat 4 with a Python kernel', () => {
  assert.equal(nb.nbformat, 4);
  assert.equal(nb.metadata.kernelspec.language, 'python');
  assert.ok(nb.cells.length > 5);
});

test('raw_data.ipynb has no stored outputs (run "Clear All Outputs" before committing)', () => {
  const withOutputs = nb.cells.filter(c => c.cell_type === 'code' && (c.outputs?.length || c.execution_count !== null));
  assert.equal(withOutputs.length, 0, `${withOutputs.length} cell(s) contain outputs, which may include personal data from the TEST DB`);
});

test('notebook opens the TEST DB read-only and labels data SOURCE=TEST', () => {
  const src = nb.cells.map(c => c.source.join('')).join('\n');
  assert.match(src, /mode=ro/);
  assert.match(src, /SOURCE = "TEST"/);
  assert.match(src, /df\.insert\(0, "SOURCE", SOURCE\)/);
});
