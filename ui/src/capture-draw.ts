// 撮影の書き込み（矢印・四角・蛍光ペン・文字・スタンプ）を描く、たった一つの関数。
//   AI に送る画像は capture-ask.ts がこれで焼く。読む画面（reader/capture-view.ts）も、次の段で同じ関数で描く予定。
//   座標は台帳どおり 0〜1 の割合。width・height は保存画像の px で、
//   ctx は呼ぶ側が「ユーザー座標 1 単位 ＝ 画像の 1px」になるよう変換してから渡す。
//   画像は描かない・消さない。上に重ねるだけ（描く順は blur の枠 → strokes → marks → 四角の番号 → pending）。
//   隠した場所（blur）は画素に入っている。options.blur が 'outline' のときだけ、その場所に枠を重ねる（読む画面。送る画像は描かない）。
//   番号（R4）：スタンプを配列順に 1 から、続けて四角を配列順に。台帳には保存せず、numberPieces が決める（消すと詰まる）。
//   矢印・四角のひとこと（R4 F4）は、線のあとに文字と同じ drawText で描く。
//
// R4-A で決めた新しい数：番号の小丸は直径 badge×0.72・字 badge×0.44（送る画像の長辺 1,024 で 2 桁が読める大きさ）。
//   矢じりの長さは実際の線の太さ×6（縮図で線を太くしたときも釣り合う）。
import { t } from './i18n';
import type { CaptureBlur, CaptureMark, CaptureStroke, StampId, StrokeKind } from './captures';
import { stampOf } from './captures';

export interface AnnotationScene {
  strokes: readonly CaptureStroke[];
  marks: readonly CaptureMark[];
  blur?: readonly CaptureBlur[]; // 隠した場所。画素には入っている。options.blur が 'outline' のときだけ、枠を描く
  pending?: { kind: StrokeKind; x1: number; y1: number; x2: number; y2: number; color: string } | null; // ドラッグ中の線（画面だけ）。最後に描く
}

export interface AnnotationOptions {
  marks: 'none' | 'badge' | 'numbered'; // none＝描かない（今の送る画像）、badge＝絵文字の札（画面）、numbered＝札＋番号（R4）
  emoji?: boolean; // 既定 true。false のときは絵文字の代わりに 1 字（GLYPH）
  scale?: number; // 出力の px ÷ 画像の px。既定 1。線の下限の換算だけに使う
  minLinePx?: number; // 出力の px での線の太さの下限。既定 0（縮図で線が消えないため）
  blur?: 'none' | 'outline'; // 既定 none（送る画像）。outline＝隠した場所に、白と濃い色の破線の枠と対角線を重ねる（読む画面）
}

export interface AnnotationStyle {
  thin: number;
  marker: number;
  head: number;
  headSpread: number;
  text: number;
  lineHeight: number;
  outline: number;
  pad: number;
  badge: number;
  font: (size: number) => string;
  emojiFont: (size: number) => string;
}

// 画像の px。描いた要素の外接矩形（後で当たり判定に使う）
export interface AnnotationBox {
  id: string;
  piece: 'mark' | 'stroke';
  x: number;
  y: number;
  w: number;
  h: number;
  label?: { x: number; y: number; w: number; h: number }; // 矢印・四角のひとことの矩形。ある要素だけ。箱 ＝ 線とひとことの和
}

export interface AnnotationLayout {
  boxes: AnnotationBox[];
}

