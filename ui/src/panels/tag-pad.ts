// タグの欄：付いているタグ（× で外す・「＋タグ」で書いて付ける）と、その下のタグのボタン
//   上の行：たたむ ▾・セットの切り替え・その他のタグ・編集 ✎　下：6つのボタン（3つ × 2段。押すと付ける・もう一度押すと外す）
//   ・空いたボタン（＋）を押すと、そこに登録するタグを選ぶ。ボタンを右クリックすると、並べ替え・替える・外す
//   ・「その他 ▾」：6つに入っていないタグ（使っている数の多い順・六角メモのタグ）。付ける・外す・ボタンへ登録
//   ・カード（拡大表示）・右の「メモ」の区画の「選んだコメントのタグ」で使う。ボタンとセットは左右のサイドバーで別々（tagbuttons.ts）
import { isMachineTag } from '../grok-cards-tags';
import { MAX_TAGS_PER_TAB, normalizeTag, registeredTagNames, tagColor } from '../tags';
import { type PinnedSource, TAG_BUTTONS, type TagButtonSet, type TagButtonStore } from '../tagbuttons';
import { el } from '../util';
import type { CellMenu, MenuButton, MenuEntry } from './cell-menu';

export interface TagUse {
  tag: string;
  count: number; // 付いているタブ・メモのセルの数
}

export interface TagPadHost {
  store: TagButtonStore;
  menu: CellMenu;
  side: string; // 「左サイドバー」「右サイドバー」（左右で別々のボタンだと分かるように、メニューに出す）
  used(): TagUse[]; // 使っているタグ（タブ・メモのセル）
  toast(text: string): void;
}

// タグを付ける相手（タブ・メモのセル）
export interface TagTarget {
  tags: readonly string[]; // 今付いているタグ（描いたときの写し）
  change(add: string[], remove: string[]): void; // 足す・外す（持ち主の台帳の、その時のタグに対して）
  what: string; // 「このタブ」「このメモ」のように呼ぶ名前（タブ・メモ・コメント）
}

type Point = { x: number; y: number };

const MORE_MAX = 60; // 「その他」に出すタグの数
const CHOICE_MAX = 30; // 空いたボタンに登録するとき、よく使うタグ・六角メモのタグから出す数

export class TagPad {
  private readonly listeners: (() => void)[] = [];
  private folded: boolean;
  private editor: { panel: HTMLElement; setId: string; back?: string } | null = null; // 編集の欄（どのセットを、どのボタンから開いたか）

  constructor(private readonly host: TagPadHost) {
    this.folded = loadFolded(host.store.side);
    host.store.onChange(() => {
      // 編集しているセットが消えたら、欄を閉じる（ほかのセットに書いてしまわないように）
      if (this.editor && !host.store.sets.some((s) => s.id === this.editor?.setId)) this.closeEditor();
      this.emit();
    });
    host.store.onSaveFailed(() => host.toast('タグのボタンを保存できませんでした（もう一度変えると、また保存します）'));
  }

  // ボタン・セット・たたみ具合が変わった（カードやコメントを描き直す）
  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  // 変わったかどうかを見る印
  get key() {
    return `${this.host.store.key}|${this.folded ? 1 : 0}`;
  }

