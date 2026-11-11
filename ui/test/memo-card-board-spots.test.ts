// 段 TA1・TA4a：型の置き場と、空きで押した点の置き場の計算（計画書 docs/plan-comment-board-templates.md の §4）。純粋な関数を確かめる（DOM も保存も使わない）
//   升目の輪の順・右と下の升へ順に置く・型の中の重なり・形を保つ一団の置き場・型を置く決まり・足したあとの寄せ方
//   位置の数は、席の文書（docs/wip/2026-11-10/comment-board-templates-plan/seats/03a-plan-break-placement.md §4.1）で手で計算したもの
import { describe, expect, it } from 'vitest';
import { spotForNewCard } from '../src/memo-card-board-edit';
import { HEX_GEO, SQUARE_GEO } from '../src/memo-card-board-geo';
import { HEX_BOX, HEX_STEP, hexDepth, hexesOverlap } from '../src/memo-card-board-hex';
import { rawOffsets } from '../src/memo-card-board-paste';
import { boxDepth, boxOutside, cellAt, centerSpot, GROUP_RINGS, groupSpotFrom, offsetsOverlap, otherCells, pointSpot, rightDownCells, ringSpot, SHAPE_SLACK, spotAt, spotsRightDown, templateSpots } from '../src/memo-card-board-spots';
import { viewToReadAdded } from '../src/memo-card-board-view';

const at = (x: number, y: number) => ({ x, y });
// 見本の型「賛成・反対・結論」の位置（ui/src/memo-card-template-samples.ts と同じ形）
const PROS_CONS = [at(240, 0), at(0, 150), at(480, 150), at(240, 300)];
// 下の区画の升目で作った、続いた 4 枚（3 列。利用者が画面で作った型と同じ作り）
const LOWER_GRID = [at(0, 0), at(210, 0), at(420, 0), at(0, 116)];

describe('升目の輪の順（今の「足す」の置き場と同じ）', () => {
  it('右と下の升は、歩数の少ない順。同じなら右が先', () => {
    expect(rightDownCells(1)).toEqual([{ dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 1, dy: 1 }]);
    expect(rightDownCells(2)).toEqual([{ dx: 2, dy: 0 }, { dx: 0, dy: 2 }, { dx: 2, dy: 1 }, { dx: 1, dy: 2 }, { dx: 2, dy: 2 }]);
    expect(rightDownCells(3)).toHaveLength(7);
  });
  it('上と左の升は、右と下の升と合わせて輪の全部になる', () => {
    expect(otherCells(1, HEX_STEP)).toHaveLength(8 - 3);
    expect(otherCells(2, HEX_STEP)).toHaveLength(16 - 5);
    expect(otherCells(1, HEX_STEP).every((c) => c.dx < 0 || c.dy < 0)).toBe(true);
  });
  it('奇数の段は、ずらしだけ右へ（六角の 83）。四角はずらさない', () => {
    expect(cellAt(at(10, 20), { dx: 1, dy: 1 }, HEX_STEP)).toEqual(at(10 + 166 + 83, 20 + 144));
    expect(cellAt(at(10, 20), { dx: 0, dy: 2 }, HEX_STEP)).toEqual(at(10, 20 + 288));
    expect(cellAt(at(0, 0), { dx: 1, dy: 1 }, SQUARE_GEO.step)).toEqual(at(210, 116));
  });
  it('spotForNewCard をくり返した位置は、真ん中と、そこから数えた右と下の升の順', () => {
    const view = { x: 0, y: 0, zoom: 1 };
    const vp = { w: 840, h: 600 };
    const base = centerSpot(view, vp, HEX_BOX);
    const taken: { x: number; y: number }[] = [];
    for (let i = 0; i < 12; i++) {
      const p = spotForNewCard(view, vp, taken, HEX_BOX, HEX_STEP, hexesOverlap);
      if (!p) throw new Error('置けない');
      taken.push(p);
    }
    expect(taken).toEqual([base, ...(spotsRightDown(base, 11, [], HEX_STEP, hexesOverlap) ?? [])]);
    expect(ringSpot(base, [], HEX_STEP, hexesOverlap)).toEqual(base);
  });
});

