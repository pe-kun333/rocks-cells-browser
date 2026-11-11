// 段 HX4：正六角の顔と並び。六角の計算（memo-card-board-hex.ts）と形ごとの口（memo-card-board-geo.ts）、口を受けるようにした関数の既定（四角）が今と同じこと
//   tab・CSS の配線（字面）は memo-card-board-hex-wiring.test.ts。見た目と当たり（SVG の多角形・乗せたときの説明）は開発画面と Windows の確かめ
//   HX5（六角のファイル・固める・動かす・足す）の計算は memo-card-board-hex-move.test.ts
import { describe, expect, it } from 'vitest';
import { BOARD_CARD, type BoardView, layoutCards, placementBounds, slotPosition, SQUARE_STEP } from '../src/memo-card-board';
import { addSpot, HEX_PASTE_NOTE, HEX_TEMPLATE_NOTE, spotBeside, spotForNewCard, spotNextToLast, toolState } from '../src/memo-card-board-edit';
import { geoOf, HEX_GEO, SQUARE_GEO } from '../src/memo-card-board-geo';
import {
  HEX,
  HEX_BAND_UNDER,
  HEX_BOX,
  HEX_CENTER,
  HEX_NEAR,
  HEX_NEAREST,
  hexBandBox,
  hexEdgeGeometry,
  hexEdgeReach,
  hexesOverlap,
  hexFaceInfo,
  hexFaceInfos,
  hexHitsRect,
  hexOutside,
  hexLayout,
  hexLineEnds,
  hexMenuAnchor,
  hexReach,
  hexReadBox,
  hexRecentView,
  hexSlot,
  linkCounts,
  pointInHex,
} from '../src/memo-card-board-hex';
import { cardDate } from '../src/memo-card-board-menu';
import { groupSize, pasteOffsets, spotForGroup } from '../src/memo-card-board-paste';
import { centerMostCard, marqueeHits, nearestInDirection } from '../src/memo-card-board-select';
import type { LoadBoardResult } from '../src/memo-card-board-store';
import { UndoStack, undoButtons, undoLayoutNote, type UndoOp } from '../src/memo-card-board-undo';
import { actualSizeView, boardFaces, boxReadable, cardVisibleRatio, edgeChipAt, edgeGeometry, fitAll, openingView, recentView, replyCount, replyCounts, settleView, squareReadBox, viewAfterShow, viewToShowCard } from '../src/memo-card-board-view';
import type { Reply } from '../src/threads';

const reply = (id: string, over: Partial<Reply> = {}): Reply => ({ id, parent: null, text: `カード ${id}`, createdAt: 1000, ...over });
// 作った順に n 枚（c00 が最初）
const cards = (n: number) => Array.from({ length: n }, (_, i) => reply(`c${String(i).padStart(2, '0')}`, { createdAt: 100 + i }));
const vpOf = (h: number, w = 840) => ({ w, h });
const hexFaces = (rs: readonly Reply[]) => boardFaces(rs, null, HEX_GEO.place);
const posOf = (faces: readonly { id: string; x: number; y: number }[]) => new Map(faces.map((f) => [f.id, { x: f.x, y: f.y }]));
const hexOpen = (rs: readonly Reply[], vp: { w: number; h: number }, place: 'upper' | 'bottom' = 'upper') => openingView(null, rs, hexFaces(rs), vp, { place, readBox: HEX_GEO.readBox, recent: HEX_GEO.recent });
const readableIds = (view: BoardView, rs: readonly Reply[], vp: { w: number; h: number }) =>
  hexFaces(rs)
    .filter((f) => boxReadable(view, hexReadBox(f), vp))
    .map((f) => f.id);

describe('寸法（計画 §6.3）', () => {
  it('幅 150・高さ 2W/√3・箱 150×174・三角 43.3・隙間 16・歩み 166 と 144・ずらし 83・5 枚と 4 枚', () => {
    expect(HEX.w).toBe(150);
    expect(HEX.h).toBeCloseTo(173.205, 3);
    expect(HEX.boxH).toBe(174);
    expect(HEX.tri).toBeCloseTo(43.301, 3);
    expect(HEX.tri * 4).toBeCloseTo(HEX.h, 9);
    expect([HEX.gap, HEX.stepX, HEX.stepY, HEX.shift, HEX.rowLong, HEX.rowShort]).toEqual([16, 166, 144, 83, 5, 4]);
    expect(HEX.stepX).toBe(HEX.w + HEX.gap);
    expect(HEX.stepY).toBe(Math.round((HEX.stepX * Math.sqrt(3)) / 2));
    expect(HEX_BOX).toEqual({ w: 150, h: 174 });
    expect(HEX_CENTER.x).toBe(75);
    expect(HEX_CENTER.y).toBeCloseTo(86.603, 3);
    expect(HEX_BAND_UNDER).toBe(14);
  });
});

describe('仮の並び（作った順に、5 枚と 4 枚の行を交互に）', () => {
  it('番と位置：行 ＝ 2×⌊i/9⌋＋(i mod 9 ≥ 5 ? 1 : 0)、列 ＝ i mod 9 か i mod 9 − 5。奇数の行は 83 右', () => {
    const at = (i: number) => hexSlot(i);
    expect([0, 1, 2, 3, 4].map(at)).toEqual([0, 166, 332, 498, 664].map((x) => ({ x, y: 0 })));
    expect([5, 6, 7, 8].map(at)).toEqual([83, 249, 415, 581].map((x) => ({ x, y: 144 })));
    expect([9, 10, 13].map(at)).toEqual([{ x: 0, y: 288 }, { x: 166, y: 288 }, { x: 664, y: 288 }]);
    expect([14, 17, 18].map(at)).toEqual([{ x: 83, y: 432 }, { x: 581, y: 432 }, { x: 0, y: 576 }]);
    expect(at(-3)).toEqual({ x: 0, y: 0 });
    expect(at(2.7)).toEqual(at(2));
  });
  it('行ごとの枚数は 5・4・5・4…（18 枚で 4 行）。位置は整数', () => {
    const rows = new Map<number, number>();
    for (let i = 0; i < 18; i++) {
      const p = hexSlot(i);
      expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
      rows.set(p.y, (rows.get(p.y) ?? 0) + 1);
    }
    expect([...rows.values()]).toEqual([5, 4, 5, 4]);
  });
  it('並べるのは作った順（並べ替えの rank には左右されない）。返信は並べない。位置は保存しない（saved: false）', () => {
    const rs = [reply('b', { createdAt: 20, rank: 0 }), reply('a', { createdAt: 10, rank: 5 }), reply('c', { createdAt: 30 }), reply('a1', { parent: 'a', createdAt: 40 })];
    expect(hexLayout(rs)).toEqual([
      { id: 'a', x: 0, y: 0, saved: false },
      { id: 'b', x: 166, y: 0, saved: false },
      { id: 'c', x: 332, y: 0, saved: false },
    ]);
    expect(hexFaces(rs).map((f) => [f.id, f.x, f.y, f.saved])).toEqual([
      ['a', 0, 0, false],
      ['b', 166, 0, false],
      ['c', 332, 0, false],
    ]);
  });
  it('六角の並べ方は、渡したファイル（六角のファイル）の位置を使う（HX5）。置いたカードは仮のカードの後ろ（上）に描く。孤児は描かない', () => {
    const rs = cards(3);
    const hexFile = { memoId: 'm1', updatedAt: 1, view: { x: 0, y: 0, zoom: 1 }, nodes: [{ ref: 'gone', x: 5, y: 5 }, { ref: 'c00', x: 900, y: 900 }] };
    expect(HEX_GEO.place(rs, hexFile)).toEqual(hexLayout(rs, hexFile));
    expect(hexLayout(rs, hexFile)).toEqual([
      { id: 'c01', x: 166, y: 0, saved: false },
      { id: 'c02', x: 332, y: 0, saved: false },
      { id: 'c00', x: 900, y: 900, saved: true },
    ]);
    expect(HEX_GEO.place(rs, null)).toEqual(hexLayout(rs)); // ファイルが無ければ全部が仮の並び（HX4 と同じ）
  });
  it('300 枚でも、どの箱も ±10,000 に入る（いちばん下の行は y＝9504、箱の下は 9678）', () => {
    let maxY = -Infinity;
    for (let i = 0; i < 300; i++) {
      const p = hexSlot(i);
      expect(Math.abs(p.x) <= 10_000 && Math.abs(p.y) <= 10_000 && p.x + HEX.w <= 10_000 && p.y + HEX.boxH <= 10_000).toBe(true);
      maxY = Math.max(maxY, p.y);
    }
    expect(maxY).toBe(9504);
  });
});

