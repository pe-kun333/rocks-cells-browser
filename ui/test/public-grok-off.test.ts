// 公開版だけの試験（rebuild-public.ps1 が置く）：Grok 機能（BOT_FEATURES）が無い既定のビルドでは、
// Grok Cards の枠（段 3。ボードもこの中）が出ず、型の窓の「Grok に頼む…」も隠れる
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { cardsStageOn } from '../src/cards-stages';
import { BOT_FEATURES } from '../src/features';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, String(v)), removeItem: (k: string) => void store.delete(k) });

describe('公開版の既定：Grok 機能はオフ', () => {
  it('BOT_FEATURES は既定で false', () => {
    expect(BOT_FEATURES).toBe(false);
  });
  it('段 3（Grok Cards の枠）は、旧い保存値があってもオフ', () => {
    localStorage.setItem('honeycomb.cardsStages', JSON.stringify(['1', '2', '3']));
    expect(cardsStageOn('3')).toBe(false);
    localStorage.removeItem('honeycomb.cardsStages');
    expect(cardsStageOn('3')).toBe(false);
  });
  it('型の窓の「Grok に頼む…」は BOT_FEATURES のときだけ', () => {
    const pane = readFileSync(new URL('../src/app/memo-pane.ts', import.meta.url), 'utf8');
    expect(pane).toMatch(/if \(!BOT_FEATURES\) tplPalAsk\.style\.display = 'none';/);
  });
});