describe('右と下の升へ、型の順に置く（spotsRightDown）', () => {
  it('六角の 4 枚と 7 枚：右・右下・その右・右の右…。押したカードより左にも上にも出ない', () => {
    expect(spotsRightDown(at(0, 0), 4, [at(0, 0)], HEX_STEP, hexesOverlap)).toEqual([at(166, 0), at(83, 144), at(249, 144), at(332, 0)]);
    expect(spotsRightDown(at(0, 0), 7, [at(0, 0)], HEX_STEP, hexesOverlap)?.slice(4)).toEqual([at(0, 288), at(415, 144), at(166, 288)]);
  });
  it('30 枚：どの升も重ならず、押したカードとも重ならない。右と下だけ', () => {
    const spots = spotsRightDown(at(0, 0), 30, [at(0, 0)], HEX_STEP, hexesOverlap);
    expect(spots).toHaveLength(30);
    const all = [at(0, 0), ...(spots ?? [])];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(hexesOverlap(all[i], all[j]), `${i}-${j}`).toBe(false);
    expect((spots ?? []).every((p) => p.x >= 0 && p.y >= 0)).toBe(true);
  });
  it('押したカードが升目に無くても、そのカードから数える', () => {
    expect(spotsRightDown(at(37, 51), 3, [at(37, 51)], HEX_STEP, hexesOverlap)).toEqual([at(203, 51), at(120, 195), at(286, 195)]);
  });
  it('ふさがった升は飛ばす（描いているカードも、保存を待っているカードも、避ける位置として渡す）', () => {
    expect(spotsRightDown(at(0, 0), 3, [at(0, 0), at(170, 10)], HEX_STEP, hexesOverlap)).toEqual([at(83, 144), at(249, 144), at(332, 0)]);
  });
  it('±10,000 の外の升は使わない（端では、縦の 1 列になる）', () => {
    expect(spotsRightDown(at(9900, 0), 4, [at(9900, 0)], HEX_STEP, hexesOverlap)).toEqual([at(9983, 144), at(9900, 288), at(9983, 432), at(9900, 576)]);
  });
  it('四角は、四角の歩みで同じ順', () => {
    expect(spotsRightDown(at(0, 0), 4, [at(0, 0)])).toEqual([at(210, 0), at(0, 116), at(210, 116), at(420, 0)]);
  });
  it('0 枚は空。輪の中に空きが足りなければ null', () => {
    expect(spotsRightDown(at(0, 0), 0, [])).toEqual([]);
    expect(spotsRightDown(at(0, 0), 4, [at(0, 0)], HEX_STEP, () => true)).toBeNull();
  });
});

describe('型の中の重なり（offsetsOverlap）', () => {
  it('下の区画の升目の上下の 2 枚は、六角では重なり、四角では重ならない', () => {
    expect(offsetsOverlap([at(0, 0), at(0, 116)], hexDepth)).toBe(true);
    expect(offsetsOverlap([at(0, 0), at(0, 116)], boxDepth)).toBe(false);
  });
  it('六角の隣どうしは、六角では重ならず、四角では重なる', () => {
    expect(offsetsOverlap([at(0, 0), at(166, 0)], hexDepth)).toBe(false);
    expect(offsetsOverlap([at(0, 0), at(166, 0)], boxDepth)).toBe(true);
  });
  it('位置を持たない型（全部 0）は重なる。1 枚は重ならない', () => {
    expect(offsetsOverlap([at(0, 0), at(0, 0)], hexDepth)).toBe(true);
    expect(offsetsOverlap([at(0, 0), at(0, 0)], boxDepth)).toBe(true);
    expect(offsetsOverlap([at(0, 0)], hexDepth)).toBe(false);
  });
  it(`浅い重なり（深さ ${SHAPE_SLACK} まで）は数えない`, () => {
    expect(hexDepth(at(0, 0), at(146, 0))).toBe(4);
    expect(offsetsOverlap([at(0, 0), at(146, 0)], hexDepth)).toBe(false);
    expect(offsetsOverlap([at(0, 0), at(140, 0)], hexDepth)).toBe(true);
    expect(offsetsOverlap([at(0, 0), at(140, 0)], hexDepth, 10)).toBe(false);
  });
  it('形の口（geo）の深さは、六角と四角で別の決め方', () => {
    expect(HEX_GEO.depth(at(0, 0), at(166, 0))).toBe(-16);
    expect(SQUARE_GEO.depth(at(0, 0), at(166, 0))).toBe(24);
    expect(SQUARE_GEO.depth(at(0, 0), at(0, 116))).toBe(-20);
  });
});

