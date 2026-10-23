// 右サイドバーの「検索」：メモ・コメントは左に探してもらい、タブ・撮影・データ置き場・単語帳は右の中で探して、1 本の一覧にする
//   ・メモとコメントを探すのは左（台帳を持っている）。ここは字と並べ方を渡して、返ってきた行を描く
//   ・タブ・撮影・置き場・単語帳は右が持っているので、deps.local で右の中を探し、左の結果と合わせて並べる（right-search.ts）
//   ・「対象」のボタンで、探すものを選ぶ（覚えておく。少なくとも 1 つは選んだまま）
//   ・字を打つと少し待って探す。Enter ですぐ探す。Escape で字を消す
//   ・並べ方：新しい順（作った時刻）／更新順（メモの変更・コメントの書き直し・♥ の新しいほう）。タブは時刻が無いので下にまとめる
//   ・行の大きいボタン：メモ・コメントは下の区画で開く（コメントなら、そのカードへ）。ほかは、その区画で開く。小さいボタン：左の盤面で見る（メモ・コメントだけ）
//   ・手本は tag-index.ts（見出し・▾ でたたむ・prefs・押したボタンの位置を残す）
import { type LocalItem, type LocalKind, mergeRows, type PanelRow, SEARCH_TARGETS, type SearchTarget } from '../right-search';
import { queryWords, type SearchItem, type SearchSort } from '../search';
import { el } from '../util';

export interface SearchPanelDeps {
  ask(seq: number, query: string, sort: SearchSort, limit: number): void;
  memoKnown(id: string): boolean | null; // 右の memoIndex にあるか（null：まだ左から届いていない）
  sheetName(id: string): string | null; // メイン以外のシートの名前（メインなら null）
  openMemo(item: SearchItem): void; // 下の区画で開く（コメントなら、そのカードへ）
  showMemo(id: string): void; // 左の盤面で見る
  local(query: string, kinds: readonly LocalKind[]): { items: LocalItem[]; notes: string[] }; // 右の中で探す（notes：読み込み中などの知らせ）
  openLocal(item: LocalItem): boolean; // その区画で開く（もう無ければ false）
}

interface Prefs {
  collapsed: boolean;
  sort: SearchSort;
  kinds: SearchTarget[]; // 探す対象（SEARCH_TARGETS の順。空にはしない）
}

// 待っている・出している探しの中身
interface Asked {
  query: string;
  recent: boolean; // 字が空（語が無い）で探した＝最近のものの一覧
  sort: SearchSort;
  limit: number;
  kinds: SearchTarget[];
}

// 左から届いたメモ・コメントの結果（メモを選んでいなければ空の結果）
interface MemoResult {
  items: SearchItem[];
  total: number;
  ready: boolean;
}

// 出している結果（左のメモと右の中の結果を合わせたもの）と、それを探したときの字・並べ方・件数・対象
interface Shown {
  rows: PanelRow[];
  total: number;
  recent: boolean;
  sort: SearchSort;
  limit: number;
  kinds: SearchTarget[];
  notes: string[]; // 状態の行に添える知らせ（読み込み中など）
}

const PREFS_KEY = 'honeycomb.searchPanel';
const PAGE = 30; // 最初に出す件数と、「ほか n 件を見る」で足す件数
const MAX_LIMIT = 300;
const TYPING_MS = 250; // 字を打ち終わるのを待つ
const SILENT_MS = 3000; // 左から返事が無いと知らせるまで
const SORTS: [SearchSort, string][] = [
  ['created', '新しい順'],
  ['updated', '更新順'],
];
const KIND_BUTTONS: [SearchTarget, string, string][] = [
  ['memo', 'メモ', 'メモとコメント'],
  ['tab', 'タブ', ''],
  ['capture', '撮影', ''],
  ['vault', '置き場', 'データ置き場（目次だけ）'],
  ['vocab', '単語帳', ''],
  ['reminder', '⏰ リマインダー', 'まだ鳴っていないリマインダー'],
];
// 右の中の行：アイコン・押したときの title・押したときにもう無かった知らせ
const LOCAL_ICON: Record<LocalKind, string> = { tab: '🌐', capture: '📷', vault: '🗄', vocab: '📇', reminder: '⏰' };
const LOCAL_TITLE: Record<LocalKind, string> = {
  tab: 'このタブを表示する',
  capture: '撮影の区画で、このカードを出す',
  vault: 'データ置き場で、これを開く',
  vocab: '単語帳で、このカードを開く',
  reminder: 'リマインダーの区画を開く',
};
const LOCAL_GONE: Record<LocalKind, string> = {
  tab: 'そのタブは、もうありません',
  capture: 'その撮影は、もうありません',
  vault: 'それは、もうデータ置き場にありません',
  vocab: 'そのカードは、もう単語帳にありません',
  reminder: 'そのリマインダーは、もうありません（鳴ったか、取り消されました）',
};