const MARKER_ALPHA = 0.55;
const TEXT_LINES_MAX = 8;
const ELLIPSIS = '…';
// 英単語・URL・数字としてひと続きに扱う字（折り返しで割らない）
const WORD_CHAR = /[A-Za-z0-9_\-.:/@#%&+=?]/;
const INK_RED = '#c23b4a';
const BADGE_FILL = 'rgb(255 248 230 / 92%)';
// 番号の小丸（スタンプの札の右下・四角の左上）。直径と字の大きさは badge に対する比
export const NUMBER_DOT = 0.72; // 番号の小丸の直径 ÷ badge（読む画面がひとことの入力欄の位置を見積もるのにも使う）
const NUMBER_FONT = 0.44;

export interface PieceNumber {
  n: number;
  piece: 'mark' | 'stroke';
  id: string;
}

// 番号。スタンプを配列順に 1 から、続けて四角（kind === 'rect'）を配列順に。矢印・蛍光ペン・文字には付けない。台帳には保存しない
//   （消せば詰まる）。読む画面・送る画像・送る文・カードの一覧は、みなこの関数の番号を使う
export function numberPieces(marks: readonly CaptureMark[], strokes: readonly CaptureStroke[]): PieceNumber[] {
  const numbers: PieceNumber[] = [];
  for (const mark of marks) numbers.push({ n: numbers.length + 1, piece: 'mark', id: mark.id });
  for (const stroke of strokes) {
    if (stroke.kind === 'rect') numbers.push({ n: numbers.length + 1, piece: 'stroke', id: stroke.id });
  }
  return numbers;
}

export function numberOf(numbers: readonly PieceNumber[], piece: 'mark' | 'stroke', id: string): number | undefined {
  return numbers.find((row) => row.piece === piece && row.id === id)?.n;
}

// 絵文字を使わないとき（options.emoji === false）の 1 字
const GLYPH: Record<StampId, string> = { good: t('良'), star: '★', ask: '？', idea: '！', care: '△' };

// 太さ・矢じり・文字の大きさは、今は幅（W）だけで決める。height は将来のために受け取っている
export function annotationStyle(width: number, _height: number): AnnotationStyle {
  const thin = Math.max(2, width / 420);
  const text = Math.max(14, Math.round(width / 44));
  return {
    thin,
    marker: Math.max(12, width / 48),
    head: thin * 6, // 基準の長さ。実際の矢じりは「実際の線の太さ × 6」（drawStroke）
    headSpread: 0.42,
    text,
    lineHeight: 1.25 * text,
    outline: Math.max(2, text / 8),
    pad: 2 * thin,
    badge: Math.max(24, Math.round(width / 32)),
    font: (size) => `700 ${size}px 'Segoe UI','Yu Gothic UI','Meiryo UI',sans-serif`,
    emojiFont: (size) => `${size}px 'Segoe UI Emoji','Segoe UI Symbol',sans-serif`,
  };
}

interface Inked {
  kind: StrokeKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  text: string;
}

// 画像に重ねる。ctx の状態は save/restore で戻す。返り値は、描いた要素の外接矩形
export function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scene: AnnotationScene,
  options: AnnotationOptions,
): AnnotationLayout {
  const boxes: AnnotationBox[] = [];
  if (!(width > 0) || !(height > 0)) return { boxes };
  const style = annotationStyle(width, height);
  const scale = options.scale && options.scale > 0 ? options.scale : 1;
  const floorPx = Math.max(0, options.minLinePx ?? 0) / scale;
  const sized = (base: number) => Math.max(base, floorPx);
  const numbered = options.marks === 'numbered';
  const numbers = numbered ? numberPieces(scene.marks, scene.strokes) : [];

  ctx.save();
  // 呼ぶ側の状態に左右されないよう、使うものは毎回決める
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.setLineDash([]);
  try {
    if (options.blur === 'outline' && scene.blur) drawBlurOutlines(ctx, width, height, sized(style.thin), scene.blur);
    const rectDots: { x: number; y: number; n: number }[] = [];
    for (const stroke of scene.strokes) {
      const n = numbered && stroke.kind === 'rect' ? numberOf(numbers, 'stroke', stroke.id) : undefined;
      const drawn = drawStroke(ctx, width, height, style, sized, stroke, n !== undefined);
      if (drawn) boxes.push({ id: stroke.id, piece: 'stroke', ...drawn.box, ...(drawn.label ? { label: drawn.label } : {}) });
      if (n !== undefined) {
        // 四角の左上の角。画像の端では、小丸が画像の中に収まるよう半径ぶん内側へずらす
        const radius = (style.badge * NUMBER_DOT) / 2;
        const x = Math.min(stroke.x1, stroke.x2) * width;
        const y = Math.min(stroke.y1, stroke.y2) * height;
        rectDots.push({ x: clampTo(x, radius, width - radius), y: clampTo(y, radius, height - radius), n });
      }
    }
    if (options.marks !== 'none') {
      for (const mark of scene.marks) {
        boxes.push(drawMark(ctx, width, height, style, sized, options, mark, numbered ? numberOf(numbers, 'mark', mark.id) : undefined));
      }
    }
    // 四角の番号は、線もスタンプも描き終えたあと（最前面）に
    for (const dot of rectDots) drawNumberDot(ctx, style, dot.x, dot.y, dot.n);
    const pending = scene.pending;
    if (pending) drawStroke(ctx, width, height, style, sized, { ...pending, text: '' }, false);
  } finally {
    ctx.restore();
  }
  return { boxes };
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const BLUR_EDGE_ALPHA = 0.9;
const BLUR_DASH = '#2b2b2b';

// 隠した場所の枠。白の実線の上に濃い破線、左上から右下への対角線を 1 本（同じ破線）。boxes には入れない
function drawBlurOutlines(ctx: CanvasRenderingContext2D, width: number, height: number, thin: number, blur: readonly CaptureBlur[]) {
  for (const region of blur) {
    const x = region.x * width;
    const y = region.y * height;
    const w = region.w * width;
    const h = region.h * height;
    ctx.save();
    ctx.lineWidth = thin;
    ctx.lineJoin = 'miter';
    ctx.setLineDash([]);
    ctx.globalAlpha = BLUR_EDGE_ALPHA;
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = BLUR_DASH;
    ctx.setLineDash([thin * 3, thin * 2]);
    ctx.strokeRect(x, y, w, h);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y + h);
    ctx.stroke();
    ctx.restore();
  }
}

