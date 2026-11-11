// 正六角のカードの顔（HX4）：div（箱 150×174。押せない）の中に、SVG の多角形の顔（押せるのはここだけ）と選びの輪、HTML の字を重ねる
//   上の三角＝帯のすぐ上の 1 行に印（日時は出さない。2026-11-09 の利用者の依頼）、真ん中＝文 5 行（写真だけのカードは 72×96 の絵）、下の三角＝タグ 1 つと「+n」か AI の書き手。題のある写真のカードは題（タグは +n）
//   計算（寸法・字の中身）は memo-card-board-hex.ts。四角の規則の打ち消し・色・字の箱の位置は grok-cards.css の HX4 の節。字は textContent だけで入れる
import { el } from '../util';
import { hexCornerPoints } from '../hex';
import { HEX, HEX_CENTER, type HexFaceInfo } from '../memo-card-board-hex';
import type { CardFace } from '../memo-card-board-view';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FACE_STROKE = 1.5; // 顔の縁の太さ（CSS の stroke-width と同じ）
const RING_IN = 4; // 選びの輪：外接の半径より内側へ（太さ 3 は CSS）

const points = (radius: number) =>
  hexCornerPoints(HEX_CENTER.x, HEX_CENTER.y, radius)
    .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(' ');

// 顔は縁の太さの半分だけ内側に描く（縁の外側が、線の端・重なりの計算と同じ六角の縁にちょうど来る）
const FACE_POINTS = points(HEX.h / 2 - FACE_STROKE / 2 / (Math.sqrt(3) / 2));
const RING_POINTS = points(HEX.h / 2 - RING_IN);

// 一枚の六角の顔。picture は写真だけのカードの縮めた絵（まだ読んでいなければ undefined。あとで img の src だけ差し替える）
export function hexCardEl(f: CardFace, info: HexFaceInfo, picture: string | undefined): HTMLDivElement {
  const card = el('div', 'memo-board-card is-hex');
  card.dataset.card = f.id;
  card.style.left = `${f.x}px`;
  card.style.top = `${f.y}px`;
  card.title = f.title;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.classList.add('memo-board-hex-svg');
  svg.setAttribute('width', String(HEX.w));
  svg.setAttribute('height', String(HEX.boxH));
  svg.setAttribute('viewBox', `0 0 ${HEX.w} ${HEX.boxH}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const face = document.createElementNS(SVG_NS, 'polygon');
  face.classList.add('memo-board-hex-face');
  face.setAttribute('points', FACE_POINTS);
  face.setAttribute('pathLength', '60'); // 線の元の破線を辺ごとにそろえる（1 辺が 10）
  const ring = document.createElementNS(SVG_NS, 'polygon');
  ring.classList.add('memo-board-hex-ring');
  ring.setAttribute('points', RING_POINTS);
  svg.append(face, ring);
  card.append(svg);
  // 上の三角：印だけ（書いた日時は出さない。2026-11-09 の利用者の依頼）。1 行の箱に入らない印は次の行へ回って隠れる（後ろから落ちる）
  const top = el('div', 'memo-board-hex-top');
  for (const mark of info.marks) top.append(el('span', 'memo-board-hex-mark', mark));
  card.append(top);
  if (f.thumb) {
    card.classList.add('has-thumb');
    const img = el('img', 'memo-board-card-thumb');
    img.alt = '';
    img.draggable = false;
    if (picture) img.src = picture;
    card.append(img);
  } else {
    const mid = el('div', 'memo-board-hex-mid');
    const flow = el('div', 'memo-board-card-flow');
    flow.append(f.bold ? el('span', 'memo-board-card-first', f.first) : document.createTextNode(f.first));
    if (f.rest) flow.append(document.createTextNode(`\n${f.rest}`));
    mid.append(flow);
    card.append(mid);
  }
  // 下の三角：タグを 1 つと「+n」。AI のカードは書き手の名前、題のある写真のカードは題（どちらもタグは +n に数える。行の箱の幅で「…」）
  const bottom = el('div', 'memo-board-hex-bottom');
  if (info.who) bottom.append(el('span', 'memo-board-hex-who', info.who));
  else if (info.title) bottom.append(el('span', 'memo-board-hex-title', info.title));
  else if (info.tag) bottom.append(el('span', 'memo-board-hex-tag', info.tag));
  if (info.more > 0) bottom.append(el('span', 'memo-board-hex-more', `+${info.more}`));
  card.append(bottom);
  return card;
}