export class SearchPanel {
  readonly element = el('section', 'panel-section search-panel');
  private prefs: Prefs = loadPrefs();
  private limit = PAGE; // 出す件数
  private seq = 0;
  private waiting: number | null = null; // 返事を待っている seq
  private asked: Asked = { query: '', recent: true, sort: this.prefs.sort, limit: PAGE, kinds: [...this.prefs.kinds] }; // 待っている・出している探しの中身
  private memo: MemoResult | null = null; // 今の探しの、左からのメモの結果（まだ届いていなければ null）
  private shown: Shown | null = null;
  private typingTimer = 0;
  private silentTimer = 0;
  private localTimer = 0; // 右の台帳が変わったあと、探し直すまで待つ
  private readonly head = el('div', 'search-panel-head');
  private readonly sub = el('span', 'search-panel-sub');
  private readonly fold = el('button', 'search-panel-fold');
  private readonly body = el('div', 'search-panel-body');
  private readonly input = el('input', 'search-panel-input');
  private readonly sortButtons = new Map<SearchSort, HTMLButtonElement>();
  private readonly kindButtons = new Map<SearchTarget, HTMLButtonElement>();
  private readonly status = el('p', 'search-panel-status');
  private readonly list = el('div', 'search-panel-list');
  private readonly more = el('button', 'search-panel-more');

  constructor(private readonly deps: SearchPanelDeps) {
    this.element.setAttribute('aria-label', '検索');
    this.head.append(el('h2', 'search-panel-title', '検索'), this.sub, this.fold);
    this.fold.type = 'button';
    this.fold.addEventListener('click', () => {
      this.prefs.collapsed = !this.prefs.collapsed;
      this.savePrefs();
      this.renderFrame();
      if (this.prefs.collapsed) this.stopTimers();
      else this.schedule(0);
    });

    const controls = el('div', 'search-panel-controls');
    this.input.type = 'search';
    this.input.placeholder = 'メモ・タブ・撮影などを探す';
    this.input.setAttribute('aria-label', '探す字');
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.maxLength = 200;
    this.input.addEventListener('input', () => {
      this.resetPage();
      this.schedule(TYPING_MS);
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return; // 日本語の変換中は何もしない
      if (e.key === 'Enter') {
        this.resetPage();
        this.schedule(0);
      } else if (e.key === 'Escape' && this.input.value) {
        e.preventDefault();
        this.input.value = '';
        this.resetPage();
        this.schedule(0);
      }
    });

    const sorts = el('div', 'search-panel-sort');
    sorts.setAttribute('role', 'group');
    sorts.setAttribute('aria-label', '並べ方');
    for (const [sort, label] of SORTS) {
      const button = el('button', 'search-panel-sortbtn', label);
      button.type = 'button';
      button.addEventListener('click', () => {
        this.prefs.sort = sort;
        this.savePrefs();
        this.renderFrame();
        this.resetPage();
        this.schedule(0);
      });
      this.sortButtons.set(sort, button);
      sorts.append(button);
    }
    controls.append(this.input, sorts);

    // 探す対象（選んでいるものを外す押し方は、残りが 1 つのときは何もしない）
    const kinds = el('div', 'search-panel-kinds');
    kinds.setAttribute('role', 'group');
    kinds.setAttribute('aria-label', '探す対象');
    for (const [kind, label, hint] of KIND_BUTTONS) {
      const button = el('button', 'search-panel-kindbtn', label);
      button.type = 'button';
      if (hint) button.title = hint;
      button.addEventListener('click', () => {
        const has = this.prefs.kinds.includes(kind);
        if (has && this.prefs.kinds.length === 1) return;
        this.prefs.kinds = SEARCH_TARGETS.filter((t) => (t === kind ? !has : this.prefs.kinds.includes(t)));
        this.savePrefs();
        this.renderFrame();
        this.resetPage();
        this.schedule(0);
      });
      this.kindButtons.set(kind, button);
      kinds.append(button);
    }

    this.status.setAttribute('aria-live', 'polite');
    this.list.setAttribute('role', 'list');
    this.list.setAttribute('aria-label', '検索の結果');
    this.more.type = 'button';
    this.more.hidden = true;
    this.more.addEventListener('click', () => {
      this.limit = Math.min(MAX_LIMIT, this.limit + PAGE);
      this.schedule(0); // 一覧の位置は残す
    });
    this.body.append(controls, kinds, this.status, this.list, this.more);
    this.element.append(this.head, this.body);
    this.renderFrame();
    // ここでは探さない（左から memoIndex が届いたときの refresh で初めて探す）
  }

