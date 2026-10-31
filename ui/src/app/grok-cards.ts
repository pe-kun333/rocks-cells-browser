import { BOT_FEATURES } from '../features';
// 下の区画の「メモ｜Grok Cards」（段 3・4）
//   段 "3" は常にオン（旗は廃止）なので、この「無いとき」の道は今は通らない。旗 "3" が無いときは、札も列も足さない。メモの升目・ドラッグ・詰めは、このタブを出していないあいだ今までどおり
import { t } from '../i18n';
import type { BotCardOrigin } from '../bot-replies';
import { cardsStageOn, onCardsStore, readCardsDevState, readCardsPlace, readColumnPrefs, readQueue, shownCountLine, writeCardsOpen, writeCardsPlace, writeColumnPrefs } from '../cards-stages';
import { columnKey, orderColumns, withAddedColumn } from '../grok-cards-columns';
import { cardArrivedLabel, requestArrivedLabel } from '../grok-cards-arrived';
import { cardFace, heldGroups, queueNote } from '../grok-cards-face';
import { cardsTabLabel, type CardsPlace } from '../grok-cards-place';
import { send } from '../bridge';
import { DRAFT_DAYS, peekDrafts, type BotDraft } from '../drafts';
import { CHAT_SENT, EVERYONE_ADDRESS, parseAddress, parseSent } from '../grok-cards-tags';
import type { RelayCommand } from '../types';
import { el } from '../util';
import { boardUpperEnabled, onBoardPlace, readBoardPlace, requestPlace, settleBoardPlace } from '../card-board-stages';
import { BOARD_TAB_TITLE_UPPER, boardTabClickFor, boardTabLabel, boardTabShownFor, chromeForPlaces, escActionFor, hostCommandFor, type UpperOwner } from '../memo-card-board-place';
import { boardTabClick, cardsTabClick, type Chrome, chromeFor, escAction, titleClick, type PaneTab } from '../grok-cards-tabs';
import { type BoardMemoPick, type BoardPlaceHook, type BoardSource, type BoardTemplateHook, MemoBoardPanel, type PaneHeightApi } from './memo-board-tab';

export interface GrokRequestSnap {
  requestId: string;
  botId: string;
  state: string;
  createdAt: number;
  no: string;
  group?: number;
  fileId?: string;
  origin?: BotCardOrigin[];
}

export interface GrokCardsData {
  cards: { id: string; text: string; tags: string[] }[];
  bots: { id: string; name: string }[];
  dock: string[];
  refused: boolean;
  requests?: GrokRequestSnap[];
  groups?: { group: number; states: string[] }[];
  requestsReady?: boolean;
}

export interface GrokCardsNotice {
  text: string;
  keep: boolean;
  address?: string;
  id?: string;
}

export interface GrokCardsMount {
  sync(memoOpen: boolean): void;
  consumeEsc(e: KeyboardEvent): boolean;
  onOpen(open: boolean): void;
  onData(data: GrokCardsData): void;
  onNotice(notice: GrokCardsNotice): void;
  onReply(id: string, text: string): void;
  setVisible(visible: boolean): void;
  dismiss(): void;
}

interface MountOpts {
  bandRow: HTMLElement;
  title: HTMLButtonElement;
  main: HTMLElement;
  band: HTMLElement;
  tools: HTMLElement;
  scroll: HTMLElement;
  countline: HTMLElement;
  status: HTMLElement;
  empty: HTMLElement;
  sheet: HTMLElement;
  page: HTMLElement;
  ask(action: RelayCommand): void;
  closeLists(): void;
  pane: HTMLElement;
  setCardsUpper(on: boolean, owner?: 'cards' | 'board'): void; // 上の入れ物（段 9・案 C）。owner は上に入れるもの（既定は Grok Cards）
  paneHeight?: PaneHeightApi; // 区画の高さの道（つまみと同じ）。「ボード」の［拡大］で使う
  boardSource?: BoardSource; // いま開いているメモのカードの写し（読むだけ）。「ボード」に描く
  boardPick?: BoardMemoPick; // ボードの見るメモの名札・選び口（M3）
  boardAsk?: (action: RelayCommand) => void; // ボードが左へ送る命令（無ければ ask と同じ）。下の面が、ボードの型の貼り付けを見分けるため
  boardTemplate?: BoardTemplateHook; // ボードの「型にする…」が借りる、下の区画の登録の小窓
  boardNotices?: { onNotice(fn: (text: string) => void): void; onUndoSend?(fn: (token: string, openMemo: string) => void): void }; // 左の知らせ（断られた理由など）。「ボード」の一言に出す。onUndoSend：型の貼り付けの「元に戻す」の印（B3-3b。ボードの Undo が使う）
}

