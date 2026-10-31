// 右サイドバーの「メモ」の区画（下のパネルのいちばん上）：右だけのシート「右のメモ」の蜂の巣と、書いたコメントの一覧
//   ・書いたコメントは、1つずつ「右のメモ」のメモのセルになる（置く場所は左が決める：真ん中から外へ、空いている所）
//   ・下の一覧は新しい順。それぞれに返信（コメントのスレッド。左の拡大表示と同じもの）
//   ・セルとコメントの行き来：ダブルクリック、または右クリックのメニュー。1回押すだけなら、両方に印が付くだけ
//   ・蜂の巣は上下左右に動かせる（空いた所のドラッグ・ホイール・矢印キー）。高さは決まっている（蜂の巣 4 : 一覧 6）
//   ・メモのセルはドラッグで動かせる（左の盤面と同じ決まり：ほかのセルとは入れ替え、入口に落とせばそのシートへ）。タブは左の盤面で動かす
//   ・空いたセルをダブルクリック（または右クリック →「ここにメモを書く」）すると、その場所にメモを書ける
//   ・見出しのすぐ下に、シートのタブ（6つまで）。＋で新しいシートを足す。「セットに保存」で今のタブのシートを
//     「シートのセット」にして、タブには新しい空のシートを1つ。「セット ▾」の一覧から開くと、タブに戻る（rightsheets.ts）
//   ・コメントにはタグを付けられる。一覧には付いたタグだけを出し、一覧のすぐ下の「選んだコメントのタグ」で付ける・外す
//     （一覧の中で欄を出し入れすると、押している間に中身がずれるので、選んだコメントの欄は1つだけ・一覧の外に置く）
//   ・台帳（メモのセル・シート）は左サイドバーが持つ。ここは写しを見て、頼みごとを左へ送る
//   ・入口とボットのセル（isSpecialCell）は、蜂の巣には出すが、一覧・数には入れない。コピー・コメントへ移るも出さない
import { t as tr } from '../i18n';
import { armConfirm } from '../confirm-arm';
import { cellLines } from '../cellface';
import { type Hex, hexCorners, hexKey, hexToPixel, pixelToHex } from '../hex';
import { isSpecialCell, type RightMemo } from '../memocells';
import { MAX_TABS, RightSheetStore } from '../rightsheets';
import { MAX_SHEETS, newSheetId, RIGHT_MEMO_NAME, RIGHT_MEMO_SHEET, type Sheet } from '../sheets';
import type { Tab } from '../tabs';
import type { ThreadRef } from '../threads';
import type { RelayCommand } from '../types';
import { el, initialOf } from '../util';
import type { CellMenu, MenuEntry } from './cell-menu';
import { tagArea, type TagPad } from './tag-pad';
import { collapseOnce, threadBlock, type ThreadUi } from './thread-view';

export interface MemoPadDeps {
  askLeft(action: RelayCommand): void;
  thread: ThreadUi; // 返信（コメントのスレッド）の操作。refresh はこの区画を描き直す
  menu: CellMenu; // 右クリックのメニュー
  tabs(): readonly Tab[]; // タブの写し（見ているシートに移したタブも、蜂の巣に出す）
  sheets(): readonly Sheet[]; // シートの台帳の写し（名前と色）
  tagPad: TagPad; // タグのボタン（右のもの）
  changeTags(id: string, add: string[], remove: string[]): void; // コメント（メモのセル）のタグを足す・外す
}

// 右の「メモ」の区画の小さな欄：シートを足す・セットに保存・セットの一覧・セットを開く前の確かめ
type Panel = 'add' | 'save' | 'sets' | { open: string } | null;

const SIZE = 22; // セルの大きさ（左の盤面と同じ）
const FACE = SIZE - 2.5;
const HIVE_H = 140; // 蜂の巣の高さ（4割）
const LIST_H = 210; // 一覧の高さ（6割）
const PREFS_KEY = 'honeycomb.memoPad';
const MAX_TEXT = 2000;
const NS = 'http://www.w3.org/2000/svg';

export class MemoPad {
  readonly element = el('section', 'panel-section memo-pad');
  private memos: RightMemo[] = []; // 新しい順（入口は除く）
  private cells: RightMemo[] = []; // 蜂の巣に出すメモのセル（入口も）
  private readonly registry = new RightSheetStore(); // シートのタブとセット
  private shown = RIGHT_MEMO_SHEET; // 蜂の巣と一覧に出しているシート（タブで選んだもの）
  private readonly created = new Map<string, string>(); // 右で作って、まだ左から届いていないシート（id → 名前）
  private counts: Record<string, number> = {}; // シートごとのメモのセルの数（書いたシートか）
  private panel: Panel = null;
  private builtKey = ''; // 今出している欄の中身（同じなら作り直さない：書きかけ・キーボードの位置が消えないように）
  private trigger: string | null = null; // 欄を開いたボタン（閉じたら、そこへキーボードの位置を戻す）
  private armedTab: string | null = null; // 書いたものがあるシートの × を一度押した
  private armTimer = 0;
  private sheetsKey = ''; // タブとセットのシートの名前・色（変わったときだけ描き直す）
  private armedSet: string | null = null; // 「消す」を一度押したセット
  private asked = 0; // 見ているシートの写しを、最後に頼んだ時刻
  private ready = false;
  private view = { x: 0, y: 0 }; // 蜂の巣を動かした量
  private selected: string | null = null; // 印を付けたメモ（セルとコメントの両方）
  private flashed: string | null = null; // 行き来した先（少しのあいだ光らせる）
  private collapsed: boolean;
  // 書いて、左から写しが届くのを待っているもの（届かなければ、書いた文を書いた欄に戻す）。pos：空いたセルに書いたもの
  //   base：書いたときの、そのシートのメモのセルの数（ほかのシートを見ている間に届いたかは、数が増えたかで見る）
  private pending: { text: string; at: number; sheet: string; base: number; pos?: Hex; timer: number }[] = [];
  private moving: { id: string; at: { x: number; y: number }; target: Hex | null } | null = null; // ドラッグで動かしているセル（at は蜂の巣の中の場所。target が無ければ、蜂の巣の外）
  private editing: Hex | null = null; // 空いたセルに書いている場所
  private listKey = '';
  private listDirty = false; // 書いている間に届いた写し（書き終えてから描き直す）
  private readonly sub = el('span', 'memo-pad-sub');
  private readonly tabsBar = el('div', 'memo-pad-tabs'); // シートのタブ
  private readonly pop = el('div', 'memo-pad-pop'); // 小さな欄
  private readonly status = el('div', 'memo-pad-status'); // 書けなかったときのひとこと
  private readonly hive = el('div', 'memo-pad-hive');
  private readonly fold = el('button', 'memo-pad-fold');
  private readonly head = el('div', 'memo-pad-head');
  private readonly body = el('div', 'memo-pad-body');
  private readonly board = document.createElementNS(NS, 'svg');
  private readonly center = el('button', 'memo-pad-center', '◎');
  private readonly text = el('textarea', 'memo-pad-text');
  private readonly list = el('div', 'memo-pad-list');
  private readonly tagStrip = el('div', 'memo-pad-tagstrip'); // 選んだコメントのタグ（一覧のすぐ下）
  private stripKey = '';
  private readonly editor = el('form', 'memo-pad-editor'); // 空いたセルに書く欄（蜂の巣の上に出す）
  private readonly editorText = el('textarea', 'memo-pad-editor-text');