describe('重なり（中心の差が幅 2W の同じ向きの正六角の内側か。隙間は足さない）', () => {
  const o = { x: 0, y: 0 };
  it('横：差 150 で接するだけ（重ならない）、149 で重なる。仮の並びの隣（166）は重ならない', () => {
    expect(hexesOverlap(o, { x: 150, y: 0 })).toBe(false);
    expect(hexesOverlap(o, { x: 149, y: 0 })).toBe(true);
    expect(hexesOverlap(o, { x: 166, y: 0 })).toBe(false);
    expect(hexesOverlap(o, o)).toBe(true);
  });
  it('縦：173 で重なり、174 で重ならない（箱は 1 重なっても六角は離れる）。斜め：辺どうしがちょうど接する所（75, 75√3）は重ならない', () => {
    expect(hexesOverlap(o, { x: 0, y: 173 })).toBe(true);
    expect(hexesOverlap(o, { x: 0, y: 174 })).toBe(false);
    expect(hexesOverlap(o, { x: 75, y: 75 * Math.sqrt(3) })).toBe(false);
    expect(hexesOverlap(o, { x: 75, y: 129 })).toBe(true);
    expect(hexesOverlap(o, { x: 120, y: 150 })).toBe(false); // 箱（150×174）は重なるが、六角は離れている
  });
  it('仮の並びの隣どうし（右・右下・左下）は、どの組も重ならない（境目で番を飛ばさない）', () => {
    expect(hexReach(83, 144)).toBeGreaterThan(150);
    const slots = Array.from({ length: 60 }, (_, i) => hexSlot(i));
    for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) expect(hexesOverlap(slots[i], slots[j]), `${i}-${j}`).toBe(false);
  });
});

describe('点が六角の中か・範囲選択の当たり（多角形）', () => {
  const at = { x: 0, y: 0 };
  it('中心・縦の辺・上の頂点は中。箱の角・頂点のすぐ外は外', () => {
    expect(pointInHex(at, { x: 75, y: 86.6 })).toBe(true);
    expect(pointInHex(at, { x: 0, y: 86.6 })).toBe(true);
    expect(pointInHex(at, { x: -0.01, y: 86.6 })).toBe(false);
    expect(pointInHex(at, { x: 75, y: 0 })).toBe(true);
    expect(pointInHex(at, { x: 75, y: -0.01 })).toBe(false);
    expect(pointInHex(at, { x: 2, y: 2 })).toBe(false);
    expect(pointInHex(at, { x: 148, y: 172 })).toBe(false);
    expect(pointInHex({ x: 100, y: 50 }, { x: 175, y: 136.6 })).toBe(true);
  });
  it('縁から外への離れ（hexOutside。TA4a）：中は 0 以下。右クリックで、縁から 9 まではそのカードに数える', () => {
    expect(hexOutside(at, { x: 75, y: 86.6 })).toBeCloseTo(-75, 1); // 中心
    expect(hexOutside(at, { x: 150, y: 86.6 })).toBeCloseTo(0, 9); // 縦の辺の上
    expect(hexOutside(at, { x: 158, y: 86.6 })).toBeCloseTo(8, 9); // 右の縁の外 8
    expect(hexOutside(at, { x: 0, y: 0 })).toBeCloseTo(37.5, 1); // 箱の角は外
    expect(hexOutside({ x: 100, y: 50 }, { x: 258, y: 136.6 })).toBeCloseTo(8, 9);
    for (const p of [{ x: 75, y: 0 }, { x: 0, y: 86.6 }, { x: 40, y: 30 }, { x: 2, y: 2 }, { x: 148, y: 172 }]) expect(hexOutside(at, p) <= 1e-9, JSON.stringify(p)).toBe(pointInHex(at, p));
    expect(HEX_NEAR).toBe(9);
    expect(HEX_GEO.near).toBe(HEX_NEAR);
    expect(HEX_GEO.outside(at, { x: 158, y: 86.6 })).toBe(hexOutside(at, { x: 158, y: 86.6 }));
    expect(SQUARE_GEO.near).toBe(0); // 四角は、箱の全部が押しを受ける
    expect(SQUARE_GEO.outside(at, { x: 95, y: 48 })).toBe(-48);
    expect(SQUARE_GEO.outside(at, { x: 195, y: 48 })).toBe(5);
  });
  it('箱の四つの角（六角の外）だけに掛かる四角は当たらない。斜めの辺に掛かれば当たる', () => {
    expect(hexHitsRect({ x: 0, y: 0, w: 10, h: 10 }, at)).toBe(false); // 左上（60° の法線で分かれる）
    expect(hexHitsRect({ x: 140, y: 0, w: 10, h: 10 }, at)).toBe(false); // 右上（120° の法線で分かれる）
    expect(hexHitsRect({ x: 0, y: 164, w: 10, h: 10 }, at)).toBe(false); // 左下（120°）
    expect(hexHitsRect({ x: 140, y: 164, w: 10, h: 10 }, at)).toBe(false); // 右下（60°）
    expect(hexHitsRect({ x: 30, y: 15, w: 10, h: 10 }, at)).toBe(true);
    expect(hexHitsRect({ x: 60, y: 80, w: 5, h: 5 }, at)).toBe(true); // 中に丸ごと
    expect(hexHitsRect({ x: -50, y: -50, w: 300, h: 300 }, at)).toBe(true); // 六角を丸ごと囲む
  });
  it('辺が接するだけなら当たらない（四角のカードと同じ）', () => {
    expect(hexHitsRect({ x: 150, y: 80, w: 5, h: 5 }, at)).toBe(false);
    expect(hexHitsRect({ x: 149, y: 80, w: 5, h: 5 }, at)).toBe(true);
    expect(hexHitsRect({ x: 70, y: 174, w: 10, h: 5 }, at)).toBe(false);
  });
  it('斜めの辺に外から接する四角は当たらず、少しでも食い込めば当たる（右上の斜めの辺の真ん中に、四角の左下の角を置く）', () => {
    const edge = { x: 75 + 75 / 2, y: HEX.tri / 2 }; // 上の頂点 (75, 0) と右上の頂点 (150, 43.3) の真ん中
    const out = Math.SQRT1_2 * 1e-6; // 辺の外向きの法線（右上）へ少しだけ
    expect(hexHitsRect({ x: edge.x + out, y: edge.y - 10 - out, w: 10, h: 10 }, at)).toBe(false);
    expect(hexHitsRect({ x: edge.x - 0.01, y: edge.y - 10 + 0.01, w: 10, h: 10 }, at)).toBe(true);
    // 左下の斜めの辺（左下の頂点 (0, 129.9) と下の頂点 (75, 173.2) の真ん中）に、四角の右上の角を置く
    const low = { x: 75 / 2, y: HEX.h - HEX.tri / 2 };
    expect(hexHitsRect({ x: low.x - 10 - out, y: low.y + out, w: 10, h: 10 }, at)).toBe(false);
    expect(hexHitsRect({ x: low.x - 10 + 0.01, y: low.y - 0.01, w: 10, h: 10 }, at)).toBe(true);
    // 離す量 0（角がちょうど辺の上）：接するだけなので当たらない（斜めの軸の比べを < から <= に替えると当たってしまう）
    expect(hexHitsRect({ x: edge.x, y: edge.y - 10, w: 10, h: 10 }, at)).toBe(false);
    expect(hexHitsRect({ x: low.x - 10, y: low.y, w: 10, h: 10 }, at)).toBe(false);
  });
  it('範囲選択（marqueeHits に六角の当たりを渡す）：下の三角と、右下の六角の上の三角に掛かる帯は 2 枚とも選ぶ。箱の角だけなら選ばない', () => {
    const view: BoardView = { x: 0, y: 0, zoom: 1 };
    const pos = new Map([
      ['A', { x: 0, y: 0 }],
      ['B', { x: 83, y: 144 }],
    ]);
    expect(marqueeHits(view, { x: 0, y: 150 }, { x: 300, y: 170 }, pos, HEX_BOX, HEX_GEO.hits)).toEqual(['A', 'B']);
    expect(marqueeHits(view, { x: -50, y: 150 }, { x: 5, y: 160 }, pos, HEX_BOX, HEX_GEO.hits)).toEqual([]);
    expect(marqueeHits(view, { x: -50, y: 150 }, { x: 5, y: 160 }, pos, HEX_BOX)).toEqual(['A']); // 箱で当てると角でも選ぶ（六角では使わない）
    expect(marqueeHits({ x: 100, y: 50, zoom: 2 }, { x: 100 + 60 * 2, y: 50 + 80 * 2 }, { x: 100 + 70 * 2, y: 50 + 90 * 2 }, pos, HEX_BOX, HEX_GEO.hits)).toEqual(['A']);
  });
});

