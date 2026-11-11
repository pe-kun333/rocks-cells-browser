import { describe, expect, it } from 'vitest';
import { arrivedPhotoCard, canOpenPhotoTitle, PHOTO_BATCH_MAX, PHOTO_TITLE_LABEL, PHOTO_TITLE_LATER, photoBatch, photoSkipNote } from '../src/memo-board-photo';
import type { Reply } from '../src/threads';

const reply = (id: string, over: Partial<Reply> = {}): Reply => ({ id, parent: null, text: `カード ${id}`, createdAt: 1000, ...over });
const none = new Set<string>();

describe('photoBatch（一度に入れる写真）', () => {
  it('画像 12 枚と json 1 つは、先頭の画像 10 枚を take に、2 枚を skipped に', () => {
    const images = Array.from({ length: 12 }, (_, i) => ({ type: 'image/png', name: `p${i}` }));
    const files = [...images, { type: 'application/json', name: 'x' }];
    const { take, skipped } = photoBatch(files);
    expect(take).toHaveLength(PHOTO_BATCH_MAX);
    expect(take).toEqual(images.slice(0, PHOTO_BATCH_MAX));
    expect(skipped).toBe(2);
  });
  it('画像でないものは skipped に数えない', () => {
    const files = [{ type: 'application/json' }, { type: 'text/plain' }, { type: 'image/jpeg' }];
    expect(photoBatch(files)).toEqual({ take: [{ type: 'image/jpeg' }], skipped: 0 });
  });
  it('上限ちょうどなら skipped は 0', () => {
    const files = Array.from({ length: PHOTO_BATCH_MAX }, () => ({ type: 'image/webp' }));
    expect(photoBatch(files)).toEqual({ take: files, skipped: 0 });
  });
  it('空なら take も skipped も空', () => {
    expect(photoBatch([])).toEqual({ take: [], skipped: 0 });
  });
  it('順のまま残す（並べ替えない）', () => {
    const files = [{ type: 'image/png', n: 'b' }, { type: 'text/plain', n: 'x' }, { type: 'image/png', n: 'a' }];
    expect(photoBatch(files).take.map((f) => f.n)).toEqual(['b', 'a']);
  });
});

describe('photoSkipNote（入れきれなかった数の一行）', () => {
  it('2 枚のとき、決まった文', () => {
    expect(photoSkipNote(2)).toBe('2 枚は入れませんでした（一度に 10 枚まで）');
  });
  it('10 は PHOTO_BATCH_MAX から作る', () => {
    expect(photoSkipNote(3)).toContain(`一度に ${PHOTO_BATCH_MAX} 枚まで`);
  });
});

describe('arrivedPhotoCard（足された写真のカード）', () => {
  it('parent が null で、known に無く、image が shot の最初のカードの id', () => {
    const replies = [reply('a', { image: 'shot1' }), reply('b', { image: 'shot2' })];
    expect(arrivedPhotoCard(replies, none, 'shot2')).toBe('b');
  });
  it('known にあるカードは見つけない（次の同じ写真へ進む）', () => {
    const replies = [reply('a', { image: 'shot1' }), reply('b', { image: 'shot1' })];
    expect(arrivedPhotoCard(replies, new Set(['a']), 'shot1')).toBe('b');
  });
  it('返信（parent が null でない）は見つけない', () => {
    const replies = [reply('a'), reply('b', { parent: 'a', image: 'shot1' })];
    expect(arrivedPhotoCard(replies, none, 'shot1')).toBeNull();
  });
  it('無ければ null', () => {
    expect(arrivedPhotoCard([reply('a', { image: 'shot1' })], none, 'shot9')).toBeNull();
    expect(arrivedPhotoCard([], none, 'shot1')).toBeNull();
  });
});

describe('canOpenPhotoTitle（題の欄を開いてよいか）', () => {
  it('ほかで処理中なら、閉じていても開かない', () => {
    expect(canOpenPhotoTitle({ composing: null, text: '', busyElsewhere: true })).toBe(false);
  });
  it('閉じている → 開いてよい', () => {
    expect(canOpenPhotoTitle({ composing: null, text: '', busyElsewhere: false })).toBe(true);
  });
  it('足す欄が空 → 開いてよい', () => {
    expect(canOpenPhotoTitle({ composing: { kind: 'add' }, text: '', busyElsewhere: false })).toBe(true);
  });
  it('足す欄に字がある → 開かない（書きかけを壊さない）', () => {
    expect(canOpenPhotoTitle({ composing: { kind: 'add' }, text: '途中', busyElsewhere: false })).toBe(false);
  });
  it('書き直す欄は空でも開かない', () => {
    expect(canOpenPhotoTitle({ composing: { kind: 'edit', id: 'a' }, text: '', busyElsewhere: false })).toBe(false);
  });
});

describe('題の文言', () => {
  it('決まった文言', () => {
    expect(PHOTO_TITLE_LABEL).toBe('この写真の題（一行。Esc で付けずに閉じる）');
    expect(PHOTO_TITLE_LATER).toBe('題は F2 で付けられます');
  });
});
