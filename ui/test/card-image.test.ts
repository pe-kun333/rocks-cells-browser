// 単語カードの指す画像（K6）：読んでいる間・読めた・消えた・読み直し
import { describe, expect, it } from 'vitest';
import { CardImages } from '../src/card-image';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('CardImages', () => {
  it('読んでいる間は undefined、読めたら data URL、読めなければ null（どちらも 1 回だけ読む）', async () => {
    const calls: string[] = [];
    let changed = 0;
    const images = new CardImages({
      shot: async (id) => (calls.push(`shot:${id}`), 'data:image/png;base64,AAAA'),
      capture: async (id) => (calls.push(`capture:${id}`), null),
    });
    images.onChange(() => changed++);
    expect(images.get({ kind: 'shot', id: 's1' })).toBeUndefined();
    expect(images.get({ kind: 'shot', id: 's1' })).toBeUndefined(); // 読んでいる間に二度は読まない
    expect(images.get({ kind: 'capture', id: 'c1' })).toBeUndefined();
    await flush();
    expect(images.get({ kind: 'shot', id: 's1' })).toBe('data:image/png;base64,AAAA');
    expect(images.get({ kind: 'capture', id: 'c1' })).toBeNull();
    expect(calls).toEqual(['shot:s1', 'capture:c1']);
    expect(changed).toBe(2);
  });

  it('画像でない文字や読みの失敗は「消えた」。forgetMissing のあとは読み直す', async () => {
    let tries = 0;
    const images = new CardImages({
      shot: async () => 'not-an-image',
      capture: async () => {
        tries++;
        if (tries === 1) throw new Error('read');
        return 'data:image/jpeg;base64,BBBB';
      },
    });
    images.get({ kind: 'shot', id: 'x' });
    images.get({ kind: 'capture', id: 'y' });
    await flush();
    expect(images.get({ kind: 'shot', id: 'x' })).toBeNull();
    expect(images.get({ kind: 'capture', id: 'y' })).toBeNull();
    images.forgetMissing();
    expect(images.get({ kind: 'capture', id: 'y' })).toBeUndefined();
    await flush();
    expect(images.get({ kind: 'capture', id: 'y' })).toBe('data:image/jpeg;base64,BBBB');
  });
});
