// 右サイドバーの「検索」：メモ・コメントは左に探してもらい、タブ・撮影・データ置き場・単語帳は右の中で探して、1 本の一覧にする
//   ・メモとコメントを探すのは左（台帳を持っている）。ここは字と並べ方を渡して、返ってきた行を描く
//   ・タブ・撮影・置き場・単語帳は右が持っているので、deps.local で右の中を探し、左の結果と合わせて並べる（right-search.ts）
//   ・「対象」のボタンで、探すものを選ぶ（覚えておく。少なくとも 1 つは選んだまま）
//   ・字を打つと少し待って探す。Enter ですぐ探す。Escape で字を消す
//   ・並べ方：新しい順（作った時刻）／更新順（メモの変更・コメントの書き直し・♥ の新しいほう）。タブは時刻が無いので下にまとめる
//   ・行の大きいボタン：メモ・コメントは下の区画で開く（コメントなら、そのカードへ）。ほかは、その区画で開く。小さいボタン：左の盤面で見る（メモ・コメントだけ）
//     コメントの行には、もう一つ小さいボタン［上で開く］（上のボードでそのカードを選んで 100% で見せる。返信は左が一番上のカードに直す。MK4）。メモの行には出さない
//   ・切り替え［カードの ♥］（MK9。計画 docs/plan-comment-board-marks.md §4.9）：対象と並べ方とは別の切り替え（prefs に入れない＝覚えない。区画を作るたび・たたむたびに切）。
//     入れている間は、左に ♥ のカードの行だけを頼む（右の中は探さない。並べ方と対象のボタンは押せない）。段の絞り［♥1 以上］［♥2 以上］［♥3］と［まとめてコピー］（出している結果の字と段で、左が組み直して書く）
//   ・手本は tag-index.ts（見出し・▾ でたたむ・prefs・押したボタンの位置を残す）
import { t as tr } from '../i18n';
import type { LikeLevel } from '../likes';
import { type LocalItem, type LocalKind, mergeRows, type PanelRow, SEARCH_TARGETS, type SearchTarget } from '../right-search';
import { queryWords, type SearchItem, type SearchSort } from '../search';
import { el } from '../util';

export interface SearchPanelDeps {
  ask(seq: number, query: string, sort: SearchSort, limit: number, hearts: LikeLevel | null): void; // hearts：［カードの ♥］の段（切なら null。MK9）
  copyHearts(query: string, min: LikeLevel): void; // ［まとめてコピー］（MK9）：左が同じ条件（字・段）で台帳から組み直して書く。一言は左から notice で届く
  memoKnown(id: string): boolean | null; // 右の memoIndex にあるか（null：まだ左から届いていない）
  sheetName(id: string): string | null; // メイン以外のシートの名前（メインなら null）
  openMemo(item: SearchItem): void; // 下の区画で開く（コメントなら、そのカードへ）
  openBoard(memoId: string, replyId: string): void; // 上のボードで、このカードを開く（コメントの行だけ。MK4）
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
  hearts: LikeLevel | null; // ［カードの ♥］の段（切なら null。MK9）
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
  query: string; // 探した字（［まとめてコピー］はこの字と hearts で頼む。MK9）
  recent: boolean;
  sort: SearchSort;
  limit: number;
  kinds: SearchTarget[];
  hearts: LikeLevel | null; // ［カードの ♥］で探した結果なら、その段（MK9）
  notes: string[]; // 状態の行に添える知らせ（読み込み中など）
}

const PREFS_KEY = 'honeycomb.searchPanel';
const PAGE = 30; // 最初に出す件数と、「ほか n 件を見る」で足す件数
const MAX_LIMIT = 300;
const TYPING_MS = 250; // 字を打ち終わるのを待つ
const SILENT_MS = 3000; // 左から返事が無いと知らせるまで
const SORTS: [SearchSort, string][] = [
  ['created', tr('新しい順')],
  ['updated', tr('更新順')],
];
const KIND_BUTTONS: [SearchTarget, string, string][] = [
  ['memo', tr('メモ'), tr('メモとコメント')],
  ['tab', tr('タブ'), ''],
  ['capture', tr('撮影'), ''],
  ['vault', tr('置き場'), tr('データ置き場（目次だけ）')],
  ['vocab', tr('単語帳'), ''],
  ['reminder', tr('⏰ リマインダー'), tr('まだ鳴っていないリマインダー')],
];
// ［カードの ♥］の段の絞り（MK9。この段以上）
const HEART_BUTTONS: [LikeLevel, string][] = [
  [1, tr('♥1 以上')],
  [2, tr('♥2 以上')],
  [3, '♥3'],
];
const HEARTS_HEAD = tr('カードの ♥（新しい順）'); // ［カードの ♥］の結果を出している間の、状態の行の頭（MK9）
// 右の中の行：アイコン・押したときの title・押したときにもう無かった知らせ
const LOCAL_ICON: Record<LocalKind, string> = { tab: '🌐', capture: '📷', vault: '🗄', vocab: '📇', reminder: '⏰' };
const LOCAL_TITLE: Record<LocalKind, string> = {
  tab: tr('このタブを表示する'),
  capture: tr('撮影の区画で、このカードを出す'),
  vault: tr('データ置き場で、これを開く'),
  vocab: tr('単語帳で、このカードを開く'),
  reminder: tr('リマインダーの区画を開く'),
};
const LOCAL_GONE: Record<LocalKind, string> = {
  tab: tr('そのタブは、もうありません'),
  capture: tr('その撮影は、もうありません'),
  vault: tr('それは、もうデータ置き場にありません'),
  vocab: tr('そのカードは、もう単語帳にありません'),
  reminder: tr('そのリマインダーは、もうありません（鳴ったか、取り消されました）'),
};

