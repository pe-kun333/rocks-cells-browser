import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseImportText } from '../src/memo-card-template-io';
it('samples/card-templates-sample.json', () => {
  const r = parseImportText(readFileSync(new URL('../../samples/card-templates-sample.json', import.meta.url), 'utf8'));
  expect(r.ok).toBe(true);
  if (r.ok) { expect(r.templates.map((t) => t.id)).toEqual(['sample-proscons', 'shared-week-review', 'shared-reading-note']); expect(r.skipped.map((s) => s.index)).toEqual([3]); expect(r.total).toBe(4); }
});