  constructor(private readonly deps: MemoPadDeps) {
    this.collapsed = loadCollapsed();
    this.element.setAttribute('aria-label', 'メモ');

    this.head.append(el('h2', 'memo-pad-title', tr('メモ')), this.sub, this.fold);
    this.fold.type = 'button';
    this.fold.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      saveCollapsed(this.collapsed);
      this.render();
    });

    // 蜂の巣
    const hive = this.hive;
    hive.style.height = `${HIVE_H}px`;
    this.board.setAttribute('class', 'memo-pad-board');
    this.board.setAttribute('role', 'group');
    this.board.setAttribute('tabindex', '0');
    this.board.setAttribute(
      'aria-label',
      '右のメモの蜂の巣。空いた所のドラッグ・ホイール・矢印キーで上下左右に動かせます。メモのセルはドラッグで動かせます。メモのセルをダブルクリックすると下のコメントへ、空いたセルをダブルクリックするとその場所にメモを書けます',
    );
    this.center.type = 'button';
    this.center.title = tr('蜂の巣を真ん中に戻す（印を付けたセルがあれば、そのセルへ）');
    this.center.setAttribute('aria-label', '蜂の巣を真ん中に戻す');
    this.center.addEventListener('click', () => {
      const memo = this.cells.find((m) => m.id === this.selected);
      this.centerOn(memo?.pos ?? { q: 0, r: 0 });
    });
    hive.append(this.board, this.center, this.editor);
    this.wireBoard();
    this.buildEditor();

    // 書く欄
    const form = el('form', 'memo-pad-form');
    this.text.id = 'memo-pad-text';
    this.text.rows = 2;
    this.text.maxLength = MAX_TEXT;
    this.text.placeholder = tr('コメントを書く（Ctrl+Enter）。書いたものは新しいセルになります');
    this.text.setAttribute('aria-label', 'コメントを書く（書いたものは、右のメモの新しいセルになります）');
    const send = el('button', 'memo-pad-send', tr('書く'));
    send.type = 'submit';
    form.append(this.text, send);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.write();
    });
    this.text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
        e.preventDefault();
        this.write();
      }
    });

    // 一覧（上下に動く）
    this.list.style.height = `${LIST_H}px`;
    this.list.setAttribute('role', 'region');
    this.list.setAttribute('aria-label', '書いたコメント（新しい順）');
    this.list.addEventListener('focusout', (e) => {
      // 返信を書き終えて一覧の外へ出た：書いている間に届いた写しで描き直す
      //   一覧の中のボタン（返信する・やめる など）へ移っただけなら描き直さない（押したボタンが消えて、押せなくなる）
      const to = e.relatedTarget;
      if (to instanceof Node && this.list.contains(to)) return;
      window.setTimeout(() => {
        if (this.listDirty && !this.writingInList()) this.renderList(true);
      }, 0);
    });
    this.status.setAttribute('role', 'status');
    this.status.hidden = true;

    // シートのタブ（見出しのすぐ下）
    this.tabsBar.setAttribute('role', 'group');
    this.tabsBar.setAttribute('aria-label', '右のシート（6つまで）');
    this.pop.hidden = true;
    this.body.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.panel && !e.defaultPrevented) {
        e.preventDefault();
        this.closePanel();
      }
    });
    this.registry.onChange(() => {
      if (this.registry.active !== this.shown) this.show(this.registry.active);
      this.renderTabs();
    });
    void this.registry.load().then(() => this.ask(true));

    this.tagStrip.setAttribute('role', 'group');
    this.tagStrip.setAttribute('aria-label', '選んだコメントのタグ');
    this.body.append(this.tabsBar, this.pop, hive, form, this.status, this.list, this.tagStrip);
    this.element.append(this.head, this.body);
    new ResizeObserver(() => this.renderHive()).observe(this.board);
    this.render();
  }

  // ---------- シートのタブ ----------

  // 左のシートの台帳が届いた：名前を描き直し、左で消したシートをタブとセットから外す
  sheetsChanged() {
    const list = this.deps.sheets();
    for (const id of [...this.created.keys()]) if (list.some((s) => s.id === id)) this.created.delete(id);
    if (this.registry.ready) this.registry.prune((id) => list.some((s) => s.id === id), new Set(this.created.keys()));
    // タブ・セットのシートの名前と色が変わったときだけ描き直す（左のタブが動くたびに届くので）
    const ids = [this.shown, ...this.registry.tabs, ...this.registry.sets.flatMap((s) => s.sheets)];
    const key = ids.map((id) => `${id}:${this.sheetInfo(id).name}:${this.sheetInfo(id).color}`).join('|');
    if (key === this.sheetsKey) return;
    this.sheetsKey = key;
    this.render();
  }

  // 見ているシートの写しを、左に頼む（force でなければ、続けて頼まない）
  private ask(force = false) {
    const now = Date.now();
    if (!force && now - this.asked < 800) return;
    this.asked = now;
    this.deps.askLeft({ command: 'showRightSheet', id: this.shown });
  }

  // タブで選んだシートに切り替える
  private show(id: string) {
    this.shown = id;
    this.ready = false;
    this.cells = [];
    this.memos = [];
    this.selected = null;
    this.flashed = null;
    this.moving = null;
    this.view = { x: 0, y: 0 };
    if (this.editing) {
      // 空いたセルに書きかけていた文は、下の書く欄に移す（場所は前のシートのものなので）
      const draft = this.editorText.value.trim();
      this.closeEditor();
      if (draft) {
        this.text.value = this.text.value.trim() ? `${this.text.value.replace(/\s+$/, '')}\n${draft}` : draft;
        this.say(tr('書きかけのメモは、下の書く欄に移しました'));
      }
    }
    // 書いて、まだ届いていないもの（ほかのシートに書いた分）は待ち続ける。届いたかは、そのシートのメモの数で見る
    this.list.scrollTop = 0;
    this.listKey = '';
    this.ask(true);
    this.render(true);
  }

  private sheetInfo(id: string): { name: string; color: string } {
    const sheet = this.deps.sheets().find((s) => s.id === id);
    if (sheet) return { name: sheet.name, color: sheet.color };
    return { name: this.created.get(id) ?? (id === RIGHT_MEMO_SHEET ? RIGHT_MEMO_NAME : tr('シート')), color: 'var(--accent)' };
  }

  // 新しいシートの名前の案（「右のメモ 2」など、まだ無い番号）
  private freshName(): string {
    const names = new Set([...this.deps.sheets().map((s) => s.name), ...this.created.values()]);
    for (let n = 2; n < 1000; n++) if (!names.has(`${RIGHT_MEMO_NAME} ${n}`)) return `${RIGHT_MEMO_NAME} ${n}`;
    return RIGHT_MEMO_NAME;
  }

  // まだシートを作れるか（左のシートは100枚まで。作ったばかりで、まだ届いていないものも数える）
  private canMakeSheet() {
    return this.deps.sheets().length + this.created.size < MAX_SHEETS;
  }

  // 新しいシートを左に作ってもらう（id は右で決める）
  private createSheet(name: string): string {
    const id = newSheetId();
    const clean = [...name.replace(/\s+/g, ' ').trim()].slice(0, 20).join('') || this.freshName();
    this.created.set(id, clean);
    this.registry.markMade(id);
    this.deps.askLeft({ command: 'addRightSheet', id, name: clean });
    return id;
  }

  // タブにもセットにも無くなった、右で作ったシート：何も書いていなければ、左で片づけてもらう
  private tidy(ids: readonly string[]) {
    for (const id of ids) {
      if ((this.counts[id] ?? 0) > 0) continue;
      this.registry.forget(id);
      this.deps.askLeft({ command: 'dropEmptySheet', id });
    }
  }

  // 今のタブに、書いたシートがあるか（セットを開く前に聞くかどうか）
  private tabsHaveWriting() {
    return this.registry.tabs.some((id) => (this.counts[id] ?? 0) > 0);
  }

  private openPanel(panel: Panel, trigger?: string) {
    this.panel = panel;
    this.armedSet = null;
    if (trigger) this.trigger = trigger;
    this.renderTabs();
    this.pop.querySelector<HTMLElement>('input, button')?.focus();
  }

  private closePanel() {
    if (!this.panel) return;
    this.panel = null;
    this.armedSet = null;
    this.renderTabs();
    this.focusKey(this.trigger ?? `tab:${this.registry.active}`);
    this.trigger = null;
  }

  // 欄を閉じて、見ているシートのタブにキーボードの位置を置く（足した・開いた・外したあと）
  private finishPanel() {
    this.panel = null;
    this.armedSet = null;
    this.trigger = null;
    this.renderTabs();
    this.focusKey(`tab:${this.registry.active}`);
  }

  private focusKey(key: string) {
    this.tabsBar.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  }

  private say(text: string) {
    this.status.textContent = text;
    this.status.classList.add('info');
    this.status.hidden = false;
    window.setTimeout(() => {
      if (this.status.textContent === text) this.status.hidden = true;
    }, 5_000);
  }

  private renderTabs() {
    const reg = this.registry;
    const focus = document.activeElement instanceof HTMLElement && this.tabsBar.contains(document.activeElement) ? document.activeElement.dataset.key : undefined;
    const nodes: HTMLElement[] = [];
    for (const id of reg.tabs) {
      const info = this.sheetInfo(id);
      const tab = el('div', `memo-pad-tab${id === reg.active ? ' active' : ''}`);
      tab.style.setProperty('--sheet', info.color);
      const main = el('button', 'memo-pad-tab-main');
      main.type = 'button';
      main.dataset.key = `tab:${id}`;
      main.title = info.name;
      main.setAttribute('aria-pressed', String(id === reg.active));
      main.append(el('span', 'memo-pad-tab-sw'), el('span', 'memo-pad-tab-name', info.name));
      main.addEventListener('click', () => reg.setActive(id));
      tab.append(main);
      if (reg.tabs.length > 1) {
        const armed = this.armedTab === id;
        const close = el('button', `memo-pad-tab-x${armed ? ' armed' : ''}`, armed ? tr('外す') : '×');
        close.type = 'button';
        close.dataset.key = `x:${id}`;
        close.title = armed
          ? tr('書いたものがあるシートです。外すと、右のタブからは開けなくなります（左のシートの一覧から開けます。セットに保存しておけば、あとでタブに戻せます）。もう一度押すと外します')
          : tr('タブから外す（シートは消えません。何も書いていない新しいシートだけは片づけます）');
        close.setAttribute('aria-label', armed ? tr('「{0}」をタブから外す（書いたものがあります。もう一度押すと外します）', { 0: info.name }) : tr('「{0}」をタブから外す', { 0: info.name }));
        if (armed) armConfirm(close, () => {
          window.clearTimeout(this.armTimer);
          this.armedTab = null;
          this.renderTabs();
        });
        close.addEventListener('click', () => {
          if ((this.counts[id] ?? 0) > 0 && this.armedTab !== id) {
            this.armedTab = id;
            window.clearTimeout(this.armTimer);
            this.armTimer = window.setTimeout(() => {
              this.armedTab = null;
              this.renderTabs();
            }, 4_000);
            this.renderTabs();
            this.focusKey(`x:${id}`);
            return;
          }
          this.armedTab = null;
          this.tidy(reg.removeTab(id));
          this.focusKey(`tab:${reg.active}`);
        });
        tab.append(close);
      }
      nodes.push(tab);
    }
    if (reg.tabs.length < MAX_TABS) {
      const add = el('button', 'memo-pad-tab-add', '＋');
      add.type = 'button';
      add.dataset.key = 'add';
      add.title = tr('新しいシートを足す');
      add.setAttribute('aria-label', '新しいシートを足す');
      add.setAttribute('aria-expanded', String(this.panel === 'add'));
      add.addEventListener('click', () => (this.panel === 'add' ? this.closePanel() : this.openPanel('add', 'add')));
      nodes.push(add);
    }
    nodes.push(el('span', 'memo-pad-slots', `${reg.tabs.length}/${MAX_TABS}`));
    const tools = el('div', 'memo-pad-tab-tools');
    const save = el('button', 'memo-pad-save', tr('セットに保存'));
    save.type = 'button';
    save.dataset.key = 'save';
    save.title = tr('今のタブのシートを「シートのセット」として保存して、タブの場所を空ける（シートは消えません）');
    save.setAttribute('aria-expanded', String(this.panel === 'save'));
    save.addEventListener('click', () => (this.panel === 'save' ? this.closePanel() : this.openPanel('save', 'save')));
    const sets = el('button', 'memo-pad-sets', tr('セット {0} ▾', { 0: reg.sets.length }));
    sets.type = 'button';
    sets.dataset.key = 'sets';
    sets.title = tr('シートのセットの一覧（開くと、そのシートがタブに戻る）');
    sets.setAttribute('aria-expanded', String(this.panel === 'sets' || (typeof this.panel === 'object' && this.panel !== null)));
    sets.addEventListener('click', () => (this.panel === 'sets' ? this.closePanel() : this.openPanel('sets', 'sets')));
    tools.append(save, sets);
    nodes.push(tools);
    this.tabsBar.replaceChildren(...nodes);
    this.renderPanel();
    if (focus) this.tabsBar.querySelector<HTMLElement>(`[data-key="${CSS.escape(focus)}"]`)?.focus({ preventScroll: true });
  }

  // 欄の中身の印（同じなら作り直さない。名前を書く欄は、開いている間ずっと同じ）
  private panelKey(): string {
    const panel = this.panel;
    if (!panel) return '';
    if (panel === 'add' || panel === 'save') return panel;
    const sets = this.registry.sets.map((s) => `${s.id}:${s.name}:${s.sheets.map((id) => `${id}/${this.sheetInfo(id).name}/${this.sheetInfo(id).color}`).join(',')}`).join('|');
    return `${typeof panel === 'object' ? `open:${panel.open}` : panel}|${this.armedSet ?? ''}|${sets}`;
  }

  private renderPanel() {
    const panel = this.panel;
    this.pop.hidden = !panel;
    if (!panel) {
      this.builtKey = '';
      this.pop.replaceChildren();
      return;
    }
    const key = this.panelKey();
    if (key === this.builtKey) return;
    this.builtKey = key;
    // 作り直すときは、押していたボタンに、キーボードの位置を戻す
    const focus = document.activeElement instanceof HTMLElement && this.pop.contains(document.activeElement) ? document.activeElement.dataset.key : undefined;
    const reg = this.registry;
    const nodes: HTMLElement[] = [];
    const button = (label: string, run: () => void, cls = '', key = '') => {
      const b = el('button', cls, label);
      b.type = 'button';
      if (key) b.dataset.key = key;
      b.addEventListener('click', run);
      return b;
    };
    if (panel === 'add') {
      const form = el('form', 'memo-pad-pop-row');
      const input = el('input');
      input.id = 'memo-pad-new-sheet';
      input.maxLength = 20;
      input.value = this.freshName();
      input.setAttribute('aria-label', '新しいシートの名前');
      const ok = el('button', 'primary', tr('作る'));
      ok.type = 'submit';
      form.append(input, ok, button(tr('やめる'), () => this.closePanel()));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (reg.tabs.length >= MAX_TABS) {
          this.say(tr('タブは6つまでです。セットに保存するか、× で外してから足してください'));
          this.finishPanel();
          return;
        }
        if (!this.canMakeSheet()) {
          this.say(tr('シートが多すぎて足せません（左のシートは100枚まで）。使わないシートを左で消してから、もう一度足してください'));
          this.finishPanel();
          return;
        }
        reg.addTab(this.createSheet(input.value));
        this.finishPanel();
      });
      nodes.push(el('div', 'memo-pad-pop-title', tr('新しいシートを足す')), form);
    } else if (panel === 'save') {
      const form = el('form', 'memo-pad-pop-row');
      const input = el('input');
      input.id = 'memo-pad-set-name';
      input.maxLength = 30;
      input.value = tr('シートのセット {0}', { 0: stamp(Date.now()) });
      input.setAttribute('aria-label', 'シートのセットの名前');
      const ok = el('button', 'primary', tr('保存'));
      ok.type = 'submit';
      form.append(input, ok, button(tr('やめる'), () => this.closePanel()));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        // 先に、保存できるか・新しい空のシートを作れるかを確かめる（できなければ、タブはそのまま）
        if (!reg.canSaveSet) {
          this.say(tr('シートのセットは100個までです。「セット ▾」の一覧から使わないセットを消してください'));
          this.finishPanel();
          return;
        }
        if (!this.canMakeSheet()) {
          this.say(tr('シートが多すぎて、新しい空のシートを作れません（左のシートは100枚まで）。使わないシートを左で消してから、もう一度保存してください'));
          this.finishPanel();
          return;
        }
        const name = input.value.trim() || tr('シートのセット {0}', { 0: stamp(Date.now()) });
        const set = reg.saveSet(name, this.createSheet(this.freshName()));
        if (set) this.say(tr('「{0}」に保存しました（シート {1} 枚）。「セット ▾」から開けます', { 0: set.name, 1: set.sheets.length }));
        this.finishPanel();
      });
      nodes.push(
        el('div', 'memo-pad-pop-title', tr('今のタブのシート {0} 枚を、シートのセットとして保存', { 0: reg.tabs.length })),
        form,
        el('div', 'memo-pad-pop-note', tr('保存したシートはタブから外れて、「セット ▾」の一覧に入ります。タブには新しい空のシートが1つ入ります（シートは消えません）')),
      );
    } else if (panel === 'sets') {
      nodes.push(el('div', 'memo-pad-pop-title', tr('シートのセット（{0}）', { 0: reg.sets.length })));
      if (reg.sets.length === 0) nodes.push(el('div', 'memo-pad-pop-note', tr('まだありません。「セットに保存」で作れます')));
      const list = el('div', 'memo-pad-set-list');
      for (const set of reg.sets) {
        const row = el('div', 'memo-pad-set');
        const info = el('div', 'memo-pad-set-info');
        const chips = el('span', 'memo-pad-set-chips');
        for (const id of set.sheets) {
          const sheet = this.sheetInfo(id);
          const chip = el('i');
          chip.style.setProperty('--sheet', sheet.color);
          chip.title = sheet.name;
          chips.append(chip);
        }
        info.append(el('b', '', set.name), el('span', '', tr('シート {0} 枚・{1}', { 0: set.sheets.length, 1: stamp(set.at) })), chips);
        info.title = set.sheets.map((id) => this.sheetInfo(id).name).join(tr('・'));
        const open = button(tr('開く'), () => {
          if (this.tabsHaveWriting()) this.openPanel({ open: set.id });
          else this.openSet(set.id, false);
        }, '', `open:${set.id}`);
        open.setAttribute('aria-label', `「${set.name}」を開く`);
        const armed = this.armedSet === set.id;
        const remove = button(armed ? tr('もう一度で消す') : tr('消す'), () => {
          if (this.armedSet === set.id) {
            this.armedSet = null;
            reg.removeSet(set.id);
            const next = this.pop.querySelector<HTMLElement>('[data-key^="open:"], [data-key^="rm:"]');
            if (next) next.focus();
            else this.focusKey('sets');
          } else {
            this.armedSet = set.id;
            this.renderPanel();
            this.pop.querySelector<HTMLElement>(`[data-key="rm:${set.id}"]`)?.focus();
            return;
          }
        }, armed ? 'danger' : '');
        remove.dataset.key = `rm:${set.id}`;
        if (armed) armConfirm(remove, () => {
          this.armedSet = null;
          this.renderPanel();
        });
        remove.title = tr('セットを消す（シートそのものは消えません）');
        remove.setAttribute('aria-label', armed ? tr('「{0}」を消す（もう一度押すと消えます）', { 0: set.name }) : tr('「{0}」を消す', { 0: set.name }));
        row.append(info, open, remove);
        list.append(row);
      }
      nodes.push(list);
    } else {
      const set = reg.sets.find((s) => s.id === panel.open);
      if (!set) {
        this.panel = 'sets';
        this.renderPanel();
        return;
      }
      // 何を聞いているかを、読み上げでも伝わるように（ボタンのかたまりに、問いと説明をつなぐ）
      const row = el('div', 'memo-pad-pop-row');
      row.setAttribute('role', 'group');
      row.setAttribute('aria-labelledby', 'memo-pad-ask-title');
      row.setAttribute('aria-describedby', 'memo-pad-ask-note');
      row.append(
        button(tr('保存して開く'), () => this.openSet(set.id, true), 'primary', 'ask:save'),
        button(tr('保存せずに開く'), () => this.openSet(set.id, false), '', 'ask:just'),
        button(tr('やめる'), () => this.openPanel('sets'), '', 'ask:no'),
      );
      const title = el('div', 'memo-pad-pop-title', tr('「{0}」を開きます。今のタブのシートには書いたものがあります。どうしますか？', { 0: set.name }));
      title.id = 'memo-pad-ask-title';
      const note = el(
        'div',
        'memo-pad-pop-note',
        tr('「保存して開く」は、今のタブを新しいシートのセットに保存してから開きます。「保存せずに開く」でもシートは消えません（左のシートの一覧から開けます。何も書いていない新しいシートだけは片づけます）'),
      );
      note.id = 'memo-pad-ask-note';
      nodes.push(title, row, note);
    }
    this.pop.replaceChildren(...nodes);
    if (focus) this.pop.querySelector<HTMLElement>(`[data-key="${CSS.escape(focus)}"]`)?.focus({ preventScroll: true });
  }

  private openSet(setId: string, saveCurrent: boolean) {
    if (saveCurrent && !this.registry.canSaveSet) {
      this.say(tr('シートのセットは100個までです。使わないセットを消してから、もう一度開いてください'));
      return;
    }
    const opened = this.registry.openSet(setId, saveCurrent ? tr('シートのセット {0}', { 0: stamp(Date.now()) }) : null);
    if (opened) {
      this.tidy(opened.dropped);
      this.say(tr('「{0}」のシートをタブに戻しました{1}', { 0: opened.set.name, 1: saveCurrent ? '（今のタブはセットに保存しました）' : '' }));
    }
    this.finishPanel();
  }

  // 左から届いた、見ているシートの写し（ほかのシートのものなら、見ているシートを頼み直す）
  setMemos(payload: { sheetId: string; sheet: { id: string; name: string } | null; memos: RightMemo[]; counts: Record<string, number> }) {
    this.counts = payload.counts ?? {};
    // ほかのシートに書いて待っていたもの：そのシートの数が増えていれば、届いた
    for (const wait of [...this.pending]) {
      if (wait.sheet !== this.shown && (this.counts[wait.sheet] ?? 0) > wait.base) {
        window.clearTimeout(wait.timer);
        this.pending = this.pending.filter((p) => p !== wait);
      }
    }
    if (payload.sheetId !== this.shown) {
      this.ask();
      this.renderTabs();
      return;
    }
    const memos = payload.memos;
    this.ready = true;
    this.cells = memos;
    this.memos = memos.filter((m) => !isSpecialCell(m)).sort((a, b) => b.createdAt - a.createdAt);
    if (this.selected && !memos.some((m) => m.id === this.selected)) this.selected = null;
    // 書いたものが届いた：そのセルに印を付けて、真ん中に（いくつか届いたら、最後に書いたもの）
    const used = new Set<string>();
    let latest: RightMemo | null = null;
    for (const wait of [...this.pending]) {
      const mine = this.memos.find((m) => !used.has(m.id) && m.text === wait.text && m.createdAt >= wait.at - 2_000);
      if (!mine) continue;
      used.add(mine.id);
      window.clearTimeout(wait.timer);
      this.pending = this.pending.filter((p) => p !== wait);
      latest = mine;
    }
    if (latest) {
      this.status.hidden = true;
      this.selected = latest.id;
      this.flash(latest.id);
      this.view = centered(latest.pos);
      this.list.scrollTop = 0;
    }
    this.render();
  }

  // タブが変わった（右のメモのシートに移したタブ）
  tabsChanged() {
    this.renderHive();
  }

  // 描き直す（force：返信を書いている途中でも）
  render(force = false) {
    this.fold.textContent = this.collapsed ? '▸' : '▾';
    this.fold.title = this.collapsed ? tr('メモの区画を開く') : tr('メモの区画をたたむ');
    this.fold.setAttribute('aria-label', this.fold.title);
    this.fold.setAttribute('aria-expanded', String(!this.collapsed));
    this.body.hidden = this.collapsed;
    const name = this.sheetInfo(this.shown).name;
    this.sub.textContent = tr('シート「{0}」・{1} 個', { 0: name, 1: this.memos.length });
    this.board.setAttribute(
      'aria-label',
      `「${name}」の蜂の巣。空いた所のドラッグ・ホイール・矢印キーで上下左右に動かせます。メモのセルはドラッグで動かせます。メモのセルをダブルクリックすると下のコメントへ、空いたセルをダブルクリックするとその場所にメモを書けます`,
    );
    this.text.setAttribute('aria-label', `コメントを書く（書いたものは、「${name}」の新しいセルになります）`);
    if (this.collapsed) return;
    this.renderTabs();
    this.renderHive();
    this.renderList(force);
  }

  // ---------- 書く ----------

  private write() {
    const text = this.text.value.trim();
    if (!text) {
      this.text.focus();
      return;
    }
    this.text.value = '';
    this.send(text);
  }

  // 左に、新しいメモのセルを頼む（pos：空いたセルに書いたとき、その場所）
  private send(text: string, pos?: Hex) {
    const sheet = this.shown;
    this.deps.askLeft({ command: 'addRightMemo', text, sheet, ...(pos ? { pos: { q: pos.q, r: pos.r } } : {}) });
    this.status.hidden = true;
    this.status.classList.remove('info');
    // しばらくしても届かなければ（メモやシートが多すぎるなど）、書いた文を書いた欄に戻す
    const wait = { text, at: Date.now(), sheet, base: this.counts[sheet] ?? 0, ...(pos ? { pos: { q: pos.q, r: pos.r } } : {}), timer: 0 };
    wait.timer = window.setTimeout(() => {
      if (!this.pending.includes(wait)) return;
      this.pending = this.pending.filter((p) => p !== wait);
      if ((this.counts[wait.sheet] ?? 0) > wait.base) return; // ほかのシートを見ている間に届いていた
      if (wait.sheet === this.shown) this.giveBack(wait.text, wait.pos);
      else this.giveBack(wait.text, undefined, this.sheetInfo(wait.sheet).name);
    }, 4_000);
    this.pending.push(wait);
  }

  // 書けなかった文を戻す：空いたセルに書いたものは、その場所の書く欄に（空いていれば）。ほかは下の書く欄に足す
  //   sheetName：ほかのシートに書いたもの（そのシートの名前を伝える）
  private giveBack(text: string, pos?: Hex, sheetName?: string) {
    if (pos && !this.editing && !this.collapsed && !this.occupied(pos)) {
      this.openEditor(pos);
      this.editorText.value = text;
      this.status.textContent = tr('書けませんでした（左のお知らせを見てください）。書いた文は、その場所の書く欄に戻しました');
    } else {
      this.text.value = this.text.value.trim() ? `${this.text.value.replace(/\s+$/, '')}\n${text}` : text;
      this.status.textContent = sheetName
        ? tr('「{0}」に書けませんでした（左のお知らせを見てください）。書いた文は、下の書く欄に戻しました', { 0: sheetName })
        : tr('書けませんでした（左のお知らせを見てください）。書いた文は、下の書く欄に戻しました');
    }
    this.status.classList.remove('info');
    this.status.hidden = false;
  }

  // ---------- 空いたセルに書く ----------

  private buildEditor() {
    const editor = this.editor;
    editor.hidden = true;
    editor.setAttribute('aria-label', 'この場所にメモを書く');
    this.editorText.id = 'memo-pad-editor-text';
    this.editorText.rows = 2;
    this.editorText.maxLength = MAX_TEXT;
    this.editorText.placeholder = tr('ここに書く（Ctrl+Enter・Esc でやめる）');
    this.editorText.setAttribute('aria-label', 'この場所に置くメモ');
    const ok = el('button', 'memo-pad-editor-ok', tr('ここに置く'));
    ok.type = 'submit';
    const cancel = el('button', 'memo-pad-editor-cancel', tr('やめる'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.closeEditor(true));
    const row = el('div', 'memo-pad-editor-row');
    row.append(ok, cancel);
    editor.append(this.editorText, row);
    editor.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitEditor();
    });
    this.editorText.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
        e.preventDefault();
        this.submitEditor();
      } else if (e.key === 'Escape') {
        if (this.deps.menu.isOpen) return; // 先にメニューを閉じる（書いた文は残す）
        e.preventDefault();
        this.closeEditor(true);
      }
    });
  }

  // その空いたセルに書く欄を開く
  private openEditor(pos: Hex) {
    if (this.occupied(pos)) return;
    this.editing = { q: pos.q, r: pos.r };
    this.select(null);
    this.editor.hidden = false;
    // 蜂の巣は低いので、その場所を上の端の近くに寄せて、書く欄をすぐ下に出す（場所が隠れないように）
    const p = hexToPixel(pos, SIZE);
    const w = this.board.clientWidth || 280;
    const h = this.board.clientHeight || HIVE_H;
    const x = p.x - (-w / 2 - this.view.x);
    this.view = { x: x < SIZE || x > w - SIZE ? -p.x : this.view.x, y: -h / 2 - (p.y - (SIZE + 4)) };
    this.renderHive();
    this.editorText.focus({ preventScroll: true });
  }

  private closeEditor(focusBoard = false) {
    if (!this.editing) return;
    this.editing = null;
    this.editor.hidden = true;
    this.editorText.value = '';
    this.renderHive();
    if (focusBoard) this.board.focus({ preventScroll: true });
  }

  private submitEditor() {
    const text = this.editorText.value.trim();
    const pos = this.editing;
    if (!text || !pos) {
      this.editorText.focus();
      return;
    }
    this.closeEditor();
    this.send(text, pos);
  }

  // 書く欄を、その場所のセルの近くに置く（蜂の巣の中に収める）
  private placeEditor(left: number, top: number, w: number, h: number) {
    if (!this.editing || this.editor.hidden) return;
    const p = hexToPixel(this.editing, SIZE);
    const x = p.x - left;
    const y = p.y - top;
    const width = Math.min(220, w - 8);
    const height = this.editor.offsetHeight || 90;
    this.editor.style.width = `${width}px`;
    this.editor.style.left = `${Math.max(4, Math.min(w - width - 4, x - width / 2))}px`;
    const below = y + SIZE + 2;
    this.editor.style.top = `${below + height <= h - 4 ? below : Math.max(4, y - SIZE - 2 - height)}px`;
  }

  // そのセルがふさがっているか（メモのセル・右のメモに移したタブ）
  private occupied(pos: Hex) {
    const key = hexKey(pos);
    return this.cells.some((m) => hexKey(m.pos) === key) || this.deps.tabs().some((t) => t.sheet === this.shown && hexKey(t.pos) === key);
  }

  // ---------- セルを動かす ----------

  // 落とした：左に頼み、写しが届くまでの間も、動かした場所に見せておく（入口に落としたときは左に任せる）
  private drop(id: string, target: Hex) {
    const memo = this.cells.find((m) => m.id === id);
    if (!memo || hexKey(memo.pos) === hexKey(target)) return;
    const other = this.cells.find((m) => m.id !== id && hexKey(m.pos) === hexKey(target));
    if (!(other?.portal && !memo.portal)) {
      if (other) other.pos = { ...memo.pos };
      memo.pos = { q: target.q, r: target.r };
    }
    this.selected = id;
    this.deps.askLeft({ command: 'moveRightMemo', id, pos: { q: target.q, r: target.r }, sheet: this.shown });
  }

  // 画面の場所 → 蜂の巣の中の場所・セル
  private boardPoint(clientX: number, clientY: number) {
    const rect = this.board.getBoundingClientRect();
    const w = this.board.clientWidth || rect.width || 280;
    const h = this.board.clientHeight || rect.height || HIVE_H;
    return { x: -w / 2 - this.view.x + (clientX - rect.left), y: -h / 2 - this.view.y + (clientY - rect.top) };
  }

  private hexAt(clientX: number, clientY: number): Hex {
    const p = this.boardPoint(clientX, clientY);
    return pixelToHex(p.x, p.y, SIZE);
  }

  // ---------- 行き来 ----------

  private flash(id: string) {
    this.flashed = id;
    window.setTimeout(() => {
      if (this.flashed !== id) return;
      this.flashed = null;
      this.renderHive();
      this.list.querySelector(`[data-memo="${id}"]`)?.classList.remove('flash');
    }, 1_600);
  }

  // セルへ：蜂の巣でそのセルを真ん中に
  private toCell(id: string) {
    const memo = this.cells.find((m) => m.id === id);
    if (!memo) return;
    this.selected = id;
    this.flash(id);
    this.centerOn(memo.pos);
    this.markList();
    this.hive.scrollIntoView({ block: 'nearest' }); // 下の一覧を見ていて、蜂の巣が隠れていたとき
    this.board.focus({ preventScroll: true });
  }

  // コメントへ：一覧でそのコメントが見えるように
  private toPost(id: string) {
    const item = this.list.querySelector<HTMLElement>(`[data-memo="${id}"]`);
    this.selected = id;
    this.flash(id);
    this.renderHive();
    this.markList();
    if (!item) return;
    this.list.scrollIntoView({ block: 'nearest' }); // 一覧が隠れていたとき
    // 一覧の中を、そのコメントまで動かす
    this.list.scrollTop += item.getBoundingClientRect().top - this.list.getBoundingClientRect().top - 4;
    item.classList.add('flash');
    item.focus({ preventScroll: true });
  }

  private select(id: string | null) {
    this.selected = id;
    this.markHive();
    this.markList();
  }

  // 蜂の巣の印だけを付け直す（描き直さない）
  private markHive() {
    for (const g of this.board.querySelectorAll('[data-memo]')) {
      const id = g.getAttribute('data-memo');
      g.classList.toggle('sel', id === this.selected);
      g.classList.toggle('flash', id === this.flashed);
    }
  }

  private centerOn(pos: Hex) {
    this.view = centered(pos);
    this.renderHive();
  }

  private menuFor(memo: RightMemo, from: 'cell' | 'post'): MenuEntry[] {
    const ref: ThreadRef = { kind: 'memo', id: memo.id };
    const entries: MenuEntry[] = [];
    const special = isSpecialCell(memo); // 入口・ボットのセル：一覧に無く、コピーもしない
    if (!special) {
      entries.push(from === 'cell' ? { label: tr('コメントへ移る'), hint: tr('ダブルクリック'), run: () => this.toPost(memo.id) } : { label: tr('セルへ移る'), hint: tr('ダブルクリック'), run: () => this.toCell(memo.id) });
    }
    if (!special) entries.push({ label: tr('コピー'), hint: tr('左の盤面に貼れる'), run: () => this.deps.askLeft({ command: 'copyComment', ref, replyId: null }) });
    if (memo.bot) entries.push({ label: tr('Grok Bot アプリで開くのは、左の盤面のセルから'), disabled: true });
    if (memo.app) entries.push({ label: tr('中央に出すのは、左の盤面のセルをダブルクリック'), disabled: true });
    if (memo.capture) {
      entries.push({ label: tr('右の撮影で開くのは、左の盤面のダブルクリック'), disabled: true });
      entries.push({ label: tr('撮った画像は、右の撮影で消します'), disabled: true });
    }
    if (!memo.capture) entries.push(
      'sep',
      {
        row: memo.portal ? tr('この入口') : memo.bot ? tr('このボットのセル') : memo.app ? tr('このアプリのセル') : tr('このメモ'),
        buttons: [
          {
            label: memo.bot || memo.app ? tr('外す') : tr('消す'),
            confirm: tr('もう一度押すと消えます'),
            run: () => {
              this.deps.menu.close();
              this.deps.askLeft({ command: 'removeMemo', id: memo.id });
            },
          },
        ],
      },
    );
    return entries;
  }

  // ---------- 蜂の巣 ----------

  private wireBoard() {
    const board = this.board;
    // 押した：tap（まだ動いていない）・pan（空いた所を引いて蜂の巣を動かす）・move（セルを引いて動かす）
    // id：押したポインター（ほかの指・ペンは無視する）
    let press: { id: number; x: number; y: number; vx: number; vy: number; mode: 'tap' | 'pan' | 'move'; memo: string | null; hex: Hex } | null = null;
    let lastTap: { key: string; at: number } | null = null; // 1回目に押したセル・場所（2回目が早ければダブルクリック）
    const memoOf = (target: EventTarget | null) => (target instanceof Element ? (target.closest('[data-memo]')?.getAttribute('data-memo') ?? null) : null);
    board.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || press) return;
      // 空いたセルに書いている途中：何も書いていなければ閉じる（書いていれば残す）
      if (this.editing && !this.editorText.value.trim()) this.closeEditor();
      press = { id: e.pointerId, x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y, mode: 'tap', memo: memoOf(e.target), hex: this.hexAt(e.clientX, e.clientY) };
      board.setPointerCapture(e.pointerId);
    });
    const inside = (e: PointerEvent) => {
      const r = board.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    };
    board.addEventListener('pointermove', (e) => {
      if (!press || e.pointerId !== press.id) return;
      const dx = e.clientX - press.x;
      const dy = e.clientY - press.y;
      if (press.mode === 'tap') {
        if (Math.hypot(dx, dy) < 4) return;
        press.mode = press.memo ? 'move' : 'pan';
        board.classList.add(press.mode === 'move' ? 'moving' : 'panning');
      }
      if (press.mode === 'pan') {
        this.view = { x: press.vx + dx, y: press.vy + dy };
      } else if (press.memo) {
        // 蜂の巣の外へ出た：落とす先なし（離すと、動かすのをやめる）
        if (!inside(e)) {
          this.moving = { id: press.memo, at: this.boardPoint(e.clientX, e.clientY), target: null };
          this.renderHive();
          return;
        }
        // 端の近く（内側）まで引いたら、蜂の巣も少し動かす（遠くへ運べるように）
        const rect = board.getBoundingClientRect();
        const edge = 18;
        const step = 6;
        if (e.clientX < rect.left + edge) this.view = { ...this.view, x: this.view.x + step };
        else if (e.clientX > rect.right - edge) this.view = { ...this.view, x: this.view.x - step };
        if (e.clientY < rect.top + edge) this.view = { ...this.view, y: this.view.y + step };
        else if (e.clientY > rect.bottom - edge) this.view = { ...this.view, y: this.view.y - step };
        this.moving = { id: press.memo, at: this.boardPoint(e.clientX, e.clientY), target: this.hexAt(e.clientX, e.clientY) };
      }
      this.renderHive();
    });
    const end = (e: PointerEvent) => {
      if (!press || e.pointerId !== press.id) return;
      const { mode, memo, hex } = press;
      press = null;
      board.classList.remove('panning', 'moving');
      const moving = this.moving;
      this.moving = null;
      if (mode === 'move') {
        // 蜂の巣の外で離した：動かさない（見えない所に落とさない）
        if (moving?.target && inside(e)) this.drop(moving.id, moving.target);
        lastTap = null;
        this.renderHive();
        this.markList();
        return;
      }
      if (mode === 'pan') {
        lastTap = null;
        if (moving) this.renderHive();
        return;
      }
      // 同じセル・同じ場所を続けて押した：セルならコメントへ、空いたセルならそこに書く
      const key = memo ?? `hex:${hexKey(hex)}`;
      if (lastTap?.key === key && e.timeStamp - lastTap.at < 450) {
        lastTap = null;
        if (memo) {
          const target = this.cells.find((m) => m.id === memo);
          if (target && !isSpecialCell(target)) this.toPost(memo);
        } else {
          this.openEditor(hex);
        }
        return;
      }
      lastTap = { key, at: e.timeStamp };
      this.select(memo);
    };
    board.addEventListener('pointerup', end);
    board.addEventListener('pointercancel', (e) => {
      if (press && e.pointerId !== press.id) return;
      press = null;
      this.moving = null;
      board.classList.remove('panning', 'moving');
      this.renderHive();
    });
    board.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // キーボード（メニューキー・Shift+F10）で開いたときは、印を付けたセルのメニュー
      const keyboard = isKeyboardMenu(e);
      const id = keyboard ? this.selected : memoOf(e.target);
      const memo = this.cells.find((m) => m.id === id);
      if (!memo) {
        // 空いたセル：そこにメモを書く
        const hex = this.hexAt(e.clientX, e.clientY);
        if (!keyboard && !this.occupied(hex)) {
          this.deps.menu.open(e.clientX, e.clientY, [{ label: tr('ここにメモを書く'), hint: tr('ダブルクリック'), run: () => this.openEditor(hex) }]);
        }
        return;
      }
      this.select(memo.id);
      const at = keyboard ? cornerOf(board.querySelector(`[data-memo="${memo.id}"]`) ?? board) : { x: e.clientX, y: e.clientY };
      this.deps.menu.open(at.x, at.y, this.menuFor(memo, 'cell'));
      if (keyboard) this.deps.menu.focusFirst();
    });
    board.addEventListener(
      'wheel',
      (e) => {
        // 上下左右に動かす（Shift＋ホイールは左右）
        e.preventDefault();
        const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? HIVE_H : 1;
        let dx = e.deltaX * unit;
        let dy = e.deltaY * unit;
        if (e.shiftKey && dx === 0) [dx, dy] = [dy, 0]; // Windows では、Shift＋ホイールはもう左右として届く
        this.view = { x: this.view.x - dx, y: this.view.y - dy };
        this.renderHive();
      },
      { passive: false },
    );
    board.addEventListener('keydown', (e) => {
      const step = 24;
      const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      const m = moves[e.key];
      if (m) {
        e.preventDefault();
        this.view = { x: this.view.x + m[0], y: this.view.y + m[1] };
        this.renderHive();
      } else if (e.key === 'Enter' && this.selected) {
        e.preventDefault();
        this.toPost(this.selected);
      }
    });
  }

  private renderHive() {
    if (this.collapsed) return;
    const board = this.board;
    const w = board.clientWidth || 280;
    const h = board.clientHeight || HIVE_H;
    const left = -w / 2 - this.view.x;
    const top = -h / 2 - this.view.y;
    board.setAttribute('viewBox', `${left} ${top} ${w} ${h}`);
    this.placeEditor(left, top, w, h);
    const nodes: SVGElement[] = [];
    // 空いたセルの格子（見えている所だけ）
    const grid = svg('g', { class: 'memo-pad-grid' });
    const r0 = Math.floor(top / (SIZE * 1.5)) - 1;
    const r1 = Math.ceil((top + h) / (SIZE * 1.5)) + 1;
    for (let r = r0; r <= r1; r++) {
      const q0 = Math.floor(left / (SIZE * Math.sqrt(3)) - r / 2) - 1;
      const q1 = Math.ceil((left + w) / (SIZE * Math.sqrt(3)) - r / 2) + 1;
      for (let q = q0; q <= q1; q++) {
        const p = hexToPixel({ q, r }, SIZE);
        grid.append(svg('polygon', { points: hexCorners(p.x, p.y, FACE) }));
      }
    }
    nodes.push(grid);
    // 右のメモのシートに移したタブ（頭の文字だけ）
    for (const tab of this.deps.tabs()) {
      if (tab.sheet !== this.shown) continue;
      const p = hexToPixel(tab.pos, SIZE);
      const g = svg('g', { class: 'memo-pad-cell tab' });
      g.append(svg('polygon', { class: 'hex', points: hexCorners(p.x, p.y, FACE) }), text(p.x, p.y + 4, initialOf(tab), 'tab-letter'), svg('title', {}, tab.title || tab.url));
      nodes.push(g);
    }
    let lifted: SVGElement | null = null; // 動かしているセル（いちばん上に描く）
    for (const memo of this.cells) {
      const dragging = this.moving?.id === memo.id;
      const p = dragging && this.moving ? this.moving.at : hexToPixel(memo.pos, SIZE);
      const kind = memo.portal ? 'portal' : memo.bot ? 'bot' : memo.app ? 'app' : memo.capture ? 'capture' : memo.by?.who === 'bot' ? 'bot-reply' : memo.by ? 'ai' : 'memo';
      const cls = ['memo-pad-cell', kind, memo.id === this.selected ? 'sel' : '', memo.id === this.flashed ? 'flash' : '', dragging ? 'dragging' : ''].filter(Boolean).join(' ');
      const g = svg('g', { class: cls, 'data-memo': memo.id });
      g.append(svg('polygon', { class: 'hex', points: hexCorners(p.x, p.y, FACE) }));
      const label = memo.portal ? [tr('入口')] : memo.bot ? [tr('ボット')] : memo.app ? [tr('アプリ')] : memo.capture ? [tr('撮影')] : memo.text ? cellLines(memo.text) : [memo.image ? tr('画像') : '…'];
      label.forEach((line, i) => g.append(text(p.x, p.y + 3 + (label.length === 1 ? 0 : (i - 0.5) * 9.5), line, 'cell-text')));
      if (memo.replies.length > 0) {
        g.append(svg('circle', { class: 'badge', cx: String(p.x + 11), cy: String(p.y - 12), r: '5' }));
        g.append(text(p.x + 11, p.y - 9.7, String(Math.min(99, memo.replies.length)), 'badge-text'));
      }
      g.append(
        svg(
          'title',
          {},
          memo.portal
            ? tr('シートへの入口')
            : memo.bot
              ? tr('ボットのセル{0}（左の盤面で押すと Grok Bot アプリが開きます）', { 0: memo.text ? `「${memo.text}」` : '' })
              : memo.app
                ? tr('アプリのセル（左の盤面でダブルクリックすると、中央に出します）')
                : memo.capture
                  ? tr('撮ったもの（左の盤面でダブルクリックすると、右の撮影で開きます）')
                  : `${memo.text || tr('（画像のメモ）')}${memo.replies.length ? tr('（返信 {0}）', { 0: memo.replies.length }) : ''}`,
        ),
      );
      if (dragging) lifted = g;
      else nodes.push(g);
    }
    // 落とす先・書いている場所（点線の六角形）。セルの上に重ねる（入れ替え・入口へ移すのが見えるように）
    const mark = this.moving ? this.moving.target : this.editing;
    if (mark) {
      const p = hexToPixel(mark, SIZE);
      const dragged = this.cells.find((m) => m.id === this.moving?.id);
      const under = this.moving ? this.cells.find((m) => m.id !== dragged?.id && hexKey(m.pos) === hexKey(mark)) : undefined;
      const cls = !this.moving ? 'memo-pad-new' : under?.portal && !dragged?.portal ? 'memo-pad-drop into-portal' : 'memo-pad-drop';
      const target = svg('polygon', { class: cls, points: hexCorners(p.x, p.y, FACE) });
      if (cls.includes('into-portal')) target.append(svg('title', {}, tr('この入口のシートへ移す')));
      nodes.push(target);
    }
    if (lifted) nodes.push(lifted);
    board.replaceChildren(...nodes);
  }

  // ---------- 一覧 ----------

  private writingInList() {
    const active = document.activeElement;
    return (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) && this.list.contains(active);
  }

  // 印（選んだ・光らせた）だけを付け直す（描き直さない）
  private markList() {
    for (const item of this.list.querySelectorAll<HTMLElement>('[data-memo]')) {
      item.classList.toggle('sel', item.dataset.memo === this.selected);
    }
    this.renderStrip();
  }

  // 選んだコメントのタグ（付いているタグ・＋タグ・タグのボタン）。選んだコメントが変わったか、タグ・ボタンが変わったときだけ描き直す
  private renderStrip() {
    const active = document.activeElement instanceof HTMLElement && this.tagStrip.contains(document.activeElement) ? document.activeElement : null;
    if (active instanceof HTMLInputElement) return; // 「＋タグ」に書いている途中
    const memo = this.ready ? this.memos.find((m) => m.id === this.selected) : undefined;
    const tags = memo?.tags ?? [];
    const key = `${memo ? `${memo.id}:${tags.join(',')}` : '-'}|${this.deps.tagPad.key}`;
    if (key === this.stripKey) return;
    this.stripKey = key;
    const focusKey = active?.dataset.focusKey;
    const head = el('div', 'memo-pad-tagstrip-head');
    head.append(el('b', '', tr('選んだコメントのタグ')));
    if (!memo) {
      this.tagStrip.classList.add('empty');
      head.append(el('span', '', tr('コメント（か蜂の巣のセル）を1回押すと、ここでタグを付けられます')));
      this.tagStrip.replaceChildren(head);
      return;
    }
    this.tagStrip.classList.remove('empty');
    const text = memo.text || (memo.image ? tr('（画像のメモ）') : '');
    const snippet = [...text.replace(/\s+/g, ' ').trim()];
    head.append(el('span', '', snippet.length > 24 ? `${snippet.slice(0, 24).join('')}…` : snippet.join('')));
    const target = { tags, what: tr('このコメント'), change: (add: string[], remove: string[]) => this.deps.changeTags(memo.id, add, remove) };
    this.tagStrip.replaceChildren(head, tagArea(target, { editable: true, pad: this.deps.tagPad, focusKey: `strip${memo.id}:`, toast: (t) => this.say(t) }));
    if (focusKey) this.tagStrip.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  }

  private renderList(force = false) {
    const key = [
      this.ready,
      this.memos.map((m) => `${m.id}:${m.text}:${m.image ? 1 : 0}:${m.by?.name ?? ''}:${m.label ?? ''}:${(m.tags ?? []).join(',')}:${m.replies.map((r) => `${r.id}/${r.editedAt ?? ''}/${r.text}/${r.quote?.text ?? ''}/${r.image ?? ''}/${r.image && this.deps.thread.shot?.(r.image) ? 1 : 0}`).join('.')}`).join('\u0001'),
      this.deps.thread.pending.map((p) => `${p.key}:${p.parent}:${p.who}`).join(','),
    ].join('|');
    if (!force && key === this.listKey) {
      this.markList();
      return;
    }
    if (this.writingInList() && !force) {
      this.listDirty = true;
      return;
    }
    this.listKey = key;
    this.listDirty = false;
    const active = document.activeElement instanceof HTMLElement && this.list.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = active?.dataset.focusKey ?? (active?.dataset.memo ? `post:${active.dataset.memo}` : undefined);
    const top = this.list.scrollTop;
    const nodes: HTMLElement[] = [];
    if (!this.ready) {
      nodes.push(el('div', 'memo-pad-empty', tr('読み込んでいます…')));
    } else if (this.memos.length === 0) {
      nodes.push(el('div', 'memo-pad-empty', tr('まだありません。上の欄に書くと、ここと蜂の巣に出ます（左のシートの一覧の「{0}」にも出ます）。', { 0: this.sheetInfo(this.shown).name })));
    }
    for (const memo of this.memos) nodes.push(this.post(memo));
    this.list.replaceChildren(...nodes);
    this.list.scrollTop = top;
    if (focusKey) {
      const target = focusKey.startsWith('post:')
        ? this.list.querySelector<HTMLElement>(`[data-memo="${focusKey.slice(5)}"]`)
        : this.list.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`);
      target?.focus({ preventScroll: true });
    }
    this.renderStrip();
  }

  private post(memo: RightMemo): HTMLElement {
    // ボットから届いた返事（by.who 'bot'）は、相棒の考察と見た目を変える
    const fromBot = memo.by?.who === 'bot';
    const item = el('article', `memo-pad-post${fromBot ? ' bot-reply' : memo.by ? ' ai' : ''}${memo.id === this.selected ? ' sel' : ''}`);
    item.dataset.memo = memo.id;
    item.tabIndex = 0;
    const text = memo.text || (memo.image ? tr('（画像のメモ）') : '');
    const who = memo.by ? (fromBot ? tr('ボット（{0}）から届いた{1}', { 0: memo.by.name, 1: memo.label ?? '返事' }) : `${memo.by.name}（${memo.label ?? tr('考察')}）`) : tr('あなた');
    item.setAttribute('aria-label', `${memo.by && !fromBot ? memo.by.name : who}、${dateTimeOf(memo.createdAt)}：${text}`);
    const head = el('div', 'memo-pad-post-head');
    head.append(el('b', '', who), el('span', '', dateTimeOf(memo.createdAt)));
    const toCell = el('button', 'memo-pad-to-cell', tr('セルへ ↑'));
    toCell.type = 'button';
    toCell.title = tr('上の蜂の巣の、このコメントのセルへ移る（ダブルクリックでも）');
    toCell.addEventListener('click', () => this.toCell(memo.id));
    head.append(toCell);
    const ref: ThreadRef = { kind: 'memo', id: memo.id };
    collapseOnce(ref);
    item.append(head, el('div', 'memo-pad-post-text', text));
    // 付いたタグ（見せるだけ。付ける・外すのは、一覧のすぐ下の「選んだコメントのタグ」）
    const tags = memo.tags ?? [];
    if (tags.length > 0) item.append(tagArea({ tags, what: tr('このコメント'), change: () => undefined }, { editable: false }));
    item.append(threadBlock(ref, memo.replies, this.deps.thread));
    // 1回押す：印。2回押す・Enter：セルへ。右クリック：メニュー（ボタン・書く欄・返信の上では、それぞれの動き）
    const inControl = (target: EventTarget | null) => target instanceof Element && !!target.closest('button, a, input, textarea, select, .thread');
    item.addEventListener('click', (e) => {
      if (!inControl(e.target)) this.select(memo.id);
    });
    item.addEventListener('dblclick', (e) => {
      if (!inControl(e.target)) this.toCell(memo.id);
    });
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target === item) {
        e.preventDefault();
        this.toCell(memo.id);
      }
    });
    item.addEventListener('contextmenu', (e) => {
      if (e.target instanceof Element && e.target.closest('input, textarea')) return; // 書く欄では、ふだんのメニュー
      e.preventDefault();
      this.select(memo.id);
      const keyboard = isKeyboardMenu(e);
      const at = keyboard ? cornerOf(item) : { x: e.clientX, y: e.clientY };
      this.deps.menu.open(at.x, at.y, this.menuFor(memo, 'post'));
      if (keyboard) this.deps.menu.focusFirst();
    });
    return item;
  }

  // 上のタグから開く（右クリックの登録先）
  get header() {
    return this.head;
  }

  isCollapsed() {
    return this.collapsed;
  }

  expand() {
    if (!this.collapsed) return;
    this.collapsed = false;
    saveCollapsed(false);
    this.render();
  }
}

// キーボード（メニューキー・Shift+F10）で開いたメニューか（マウスの位置が無い）
function isKeyboardMenu(e: MouseEvent) {
  return (e instanceof PointerEvent && e.pointerType === '') || (e.clientX === 0 && e.clientY === 0) || e.button === -1;
}

// メニューを出す場所（その要素の左下）
function cornerOf(node: Element) {
  const r = node.getBoundingClientRect();
  return { x: r.left + 8, y: r.bottom };
}

// そのセルが蜂の巣の真ん中に来る動かし量
function centered(pos: Hex) {
  const p = hexToPixel(pos, SIZE);
  return { x: -p.x, y: -p.y };
}

function svg(tag: string, attrs: Record<string, string>, content?: string): SVGElement {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (content !== undefined) node.textContent = content;
  return node;
}

function text(x: number, y: number, content: string, cls: string): SVGElement {
  return svg('text', { x: x.toFixed(1), y: y.toFixed(1), class: cls, 'text-anchor': 'middle' }, content);
}

// 月/日 時:分
function stamp(ms: number) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function dateTimeOf(ms: number) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(PREFS_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

function saveCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(PREFS_KEY, collapsed ? 'collapsed' : 'open');
  } catch {
    // 保存できなくても動作は続ける
  }
}
