// 拡大表示を、選んだ置き場所に出す（左サイドバー用）
//   dock  : サイドバーの下に固定
//   float : 盤面の上の好きな場所（つまみをドラッグして動かす）
//   popup : マウスを乗せたセルのすぐ近く
// 何を表示するか：最後にマウスを乗せたタブ（かメモのセル）。サイドバーの外へマウスが出たら、表示中のタブに戻る
//   ボットのセルを外した直後は、ほかのセルに乗るまで「置き直す」のカードを出す
import type { AppEntry } from '../apps';
import type { BotEntry, BotFullState } from '../bots';
import type { PortalInfo } from '../cellface';
import type { Hex } from '../hex';
import { memosCitingPage, type MemoStore } from '../memocells';
import type { TabStore } from '../tabs';
import type { Thumbnails } from '../thumbs';
import type { Island, PreviewPlacement } from '../types';
import { detailCardActionClosesPin } from '../popup-gesture';
import { clamp, el } from '../util';
import { type CardWin, type CardWinKind, closeWin, MAX_CARD_WINS, moveWin, openWin, sameWin } from '../card-wins';
import { type AppActions, appCard } from './app-card';
import { type BotActions, botCard, removedBotCard } from './bot-card';
import { type MemoActions, memoCard } from './memo-card';
import { type PortalActions, portalCard } from './portal-card';
import { isWritingIn, type PreviewActions, previewCard } from './preview';
import type { TagPad } from './tag-pad';
import type { ThreadUi } from './thread-view';

export interface PreviewHostOptions {
  pinnedDetail?(): boolean; // 試し：固定したポップアップは詳しく（compact: false）。マウスを乗せただけのときはいつも小さい
  store: TabStore;
  thumbs: Thumbnails;
  dock: HTMLElement; // サイドバー下部の置き場所
  overlay: HTMLElement; // 盤面の上に重ねる置き場所（自由配置・ポップアップ用）
  anchorOf(id: number): DOMRect | null; // ポップアップを出す基準（セルの画面上の四角）
  actions: PreviewActions;
  islandOf(id: string | null): Island | undefined;
  floatMoved(pos: { x: number; y: number }): void;
  memos: MemoStore;
  memoActions: MemoActions;
  anchorOfMemo(id: string): DOMRect | null;
  thread: ThreadUi; // コメントのスレッド（メモのセルとタブのメモ）
  portal: {
    info(sheet: string | undefined): (PortalInfo & { tabs: number; memos: number }) | null; // 入口の行き先のシート
    actions: PortalActions;
  };
  bot: {
    entry(botId: string | undefined): BotEntry | undefined; // 台帳のボット
    state(botId: string | undefined): BotFullState; // セルの顔の状態（リンクなし・アプリなし・第2段の返事あり・待っている など）
    badges?(botId: string | undefined): { unread: number; waiting: number } | undefined; // まだ読んでいない数・待っている数
    actions: BotActions;
  };
  app: {
    entry(appId: string | undefined): AppEntry | undefined;
    pinned(appId: string | undefined): boolean; // いま中央に出している（ボタンが「最前面をやめる」）
    actions: AppActions;
  };
  sheetName(sheet: string): string | undefined; // メイン以外のシートの名前（カードに出す）
  topInset(): number; // 盤面の上の端から空けておく高さ（左上のシートの名前に重ねない）
  tagPad: TagPad; // タグのボタン（6つ・セット・その他）
  toast(text: string): void;
  cardWinsChanged?(list: CardWin[]): void; // P1：カードの小窓の一覧が変わった（prefs に残す）
}

