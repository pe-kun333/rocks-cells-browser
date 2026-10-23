// ダイソンの殻（六角の板 6 枚と、明るい核）。状態は nest-shell.ts が決める
//   マウスを乗せたときは核だけ明るくする（板は変えない）。焦点は六角の輪（CSS の outline は使わない）
//   26px は別の絵（核と 6 点）。閉じているときだけ、銀の数か「!」
import { svgEl } from '../cellface';
import type { ShellView } from '../nest-shell';
import { el } from '../util';

const CX = 32;
const CY = 32;

function hexPoints(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    return `${(cx + Math.cos(a) * r).toFixed(2)},${(cy + Math.sin(a) * r).toFixed(2)}`;
  }).join(' ');
}

function at(i: number, orbit: number): { x: number; y: number } {
  const a = -Math.PI / 2 + (i * Math.PI) / 3;
  return { x: CX + Math.cos(a) * orbit, y: CY + Math.sin(a) * orbit };
}

export function shellButton(view: ShellView, onPress: () => void): HTMLElement {
  const slot = el('div', 'bot-nest-center nest-shell-slot');
  const button = el('button', 'nest-shell');
  button.type = 'button';
  button.dataset.key = 'shell';
  button.dataset.size = String(view.size);
  button.dataset.open = view.open ? 'true' : 'false';
  button.title = view.label;
  button.setAttribute('aria-label', view.label);
  button.setAttribute('aria-expanded', String(view.open));
  button.addEventListener('click', () => onPress());

  const svg = svgEl('svg', { class: 'nest-shell-svg', viewBox: '0 0 64 64', 'aria-hidden': 'true' });
  const dots = view.size === 26;
  const orbit = dots ? 16 : view.open ? 15.2 : 19.6;
  const plateR = view.open ? 6.3 : 6.7;
  const coreR = dots ? 4.4 : view.open ? 11.2 : 7.4;

  svg.append(svgEl('polygon', { class: 'nest-shell-focus', points: hexPoints(CX, CY, 30) }));
  svg.append(svgEl('circle', { class: 'nest-shell-glow', cx: CX, cy: CY, r: coreR + (dots ? 2 : 5) }));
  svg.append(svgEl('circle', { class: 'nest-shell-core', cx: CX, cy: CY, r: coreR }));
  view.plates.forEach((plate, i) => {
    const p = at(i, orbit);
    if (dots) {
      const dot = svgEl('circle', {
        class: 'nest-shell-dot',
        cx: p.x.toFixed(2),
        cy: p.y.toFixed(2),
        r: plate.empty ? 2.1 : 2.35,
        'data-empty': plate.empty ? 'true' : 'false',
        'data-arrived': plate.arrived ? 'true' : 'false',
      });
      svg.append(dot);
      return;
    }
    svg.append(
      svgEl('polygon', {
        class: 'nest-shell-plate',
        points: hexPoints(p.x, p.y, plateR),
        'data-empty': plate.empty ? 'true' : 'false',
        'data-arrived': plate.arrived ? 'true' : 'false',
      }),
    );
  });
  button.append(svg);
  if (view.badge !== 'none') {
    const badge = el('span', 'nest-shell-badge', view.badgeText);
    badge.dataset.kind = view.badge;
    badge.setAttribute('aria-hidden', 'true');
    button.append(badge);
  }
  slot.append(button);
  if (view.caption) {
    const caption = el('span', 'nest-shell-caption', view.caption);
    caption.setAttribute('aria-hidden', 'true');
    slot.append(caption);
  }
  return slot;
}
