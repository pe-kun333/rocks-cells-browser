// 単語帳のパネル（右サイドバー）
//   ・カードの一覧（覚えた度合いは六角形の辺）と、手で入れる・このページから AI で作る・六角メモへ送る
//   ・復習：時期が来たカードを1枚ずつ。答えを見て「もう一度 / 難しい / できた / かんたん」（キーは Space と 1〜4）
//   台帳は左サイドバーが持つので、変えたいときは左に頼む（askLeft）
import { t } from '../i18n';
import { makeCards } from '../ai/cards';
import { BUDGET_NEAR_NOTE } from '../ai/budget';
import { formatLesson, lessonFailure, makeLesson } from '../ai/lesson';
import type { OrganizeSettings } from '../ai/organize';
import { BLOCK_NOTE, pageIsBlocked } from '../blocklist';
import { requestPageText } from '../ai/page';
import { hexCornerPoints } from '../hex';
import { type HexMemoTarget, sendToHexMemo } from '../integrations/hexmemo';
import { clockOf, newReminderId, presetTimes, triggeredReminder } from '../reminder-when';
import { samePage } from '../threads';
import type { HexMemoRecord, RelayCommand, Reminder } from '../types';
import { el, hostOf } from '../util';
import type { VaultDraft } from '../vault';
import {
  type CardDraft,
  type CardImage,
  type CardKind,
  type CardLink,
  cardKey,
  cardLinks,
  cleanNote,
  dayOf,
  dueInDays,
  findVocabTab,
  type Grade,
  intervalLabel,
  isDue,
  isWeak,
  type LinkRole,
  MAX_LINKS,
  NEXT_DAYS_MAX,
  NOTIFY_HOUR,
  sameCell,
  schedule,
  type VocabCard,
  type VocabLink,
  type VocabState,
} from '../vocab';
import {
  type Choices,
  type ClozePart,
  clozeParts,
  compareTyped,
  forecastDays,
  hasCloze,
  isWilting,
  overdueDays,
  pickChoices,
  pickVoice,
  promptSide,
  speechLang,
} from '../vocab-view';

export interface VocabPanelHost {
  askLeft(action: RelayCommand): void;
  settings(): OrganizeSettings;
  hexMemoTarget(): HexMemoTarget | null;
  activeTabId(): number | null;
  tabs(): readonly { id: number; title: string; url: string; sheet: string }[];
  memos(): readonly { id: string; title: string; sheet: string }[] | null; // null：左からの写しがまだ
  sheetName(id: string): string;
  openUrl(url: string): void;
  announce(text: string): void; // 相棒の吹き出しで知らせる
  toVault?(draft: VaultDraft): Promise<boolean>; // データ置き場（右サイドバーのメモの区画の下）に入れる
  openRotate?(): void; // 月の窓のめぐる表示の ⚙ を開く（レターも Visions も無いと、月の窓は隠れているので、ここが入口）
  addReminder?(reminder: Reminder): boolean; // カードから「復習を思い出す」（K4。false：いっぱいで置かなかった。知らせは host が出す）
  image?(image: CardImage): string | null | undefined; // 指す画像の data URL（K6c-1。読んでいる間は undefined、消えていれば null）
  imageChoices?(): { captures: readonly { id: string; label: string; at: number }[]; shots: readonly { id: string; label: string }[] }; // 撮影（新しい順）と画像のセル（K6c-1）
}

const SESSION_MAX = 50; // 1回の復習の枚数
const UNDO_MS = 5000; // 評価の「元に戻す」を出す間（K5b）
const LIST_STEP = 20;
const DUE_KEY = 'honeycomb.vocab.hexDue';
const GRADES: [Grade, string][] = [
  ['again', t('もう一度')],
  ['hard', t('難しい')],
  ['good', t('できた')],
  ['easy', t('かんたん')],
];

interface Session {
  queue: string[]; // カードの id（「もう一度」は後ろにもう1回入る）
  index: number;
  revealed: boolean;
  counts: Record<Grade, number>;
  requeued: Set<string>;
  mode: 'review' | 'quiz';
  // K5a：この回だけの見せ方（台帳には残さない）
  reverse: boolean; // 逆向き：言葉のカードは裏を見せて表を答える
  answerBy: AnswerBy;
  draft: string; // 打って答える：書きかけ（描き直しで消えないように）
  typed: string | null; // 打って答える：答え合わせした文字
  choices: Choices | null; // 選ぶ：今のカードの 4 つ（choiceFor のカードのもの）
  choiceFor: string | null;
  picked: number | null; // 選ぶ：選んだ位置
  practiced: number; // 選ぶ：正しく選んだ数（練習なので評価は付けない）
}

type AnswerBy = 'see' | 'type' | 'choose'; // 答え方：見る・打つ・選ぶ
const ANSWER_BY: [AnswerBy, string, string][] = [
  ['see', t('見る'), t('答えを見てから、自分で評価します')],
  ['type', t('打つ'), t('答えを打ってから見ます。合った文字は金、違う文字は赤（評価は自分で付けます）')],
  ['choose', t('選ぶ'), t('4 つから選びます（練習。正しければ評価は付けず、違えば「もう一度」にします）')],
];

interface PendingLesson {
  title: string;
  url: string;
  text: string;
}

interface LessonView {
  title: string;
  summary: string;
  points: string[];
  cards: (CardDraft & { checked: boolean })[];
}

export class VocabPanel {
  readonly element = el('section', 'panel-section vocab-panel');
  private readonly body = el('div', 'vocab-body');
  private readonly status = el('div', 'panel-note organize-status');
  private state: VocabState = { cards: [], notify: true };
  private session: Session | null = null;
  private finished: string | null = null; // 復習を終えたときのまとめ
  private adding: { kind: CardKind; front: string; back: string; example: string } | null = null;
  private proposals: (CardDraft & { checked: boolean })[] | null = null;
  private proposalPage: { title: string; url: string } | null = null; // 案を作ったページ（データ置き場に残すとき）
  private pendingLesson: PendingLesson | null = null; // 確認が済むまで本文を持つ。作ったあとは捨てる
  private lesson: LessonView | null = null;
  private lessonBusy = false;
  private making = false;
  private sending = false;
  private query = '';
  private opened: string | null = null; // 一覧で開いているカード
  private editing: string | null = null;
  private linking: string | null = null; // セルを選んでいるカード
  private filter: { ids: Set<string>; label: string } | null = null; // セルで絞る（K6b。右の「つながったカード」から）
  private remindFor: string | null = null; // 「復習を思い出す」の行を開いているカード（K4b）
  private nextFor: string | null = null; // 「次は □ 日後」の欄を開いているカード（K5b）
  private imageFor: string | null = null; // 「🖼 画像を付ける…」の欄を開いているカード（K6c-1）
  private cellQuery = '';
  private shown = LIST_STEP;
  private statusTimer = 0;
  // 直前の評価（K5b。5 秒だけ「元に戻す」。前の時期・度合い・回数と、復習のどこにいたか）
  private gradeUndo: { id: string; front: string; grade: Grade; before: Pick<VocabCard, 'due' | 'level' | 'reviews' | 'lapses'>; index: number; requeued: boolean } | null = null;
  private gradeUndoTimer = 0;

  constructor(private readonly host: VocabPanelHost) {
    this.element.append(this.body, this.status);
    window.addEventListener('keydown', (e) => this.onKey(e));
    // 読み上げの声は後から届くことがある（届いたら 🔊 のボタンを出し直す。K5a）
    window.speechSynthesis?.addEventListener?.('voiceschanged', () => {
      if (!this.isTyping()) this.render();
    });
    this.render();
  }

  setState(state: VocabState) {
    this.state = state;
    if (this.isTyping()) return; // 書いている途中は描き直さない
    this.render();
  }

  private card(id: string) {
    return this.state.cards.find((c) => c.id === id);
  }

  // ほかの区画から「＋カード」を下書きつきで開く（K3：鳴ったリマインダーの「カードに」）。復習の途中なら開かない
  startAdd(draft: { front?: string; back?: string; example?: string }): boolean {
    if (this.session) return false;
    this.adding = { kind: 'word', front: draft.front ?? '', back: draft.back ?? '', example: draft.example ?? '' };
    this.render();
    window.requestAnimationFrame(() => {
      const form = this.body.querySelector<HTMLElement>('.vocab-form');
      form?.scrollIntoView({ block: 'nearest' });
      form?.querySelector<HTMLElement>(draft.front ? 'textarea' : 'input')?.focus(); // 表が入っていれば裏（意味）の欄へ
    });
    return true;
  }

  // 月の窓の「単語帳で開く」：一覧でそのカードを開いて見せる（復習の途中なら、復習はそのまま）
  reveal(id: string) {
    const card = this.card(id);
    if (!card) return;
    if (!this.session) {
      this.query = '';
      this.opened = id;
      this.editing = null;
      const at = [...this.state.cards].sort((a, b) => b.createdAt - a.createdAt).findIndex((c) => c.id === id);
      this.shown = Math.max(this.shown, Math.ceil((at + 1) / LIST_STEP) * LIST_STEP);
      this.render();
    }
    window.requestAnimationFrame(() => {
      const target = this.element.querySelector<HTMLElement>('.vocab-item.open') ?? this.element;
      target.scrollIntoView({ block: 'nearest' });
      target.querySelector<HTMLElement>('.vocab-line')?.focus({ preventScroll: true });
    });
  }

  // 左の盤面のセルの右クリック「つながったカードを見る」（K6b）：一覧をそのカードだけに絞る。復習の途中なら、終えたあとの一覧で効く
  setFilter(ids: string[], label: string) {
    this.filter = { ids: new Set(ids), label };
    this.query = '';
    this.shown = LIST_STEP;
    this.render();
    this.element.scrollIntoView({ block: 'nearest' });
  }

  // めぐる表示の 1 枚の「セルへ：題名」（K6d。リンクの先頭）。見つからないセルは出さない
  cellLink(card: VocabCard): { title: string; open(): void } | null {
    const link = cardLinks(card)[0];
    if (!link) return null;
    const found = this.lookup(link);
    if (found === 'missing') return null;
    return { title: found === 'pending' ? t('メモ') : found.title, open: () => this.openLink(link) };
  }

  private isTyping() {
    const a = document.activeElement;
    return (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) && this.element.contains(a);
  }

