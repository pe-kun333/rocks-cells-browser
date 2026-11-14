// 下のメモの区画の、左サイドバー側の世話役
//   台帳を書くのは左だけ。下の面は写しを見て、本文を変えてほしいときは左に頼む
//   開く・閉じる（見える・隠す）を C++ に言うのも左だけ。高さは下の面が直接送る
import { t } from './i18n';
import { send } from './bridge';
import { isSpecialCell, type MemoCell, type MemoStore, toMemoIndexItem } from './memocells';
import { MAIN_SHEET, type SheetStore } from './sheets';
import type { TabStore } from './tabs';
import type { MemoPaneView } from './types';

const KEY = 'honeycomb.memoPane';
import { clampMemoPaneHeight, MEMO_PANE_DEFAULT } from './memo-pane-limits';
export { clampMemoPaneHeight, MEMO_PANE_DEFAULT, MEMO_PANE_MAX, MEMO_PANE_MIN } from './memo-pane-limits';

export interface MemoPanePrefs {
  height: number;
  lastMemo: string | null;
  listOpen: boolean;
  recent: string[]; // 最近開いたメモ（新しい順・10件まで）
  boardMemo: string | null; // ボードが見るメモ（下の区画とは別に選ぶ。M1：左が写しを送るだけ。無い・古い設定は null）
}

const RECENT_MEMOS = 10;
const LIST_LIMIT = 200;

export function readMemoPanePrefs(): MemoPanePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { height?: unknown; lastMemo?: unknown; listOpen?: unknown; recent?: unknown; boardMemo?: unknown } | null;
    const recent = Array.isArray(raw?.recent) ? raw.recent.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, RECENT_MEMOS) : [];
    return {
      height: clampMemoPaneHeight(typeof raw?.height === 'number' ? raw.height : MEMO_PANE_DEFAULT),
      lastMemo: typeof raw?.lastMemo === 'string' && raw.lastMemo ? raw.lastMemo : null,
      listOpen: raw?.listOpen === true,
      recent,
      boardMemo: typeof raw?.boardMemo === 'string' && raw.boardMemo ? raw.boardMemo : null,
    };
  } catch {
    return { height: MEMO_PANE_DEFAULT, lastMemo: null, listOpen: false, recent: [], boardMemo: null };
  }
}

export function writeMemoPanePrefs(patch: Partial<MemoPanePrefs>) {
  const current = readMemoPanePrefs();
  const next: MemoPanePrefs = {
    height: patch.height !== undefined ? clampMemoPaneHeight(patch.height) : current.height,
    lastMemo: patch.lastMemo !== undefined ? patch.lastMemo : current.lastMemo,
    listOpen: patch.listOpen !== undefined ? patch.listOpen : current.listOpen,
    recent: patch.recent !== undefined ? patch.recent.slice(0, RECENT_MEMOS) : current.recent,
    boardMemo: patch.boardMemo !== undefined ? patch.boardMemo : current.boardMemo,
  };
  localStorage.setItem(KEY, JSON.stringify(next));
}

export class MemoPaneHost {
  private current: string | null = null;
  private shown = false;
  private timer = 0;
  private lastPage = '';
  private pendingFocus: { memoId: string; replyId: string; n: number } | null = null;
  private focusN = 0;
  // ボードが見るメモ（M1：写しを memoBoardView で送るだけ。下の区画の current とは独立。使っていない間は何も送らず、今までと同じ）
  private boardMemo: string | null = null;
  private boardSent = false; // memoBoardView で、null でない写しを送った（あとで null を一度だけ送って片づけるため）
  private boardRestore: string | null = readMemoPanePrefs().boardMemo; // 前に選んだメモ。起動直後は台帳をまだ読めていないことがあるので、見つかったときに戻す
  // 右の検索の［上で開く］：ボードでこのカードを選んで見せる頼み（番号が上がるたびに、ボードが一度だけ当てる。ボードが見る写しにだけ載せる。MK4）
  //   捨てるのは、見るメモを選び直したとき（setBoardMemo）と、ボードが下に付いていく間に下が別のメモへ替わった・閉じたとき（open・close。MK4 の見直し：あとで開き直したときに急に当たらないように）。
  //   下の面が読み込み直されたとき（ready）は捨てずに送り直す。作り直したボードは番号を 0 から数えるので、もう一度当てる（下の区画の focusReply と同じ）
  private boardFocus: { memoId: string; replyId: string; n: number } | null = null;
  private boardFocusN = 0;

  constructor(
    private readonly o: {
      memos: MemoStore;
      sheets: SheetStore;
      store: TabStore;
      toast(text: string): void;
      onOpenChange(id: string | null): void;
    },
  ) {
    // 起動し直したときは開き直さない（高さは覚えている。相談6）
    send({ type: 'setSidebar', side: 'memo', visible: false });
    o.memos.onChange(() => this.onMemos());
    o.sheets.onChange(() => {
      if (this.current || this.boardMemo) this.pushSoon();
    });
    o.store.onChange(() => this.onPage());
  }

  get openId() {
    return this.current;
  }

