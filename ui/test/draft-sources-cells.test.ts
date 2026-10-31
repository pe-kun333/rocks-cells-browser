// 段 D3：左のセルと島を材料にする変換（純粋関数）。画面も台帳も触らない
import { describe, expect, it } from 'vitest';
import { serializeMaterials } from '../src/draft-materials';
import { CELL_ON_MAX, CellMaterials, type CellMemoCopy, type CellTabCopy } from '../src/app/draft-sources';

const tab = (uid: string, extra: Partial<CellTabCopy> = {}): CellTabCopy => ({
  uid,
  title: extra.title ?? `題${uid}`,
  url: extra.url ?? `https://ex.com/${uid}`,
  ...extra,
});

const memo = (id: string, text = `一行${id}\n本文${id}`, extra: Partial<CellMemoCopy> = {}): CellMemoCopy => ({
  id,
  text,
  ...extra,
});

describe('タブのセル 1 個', () => {
  it('題名・?# を消した URL・ひとこと。印はオン。ページの本文は無い', () => {
    const set = CellMaterials.collect({
      tabs: [tab('u1', { title: '朝の記事', url: 'https://ex.com/a?q=1#h', comment: 'セルのひとこと' })],
    });
    expect(set.dropped).toBe(0);
    expect(set.empty).toBe(0);
    expect(set.blocked).toBe(0);
    expect(set.items).toHaveLength(1);
    const item = set.items[0]!;
    expect(item.kind).toBe('cell');
    expect(item.on).toBe(true);
    expect(item.label).toBe('朝の記事');
    expect(item.url).toBe('https://ex.com/a');
    expect(item.text).toBe('セルのひとこと');
    expect(item.ref).toEqual({ kind: 'tab', uid: 'u1' });
    expect(item.key).toBe('tab:u1');
    expect(set.items.every((row) => row.kind === 'cell')).toBe(true);
    const wire = serializeMaterials(set.items);
    expect(wire.block).toBe('材料 1/1（タブのセル「朝の記事」）：\nセルのひとこと\nhttps://ex.com/a');
    const off = { ...item, on: false };
    const hidden = JSON.stringify(serializeMaterials([off]));
    expect(hidden).not.toContain('セルのひとこと');
    expect(hidden).not.toContain('朝の記事');
    expect(hidden).not.toContain('ex.com');
  });
});

describe('メモのセル', () => {
  it('1 行目を名前にし、本文は 2,000 字まで。出典の URL は付けない', () => {
    const set = CellMaterials.collect({ memos: [memo('m1', `${'あ'.repeat(2_001)}`)] });
    expect(set.items).toHaveLength(1);
    const item = set.items[0]!;
    expect(item.ref).toEqual({ kind: 'memo', id: 'm1' });
    expect(item.label).toBe('あ'.repeat(40));
    expect(item.text).toHaveLength(2_000);
    expect(item.cut).toBe(true);
    expect(item.on).toBe(true);
    expect(item.url).toBeUndefined();
    expect(serializeMaterials([item]).block.startsWith('材料 1/1（メモのセル「')).toBe(true);
  });
});

describe('入れないセル', () => {
  it('入口・ボット・アプリ・撮ったものは一覧にも empty にも dropped にも入らない', () => {
    const set = CellMaterials.collect({
      memos: [
        memo('portal', '入口', { portal: 'sheet-2' }),
        memo('bot', 'ボット', { bot: 'b1' }),
        memo('app', 'アプリ', { app: 'a1' }),
        memo('cap', '撮影', { capture: 'c1' }),
        memo('keep', '残す'),
      ],
    });
    expect(set.items.map((item) => item.ref)).toEqual([{ kind: 'memo', id: 'keep' }]);
    expect(set.empty).toBe(0);
    expect(set.dropped).toBe(0);
    expect(set.blocked).toBe(0);
  });

  it('文も URL も無いタブは empty。空のメモも empty', () => {
    const set = CellMaterials.collect({
      tabs: [tab('blank', { title: '題だけ', url: 'ftp://files.example/a', comment: '' })],
      memos: [memo('empty', '   \n  ')],
    });
    expect(set.items).toHaveLength(0);
    expect(set.empty).toBe(2);
  });
});

describe('渡し止め', () => {
  it('タブは材料に入らず、外した数と一行を載せる', () => {
    const set = CellMaterials.collect({
      tabs: [
        tab('ok', { title: '残る' }),
        tab('no1', { url: 'https://secret.example/a?x=1', comment: '渡さない文' }),
        tab('no2', { url: 'https://secret.example/b' }),
      ],
      blocked: (url) => url.includes('secret.example'),
    });
    expect(set.items.map((item) => item.label)).toEqual(['残る']);
    expect(JSON.stringify(set.items)).not.toContain('渡さない文');
    expect(JSON.stringify(set.items)).not.toContain('secret.example');
    expect(set.blocked).toBe(2);
    expect(set.notes).toEqual(['渡し止めのサイトのタブ 2 個は外しました（このサイトは渡しません）']);
  });
});