describe('形を保つ一団の置き場（groupSpotFrom）', () => {
  it('空いていれば、始めの位置', () => {
    expect(groupSpotFrom(at(166, 0), [at(0, 0)], PROS_CONS, HEX_STEP, hexesOverlap)).toEqual(at(166, 0));
  });
  it('ふさがっていれば、一団ごと右と下へずらす（上と左へは探さない）', () => {
    expect(groupSpotFrom(at(166, 0), [at(0, 0), at(400, 10)], PROS_CONS, HEX_STEP, hexesOverlap)).toEqual(at(332, 0));
  });
  it(`輪は ${GROUP_RINGS} つまで。その中に空きが無ければ null`, () => {
    expect(groupSpotFrom(at(166, 0), [at(0, 0)], PROS_CONS, HEX_STEP, () => true)).toBeNull();
    expect(groupSpotFrom(at(166, 0), [at(400, 10)], PROS_CONS, HEX_STEP, hexesOverlap, 0)).toBeNull();
  });
  it('避ける位置が空でも、型の位置が空でなければ、始めの位置を返す（引数の順）', () => {
    expect(groupSpotFrom(at(5, 5), [], [at(0, 0), at(300, 0)])).toEqual(at(5, 5));
  });
});

describe('型を置く決まり（templateSpots。押したカードが基準）', () => {
  const hex = (raw: { x: number; y: number }[], taken = [at(0, 0)]) => templateSpots({ raw, anchor: { kind: 'card', at: at(0, 0) }, taken, step: HEX_GEO.step, overlaps: HEX_GEO.overlaps, depth: HEX_GEO.depth });
  it('型の中に重なりが無ければ、形のまま、押したカードの右から出る（見本の型）', () => {
    expect(hex(PROS_CONS)).toEqual([at(406, 0), at(166, 150), at(646, 150), at(406, 300)]);
  });
  it('型の中で重なれば、右と下の升へ順に（下の区画の升目で作った型を、六角で置く）', () => {
    expect(hex(LOWER_GRID)).toEqual([at(166, 0), at(83, 144), at(249, 144), at(332, 0)]);
  });
  it('同じ型でも、四角では形のまま出る', () => {
    expect(templateSpots({ raw: LOWER_GRID, anchor: { kind: 'card', at: at(0, 0) }, taken: [at(0, 0)] })).toEqual([at(210, 0), at(420, 0), at(630, 0), at(210, 116)]);
  });
  it('位置を持たない型・1 枚の型は、升へ順に。0 枚は空', () => {
    expect(hex([at(0, 0), at(0, 0), at(0, 0)])).toEqual([at(166, 0), at(83, 144), at(249, 144)]);
    expect(hex([at(0, 0)])).toEqual([at(166, 0)]);
    expect(hex([])).toEqual([]);
  });
  it('形を保つ置き方で空きが無ければ、升へ順に落とす', () => {
    // 一団がどこへずらしても当たるように、型のカードの出る辺りを広くふさぐ（升 (2,0)〜(5,2) の辺り）
    const wall = [at(0, 0)];
    for (let x = 300; x <= 1200; x += 150) for (let y = -100; y <= 700; y += 160) wall.push(at(x, y));
    const spots = hex(PROS_CONS, wall);
    expect(spots).not.toBeNull();
    expect(spots).toHaveLength(4);
    expect(spots).not.toEqual([at(406, 0), at(166, 150), at(646, 150), at(406, 300)]); // 形のままの位置ではない
    expect((spots ?? []).every((p) => p.x >= 0 && p.y >= 0)).toBe(true);
    for (const p of spots ?? []) expect(wall.some((t) => hexesOverlap(p, t))).toBe(false);
  });
});

describe('型の生の位置の差（rawOffsets）', () => {
  const tpl = (pts: { x: number; y: number }[]) => ({ cards: pts.map((p) => ({ dx: p.x, dy: p.y })) }) as never;
  it('いちばん左・いちばん上を 0 にする。位置を持たない型は、升目に広げずに全部 0', () => {
    expect(rawOffsets(tpl([at(240, 130), at(120, 0), at(0, 130)]))).toEqual([at(240, 130), at(120, 0), at(0, 130)]);
    expect(rawOffsets(tpl([at(50, 60), at(260, 60)]))).toEqual([at(0, 0), at(210, 0)]);
    expect(rawOffsets(tpl([at(0, 0), at(0, 0), at(0, 0)]))).toEqual([at(0, 0), at(0, 0), at(0, 0)]);
    expect(rawOffsets(tpl([]))).toEqual([]);
  });
});