export class SearchPanel {
  readonly element = el('section', 'panel-section search-panel');
  private prefs: Prefs = loadPrefs();
  private limit = PAGE; // 出す件数
  private seq = 0;
  private waiting: number | null = null; // 返事を待っている seq
  private asked: Asked = { query: '', recent: true, sort: this.prefs.sort, limit: PAGE, kinds: [...this.prefs.kinds], hearts: null }; // 待っている・出している探しの中身
  // ［カードの ♥］（MK9）：prefs に入れない（savePrefs は prefs を丸ごと書くので、ここに置く）。区画を作るたび・検索をたたむたびに切。段は ♥1 以上で始まる
  private hearts = false;
  private heartMin: LikeLevel = 1;
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
  private readonly heartToggle = el('button', 'search-panel-heartbtn', tr('カードの ♥'));
  private readonly heartOpts = el('span', 'search-panel-heartopts'); // 段の絞りと［まとめてコピー］（入れている間だけ見せる）
  private readonly heartButtons = new Map<LikeLevel, HTMLButtonElement>();
  private readonly heartCopy = el('button', 'search-panel-heartcopy', tr('まとめてコピー'));
  private readonly status = el('p', 'search-panel-status');
  private readonly list = el('div', 'search-panel-list');
  private readonly more = el('button', 'search-panel-more');

