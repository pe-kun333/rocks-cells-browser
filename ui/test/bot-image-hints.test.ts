// 段 D0：画像の隠す候補の種類判定の、今の挙動を固める（ui/src は変えない）
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/bridge', () => ({ surface: 'left', send: () => {}, onMessage: () => {}, request: async () => null }));

import { hintKindOf } from '../src/bot-image-hints';

describe('hintKindOf', () => {
  it('何も無ければ null。鍵らしき文字は、メールや電話番号より先', () => {
    expect(hintKindOf('')).toBeNull();
    expect(hintKindOf('hello')).toBeNull();
    expect(hintKindOf('sk-ant-abc')).toBe('secret');
    expect(hintKindOf('SK-ANT-XYZ')).toBe('secret');
    expect(hintKindOf('xai-token')).toBe('secret');
    expect(hintKindOf('AKIAEXAMPLE')).toBe('secret');
    expect(hintKindOf('api key')).toBe('secret');
    expect(hintKindOf('API KEY: abc')).toBe('secret');
    expect(hintKindOf('-----BEGIN PRIVATE KEY-----abc-----END PRIVATE KEY-----')).toBe('secret');
    expect(hintKindOf('ｓｋ－ａｎｔ－ａｂｃ')).toBe('secret');
    expect(hintKindOf('sk-ant-x user@example.com')).toBe('secret');
    expect(hintKindOf('sk-ant-x 090-1234-5678')).toBe('secret');
  });

  it('メールは空白を詰めた全文で見る。全角も半角にそろえる。電話番号より先', () => {
    expect(hintKindOf('user@example.com')).toBe('mail');
    expect(hintKindOf('a @ example.com')).toBe('mail');
    expect(hintKindOf('ｔｅｓｔ＠ｅｘａｍｐｌｅ．ｃｏｍ')).toBe('mail');
    expect(hintKindOf('a@b.c')).toBeNull();
    expect(hintKindOf('a@b.co')).toBe('mail');
    expect(hintKindOf('user@example.com 090-1234-5678')).toBe('mail');
  });

  it('電話番号は 0 で始まる 3 区画。各種の横棒を - にそろえ、全角の数字も見る', () => {
    expect(hintKindOf('090-1234-5678')).toBe('phone');
    expect(hintKindOf('０９０－１２３４－５６７８')).toBe('phone');
    expect(hintKindOf('090‐1234‐5678')).toBe('phone'); // U+2010
    expect(hintKindOf('090‑1234‑5678')).toBe('phone'); // U+2011
    expect(hintKindOf('090—1234—5678')).toBe('phone'); // U+2014
    expect(hintKindOf('090―1234―5678')).toBe('phone'); // U+2015
    expect(hintKindOf('090−1234−5678')).toBe('phone'); // U+2212
    expect(hintKindOf('090ー1234ー5678')).toBe('phone'); // U+30FC
    expect(hintKindOf('090－1234－5678')).toBe('phone'); // U+FF0D
    expect(hintKindOf('090 1234 5678')).toBeNull();
    expect(hintKindOf('09012345678')).toBeNull();
    expect(hintKindOf('+81-90-1234-5678')).toBeNull();
  });
});
