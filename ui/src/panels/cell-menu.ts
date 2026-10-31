// 盤面の右クリックのメニュー（コピー・貼り付け・セット）と、短いお知らせ（トースト）
import { t } from '../i18n';
import { armConfirm } from '../confirm-arm';
import { el } from '../util';

export interface MenuButton {
  label: string;
  run: () => void;
  confirm?: string; // 押すと一度この文字に変わり、もう一度押すと実行（消すときなど）
  pressed?: boolean; // 切り替えのボタン（押してある方）。押してもメニューは閉じない
  aria?: string; // 読み上げる名前（ボタンの文字だけでは、何のボタンか分からないとき）
  title?: string; // マウスを乗せたときの説明
  close?: boolean; // 押したらメニューを閉じる（シートのボタンなど。無ければ、今までどおり開いたまま）
  color?: string; // 色の見本のボタン（島の色を選ぶ）。label は空でもよい
  current?: boolean; // いまのシート（見た目だけ）
}

export type MenuEntry =
  | { label: string; hint?: string; disabled?: boolean; run?: () => void }
  | { section: string }
  | { row: string; hint?: string; buttons: MenuButton[]; menu?: () => void } // 名前と、横に並ぶボタン（セットの一覧）。menu：行の右クリック・ContextMenu キー・Shift+F10
  | { pills: MenuButton[] } // 登録したシートのボタン（右の区画タグと同じ丸いボタン）
  | { note: string } // 押せない、何行かの文（メモにする前に見せる、クリップボードの最初の 200 字など。文字としてだけ出す）
  | 'sep';

export class CellMenu {
  private readonly element = el('div', 'cell-menu');
  private at = { x: 0, y: 0 };
  private entries: MenuEntry[] = [];
  private opener: HTMLElement | null = null; // メニューを開いたボタン（閉じたら、キーボードの位置を戻す）
  private opened = 0; // open のたびに増やす（あとから中身を入れるとき、別のメニューを上書きしない）

