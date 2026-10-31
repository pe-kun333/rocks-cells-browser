// 段 D0：下書きのうち、ファイルを読まない関数の今の挙動を固める（ui/src は変えない）
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/bridge', () => ({ surface: 'left', send: () => {}, onMessage: () => {}, request: async () => null }));
vi.mock('../src/data', () => ({ readData: async () => null, writeData: async () => true, deleteData: () => {}, listData: async () => [] }));

import type { AskAllRun, AskAllTarget } from '../src/bot-ask-all';
import { draftsFromAskAll, flagsOf } from '../src/drafts';

describe('flagsOf', () => {
  it('項目があるかを印にする。空文字は無し。空白だけの文字は有り。画像は引数のまま', () => {
    expect(flagsOf({})).toEqual({ title: false, url: false, selection: false, body: false, image: false, materials: 0 });
    expect(flagsOf({ title: '題', url: 'https://ex.com', selection: '選', body: '本文' }, true)).toEqual({
      title: true,
      url: true,
      selection: true,
      body: true,
      image: true,
      materials: 0,
    });
    expect(flagsOf({ title: '', url: '', selection: '', body: '' })).toEqual({
      title: false,
      url: false,
      selection: false,
      body: false,
      image: false,
      materials: 0,
    });
    expect(flagsOf({ materials: [{ kind: 'card', label: '題', text: '文' }] }).materials).toBe(1);
    expect(flagsOf({ title: ' ' }).title).toBe(true);
  });
});

describe('draftsFromAskAll', () => {
  const seats: AskAllTarget[] = [
    { id: 'b7k2m9', name: '調査役', linked: true, role: { preset: 'research', name: '調査', shape: 'hexagon' }, seat: 1 },
    { id: 'b8k2m9', name: '役なし席', linked: true, seat: 2 },
  ];
  const run: AskAllRun = {
    group: 12,
    seats,
    text: '頼む',
    attach: { title: '題' },
    chatOnly: false,
    index: 0,
    sent: [false, false],
  };

  it('席の順に下書きを作り、最初の席だけ次。席の番号は下書きにあり、依頼の中身には入れない', () => {
    const made = draftsFromAskAll(run, 1_700_000_000_000);
    expect(made.map((d) => d.id)).toEqual(['g12-0', 'g12-1']);
    expect(made.map((d) => d.next)).toEqual([true, false]);
    expect(made[0]).toMatchObject({
      createdAt: 1_700_000_000_000,
      text: '頼む',
      botId: 'b7k2m9',
      botName: '調査役',
      roleName: '調査',
      seat: 1,
      group: 12,
      step: 1,
      steps: 2,
      chatOnly: false,
      attach: { title: true, url: false, selection: false, body: false, image: false },
    });
    expect(made[1].roleName).toBeUndefined();
    expect(made[1].seat).toBe(2);
    expect(made[0].req).toMatchObject({ botId: 'b7k2m9', group: 12, planned: ['b7k2m9', 'b8k2m9'], role: seats[0].role });
    expect(made[0].req.seat).toBeUndefined();
    expect(made[0].req.text).toContain('頼む');
    expect(made[0].req.text).toContain('ページの題名：題');
    expect(made[1].req.role).toBeNull();
  });
});
