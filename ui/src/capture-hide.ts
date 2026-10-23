// 撮影の「隠す加工」の土台（R3）。DOM の要素にも、台帳の店（captures.ts）にも触らない純粋な関数だけ。
//   隠す場所（矩形）を画素に塗る paintHide ・ applyHides（canvas の ctx は受け取る）。
//   読んだ行（OCR）の矩形から、隠す矩形を作る lineHideRects。
//   鍵・メール・電話・カードらしき行を「示すだけ」の hideCandidates（勝手には何も外さない）。
//   店の hide()（captures.ts）も、AI へ出す画像（capture-ask.ts）も、同じ paintHide を通る。
//
// この段で決めた新しい数：
//   - 塗りつぶしの色 HIDE_FILL ＝ #000
//   - 塗りつぶしだけ、矩形を四方へ hidePadPx(width, height) 広げる（字の端やにじみを残さないため）。
//     hidePadPx ＝ max(3, round(min(幅, 高さ) / 300)) px
//   - lineHideRects の余白：縦は行の高さの 25% ずつ、横は 0.006（割合）ずつ
//   モザイクは前からの式（ブロック ＝ max(8, round(min(幅, 高さ) / 36))、矩形は広げない）のまま。
//   前のモザイクの上に同じ格子で塗り直しても、絵が変わらないようにするため。
export type HideMode = 'fill' | 'mosaic';
export const HIDE_MODE_DEFAULT: HideMode = 'fill';
// theme: fixed begin：隠す塗りの色（画像に書く色）
export const HIDE_FILL = '#000';
// theme: fixed end
export const HIDDEN_TEXT = '（隠した）';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 鍵らしき字（前からの粗い目印）。candidateKind はこれに加えて、形のはっきりした鍵を見る
export const SECRET_RE = /sk-ant-|xai-|AKIA|api key|PRIVATE KEY/i;

export function looksLikeSecret(text: string): boolean {
  return SECRET_RE.test(text);
}

export function ocrHasSecret(lines: readonly { text: string }[]): boolean {
  return lines.some((line) => looksLikeSecret(line.text));
}

// 台帳の mode から隠し方を決める。値が無い（undefined）のは R3 より前の矩形で、モザイクで焼いてある（見たものと送るものを合わせる）。
// 知らない値は、塗りつぶし（隠す側に倒す）
export function resolveHideMode(mode: unknown): HideMode {
  if (mode === 'fill' || mode === 'mosaic') return mode;
  if (mode === undefined) return 'mosaic';
  return 'fill';
}

// 塗りつぶしの矩形を四方へ広げる px
export function hidePadPx(width: number, height: number) {
  return Math.max(3, Math.round(Math.min(width, height) / 300));
}

function clampInt(value: number, low: number, high: number) {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

// rect（画像に対する割合）を ctx の画素に塗る。塗れたら true
export function paintHide(ctx: CanvasRenderingContext2D, width: number, height: number, rect: Rect, mode: HideMode): boolean {
  if (!(width >= 1) || !(height >= 1)) return false;
  if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) return false;
  return mode === 'mosaic' ? pixelate(ctx, width, height, rect) : fillBlack(ctx, width, height, rect);
}

function fillBlack(ctx: CanvasRenderingContext2D, bitmapWidth: number, bitmapHeight: number, region: Rect) {
  const pad = hidePadPx(bitmapWidth, bitmapHeight);
  const left = clampInt(Math.round(region.x * bitmapWidth) - pad, 0, bitmapWidth - 1);
  const top = clampInt(Math.round(region.y * bitmapHeight) - pad, 0, bitmapHeight - 1);
  const right = clampInt(Math.round((region.x + region.w) * bitmapWidth) + pad, left + 1, bitmapWidth);
  const bottom = clampInt(Math.round((region.y + region.h) * bitmapHeight) + pad, top + 1, bitmapHeight);
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = HIDE_FILL;
  ctx.fillRect(left, top, right - left, bottom - top);
  ctx.restore();
  return true;
}

