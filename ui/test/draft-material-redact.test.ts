// 段 D8b：材料の名前と本文にある渡し止めのアドレスを、組むときに伏せる（純粋関数）
import { describe, expect, it } from 'vitest';
import { CardMaterials, CellMaterials } from '../src/app/draft-sources';
import { serializeMaterials, takeMaterials } from '../src/draft-materials';

const HOSTS = ['secret.example'];
const MASK = '（渡し止めのアドレス）';
const BLOCKED = 'https://secret.example/a';
const OPEN = 'https://open.example/b';
const EMPTY_COUNTS = { items: 0, chars: 0, byKind: { page: 0, selection: 0, body: 0, cell: 0, card: 0 } };

describe('材料の文の渡し止め', () => {
  it('島の名前とメモ本文は伏せ、渡し止めでないアドレスは残る', () => {
    const set = CellMaterials.collect({
      hosts: HOSTS,
      island: {
        id: 'is1',
        name: `朝 ${BLOCKED}`,
        memos: [{ id: 'm1', text: `一行 ${OPEN}\n本文 ${BLOCKED}。`, pos: { q: 0, r: 0 } }],
      },
    });
    const island = set.items[0]!;
    const memo = set.items[1]!;
    expect(island.label).toBe(`朝 ${MASK}`);
    // 文の中のアドレスは、うしろの「」までをアドレスの塊として置き換える（redactBlockedUrls と同じ）
    expect(island.text).toBe(`島「朝 ${MASK}`);
    expect(memo.label).toBe(`一行 ${OPEN}`);
    expect(memo.text).toBe(`一行 ${OPEN}\n本文 ${MASK}`);
    const out = serializeMaterials(set.items);
    const blob = JSON.stringify(out);
    expect(blob).toContain(MASK);
    expect(blob).toContain(OPEN);
    expect(blob).not.toContain('secret.example');
    expect(out.wire.map((item) => item.text)).toEqual([`島「朝 ${MASK}`, `一行 ${OPEN}\n本文 ${MASK}`]);
  });

  it('セルの名前と本文も同じ', () => {
    const set = CellMaterials.collect({
      hosts: HOSTS,
      memos: [{ id: 'm1', text: `${BLOCKED}\n残す ${OPEN}` }],
    });
    const item = set.items[0]!;
    expect(item.label).toBe(MASK);
    expect(item.text).toBe(`${MASK}\n残す ${OPEN}`);
    expect(JSON.stringify(serializeMaterials(set.items))).not.toContain('secret.example');
    expect(serializeMaterials(set.items).block).toContain(OPEN);
  });

  it('カードの名前と本文も同じ', () => {
    const set = CardMaterials.collect({
      hosts: HOSTS,
      memoId: 'memo1',
      ids: ['r1'],
      replies: [{ id: 'r1', parent: null, text: `${BLOCKED} のカード\n本文 ${OPEN}`, createdAt: 1 }],
    });
    const item = set.items[0]!;
    expect(item.label).toBe(`${MASK} のカード`);
    expect(item.text).toBe(`${MASK} のカード\n本文 ${OPEN}`);
    const blob = JSON.stringify(serializeMaterials(set.items));
    expect(blob).toContain(MASK);
    expect(blob).toContain(OPEN);
    expect(blob).not.toContain('secret.example');
  });

  it('印を外した材料は、伏せたあとも直列化に入らない', () => {
    const set = takeMaterials(
      [
        { key: 'on', kind: 'cell', label: `名 ${BLOCKED}`, text: `本文 ${BLOCKED}`, on: true, ref: { kind: 'memo', id: 'a' } },
        { key: 'off', kind: 'card', label: '印外ラベルZZ', text: `印外本文ZZ ${BLOCKED}`, on: false, ref: { kind: 'card', memo: 'm', reply: 'r' } },
      ],
      { hosts: HOSTS },
    );
    const blob = JSON.stringify(serializeMaterials(set.items));
    expect(blob).toContain(MASK);
    expect(blob).not.toContain('印外ラベルZZ');
    expect(blob).not.toContain('印外本文ZZ');
    expect(blob).not.toContain('secret.example');
    expect(serializeMaterials(set.items).wire).toEqual([{ kind: 'cell', label: `名 ${MASK}`, text: `本文 ${MASK}` }]);
  });

  it('材料が無いときと、アドレスの無い文は、一覧を渡しても出力が変わらない', () => {
    expect(serializeMaterials([])).toEqual({ block: '', wire: [], counts: EMPTY_COUNTS });
    expect(takeMaterials([], { hosts: HOSTS })).toEqual(takeMaterials([]));
    expect(serializeMaterials(takeMaterials([], { hosts: HOSTS }).items)).toEqual(serializeMaterials([]));
    const withHosts = CellMaterials.collect({ hosts: HOSTS, memos: [{ id: 'm', text: 'ただのメモ' }] });
    const bare = CellMaterials.collect({ memos: [{ id: 'm', text: 'ただのメモ' }] });
    expect(serializeMaterials(withHosts.items)).toEqual(serializeMaterials(bare.items));
    const card = CardMaterials.collect({
      hosts: HOSTS,
      memoId: 'memo1',
      ids: ['r1'],
      replies: [{ id: 'r1', parent: null, text: 'カードの文', createdAt: 1 }],
    });
    const cardBare = CardMaterials.collect({
      memoId: 'memo1',
      ids: ['r1'],
      replies: [{ id: 'r1', parent: null, text: 'カードの文', createdAt: 1 }],
    });
    expect(serializeMaterials(card.items)).toEqual(serializeMaterials(cardBare.items));
  });
});
