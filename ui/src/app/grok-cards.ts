// 下の区画の「メモ｜Grok Cards」（段 3・4）
//   旗 "3" が無いときは、札も列も足さない。メモの升目・ドラッグ・詰めは、このタブを出していないあいだ今までどおり
import { cardsStageOn, onCardsStore, readCardsDevState, readCardsPlace, readColumnPrefs, readQueue, shownCountLine, writeCardsOpen, writeCardsPlace, writeColumnPrefs } from '../cards-stages';
import { columnKey, orderColumns, withAddedColumn } from '../grok-cards-columns';
import { cardArrivedLabel, requestArrivedLabel } from '../grok-cards-arrived';
import { cardFace, heldGroups, queueNote } from '../grok-cards-face';
import { cardsTabLabel, hostPlaceCommand, type CardsPlace } from '../grok-cards-place';
import { send } from '../bridge';
import { DRAFT_DAYS, peekDrafts, type BotDraft } from '../drafts';
import { CHAT_SENT, EVERYONE_ADDRESS, parseAddress, parseSent } from '../grok-cards-tags';
import type { RelayCommand } from '../types';
import { el } from '../util';

export interface GrokRequestSnap {
  requestId: string;
  botId: string;
  state: string;
  createdAt: number;
  no: string;
  group?: number;
  fileId?: string;
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
  setCardsUpper(on: boolean): void;
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

class GrokCardsView {
  private tab: 'memo' | 'cards' = 'memo';
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

