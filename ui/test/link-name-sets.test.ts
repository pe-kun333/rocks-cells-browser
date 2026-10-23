// 呼称セット（台帳は全部のメモで共通、使うセットはメモごと）。DOM は使わない
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/bridge', () => ({ surface: 'left', send: () => {}, onMessage: () => {}, request: async () => ({}) }));

import {
  applyLinkNameSetOp,
  emptyLinkNameBook,
  MAX_LINK_NAME_SETS,
  normalizeLinkNameBook,
  resolvedLinkKindNames,
} from '../src/link-name-sets';
import { applyLinkKindNames, LINK_KINDS, linkKindInfo, parseLink } from '../src/memo-card-links';
import { INTERCHANGE_FORMAT, parseInterchange } from '../src/memo-interchange';
import { MemoStore, parseMemo } from '../src/memocells';

afterEach(() => applyLinkKindNames(undefined));

const cards = [
  { id: 'c1', parent: null, text: '甲', createdAt: 1, links: [{ to: 'c2', kind: 'ground', name: '理由', set: 'x' }, { to: 'c2', kind: 'custom' }] },
  { id: 'c2', parent: null, text: '乙', createdAt: 2, links: [{ to: 'c1', kind: 'counter' }] },
];
const replies = [
  { id: 'c1', parent: null, text: '甲', createdAt: 1, links: [{ to: 'c2', kind: 'ground' as const }] },
  { id: 'c2', parent: null, text: '乙', createdAt: 2, links: [{ to: 'c1', kind: 'counter' as const }] },
];

describe('呼称セットの台帳', () => {
  it('知らない項目や壊れたセットを読み飛ばし、名前は 10 字・元の名前は捨てる', () => {
    const book = normalizeLinkNameBook({
      version: 2,
      current: '全体では使わない',
      extra: true,
      sets: [
        { id: 'read', name: '  読書 用  ', names: { ground: '引用元ですけれども長い', same: '同じ', nope: 'x' }, mystery: 1 },
        null,
        { id: 'read', name: '', names: { ask: '問い' } },
        { name: 5, names: [] },
        'bad',
      ],
    });
    expect(book.version).toBe(1);
    expect('current' in book).toBe(false);
    expect(book.sets).toHaveLength(3);
    expect(book.sets[0]).toEqual({ id: 'read', name: '読書 用', names: { ground: '引用元ですけれども長' } });
    expect(book.sets[1].id).not.toBe('read');
    expect(book.sets[1].name).toBe('セット2');
    expect(book.sets[1].names).toEqual({ ask: '問い' });
    expect(book.sets[2]).toEqual({ id: 'n3', name: '5', names: {} });
  });

  it('台帳が無い・形が違うときは空', () => {
    expect(normalizeLinkNameBook(null)).toEqual(emptyLinkNameBook());
    expect(normalizeLinkNameBook('x')).toEqual(emptyLinkNameBook());
    expect(normalizeLinkNameBook({ sets: {} })).toEqual(emptyLinkNameBook());
  });

  it('セットは 12 個まで足せて、名前の変更・6 つの名前・削除ができる', () => {
    let book = emptyLinkNameBook();
    let id = '';
    for (let i = 0; i < MAX_LINK_NAME_SETS; i++) {
      const added = applyLinkNameSetOp(book, { type: 'add', name: i === 0 ? '  読書  ' : `s${i}`, names: { ground: '引用元', counter: '反論' } });
      expect(added.changed).toBe(true);
      book = added.book;
      if (i === 0) id = added.id ?? '';
    }
    expect(book.sets).toHaveLength(12);
    expect(book.sets[0].names).toEqual({ ground: '引用元' });
    const full = applyLinkNameSetOp(book, { type: 'add', name: 'あふれる' });
    expect(full.changed).toBe(false);
    expect(full.id).toBeNull();
    expect(full.book.sets).toHaveLength(12);

    const snapshot = JSON.parse(JSON.stringify(book)) as unknown;
    const renamed = applyLinkNameSetOp(book, { type: 'rename', id, name: '論文' });
    expect(book).toEqual(snapshot);
    expect(renamed.changed).toBe(true);
    expect(renamed.book.sets[0].name).toBe('論文');
    expect(applyLinkNameSetOp(renamed.book, { type: 'rename', id, name: '   ' }).changed).toBe(false);

    const named = applyLinkNameSetOp(renamed.book, { type: 'setNames', id, names: { next: '次の章', ask: '疑問' } });
    expect(named.book.sets[0].names).toEqual({ next: '次の章' });
    expect(applyLinkNameSetOp(named.book, { type: 'setNames', id, names: { next: '次の章' } }).changed).toBe(false);

    const removed = applyLinkNameSetOp(named.book, { type: 'remove', id });
    expect(removed.id).toBe(id);
    expect(removed.book.sets).toHaveLength(11);
    expect(removed.book.sets.some((s) => s.id === id)).toBe(false);
    expect(applyLinkNameSetOp(removed.book, { type: 'remove', id }).changed).toBe(false);
  });
});