  // ---------- 外から ----------

  // 上のタグから開く（右クリックの登録先）
  get header() {
    return this.head;
  }

  isCollapsed() {
    return this.prefs.collapsed;
  }

  expand() {
    if (!this.prefs.collapsed) return;
    this.prefs.collapsed = false;
    this.savePrefs();
    this.renderFrame();
    this.renderRows();
    this.schedule(0);
  }

  // 右に memoIndex が届いた：消えたメモの行を薄くして、同じ字・同じ件数で探し直す
  refresh() {
    this.renderRows();
    this.schedule(TYPING_MS);
  }

  // 左からの短い知らせ（状態の行に出す。次に結果を描くまで残る）
  notice(text: string) {
    this.renderStatus(text);
  }

  // 左からの結果（メモとコメント）
  receive(p: { seq: number; ready: boolean; items: SearchItem[]; total: number }) {
    if (p.seq !== this.waiting) return; // 古い返事は捨てる
    this.waiting = null;
    window.clearTimeout(this.silentTimer);
    this.memo = { items: p.ready ? p.items : [], total: p.ready ? p.total : 0, ready: p.ready };
    this.compose();
  }

  // 右の台帳（タブ・撮影・置き場・単語帳）が変わった：少し待って、右の中だけ探し直す（左には頼まない。一覧の位置は残る）
  localChanged() {
    if (this.prefs.collapsed || !this.memo || this.waiting !== null) return;
    if (!this.asked.kinds.some((k) => k !== 'memo')) return;
    window.clearTimeout(this.localTimer);
    this.localTimer = window.setTimeout(() => this.compose(), TYPING_MS);
  }

  // ---------- 探す ----------

  private resetPage() {
    this.limit = PAGE;
    this.list.scrollTop = 0;
  }

  private stopTimers() {
    window.clearTimeout(this.typingTimer);
    window.clearTimeout(this.silentTimer);
    window.clearTimeout(this.localTimer);
  }

  // delay 後に探す（0 はすぐ）。たたんでいたら何もしない
  private schedule(delay: number) {
    window.clearTimeout(this.typingTimer);
    if (this.prefs.collapsed) return;
    if (delay <= 0) this.run();
    else this.typingTimer = window.setTimeout(() => this.run(), delay);
  }

  private run() {
    window.clearTimeout(this.typingTimer);
    if (this.prefs.collapsed) return;
    window.clearTimeout(this.localTimer); // 右の探し直しの待ちは、この探しに含まれる
    const query = this.input.value;
    this.asked = { query, recent: queryWords(query).length === 0, sort: this.prefs.sort, limit: this.limit, kinds: [...this.prefs.kinds] };
    this.memo = null;
    window.clearTimeout(this.silentTimer);
    if (this.asked.kinds.includes('memo')) {
      // メモとコメントは左に頼む。返事が来たら右の中の結果と合わせる（receive → compose）
      const seq = ++this.seq;
      this.waiting = seq;
      this.deps.ask(seq, query, this.prefs.sort, this.limit);
      this.silentTimer = window.setTimeout(() => {
        if (this.waiting === seq) this.renderStatus('左の準備ができていません。少し待ってから探してください');
      }, SILENT_MS);
    } else {
      // メモを選んでいないときは左に頼まない（古い返事は waiting が null なので捨てられる）
      this.waiting = null;
      this.memo = { items: [], total: 0, ready: true };
      this.compose();
    }
  }

