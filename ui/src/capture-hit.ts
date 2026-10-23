// 読む画面で、クリックした場所にある線・文字を探す（R4-C F2）。純粋な計算だけで、DOM は触らない。
//   座標は画像の px。描き手（capture-draw.ts の drawAnnotations）が返す boxes と、annotationStyle の太さを使い、
//   画面に描いてあるものと同じ大きさで当てる。隠した矩形（blur）は描き手が boxes に入れないので、ここでは当たらない。
import { annotationStyle, type AnnotationBox } from './capture-draw';
import type { CaptureStroke } from './captures';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 点 (px, py) から線分 (x1, y1)-(x2, y2) までの距離。射影を 0〜1 に挟む（長さ 0 の線分は、その点までの距離）
function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lengthSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function inside(px: number, py: number, rect: Rect, grow: number) {
  return px >= rect.x - grow && px <= rect.x + rect.w + grow && py >= rect.y - grow && py <= rect.y + rect.h + grow;
}

// px・py・tolPx は画像 px。strokes の末尾（上に描いたもの）から見て、最初に当たった線を返す。当たらなければ null。
//   矢印＝線分からの距離 ≤ 太さ/2 ＋ tol、蛍光ペン＝距離 ≤ 太さ/2（余裕なし）、四角＝4 辺からの距離 ≤ 太さ/2 ＋ tol（中は当てない）、
//   文字＝boxes の同じ id の矩形を tol だけ広げた中。矢印・四角は、ひとことの矩形（box.label）の中も当てる
export function hitStroke(
  strokes: readonly CaptureStroke[],
  boxes: readonly AnnotationBox[],
  width: number,
  height: number,
  px: number,
  py: number,
  tolPx: number,
): CaptureStroke | null {
  if (!(width > 0) || !(height > 0)) return null;
  const style = annotationStyle(width, height);
  const boxOf = new Map<string, AnnotationBox>();
  for (const box of boxes) if (box.piece === 'stroke') boxOf.set(box.id, box);
  for (let index = strokes.length - 1; index >= 0; index--) {
    const stroke = strokes[index];
    const x1 = stroke.x1 * width;
    const y1 = stroke.y1 * height;
    const x2 = stroke.x2 * width;
    const y2 = stroke.y2 * height;
    const box = boxOf.get(stroke.id);
    if (stroke.kind === 'text') {
      if (box && inside(px, py, box, tolPx)) return stroke;
      continue;
    }
    if (stroke.kind === 'marker') {
      if (distanceToSegment(px, py, x1, y1, x2, y2) <= style.marker / 2) return stroke;
      continue;
    }
    const reach = style.thin / 2 + tolPx;
    if (stroke.kind === 'arrow') {
      if (distanceToSegment(px, py, x1, y1, x2, y2) <= reach) return stroke;
      // 矢じりの羽（描き手と同じ形：長さは線の太さ×6、開きは headSpread）。拡大すると余裕が小さくなるので、羽も当てる
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const head = style.thin * 6;
      const ax = x2 - head * Math.cos(angle - style.headSpread);
      const ay = y2 - head * Math.sin(angle - style.headSpread);
      const bx = x2 - head * Math.cos(angle + style.headSpread);
      const by = y2 - head * Math.sin(angle + style.headSpread);
      if (distanceToSegment(px, py, x2, y2, ax, ay) <= reach || distanceToSegment(px, py, x2, y2, bx, by) <= reach) return stroke;
    } else {
      const left = Math.min(x1, x2);
      const right = Math.max(x1, x2);
      const top = Math.min(y1, y2);
      const bottom = Math.max(y1, y2);
      if (
        distanceToSegment(px, py, left, top, right, top) <= reach ||
        distanceToSegment(px, py, right, top, right, bottom) <= reach ||
        distanceToSegment(px, py, right, bottom, left, bottom) <= reach ||
        distanceToSegment(px, py, left, bottom, left, top) <= reach
      ) {
        return stroke;
      }
    }
    if (box?.label && inside(px, py, box.label, 0)) return stroke;
  }
  return null;
}