describe('線（端を六角の縁で切る。縁から縁が 14 未満なら短い帯）', () => {
  const center = (p: { x: number; y: number }) => ({ x: p.x + HEX_CENTER.x, y: p.y + HEX_CENTER.y });
  it('縁までの長さは (W/2) ÷ max|u·n|：平らな辺の向きは 75、頂点の向きは 86.6', () => {
    expect(hexEdgeReach(1, 0)).toBeCloseTo(75, 9);
    expect(hexEdgeReach(0, 1)).toBeCloseTo(HEX.h / 2, 9);
    expect(hexEdgeReach(0.5, Math.sqrt(3) / 2)).toBeCloseTo(75, 9);
  });
  it('どの向きでも、線の端は両方の六角の縁の上（中心からの max|d·n| が W/2）。端は中心どうしを結ぶ線の上', () => {
    const a = { x: 0, y: 0 };
    for (let deg = 0; deg < 360; deg += 7.5) {
      const rad = (deg * Math.PI) / 180;
      const b = { x: Math.round(400 * Math.cos(rad)), y: Math.round(400 * Math.sin(rad)) };
      const ends = hexLineEnds(a, b);
      if (!ends) throw new Error(`${deg}`);
      const ca = center(a);
      const cb = center(b);
      expect(hexReach(ends.p.x - ca.x, ends.p.y - ca.y), `p ${deg}`).toBeCloseTo(75, 9);
      expect(hexReach(ends.q.x - cb.x, ends.q.y - cb.y), `q ${deg}`).toBeCloseTo(75, 9);
      const cross = (ends.p.x - ca.x) * (cb.y - ca.y) - (ends.p.y - ca.y) * (cb.x - ca.x);
      expect(Math.abs(cross)).toBeLessThan(1e-6);
      expect(ends.length).toBeCloseTo(Math.hypot(cb.x - ca.x, cb.y - ca.y) - 2 * hexEdgeReach(ends.ux, ends.uy), 9);
    }
  });
  it('仮の並びの横の隣（縁から縁 16）と斜めの隣（16.2）は曲線（四角と同じ曲げ方）。d の始まりと終わりは縁の上（0.1 に丸めた値）', () => {
    const g = hexEdgeGeometry({ x: 0, y: 0 }, { x: 166, y: 0 });
    expect(g?.band).toBeUndefined();
    expect(g?.d.startsWith('M150,86.6 C')).toBe(true);
    expect(g?.d.endsWith(' 166,86.6')).toBe(true);
    const diag = hexLineEnds({ x: 0, y: 0 }, { x: 83, y: 144 });
    expect(diag?.length).toBeCloseTo(16.2, 1);
    const dg = hexEdgeGeometry({ x: 0, y: 0 }, { x: 83, y: 144 });
    expect(dg?.band).toBeUndefined();
    const [, sx, sy] = /^M([-\d.]+),([-\d.]+) C/.exec(dg?.d ?? '') ?? [];
    expect(Math.abs(Number(sx) - (diag?.p.x ?? 0))).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(Math.abs(Number(sy) - (diag?.p.y ?? 0))).toBeLessThanOrEqual(0.05 + 1e-9);
  });
  it('縁から縁が 14 未満（13）は短い帯、14・15 は曲線。帯の太さは長さ − 2 で、向き合う辺どうしの隙間を超えない（1〜10）', () => {
    expect(hexEdgeGeometry({ x: 0, y: 0 }, { x: 163, y: 0 })?.band).toBe(10);
    expect(hexEdgeGeometry({ x: 0, y: 0 }, { x: 164, y: 0 })?.band).toBeUndefined();
    expect(hexEdgeGeometry({ x: 0, y: 0 }, { x: 165, y: 0 })?.band).toBeUndefined();
    expect(hexEdgeGeometry({ x: 0, y: 0 }, { x: 155, y: 0 })?.band).toBe(3);
    expect(hexEdgeGeometry({ x: 0, y: 0 }, { x: 153, y: 0 })?.band).toBe(1);
    expect(hexEdgeGeometry({ x: 0, y: 0 }, { x: 151, y: 0 })?.band).toBe(1); // 隙間 1：帯の太さ 1 は隙間にちょうど入る
  });
  // 帯の両端（d の M と L）と向き
  const bandEnds = (d: string) => {
    const [, x1, y1, x2, y2] = /^M([-\d.]+),([-\d.]+) L([-\d.]+),([-\d.]+)$/.exec(d) ?? [];
    return { p: { x: Number(x1), y: Number(y1) }, q: { x: Number(x2), y: Number(y2) } };
  };
  const N60 = { x: 0.5, y: Math.sqrt(3) / 2 };
  const N120 = { x: -0.5, y: Math.sqrt(3) / 2 };
  it('短い帯は、向き合う二つの辺のちょうど真ん中に、辺と平行に置く（矢じりの無い直線。名札は帯の真ん中）', () => {
    const g = hexEdgeGeometry({ x: 0, y: 0 }, { x: 163, y: 0 }); // 右隣（縦の辺どうし）
    expect(g?.d).toBe('M156.5,56.3 L156.5,116.9');
    expect(g?.mid).toEqual({ x: 156.5, y: 86.6 });
    for (const [b, n] of [[{ x: 81, y: 140 }, N60], [{ x: -81, y: 140 }, N120]] as const) {
      // 右下・左下の隣（斜めの辺どうし）：帯は斜めの辺と平行（向き合う辺の法線に直交）
      expect((hexLineEnds({ x: 0, y: 0 }, b)?.length ?? 99) < HEX_BAND_UNDER).toBe(true);
      const e = bandEnds(hexEdgeGeometry({ x: 0, y: 0 }, b)?.d ?? '');
      expect(Math.abs((e.q.x - e.p.x) * n.x + (e.q.y - e.p.y) * n.y), `${b.x},${b.y}`).toBeLessThanOrEqual(0.15);
      expect(Math.hypot(e.q.x - e.p.x, e.q.y - e.p.y)).toBeGreaterThan(50);
    }
  });
  it('縦にずれた隣（中心の差 152, 60）：帯は向き合う縦の辺の重なる区間（y 103.3〜129.9）だけに、二つの辺の真ん中（x 151）に置く。両端はどちらの顔の内側にも入らない', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 152, y: 60 };
    const g = hexEdgeGeometry(a, b);
    expect(g?.band).toBe(1); // 縁から縁 2.15（中心どうしの線の上）− 2 は 1 より細いので 1。向き合う辺どうしの隙間は 2
    expect(g?.d).toBe('M151,103.3 L151,129.9');
    const e = bandEnds(g?.d ?? '');
    for (const p of [e.p, e.q]) {
      expect(pointInHex(a, p)).toBe(false);
      expect(pointInHex(b, p)).toBe(false);
    }
  });
  it('どの向きでも：帯は向き合う辺と平行で、両端はどちらの顔の内側にも入らない。長さは 6〜辺の 7 割。向き合う辺どうしの隙間が 1 以上なら、帯の太さは隙間を超えない（縁に掛からない）', () => {
    const a = { x: 0, y: 0 };
    const ca = { x: HEX_CENTER.x, y: HEX_CENTER.y };
    let bands = 0;
    let wide = 0;
    for (let deg = 0; deg < 360; deg += 3) {
      for (const gap of [0.5, 3, 7, 12]) {
        const ux = Math.cos((deg * Math.PI) / 180);
        const uy = Math.sin((deg * Math.PI) / 180);
        const dist = 2 * hexEdgeReach(ux, uy) + gap;
        const b = { x: Math.round(ux * dist), y: Math.round(uy * dist) };
        const g = hexEdgeGeometry(a, b);
        if (!g?.band) continue;
        bands += 1;
        const e = bandEnds(g.d);
        const d = { x: b.x, y: b.y }; // 中心の差（どちらも箱の左上から同じだけずらした所が中心）
        const normals = [{ x: 1, y: 0 }, N60, N120];
        const face = normals.reduce((m, n) => (Math.abs(d.x * n.x + d.y * n.y) > Math.abs(d.x * m.x + d.y * m.y) ? n : m));
        expect(Math.abs((e.q.x - e.p.x) * face.x + (e.q.y - e.p.y) * face.y), `${deg} ${gap}`).toBeLessThanOrEqual(0.15);
        const len = Math.hypot(e.q.x - e.p.x, e.q.y - e.p.y);
        expect(len, `${deg} ${gap}`).toBeGreaterThanOrEqual(6 - 0.15);
        expect(len, `${deg} ${gap}`).toBeLessThanOrEqual((HEX.h / 2) * 0.7 + 0.15);
        const cb = { x: b.x + HEX_CENTER.x, y: b.y + HEX_CENTER.y };
        for (const p of [e.p, e.q]) {
          expect(hexReach(p.x - ca.x, p.y - ca.y), `a ${deg} ${gap}`).toBeGreaterThanOrEqual(75 - 0.1);
          expect(hexReach(p.x - cb.x, p.y - cb.y), `b ${deg} ${gap}`).toBeGreaterThanOrEqual(75 - 0.1);
        }
        const g2 = hexReach(d.x, d.y) - HEX.w; // 向き合う辺どうしの隙間
        expect(g.band, `${deg} ${gap}`).toBeGreaterThanOrEqual(1);
        expect(g.band, `${deg} ${gap}`).toBeLessThanOrEqual(10);
        if (g2 >= 1) {
          wide += 1;
          expect(g.band, `${deg} ${gap}`).toBeLessThanOrEqual(g2 + 0.05); // 太さは 0.1 に丸めた値
        }
      }
    }
    expect(bands).toBeGreaterThan(200);
    expect(wide).toBeGreaterThan(300);
  });
  it('向き合う二つの辺が重ならない（ずれが大きい）ときは、長さ 6 で、近い端どうしの真ん中に置く', () => {
    // 中心の差 (152, 87)：向き合うのは縦の辺（|d·n0|＝152 が最大）。縦の辺は a が y 43.3〜129.9、b が 130.3〜216.9 で重ならない（近い端は 129.9 と 130.3）
    const g = hexEdgeGeometry({ x: 0, y: 0 }, { x: 152, y: 87 });
    expect(g?.band).toBe(1);
    expect(g?.d).toBe('M151,127.1 L151,133.1');
    expect(g?.mid).toEqual({ x: 151, y: 130.1 });
  });
  it('重なって・接して長さが無ければ描かない（null）', () => {
    expect(hexEdgeGeometry({ x: 0, y: 0 }, { x: 150, y: 0 })).toBeNull();
    expect(hexEdgeGeometry({ x: 0, y: 0 }, { x: 100, y: 30 })).toBeNull();
    expect(hexEdgeGeometry({ x: 0, y: 0 }, { x: 0, y: 0 })).toBeNull();
    expect(hexEdgeGeometry({ x: 0, y: 0 }, { x: 75, y: 75 * Math.sqrt(3) })).toBeNull();
  });
});

