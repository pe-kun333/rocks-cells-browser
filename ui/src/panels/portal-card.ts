// シートへの入口のカード（拡大表示に出す）：行き先のシートの名前・中のセルの数・入口のひとことと、できること
import { t } from '../i18n';
import { armConfirm } from '../confirm-arm';
import { drawPortalFace, type PortalInfo, svgEl } from '../cellface';
import type { MemoCell } from '../memocells';
import { el } from '../util';

export interface PortalActions {
  open(id: string): void; // そのシートへ移る
  rename(id: string): void; // シートの名前を変える
  editFace(id: string): void; // 入口の見た目（画像・ひとこと）
  unpack(id: string): void; // 中身をここに出す（シートをなくす）
  remove(id: string): void; // 入口を消す（シートは残る）
}

export interface PortalCardOptions {
  memo: MemoCell;
  info: PortalInfo | null; // 行き先のシート（見つからなければ null）
  counts: { tabs: number; memos: number };
  image?: string; // 入口の画像（data URL）
  compact: boolean;
  actions?: PortalActions;
}

export function portalCard(o: PortalCardOptions): HTMLElement {
  const { memo, info } = o;
  const card = el('div', o.compact ? 'preview-card portal-card compact' : 'preview-card portal-card');
  card.dataset.memo = memo.id;
  const visual = el('div', 'preview-visual portal-visual');
  const svg = svgEl('svg', { viewBox: '-23 -23 46 47', class: 'portal-card-svg', role: 'img', 'aria-label': t('シートへの入口') });
  const g = svgEl('g', { class: 'cell portal' });
  drawPortalFace(g, { x: 0, y: 0 }, 19.5, info, o.image, memo.text, 'portal-card-clip');
  svg.append(g);
  visual.append(svg);
  card.append(visual, el('div', 'preview-title', info ? t('シート「{0}」', { 0: info.name }) : t('行き先のシートが見つかりません')));
  const meta = el('div', 'preview-meta');
  meta.append(el('span', 'pill pill-portal', t('入口')), el('span', 'pill', t('タブ {0}', { 0: o.counts.tabs })), el('span', 'pill', t('メモ {0}', { 0: o.counts.memos })));
  card.append(meta);
  if (memo.text) card.append(el('div', 'portal-comment', memo.text));
  const a = o.actions;
  if (!o.compact && a) {
    const actions = el('div', 'preview-actions');
    const open = button(t('開く'), () => a.open(memo.id));
    open.disabled = !info;
    const rename = button(t('名前'), () => a.rename(memo.id));
    rename.disabled = !info;
    const unpack = button(t('中身をここに出す'), () => a.unpack(memo.id));
    unpack.title = t('シートの中のタブとメモを、この入口の場所に並べ直して、シートをなくす');
    unpack.disabled = !info;
    const remove = button(t('入口を消す'), () => {
      if (remove.textContent !== '本当に消す') {
        armConfirm(remove);
        remove.textContent = '本当に消す';
        remove.classList.add('danger');
        remove.title = t('もう一度押すと、入口を消します（シートと中身は残り、左上のシートの名前 ▾ から開けます）');
        return;
      }
      a.remove(memo.id);
    });
    remove.title = t('この入口を消す（シートと中身は残ります）');
    actions.append(open, rename, button(t('見た目'), () => a.editFace(memo.id)), unpack, remove);
    card.append(actions);
  }
  return card;
}

function button(label: string, onClick: () => void) {
  const b = el('button', 'preview-button', label);
  b.addEventListener('click', onClick);
  return b;
}