  constructor(private readonly deps: SearchPanelDeps) {
    this.element.setAttribute('aria-label', '検索');
    this.head.append(el('h2', 'search-panel-title', tr('検索')), this.sub, this.fold);
    this.fold.type = 'button';
    this.fold.addEventListener('click', () => {
      this.prefs.collapsed = !this.prefs.collapsed;
      if (this.prefs.collapsed) {
        this.hearts = false; // ［カードの ♥］は開くたびに切（たたむと切る。MK9）
        this.dropHeartsResult(); // ♥ の結果も捨てる（開いたときに、切ったのに古い ♥ の行と頭が見えないように）
      }
      this.savePrefs();
      this.renderFrame();
      if (this.prefs.collapsed) this.stopTimers();
      else this.schedule(0);
    });

    const controls = el('div', 'search-panel-controls');
    this.input.type = 'search';
    this.input.placeholder = tr('メモ・タブ・撮影などを探す');
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

    // ［カードの ♥］（MK9）：対象の下の行。切り替えと、入れている間だけの段の絞り・［まとめてコピー］
    const hearts = el('div', 'search-panel-hearts');
    hearts.setAttribute('role', 'group');
    hearts.setAttribute('aria-label', tr('カードの ♥'));
    this.heartToggle.type = 'button';
    this.heartToggle.addEventListener('click', () => {
      this.hearts = !this.hearts;
      this.renderFrame();
      this.resetPage();
      this.schedule(0);
    });
    for (const [level, label] of HEART_BUTTONS) {
      const button = el('button', 'search-panel-heartmin', label);
      button.type = 'button';
      button.addEventListener('click', () => {
        this.heartMin = level;
        this.renderFrame();
        this.resetPage();
        this.schedule(0);
      });
      this.heartButtons.set(level, button);
      this.heartOpts.append(button);
    }
    // 出している結果の条件（その結果を探した字と段。shown）で頼む。打ちかけの字の待ち・左の返事の待ちの間も、見えている一覧と同じものを写す。
    //   ♥ の結果をまだ出していない（入れた直後で、左の返事の前）ときは何もしない
    this.heartCopy.type = 'button';
    this.heartCopy.addEventListener('click', () => {
      const shown = this.shown;
      if (shown && shown.hearts !== null) this.deps.copyHearts(shown.query, shown.hearts);
    });
    this.heartOpts.append(this.heartCopy);
    hearts.append(this.heartToggle, this.heartOpts);

    this.status.setAttribute('aria-live', 'polite');
    this.list.setAttribute('role', 'list');
    this.list.setAttribute('aria-label', '検索の結果');
    this.more.type = 'button';
    this.more.hidden = true;
    this.more.addEventListener('click', () => {
      this.limit = Math.min(MAX_LIMIT, this.limit + PAGE);
      this.schedule(0); // 一覧の位置は残す
    });
    this.body.append(controls, kinds, hearts, this.status, this.list, this.more);
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
    if (this.asked.hearts !== null || !this.asked.kinds.some((k) => k !== 'memo')) return; // ［カードの ♥］の間は右の中を探さない（MK9）
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

  // ［カードの ♥］の結果を捨てる（たたむとき。MK9）：待っている返事・一覧・状態の行・見出しの件数を空にする。
  //   待っている探しも出している結果も ♥ でなければ、何もしない（ふつうの検索の結果は、たたんでも今のまま残す）
  private dropHeartsResult() {
    if (this.asked.hearts === null && (this.shown === null || this.shown.hearts === null)) return;
    this.waiting = null; // あとから届く ♥ の返事は捨てる
    this.memo = null;
    this.shown = null;
    this.sub.textContent = '';
    this.renderRows();
    this.renderStatus('');
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
    const hearts = this.hearts ? this.heartMin : null; // ［カードの ♥］（MK9）
    this.asked = { query, recent: queryWords(query).length === 0, sort: this.prefs.sort, limit: this.limit, kinds: [...this.prefs.kinds], hearts };
    this.memo = null;
    window.clearTimeout(this.silentTimer);
    if (hearts !== null || this.asked.kinds.includes('memo')) {
      // メモとコメントは左に頼む。返事が来たら右の中の結果と合わせる（receive → compose）。［カードの ♥］の間は、対象の選びによらず左に ♥ のカードの行だけを頼む
      const seq = ++this.seq;
      this.waiting = seq;
      this.deps.ask(seq, query, this.prefs.sort, this.limit, hearts);
      this.silentTimer = window.setTimeout(() => {
        if (this.waiting === seq) this.renderStatus(tr('左の準備ができていません。少し待ってから探してください'));
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
    const kinds = asked.hearts !== null ? [] : asked.kinds.filter((k): k is LocalKind => k !== 'memo'); // ［カードの ♥］の間は、メモのカードの行だけ（MK9）
    const local = kinds.length > 0 ? this.deps.local(asked.query, kinds) : { items: [], notes: [] };
    const notes = [...(memo.ready ? [] : [tr('メモ・コメントは準備中です（左がメモを読み込んでいます）')]), ...local.notes];
    this.shown = {
      rows: mergeRows(memo.items, local.items, asked.limit),
      total: memo.total + local.items.length,
      query: asked.query,
      recent: asked.recent,
      sort: asked.sort,
      limit: asked.limit,
      kinds: asked.kinds,
      hearts: asked.hearts,
      notes,
    };
    this.renderRows();
    this.renderStatus(this.statusOf(this.shown));
    // 見出しの件数：［カードの ♥］では字が空でも出す（MK9）
    this.sub.textContent = (this.shown.recent && this.shown.hearts === null) || this.shown.total === 0 ? '' : tr('{0} 件', { 0: this.shown.total });
  }

  // ---------- 描く ----------

  // 見出し・たたみ・並べ方のボタン
  private renderFrame() {
    const collapsed = this.prefs.collapsed;
    this.fold.textContent = collapsed ? '▸' : '▾';
    this.fold.title = collapsed ? tr('検索を開く') : tr('検索をたたむ');
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
    // ［カードの ♥］（MK9）：入れている間だけ段の絞りと［まとめてコピー］を見せ、並べ方と対象のボタンは押せない（選びは prefs のまま残る）
    this.heartToggle.classList.toggle('on', this.hearts);
    this.heartToggle.setAttribute('aria-pressed', String(this.hearts));
    this.heartOpts.hidden = !this.hearts;
    for (const [level, button] of this.heartButtons) {
      const on = level === this.heartMin;
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
    }
    for (const button of [...this.sortButtons.values(), ...this.kindButtons.values()]) button.disabled = this.hearts;
  }

  // 状態の行に字を出す。出している結果が［カードの ♥］なら、頭はいつも「カードの ♥（新しい順）」（MK9）。
  //   結果の文（statusOf）にも、左からの一言（notice）・もう無いメモの知らせ（guard）・左の返事が無い知らせにも付ける（字が空なら頭だけ）
  private renderStatus(text: string) {
    const head = this.shown !== null && this.shown.hearts !== null ? HEARTS_HEAD : '';
    this.status.textContent = [head, text].filter(Boolean).join('　');
  }

  // 状態の行の文：主な文に、読み込み中などの知らせを全角の空白でつなぐ
  //   ［カードの ♥］（MK9）：頭は renderStatus が付ける。字で当たらなければ「見つかりませんでした」、300 件を超えれば上限の文を添える（字が空で 0 件なら空＝頭だけ）
  private statusOf(shown: Shown): string {
    let main = '';
    if (shown.recent && shown.hearts === null) {
      const updated = shown.sort === 'updated';
      if (shown.kinds.every((k) => k === 'tab')) main = tr('タブは、字を入れると探せます');
      else if (shown.kinds.length === 1 && shown.kinds[0] === 'memo') main = updated ? tr('最近のメモ（更新順）') : tr('最近のメモ（新しい順）');
      else main = updated ? tr('最近のもの（更新順）') : tr('最近のもの（新しい順）');
    } else if (shown.total === 0) {
      if (!shown.recent) main = tr('見つかりませんでした');
    } else if (shown.limit >= MAX_LIMIT && shown.total > MAX_LIMIT) {
      main = tr('{0} 件まで出します。字を足して絞ってください', { 0: MAX_LIMIT });
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
    if (!this.more.hidden) this.more.textContent = tr('ほか {0} 件を見る ▾', { 0: rest });
  }

  private rowNode(item: SearchItem): HTMLElement {
    const known = this.deps.memoKnown(item.memoId);
    const row = el('div', `search-row${known === false ? ' gone' : ''}`);
    row.setAttribute('role', 'listitem');
    const key = `${item.kind}:${item.memoId}:${item.replyId ?? ''}`;
    // もう無いメモなら開かずに知らせる（ここを押した時点の有無で見る）
    const guard = (act: () => void) => () => {
      if (this.deps.memoKnown(item.memoId) === false) this.renderStatus(tr('そのメモは、もうありません'));
      else act();
    };

    const main = el('button', 'search-row-main');
    main.type = 'button';
    main.dataset.focusKey = `${key}:main`;
    main.title = item.kind === 'reply' ? tr('このコメントを下の区画で開く') : tr('このメモを下の区画で開く');
    // 題の枠：［カードの ♥］の行は「♥2 メモの題」（♥ の段は題の枠の中。行の格子の列は増やさない。MK9）
    const title = el('span', 'search-row-title');
    if (item.cardLike) title.append(el('span', 'search-row-like', `♥${item.cardLike}`), ' ');
    title.append(item.title);
    main.append(el('span', 'search-row-icon', item.kind === 'reply' ? '💬' : item.image ? '🖼' : '📝'), title);
    if (item.kind === 'reply') main.append(el('span', 'search-row-kind', tr('コメント')));
    main.append(el('span', 'search-row-meta', this.metaOf(item)));
    if (item.snippet) main.append(snippetNode(item.snippet));
    else if (item.cardHead) main.append(el('span', 'search-row-snippet', item.cardHead)); // ［カードの ♥］で字が空のとき：カードの文の頭（抜き出しの席。MK9）
    main.addEventListener('click', guard(() => this.deps.openMemo(item)));

    // 小さいボタンの並び（右寄せ）：コメントの行は［上で開く］［盤面で見る］、メモの行は［盤面で見る］だけ
    const actions = el('div', 'search-row-actions');
    if (item.kind === 'reply' && item.replyId) {
      const replyId = item.replyId;
      const upper = el('button', 'search-row-upper', tr('上で開く'));
      upper.type = 'button';
      upper.dataset.focusKey = `${key}:upper`;
      upper.title = tr('上のボードで、このカードを開きます');
      upper.addEventListener('click', guard(() => this.deps.openBoard(item.memoId, replyId)));
      actions.append(upper);
    }

    const board = el('button', 'search-row-board', tr('盤面で見る'));
    board.type = 'button';
    board.dataset.focusKey = `${key}:board`;
    board.title = tr('左の盤面で、このメモのセルを見る');
    board.addEventListener('click', guard(() => this.deps.showMemo(item.memoId)));
    actions.append(board);

    row.append(main, actions);
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
    if (item.where === 'tags') parts.push(tr('タグ'));
    else if (item.where === 'quote') parts.push(tr('引用'));
    else if (item.where === 'quoteTitle') parts.push(tr('引用元の題名'));
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
