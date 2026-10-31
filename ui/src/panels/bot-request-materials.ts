// 依頼の小窓の材料欄（段 D2）。送るものの中、クリップボードの画像のカードより上に出す。
//   1 件が 1 枚。種類・名前・見本・付ける印・✕。5 件を超えた分は「ほか n 件」。文字は textContent だけ
import { tryTurnMaterialOn, turnMaterialsOn, type Material, type MaterialRef } from '../draft-materials';
import { findSecretish } from '../bot-replies';
import { el } from '../util';

const SHOW_MAX = 5;

function badge(item: Material): string {
  if (item.kind === 'cell') {
    if (item.ref?.kind === 'tab') return 'タブ';
    if (item.ref?.kind === 'memo') return 'メモ';
    if (item.ref?.kind === 'island') return '島';
    return 'セル';
  }
  if (item.kind === 'card') return 'カード';
  if (item.kind === 'page') return 'ページ';
  if (item.kind === 'selection') return '選んだ文';
  if (item.kind === 'body') return '本文';
  return '画像';
}

function snippetOf(item: Material): string {
  if (item.detail) return item.detail;
  if (item.kind !== 'image' && item.text) return findSecretish(item.text).masked;
  if (item.kind !== 'image' && item.url) return item.url;
  return '';
}

function refName(ref: MaterialRef): string {
  if (ref.kind === 'tab') return 'タブ';
  if (ref.kind === 'memo') return 'メモ';
  if (ref.kind === 'card') return 'カード';
  return '島';
}

// 材料の一覧。印の付け外しは、渡された配列をその場で変える（開いたときにコピーしてある）
export class MaterialList {
  readonly element = el('fieldset', 'brf-mat');
  private items: Material[] = [];
  private missing: MaterialRef[] = [];
  private opened = false;
  private onChange: (note?: string) => void = () => {};

  constructor() {
    this.element.hidden = true;
  }

  set(items: Material[], onChange: (note?: string) => void) {
    this.items = items;
    this.missing = [];
    this.opened = false;
    this.onChange = onChange;
    this.render();
  }

  setMissing(refs: MaterialRef[], onChange: (note?: string) => void) {
    this.items = [];
    this.missing = refs;
    this.opened = false;
    this.onChange = onChange;
    this.render();
  }

  clear() {
    this.items = [];
    this.missing = [];
    this.opened = false;
    this.render();
  }

  list(): Material[] {
    return this.items;
  }

  hasItems(): boolean {
    return this.items.length > 0 || this.missing.length > 0;
  }

  // 鍵らしき文字のある材料の印を外す（送る文に入れない）
  dropSecrets(): boolean {
    let dropped = false;
    for (const item of this.items) {
      if (item.kind === 'image' || !item.on || !item.text) continue;
      if (!findSecretish(item.text).count) continue;
      item.on = false;
      dropped = true;
    }
    if (dropped) this.render();
    return dropped;
  }

  // 材料の文の鍵らしき文字を置き換える（印の有無によらず。見本に生の値を残さない）
  maskTexts(mask: (value: string) => string) {
    let changed = false;
    for (const item of this.items) {
      if (item.kind === 'image' || !item.text) continue;
      const next = mask(item.text);
      if (next === item.text) continue;
      item.text = next;
      changed = true;
    }
    if (changed) this.render();
  }

  private render() {
    const items = this.items;
    const missing = this.missing;
    const pool = items.length || missing.length;
    this.element.hidden = pool === 0;
    if (!pool) {
      this.element.replaceChildren();
      return;
    }
    const legend = el('legend', 'brf-mat-legend', items.length ? `材料（${items.length} 件）` : `材料（見つからない ${missing.length} 件）`);
    const list = el('div', 'brf-mat-list');
    const shownItems = this.opened ? items : items.slice(0, SHOW_MAX);
    const shownMissing = items.length ? [] : this.opened ? missing : missing.slice(0, SHOW_MAX);
    for (const item of shownItems) list.append(this.card(item));
    for (const ref of shownMissing) list.append(this.missingCard(ref));
    const actions = el('div', 'brf-mat-actions');
    if (pool > SHOW_MAX) {
      const more = el('button', 'brf-button brf-mat-more', this.opened ? '閉じる' : `ほか ${pool - SHOW_MAX} 件 ▾`);
      more.type = 'button';
      more.addEventListener('click', () => {
        this.opened = !this.opened;
        this.render();
      });
      actions.append(more);
    }
    if (items.length) {
      const off = el('button', 'brf-button', '全部外す');
      off.type = 'button';
      off.addEventListener('click', () => {
        for (const item of this.items) item.on = false;
        this.onChange();
        this.render();
      });
      const on = el('button', 'brf-button', '全部付ける（本文・画像・つながったカードは除く）');
      on.type = 'button';
      on.title = '本文・画像・つながりから足したカードの印は、今のままにします';
      on.addEventListener('click', () => {
        const note = turnMaterialsOn(this.items);
        this.onChange(note ?? undefined);
        this.render();
      });
      actions.append(off, on);
    }
    this.element.replaceChildren(legend, list, actions);
  }

  private card(item: Material): HTMLElement {
    const row = el('div', 'brf-mat-card');
    const input = el('input', 'brf-checkbox');
    input.type = 'checkbox';
    const image = item.kind === 'image';
    if (image) item.on = false;
    input.checked = item.on && !image;
    input.disabled = image;
    input.addEventListener('change', () => {
      if (input.checked) {
        const note = tryTurnMaterialOn(this.items, item);
        this.onChange(note ?? undefined);
        this.render();
        return;
      }
      item.on = false;
      this.onChange();
      this.render();
    });
    const label = el('label', 'brf-check brf-mat-label');
    const textBox = el('span', 'brf-check-text');
    const head = el('span', 'brf-check-label');
    head.append(el('span', 'brf-mat-kind', badge(item)));
    if (item.label) head.append(el('span', '', ` ${item.label}`));
    textBox.append(head);
    const snip = snippetOf(item);
    if (snip) textBox.append(el('span', 'brf-check-sub', snip));
    if (image) textBox.append(el('span', 'brf-check-sub', '画像は下の画像のカードで付けます（ここでは送りません）'));
    if (!image && item.text && findSecretish(item.text).count) textBox.append(el('span', 'brf-check-sub brf-check-warn', '鍵らしき文字があります（ここでは〔鍵〕で伏せて見せています）'));
    label.append(input, textBox);
    const drop = el('button', 'brf-button brf-mat-x', '✕');
    drop.type = 'button';
    drop.title = 'この材料を外します';
    drop.disabled = image;
    drop.addEventListener('click', () => {
      item.on = false;
      this.onChange();
      this.render();
    });
    row.append(label, drop);
    return row;
  }

  private missingCard(ref: MaterialRef): HTMLElement {
    const row = el('div', 'brf-mat-card');
    const input = el('input', 'brf-checkbox');
    input.type = 'checkbox';
    input.checked = false;
    input.disabled = true;
    const label = el('label', 'brf-check brf-mat-label');
    const textBox = el('span', 'brf-check-text');
    textBox.append(el('span', 'brf-check-label', `${refName(ref)}（見つかりません）`));
    textBox.append(el('span', 'brf-check-sub', '中身は読み直せません。送りません'));
    label.append(input, textBox);
    row.append(label);
    return row;
  }
}
