// 公開版だけの試験（rebuild-public.ps1 が置く）：Grok 機能（BOT_FEATURES）が無い既定のビルドでも、
// Grok Cards の枠（段 3。ボードもこの中）は出る。型の窓の「Grok に頼む…」は隠れる
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { cardsStageOn } from '../src/cards-stages';
import { BOT_FEATURES } from '../src/features';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, String(v)), removeItem: (k: string) => void store.delete(k) });

describe('公開版の既定：Grok 機能はオフ、Grok Cards の枠は出る', () => {
  it('BOT_FEATURES は既定で false', () => {
    expect(BOT_FEATURES).toBe(false);
  });
  it('段 3（Grok Cards の枠）は、保存値が無くても古い値があってもオン', () => {
    store.clear();
    expect(cardsStageOn('3')).toBe(true);
    localStorage.setItem('honeycomb.cardsStages', JSON.stringify(['1']));
    expect(cardsStageOn('3')).toBe(true);
    store.clear();
  });
  it('型の窓の「Grok に頼む…」は BOT_FEATURES のときだけ', () => {
    const pane = readFileSync(new URL('../src/app/memo-pane.ts', import.meta.url), 'utf8');
    expect(pane).toMatch(/if \(!BOT_FEATURES\) tplPalAsk\.style\.display = 'none';/);
  });
  it('「この島を頼む」「🔍 Grok に頼む」は BOT_FEATURES のときだけ（依頼の小窓は Grok Bot とつなぐ機能）', () => {
    const primary = readFileSync(new URL('../src/app/primary.ts', import.meta.url), 'utf8');
    const menuLines = primary.split(/\r?\n/).filter((l) => /label: '(この島を頼む|🔍 Grok に頼む)'/.test(l));
    expect(menuLines.length).toBeGreaterThanOrEqual(3);
    for (const l of menuLines) expect(l).toContain('BOT_FEATURES');
    const organize = readFileSync(new URL('../src/panels/organize-panel.ts', import.meta.url), 'utf8');
    expect(organize).toMatch(/if \(!BOT_FEATURES\) ask\.style\.display = 'none';/);
  });
});