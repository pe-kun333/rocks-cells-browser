// Grok の提案の一覧（前 → 後）：チェックを付けたものだけ「反映する」。左サイドバーの上に重ねて出す
//   ・使えるもの（ok）は、はじめからチェックが付いている。もうそうなっている・見つからない・断るものは押せない（理由を出す）
//   ・書き出したあとに変わったメモ・カードには ⚠ の印（チェックは付いたまま。外すかは使う人が決める）
//   ・チェックが変わるたびに onChecked（盤面の点線の見本を描き直す）
//   ・取り込み（hcb-memo-interchange）は openInterchange：まとまり（島）ごとのチェック・メモ単位・ミニ盤面（設計 §9）
import { t } from '../i18n';
import type { GrokPatch, PlanItem } from '../grok-patch';
import { PATCH_REASON_TEXT } from '../grok-patch';
import { el } from '../util';
import { miniBoard, type MiniBoardInput } from './interchange-mini-board';

// 取り込みの一覧に渡すもの（計算は app/interchange-flow.ts。ここは見せてチェックを返すだけ）
export interface InterchangeChoiceState {
  memos: Set<string>; // 取り込むメモの鍵
  skipIslands: Set<string>; // 作らない島の鍵
  portal: boolean; // 今のシートに入口を置く
}

export interface InterchangeViewRow {
  key: string;
  title: string;
  detail: string; // 「カード 6・関連 4・タグ 2」など
  cards: string[]; // カードの題（開いたときに見せる）
}

export interface InterchangeViewGroup {
  key: string | null; // 島の鍵（null は島なし）
  name: string;
  color: string | null;
  note?: string; // 「島の上限で作れません」など
  rows: InterchangeViewRow[];
}

export interface InterchangeReplan {
  summary: string; // 「新しいシートを 1 枚作ります：メモ 11・…」
  warnings: string[];
  links: string; // 盤面の線の行の文
  blocked: string | null; // 反映を押せない理由
  applyLabel: string;
  board: MiniBoardInput;
  portal: { pos: { q: number; r: number } } | null;
}

export interface InterchangeViewOptions {
  title: string;
  meta: string; // 出どころ・作られた日時
  note?: string; // x_grokBot.requestNote
  sheetName: string;
  portalText: string | null; // 入口を置けなければ null
  groups: InterchangeViewGroup[];
  initial: InterchangeChoiceState;
  replan(choice: InterchangeChoiceState): InterchangeReplan;
  onApply(choice: InterchangeChoiceState): void;
  onClose(): void;
}

export interface PatchViewOptions {
  patch: GrokPatch;
  items: PlanItem[];
  dropped: { index: number; reason: string }[];
  source: string; // 「受け取り口」「ファイル」など
  staleNote?: string; // 書き出しより古い・新しいなどの知らせ
  onChecked(items: PlanItem[]): void;
  onApply(items: PlanItem[]): void;
  onClose(): void;
}

const STATUS_TEXT: Record<PlanItem['status'], string> = { ok: '', same: t('もうそうなっています'), missing: t('相手が見つかりません'), refused: t('できません') };

export class GrokPatchView {
  private root: HTMLElement | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  get isOpen() {
    return this.root !== null;
  }