describe('名前の決まり方', () => {
  it('選んでいなければこのメモの名前、選んでいればセット、消えたセットはこのメモの名前に戻る', () => {
    const added = applyLinkNameSetOp(emptyLinkNameBook(), { type: 'add', name: '読書', names: { ground: '引用元', next: '次の章' } });
    const plain = applyLinkNameSetOp(added.book, { type: 'add', name: 'そのまま', names: { ground: '根拠' } });
    const read = added.id ?? '';
    const same = plain.book.sets.find((s) => s.name === 'そのまま')?.id ?? '';
    expect(plain.book.sets.find((s) => s.id === same)?.names).toEqual({});

    expect(resolvedLinkKindNames({ linkNames: { ground: '理由' } }, plain.book)).toEqual({ ground: '理由' });
    expect(resolvedLinkKindNames({}, plain.book)).toBeUndefined();
    expect(resolvedLinkKindNames(null, plain.book)).toBeUndefined();
    expect(resolvedLinkKindNames({ linkSet: read, linkNames: { ground: '理由' } }, plain.book)).toEqual({ ground: '引用元', next: '次の章' });
    expect(resolvedLinkKindNames({ linkSet: same, linkNames: { ground: '理由' } }, plain.book)).toBeUndefined();
    expect(resolvedLinkKindNames({ linkSet: 'gone', linkNames: { ground: '理由' } }, plain.book)).toEqual({ ground: '理由' });

    const removed = applyLinkNameSetOp(plain.book, { type: 'remove', id: read });
    expect(resolvedLinkKindNames({ linkSet: read, linkNames: { ground: '理由' } }, removed.book)).toEqual({ ground: '理由' });
  });

  it('名前を当てても色と形は変わらない', () => {
    const before = LINK_KINDS.map((k) => ({ kind: k.kind, color: k.color, head: k.head, dashed: k.dashed }));
    applyLinkKindNames({ ground: '引用元' });
    expect(linkKindInfo('ground').name).toBe('引用元');
    expect(linkKindInfo('counter').name).toBe('反論');
    expect(LINK_KINDS.map((k) => ({ kind: k.kind, color: k.color, head: k.head, dashed: k.dashed }))).toEqual(before);
    applyLinkKindNames(undefined);
    expect(linkKindInfo('ground').name).toBe('根拠');
  });
});