  // タグのボタンの区画（focusKey：描き直した後にキーボードの位置を戻すための頭の文字）
  block(target: TagTarget, focusKey = ''): HTMLElement {
    const store = this.host.store;
    const set = store.current;
    const tags = [...target.tags]; // 押した後、写しが届くまでの間もボタンの印が合うように
    const box = el('div', this.folded ? 'tag-pad folded' : 'tag-pad');

    const top = el('div', 'tag-pad-top');
    const fold = el('button', 'tag-pad-fold', this.folded ? '▸' : '▾');
    fold.type = 'button';
    fold.title = this.folded ? 'タグのボタンを出す' : 'タグのボタンをたたむ';
    fold.setAttribute('aria-label', fold.title);
    fold.setAttribute('aria-expanded', String(!this.folded));
    fold.dataset.focusKey = `${focusKey}tagfold`;
    fold.addEventListener('click', () => this.setFolded(!this.folded));
    const setButton = el('button', 'tag-pad-set');
    setButton.type = 'button';
    setButton.append(el('span', 'tag-pad-set-name', set.name), el('span', 'tag-pad-arrow', '▾'));
    setButton.title = `${this.host.side}のタグのボタンのセット「${set.name}」（押すと切り替え・新しいセット・名前・消す）`;
    setButton.setAttribute('aria-label', `タグのボタンのセット「${set.name}」`);
    setButton.setAttribute('aria-haspopup', 'menu');
    setButton.setAttribute('aria-expanded', 'false');
    setButton.dataset.focusKey = `${focusKey}tagset`;
    setButton.addEventListener('click', (e) => this.openSets(setButton, e.detail === 0));
    const more = el('button', 'tag-pad-more', 'その他 ▾');
    more.type = 'button';
    more.title = '6つのボタンに入っていないタグ（付ける・外す・ボタンに登録。名前を書けば、どのタグでも）';
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', 'false');
    more.dataset.focusKey = `${focusKey}tagmore`;
    more.addEventListener('click', (e) => this.openMore(more, target, tags, e.detail === 0));
    const edit = el('button', 'tag-pad-edit', '✎');
    edit.type = 'button';
    edit.title = 'タグのボタンを編集（6つのタグ・並び・セットの名前）';
    edit.setAttribute('aria-label', 'タグのボタンを編集');
    edit.dataset.focusKey = `${focusKey}tagedit`;
    edit.addEventListener('click', () => this.openEditor(edit.getBoundingClientRect(), edit.dataset.focusKey));
    top.append(fold, el('span', 'tag-pad-label', 'タグのボタン'), setButton, el('span', 'tag-pad-gap'), more, edit);
    box.append(top);
    if (this.folded) return box;

    const grid = el('div', 'tag-pad-grid');
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', `タグのボタン（${set.name}）`);
    set.tags.forEach((tag, i) => {
      if (tag) {
        const b = el('button', 'tag-pad-button');
        b.type = 'button';
        b.append(el('span', 'tag-pad-name', tag));
        b.style.setProperty('--tag', tagColor(tag));
        b.dataset.focusKey = `${focusKey}tagbtn:${i}`;
        const mark = () => {
          const has = tags.includes(tag);
          b.setAttribute('aria-pressed', String(has));
          b.title = `${has ? `${target.what}から外す` : `${target.what}に付ける`}：#${tag}（右クリックで並べ替え・替える・ボタンから外す）`;
        };
        mark();
        b.addEventListener('click', () => {
          this.toggle(target, tags, tag);
          mark();
        });
        b.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation(); // コメント・盤面の右クリックのメニューを出さない
          const at = keyboardMenu(e) ? cornerOf(b) : { x: e.clientX, y: e.clientY };
          this.openSlot(i, at, target, tags, keyboardMenu(e));
        });
        grid.append(b);
      } else {
        const b = el('button', 'tag-pad-button empty', '＋');
        b.type = 'button';
        b.title = `空き（押すと、ボタン ${i + 1} に登録するタグを選ぶ）`;
        b.setAttribute('aria-label', `空きのボタン ${i + 1}（押すと、登録するタグを選ぶ）`);
        b.setAttribute('aria-haspopup', 'menu');
        b.dataset.focusKey = `${focusKey}tagbtn:${i}`;
        b.addEventListener('click', (e) => this.openChooser(i, cornerOf(b), target, tags, e.detail === 0));
        b.addEventListener('contextmenu', (e) => e.stopPropagation()); // 空きでも、ほかの右クリックのメニューは出さない
        grid.append(b);
      }
    });
    box.append(grid);
    box.addEventListener('contextmenu', (e) => e.stopPropagation()); // 上の行の上でも、コメント・盤面のメニューは出さない
    return box;
  }

  // 付ける・外す（tags は区画の写し。押したらすぐ書き換える）
  toggle(target: TagTarget, tags: string[], tag: string) {
    const at = tags.indexOf(tag);
    if (at >= 0) {
      tags.splice(at, 1);
      target.change([], [tag]);
      return;
    }
    if (tags.length >= MAX_TAGS_PER_TAB) {
      this.host.toast(`タグは1つに ${MAX_TAGS_PER_TAB} 個までです（ほかのタグを外してから付けてください）`);
      return;
    }
    tags.push(tag);
    target.change([tag], []);
  }

  private setFolded(folded: boolean) {
    this.folded = folded;
    saveFolded(this.host.store.side, folded);
    this.emit();
  }

  // ---------- メニュー（開くときは、編集の欄を閉じる：欄の下にメニューが隠れたり、ほかのセットに書いたりしないように） ----------

  // セットの切り替え・新しいセット・複製・名前・消す・編集
  private openSets(anchor: HTMLElement, keyboard: boolean) {
    this.closeEditor();
    const { store, menu } = this.host;
    const current = store.current;
    const at = cornerOf(anchor);
    const rect = anchor.getBoundingClientRect(); // メニューを開いている間に、カードが描き直されることがある
    const back = anchor.dataset.focusKey;
    const entries: MenuEntry[] = [{ section: `タグのボタンのセット（${this.host.side}）` }];
    for (const set of store.sets) {
      const names = set.tags.filter((t): t is string => !!t);
      entries.push({ label: `${set.id === current.id ? '✓' : '　'} ${set.name}`, hint: names.slice(0, 3).join('・') || '空き', run: () => store.setCurrent(set.id) });
    }
    entries.push('sep');
    entries.push({
      label: '＋ 新しいセット…',
      disabled: !store.canAddSet,
      run: () =>
        menu.prompt(
          '新しいセットの名前',
          `セット${store.sets.length + 1}`,
          (name) => {
            const set = store.addSet(name);
            if (set) this.host.toast(`セット「${set.name}」を作りました。空いたボタン（＋）を押すと、タグを登録できます`);
          },
          at,
        ),
    });
    entries.push({
      label: 'このセットを複製…',
      disabled: !store.canAddSet,
      run: () =>
        menu.prompt(
          '複製したセットの名前',
          `${current.name}のコピー`,
          (name) => {
            const set = store.addSet(name, current.tags);
            if (set) this.host.toast(`「${current.name}」を複製して、「${set.name}」にしました`);
          },
          at,
        ),
    });
    entries.push({ label: 'このセットの名前を変える…', run: () => menu.prompt('セットの名前', current.name, (name) => store.renameSet(current.id, name), at) });
    if (store.sets.length > 1) {
      entries.push({
        row: `「${current.name}」を消す`,
        buttons: [
          {
            label: '消す',
            confirm: '本当に消す',
            aria: `セット「${current.name}」を消す（2回押す）`,
            run: () => {
              menu.close();
              store.removeSet(current.id);
              this.host.toast(`セット「${current.name}」を消しました（付けたタグはそのままです）`);
            },
          },
        ],
      });
    } else {
      entries.push({ label: 'このセットを消す（最後の1つは消せません）', disabled: true });
    }
    if (!store.canAddSet) entries.push({ label: 'セットは 12 個までです', disabled: true });
    entries.push('sep', { label: '✎ ボタンを編集…', run: () => this.openEditor(anchor.isConnected ? anchor.getBoundingClientRect() : rect, back) });
    menu.open(at.x, at.y, entries);
    if (keyboard) menu.focusFirst();
  }

  // 6つに入っていないタグ：付ける・外す・ボタンへ登録。いちばん上で、名前を書いて付ける（一覧に無いタグも）
  private openMore(anchor: HTMLElement, target: TagTarget, tags: string[], keyboard: boolean) {
    this.closeEditor();
    const { store, menu } = this.host;
    const at = cornerOf(anchor);
    const inButtons = new Set(store.current.tags.filter((t): t is string => !!t));
    const all = this.known(tags).filter((u) => !inButtons.has(u.tag));
    const shown = all.slice(0, MORE_MAX);
    const entries: MenuEntry[] = [{ section: `その他のタグ（${target.what}に付ける・外す）` }];
    entries.push({
      label: '＋ タグの名前を書いて付ける…',
      hint: '新しいタグも',
      run: () =>
        menu.prompt(
          '付けるタグの名前（# と空白は入りません）',
          '',
          (value) => {
            const tag = normalizeTag(value);
            if (!tag) return;
            if (tags.includes(tag)) {
              this.host.toast(`「${tag}」はもう付いています`);
              return;
            }
            this.toggle(target, tags, tag);
          },
          at,
        ),
    });
    if (shown.length === 0) entries.push({ label: 'ほかのタグはまだありません', disabled: true });
    else entries.push('sep');
    for (const use of shown) {
      const tag = use.tag;
      const row = { row: '', hint: use.count > 0 ? String(use.count) : '六角メモ', buttons: [] as MenuButton[] };
      const toggle: MenuButton = { label: '', run: () => undefined };
      const label = () => {
        const has = tags.includes(tag);
        row.row = `${has ? '✓ ' : ''}#${tag}`;
        toggle.label = has ? '外す' : '付ける';
        toggle.aria = has ? `#${tag} を${target.what}から外す` : `#${tag} を${target.what}に付ける`;
      };
      toggle.run = () => {
        this.toggle(target, tags, tag);
        label();
        menu.refresh();
      };
      label();
      row.buttons.push(toggle, {
        label: 'ボタンへ',
        aria: `#${tag} を空いたボタンに登録する`,
        run: () => {
          menu.close();
          const slot = store.firstEmpty();
          if (slot < 0) {
            this.host.toast('ボタンに空きがありません。ボタンを右クリック →「ボタンから外す」か、✎ で入れ替えてください');
            return;
          }
          store.assign(slot, tag);
          this.host.toast(`「${tag}」をボタン ${slot + 1} に登録しました（セット「${store.current.name}」）`);
        },
      });
      entries.push(row);
    }
    if (all.length > shown.length) entries.push({ label: `ほか ${all.length - shown.length} 個（多い順に ${MORE_MAX} 個まで。ほかは名前を書いて付けられます）`, disabled: true });
    menu.open(at.x, at.y, entries);
    if (keyboard) menu.focusFirst();
  }

  // 空いたボタン（や「別のタグに替える」）：そのボタンに登録するタグを選ぶ
  private openChooser(slot: number, at: Point, target: TagTarget, tags: string[], keyboard: boolean) {
    this.closeEditor();
    const { store, menu } = this.host;
    const inButtons = new Set(store.current.tags.filter((t): t is string => !!t));
    const entries: MenuEntry[] = [{ section: `ボタン ${slot + 1} に登録するタグ` }];
    entries.push({
      label: '＋ タグの名前を書く…',
      hint: '新しいタグも',
      run: () =>
        menu.prompt(
          `ボタン ${slot + 1} に登録するタグの名前`,
          '',
          (value) => {
            const tag = normalizeTag(value);
            if (tag) store.assign(slot, tag);
          },
          at,
        ),
    });
    const own = tags.filter((t) => !inButtons.has(t));
    if (own.length > 0) {
      entries.push({ section: `${target.what}のタグ` });
      for (const tag of own) entries.push({ label: `#${tag}`, run: () => store.assign(slot, tag) });
    }
    const usedAll = this.host.used().filter((u) => !inButtons.has(u.tag) && !own.includes(u.tag));
    const used = usedAll.slice(0, CHOICE_MAX);
    if (used.length > 0) {
      entries.push({ section: 'よく使うタグ' });
      for (const u of used) entries.push({ label: `#${u.tag}`, hint: String(u.count), run: () => store.assign(slot, u.tag) });
    }
    const listed = new Set([...own, ...usedAll.map((u) => u.tag)]);
    const hexAll = registeredTagNames().filter((t) => !inButtons.has(t) && !listed.has(t));
    const hex = hexAll.slice(0, CHOICE_MAX);
    if (hex.length > 0) {
      entries.push({ section: '六角メモのタグ' });
      for (const tag of hex) entries.push({ label: `#${tag}`, run: () => store.assign(slot, tag) });
    }
    const hidden = usedAll.length - used.length + hexAll.length - hex.length;
    if (hidden > 0) entries.push({ label: `ほか ${hidden} 個（いちばん上で名前を書けば、どのタグでも登録できます）`, disabled: true });
    menu.open(at.x, at.y, entries);
    if (keyboard) menu.focusFirst();
  }

  // ボタンを右クリック：付ける・外す・並べ替え・替える・ボタンから外す
  private openSlot(slot: number, at: Point, target: TagTarget, tags: string[], keyboard: boolean) {
    this.closeEditor();
    const { store, menu } = this.host;
    const tag = store.current.tags[slot];
    if (!tag) return;
    const has = tags.includes(tag);
    const entries: MenuEntry[] = [
      { section: `ボタン ${slot + 1}：#${tag}` },
      { label: has ? `${target.what}から外す` : `${target.what}に付ける`, run: () => this.toggle(target, tags, tag) },
      'sep',
      { label: '← 前へ', disabled: slot === 0, run: () => store.swap(slot, slot - 1) },
      { label: '後ろへ →', disabled: slot === TAG_BUTTONS - 1, run: () => store.swap(slot, slot + 1) },
      { label: '別のタグに替える…', run: () => this.openChooser(slot, at, target, tags, keyboard) },
      { label: 'ボタンから外す（付けたタグはそのまま）', run: () => store.clear(slot) },
    ];
    menu.open(at.x, at.y, entries);
    if (keyboard) menu.focusFirst();
  }

  // 選べるタグ：付いているもの → 使っている数の多い順 → 六角メモのタグ
  private known(tags: readonly string[]): TagUse[] {
    const counts = new Map<string, number>();
    for (const u of this.host.used()) counts.set(u.tag, u.count);
    const out: TagUse[] = [];
    const seen = new Set<string>();
    const push = (tag: string) => {
      if (seen.has(tag) || isMachineTag(tag)) return;
      seen.add(tag);
      out.push({ tag, count: counts.get(tag) ?? 0 });
    };
    for (const tag of tags) push(tag);
    for (const u of [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))) push(u[0]);
    for (const tag of registeredTagNames()) push(tag);
    return out;
  }

  // ---------- 編集の欄（✎） ----------
  //   開いたときのセットに書く。back：閉じたら、キーボードの位置を戻すボタン（描き直されていても、印で探す）

  private openEditor(anchor: DOMRect, back?: string) {
    this.closeEditor();
    this.host.menu.close();
    const store = this.host.store;
    const set: TagButtonSet = store.current;
    const panel = el('div', 'tag-pad-editor');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', `タグのボタンを編集（${this.host.side}・セット「${set.name}」）`);
    const head = el('div', 'tag-pad-editor-head');
    const close = el('button', 'tag-pad-editor-x', '×');
    close.type = 'button';
    close.title = 'やめる（Esc）';
    close.setAttribute('aria-label', 'やめる');
    close.addEventListener('click', () => this.closeEditor());
    head.append(el('span', 'tag-pad-editor-title', `タグのボタンを編集（${this.host.side}）`), close);

    const listId = `tag-pad-known-${store.side}`;
    const known = el('datalist');
    known.id = listId;
    for (const u of this.known([])) {
      const option = el('option');
      option.value = u.tag;
      known.append(option);
    }

    const nameRow = el('label', 'tag-pad-editor-name');
    const name = el('input');
    name.maxLength = 20;
    name.value = set.name;
    name.setAttribute('aria-label', 'セットの名前');
    nameRow.append(el('span', '', 'セットの名前'), name);

    const inputs: HTMLInputElement[] = [];
    const rows = el('div', 'tag-pad-editor-rows');
    for (let i = 0; i < TAG_BUTTONS; i++) {
      const row = el('div', 'tag-pad-editor-row');
      const input = el('input');
      input.value = set.tags[i] ?? '';
      input.maxLength = 30;
      input.placeholder = '（空き）';
      input.setAttribute('list', listId);
      input.setAttribute('aria-label', `ボタン ${i + 1} のタグ`);
      inputs.push(input);
      const swapWith = (j: number) => {
        const other = inputs[j];
        if (!other) return;
        [input.value, other.value] = [other.value, input.value];
        other.focus();
      };
      const up = smallButton('↑', `ボタン ${i + 1} を前へ`, () => swapWith(i - 1));
      up.disabled = i === 0;
      const down = smallButton('↓', `ボタン ${i + 1} を後ろへ`, () => swapWith(i + 1));
      down.disabled = i === TAG_BUTTONS - 1;
      const clear = smallButton('空に', `ボタン ${i + 1} を空きにする`, () => {
        input.value = '';
        input.focus();
      });
      row.append(el('span', 'tag-pad-editor-num', String(i + 1)), input, up, down, clear);
      rows.append(row);
    }

    const note = el('div', 'tag-pad-editor-note', '# と空白は入りません。同じタグは1つにまとめます。空きのボタンは「＋」になります（付けたタグは変わりません）。Ctrl+Enter で保存');
    const foot = el('div', 'tag-pad-editor-foot');
    const cancel = smallButton('やめる', 'やめる（Esc）', () => this.closeEditor());
    const save = el('button', 'tag-pad-editor-save primary', '保存');
    save.type = 'button';
    save.addEventListener('click', () => {
      const changed = store.replaceSet(set.id, { name: name.value, tags: inputs.map((x) => normalizeTag(x.value) || null) });
      this.closeEditor();
      const saved = store.sets.find((s) => s.id === set.id);
      if (!saved) this.host.toast('編集していたセットが無くなったので、書き直せませんでした');
      else if (changed) this.host.toast(`セット「${saved.name}」のタグのボタンを書き直しました`);
    });
    foot.append(cancel, save);
    panel.append(head, known, nameRow, rows, note, foot);
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.closeEditor();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
        e.preventDefault();
        save.click();
      }
    });
    document.body.append(panel);
    this.editor = { panel, setId: set.id, back };
    // 押したボタンの近く（画面からはみ出さないように）
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const x = Math.max(6, Math.min(anchor.right - width, window.innerWidth - width - 6));
    const below = anchor.bottom + 4;
    const y = below + height <= window.innerHeight - 6 ? below : Math.max(6, anchor.top - height - 4);
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
    inputs[Math.max(0, set.tags.indexOf(null))]?.focus();
  }

  private closeEditor() {
    const editor = this.editor;
    if (!editor) return;
    this.editor = null;
    const inside = editor.panel.contains(document.activeElement);
    editor.panel.remove();
    // キーボードで使っていたら、✎ に戻す（保存で描き直されていても、印で探す）
    if (inside && editor.back) document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(editor.back)}"]`)?.focus({ preventScroll: true });
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