export function mountGrokCards(o: MountOpts): GrokCardsMount {
  if (!cardsStageOn('3')) {
    return {
      sync() {},
      consumeEsc() {
        return false;
      },
      onOpen() {},
      onData() {},
      onNotice() {},
      onReply() {},
      setVisible() {},
      dismiss() {},
    };
  }
  return new GrokCardsView(o);
}

const BOARD_TAB_TITLE = t('ボード（メモのカードを自由に置く面。今は準備中）');

class GrokCardsView {
  private tab: PaneTab = 'memo';
  private memoOpen = false;
  private data: GrokCardsData = { cards: [], bots: [], dock: [], refused: false };
  private requests: GrokRequestSnap[] = [];
  private groups: { group: number; states: string[] }[] = [];
  private requestsReady = false;
  private queue: BotDraft[] = [];
  private notice = '';
  private readonly replies = new Map<string, string>();
  private picker = false;
  private readonly compose = new Map<string, string>();
  private readonly composeOpen = new Set<string>();
  private readonly expanded = new Set<string>();
  private readonly edits = new Map<string, string>();
  private readonly root = el('div', 'grok-cards');
  private readonly tabBtn: HTMLButtonElement;
  private readonly tabCount: HTMLElement;
  private body: HTMLElement | null = null;
  private placeBar: HTMLElement | null = null;
  private sentUpper = false;
  private board: MemoBoardPanel | null = null;
  private boardBtn: HTMLButtonElement | null = null;
  private placing = false; // 置き場を書いている最中（途中の状態で面を組み替えない。書き終えてから 1 回だけ組み替える）
  private boardUp = false; // いま、ボードの面を上の入れ物に入れている（案 C）
  private placeUi = false; // ボードに「上に出す」ボタンを出している（外れたら 1 回だけ戻す）

  constructor(private readonly o: MountOpts) {
    this.tab = 'memo';
    this.root.hidden = true;
    this.o.main.append(this.root);
    this.tabBtn = el('button', 'grok-cards-tab', 'Grok Cards');
    this.tabBtn.type = 'button';
    this.tabBtn.dataset.key = 'grok-tab';
    this.tabBtn.setAttribute('role', 'tab');
    this.tabBtn.setAttribute('aria-selected', 'false');
    this.tabBtn.title = t('Grok Cards（ボットへの下書き）');
    this.tabBtn.addEventListener('click', () => {
      if (cardsTabClick(this.isUpper()) === 'place-bottom') {
        this.setCardsPlace('bottom');
        return;
      }
      this.showCards();
    });
    this.tabCount = el('span', 'grok-cards-tab-count');
    this.tabCount.setAttribute('aria-hidden', 'true');
    this.o.title.setAttribute('role', 'tab');
    this.o.title.setAttribute('aria-selected', 'true');
    this.o.title.addEventListener(
      'click',
      (e) => {
        if (titleClick(this.tab) !== 'show-memo') return;
        e.preventDefault();
        e.stopPropagation();
        this.showMemo();
      },
      true,
    );
    this.o.title.after(this.tabBtn, this.tabCount);
    onCardsStore(() => {
      this.applyPlace();
      if (this.showingCards()) void this.loadQueue();
    });
    writeCardsOpen(false);
    // 起動時に、Grok Cards とボードが両方「上」と残っていたら、ボードを下に戻す（鍵も書き戻す）。一言は上に残る Grok Cards の状態欄に出す（段 "2" が無ければ何もしない）
    if (boardUpperEnabled()) this.notice = settleBoardPlace();
    this.applyPlace();
    this.ensureBoard();
    onBoardPlace(() => {
      if (this.placing || !(boardUpperEnabled() || this.boardUp)) return; // 段 "2" が無い人には、今までのまま何もしない
      this.applyPlace();
    });
  }

  sync(memoOpen: boolean) {
    this.memoOpen = memoOpen;
    this.applyChrome();
  }

  consumeEsc(e: KeyboardEvent): boolean {
    if (this.tab === 'memo') return this.consumeBoardUpperEsc(e);
    const target = e.target;
    const inField = target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;
    const action = escAction(this.tab, { inField, picker: this.picker, boardExpanded: this.board?.expanded, boardDragging: this.board?.dragging, boardSelected: this.board?.hasSelection });
    if (action === 'ignore') return false;
    e.preventDefault();
    if (action === 'close-picker') {
      this.picker = false;
      this.render();
      return true;
    }
    if (action === 'cancel-drag') {
      this.board?.cancelDrag();
      return true;
    }
    if (action === 'clear-selection') {
      this.board?.clearSelection();
      return true;
    }
    if (action === 'shrink-board') {
      this.board?.shrink();
      return true;
    }
    const active = document.activeElement;
    if (active instanceof HTMLElement && (this.root.contains(active) || this.board?.root.contains(active))) active.blur();
    this.showMemo();
    return true;
  }

