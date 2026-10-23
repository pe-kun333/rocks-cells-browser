// 単語カードの表示だけの計算（K5a）：伏せ方・向き・打って答える・選ぶ・暦の予報・枯れかけ・読み上げ
import { describe, expect, it } from 'vitest';

import type { VocabCard } from '../src/vocab';
import {
  clozeParts,
  compareTyped,
  forecastDays,
  hasCloze,
  isWilting,
  overdueDays,
  pickChoices,
  pickVoice,
  promptSide,
  speechLang,
} from '../src/vocab-view';

const DAY = 24 * 60 * 60_000;
const NOW = new Date(2026, 9, 22, 14, 0, 0).getTime(); // 2026-10-22 14:00（この端末の時刻）

let seq = 0;
function card(over: Partial<VocabCard> = {}): VocabCard {
  seq += 1;
  return { id: `v${seq}`, kind: 'word', front: `w${seq}`, back: `b${seq}`, createdAt: 1, level: 2, due: NOW, reviews: 1, lapses: 0, ...over };
}

// 決まった並びの「でたらめ」
function fixedRandom(values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('clozeParts', () => {
  it('表の言葉を大文字小文字を同じに見て、全部伏せる', () => {
    const parts = clozeParts('Serendipity is rare. I love serendipity.', 'serendipity', 'word');
    expect(parts).toEqual([
      { text: 'Serendipity', hidden: true },
      { text: ' is rare. I love ', hidden: false },
      { text: 'serendipity', hidden: true },
      { text: '.', hidden: false },
    ]);
  });

  it('英字の言葉は語の途中では伏せず、語の頭なら後ろが続いても伏せる', () => {
    expect(hasCloze(clozeParts('concatenate the lists', 'cat', 'word'))).toBe(false);
    expect(clozeParts('a category', 'cat', 'word')[1]).toEqual({ text: 'cat', hidden: true }); // 語の頭は伏せる
    expect(clozeParts('A glanceable display', 'glance', 'word')).toEqual([
      { text: 'A ', hidden: false },
      { text: 'glance', hidden: true },
      { text: 'able display', hidden: false },
    ]);
  });

  it('日本語は語の区切りを見ない。記号もそのまま探す', () => {
    expect(clozeParts('今日は僥倖だった', '僥倖', 'word')).toEqual([
      { text: '今日は', hidden: false },
      { text: '僥倖', hidden: true },
      { text: 'だった', hidden: false },
    ]);
    expect(hasCloze(clozeParts('use C++ (or C)', 'C++', 'word'))).toBe(true);
  });

  it('問いのカード・見つからない・空の言葉は伏せない', () => {
    expect(clozeParts('apple pie', 'apple', 'quiz')).toEqual([{ text: 'apple pie', hidden: false }]);
    expect(clozeParts('apple pie', 'pear', 'word')).toEqual([{ text: 'apple pie', hidden: false }]);
    expect(clozeParts('apple pie', '  ', 'word')).toEqual([{ text: 'apple pie', hidden: false }]);
  });
});

describe('promptSide', () => {
  it('逆向きの言葉のカードは裏を見せて表を答える。問いのカードは変えない', () => {
    expect(promptSide({ kind: 'word', front: 'apple', back: 'りんご' }, true)).toEqual({ prompt: 'りんご', answer: 'apple', reversed: true });
    expect(promptSide({ kind: 'word', front: 'apple', back: 'りんご' }, false)).toEqual({ prompt: 'apple', answer: 'りんご', reversed: false });
    expect(promptSide({ kind: 'quiz', front: '問い', back: '答え' }, true)).toEqual({ prompt: '問い', answer: '答え', reversed: false });
  });
});

describe('compareTyped', () => {
  it('同じ位置の文字が合うかで分け、続きはまとめる', () => {
    expect(compareTyped('aplle', 'apple')).toEqual({
      parts: [
        { text: 'ap', ok: true },
        { text: 'l', ok: false },
        { text: 'le', ok: true },
      ],
      exact: false,
    });
  });

  it('大文字小文字・全角・前後の空白はならして、ぴったりなら exact', () => {
    expect(compareTyped('  ＡＰＰＬＥ ', 'apple').exact).toBe(true);
    expect(compareTyped('apples', 'apple')).toEqual({ parts: [{ text: 'apple', ok: true }, { text: 's', ok: false }], exact: false });
    expect(compareTyped('', 'apple')).toEqual({ parts: [], exact: false });
  });
});

describe('pickChoices', () => {
  it('同じ種類・同じ出典・同じ度合いを先に混ぜ、正しいものを 1 つ入れる', () => {
    const source = { url: 'https://example.com/a', title: 'A' };
    const target = card({ back: '正', source, level: 3 });
    const best = card({ back: '同じ出典・度合い', source: { url: 'https://example.com/a#x', title: 'A' }, level: 3 });
    const sameSource = card({ back: '同じ出典', source, level: 1 });
    const sameLevel = card({ back: '同じ度合い', level: 3 });
    const quiz = card({ kind: 'quiz', back: '問いの答え', source, level: 3 });
    const plain = card({ back: 'ほか', level: 0 });
    const got = pickChoices(target, [target, plain, quiz, sameLevel, sameSource, best], false, fixedRandom([0.5]));
    expect(got).not.toBeNull();
    expect(got!.options).toHaveLength(4);
    expect(got!.options[got!.answer]).toBe('正');
    expect(got!.options.filter((o) => o !== '正').sort()).toEqual(['同じ出典', '同じ出典・度合い', '同じ度合い'].sort());
  });

  it('答えの重なるものは一つにし、3 つ取れなければ null', () => {
    const target = card({ back: 'りんご' });
    expect(pickChoices(target, [target, card({ back: 'りんご' }), card({ back: 'なし' }), card({ back: 'ナシ' })])).toBeNull();
    expect(pickChoices(target, [target, card({ back: 'なし' }), card({ back: 'もも' })])).toBeNull();
  });

  it('逆向きでは表を選ばせる', () => {
    const target = card({ front: 'apple', back: 'りんご' });
    const got = pickChoices(target, [target, card({ front: 'pear' }), card({ front: 'peach' }), card({ front: 'plum' })], true, fixedRandom([0.1, 0.2, 0.3, 0.99]));
    expect(got!.answer).toBe(3);
    expect(got!.options[3]).toBe('apple');
    expect(got!.options.slice(0, 3).sort()).toEqual(['peach', 'pear', 'plum']);
  });
});

describe('forecastDays', () => {
  it('今日の分には過ぎたものも入れ、14 日目より先は数えない', () => {
    const today = new Date(2026, 9, 22).getTime();
    const days = forecastDays(
      [
        { due: NOW - 10 * DAY },
        { due: NOW + 60_000 },
        { due: today + DAY }, // 明日の 0 時
        { due: today + 2 * DAY - 1 },
        { due: today + 13 * DAY + 5 },
        { due: today + 14 * DAY }, // 15 日目
      ],
      NOW,
    );
    expect(days).toHaveLength(14);
    expect(days[0]).toEqual({ start: today, count: 2 });
    expect(days[1].count).toBe(2);
    expect(days[13].count).toBe(1);
    expect(days.reduce((n, d) => n + d.count, 0)).toBe(5);
  });
});

describe('枯れかけ', () => {
  it('復習したことのあるカードが 7 日以上過ぎたら枯れかけ', () => {
    expect(overdueDays({ due: NOW - 7 * DAY, reviews: 2 }, NOW)).toBe(7);
    expect(isWilting({ due: NOW - 7 * DAY, reviews: 2 }, NOW)).toBe(true);
    expect(isWilting({ due: NOW - 6 * DAY - 1, reviews: 2 }, NOW)).toBe(false);
    expect(isWilting({ due: NOW - 30 * DAY, reviews: 0 }, NOW)).toBe(false);
    expect(overdueDays({ due: NOW + DAY, reviews: 3 }, NOW)).toBe(0);
  });
});

describe('読み上げ', () => {
  it('ASCII だけなら英語、ほかは日本語', () => {
    expect(speechLang("look up, isn't it")).toBe('en');
    expect(speechLang('café')).toBe('ja');
    expect(speechLang('僥倖')).toBe('ja');
  });

  it('端末の中の声だけから、言語の合う声を選ぶ（既定を先に）', () => {
    const voices = [
      { name: 'cloud', lang: 'en-US', localService: false, default: true },
      { name: 'a', lang: 'en-GB', localService: true, default: false },
      { name: 'b', lang: 'en_US', localService: true, default: true },
      { name: 'j', lang: 'ja-JP', localService: false, default: false },
    ];
    expect(pickVoice(voices, 'en')?.name).toBe('b');
    expect(pickVoice(voices, 'ja')).toBeNull();
  });
});