  // options.host：入れる所（無ければ body。前後の順をほかの浮いた窓と分け合うとき）。
  //   options.keepOpen：外を押しても閉じない所（関連の一覧の欄を開いたまま、出したカードを押すなど）
  constructor(options: { host?: HTMLElement; keepOpen?: (target: Node) => boolean } = {}) {
    this.element.hidden = true;
    this.element.setAttribute('role', 'menu');
    (options.host ?? document.body).append(this.element);
    document.addEventListener('pointerdown', (e) => {
      const target = e.target as Node;
      if (this.element.hidden || this.element.contains(target)) return;
      if (options.keepOpen?.(target)) return;
      this.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.element.hidden) this.close();
    });
    window.addEventListener('blur', () => this.close());
  }

  // 欄そのもの（前後の順を付ける・場所を測るため。中身は触らない）
  get node(): HTMLElement {
    return this.element;
  }

  get isOpen() {
    return !this.element.hidden;
  }

  open(x: number, y: number, entries: MenuEntry[]) {
    this.opened++;
    this.at = { x, y };
    this.remember();
    this.show(entries);
  }

  // 呼ぶ側で組んだ中身（いくつも入れる欄のある小窓など）を、メニューの場所に出す。外を押す・Esc で閉じる
  showForm(node: HTMLElement, at?: { x: number; y: number }) {
    this.opened++;
    if (at) this.at = at;
    this.remember();
    this.entries = [];
    this.element.classList.add('cell-menu-wide');
    this.element.replaceChildren(node);
    this.element.hidden = false;
    this.place();
  }

  // いま開いているメニューの印（open のあとで読む。別のメニューが開いたら、合わなくなる）
  token() {
    return this.opened;
  }

  // 開いたまま中身だけ入れ替える（クリップボードを読み終えたときなど）
  //   token：open の直後の印。渡したときは、そのメニューがまだ開いているときだけ入れる
  update(entries: MenuEntry[], token?: number) {
    if (!this.isOpen || (token !== undefined && token !== this.opened)) return;
    this.show(entries);
  }

  // 今の中身を描き直す（切り替えのボタンを押したときなど。中身の項目を書き換えてから呼ぶ）
  refresh() {
    if (!this.isOpen) return;
    // 押したボタンに、描き直した後もキーボードの位置を残す
    const buttons = [...this.element.querySelectorAll('button')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    this.show(this.entries);
    if (index >= 0) this.element.querySelectorAll('button')[index]?.focus();
  }

  // いちばん上の押せる項目にキーボードの位置を置く（キーボードで開いたメニュー）
  focusFirst() {
    this.element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }

  close() {
    this.element.classList.remove('cell-menu-wide');
    // メニューの中にキーボードの位置があったら（項目を押した・Esc）、開いたボタンへ戻す
    const back = this.element.contains(document.activeElement) ? this.opener : null;
    this.opener?.setAttribute('aria-expanded', 'false');
    this.opener = null;
    this.element.hidden = true;
    this.element.replaceChildren();
    if (back?.isConnected) back.focus({ preventScroll: true });
  }

  // 開いたボタンを覚える（aria-haspopup のボタンなら、開いている印も付ける）
  //   ボタンだけ（盤面の右クリックのとき、アドレスバーなどに戻すと、そのあとの Ctrl+V がそちらへ行ってしまう）
  private remember() {
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.element.contains(active)) return;
    const opener = active instanceof HTMLButtonElement ? active : null;
    if (this.opener !== opener) this.opener?.setAttribute('aria-expanded', 'false');
    this.opener = opener;
    if (opener?.hasAttribute('aria-haspopup')) opener.setAttribute('aria-expanded', 'true');
  }

  // 名前を入れる欄（Enter で決める・Esc でやめる）。at：出す場所（無ければ、最後に開いたメニューの場所）
  //   options：maxLength（無ければ 30 文字）・placeholder（ボットのリンクを貼る欄など）
  prompt(label: string, initial: string, onOk: (value: string) => void, at?: { x: number; y: number }, options: { maxLength?: number; placeholder?: string } = {}) {
    if (at) this.at = at;
    this.remember();
    const form = el('form', 'cell-menu-form');
    const input = el('input');
    input.value = initial;
    input.maxLength = options.maxLength ?? 30;
    if (options.placeholder) {
      input.placeholder = options.placeholder;
      input.spellcheck = false;
    }
    input.setAttribute('aria-label', label);
    const ok = el('button', 'cell-menu-small', t('決める'));
    ok.type = 'submit';
    form.append(el('div', 'cell-menu-section', label), input, ok);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = input.value.trim();
      if (!value) return;
      this.close();
      onOk(value);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
    this.element.replaceChildren(form);
    this.element.hidden = false;
    this.place();
    input.focus();
    input.select();
  }

  // 単語帳に入れる前の確認。表・裏・言葉か問い・前後の文を直してから入れる
  confirmVocab(
    draft: { kind: 'word' | 'quiz'; front: string; back: string; example: string; note: string; rotate: boolean },
    onOk: (value: { kind: 'word' | 'quiz'; front: string; back: string; example: string; rotate: boolean; note: string }) => void,
    at?: { x: number; y: number },
  ) {
    if (at) this.at = at;
    this.opened++;
    this.remember();
    this.element.classList.add('cell-menu-wide');
    let kind = draft.kind;
    let rotate = draft.rotate;
    const form = el('form', 'cell-menu-form');
    const kindRow = el('div', 'cell-menu-kind');
    const word = el('button', 'cell-menu-small cell-menu-toggle', t('言葉'));
    const quiz = el('button', 'cell-menu-small cell-menu-toggle', t('問い'));
    const rotateButton = el('button', 'cell-menu-small cell-menu-toggle', t('⟳ めぐるに出す'));
    word.type = 'button';
    quiz.type = 'button';
    rotateButton.type = 'button';
    word.title = t('言葉と意味のカードにする');
    quiz.title = t('問いと答えのカードにする');
    rotateButton.title = t('めぐる表示（右の月の窓）に出す印を付けて入れます。既定は月の窓の ⚙ の「新しく入れたカードに ⟳ を付ける」');
    const paint = () => {
      word.setAttribute('aria-pressed', String(kind === 'word'));
      quiz.setAttribute('aria-pressed', String(kind === 'quiz'));
      rotateButton.setAttribute('aria-pressed', String(rotate));
    };
    word.addEventListener('click', () => {
      kind = 'word';
      paint();
    });
    quiz.addEventListener('click', () => {
      kind = 'quiz';
      paint();
    });
    rotateButton.addEventListener('click', () => {
      rotate = !rotate;
      paint();
    });
    paint();
    kindRow.append(word, quiz);
    const front = el('input');
    front.value = draft.front;
    front.maxLength = 400;
    front.placeholder = t('表（言葉・問い）');
    front.setAttribute('aria-label', '表');
    const back = el('textarea');
    back.value = draft.back;
    back.maxLength = 1000;
    back.rows = 3;
    back.placeholder = t('裏（意味・答え）');
    back.setAttribute('aria-label', '裏');
    const example = el('input');
    example.value = draft.example;
    example.maxLength = 300;
    example.placeholder = t('前後の文（なくてもよい）');
    example.setAttribute('aria-label', '前後の文');
    // メモ（K5b）：左の単語帳のカードに入る。Esc で閉じる（裏の欄と同じ）
    const memo = el('textarea');
    memo.placeholder = t('メモ（なくてもよい）');
    memo.maxLength = 500;
    memo.rows = 2;
    memo.setAttribute('aria-label', 'メモ');
    memo.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
    const warn = el('div', 'cell-menu-note', t('表と裏の両方を書いてください'));
    warn.hidden = true;
    const ok = el('button', 'cell-menu-small', t('入れる'));
    ok.type = 'submit';
    const cancel = el('button', 'cell-menu-small', t('やめる'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.close());
    const row = el('div', 'cell-menu-kind');
    row.append(ok, cancel);
    form.append(el('div', 'cell-menu-section', t('単語帳に入れる')), el('div', 'cell-menu-note', draft.note), kindRow, front, back, example, memo, rotateButton, warn, row);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const nextFront = front.value.trim();
      const nextBack = back.value.trim();
      if (!nextFront || !nextBack) {
        warn.hidden = false;
        (nextFront ? back : front).focus();
        return;
      }
      this.close();
      onOk({ kind, front: nextFront, back: nextBack, example: example.value.trim(), rotate, note: memo.value.trim() });
    });
    front.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
    back.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
    this.element.replaceChildren(form);
    this.element.hidden = false;
    this.place();
    if (front.value.trim()) back.focus();
    else front.focus();
  }

  private show(entries: MenuEntry[]) {
    this.entries = entries;
    const nodes: HTMLElement[] = [];
    for (const entry of entries) {
      if (entry === 'sep') {
        nodes.push(el('div', 'cell-menu-sep'));
      } else if ('section' in entry) {
        nodes.push(el('div', 'cell-menu-section', entry.section));
      } else if ('note' in entry) {
        nodes.push(el('div', 'cell-menu-note', entry.note));
      } else if ('pills' in entry) {
        const row = el('div', 'cell-menu-pills');
        for (const b of entry.pills) {
          const button = el('button', b.current ? 'sidebar-tag is-current' : 'sidebar-tag', b.label);
          button.type = 'button';
          const title = b.title ?? b.aria ?? b.label;
          button.title = title;
          button.setAttribute('aria-label', title);
          if (b.current) button.setAttribute('aria-current', 'true');
          button.addEventListener('click', () => {
            if (b.close) this.close();
            b.run();
          });
          row.append(button);
        }
        nodes.push(row);
      } else if ('row' in entry) {
        const row = el('div', 'cell-menu-row');
        const menu = entry.menu;
        if (menu) {
          // 行の右クリック（キーのときは、焦点のあるボタンの keydown で受け、あとから届く contextmenu は捨てる）
          let keyAt = 0;
          row.addEventListener('keydown', (e) => {
            if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return;
            e.preventDefault();
            e.stopPropagation();
            keyAt = Date.now();
            menu();
          });
          row.addEventListener('contextmenu', (e) => {
            e.preventDefault(); // WebView2 の既定の欄は出さない
            e.stopPropagation();
            if (e.button !== 2 && Date.now() - keyAt < 800) return;
            menu();
          });
        }
        const name = el('span', 'cell-menu-row-name', entry.row);
        if (entry.hint) name.append(el('span', 'cell-menu-hint', entry.hint));
        row.append(name);
        for (const b of entry.buttons) {
          const button = el('button', b.pressed === undefined ? 'cell-menu-small' : 'cell-menu-small cell-menu-toggle', b.label);
          if (b.pressed !== undefined) button.setAttribute('aria-pressed', String(b.pressed));
          if (b.aria) button.setAttribute('aria-label', b.aria);
          if (b.title) button.title = b.title;
          if (b.color) {
            button.classList.add('cell-menu-swatch');
            button.style.setProperty('--swatch', b.color);
          }
          button.addEventListener('click', () => {
            if (b.confirm && button.textContent !== b.confirm) {
              armConfirm(button);
              button.textContent = b.confirm;
              button.classList.add('danger');
              return;
            }
            if (b.close) this.close();
            b.run();
          });
          row.append(button);
        }
        nodes.push(row);
      } else {
        const item = el('button', 'cell-menu-item');
        item.setAttribute('role', 'menuitem');
        item.append(el('span', '', entry.label));
        if (entry.hint) item.append(el('span', 'cell-menu-hint', entry.hint));
        item.disabled = !!entry.disabled || !entry.run;
        const run = entry.run;
        if (run) {
          item.addEventListener('click', () => {
            this.close();
            run();
          });
        }
        nodes.push(item);
      }
    }
    this.element.replaceChildren(...nodes);
    this.element.hidden = false;
    this.place();
  }

  // 画面からはみ出さないように置く
  private place() {
    const width = this.element.offsetWidth;
    const height = this.element.offsetHeight;
    const x = Math.max(4, Math.min(this.at.x, window.innerWidth - width - 4));
    const y = Math.max(4, Math.min(this.at.y, window.innerHeight - height - 4));
    this.element.style.left = `${x}px`;
    this.element.style.top = `${y}px`;
  }
}

// 盤面の下に、短いお知らせを出す
export function showToast(host: HTMLElement, text: string, ms = 3500) {
  let toast = host.querySelector<HTMLElement>(':scope > .board-toast');
  if (!toast) {
    toast = el('div', 'board-toast');
    host.append(toast);
  }
  toast.textContent = text;
  toast.hidden = false;
  window.clearTimeout(Number(toast.dataset.timer));
  const node = toast;
  node.dataset.timer = String(window.setTimeout(() => (node.hidden = true), ms));
}
