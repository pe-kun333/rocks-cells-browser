// 段 D0：送る前の 1 枚のうち、DOM を使わない料金の目安の今の挙動を固める（ui/src は変えない）
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/bridge', () => ({ surface: 'left', send: () => {}, onMessage: () => {}, request: async () => null }));
vi.mock('../src/data', () => ({ readData: async () => null, writeData: async () => true, deleteData: () => {}, listData: async () => [] }));

import { BOT_COST_NOTE, companionCostNote } from '../src/send-preview';

describe('companionCostNote', () => {
  it('練習モードは料金なし。目安は先頭のモデルの単価で、知らないモデルもそれに落ちる', () => {
    expect(BOT_COST_NOTE).toBe('Grok Bot の使用量は、このブラウザからは分かりません');
    expect(companionCostNote(1000, 'claude-opus-5-5', true)).toBe('練習モードなので料金はかかりません');
    expect(companionCostNote(0, 'claude-opus-5-5', false)).toBe('約 $0.018（目安です。実際の請求とは一致しません）');
    expect(companionCostNote(-5, 'claude-opus-5-5', false)).toBe('約 $0.018（目安です。実際の請求とは一致しません）');
    expect(companionCostNote(1000, 'claude-opus-5-5', false)).toBe('約 $0.020（目安です。実際の請求とは一致しません）');
    expect(companionCostNote(0, 'claude-sonnet-5-5', false)).toBe('約 $0.009（目安です。実際の請求とは一致しません）');
    expect(companionCostNote(0, 'nope', false)).toBe('約 $0.018（目安です。実際の請求とは一致しません）');
    expect(companionCostNote(0, 'claude-opus-5-5-extra', false)).toBe('約 $0.018（目安です。実際の請求とは一致しません）');
  });
});