  // 左のメモの結果と右の中の結果を合わせて、一覧・状態の行・見出しの件数を描く
  private compose() {
    const memo = this.memo;
    if (!memo) return;
    const asked = this.asked;
    const kinds = asked.kinds.filter((k): k is LocalKind => k !== 'memo');
    const local = kinds.length > 0 ? this.deps.local(asked.query, kinds) : { items: [], notes: [] };
    const notes = [...(memo.ready ? [] : ['メモ・コメントは準備中です（左がメモを読み込んでいます）']), ...local.notes];
    this.shown = {
      rows: mergeRows(memo.items, local.items, asked.limit),
      total: memo.total + local.items.length,
      recent: asked.recent,
      sort: asked.sort,
      limit: asked.limit,
      kinds: asked.kinds,
      notes,
    };
    this.renderRows();
    this.renderStatus(this.statusOf(this.shown));
    this.sub.textContent = this.shown.recent || this.shown.total === 0 ? '' : `${this.shown.total} 件`;
  }

  // ---------- 描く ----------

  // 見出し・たたみ・並べ方のボタン
  private renderFrame() {
    const collapsed = this.prefs.collapsed;
    this.fold.textContent = collapsed ? '▸' : '▾';
    this.fold.title = collapsed ? '検索を開く' : '検索をたたむ';
    this.fold.setAttribute('aria-label', this.fold.title);
    this.fold.setAttribute('aria-expanded', String(!collapsed));
    this.body.hidden = collapsed;
    for (const [sort, button] of this.sortButtons) {
      const on = sort === this.prefs.sort;
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
    }
    for (const [kind, button] of this.kindButtons) {
      const on = this.prefs.kinds.includes(kind);
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
    }
  }

  private renderStatus(text: string) {
    this.status.textContent = text;
  }

  // 状態の行：主な文に、読み込み中などの知らせを全角の空白でつなぐ
  private statusOf(shown: Shown): string {
    let main = '';
    if (shown.recent) {
      const updated = shown.sort === 'updated';
      if (shown.kinds.every((k) => k === 'tab')) main = 'タブは、字を入れると探せます';
      else if (shown.kinds.length === 1 && shown.kinds[0] === 'memo') main = updated ? '最近のメモ（更新順）' : '最近のメモ（新しい順）';
      else main = updated ? '最近のもの（更新順）' : '最近のもの（新しい順）';
    } else if (shown.total === 0) {
      main = '見つかりませんでした';
    } else if (shown.limit >= MAX_LIMIT && shown.total > MAX_LIMIT) {
      main = `${MAX_LIMIT} 件まで出します。字を足して絞ってください`;
    }
    return [main, ...shown.notes].filter(Boolean).join('　');
  }

