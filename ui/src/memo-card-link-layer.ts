// 下の区画のカードの関連線の層（SVG）：カードの並びを測り、memo-card-links.ts の routeCardLinks の経路を描く
//   ・層はカードの並びを包む要素（position: relative; isolation: isolate）の子で、z-index -1（カードの下。隙間にだけ見える）
//   ・線は 2 本の path：太い透明の当たり判定（押す・乗せる）と、見える線（種類の色・矢じり・疑問は破線）。線の文は title
//   ・矢じりは種類ごとの marker（色を直に書く。fill="context-stroke" は WebView2 で確かめていないので使わない）
//   ・画面の文字は textContent だけ
import { type CardBox, type DrawLink, LINK_KINDS, type LinkKindInfo, type LinkLayout, type LinkPath, linkKindInfo } from './memo-card-links';

const SVG_NS = 'http://www.w3.org/2000/svg';
const LAYER_PREFIX = 'memo-link-head-';

// 種類ごとの矢じりの defs（prefix：marker の id の頭。id は文書の中で一意にする。線の層は 'memo-link-head-'、マップは 'memo-map-head-'）
//   線の marker-end は `url(#${prefix}${kind})`（矢じりの無い「同じ」には marker が無い）
export function linkMarkerDefs(prefix: string): SVGDefsElement {
  const defs = document.createElementNS(SVG_NS, 'defs');
  for (const info of LINK_KINDS) {
    const marker = headMarker(info, prefix);
    if (marker) defs.append(marker);
  }
  return defs;
}

export interface LinkLayerHandlers {
  title(link: DrawLink): string; // 線に乗せたときに出す文（「元」は「相手」の根拠）
  click(link: DrawLink, e: MouseEvent): void; // 線を押した（隙間の当たり判定だけ）
}

// カードの並び（grid）の子のうち、見えているカードと見出しの行を、包みの左上からの位置で測る
export function measureLinkLayout(wrap: HTMLElement, grid: HTMLElement): LinkLayout {
  const cards: CardBox[] = [];
  for (const node of grid.querySelectorAll<HTMLElement>(':scope > [data-card]')) {
    const id = node.dataset.card;
    if (id) cards.push({ id, x: node.offsetLeft, y: node.offsetTop, w: node.offsetWidth, h: node.offsetHeight });
  }
  const heads = [...grid.querySelectorAll<HTMLElement>(':scope > .memo-pane-chain-head')].map((node) => ({ y: node.offsetTop, h: node.offsetHeight }));
  return { width: wrap.clientWidth, height: wrap.clientHeight, cards, heads };
}

// 測った形と線の印（同じなら描き直さない）
export function linkLayoutKey(layout: LinkLayout, links: readonly DrawLink[], extra: string): string {
  const r = (v: number) => Math.round(v);
  const cards = layout.cards.map((c) => `${c.id}:${r(c.x)},${r(c.y)},${r(c.w)},${r(c.h)}`).join(';');
  const heads = (layout.heads ?? []).map((h) => `${r(h.y)},${r(h.h)}`).join(';');
  const lines = links.map((l) => `${l.from}>${l.to}:${l.kind}`).join(';');
  return `${r(layout.width)}x${r(layout.height)}|${cards}|${heads}|${lines}|${extra}`;
}

export class LinkLayer {
  readonly svg: SVGSVGElement;
  private readonly lines: SVGGElement;

  constructor(private readonly handlers: LinkLayerHandlers) {
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.classList.add('memo-pane-link-layer');
    this.svg.setAttribute('aria-hidden', 'true');
    this.svg.setAttribute('focusable', 'false');
    const defs = linkMarkerDefs(LAYER_PREFIX);
    this.lines = document.createElementNS(SVG_NS, 'g');
    this.svg.append(defs, this.lines);
  }