// 矩形の中を粗く均す（元のピクセルは残さない）。captures.ts の pixelate をそのまま移したもの。式も、広げない矩形も変えない
function pixelate(ctx: CanvasRenderingContext2D, bitmapWidth: number, bitmapHeight: number, region: Rect) {
  const left = clampInt(Math.round(region.x * bitmapWidth), 0, bitmapWidth - 1);
  const top = clampInt(Math.round(region.y * bitmapHeight), 0, bitmapHeight - 1);
  const right = clampInt(Math.round((region.x + region.w) * bitmapWidth), left + 1, bitmapWidth);
  const bottom = clampInt(Math.round((region.y + region.h) * bitmapHeight), top + 1, bitmapHeight);
  const spanW = right - left;
  const spanH = bottom - top;
  if (spanW < 2 || spanH < 2) return false;
  const block = Math.max(8, Math.round(Math.min(bitmapWidth, bitmapHeight) / 36));
  const image = ctx.getImageData(left, top, spanW, spanH);
  const data = image.data;
  for (let y0 = 0; y0 < spanH; y0 += block) {
    for (let x0 = 0; x0 < spanW; x0 += block) {
      const bw = Math.min(block, spanW - x0);
      const bh = Math.min(block, spanH - y0);
      let red = 0;
      let green = 0;
      let blue = 0;
      const count = bw * bh;
      for (let yy = 0; yy < bh; yy++) {
        for (let xx = 0; xx < bw; xx++) {
          const i = ((y0 + yy) * spanW + (x0 + xx)) * 4;
          red += data[i];
          green += data[i + 1];
          blue += data[i + 2];
        }
      }
      const r = Math.round(red / count);
      const g = Math.round(green / count);
      const b = Math.round(blue / count);
      for (let yy = 0; yy < bh; yy++) {
        for (let xx = 0; xx < bw; xx++) {
          const i = ((y0 + yy) * spanW + (x0 + xx)) * 4;
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
        }
      }
    }
  }
  ctx.putImageData(image, left, top);
  return true;
}

// 台帳の矩形を全部塗る。mode が無い矩形（R3 より前）はモザイク、知らない値は塗りつぶし（resolveHideMode）
export function applyHides(ctx: CanvasRenderingContext2D, width: number, height: number, blur: readonly (Rect & { mode?: unknown })[]) {
  for (const region of blur) paintHide(ctx, width, height, region, resolveHideMode(region.mode));
}

// 読んだ行の矩形に余白（縦は行の高さの 25% ずつ、横は 0.006 ずつ）を付けて 0〜1 に収め、交わる矩形を 1 つに合わせる。
// 合わせて変わらなくなるまで繰り返す（辺が触れるだけでも交わるとみなす）
const LINE_PAD_Y = 0.25;
const LINE_PAD_X = 0.006;
// 行の矩形の最小の幅と高さ（割合）。とても背の低い行でも、店の hide が小さすぎる矩形として捨てないように
const LINE_RECT_MIN = 0.012;

// 中心を保って、幅と高さを min 以上に広げる（0〜1 に収める）
function atLeast(rect: Rect, min: number): Rect {
  const w = Math.min(1, Math.max(rect.w, min));
  const h = Math.min(1, Math.max(rect.h, min));
  const x = Math.min(1 - w, Math.max(0, rect.x + rect.w / 2 - w / 2));
  const y = Math.min(1 - h, Math.max(0, rect.y + rect.h / 2 - h / 2));
  return { x, y, w, h };
}

export function lineHideRects(lines: readonly Rect[]): Rect[] {
  let rects: Rect[] = [];
  for (const line of lines) {
    if (![line.x, line.y, line.w, line.h].every(Number.isFinite) || line.w < 0 || line.h < 0) continue;
    const left = Math.max(0, line.x - LINE_PAD_X);
    const top = Math.max(0, line.y - line.h * LINE_PAD_Y);
    const right = Math.min(1, line.x + line.w + LINE_PAD_X);
    const bottom = Math.min(1, line.y + line.h + line.h * LINE_PAD_Y);
    if (right <= left || bottom <= top) continue;
    rects.push(atLeast({ x: left, y: top, w: right - left, h: bottom - top }, LINE_RECT_MIN));
  }
  for (;;) {
    const merged: Rect[] = [];
    let changed = false;
    for (const rect of rects) {
      const at = merged.findIndex((other) => touches(other, rect));
      if (at < 0) {
        merged.push({ ...rect });
        continue;
      }
      merged[at] = union(merged[at], rect);
      changed = true;
    }
    rects = merged;
    if (!changed) return rects;
  }
}