describe('重なりと並び', () => {
  it('同じ uid は先の 1 件。盤面の位置があれば行・列の順。無ければ渡した順', () => {
    const dup = CellMaterials.collect({
      tabs: [tab('u', { title: '先' }), tab('u', { title: 'あと' }), tab('v', { title: '別' })],
    });
    expect(dup.dropped).toBe(0);
    expect(dup.items.map((item) => item.label)).toEqual(['先', '別']);
    const board = CellMaterials.collect({
      tabs: [tab('b', { pos: { q: 0, r: 1 } }), tab('a', { pos: { q: 0, r: 0 } })],
      memos: [memo('m', 'メモ', { pos: { q: 2, r: 0 } })],
    });
    expect(board.items.map((item) => item.key)).toEqual(['tab:a', 'memo:m', 'tab:b']);
    const given = CellMaterials.collect({
      tabs: [tab('b'), tab('a')],
      memos: [memo('m')],
    });
    expect(given.items.map((item) => item.key)).toEqual(['tab:b', 'tab:a', 'memo:m']);
  });
});

describe('先頭 8 件と上限', () => {
  it('12 件は先頭 8 件がオン、残り 4 件はオフのまま一覧に残る', () => {
    const set = CellMaterials.collect({
      tabs: Array.from({ length: 12 }, (_, i) => tab(`t${i}`, { title: `題${i}` })),
    });
    expect(CELL_ON_MAX).toBe(8);
    expect(set.items).toHaveLength(12);
    expect(set.dropped).toBe(0);
    expect(set.items.slice(0, 8).every((item) => item.on)).toBe(true);
    expect(set.items.slice(8).every((item) => !item.on)).toBe(true);
    expect(set.notes).toEqual([]);
  });

  it('31 件目は落とす。オフの長い文は合計字数で消えない', () => {
    const over = CellMaterials.collect({
      memos: Array.from({ length: 31 }, (_, i) => memo(`m${i}`, `文${i}`)),
    });
    expect(over.items).toHaveLength(30);
    expect(over.dropped).toBe(1);
    expect(over.items.some((item) => item.ref?.kind === 'memo' && item.ref.id === 'm30')).toBe(false);
    expect(over.notes).toEqual(['上限を超えた 1 件は外しました']);
    const longs = CellMaterials.collect({
      memos: Array.from({ length: 12 }, (_, i) => memo(`l${i}`, 'あ'.repeat(2_000))),
    });
    expect(longs.items).toHaveLength(12);
    expect(longs.items.filter((item) => item.on).map((item) => (item.ref?.kind === 'memo' ? item.ref.id : ''))).toEqual(['l0', 'l1', 'l2', 'l3', 'l4', 'l5']);
    expect(longs.items.filter((item) => !item.on).map((item) => (item.ref?.kind === 'memo' ? item.ref.id : ''))).toEqual(['l6', 'l7', 'l8', 'l9', 'l10', 'l11']);
    expect(longs.dropped).toBe(0);
    expect(longs.notes).toEqual(['字数の上限を超える 2 件は印を外しました']);
  });
});

describe('島', () => {
  it('名前がオン。入っているメモは先頭 8 件がオン、残りはオフ。特別なセルは入れない', () => {
    const set = CellMaterials.collect({
      tabs: [tab('outside', { title: '島の外' })],
      island: {
        id: 'is1',
        name: '朝の島',
        memos: [
          memo('late', '遅い', { pos: { q: 5, r: 1 } }),
          ...Array.from({ length: 8 }, (_, i) => memo(`n${i}`, `メモ${i}`, { pos: { q: i, r: 0 } })),
          memo('portal', '入口', { portal: 's', pos: { q: 0, r: 0 } }),
        ],
      },
    });
    expect(set.items[0]).toMatchObject({ key: 'island:is1', on: true, label: '朝の島', text: '島「朝の島」', ref: { kind: 'island', id: 'is1' } });
    expect(serializeMaterials([set.items[0]!]).block).toBe('材料 1/1（島「朝の島」）：\n島「朝の島」');
    const rest = set.items.slice(1);
    expect(rest.map((item) => (item.ref?.kind === 'memo' ? item.ref.id : item.key))).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'late']);
    expect(rest.slice(0, 8).every((item) => item.on)).toBe(true);
    expect(rest[8]?.on).toBe(false);
    expect(JSON.stringify(set.items)).not.toContain('島の外');
    expect(JSON.stringify(set.items)).not.toContain('入口');
    expect(set.items.every((item) => item.kind === 'cell')).toBe(true);
  });
});