  open(o: PatchViewOptions) {
    this.close();
    const root = el('div', 'grok-patch');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Grok の提案');
    const head = el('div', 'grok-patch-head');
    head.append(el('div', 'grok-patch-title', t('Grok の提案：{0}', { 0: o.patch.title })));
    head.append(el('div', 'grok-patch-meta', t('{0}・{1} 件{2}', { 0: o.source, 1: o.patch.ops.length, 2: o.patch.basedOn ? `・書き出し ${new Date(o.patch.basedOn).toLocaleString()} をもとに` : '' })));
    if (o.patch.note) head.append(el('p', 'grok-patch-note', o.patch.note));
    if (o.staleNote) head.append(el('p', 'grok-patch-warn', o.staleNote));
    if (o.dropped.length > 0) {
      const why = [...new Set(o.dropped.map((d) => PATCH_REASON_TEXT[d.reason] ?? d.reason))].join(t('・'));
      head.append(el('p', 'grok-patch-warn', t('読めない指示 {0} 件は使いません（{1}）', { 0: o.dropped.length, 1: why })));
    }
    const list = el('ol', 'grok-patch-list');
    const boxes: { item: PlanItem; box: HTMLInputElement }[] = [];
    for (const item of o.items) {
      const li = el('li', `grok-patch-item is-${item.status}`);
      const label = el('label', 'grok-patch-row');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = item.status === 'ok';
      box.disabled = item.status !== 'ok';
      const body = el('div', 'grok-patch-body');
      body.append(el('div', 'grok-patch-what', `${item.what}：${item.target}`));
      if (item.before || item.after) {
        const diff = el('div', 'grok-patch-diff');
        // 「（なし）」などの空の印は消し線にしない
        if (item.before) diff.append(el('span', item.before.startsWith('（') ? 'grok-patch-empty' : 'grok-patch-before', item.before), el('span', 'grok-patch-arrow', ' → '));
        diff.append(el('span', 'grok-patch-after', item.after));
        body.append(diff);
      }
      const notes = [...(item.status !== 'ok' ? [STATUS_TEXT[item.status]] : []), ...item.notes, ...(item.changedSince ? [t('⚠ 書き出したあとに変わっています')] : [])].filter(Boolean);
      for (const n of [...new Set(notes)]) body.append(el('div', item.changedSince && n.startsWith('⚠') ? 'grok-patch-warn' : 'grok-patch-why', n));
      label.append(box, body);
      li.append(label);
      list.append(li);
      boxes.push({ item, box });
    }
    const foot = el('div', 'grok-patch-foot');
    const count = el('span', 'grok-patch-count');
    const all = el('button', 'cell-menu-small', t('全部選ぶ'));
    const none = el('button', 'cell-menu-small', t('全部外す'));
    const apply = el('button', 'cell-menu-small grok-patch-apply', t('反映する'));
    const cancel = el('button', 'cell-menu-small', t('やめる'));
    // 盤面を見る：一覧を畳んで下に寄せ、点線の見本（島・線）が見えるようにする。もう一度押すと戻る
    const peek = el('button', 'cell-menu-small', t('盤面を見る'));
    peek.setAttribute('aria-pressed', 'false');
    peek.title = t('チェックした島・線を、盤面に点線で見せています。一覧を畳んで盤面を見ます');
    peek.addEventListener('click', () => {
      const on = root.classList.toggle('is-peek');
      peek.setAttribute('aria-pressed', String(on));
      peek.textContent = on ? t('一覧に戻る') : t('盤面を見る');
    });
    for (const b of [all, none, apply, cancel, peek]) b.type = 'button';
    const checked = () => boxes.filter((b) => b.box.checked).map((b) => b.item);
    const update = () => {
      const n = checked().length;
      count.textContent = t('{0} / {1} 件を選んでいます', { 0: n, 1: boxes.filter((b) => !b.box.disabled).length });
      apply.disabled = n === 0;
      apply.textContent = n > 0 ? t('反映する（{0}）', { 0: n }) : t('反映する');
      o.onChecked(checked());
    };
    for (const b of boxes) b.box.addEventListener('change', update);
    all.addEventListener('click', () => {
      for (const b of boxes) if (!b.box.disabled) b.box.checked = true;
      update();
    });
    none.addEventListener('click', () => {
      for (const b of boxes) b.box.checked = false;
      update();
    });
    apply.addEventListener('click', () => {
      const items = checked();
      if (items.length === 0) return;
      this.close();
      o.onApply(items);
    });
    cancel.addEventListener('click', () => this.close());
    foot.append(count, all, none, peek, apply, cancel);
    foot.append(el('div', 'grok-patch-why', t('反映する前に控えを取ります。シートの名前 ▾ →「Grok の提案の記録…」から元に戻せます')));
    root.append(head, list, foot);
    document.body.append(root);
    this.root = root;
    const onClose = o.onClose;
    this.keyHandler = (e) => {
      if (e.key === 'Escape' && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    };
    window.addEventListener('keydown', this.keyHandler, true);
    this.closeHook = onClose;
    update();
    apply.focus();
  }

  private closeHook: (() => void) | null = null;

  // 取り込みの一覧（§9.1）。チェックはメモ単位、島の行でまとめて付け外し。シートを作る行は外せない
  openInterchange(o: InterchangeViewOptions) {
    this.close();
    const choice: InterchangeChoiceState = { memos: new Set(o.initial.memos), skipIslands: new Set(o.initial.skipIslands), portal: o.initial.portal };
    const root = el('div', 'grok-patch is-interchange');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Grok の取り込み');
    const head = el('div', 'grok-patch-head');
    head.append(el('div', 'grok-patch-title', t('Grok の取り込み：「{0}」', { 0: o.title })));
    head.append(el('div', 'grok-patch-meta', o.meta));
    const summary = el('p', 'grok-patch-note ix-summary');
    head.append(summary);
    if (o.note) head.append(el('p', 'grok-patch-note ix-request', t('Grok のメモ：{0}', { 0: o.note })));
    const warnings = el('div', 'ix-warnings');
    const board = el('div', 'ix-board');
    head.append(warnings, board);

    const list = el('ol', 'grok-patch-list');
    const fixedRow = (text: string, checked: boolean, disabled: boolean, onChange?: (on: boolean) => void) => {
      const li = el('li', 'grok-patch-item is-ok');
      const label = el('label', 'grok-patch-row');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = checked;
      box.disabled = disabled;
      if (onChange) box.addEventListener('change', () => onChange(box.checked));
      label.append(box, el('div', 'grok-patch-body', ''));
      (label.lastChild as HTMLElement).append(el('div', 'grok-patch-what', text));
      li.append(label);
      list.append(li);
      return { li, box, body: label.lastChild as HTMLElement };
    };
    fixedRow(t('シート「{0}」を作る（外せません）', { 0: o.sheetName }), true, true);
    if (o.portalText) {
      fixedRow(o.portalText, choice.portal, false, (on) => {
        choice.portal = on;
        update();
      });
    } else {
      const row = fixedRow(t('今のシートに入口を置く'), false, true);
      row.body.append(el('div', 'grok-patch-why', t('今のシートに空いた場所が見つかりません（あとで手で置けます）')));
    }

    const memoBoxes = new Map<string, HTMLInputElement>();
    const groupBoxes: { group: InterchangeViewGroup; box: HTMLInputElement; skip: HTMLButtonElement | null }[] = [];
    for (const group of o.groups) {
      if (group.rows.length === 0) continue;
      const li = el('li', 'grok-patch-item is-ok ix-group');
      const label = el('label', 'grok-patch-row ix-group-row');
      const box = el('input');
      box.type = 'checkbox';
      const body = el('div', 'grok-patch-body');
      const what = el('div', 'grok-patch-what');
      if (group.color) {
        const dot = el('span', 'ix-dot');
        dot.style.setProperty('--data', group.color);
        what.append(dot);
      }
      what.append(document.createTextNode(t('{0}　メモ {1}', { 0: group.key === null ? group.name : `島「${group.name}」`, 1: group.rows.length })));
      body.append(what);
      if (group.note) body.append(el('div', 'grok-patch-warn', group.note));
      label.append(box, body);
      li.append(label);
      let skip: HTMLButtonElement | null = null;
      if (group.key !== null && !group.note) {
        // 島の行だけ外す（メモは残し、島なしで取り込む）
        const key = group.key;
        skip = el('button', 'cell-menu-small ix-skip', t('島を作らない'));
        skip.type = 'button';
        skip.setAttribute('aria-pressed', String(choice.skipIslands.has(key)));
        skip.addEventListener('click', () => {
          if (choice.skipIslands.has(key)) choice.skipIslands.delete(key);
          else choice.skipIslands.add(key);
          skip?.setAttribute('aria-pressed', String(choice.skipIslands.has(key)));
          if (skip) skip.textContent = choice.skipIslands.has(key) ? t('島を作る') : t('島を作らない');
          update();
        });
        li.append(skip);
      }
      const rows = el('ol', 'ix-memos');
      for (const row of group.rows) {
        const item = el('li', 'ix-memo');
        const rl = el('label', 'grok-patch-row');
        const mb = el('input');
        mb.type = 'checkbox';
        mb.checked = choice.memos.has(row.key);
        mb.addEventListener('change', () => {
          if (mb.checked) choice.memos.add(row.key);
          else choice.memos.delete(row.key);
          update();
        });
        const rb = el('div', 'grok-patch-body');
        rb.append(el('div', 'grok-patch-what', row.title), el('div', 'grok-patch-why', row.detail));
        rl.append(mb, rb);
        item.append(rl);
        if (row.cards.length > 0) {
          const more = el('details', 'ix-cards');
          more.append(el('summary', '', t('カードの題（{0}）', { 0: row.cards.length })));
          const ul = el('ul');
          for (const c of row.cards) ul.append(el('li', '', c));
          more.append(ul);
          item.append(more);
        }
        rows.append(item);
        memoBoxes.set(row.key, mb);
      }
      li.append(rows);
      list.append(li);
      box.addEventListener('change', () => {
        for (const row of group.rows) {
          if (box.checked) choice.memos.add(row.key);
          else choice.memos.delete(row.key);
          const mb = memoBoxes.get(row.key);
          if (mb) mb.checked = box.checked;
        }
        update();
      });
      groupBoxes.push({ group, box, skip });
    }
    const links = fixedRow(t('盤面の線'), true, true);
    const linksWhy = el('div', 'grok-patch-why');
    links.body.append(linksWhy);

    const foot = el('div', 'grok-patch-foot');
    const count = el('span', 'grok-patch-count');
    const all = el('button', 'cell-menu-small', t('全部選ぶ'));
    const none = el('button', 'cell-menu-small', t('全部外す'));
    const big = el('button', 'cell-menu-small', t('ミニ盤面を大きく'));
    big.setAttribute('aria-pressed', 'false');
    const apply = el('button', 'cell-menu-small grok-patch-apply', t('反映する'));
    const cancel = el('button', 'cell-menu-small', t('やめる'));
    for (const b of [all, none, big, apply, cancel]) b.type = 'button';
    big.addEventListener('click', () => {
      const on = root.classList.toggle('is-big-board');
      big.setAttribute('aria-pressed', String(on));
      big.textContent = on ? t('ミニ盤面を小さく') : t('ミニ盤面を大きく');
    });
    const allKeys = o.groups.flatMap((g) => g.rows.map((r) => r.key));
    all.addEventListener('click', () => {
      for (const k of allKeys) choice.memos.add(k);
      for (const b of memoBoxes.values()) b.checked = true;
      update();
    });
    none.addEventListener('click', () => {
      choice.memos.clear();
      for (const b of memoBoxes.values()) b.checked = false;
      update();
    });
    let last: InterchangeReplan | null = null;
    const update = () => {
      for (const g of groupBoxes) {
        const on = g.group.rows.filter((r) => choice.memos.has(r.key)).length;
        g.box.checked = on === g.group.rows.length;
        g.box.indeterminate = on > 0 && on < g.group.rows.length;
      }
      last = o.replan(choice);
      summary.textContent = last.summary;
      warnings.replaceChildren(...last.warnings.map((w) => el('p', 'grok-patch-warn', `⚠ ${w}`)));
      board.replaceChildren(miniBoard(last.board));
      linksWhy.textContent = last.links;
      count.textContent = last.blocked ?? t('メモ {0} / {1} 個を選んでいます', { 0: choice.memos.size, 1: allKeys.length });
      count.classList.toggle('grok-patch-warn', !!last.blocked);
      apply.disabled = !!last.blocked;
      apply.textContent = last.applyLabel;
    };
    apply.addEventListener('click', () => {
      if (!last || last.blocked) return;
      const picked: InterchangeChoiceState = { memos: new Set(choice.memos), skipIslands: new Set(choice.skipIslands), portal: choice.portal };
      this.close();
      o.onApply(picked);
    });
    cancel.addEventListener('click', () => this.close());
    foot.append(count, all, none, big, apply, cancel);
    foot.append(el('div', 'grok-patch-why', t('反映する前に控えを取ります。シートの名前 ▾ →「Grok の提案の記録…」から 1 回で元に戻せます')));
    root.append(head, list, foot);
    document.body.append(root);
    this.root = root;
    this.keyHandler = (e) => {
      if (e.key === 'Escape' && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    };
    window.addEventListener('keydown', this.keyHandler, true);
    this.closeHook = o.onClose;
    update();
    apply.focus();
  }

  close() {
    if (!this.root) return;
    this.root.remove();
    this.root = null;
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler, true);
    this.keyHandler = null;
    const hook = this.closeHook;
    this.closeHook = null;
    hook?.();
  }
}