export class PreviewHost {
  placement: PreviewPlacement = 'dock';
  floatPos = { x: 12, y: 12 };
  private pointerId: number | null = null; // 今マウスが乗っているタブ
  private lastId: number | null = null; // 最後にマウスが乗ったタブ
  private memoPointer: string | null = null; // 今マウスが乗っているメモのセル
  private lastMemo: string | null = null; // 最後にマウスが乗った・押したメモのセル（タブより優先）
  private removedBot: { botId: string; at: { sheet: string; pos: Hex } } | null = null; // 外したばかりのボットのセル（置き直すカード）
  private pinned = false; // 📌 固定（この起動のあいだだけ。覚えない）
  private readonly floating = el('div', 'preview-float');
  private readonly floatSlot = el('div', 'preview-slot');
  private readonly popup = el('div', 'preview-popup');
  private pinnedMemo: string | null = null; // 試し：1回押しで固定したポップアップのメモのセル（タブとどちらか1つ）
  private pinnedTab: number | null = null; // 試し：1回押しで固定したポップアップのタブ（置き場所がポップアップのときだけ）
  private peekPin: { id: number; anchor(): DOMRect | null } | null = null; // 小窓のタブ：詳しいカードを、そのセルの近くに出す
  private dragHidden = false; // 盤面のものをドラッグしているあいだ、ポップアップを出さない（固定は覚えておく）
  private readonly popupClose = el('button', 'preview-popup-close', '×');
  private cardWins: CardWin[] = []; // P1：盤面の上に出しているカードの小窓（後ろほど前面）
  private readonly cardWinEls = new Map<string, HTMLElement>();

  constructor(private readonly o: PreviewHostOptions) {
    const grip = el('div', 'preview-grip', '⠿ 拡大表示');
    grip.title = 'ドラッグで移動';
    this.floating.append(grip, this.floatSlot);
    this.bindFloatDrag(grip);
    this.popupClose.setAttribute('type', 'button');
    this.popupClose.title = '固定をやめる（Esc）';
    this.popupClose.setAttribute('aria-label', '固定をやめる');
    this.popupClose.addEventListener('click', () => this.unpinTab());
    o.store.onChange(() => this.render());
    o.thumbs.onChange(() => this.render());
    o.memos.onChange(() => this.render());
    o.tagPad.onChange(() => this.render());
  }

  // 拡大表示しているタブ
  get focusId() {
    const id = this.lastId ?? this.o.store.activeId;
    return id !== null && this.o.store.get(id) ? id : this.o.store.activeId;
  }

  setPointer(id: number | null) {
    if (this.dragHidden) return; // ドラッグが終わるまで出さない
    if (this.pinned || this.pinnedTab !== null || this.pinnedMemo !== null) return; // 固定中は、マウスを乗せてもカードを替えない
    if (id === this.pointerId) return;
    this.pointerId = id;
    if (id !== null) {
      this.lastId = id;
      this.lastMemo = null;
      this.removedBot = null;
    }
    this.render();
  }

  // メモのセルに乗った・押した
  setMemoPointer(id: string | null) {
    if (this.dragHidden) return;
    if (this.pinned || this.pinnedTab !== null || this.pinnedMemo !== null) return;
    if (id === this.memoPointer) return;
    this.memoPointer = id;
    if (id !== null) {
      this.lastMemo = id;
      this.removedBot = null;
    }
    this.render();
  }

  // 試し：入口の小窓を開いた：乗せていた・最後に乗った入口のカードを消す（ほかのセルに乗るまで、表示中のタブ）
  hidePortalCard(isPortal: (id: string) => boolean) {
    let changed = false;
    if (this.memoPointer !== null && isPortal(this.memoPointer)) {
      this.memoPointer = null;
      changed = true;
    }
    if (this.lastMemo !== null && isPortal(this.lastMemo)) {
      this.lastMemo = null;
      changed = true;
    }
    if (changed) this.render();
  }

  showMemo(id: string) {
    this.lastMemo = id;
    this.removedBot = null;
    this.render();
  }

  // ボットのセルを外した：ほかのセルに乗るまで「置き直す」のカードを出す（セルを消す前に呼ぶ）
  showRemovedBot(botId: string, at: { sheet: string; pos: Hex }) {
    this.removedBot = { botId, at: { sheet: at.sheet, pos: { ...at.pos } } };
    this.lastMemo = null;
    this.render();
  }

  get focusMemo() {
    return this.lastMemo && this.o.memos.get(this.lastMemo) ? this.lastMemo : null;
  }