let candidateSeq = 0; // 「＋タグ」の候補（datalist・候補の欄）の id を一意にする数

// タグの欄（付いているタグと「＋タグ」。pad があれば、その下にタグのボタン）
//   editable でなければ、タグを見せるだけ（ポップアップの小さいカード・右のコメントの一覧）
//   candidates：「＋タグ」の書く欄に出す候補（無ければ出さない）／onClose：書く欄を閉じた（付けた・やめた・ほかを押した）あと
//   pinned：登録したタグの写し（下の区画のカードだけ）。渡したときは datalist の代わりに候補の欄（登録したタグ → 区切り → その他）を出す
export function tagArea(
  target: TagTarget,
  o: { editable: boolean; pad?: TagPad; focusKey?: string; toast?: (text: string) => void; candidates?: readonly string[]; pinned?: PinnedSource; onClose?: () => void },
): HTMLElement {
  const area = el('div', 'tag-area');
  const row = el('div', 'preview-tags');
  for (const tag of target.tags) {
    if (isMachineTag(tag)) continue;
    const chip = el('span', 'tag-chip', tag);
    chip.style.setProperty('--tag', tagColor(tag));
    chip.title = `#${tag}`;
    if (o.editable) {
      const remove = el('button', 'tag-remove', '×');
      remove.type = 'button';
      remove.title = `タグ「${tag}」を外す`;
      remove.setAttribute('aria-label', `タグ「${tag}」を外す`);
      remove.dataset.focusKey = `${o.focusKey ?? ''}tagx:${tag}`;
      remove.addEventListener('click', () => target.change([], [tag]));
      chip.append(remove);
    }
    row.append(chip);
  }
  if (o.editable) {
    const add = el('button', 'tag-add', '＋タグ');
    add.type = 'button';
    add.dataset.focusKey = `${o.focusKey ?? ''}tagadd`;
    add.addEventListener('click', () => {
      const input = el('input', 'preview-tag-input');
      input.placeholder = 'タグ（Enter で付ける）';
      input.maxLength = 30;
      input.setAttribute('aria-label', `${target.what}に付けるタグ（Enter で付ける）`);
      // 候補（今付いているタグは除く）。datalist は書く欄の直後に置き、閉じるときに一緒に外す（pinned があるときは datalist を作らず、候補の欄）
      const options = (o.candidates ?? []).filter((c) => !target.tags.includes(c));
      let list: HTMLDataListElement | null = null;
      if (!o.pinned && options.length > 0) {
        list = el('datalist');
        list.id = `tag-candidates-${++candidateSeq}`;
        for (const value of options) {
          const option = el('option');
          option.value = value;
          list.append(option);
        }
        input.setAttribute('list', list.id);
      }
      let done = false;
      let cand: CandidateBox | null = null; // 候補の欄（pinned があるときだけ）
      // 書く欄を「＋タグ」に戻す（keyboard：Enter・Esc で終えたら、「＋タグ」にキーボードの位置を置く）
      const finish = (tag: string | null, keyboard: boolean) => {
        if (done) return;
        done = true;
        cand?.close(); // 登録したタグの写しの見張りを止める（1 回だけ）
        const shown: HTMLElement = cand ? cand.wrap : input;
        if (shown.isConnected) shown.replaceWith(add);
        list?.remove();
        if (keyboard) add.focus({ preventScroll: true });
        if (tag) target.change([tag], []); // 書く欄を閉じてから（書いている間はカードを描き直さないので）
        o.onClose?.();
      };
      // 付ける（Enter・候補を押す）。上限なら知らせて閉じる。もう付いているタグは付けない（今までどおり）
      const choose = (value: string) => {
        const tag = normalizeTag(value);
        if (tag && !target.tags.includes(tag) && target.tags.length >= MAX_TAGS_PER_TAB) {
          o.toast?.(`タグは1つに ${MAX_TAGS_PER_TAB} 個までです（ほかのタグを外してから付けてください）`);
          finish(null, true);
          return;
        }
        finish(tag && !target.tags.includes(tag) ? tag : null, true);
      };
      input.addEventListener('keydown', (e) => {
        if (e.isComposing) return;
        if (cand && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
          e.preventDefault();
          cand.move(e.key === 'ArrowDown' ? 1 : -1);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          choose(cand?.active() ?? input.value); // 選んだ項目があれば、そのタグで付ける
        } else if (e.key === 'Escape') {
          e.stopPropagation();
          finish(null, true);
        }
      });
      input.addEventListener('input', () => cand?.filter());
      input.addEventListener('blur', () => finish(null, false));
      if (o.pinned) {
        cand = candidateBox(input, target, o.pinned, options, choose);
        add.replaceWith(cand.wrap);
        cand.open();
      } else {
        add.replaceWith(input);
        if (list) input.after(list);
      }
      input.focus();
    });
    row.append(add);
  }
  area.append(row);
  if (o.editable && o.pad) area.append(o.pad.block(target, o.focusKey));
  return area;
}

