import { describe, expect, it } from 'vitest';
import { cardFace } from '../src/memo-card-board-view';
import type { Reply } from '../src/threads';

const reply = (id: string, over: Partial<Reply> = {}): Reply => ({ id, parent: null, text: '', createdAt: 1000, ...over });
const place = { x: 0, y: 0, saved: true };

describe('顔の小さな絵（CB16・決定 1）', () => {
  it('画像だけのカードは thumb に shots の id', () => {
    const r = reply('a', { text: '紙のメモ', image: 'shot1' });
    expect(cardFace([r], r, place)).toMatchObject({ thumb: 'shot1', first: '紙のメモ', rest: '' });
  });
  it('引用と画像の両方があるカードは、題と印のまま', () => {
    const r = reply('a', { image: 'shot1', quote: { text: '文', url: 'https://example.com/', title: '題' } });
    expect(cardFace([r], r, place).thumb).toBe('');
  });
  it('文だけのカードには出さない', () => {
    const r = reply('a', { text: '文' });
    expect(cardFace([r], r, place).thumb).toBe('');
  });
});