describe('関連の保存', () => {
  it('線には種類の id だけが残り、名前やセットの印は読まない', () => {
    expect(parseLink({ to: 'c2', kind: 'ask', name: '問い', set: 'read' })).toEqual({ to: 'c2', kind: 'ask' });
    expect(parseLink({ to: 'c2', kind: 'made-up' })).toBeNull();
  });

  it('昔のメモ（linkSet が無い）も、名前の項目が付いた線も、関連は残る', () => {
    const old = parseMemo({ id: 'm1', pos: { q: 0, r: 0 }, text: '昔', createdAt: 1, updatedAt: 2, replies: cards });
    expect(old?.linkSet).toBeUndefined();
    expect(old?.linkNames).toBeUndefined();
    expect(old?.replies?.[0].links).toEqual([{ to: 'c2', kind: 'ground' }]);
    expect(old?.replies?.[1].links).toEqual([{ to: 'c1', kind: 'counter' }]);
    expect(parseMemo(old)).toEqual(old);

    const next = parseMemo({
      id: 'm1',
      pos: { q: 1, r: 0 },
      text: '今',
      createdAt: 3,
      updatedAt: 4,
      linkNames: { ground: '理由', counter: '反論', nope: 'x' },
      linkSet: 'nreading',
      extra: 1,
      replies: cards,
    });
    expect(next?.linkNames).toEqual({ ground: '理由' });
    expect(next?.linkSet).toBe('nreading');
    expect(next?.replies?.[0].links).toEqual([{ to: 'c2', kind: 'ground' }]);
    expect(parseMemo({ ...next, linkSet: '壊れた id' })?.linkSet).toBeUndefined();
    expect(parseMemo({ ...next, linkSet: '壊れた id' })?.replies?.[0].links).toEqual([{ to: 'c2', kind: 'ground' }]);
  });

  it('メモにセットを選んでも、線とこのメモの名前は残る。消すと選んでいたメモだけ外れる', () => {
    const store = new MemoStore();
    const a = store.add({ pos: { q: 0, r: 0 }, text: 'a', replies });
    const b = store.add({ pos: { q: 1, r: 0 }, text: 'b' });
    const c = store.add({ pos: { q: 2, r: 0 }, text: 'c' });
    const portal = store.add({ pos: { q: 3, r: 0 }, text: '', portal: 'shabc' });
    expect(a && b && c && portal).toBeTruthy();
    if (!a || !b || !c || !portal) return;
    const stamp = a.updatedAt;
    expect(store.setLinkNames(a.id, { ground: '理由' })).toBe(true);
    expect(store.setLinkSet(a.id, 'nshared')).toBe(true);
    expect(store.setLinkSet(b.id, 'nshared')).toBe(true);
    expect(store.setLinkSet(c.id, 'nother')).toBe(true);
    expect(store.setLinkSet(portal.id, 'nshared')).toBe(false);
    expect(store.setLinkSet(a.id, 'has space')).toBe(false);
    expect(a.linkSet).toBe('nshared');
    expect(a.linkNames).toEqual({ ground: '理由' });
    expect(a.updatedAt).toBe(stamp);
    expect(a.replies?.[0].links).toEqual([{ to: 'c2', kind: 'ground' }]);

    const again = parseMemo(JSON.parse(JSON.stringify(a)));
    expect(again?.linkSet).toBe('nshared');
    expect(again?.linkNames).toEqual({ ground: '理由' });
    expect(again?.replies?.[0].links).toEqual([{ to: 'c2', kind: 'ground' }]);

    expect(store.clearLinkSet('nshared')).toBe(true);
    expect(store.get(a.id)?.linkSet).toBeUndefined();
    expect(store.get(b.id)?.linkSet).toBeUndefined();
    expect(store.get(c.id)?.linkSet).toBe('nother');
    expect(store.get(a.id)?.linkNames).toEqual({ ground: '理由' });
    expect(store.get(a.id)?.replies?.[0].links).toEqual([{ to: 'c2', kind: 'ground' }]);
    expect(store.clearLinkSet('壊れた')).toBe(false);
  });

  it('書き出しではセットの選択とメモの名前を捨て、関連の線は残す', () => {
    const parsed = parseInterchange({
      format: INTERCHANGE_FORMAT,
      version: 1,
      sheet: { name: 'メイン' },
      memos: [
        {
          id: 'm1',
          text: 'メモ',
          linkNames: { ground: '理由' },
          linkSet: 'n1',
          replies: [{ id: 'c1', parent: null, text: '甲', links: [{ to: 'c2', kind: 'next', name: 'つづき' }] }],
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc.memos[0].dropped).toEqual({ linkNames: { ground: '理由' }, linkSet: 'n1' });
    expect(parsed.doc.memos[0].cards[0].links).toEqual([{ to: 'c2', kind: 'next', name: 'つづき' }]);
    expect(parsed.doc.memos[0].cards[0].dropped).toEqual({});
  });
});