  // 試し：1回押しで固定するのは、置き場所がポップアップのときだけ
  get clickPins() {
    return this.placement === 'popup';
  }

  get pinnedTabId() {
    return this.pinnedTab;
  }

  // そのタブにポップアップを固定する。同じタブならやめる。ほかのタブなら固定を移す
  //   小窓から出していたカードを、盤面の同じタブで押し直したときは、盤面のセルの位置へ移す（やめない）
  pinTab(id: number) {
    const fromPeek = this.peekPin !== null;
    this.peekPin = null;
    if (this.pinnedTab === id && !fromPeek) {
      this.unpinTab();
      return;
    }
    this.pinnedTab = id;
    this.pinnedMemo = null;
    this.pointerId = id;
    this.lastId = id;
    this.memoPointer = null;
    this.lastMemo = null;
    this.removedBot = null;
    this.render();
  }

  // 小窓のタブを左クリック：盤面と同じ詳しいカードを、そのセルの近くに固定する（置き場所がポップアップでなくても出す）
  //   同じタブをもう一度（短い間を過ぎて）押したらやめる。盤面の拡大表示（ドック）はすり替えない
  pinTabFromPeek(id: number, anchor: () => DOMRect | null) {
    if (this.peekPin?.id === id && this.pinnedTab === id) {
      this.unpinTab();
      return;
    }
    this.peekPin = { id, anchor };
    this.pinnedTab = id;
    this.pinnedMemo = null;
    this.pointerId = null;
    this.memoPointer = null;
    this.render();
  }

  // 小窓を閉じた・中のシートが変わった・小窓の空いた所：小窓から出した詳細だけしまう
  releasePeekPin() {
    if (!this.peekPin) return;
    this.unpinTab();
  }

  // 盤面のものをドラッグしているあいだ、乗せたカードも固定したカードも出さない。固定は残し、終わったら戻す
  setDragHidden(on: boolean) {
    if (this.dragHidden === on) return;
    this.dragHidden = on;
    if (on) {
      this.pointerId = null;
      this.memoPointer = null;
    }
    this.render();
  }

  // そのメモのセルにポップアップを固定する。同じセルならやめる
  pinMemo(id: string) {
    this.peekPin = null;
    if (this.pinnedMemo === id) {
      this.unpinTab();
      return;
    }
    this.pinnedMemo = id;
    this.pinnedTab = null;
    this.memoPointer = id;
    this.lastMemo = id;
    this.removedBot = null;
    this.render();
  }

  // 固定をやめる（Esc・空いた所を押す・×）。マウスがまた乗るまでポップアップは出さない
  unpinTab() {
    if (this.pinnedTab === null && this.pinnedMemo === null) return;
    this.pinnedTab = null;
    this.pinnedMemo = null;
    this.peekPin = null;
    this.pointerId = null;
    this.memoPointer = null;
    this.render();
  }

  // 盤面を動かした・拡大縮小した・小窓を動かした：固定したポップアップの位置をセルに合わせる
  reposition() {
    if (this.dragHidden) return;
    if (this.peekPin) {
      this.render();
      return;
    }
    if ((this.pinnedTab !== null || this.pinnedMemo !== null) && this.placement === 'popup') this.render();
  }

  // 表示中のタブに戻す
  resetFocus() {
    this.pointerId = null;
    this.lastId = null;
    this.memoPointer = null;
    this.lastMemo = null;
    this.removedBot = null;
    this.render();
  }