interface DrawnStroke {
  box: Rect; // 線（と、あればひとこと）の外接矩形
  label?: Rect; // 矢印・四角のひとこと
}

// 線を描き、矢印・四角はひとこと（stroke.text）も描く。numbered は、この四角に番号の小丸を付けること
//   （小丸はあとで最前面に描く。ここでは、ひとことを小丸の幅だけ右へずらすために使う）
function drawStroke(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  style: AnnotationStyle,
  sized: (base: number) => number,
  stroke: Inked,
  numbered: boolean,
): DrawnStroke | null {
  const x1 = stroke.x1 * width;
  const y1 = stroke.y1 * height;
  const x2 = stroke.x2 * width;
  const y2 = stroke.y2 * height;
  if (stroke.kind === 'text') {
    const rect = drawText(ctx, width, style, sized, stroke.text, stroke.color, x1, y1);
    return rect ? { box: rect } : null;
  }
  ctx.save();
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'miter';
  let box: Rect;
  if (stroke.kind === 'rect') {
    const lineWidth = sized(style.thin);
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    box = spanOf([x1, x2], [y1, y2], lineWidth / 2);
  } else if (stroke.kind === 'marker') {
    const lineWidth = sized(style.marker);
    ctx.globalAlpha = MARKER_ALPHA;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    box = spanOf([x1, x2], [y1, y2], lineWidth / 2);
  } else {
    const lineWidth = sized(style.thin);
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    // 矢じりの長さは、実際の線の太さ × 6（縮図で線が太くなったときも、矢じりが細くならない）
    const head = lineWidth * 6;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const ax = x2 - head * Math.cos(angle - style.headSpread);
    const ay = y2 - head * Math.sin(angle - style.headSpread);
    const bx = x2 - head * Math.cos(angle + style.headSpread);
    const by = y2 - head * Math.sin(angle + style.headSpread);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.closePath();
    ctx.fill();
    box = spanOf([x1, x2, ax, bx], [y1, y2, ay, by], lineWidth / 2);
  }
  ctx.restore();
  // ひとこと。矢印は始点のそば、四角は上辺のそば。上に入らないときは内側へ
  const note = stroke.text.trim();
  if (note && (stroke.kind === 'arrow' || stroke.kind === 'rect')) {
    let labelX: number;
    let top: number; // 置きたい辺の y（矢印は始点、四角は上辺）
    if (stroke.kind === 'rect') {
      labelX = Math.min(x1, x2) + (numbered ? style.badge * NUMBER_DOT : 0) + style.pad;
      top = Math.min(y1, y2);
    } else {
      labelX = x1 + style.pad;
      top = y1;
    }
    let baseline = top - style.pad;
    if (baseline - style.text < 0) baseline = top + style.text + style.pad;
    const label = drawText(ctx, width, style, sized, note, stroke.color, labelX, baseline);
    if (label) return { box: unionRect(box, label), label };
  }
  return { box };
}

function unionRect(a: Rect, b: Rect): Rect {
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  return { x: left, y: top, w: Math.max(a.x + a.w, b.x + b.w) - left, h: Math.max(a.y + a.h, b.y + b.h) - top };
}

function clampTo(value: number, low: number, high: number): number {
  if (high < low) return (low + high) / 2; // 小さすぎて収まらないときは中央
  return value < low ? low : value > high ? high : value;
}

function spanOf(xs: number[], ys: number[], grow: number): Rect {
  const left = Math.min(...xs) - grow;
  const top = Math.min(...ys) - grow;
  return { x: left, y: top, w: Math.max(...xs) + grow - left, h: Math.max(...ys) + grow - top };
}

// 文字。(x, y) は 1 行目の左下（基準線）。幅に収まるよう折り返し、最大 8 行。縁は白
function drawText(
  ctx: CanvasRenderingContext2D,
  width: number,
  style: AnnotationStyle,
  sized: (base: number) => number,
  raw: string,
  color: string,
  startX: number,
  baseline: number,
): Rect | null {
  const text = raw.trim();
  if (!text) return null;
  const x = textStartX(width, startX);
  const maxW = textWidth(width, x);
  ctx.save();
  ctx.font = style.font(style.text);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const measure = (value: string) => ctx.measureText(value).width;
  const lines = wrapLines(text, maxW, measure);
  // 縁を先に全部描いてから字を描く（上の行の縁が、下の行の字を削らないように）
  ctx.lineJoin = 'round';
  ctx.lineWidth = sized(style.outline);
  ctx.strokeStyle = '#fff';
  lines.forEach((line, index) => ctx.strokeText(line, x, baseline + index * style.lineHeight));
  ctx.fillStyle = color;
  lines.forEach((line, index) => ctx.fillText(line, x, baseline + index * style.lineHeight));
  const widest = lines.reduce((most, line) => Math.max(most, measure(line)), 0);
  ctx.restore();
  return { x, y: baseline - style.text, w: widest, h: lines.length * style.lineHeight };
}