  // 線を描く（selected：そのカードにつながる線を強く。null なら全部ふつう）
  draw(paths: readonly LinkPath[], size: { width: number; height: number }, selected: string | null) {
    this.svg.setAttribute('width', String(Math.max(0, Math.round(size.width))));
    this.svg.setAttribute('height', String(Math.max(0, Math.round(size.height))));
    this.lines.replaceChildren(...paths.map((p) => this.line(p, selected)));
  }

  clear() {
    this.lines.replaceChildren();
    this.svg.setAttribute('width', '0');
    this.svg.setAttribute('height', '0');
  }

  private line(path: LinkPath, selected: string | null): SVGGElement {
    const info = linkKindInfo(path.kind);
    const group = document.createElementNS(SVG_NS, 'g');
    group.classList.add('memo-pane-link');
    if (selected !== null && (path.from === selected || path.to === selected)) group.classList.add('selected');
    group.dataset.from = path.from;
    group.dataset.to = path.to;
    group.dataset.kind = path.kind;
    group.style.setProperty('--rel', info.color); // 描くときはテーマの明るさの帯へ（data-colors.css。属性の色は帯の効かない所の代わり）
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = this.handlers.title(path);
    const hit = document.createElementNS(SVG_NS, 'path');
    hit.classList.add('memo-pane-link-hit');
    hit.setAttribute('d', path.d);
    const line = document.createElementNS(SVG_NS, 'path');
    line.classList.add('memo-pane-link-line');
    line.setAttribute('d', path.d);
    line.setAttribute('stroke', info.color);
    if (info.dashed) line.setAttribute('stroke-dasharray', '5 4');
    if (info.head !== 'none') line.setAttribute('marker-end', `url(#${LAYER_PREFIX}${info.kind})`);
    group.append(title, hit, line);
    group.addEventListener('click', (e) => this.handlers.click(path, e));
    return group;
  }
}

// 種類ごとの矢じり（相手の側。線の向きに合わせて回す。大きさは線の太さによらない）
function headMarker(info: LinkKindInfo, prefix: string): SVGMarkerElement | null {
  if (info.head === 'none') return null;
  const marker = document.createElementNS(SVG_NS, 'marker');
  marker.id = `${prefix}${info.kind}`;
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '10');
  marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '9');
  marker.setAttribute('markerHeight', '9');
  marker.setAttribute('markerUnits', 'userSpaceOnUse');
  marker.setAttribute('orient', 'auto');
  let shape: SVGElement;
  if (info.head === 'triangle') {
    shape = document.createElementNS(SVG_NS, 'path');
    shape.setAttribute('d', 'M0 0 L10 5 L0 10 z');
    shape.setAttribute('fill', info.color);
  } else if (info.head === 'bar') {
    shape = document.createElementNS(SVG_NS, 'path');
    shape.setAttribute('d', 'M8.5 0 L8.5 10');
    shape.setAttribute('stroke', info.color);
    shape.setAttribute('stroke-width', '2.5');
    shape.setAttribute('fill', 'none');
  } else if (info.head === 'chevron') {
    shape = document.createElementNS(SVG_NS, 'path');
    shape.setAttribute('d', 'M1 1 L9 5 L1 9');
    shape.setAttribute('stroke', info.color);
    shape.setAttribute('stroke-width', '1.8');
    shape.setAttribute('fill', 'none');
  } else if (info.head === 'diamond') {
    shape = document.createElementNS(SVG_NS, 'path');
    shape.setAttribute('d', 'M2 5 L6 1.5 L10 5 L6 8.5 z');
    shape.setAttribute('fill', info.color);
  } else {
    shape = document.createElementNS(SVG_NS, 'circle');
    shape.setAttribute('cx', '6.5');
    shape.setAttribute('cy', '5');
    shape.setAttribute('r', '3.5');
    shape.setAttribute('fill', info.color);
  }
  shape.classList.add('memo-pane-link-head', shape.getAttribute('fill') === 'none' ? 'is-stroke' : 'is-fill');
  shape.style.setProperty('--rel', info.color);
  marker.append(shape);
  return marker;
}
