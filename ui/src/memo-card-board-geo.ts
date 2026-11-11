// ボードの形ごとの寸法と置き方の口（geo。HX4・HX5。DOM も保存も使わない。ui/test/memo-card-board-hex.test.ts）
//   四角の口は今の関数を包むだけ（答えは今と同じ）。六角の口の計算は memo-card-board-hex.ts
//   app/memo-board-tab.ts は、形に関わる所（並べ方・線・範囲選択・Shift＋矢印・面の真ん中・見えている割合・面の外の札・［全体］・読む箱・最後に書いた辺り・メニューの出し口・
//   足す・貼る置き場と重なり）でこの口だけを使う。ファイルに書く動きの計画は、読み込みの形で選ぶ planBoardMoves
import { BOARD_CARD, type Board, type BoardLayout, type BoardPlacement, type BoardView, boxesOverlap, type CardSize, type GridStep, layoutCards, type NodeMove, type Rect, SQUARE_STEP } from './memo-card-board';
import { HEX_BOX, HEX_CENTER, HEX_NEAR, HEX_NEAREST, HEX_STEP, hexDepth, hexEdgeGeometry, hexesOverlap, hexHitsRect, hexLayout, hexMenuAnchor, hexOutside, hexReadBox, hexRecentView, hexSlideBox, planHexMoves } from './memo-card-board-hex';
import { hexRoutedEdge } from './memo-card-board-route';
import type { NearestOpts, Pt } from './memo-card-board-select';
import { boxDepth, boxOutside } from './memo-card-board-spots';
import type { LoadBoardResult } from './memo-card-board-store';
import { edgeGeometry, type EdgeGeometry, type MovePlan, planMoves, recentView, type ReadBox, type RecentFn, squareReadBox, type Viewport } from './memo-card-board-view';
import type { Reply } from './threads';

export interface BoardGeo {
  readonly layout: BoardLayout;
  readonly box: CardSize; // 箱の大きさ（位置の左上から）：見えている割合・面の外の札・［全体］・足す置き場
  readonly center: Pt; // 箱の左上から中心まで：面の真ん中に近いカード（キーのメニュー・Shift＋矢印の起点）
  readonly readBox: ReadBox; // 読めるかを見る箱：開いたとき・出したとき・面が替わったとき・書く欄・「100%」
  slideBox(at: Pt, zoom: number, viewport: Viewport): Rect; // 足したあと・面の外で離したあとに滑らせる目当て（slideToRead）。四角は読む箱。六角は箱が面に入らなければ文の帯（HX5）
  readonly recent: RecentFn; // 最後に書いた辺り（開き方の決まり 3・4）
  readonly nearest: Readonly<NearestOpts>; // Shift＋矢印の隣のカードの選び方
  readonly step: Readonly<GridStep>; // 足す・貼る所を探す升目の歩み（四角 210×116、六角 166×144 で奇数の行は 83 右。HX5）
  readonly besideFallback: 'center' | 'last'; // Ctrl+Enter・Shift+Enter で選んだ 1 枚の横に置けない・選んだ 1 枚が無いとき：四角は面の真ん中から（HX2 のまま）、六角は［決める］と同じ置き方（HX5）
  depth(a: Pt, b: Pt): number; // 二枚（位置の左上）の重なりの深さ（重ならなければ 0 以下）。型を基準つきで置くとき、型の中の重なりを見る（TA1）
  readonly near: number; // 右クリックで、縁のすぐ外をそのカードの上と数える幅（六角 9。四角は箱の全部が押しを受けるので 0。TA4a）
  outside(at: Pt, p: Pt): number; // 点 p の、カード（位置の左上 at）の縁から外への離れ（中は 0 以下）。空きの右クリックで、近くのカードを見る（TA4a）
  overlaps(a: Pt, b: Pt): boolean; // 二枚（位置の左上）が重なるか（四角は箱、六角は六角どうし。隙間は足さない）。足す・貼る置き場で使う（HX5）
  place(replies: readonly Reply[], board: Board | null): BoardPlacement[]; // 並べ方（board はその形のファイル。置いたカードはその位置、ほかは仮の並び）
  edge(a: Pt, b: Pt): EdgeGeometry | null; // 線の形（a・b は箱の左上）
  // 線の形（ほかのカードの字を避ける。六角だけ。memo-card-board-route.ts）：others は両端のほかの、描いているカードの箱の左上。
  //   全部の線を作り直すとき（build）と、取り消し・同じ所で離したあとに動かしたカードの線を描き直すとき（routeLines）に使う。
  //   つまんで運ぶ間は edge（今の曲線）のまま。無い形（四角）は edge
  route?(a: Pt, b: Pt, others: readonly Pt[]): EdgeGeometry | null;
  hits(rect: Rect, at: Pt): boolean; // 範囲選択：ボードの座標の四角が、そのカード（箱の左上 at）に掛かるか
  menuAnchor(at: Pt): Pt; // メニュー・📌・［移る］の出し口（ボードの座標）
}