// 文字を置き始める x（画像の px）。右の端に近くて幅が 25% 未満しか取れないときは、左へ寄せる。
//   読む画面の入力欄も、これで同じ場所に出す
export function textStartX(width: number, x: number): number {
  const pad = annotationStyle(width, 0).pad;
  if (Math.min(0.6 * width, width - x - pad) >= 0.25 * width) return x;
  return Math.max(0, Math.min(x, width - pad - 0.25 * width));
}

// 折り返す幅（画像の px）。textStartX で決めた x から
function textWidth(width: number, x: number): number {
  const pad = annotationStyle(width, 0).pad;
  return Math.max(0.25 * width, Math.min(0.6 * width, width - x - pad));
}

// 折り返し。入りきらなくなった行は、中に空白があれば最後の空白の後で、無ければその字の前で折る。
//   fillText の maxWidth は使わない（字が潰れる）。最大 8 行を超えたら、最後の行を「…」で終える
function wrapLines(text: string, maxW: number, measure: (value: string) => number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    if (line === '' && ch === ' ') continue;
    if (line === '' || measure(line + ch) <= maxW) {
      line += ch;
      continue;
    }
    if (ch === ' ') {
      lines.push(line.trimEnd());
      line = '';
      continue;
    }
    // 折る位置：行の中に空白があれば最後の空白の後。無くて英単語の途中なら、その単語の頭（日本語の直後の英単語を割らない）
    let cut = -1;
    const space = line.lastIndexOf(' ');
    if (space > 0) cut = space + 1;
    else if (WORD_CHAR.test(ch)) {
      let start = line.length;
      while (start > 0 && WORD_CHAR.test(line[start - 1])) start--;
      if (start > 0 && start < line.length) cut = start;
    }
    const head = cut > 0 ? line.slice(0, cut).trimEnd() : '';
    const tail = cut > 0 ? line.slice(cut) : '';
    if (head !== '' && measure(tail + ch) <= maxW) {
      lines.push(head);
      line = tail + ch;
    } else {
      lines.push(line.trimEnd());
      line = ch;
    }
  }
  if (line !== '') lines.push(line.trimEnd());
  if (lines.length <= TEXT_LINES_MAX) return lines;
  const kept = lines.slice(0, TEXT_LINES_MAX);
  const last = [...kept[TEXT_LINES_MAX - 1]];
  while (last.length > 0 && measure(last.join('') + ELLIPSIS) > maxW) last.pop();
  kept[TEXT_LINES_MAX - 1] = last.join('') + ELLIPSIS;
  return kept;
}

// スタンプの札。中心 (x*W, y*H)、直径 badge
function drawMark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  style: AnnotationStyle,
  sized: (base: number) => number,
  options: AnnotationOptions,
  mark: CaptureMark,
  number: number | undefined,
): AnnotationBox {
  const cx = mark.x * width;
  const cy = mark.y * height;
  const radius = style.badge / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = BADGE_FILL;
  ctx.fill();
  ctx.lineWidth = sized(style.thin);
  ctx.strokeStyle = INK_RED;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000';
  if (options.emoji === false) {
    ctx.font = style.font(style.badge * 0.6);
    ctx.fillText(GLYPH[mark.stamp] ?? '•', cx, cy);
  } else {
    ctx.font = style.emojiFont(style.badge * 0.6);
    ctx.fillText(stampOf(mark.stamp)?.emoji ?? '•', cx, cy);
  }
  // 番号の小丸は札の右下（位置は R4 より前から変えない）
  if (options.marks === 'numbered' && number !== undefined) {
    drawNumberDot(ctx, style, cx + radius * Math.SQRT1_2, cy + radius * Math.SQRT1_2, number);
  }
  ctx.restore();
  return { id: mark.id, piece: 'mark', x: cx - radius, y: cy - radius, w: style.badge, h: style.badge };
}

// 番号の小丸。赤い丸に白い数字。スタンプの札の右下と、四角の左上の角で共用する。中心 (cx, cy)、直径 badge×0.72
function drawNumberDot(ctx: CanvasRenderingContext2D, style: AnnotationStyle, cx: number, cy: number, n: number) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, (style.badge * NUMBER_DOT) / 2, 0, Math.PI * 2);
  ctx.fillStyle = INK_RED;
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = style.font(style.badge * NUMBER_FONT);
  ctx.fillText(String(n), cx, cy);
  ctx.restore();
}
