// 段 D0：返事の文字を整える純粋関数の、今の挙動を固める（ui/src は変えない）
import { describe, expect, it } from 'vitest';
import { cleanBotLine, cleanBotText, cutChars, findSecretish, parsePending, stripUrlQuery } from '../src/bot-replies';

describe('cleanBotText', () => {
  it('改行を \\n にそろえ、見えない制御文字と向きを変える文字を消し、前後の空白を取る', () => {
    expect(cleanBotText('  a\r\nb\rc  ')).toBe('a\nb\nc');
    expect(cleanBotText('\u0000hello\u200e')).toBe('hello');
    expect(cleanBotText('\ufeffhello')).toBe('hello');
    expect(cleanBotText('a\tb')).toBe('a\tb');
    expect(cleanBotText('\ta\n')).toBe('a');
    expect(cleanBotText('a\u000b\u007f\u0085\u061c\u200f\u202ab\u2066c')).toBe('abc');
    expect(cleanBotText('a  b')).toBe('a  b');
  });
});

describe('cleanBotLine', () => {
  it('改行とタブも空白にして、空白を 1 つにまとめる', () => {
    expect(cleanBotLine('a\r\n\tb  c')).toBe('a b c');
    expect(cleanBotLine('  \n  ')).toBe('');
    expect(cleanBotLine('a\u0000b')).toBe('ab');
  });
});

describe('findSecretish', () => {
  it('鍵らしき並びを〔鍵n〕にし、同じ値は同じ番号。数は番号の数', () => {
    expect(findSecretish('何も無い')).toEqual({ count: 0, masked: '何も無い' });
    expect(findSecretish('')).toEqual({ count: 0, masked: '' });
    const once = findSecretish('prefix sk-ant-abc123 suffix');
    expect(once).toEqual({ count: 1, masked: 'prefix 〔鍵1〕 suffix' });
    expect(once.masked).not.toContain('sk-ant-abc123');
    expect(findSecretish('sk-ant-abc sk-ant-abc')).toEqual({ count: 1, masked: '〔鍵1〕 〔鍵1〕' });
    expect(findSecretish('sk-ant-aaa xai-bbb')).toEqual({ count: 2, masked: '〔鍵1〕 〔鍵2〕' });
    expect(findSecretish('sk-ant-a xai-b', 3)).toEqual({ count: 2, masked: '〔鍵3〕 〔鍵4〕' });
    expect(findSecretish('AKIAXXXX', 5)).toEqual({ count: 1, masked: '〔鍵5〕' });
    expect(findSecretish('xxsk-ant-abc')).toEqual({ count: 1, masked: 'xx〔鍵1〕' });
  });

  it('api key は区切りのあとがあれば値まで、無ければ語だけ。PRIVATE KEY の塊は END まで', () => {
    expect(findSecretish('the api key is here')).toEqual({ count: 1, masked: 'the 〔鍵1〕 is here' });
    expect(findSecretish('api key: super-secret tail')).toEqual({ count: 1, masked: '〔鍵1〕 tail' });
    expect(findSecretish('api key: "quoted" tail')).toEqual({ count: 1, masked: '〔鍵1〕 tail' });
    expect(findSecretish('see api key, next')).toEqual({ count: 1, masked: 'see 〔鍵1〕, next' });
    expect(findSecretish('api key: one api key: two')).toEqual({ count: 2, masked: '〔鍵1〕 〔鍵2〕' });
    expect(findSecretish('API KEY = VALUE')).toEqual({ count: 1, masked: '〔鍵1〕' });
    expect(findSecretish('private key')).toEqual({ count: 1, masked: '〔鍵1〕' });
    const block = findSecretish('前\n-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n後');
    expect(block).toEqual({ count: 1, masked: '前\n〔鍵1〕\n後' });
    expect(block.masked).not.toContain('abc');
    expect(block.masked).not.toContain('BEGIN');
  });
});

describe('stripUrlQuery', () => {
  it('最初の ? か # から後ろを消す。前後の空白やスキームは見ない', () => {
    expect(stripUrlQuery('https://ex.com/a?b=1&c=2#h')).toBe('https://ex.com/a');
    expect(stripUrlQuery('https://ex.com/a#h?b')).toBe('https://ex.com/a');
    expect(stripUrlQuery('https://ex.com/a')).toBe('https://ex.com/a');
    expect(stripUrlQuery(' https://ex.com/a?x')).toBe(' https://ex.com/a');
    expect(stripUrlQuery('?only')).toBe('');
    expect(stripUrlQuery('#only')).toBe('');
    expect(stripUrlQuery('')).toBe('');
  });
});

describe('cutChars', () => {
  it('最初の max 字を、符号の位置ではなく文字の数で切る', () => {
    expect(cutChars('abcdef', 3)).toEqual({ text: 'abc', cut: true });
    expect(cutChars('ab', 3)).toEqual({ text: 'ab', cut: false });
    expect(cutChars('ab', 2)).toEqual({ text: 'ab', cut: false });
    expect(cutChars('', 0)).toEqual({ text: '', cut: false });
    expect(cutChars('a', 0)).toEqual({ text: '', cut: true });
    expect(cutChars('あいう', 2)).toEqual({ text: 'あい', cut: true });
    expect(cutChars('😀', 1)).toEqual({ text: '😀', cut: false });
    expect(cutChars('😀😀', 2)).toEqual({ text: '😀😀', cut: false });
    expect(cutChars(`😀a`, 1)).toEqual({ text: '😀', cut: true });
    expect(cutChars('a😀', 1)).toEqual({ text: 'a', cut: true });
  });
});

describe('parsePending の origin', () => {
  const base = {
    requestId: 'hb-20261026-0001-abcd',
    check: 'abcdefghij',
    createdAt: 1,
    status: 'done',
    textChars: 3,
  };

  it('origin の無い古いファイルはそのまま読める', () => {
    const out = parsePending({ version: 1, requests: [base] });
    expect(out.requests).toHaveLength(1);
    expect(out.requests[0]?.requestId).toBe(base.requestId);
    expect(out.requests[0]).not.toHaveProperty('origin');
  });

  it('カードの出どころだけ残し、形の違うもの・11 件目以降は落とす', () => {
    const cards = Array.from({ length: 11 }, (_, i) => ({ kind: 'card', memo: `m${i}`, reply: `r${i}` }));
    const out = parsePending({
      version: 1,
      requests: [
        {
          ...base,
          origin: [cards[0], { kind: 'tab', uid: 't1' }, { kind: 'card', memo: '悪い id', reply: 'r' }, { kind: 'card', memo: 'm0', reply: 'r0' }, ...cards.slice(1)],
          later: true,
        },
      ],
    });
    expect(out.requests[0]?.origin).toEqual(cards.slice(0, 10));
    expect(out.requests[0]).not.toHaveProperty('later');
  });
});