function touches(a: Rect, b: Rect) {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

function union(a: Rect, b: Rect): Rect {
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  return { x: left, y: top, w: Math.max(a.x + a.w, b.x + b.w) - left, h: Math.max(a.y + a.h, b.y + b.h) - top };
}

// ---- 隠す候補（示すだけ。既定では何も外さない） ----

export type CandidateKind = 'key' | 'mail' | 'phone' | 'card';

// OCR は長音「ー」と「-」を取り違えるので、区切りにどちらも許す
const SEP = '[-‐‑–—−ー－ 　]?';
const NO_DIGIT_BEFORE = '(?<!\\d)';
const NO_DIGIT_AFTER = '(?!\\d)';

const KEY_RES: RegExp[] = [
  /sk-ant-[\w-]{8,}/,
  /\bsk-[\w-]{16,}/,
  /\bxai-[\w-]{8,}/,
  /\bAKIA[0-9A-Z]{12,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_\w{20,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[\w-]{20,}/,
  /\bya29\.[\w-]{20,}/,
  /eyJ[\w-]{8,}\.eyJ[\w-]{8,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[\w.~+/-]{16,}/i,
];
// ラベル＋値。値が伏せ字（•*●・）だけなら鍵ではない
const LABEL_RE = /(?:api[_ -]?key|secret|token|password|passwd|パスワード|暗証番号|秘密鍵|アクセスキー)\s*[:=：]\s*(\S{4,})/gi;
const MASK_ONLY_RE = /^[•*●・]+$/;

const MAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9-]+)+/;

const MOBILE_RE = new RegExp(`${NO_DIGIT_BEFORE}0[789]0${SEP}\\d{4}${SEP}\\d{4}${NO_DIGIT_AFTER}`);
// 固定電話は、区切りを除いて 10 桁のときだけ（先読みで数える）
const LANDLINE_RE = new RegExp(`${NO_DIGIT_BEFORE}(?=(?:\\d${SEP}){9}\\d${NO_DIGIT_AFTER})0[1-9]\\d{0,3}${SEP}\\d{1,4}${SEP}\\d{4}${NO_DIGIT_AFTER}`);
const FREE_DIAL_RE = new RegExp(`${NO_DIGIT_BEFORE}0(?:120|800)${SEP}\\d{3}${SEP}\\d{3}${NO_DIGIT_AFTER}`);
const INTL_RE = new RegExp(`${NO_DIGIT_BEFORE}\\+81${SEP}\\d{1,4}${SEP}\\d{1,4}${SEP}\\d{3,4}${NO_DIGIT_AFTER}`);
const PHONE_RES = [MOBILE_RE, LANDLINE_RE, FREE_DIAL_RE, INTL_RE];

const CARD_PATTERNS: string[] = [
  `${NO_DIGIT_BEFORE}\\d{4}${SEP}\\d{4}${SEP}\\d{4}${SEP}\\d{4}${NO_DIGIT_AFTER}`,
  `${NO_DIGIT_BEFORE}\\d{4}${SEP}\\d{6}${SEP}\\d{5}${NO_DIGIT_AFTER}`,
  `${NO_DIGIT_BEFORE}\\d{13,19}${NO_DIGIT_AFTER}`,
];

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

function hasKey(text: string): boolean {
  if (looksLikeSecret(text)) return true;
  if (KEY_RES.some((re) => re.test(text))) return true;
  for (const match of text.matchAll(LABEL_RE)) if (!MASK_ONLY_RE.test(match[1])) return true;
  return false;
}

// 候補を 1 文字ずつずらして探す（前の候補が Luhn を通らなくても、その中から始まる本物の番号を見逃さない）
function hasCard(text: string): boolean {
  for (const pattern of CARD_PATTERNS) {
    const re = new RegExp(pattern, 'g');
    for (let match = re.exec(text); match; match = re.exec(text)) {
      re.lastIndex = match.index + 1;
      const digits = match[0].replace(/\D/g, '');
      // 45・49 で始まる 13 桁は日本の商品コード（JAN）。Luhn を偶然通ることがあるので、カードの候補にしない
      if (digits.length === 13 && /^4[59]/.test(digits)) continue;
      if (/^[2-6]/.test(digits) && luhn(digits)) return true;
    }
  }
  return false;
}

// 一行が隠す候補か。順は 鍵 → カード → 電話 → メール。判定の前に NFKC（全角の数字・＠・－ を半角に）
export function candidateKind(text: string): CandidateKind | null {
  if (text.trim() === HIDDEN_TEXT) return null; // NFKC は「（）」を半角にするので、先に見る
  const plain = text.normalize('NFKC');
  if (hasKey(plain)) return 'key';
  if (hasCard(plain)) return 'card';
  if (PHONE_RES.some((re) => re.test(plain))) return 'phone';
  if (MAIL_RE.test(plain)) return 'mail';
  return null;
}

export function hideCandidates(lines: readonly { id: string; text: string }[]): { id: string; kind: CandidateKind }[] {
  const found: { id: string; kind: CandidateKind }[] = [];
  for (const line of lines) {
    const kind = candidateKind(line.text);
    if (kind) found.push({ id: line.id, kind });
  }
  return found;
}