describe('型を足したあとの寄せ方（viewToReadAdded）', () => {
  const box = (x: number, y: number) => ({ x, y, w: 150, h: 174 });
  it('全部が読めていれば、動かさない', () => {
    expect(viewToReadAdded({ x: 10, y: 10, zoom: 1 }, box(0, 0), [box(166, 0)], { w: 840, h: 600 })).toBeNull();
  });
  it('全部を囲む箱が面に入るなら、押したカードも足した分も読める所へ', () => {
    expect(viewToReadAdded({ x: 0, y: -300, zoom: 1 }, box(0, 0), [box(166, 144)], { w: 840, h: 900 })).toEqual({ x: 2, y: 2, zoom: 1 });
  });
  it('入らなければ、足した分だけを目当てにする（押したカードの側には合わせない）', () => {
    expect(viewToReadAdded({ x: 0, y: 0, zoom: 1 }, box(0, 0), [box(700, 0)], { w: 840, h: 600 })).toEqual({ x: -12, y: 2, zoom: 1 });
  });
  it('基準が無ければ（空きから）、足した分だけ。足した分が無ければ null', () => {
    expect(viewToReadAdded({ x: 0, y: 0, zoom: 1 }, null, [box(900, 10)], { w: 840, h: 600 })).toEqual({ x: -212, y: 0, zoom: 1 });
    expect(viewToReadAdded({ x: 0, y: 0, zoom: 1 }, box(0, 0), [], { w: 840, h: 600 })).toBeNull();
  });
});

