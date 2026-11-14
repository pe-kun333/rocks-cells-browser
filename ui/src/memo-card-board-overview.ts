// 「［全体］の間」（MK2。docs/plan-comment-board-marks.md §4.2）：［全体］を押してから、％・Esc で前の位置へ戻るか、終わるだけの出来事までの間
//   DOM も localStorage も使わない（ui/test/memo-card-board-overview.test.ts）。持つのは app/memo-board-tab.ts
//   始めてよいか・覚える位置・終わりの理由・面の上端が動いたときの直し・％の項目の字と説明と読み上げ
//   MK3（§4.3）：間だけ上の区画を高くする量（overviewNeedPx）・ピンチで終えたあと高さを戻すまで待つか・戻すときの y の寄せ（ui/test/memo-card-board-upper-borrow.test.ts）
//   MK8a（§4.8）：印のカードがあるときは、借りる量を、左右に吹き出しの席が残る高さまでにする（上限の計算は memo-card-board-callouts.ts の calloutFaceCap）
//   画面の字は textContent・属性だけで入れる（呼ぶ側）
import { t as tr } from './i18n';
import { BOARD_LIMITS, type BoardView, type CardSize, fitView, panBy, placementBounds } from './memo-card-board';
import { calloutFaceCap, hasCalloutMark } from './memo-card-board-callouts';

// 間を終える理由。return＝前の位置へ戻る（％・Esc）。ほかは終わるだけ（見ている位置はそのまま）
//   zoom＝ピンチ・Ctrl＋ホイールで倍率が替わった／memo＝メモの替え／close＝メモが閉じた／place＝置き場の替え／shape＝形の替え／hide＝隠す／jump＝カードへ跳ぶ（MK4 の［上で開く］・MK8 の吹き出しの頭のダブルクリック）
export type OverviewEnd = 'return' | 'zoom' | 'memo' | 'close' | 'place' | 'shape' | 'hide' | 'jump';

export interface Overview {
  before: BoardView; // ［全体］を押す直前の見ている位置（倍率と x・y。面の左上から）
}

// 同じ位置とみなす差：倍率は 0.005 未満、位置は x・y とも 1px 未満
export const SAME_ZOOM = 0.005;
export const SAME_PX = 1;
const EPS = 1e-9; // 小数の引き算の誤差（1.005 − 1 が 0.005 より少し小さくなる）で、ちょうど 0.005 の差を同じとみなさないため

export function sameView(a: BoardView, b: BoardView): boolean {
  return Math.abs(a.zoom - b.zoom) < SAME_ZOOM - EPS && Math.abs(a.x - b.x) < SAME_PX - EPS && Math.abs(a.y - b.y) < SAME_PX - EPS;
}

export interface OverviewStartInput {
  loading: boolean; // ボードのファイルを読んでいる途中
  unreadable: boolean; // 読めないボード
  cards: number; // 描いているカードの数
  ready: boolean; // 面に大きさがあり、開いたときの位置を決め終えている（needFit が下りている）
  view: BoardView; // 今の見ている位置
  fit: BoardView; // ［全体］の位置
  marked: boolean; // 描いているカードに印（♥・色）がある（MK8b。吹き出しを出すため、全体の位置が今と同じでも始める）
}

// ［全体］を押したとき（間でないとき）：始めるなら覚える中身、始めないなら null。
//   読み込み中・カード 0 枚・読めないボードでは始めない。面の大きさが 0 か、開いたときの位置をまだ決めていない（ready でない）ときも始めない
//   （覚えるのが開く前の位置になり、あとで開き方の決まりが位置を決め直しても間が続くため）。全体の位置が今の位置と同じときも始めない（そのときの％は今までどおり 100%）。
//   ただし MK8b（MK8a の記録の (c)）：描いているカードに印があれば、全体の位置が今と同じでも始める（吹き出しを出す道がほかに無いため。覚える位置は今の位置。借りる高さもふつうどおり。
//   そのときの％は「全体の前」＝今の位置へ戻る：借りていれば境目が戻り、借りていなければ見ている位置は動かない）
export function overviewStart(input: OverviewStartInput): Overview | null {
  if (input.loading || input.unreadable || input.cards <= 0 || !input.ready) return null;
  if (sameView(input.view, input.fit) && !input.marked) return null;
  return { before: { x: input.view.x, y: input.view.y, zoom: input.view.zoom } };
}

// 前の位置へ戻る理由か（％・Esc だけ）
export const overviewGoesBack = (reason: OverviewEnd): boolean => reason === 'return';

// ---------- MK3：「［全体］の間」だけ上の区画を高くする（境目を一時に下げる。§4.3） ----------