  get boardMemoId() {
    return this.boardMemo;
  }

  // ボードが見るメモを選ぶ（null で選びを外す＝下の区画と同じ見方に戻る）。選べないメモ（無い・特別なセル）は断って false
  setBoardMemo(id: string | null): boolean {
    if (id !== null) {
      const memo = this.o.memos.get(id);
      if (!memo || isSpecialCell(memo)) return false;
    }
    this.boardRestore = null;
    this.boardMemo = id;
    this.boardFocus = null; // 選ぶカードの頼みは、見るメモを選び直したら持ち越さない（［上で開く］は、このあとで focusBoard を呼ぶ。MK4）
    writeMemoPanePrefs({ boardMemo: id });
    this.pushBoard();
    return true;
  }

  // ボードでこのカードを選んで 100% で見せる頼み（右の検索の［上で開く］。MK4）。番号を上げて印を持ち、ボードが見る写しを送り直す
  //   選んだメモがあればその写し（memoBoardView）、無ければ下の区画の写し（memoPane。ボードは下に付いていく）。
  //   setBoardMemo・open の中では送らない（送る数を変えない。左が runBoardOpen のあとで呼ぶ）
  focusBoard(memoId: string, replyId: string) {
    this.boardFocusN += 1;
    this.boardFocus = { memoId, replyId, n: this.boardFocusN };
    if (this.boardMemo) this.pushBoard();
    else if (this.current) this.pushNow();
  }

  isOpen(id?: string) {
    return id === undefined ? this.current !== null : this.current === id;
  }

  open(id: string, replyId?: string) {
    const memo = this.o.memos.get(id);
    if (!memo || isSpecialCell(memo)) return;
    // 右の検索から：このカードへ移る頼み（n が変わるたびに、下の面が一度だけ移る）
    if (replyId) {
      this.focusN += 1;
      this.pendingFocus = { memoId: id, replyId, n: this.focusN };
    } else {
      this.pendingFocus = null;
    }
    if (!this.boardMemo && this.boardFocus && this.boardFocus.memoId !== id) this.boardFocus = null; // ボードは下に付いていく：下が別のメモへ替わったら、ボードで選ぶ頼みは捨てる（MK4 の見直し）
    const wasHidden = this.current === null;
    this.current = id;
    const recent = [id, ...readMemoPanePrefs().recent.filter((item) => item !== id)].slice(0, RECENT_MEMOS);
    writeMemoPanePrefs({ lastMemo: id, recent });
    this.o.onOpenChange(id);
    if (wasHidden) {
      this.shown = true;
      send({ type: 'setSidebar', side: 'memo', visible: true, height: readMemoPanePrefs().height });
    }
    this.pushNow();
  }

  // メモを開かずに、下の面だけ出す（Grok Cards。開いているメモはそのまま）
  showAside() {
    if (!this.shown) {
      this.shown = true;
      send({ type: 'setSidebar', side: 'memo', visible: true, height: readMemoPanePrefs().height });
    }
    this.pushNow();
  }

  close() {
    if (!this.current && !this.shown) return;
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.current = null;
    this.shown = false;
    this.pendingFocus = null;
    if (!this.boardMemo) this.boardFocus = null; // ボードは下に付いていく：下を閉じたら、ボードで選ぶ頼みも捨てる（MK4 の見直し）
    this.o.onOpenChange(null);
    send({ type: 'setSidebar', side: 'memo', visible: false });
    this.push();
  }

  // M4 の Ctrl+Shift+M で使う。M1 ではつないでいない
  toggle(id?: string) {
    if (this.current) this.close();
    else this.open(id || readMemoPanePrefs().lastMemo || '');
  }

  ready() {
    this.restoreBoardMemo();
    this.pushNow();
  }

  // 今の写しをすぐ送り直す（左が並べ替えを断った・並びが変わらなかったとき。写しが来ないと、下の区画の待ちの並びが戻らないため。plan-memo-card-order の O1）
  resend() {
    if (this.current) this.pushNow();
  }

  setText(id: string, text: string) {
    const memo = this.o.memos.get(id);
    if (!memo || isSpecialCell(memo) || typeof text !== 'string') return;
    if (memo.text === text) return;
    this.o.memos.update(id, { text });
  }

  private onMemos() {
    this.restoreBoardMemo();
    if (this.boardMemo && !this.o.memos.get(this.boardMemo)) this.dropBoardMemo();
    if (!this.current) {
      if (this.boardMemo) this.pushSoon(); // ボードが見ているメモが変わったかもしれない
      return;
    }
    if (!this.o.memos.get(this.current)) {
      this.close();
      // 消した直後の「消しました」より後に出す（同じ場所のお知らせは、あとから来た方が残る）
      window.setTimeout(() => this.o.toast(t('メモが消されたので、下の区画を閉じました')), 0);
      return;
    }
    this.pushSoon();
  }

  private onPage() {
    const key = this.pageKey();
    if (key === this.lastPage) return;
    this.lastPage = key;
    if (this.current) this.pushNow();
  }