  // ボードを上に出しているあいだの Esc（C4）。つまむのを取り消す→選びを外す、まで。縮めない・メモのタブへ戻さない・下へ戻さない（戻すのは［下に戻す］だけ。U9）
  //   下の帯のメモ側（フォーカスが下の帯・境目）の Esc は、メモの今までの Esc に任せる。上に出していないとき（段 "2" 無しも含む）は、今までどおり何もしない
  private consumeBoardUpperEsc(e: KeyboardEvent): boolean {
    const board = this.board;
    if (!board || !this.isBoardUpper()) return false;
    if (board.ownsMenu(e)) {
      e.preventDefault(); // ボードのメニューの Esc は、メニューを閉じるだけ（メニュー自身が閉じる）。メモの帯は閉じない・選びも外さない（M3）
      return true;
    }
    if (!board.keysAllowed(e.target)) return false;
    const target = e.target;
    const inField = target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;
    const action = escActionFor('memo', { inField, picker: false, boardDragging: board.dragging, boardSelected: board.hasSelection }, true);
    if (action === 'cancel-drag') {
      e.preventDefault();
      board.cancelDrag();
      return true;
    }
    if (action === 'clear-selection') {
      e.preventDefault();
      board.clearSelection();
      return true;
    }
    // 取り消すものが無いとき：ボードの面の中（ボタンなど。欄は除く）にフォーカスがあるなら、何もしない（メモの帯を閉じない）。どこにも無いときは、メモの今までの Esc に任せる
    if (!inField && board.hasFocusInside(target)) {
      e.preventDefault();
      return true;
    }
    return false;
  }

  onOpen(open: boolean) {
    if (open) this.applyOpen();
    else if (this.tab !== 'board') this.applyClosed(); // ボードを見ているときは、左の「閉じた」知らせでボードから追い出さない
  }

  onData(data: GrokCardsData) {
    this.data = {
      cards: Array.isArray(data.cards) ? data.cards : [],
      bots: Array.isArray(data.bots) ? data.bots : [],
      dock: Array.isArray(data.dock) ? data.dock : [],
      refused: data.refused === true,
    };
    this.requests = Array.isArray(data.requests) ? data.requests : [];
    this.groups = Array.isArray(data.groups) ? data.groups : [];
    this.requestsReady = data.requestsReady === true;
    if (this.showingCards()) this.render();
  }

  onReply(id: string, text: string) {
    this.replies.set(id, text);
    this.expanded.add(id);
    if (this.showingCards()) this.render();
  }

  onNotice(notice: GrokCardsNotice) {
    this.notice = notice.text;
    if (!notice.keep && notice.address) {
      this.compose.set(notice.address, '');
      this.composeOpen.delete(notice.address);
    }
    if (!notice.keep && notice.id) this.edits.delete(notice.id);
    if (this.showingCards()) this.render();
  }

  setVisible(visible: boolean) {
    if (!visible) writeCardsOpen(false);
    else if (this.tab === 'cards') writeCardsOpen(true);
  }

  dismiss() {
    if (this.tab !== 'cards') return;
    this.applyClosed();
  }

  private showCards() {
    const already = this.tab === 'cards';
    this.applyOpen();
    if (!already) this.o.ask({ command: 'openGrokCards' });
  }

  private showMemo() {
    const was = this.tab === 'cards';
    this.applyClosed();
    if (was) this.o.ask({ command: 'closeGrokCards' });
  }

  // ボードは左の台帳に関わらない面。Grok Cards を見ていたなら、左へ「閉じた」と伝える（札の旗も下ろす）
  private showBoard() {
    if (boardTabClick(this.tab) === 'stay' || !this.board) return;
    const was = this.tab === 'cards';
    this.tab = 'board';
    writeCardsOpen(false);
    this.o.closeLists();
    this.applyChrome();
    if (was) this.o.ask({ command: 'closeGrokCards' });
  }

  private applyOpen() {
    this.leaveBoard();
    this.tab = 'cards';
    writeCardsOpen(true);
    this.o.closeLists();
    this.applyChrome();
    void this.loadQueue();
  }

  private applyClosed() {
    this.leaveBoard();
    this.tab = 'memo';
    writeCardsOpen(false);
    this.applyChrome();
  }

