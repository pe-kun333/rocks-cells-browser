// 取り込みの一覧の「ミニ盤面」：新しいシートの姿を、計画の位置で小さく描く（設計 §9.4）
//   ・新しいシートはまだ盤面に無いので、左の盤面の点線の見本では見せられない。一覧の中に SVG で描く
//   ・六角形は島の色でぬる（島なしは灰色）。選んでいないメモは薄く。盤面の線は種類の色の点線。Grok Bot のメモには印
import { t } from '../i18n';
import { svgEl, svgText } from '../cellface';
import { type Hex, hexCorners, hexToPixel } from '../hex';
import { type LinkKind, linkKindInfo } from '../memo-card-links';

export interface MiniBoardInput {
  memos: { key: string; pos: Hex; color: string | null; selected: boolean; bot: boolean; title: string }[];
  links: { fromKey: string; toKey: string; kind: LinkKind; selected: boolean }[];
}

const SIZE = 12; // 六角形の大きさ（中心から頂点まで）

export function miniBoard(input: MiniBoardInput): SVGSVGElement {
  const svg = svgEl('svg', { class: 'ix-mini-board', role: 'img', 'aria-label': t('新しいシートの見本（メモ {0}）', { 0: input.memos.filter((m) => m.selected).length }) });
  const centers = new Map(input.memos.map((m) => [m.key, hexToPixel(m.pos, SIZE)]));
  const xs = [...centers.values()].map((c) => c.x);
  const ys = [...centers.values()].map((c) => c.y);
  const pad = SIZE * 1.5;
  const minX = Math.min(0, ...xs) - pad;
  const minY = Math.min(0, ...ys) - pad;
  const maxX = Math.max(0, ...xs) + pad;
  const maxY = Math.max(0, ...ys) + pad;
  svg.setAttribute('viewBox', `${minX.toFixed(1)} ${minY.toFixed(1)} ${(maxX - minX).toFixed(1)} ${(maxY - minY).toFixed(1)}`);
  const cells = svgEl('g', { class: 'ix-mini-cells' });
  for (const m of input.memos) {
    const c = centers.get(m.key) as { x: number; y: number };
    const hex = svgEl('polygon', {
      class: `ix-mini-hex${m.selected ? '' : ' is-off'}`,
      points: hexCorners(c.x, c.y, SIZE - 1),
      fill: m.color ?? 'var(--muted)',
      ...(m.color ? { style: `--data: ${m.color}` } : {}), // 描くときはテーマの明るさの帯へ（data-colors.css）
    });
    const title = svgEl('title', {});
    title.textContent = m.title;
    hex.append(title);
    cells.append(hex);
    if (m.bot) cells.append(svgText({ x: c.x, y: c.y }, 'G', 'ix-mini-bot'));
  }
  const lines = svgEl('g', { class: 'ix-mini-links' });
  for (const l of input.links) {
    const a = centers.get(l.fromKey);
    const b = centers.get(l.toKey);
    if (!a || !b) continue;
    lines.append(svgEl('line', { class: `ix-mini-link${l.selected ? '' : ' is-off'}`, x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: linkKindInfo(l.kind).color }));
  }
  svg.append(cells, lines);
  return svg;
}