  private pageKey() {
    const tab = this.o.store.active;
    return tab ? `${tab.id}\n${tab.url}\n${tab.title}` : '';
  }

  private pushSoon() {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.push(), 150);
  }

  private pushNow() {
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.push();
  }

  private push() {
    this.lastPage = this.pageKey();
    send({ type: 'relay', to: 'memo', payload: { kind: 'memoPane', view: this.view() } });
    send({ type: 'relay', to: 'memo', payload: this.listPayload() });
    this.pushBoard();
  }

  // ボードが見るメモの写し。選んでいない間は何も送らない（選びを外した・消えたときだけ、null を一度送る）
  private pushBoard() {
    const view = this.boardView();
    if (view === null && !this.boardSent) return;
    this.boardSent = view !== null;
    send({ type: 'relay', to: 'memo', payload: { kind: 'memoBoardView', view } });
  }

  private boardView(): MemoPaneView | null {
    if (!this.boardMemo) return null;
    const memo = this.o.memos.get(this.boardMemo);
    if (!memo || isSpecialCell(memo)) return null;
    const view = viewOf(memo, this.o.sheets, this.o.store);
    if (this.boardFocus && this.boardFocus.memoId === memo.id) view.boardFocus = { id: this.boardFocus.replyId, n: this.boardFocus.n }; // ボードはこの写しを見る（MK4）
    return view;
  }

  // 前に選んだメモが見つかったら戻す（送るのは呼んだ側）。見つからない間は何も変えない（設定は消さない）
  private restoreBoardMemo() {
    if (!this.boardRestore) return;
    const memo = this.o.memos.get(this.boardRestore);
    if (!memo || isSpecialCell(memo)) return;
    this.boardMemo = this.boardRestore;
    this.boardRestore = null;
  }

  // ボードが見ていたメモが消された：選びを外して（下の区画と同じ見方に戻る）、null を送って知らせる
  private dropBoardMemo() {
    this.boardMemo = null;
    writeMemoPanePrefs({ boardMemo: null });
    this.pushBoard();
    window.setTimeout(() => this.o.toast(t('ボードで見ていたメモが消されたので、下の区画と同じ見方に戻しました')), 0);
  }

  private listPayload() {
    const memo = this.current ? this.o.memos.get(this.current) : undefined;
    if (!memo) return { kind: 'memoPaneList' as const, items: [], recent: [], sheetName: '' };
    const sheet = memo.sheet;
    const items = this.o.memos
      .inSheet(sheet)
      .filter((m) => !isSpecialCell(m))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, LIST_LIMIT)
      .map(toMemoIndexItem);
    const recent = readMemoPanePrefs()
      .recent.map((id) => this.o.memos.get(id))
      .filter((m): m is MemoCell => !!m && !isSpecialCell(m))
      .slice(0, RECENT_MEMOS)
      .map(toMemoIndexItem);
    const sheetName = sheet !== MAIN_SHEET ? this.o.sheets.get(sheet)?.name || t('シート') : t('メイン');
    return { kind: 'memoPaneList' as const, items, recent, sheetName };
  }

  private view(): MemoPaneView | null {
    if (!this.current) return null;
    const memo = this.o.memos.get(this.current);
    if (!memo) return null;
    const view = viewOf(memo, this.o.sheets, this.o.store);
    // 移る頼みは消さない（下の面が n で一度だけ移る。ready() の送り直しにも載る）
    if (this.pendingFocus && this.pendingFocus.memoId === this.current) {
      view.focusReply = { id: this.pendingFocus.replyId, n: this.pendingFocus.n };
    }
    // ボードが下に付いていく（選んだメモが無い）ときだけ、ボードで選んで見せる頼みも載せる（消さない。ready() の送り直しにも載る。MK4）
    if (!this.boardMemo && this.boardFocus && this.boardFocus.memoId === this.current) {
      view.boardFocus = { id: this.boardFocus.replyId, n: this.boardFocus.n };
    }
    return view;
  }
}

function viewOf(memo: MemoCell, sheets: SheetStore, store: TabStore): MemoPaneView {
  const tab = store.active;
  const sheetName = memo.sheet !== MAIN_SHEET ? sheets.get(memo.sheet)?.name : undefined;
  return {
    id: memo.id,
    sheet: memo.sheet,
    ...(sheetName ? { sheetName } : {}),
    text: memo.text,
    tags: [...memo.tags],
    liked: memo.liked,
    ...(memo.image ? { image: memo.image } : {}),
    ...(memo.source ? { source: { url: memo.source.url, title: memo.source.title } } : {}),
    ...(memo.by ? { by: memo.by, ...(memo.label ? { label: memo.label } : {}) } : {}),
    replies: memo.replies ?? [],
    ...(memo.linkNames ? { linkNames: { ...memo.linkNames } } : {}),
    ...(memo.linkSet ? { linkSet: memo.linkSet } : {}),
    createdAt: memo.createdAt,
    updatedAt: memo.updatedAt,
    page: { tabId: tab ? tab.id : null, url: tab?.url ?? '', title: tab?.title || tab?.url || '' },
  };
}