export const SQUARE_GEO: BoardGeo = {
  layout: 'square',
  box: { w: BOARD_CARD.w, h: BOARD_CARD.h },
  center: { x: BOARD_CARD.w / 2, y: BOARD_CARD.h / 2 },
  readBox: squareReadBox,
  slideBox: (at) => squareReadBox(at),
  recent: recentView,
  nearest: {},
  step: SQUARE_STEP,
  besideFallback: 'center',
  depth: (a, b) => boxDepth(a, b),
  near: 0,
  outside: (at, p) => boxOutside(at, p),
  overlaps: (a, b) => boxesOverlap(a, b),
  place: (replies, board) => layoutCards(replies, board),
  edge: (a, b) => edgeGeometry(a, b),
  hits: (rect, at) => at.x < rect.x + rect.w && at.x + BOARD_CARD.w > rect.x && at.y < rect.y + rect.h && at.y + BOARD_CARD.h > rect.y,
  menuAnchor: (at) => ({ x: at.x + BOARD_CARD.w, y: at.y }),
};

export const HEX_GEO: BoardGeo = {
  layout: 'hex',
  box: HEX_BOX,
  center: HEX_CENTER,
  readBox: hexReadBox,
  slideBox: (at, zoom, viewport) => hexSlideBox(at, zoom, viewport),
  recent: hexRecentView,
  nearest: HEX_NEAREST,
  step: HEX_STEP,
  besideFallback: 'last',
  depth: (a, b) => hexDepth(a, b),
  near: HEX_NEAR,
  outside: (at, p) => hexOutside(at, p),
  overlaps: (a, b) => hexesOverlap(a, b),
  place: (replies, board) => hexLayout(replies, board),
  edge: (a, b) => hexEdgeGeometry(a, b),
  route: (a, b, others) => hexRoutedEdge(a, b, others),
  hits: (rect, at) => hexHitsRect(rect, at),
  menuAnchor: (at) => hexMenuAnchor(at),
};

export const geoOf = (layout: BoardLayout): BoardGeo => (layout === 'hex' ? HEX_GEO : SQUARE_GEO);

// ファイルに書く動き（動かす・足す・貼る・戻す・やり直す）の計画を、読み込み（load）の形の決まりで作る（HX5）。今の形ではなく、書く先のファイルの形で選ぶ
//   四角：planMoves（今のまま。動かしたカードだけが入る。opts は使わない）。六角：planHexMoves（同じ所なら書かない・初めてなら固める・動かしたカードを nodes の最後へ）
//   opts.writeSame：足す道は同じ所でも書く（六角は固める）。opts.view：六角のファイルを初めて作るときの見ている位置（見る位置を触っていたときだけ渡す）
export function planBoardMoves(load: LoadBoardResult | null, replies: readonly Reply[], moves: readonly NodeMove[], now: number, opts: { writeSame?: boolean; view?: BoardView } = {}): MovePlan {
  return load?.layout === 'hex' ? planHexMoves(load, replies, moves, now, opts) : planMoves(load, replies, moves, now);
}
