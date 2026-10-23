// 相棒への頼みごとのボタン（6つ）と、その編集。会話の入力欄の上に置く
//   上の行：セットの切り替え・その他の文言・編集　下：6つのボタン（Alt+1〜6 でも押せる）
import { armConfirm } from '../confirm-arm';
import {
  BUTTONS,
  defaultBook,
  isFixed,
  KIND_LABELS,
  KIND_SHORT,
  LABEL_MAX,
  loadPhrases,
  MAX_OTHERS,
  MAX_SETS,
  newSetId,
  normalizeBook,
  type Phrase,
  type PhraseBook,
  type PhraseKind,
  parsePhrase,
  savePhrases,
  TEXT_MAX,
} from '../ai/phrases';
import { el } from '../util';
import { CellMenu, type MenuEntry, showToast } from './cell-menu';

export interface PhraseBarHost {
  run(p: Phrase): void; // ボタンを押したとき
  inputText(): string; // 入力欄の文（「その他」に登録するとき）
}

// 編集中の文言（文言が空でもよい。保存するときに使えるものだけ残す）
type Draft = Phrase;
interface DraftBook {
  current: string;
  sets: { id: string; name: string; buttons: Draft[] }[];
  others: Draft[];
}

const KIND_ORDER: PhraseKind[] = ['send', 'fill', 'summarize', 'explain', 'quiz'];
const blank = (): Draft => ({ label: '', kind: 'send', text: '', page: true });

export class PhraseBar {
  readonly element = el('div', 'ai-quick');
  readonly editor = el('div', 'phrase-editor');
  private book: PhraseBook = defaultBook();
  private readonly menu = new CellMenu();
  private readonly setButton = el('button', 'ai-small phrase-set');
  private readonly moreButton = el('button', 'ai-small', 'その他 ▾');
  private readonly editButton = el('button', 'ai-small', '✎');
  private readonly grid = el('div', 'phrase-grid');
  private draft: DraftBook | null = null;
  private editing = ''; // 編集中のセット