  render() {
    const s = this.session;
    if (s) {
      while (s.index < s.queue.length && !this.card(s.queue[s.index])) s.index++; // 消されたカードは飛ばす
      if (s.index >= s.queue.length) this.endSession();
    }
    if (this.session) this.body.replaceChildren(this.reviewView(this.session));
    else this.body.replaceChildren(...this.homeView());
    if (this.state.readFailed === true) {
      this.body.prepend(el('div', 'panel-note field-error', t('単語帳の台帳を読めませんでした。いま入れたカードや復習の記録は保存されません。ブラウザを開き直してください')));
    }
  }

  // ---------- ふだんの表示 ----------

  private homeView(): HTMLElement[] {
    const cards = this.state.cards;
    const now = Date.now();
    const due = cards.filter((c) => isDue(c, now));
    const weak = cards.filter(isWeak);
    const quizzes = cards.filter((c) => c.kind === 'quiz');
    const quizDue = quizzes.filter((c) => isDue(c, now));
    const learned = cards.filter((c) => c.level >= 6).length;

    const head = el('div', 'info-head');
    const add = el('button', 'ai-small', t('＋カード'));
    add.addEventListener('click', () => {
      this.adding = this.adding ? null : { kind: 'word', front: '', back: '', example: '' };
      this.render();
      this.body.querySelector<HTMLInputElement>('.vocab-form input')?.focus();
    });
    head.append(el('div', 'panel-subtitle', t('単語帳')), add);

    const summary = el('div', 'vocab-summary');
    summary.append(
      el('span', `vocab-due${due.length > 0 ? ' has' : ''}`, t('今日の復習 {0} 枚', { 0: due.length })),
      el('span', 'organize-count', t('全 {0} 枚・問い {1}・覚えた {2}・苦手 {3}', { 0: cards.length, 1: quizzes.length, 2: learned, 3: weak.length })),
    );

    const buttons = el('div', 'route-actions');
    const review = el('button', 'ai-small vocab-start', t('復習する（{0} 枚）', { 0: Math.min(due.length, SESSION_MAX) }));
    review.disabled = due.length === 0;
    review.addEventListener('click', () => this.start(due, 'review'));
    const weakButton = el('button', 'ai-small', t('苦手だけ（{0}）', { 0: weak.length }));
    weakButton.disabled = weak.length === 0;
    weakButton.title = t('「もう一度」が多いカードだけを、時期に関係なく復習する');
    weakButton.addEventListener('click', () => this.start(weak, 'review'));
    const quizQueue = quizDue.length > 0 ? quizDue : quizzes;
    const quiz = el('button', 'ai-small', t('クイズ（{0} 問）', { 0: Math.min(quizQueue.length, SESSION_MAX) }));
    quiz.disabled = quizzes.length === 0 || this.making || this.lessonBusy;
    quiz.title =
      quizzes.length === 0
        ? t('問いのカードがありません。記事を教材にするか、返事の「教材にする」「クイズにする」で作れます')
        : quizDue.length > 0
          ? t('時期が来た問いだけを出します')
          : t('時期が来た問いは無いので、問いのカードを全部出します');
    quiz.addEventListener('click', () => this.start(quizQueue, 'quiz'));
    const fromPage = el('button', 'ai-small', this.making ? t('作っています…') : t('このページから作る（AI）'));
    fromPage.title = t('表示中のページから、覚えておくとよい言葉と、理解を確かめる問いのカードを AI が作る（入れる前に選べます）');
    fromPage.disabled = this.making || this.lessonBusy;
    fromPage.addEventListener('click', () => void this.makeFromPage());
    const toLesson = el('button', 'ai-small', this.lessonBusy ? t('作っています…') : t('記事を教材にする'));
    toLesson.title = t('表示中のページから、要点と問いを作ります。作る前に確認します。渡し止めのページの本文は送りません');
    toLesson.disabled = this.making || this.lessonBusy;
    toLesson.addEventListener('click', () => void this.prepareLesson());
    const unsent = cards.filter((c) => !c.sent);
    const hex = el('button', 'ai-small', this.sending ? t('送っています…') : t('六角メモへ（{0}）', { 0: unsent.length }));
    hex.title = t('まだ送っていないカードを、六角メモの送り先のノートへ送る（覚えた度合いは六角形の進み具合として）');
    hex.disabled = this.sending || unsent.length === 0;
    hex.addEventListener('click', () => void this.sendToHexMemo(unsent));
    buttons.append(review, weakButton, quiz, fromPage, toLesson, hex);
    if (this.host.openRotate) {
      const rotate = el('button', 'ai-small', t('⟳ 月の窓に映す…'));
      rotate.title = t('右サイドバーの上の月の窓で、カードを決めた間で1枚ずつ映す設定を開きます（AI は使いません）');
      const openRotate = this.host.openRotate;
      rotate.addEventListener('click', () => openRotate());
      buttons.append(rotate);
    }

    // 暦の予報（K5a）：カードが無いときは出さない
    const parts: HTMLElement[] = cards.length > 0 ? [head, summary, forecastRow(cards), buttons] : [head, summary, buttons];
    if (this.finished) {
      const done = el('div', 'vocab-finished', this.finished);
      parts.push(done);
    }
    {
      const undo = this.gradeUndoRow(); // 復習の最後の 1 枚の評価も、終えたあと 5 秒は戻せる（K5b）
      if (undo) parts.push(undo);
    }
    if (this.adding) parts.push(this.addForm(this.adding));
    if (this.pendingLesson) parts.push(this.confirmView(this.pendingLesson));
    if (this.lesson) parts.push(this.lessonView(this.lesson));
    if (this.proposals) parts.push(this.proposalView(this.proposals));
    if (cards.length > 0) parts.push(this.listView(cards));
    else if (!this.adding && !this.proposals && !this.pendingLesson && !this.lesson) {
      parts.push(
        el(
          'div',
          'reminder-empty',
          t('まだカードがありません。「＋カード」で入れるほか、相棒の返事の「単語帳へ」、六角で読む画面の「単語帳へ」、「このページから作る（AI）」、「記事を教材にする」でも入れられます。'),
        ),
      );
    }

    const notify = el('label', 'ai-check');
    const notifyBox = el('input');
    notifyBox.type = 'checkbox';
    notifyBox.checked = this.state.notify;
    notifyBox.addEventListener('change', () => this.host.askLeft({ command: 'setVocabNotify', notify: notifyBox.checked }));
    notify.append(notifyBox, document.createTextNode(t('復習の時期を相棒が知らせる（1日1回、{0}時から）', { 0: NOTIFY_HOUR })));
    const withDue = el('label', 'ai-check');
    const dueBox = el('input');
    dueBox.type = 'checkbox';
    dueBox.checked = loadFlag(DUE_KEY);
    dueBox.addEventListener('change', () => saveFlag(DUE_KEY, dueBox.checked));
    withDue.append(dueBox, document.createTextNode(t('六角メモへ送るとき、次の復習日を期限として付ける')));
    parts.push(
      notify,
      withDue,
      el(
        'p',
        'panel-note',
        t('覚えた度合いは六角形の辺で表します（6本で「覚えた」）。答えるたびに、次の復習までの間があきます（1日 → 2日 → 4日 → 1週間 → 2週間 → 1か月）。カードはこのパソコンの中に保存します。「記事を教材にする」は、作るを押すまで本文を送りません。練習モードでは送りません。渡し止めのページの本文は教材にしません。'),
      ),
    );
    return parts;
  }