  private applyChrome() {
    const upper = this.isUpper();
    const bu = this.isBoardUpper();
    const base = { tab: this.tab, upper, memoOpen: this.memoOpen, sheetEmpty: this.o.sheet.textContent?.trim() === '' };
    const c: Chrome = bu ? chromeForPlaces({ ...base, boardUpper: true }) : chromeFor(base);
    this.root.hidden = c.cardsRootHidden;
    this.tabBtn.setAttribute('aria-selected', String(c.cardsSelected));
    this.o.title.setAttribute('aria-selected', String(c.memoSelected));
    this.paintBoardTab(c.boardSelected);
    this.paintCount();
    // メモが無くても帯は出す（この面から Grok Cards を開ける。旗が無いときは、この関数自体が呼ばれない）
    this.o.band.hidden = c.band;
    this.o.main.hidden = c.main;
    this.o.scroll.hidden = c.scroll;
    this.o.tools.hidden = c.tools;
    this.o.countline.hidden = c.countline;
    this.o.status.hidden = c.status;
    this.o.empty.hidden = c.empty;
    this.o.sheet.hidden = c.sheet;
    this.o.page.hidden = c.page;
    // ボードの面は、主の枠を出したあとで見せる（面の大きさを測るため）
    this.board?.setHidden(c.boardRootHidden);
    // ボタンと［拡大］の出し分け。段 "2" が一度も入っていない人には触らない（外れたときは 1 回だけ元に戻す）
    const placeOn = boardUpperEnabled();
    if (this.board && (placeOn || this.placeUi)) {
      this.board.setPlace(placeOn, bu);
      this.placeUi = placeOn || bu;
    }
  }

  // ボードのタブと面を作る（旗は廃止したので常に作る。2026-10-25）
  private ensureBoard() {
    if (!this.board) {
      const place: BoardPlaceHook = { request: (to) => this.placeBoard(to) };
      const panel = new MemoBoardPanel(this.o.paneHeight, this.o.boardSource, { ask: (action) => (this.o.boardAsk ?? this.o.ask)(action), pick: this.o.boardPick, onNotice: this.o.boardNotices?.onNotice, onUndoSend: this.o.boardNotices?.onUndoSend, template: this.o.boardTemplate, place });
      const btn = el('button', 'grok-cards-tab board-tab', t('ボード'));
      btn.type = 'button';
      btn.dataset.key = 'board-tab';
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', 'false');
      btn.title = BOARD_TAB_TITLE;
      btn.addEventListener('click', () => (boardTabClickFor(this.tab, this.isBoardUpper()) === 'place-bottom' ? this.placeBoard('bottom') : this.showBoard()));
      this.tabCount.after(btn);
      this.o.main.append(panel.root);
      this.board = panel;
      this.boardBtn = btn;
    }
    if (boardUpperEnabled() || this.boardUp) this.applyPlace(); // 置き場も組み替える
    else this.applyChrome();
  }

  private paintBoardTab(selected: boolean) {
    if (!this.boardBtn) return;
    const bu = this.isBoardUpper();
    this.boardBtn.hidden = !boardTabShownFor(true, this.tab, this.isUpper(), bu);
    this.boardBtn.setAttribute('aria-selected', String(selected));
    this.boardBtn.textContent = boardTabLabel(bu ? 'upper' : 'bottom');
    this.boardBtn.classList.toggle('is-upper', bu);
    this.boardBtn.title = bu ? BOARD_TAB_TITLE_UPPER : BOARD_TAB_TITLE;
  }

  // ボードを離れるとき、このタブで広げた高さを元へ戻す
  private leaveBoard() {
    if (this.tab === 'board') this.board?.leave();
  }
  private paintCount() {
    const upper = this.isUpper();
    const line = shownCountLine();
    this.tabBtn.textContent = cardsTabLabel(upper ? 'upper' : 'bottom');
    this.tabBtn.classList.toggle('is-upper', upper);
    this.tabCount.textContent = upper ? '' : line;
    this.tabBtn.title = upper ? t('押すと下の面に戻します') : line ? `Grok Cards（${line}）` : t('Grok Cards（ボットへの下書き）');
  }

  private isUpper(): boolean {
    return readCardsPlace() === 'upper';
  }

  // ボードを上の入れ物に入れているか（段 "1" と "2" があり、ボードの面があり、置き場が上で、Grok Cards が上を持っていないとき）
  private isBoardUpper(): boolean {
    return !!this.board && boardUpperEnabled() && !this.isUpper() && readBoardPlace() === 'upper';
  }

  // 段 9 が無いときは、札の根の子は今までどおり（帯も包みも足さない）。上半分のときだけ札の根を上の枠へ移す
  private applyPlace() {
    if (this.placing) return;
    const stage9 = cardsStageOn('9');
    const place = readCardsPlace();
    const upper = place === 'upper';
    const bu = this.isBoardUpper();
    if (!stage9 && this.body) {
      this.dropStage9Chrome();
      if (this.tab === 'cards') this.render();
    }
    // ボードが上に出るとき、下の帯でボードを見ていたなら、下のタブはメモへ（上のボードは下の帯のタブにならない）。広げていた高さは戻す
    if (bu && this.tab === 'board') {
      this.leaveBoard();
      this.tab = 'memo';
    }
    this.boardUp = bu;
    const owner: UpperOwner = upper ? 'cards' : bu ? 'board' : 'none';
    this.syncUpperDom(owner);
    this.pushHost(owner);
    if (stage9 && !this.body && (upper || this.tab === 'cards')) {
      if (this.root.querySelector('.grok-cards-cols')) this.render();
      else void this.loadQueue();
    }
    this.paintPlace();
    this.applyChrome();
  }

