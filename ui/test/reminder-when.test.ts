// リマインダーを自分で（K2）：文と時刻を一つの欄で読む・押しボタンの時刻・延ばす・日ごとの見出し・置いた人と指す先の読み替え
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/bridge', () => ({ surface: 'right', send: () => {}, onMessage: () => {}, request: async () => null }));

import { clockOf, dayLabel, MAX_AHEAD_MS, parseWhen, presetTimes, snoozedCopy } from '../src/reminder-when';
import { reminderBy, reminderLink } from '../src/reminders';

const at = (month: number, day: number, h: number, m = 0, year = 2026) => new Date(year, month - 1, day, h, m).getTime();
const NOW = at(10, 22, 14, 0); // 2026-10-22（木）14:00

describe('parseWhen', () => {
  it('分後・時間後。全角の数字も読み、残りの文の頭の「に」「、」は外す', () => {
    expect(parseWhen('30分後に休憩', NOW)).toEqual({ dueAt: NOW + 30 * 60_000, text: '休憩' });
    expect(parseWhen('２時間後、洗濯物', NOW)).toEqual({ dueAt: NOW + 2 * 3600_000, text: '洗濯物' });
    expect(parseWhen('  10 分後 には 電話  ', NOW)).toEqual({ dueAt: NOW + 10 * 60_000, text: '電話' });
  });

  it('今夜・今日の夕方は過ぎていれば翌日。明日の朝・明日 n 時・来週', () => {
    expect(parseWhen('今夜 薬', NOW)).toEqual({ dueAt: at(10, 22, 21), text: '薬' });
    expect(parseWhen('今日の夕方に買い物', NOW)).toEqual({ dueAt: at(10, 22, 17), text: '買い物' });
    expect(parseWhen('今日の夕方に買い物', at(10, 22, 18))?.dueAt).toBe(at(10, 23, 17));
    expect(parseWhen('今夜', at(10, 22, 22))?.dueAt).toBe(at(10, 23, 21));
    expect(parseWhen('明日の朝 ゴミ出し', NOW)).toEqual({ dueAt: at(10, 23, 9), text: 'ゴミ出し' });
    expect(parseWhen('明日7時に起きる', NOW)).toEqual({ dueAt: at(10, 23, 7), text: '起きる' });
    expect(parseWhen('来週 振り返り', NOW)).toEqual({ dueAt: at(10, 29, 9), text: '振り返り' });
  });

  it('月/日 時:分。過ぎていれば来年、ない日は読まない', () => {
    expect(parseWhen('10/24 14:30 会議', NOW)).toEqual({ dueAt: at(10, 24, 14, 30), text: '会議' });
    expect(parseWhen('１／５ ９：００ 初詣', NOW)).toEqual({ dueAt: at(1, 5, 9, 0, 2027), text: '初詣' });
    expect(parseWhen('2/30 10:00 x', NOW)).toBeNull();
    expect(parseWhen('13/1 10:00 x', NOW)).toBeNull();
  });

  it('読めない・今より前・400 日より先・頭にないものは null。文だけのときは空の文', () => {
    expect(parseWhen('休憩する', NOW)).toBeNull();
    expect(parseWhen('休憩は30分後', NOW)).toBeNull();
    expect(parseWhen('0分後 x', NOW)).toBeNull();
    expect(parseWhen('明日25時 x', NOW)).toBeNull();
    expect(parseWhen(`${Math.ceil(MAX_AHEAD_MS / 60_000) + 1}分後 x`, NOW)).toBeNull();
    expect(parseWhen('30分後', NOW)).toEqual({ dueAt: NOW + 30 * 60_000, text: '' });
  });
});

describe('押しボタンの時刻', () => {
  it('10 分後・1 時間後・今日の夕方・明日の朝・来週。夕方を過ぎたら夕方は出さない', () => {
    expect(presetTimes(NOW).map((p) => `${p.key}:${clockOf(p.dueAt)}`)).toEqual(['m10:14:10', 'h1:15:00', 'evening:17:00', 'morning:09:00', 'week:09:00']);
    expect(presetTimes(at(10, 22, 17, 30)).map((p) => p.key)).toEqual(['m10', 'h1', 'morning', 'week']);
    expect(presetTimes(NOW).find((p) => p.key === 'week')?.dueAt).toBe(at(10, 29, 9));
  });
});

describe('延ばすと見出し', () => {
  it('延ばすときは新しい id と時刻で、文・指す先・置いた人はそのまま', () => {
    const r = { id: 'r1', text: '休憩', dueAt: NOW, createdAt: 1, by: 'user' as const, link: { kind: 'memo' as const, id: 'm1' }, title: 'メモ' };
    const copy = snoozedCopy(r, NOW + 600_000, NOW);
    expect(copy).toMatchObject({ text: '休憩', dueAt: NOW + 600_000, createdAt: NOW, by: 'user', link: { kind: 'memo', id: 'm1' }, title: 'メモ' });
    expect(copy.id).not.toBe('r1');
  });

  it('今日・明日・それより先は月日と曜日', () => {
    expect(dayLabel(at(10, 22, 23, 59), NOW)).toBe('今日');
    expect(dayLabel(at(10, 23, 0), NOW)).toBe('明日');
    expect(dayLabel(at(10, 24, 9), NOW)).toBe('10/24（土）');
  });
});

describe('置いた人と指す先', () => {
  it('置いた人は、無い・読めないものを相棒と読む', () => {
    expect(reminderBy({})).toBe('companion');
    expect(reminderBy({ by: 'user' })).toBe('user');
    expect(reminderBy({ by: 'x' as never })).toBe('companion');
  });

  it('指す先は link を確かめて読み、無ければ古い tabId をタブと読み替える', () => {
    expect(reminderLink({ link: { kind: 'tab', id: 3, url: 'https://example.com/' } })).toEqual({ kind: 'tab', id: 3, url: 'https://example.com/' });
    expect(reminderLink({ tabId: 7 })).toEqual({ kind: 'tab', id: 7 });
    expect(reminderLink({ tabId: null })).toBeUndefined();
    expect(reminderLink({ link: { kind: 'memo', id: '<bad>' } as never, tabId: 0 })).toBeUndefined();
  });
});