  private addForm(draft: NonNullable<VocabPanel['adding']>): HTMLElement {
    const form = el('form', 'vocab-form');
    const kind = el('div', 'seg vocab-kind');
    for (const [k, label] of [
      ['word', t('言葉')],
      ['quiz', t('問い')],
    ] as const) {
      const b = el('button', 'ai-small', label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(draft.kind === k));
      b.addEventListener('click', () => {
        draft.kind = k;
        this.render();
      });
      kind.append(b);
    }
    const front = el('input');
    front.placeholder = draft.kind === 'word' ? t('言葉（例：ドーパミン）') : t('問い');
    front.value = draft.front;
    front.maxLength = 400;
    front.addEventListener('input', () => (draft.front = front.value));
    const back = el('textarea', 'info-textarea');
    back.placeholder = draft.kind === 'word' ? t('意味・説明') : t('答え');
    back.rows = 3;
    back.value = draft.back;
    back.maxLength = 1000;
    back.addEventListener('input', () => (draft.back = back.value));
    const example = el('input');
    example.placeholder = t('例文・メモ（なくてもよい）');
    example.value = draft.example;
    example.maxLength = 300;
    example.addEventListener('input', () => (draft.example = example.value));
    const ok = el('button', 'ai-small', t('入れる'));
    ok.type = 'submit';
    const cancel = el('button', 'ai-small', t('やめる'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      this.adding = null;
      this.render();
    });
    const row = el('div', 'ai-row');
    row.append(ok, cancel);
    form.append(kind, front, back, example, row);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!draft.front.trim() || !draft.back.trim()) {
        this.setStatus(t('言葉（問い）と、意味（答え）の両方を書いてください'));
        return;
      }
      this.addCards([{ kind: draft.kind, front: draft.front, back: draft.back, example: draft.example || undefined }]);
      this.adding = null;
      (document.activeElement as HTMLElement | null)?.blur();
      this.render();
    });
    return form;
  }

  private proposalView(list: NonNullable<VocabPanel['proposals']>): HTMLElement {
    const box = el('div', 'vocab-proposals');
    box.append(el('div', 'route-list-label', t('AI のカードの案（入れるものに印）')));
    for (const p of list) {
      const row = el('label', 'vocab-proposal');
      const check = el('input');
      check.type = 'checkbox';
      check.checked = p.checked;
      check.addEventListener('change', () => (p.checked = check.checked));
      const text = el('span', 'vocab-proposal-text');
      text.append(el('strong', '', `${p.kind === 'quiz' ? 'Q. ' : ''}${p.front}`), el('span', '', p.back));
      row.append(check, text);
      box.append(row);
    }
    const ok = el('button', 'ai-small', t('印を付けたものを入れる'));
    ok.addEventListener('click', () => {
      this.addCards(list.filter((p) => p.checked).map(({ checked: _, ...d }) => d));
      this.proposals = null;
      this.render();
    });
    const cancel = el('button', 'ai-small', t('やめる'));
    cancel.addEventListener('click', () => {
      this.proposals = null;
      this.render();
    });
    const row = el('div', 'ai-row');
    row.append(ok, cancel);
    const toVault = this.host.toVault;
    if (toVault) {
      // AI が作ったカードの案を、データ置き場に残す（印を付けたもの。単語帳に入れるかどうかとは別）
      const vault = el('button', 'ai-small', t('データ置き場へ'));
      vault.title = t('AI が作ったカードの案（印を付けたもの）を、データ置き場（右サイドバーのメモの区画の下）に残す');
      vault.addEventListener('click', () => {
        const picked = list.filter((p) => p.checked);
        if (picked.length === 0) return this.setStatus(t('残すカードに印を付けてください'));
        void toVault(vocabDraft(picked.map(({ checked: _, ...d }) => d), this.proposalPage));
      });
      row.append(vault);
    }
    box.append(row);
    return box;
  }

  private listView(cards: VocabCard[]): HTMLElement {
    const box = el('div', 'vocab-list-box');
    const search = el('input', 'vocab-search');
    search.placeholder = t('カードを探す');
    search.value = this.query;
    search.addEventListener('input', () => {
      this.query = search.value;
      this.shown = LIST_STEP;
      list.replaceChildren(...this.rows(cards));
    });
    const list = el('div', 'vocab-list');
    list.append(...this.rows(cards));
    if (this.filter) box.append(this.filterBar(this.filter, cards));
    box.append(search, list);
    return box;
  }

  // セルで絞った札（K6b）：「（label）の n 枚」と、絞りを外す
  private filterBar(filter: { ids: Set<string>; label: string }, cards: VocabCard[]): HTMLElement {
    const bar = el('div', 'vocab-filter');
    const n = cards.filter((c) => filter.ids.has(c.id)).length;
    bar.append(el('span', '', t('{0}の {1} 枚', { 0: filter.label, 1: n })));
    const clear = el('button', 'ai-small', t('絞りを外す'));
    clear.type = 'button';
    clear.addEventListener('click', () => {
      this.filter = null;
      this.render();
    });
    bar.append(clear);
    return bar;
  }

  private rows(cards: VocabCard[]): HTMLElement[] {
    const q = this.query.trim().toLowerCase();
    const hits = cards
      .filter((c) => !this.filter || this.filter.ids.has(c.id))
      .filter((c) => !q || `${c.front}\n${c.back}\n${c.example ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => b.createdAt - a.createdAt);
    const rows = hits.slice(0, this.shown).map((c) => this.row(c));
    if (hits.length > this.shown) {
      const more = el('button', 'route-link', t('もっと見る（あと {0} 枚）', { 0: hits.length - this.shown }));
      more.addEventListener('click', () => {
        this.shown += LIST_STEP;
        this.render();
      });
      rows.push(more);
    }
    return rows;
  }

  private row(card: VocabCard): HTMLElement {
    const item = el('div', `vocab-item${this.opened === card.id ? ' open' : ''}`);
    const line = el('button', 'vocab-line');
    const hex = levelHex(card.level);
    if (isWilting(card)) {
      // 枯れかけ：時期を過ぎたまま長く放ってある（K5a）。見た目と説明を変える
      hex.classList.add('wilt');
      const title = hex.querySelector('title');
      if (title) title.textContent = t('時期を {0} 日過ぎています（覚えた度合い {1} / 6）', { 0: overdueDays(card), 1: card.level });
    }
    line.append(hex, el('span', 'vocab-front', `${card.kind === 'quiz' ? 'Q. ' : ''}${card.front}`), el('span', 'vocab-when', whenLabel(card)));
    line.addEventListener('click', () => {
      this.opened = this.opened === card.id ? null : card.id;
      this.editing = null;
      this.remindFor = null; // ほかのカードを開いたら、「復習を思い出す」の行は閉じる（K4b）
      this.nextFor = null; // 「次は □ 日後」の欄も閉じる（K5b）
      this.imageFor = null; // 画像の欄も閉じる（K6c-1）
      if (this.linking !== this.opened) this.linking = null;
      this.render();
    });
    // 行の頭のめぐる表示の印 ⟳（K1b）。押しても行は開かない
    const head = el('div', 'vocab-item-head');
    const mark = el('button', 'vocab-rotate-mark', '⟳');
    mark.type = 'button';
    mark.setAttribute('aria-pressed', String(card.rotate === true));
    mark.setAttribute('aria-label', 'めぐる表示の印');
    mark.title = card.rotate === true ? t('めぐる表示に出しています（押すと外す）') : t('めぐる表示に出す（月の窓の ⚙ で「⟳ の印だけ」を選ぶと、印のカードだけが映ります）');
    mark.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleRotate(card);
    });
    head.append(line, mark);
    item.append(head);
    if (this.opened !== card.id) {
      item.append(el('div', 'vocab-back-line', card.back));
      return item;
    }
    if (this.editing === card.id) {
      item.append(this.editForm(card));
      return item;
    }
    item.append(el('div', 'vocab-back', card.back));
    if (card.example) {
      // 例文の中の見出しの言葉は伏せる（K5a）。伏せられない例文は今のまま出す
      const parts = clozeParts(card.example, card.front, card.kind);
      item.append(hasCloze(parts) ? clozeExample(parts) : el('div', 'vocab-example', `「${card.example}」`));
    }
    // 指す画像（K6c-1）：例文の後ろ、メモの前。画像は写さず、指すだけ
    const picture = this.imageNode(card);
    if (picture) item.append(picture);
    // メモ（K5b）：例文の下。文は textContent で入れ、改行はそのまま見せる（CSS の pre-wrap）
    if (card.note) item.append(el('div', 'vocab-note', card.note));
    const meta = el('div', 'organize-count', t('復習 {0} 回・もう一度 {1} 回{2}', { 0: card.reviews, 1: card.lapses, 2: card.sent ? '・六角メモへ送った' : '' }));
    item.append(meta);
    const actions = el('div', 'ai-row vocab-actions');
    if (card.kind === 'word') {
      // 読み上げ（K5a）。この端末に言語の合う声が無いときは出さない
      const speak = speakButton(card.front);
      if (speak) actions.append(speak);
    }
    if (card.source) {
      const page = el('button', 'ai-small', t('ページを開く'));
      page.title = card.source.title || card.source.url;
      page.addEventListener('click', () => this.host.openUrl(card.source?.url ?? ''));
      actions.append(page);
    }
    // めぐる表示の印の付け外し（K1b）。「ページを開く」の後ろ（無ければ 🔊 の後ろ、それも無ければ先頭）
    const rotate = el('button', 'ai-small', card.rotate === true ? t('⟳ めぐるから外す') : t('⟳ めぐるに出す'));
    rotate.setAttribute('aria-pressed', String(card.rotate === true));
    rotate.addEventListener('click', () => this.toggleRotate(card));
    actions.append(rotate);
    if (this.host.addReminder) {
      // 復習を思い出す（K4b）：「直す」の前。押すと、ボタンの列の下に置く行を開く・閉じる
      const remind = el('button', 'ai-small', t('🔔 復習を思い出す…'));
      remind.type = 'button';
      remind.setAttribute('aria-expanded', String(this.remindFor === card.id));
      remind.addEventListener('click', () => {
        this.remindFor = this.remindFor === card.id ? null : card.id;
        this.render();
      });
      actions.append(remind);
    }
    // 次は □ 日後（K5b）：「直す」の前。押すと、ボタンの列のすぐ後ろの欄を開く・閉じる
    const next = el('button', 'ai-small', t('次は □ 日後…'));
    next.type = 'button';
    next.setAttribute('aria-expanded', String(this.nextFor === card.id));
    next.addEventListener('click', () => {
      this.nextFor = this.nextFor === card.id ? null : card.id;
      this.render();
    });
    actions.append(next);
    if (this.host.imageChoices) {
      // 画像を付ける・替える（K6c-1）：「次は □ 日後」の後ろ・「直す」の前。押すと、ボタンの列のすぐ後ろの欄を開く・閉じる
      const pick = el('button', 'ai-small', card.image ? t('🖼 画像を替える…') : t('🖼 画像を付ける…'));
      pick.type = 'button';
      pick.setAttribute('aria-expanded', String(this.imageFor === card.id));
      pick.addEventListener('click', () => {
        this.imageFor = this.imageFor === card.id ? null : card.id;
        this.render();
      });
      actions.append(pick);
    }
    const edit = el('button', 'ai-small', t('直す'));
    edit.addEventListener('click', () => {
      this.editing = card.id;
      this.render();
    });
    const remove = el('button', 'ai-small route-remove', t('消す'));
    remove.addEventListener('click', () => {
      this.host.askLeft({ command: 'removeCard', id: card.id });
      this.state = { ...this.state, cards: this.state.cards.filter((c) => c.id !== card.id) };
      this.opened = null;
      this.render();
    });
    actions.append(edit, remove);
    item.append(actions);
    if (this.imageFor === card.id) item.append(this.imageChooser(card));
    if (this.nextFor === card.id) item.append(this.nextForm(card));
    if (this.remindFor === card.id) item.append(this.remindRow(card));
    if (this.linking === card.id) item.append(this.cellChooser(card));
    else item.append(this.linkRow(card, true));
    return item;
  }

  // 「復習を思い出す」の行（K4b）：時刻の押しボタン（5 つまで）と「次に起動したとき」。置けたら行を閉じる
  private remindRow(card: VocabCard): HTMLElement {
    const row = el('div', 'vocab-remind');
    const text = t('復習：{0}', { 0: clipText(card.front, 40) });
    // 時刻は押したときに作る（行を開いたまま置いても「10 分後」がずれないように）
    for (const preset of presetTimes(Date.now()).slice(0, 5)) {
      const button = el('button', 'ai-small', preset.label);
      button.type = 'button';
      button.addEventListener('click', () => {
        const now = Date.now();
        const dueAt = presetTimes(now).find((p) => p.key === preset.key)?.dueAt ?? preset.dueAt;
        const at = new Date(dueAt);
        const reminder: Reminder = { id: newReminderId(now), text, dueAt, createdAt: now, by: 'user', card: card.id };
        this.remindCard(card, reminder, t('を {0}/{1} {2} に思い出させます', { 0: at.getMonth() + 1, 1: at.getDate(), 2: clockOf(dueAt) }));
      });
      row.append(button);
    }
    const startup = el('button', 'ai-small', t('次に起動したとき'));
    startup.type = 'button';
    startup.addEventListener('click', () =>
      this.remindCard(card, triggeredReminder(text, { kind: 'startup' }, Date.now(), { by: 'user', card: card.id }), t('を次に起動したときに思い出させます')),
    );
    row.append(startup);
    return row;
  }

  // 置く（K4b）：host が置けたら行を閉じて、状態の文を出す（置けなかったときは host が知らせる）
  private remindCard(card: VocabCard, reminder: Reminder, said: string) {
    if (!this.host.addReminder?.(reminder)) return;
    this.remindFor = null;
    this.setStatus(`「${clipText(card.front, 24)}」${said}`);
    this.render();
  }

  // 次は □ 日後（K5b）：次の復習の日を決め直す。台帳は左が書くので頼み、度合い（level）は変えない
  private nextForm(card: VocabCard): HTMLElement {
    const form = el('form', 'vocab-next-days');
    const days = el('input');
    days.type = 'number';
    days.min = '1';
    days.max = String(NEXT_DAYS_MAX);
    days.step = '1';
    // 今の時期までの日数。上限を超えるときは上限に合わせる（超えたままだと、決める前に欄が入力エラーになる）
    days.value = String(Math.min(NEXT_DAYS_MAX, Math.max(1, Math.round((card.due - Date.now()) / (24 * 60 * 60_000)))));
    days.setAttribute('aria-label', '何日後');
    const ok = el('button', 'ai-small', t('決める'));
    ok.type = 'submit';
    const cancel = el('button', 'ai-small', t('やめる'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      this.nextFor = null;
      this.render();
    });
    form.append(el('span', '', t('次の復習は')), days, el('span', '', t('日後')), ok, cancel);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const due = dueInDays(Number(days.value));
      this.host.askLeft({ command: 'updateCard', id: card.id, due });
      card.due = due;
      this.nextFor = null;
      const at = new Date(due);
      this.setStatus(t('「{0}」の次の復習を {1}/{2} にしました', { 0: clipText(card.front, 24), 1: at.getMonth() + 1, 2: at.getDate() }));
      this.render();
    });
    return form;
  }

  // 指す画像の部品（K6c-1）：画像の data URL は host から読む。読んでいる間は何も出さず（読み終えたら host が render を呼ぶ）、消えていれば「（消えた画像）」
  private imageNode(card: VocabCard): HTMLElement | null {
    const image = card.image;
    if (!image || !this.host.image) return null;
    const url = this.host.image(image);
    if (url === undefined) return null;
    if (url === null) return el('div', 'panel-note vocab-missing', t('（消えた画像）'));
    const img = el('img', 'vocab-image');
    img.src = url;
    img.alt = '';
    img.decoding = 'async';
    return img;
  }

  // 画像の選び（K6c-1）：撮影か画像のセルから付け替える。画像は写さず、指すだけ。台帳は左が書く（updateCard）
  private imageChooser(card: VocabCard): HTMLElement {
    const box = el('div', 'vocab-image-chooser');
    const choices = this.host.imageChoices?.() ?? { captures: [], shots: [] };
    box.append(el('div', 'organize-count', t('撮影か画像のセルを選んでください（画像は写さず、指すだけです）')));
    box.append(el('div', 'panel-subtitle', t('撮影')));
    if (choices.captures.length === 0) {
      box.append(el('div', 'panel-note vocab-missing', t('撮影はありません')));
    } else {
      const row = el('div', 'ai-row');
      for (const capture of choices.captures.slice(0, 12)) {
        const label = [captureStamp(capture.at), clipText(capture.label.trim(), 20)].filter(Boolean).join(' ');
        row.append(this.imageButton(card, { kind: 'capture', id: capture.id }, label));
      }
      box.append(row);
    }
    box.append(el('div', 'organize-count', t('撮影は 80 件まで。古いものから消えます')));
    box.append(el('div', 'panel-subtitle', t('画像のセル')));
    if (choices.shots.length === 0) {
      box.append(el('div', 'panel-note vocab-missing', t('画像のセルはありません')));
    } else {
      const row = el('div', 'ai-row');
      for (const shot of choices.shots.slice(0, 12)) {
        row.append(this.imageButton(card, { kind: 'shot', id: shot.id }, clipText(shot.label.trim(), 20) || t('画像のセル')));
      }
      box.append(row);
    }
    const actions = el('div', 'ai-row');
    if (card.image) {
      const off = el('button', 'ai-small', t('画像を外す'));
      off.type = 'button';
      off.addEventListener('click', () => this.clearImage(card));
      actions.append(off);
    }
    const close = el('button', 'ai-small', t('閉じる'));
    close.type = 'button';
    close.addEventListener('click', () => {
      this.imageFor = null;
      this.render();
    });
    actions.append(close);
    box.append(actions);
    return box;
  }

  // 選ぶボタン（K6c-1）：今の画像と同じ（kind と id が同じ）なら aria-pressed を true にする
  private imageButton(card: VocabCard, image: CardImage, label: string): HTMLButtonElement {
    const button = el('button', 'ai-small', label);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(card.image?.kind === image.kind && card.image?.id === image.id));
    button.addEventListener('click', () => this.pickImage(card, image));
    return button;
  }

  // 画像を付ける（K6c-1）：台帳は左が書くので頼み、見た目もすぐ直す（toggleRotate と同じ）
  private pickImage(card: VocabCard, image: CardImage) {
    this.host.askLeft({ command: 'updateCard', id: card.id, image });
    card.image = image;
    this.imageFor = null;
    this.setStatus(t('画像を付けました'));
    this.render();
  }

  // 画像を外す（K6c-1）：左に null を頼み、見た目もすぐ直す
  private clearImage(card: VocabCard) {
    this.host.askLeft({ command: 'updateCard', id: card.id, image: null });
    delete card.image;
    this.imageFor = null;
    this.setStatus(t('画像を外しました'));
    this.render();
  }

  // めぐる表示の印を付け外す（K1b）。台帳は左が書くので頼み、見た目はすぐ直す（clearLink と同じ）
  private toggleRotate(card: VocabCard) {
    const on = card.rotate !== true;
    this.host.askLeft({ command: 'updateCard', id: card.id, rotate: on });
    if (on) card.rotate = true;
    else delete card.rotate;
    this.setStatus(on ? t('「{0}」をめぐる表示に出します', { 0: clipText(card.front, 24) }) : t('「{0}」をめぐる表示から外しました', { 0: clipText(card.front, 24) }));
    this.render();
  }

  // 開いたカードのリンクの列（K6b）：リンクごとに、役目の札・セルへ・ページを開く・×。editable のときだけ、役目を変える・外す・足す
  private linkRow(card: VocabCard, editable: boolean): HTMLElement {
    const wrap = el('div', 'vocab-link');
    const links = cardLinks(card);
    links.forEach((link, index) => {
      const row = el('div', 'ai-row vocab-link-row');
      if (editable) {
        const role = el('button', 'vocab-link-role', roleLabel(link.role));
        role.type = 'button';
        role.dataset.role = link.role ?? '';
        role.title = t('役目を変えます（押すたびに 役目なし → 出典 → 関連 → 役目なし）');
        role.addEventListener('click', () => this.setRole(card, index, nextRole(link.role)));
        row.append(role);
      } else if (link.role) {
        const role = el('span', 'vocab-link-role', roleLabel(link.role));
        role.dataset.role = link.role;
        row.append(role);
      }
      const found = this.lookup(link);
      const missing = found === 'missing';
      const reason = link.kind === 'memo' ? 'そのメモのセルは、もうありません' : t('そのタブのセルは、もうありません');
      const goLabel = missing ? t('セルへ（見つかりません）') : found === 'pending' ? t('セルへ（メモ）') : t('セルへ：{0}', { 0: found.title });
      const goTitle = missing
        ? reason
        : found === 'pending'
          ? t('メモの一覧がまだ届いていません。押すと、左の盤面で探します')
          : t('{0}「{1}」{2}。押すと、そのシートに移ってセルを目立たせます{3}', { 0: found.kind === 'memo' ? 'メモ' : 'タブ', 1: found.title, 2: found.sheet ? `（${found.sheet}）` : '', 3: found.kind === 'memo' ? '。下の区画でも開きます' : '' });
      row.append(linkButton(goLabel, goTitle, () => this.openLink(link)));
      if (missing && link.kind === 'tab' && link.url && (!card.source || !samePage(card.source.url, link.url))) {
        const url = link.url;
        row.append(linkButton(t('ページを開く'), url, () => this.host.openUrl(url)));
      }
      if (editable) {
        const remove = el('button', 'vocab-link-remove', '×');
        remove.type = 'button';
        remove.title = t('このリンクを外す');
        remove.setAttribute('aria-label', 'このリンクを外す');
        remove.addEventListener('click', () => this.sendLinks(card, links.filter((_, j) => j !== index), t('セルを 1 つ外しました')));
        row.append(remove);
      }
      wrap.append(row);
      if (missing) wrap.append(el('div', 'panel-note vocab-missing', reason));
    });
    if (editable) {
      if (links.length === 0) {
        const row = el('div', 'ai-row');
        row.append(this.registerButton(card));
        wrap.append(row);
      } else if (links.length < MAX_LINKS) {
        const row = el('div', 'ai-row');
        row.append(linkButton(t('＋ セルを足す…'), t('左の盤面のタブか、メモのセルを、このカードにもう1つ結びます（{0} つまで）', { 0: MAX_LINKS }), () => this.startLinking(card.id)));
        wrap.append(row);
      }
    }
    return wrap;
  }

  private registerButton(card: VocabCard): HTMLButtonElement {
    return linkButton(t('セルを登録…'), t('左の盤面のタブか、メモのセルを、このカードに1つ登録します'), () => this.startLinking(card.id));
  }

  private startLinking(id: string) {
    this.linking = id;
    this.cellQuery = '';
    this.render();
    this.element.querySelector<HTMLInputElement>('.vocab-cells input')?.focus();
  }

  private lookup(link: VocabLink): { kind: 'tab' | 'memo'; title: string; sheet: string } | 'missing' | 'pending' {
    if (link.kind === 'tab') {
      const tab = findVocabTab(this.host.tabs(), link); // AR0：番号と URL で探す
      if (!tab) return 'missing';
      return { kind: 'tab', title: tab.title || hostOf(tab.url) || t('タブ'), sheet: this.host.sheetName(tab.sheet) };
    }
    const memos = this.host.memos();
    if (!memos) return 'pending';
    const memo = memos.find((item) => item.id === link.id);
    if (!memo) return 'missing';
    return { kind: 'memo', title: memo.title || t('（空のメモ）'), sheet: this.host.sheetName(memo.sheet) };
  }

  private openLink(link: VocabLink) {
    const found = this.lookup(link);
    if (found === 'missing') {
      this.setStatus(link.kind === 'memo' ? 'そのメモのセルは、もうありません' : t('そのタブのセルは、もうありません'));
      return;
    }
    this.host.askLeft({ command: 'openVocabCell', link: plainLink(link) });
  }

  // 並びを左に頼み（台帳は左が書く）、見た目もすぐ直す（K6b）。足す・外す・役目を変えるは、全部ここを通す
  private sendLinks(card: VocabCard, links: CardLink[], status: string) {
    const first = links[0];
    this.host.askLeft({ command: 'linkCard', id: card.id, link: first ? plainLink(first) : null, links });
    if (first) {
      card.links = links;
      card.link = plainLink(first);
    } else {
      delete card.links;
      delete card.link;
    }
    this.setStatus(status);
    this.render();
  }

  // 役目を回す（K6b）：役目なし → 出典 → 関連 → 役目なし
  private setRole(card: VocabCard, index: number, role: LinkRole | undefined) {
    const links = cardLinks(card).map((link, j) => (j === index ? withRole(link, role) : link));
    this.sendLinks(card, links, role ? t('役目を「{0}」にしました', { 0: roleLabel(role) }) : t('役目を外しました'));
  }

  // 選んだセルを足す（K6b）：同じセルが既にあれば何もしない。1 つ目は「出典」、2 つ目からは「関連」
  private saveLink(card: VocabCard, link: VocabLink, title: string) {
    const links = cardLinks(card);
    if (links.some((l) => sameCell(l, link))) {
      this.setStatus(t('「{0}」はもう登録してあります', { 0: clipText(title, 24) }));
      return;
    }
    if (links.length >= MAX_LINKS) {
      this.setStatus(t('1 枚のカードに結べるセルは {0} つまでです', { 0: MAX_LINKS }));
      return;
    }
    const role: LinkRole = links.length === 0 ? 'source' : 'related';
    this.linking = null;
    this.cellQuery = '';
    this.sendLinks(card, [...links, { ...link, role }], t('「{0}」を、このカードに登録しました', { 0: clipText(title, 24) }));
  }

  // タブとメモを、名前で絞って選ぶ（カードの中。一覧の検索と同じ）
  private cellChooser(card: VocabCard): HTMLElement {
    const box = el('div', 'vocab-cells');
    const search = el('input', 'vocab-search');
    search.placeholder = t('タブやメモの名前');
    search.value = this.cellQuery;
    search.setAttribute('aria-label', '登録するセルを名前で探す');
    const list = el('div', 'vocab-cell-list');
    const paint = () => list.replaceChildren(...this.cellChoices(card, search.value));
    search.addEventListener('input', () => {
      this.cellQuery = search.value;
      paint();
    });
    paint();
    const cancel = el('button', 'ai-small', t('やめる'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      this.linking = null;
      this.cellQuery = '';
      this.render();
    });
    box.append(el('div', 'panel-note', t('タブか、メモのセルを1つ選びます。別のものを選ぶと入れかわります')), search, list, cancel);
    return box;
  }

  private cellChoices(card: VocabCard, query: string): HTMLElement[] {
    const q = query.trim().toLowerCase();
    const tabs = this.host.tabs().map((tab) => ({
      link: { kind: 'tab' as const, id: tab.id, url: tab.url },
      title: tab.title || hostOf(tab.url) || t('新しいタブ'),
      kind: t('タブ'),
      sheet: this.host.sheetName(tab.sheet),
    }));
    const memos = this.host.memos();
    const notes =
      memos?.map((memo) => ({
        link: { kind: 'memo' as const, id: memo.id },
        title: memo.title || t('（空のメモ）'),
        kind: t('メモ'),
        sheet: this.host.sheetName(memo.sheet),
      })) ?? [];
    const hits = [...tabs, ...notes].filter((item) => !q || `${item.title}\n${item.sheet}`.toLowerCase().includes(q));
    const rows: HTMLElement[] = [];
    if (!memos) rows.push(el('div', 'panel-note vocab-missing', t('メモの一覧は、まだ届いていません（タブは選べます）')));
    if (hits.length === 0) {
      rows.push(el('div', 'panel-note vocab-missing', memos && tabs.length === 0 ? t('タブもメモのセルもありません') : t('見つかりません')));
      return rows;
    }
    for (const item of hits.slice(0, 30)) {
      const button = el('button', 'vocab-cell');
      button.type = 'button';
      button.title = t('{0}「{1}」を、このカードに登録します', { 0: item.kind, 1: item.title });
      button.append(el('span', 'vocab-cell-kind', item.kind), el('span', 'vocab-cell-name', item.title));
      if (item.sheet) button.append(el('span', 'vocab-cell-sheet', item.sheet));
      button.addEventListener('click', () => this.saveLink(card, item.link, item.title));
      rows.push(button);
    }
    if (hits.length > 30) rows.push(el('div', 'panel-note vocab-missing', t('ほか {0} 件は、名前を入れて絞ってください', { 0: hits.length - 30 })));
    return rows;
  }

  private editForm(card: VocabCard): HTMLElement {
    const form = el('form', 'vocab-form');
    const front = el('input');
    front.value = card.front;
    front.maxLength = 400;
    const back = el('textarea', 'info-textarea');
    back.rows = 3;
    back.value = card.back;
    back.maxLength = 1000;
    const example = el('input');
    example.value = card.example ?? '';
    example.placeholder = t('例文・メモ');
    example.maxLength = 300;
    const memo = el('textarea');
    memo.value = card.note ?? '';
    memo.placeholder = t('メモ（なくてもよい）');
    memo.maxLength = 500;
    memo.rows = 2;
    memo.setAttribute('aria-label', 'メモ');
    const ok = el('button', 'ai-small', t('決める'));
    ok.type = 'submit';
    const cancel = el('button', 'ai-small', t('やめる'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      this.editing = null;
      this.render();
    });
    const row = el('div', 'ai-row');
    row.append(ok, cancel);
    form.append(front, back, example, memo, row);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!front.value.trim() || !back.value.trim()) return;
      this.host.askLeft({ command: 'updateCard', id: card.id, front: front.value, back: back.value, example: example.value, note: memo.value });
      Object.assign(card, { front: front.value.trim(), back: back.value.trim(), example: example.value.trim() || undefined });
      // メモは見た目もすぐ直す（空なら外す。台帳の中身は左が cleanNote で決める）
      const note = cleanNote(memo.value);
      if (note) card.note = note;
      else delete card.note;
      this.editing = null;
      (document.activeElement as HTMLElement | null)?.blur();
      this.render();
    });
    return form;
  }

  // ---------- 復習 ----------

  private start(cards: VocabCard[], mode: Session['mode']) {
    const queue = [...cards].sort((a, b) => a.due - b.due || a.level - b.level).slice(0, SESSION_MAX).map((c) => c.id);
    if (queue.length === 0) {
      if (mode === 'quiz') this.setStatus(t('問いのカードがありません。先に「記事を教材にする」で作れます'));
      return;
    }
    this.session = {
      queue,
      index: 0,
      revealed: false,
      counts: { again: 0, hard: 0, good: 0, easy: 0 },
      requeued: new Set(),
      mode,
      reverse: false,
      answerBy: 'see',
      draft: '',
      typed: null,
      choices: null,
      choiceFor: null,
      picked: null,
      practiced: 0,
    };
    this.finished = null;
    this.render();
    this.element.scrollIntoView({ block: 'nearest' });
  }

  private reviewView(s: Session): HTMLElement {
    const box = el('div', 'vocab-review');
    const card = this.card(s.queue[s.index]);
    const head = el('div', 'info-head');
    const heading = s.mode === 'quiz' ? t('クイズ') : t('復習');
    head.append(el('div', 'panel-subtitle', `${heading} ${Math.min(s.index + 1, s.queue.length)} / ${s.queue.length}`));
    const stop = el('button', 'ai-small', t('やめる'));
    stop.title = t('ここでやめる（Esc）');
    stop.addEventListener('click', () => this.finish());
    head.append(stop);
    box.append(head);
    const undo = this.gradeUndoRow();
    if (undo) box.append(undo);
    if (!card) return box;
    box.append(this.reviewOptions(s));
    const choices = s.answerBy === 'choose' ? this.choicesFor(s, card) : null;
    const side = promptSide(card, s.reverse);
    const face = el('div', `vocab-card${s.revealed ? ' revealed' : ''}`);
    const top = el('div', 'vocab-card-top');
    top.append(levelHex(card.level, 22), el('span', 'ai-tag', card.kind === 'quiz' ? t('問い') : side.reversed ? t('言葉（逆向き）') : t('言葉')));
    // 読み上げるのは表の言葉。逆向きでは表が答えなので、答えを見てから
    const speak = card.kind === 'word' && (!side.reversed || s.revealed) ? speakButton(card.front) : null;
    if (speak) top.append(speak);
    face.append(top, el('div', 'vocab-card-front', side.prompt));
    // 指す画像（K6c-1）：表の言葉のすぐ後ろ。逆向きでは答えを見たあとに出す（画像が答えの手がかりにならないように）
    const picture = side.reversed ? null : this.imageNode(card);
    if (picture) face.append(picture);
    if (!s.revealed && side.reversed && card.example) {
      // 逆向きのヒント：表の言葉を伏せた例文（伏せた言葉は押すと見える）
      const parts = clozeParts(card.example, card.front, card.kind);
      if (hasCloze(parts)) face.append(clozeExample(parts));
    }
    if (s.revealed) {
      face.append(el('div', 'vocab-card-back', side.answer));
      if (s.answerBy === 'type' && s.typed !== null) face.append(typedView(s.typed, side.answer));
      if (card.example) face.append(el('div', 'vocab-example', `「${card.example}」`));
      const reversedPicture = side.reversed ? this.imageNode(card) : null; // 逆向きの画像は答えを見たあと（K6c-1）
      if (reversedPicture) face.append(reversedPicture);
      if (card.source) {
        const page = el('button', 'route-link', `↗ ${card.source.title || card.source.url}`);
        page.addEventListener('click', () => this.host.openUrl(card.source?.url ?? ''));
        face.append(page);
      }
      if (cardLinks(card).length > 0) face.append(this.linkRow(card, false));
    }
    box.append(face);
    box.append(this.answerArea(s, card, choices));
    return box;
  }

  // この回だけの見せ方（K5a）：向きと答え方。答えを見る前だけ変えられ、今のカードから効く
  private reviewOptions(s: Session): HTMLElement {
    const row = el('div', 'vocab-review-options');
    const reverse = el('button', 'ai-small', t('⇄ 逆向き'));
    reverse.type = 'button';
    reverse.disabled = s.revealed || s.mode === 'quiz';
    reverse.setAttribute('aria-pressed', String(s.reverse));
    reverse.title =
      s.mode === 'quiz'
        ? t('問いのカードは向きを変えません')
        : t('意味を見て言葉を答えます（この回だけ。問いのカードは変わりません）。答えを見る前に切り替えられます');
    reverse.addEventListener('click', () => this.setReviewOption(s, { reverse: !s.reverse }));
    const group = el('div', 'vocab-answer-by');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', '答え方');
    for (const [key, label, title] of ANSWER_BY) {
      const b = el('button', 'ai-small', label);
      b.type = 'button';
      b.title = title;
      b.disabled = s.revealed;
      b.setAttribute('aria-pressed', String(s.answerBy === key));
      b.addEventListener('click', () => this.setReviewOption(s, { answerBy: key }));
      group.append(b);
    }
    row.append(reverse, el('span', 'organize-count', t('答え方')), group);
    return row;
  }

  private setReviewOption(s: Session, patch: Partial<Pick<Session, 'reverse' | 'answerBy'>>) {
    if (s.revealed) return;
    Object.assign(s, patch);
    s.draft = '';
    s.typed = null;
    s.picked = null;
    s.choiceFor = null; // 向きが変わると選ぶものも変わる
    this.render();
  }

  // 選ぶ：今のカードの 4 つ（カードが替わったら作り直す。答えの違うカードが足りなければ null）
  private choicesFor(s: Session, card: VocabCard): Choices | null {
    if (s.choiceFor !== card.id) {
      s.choices = pickChoices(card, this.state.cards, s.reverse);
      s.choiceFor = card.id;
    }
    return s.choices;
  }

  // 答えの欄：見る（Space）・打つ（Enter で答え合わせ）・選ぶ（1〜4）。答えのあとは評価、選んだときは「次へ」
  private answerArea(s: Session, card: VocabCard, choices: Choices | null): HTMLElement {
    const buttons = el('div', 'vocab-grades');
    if (s.answerBy === 'choose' && choices) {
      choices.options.forEach((text, i) => {
        const mark = !s.revealed ? '' : i === choices.answer ? ' right' : i === s.picked ? ' wrong' : '';
        const b = el('button', `ai-small vocab-choice${mark}`, `${i + 1}. ${text}`);
        b.type = 'button';
        b.disabled = s.revealed;
        b.addEventListener('click', () => this.pick(i));
        buttons.append(b);
      });
      if (s.revealed) {
        const right = s.picked === choices.answer;
        buttons.append(el('div', 'panel-note', right ? t('正解です（練習なので評価は付けません）') : t('違いました。「もう一度」にしました')));
        const next = el('button', 'ai-small vocab-show', t('次へ（Space）'));
        next.addEventListener('click', () => this.next());
        buttons.append(next);
      }
      return buttons;
    }
    if (!s.revealed) {
      if (s.answerBy === 'choose') buttons.append(el('div', 'panel-note', t('選ぶには、答えの違うカードがあと 3 枚要ります（このカードは「見る」で）')));
      if (s.answerBy === 'type') {
        buttons.append(this.typeForm(s, card));
      } else {
        const show = el('button', 'ai-small vocab-show', t('答えを見る（Space）'));
        show.addEventListener('click', () => this.revealAnswer());
        buttons.append(show);
      }
      return buttons;
    }
    GRADES.forEach(([grade, label], i) => {
      const b = el('button', `ai-small vocab-grade ${grade}`);
      b.append(el('span', '', `${i + 1}. ${label}`), el('span', 'vocab-next', intervalLabel(card, grade)));
      b.addEventListener('click', () => this.grade(grade));
      buttons.append(b);
    });
    return buttons;
  }

  // 打って答える欄（K5a）。Enter で答え合わせ。欄にいる間は Space と 1〜4 を取らない（onKey）
  private typeForm(s: Session, card: VocabCard): HTMLElement {
    const form = el('form', 'vocab-type');
    const input = el('input');
    input.type = 'text';
    input.value = s.draft;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = promptSide(card, s.reverse).reversed ? t('言葉を打つ') : t('答えを打つ');
    input.setAttribute('aria-label', '答えを打つ');
    input.addEventListener('input', () => (s.draft = input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') input.blur(); // もう一度 Esc で、復習をやめる
    });
    const check = el('button', 'ai-small vocab-show', t('答え合わせ（Enter）'));
    check.type = 'submit';
    const skip = el('button', 'ai-small', t('分からない'));
    skip.type = 'button';
    skip.addEventListener('click', () => this.revealAnswer());
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      s.typed = input.value;
      this.revealAnswer();
    });
    form.append(input, check, skip);
    // 新しいカードでは欄に入る（ほかの所で書いている途中なら奪わない）
    const active = document.activeElement;
    if (!active || active === document.body || this.element.contains(active)) {
      window.requestAnimationFrame(() => input.focus({ preventScroll: true }));
    }
    return form;
  }

  private revealAnswer() {
    if (!this.session) return;
    this.session.revealed = true;
    this.render();
  }

  private grade(grade: Grade) {
    const s = this.session;
    const card = s && this.card(s.queue[s.index]);
    if (!s || !card || !s.revealed || s.picked !== null) return;
    this.rememberGrade(s, card, grade);
    this.applyGrade(s, card, grade);
    this.advance(s);
  }

  // 評価の元に戻す（K5b）：評価の前の時期・度合い・回数を 5 秒だけ覚える（選ぶの練習の「もう一度」は覚えない。そのカードにいるので）
  private rememberGrade(s: Session, card: VocabCard, grade: Grade) {
    window.clearTimeout(this.gradeUndoTimer);
    this.gradeUndo = {
      id: card.id,
      front: card.front,
      grade,
      before: { due: card.due, level: card.level, reviews: card.reviews, lapses: card.lapses },
      index: s.index,
      requeued: grade === 'again' && !s.requeued.has(card.id),
    };
    this.gradeUndoTimer = window.setTimeout(() => {
      this.gradeUndo = null;
      if (!this.isTyping()) this.render();
    }, UNDO_MS);
  }

  // 元に戻す：左に前の値を頼み（updateCard）、見た目もすぐ戻す。復習の途中なら、そのカードの答えを見た所へ戻る
  private undoGrade() {
    const u = this.gradeUndo;
    if (!u) return;
    window.clearTimeout(this.gradeUndoTimer);
    this.gradeUndo = null;
    this.host.askLeft({ command: 'updateCard', id: u.id, ...u.before });
    const card = this.card(u.id);
    if (card) Object.assign(card, u.before);
    const s = this.session;
    if (s && s.queue[u.index] === u.id) {
      s.counts[u.grade] = Math.max(0, s.counts[u.grade] - 1);
      if (u.requeued) {
        const at = s.queue.lastIndexOf(u.id);
        if (at > u.index) s.queue.splice(at, 1);
        s.requeued.delete(u.id);
      }
      s.index = u.index;
      s.revealed = true;
      s.draft = '';
      s.typed = null;
      s.picked = null;
      s.choiceFor = null;
    } else if (!s) {
      this.finished = null; // 終えたあとに戻した：まとめの数が合わなくなるので消す
    }
    this.setStatus(t('「{0}」の評価を元に戻しました', { 0: clipText(u.front, 24) }));
    this.render();
  }

  private gradeUndoRow(): HTMLElement | null {
    const u = this.gradeUndo;
    if (!u) return null;
    const row = el('div', 'vocab-undo');
    const label = GRADES.find(([g]) => g === u.grade)?.[1] ?? '';
    const button = el('button', 'ai-small', this.session ? t('元に戻す（Z）') : t('元に戻す')); // Z は復習の途中だけ効く
    button.type = 'button';
    button.title = t('この評価を取り消して、前の時期と度合いに戻します');
    button.addEventListener('click', () => this.undoGrade());
    row.append(el('span', 'vocab-undo-text', t('「{0}」を「{1}」にしました', { 0: clipText(u.front, 20), 1: label })), button);
    return row;
  }

  // 選ぶ（K5a。計画書 §5 の 20）：正しければ評価は付けない（練習）。違えば「もう一度」を付ける
  private pick(i: number) {
    const s = this.session;
    const card = s && this.card(s.queue[s.index]);
    const choices = s?.choices;
    if (!s || !card || !choices || s.revealed || s.choiceFor !== card.id || i < 0 || i >= choices.options.length) return;
    s.picked = i;
    s.revealed = true;
    if (i === choices.answer) s.practiced += 1;
    else this.applyGrade(s, card, 'again');
    this.render();
  }

  // 選んだあとの「次へ」
  private next() {
    const s = this.session;
    if (s?.revealed && s.picked !== null) this.advance(s);
  }

  private applyGrade(s: Session, card: VocabCard, grade: Grade) {
    this.host.askLeft({ command: 'gradeCard', id: card.id, grade });
    // 左から写しが届くまでの間も、すぐ見た目に出す
    Object.assign(card, schedule(card, grade), { reviews: card.reviews + 1, lapses: card.lapses + (grade === 'again' ? 1 : 0), lastReviewedAt: Date.now() });
    s.counts[grade] += 1;
    if (grade === 'again' && !s.requeued.has(card.id)) {
      s.requeued.add(card.id);
      s.queue.push(card.id); // この回の最後に、もう一度
    }
  }

  private advance(s: Session) {
    s.index += 1;
    s.revealed = false;
    s.draft = '';
    s.typed = null;
    s.picked = null;
    s.choiceFor = null; // 同じカードがもう一度来ても、並びを作り直す
    if (s.index >= s.queue.length) this.finish();
    else this.render();
  }

  private finish() {
    this.endSession();
    this.render();
  }

  private endSession() {
    const s = this.session;
    this.session = null;
    if (s && s.index > 0) {
      const ok = s.counts.good + s.counts.easy;
      const name = s.mode === 'quiz' ? t('クイズ') : t('単語帳の復習');
      const practice = s.practiced > 0 ? t('、選んで正しかった {0}', { 0: s.practiced }) : '';
      this.finished = t('{0}を {1} 回答えました（できた・かんたん {2}、難しい {3}、もう一度 {4}{5}）。おつかれさまでした', { 0: name, 1: s.index, 2: ok, 3: s.counts.hard, 4: s.counts.again, 5: practice });
      this.host.announce(t('📇 {0}：{1} 回答えました（できた {2}・もう一度 {3}）。おつかれさまでした', { 0: name, 1: s.index, 2: ok, 3: s.counts.again }));
    }
  }

  private onKey(e: KeyboardEvent) {
    const s = this.session;
    if (!s || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return; // 打って答える欄などにいる間は取らない
    const choosing = s.answerBy === 'choose' && s.choices !== null && s.choiceFor === s.queue[s.index];
    if (e.key === ' ' || e.key === 'Enter') {
      if (choosing) {
        if (!s.revealed) return;
        e.preventDefault();
        this.next();
        return;
      }
      if (s.revealed || s.answerBy === 'type') return;
      e.preventDefault();
      this.revealAnswer();
    } else if (/^[1-4]$/.test(e.key)) {
      if (choosing === s.revealed) return; // 選ぶは答えの前、評価は答えのあと
      e.preventDefault();
      if (choosing) this.pick(Number(e.key) - 1);
      else this.grade(GRADES[Number(e.key) - 1][0]);
    } else if ((e.key === 'z' || e.key === 'Z') && this.gradeUndo) {
      e.preventDefault();
      this.undoGrade();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.finish();
    }
  }

  // ---------- 入れる・作る・送る ----------

  private addCards(drafts: CardDraft[]) {
    const known = new Set(this.state.cards.map((c) => cardKey(c.kind, c.front)));
    const fresh = drafts.filter((d) => !known.has(cardKey(d.kind, d.front)));
    if (fresh.length > 0) this.host.askLeft({ command: 'addCards', cards: fresh });
    const skipped = drafts.length - fresh.length;
    this.setStatus(fresh.length > 0 ? t('単語帳に {0} 枚入れました{1}', { 0: fresh.length, 1: skipped > 0 ? `（同じものがある ${skipped} 枚は入れません）` : '' }) : t('同じカードがもうあります'));
  }

  private confirmView(pending: PendingLesson): HTMLElement {
    const box = el('div', 'vocab-lesson');
    const practice = this.host.settings().practice;
    box.append(el('div', 'route-list-label', t('記事を教材にする')));
    box.append(el('p', 'panel-note', pending.title || t('無題')));
    box.append(el('p', 'panel-note', hostLabel(pending.url)));
    box.append(
      el(
        'p',
        'panel-note',
        practice
          ? t('練習モードです。本文は Anthropic に送りません。決まった形の教材を、この画面に出します。')
          : t('作るを押すと、このページの本文を送って要点と問いを作ります。作るまで送りません。渡し止めのページは送りません。'),
      ),
    );
    const go = el('button', 'ai-small', this.lessonBusy ? t('作っています…') : t('作る'));
    go.type = 'button';
    go.disabled = this.lessonBusy;
    go.addEventListener('click', () => void this.runLesson());
    const cancel = el('button', 'ai-small', t('やめる'));
    cancel.type = 'button';
    cancel.disabled = this.lessonBusy;
    cancel.addEventListener('click', () => {
      this.pendingLesson = null;
      this.render();
    });
    const row = el('div', 'ai-row');
    row.append(go, cancel);
    box.append(row);
    return box;
  }

  private lessonView(lesson: LessonView): HTMLElement {
    const box = el('div', 'vocab-lesson');
    box.append(el('div', 'route-list-label', lesson.title || t('教材')));
    if (lesson.summary) box.append(el('p', 'panel-note', lesson.summary));
    if (lesson.points.length > 0) {
      const list = el('ul', 'vocab-points');
      for (const point of lesson.points) list.append(el('li', '', point));
      box.append(list);
    }
    for (const card of lesson.cards) {
      const row = el('label', 'vocab-proposal');
      const check = el('input');
      check.type = 'checkbox';
      check.checked = card.checked;
      check.addEventListener('change', () => (card.checked = check.checked));
      const text = el('span', 'vocab-proposal-text');
      text.append(el('strong', '', `Q. ${card.front}`), el('span', '', card.back));
      row.append(check, text);
      box.append(row);
    }
    box.append(el('p', 'panel-note', t('問いは今の単語帳に入ります。要点は、今見ているシートのメモに残ります。新しい入れ物は作りません。')));
    const save = el('button', 'ai-small', t('選んだ問いを単語帳へ'));
    save.type = 'button';
    save.disabled = lesson.cards.length === 0;
    save.addEventListener('click', () => {
      const picked = lesson.cards.filter((card) => card.checked).map(({ checked: _, ...card }) => card);
      if (picked.length === 0) {
        this.setStatus(t('入れる問いに印を付けてください'));
        return;
      }
      this.addCards(picked);
    });
    const keep = el('button', 'ai-small', t('盤面に残す'));
    keep.type = 'button';
    keep.disabled = !lesson.summary && lesson.points.length === 0 && lesson.cards.length === 0;
    keep.addEventListener('click', () => {
      const text = formatLesson({
        title: lesson.title,
        summary: lesson.summary,
        points: lesson.points,
        cards: lesson.cards.filter((card) => card.checked),
      });
      this.host.askLeft({ command: 'addMemoCell', text, label: t('教材') });
      this.setStatus(t('今見ているシートのメモに残すよう頼みました。盤面に「教材：…」のセルが出ます'), 8000);
    });
    const cancel = el('button', 'ai-small', t('閉じる'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      this.lesson = null;
      this.render();
    });
    const row = el('div', 'ai-row');
    row.append(save, keep, cancel);
    box.append(row);
    return box;
  }

  private async prepareLesson() {
    if (this.making || this.lessonBusy) return;
    if (this.pendingLesson) {
      this.pendingLesson = null;
      this.render();
      return;
    }
    this.lessonBusy = true;
    this.render();
    try {
      const page = await requestPageText(this.host.activeTabId() ?? undefined);
      if (await pageIsBlocked(page.url)) {
        this.setStatus(BLOCK_NOTE, 6000);
        return;
      }
      if (page.error || !page.text?.trim()) {
        this.setStatus(t('表示中のページの文章を取り出せませんでした'), 6000);
        return;
      }
      this.pendingLesson = { title: page.title ?? '', url: page.url ?? '', text: page.text };
      this.lesson = null;
    } catch (error) {
      this.setStatus(t('取り出せませんでした：{0}', { 0: lessonFailure(error) }), 8000);
    } finally {
      this.lessonBusy = false;
      this.render();
    }
  }

  private async runLesson() {
    const pending = this.pendingLesson;
    if (!pending || this.lessonBusy) return;
    this.lessonBusy = true;
    this.render();
    try {
      if (await pageIsBlocked(pending.url)) {
        this.pendingLesson = null;
        this.setStatus(BLOCK_NOTE, 6000);
        return;
      }
      const result = await makeLesson({ title: pending.title, url: pending.url, text: pending.text }, this.host.settings());
      const known = new Set(this.state.cards.map((c) => cardKey(c.kind, c.front)));
      const cards = result.cards.filter((card) => !known.has(cardKey(card.kind, card.front))).map((card) => ({ ...card, checked: true }));
      this.lesson = { title: result.title, summary: result.summary, points: result.points, cards };
      this.pendingLesson = null;
      const cost = result.cost > 0 ? t('（約 ${0}）', { 0: result.cost.toFixed(3) }) : '';
      const near = result.near ? ` ${BUDGET_NEAR_NOTE}` : '';
      this.setStatus(cards.length > 0 || result.summary ? t('教材ができました{0}{1}', { 0: cost, 1: near }) : t('教材は作れませんでした{0}', { 0: cost }), 8000);
    } catch (error) {
      this.pendingLesson = null;
      this.setStatus(t('作れませんでした：{0}', { 0: lessonFailure(error) }), 8000);
    } finally {
      this.lessonBusy = false;
      this.render();
    }
  }

  private async makeFromPage() {
    this.making = true;
    this.render();
    try {
      const page = await requestPageText(this.host.activeTabId() ?? undefined);
      if (await pageIsBlocked(page.url)) {
        this.setStatus(BLOCK_NOTE, 6000);
        return;
      }
      if (page.error || !page.text) {
        this.setStatus(t('表示中のページの文章を取り出せませんでした'), 6000);
        return;
      }
      const result = await makeCards(
        { title: page.title ?? '', url: page.url ?? '', text: page.text, selection: page.selection },
        this.state.cards.map((c) => c.front),
        this.host.settings(),
      );
      const known = new Set(this.state.cards.map((c) => cardKey(c.kind, c.front)));
      const fresh = result.cards.filter((c) => !known.has(cardKey(c.kind, c.front)));
      this.proposals = fresh.map((c) => ({ ...c, checked: true }));
      this.proposalPage = { title: page.title ?? '', url: page.url ?? '' };
      this.setStatus(
        fresh.length > 0 ? t('{0} 枚の案ができました{1}', { 0: fresh.length, 1: result.cost > 0 ? `（約 $${result.cost.toFixed(3)}）` : '' }) : t('このページから新しいカードは作れませんでした'),
        8000,
      );
    } catch (error) {
      this.setStatus(t('作れませんでした：{0}', { 0: error instanceof Error ? error.message : String(error) }), 8000);
    } finally {
      this.making = false;
      this.render();
    }
  }

  private async sendToHexMemo(cards: VocabCard[]) {
    const target = this.host.hexMemoTarget();
    if (!target) {
      this.setStatus(t('相棒の ⚙ で「六角メモの送り先」を選んでから、もう一度押してください'), 6000);
      return;
    }
    const withDue = loadFlag(DUE_KEY);
    const list = cards.slice(0, 200);
    this.sending = true;
    this.render();
    try {
      for (let i = 0; i < list.length; i += 50) {
        const part = list.slice(i, i + 50);
        const records: HexMemoRecord[] = part.map((c) => ({
          text: c.kind === 'quiz' ? `Q. ${c.front}\nA. ${c.back}` : `${c.front}\n${c.back}${c.example ? `\n\n「${c.example}」` : ''}`,
          createdAt: new Date(c.createdAt).toISOString(),
          tags: c.kind === 'quiz' ? [t('単語帳'), t('問い')] : [t('単語帳')],
          urls: c.source ? [{ url: c.source.url, title: c.source.title }] : undefined,
          progress: c.level > 0 ? c.level : undefined,
          due: withDue && c.level < 6 ? dayOf(new Date(c.due)) : undefined,
        }));
        const outcome = await sendToHexMemo(target, records);
        if (!outcome.ok) {
          this.setStatus(t('送れませんでした：{0}', { 0: outcome.error }), 8000);
          return;
        }
        this.host.askLeft({ command: 'markCardsSent', ids: part.map((c) => c.id) });
        for (const c of part) c.sent = true;
      }
      const more = cards.length > list.length ? t('（残り {0} 枚は、もう一度押すと送ります）', { 0: cards.length - list.length }) : '';
      this.setStatus(t('{0} 枚を、六角メモ「{1}」へ送りました{2}', { 0: list.length, 1: target.label, 2: more }), 8000);
    } finally {
      this.sending = false;
      this.render();
    }
  }

  private setStatus(text: string, ms = 5000) {
    this.status.textContent = text;
    window.clearTimeout(this.statusTimer);
    if (ms > 0) this.statusTimer = window.setTimeout(() => (this.status.textContent = ''), ms);
  }
}

// 覚えた度合いの六角形（上の頂点から時計回りに、度合いの数だけ辺が明るい）
function levelHex(level: number, size = 18): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', 'vocab-hex');
  const corners = hexCornerPoints(10, 10, 8);
  const pts = (list: { x: number; y: number }[]) => list.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const base = document.createElementNS(NS, 'polygon');
  base.setAttribute('points', pts(corners));
  base.setAttribute('class', 'vocab-hex-base');
  svg.append(base);
  if (level > 0) {
    const edges = document.createElementNS(NS, 'polyline');
    edges.setAttribute('points', pts([...corners, corners[0]].slice(0, level + 1)));
    edges.setAttribute('class', level >= 6 ? 'vocab-hex-edges done' : 'vocab-hex-edges');
    svg.append(edges);
  }
  const title = document.createElementNS(NS, 'title');
  title.textContent = level >= 6 ? t('覚えた') : t('覚えた度合い {0} / 6', { 0: level });
  svg.append(title);
  return svg;
}

// 暦の予報（K5a）：これから 14 日の復習の枚数を、日ごとの六角形で並べる（今日の分には、時期を過ぎたカードも入る）
function forecastRow(cards: readonly VocabCard[]): HTMLElement {
  const WEEK = [t('日'), t('月'), t('火'), t('水'), t('木'), t('金'), t('土')];
  const row = el('div', 'vocab-forecast');
  row.title = t('これから 14 日の復習の予報（今日の分には、時期を過ぎたカードも入ります）');
  row.setAttribute('role', 'img');
  const labels: string[] = [];
  forecastDays(cards).forEach((day, i) => {
    const date = new Date(day.start);
    const md = `${date.getMonth() + 1}/${date.getDate()}（${WEEK[date.getDay()]}）`;
    const short = i === 0 ? '今日' : i === 1 ? t('明日') : md;
    const lead = i === 0 ? t('今日 ') : i === 1 ? t('明日 ') : '';
    const n = day.count;
    const level = n === 0 ? 'n0' : n <= 4 ? 'n1' : n <= 14 ? 'n2' : 'n3';
    const cell = el('span', `vocab-forecast-day ${level}`, n > 0 ? String(n) : '');
    cell.title = t('{0}{1}{2} 枚', { 0: lead, 1: md, 2: n });
    row.append(cell);
    labels.push(t('{0} {1} 枚', { 0: short, 1: n }));
  });
  row.setAttribute('aria-label', labels.join('、'));
  return row;
}

// 読み上げのボタン（K5a）：この端末の中の声だけ使う。言語の合う声が無ければ null（ボタンを出さない）
function speakButton(text: string): HTMLButtonElement | null {
  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance !== 'function') return null;
  const voice = pickVoice(synth.getVoices(), speechLang(text));
  if (!voice) return null;
  const button = el('button', 'ai-small vocab-speak', '🔊');
  button.type = 'button';
  button.title = t('読み上げる（この端末の声：{0}）', { 0: voice.name });
  button.setAttribute('aria-label', '読み上げる');
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.voice = voice;
    utter.lang = voice.lang;
    synth.speak(utter);
  });
  return button;
}

// 伏せた例文（K5a）：伏せた言葉を押すと見える（もう一度押すと伏せる）。描き直すと伏せた形に戻る
function clozeExample(parts: readonly ClozePart[]): HTMLElement {
  const box = el('div', 'vocab-example');
  box.append('「');
  for (const part of parts) {
    if (!part.hidden) {
      box.append(part.text);
      continue;
    }
    const word = el('span', 'vocab-cloze', part.text);
    word.tabIndex = 0;
    word.setAttribute('role', 'button');
    word.setAttribute('aria-pressed', 'false');
    word.setAttribute('aria-label', '伏せた言葉（押すと見える）'); // 伏せている間は、読み上げソフトにも言葉を出さない
    word.title = t('伏せた言葉（押すと見える）');
    const toggle = (e: Event) => {
      e.stopPropagation(); // 復習の Space・Enter に渡さない
      const shown = word.classList.toggle('show');
      word.setAttribute('aria-pressed', String(shown));
      if (shown) word.removeAttribute('aria-label');
      else word.setAttribute('aria-label', '伏せた言葉（押すと見える）');
    };
    word.addEventListener('click', toggle);
    word.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      toggle(e);
    });
    box.append(word);
  }
  box.append('」');
  return box;
}

// 打った答えの見え方（K5a）：合った文字は金、違う文字は赤。ぴったりなら印（評価は人が付ける）
function typedView(typed: string, answer: string): HTMLElement {
  const { parts, exact } = compareTyped(typed, answer);
  const row = el('div', 'vocab-typed');
  row.append(el('span', 'organize-count', t('打った答え：')));
  if (parts.length === 0) row.append(el('span', 'organize-count', t('（空）')));
  for (const part of parts) row.append(el('span', part.ok ? 'vocab-typed-ok' : 'vocab-typed-ng', part.text));
  if (exact) row.append(el('span', 'vocab-typed-exact', t('✓ ぴったり')));
  return row;
}

// 枠の中に収める。長い名前は CSS で「…」にする。マウスを乗せると title の全文が出る
function linkButton(label: string, title: string, run: () => void): HTMLButtonElement {
  const button = el('button', 'ai-small');
  button.type = 'button';
  button.title = title;
  button.setAttribute('aria-label', title);
  button.append(el('span', 'vocab-link-label', label));
  button.addEventListener('click', run);
  return button;
}

// 役目の名前（K6b）
function roleLabel(role: LinkRole | undefined): string {
  return role === 'source' ? '出典' : role === 'related' ? t('関連') : t('役目なし');
}

// 役目を次へ回す（K6b）：役目なし → 出典 → 関連 → 役目なし
function nextRole(role: LinkRole | undefined): LinkRole | undefined {
  return role === undefined ? 'source' : role === 'source' ? 'related' : undefined;
}

// 役目を外したセル（K6b。古い版の link には役目を持たせない）
function plainLink(link: CardLink): VocabLink {
  const { role: _role, ...rest } = link;
  return rest as VocabLink;
}

// 役目を付けた写し（K6b）：役目が無いときは役目の印を付けない
function withRole(link: CardLink, role: LinkRole | undefined): CardLink {
  const plain = plainLink(link);
  return role ? { ...plain, role } : plain;
}

function clipText(text: string, max = 16) {
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : text;
}

function whenLabel(card: VocabCard): string {
  const now = Date.now();
  if (card.due <= now) return card.reviews === 0 ? t('新しい') : '今日';
  const ms = card.due - now;
  if (ms < 60 * 60_000) return t('{0}分後', { 0: Math.max(1, Math.round(ms / 60_000)) });
  if (dayOf(new Date(card.due)) === dayOf(new Date(now))) return '今日';
  const days = Math.round(ms / (24 * 60 * 60_000));
  if (days <= 1) return t('明日');
  if (days < 14) return t('{0}日後', { 0: days });
  return t('{0}週間後', { 0: Math.round(days / 7) });
}

// 撮影の時刻（K6c-1）：「M/D H:MM」。分だけ 0 埋めする
function captureStamp(at: number): string {
  const date = new Date(at);
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname || t('このページ');
  } catch {
    return t('このページ');
  }
}

function loadFlag(key: string) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function saveFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // 覚えられなくても動作は続ける
  }
}

// データ置き場に入れる形（AI が作った単語帳のカードの案）
function vocabDraft(cards: CardDraft[], page: { title: string; url: string } | null): VaultDraft {
  const lines = [t('単語帳のカードの案{0}', { 0: page?.title ? `：${page.title}` : '' }), ''];
  for (const c of cards) {
    lines.push(c.kind === 'quiz' ? `Q. ${c.front}` : c.front, c.kind === 'quiz' ? `A. ${c.back}` : c.back);
    if (c.example) lines.push(`「${c.example}」`);
    lines.push('');
  }
  return {
    kind: 'vocab',
    title: t('単語帳の案{0}（{1} 枚）', { 0: page?.title ? `：${page.title}` : '', 1: cards.length }),
    text: lines.join('\n').trim(),
    data: { version: 1, cards, page },
    source: page?.url ? { pageTitle: page.title, pageUrl: page.url } : {},
  };
}