  // owner：上の入れ物に入れるもの。入れないほう（と、誰も持たないとき）は下の主の枠へ戻す。戻すのは setCardsUpper(false) の前（先に子を出しておく）
  private syncUpperDom(owner: UpperOwner) {
    const down = (node: HTMLElement | undefined) => {
      if (!node || node.parentElement === this.o.main) return;
      const mark = fieldMark(node);
      this.o.main.append(node);
      restoreField(node, mark);
    };
    if (owner !== 'none') {
      const mine = owner === 'cards' ? this.root : this.board?.root;
      down(owner === 'cards' ? this.board?.root : this.root); // 持たないほうは下へ
      this.o.setCardsUpper(true, owner);
      const slot = this.o.pane.querySelector(':scope > .grok-cards-upper');
      if (mine && slot && mine.parentElement !== slot) {
        const mark = fieldMark(mine);
        slot.append(mine);
        restoreField(mine, mark);
      }
      return;
    }
    down(this.root);
    down(this.board?.root);
    this.o.setCardsUpper(false);
  }

  private pushHost(owner: UpperOwner) {
    const cmd = hostCommandFor(owner, this.sentUpper);
    if (cmd === null || (cmd === 'upper') === this.sentUpper) return;
    this.sentUpper = cmd === 'upper';
    if (cmd === 'upper') send({ type: 'setSidebar', side: 'memo', place: 'upper', visible: true });
    else send({ type: 'setSidebar', side: 'memo', place: '' });
  }

  // Grok Cards の「上の半分」「下の面」を押した。ボードを上に出せる（段 "2"）ときは、取り合い（あとから出したほうが上）も一緒に決める。一言は Grok Cards の状態欄へ
  private setCardsPlace(place: CardsPlace) {
    if (!this.board || !boardUpperEnabled()) {
      writeCardsPlace(place);
      return;
    }
    const note = this.requestPlaced({ who: 'cards', to: place });
    if (note) {
      this.notice = note;
      if (this.showingCards()) this.render();
    }
  }

  // ボードの「上に出す／下に戻す」（ボタン・ボードのタブ）。取り合いの一言はボードの一言欄へ。下に戻したら、そのままボードを下の帯で見せる
  private placeBoard(to: 'upper' | 'bottom') {
    if (!this.board || !boardUpperEnabled()) return;
    const note = this.requestPlaced({ who: 'board', to });
    if (to === 'bottom') this.showBoard();
    if (note) this.board.notify(note);
  }

  // 置き場の鍵を書く（途中の状態で面を組み替えない）→ 1 回だけ組み替える。取り合いの一言を返す（無ければ空）
  private requestPlaced(req: Parameters<typeof requestPlace>[0]): string {
    let note = '';
    this.placing = true;
    try {
      note = requestPlace(req).note;
    } finally {
      this.placing = false;
    }
    this.applyPlace();
    return note;
  }

  private renderHost(): HTMLElement {
    if (!cardsStageOn('9')) {
      this.dropStage9Chrome();
      return this.root;
    }
    if (!this.body || !this.placeBar) {
      this.body = el('div', 'grok-cards-body');
      this.placeBar = this.buildPlaceBar();
      const kids = [...this.root.childNodes];
      this.root.replaceChildren(this.placeBar, this.body);
      for (const kid of kids) this.body.append(kid);
    }
    this.paintPlace();
    return this.body;
  }

  private dropStage9Chrome() {
    if (!this.body) return;
    const kids = [...this.body.childNodes];
    this.placeBar?.remove();
    this.body.remove();
    this.root.append(...kids);
    this.body = null;
    this.placeBar = null;
  }

  private buildPlaceBar(): HTMLElement {
    const bar = el('div', 'grok-cards-place');
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', '出す場所');
    bar.append(el('span', 'grok-cards-place-label', t('出す場所')));
    for (const [place, label] of [
      ['bottom', t('下の面')],
      ['upper', t('上の半分')],
    ] as const) {
      const button = el('button', 'grok-cards-place-btn', label);
      button.type = 'button';
      button.dataset.place = place;
      if (place === 'upper') button.title = t('メモと一緒に見ます。下のタブから戻れます');
      button.addEventListener('click', () => this.setCardsPlace(place));
      bar.append(button);
    }
    return bar;
  }

  private paintPlace() {
    if (!this.placeBar) return;
    const place = readCardsPlace();
    for (const button of this.placeBar.querySelectorAll<HTMLButtonElement>('.grok-cards-place-btn')) {
      button.setAttribute('aria-pressed', String(button.dataset.place === place));
    }
  }