// ［全体］の余白（片側）と、合わせるときの上限の倍率（fitView の既定と同じ）
export const FIT_PAD = 18;
export const FIT_MAX_ZOOM = 1.2;
// ピンチで間を終えたあと、止まったとみなして高さを戻すまでの長さ（最後の wheel から。保存の待ちと同じ長さ）
export const UPPER_BACK_MS = 400;

// 上の区画に足してほしい高さ（画素）。目当ての倍率 z＝min((面の幅 − 36) ÷ 外枠の幅, 1.2) を 0.25〜2 に収め、要る高さ＝外枠の高さ × z ＋ 36。
//   返すのは 要る高さ − 今の面の高さ（切り上げ）。0 以下なら借りない（幅で決まり、全体も入っている）。下限 0.25 で止まって入りきらないボードは正（借りる。はみ出した行が見える）。
//   カードが無い・面の幅が余白より狭いときは 0。placements と size は fitAll と同じもの（外枠は placementBounds）
//   MK8a（§4.8 の MK3 との組み）：印（like・color）のあるカードがあれば、［全体］で左右に吹き出しの席（空き 200 以上）が残る高さまでにする（calloutFaceCap。外枠の x と fitView の丸めの分を見込み、切り捨てて 2 引く）。
//   今の面ですでに席が無いとき・借りても席が残るときは、上限をかけない。印は描いているカードの全部で見る（絞り・検索で薄くしたカードも数える）
export function overviewNeedPx(placements: readonly { x: number; y: number; like?: number; color?: string }[], viewport: { w: number; h: number }, size?: CardSize): number {
  const box = placementBounds(placements, size);
  if (!box || !(box.w > 0) || !(box.h > 0) || !Number.isFinite(viewport.h)) return 0;
  const aw = viewport.w - FIT_PAD * 2;
  if (!(aw > 0)) return 0;
  const zoom = Math.min(Math.max(Math.min(aw / box.w, FIT_MAX_ZOOM), BOARD_LIMITS.zoomMin), BOARD_LIMITS.zoomMax);
  const need = Math.ceil(box.h * zoom + FIT_PAD * 2 - viewport.h);
  if (!placements.some(hasCalloutMark)) return need;
  const cap = calloutFaceCap(box, viewport.w, fitView(box, viewport).zoom, zoom, FIT_PAD);
  return cap === null ? need : Math.min(need, cap - viewport.h);
}

// 間を終えたとき、借りた高さを戻すのを待つか（ピンチ・Ctrl＋ホイールで終えたときだけ。止まったとみなすまで待つ）。ほかの理由はその場で戻す
export const overviewUpperWaits = (reason: OverviewEnd): boolean => reason === 'zoom';

// ピンチで終えたあと高さを戻す（面の上端は動かず、高さが h0 から h1 になる）：面の真ん中に見えていた点が真ん中に残るよう、y を高さの差の半分だけ動かす。倍率と x はそのまま
export function upperGiveBackView(view: BoardView, h0: number, h1: number): BoardView {
  if (!Number.isFinite(h0) || !Number.isFinite(h1) || h0 === h1) return view;
  return panBy(view, 0, (h1 - h0) / 2);
}

// 面の上端が動いた（道具の列を畳む・開く、絞りの札の行。settleFace）：覚えた位置の y にも、今の位置と同じ差を足す
//   間は［全体］で触ったあとなので、今の位置は settleView で上端の差 dy を引くだけ（下へ動けば正）。覚えた位置も同じく dy を引く
export function overviewFaceMoved(o: Overview, dy: number): Overview {
  return dy === 0 ? o : { before: panBy(o.before, 0, -dy) };
}

// ％の項目の説明（間でないとき。HX1 の字のまま）
export const ZOOM_TITLE = tr('100% にします（1 枚選んでいればそのカード、選んでいなければ最後に書いた辺りを見せます）');

export interface ZoomTexts {
  percent: number; // 今の倍率（％。四捨五入）
  text: string; // ボタンの字
  title: string; // 説明
  label: string; // 読み上げの名前
}

// ％の項目の字・説明・読み上げ。back：覚えた位置（間でなければ null）。間の説明は「押すと全体の前（85%）に戻ります」（数は覚えた倍率）
export function zoomTexts(zoom: number, back: BoardView | null): ZoomTexts {
  const percent = Math.round(zoom * 100);
  const before = back ? Math.round(back.zoom * 100) : 0;
  const press = back ? tr('押すと全体の前（{0}%）に戻ります', { 0: before }) : tr('押すと 100% にします');
  const label = back ? tr('倍率 {0}%。押すと全体の前（{1}%）に戻ります', { 0: percent, 1: before }) : tr('倍率 {0}%。押すと 100% にします', { 0: percent });
  return { percent, text: `${percent}%`, title: back ? press : ZOOM_TITLE, label };
}
