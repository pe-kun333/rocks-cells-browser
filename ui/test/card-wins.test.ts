// カードの小窓（P1）の一覧：出す・前へ回す・いっぱい・閉じる・動かす・読み直し
import { describe, expect, it } from 'vitest';
import { closeWin, MAX_CARD_WINS, moveWin, openWin, parseCardWins, type CardWin } from '../src/card-wins';

const w = (key: string, kind: CardWin['kind'] = 'memo'): CardWin => ({ kind, key, x: 0, y: 0 });

describe('card-wins', () => {
  it('出す・同じ物は前へ回すだけ', () => {
    let list = openWin([], w('a'))!;
    list = openWin(list, w('b', 'tab'))!;
    list = openWin(list, { ...w('a'), x: 99 })!;
    expect(list.map((x) => x.key)).toEqual(['b', 'a']);
    expect(list[1].x).toBe(0); // 位置は前のまま
  });
  it('いっぱいなら出せない。見つからない物があれば外して出す', () => {
    let list: CardWin[] = [];
    for (let i = 0; i < MAX_CARD_WINS; i++) list = openWin(list, w(`m${i}`))!;
    expect(openWin(list, w('x'))).toBeNull();
    const next = openWin(list, w('x'), (x) => x.key !== 'm2')!;
    expect(next.map((x) => x.key)).not.toContain('m2');
    expect(next.at(-1)!.key).toBe('x');
  });
  it('閉じる・動かす', () => {
    const list = [w('a'), w('a', 'tab')];
    expect(closeWin(list, { kind: 'tab', key: 'a' })).toEqual([w('a')]);
    expect(moveWin(list, { kind: 'memo', key: 'a' }, { x: 10.4, y: 20.6 })[0]).toEqual({ kind: 'memo', key: 'a', x: 10, y: 21 });
  });
  it('壊れた物・重なった物は読まない', () => {
    expect(parseCardWins(null)).toEqual([]);
    expect(parseCardWins([w('a'), w('a'), { kind: 'x', key: 'b', x: 0, y: 0 }, { kind: 'tab', key: '', x: 0, y: 0 }, { kind: 'tab', key: 'c', x: 'a', y: 0 }])).toEqual([w('a')]);
  });
});
