// AI のカードの本文の形（plan-reader-video の V0c）：組む・読み戻す・時刻の札
import { describe, expect, it } from 'vitest';

import { AI_CARD_UNTITLED, AI_TECH_MAX, aiCardText, parseAiCardText, secLabel, splitAiCard } from '../src/reader-ai-card';

const HEAD = '技法の色・ハガキ 1（2:41〜4:22）';

describe('secLabel：時刻の札', () => {
  it('1 時間未満は m:ss、1 時間からは h:mm:ss。小数は切り捨て、負・数でない・無限は 0:00', () => {
    expect(secLabel(0)).toBe('0:00');
    expect(secLabel(196.7)).toBe('3:16');
    expect(secLabel(3725)).toBe('1:02:05');
    expect(secLabel(59.9)).toBe('0:59');
    expect(secLabel(3599)).toBe('59:59');
    expect(secLabel(3600)).toBe('1:00:00');
    expect(secLabel(-5)).toBe('0:00');
    expect(secLabel(Number.NaN)).toBe('0:00');
    expect(secLabel(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
});

describe('aiCardText：組む', () => {
  it('手本の例：見出しと時刻の行を改行でつなぐ', () => {
    expect(aiCardText(HEAD, [{ sec: 196, tech: 'ボケ', text: '裏切る（オチ）' }, { sec: 201, text: '間をあける' }])).toBe(
      '技法の色・ハガキ 1（2:41〜4:22）\n▶ 3:16〔ボケ〕裏切る（オチ）\n▶ 3:21 間をあける',
    );
  });
  it('見出しと文は空白（改行も）を一つにまとめ、前後を取る。空の見出しは AI のカード', () => {
    expect(aiCardText('  見出し\n\n続き  ', [])).toBe('見出し 続き');
    expect(aiCardText(' \n ', [])).toBe(AI_CARD_UNTITLED);
    expect(aiCardText('', [])).toBe('AI のカード');
    expect(aiCardText('h', [{ sec: 0, text: ' 前 \n 後 ' }])).toBe('h\n▶ 0:00 前 後');
  });
  it('文が空の行は書かない', () => {
    expect(aiCardText('h', [{ sec: 5, text: ' \n ' }, { sec: 10, text: 'x' }])).toBe('h\n▶ 0:10 x');
  });
  it('技法は〔〕を取り、AI_TECH_MAX 字で切る。空なら技法なし', () => {
    expect(aiCardText('h', [{ sec: 0, tech: '〔ボケ〕', text: 'x' }])).toBe('h\n▶ 0:00〔ボケ〕x');
    const long = 'あいうえおかきくけこさしすせそ'; // 13 字
    expect(aiCardText('h', [{ sec: 0, tech: long, text: 'x' }])).toBe(`h\n▶ 0:00〔${[...long].slice(0, AI_TECH_MAX).join('')}〕x`);
    expect(aiCardText('h', [{ sec: 0, tech: ' 〔 〕 ', text: 'x' }])).toBe('h\n▶ 0:00 x');
  });
  it('秒が数でない・無限・負なら、文だけの行（技法も付けない）', () => {
    expect(
      aiCardText('h', [
        { sec: Number.NaN, tech: 'ボケ', text: '文' },
        { sec: -1, text: '負' },
        { sec: Number.POSITIVE_INFINITY, text: '無限' },
      ]),
    ).toBe('h\n文\n負\n無限');
  });
  it('字数では切らない', () => {
    const body = 'あ'.repeat(2500);
    expect(aiCardText('h', [{ sec: 0, text: body }])).toBe(`h\n▶ 0:00 ${body}`);
  });
});

describe('parseAiCardText：読み戻す', () => {
  it('手本の例：組んだ本文を読むと、見出しと時刻の行に戻る', () => {
    const text = aiCardText(HEAD, [{ sec: 196, tech: 'ボケ', text: '裏切る（オチ）' }, { sec: 201, text: '間をあける' }]);
    expect(parseAiCardText(text)).toEqual({
      head: HEAD,
      rows: [
        { kind: 'timed', sec: 196, label: '3:16', tech: 'ボケ', text: '裏切る（オチ）' },
        { kind: 'timed', sec: 201, label: '3:21', text: '間をあける' },
      ],
    });
  });
  it('手本の例：形の合わない行は字のまま plain。時刻は 03:16 でも 3:16 にそろう。59 を超えたら plain', () => {
    expect(parseAiCardText('見出し\n説明の行\n▶ 1:02:05〔フリ〕長い動画\n▶ 3:75 秒が 75\n▶3:16ボケ')).toEqual({
      head: '見出し',
      rows: [
        { kind: 'plain', text: '説明の行' },
        { kind: 'timed', sec: 3725, label: '1:02:05', tech: 'フリ', text: '長い動画' },
        { kind: 'plain', text: '▶ 3:75 秒が 75' },
        { kind: 'timed', sec: 196, label: '3:16', text: 'ボケ' },
      ],
    });
    expect(parseAiCardText('h\n▶ 03:16 x').rows).toEqual([{ kind: 'timed', sec: 196, label: '3:16', text: 'x' }]);
    expect(parseAiCardText('h\n▶ 1:02:75 x').rows).toEqual([{ kind: 'plain', text: '▶ 1:02:75 x' }]);
    expect(parseAiCardText('h\n▶ 123:45:67 x').rows).toEqual([{ kind: 'plain', text: '▶ 123:45:67 x' }]);
  });
  it('空の本文・空白だけ・見出しだけ・改行の違い（\\r\\n と \\r）', () => {
    expect(parseAiCardText('')).toEqual({ head: '', rows: [] });
    expect(parseAiCardText(' \n\r\n \r ')).toEqual({ head: '', rows: [] });
    expect(parseAiCardText('見出しだけ')).toEqual({ head: '見出しだけ', rows: [] });
    expect(parseAiCardText('見出し\r\n\r\n▶ 0:05 a\r▶ 0:06 b')).toEqual({
      head: '見出し',
      rows: [
        { kind: 'timed', sec: 5, label: '0:05', text: 'a' },
        { kind: 'timed', sec: 6, label: '0:06', text: 'b' },
      ],
    });
  });
  it('1 行目が時刻の形なら、見出しは空（その行は rows に入る）', () => {
    expect(parseAiCardText('▶ 0:05 最初')).toEqual({
      head: '',
      rows: [{ kind: 'timed', sec: 5, label: '0:05', text: '最初' }],
    });
  });
});

describe('組んで読み戻す', () => {
  it('秒は切り捨てで同じ値、技法と文も同じになる', () => {
    const text = aiCardText('h', [{ sec: 196.7, tech: 'ボケ', text: '裏切る' }]);
    expect(parseAiCardText(text)).toEqual({
      head: 'h',
      rows: [{ kind: 'timed', sec: 196, label: '3:16', tech: 'ボケ', text: '裏切る' }],
    });
  });
  it('技法が無い行には tech の項目を付けない。文が数字で始まっても時刻と混ざらない', () => {
    const row = parseAiCardText(aiCardText('h', [{ sec: 65, text: '3人で言う' }])).rows[0];
    expect(row).toEqual({ kind: 'timed', sec: 65, label: '1:05', text: '3人で言う' });
    expect(row).not.toHaveProperty('tech');
  });
  it('技法の括弧は札から外れ、13 字以上は AI_TECH_MAX 字に切られて戻る', () => {
    const text = aiCardText('h', [{ sec: 0, tech: '〔あいうえおかきくけこさしすせそ〕', text: 'x' }]);
    expect(parseAiCardText(text).rows).toEqual([
      { kind: 'timed', sec: 0, label: '0:00', tech: 'あいうえおかきくけこさし', text: 'x' },
    ]);
  });
  it('秒が NaN の行は文だけになり、読み戻すと plain', () => {
    const text = aiCardText('h', [{ sec: Number.NaN, text: '文だけ' }]);
    expect(text).toBe('h\n文だけ');
    expect(parseAiCardText(text).rows).toEqual([{ kind: 'plain', text: '文だけ' }]);
  });
  it('見出しが空白だけなら AI_CARD_UNTITLED として戻る', () => {
    expect(parseAiCardText(aiCardText('   \n  ', [])).head).toBe(AI_CARD_UNTITLED);
  });
});

describe('splitAiCard（2,000 字を超える AI のカードを分ける。V4b）', () => {
  const line = (sec: number, n = 100) => ({ sec, tech: 'ボケ', text: 'あ'.repeat(n) });
  const chapter = (sec: number) => (sec < 60 ? 'つかみ' : sec < 180 ? '本ネタ' : null);

  it('収まれば 1 枚（入力は変えない）', () => {
    const lines = [line(1), line(70)];
    const parts = splitAiCard('技法の色・全体', lines, chapter);
    expect(parts).toEqual([{ head: '技法の色・全体', lines }]);
    expect(parts[0].lines).not.toBe(lines);
  });

  it('超えるならチャプターごと（見出しに名前。名前が無い組は見出しのまま）', () => {
    const lines = [line(1, 110), line(2, 110), line(70, 110), line(200, 110)];
    const parts = splitAiCard('技法の色・全体', lines, chapter, 300);
    expect(parts.map((p) => [p.head, p.lines.map((l) => l.sec)])).toEqual([
      ['技法の色・全体（つかみ）', [1, 2]],
      ['技法の色・全体（本ネタ）', [70]],
      ['技法の色・全体', [200]],
    ]);
    for (const p of parts) expect([...aiCardText(p.head, p.lines)].length).toBeLessThanOrEqual(300);
  });

  it('一つの組がまだ超えるなら、行の途中で分けて「・続き n」', () => {
    const lines = [line(1, 110), line(2, 110), line(3, 110)];
    const parts = splitAiCard('骨組み', lines, () => null, 300);
    expect(parts.map((p) => [p.head, p.lines.length])).toEqual([
      ['骨組み', 2],
      ['骨組み・続き 2', 1],
    ]);
    for (const p of parts) expect([...aiCardText(p.head, p.lines)].length).toBeLessThanOrEqual(300);
  });

  it('行が無くても 1 枚', () => {
    expect(splitAiCard('間・全体', [], chapter)).toEqual([{ head: '間・全体', lines: [] }]);
  });
});