  private renderRows() {
    const shown = this.shown;
    // 押したボタンに、描き直した後もキーボードの位置を残す
    const active = document.activeElement instanceof HTMLElement && this.list.contains(document.activeElement) ? document.activeElement.dataset.focusKey : undefined;
    const top = this.list.scrollTop;
    this.list.replaceChildren(...(shown ? shown.rows.map((row) => ('memoId' in row ? this.rowNode(row) : this.localRowNode(row))) : []));
    this.list.scrollTop = top;
    if (active) this.list.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(active)}"]`)?.focus({ preventScroll: true });
    const rest = shown ? shown.total - shown.rows.length : 0;
    this.more.hidden = !shown || rest <= 0 || shown.limit >= MAX_LIMIT;
    if (!this.more.hidden) this.more.textContent = `ほか ${rest} 件を見る ▾`;
  }

  private rowNode(item: SearchItem): HTMLElement {
    const known = this.deps.memoKnown(item.memoId);
    const row = el('div', `search-row${known === false ? ' gone' : ''}`);
    row.setAttribute('role', 'listitem');
    const key = `${item.kind}:${item.memoId}:${item.replyId ?? ''}`;
    // もう無いメモなら開かずに知らせる（ここを押した時点の有無で見る）
    const guard = (act: () => void) => () => {
      if (this.deps.memoKnown(item.memoId) === false) this.renderStatus('そのメモは、もうありません');
      else act();
    };

    const main = el('button', 'search-row-main');
    main.type = 'button';
    main.dataset.focusKey = `${key}:main`;
    main.title = item.kind === 'reply' ? 'このコメントを下の区画で開く' : 'このメモを下の区画で開く';
    main.append(el('span', 'search-row-icon', item.kind === 'reply' ? '💬' : item.image ? '🖼' : '📝'), el('span', 'search-row-title', item.title));
    if (item.kind === 'reply') main.append(el('span', 'search-row-kind', 'コメント'));
    main.append(el('span', 'search-row-meta', this.metaOf(item)));
    if (item.snippet) main.append(snippetNode(item.snippet));
    main.addEventListener('click', guard(() => this.deps.openMemo(item)));

    const board = el('button', 'search-row-board', '盤面で見る');
    board.type = 'button';
    board.dataset.focusKey = `${key}:board`;
    board.title = '左の盤面で、このメモのセルを見る';
    board.addEventListener('click', guard(() => this.deps.showMemo(item.memoId)));

    row.append(main, board);
    return row;
  }

  // 右の中の行（タブ・撮影・置き場・単語帳）：大きいボタンだけ。押すと、その区画で開く
  private localRowNode(item: LocalItem): HTMLElement {
    const row = el('div', 'search-row local');
    row.setAttribute('role', 'listitem');

    const main = el('button', 'search-row-main');
    main.type = 'button';
    main.dataset.focusKey = `${item.kind}:${item.id}:main`;
    main.title = LOCAL_TITLE[item.kind];
    main.append(
      el('span', 'search-row-icon', LOCAL_ICON[item.kind]),
      el('span', 'search-row-title', item.title),
      el('span', 'search-row-kind', item.label),
      el('span', 'search-row-meta', this.localMetaOf(item)),
    );
    if (item.snippet) main.append(snippetNode(item.snippet));
    main.addEventListener('click', () => {
      if (!this.deps.openLocal(item)) this.renderStatus(LOCAL_GONE[item.kind]);
    });
    row.append(main);
    return row;
  }

  private localMetaOf(item: LocalItem): string {
    const parts: string[] = [];
    if (item.at !== null) {
      const time = timeOf(item.at);
      if (time) parts.push(time);
    }
    if (item.kind === 'tab' && item.sheet) {
      const sheet = this.deps.sheetName(item.sheet);
      if (sheet) parts.push(sheet);
    }
    if (item.where) parts.push(item.where);
    return parts.join(' · ');
  }

  private metaOf(item: SearchItem): string {
    const parts: string[] = [];
    const time = timeOf(item.at);
    if (time) parts.push(time);
    const sheet = this.deps.sheetName(item.sheet);
    if (sheet) parts.push(sheet);
    if (item.by) parts.push(item.by);
    if (item.liked) parts.push(`♥${item.liked}`);
    if (item.where === 'tags') parts.push('タグ');
    else if (item.where === 'quote') parts.push('引用');
    else if (item.where === 'quoteTitle') parts.push('引用元の題名');
    return parts.join(' · ');
  }

  private savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {
      // 保存できなくても動作は続ける
    }
  }
}

// 抜き出し：当たりの所は mark、ほかはテキストの節（HTML としては組み立てない）
function snippetNode(snippet: NonNullable<SearchItem['snippet']>): HTMLElement {
  const node = el('span', 'search-row-snippet');
  const text = snippet.text;
  if (snippet.head) node.append(document.createTextNode('…'));
  let at = 0;
  for (const [a, b] of snippet.marks) {
    if (a < at || b > text.length || a >= b) continue; // 形が合わないものは飛ばす
    if (a > at) node.append(document.createTextNode(text.slice(at, a)));
    node.append(el('mark', '', text.slice(a, b)));
    at = b;
  }
  if (at < text.length) node.append(document.createTextNode(text.slice(at)));
  if (snippet.tail) node.append(document.createTextNode('…'));
  return node;
}

// M/D HH:MM（時刻が無い・数でないときは空）
function timeOf(at: number): string {
  if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) return '';
  const d = new Date(at);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

function loadPrefs(): Prefs {
  const fallback: Prefs = { collapsed: false, sort: 'created', kinds: [...SEARCH_TARGETS] };
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    if (!raw || typeof raw !== 'object') return fallback;
    // 対象：知っている値だけを、決まった順に重なりなく取る（空なら全部）
    const kinds = Array.isArray(raw.kinds) ? SEARCH_TARGETS.filter((t) => (raw.kinds as unknown[]).includes(t)) : [];
    return { collapsed: raw.collapsed === true, sort: raw.sort === 'updated' ? 'updated' : 'created', kinds: kinds.length > 0 ? kinds : [...SEARCH_TARGETS] };
  } catch {
    return fallback;
  }
}
