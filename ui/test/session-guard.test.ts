import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/bridge', () => ({ surface: 'left', send() {}, onMessage() {}, request: async () => ({}) }));

import { decideSessionStart, formatSavedAt, SaveHealth, sessionNoticeText } from '../src/session-guard';

const board = { version: 1, activeId: 1, islands: [], tabs: [{ id: 1, url: 'https://example.com/', pos: { q: 0, r: 0 }, order: 1 }] };

describe('decideSessionStart', () => {
  it('ok：読めた盤面で、すぐ書いてよい', () => {
    const s = decideSessionStart({ session: board, sessionState: 'ok' });
    expect(s.writable).toBe(true);
    expect(s.recovery).toBeNull();
    expect(s.saved?.tabs).toHaveLength(1);
  });

  it('missing：新しい盤面で、書いてよい（初めての起動）', () => {
    expect(decideSessionStart({ session: null, sessionState: 'missing' })).toEqual({ saved: null, writable: true, recovery: null });
  });

  it('unreadable で控えあり：控えの盤面を並べ、決めるまで書かない', () => {
    const s = decideSessionStart({
      session: board,
      sessionState: 'unreadable',
      sessionRecovery: { reason: 'parse', quarantine: 'session.corrupt-20261017-193012.json', backup: 'session.bak1.json', backupSavedAt: 1_760_000_000_000 },
    });
    expect(s.writable).toBe(false);
    expect(s.saved?.tabs).toHaveLength(1);
    expect(s.recovery).toEqual({ reason: 'parse', quarantine: 'session.corrupt-20261017-193012.json', backup: 'session.bak1.json', backupSavedAt: 1_760_000_000_000 });
  });

  it('unreadable で控えなし：新しい盤面だが書かない', () => {
    const s = decideSessionStart({ session: null, sessionState: 'unreadable', sessionRecovery: { reason: 'parse', quarantine: 'session.corrupt-20261017-193012.json' } });
    expect(s).toMatchObject({ saved: null, writable: false, recovery: { reason: 'parse' } });
    expect(s.recovery?.backup).toBeUndefined();
  });

  it('控えの名前が付いていても UI で読めない中身なら使わない（名前も消す）', () => {
    const s = decideSessionStart({ session: { version: 2 }, sessionState: 'unreadable', sessionRecovery: { reason: 'parse', backup: 'session.bak2.json', backupSavedAt: 5 } });
    expect(s.saved).toBeNull();
    expect(s.recovery).toEqual({ reason: 'parse' });
  });

  it('ok でも UI で読めない形なら、書かない（shape）', () => {
    expect(decideSessionStart({ session: { version: 1 }, sessionState: 'ok' })).toEqual({ saved: null, writable: false, recovery: { reason: 'shape' } });
  });

  it('おかしな名前・理由は捨てる（パスを混ぜない）', () => {
    const s = decideSessionStart({ session: null, sessionState: 'unreadable', sessionRecovery: { reason: 'evil', quarantine: '..\\..\\x.json', backup: 3 } });
    expect(s.recovery).toEqual({ reason: 'parse' });
  });

  it('sessionState の無い古い C++：今までどおり', () => {
    expect(decideSessionStart({ session: null })).toEqual({ saved: null, writable: true, recovery: null });
    expect(decideSessionStart({ session: board }).writable).toBe(true);
  });
});

describe('sessionNoticeText', () => {
  it('壊れていて控えから戻した：写しと控えの時刻を書き、続けるをすすめる', () => {
    const at = new Date(2026, 9, 17, 18, 5).getTime();
    const t = sessionNoticeText({ reason: 'parse', quarantine: 'session.corrupt-20261017-193012.json', backup: 'session.bak1.json', backupSavedAt: at });
    expect(t.title).toBe('盤面を控えから戻しました');
    expect(t.body.join('')).toContain('session.corrupt-20261017-193012.json');
    expect(t.body.join('')).toContain('2026/10/17 18:05');
    expect(t.body.join('')).toContain('決めるまでは、盤面を保存しません');
    expect(t.recommend).toBe('accept');
  });

  it('控えが無い：新しい盤面で書き直すかを聞き、保存しないをすすめる', () => {
    const t = sessionNoticeText({ reason: 'parse', quarantine: 'session.corrupt-x.json' });
    expect(t.accept).toContain('書き直す');
    expect(t.recommend).toBe('decline');
  });

  it('開けなかっただけ・写しが無い：保存しないをすすめる', () => {
    expect(sessionNoticeText({ reason: 'open', backup: 'session.bak1.json' }).recommend).toBe('decline');
    expect(sessionNoticeText({ reason: 'parse', backup: 'session.bak1.json' }).recommend).toBe('decline');
    expect(sessionNoticeText({ reason: 'parse', backup: 'session.bak1.json' }).body.join('')).toContain('写しは作れませんでした');
  });

  it('時刻の書き方', () => {
    expect(formatSavedAt(new Date(2026, 0, 2, 3, 4).getTime())).toBe('2026/01/02 03:04');
  });
});

describe('SaveHealth', () => {
  it('変わり目だけ知らせる', () => {
    const h = new SaveHealth();
    expect(h.note(true)).toBeNull();
    expect(h.note(false)).toBe('failed');
    expect(h.note(false)).toBeNull();
    expect(h.isFailing).toBe(true);
    expect(h.note(true)).toBe('recovered');
    expect(h.note(true)).toBeNull();
  });
});
