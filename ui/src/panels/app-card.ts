// アプリのセルのカード（拡大表示）。メモの書く欄にはしない（ダブルクリックで中央に出す。もう一度で最前面をやめる）
import { t } from '../i18n';
import { type AppEntry, appFileLabel } from '../apps';
import { drawAppFace, svgEl } from '../cellface';
import type { MemoCell } from '../memocells';
import { el } from '../util';

export interface AppActions {
  launch(id: string): void; // ダブルクリックと同じ。中央に出す、または最前面をやめる
  rename(id: string): void;
  repick(id: string): void;
  remove(id: string): void; // このセルだけ外す（台帳には残る）
  forget(id: string): void; // 台帳からも消す
}

export function appCard(o: { memo: MemoCell; app: AppEntry | undefined; pinned?: boolean; compact: boolean; actions?: AppActions }): HTMLElement {
  const { memo, app } = o;
  const card = el('div', o.compact ? 'preview-card app-card compact' : 'preview-card app-card');
  card.dataset.memo = memo.id;
  const visual = el('div', 'preview-visual app-visual');
  const svg = svgEl('svg', { viewBox: '-23 -23 46 47', class: 'app-card-svg', role: 'img', 'aria-label': app ? t('アプリ「{0}」', { 0: app.name }) : t('アプリ') });
  const g = svgEl('g', { class: app ? 'cell app' : 'cell app lost' });
  drawAppFace(g, { x: 0, y: 0 }, 19.5, { name: app?.name ?? '', icon: app?.icon, lost: !app }, `app-card-clip-${memo.id}`);
  svg.append(g);
  visual.append(svg);
  card.append(visual);
  card.append(el('div', 'preview-title', app ? t('アプリ「{0}」', { 0: app.name }) : t('アプリ（台帳に見つかりません）')));
  const meta = el('div', 'preview-meta');
  meta.append(el('span', 'pill pill-app', t('アプリ')));
  card.append(meta);
  if (app) {
    const file = el('div', 'app-card-file', appFileLabel(app));
    file.title = app.shortcut || app.target || app.launch;
    card.append(file);
    if (!o.compact) {
      card.append(
        el(
          'p',
          'app-card-note',
          o.pinned
            ? t('いま最前面です。もう一度ダブルクリックすると、最前面をやめます。位置と大きさはそのままです。')
            : t('ダブルクリックで、中央の区画に合わせて最前面にします。'),
        ),
      );
    }
  }
  const actions = o.actions;
  if (!o.compact && actions) {
    const row = el('div', 'preview-actions');
    const button = (label: string, title: string, run: () => void) => {
      const node = el('button', '', label);
      node.type = 'button';
      node.title = title;
      node.addEventListener('click', run);
      return node;
    };
    if (app) {
      row.append(
        button(
          o.pinned ? t('最前面をやめる') : t('中央に出す'),
          o.pinned ? t('最前面をやめる（位置と大きさはそのまま）') : t('ダブルクリックと同じ（中央に合わせて最前面）'),
          () => actions.launch(memo.id),
        ),
        button(t('名前を変える'), t('台帳の名前を変える（同じアプリのセル全部）'), () => actions.rename(memo.id)),
        button(t('ファイルを選び直す'), t('パスとアイコンを選び直す（名前はそのまま）'), () => actions.repick(memo.id)),
        button(t('台帳から消す'), t('このアプリのセルを全部外し、台帳からも消す'), () => actions.forget(memo.id)),
      );
    }
    row.append(button(t('セルを外す'), t('このセルだけ外す（台帳には残る）'), () => actions.remove(memo.id)));
    card.append(row);
  }
  return card;
}