  constructor(private readonly o: MountOpts) {
    this.tab = 'memo';
    this.root.hidden = true;
    this.o.main.append(this.root);
    this.tabBtn = el('button', 'grok-cards-tab', 'Grok Cards');
    this.tabBtn.type = 'button';
    this.tabBtn.dataset.key = 'grok-tab';
    this.tabBtn.setAttribute('role', 'tab');
    this.tabBtn.setAttribute('aria-selected', 'false');
    this.tabBtn.title = 'Grok Cards（ボットへの下書き）';
    this.tabBtn.addEventListener('click', () => {
      if (readCardsPlace() === 'upper') {
        writeCardsPlace('bottom');
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
        if (this.tab !== 'cards') return;
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
    this.applyPlace();
  }

  sync(memoOpen: boolean) {
    this.memoOpen = memoOpen;
    this.applyChrome();
  }

  consumeEsc(e: KeyboardEvent): boolean {
    if (this.tab !== 'cards') return false;
    const target = e.target;
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return false;
    if (this.picker) {
      e.preventDefault();
      this.picker = false;
      this.render();
      return true;
    }
    e.preventDefault();
    if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.showMemo();
    return true;
  }

  onOpen(open: boolean) {
    if (open) this.applyOpen();
    else this.applyClosed();
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

  private applyOpen() {
    this.tab = 'cards';
    writeCardsOpen(true);
    this.o.closeLists();
    this.applyChrome();
    void this.loadQueue();
  }

  private applyClosed() {
    this.tab = 'memo';
    writeCardsOpen(false);
    this.applyChrome();
  }

  private applyChrome() {
    const upper = this.isUpper();
    const show = this.tab === 'cards' && !upper;
    this.root.hidden = upper ? false : !show;
    this.tabBtn.setAttribute('aria-selected', String(show));
    this.o.title.setAttribute('aria-selected', String(upper || !show));
    this.paintCount();
    if (show) {
      this.o.band.hidden = false;
      this.o.main.hidden = false;
      this.o.scroll.hidden = true;
      this.o.tools.hidden = true;
      this.o.countline.hidden = true;
      this.o.status.hidden = true;
      this.o.empty.hidden = true;
      this.o.sheet.hidden = true;
      this.o.page.hidden = true;
      return;
    }
    this.o.tools.hidden = !this.memoOpen;
    this.o.main.hidden = !this.memoOpen;
    this.o.scroll.hidden = !this.memoOpen;
    this.o.countline.hidden = !this.memoOpen;
    this.o.status.hidden = !this.memoOpen;
    this.o.empty.hidden = this.memoOpen;
    // メモが無くても札は出す（この面から Grok Cards を開ける。旗が無いときは、この関数自体が呼ばれない）
    this.o.band.hidden = false;
    if (this.memoOpen) {
      this.o.page.hidden = false;
      this.o.sheet.hidden = this.o.sheet.textContent?.trim() === '';
    } else {
      this.o.sheet.hidden = true;
      this.o.page.hidden = true;
    }
  }

  private paintCount() {
    const upper = this.isUpper();
    const line = shownCountLine();
    this.tabBtn.textContent = cardsTabLabel(upper ? 'upper' : 'bottom');
    this.tabBtn.classList.toggle('is-upper', upper);
    this.tabCount.textContent = upper ? '' : line;
    this.tabBtn.title = upper ? '押すと下の面に戻します' : line ? `Grok Cards（${line}）` : 'Grok Cards（ボットへの下書き）';
  }

  private isUpper(): boolean {
    return readCardsPlace() === 'upper';
  }

  // 段 9 が無いときは、札の根の子は今までどおり（帯も包みも足さない）。上半分のときだけ札の根を上の枠へ移す
  private applyPlace() {
    const stage9 = cardsStageOn('9');
    const place = readCardsPlace();
    const upper = place === 'upper';
    if (!stage9 && this.body) {
      this.dropStage9Chrome();
      if (this.tab === 'cards') this.render();
    }
    this.syncUpperDom(upper);
    this.pushHost(stage9, place);
    if (stage9 && !this.body && (upper || this.tab === 'cards')) {
      if (this.root.querySelector('.grok-cards-cols')) this.render();
      else void this.loadQueue();
    }
    this.paintPlace();
    this.applyChrome();
  }

  private syncUpperDom(upper: boolean) {
    if (upper) {
      this.o.setCardsUpper(true);
      const slot = this.o.pane.querySelector(':scope > .grok-cards-upper');
      if (slot && this.root.parentElement !== slot) {
        const mark = fieldMark(this.root);
        slot.append(this.root);
        restoreField(this.root, mark);
      }
      return;
    }
    if (this.root.parentElement !== this.o.main) {
      const mark = fieldMark(this.root);
      this.o.main.append(this.root);
      restoreField(this.root, mark);
    }
    this.o.setCardsUpper(false);
  }

  private pushHost(stage9: boolean, place: CardsPlace) {
    const cmd = hostPlaceCommand(stage9, place, this.sentUpper);
    if (cmd === null || (cmd === 'upper') === this.sentUpper) return;
    this.sentUpper = cmd === 'upper';
    if (cmd === 'upper') send({ type: 'setSidebar', side: 'memo', place: 'upper', visible: true });
    else send({ type: 'setSidebar', side: 'memo', place: '' });
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
    bar.append(el('span', 'grok-cards-place-label', '出す場所'));
    for (const [place, label] of [
      ['bottom', '下の面'],
      ['upper', '上の半分'],
    ] as const) {
      const button = el('button', 'grok-cards-place-btn', label);
      button.type = 'button';
      button.dataset.place = place;
      if (place === 'upper') button.title = 'メモと一緒に見ます。下のタブから戻れます';
      button.addEventListener('click', () => writeCardsPlace(place));
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
    const bits = [this.notice, this.data.refused ? '台帳を読めていないので、下書きは保存できません。書いた文はこの欄に残しています' : ''].filter(Boolean);
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
    const add = el('button', 'grok-cards-add', '＋下書き');
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
    col.append(head, add);
    if (cardsStageOn('4') && this.composeOpen.has(address)) col.append(this.composer(address));
    const cards = this.data.cards.filter((card) => {
      const parsed = parseAddress(card.tags);
      if (!parsed.address) return address === 'all';
      return parsed.address === address;
    });
    const held = cardsStageOn('5') ? heldGroups(this.data.cards) : new Set<number>();
    const queued = this.queue.filter((draft) => draft.botId === address && (draft.group == null || !held.has(draft.group)));
    if (cards.length === 0 && queued.length === 0) col.append(el('p', 'grok-cards-empty', '下書きはまだありません'));
    for (const card of cards) col.append(this.card(card));
    for (const draft of queued) col.append(this.queueCard(draft));
    return col;
  }

  private composer(address: string): HTMLElement {
    const form = el('form', 'grok-cards-compose');
    const text = el('textarea');
    text.dataset.key = `compose:${address}`;
    text.value = this.compose.get(address) ?? '';
    text.placeholder = '頼む文';
    text.setAttribute('aria-label', '頼む文');
    text.addEventListener('input', () => this.compose.set(address, text.value));
    const save = el('button', 'grok-cards-save', '下書きにする');
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
    if (parsed.duplicate) box.append(el('p', 'grok-card-meta', '宛て先が二つ'));
    const reply = this.replies.get(card.id);
    if (open && reply) box.append(el('p', 'grok-card-reply', reply));
    box.append(this.btn(open ? '閉じる' : '開く', () => this.toggleOpen(card.id)));
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
      box.append(this.btn('コピーして開く ↗', () => this.o.ask({ command: 'copyGrokCard', id: card.id })));
      return;
    }
    if (kind === 'copied' || kind === 'waiting') {
      if (cardsStageOn('5') && address && address !== EVERYONE_ADDRESS) box.append(this.btn('アプリを開く ↗', openApp));
      if (cardsStageOn('7') && request?.fileId) box.append(this.btn('回答を開く', () => this.o.ask({ command: 'showGrokReply', id: card.id })));
      if (cardsStageOn('7') && sent?.group != null) box.append(this.btn('回答を開く', () => this.o.ask({ command: 'botGroupRead', group: sent.group as number })));
      return;
    }
    if (kind === 'unpasted') {
      if (cardsStageOn('5') && address && address !== EVERYONE_ADDRESS) box.append(this.btn('↗ 開く', openApp));
      if (cardsStageOn('6')) box.append(this.btn('貼った ✓', () => this.o.ask({ command: 'markGrokCardPasted', id: card.id })));
      return;
    }
    if (kind === 'late') {
      box.append(this.btn('もう一度コピー', () => this.o.ask({ command: 'copyGrokCard', id: card.id })));
      if (request) box.append(this.btn('待つのをやめる', () => this.o.ask({ command: 'botStopWaiting', botId: request.botId, requestId: request.requestId })));
      return;
    }
    if (kind === 'replied' && request?.fileId) {
      box.append(this.btn('回答を開く', () => this.o.ask({ command: 'showGrokReply', id: card.id })));
      box.append(this.btn('メモにする', () => this.o.ask({ command: 'botToMemo', botId: request.botId, fileId: request.fileId as string, to: 'right' })));
      return;
    }
    if (kind === 'error') {
      box.append(this.btn('見る', () => this.o.ask({ command: 'showGrokReply', id: card.id })));
      return;
    }
    if (kind === 'expired') {
      box.append(this.btn('もう一度下書きにする', () => this.o.ask({ command: 'clearGrokCardSent', id: card.id })));
      box.append(this.btn('外す', () => this.o.ask({ command: 'removeGrokCard', id: card.id })));
    }
  }

  private btn(label: string, run: () => void): HTMLButtonElement {
    const button = el('button', 'grok-card-open', label);
    button.type = 'button';
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
    const button = el('button', 'grok-cards-add', '＋ 列を足す');
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
      col.append(el('p', 'grok-cards-empty', '足せるボットはいません'));
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
    const note = aged ? queueNote(draft.createdAt, Date.now(), DRAFT_DAYS) : { text: `${DRAFT_DAYS} 日で順番待ちから外れます`, soon: false };
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