describe('空きで押した点に 1 枚置く（spotAt・pointSpot。TA4a）', () => {
  const hex = (p: { x: number; y: number }, taken: { x: number; y: number }[]) => spotAt(p, taken, HEX_STEP, hexesOverlap);
  const sq = (p: { x: number; y: number }, taken: { x: number; y: number }[]) => spotAt(p, taken, SQUARE_GEO.step, SQUARE_GEO.overlaps);
  const A = at(0, 0);
  it('点を真ん中にした箱の左上（整数。±10,000 に収める）', () => {
    expect(pointSpot(at(500, 300), HEX_BOX)).toEqual(at(425, 213));
    expect(pointSpot(at(500, 300))).toEqual(at(405, 252));
    expect(pointSpot(at(500, 300), SQUARE_GEO.box)).toEqual(pointSpot(at(500, 300)));
    expect(pointSpot(at(99999, -99999), HEX_BOX)).toEqual(at(10000, -10000));
  });
  it('空いていれば、押した所そのもの（升には寄せない。接していてもよい）', () => {
    expect(hex(at(37.4, 51.6), [])).toEqual(at(37, 52));
    expect(hex(at(400, 300), [A])).toEqual(at(400, 300));
    expect(hex(at(150, 0), [A])).toEqual(at(150, 0)); // 辺が接するだけ
    expect(sq(at(190, 0), [A])).toEqual(at(190, 0));
  });
  it('六角：ふさがっていれば、重なる相手の隣の升のうち、押した所にいちばん近い空き', () => {
    expect(hex(at(100, 0), [A])).toEqual(at(166, 0)); // 右（66）。右下は 145
    expect(hex(at(65, 78), [A])).toEqual(at(83, 144)); // 右下（68.4）。右は 127.6
    expect(hex(at(148, 85), [A])).toEqual(at(166, 0)); // 角の向き。右 86.9・右下 87.8
    expect(hex(at(-100, 0), [A])).toEqual(at(-166, 0)); // 左にも出る（押した所に近い方）
    expect(hex(at(10, -100), [A])).toEqual(at(83, -144)); // 上にも出る
  });
  it('同じ近さなら下、次に右', () => {
    expect(hex(at(0, 120), [A])).toEqual(at(83, 144)); // 右下と左下が同じ近さ
    expect(sq(at(105, 58), [A])).toEqual(at(210, 116)); // 右・下・右下が同じ近さ
  });
  it('六角：2 枚に掛かるとき。相手どうしでふさがる升は使わない', () => {
    const B = at(180, 0);
    expect(hex(at(90, 0), [A, B])).toEqual(at(97, 144)); // A の右は B と、B の左は A と重なる
    expect(hex(at(140, 30), [A, at(40, 30)])).toEqual(at(206, 30)); // 重なった 2 枚。A の右・右下は B と重なる
    expect(hex(at(200, 60), [A, at(332, 0), at(249, 144), at(83, 144)])).toEqual(at(166, 0)); // 升目の穴に入る
  });
  it('四角：隣の升は 8 つ（斜めも）', () => {
    expect(sq(at(105, 0), [A])).toEqual(at(210, 0));
    expect(sq(at(189, 95), [A])).toEqual(at(210, 116)); // 重なりは 1×1。右下がいちばん近い
    expect(sq(at(115, 0), [A, at(230, 0)])).toEqual(at(210, 116));
    expect(sq(at(115, 40), [A, at(230, 0), at(115, 130)])).toEqual(at(210, -116)); // 下がふさがっていれば、上に出る
  });
  it('置いた所は、どのカードとも重ならない', () => {
    const taken = [A, at(166, 0), at(83, 144), at(40, 300), at(-120, 90)];
    for (let x = -200; x <= 400; x += 37) {
      for (let y = -200; y <= 500; y += 41) {
        const p = hex(at(x, y), taken);
        expect(p, `${x},${y}`).not.toBeNull();
        expect(taken.some((t) => hexesOverlap(p!, t)), `${x},${y}`).toBe(false);
      }
    }
  });
  it('隣の升が全部ふさがっていれば、押した所から升目の輪で探す（右と下が先）。±10,000 の外は使わない', () => {
    const ring = [at(166, 0), at(-166, 0), at(83, 144), at(-83, 144), at(83, -144), at(-83, -144)];
    const p = hex(at(0, 0), [A, ...ring]);
    expect(p).toEqual(ringSpot(at(0, 0), [A, ...ring], HEX_STEP, hexesOverlap));
    expect(p).toEqual(at(249, 144)); // 輪 1 の右 (166,0)・右下 (83,144) はふさがり、その次の升
    expect(hex(at(10000, 0), [at(10000, 0)])).toEqual(at(9834, 0)); // 右は範囲の外。左が空き
    expect(spotAt(at(0, 0), [A], HEX_STEP, () => true, 1)).toBeNull(); // どこも重なるなら null
  });
  it('箱の縁から外への離れ（四角の geo の outside）', () => {
    expect(boxOutside(A, at(95, 48))).toBe(-48);
    expect(boxOutside(A, at(190, 48))).toBe(0);
    expect(boxOutside(A, at(198, 48))).toBe(8);
    expect(boxOutside(A, at(95, -5))).toBe(5);
  });
});