  constructor(private readonly host: PhraseBarHost) {
    const top = el('div', 'phrase-top');
    this.setButton.title = 'ボタンのセットを切り替える';
    this.moreButton.title = 'その他の文言（入力中の文を登録することもできる）';
    this.editButton.title = 'ボタンとその他の文言を編集する';
    this.editButton.setAttribute('aria-label', 'ボタンを編集');
    this.setButton.addEventListener('click', () => this.openSets());
    this.moreButton.addEventListener('click', () => this.openMore());
    this.editButton.addEventListener('click', () => this.openEditor());
    top.append(this.setButton, el('span', 'phrase-gap'), this.moreButton, this.editButton);
    this.element.append(top, this.grid);
    this.editor.hidden = true;
    this.editor.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.closeEditor();
      }
    });
    this.render();
    void loadPhrases().then((book) => {
      this.book = book;
      this.render();
    });
  }

  private get current() {
    return this.book.sets.find((s) => s.id === this.book.current) ?? this.book.sets[0];
  }

  // Alt+1〜6
  press(index: number) {
    const p = this.current.buttons[index];
    if (p) this.host.run(p);
  }

  private render() {
    const set = this.current;
    this.setButton.textContent = `${set.name} ▾`;
    this.grid.replaceChildren(
      ...set.buttons.map((p, i) => {
        if (!p) {
          const b = el('button', 'phrase-button empty', '＋');
          b.title = `空き（押すと、ここにボタンを登録）・Alt+${i + 1}`;
          b.addEventListener('click', () => this.openEditor(i));
          return b;
        }
        const b = el('button', `phrase-button ${p.kind}`, p.label);
        b.title = `${hintOf(p)}・Alt+${i + 1}`;
        b.addEventListener('click', () => this.host.run(p));
        return b;
      }),
    );
  }

  private async save(book: PhraseBook, message?: string) {
    this.book = book;
    this.render();
    const ok = await savePhrases(book);
    const host = this.element.parentElement;
    if (host) showToast(host, ok ? (message ?? '保存しました') : '保存できませんでした', ok ? 2500 : 5000);
  }

  // ---------- メニュー ----------

  private anchor(button: HTMLElement): [number, number] {
    const r = button.getBoundingClientRect();
    return [r.left, r.bottom + 2];
  }

  private openSets() {
    const entries: MenuEntry[] = [{ section: 'ボタンのセット' }];
    for (const set of this.book.sets) {
      entries.push({
        label: `${set.id === this.book.current ? '✓ ' : '　'}${set.name}`,
        hint: set.buttons
          .filter((p): p is Phrase => p !== null)
          .map((p) => p.label)
          .slice(0, 3)
          .join('・'),
        run: () => void this.save({ ...this.book, current: set.id }, `「${set.name}」のボタンにしました`),
      });
    }
    entries.push('sep', { label: 'セットを編集…', run: () => this.openEditor() });
    entries.push({ label: '＋ 新しいセット…', disabled: this.book.sets.length >= MAX_SETS, run: () => this.openEditor(0, true) });
    this.menu.open(...this.anchor(this.setButton), entries);
  }

  private openMore() {
    const entries: MenuEntry[] = [{ section: 'その他の文言' }];
    if (this.book.others.length === 0) entries.push({ label: 'まだありません', disabled: true });
    for (const p of this.book.others) entries.push({ label: p.label, hint: shortKind(p), run: () => this.host.run(p) });
    const text = this.host.inputText().trim();
    entries.push('sep', {
      label: '＋ 入力中の文を登録',
      hint: text ? '' : '入力欄に書いてから',
      disabled: !text || this.book.others.length >= MAX_OTHERS,
      run: () => this.register(text),
    });
    entries.push({ label: '文言を編集…', run: () => this.openEditor(undefined, false, true) });
    this.menu.open(...this.anchor(this.moreButton), entries);
  }

  private register(text: string) {
    const p = parsePhrase({ kind: 'send', text, page: true });
    if (!p) return;
    void this.save({ ...this.book, others: [...this.book.others, p] }, `「${p.label}」をその他に登録しました`);
  }

  // ---------- 編集 ----------

  // slot：その番目のボタンの欄を選んでおく　newSet：新しいセットを作って開く　others：その他の文言の所を見せる
  openEditor(slot?: number, newSet = false, others = false) {
    this.menu.close();
    const draft: DraftBook = {
      current: this.book.current,
      sets: this.book.sets.map((s) => ({ id: s.id, name: s.name, buttons: s.buttons.map((p) => (p ? { ...p } : blank())) })),
      others: this.book.others.map((p) => ({ ...p })),
    };
    if (newSet) {
      const set = { id: newSetId(), name: `セット${draft.sets.length + 1}`, buttons: Array.from({ length: BUTTONS }, blank) };
      draft.sets.push(set);
      draft.current = set.id;
    }
    this.draft = draft;
    this.editing = draft.current;
    this.renderEditor();
    this.editor.hidden = false;
    const focus = others
      ? this.editor.querySelector<HTMLElement>('.phrase-others')
      : newSet
        ? this.editor.querySelector<HTMLInputElement>('.phrase-set-name')
        : this.editor.querySelectorAll<HTMLInputElement>('.phrase-slot .phrase-label')[slot ?? 0];
    focus?.scrollIntoView({ block: 'nearest' });
    if (focus instanceof HTMLInputElement) {
      focus.focus();
      focus.select();
    }
  }

  private closeEditor() {
    this.draft = null;
    this.editor.hidden = true;
    this.editor.replaceChildren();
  }

  private renderEditor() {
    const draft = this.draft;
    if (!draft) return;
    const set = draft.sets.find((s) => s.id === this.editing) ?? draft.sets[0];
    this.editing = set.id;

    const head = el('div', 'phrase-editor-head');
    const close = el('button', 'ai-small', '×');
    close.title = 'やめる（Esc）';
    close.addEventListener('click', () => this.closeEditor());
    head.append(el('span', 'phrase-editor-title', 'ボタンとその他の文言'), close);

    // セット：切り替え・名前・新しく・複製・消す
    const setRow = el('div', 'phrase-set-row');
    const select = el('select');
    select.setAttribute('aria-label', '編集するセット');
    for (const s of draft.sets) {
      const option = el('option', '', s.name || '（名前なし）');
      option.value = s.id;
      option.selected = s.id === set.id;
      select.append(option);
    }
    select.addEventListener('change', () => {
      this.editing = select.value;
      this.renderEditor();
    });
    const name = el('input', 'phrase-set-name');
    name.value = set.name;
    name.maxLength = 20;
    name.placeholder = 'セットの名前';
    name.setAttribute('aria-label', 'セットの名前');
    name.addEventListener('input', () => {
      set.name = name.value;
      const option = [...select.options].find((o) => o.value === set.id);
      if (option) option.textContent = name.value || '（名前なし）';
    });
    const add = el('button', 'ai-small', '＋ 新しく');
    add.disabled = draft.sets.length >= MAX_SETS;
    add.addEventListener('click', () => {
      const s = { id: newSetId(), name: `セット${draft.sets.length + 1}`, buttons: Array.from({ length: BUTTONS }, blank) };
      draft.sets.push(s);
      this.editing = s.id;
      this.renderEditor();
    });
    const copy = el('button', 'ai-small', '複製');
    copy.disabled = draft.sets.length >= MAX_SETS;
    copy.addEventListener('click', () => {
      const s = { id: newSetId(), name: `${set.name}のコピー`.slice(0, 20), buttons: set.buttons.map((p) => ({ ...p })) };
      draft.sets.push(s);
      this.editing = s.id;
      this.renderEditor();
    });
    const remove = el('button', 'ai-small', '消す');
    remove.disabled = draft.sets.length <= 1;
    remove.title = draft.sets.length <= 1 ? 'セットが1つのときは消せません' : 'このセットを消す（もう一度押すと消える）';
    remove.addEventListener('click', () => {
      if (remove.textContent !== '本当に消す') {
        armConfirm(remove);
        remove.textContent = '本当に消す';
        remove.classList.add('danger');
        return;
      }
      draft.sets = draft.sets.filter((s) => s.id !== set.id);
      if (draft.current === set.id) draft.current = draft.sets[0].id;
      this.editing = draft.current;
      this.renderEditor();
    });
    const use = el('label', 'ai-check');
    const useBox = el('input');
    useBox.type = 'checkbox';
    useBox.checked = draft.current === set.id;
    useBox.addEventListener('change', () => {
      if (useBox.checked) draft.current = set.id;
      else useBox.checked = true; // どれか1つは使う
    });
    use.append(useBox, document.createTextNode('このセットを使う'));
    setRow.append(select, name, add, copy, remove, use);

    // 6つのボタン
    const slots = el('div', 'phrase-slots');
    set.buttons.forEach((p, i) => {
      slots.append(
        this.row(p, `${i + 1}`, 'phrase-slot', {
          label: '空にする',
          run: () => {
            set.buttons[i] = blank();
            this.renderEditor();
          },
        }),
      );
    });

    // その他の文言
    const others = el('div', 'phrase-others');
    others.append(el('div', 'ai-setting-title', `その他の文言（${draft.others.length} / ${MAX_OTHERS}）`));
    draft.others.forEach((p, i) => {
      others.append(
        this.row(p, '・', 'phrase-other', {
          label: '消す',
          run: () => {
            draft.others.splice(i, 1);
            this.renderEditor();
          },
        }),
      );
    });
    const addOther = el('button', 'ai-small', '＋ 文言を足す');
    addOther.disabled = draft.others.length >= MAX_OTHERS;
    addOther.addEventListener('click', () => {
      draft.others.push(blank());
      this.renderEditor();
      const rows = this.editor.querySelectorAll<HTMLTextAreaElement>('.phrase-other .phrase-text');
      rows[rows.length - 1]?.focus();
    });
    others.append(addOther);

    const foot = el('div', 'phrase-editor-foot');
    const save = el('button', 'ai-small primary', '保存');
    save.addEventListener('click', () => this.commit());
    const cancel = el('button', 'ai-small', 'やめる');
    cancel.addEventListener('click', () => this.closeEditor());
    foot.append(
      el('span', 'phrase-editor-note', '表示名が空なら文言の頭を使う。文言の無いボタンは空きになる'),
      cancel,
      save,
    );

    const body = el('div', 'phrase-editor-body');
    body.append(setRow, el('div', 'ai-setting-title', `「${set.name || '（名前なし）'}」の6つのボタン（Alt+1〜6）`), slots, others);
    this.editor.replaceChildren(head, body, foot);
  }

  // 1つの文言の欄：表示名・種類・ページを添える・文言
  private row(p: Draft, mark: string, className: string, action: { label: string; run: () => void }) {
    const row = el('div', `phrase-row ${className}`);
    const top = el('div', 'phrase-row-top');
    const num = el('span', 'phrase-num', mark);
    const label = el('input', 'phrase-label');
    label.value = p.label;
    label.maxLength = LABEL_MAX;
    label.placeholder = '表示名';
    label.setAttribute('aria-label', '表示名');
    label.addEventListener('input', () => (p.label = label.value));
    const kind = el('select', 'phrase-kind');
    kind.setAttribute('aria-label', '押したときにすること');
    for (const k of KIND_ORDER) {
      const option = el('option', '', KIND_SHORT[k]);
      option.title = KIND_LABELS[k];
      option.value = k;
      option.selected = k === p.kind;
      kind.append(option);
    }
    const pageLabel = el('label', 'ai-check phrase-page');
    const page = el('input');
    page.type = 'checkbox';
    page.checked = p.page;
    page.addEventListener('change', () => (p.page = page.checked));
    pageLabel.append(page, document.createTextNode('ページを添える'));
    const act = el('button', 'ai-small', action.label);
    act.addEventListener('click', action.run);
    top.append(num, label, kind, act);
    const text = el('textarea', 'phrase-text');
    text.value = p.text;
    text.maxLength = TEXT_MAX;
    text.rows = 2;
    text.setAttribute('aria-label', '文言');
    text.addEventListener('input', () => (p.text = text.value));
    const sync = () => {
      const fixed = isFixed(p.kind);
      text.hidden = fixed;
      pageLabel.hidden = p.kind !== 'send';
      text.placeholder = p.kind === 'fill' ? '入力欄に入れる文言（続きを書いてから送る）' : '相棒に送る文言';
      label.placeholder = fixed ? KIND_LABELS[p.kind] : '表示名（空なら文言の頭）';
    };
    kind.addEventListener('change', () => {
      p.kind = kind.value as PhraseKind;
      sync();
    });
    sync();
    row.append(top, text, pageLabel);
    return row;
  }

  private commit() {
    const draft = this.draft;
    if (!draft) return;
    const book = normalizeBook({ version: 1, current: draft.current, sets: draft.sets, others: draft.others });
    this.closeEditor();
    void this.save(book);
  }
}

function shortKind(p: Phrase) {
  if (p.kind === 'fill') return '入力欄へ';
  if (p.kind === 'send') return p.page ? 'ページつき' : '';
  return KIND_LABELS[p.kind];
}

function hintOf(p: Phrase) {
  if (p.kind === 'send') return `${p.text}${p.page ? '（このページを添える）' : ''}`;
  if (p.kind === 'fill') return `入力欄に入れる：${p.text}`;
  return KIND_LABELS[p.kind];
}