  render() {
    const { dock, overlay } = this.o;
    if (isWritingIn(dock) || isWritingIn(this.floating) || isWritingIn(this.popup)) {
      this.renderCardWins(); // 小窓の中で書いている物は、小窓ごとに守る
      return; // メモ・タグを書いている途中（固定したポップアップの中も）
    }

    const tabAlive = this.pinnedTab !== null && !!this.o.store.get(this.pinnedTab);
    const peeking = tabAlive && this.peekPin !== null && this.peekPin.id === this.pinnedTab;
    if (this.pinnedTab !== null && !tabAlive) {
      this.pinnedTab = null; // タブを閉じた
      this.peekPin = null;
      this.pointerId = null;
    } else if (this.pinnedTab !== null && this.placement !== 'popup' && !peeking) {
      this.pinnedTab = null; // 置き場所を変えた（小窓のカードは、置き場所に関係なく残す）
      this.peekPin = null;
      this.pointerId = null;
    }
    if (this.peekPin && this.pinnedTab !== this.peekPin.id) this.peekPin = null;
    if (this.pinnedMemo !== null && (this.placement !== 'popup' || !this.o.memos.get(this.pinnedMemo))) {
      this.pinnedMemo = null; // 置き場所を変えた・セルを外した
      this.memoPointer = null;
    }
    dock.hidden = this.placement !== 'dock';
    // 押したボタン（タグのボタンなど）に、描き直した後もキーボードの位置を残す
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusKey = active && (dock.contains(active) || this.floating.contains(active)) ? active.dataset.focusKey : undefined;
    const popupFocusKey = active && this.popup.contains(active) ? active.dataset.focusKey : undefined; // 固定したポップアップの中のボタン
    const popupScroll = this.popup.scrollTop; // 描き直しても、ポップアップの中のスクロールを残す
    const memo = this.focusMemo;
    const main = () => (memo ? this.memoCard(memo, false) : (this.removedCard() ?? this.card(this.focusId, false))) ?? el('div', 'preview-empty', 'タブがありません');
    if (this.placement === 'dock') {
      dock.replaceChildren(main());
    } else {
      dock.replaceChildren();
    }

    if (this.placement === 'float') {
      this.floatSlot.replaceChildren(main());
      if (this.floating.parentElement !== overlay) overlay.append(this.floating);
      this.placeFloat();
    } else {
      this.floating.remove();
    }
    if (focusKey) {
      const holder = this.placement === 'dock' ? dock : this.floatSlot;
      holder.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    }

    // ドラッグ中は出さない（固定したタブは覚えたまま。終わったら reposition や次の render で戻る）
    const showPeek = !this.dragHidden && this.peekPin !== null && this.pinnedTab === this.peekPin.id;
    const pinnedTab = !this.dragHidden && (this.placement === 'popup' || showPeek) ? this.pinnedTab : null;
    const pinnedMemo = !this.dragHidden && this.placement === 'popup' ? this.pinnedMemo : null;
    const memoUnder = this.dragHidden || this.placement !== 'popup' || pinnedTab !== null ? null : (pinnedMemo ?? this.memoPointer);
    const anchor = this.dragHidden
      ? null
      : showPeek
        ? this.peekPin!.anchor()
        : this.placement !== 'popup'
          ? null
          : memoUnder
            ? this.o.anchorOfMemo(memoUnder)
            : pinnedTab !== null
              ? this.o.anchorOf(pinnedTab)
              : this.pointerId !== null
                ? this.o.anchorOf(this.pointerId)
                : null;
    const isPinned = pinnedTab !== null || pinnedMemo !== null;
    // 固定したポップアップだけ詳しく（右のカードと同じ作り。📌 固定は出さない・コメントは数だけ）
    //   小窓のカードはいつも詳しく（「開く」「下で開く」が要るため）
    const detail = isPinned && (showPeek || (this.o.pinnedDetail?.() ?? false));
    const popupCard = !anchor
      ? null
      : memoUnder
        ? this.memoCard(memoUnder, !detail, detail)
        : pinnedTab !== null
          ? this.card(pinnedTab, !detail, detail)
          : this.pointerId !== null
            ? this.card(this.pointerId, true)
            : null;
    if (anchor && popupCard) {
      this.popup.classList.toggle('pinned', isPinned);
      this.popup.classList.toggle('detailed', detail);
      this.popup.classList.toggle('from-peek', showPeek);
      if (isPinned) this.popup.replaceChildren(this.popupClose, popupCard);
      else this.popup.replaceChildren(popupCard);
      // 小窓（z-index 15）より前に出すため、盤面の直下に置く。ふつうのポップアップは重ねる層の中
      const layer = showPeek ? (overlay.parentElement ?? overlay) : overlay;
      if (this.popup.parentElement !== layer) layer.append(this.popup);
      if (detail) this.popup.scrollTop = popupScroll;
      if (popupFocusKey) this.popup.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(popupFocusKey)}"]`)?.focus({ preventScroll: true });
      this.placePopup(anchor);
    } else {
      this.popup.classList.remove('from-peek');
      this.popup.remove();
    }
    this.renderCardWins();
  }

  // ---------- P1：カードの小窓（右クリック →「小窓で出す」。いくつでも〔MAX_CARD_WINS まで〕・つまみでドラッグ・× で閉じる） ----------
  setCardWins(list: CardWin[]) {
    this.cardWins = list.slice();
    this.renderCardWins();
  }

  get cardWinList(): readonly CardWin[] {
    return this.cardWins;
  }

  // 出す。出ていれば前へ。出せたら true
  openCardWin(kind: CardWinKind, key: string): boolean {
    const n = this.cardWins.length;
    const pos = { x: 12 + (n % 4) * 18, y: Math.max(this.o.topInset(), 12) + (n % 4) * 22 }; // 重ならないよう少しずつずらす
    const next = openWin(this.cardWins, { kind, key, ...pos }, (w) => this.cardWinAlive(w));
    if (!next) {
      this.o.toast(`小窓は ${MAX_CARD_WINS} 個までです。どれかを × で閉じてください`);
      return false;
    }
    this.cardWins = next;
    this.o.cardWinsChanged?.(this.cardWins);
    this.renderCardWins();
    return true;
  }

  closeCardWin(kind: CardWinKind, key: string) {
    this.cardWins = closeWin(this.cardWins, { kind, key });
    this.o.cardWinsChanged?.(this.cardWins);
    this.renderCardWins();
  }

  private cardWinAlive(w: CardWin) {
    return w.kind === 'tab' ? !!this.tabByUid(w.key) : !!this.o.memos.get(w.key);
  }

  private tabByUid(uid: string) {
    return this.o.store.all().find((tab) => tab.uid === uid);
  }

  private renderCardWins() {
    const overlay = this.o.overlay;
    const live = new Set<string>();
    this.cardWins.forEach((w, index) => {
      const id = `${w.kind}:${w.key}`;
      const tab = w.kind === 'tab' ? this.tabByUid(w.key) : undefined;
      const memo = w.kind === 'memo' ? this.o.memos.get(w.key) : undefined;
      if (!tab && !memo) return; // まだ読み込み前・消えた（一覧には残す。いっぱいのときに外れる）
      live.add(id);
      let win = this.cardWinEls.get(id);
      if (!win) {
        win = this.makeCardWin(w);
        this.cardWinEls.set(id, win);
      }
      const title = tab ? tab.title || tab.url || 'タブ' : (memo?.text.trim().split('\n')[0] || (memo?.portal ? '入口' : memo?.bot ? 'ボット' : memo?.app ? 'アプリ' : memo?.capture ? '撮ったもの' : 'メモ')).slice(0, 40);
      const label = win.querySelector<HTMLElement>('.card-win-title');
      if (label && label.textContent !== title) label.textContent = title;
      const body = win.querySelector<HTMLElement>('.card-win-body')!;
      if (!isWritingIn(body)) {
        const scroll = body.scrollTop;
        const card = tab ? this.card(tab.id, false, true) : this.memoCard(w.key, false, true);
        body.replaceChildren(card ?? el('div', 'preview-empty', '見つかりません'));
        body.scrollTop = scroll;
      }
      win.style.zIndex = String(20 + index);
      if (win.parentElement !== overlay) overlay.append(win);
      this.placeCardWin(win, w);
    });
    for (const [id, win] of this.cardWinEls) {
      if (live.has(id)) continue;
      win.remove();
      this.cardWinEls.delete(id);
    }
  }

  private makeCardWin(w: CardWin) {
    const win = el('div', 'card-win');
    const head = el('div', 'card-win-head');
    const title = el('span', 'card-win-title');
    const close = el('button', 'card-win-close', '×');
    close.type = 'button';
    close.title = '小窓を閉じる';
    close.setAttribute('aria-label', '小窓を閉じる');
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeCardWin(w.kind, w.key);
    });
    head.append(title, close);
    win.append(head, el('div', 'card-win-body'));
    head.title = 'ドラッグで移動';
    let start: { x: number; y: number; left: number; top: number } | null = null;
    const current = () => this.cardWins.find((x) => sameWin(x, w));
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target instanceof Element && e.target.closest('.card-win-close'))) return;
      const now = current();
      if (!now) return;
      start = { x: e.clientX, y: e.clientY, left: now.x, top: now.y };
      head.setPointerCapture(e.pointerId);
      // 押した小窓を前へ
      if (this.cardWins.at(-1) !== now) {
        this.cardWins = [...this.cardWins.filter((x) => x !== now), now];
        this.cardWins.forEach((x, i) => {
          const node = this.cardWinEls.get(`${x.kind}:${x.key}`);
          if (node) node.style.zIndex = String(20 + i);
        });
      }
    });
    head.addEventListener('pointermove', (e) => {
      if (!start) return;
      this.cardWins = moveWin(this.cardWins, w, { x: start.left + e.clientX - start.x, y: start.top + e.clientY - start.y });
      const now = current();
      if (now) this.placeCardWin(win, now);
    });
    const end = () => {
      if (!start) return;
      start = null;
      this.o.cardWinsChanged?.(this.cardWins);
    };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
    return win;
  }

  // 盤面からはみ出さないように置く（覚える位置は動かしたときの値。盤面が狭いときだけ見た目を寄せる）
  private placeCardWin(win: HTMLElement, w: CardWin) {
    const box = this.o.overlay.getBoundingClientRect();
    const x = clamp(w.x, 0, Math.max(0, box.width - win.offsetWidth));
    const y = clamp(w.y, 0, Math.max(0, box.height - 28));
    win.style.left = `${x}px`;
    win.style.top = `${y}px`;
  }

  //   inPopup：固定したポップアップの詳しいカード（📌 固定は出さない・コメントは「N件」の数だけ）
  private memoCard(id: string, compact: boolean, inPopup = false) {
    const memo = this.o.memos.get(id);
    if (!memo) return null;
    if (memo.portal) {
      const info = this.o.portal.info(memo.portal);
      return portalCard({ memo, info, counts: { tabs: info?.tabs ?? 0, memos: info?.memos ?? 0 }, image: this.o.memos.image(memo.image), compact, actions: this.o.portal.actions });
    }
    if (memo.bot) {
      const bot = this.o.bot;
      return botCard({ memo, bot: bot.entry(memo.bot), state: bot.state(memo.bot), badges: bot.badges?.(memo.bot), image: this.o.memos.image(memo.image), compact, actions: bot.actions });
    }
    if (memo.app) {
      return appCard({ memo, app: this.o.app.entry(memo.app), pinned: this.o.app.pinned(memo.app), compact, actions: this.o.app.actions });
    }
    return memoCard({
      memo,
      image: this.o.memos.image(memo.image),
      compact,
      actions: this.memoActionsForCard(),
      island: this.o.islandOf(memo.island),
      thread: inPopup ? undefined : this.o.thread,
      tagPad: this.o.tagPad,
      toast: this.o.toast,
      ...(!compact && !inPopup ? { pin: { on: this.pinned, toggle: () => this.togglePin() } } : {}),
    });
  }

  // 外したばかりのボットのセルの「置き直す」カード（台帳から消えていたら出さない）
  private removedCard() {
    const removed = this.removedBot;
    const bot = removed ? this.o.bot.entry(removed.botId) : undefined;
    if (!removed || !bot) return null;
    return removedBotCard({ bot, at: removed.at, actions: this.o.bot.actions });
  }

  private card(id: number | null, compact: boolean, inPopup = false) {
    const tab = id === null ? undefined : this.o.store.get(id);
    if (!tab) return null;
    return previewCard({
      tab,
      activeId: this.o.store.activeId,
      thumbnail: this.o.thumbs.get(tab.id),
      compact,
      actions: this.tabActionsForCard(),
      island: this.o.islandOf(tab.island),
      thread: inPopup ? undefined : this.o.thread,
      faceImage: this.o.memos.image(tab.image),
      sheetName: this.o.sheetName(tab.sheet),
      tagPad: this.o.tagPad,
      toast: this.o.toast,
      ...(!compact && !inPopup ? { pin: { on: this.pinned, toggle: () => this.togglePin() } } : {}),
      cited: memosCitingPage(this.o.memos.list(), tab.url),
      // すでにそのメモを下で開いているときは閉じない（「下で開く」ボタンだけが、開いていれば閉じる）
      //   下で開くので、固定した詳細はしまう
      openCited: (id) => {
        if (detailCardActionClosesPin('open-below')) this.unpinTab();
        if (!this.o.memoActions.isPaneOpen(id)) this.o.memoActions.openPane(id);
      },
    });
  }

  // カードの「開く」：サイトを開いたら、固定した詳細をしまう
  private tabActionsForCard(): PreviewActions {
    const actions = this.o.actions;
    return {
      ...actions,
      open: (id) => {
        if (detailCardActionClosesPin('open-site')) this.unpinTab();
        actions.open(id);
      },
    };
  }

  // メモのカードの「下で開く」「リンクを開く」も、固定した詳細をしまう（ダブルクリックで下を開くときは、ここを通らない）
  private memoActionsForCard(): MemoActions {
    const actions = this.o.memoActions;
    return {
      ...actions,
      openPane: (id) => {
        if (detailCardActionClosesPin('open-below')) this.unpinTab();
        actions.openPane(id);
      },
      openUrl: (url) => {
        if (detailCardActionClosesPin('open-site')) this.unpinTab();
        actions.openUrl(url);
      },
    };
  }

  private togglePin() {
    this.pinned = !this.pinned;
    this.render();
  }

  // 盤面からはみ出さないように置く
  private placeFloat() {
    const box = this.o.overlay.getBoundingClientRect();
    this.floatPos = {
      x: clamp(this.floatPos.x, 0, Math.max(0, box.width - this.floating.offsetWidth)),
      y: clamp(this.floatPos.y, Math.min(this.o.topInset(), Math.max(0, box.height - this.floating.offsetHeight)), Math.max(0, box.height - this.floating.offsetHeight)),
    };
    this.floating.style.left = `${this.floatPos.x}px`;
    this.floating.style.top = `${this.floatPos.y}px`;
  }

  // セルの下に出す。下に入りきらなければ上に出す
  private placePopup(anchor: DOMRect) {
    const box = (this.popup.offsetParent instanceof HTMLElement ? this.popup.offsetParent : this.o.overlay).getBoundingClientRect();
    const width = this.popup.offsetWidth;
    const height = this.popup.offsetHeight;
    const x = clamp(anchor.left + anchor.width / 2 - box.left - width / 2, 4, Math.max(4, box.width - width - 4));
    const below = anchor.bottom - box.top + 8;
    const y = below + height <= box.height ? below : Math.max(this.o.topInset(), anchor.top - box.top - height - 8);
    this.popup.style.left = `${x}px`;
    this.popup.style.top = `${y}px`;
  }

  private bindFloatDrag(grip: HTMLElement) {
    let start: { x: number; y: number; left: number; top: number } | null = null;
    grip.addEventListener('pointerdown', (e) => {
      start = { x: e.clientX, y: e.clientY, left: this.floatPos.x, top: this.floatPos.y };
      grip.setPointerCapture(e.pointerId);
    });
    grip.addEventListener('pointermove', (e) => {
      if (!start) return;
      this.floatPos = { x: start.left + e.clientX - start.x, y: start.top + e.clientY - start.y };
      this.placeFloat();
    });
    grip.addEventListener('pointerup', () => {
      if (!start) return;
      start = null;
      this.o.floatMoved(this.floatPos);
    });
  }
}
