// 段 D0：前回の選び方の形の、今の挙動を固める（ui/src は変えない）
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/bridge', () => ({ surface: 'left', send: () => {}, onMessage: () => {}, request: async () => null }));
vi.mock('../src/data', () => ({ readData: async () => null, writeData: async () => true, deleteData: () => {}, listData: async () => [] }));

import { normalizeLastChoice, normalizeLastRequest } from '../src/bot-last-request';

describe('normalizeLastChoice', () => {
  it('オブジェクトでなければ null。項目が欠けていれば既定', () => {
    expect(normalizeLastChoice(null)).toBeNull();
    expect(normalizeLastChoice([])).toBeNull();
    expect(normalizeLastChoice('page')).toBeNull();
    expect(normalizeLastChoice({})).toEqual({
      entry: 'page',
      presets: [],
      to: {},
      replyTo: 'inbox',
      stamps: [],
      attach: { url: false, title: false, selection: false },
    });
  });

  it('知らない入口はページ。入口の名前そのものは通す', () => {
    expect(normalizeLastChoice({ entry: 'later' })?.entry).toBe('page');
    expect(normalizeLastChoice({ entry: 'Page' })?.entry).toBe('page');
    expect(normalizeLastChoice({ entry: 'cells' })?.entry).toBe('cells');
    expect(normalizeLastChoice({ entry: 'cards' })?.entry).toBe('cards');
    expect(normalizeLastChoice({ entry: 'follow' })?.entry).toBe('follow');
    expect(normalizeLastChoice({ entry: 'memo' })?.entry).toBe('memo');
  });

  it('定型の id は形の合うものを順に 12 個まで。印の id は小文字だけ 10 個まで', () => {
    const presets = ['p1', 'p1', 'has space', 'a_b', '', ...Array.from({ length: 12 }, (_, i) => `q${i}`)];
    const stamps = ['rush', 'Rush', 'a1', 'a_b', 'ok', ...Array.from({ length: 12 }, () => 'x')];
    const out = normalizeLastChoice({ presets, stamps, set: 'page-1' });
    expect(out?.set).toBe('page-1');
    expect(out?.presets).toEqual(['p1', 'a_b', ...Array.from({ length: 10 }, (_, i) => `q${i}`)]);
    expect(out?.stamps).toEqual(['rush', 'ok', 'x']);
    expect(normalizeLastChoice({ set: 'ページ' })).not.toHaveProperty('set');
    expect(normalizeLastChoice({ set: 'a'.repeat(41) })).not.toHaveProperty('set');
  });

  it('みんなに聞くなら botId と席は持たない。1 体なら id の形と席 1〜6 だけ', () => {
    expect(normalizeLastChoice({ to: { all: true, botId: 'b7k2m9', seat: 2 } })?.to).toEqual({ all: true });
    expect(normalizeLastChoice({ to: { botId: 'b7k2m9', seat: 1 } })?.to).toEqual({ botId: 'b7k2m9', seat: 1 });
    expect(normalizeLastChoice({ to: { botId: 'b7k2m9', seat: 6 } })?.to).toEqual({ botId: 'b7k2m9', seat: 6 });
    expect(normalizeLastChoice({ to: { botId: 'B7k2m9', seat: 0 } })?.to).toEqual({});
    expect(normalizeLastChoice({ to: { botId: 'bot1', seat: 7 } })?.to).toEqual({});
    expect(normalizeLastChoice({ to: { botId: 'b7k2m9', seat: 1.5 } })?.to).toEqual({ botId: 'b7k2m9' });
    expect(normalizeLastChoice({ to: { seat: '3' } })?.to).toEqual({});
  });

  it('返し先は chat・memo・card だけ通り、ほかは受け取り箱。添付の印は true だけ', () => {
    expect(normalizeLastChoice({ replyTo: 'chat' })?.replyTo).toBe('chat');
    expect(normalizeLastChoice({ replyTo: 'memo' })?.replyTo).toBe('memo');
    expect(normalizeLastChoice({ replyTo: 'card' })?.replyTo).toBe('card');
    expect(normalizeLastChoice({ replyTo: 'patch' })?.replyTo).toBe('inbox');
    expect(normalizeLastChoice({ replyTo: 'mail' })?.replyTo).toBe('inbox');
    expect(normalizeLastChoice({ replyTo: 'CHAT' })?.replyTo).toBe('inbox');
    expect(normalizeLastChoice({ attach: { url: true, title: 1, selection: 'yes' } })?.attach).toEqual({
      url: true,
      title: false,
      selection: false,
    });
  });
});

describe('normalizeLastRequest', () => {
  it('時刻が読めるものだけ、選び方に ISO の時刻を足す', () => {
    expect(normalizeLastRequest({ at: '2026-10-25T09:00:00+09:00', entry: 'shot', replyTo: 'memo' })).toEqual({
      entry: 'shot',
      presets: [],
      to: {},
      replyTo: 'memo',
      stamps: [],
      attach: { url: false, title: false, selection: false },
      at: '2026-10-25T00:00:00.000Z',
    });
    expect(normalizeLastRequest({ at: '2026-10-25' })?.at).toBe('2026-10-25T00:00:00.000Z');
  });

  it('時刻が無い・長すぎる・読めないものは null', () => {
    expect(normalizeLastRequest({})).toBeNull();
    expect(normalizeLastRequest(null)).toBeNull();
    expect(normalizeLastRequest({ at: 1 })).toBeNull();
    expect(normalizeLastRequest({ at: 'not-a-date' })).toBeNull();
    expect(normalizeLastRequest({ at: 'x'.repeat(41) })).toBeNull();
  });
});