  private async loadQueue() {
    try {
      this.queue = await peekDrafts();
    } catch {
      this.queue = [];
    }
    if (this.showingCards()) this.render();
  }

  private showingCards(): boolean {
    return this.tab === 'cards' || this.isUpper();
  }

  private render() {
    const active = document.activeElement;
    const key = active instanceof HTMLElement && this.root.contains(active) ? (active.dataset.key ?? '') : '';
    const sel = active instanceof HTMLTextAreaElement ? active.selectionStart : null;
    const names = new Map(this.data.bots.map((bot) => [bot.id, bot.name]));
    for (const draft of this.queue) if (draft.botName) names.set(draft.botId, names.get(draft.botId) || draft.botName);
    const addressed: string[] = [];
    for (const card of this.data.cards) {
      const parsed = parseAddress(card.tags);
      if (parsed.address && parsed.address !== 'all') addressed.push(parsed.address);
    }
    for (const snap of readQueue()) if (snap.botId && snap.botId !== 'all') addressed.push(snap.botId);
    for (const draft of this.queue) if (draft.botId) addressed.push(draft.botId);
    const prefs = readColumnPrefs();
    const columns = orderColumns({
      dock: this.data.dock,
      extra: addressed,
      savedOrder: prefs.order,
      hidden: prefs.hidden,
      names,
    });
    const cols = el('div', 'grok-cards-cols');
    for (const column of columns) cols.append(this.column(column.address, column.title));
    if (cardsStageOn('7')) cols.append(this.addColumn(columns.map((column) => column.key), prefs.hidden));
    const note = el('div', 'grok-cards-note');
    const bits = [this.notice, this.data.refused ? t('台帳を読めていないので、下書きは保存できません。書いた文はこの欄に残しています') : ''].filter(Boolean);
    note.textContent = bits.join(' ');
    note.hidden = bits.length === 0;
    this.renderHost().replaceChildren(note, cols);
    this.paintCount();
    if (!key) return;
    const next = this.root.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    if (next instanceof HTMLTextAreaElement) {
      next.focus({ preventScroll: true });
      if (sel !== null) {
        const at = Math.min(sel, next.value.length);
        next.setSelectionRange(at, at);
      }
    }
  }

  private column(address: string, title: string): HTMLElement {
    const col = el('section', 'grok-cards-col');
    col.setAttribute('aria-label', title);
    const head = el('h3', 'grok-cards-col-head', title);
    const add = el('button', 'grok-cards-add', t('＋下書き'));
    add.type = 'button';
    add.addEventListener('click', () => {
      if (!cardsStageOn('4')) {
        this.o.ask({ command: 'openNestForm', address });
        return;
      }
      if (this.composeOpen.has(address)) this.composeOpen.delete(address);
      else this.composeOpen.add(address);
      this.render();
      this.root.querySelector<HTMLTextAreaElement>(`[data-key="compose:${CSS.escape(address)}"]`)?.focus();
    });
    const write = el('button', 'grok-cards-add', t('小窓で書く'));
    write.type = 'button';
    if (!BOT_FEATURES) write.style.display = 'none'; // 公開版（rebuild-public.ps1）
    write.addEventListener('click', () => {
      this.o.ask({ command: 'askWithCards', to: address === 'all' ? '*all' : address });
    });
    const tools = el('div', 'grok-cards-col-tools');
    tools.append(add, write);
    col.append(head, tools);
    if (cardsStageOn('4') && this.composeOpen.has(address)) col.append(this.composer(address));
    const cards = this.data.cards.filter((card) => {
      const parsed = parseAddress(card.tags);
      if (!parsed.address) return address === 'all';
      return parsed.address === address;
    });
    const held = cardsStageOn('5') ? heldGroups(this.data.cards) : new Set<number>();
    const queued = this.queue.filter((draft) => draft.botId === address && (draft.group == null || !held.has(draft.group)));
    if (cards.length === 0 && queued.length === 0) col.append(el('p', 'grok-cards-empty', t('下書きはまだありません')));
    for (const card of cards) col.append(this.card(card));
    for (const draft of queued) col.append(this.queueCard(draft));
    return col;
  }

