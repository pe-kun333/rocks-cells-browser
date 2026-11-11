import { readFileSync as readFile } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOARD_CARD, type BoardView } from '../src/memo-card-board';
import { ARRIVAL_FLASH_MS, arrivedCards, edgeChipAt } from '../src/memo-card-board-view';
import type { Reply } from '../src/threads';

const css = readFile(new URL('../src/grok-cards.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const reply = (id: string, over: Partial<Reply> = {}): Reply => ({ id, parent: null, text: `カード ${id}`, createdAt: 1000, ...over });
const view = (over: Partial<BoardView> = {}): BoardView => ({ x: 0, y: 0, zoom: 1, ...over });
const VIEWPORT = { w: 800, h: 600 };
const none = new Set<string>();

describe('arrivedCards（足したカード）', () => {
  it('写しに新しく現れた一番上のカードだけ（返信は入らない）', () => {
    const replies = [reply('a'), reply('b', { parent: 'a' }), reply('c')];
    expect(arrivedCards(new Set(['a']), replies, none)).toEqual(['c']);
  });
  it('pending にあるもの（ボードの中から足した分）は入らない', () => {
    const replies = [reply('a'), reply('b')];
    expect(arrivedCards(none, replies, new Set(['a']))).toEqual(['b']);
  });
  it('known にあるものは入らない', () => {
    const replies = [reply('a'), reply('b'), reply('c')];
    expect(arrivedCards(new Set(['a', 'b']), replies, none)).toEqual(['c']);
  });
  it('作った順のまま（並べ替えない）', () => {
    const replies = [reply('z'), reply('m')];
    expect(arrivedCards(none, replies, none)).toEqual(['z', 'm']);
  });
});

describe('edgeChipAt（面の外のカードの札）', () => {
  it('右の外のカードは →。札は右端に寄り、高さはカードの高さのまま', () => {
    // 札の中心の x は、面の右端から 80（札の半分）＋ 6 の所
    expect(edgeChipAt(view(), { x: 900, y: 100 }, VIEWPORT, [])).toEqual({ arrow: '→', x: VIEWPORT.w - 86, y: 100 + BOARD_CARD.h / 2 });
  });
  it('上の外のカードは ↑。札の y は 14', () => {
    expect(edgeChipAt(view(), { x: 300, y: -500 }, VIEWPORT, [])).toEqual({ arrow: '↑', x: 300 + BOARD_CARD.w / 2, y: 14 });
  });
  it('下の外のカードは ↓。札の y は面の下端から 14 の所', () => {
    expect(edgeChipAt(view(), { x: 300, y: 900 }, VIEWPORT, [])).toEqual({ arrow: '↓', x: 300 + BOARD_CARD.w / 2, y: VIEWPORT.h - 14 });
  });
  it('左の外のカードは ←。札の x は 86', () => {
    expect(edgeChipAt(view(), { x: -500, y: 100 }, VIEWPORT, [])).toEqual({ arrow: '←', x: 86, y: 100 + BOARD_CARD.h / 2 });
  });
  it('右と下の両方にはみ出すときは、はみ出しの大きいほう', () => {
    expect(edgeChipAt(view(), { x: 900, y: 550 }, VIEWPORT, []).arrow).toBe('→'); // 右へ 290、下へ 46
    expect(edgeChipAt(view(), { x: 700, y: 900 }, VIEWPORT, []).arrow).toBe('↓'); // 右へ 90、下へ 396
  });
  it('全部見えていれば ↓', () => {
    expect(edgeChipAt(view(), { x: 100, y: 100 }, VIEWPORT, []).arrow).toBe('↓');
  });
  it('倍率 2 でも、四角を倍率で計算する', () => {
    // 倍率 2 のカードは 380 × 192。板の x=450 は画面の 900 で、右へ 480 はみ出す（倍率 1 では収まる）
    expect(edgeChipAt(view({ zoom: 2 }), { x: 450, y: 10 }, VIEWPORT, [])).toEqual({ arrow: '→', x: VIEWPORT.w - 86, y: 20 + BOARD_CARD.h });
    expect(edgeChipAt(view({ zoom: 1 }), { x: 450, y: 10 }, VIEWPORT, []).arrow).toBe('↓');
  });
  it('ほかの札と重なれば、下へ 24 ずつずらす', () => {
    const at = { x: 900, y: 100 };
    const y0 = 100 + BOARD_CARD.h / 2;
    expect(edgeChipAt(view(), at, VIEWPORT, [{ x: VIEWPORT.w - 86, y: y0 }]).y).toBe(y0 + 24);
    expect(edgeChipAt(view(), at, VIEWPORT, [{ x: VIEWPORT.w - 86, y: y0 }, { x: VIEWPORT.w - 86, y: y0 + 24 }]).y).toBe(y0 + 48);
  });
  it('離れた札とは重ならないので、ずらさない', () => {
    expect(edgeChipAt(view(), { x: 900, y: 100 }, VIEWPORT, [{ x: 100, y: 148 }]).y).toBe(148);
  });
  it('面が狭くて範囲が逆になるときは真ん中に置く', () => {
    expect(edgeChipAt(view(), { x: 900, y: 100 }, { w: 100, h: 20 }, [])).toEqual({ arrow: '→', x: 50, y: 10 });
  });
});

describe('grok-cards.css：足したカード（光らせる・札）', () => {
  it('is-arrive は短く光らせ、動きを減らす設定では止めて枠だけにする', () => {
    expect(css).toMatch(/\.memo-board-card\.is-arrive \{\n  animation: memo-board-arrive 1\.6s ease-out;\n\}/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n  \.memo-board-card\.is-arrive \{\n    animation: none;\n    outline: 2px solid var\(--accent-line\);\n  \}\n\}/);
  });
  it('光らせる長さは CSS の 1.6s と合う（ARRIVAL_FLASH_MS）', () => {
    expect(ARRIVAL_FLASH_MS).toBe(1600);
    expect(css).toContain(`memo-board-arrive ${ARRIVAL_FLASH_MS / 1000}s`);
  });
  it('札は押せる（pointer-events: auto）', () => {
    const block = /\.memo-board-edgechip \{([^}]*)\}/.exec(css);
    expect(block?.[1]).toContain('pointer-events: auto;');
  });
});