describe('開いたとき（HX1 の決まりに、六角の読む箱と最後に書いた辺りを渡す）', () => {
  const rs14 = cards(14);
  const rs15 = cards(15);
  it('読む箱は箱全体（150×174。三角まで丸ごと）、文の帯は y＋43.3〜y＋129.9', () => {
    expect(hexReadBox({ x: 10, y: 20 })).toEqual({ x: 10, y: 20, w: 150, h: 174 });
    const band = hexBandBox({ x: 10, y: 20 });
    expect(band.x).toBe(10);
    expect(band.y).toBeCloseTo(63.301, 3);
    expect(band.y + band.h).toBeCloseTo(149.904, 3);
  });
  it('14 枚・面 840×217（上の区画）：決まり 3。最後に書いたカードの行が丸ごと（5 枚）読め、上の端に寄せる（余白 4）', () => {
    const open = hexOpen(rs14, vpOf(217));
    expect(open).toEqual({ view: { x: 13, y: -284, zoom: 1 }, rule: 3, n: 5 });
    expect(readableIds(open.view, rs14, vpOf(217))).toEqual(['c09', 'c10', 'c11', 'c12', 'c13']);
  });
  it('面 180（道具の列を開いた）でも 1.0 倍で最後の行が丸ごと', () => {
    expect(hexOpen(rs14, vpOf(180))).toEqual({ view: { x: 13, y: -284, zoom: 1 }, rule: 3, n: 5 });
  });
  it('面 146・88：どれも入らないので決まり 4。最後に書いたカードの真ん中の文の帯を 1.0 倍で真ん中に', () => {
    const v146 = hexOpen(rs14, vpOf(146));
    expect(v146).toEqual({ view: { x: -319, y: -302, zoom: 1 }, rule: 4, n: 0 });
    const v88 = hexOpen(rs14, vpOf(88));
    expect(v88).toEqual({ view: { x: -319, y: -331, zoom: 1 }, rule: 4, n: 0 });
    const band = hexBandBox(hexSlot(13));
    expect(band.y + v146.view.y).toBeGreaterThan(0);
    expect(band.y + band.h + v146.view.y).toBeLessThan(146);
    expect(Math.abs(band.y + band.h / 2 + v88.view.y - 44)).toBeLessThanOrEqual(0.5);
  });
  it('15 枚：最後に書いたカードは 1 枚だけの行。同じ行に足すカードが無いので、上の端に寄せて横の真ん中に（上の隣の行は同じ行ではないので数えない）', () => {
    const open = hexOpen(rs15, vpOf(217));
    expect(open).toEqual({ view: { x: (840 - 150) / 2 - 83, y: -428, zoom: 1 }, rule: 3, n: 1 });
    expect(open.view.x).toBe(262);
    expect(readableIds(open.view, rs15, vpOf(217))).toEqual(['c14']);
  });
  it('幅の狭い面：同じ行のカードだけを、横に近い順に、面の幅に入るだけ足す（14 枚・500×217 で 3 枚）', () => {
    const open = hexOpen(rs14, vpOf(217, 500));
    expect(open).toEqual({ view: { x: -323, y: -284, zoom: 1 }, rule: 3, n: 3 });
    expect(readableIds(open.view, rs14, vpOf(217, 500))).toEqual(['c11', 'c12', 'c13']);
    expect(hexOpen(rs14, vpOf(217, 400))).toEqual({ view: { x: -456, y: -284, zoom: 1 }, rule: 3, n: 2 });
    expect(hexOpen(rs14, vpOf(217, 640))).toEqual({ view: { x: -253, y: -284, zoom: 1 }, rule: 3, n: 3 });
  });
  it('35 枚・下の置き場 840×600：上の隣の行は縦も読めるが、同じ行ではないので横に足さない（同じ行の 3 枚の真ん中に）。n はほかの行の読めるカードも数える', () => {
    const rs = cards(35);
    const vp = vpOf(600);
    const open = hexOpen(rs, vp, 'bottom');
    expect(open).toEqual({ view: { x: 96, y: -795, zoom: 1 }, rule: 3, n: 7 });
    expect(readableIds(open.view, rs, vp)).toEqual(['c27', 'c28', 'c29', 'c30', 'c32', 'c33', 'c34']); // 同じ行の c32〜c34 と、上の行で見えている 4 枚
  });
  it('最後に書いたカードが行の途中（14 枚に c06 への返信を足す）：すぐ前に書いた同じ行の隣（c05）を足し、横 83 の近さの下の行（c10・c11）には幅を取らせない', () => {
    const rs = [...rs14, reply('c06r', { parent: 'c06', createdAt: 10_000 })];
    expect(hexOpen(rs, vpOf(217, 400))).toEqual({ view: { x: -41, y: -140, zoom: 1 }, rule: 3, n: 2 });
    expect(readableIds({ x: -41, y: -140, zoom: 1 }, rs, vpOf(217, 400))).toEqual(['c05', 'c06']);
    // 面が高ければ下の行も縦が丸ごと読める。それでも横に足すのは同じ行だけ（下の行で読めるのは、見えている c10 だけ）
    expect(hexOpen(rs, vpOf(500, 400))).toEqual({ view: { x: -41, y: -140, zoom: 1 }, rule: 3, n: 3 });
    expect(readableIds({ x: -41, y: -140, zoom: 1 }, rs, vpOf(500, 400))).toEqual(['c05', 'c06', 'c10']);
  });
  it('同じ行は、箱の上端の差の絶対値が HEX.tri（43.3）より小さいカード。同じ行でも、縦が丸ごと読めないカードは足さない（HX5 の自由な位置）', () => {
    const rs = [reply('a', { createdAt: 1 }), reply('b', { createdAt: 2 })]; // 最後に書いたのは b（箱の上端 0）
    const at = (ay: number, h: number, place: 'upper' | 'bottom' = 'upper') => hexRecentView(rs, [{ id: 'a', x: 0, y: ay }, { id: 'b', x: 166, y: 0 }], vpOf(h), { place });
    expect(at(43, 300)).toEqual({ view: { x: 262, y: 4, zoom: 1 }, rule: 3, n: 2 }); // 差 43：同じ行。a と b の幅（0〜316）の真ん中
    expect(at(44, 300)).toEqual({ view: { x: 179, y: 4, zoom: 1 }, rule: 3, n: 2 }); // 差 44：別の行。b だけの真ん中（a は読めるが数えない）
    expect(at(-43, 300, 'bottom')).toEqual({ view: { x: 262, y: 63, zoom: 1 }, rule: 3, n: 2 }); // 上へ 43：同じ行。下の置き場（真ん中）では縦も読めるので足す
    expect(at(-43, 300)).toEqual({ view: { x: 179, y: 4, zoom: 1 }, rule: 3, n: 1 }); // 上の区画（上の端に寄せる）では a の上が切れるので足さない
    expect(at(40, 217)).toEqual({ view: { x: 179, y: 4, zoom: 1 }, rule: 3, n: 1 }); // 差 40：同じ行だが、面 217 では a の下が切れて縦が読めないので足さない
  });
  it('決まり 3 の性質（幅 4 つ × 高さ 3 つ × 上と下）：最後に書いたカードの行で読めるのは min(行の枚数, 面の幅に入る枚数) 枚で、その並びが横の真ん中に来る', () => {
    // どの組でも決まり 3 になるメモだけを使う（全体が 0.85 倍で入るメモは決まり 2：14・15・9 枚は、高さ 600・幅 840 では全体が入るので、低い面だけ）
    const sets: [Reply[], number[]][] = [
      [rs14, [217, 180]],
      [rs15, [217, 180]],
      [cards(9), [217, 180]],
      [cards(19), [217, 180, 600]],
      [cards(23), [217, 180, 600]],
      [cards(35), [217, 180, 600]],
    ];
    let checked = 0;
    for (const [rs, heights] of sets) {
      const faces = hexFaces(rs);
      const last = faces.find((f) => f.id === rs[rs.length - 1].id);
      if (!last) throw new Error('最後に書いたカードが描かれていません');
      const row = faces.filter((f) => Math.abs(f.y - last.y) < HEX.tri);
      for (const w of [400, 500, 640, 840]) {
        for (const h of heights) {
          for (const place of ['upper', 'bottom'] as const) {
            const vp = vpOf(h, w);
            const label = `${rs.length}枚 ${w}×${h} ${place}`;
            const open = hexOpen(rs, vp, place);
            expect(open.rule, label).toBe(3);
            const zoom = open.view.zoom;
            const read = row.filter((f) => boxReadable(open.view, hexReadBox(f), vp));
            expect(read.map((f) => f.id), label).toContain(last.id);
            expect(read.length, label).toBe(Math.min(row.length, Math.floor(((w - 4) / zoom + HEX.gap) / HEX.stepX)));
            const x0 = Math.min(...read.map((f) => f.x));
            const x1 = Math.max(...read.map((f) => f.x + HEX.w));
            expect(Math.abs(((x0 + x1) / 2) * zoom + open.view.x - w / 2), label).toBeLessThanOrEqual(1);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBe((3 * 2 + 3 * 3) * 4 * 2);
  });
  it('覚えた位置（saved）は決まり 1 の確かめにかける：倍率 0.85 以上で最後に書いたカードが読めればそのまま、だめなら決まり 2〜4', () => {
    const faces = hexFaces(rs14);
    const opts = { place: 'upper' as const, readBox: HEX_GEO.readBox, recent: HEX_GEO.recent };
    const good: BoardView = { x: 20, y: -280, zoom: 1 }; // 最後に書いたカード（664, 288）が面に入る
    expect(openingView(null, rs14, faces, vpOf(217), { ...opts, saved: good })).toEqual({ view: good, rule: 1, n: 0 });
    const far: BoardView = { x: 30, y: 10, zoom: 0.4 }; // ［全体］で縮めた位置（0.4 倍）
    const small = openingView(null, rs14, faces, vpOf(217), { ...opts, saved: far });
    expect(small.rule).not.toBe(1);
    expect(small).toEqual(hexOpen(rs14, vpOf(217)));
    const lost: BoardView = { x: 20, y: 0, zoom: 1 }; // 1.0 倍でも、最後に書いたカードが面の外
    const back = openingView(null, rs14, faces, vpOf(217), { ...opts, saved: lost });
    expect(back.rule).toBe(3);
    expect(back).toEqual(hexOpen(rs14, vpOf(217)));
  });
  it('覚えた位置はファイルの位置より先に見る（四角でも同じ口。無ければ今のとおりファイルの位置）', () => {
    const sq = boardFaces(rs14, null);
    const fileView: BoardView = { x: 115, y: -345, zoom: 1 };
    const load: LoadBoardResult = { state: 'ok', layout: 'square', memoId: 'm1', board: { memoId: 'm1', updatedAt: 1, view: fileView, nodes: [] }, dropped: 0, raw: null, backupNeeded: false };
    expect(openingView(load, rs14, sq, vpOf(217), { place: 'upper' })).toEqual({ view: fileView, rule: 1, n: 0 });
    const kept: BoardView = { x: 115, y: -350, zoom: 1 }; // 最後に書いたカード（210, 464）が面に入る、ファイルとは別の位置
    expect(openingView(load, rs14, sq, vpOf(217), { place: 'upper', saved: kept })).toEqual({ view: kept, rule: 1, n: 0 });
    const zoomedOut: BoardView = { x: 100, y: 10, zoom: 0.4 };
    expect(openingView(load, rs14, sq, vpOf(217), { place: 'upper', saved: zoomedOut }).rule).toBe(3); // 覚えた位置が通らなければ、ファイルの位置にも戻らず決まり 2〜4
  });
  it('六角のファイルが無いとき、左で足したカードは仮の並びの最後（作った順のいちばん後ろ）に出る', () => {
    const added = [...rs14, reply('new1', { createdAt: 10_000 })];
    const layout = HEX_GEO.place(added, null);
    expect(layout[layout.length - 1]).toEqual({ id: 'new1', ...hexSlot(14), saved: false });
    expect(layout.find((p) => p.id === 'new1')).toEqual({ id: 'new1', x: 83, y: 432, saved: false });
  });
  it('下の置き場では真ん中に置く', () => {
    expect(hexOpen(rs14, vpOf(300), 'bottom')).toEqual({ view: { x: 13, y: -225, zoom: 1 }, rule: 3, n: 5 });
  });
  it('小さいメモは今と同じく全体（決まり 2）。カードが無ければ全体の決まり', () => {
    const open = hexOpen(cards(3), vpOf(217));
    expect(open.rule).toBe(2);
    expect(open.view.zoom).toBeGreaterThanOrEqual(0.85);
    expect(hexRecentView([], [], vpOf(217), { place: 'upper' })).toBeNull();
  });
  it('入らないときは倍率を 0.85 まで下げて探す（面 165 では 0.9 倍）', () => {
    const open = hexOpen(rs14, vpOf(165));
    expect(open.rule).toBe(3);
    expect(open.view.zoom).toBe(0.9);
    expect(readableIds(open.view, rs14, vpOf(165))).toContain('c13');
  });
  it('「100%」：選んでいなければ 1.0 倍で最後に書いた辺り（入らなければ文の帯）。1 枚選んでいればそのカードの箱を真ん中に', () => {
    const far: BoardView = { x: 5000, y: 5000, zoom: 0.5 };
    const size = (h: number, selected: string | null) => actualSizeView(far, rs14, hexFaces(rs14), vpOf(h), { place: 'upper', selected, readBox: HEX_GEO.readBox, recent: HEX_GEO.recent });
    expect(size(217, null)).toEqual({ x: 13, y: -284, zoom: 1 });
    expect(size(88, null)).toEqual({ x: -319, y: -331, zoom: 1 });
    expect(size(217, 'c05')).toEqual({ x: 262, y: -122, zoom: 1 });
  });
  it('隠して出したとき・面が替わったときも、六角の決まりで計算し直す', () => {
    const far: BoardView = { x: 5000, y: 5000, zoom: 1 };
    expect(viewAfterShow(far, rs14, hexFaces(rs14), vpOf(217), { place: 'upper', before: 'c12', readBox: HEX_GEO.readBox, recent: HEX_GEO.recent })).toEqual({ view: { x: 13, y: -284, zoom: 1 }, rule: 3, n: 5 });
    const settled = settleView(far, rs14, hexFaces(rs14), vpOf(146), { dy: 37, rule: 3, touched: false, selected: 0 }, { place: 'upper', readBox: HEX_GEO.readBox, recent: HEX_GEO.recent });
    expect(settled).toEqual({ view: { x: -319, y: -302, zoom: 1 }, rule: 4 });
  });
});

describe('Shift＋矢印（六角：↑↓ の横の重み 0.5、同点なら ↓ は右下・↑ は左上）', () => {
  const pos = posOf(hexLayout(cards(14)));
  const go = (from: string, dir: 'up' | 'down' | 'left' | 'right', opts = HEX_NEAREST) => nearestInDirection(from, pos, dir, opts);
  it('↓ は隣の行の右下、↑ は隣の行の左上へ。↓↑ で元へ戻る', () => {
    expect(go('c00', 'down')).toBe('c05');
    expect(go('c01', 'down')).toBe('c06');
    expect(go('c06', 'up')).toBe('c01');
    expect(go('c06', 'down')).toBe('c11');
    expect(go('c11', 'up')).toBe('c06');
    expect(go('c04', 'down')).toBe('c08'); // 右下が無い端は左下
    expect(go('c08', 'down')).toBe('c13');
  });
  it('六角の決め方の値：↑↓ の横の重み 0.5、同点は向きで決める', () => {
    expect(HEX_NEAREST).toEqual({ verticalSide: 0.5, diagonalTie: true });
    expect(HEX_GEO.nearest).toBe(HEX_NEAREST);
  });
  it('重み 0.5 と 1 で答えが分かれる：主 144・横 166 のカードと、主 288・横 0 のカード', () => {
    const p = new Map([
      ['from', { x: 0, y: 0 }],
      ['side', { x: 166, y: 144 }],
      ['below', { x: 0, y: 288 }],
    ]);
    expect(nearestInDirection('from', p, 'down', HEX_NEAREST)).toBe('side'); // 144＋83＝227 ＜ 288
    expect(nearestInDirection('from', p, 'down', { verticalSide: 1, diagonalTie: true })).toBe('below'); // 144＋166＝310 ＞ 288
    expect(nearestInDirection('from', p, 'down')).toBe('below');
  });
  it('同点の決め方：並びの順で右上のカードが先に来ても、↑ は左上を選ぶ（↓ は右下）', () => {
    const up = new Map([
      ['from', { x: 0, y: 300 }],
      ['right', { x: 83, y: 156 }],
      ['left', { x: -83, y: 156 }],
    ]);
    expect(nearestInDirection('from', up, 'up', HEX_NEAREST)).toBe('left');
    expect(nearestInDirection('from', up, 'up', { verticalSide: 0.5 })).toBe('right'); // 同点の決め方が無ければ並びの順
    const down = new Map([
      ['from', { x: 0, y: 0 }],
      ['left', { x: -83, y: 144 }],
      ['right', { x: 83, y: 144 }],
    ]);
    expect(nearestInDirection('from', down, 'down', HEX_NEAREST)).toBe('right');
    expect(nearestInDirection('from', down, 'down', { verticalSide: 0.5 })).toBe('left');
  });
  it('四角の決まり（重み 2）では隣の行を飛ばしてしまう（六角で替える理由）', () => {
    expect(nearestInDirection('c00', pos, 'down')).toBe('c09');
    expect(nearestInDirection('c00', pos, 'down', SQUARE_GEO.nearest)).toBe('c09');
  });
  it('←→ は今のまま（重み 2、同点は並びの順）', () => {
    expect(go('c05', 'right')).toBe('c06');
    expect(go('c05', 'right')).toBe(nearestInDirection('c05', pos, 'right'));
    expect(go('c05', 'left')).toBe(nearestInDirection('c05', pos, 'left'));
    expect(go('c00', 'up')).toBeNull();
  });
  it('真ん中に近いカードは、多角形の中心で測る', () => {
    const view: BoardView = { x: 0, y: 0, zoom: 1 };
    const p = new Map([
      ['sq', { x: 200 - BOARD_CARD.w / 2, y: 100 - BOARD_CARD.h / 2 }], // 四角の箱の真ん中が面の真ん中
      ['hx', { x: 200 - HEX_CENTER.x, y: 100 - HEX_CENTER.y }], // 六角の中心が面の真ん中
    ]);
    expect(centerMostCard(p, view, { w: 400, h: 200 }, HEX_GEO.center)).toBe('hx');
    expect(centerMostCard(p, view, { w: 400, h: 200 })).toBe('sq');
  });
});

describe('メニュー・📌・［移る］の出し口：右の縦の辺の上の端', () => {
  it('六角は箱の (x＋150, y＋43.3)、四角は今と同じ右上の角 (x＋190, y)', () => {
    const a = hexMenuAnchor({ x: 10, y: 20 });
    expect(a.x).toBe(160);
    expect(a.y).toBeCloseTo(63.301, 3);
    expect(HEX_GEO.menuAnchor({ x: 10, y: 20 })).toEqual(a);
    expect(SQUARE_GEO.menuAnchor({ x: 10, y: 20 })).toEqual({ x: 10 + BOARD_CARD.w, y: 20 });
  });
});

describe('顔の三角の字', () => {
  it('上の三角：❝・💬n・🔗n・✎ の順の印。無ければ印は空（日時は出さない。cardDate はメニューの事実の行で使う）', () => {
    const t = new Date(2026, 10, 7, 7, 58).getTime();
    const base = reply('a', { createdAt: t });
    expect(hexFaceInfo([base], base, 0)).toEqual({ marks: [], tag: '', more: 0, who: '', title: '' });
    expect(cardDate(t)).toBe('11/7 07:58');
    const rich = reply('a', { createdAt: t, quote: { text: 'q', url: 'https://example.com/', title: 'T' }, editedAt: t + 1 });
    const rs = [rich, reply('r1', { parent: 'a' }), reply('r2', { parent: 'r1' })];
    expect(hexFaceInfo(rs, rich, 3).marks).toEqual(['❝', '💬2', '🔗3', '✎']);
  });
  it('下の三角：タグを 1 つと「+n」（機械タグは数えない）。AI のカードは書き手の名前だけで、タグは +n に数える', () => {
    const tagged = reply('a', { tags: ['買い物', '宛て:grok', '週末', '本'] });
    expect(hexFaceInfo([tagged], tagged, 0)).toMatchObject({ tag: '買い物', more: 2, who: '' });
    const ai = reply('b', { tags: ['本', '週末'], by: { who: 'grok', name: ' Grok ' } });
    expect(hexFaceInfo([ai], ai, 0)).toMatchObject({ tag: '', more: 2, who: 'Grok' });
    const aiMachine = reply('b2', { tags: ['本', '宛て:grok', '週末'], by: { who: 'grok', name: 'Grok' } });
    expect(hexFaceInfo([aiMachine], aiMachine, 0)).toMatchObject({ more: 2, who: 'Grok' }); // AI のカードでも機械タグは数えない
    const unnamed = reply('c', { by: { who: 'grok', name: '  ' } });
    expect(hexFaceInfo([unnamed], unnamed, 0)).toMatchObject({ who: 'AI', more: 0 });
  });
  it('写真だけのカードに題（文の最初の行）があれば、下の三角はタグの代わりに題。タグは全部 +n に数える（機械タグは数えない）。題が無ければ今のとおりタグ', () => {
    const titled = reply('p', { image: 'shot1', text: '\n  駅前の朝  \n二行目', tags: ['散歩', '宛て:grok', '朝'] });
    expect(hexFaceInfo([titled], titled, 0)).toMatchObject({ title: '駅前の朝', tag: '', more: 2, who: '' });
    const untitled = reply('q', { image: 'shot2', text: '', tags: ['散歩', '朝'] });
    expect(hexFaceInfo([untitled], untitled, 0)).toMatchObject({ title: '', tag: '散歩', more: 1 });
    const quoted = reply('r', { image: 'shot3', text: '引用つきの画像', quote: { text: 'q', url: 'https://example.com/', title: 'T' } });
    expect(hexFaceInfo([quoted], quoted, 0).title).toBe(''); // 引用つきの画像は写真だけのカードではない（真ん中に文が出る）
    const plain = reply('s', { text: '文のカード', tags: ['本'] });
    expect(hexFaceInfo([plain], plain, 0)).toMatchObject({ title: '', tag: '本', more: 0 });
    const aiPhoto = reply('t', { image: 'shot4', text: '題', by: { who: 'grok', name: 'Grok' }, tags: ['本'] });
    expect(hexFaceInfo([aiPhoto], aiPhoto, 0)).toMatchObject({ who: 'Grok', title: '', more: 1 }); // AI のカードは書き手の名前が先
  });
  it('描いているカードごとの三角の字（描き直しの鍵にも使う）：書き直すと ✎ が入る', () => {
    const rs = [reply('a', { createdAt: 1 }), reply('b', { createdAt: 2, editedAt: 5 })];
    const infos = hexFaceInfos(rs, [{ id: 'a' }, { id: 'b' }, { id: 'gone' }], [{ from: 'a', to: 'b', kind: 'next' }]);
    expect([...infos.keys()]).toEqual(['a', 'b']);
    expect(infos.get('a')?.marks).toEqual(['🔗1']);
    expect(infos.get('b')?.marks).toEqual(['🔗1', '✎']);
    expect(JSON.stringify([...hexFaceInfos([reply('b', { createdAt: 2 })], [{ id: 'b' }], [])])).not.toBe(JSON.stringify([...hexFaceInfos([reply('b', { createdAt: 2, editedAt: 5 })], [{ id: 'b' }], [])]));
  });
  it('返信の数は、全部のカードについて一回でまとめて数える（replyCounts は replyCount と同じ答え。返信の返信も、輪になった返信も同じに数える）', () => {
    const rs = [
      reply('a', { createdAt: 1 }),
      reply('b', { createdAt: 2 }),
      reply('a1', { parent: 'a' }),
      reply('a2', { parent: 'a1' }),
      reply('a3', { parent: 'a' }),
      reply('b1', { parent: 'b' }),
      reply('x1', { parent: 'gone' }),
      reply('o1', { parent: 'o2' }),
      reply('o2', { parent: 'o1' }),
    ];
    const ids = ['a', 'b', 'a1', 'gone', 'o1', 'none', 'a'];
    const counts = replyCounts(rs, ids);
    expect([...counts]).toEqual([
      ['a', 3],
      ['b', 1],
      ['a1', 1],
      ['gone', 1],
      ['o1', 1],
      ['none', 0],
    ]);
    for (const id of ids) expect(counts.get(id), id).toBe(replyCount(rs, id));
    const infos = hexFaceInfos(rs, [{ id: 'a' }, { id: 'b' }], []);
    expect(infos.get('a')).toEqual(hexFaceInfo(rs, rs[0], 0)); // 数を渡さなければ、一枚ずつ数える（同じ答え）
    expect(infos.get('a')?.marks).toEqual(['💬3']);
    expect(infos.get('b')?.marks).toEqual(['💬1']);
  });
  it('🔗n は、描いている線を両端のカードで数える', () => {
    expect([...linkCounts([{ from: 'a', to: 'b', kind: 'next' }, { from: 'c', to: 'a', kind: 'same' }])]).toEqual([
      ['a', 2],
      ['b', 1],
      ['c', 1],
    ]);
  });
});

describe('形ごとの口（geo）：四角の口は今の関数と同じ答え', () => {
  const rs = cards(14);
  const faces = boardFaces(rs, null);
  const pos = posOf(faces);
  const view: BoardView = { x: 37, y: -120, zoom: 0.9 };
  const vp = vpOf(217);
  const missing: LoadBoardResult = { state: 'missing', layout: 'square', memoId: 'm1', board: { memoId: 'm1', updatedAt: 0, view: { x: 0, y: 0, zoom: 1 }, nodes: [] }, dropped: 0, raw: null, backupNeeded: false };
  it('geoOf：hex のときだけ六角', () => {
    expect(geoOf('hex')).toBe(HEX_GEO);
    expect(geoOf('square')).toBe(SQUARE_GEO);
    expect(SQUARE_GEO.layout).toBe('square');
    expect(HEX_GEO.layout).toBe('hex');
  });
  it('並べ方・顔・読む箱・最後に書いた辺り・箱・中心', () => {
    expect(SQUARE_GEO.place(rs, null)).toEqual(layoutCards(rs, null));
    expect(boardFaces(rs, null, SQUARE_GEO.place)).toEqual(faces);
    expect(SQUARE_GEO.readBox).toBe(squareReadBox);
    expect(SQUARE_GEO.recent).toBe(recentView);
    expect(SQUARE_GEO.box).toEqual({ w: BOARD_CARD.w, h: BOARD_CARD.h });
    expect(SQUARE_GEO.center).toEqual({ x: BOARD_CARD.w / 2, y: BOARD_CARD.h / 2 });
    for (const h of [217, 180, 146, 88]) {
      expect(openingView(missing, rs, faces, vpOf(h), { place: 'upper', readBox: SQUARE_GEO.readBox, recent: SQUARE_GEO.recent })).toEqual(openingView(missing, rs, faces, vpOf(h), { place: 'upper' }));
    }
  });
  it('線・範囲選択・Shift＋矢印・面の真ん中', () => {
    for (const [a, b] of [['c00', 'c01'], ['c00', 'c04'], ['c03', 'c13'], ['c05', 'c05']] as const) expect(SQUARE_GEO.edge(pos.get(a)!, pos.get(b)!)).toEqual(edgeGeometry(pos.get(a)!, pos.get(b)!));
    for (const [a, b] of [[{ x: 0, y: 0 }, { x: 300, y: 150 }], [{ x: 200, y: 10 }, { x: 260, y: 40 }], [{ x: 500, y: 200 }, { x: 10, y: 5 }]]) {
      expect(marqueeHits(view, a, b, pos, SQUARE_GEO.box, SQUARE_GEO.hits)).toEqual(marqueeHits(view, a, b, pos));
    }
    for (const id of pos.keys()) for (const dir of ['up', 'down', 'left', 'right'] as const) expect(nearestInDirection(id, pos, dir, SQUARE_GEO.nearest)).toBe(nearestInDirection(id, pos, dir));
    expect(centerMostCard(pos, view, vp, SQUARE_GEO.center)).toBe(centerMostCard(pos, view, vp));
  });
  it('見えている割合・カードへ移る・面の外の札・［全体］・囲む四角', () => {
    const at = { x: 400, y: 300 };
    expect(cardVisibleRatio(view, at, vp, SQUARE_GEO.box)).toBe(cardVisibleRatio(view, at, vp));
    expect(viewToShowCard(view, at, vp, SQUARE_GEO.box)).toEqual(viewToShowCard(view, at, vp));
    expect(edgeChipAt(view, at, vp, [], SQUARE_GEO.box)).toEqual(edgeChipAt(view, at, vp, []));
    expect(fitAll(faces, vp, SQUARE_GEO.box)).toEqual(fitAll(faces, vp));
    expect(placementBounds(faces, SQUARE_GEO.box)).toEqual(placementBounds(faces));
  });
  it('六角の箱を渡すと、六角の大きさで見る', () => {
    const hf = hexFaces(rs);
    expect(placementBounds(hf, HEX_GEO.box)).toEqual({ x: 0, y: 0, w: 814, h: 288 + 174 });
    expect(cardVisibleRatio({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 43 }, vpOf(217), HEX_GEO.box)).toBe(1);
    expect(cardVisibleRatio({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 130 }, vpOf(217), HEX_GEO.box)).toBeCloseTo(87 / 174, 9);
  });
  it('置き場と型の口（size・step）：既定は四角の 190×96・210×116 で、今と同じ答え', () => {
    const taken = [...pos.values()];
    const last = pos.get('c13') ?? null;
    expect(SQUARE_STEP).toEqual({ x: 210, y: 116 });
    expect(slotPosition(7, SQUARE_STEP)).toEqual(slotPosition(7));
    expect(spotForNewCard(view, vp, taken, BOARD_CARD, SQUARE_STEP)).toEqual(spotForNewCard(view, vp, taken));
    expect(spotBeside({ x: 0, y: 0 }, 'down', taken, BOARD_CARD, SQUARE_STEP)).toEqual(spotBeside({ x: 0, y: 0 }, 'down', taken));
    expect(spotNextToLast(view, vp, last, taken, BOARD_CARD, SQUARE_STEP)).toEqual(spotNextToLast(view, vp, last, taken));
    expect(addSpot({ last, view, viewport: vp, taken, size: BOARD_CARD, step: SQUARE_STEP })).toEqual(addSpot({ last, view, viewport: vp, taken }));
    const tpl = { cards: [{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }, { dx: 0, dy: 0 }, { dx: 0, dy: 0 }] } as never;
    expect(pasteOffsets(tpl, SQUARE_STEP)).toEqual(pasteOffsets(tpl));
    expect(groupSize(pasteOffsets(tpl), BOARD_CARD)).toEqual(groupSize(pasteOffsets(tpl)));
    expect(spotForGroup(view, vp, taken, pasteOffsets(tpl), BOARD_CARD, SQUARE_STEP)).toEqual(spotForGroup(view, vp, taken, pasteOffsets(tpl)));
    expect(spotBeside({ x: 0, y: 0 }, 'right', [], HEX_BOX, { x: 166, y: 144 })).toEqual({ x: 166, y: 0 }); // 歩みを渡せる（HX5 の六角の足し方で使う）
  });
});

describe('六角の表示のボタン（toolState）', () => {
  const rs = cards(3);
  const missing: LoadBoardResult = { state: 'missing', layout: 'square', memoId: 'm1', board: { memoId: 'm1', updatedAt: 0, view: { x: 0, y: 0, zoom: 1 }, nodes: [] }, dropped: 0, raw: null, backupNeeded: false };
  const hexMissing: LoadBoardResult = { ...missing, layout: 'hex' }; // 画面では this.loaded はいつも今の形のもの
  it('六角では型を貼る・型にするを押せず、title に「四角に戻すと使えます」。足すは四角と同じ置き場の文（HX5：六角でも位置を決めて足す）', () => {
    const st = toolState({ selected: ['c00', 'c01'], replies: rs, load: hexMissing, layout: 'hex' });
    expect(st.template).toEqual({ enabled: false, note: HEX_TEMPLATE_NOTE });
    expect(st.paste).toEqual({ enabled: false, note: HEX_PASTE_NOTE });
    expect(HEX_TEMPLATE_NOTE).toContain('四角に戻すと使えます');
    expect(HEX_PASTE_NOTE).toContain('四角に戻すと使えます');
    expect(st.add).toEqual(toolState({ selected: ['c00', 'c01'], replies: rs, load: missing, layout: 'square' }).add);
    expect(st.add.note).toContain('最後に書いたカードが見えていればその右か下');
    expect(st.add.note).not.toContain('並びの最後');
  });
  it('四角（と、形を渡さないとき）は今のまま', () => {
    const sq = toolState({ selected: ['c00', 'c01'], replies: rs, load: missing, layout: 'square' });
    expect(sq).toEqual(toolState({ selected: ['c00', 'c01'], replies: rs, load: missing }));
    expect(sq.template.enabled).toBe(true);
    expect(sq.paste.enabled).toBe(true);
  });
});

describe('元に戻すの積み：操作を始めたときの形の印（UndoOp の外。HX4）', () => {
  const add: UndoOp = { kind: 'add', id: 'a', text: 'x', at: { x: 166, y: 0 } }; // 六角で足したカードも位置を持つ（HX5）
  const move: UndoOp = { kind: 'move', moves: [{ ref: 'a', from: { x: 0, y: 0 }, to: { x: 10, y: 0 } }] };
  it('積むときに形を付け、取り出す前に覗ける。形を渡さなければ四角', () => {
    const s = new UndoStack();
    expect(s.peekLayout('undo')).toBeNull();
    s.push(move);
    s.push(add, 'hex');
    expect(s.peekLayout('undo')).toBe('hex');
    expect(s.take('undo')).toBe(add);
    s.finish('undo', add, s.version, 'hex');
    expect(s.peekLayout('redo')).toBe('hex');
    expect(s.peekLayout('undo')).toBe('square');
  });
  it('型の貼り直しで id を付け替えても、形の印は落ちない', () => {
    const s = new UndoStack();
    const paste: UndoOp = { kind: 'paste', template: { name: 't' } as never, ids: ['p1'], at: [{ x: 0, y: 0 }], token: null };
    s.push(paste, 'square');
    s.push(add, 'hex');
    s.take('undo');
    s.finish('undo', add, s.version, 'hex');
    s.remapRedo(new Map([['a', 'b']]));
    expect(s.peekRedo()).toEqual({ ...add, id: 'b' });
    expect(s.peekLayout('redo')).toBe('hex');
  });
  it('ボタン：次の操作の形が今と違えば押せず、その形に戻すと戻せると書く', () => {
    const load: LoadBoardResult = { state: 'missing', layout: 'square', memoId: 'm1', board: { memoId: 'm1', updatedAt: 0, view: { x: 0, y: 0, zoom: 1 }, nodes: [] }, dropped: 0, raw: null, backupNeeded: false };
    const hexLoad: LoadBoardResult = { ...load, layout: 'hex' };
    const b = undoButtons({ undo: move, redo: add, busy: false, load: hexLoad, layout: { now: 'hex', undo: 'square', redo: 'hex' } });
    expect(b.undo).toEqual({ enabled: false, note: '「カードの移動」は、四角の表示に戻すと元に戻せます' });
    expect(b.redo.enabled).toBe(true);
    expect(undoLayoutNote(add, 'redo', 'hex')).toBe('「カードを足す」は、六角の表示に戻すとやり直せます');
    expect(undoButtons({ undo: move, redo: null, busy: false, load }).undo.enabled).toBe(true); // 形を渡さなければ今のまま
    expect(undoButtons({ undo: move, redo: null, busy: false, load, layout: { now: 'square', undo: 'square', redo: null } }).undo.enabled).toBe(true);
  });
});