  private composer(address: string): HTMLElement {
    const form = el('form', 'grok-cards-compose');
    const text = el('textarea');
    text.dataset.key = `compose:${address}`;
    text.value = this.compose.get(address) ?? '';
    text.placeholder = t('頼む文');
    text.setAttribute('aria-label', '頼む文');
    text.addEventListener('input', () => this.compose.set(address, text.value));
    const save = el('button', 'grok-cards-save', t('下書きにする'));
    save.type = 'submit';
    form.append(text, save);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.compose.set(address, text.value);
      this.o.ask({ command: 'addGrokCard', address, text: text.value });
    });
    return form;
  }

  private card(card: { id: string; text: string; tags: string[] }): HTMLElement {
    const parsed = parseAddress(card.tags);
    const sent = parseSent(card.tags);
    const faced = cardsStageOn('5') || cardsStageOn('6') || cardsStageOn('7');
    const face = faced ? this.faceOf(card.tags, sent?.group ?? null) : { kind: 'draft' as const, label: '' };
    const box = el('article', `grok-card${face.kind === 'draft' ? '' : ` is-${face.kind}`}`);
    const open = this.expanded.has(card.id);
    const draftEdit = open && cardsStageOn('4') && face.kind === 'draft';
    if (draftEdit) {
      const text = el('textarea', 'grok-card-edit');
      text.dataset.key = `edit:${card.id}`;
      text.value = this.edits.get(card.id) ?? card.text;
      text.setAttribute('aria-label', '下書きの文');
      text.addEventListener('input', () => this.edits.set(card.id, text.value));
      text.addEventListener('blur', () => {
        const next = this.edits.get(card.id) ?? text.value;
        if (next !== card.text) this.o.ask({ command: 'setGrokCardText', id: card.id, text: next });
      });
      box.append(text);
    } else {
      const text = el('p', 'grok-card-text', card.text);
      if (open) text.style.webkitLineClamp = 'unset';
      box.append(text);
      if (open) box.classList.add('open');
    }
    if (face.label) box.append(el('p', 'grok-card-meta', face.label));
    const arrived = this.arrivedLine(card.tags);
    if (arrived) box.append(el('p', 'grok-card-meta grok-card-arrived', arrived));
    if (parsed.duplicate) box.append(el('p', 'grok-card-meta', t('宛て先が二つ')));
    const reply = this.replies.get(card.id);
    if (open && reply) box.append(el('p', 'grok-card-reply', reply));
    box.append(this.btn(open ? t('閉じる') : t('開く'), () => this.toggleOpen(card.id)));
    this.actions(box, card, face.kind, parsed.address);
    if (sent?.group != null && cardsStageOn('5')) {
      for (const draft of this.queue.filter((item) => item.group === sent.group)) box.append(this.queueCard(draft));
    }
    return box;
  }

  // 段 8。組の札はその組の席、1 件の札は 0/1 か 1/1。チャットだけ送った札は数えない
  private arrivedLine(tags: readonly string[]): string {
    if (!cardsStageOn('8')) return '';
    const sent = parseSent(tags);
    if (!sent) return '';
    if (sent.group !== null) return cardArrivedLabel(this.groups.find((item) => item.group === sent.group)?.states);
    if (sent.raw === CHAT_SENT) return '';
    return requestArrivedLabel(this.requests.find((item) => item.requestId === sent.raw)?.state);
  }

  private faceOf(tags: readonly string[], group: number | null) {
    const sent = parseSent(tags);
    const request = sent && sent.group === null ? (this.requests.find((item) => item.requestId === sent.raw) ?? null) : null;
    const groupStates = group == null ? null : (this.groups.find((item) => item.group === group)?.states ?? null);
    const queueLeft = group != null && this.queue.some((item) => item.group === group);
    return cardFace({
      tags,
      stage6: cardsStageOn('6'),
      stage7: cardsStageOn('7'),
      now: Date.now(),
      request: request ? { state: request.state, createdAt: request.createdAt } : null,
      groupStates,
      requestsReady: this.requestsReady,
      queueLeft,
      overdue: readCardsDevState().overdue === true,
    });
  }

  private actions(box: HTMLElement, card: { id: string; tags: string[] }, kind: string, address: string | null) {
    const sent = parseSent(card.tags);
    const request = sent && sent.group === null ? this.requests.find((item) => item.requestId === sent.raw) : undefined;
    const openApp = () => {
      if (address && address !== EVERYONE_ADDRESS) this.o.ask({ command: 'openGrokCardApp', id: card.id });
    };
    if (kind === 'draft' && cardsStageOn('5')) {
      box.append(this.btn(t('コピーして開く ↗'), () => this.o.ask({ command: 'copyGrokCard', id: card.id })));
      return;
    }
    if (kind === 'copied' || kind === 'waiting') {
      if (cardsStageOn('5') && address && address !== EVERYONE_ADDRESS) box.append(this.btn(t('アプリを開く ↗'), openApp));
      if (cardsStageOn('7') && request?.fileId) box.append(this.btn(t('回答を開く'), () => this.o.ask({ command: 'showGrokReply', id: card.id })));
      if (cardsStageOn('7') && sent?.group != null) box.append(this.btn(t('回答を開く'), () => this.o.ask({ command: 'botGroupRead', group: sent.group as number })));
      return;
    }
    if (kind === 'unpasted') {
      if (cardsStageOn('5') && address && address !== EVERYONE_ADDRESS) box.append(this.btn(t('↗ 開く'), openApp));
      if (cardsStageOn('6')) box.append(this.btn(t('貼った ✓'), () => this.o.ask({ command: 'markGrokCardPasted', id: card.id })));
      return;
    }
    if (kind === 'late') {
      box.append(this.btn(t('もう一度コピー'), () => this.o.ask({ command: 'copyGrokCard', id: card.id })));
      if (request) box.append(this.btn(t('待つのをやめる'), () => this.o.ask({ command: 'botStopWaiting', botId: request.botId, requestId: request.requestId })));
      return;
    }
    if (kind === 'replied' && request?.fileId) {
      box.append(this.btn(t('回答を開く'), () => this.o.ask({ command: 'showGrokReply', id: card.id })));
      box.append(this.btn(t('メモにする'), () => this.o.ask({ command: 'botToMemo', botId: request.botId, fileId: request.fileId as string, to: 'right' })));
      // 段 D6：出どころがある返事だけ。押すまで台帳は変わらない
      const origins = request.origin ?? [];
      origins.forEach((_, i) => {
        box.append(
          this.btn(
            origins.length === 1 ? t('カードにする') : t('カードにする（{0}）', { 0: i + 1 }),
            () => this.o.ask({ command: 'botToCard', botId: request.botId, fileId: request.fileId as string, origin: i }),
            t('押すまで台帳は変わりません。新しい一番上のカードを足し、元のカードから関連「補足」を 1 本引きます'),
          ),
        );
      });
      return;
    }
    if (kind === 'error') {
      box.append(this.btn(t('見る'), () => this.o.ask({ command: 'showGrokReply', id: card.id })));
      return;
    }
    if (kind === 'expired') {
      box.append(this.btn(t('もう一度下書きにする'), () => this.o.ask({ command: 'clearGrokCardSent', id: card.id })));
      box.append(this.btn(t('外す'), () => this.o.ask({ command: 'removeGrokCard', id: card.id })));
    }
  }

  private btn(label: string, run: () => void, title?: string): HTMLButtonElement {
    const button = el('button', 'grok-card-open', label);
    button.type = 'button';
    if (title) button.title = title;
    button.addEventListener('click', run);
    return button;
  }

  private toggleOpen(id: string) {
    if (this.expanded.has(id)) this.expanded.delete(id);
    else this.expanded.add(id);
    this.render();
  }

  private addColumn(current: string[], hidden: string[]): HTMLElement {
    const col = el('section', 'grok-cards-col grok-cards-addcol');
    col.setAttribute('aria-label', '列を足す');
    const button = el('button', 'grok-cards-add', t('＋ 列を足す'));
    button.type = 'button';
    button.addEventListener('click', () => {
      this.picker = !this.picker;
      this.render();
    });
    col.append(button);
    if (!this.picker) return col;
    const have = new Set(current);
    const choices = this.data.bots.filter((bot) => !have.has(columnKey(bot.id)));
    if (!choices.length) {
      col.append(el('p', 'grok-cards-empty', t('足せるボットはいません')));
      return col;
    }
    for (const bot of choices) {
      col.append(
        this.btn(bot.name, () => {
          const next = withAddedColumn(current, hidden, columnKey(bot.id));
          if (!next) return;
          writeColumnPrefs(next.order, next.hidden);
          this.picker = false;
          this.render();
        }),
      );
    }
    return col;
  }

  private queueCard(draft: BotDraft): HTMLElement {
    const aged = cardsStageOn('5') || cardsStageOn('7');
    const note = aged ? queueNote(draft.createdAt, Date.now(), DRAFT_DAYS) : { text: t('{0} 日で順番待ちから外れます', { 0: DRAFT_DAYS }), soon: false };
    const box = el('article', `grok-card queue${note.soon ? ' is-soon' : ''}`);
    box.append(el('p', 'grok-card-text', draft.text));
    const who = draft.botName ? `${draft.botName}。` : '';
    box.append(el('p', 'grok-card-meta', `${who}${note.text}`));
    return box;
  }
}

function fieldMark(root: HTMLElement): { key: string; start: number; end: number } | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLTextAreaElement) || !root.contains(active)) return null;
  return { key: active.dataset.key ?? '', start: active.selectionStart ?? 0, end: active.selectionEnd ?? 0 };
}

function restoreField(root: HTMLElement, mark: { key: string; start: number; end: number } | null) {
  if (!mark?.key) return;
  const next = root.querySelector<HTMLElement>(`[data-key="${CSS.escape(mark.key)}"]`);
  if (!(next instanceof HTMLTextAreaElement)) return;
  next.focus({ preventScroll: true });
  const start = Math.min(mark.start, next.value.length);
  const end = Math.min(mark.end, next.value.length);
  next.setSelectionRange(start, end);
}