describe('型を置く決まり（templateSpots。空きで押した所・面の真ん中が基準。TA5）', () => {
  const point = (raw: { x: number; y: number }[], p: { x: number; y: number }, taken: { x: number; y: number }[] = []) =>
    templateSpots({ raw, anchor: { kind: 'point', at: pointSpot(p, HEX_BOX), corner: p }, taken, step: HEX_GEO.step, overlaps: HEX_GEO.overlaps, depth: HEX_GEO.depth });
  const center = (raw: { x: number; y: number }[], c: { x: number; y: number }, taken: { x: number; y: number }[] = []) =>
    templateSpots({ raw, anchor: { kind: 'center', at: c }, taken, step: HEX_GEO.step, overlaps: HEX_GEO.overlaps, depth: HEX_GEO.depth });
  it('点・順に升へ：1 枚目は、押した点を真ん中にした所。残りは、その 1 枚目の右と下の升へ', () => {
    const s = pointSpot(at(500, 300), HEX_BOX); // (425, 213)
    expect(point(LOWER_GRID, at(500, 300))).toEqual([s, at(s.x + 166, s.y), at(s.x + 83, s.y + 144), at(s.x + 249, s.y + 144)]);
    expect(point([at(0, 0)], at(500, 300))).toEqual([s]); // 1 枚の型
    expect(point([at(0, 0), at(0, 0), at(0, 0)], at(500, 300))).toEqual([s, at(s.x + 166, s.y), at(s.x + 83, s.y + 144)]); // 位置を持たない型
  });
  it('点・順に升へ：押した所がふさがっていれば、1 枚目は近くの升へ寄り（spotAt）、残りはそこから。どのカードとも重ならない', () => {
    const taken = [at(0, 0)];
    const spots = point(LOWER_GRID, at(175, 87), taken); // 置き場の左上は (100, 0)：(0,0) のカードと重なる
    expect(spots?.[0]).toEqual(at(166, 0));
    expect(spots).toEqual([at(166, 0), at(332, 0), at(249, 144), at(415, 144)]);
    for (const p of spots ?? []) expect(taken.some((t) => hexesOverlap(p, t))).toBe(false);
  });
  it('点・形を保つ：一団の左上の角を、押した点に合わせる（カードは、押した点から右と下だけに出る）。ふさがっていれば、右と下へ 2 輪まで', () => {
    expect(point(PROS_CONS, at(500, 300))).toEqual(PROS_CONS.map((d) => at(500 + d.x, 300 + d.y)));
    expect(point(PROS_CONS, at(500.4, 299.6))).toEqual(PROS_CONS.map((d) => at(500 + d.x, 300 + d.y))); // 整数にする
    const moved = point(PROS_CONS, at(500, 300), [at(740, 310)]); // 型の 1 枚目 (740, 300) と重なる：一団ごと右の升へ
    expect(moved).toEqual(PROS_CONS.map((d) => at(500 + 166 + d.x, 300 + d.y)));
    // corner が無ければ、at を一団の左上にする
    expect(templateSpots({ raw: PROS_CONS, anchor: { kind: 'point', at: at(10, 20) }, taken: [], step: HEX_GEO.step, overlaps: HEX_GEO.overlaps, depth: HEX_GEO.depth })).toEqual(PROS_CONS.map((d) => at(10 + d.x, 20 + d.y)));
  });
  it('点・形を保つ置き方で空きが無ければ、順に升へ（1 枚目は押した所）', () => {
    // 一団を置ける 9 つの所（押した点と、右と下の 2 輪）の全部で、型の 1 枚目が当たるように、カードを置く
    const start = at(500, 300);
    const origins = [start, ...[1, 2].flatMap((ring) => rightDownCells(ring).map((c) => cellAt(start, c, HEX_STEP)))];
    const wall = origins.map((o) => at(o.x + PROS_CONS[0].x, o.y + PROS_CONS[0].y));
    expect(origins).toHaveLength(9);
    const spots = point(PROS_CONS, at(500, 300), wall);
    expect(spots).toHaveLength(4);
    expect(spots?.[0]).toEqual(pointSpot(at(500, 300), HEX_BOX));
    for (const p of spots ?? []) expect(wall.some((t) => hexesOverlap(p, t))).toBe(false);
  });
  it('真ん中・順に升へ：1 枚目は、今の「足す」と同じ探し方（真ん中から、右と下）。上や左へは出ない', () => {
    const c = at(345, 213);
    expect(center(LOWER_GRID, c)).toEqual([c, at(c.x + 166, c.y), at(c.x + 83, c.y + 144), at(c.x + 249, c.y + 144)]);
    const spots = center(LOWER_GRID, c, [c]); // 真ん中がふさがっている：1 枚目は右の升
    expect(spots?.[0]).toEqual(ringSpot(c, [c], HEX_STEP, hexesOverlap));
    expect(spots?.[0]).toEqual(at(c.x + 166, c.y));
    for (const p of spots ?? []) expect(p.x >= c.x && p.y >= c.y).toBe(true);
  });
  it('真ん中・形を保つ：一団の左上を、真ん中の置き場に置く', () => {
    expect(center(PROS_CONS, at(345, 213))).toEqual(PROS_CONS.map((d) => at(345 + d.x, 213 + d.y)));
  });
  it('四角でも同じ決まり（既定の歩みと重なり）', () => {
    const s = pointSpot(at(400, 200)); // (305, 152)
    expect(templateSpots({ raw: [at(0, 0), at(0, 0)], anchor: { kind: 'point', at: s, corner: at(400, 200) }, taken: [] })).toEqual([s, at(s.x + 210, s.y)]);
    expect(templateSpots({ raw: LOWER_GRID, anchor: { kind: 'point', at: s, corner: at(400, 200) }, taken: [] })).toEqual(LOWER_GRID.map((d) => at(400 + d.x, 200 + d.y))); // 四角では重ならないので、形のまま
  });
});