// 「＋タグ」の候補の欄（pinned が渡されたとき）：書く欄と候補の欄を包む。上から「登録したタグ」（セット名つき）・横線・「その他」
//   字で絞る・↑↓で選ぶ・押して選ぶ（押したら choose で付ける）。開いている間だけ、登録したタグの写しを見張る（close で止める）
interface CandidateBox {
  wrap: HTMLElement; // 書く欄と候補の欄の包み（「＋タグ」の代わりに入れる）
  open(): void; // 包みを入れたあとに呼ぶ：見張りを始め、描き、置き場所を決める
  close(): void; // 閉じるとき 1 回（見張りを止める）
  filter(): void; // 書く欄の字が変わった（絞り直す）
  move(step: 1 | -1): void; // ↓（1）・↑（-1）で選ぶ項目を動かす
  active(): string | null; // 選んでいる項目のタグ（選んでいなければ null）
}

function candidateBox(input: HTMLInputElement, target: TagTarget, pinned: PinnedSource, options: readonly string[], choose: (value: string) => void): CandidateBox {
  const panel = el('div', 'tag-candidates');
  panel.id = `tag-candidates-${++candidateSeq}`;
  panel.setAttribute('role', 'listbox');
  panel.setAttribute('aria-label', 'タグの候補');
  const wrap = el('span', 'tag-candidates-wrap');
  wrap.append(input, panel);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', panel.id);
  // 候補の欄を押しても、書く欄の焦点は残す（書く欄の blur で閉じないように）
  panel.addEventListener('mousedown', (e) => e.preventDefault());

  const capNote = `タグは ${MAX_TAGS_PER_TAB} 個までです（ほかのタグを外してから付けてください）`;
  let active: string | null = null; // 選んでいる項目のタグ（描き直しても、同じタグが見えていれば残す）
  let seq = 0; // 項目の id の数
  let closed = false;
  let stop: () => void = () => undefined;

  const note = (text: string) => {
    const n = el('div', 'tag-candidates-note', text);
    n.setAttribute('role', 'presentation');
    return n;
  };
  const head = (text: string, id: string) => {
    const h = el('div', 'tag-candidates-head', text);
    h.id = id;
    h.setAttribute('role', 'presentation');
    return h;
  };
  const group = (cls: string, labelledBy: string) => {
    const g = el('div', cls);
    g.setAttribute('role', 'group');
    g.setAttribute('aria-labelledby', labelledBy);
    return g;
  };
  // 項目（押せないものは disabled と aria-disabled）
  const item = (tag: string, cls: string, disabled: boolean, title: string, text: string) => {
    const b = el('button', cls, text);
    b.type = 'button';
    b.id = `${panel.id}-${seq++}`;
    b.dataset.tag = tag;
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', 'false');
    b.title = title;
    b.style.setProperty('--tag', tagColor(tag));
    b.disabled = disabled;
    if (disabled) b.setAttribute('aria-disabled', 'true');
    b.addEventListener('click', () => choose(tag));
    return b;
  };
  const enabledItems = () => [...panel.querySelectorAll<HTMLButtonElement>('button.tag-candidate')].filter((b) => !b.disabled);

  // 選んでいる項目の印（class・aria-selected・書く欄の aria-activedescendant）。見えない・押せない項目は選んでいないことにする
  const syncActive = (scroll: boolean) => {
    const hit = enabledItems().find((b) => b.dataset.tag === active);
    if (!hit) active = null;
    for (const b of panel.querySelectorAll<HTMLButtonElement>('button.tag-candidate')) {
      const on = b === hit;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    }
    if (hit) {
      input.setAttribute('aria-activedescendant', hit.id);
      if (scroll) hit.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };

  // 中身を作り直す：字で絞る・上限・付いている印・登録したタグ（写し）。選んでいる項目は、同じタグが見えていれば残す
  const render = () => {
    const query = normalizeTag(input.value).toLowerCase();
    const matches = (tag: string) => tag.toLowerCase().includes(query);
    const data = pinned.get();
    const pinnedAll = data?.tags ?? [];
    const pinnedShown = pinnedAll.filter(matches);
    const restShown = options.filter((tag) => !pinnedAll.includes(tag) && matches(tag));
    const capped = target.tags.length >= MAX_TAGS_PER_TAB;
    const nodes: HTMLElement[] = [];
    if (capped) nodes.push(note(capNote));
    if (!data) nodes.push(note('登録したタグはありません（右サイドバーのタグのボタンの ✎ で登録できます）'));
    if (data && pinnedShown.length > 0) {
      const headId = `${panel.id}-pinned`;
      const row = group('tag-candidates-pinned', headId);
      for (const tag of pinnedShown) {
        const has = target.tags.includes(tag);
        const title = has ? 'このカードに付いています' : capped ? capNote : `#${tag} を${target.what}に付ける`;
        row.append(item(tag, 'tag-candidate pinned', has || capped, title, has ? `✓ ${tag}` : tag));
      }
      nodes.push(head(`登録したタグ（セット「${data.setName}」・右サイドバー）`, headId), row);
    }
    if (data && pinnedShown.length > 0 && restShown.length > 0) {
      const sep = el('div', 'tag-candidates-sep');
      sep.setAttribute('role', 'presentation');
      nodes.push(sep);
    }
    if (restShown.length > 0) {
      const headId = `${panel.id}-rest`;
      const rows = group('tag-candidates-rest', headId);
      for (const tag of restShown) rows.append(item(tag, 'tag-candidate', capped, capped ? capNote : `#${tag} を${target.what}に付ける`, tag));
      nodes.push(head('その他（このメモのカード・メモ・六角メモ）', headId), rows);
    }
    if (pinnedShown.length + restShown.length === 0) nodes.push(note(query ? '書いた字で付けます（新しいタグ）' : '候補はまだありません（書いた字で付けます）'));
    panel.replaceChildren(...nodes);
    syncActive(false);
  };

  // ↓（1）：次の項目（いちばん上は最初の項目）。↑（-1）：前の項目（いちばん上の次で「選んでいない」に戻る）。端で止まる
  const move = (step: 1 | -1) => {
    const list = enabledItems();
    if (list.length === 0) return;
    const at = list.findIndex((b) => b.dataset.tag === active);
    if (step > 0) active = list[at < 0 ? 0 : Math.min(at + 1, list.length - 1)].dataset.tag ?? null;
    else if (at >= 0) active = at === 0 ? null : (list[at - 1].dataset.tag ?? null);
    syncActive(true);
  };

  // 置き場所：書く欄の下に 230px 入るか、上の空きが下の空き以上なら下に開く。高さは開く側の空きに合わせる（60〜230px）
  const place = () => {
    const edge = visibleEdge(input);
    const r = input.getBoundingClientRect();
    const below = edge.bottom - r.bottom - 6;
    const above = r.top - edge.top - 6;
    const down = below >= 230 || below >= above;
    panel.classList.toggle('up', !down);
    panel.style.maxHeight = `${Math.max(60, Math.min(230, down ? below : above))}px`;
  };

  return {
    wrap,
    open() {
      // 登録したタグが変わったら、作り直して置き場所も決め直す（閉じたあとに届いた写しは無視する）
      stop = pinned.watch(() => {
        if (closed) return;
        render();
        place();
      });
      render();
      place();
    },
    close() {
      if (closed) return;
      closed = true;
      stop();
    },
    filter: render,
    move,
    active: () => active,
  };
}

// 書く欄に近いスクロールする親（overflow-y が auto か scroll）の見えている範囲。無ければ窓
function visibleEdge(node: HTMLElement): { top: number; bottom: number } {
  for (let p = node.parentElement; p; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') {
      const r = p.getBoundingClientRect();
      return { top: Math.max(0, r.top), bottom: Math.min(window.innerHeight, r.bottom) };
    }
  }
  return { top: 0, bottom: window.innerHeight };
}

function smallButton(label: string, title: string, run: () => void) {
  const b = el('button', 'tag-pad-small', label);
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', run);
  return b;
}

// キーボード（メニューキー・Shift+F10）で開いたメニューか（マウスの位置が無い）
function keyboardMenu(e: MouseEvent) {
  return (e instanceof PointerEvent && e.pointerType === '') || (e.clientX === 0 && e.clientY === 0) || e.button === -1;
}

// メニューを出す場所（その要素の左下）
function cornerOf(node: Element): Point {
  const r = node.getBoundingClientRect();
  return { x: r.left, y: r.bottom + 2 };
}

function loadFolded(side: string): boolean {
  try {
    return localStorage.getItem(`honeycomb.tagPad.${side}`) === 'folded';
  } catch {
    return false;
  }
}

function saveFolded(side: string, folded: boolean) {
  try {
    localStorage.setItem(`honeycomb.tagPad.${side}`, folded ? 'folded' : 'open');
  } catch {
    // 保存できなくても動作は続ける
  }
}
