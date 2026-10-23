// テストの仕組みの確かめ（vitest）。DOM を使わない関数だけを試す
import { describe, expect, it } from 'vitest';
import { changeTagList, normalizeTag, normalizeTags } from '../src/tags';

describe('tags', () => {
  it('先頭の # と空白を除き、30 字で切る', () => {
    expect(normalizeTag('  #レビュー ')).toBe('レビュー');
    expect([...normalizeTag('あ'.repeat(40))].length).toBe(30);
  });
  it('重複を除き 10 個まで', () => {
    const many = Array.from({ length: 15 }, (_, i) => `t${i}`);
    expect(normalizeTags([...many, 't0'])).toHaveLength(10);
  });
  it('足し引き：変わらなければ null', () => {
    expect(changeTagList(['a'], ['a'], []).tags).toBeNull();
    expect(changeTagList(['a'], ['b'], ['a']).tags).toEqual(['b']);
  });
});
