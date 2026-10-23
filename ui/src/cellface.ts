// セルの顔（六角形の中に何を見せるか）を描く。盤面・見た目の欄の見本・大きい表示のアイコンで同じものを使う
//   タブ：見え方（おまかせ・アイコン・画像・コメント・ページの画面）に合わせて、アイコン・画像・文字のどれか
//   シートへの入口：シートの色でぬった六角形に、白い内枠と名前（案A「扉」）。画像を付けたら画像に色の縁
//   ボットのセル：石板の色（--bot）の六角形に四角い頭の顔、左上に「外へ出る矢印」、右上に四角い札（ボット専用の顔）
import type { BotFullState } from './bots';
import { hexCornerPoints, hexCorners } from './hex';
import type { Tab, TabLook } from './tabs';
import { initialOf } from './util';

export const SVG_NS = 'http://www.w3.org/2000/svg';

type Point = { x: number; y: number };

export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  return node;
}

export function svgText(at: Point, text: string, className: string) {
  const node = svgEl('text', { x: at.x, y: at.y, class: className, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
  node.textContent = text;
  return node;
}

// 文字を、六角形に入る 3文字×2行に（入りきらない分は切る）
export function cellLines(text: string): string[] {
  const chars = [...text.replace(/\s+/g, '')].slice(0, 6);
  return chars.length > 3 ? [chars.slice(0, 3).join(''), chars.slice(3).join('')] : [chars.join('')];
}

function appendLines(g: SVGElement, c: Point, lines: string[], className: string, dy = 0) {
  lines.forEach((line, i) => g.append(svgText({ x: c.x, y: c.y + dy + (lines.length === 1 ? 0 : (i - 0.5) * 9.5) }, line, className)));
}

// 画像やアイコンを取ってくる所（盤面と見た目の欄で違う）
export interface FaceSources {
  image(id: string | undefined): string | undefined; // 付けた画像の data URL（読み込み中は undefined）
  thumb(tabId: number): string | undefined; // ページの画面（表示したことのあるタブだけ）
  iconOk(url: string): boolean; // アイコンを読めるか（読めなかったものは頭の文字にする）
  iconFailed(url: string): void;
}

export type ShownFace =
  | { mode: 'icon' }
  | { mode: 'image'; href: string; comment?: string } // comment：画像の上に「印」を付けるコメント
  | { mode: 'text'; text: string; dim: boolean }; // dim：コメントが無く、題名を薄く見せている

// このタブを、どの見え方で見せるか（tab.look があればそれ、無ければ全体の見え方）
export function resolveFace(tab: Tab, globalLook: TabLook, src: FaceSources): ShownFace {
  const look = tab.look ?? globalLook;
  const image = src.image(tab.image);
  switch (look) {
    case 'icon':
      return { mode: 'icon' };
    case 'image':
      return image ? { mode: 'image', href: image } : { mode: 'icon' };
    case 'comment':
      return tab.comment ? { mode: 'text', text: tab.comment, dim: false } : { mode: 'text', text: tab.title || tab.url || '新しいタブ', dim: true };
    case 'page': {
      const thumb = src.thumb(tab.id);
      return thumb ? { mode: 'image', href: thumb } : { mode: 'icon' };
    }
    default:
      if (image) return { mode: 'image', href: image, comment: tab.comment };
      if (tab.comment) return { mode: 'text', text: tab.comment, dim: false };
      return { mode: 'icon' };
  }
}

// コメントを、セルの上で全部読めるか（読めなければ、乗せたときに吹き出しで見せる）
export function commentFullyShown(tab: Tab, shown: ShownFace) {
  return !tab.comment || (shown.mode === 'text' && !shown.dim && [...tab.comment.replace(/\s+/g, '')].length <= 6);
}

// 六角形に切り抜いた画像（clipId は文書の中で重ならない名前）
export function clippedImage(c: Point, radius: number, href: string, clipId: string, className = 'face-image'): SVGElement[] {
  const clip = svgEl('clipPath', { id: clipId });
  clip.append(svgEl('polygon', { points: hexCorners(c.x, c.y, radius) }));
  const image = svgEl('image', {
    class: className,
    href,
    x: c.x - radius,
    y: c.y - radius,
    width: 2 * radius,
    height: 2 * radius,
    preserveAspectRatio: 'xMidYMid slice',
    'clip-path': `url(#${clipId})`,
  });
  return [clip, image];
}

// 画像の上の「印」（コメントがある）。中身は乗せたときの吹き出しで
export function commentMark(c: Point, radius: number): SVGElement {
  const g = svgEl('g', { class: 'comment-mark' });
  const at = { x: c.x, y: c.y - radius * 0.68 };
  g.append(svgEl('circle', { cx: at.x, cy: at.y, r: 4.2 }), svgText({ x: at.x, y: at.y + 1.2 }, '“', 'comment-mark-text'));
  return g;
}

// タブの顔を g に足す（六角形の地は呼ぶ側が先に描く）
export function drawTabFace(g: SVGElement, tab: Tab, c: Point, radius: number, shown: ShownFace, clipId: string, src: FaceSources) {
  if (shown.mode === 'image') {
    g.append(...clippedImage(c, radius, shown.href, clipId));
    g.append(svgEl('polygon', { class: 'face-rim', points: hexCorners(c.x, c.y, radius) }));
    if (shown.comment) g.append(commentMark(c, radius));
    return;
  }
  if (shown.mode === 'text') {
    if (tab.favicon && src.iconOk(tab.favicon)) {
      const icon = svgEl('image', { class: 'face-mini-icon', href: tab.favicon, x: c.x - 4.5, y: c.y - radius * 0.8, width: 9, height: 9 });
      icon.addEventListener('error', () => src.iconFailed(tab.favicon), { once: true });
      g.append(icon);
    }
    appendLines(g, c, cellLines(shown.text), shown.dim ? 'face-text dim' : 'face-text', 3);
    return;
  }
  if (!tab.favicon || !src.iconOk(tab.favicon)) {
    g.append(svgText(c, initialOf(tab), 'letter'));
    return;
  }
  const size = 16;
  const img = svgEl('image', { href: tab.favicon, x: c.x - size / 2, y: c.y - size / 2, width: size, height: size });
  img.addEventListener('error', () => src.iconFailed(tab.favicon), { once: true });
  g.append(img);
}

// シートへの入口の顔（案A「扉」）。info が無いのは、行き先のシートが見つからないとき
export interface PortalInfo {
  name: string;
  color: string;
  count: number; // シートの中のセルの数
}

export function drawPortalFace(g: SVGElement, c: Point, radius: number, info: PortalInfo | null, image: string | undefined, comment: string, clipId: string) {
  const color = info?.color ?? 'var(--muted)';
  g.style.setProperty('--sheet', color);
  g.append(svgEl('polygon', { class: 'portal-door', points: hexCorners(c.x, c.y, radius) }));
  if (image) {
    g.append(...clippedImage(c, radius, image, clipId));
    g.append(svgEl('polygon', { class: 'portal-rim', points: hexCorners(c.x, c.y, radius - 1) }));
  } else {
    g.append(svgEl('polygon', { class: 'portal-frame', points: hexCorners(c.x, c.y, radius - 3.2) }));
    appendLines(g, c, info ? cellLines(info.name) : ['?'], 'portal-name');
  }
  if (comment) g.append(commentMark(c, radius));
  if (info) {
    const corner = hexCornerPoints(c.x, c.y, radius)[1]; // 右上の頂点
    const b = { x: corner.x - 2, y: corner.y + 3 };
    g.append(svgEl('circle', { class: 'portal-count', cx: b.x, cy: b.y, r: 6.2 }), svgText({ x: b.x, y: b.y + 0.3 }, info.count > 99 ? '99+' : String(info.count), 'portal-count-text'));
  }
}

// ボットのセルの顔（外の Grok Bot への窓口。docs/bot-cells/plan.md の D24：相棒の顔は流用しない）
//   ・石板の色（--bot）の六角形に、四角い頭のボットの顔
//   ・左上に「外へ出る矢印」（このセルは外のアプリ・ボットへの窓口）。入口の扉・相棒の顔・タブと形で見分ける
//   ・右上に四角い札（まだ読んでいない返事の数。第2段から。0 なら出さない）
//   ・左下に状態の丸（リンクなし「?」・アプリなし「×」）。この2つは灰色の点線にする（押してもアプリは開けない）
//   ・第2段の状態（§9.6 の表）：待っている（受け付けた）＝点線の輪・作業中＝ゆっくり回る点線の輪・返事あり＝札の色の縁・
//     遅れている＝札の色の縁と輪・ボットのエラー＝赤い枠と左下の「!」。左下には、待っている数（遅れていれば札の色）も出す（バッジは2つまで）
//   ・画像を付けたら、画像に石板の色の縁（矢印と札・丸は画像の上にも出す）。1倍では名前を出さない（名前は吹き出しで）
export interface BotFaceInfo {
  state: BotFullState;
  unread?: number; // まだ読んでいない返事の数（第2段。右上の札）
  waiting?: number; // 待っている依頼の数（第2段。左下）
}

export function drawBotFace(g: SVGElement, c: Point, radius: number, info: BotFaceInfo, image: string | undefined, comment: string, clipId: string) {
  const k = radius / 19.5; // 盤面のセルの大きさ（19.5）を 1 として、印の大きさをそろえる
  const off = info.state === 'noLink' || info.state === 'noApp';
  const face = svgEl('g', { class: `bot-face ${off ? 'bot-off' : 'bot-on'} bot-${info.state}` });
  g.append(face);
  face.append(svgEl('polygon', { class: 'bot-plate', points: hexCorners(c.x, c.y, radius) }));
  // 待っている・作業中・遅れている：顔のまわりの点線の輪（作業中はゆっくり回る）
  if (info.state === 'accepted' || info.state === 'working' || info.state === 'late') {
    face.append(svgEl('circle', { class: 'bot-ring', cx: c.x, cy: c.y + 0.6 * k, r: radius * 0.66 }));
  }
  if (image) {
    face.append(...clippedImage(c, radius, image, clipId));
    face.append(svgEl('polygon', { class: 'bot-image-rim', points: hexCorners(c.x, c.y, radius - 1) }));
    if (comment) face.append(commentMark(c, radius));
  } else {
    face.append(svgEl('polygon', { class: 'bot-rim', points: hexCorners(c.x, c.y, radius - 2.6 * k) }));
    face.append(botHead({ x: c.x, y: c.y + 1.6 * k }, k, !off));
  }
  const corners = hexCornerPoints(c.x, c.y, radius);
  const toward = (p: Point, t: number): Point => ({ x: c.x + (p.x - c.x) * t, y: c.y + (p.y - c.y) * t });
  // 左上：外へ出る矢印（丸の中に、右上へ向かう矢印）
  const e = toward(corners[5], 0.62);
  const a = 1.5 * k;
  face.append(
    svgEl('circle', { class: 'bot-exit', cx: e.x, cy: e.y, r: 3.6 * k }),
    svgEl('path', { class: 'bot-exit-arrow', d: `M${e.x - a},${e.y + a} L${e.x + a},${e.y - a} M${e.x - 0.2 * k},${e.y - a} L${e.x + a},${e.y - a} L${e.x + a},${e.y + 0.2 * k}` }),
  );
  // 右上：四角い札（まだ読んでいない数）
  if (info.unread && info.unread > 0) {
    const t = toward(corners[1], 0.86);
    face.append(
      svgEl('rect', { class: 'bot-tag', x: t.x - 5 * k, y: t.y - 4 * k, width: 10 * k, height: 8 * k, rx: 2 * k }),
      svgText({ x: t.x, y: t.y + 0.3 * k }, info.unread > 9 ? '9+' : String(info.unread), 'bot-tag-text'),
    );
  }
  // 左下：リンクなし「?」・アプリなし「×」、ボットのエラー「!」、待っている数
  const mark = off ? (info.state === 'noLink' ? '?' : '×') : info.state === 'botError' ? '!' : info.waiting && info.waiting > 0 ? (info.waiting > 9 ? '9+' : String(info.waiting)) : '';
  if (mark) {
    const p = toward(corners[4], 0.86);
    const kind = off ? '' : info.state === 'botError' ? ' alert' : info.state === 'late' ? ' wait late' : ' wait';
    face.append(
      svgEl('circle', { class: `bot-badge${kind}`, cx: p.x, cy: p.y, r: 4.8 * k }),
      svgText({ x: p.x, y: p.y + 0.3 * k }, mark, `bot-badge-text${kind}`),
    );
  }
}

// ボットの頭（角の丸い四角に、アンテナ1本・目・口）。awake でないとき（リンクなし・アプリなし）は目を閉じた線
function botHead(at: Point, k: number, awake: boolean): SVGElement {
  const g = svgEl('g', { class: 'bot-head-group' });
  const w = 5.6 * k;
  const h = 4.8 * k;
  const top = at.y - h;
  g.append(
    svgEl('line', { class: 'bot-antenna', x1: at.x, y1: top, x2: at.x, y2: top - 2.4 * k }),
    svgEl('circle', { class: 'bot-antenna-tip', cx: at.x, cy: top - 3.1 * k, r: 1.1 * k }),
    svgEl('rect', { class: 'bot-head', x: at.x - w, y: top, width: 2 * w, height: 2 * h, rx: 2 * k }),
  );
  const ex = 2.3 * k;
  const ey = at.y - 0.7 * k;
  if (awake) {
    g.append(svgEl('circle', { class: 'bot-eye', cx: at.x - ex, cy: ey, r: 1.05 * k }), svgEl('circle', { class: 'bot-eye', cx: at.x + ex, cy: ey, r: 1.05 * k }));
  } else {
    g.append(svgEl('path', { class: 'bot-line', d: `M${at.x - ex - k},${ey} h${2 * k} M${at.x + ex - k},${ey} h${2 * k}` }));
  }
  g.append(svgEl('path', { class: 'bot-line', d: `M${at.x - 1.8 * k},${at.y + 2.1 * k} h${3.6 * k}` }));
  return g;
}

// アプリのセルの顔（登録した Windows のアプリ。ボットの四角い頭とは別の、青緑の六角形にアイコン）
//   アイコンが無い・台帳に無いときは、名前の頭の1文字か「?」。左上の矢印（ボットの印）は付けない
export interface AppFaceInfo {
  name: string;
  icon?: string;
  lost: boolean;
}

export function drawAppFace(g: SVGElement, c: Point, radius: number, info: AppFaceInfo, clipId: string) {
  g.append(svgEl('polygon', { class: 'app-plate', points: hexCorners(c.x, c.y, radius) }));
  if (info.icon && !info.lost) {
    const clip = svgEl('clipPath', { id: clipId });
    clip.append(svgEl('polygon', { points: hexCorners(c.x, c.y, radius - 1.2) }));
    const size = radius * 1.55;
    const image = svgEl('image', {
      class: 'app-icon',
      href: info.icon,
      x: c.x - size / 2,
      y: c.y - size / 2,
      width: size,
      height: size,
      preserveAspectRatio: 'xMidYMid meet',
      'clip-path': `url(#${clipId})`,
    });
    g.append(clip, image);
    return;
  }
  const letter = info.lost || !info.name.trim() ? '?' : ([...info.name.trim()][0] ?? '?');
  g.append(svgText(c, letter, 'app-letter'));
}
