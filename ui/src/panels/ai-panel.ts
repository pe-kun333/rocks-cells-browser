// AI の相棒の画面：右サイドバーの下に常駐する六角形のセルと、その上に開く会話
import { t as tr } from '../i18n';
import { armConfirm } from '../confirm-arm';
import {
  blurbOf,
  type Cast,
  CHARACTER_IDS,
  type CharacterId,
  cleanName,
  cleanPersona,
  defaultCast,
  DEFAULT_FABLE,
  DEFAULT_SECOND,
  DEFAULT_TRIO,
  HAIKU_IDS,
  HAIKU_PERSONAS,
  HAIKU_MAX,
  HAIKU_MIN,
  HAIKU_UNIT_NAME,
  type HaikuSpeak,
  isCharacterId,
  isHaiku,
  isHaikuOnly,
  isTrioOnly,
  MAX_MEMBERS,
  modelOf,
  nameOf,
  normalizeMembers,
  parseCast,
  type Persona,
  type SecondConfig,
  slotsOf,
  teamOf,
  TRIO_IDS,
} from '../ai/characters';
import { makeCards } from '../ai/cards';
import { FABLE_MODEL, HAIKU_MODEL, type HaikuModelId, MODELS, type ModelId } from '../ai/client';
import { type ChatEntry, Companion, type CompanionState, type Target } from '../ai/companion';
import { canEvolve, DEFAULT_EVOLVE, EVOLVE_MODES, type EvolveMode, evolveRemaining, type EvolveSettings, EVOLVE_TIMEOUT_MS, parseEvolve } from '../ai/evolve';
import {
  ADVISOR_IDS,
  ADVISORS,
  answeredBy,
  type AdvisorId,
  canConsult,
  CONSULT_MODES,
  CONSULT_TIMEOUT_MS,
  type ConsultMode,
  consultRemaining,
  type ConsultSettings,
  DEFAULT_CONSULT,
  limitOf,
  loadConsultStats,
  modeOf,
  parseConsult,
} from '../ai/advisor';
import { type ConversationSummary, deleteConversation, loadConversation, loadIndex } from '../ai/history';
import { DEFAULT_ROUTE, type PathChoice, parseRoute, type RefusalMode, routeFoot, routeLabel, type RouteKind, type RouteMode, type StuckMode } from '../ai/route';
import { cleanChat, type Letter, LetterStore, letterText, MAX_LETTERS } from '../ai/letters';
import type { Phrase } from '../ai/phrases';
import { ACTION_LABELS, QUIZ_ANSWER_MARK, SECOND_ROLES, type SecondRole } from '../ai/prompts';
import type { OrganizeSettings } from '../ai/organize';
import { type BrowserTools, formatTime } from '../ai/tools';
import { BLOCK_NOTE, BLOCKLIST_MAX, ensureBlocklist, normalizeHost, pageIsBlocked, redactBlockedUrls, setBlocklist } from '../blocklist';
import { requestPageText } from '../ai/page';
import { companionCostNote, renderSendPreview } from '../send-preview';
import { assertBudget, type BudgetView, BudgetError, BUDGET_NEAR_NOTE, formatUsd, loadBudget, MAX_CAP, onBudget, setBudgetCap } from '../ai/budget';
import { onMessage, send } from '../bridge';
import { type HexMemoTarget, loadCatalog, sendToHexMemo, targetsOf } from '../integrations/hexmemo';
import type { CompanionEvent, HexMemoRecord, RelayCommand, Reminder, TabNote } from '../types';
import { newReplyId, type ReplyAuthor } from '../threads';
import { secLabel } from '../reader-ai-card';
import type { ReaderRefusal } from '../reader-links';
import { parseTalk, TALK_MODE_NAME, TALK_QUESTIONS, type TalkMaterial, talkCardText, talkPrompt } from '../reader-talk';
import { clamp, el } from '../util';
import type { CardDraft, CardKind } from '../vocab';
import type { VaultDraft } from '../vault';
import { FACES } from './ai-faces';
import { moonSvg } from './moon';
import { PhraseBar } from './phrase-bar';
import type { ConversationSnapshot } from './vault-panel';

// この画面の外に頼むこと（タブの台帳は左サイドバーが持っている）
export interface AiPanelHost {
  keepNote(tabId: number, note: TabNote): void;
  activeTabId(): number | null;
  tools: BrowserTools; // ブラウザを操作する道具
  memory(): Promise<string | null>; // 覚えていること（新しい会話の最初に添える）
  openUrl(url: string): void; // 引用元などを新しいタブで開く
  addCards(cards: CardDraft[]): void; // 単語帳に入れる
  placeMemoCell(text: string, by: ReplyAuthor, label: string): void; // 盤面にメモのセルとして置く（フェイブルレター）
  copyMemoCell(text: string, by: ReplyAuthor, label: string): void; // メモのセル1つとしてコピーする（盤面に貼れる）
  toVault(draft: VaultDraft): Promise<boolean>; // データ置き場（右サイドバーの上の区画）に入れる
  conversationToVault(): void; // 今の会話を、見たままの画像と文字のデータでデータ置き場に残す
  askBot?(text: string): boolean; // 相棒の返事を、ボットの下書きの小窓に入れる（段階7。コピーもアプリも開かない）
  reminderActions?(reminder: Reminder): ReminderAction[]; // リマインダーの吹き出しのボタン（延ばす・そのセルへ。K2。AI は呼ばない）
  askLeft(action: RelayCommand): void; // 左へ頼む（六角で見るのやり取りの「▶ 時刻」「📌 カードへ」。plan-reader-video の V5）
}

// リマインダーの吹き出しのボタン 1 つ（K2）
export interface ReminderAction {
  label: string;
  title: string;
  run(): void;
}

// 相棒から話しかける頻度
//   off    : 話しかけない（頼まれたときだけ話す）
//   quiet  : ページを最後まで読んだときだけ
//   normal : ♥×3 を付けたとき・メモを書いたときにも
type TalkLevel = 'off' | 'quiet' | 'normal';

const TALK_LEVELS: [TalkLevel, string][] = [
  ['off', tr('話しかけない')],
  ['quiet', tr('控えめ（ページを読み終えたときだけ）')],
  ['normal', tr('ふつう（♥×3・メモを書いたときにも）')],
];

// キャラたちの設定（Cast）も、同じ所に並べて保存する
interface AiPrefs extends Cast {
  model: ModelId;
  practice: boolean; // 練習モード（API を使わない）
  open: boolean; // 会話を開いているか
  attachPage: boolean; // 「このページについて」
  lastConversation: string | null; // 次に起動したときに開く会話
  hexMemoTarget: HexMemoTarget | null; // 六角メモの送り先
  talk: TalkLevel;
  dailyLimit: number; // 1日に自分から話す回数の上限
  useTools: boolean; // ブラウザの操作（道具）を任せる
  webSearch: boolean; // Web 検索を使わせる
  skipSendPreview: boolean; // 短いボタン（要約・解説・クイズなど）の送る前の確認を省略。渡し止めのページでは省略できない
  target: Target; // 話しかける相手（メンバーのだれか・みんな）
  evolveMode: EvolveMode; // フェイブルの進化の許可：毎回聞く／この会話ではいつも許可／進化しない
  evolveLimit: number; // 1日に進化できる回数（フェイブルの合図と、さらに考えるボタンで分け合う）
  evolveReserve: boolean; // フェイブルの合図用に1回残す
  consultOpus: ConsultMode; // ハイク組から Claude 先生への相談の許可
  consultFable: ConsultMode; // ハイク組からフェイブル先生への相談の許可
  consultOpusLimit: number; // Claude 先生への相談の1日の回数（きらり）
  consultFableLimit: number; // フェイブル先生への相談の1日の回数（月。フェイブルの進化とは別）
  routeMode: RouteMode; // 道すじ（段階8）
  routeStuck: StuckMode;
  routeRefusal: RefusalMode;
}

const PREFS_KEY = 'honeycomb.ai';
const DAILY_KEY = 'honeycomb.ai.daily'; // 今日、自分から話した回数
const BUBBLE_MS = 15_000; // 吹き出しを出しておく時間
const PENDING_MS = 120_000; // 話している最中に起きた出来事を、あとで話す期限

const STATUS: Record<CompanionState, string> = {
  noKey: tr('API キーを入れると話せます'),
  idle: tr('待機中 — ページの要約や質問ができます'),
  thinking: tr('考えています…'),
  speaking: tr('話しています…'),
  working: tr('ブラウザを操作しています…'),
  confirm: tr('あなたの確認を待っています'),
  error: 'うまくいきませんでした',
};

export class AiPanel {
  readonly element = el('section', 'ai-dock');
  private readonly prefs = loadAiPrefs();
  private readonly companion = new Companion(this.prefs.model, this.prefs.practice);
  private readonly chat = el('div', 'ai-chat');
  private readonly settings = el('div', 'ai-settings');
  private readonly log = el('div', 'ai-log');
  private readonly input = el('textarea', 'ai-text');
  private readonly attach = el('input');
  private readonly sendButton = el('button', 'ai-send', tr('送る'));
  // 六角で見るのやり取りの型（plan-reader-video の V5）：始めた材料と、何問目まで出したか（ふりかえる）。答えを待つ間は、送る文を材料と基準で包む
  private talk: { m: TalkMaterial; round: number } | null = null;
  private readonly talkBar = el('div', 'ai-talk-bar');
  private talkSeq = 0;
  private readonly talkWaiting = new Map<number, number>(); // 「📌 カードへ」の頼みの番号 → 返事の id
  private readonly deepButton = el('button', 'ai-deep'); // さらに考える（フェイブルが確認なしで進化する）
  private readonly historyButton = el('button', 'ai-small', tr('履歴'));
  readonly letters = new LetterStore(); // 月の窓（右サイドバーの上）も、同じ一覧を映す
  private readonly openLetters = new Set<string>(); // 全文を開いているレター
  private readonly openChats = new Set<string>(); // 元の会話を開いているレター
  private armedLetter: string | null = null; // 「消す」を一度押したレター（もう一度押すと消える）
  private armTimer = 0;
  // レターから単語帳のカードの案を作っている途中・選んでいる途中
  private study: { letterId: string; making: boolean; cards: (CardDraft & { checked: boolean })[] } | null = null;
  private letterNote: { id: string; text: string } | null = null; // レターの下に出す、ひとこと（カードを入れました、など）
  private logKey = ''; // 履歴・レターの一覧を最後に描いたときの中身（変わっていなければ描き直さない。返事が流れている間も押せるように）
  // 相棒たちの顔（会話のメンバーだけを出す）
  private readonly cells = Object.fromEntries(CHARACTER_IDS.map((id) => [id, el('button', `ai-cell ${id}`)])) as Record<CharacterId, HTMLButtonElement>;
  private readonly faces = el('div', 'ai-companion');
  private readonly teamBox = el('div', 'ai-team'); // ハイク組の顔（小さな蜂の巣に並べる）
  private readonly nameLine = el('div', 'ai-name', 'Claude');
  private readonly title = el('button', 'ai-chat-title'); // メンバーの名前。押すとメンバーを選ぶ欄が開く
  private readonly titleNames = el('span', 'ai-chat-names', 'Claude');
  private readonly membersPanel = el('div', 'ai-members');
  private readonly membersNote = el('div', 'ai-members-note');
  private readonly targets = el('div', 'ai-targets');
  private targetsKey = ''; // 宛先のボタンの中身（同じなら作り直さない）
  private readonly status = el('div', 'ai-status');
  private readonly cost = el('span', 'ai-cost');
  // 入力欄の上の、頼みごとのボタン（6つ・セット・その他の文言）
  private readonly phraseBar = new PhraseBar({ run: (p) => this.runPhrase(p), inputText: () => this.input.value });
  private readonly previewHost = el('section', 'send-sheet');
  private readonly previewBody = el('div', 'send-sheet-body');
  private readonly previewGo = el('button', 'ai-small primary', tr('送る'));
  private readonly previewStop = el('button', 'ai-small', tr('やめる'));
  private previewPhrase: Phrase | null = null;
  private readonly keyInput = el('input');
  private readonly keyState = el('div', 'ai-key-state');
  private readonly hexSelect = el('select');
  private readonly hexState = el('div', 'ai-key-state');
  private blockHosts: string[] = []; // 渡し止め（ui-data/blocklist.json）。開くたびに読み直す
  private readonly blockList = el('div', 'ai-block-list');
  private readonly blockInput = el('input', 'memory-input');
  private readonly blockState = el('div', 'ai-key-state');
  private budgetMonth = '';
  private toldNear = false; // 「近づいています」は、この画面を開いているあいだに1回
  private readonly budgetInput = el('input', 'memory-input');
  private readonly budgetState = el('div', 'ai-key-state');
  private readonly dailyState = el('div', 'ai-key-state');
  private readonly evolveState = el('div', 'ai-key-state'); // 今日、進化した回数
  private readonly consultState = el('div', 'ai-key-state'); // ハイク組の相談の、今日の残りと記録
  // 「先生に聞く」（ハイク組が答える前に、アプリが先生に相談する。押す＝許可）
  private readonly adviceRow = el('div', 'ai-advice-row');
  private readonly askButtons = Object.fromEntries(ADVISOR_IDS.map((id) => [id, el('button', `ai-advice-ask ${id}`)])) as Record<AdvisorId, HTMLButtonElement>;
  private readonly openAdviceLetters = new Set<number>(); // 相談の手紙を開いている返事
  private readonly bubble = el('div', 'ai-bubble');
  private readonly bubbleText = el('div', 'ai-bubble-text');
  private bubbleId: number | null = null; // 吹き出しに出している返事
  private bubbleReminder: { entryId: number; reminder: Reminder } | null = null; // 吹き出しに出しているリマインダー（そのボタンを出すため）
  private readonly bubbleActions = el('div', 'ai-row ai-bubble-actions'); // リマインダーの吹き出しのボタン（延ばす・そのセルへ。K2）
  private bubbleAfter: number | null = null; // この番号より後に始まる自分からの返事を、吹き出しに出す
  private bubbleTimer = 0;
  private pending: { event: CompanionEvent; at: number } | null = null;
  private restored: Promise<void> = Promise.resolve(); // 前回の会話を開き終えたら
  private readonly revealed = new Set<number>(); // 答えを見たクイズ
  private readonly sending = new Set<number>(); // 六角メモへ送っている途中の返事
  private cardDraft: CardFormDraft | null = null; // 返事から単語帳のカードを作っている途中
  private readonly openRoutes = new Set<number>(); // 開いたままの道すじ（描き直しても閉じない）
  private view: 'chat' | 'history' | 'letters' = 'chat';
  private historyItems: ConversationSummary[] = [];
  private hexTargets: HexMemoTarget[] | null = null; // まだ読んでいなければ null
  private frame = 0;

  constructor(private readonly host: AiPanelHost) {
    this.buildChat();
    this.buildCompanion();
    this.companion.onChange(() => {
      // 話した会話だけを「次に開く会話」にする（何も話していない新しい会話では、前の会話を残す）
      if (this.companion.entries.some((e) => e.role === 'user') && this.prefs.lastConversation !== this.companion.id) {
        this.prefs.lastConversation = this.companion.id;
        saveAiPrefs(this.prefs);
      }
      // 自分から話し始めた返事を、吹き出しに出す
      const last = this.companion.entries.at(-1);
      if (this.bubbleAfter !== null && last?.role === 'assistant' && last.auto && last.id > this.bubbleAfter) {
        this.bubbleAfter = null;
        this.bubbleId = last.id;
      }
      // 話している最中に起きた出来事を、話し終わってから話す
      if (this.pending && !this.companion.busy) {
        const { event, at } = this.pending;
        this.pending = null;
        if (Date.now() - at < PENDING_MS) window.setTimeout(() => this.onEvent(event), 0);
      }
      this.requestRender();
    });
    onMessage((msg) => {
      if (msg.type === 'apiKey') this.onApiKey(msg.key, msg.error);
    });
    this.companion.setTools(this.prefs.useTools ? host.tools : null);
    this.companion.setMemory(() => host.memory());
    this.companion.setWebSearch(this.prefs.webSearch);
    this.companion.setCast(castOf(this.prefs));
    this.companion.setEvolve(this.evolveSettings());
    this.companion.setConsult(this.consultSettings());
    this.companion.setRoute(this.routeSettings());
    send({ type: 'getApiKey' });
    this.redrawAtMidnight();
    window.addEventListener('focus', () => {
      this.render();
      void this.loadBudget();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.render();
    });
    onBudget((view) => {
      this.showBudget(view);
      if (view.near && !this.toldNear) {
        this.toldNear = true;
        this.companion.notice(BUDGET_NEAR_NOTE);
      }
    });
    void this.loadBudget();
    this.restored = this.restoreLastConversation();
    this.letters.onChange(() => this.requestRender());
    void this.letters.load();
    this.render();
  }

  // 今の会話（記憶のパネルが「覚えることの案」を作るのに使う）
  conversationEntries(): ChatEntry[] {
    return [...this.companion.entries];
  }

  // データ置き場：今の会話（見たままに描いたもの・文字のデータ）。まだ何も話していなければ null
  conversationSnapshot(): ConversationSnapshot | null {
    const c = this.companion;
    const entries = c.entries.filter((e) => e.role !== 'notice' || e.text);
    const first = entries.find((e) => e.role === 'user' && !e.auto) ?? entries.find((e) => e.role === 'user' || e.role === 'assistant');
    if (!first) return null;
    const head = first.text.length > 40 ? `${first.text.slice(0, 40)}…` : first.text;
    const title = first.pageTitle ? `${head} — ${first.pageTitle}` : head || tr('相棒との会話');
    const members = c.members.map((id) => c.nameOf(id));
    const showing = this.prefs.open && this.view === 'chat' && this.log.clientWidth > 0;
    const width = Math.round(this.log.clientWidth || this.element.clientWidth || 300);
    return {
      id: c.id,
      title,
      busy: c.busy,
      members,
      startedAt: c.entries[0]?.time ?? Date.now(),
      width: clamp(width, 240, 1200),
      text: transcriptOf(title, members, c.entries),
      data: { version: 1, conversationId: c.id, title, members, totalCost: c.totalCost, entries: c.entries.map(entryData) },
      render: () => c.entries.map((entry) => this.renderEntry(entry, { export: true })), // 書き出しでは、会話記録に残さない画像は描かない
      // 予備の経路（画面の会話欄をそのまま撮る）では、撮影から送った画像が写り込むので、その画像が欄にある間は使わない
      log: showing && !c.entries.some((entry) => entry.imageTransient && entry.image) ? this.log : null,
    };
  }

  // ほかのパネル（整理など）が AI を使うときの設定
  // 六角メモの送り先（⚙ で選んだノート）
  hexMemoTarget(): HexMemoTarget | null {
    return this.prefs.hexMemoTarget;
  }

  organizeSettings(): OrganizeSettings {
    return { apiKey: this.companion.key, practice: this.prefs.practice, model: this.prefs.model };
  }

  companionBusy() {
    return this.companion.busy;
  }

  // 撮影の送り先。ハイク組でないキャラは一人ずつ。三人組だけのときは組の名前でみんなへ。ハイク組がいるときは組へ
  captureCompanions(): { target: string; label: string }[] {
    const members = [...this.companion.members];
    const out: { target: string; label: string }[] = [];
    if (isTrioOnly(members)) out.push({ target: 'all', label: tr('相棒：{0}', { 0: this.companion.trioUnitName() }) });
    else {
      for (const id of members) {
        if (isHaiku(id)) continue;
        out.push({ target: id, label: tr('相棒：{0}', { 0: this.companion.nameOf(id) }) });
      }
    }
    if (teamOf(members).length > 0) out.push({ target: 'team', label: tr('相棒：{0}', { 0: HAIKU_UNIT_NAME }) });
    return out;
  }

  // 目安に使う、その送り先の1人分の料金（100万トークンあたりのドル）
  capturePrice(target: string): { input: number; output: number } {
    const members = [...this.companion.members];
    const speaker: CharacterId =
      target === 'team' ? (teamOf(members)[0] ?? this.companion.lead) : target === 'all' ? this.companion.lead : isCharacterId(target) && members.includes(target) ? target : this.companion.lead;
    return modelPrice(this.companion.modelFor(speaker));
  }

  // 撮影の確認で「送る」を押したときだけ。ページの本文は取りにいかない。練習モードは API も料金も使わない
  async sendCapture(text: string, images: string[] | undefined, target: string, display: string): Promise<{ ok: true } | { ok: false; message: string }> {
    await this.restored;
    if (this.companion.busy) return { ok: false, message: tr('相棒が話し終わってから押してください') };
    const resolved = this.captureTarget(target);
    if (!resolved) return { ok: false, message: tr('送り先が見つかりません') };
    if (!this.prefs.practice) {
      try {
        await assertBudget();
      } catch (error) {
        if (error instanceof BudgetError) return { ok: false, message: error.message };
        return { ok: false, message: tr('料金の上限を確認できませんでした') };
      }
    }
    if (!this.companion.canTalk) return { ok: false, message: tr('API キーを設定するか、練習モードにしてください（相棒の ⚙）') };
    this.view = 'chat';
    const shots = images?.filter((src) => src.startsWith('data:image/')).slice(0, 4);
    if (!this.prefs.open) this.setOpen(true);
    else this.render();
    void this.companion.ask('chat', text, false, resolved, { ...(shots && shots.length > 0 ? { images: shots } : {}), display, bare: true, imagesTransient: true }); // 撮影の画像は会話記録に残さない（R3 D1）
    return { ok: true };
  }

  private captureTarget(target: string): Target | null {
    const members = this.companion.members;
    if (target === 'all') return members.length > 0 ? 'all' : null;
    if (target === 'team') return teamOf(members).length > 0 ? 'team' : null;
    if (isCharacterId(target) && members.includes(target) && !isHaiku(target)) return target;
    return null;
  }

  // めぐる表示のひとこと（R3）。組の3体までの名前。ハイク組の名前は決まっている。三人組は ⚙ の名前
  commentVoices(team: 'haiku' | 'sonnet'): string[] {
    const cast = castOf(this.prefs);
    if (team === 'sonnet') return cast.trio.members.map((member) => member.name).slice(0, 3);
    return HAIKU_IDS.slice(0, 3).map((id) => HAIKU_PERSONAS[id].name);
  }

  // 回答カードの Deeper Dive（段階6）。目安を出してから、道具なしで1回
  diveEstimate(chars: number) {
    return this.companion.diveEstimate(chars);
  }

  diveReply(text: string) {
    return this.companion.dive(text);
  }

  // ボットの返事を相棒に見せる（段階7）。目安を出してから、道具なしで1回。全文は会話に残さない
  showEstimate(chars: number) {
    return this.companion.showEstimate(chars);
  }

  showReply(text: string) {
    return this.companion.show(text);
  }

  // 相棒の返事を、ボットの下書きにする（段階7）。小窓を開くだけ。渡し止めのアドレスは文から外す
  private async askBotFrom(entry: ChatEntry) {
    const raw = (await redactBlockedUrls(entry.text)).trim();
    const chars = [...raw];
    const text = chars.length > 12_000 ? tr('{0}\n…（長すぎるので、ここまで）', { 0: chars.slice(0, 12_000).join('') }) : raw;
    if (!text) return;
    this.host.askBot?.(text);
  }

  // 左サイドバーから届いた出来事（読み終えた・♥×3・メモ）。設定に合わせて、相棒が自分からひとこと話す
  onEvent(event: CompanionEvent) {
    const talk = this.prefs.talk;
    if (talk === 'off' || (talk === 'quiet' && event.type !== 'read')) return;
    if (!this.companion.canTalk) return;
    if (this.companion.busy) {
      this.pending = { event, at: Date.now() }; // いちばん新しい出来事だけ覚えておく
      return;
    }
    void this.talkAbout(event);
  }

  // 六角で読む画面から「このマスについて相棒に聞く」：会話を開いて、Claude（いなければメンバーの先頭）に聞く
  //   from：reader（六角で読む画面）・memo（盤面のメモのセル）・shot（六角形スクショ）。image があれば見せる
  async askAbout(text: string, pageTitle: string, from: 'reader' | 'memo' | 'shot' = 'reader', image?: string) {
    await this.restored;
    if (!this.prefs.open) this.setOpen(true);
    this.view = 'chat';
    const quoted = text.length > 400 ? `${text.slice(0, 400)}…` : text;
    if (from === 'reader') {
      void this.companion.ask('chat', `「${pageTitle}」を六角で読んでいて、次の部分が気になりました。わかりやすく説明してください。\n「${quoted}」`, true);
      return;
    }
    const images = image ? [image] : undefined;
    if (from === 'shot') {
      const where = pageTitle ? `「${pageTitle}」のページの一部を` : '画面の一部を';
      const input = `${where}六角形に切り取ったスクリーンショットです。何が写っているかを短く説明して、気づいたことや大事そうな点を教えてください。${text ? `\n私のコメント：「${quoted}」` : ''}`;
      void this.companion.ask('chat', input, false, undefined, { images, display: text ? tr('📷 スクショ：{0}', { 0: quoted }) : tr('📷 スクショを見せる') });
      return;
    }
    const input = `盤面に置いたメモのセルです。内容について、気づいたことや次にできることをコメントしてください。\n「${quoted}」`;
    void this.companion.ask('chat', input, false, undefined, { images, display: tr('✎ メモ：{0}', { 0: quoted.length > 60 ? `${quoted.slice(0, 60)}…` : quoted }) });
  }

  // ---------- 六角で見るのやり取りの型（plan-reader-video の V5。D10・D11） ----------
  //   読む画面が組んだ材料（左が渡し止めを見てから届く）で始める。ツッコむ・当てるは、使う人が送った文を本物の字幕と基準で包んで送る
  //   （答えるまで本物は見せない）。ふりかえるは 3 問のあとにまとめ、掛け合いは 1 回。道具は渡さない（bare）。返事には「▶ 時刻」と「📌 カードへ」
  async startTalk(raw: unknown) {
    const m = parseTalk(raw);
    if (!m) return;
    await this.restored;
    if (!this.prefs.open) this.setOpen(true);
    this.view = 'chat';
    const t = { m, round: 0 };
    this.talk = t;
    const name = TALK_MODE_NAME[m.mode];
    if (m.mode === 'tsukkomi' || m.mode === 'guess') {
      const last = m.context[m.context.length - 1];
      this.companion.announce(
        m.mode === 'tsukkomi'
          ? tr('🎬 {0}：{1} の「{2}」にツッコんでみてください（本物の返しは隠しています。点は付けず、短さ・型・間で返します）', { 0: name, 1: last.t, 2: last.text })
          : tr('🎬 {0}：{1} の「{2}」で止めました。このあと何と続くでしょう。予想を書いて送ってください', { 0: name, 1: last.t, 2: last.text }),
      );
      this.render();
      this.input.focus();
      return;
    }
    this.render();
    const reply = await this.talkAsk(talkPrompt(m), `🎬 ${name}（${m.label}）`);
    if (this.talk !== t) return; // 途中でやめた・ほかの型を始めた
    if (!reply) return this.endTalk();
    if (m.mode === 'duo') {
      this.tagTalk(reply, m);
      return this.endTalk();
    }
    t.round = 1;
    this.render();
  }

  // 使う人の答えを待っているか（ツッコむ・当てるはまだ答えていない、ふりかえるは問いを出したあと）
  private talkTakesAnswer(): boolean {
    const t = this.talk;
    if (!t || this.companion.busy) return false;
    return t.m.mode === 'socratic' ? t.round >= 1 : (t.m.mode === 'tsukkomi' || t.m.mode === 'guess') && t.round === 0;
  }

  // 使う人の答えを、材料と基準で包んで送る。ふりかえるは 3 問目の答えのあとのまとめを、ツッコむ・当てるは返事を、カードに残せるようにする
  private async answerTalk(text: string) {
    const t = this.talk;
    if (!t) return;
    const m = t.m;
    if (m.mode === 'socratic') {
      const round = t.round;
      t.round = 0; // 返事が来るまでは答えを包まない
      this.render();
      const reply = await this.talkAsk(talkPrompt(m, text, round), text);
      if (this.talk !== t) return;
      if (!reply) return this.endTalk();
      if (round >= TALK_QUESTIONS) {
        this.tagTalk(reply, m);
        return this.endTalk();
      }
      t.round = round + 1;
      this.render();
      return;
    }
    t.round = 1; // 答えた（もう包まない）
    this.render();
    const reply = await this.talkAsk(talkPrompt(m, text), text);
    if (reply) this.tagTalk(reply, m, text);
    if (this.talk === t) this.endTalk();
  }

  // 包んだ文を相棒に送り、その返事（失敗・付け足しなしは null）を返す。画面には display だけを出す
  private async talkAsk(prompt: string, display: string): Promise<ChatEntry | null> {
    if (!prompt) return null;
    const before = this.companion.entries.at(-1)?.id ?? -1;
    await this.companion.ask('chat', prompt, false, undefined, { display, bare: true });
    return [...this.companion.entries].reverse().find((e) => e.id > before && e.role === 'assistant' && !e.error && !e.passed && !!e.text) ?? null;
  }

  // 返事にカードへ残す材料を付ける（字幕は止めたマスだけにして残す。会話記録を重くしない）
  private tagTalk(reply: ChatEntry, m: TalkMaterial, answer?: string) {
    this.companion.markTalk(reply.id, { m: { ...m, context: m.context.slice(-1) }, ...(answer ? { answer } : {}) });
  }

  private endTalk() {
    this.talk = null;
    this.render();
  }

  // やり取りの型の帯（型の名前・今すること・やめる）と、欄の案内。型の外では帯を隠す（案内は render が付ける）
  private renderTalkBar() {
    const t = this.talk;
    this.talkBar.hidden = !t;
    if (!t) {
      this.talkBar.replaceChildren();
      return;
    }
    const m = t.m;
    const waiting = tr('返事を待っています');
    const hint =
      m.mode === 'tsukkomi'
        ? t.round === 0
          ? tr('ツッコミを書いて送る（本物の返しは、送ったあとに出ます）')
          : waiting
        : m.mode === 'guess'
          ? t.round === 0
            ? tr('予想を書いて送る（本物の続きは、送ったあとに出ます）')
            : waiting
          : m.mode === 'socratic'
            ? t.round === 0
              ? waiting
              : tr('{0} 問目の答えを書いて送る（全部で {1} 問）', { 0: t.round, 1: TALK_QUESTIONS })
            : waiting;
    this.input.placeholder = hint;
    const stop = el('button', 'ai-small', tr('やめる'));
    stop.type = 'button';
    stop.title = tr('やり取りの型をやめて、ふつうの会話に戻る');
    stop.addEventListener('click', () => {
      this.endTalk();
      this.input.focus();
    });
    this.talkBar.replaceChildren(el('span', 'ai-talk-name', `🎬 ${TALK_MODE_NAME[m.mode]}（${m.label}）`), el('span', 'ai-talk-hint', hint), stop);
  }

  // やり取りの返事の「▶ 時刻」（読む画面のその時刻へ）と「📌 カードへ」（区間と結んだカードを下の区画へ）
  private talkButtons(entry: ChatEntry, talk: NonNullable<ChatEntry['talk']>): HTMLElement[] {
    const play = el('button', 'ai-small', `▶ ${secLabel(talk.m.sec)}`);
    play.title = tr('読む画面でこの時刻へ（開いていなければ、その動画を開きます）');
    play.addEventListener('click', () => this.host.askLeft({ command: 'openReaderAt', video: talk.m.video, start: talk.m.sec }));
    const card = el('button', 'ai-small', talk.card ? tr('カードにしました ✓') : tr('📌 カードへ'));
    card.title = tr('このやり取りを、区間と結んだカードにして下の区画へ（読む画面でその動画を開いているときだけ）');
    if (!talk.card) card.addEventListener('click', () => this.sendTalkCard(entry, talk));
    return [play, card];
  }

  // 「📌 カードへ」：左に結んだカードを頼む（返事は右へ。結ぶ先は今の下の区画のメモ、無ければ左が動画のメモを作る）
  private sendTalkCard(entry: ChatEntry, talk: NonNullable<ChatEntry['talk']>) {
    const m = talk.m;
    const seq = ++this.talkSeq;
    this.talkWaiting.set(seq, entry.id);
    this.host.askLeft({
      command: 'readerCard',
      seq,
      replyId: newReplyId(),
      text: talkCardText(m, entry.text, talk.answer),
      by: { who: entry.speaker ?? 'main', name: entry.speakerName ?? 'Claude' },
      at: { video: m.video, ...(m.title ? { title: m.title } : {}), spans: m.spans, kind: 'talk' },
      replyTo: 'right',
    });
  }

  // 「📌 カードへ」の返事（左の readerCardDone）：足せたら印、断られたら理由を会話の下に 1 行
  onTalkCardDone(done: { seq: number; ok: boolean; reason?: ReaderRefusal }) {
    const entryId = this.talkWaiting.get(done.seq);
    if (entryId === undefined) return;
    this.talkWaiting.delete(done.seq);
    if (done.ok) {
      this.companion.markTalk(entryId, { card: true });
      return;
    }
    const why =
      done.reason === 'video'
        ? tr('読む画面でその動画を開いているときに押してください')
        : done.reason === 'full'
          ? tr('メモのコメントがいっぱい（300）です')
          : done.reason === 'ledger'
            ? tr('メモの台帳を読めていません')
            : done.reason === 'special'
              ? tr('下の区画で開いているのが入口やボットのセルです')
              : tr('形が合いませんでした');
    this.companion.announce(tr('📌 カードにできませんでした：{0}', { 0: why }));
  }

  // 月の窓の「会話に残す」。呼び出しはしない。Claude に送らないお知らせとして、いまの会話の下に1行足す
  async keepMoonComment(text: string) {
    await this.restored;
    this.companion.announce(text);
  }

  // ほかのパネルからのお知らせ（情報収集で新しいものが見つかった、など）。吹き出しで知らせる
  async announce(text: string) {
    await this.restored;
    const entry = this.companion.announce(text);
    this.bubbleId = entry.id;
    this.hideBubbleLater(30_000);
    this.render();
  }

  // リマインダーの時間になった（左サイドバーから届く。Windows の通知は C++ が出している）
  async onReminder(reminder: Reminder, late: boolean) {
    await this.restored; // 前回の会話に続けて出す（先に出すと、前回の会話が開かれなくなる）
    const when = late ? tr('（{0} の分。起動していない間に過ぎていました）', { 0: formatTime(reminder.dueAt) }) : '';
    const entry = this.companion.announce(tr('⏰ リマインダー：{0}{1}{2}', { 0: reminder.text, 1: reminder.title ? `（${reminder.title}）` : '', 2: when }));
    this.bubbleReminder = { entryId: entry.id, reminder };
    window.clearTimeout(this.bubbleTimer); // リマインダーの吹き出しは、閉じるか押すまで出しておく
    this.bubbleId = entry.id;
    this.render();
  }

  private async talkAbout(event: CompanionEvent) {
    const count = loadDailyCount();
    if (count >= this.prefs.dailyLimit) return;
    saveDailyCount(count + 1);
    this.bubbleAfter = this.companion.entries.at(-1)?.id ?? 0;
    window.clearTimeout(this.bubbleTimer);
    const entry = await this.companion.react(event);
    this.bubbleAfter = null;
    if (!entry) this.bubbleId = null;
    else if (this.bubbleId === entry.id) this.hideBubbleLater(BUBBLE_MS);
    this.render();
  }

  private hideBubbleLater(ms: number) {
    window.clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(() => {
      this.bubbleId = null;
      this.render();
    }, ms);
  }

  private setOpen(open: boolean) {
    this.prefs.open = open;
    saveAiPrefs(this.prefs);
    if (open) this.bubbleId = null; // 会話を開いたら、吹き出しは要らない
    this.render();
    if (open) {
      this.log.scrollTop = this.log.scrollHeight;
      this.input.focus();
    }
  }

  // ---------- 組み立て ----------

  private buildChat() {
    const header = el('header', 'ai-chat-header');
    this.historyButton.title = tr('過去の会話と、フェイブルレター');
    this.historyButton.addEventListener('click', () => void this.toggleHistory());
    const newChat = el('button', 'ai-small', tr('新しい会話'));
    newChat.addEventListener('click', () => {
      this.revealed.clear();
      this.openAdviceLetters.clear();
      this.view = 'chat';
      this.companion.reset();
    });
    const gear = el('button', 'ai-small', '⚙');
    gear.title = tr('設定');
    gear.setAttribute('aria-label', 'AI の設定');
    gear.addEventListener('click', () => {
      this.settings.hidden = !this.settings.hidden;
      if (!this.settings.hidden) {
        if (this.hexTargets === null) void this.loadHexTargets();
        void this.loadBlockHosts();
        void this.loadBudget();
      }
    });
    this.title.type = 'button';
    this.title.append(this.titleNames, el('span', 'ai-chat-caret', '▾'));
    this.cost.title = tr('この会話の料金の目安');
    this.membersNote.setAttribute('role', 'status');
    this.title.addEventListener('click', () => {
      this.membersPanel.hidden = !this.membersPanel.hidden;
      this.membersNote.textContent = '';
      this.renderMembers();
      this.render();
    });
    const vaultButton = el('button', 'ai-small', '📥');
    vaultButton.title = tr('今の会話を、データ置き場（右サイドバーのメモの区画の下）に残す（見たままの画像と文字のデータ）');
    vaultButton.setAttribute('aria-label', '今の会話をデータ置き場に残す');
    vaultButton.addEventListener('click', () => this.host.conversationToVault());
    header.append(this.title, this.cost, this.historyButton, newChat, vaultButton, gear);

    this.buildSettings();
    this.membersPanel.hidden = true;
    this.renderMembers();

    // Alt+1〜6 で、6つのボタンを押す（会話を開いているとき）
    document.addEventListener('keydown', (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || !/^[1-6]$/.test(e.key) || !this.prefs.open) return;
      e.preventDefault();
      this.phraseBar.press(Number(e.key) - 1);
    });

    const form = el('form', 'ai-form');
    this.input.placeholder = tr('Claude に話しかける…（Enter で送る・Shift+Enter で改行）');
    this.input.rows = 2;
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    this.attach.type = 'checkbox';
    this.attach.checked = this.prefs.attachPage;
    this.attach.addEventListener('change', () => {
      this.prefs.attachPage = this.attach.checked;
      saveAiPrefs(this.prefs);
    });
    const attachLabel = el('label', 'ai-attach');
    attachLabel.append(this.attach, document.createTextNode(tr('このページについて')));
    this.sendButton.type = 'submit';
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.companion.busy) {
        this.companion.stop();
        return;
      }
      const text = this.input.value.trim();
      if (!text) return;
      this.input.value = '';
      this.view = 'chat';
      if (this.talkTakesAnswer()) {
        void this.answerTalk(text); // やり取りの型の答え（V5）：材料と基準で包んで送る
        return;
      }
      void this.companion.ask('chat', text, this.attach.checked, this.prefs.target);
    });
    const row = el('div', 'ai-form-row');
    this.deepButton.type = 'button';
    this.deepButton.addEventListener('click', () => this.deepen());
    row.append(attachLabel, this.deepButton, this.sendButton);
    for (const id of ADVISOR_IDS) {
      const b = this.askButtons[id];
      b.type = 'button';
      b.addEventListener('click', () => this.askAdvisor(id));
    }
    this.adviceRow.setAttribute('role', 'group');
    this.adviceRow.setAttribute('aria-label', '先生に聞く（数は今日の残り）');
    this.adviceRow.append(el('span', 'ai-advice-label', tr('先生に聞く：')), ...ADVISOR_IDS.map((id) => this.askButtons[id]));
    form.append(this.targets, this.adviceRow, this.input, row);

    this.buildPreview();
    this.talkBar.hidden = true;
    this.chat.append(header, this.membersPanel, this.settings, this.log, this.previewHost, this.phraseBar.element, this.talkBar, form, this.phraseBar.editor);
  }

  // 頼みごとのボタン：決まった頼み方・文言を送る・入力欄に入れる
  private runPhrase(p: Phrase) {
    this.view = 'chat';
    if (p.kind === 'fill') {
      this.input.value = p.text;
      this.input.focus();
      this.input.setSelectionRange(p.text.length, p.text.length);
      return;
    }
    if (this.companion.busy) {
      this.companion.notice(tr('相棒が話し終わってから押してください'));
      return;
    }
    void this.confirmPhrase(p);
  }

  // 短いボタンは、送る前の1枚を出す。⚙で省略できる。渡し止めのページは省略できない
  private async confirmPhrase(p: Phrase) {
    const fixed = p.kind === 'summarize' || p.kind === 'explain' || p.kind === 'quiz';
    const wantsPage = fixed || (p.kind === 'send' && p.page);
    const page = wantsPage ? await requestPageText() : null;
    if (this.companion.busy) {
      this.companion.notice(tr('相棒が話し終わってから押してください'));
      return;
    }
    const blocked = !!(page?.url && (await pageIsBlocked(page.url)));
    if (this.prefs.skipSendPreview && !blocked) {
      this.dispatchPhrase(p);
      return;
    }
    const count = (value?: string) => [...(value ?? '')].length;
    const clip = (value?: string) => {
      const text = (value ?? '').replace(/\s+/g, ' ').trim();
      return [...text].length > 80 ? `${[...text].slice(0, 80).join('')}…` : text;
    };
    const pageOk = !!page && !page.error && !!page.text && !blocked;
    const explainOk = p.kind !== 'explain' || !!page?.selection;
    const cannot = fixed && (!pageOk || !explainOk);
    const sentChars = count(p.kind === 'send' ? p.text : '') + (pageOk ? count(page?.text) + count(page?.selection) + count(page?.title) : 0);
    renderSendPreview(this.previewBody, {
      to: tr('相棒（{0}）', { 0: nameOf(this.prefs, this.companion.lead) }),
      items: [
        { label: tr('題名'), on: wantsPage && pageOk && !!page?.title, detail: pageOk ? clip(page?.title) : undefined },
        { label: tr('アドレス'), on: wantsPage && pageOk && !!page?.url, detail: pageOk ? clip(page?.url) : undefined },
        { label: tr('選んだ文'), on: wantsPage && pageOk && !!page?.selection, detail: page?.selection ? tr('{0} 字', { 0: count(page.selection).toLocaleString('ja-JP') }) : undefined },
        { label: '本文', on: wantsPage && pageOk && !!page?.text, detail: page?.text ? tr('{0} 字', { 0: count(page.text).toLocaleString('ja-JP') }) : undefined },
        { label: tr('画像'), on: false },
      ],
      chars: count(p.kind === 'send' ? p.text : p.label),
      ...(blocked ? { blocked: BLOCK_NOTE } : {}),
      cost: cannot ? tr('この内容では呼び出しません') : companionCostNote(sentChars, this.prefs.model, this.prefs.practice),
      note: cannot
        ? blocked
          ? tr('ページの文章は付けないので、このボタンでは送りません')
          : p.kind === 'explain'
            ? tr('ページで説明してほしい言葉を選んでから押してください')
            : tr('ページの文章が取れないので、このボタンでは送りません')
        : p.kind === 'send'
          ? p.text
          : p.kind === 'summarize'
            ? tr('このページを要約します')
            : p.kind === 'explain'
              ? tr('選んだ言葉を解説します')
              : tr('このページからクイズを作ります'),
    });
    this.previewPhrase = cannot ? null : p;
    this.previewGo.hidden = cannot;
    this.previewStop.textContent = cannot ? tr('閉じる') : tr('やめる');
    this.previewHost.hidden = false;
  }

  private hidePreview() {
    this.previewHost.hidden = true;
    this.previewPhrase = null;
  }

  private buildPreview() {
    this.previewHost.hidden = true;
    this.previewHost.setAttribute('role', 'dialog');
    this.previewHost.setAttribute('aria-label', '送る前の確認');
    this.previewGo.type = 'button';
    this.previewStop.type = 'button';
    this.previewGo.addEventListener('click', () => {
      const phrase = this.previewPhrase;
      this.hidePreview();
      if (phrase) this.dispatchPhrase(phrase);
    });
    this.previewStop.addEventListener('click', () => this.hidePreview());
    const foot = el('div', 'send-sheet-foot');
    foot.append(this.previewStop, this.previewGo);
    this.previewHost.append(el('div', 'ai-setting-title', tr('送る前の確認')), this.previewBody, foot);
  }

  private dispatchPhrase(p: Phrase) {
    if (p.kind === 'fill') return;
    if (p.kind === 'send') void this.companion.ask('chat', p.text, p.page, this.prefs.target);
    else void this.companion.ask(p.kind);
  }

  private buildSettings() {
    this.settings.hidden = true;
    this.keyInput.type = 'password';
    this.keyInput.placeholder = 'sk-ant-…';
    this.keyInput.autocomplete = 'off';
    this.keyInput.spellcheck = false;
    const keyError = el('div', 'field-error');
    this.keyInput.addEventListener('input', () => (keyError.textContent = ''));
    const save = el('button', 'ai-small', tr('キーを保存'));
    save.addEventListener('click', () => {
      const key = this.keyInput.value.trim();
      if (!key) {
        keyError.textContent = tr('API キーを入れてください');
        return;
      }
      send({ type: 'setApiKey', key });
      this.keyInput.value = '';
    });
    const remove = el('button', 'ai-small', tr('キーを削除'));
    remove.addEventListener('click', () => send({ type: 'deleteApiKey' }));
    const keyRow = el('div', 'ai-row');
    keyRow.append(save, remove);

    const model = el('select');
    for (const m of MODELS) {
      const option = el('option', '', m.label);
      option.value = m.id;
      option.selected = m.id === this.prefs.model;
      model.append(option);
    }
    model.addEventListener('change', () => {
      this.prefs.model = model.value as ModelId;
      saveAiPrefs(this.prefs);
      this.companion.setModel(this.prefs.model);
      this.renderMembers(); // メンバーの欄の Claude のモデル
    });

    const practice = el('input');
    practice.type = 'checkbox';
    practice.checked = this.prefs.practice;
    practice.addEventListener('change', () => {
      this.prefs.practice = practice.checked;
      saveAiPrefs(this.prefs);
      this.companion.setPractice(practice.checked);
    });
    const practiceLabel = el('label', 'ai-check');
    practiceLabel.append(practice, document.createTextNode(tr('練習モード（API を使わずに、画面の動きだけ試す）')));

    const skipPreview = el('input');
    skipPreview.type = 'checkbox';
    skipPreview.checked = this.prefs.skipSendPreview;
    skipPreview.addEventListener('change', () => {
      this.prefs.skipSendPreview = skipPreview.checked;
      saveAiPrefs(this.prefs);
    });
    const skipLabel = el('label', 'ai-check');
    skipLabel.append(skipPreview, document.createTextNode(tr('短いボタンの確認を省略（要約・解説・クイズなど）。渡し止めのページでは省略できません')));

    const tools = el('input');
    tools.type = 'checkbox';
    tools.checked = this.prefs.useTools;
    tools.addEventListener('change', () => {
      this.prefs.useTools = tools.checked;
      saveAiPrefs(this.prefs);
      this.companion.setTools(tools.checked ? this.host.tools : null);
    });
    const search = el('input');
    search.type = 'checkbox';
    search.checked = this.prefs.webSearch;
    search.addEventListener('change', () => {
      this.prefs.webSearch = search.checked;
      saveAiPrefs(this.prefs);
      this.companion.setWebSearch(search.checked);
    });
    const searchLabel = el('label', 'ai-check');
    searchLabel.append(search, document.createTextNode(tr('Web 検索を使う（新しい情報が要るときだけ。1回 約 $0.01、1回の返事で3回まで）')));
    const toolsLabel = el('label', 'ai-check');
    toolsLabel.append(tools, document.createTextNode(tr('ブラウザの操作を任せる（タブを開く・探す・休眠・リマインダー・音楽。閉じる前は確認）')));

    // 六角メモの送り先（メモアプリ › ノート。返事はノートの原点の下の階層に置かれる）
    this.hexSelect.addEventListener('change', () => {
      const target = this.hexTargets?.[Number(this.hexSelect.value)] ?? null;
      this.prefs.hexMemoTarget = target;
      saveAiPrefs(this.prefs);
      this.hexState.textContent = target ? tr('「{0}」の原点の下に送ります', { 0: target.label }) : '';
    });
    const talk = el('select');
    for (const [value, label] of TALK_LEVELS) {
      const option = el('option', '', label);
      option.value = value;
      option.selected = value === this.prefs.talk;
      talk.append(option);
    }
    talk.addEventListener('change', () => {
      this.prefs.talk = talk.value as TalkLevel;
      saveAiPrefs(this.prefs);
    });
    const limit = el('input');
    limit.type = 'number';
    limit.min = '1';
    limit.max = '200';
    limit.value = String(this.prefs.dailyLimit);
    limit.addEventListener('change', () => {
      const value = Math.round(Number(limit.value));
      this.prefs.dailyLimit = Number.isFinite(value) ? clamp(value, 1, 200) : this.prefs.dailyLimit;
      limit.value = String(this.prefs.dailyLimit);
      saveAiPrefs(this.prefs);
      this.render();
    });
    const limitLabel = el('label', 'ai-limit');
    limitLabel.append(document.createTextNode(tr('1日に')), limit, document.createTextNode(tr('回まで')));

    const reloadHex = el('button', 'ai-small', tr('一覧を読み直す'));
    reloadHex.addEventListener('click', () => void this.loadHexTargets());
    this.renderHexOptions();

    this.blockInput.type = 'text';
    this.blockInput.placeholder = 'mail.example.com';
    this.blockInput.spellcheck = false;
    this.blockInput.autocomplete = 'off';
    this.blockInput.setAttribute('aria-label', '渡し止めに足すサイト');
    const addBlock = el('button', 'ai-small', tr('足す'));
    addBlock.type = 'button';
    addBlock.addEventListener('click', () => void this.addBlockHost());
    this.blockInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void this.addBlockHost();
      }
    });
    const blockRow = el('div', 'ai-row');
    blockRow.append(this.blockInput, addBlock);

    this.budgetInput.type = 'text';
    this.budgetInput.inputMode = 'decimal';
    this.budgetInput.placeholder = tr('空欄なら上限なし');
    this.budgetInput.spellcheck = false;
    this.budgetInput.autocomplete = 'off';
    this.budgetInput.setAttribute('aria-label', '今月の料金の上限（ドル）');
    const saveBudget = () => void this.saveBudgetCap();
    this.budgetInput.addEventListener('change', saveBudget);
    this.budgetInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveBudget();
      }
    });

    this.settings.append(
      el('div', 'ai-setting-title', tr('API キー')),
      this.keyInput,
      keyError,
      keyRow,
      this.keyState,
      el('div', 'ai-setting-title', tr('モデル')),
      model,
      practiceLabel,
      skipLabel,
      toolsLabel,
      searchLabel,
      ...this.buildCastSettings(),
      el('div', 'ai-setting-title', tr('今月の料金')),
      this.budgetInput,
      this.budgetState,
      el(
        'p',
        'ai-setting-note',
        tr('相棒（Claude）の料金の目安を、月ごとに足します。空欄のあいだは上限なしです。0 と入れると、次の呼び出しから止まります。近づいたときと、達したときに知らせます。これは目安で、実際の請求とは一致しません。Grok Bot の使用量は、このブラウザからは見えないので数えていません。練習モードは数えません。月が替わると、合計は 0 に戻ります。'),
      ),
      el('div', 'ai-setting-title', tr('相棒から話しかける')),
      talk,
      limitLabel,
      this.dailyState,
      el('div', 'ai-setting-title', tr('六角メモの送り先')),
      this.hexSelect,
      reloadHex,
      this.hexState,
      el('div', 'ai-setting-title', tr('渡し止め')),
      el(
        'p',
        'ai-setting-note',
        tr('ここに書いたサイトの本文・選んだ文・アドレス・画像・字幕は、相棒にも Grok Bot にも添付しません。例：mail.example.com（そのサイトと、その下の名前。www.mail.example.com も止まります）。一覧は空からはじまります。人が自分で書いた頼む文は止まりません。'),
      ),
      this.blockList,
      blockRow,
      this.blockState,
      el(
        'p',
        'ai-setting-note',
        tr('要約・解説・クイズや「このページについて」の質問では、表示中のページの文章（最大4万字）が Anthropic に送られます。相棒から話しかける設定のときは、ページを読み終えたとき（「ふつう」では ♥×3・メモのときも）にも、そのページの文章が送られます（1日の上限まで）。ブラウザの操作を任せているときは、道具を使うときにタブの一覧（タイトル・URL・メモ）も送られます。新しい会話の最初には、相棒が覚えていること（右サイドバーの「相棒が覚えていること」）も送られます。Web 検索は Anthropic 側で行われます。キーは Windows の仕組みで暗号化して、このパソコンに保存します。会話はこのパソコンに保存され、「履歴」から開き直せます。'),
      ),
    );
  }

  private buildCompanion() {
    for (const id of CHARACTER_IDS) {
      this.cells[id].innerHTML = FACES[id]; // 中身は固定の図形だけ
      this.cells[id].addEventListener('click', () => this.onFace(id));
    }
    this.buildBubble();
    const info = el('div', 'ai-info');
    info.append(this.nameLine, this.status);
    this.teamBox.append(...HAIKU_IDS.map((id) => this.cells[id]));
    this.faces.append(...CHARACTER_IDS.filter((id) => !isHaiku(id)).map((id) => this.cells[id]), this.teamBox, info);
    this.element.append(this.chat, this.bubble, this.faces);
  }

  // 顔を押す：そのキャラに話しかける（会話が閉じていれば開く。開いていて、すでにそのキャラ宛てなら閉じる）
  private onFace(id: CharacterId) {
    const single = this.prefs.members.length === 1;
    if (this.prefs.open && (single || this.prefs.target === id)) {
      this.setOpen(false);
      return;
    }
    if (!single) this.setTarget(id);
    if (!this.prefs.open) this.setOpen(true);
  }

  private setTarget(target: Target) {
    this.prefs.target = target;
    fixTarget(this.prefs);
    saveAiPrefs(this.prefs);
    this.render();
  }

  // 話しかける相手のボタン（メンバーが2体以上のときだけ）
  //   ハイク組は「ハイク組へ」の1つ（組の中のひとりへは、顔を押すと選べる。選んでいる間は、その体のボタンも出す）
  private renderTargets() {
    const members = this.prefs.members;
    this.targets.hidden = members.length < 2;
    if (members.length < 2) return;
    const team = teamOf(members);
    const target = this.prefs.target;
    const choices: [Target, string][] = [
      ...members.filter((id) => !isHaiku(id)).map((id): [Target, string] => [id, tr('{0}へ', { 0: this.companion.nameOf(id) })]),
      ...(team.length > 0 ? [['team', tr('{0}へ', { 0: HAIKU_UNIT_NAME })] as [Target, string]] : []),
      ...(isHaiku(target) && team.includes(target) ? [[target, tr('{0}へ', { 0: this.companion.nameOf(target) })] as [Target, string]] : []),
      ...(team.length === members.length ? [] : [['all', members.length === 2 ? tr('二人へ') : tr('みんなへ')] as [Target, string]]),
    ];
    const key = JSON.stringify(choices);
    if (key === this.targetsKey) {
      for (const b of this.targets.querySelectorAll<HTMLButtonElement>('.ai-target')) b.setAttribute('aria-pressed', String(this.prefs.target === b.dataset.target));
      return;
    }
    this.targetsKey = key;
    // 作り直すと押したボタンが消えるので、キーボードの位置を同じ宛先のボタンへ戻す（無ければ、選ばれているボタンへ）
    const focused = document.activeElement instanceof HTMLElement && this.targets.contains(document.activeElement) ? document.activeElement.dataset.target : undefined;
    this.targets.replaceChildren(
      ...choices.map(([target, label]) => {
        const b = el('button', `ai-target ${target}`, label);
        b.type = 'button';
        b.title = label;
        b.dataset.target = target;
        b.setAttribute('aria-pressed', String(this.prefs.target === target));
        b.addEventListener('click', () => this.setTarget(target));
        return b;
      }),
    );
    if (focused !== undefined) {
      const back =
        this.targets.querySelector<HTMLElement>(`[data-target="${focused}"]`) ?? this.targets.querySelector<HTMLElement>('[aria-pressed="true"]');
      back?.focus();
    }
  }

  // キャラたちの設定（⚙）：名前・性格・モデル・掛け合い。メンバーを選ぶのは、会話のいちばん上の名前（▾）
  private buildCastSettings(): HTMLElement[] {
    const banter = el('input');
    banter.type = 'checkbox';
    banter.checked = this.prefs.banter;
    banter.addEventListener('change', () => this.updateCast({ banter: banter.checked }));
    const banterLabel = el('label', 'ai-check');
    banterLabel.append(banter, document.createTextNode(tr('掛け合い（だれかが答えたら、ほかのメンバーがひとことずつ返す。料金が増えます）')));

    // 二人目の相棒（役割は決まった中から選ぶ）
    const updateSecond = (patch: Partial<SecondConfig>) => this.updateCast({ second: { ...this.prefs.second, ...patch } });
    const secondName = el('input', 'memory-input');
    secondName.value = this.prefs.second.name;
    secondName.placeholder = tr('名前');
    secondName.addEventListener('change', () => {
      const name = cleanName(secondName.value, DEFAULT_SECOND.name);
      secondName.value = name;
      updateSecond({ name });
    });
    const secondRole = el('select');
    for (const [key, role] of Object.entries(SECOND_ROLES)) secondRole.append(new Option(role.label, key, false, key === this.prefs.second.role));
    secondRole.addEventListener('change', () => updateSecond({ role: secondRole.value as SecondRole }));
    const secondModel = el('select');
    for (const m of MODELS) secondModel.append(new Option(m.label, m.id, false, m.id === this.prefs.second.model));
    secondModel.addEventListener('change', () => updateSecond({ model: secondModel.value as SecondConfig['model'] }));

    const fable = this.personaFields(
      () => this.prefs.fable,
      DEFAULT_FABLE,
      (persona) => this.updateCast({ fable: persona }),
    );
    const unitName = el('input', 'memory-input');
    unitName.value = this.prefs.trio.unitName;
    unitName.placeholder = tr('三人組の名前');
    unitName.addEventListener('change', () => {
      const name = cleanName(unitName.value, DEFAULT_TRIO.unitName);
      unitName.value = name;
      this.updateCast({ trio: { ...this.prefs.trio, unitName: name } });
    });
    const trio = TRIO_IDS.map((_, i) =>
      this.personaFields(
        () => this.prefs.trio.members[i],
        DEFAULT_TRIO.members[i],
        (persona) => {
          const members = [...this.prefs.trio.members] as Cast['trio']['members'];
          members[i] = persona;
          this.updateCast({ trio: { ...this.prefs.trio, members } });
        },
      ),
    );

    return [
      el('div', 'ai-setting-title', tr('キャラクター')),
      el('p', 'ai-setting-note', tr('会話に参加するキャラは、会話のいちばん上の名前（▾）を押して選びます（Claude も入れて3体まで）。')),
      banterLabel,
      el('div', 'ai-setting-sub', tr('二人目の相棒（役割を選ぶ）')),
      secondName,
      secondRole,
      secondModel,
      el('div', 'ai-setting-sub', tr('賢者（{0}）', { 0: FABLE_MODEL.label })),
      fable,
      ...this.buildEvolveSettings(),
      el('div', 'ai-setting-sub', tr('三人組（Claude Sonnet 5.5 が3体）')),
      unitName,
      ...trio,
      ...this.buildHaikuSettings(),
      el(
        'p',
        'ai-setting-note',
        tr('Claude 以外のキャラは、別の役割を演じる Claude です。ブラウザの操作（開く・閉じる・休眠など）は Claude だけ。フェイブルは見るだけの道具・ほかのタブを読む・Web 検索と取得・考察を残す（確認つき）、ジンは Web 検索、ルカはタブと順路を見る、モモはリマインダーと単語帳（確認つき）を使えます（「ブラウザの操作を任せる」「Web 検索を使う」の設定しだい。キャラがその会話で初めて話すときに決まります。あとで「Web 検索を使う」を切ると、話し始めたキャラには使わないよう頼みます）。名前・性格・モデルを変えると、そのキャラがまだ話していない会話から効きます。'),
      ),
    ];
  }

  // ハイク組：4体からの話し方（人数は、メンバーの欄で選ぶ）
  private buildHaikuSettings(): HTMLElement[] {
    const speak = el('select');
    speak.setAttribute('aria-label', 'ハイク組が4体以上のときの話し方');
    const modes: [HaikuSpeak, string][] = [
      ['lead', tr('4体から：モミジが組を代表して答える')],
      ['groups', tr('4体から：2つの班（3体まで）が、順番に答える')],
    ];
    for (const [value, label] of modes) speak.append(new Option(label, value, false, value === this.prefs.haiku.speak));
    speak.addEventListener('change', () => this.updateCast({ haiku: { ...this.prefs.haiku, speak: speak.value === 'groups' ? 'groups' : 'lead' } }));
    // 先生への相談：許可のしかた（先生ごと）と、ハイク組だけの1日の回数
    const apply = () => {
      saveAiPrefs(this.prefs);
      this.companion.setConsult(this.consultSettings());
      this.companion.setRoute(this.routeSettings());
      this.render();
    };
    const routeSelect = (key: 'routeMode' | 'routeStuck' | 'routeRefusal', label: string, options: [string, string][]) => {
      const select = el('select');
      select.setAttribute('aria-label', label);
      const current = this.prefs[key];
      for (const [value, text] of options) select.append(new Option(text, value, false, value === current));
      select.addEventListener('change', () => {
        if (key === 'routeMode') this.prefs.routeMode = select.value === 'team' || select.value === 'consult' ? select.value : 'auto';
        else if (key === 'routeStuck') this.prefs.routeStuck = select.value === 'auto' ? 'auto' : 'buttons';
        else this.prefs.routeRefusal = select.value === 'advisor' ? 'advisor' : 'plain';
        apply();
      });
      const row = el('label', 'ai-limit');
      row.append(document.createTextNode(`${label}：`), select);
      return row;
    };
    const modeSelect = (id: AdvisorId) => {
      const select = el('select');
      select.setAttribute('aria-label', `${ADVISORS[id].name}への相談の許可`);
      for (const [value, label] of CONSULT_MODES) select.append(new Option(label, value, false, value === modeOf(this.consultSettings(), id)));
      select.addEventListener('change', () => {
        const mode = CONSULT_MODES.some(([m]) => m === select.value) ? (select.value as ConsultMode) : DEFAULT_CONSULT[id];
        if (id === 'opus') this.prefs.consultOpus = mode;
        else this.prefs.consultFable = mode;
        apply();
      });
      const label = el('label', 'ai-limit');
      label.title = tr('{0}（{1}）への相談の許可', { 0: ADVISORS[id].name, 1: ADVISORS[id].label });
      label.append(document.createTextNode(`${ADVISORS[id].mark} ${ADVISORS[id].name}：`), select); // 選ぶ欄の文字が切れないよう、名前だけ
      return label;
    };
    const limitInput = (id: AdvisorId) => {
      const input = el('input');
      input.type = 'number';
      input.min = '0';
      input.max = '50';
      input.value = String(limitOf(this.consultSettings(), id));
      input.setAttribute('aria-label', `${ADVISORS[id].quotaName}（${ADVISORS[id].name}）：1日に何回まで`);
      input.addEventListener('change', () => {
        const raw = input.value.trim();
        const value = raw === '' ? Number.NaN : Math.round(Number(raw));
        const next = Number.isFinite(value) ? clamp(value, 0, 50) : limitOf(this.consultSettings(), id); // 空・数でないときは元の数に戻す
        if (id === 'opus') this.prefs.consultOpusLimit = next;
        else this.prefs.consultFableLimit = next;
        input.value = String(next);
        apply();
      });
      const label = el('label', 'ai-limit');
      label.append(document.createTextNode(tr('{0} {1}（{2}）：1日に', { 0: ADVISORS[id].mark, 1: ADVISORS[id].quotaName, 2: ADVISORS[id].name })), input, document.createTextNode(tr('回まで')));
      return label;
    };
    return [
      el('div', 'ai-setting-sub', tr('{0}（Claude Haiku 5.5 が{1}〜{2}体）', { 0: HAIKU_UNIT_NAME, 1: HAIKU_MIN, 2: HAIKU_MAX })),
      speak,
      el('div', 'ai-setting-sub', tr('道すじ（振り分け）')),
      routeSelect('routeMode', tr('道すじ'), [
        ['auto', tr('おまかせ（決まり＋迷うときだけハイクの判定）')],
        ['team', tr('いつもハイク組だけ')],
        ['consult', tr('いつも相談つき')],
      ]),
      routeSelect('routeStuck', tr('割れた・詰まったとき'), [
        ['buttons', tr('ボタンを出すだけ')],
        ['auto', tr('Claude 先生に自動で聞く（きらりを使う）')],
      ]),
      routeSelect('routeRefusal', tr('断られたあと'), [
        ['plain', tr('言い直す・ほかのハイクに聞く、だけ')],
        ['advisor', tr('先生に聞く、も出す')],
      ]),
      el(
        'p',
        'ai-setting-note',
        tr('ハイク組に話しかけたとき、自分の発言の下に「道すじ」が出ます。短い質問は組だけ、見通しや「本当？」は相談つき、と無料の決まりで分けます。決まりで決まらないときだけ、ハイクに1回聞いて決めます。開くと理由と、もう一方への選び直しが出ます。意見の数字が食い違ったときと、返事が途中で止まったときは、上の「割れた・詰まった」に従います。安全のための判定で断られたときは、自動では先生に回しません。作戦カードは、この段階にはありません。'),
      ),
      el('div', 'ai-setting-sub', tr('{0}から先生への相談', { 0: HAIKU_UNIT_NAME })),
      modeSelect('opus'),
      modeSelect('fable'),
      limitInput('opus'),
      limitInput('fable'),
      el('div', 'ai-setting-sub', tr('相談の記録')),
      this.consultState,
      el(
        'p',
        'ai-setting-note',
        tr('ハイク組の体が、自分だけでは自信が持てないときに先生に相談します（1つの頼みで組全体で1回まで。見送ったときも、その頼みではもう聞きません）。アプリが「相談の手紙」（問い・理由・使う人の頼み・最近の会話・ページのURLと本文の一部）を作って先生に渡し、助言は返事の中のカードに全文が出ます（［相談の手紙を見る］で、渡したものも見られます）。入力欄の上の「先生に聞く」を押すと、ハイク組が答える前に先生に相談します（押す＝許可。枠は使います）。枠はハイク組だけの1日の回数で、フェイブルの進化とは別。0時に戻ります。先生が書き始める前に届かなかった相談の分は戻りますが、時間切れ・止めたときは使ったことになります（途中までの料金がかかることがあります）。1回の目安：Claude 先生 約 $0.02〜0.10、フェイブル先生 約 $0.05〜0.25。フェイブル先生（Fable 5.1）に渡した相談の手紙は、Anthropic 側に30日保存されます。'),
      ),
      el(
        'p',
        'ai-setting-note',
        tr('人数（3〜6体）は、メンバーの欄（会話のいちばん上の名前 ▾）で選びます。ハイク組は何体でも会話のメンバーの1枠。3体までは「みんなへ」「ハイク組へ」で全員が順に答えます。4体からは、モミジが代表して答えるか、2つの班が頼みごとごとに交代で答えます（班は 4体なら2・2、5体なら3・2、6体なら3・3）。顔を押すと、組の中のひとりに話しかけられます。ツクシはタブと順路を見てほかのタブを読み、ホタルは Web 検索、モミジはリマインダーと単語帳（確認してから）、カエルは考察を残す（確認してから）、トンボはタブと順路を見ます。ユキは今は話すだけです。'),
      ),
    ];
  }

  // フェイブルの一時的な進化：許可のしかたと、1日の上限
  private buildEvolveSettings(): HTMLElement[] {
    const mode = el('select');
    mode.setAttribute('aria-label', '進化の許可');
    for (const [value, label] of EVOLVE_MODES) mode.append(new Option(label, value, false, value === this.prefs.evolveMode));
    const apply = () => {
      saveAiPrefs(this.prefs);
      this.companion.setEvolve(this.evolveSettings());
      this.render();
    };
    mode.addEventListener('change', () => {
      this.prefs.evolveMode = mode.value as EvolveMode;
      apply();
    });
    const limit = el('input');
    limit.type = 'number';
    limit.min = '1';
    limit.max = '20';
    limit.value = String(this.prefs.evolveLimit);
    limit.setAttribute('aria-label', '1日に進化できる回数');
    limit.addEventListener('change', () => {
      const value = Math.round(Number(limit.value));
      this.prefs.evolveLimit = Number.isFinite(value) ? clamp(value, 1, 20) : this.prefs.evolveLimit;
      limit.value = String(this.prefs.evolveLimit);
      apply();
    });
    const limitLabel = el('label', 'ai-limit');
    limitLabel.append(document.createTextNode(tr('1日に')), limit, document.createTextNode(tr('回まで（合図とボタンで分け合う。0時に戻る）')));
    const reserve = el('input');
    reserve.type = 'checkbox';
    reserve.checked = this.prefs.evolveReserve;
    reserve.addEventListener('change', () => {
      this.prefs.evolveReserve = reserve.checked;
      apply();
    });
    const reserveLabel = el('label', 'ai-check');
    reserveLabel.append(reserve, document.createTextNode(tr('フェイブルの合図用に1回残す（ボタンでは最後の1回を使わない。使われなければ、その日のうちに消える）')));
    return [
      el('div', 'ai-setting-sub', tr('フェイブルの進化（深く考えたいときだけ、考える深さを max に上げる）')),
      mode,
      limitLabel,
      reserveLabel,
      this.evolveState,
      el(
        'p',
        'ai-setting-note',
        tr('進化すると、ふだんより深く考えます（数分かかることがあります。1回 約 $0.20〜$1.00）。フェイブルの合図のときは許可を聞き、目安の料金が出ます。入力欄の下の「さらに考える」ボタンなら、確認なしで、その返事の初めから進化します。残りの回数は月の満ち欠けで出ます（満月＝まだ全部、新月＝もう無い）。'),
      ),
    ];
  }

  // 0時（日付が変わったとき）に描き直す：進化の枠の残りが戻るので
  private redrawAtMidnight() {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    window.setTimeout(() => {
      this.render();
      this.redrawAtMidnight();
    }, next.getTime() - now.getTime());
  }

  private routeSettings() {
    return { mode: this.prefs.routeMode, stuck: this.prefs.routeStuck, refusal: this.prefs.routeRefusal };
  }

  private consultSettings(): ConsultSettings {
    return {
      opus: this.prefs.consultOpus,
      fable: this.prefs.consultFable,
      opusLimit: this.prefs.consultOpusLimit,
      fableLimit: this.prefs.consultFableLimit,
    };
  }

  // 「先生に聞く」：入力した文（空なら、ここまでの話）を、ハイク組が先生に相談してから答える
  private askAdvisor(id: AdvisorId) {
    if (this.companion.busy || !canConsult(this.consultSettings(), id)) return;
    const text = this.input.value.trim();
    this.input.value = '';
    this.view = 'chat';
    const advisor = ADVISORS[id];
    // 入力が空なら、先生には「答えるときに気をつけること」を聞き、組には続きを頼む（助言は発言の中のかたまりで渡る）
    void this.companion.ask('chat', text || 'ここまでの話について、続けて答えてください。', this.attach.checked, this.prefs.target, {
      advisor: id,
      display: text || tr('{0} {1}に聞いて答えて', { 0: advisor.mark, 1: advisor.name }),
      question: text ? undefined : `ここまでの会話について、${HAIKU_UNIT_NAME}が次に答えるときに気をつけることを助言してください`,
    });
  }

  private evolveSettings(): EvolveSettings {
    return { mode: this.prefs.evolveMode, dailyLimit: this.prefs.evolveLimit, reserve: this.prefs.evolveReserve };
  }

  // さらに考える：フェイブルに、確認なしで初めから深く考えて（進化して）答えてもらう。入力が空なら、ここまでの話を深める
  private deepen() {
    if (this.companion.busy || !this.prefs.members.includes('fable') || !canEvolve(this.evolveSettings(), 'button')) return;
    const text = this.input.value.trim();
    this.input.value = '';
    this.view = 'chat';
    void this.companion.ask(
      'chat',
      text || 'ここまでの話を、もう一段深く考えてください。新しい見方・前提の問い直し・仮説があれば教えてください。',
      this.attach.checked,
      'fable',
      { deep: true, display: text || tr('🌕 さらに考えて') },
    );
  }

  // 名前と性格を書ける欄（元に戻すボタンつき）
  private personaFields(current: () => Persona, fallback: Persona, apply: (persona: Persona) => void): HTMLElement {
    const box = el('div', 'ai-persona');
    const name = el('input', 'memory-input');
    name.value = current().name;
    name.placeholder = tr('名前');
    name.addEventListener('change', () => {
      name.value = cleanName(name.value, fallback.name);
      apply({ ...current(), name: name.value });
    });
    const persona = el('textarea', 'memory-input info-textarea');
    persona.rows = 3;
    persona.value = current().persona;
    persona.placeholder = tr('性格と役割');
    persona.addEventListener('change', () => {
      persona.value = cleanPersona(persona.value, fallback.persona);
      apply({ ...current(), persona: persona.value });
    });
    const reset = el('button', 'ai-small', tr('元に戻す'));
    reset.type = 'button';
    reset.addEventListener('click', () => {
      name.value = fallback.name;
      persona.value = fallback.persona;
      apply({ ...fallback });
    });
    box.append(name, persona, reset);
    return box;
  }

  // キャラたちの設定を変える（保存して、相棒の頭と画面に伝える）
  private updateCast(patch: Partial<Cast> & { target?: Target }) {
    Object.assign(this.prefs, patch);
    this.prefs.members = normalizeMembers(this.prefs.members, this.prefs.haiku.size); // 顔と同じ並び（「みんなへ」もこの順に答える）
    fixTarget(this.prefs);
    saveAiPrefs(this.prefs);
    this.companion.setCast(castOf(this.prefs));
    this.renderMembers();
    this.render();
  }

  // 会話に参加するメンバーを選ぶ欄（Claude も入れて3体まで）
  private renderMembers() {
    const members = this.prefs.members;
    const focused = document.activeElement instanceof HTMLElement && this.membersPanel.contains(document.activeElement) ? document.activeElement.dataset.id : undefined;
    const row = (id: CharacterId) => {
      const label = el('label', `ai-member ${id}`);
      const check = el('input');
      check.type = 'checkbox';
      check.checked = members.includes(id);
      check.dataset.id = id;
      check.addEventListener('change', () => this.toggleMember(id, check.checked));
      const text = el('span', 'ai-member-text');
      text.append(el('span', 'ai-member-name', nameOf(this.prefs, id)), el('span', 'ai-member-blurb', blurbOf(this.prefs, id)));
      // モデル：話し始めたキャラは、この会話で使っているモデル（⚙ で変えても、話し始めた会話では変わらない）
      const setting = modelOf(this.prefs, id, this.prefs.model);
      const now = this.companion.modelFor(id);
      const model = el('span', 'ai-member-model', now === setting ? modelLabel(now) : tr('{0}（この会話）', { 0: modelLabel(now) }));
      if (now !== setting) model.title = tr('⚙ の設定は {0}。次の会話から効きます', { 0: modelLabel(setting) });
      label.append(check, el('span', `ai-member-dot ${id}`), text, model);
      return label;
    };
    // ハイク組：組で1つの行（印を付けると、組の人数の分だけ入る）と、人数の選択
    const team = teamOf(members);
    const haikuOnly = isHaikuOnly(members);
    const teamButton = el('button', 'ai-small', haikuOnly ? tr('{0}で話しています', { 0: HAIKU_UNIT_NAME }) : tr('{0}で話す', { 0: HAIKU_UNIT_NAME }));
    teamButton.type = 'button';
    teamButton.dataset.id = 'haiku-only';
    teamButton.disabled = haikuOnly;
    teamButton.title = tr('メンバーを{0}だけにして、{1}に話しかける（ほかのキャラは外れる）', { 0: HAIKU_UNIT_NAME, 1: HAIKU_UNIT_NAME });
    teamButton.addEventListener('click', () => {
      this.membersNote.textContent = '';
      this.updateCast({ members: [...HAIKU_IDS], target: 'team' });
    });
    const teamHead = el('div', 'ai-member-group');
    teamHead.append(el('span', 'ai-member-group-name', HAIKU_UNIT_NAME), teamButton);
    const teamLabel = el('label', 'ai-member haiku');
    const teamCheck = el('input');
    teamCheck.type = 'checkbox';
    teamCheck.checked = team.length > 0;
    teamCheck.dataset.id = 'haiku';
    teamCheck.addEventListener('change', () => this.toggleTeam(teamCheck.checked));
    const teamText = el('span', 'ai-member-text');
    const size = this.prefs.haiku.size;
    teamText.append(
      el('span', 'ai-member-name', tr('{0}（1枠）', { 0: HAIKU_UNIT_NAME })),
      el('span', 'ai-member-blurb', HAIKU_IDS.slice(0, size).map((id) => nameOf(this.prefs, id)).join(tr('・'))),
    );
    teamLabel.append(teamCheck, el('span', 'ai-member-dot tsukushi'), teamText, el('span', 'ai-member-model', modelLabel(HAIKU_MODEL.id)));
    const sizeSelect = el('select', 'ai-member-size');
    sizeSelect.dataset.id = 'haiku-size';
    sizeSelect.setAttribute('aria-label', `${HAIKU_UNIT_NAME}の人数`);
    for (let n = HAIKU_MIN; n <= HAIKU_MAX; n++) sizeSelect.append(new Option(tr('{0}体', { 0: n }), String(n), false, n === size));
    sizeSelect.addEventListener('change', () => {
      this.membersNote.textContent = '';
      this.updateCast({ haiku: { ...this.prefs.haiku, size: Number(sizeSelect.value) } });
    });
    const teamRow = el('div', 'ai-member-row');
    teamRow.append(teamLabel, sizeSelect);
    const trioOnly = isTrioOnly(members);
    const trioButton = el('button', 'ai-small', trioOnly ? tr('三人組で話しています') : tr('三人組で話す'));
    trioButton.type = 'button';
    trioButton.dataset.id = 'trio';
    trioButton.disabled = trioOnly;
    trioButton.title = tr('メンバーを三人組の3体にして、みんなに話しかける（ほかのキャラは外れる）');
    trioButton.addEventListener('click', () => {
      this.membersNote.textContent = '';
      this.updateCast({ members: [...TRIO_IDS], target: 'all' });
    });
    const trioHead = el('div', 'ai-member-group');
    trioHead.append(el('span', 'ai-member-group-name', this.prefs.trio.unitName), trioButton);
    this.title.setAttribute('aria-expanded', String(!this.membersPanel.hidden));
    this.membersPanel.replaceChildren(
      el('div', 'ai-setting-title', tr('会話に参加するメンバー（Claude も入れて{0}枠まで。{1}は1枠）', { 0: MAX_MEMBERS, 1: HAIKU_UNIT_NAME })),
      row('main'),
      row('second'),
      row('fable'),
      trioHead,
      ...TRIO_IDS.map(row),
      teamHead,
      teamRow,
      this.membersNote,
      el(
        'p',
        'ai-setting-note',
        tr('ブラウザの操作は Claude だけ（ほかのキャラは、見る・読む・調べるなどの道具を少し持つ）。Claude がいないときは、要約などの頼みごとや出来事に、いちばん上のメンバーが答える。{0}（{1}）の料金は Opus 5.5 の約2.5倍。{2}（{3}）は 3〜6体で1枠、料金はいちばん安い（Opus 5.5 の約40分の1）。名前と性格・ハイク組の話し方は ⚙ で変えられます。', { 0: nameOf(this.prefs, 'fable'), 1: FABLE_MODEL.label, 2: HAIKU_UNIT_NAME, 3: HAIKU_MODEL.label }),
      ),
    );
    if (focused) {
      // 押したボタンが使えなくなったとき（三人組で話す・ハイク組で話す）は、その組の最初の欄へ
      const back = this.membersPanel.querySelector<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>(`[data-id="${focused}"]`);
      const fallback = focused === 'haiku-only' ? '[data-id="haiku"]' : '[data-id="trio1"]';
      (back && !back.disabled ? back : this.membersPanel.querySelector<HTMLElement>(fallback))?.focus();
    }
  }

  private toggleMember(id: CharacterId, on: boolean) {
    const members = this.prefs.members;
    // 断るときは、印を元に戻してから知らせる（欄を描き直したあとに書くと、読み上げにも伝わる）
    const refuse = (message: string) => {
      this.membersNote.textContent = '';
      this.renderMembers();
      this.membersNote.textContent = message;
    };
    if (on && !members.includes(id) && slotsOf(members) >= MAX_MEMBERS) {
      refuse(tr('会話のメンバーは{0}枠までです（{1}は1枠）。先にだれかを外してください', { 0: MAX_MEMBERS, 1: HAIKU_UNIT_NAME }));
      return;
    }
    if (!on && members.length === 1 && members[0] === id) {
      refuse(tr('1体は残してください'));
      return;
    }
    this.membersNote.textContent = '';
    this.updateCast({ members: on ? [...members, id] : members.filter((m) => m !== id) });
  }

  // ハイク組を会話に入れる・外す（入れるときは、組の人数の分だけ入る）
  private toggleTeam(on: boolean) {
    const members = this.prefs.members;
    const refuse = (message: string) => {
      this.membersNote.textContent = '';
      this.renderMembers();
      this.membersNote.textContent = message;
    };
    if (on && teamOf(members).length === 0 && slotsOf(members) >= MAX_MEMBERS) {
      refuse(tr('会話のメンバーは{0}枠までです（{1}は1枠）。先にだれかを外してください', { 0: MAX_MEMBERS, 1: HAIKU_UNIT_NAME }));
      return;
    }
    if (!on && isHaikuOnly(members)) {
      refuse(tr('1体は残してください'));
      return;
    }
    this.membersNote.textContent = '';
    this.updateCast({ members: on ? [...members, ...HAIKU_IDS] : members.filter((m) => !isHaiku(m)) });
  }

  // 会話を閉じているときに、自分から話したことを見せる吹き出し（押すと会話が開く）
  private buildBubble() {
    this.bubble.hidden = true;
    const close = el('button', 'ai-bubble-close', '×');
    close.title = tr('吹き出しを閉じる');
    close.setAttribute('aria-label', '吹き出しを閉じる');
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      this.bubbleId = null;
      this.render();
    });
    this.bubble.title = tr('押すと会話を開きます');
    this.bubble.addEventListener('click', () => this.setOpen(true));
    // マウスを乗せている間は消さない
    this.bubble.addEventListener('pointerenter', () => window.clearTimeout(this.bubbleTimer));
    this.bubble.addEventListener('pointerleave', () => {
      const entry = this.companion.entries.find((e) => e.id === this.bubbleId);
      if (entry && !entry.streaming) this.hideBubbleLater(6_000);
    });
    this.bubble.append(close, this.bubbleText, this.bubbleActions);
  }

  private onApiKey(key: string | null, error?: string) {
    if (error) {
      this.keyState.textContent = tr('キーを保存できませんでした');
      return;
    }
    this.companion.setApiKey(key);
  }

  // ---------- 会話の保存 ----------

  private async restoreLastConversation() {
    const id = this.prefs.lastConversation;
    if (!id) return;
    const saved = await loadConversation(id);
    if (saved && this.companion.entries.length === 0) this.companion.load(saved);
  }

  // ---------- フェイブルレター ----------

  // 月の窓から：相棒の会話を開いて、レターの一覧でそのレターを見せる
  async openLetter(id: string) {
    await this.restored;
    if (!this.prefs.open) this.setOpen(true);
    this.showLetters(id);
  }

  // 月の窓から：レターが生まれた会話を開く
  async openConversationById(id: string) {
    await this.restored;
    if (!this.prefs.open) this.setOpen(true);
    await this.openConversation(id);
  }

  // レターの一覧を開いて、そのレターを見せる
  private showLetters(letterId?: string) {
    this.view = 'letters';
    this.render();
    const item = letterId ? this.log.querySelector<HTMLElement>(`[data-letter="${letterId}"]`) : null;
    for (const lit of this.log.querySelectorAll('.ai-letter-item.flash')) lit.classList.remove('flash');
    if (item) {
      // 一覧の中だけを動かす（scrollIntoView は、はみ出しを隠している右サイドバーそのものまで動かしてしまう）
      this.log.scrollTop += item.getBoundingClientRect().top - this.log.getBoundingClientRect().top - 8;
      void item.offsetWidth; // 同じレターをもう一度見せるときも、光り直す
      item.classList.add('flash');
    } else {
      this.log.scrollTop = 0;
    }
  }

  // 提案されたレターを残す
  private keepLetter(entry: ChatEntry) {
    const proposal = entry.letter;
    if (!proposal || proposal.state !== 'proposed' || entry.streaming) return; // 返事が終わってから
    if (!this.letters.ready) {
      this.companion.notice(tr('レターの一覧を読み込んでいます。少し待ってから、もう一度押してください'));
      return;
    }
    const speaker = entry.speaker && isCharacterId(entry.speaker) ? entry.speaker : 'fable';
    const letter = this.letters.add({
      title: proposal.title,
      ...(proposal.points?.length ? { points: [...proposal.points] } : {}),
      body: proposal.body,
      chat: cleanChat(entry.question, entry.text), // 3段目：元の会話（使う人の発言と、この返事）
      by: { who: speaker, name: entry.speakerName ?? this.companion.nameOf(speaker) },
      conversationId: this.companion.id,
      question: entry.question ? [...entry.question].slice(0, 200).join('') : undefined,
      pageTitle: entry.pageTitle,
      pageUrl: entry.pageUrl && /^https?:\/\//i.test(entry.pageUrl) ? entry.pageUrl : undefined,
    });
    if (!letter) {
      this.companion.notice(tr('レターがいっぱいです（{0}通まで）。「履歴」→「✉ フェイブルレター」から古いレターを消してから、もう一度押してください', { 0: MAX_LETTERS }));
      return;
    }
    this.companion.setLetterState(entry.id, 'kept', letter.id);
  }

  // レターから、単語帳のカードの案を作る（もう一度押すと、案を閉じる）
  private async studyLetter(letter: Letter) {
    if (this.study?.making) return;
    if (this.study?.letterId === letter.id) {
      this.study = null;
      if (this.letterNote?.id === letter.id) this.letterNote = null;
      this.render();
      return;
    }
    this.study = { letterId: letter.id, making: true, cards: [] };
    this.letterNote = null;
    this.render();
    try {
      // カードの出どころはページ（題名もページのもの）。このレターから入れたカードは、もう作らない
      const points = letter.points?.length ? `${letter.points.join('\n')}\n` : '';
      const result = await makeCards({ title: letter.pageTitle ?? letter.title, url: letter.pageUrl ?? '', text: `${letter.title}\n${points}${letter.body}` }, letter.studiedFronts ?? [], this.organizeSettings());
      if (this.study?.letterId !== letter.id) return;
      this.study = result.cards.length > 0 ? { letterId: letter.id, making: false, cards: result.cards.map((c) => ({ ...c, checked: true })) } : null;
      const cost = result.cost > 0 ? tr('（約 ${0}）', { 0: result.cost.toFixed(3) }) : '';
      this.letterNote = { id: letter.id, text: result.cards.length > 0 ? tr('カードの案が {0} 枚できました{1}。入れるものに印を付けてください', { 0: result.cards.length, 1: cost }) : tr('この手紙から、カードの案は作れませんでした{0}', { 0: cost }) };
    } catch (error) {
      if (this.study?.letterId === letter.id) this.study = null;
      this.letterNote = { id: letter.id, text: tr('作れませんでした：{0}', { 0: error instanceof Error ? error.message : String(error) }) };
    }
    this.render();
  }

  // 一覧のレターを消す（一度目は「もう一度押すと消えます」、二度目で消す）
  private removeLetter(letter: Letter) {
    window.clearTimeout(this.armTimer);
    if (this.armedLetter === letter.id) {
      this.armedLetter = null;
      if (this.study?.letterId === letter.id) this.study = null;
      this.letters.remove(letter.id);
      return;
    }
    this.armedLetter = letter.id;
    this.armTimer = window.setTimeout(() => {
      this.armedLetter = null;
      this.render();
    }, 4_000);
    this.render();
    this.log.querySelector<HTMLElement>(`[data-letter="${letter.id}"] .ai-letter-remove`)?.focus();
  }

  // 履歴のボタン：過去の会話（とレターのタブ）を開く・閉じる
  private async toggleHistory() {
    if (this.view === 'history' || this.view === 'letters') {
      this.view = 'chat';
      this.render();
      return;
    }
    await this.showHistory();
  }

  private async showHistory() {
    this.view = 'history';
    this.historyItems = await loadIndex();
    this.render();
  }

  // レターのタブを出すか（フェイブルがメンバーにいるか、残したレターがあるとき）
  private get lettersShown() {
    return this.letters.list().length > 0 || this.prefs.members.includes('fable');
  }

  // 履歴の上のタブ：過去の会話／フェイブルレター
  private renderLogTabs(): HTMLElement {
    const bar = el('div', 'ai-log-tabs');
    if (!this.lettersShown) {
      bar.hidden = true;
      return bar;
    }
    bar.setAttribute('role', 'tablist');
    const count = this.letters.list().length;
    const tab = (view: 'history' | 'letters', label: string, open: () => void) => {
      const button = el('button', 'ai-log-tab', label);
      button.dataset.key = `tab:${view}`;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(this.view === view));
      button.addEventListener('click', () => {
        if (this.view !== view) open();
      });
      return button;
    };
    bar.append(
      tab('history', tr('過去の会話'), () => void this.showHistory()),
      tab('letters', tr('✉ フェイブルレター{0}', { 0: count > 0 ? `（${count}）` : '' }), () => this.showLetters()),
    );
    return bar;
  }

  private async openConversation(id: string) {
    const saved = await loadConversation(id);
    this.view = 'chat';
    if (saved) {
      this.revealed.clear();
      this.openAdviceLetters.clear();
      this.companion.load(saved);
    } else {
      this.companion.notice(tr('その会話は、もう残っていません（履歴から削除されたようです）'));
    }
    this.render();
  }

  private async removeConversation(item: ConversationSummary) {
    if (!window.confirm(tr('「{0}」の会話を削除しますか？', { 0: item.title }))) return;
    await deleteConversation(item.id);
    if (item.id === this.companion.id) this.companion.reset();
    this.historyItems = await loadIndex();
    this.render();
  }

  // ---------- 返事を残す ----------

  // 返事から作る単語帳のカード（言葉・問いと、意味・答え。入れる前に直せる）
  private cardForm(entry: ChatEntry, draft: CardFormDraft): HTMLElement {
    const form = el('form', 'ai-card-form vocab-form');
    const front = el('input');
    front.dataset.field = 'front';
    front.placeholder = draft.kind === 'quiz' ? tr('問い') : tr('言葉（覚えたい言葉）');
    front.value = draft.front;
    front.maxLength = 400;
    front.addEventListener('input', () => (draft.front = front.value));
    const back = el('textarea', 'info-textarea');
    back.dataset.field = 'back';
    back.placeholder = draft.kind === 'quiz' ? tr('答え') : tr('意味・説明');
    back.rows = 4;
    back.value = draft.back;
    back.maxLength = 1000;
    back.addEventListener('input', () => (draft.back = back.value));
    const ok = el('button', 'ai-small', tr('単語帳に入れる'));
    ok.type = 'submit';
    const cancel = el('button', 'ai-small', tr('やめる'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      this.cardDraft = null;
      this.render();
    });
    const row = el('div', 'ai-row');
    row.append(ok, cancel);
    form.append(front, back, row);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!draft.front.trim() || !draft.back.trim()) {
        (draft.front.trim() ? back : front).focus();
        return;
      }
      const source = entry.pageUrl && /^https?:\/\//i.test(entry.pageUrl) ? { url: entry.pageUrl, title: entry.pageTitle ?? '' } : undefined;
      this.host.addCards([{ kind: draft.kind, front: draft.front, back: draft.back, source }]);
      this.cardDraft = null;
      (document.activeElement as HTMLElement | null)?.blur();
      this.companion.markKept(entry.id, { vocab: true });
    });
    return form;
  }

  private keepInTab(entry: ChatEntry) {
    const tabId = entry.tabId ?? this.host.activeTabId();
    if (tabId === null) return;
    this.host.keepNote(tabId, {
      id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      text: entry.text,
      createdAt: Date.now(),
      source: 'ai',
      label: `${entry.speaker && entry.speaker !== 'main' ? tr('{0}・', { 0: entry.speakerName }) : ''}${entry.action ? ACTION_LABELS[entry.action] : 'AI'}`,
    });
    this.companion.markKept(entry.id, { tab: true });
  }

  // 返事をデータ置き場に入れる（文字のデータ。元の会話・話したキャラ・ページも覚えておく）
  private async replyToVault(entry: ChatEntry) {
    const name = entry.speakerName ?? 'Claude';
    const label = entry.action ? ACTION_LABELS[entry.action] : tr('返事');
    const ok = await this.host.toVault({
      kind: 'reply',
      title: tr('{0}の{1}{2}', { 0: name, 1: label, 2: entry.pageTitle ? `：${entry.pageTitle}` : '' }),
      text: recordOf(entry).text,
      data: { version: 1, conversationId: this.companion.id, entry: entryData(entry) },
      sourceAt: entry.time,
      source: { conversationId: this.companion.id, entryId: entry.id, speaker: name, model: entry.model, pageTitle: entry.pageTitle, pageUrl: entry.pageUrl },
    });
    if (ok) this.companion.markKept(entry.id, { vault: true });
  }

  private async sendEntryToHexMemo(entry: ChatEntry) {
    const target = this.prefs.hexMemoTarget;
    if (!target) {
      // 送り先がまだ無い：設定を開いて選んでもらう
      this.settings.hidden = false;
      if (this.hexTargets === null) await this.loadHexTargets();
      this.hexState.textContent = tr('先に、六角メモの送り先を選んでください');
      this.hexSelect.focus();
      return;
    }
    this.sending.add(entry.id);
    this.render();
    const outcome = await sendToHexMemo(target, [recordOf(entry)]);
    this.sending.delete(entry.id);
    if (!outcome.ok) {
      this.companion.markKept(entry.id, { hexMemo: outcome.error, hexMemoFailed: true });
    } else if ('pending' in outcome) {
      this.companion.markKept(entry.id, { hexMemo: outcome.message, hexMemoFailed: false });
    } else {
      this.companion.markKept(entry.id, { hexMemo: tr('六角メモ「{0}」に送りました', { 0: outcome.where || target.label }), hexMemoFailed: false });
    }
  }

  private showBudget(view: BudgetView) {
    if (view.month !== this.budgetMonth) {
      this.budgetMonth = view.month;
      this.toldNear = false;
    }
    if (document.activeElement !== this.budgetInput) this.budgetInput.value = view.cap === null ? '' : String(view.cap);
    const cap = view.cap === null ? tr('上限なし') : tr('上限 {0}', { 0: formatUsd(view.cap) });
    const state = view.blocked ? tr('。上限に達しているので、新しい呼び出しは止まります') : view.near ? tr('。上限に近づいています') : '';
    this.budgetState.textContent = tr('今月の目安：{0}（{1}）{2}', { 0: formatUsd(view.spent), 1: cap, 2: state });
  }

  private async loadBudget() {
    this.showBudget(await loadBudget());
  }

  private async saveBudgetCap() {
    const raw = this.budgetInput.value.trim();
    if (!raw) {
      this.showBudget(await setBudgetCap(null));
      return;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      this.budgetState.textContent = tr('0 以上の数字を入れるか、空欄にしてください（空欄は上限なし）');
      return;
    }
    if (value > MAX_CAP) {
      this.budgetState.textContent = tr('上限は {0} までです', { 0: formatUsd(MAX_CAP) });
      return;
    }
    this.showBudget(await setBudgetCap(value));
  }

  private async loadBlockHosts() {
    this.blockHosts = await ensureBlocklist();
    this.renderBlockHosts();
  }

  private renderBlockHosts() {
    this.blockList.replaceChildren(
      ...this.blockHosts.map((host) => {
        const row = el('div', 'ai-row');
        const name = el('span', 'ai-block-host', host);
        const remove = el('button', 'ai-small', tr('外す'));
        remove.type = 'button';
        remove.addEventListener('click', () => void this.removeBlockHost(host));
        row.append(name, remove);
        return row;
      }),
    );
  }

  private async addBlockHost() {
    const parts = this.blockInput.value.split(/[\s,、]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return;
    const accepted: string[] = [];
    let rejected = false;
    for (const part of parts) {
      const host = normalizeHost(part);
      if (host) accepted.push(host);
      else rejected = true;
    }
    const next = [...this.blockHosts];
    for (const host of accepted) if (!next.includes(host)) next.push(host);
    if (next.length > BLOCKLIST_MAX) {
      this.blockState.textContent = tr('{0}件までです', { 0: BLOCKLIST_MAX });
      return;
    }
    this.blockHosts = await setBlocklist(next);
    this.renderBlockHosts();
    if (!rejected) this.blockInput.value = '';
    this.blockState.textContent = rejected ? tr('サイトの形になっていないものがあります。例：mail.example.com（com だけ、のような短い名前は入れられません）') : accepted.length > 0 ? tr('足しました') : '';
  }

  private async removeBlockHost(host: string) {
    this.blockHosts = await setBlocklist(this.blockHosts.filter((h) => h !== host));
    this.renderBlockHosts();
    this.blockState.textContent = '';
  }

  private async loadHexTargets() {
    this.hexState.textContent = tr('六角メモの一覧を読んでいます…');
    const catalog = await loadCatalog();
    this.hexTargets = catalog.available ? targetsOf(catalog) : [];
    this.renderHexOptions();
    if (!catalog.available) this.hexState.textContent = tr('六角メモのデータが見つかりませんでした');
    else if (!catalog.canSignal) this.hexState.textContent = tr('六角メモのプログラムが見つからないため、送ったものは次に六角メモを開いたときに届きます');
    else this.hexState.textContent = this.prefs.hexMemoTarget ? tr('「{0}」の原点の下に送ります', { 0: this.prefs.hexMemoTarget.label }) : '';
  }

  private renderHexOptions() {
    const current = this.prefs.hexMemoTarget;
    const options: HTMLOptionElement[] = [];
    const none = el('option', '', this.hexTargets === null && current ? current.label : tr('（選んでいません）'));
    none.value = '';
    options.push(none);
    (this.hexTargets ?? []).forEach((t, i) => {
      const option = el('option', '', t.label);
      option.value = String(i);
      option.selected = !!current && current.appId === t.appId && current.boardId === t.boardId;
      options.push(option);
    });
    this.hexSelect.replaceChildren(...options);
  }

  // ---------- 表示 ----------

  private requestRender() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private render() {
    const c = this.companion;
    const members = this.prefs.members;
    // 話している（話していなければ、頼みごとに答える）キャラの顔だけを動かす
    // うまくいかなかったときは、失敗したキャラの顔に出す
    const resting: CompanionState = c.state === 'noKey' ? 'noKey' : 'idle';
    const failed = c.state === 'error' && c.lastSpeaker && members.includes(c.lastSpeaker) ? c.lastSpeaker : null;
    const moving = c.activeSpeaker ?? failed ?? c.lead;
    for (const id of CHARACTER_IDS) {
      const cell = this.cells[id];
      cell.hidden = !members.includes(id);
      if (cell.hidden) continue;
      const name = c.nameOf(id);
      const closes = this.prefs.open && (members.length === 1 || this.prefs.target === id);
      cell.dataset.state = id === moving ? c.state : resting;
      // 会話を開いているとき、話しかける相手の枠を濃くする
      cell.dataset.target = String(
        this.prefs.open && (members.length === 1 || this.prefs.target === id || this.prefs.target === 'all' || (this.prefs.target === 'team' && isHaiku(id))),
      );
      cell.setAttribute('aria-expanded', String(this.prefs.open));
      cell.setAttribute('aria-label', closes ? tr('{0}との会話を閉じる', { 0: name }) : members.length === 1 ? tr('{0}との会話を開く', { 0: name }) : tr('{0}に話しかける', { 0: name }));
      cell.title = `${name}（${blurbOf(this.prefs, id)}）`;
    }
    // フェイブル：進化している間は進化した姿、許可を聞いている間は少しだけ光る。終わったら光が広がって消える
    const fableCell = this.cells.fable;
    const form = c.awake === 'fable' ? 'evolved' : this.evolvePending('fable') ? 'teaser' : 'normal';
    if (fableCell.dataset.form === 'evolved' && form !== 'evolved') {
      fableCell.dataset.revert = '';
      window.setTimeout(() => delete fableCell.dataset.revert, 1_000);
    }
    fableCell.dataset.form = form;
    this.faces.dataset.count = String(slotsOf(members)); // ハイク組は1枠に数えて、ほかの顔の大きさを決める
    this.layoutTeam(teamOf(members), slotsOf(members));
    const team = teamOf(members);
    const groups = [...members.filter((id) => !isHaiku(id)).map((id) => c.nameOf(id)), ...(team.length > 0 ? [HAIKU_UNIT_NAME] : [])];
    const names = isTrioOnly(members) ? this.prefs.trio.unitName : groups.join(groups.length === 2 ? tr(' と ') : tr('・'));
    this.nameLine.textContent = names;
    this.titleNames.textContent = names;
    this.title.title = tr('会話に参加するメンバーを選ぶ（いま {0}枠・Claude も入れて{1}枠まで。{2}は1枠）', { 0: slotsOf(members), 1: MAX_MEMBERS, 2: HAIKU_UNIT_NAME });
    const speaking = c.activeSpeaker ?? failed;
    const who = speaking && c.awake === speaking ? tr('{0}（覚醒）：', { 0: c.nameOf(speaking) }) : members.length > 1 && speaking ? `${c.nameOf(speaking)}：` : '';
    this.status.textContent = who + STATUS[c.state] + (c.practice ? tr('（練習モード）') : '');
    this.renderTargets();
    this.input.placeholder = tr('{0}に話しかける…（Enter で送る・Shift+Enter で改行）', { 0: this.targetLabel(this.prefs.target) });
    this.renderTalkBar(); // やり取りの型の間は、上の帯と欄の案内を替える（V5）
    this.chat.hidden = !this.prefs.open;
    this.cost.textContent = c.practice ? tr('練習モード') : tr('約 ${0}', { 0: c.totalCost.toFixed(3) });
    this.keyState.textContent = c.hasKey ? tr('保存済み（暗号化してこのパソコンに保存）') : tr('まだ保存されていません');
    this.sendButton.textContent = c.busy ? tr('止める') : tr('送る');
    this.historyButton.setAttribute('aria-pressed', String(this.view === 'history' || this.view === 'letters'));
    if (this.view === 'letters' && !this.lettersShown && this.letters.ready) {
      // レターのタブが無くなった（最後のレターを消した）：過去の会話の一覧へ（一覧を読み直す）
      this.view = 'history';
      void loadIndex().then((items) => {
        this.historyItems = items;
        this.requestRender();
      });
    }
    this.dailyState.textContent = tr('今日は {0} 回、自分から話しました', { 0: loadDailyCount() });
    // 進化の枠の残り（月の満ち欠け）と、さらに考えるボタン
    const evolve = this.evolveSettings();
    const remaining = evolveRemaining(evolve);
    const phase = moonSvg(remaining / evolve.dailyLimit);
    const reserved = evolve.reserve && remaining > 0 ? tr('（うち1回はフェイブルの合図用）') : '';
    this.evolveState.innerHTML = `${phase} `; // 形だけの SVG
    this.evolveState.append(document.createTextNode(tr('今日の残り {0}/{1} 回{2}', { 0: remaining, 1: evolve.dailyLimit, 2: reserved })));
    this.deepButton.hidden = !members.includes('fable') || evolve.mode === 'never';
    // 「先生に聞く」：ハイク組に話しかけるとき（組へ・組のひとりへ・みんなへ）だけ出す
    const consult = this.consultSettings();
    const target = this.prefs.target;
    const toTeam = teamOf(members).length > 0 && (target === 'team' || target === 'all' || isHaiku(target));
    for (const id of ADVISOR_IDS) {
      const b = this.askButtons[id];
      const advisor = ADVISORS[id];
      const left = consultRemaining(consult, id);
      b.hidden = !toTeam || modeOf(consult, id) === 'never';
      b.disabled = c.busy || left === 0;
      const mark = el('span', '', advisor.mark);
      mark.setAttribute('aria-hidden', 'true');
      b.replaceChildren(mark, ` ${id === 'opus' ? 'Claude' : tr('フェイブル')} `, el('span', 'ai-advice-left', String(left)));
      b.title = tr('{0}が答える前に、{1}（{2}）に相談します。入力した文（空なら、ここまでの話）について。押すと許可したことになり、今日の{3}の枠を1回使います（残り {4}/{5} 回・0時に戻ります）{6}', { 0: HAIKU_UNIT_NAME, 1: advisor.name, 2: advisor.label, 3: advisor.quotaName, 4: left, 5: limitOf(consult, id), 6: id === 'fable' ? '。フェイブル先生に渡す相談の手紙は、Anthropic 側に30日保存されます' : '' });
    }
    this.adviceRow.hidden = ADVISOR_IDS.every((id) => this.askButtons[id].hidden);
    const stats = loadConsultStats();
    this.consultState.textContent = tr('今日の残り：{0} {1} {2}/{3}・{4} {5} {6}/{7}（0時に戻ります）。これまでの相談 {8} 回・役に立った {9}・外れた {10}・約 ${11}', { 0: ADVISORS.opus.mark, 1: ADVISORS.opus.quotaName, 2: consultRemaining(consult, 'opus'), 3: consult.opusLimit, 4: ADVISORS.fable.mark, 5: ADVISORS.fable.quotaName, 6: consultRemaining(consult, 'fable'), 7: consult.fableLimit, 8: stats.consults, 9: stats.good, 10: stats.bad, 11: stats.cost.toFixed(2) });
    this.deepButton.disabled = c.busy || !canEvolve(evolve, 'button');
    this.deepButton.innerHTML = tr('{0}<span>さらに考える</span>', { 0: phase }); // 形だけの SVG と、決まった文字
    const why = remaining === 0 ? tr('今日の進化の枠を使い切りました（0時に戻ります）') : !canEvolve(evolve, 'button') ? tr('残りの1回は、フェイブルの合図用に取ってあります') : '';
    this.deepButton.title = tr('{0}が一時的に進化して（考える深さ max）、入力した文（空なら、ここまでの話）を深く考えて答えます。確認なしで、今日の進化の枠を1回使います。今日の残り {1}/{2} 回（0時に戻ります）。{3}{4}', { 0: c.nameOf('fable'), 1: remaining, 2: evolve.dailyLimit, 3: reserved, 4: why ? `\n${why}` : '' });
    this.deepButton.setAttribute('aria-label', `さらに考える（${c.nameOf('fable')}が進化して答える。今日の残り ${remaining} 回）`);
    this.renderBubble();

    if (this.view === 'history' || this.view === 'letters') {
      // 中身が変わったときだけ描き直す（返事が流れている間も、押した・選んだ・キーボードの位置が消えないように）
      const key = this.listKey();
      if (key === this.logKey) return;
      this.logKey = key;
      const focused = document.activeElement instanceof HTMLElement && this.log.contains(document.activeElement) ? document.activeElement.dataset.key : undefined;
      const top = this.log.scrollTop;
      this.log.replaceChildren(this.renderLogTabs(), this.view === 'history' ? this.renderHistory() : this.renderLetters());
      if (this.view === 'letters') this.log.scrollTop = top;
      if (focused) this.log.querySelector<HTMLElement>(`[data-key="${focused}"]`)?.focus({ preventScroll: true });
      return;
    }
    this.logKey = '';
    const nearBottom = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 40;
    // カードを書いている途中なら、描き直したあとも同じ欄に戻る
    const active = document.activeElement;
    const field = active instanceof HTMLElement && this.log.contains(active) ? active.dataset.field : undefined;
    const keyed = active instanceof HTMLElement && this.log.contains(active) ? active.dataset.key : undefined; // 助言カード・相談の許可のボタン
    // 開いている相談の手紙の、読んでいた位置（描き直すと、いちばん上に戻ってしまうので）
    const letterTops = new Map([...this.log.querySelectorAll<HTMLElement>('.ai-advice-letter')].map((pre) => [pre.dataset.key ?? '', pre.scrollTop]));
    this.log.replaceChildren(
      ...(c.entries.length > 0 ? c.entries.map((entry) => this.renderEntry(entry)) : [this.renderWelcome()]),
    );
    for (const pre of this.log.querySelectorAll<HTMLElement>('.ai-advice-letter')) {
      const top = letterTops.get(pre.dataset.key ?? '');
      if (top) pre.scrollTop = top;
    }
    if (field) this.log.querySelector<HTMLElement>(`.ai-card-form [data-field="${field}"]`)?.focus();
    else if (keyed) {
      // 許可の欄に答えてボタンが消えたら、同じ返事の助言カードへ
      const entryId = keyed.startsWith('consult:') ? keyed.split(':')[1] : '';
      const target = this.log.querySelector<HTMLElement>(`[data-key="${keyed}"]`) ?? (entryId ? this.log.querySelector<HTMLElement>(`[data-key^="advice:${entryId}:"]`) : null);
      target?.focus({ preventScroll: true });
    }
    if (nearBottom) this.log.scrollTop = this.log.scrollHeight;
  }

  // 履歴・レターの一覧の中身（描き直すかどうかを決める）
  private listKey(): string {
    const letters = this.letters.list().map((l) => `${l.id}:${l.studied ?? 0}:${l.publishable ? 1 : 0}`).join(',');
    const history = this.historyItems.map((i) => `${i.id}:${i.updatedAt}`).join(',');
    const study = this.study ? `${this.study.letterId}:${this.study.making}:${this.study.cards.length}` : '';
    return [this.view, this.letters.ready, this.lettersShown, letters, history, this.companion.id, [...this.openLetters].join(','), [...this.openChats].join(','), this.armedLetter ?? '', study, this.letterNote ? `${this.letterNote.id}:${this.letterNote.text}` : '', this.companion.nameOf('fable')].join('|');
  }

  // ハイク組の顔を、小さな蜂の巣に並べる（3体は一列、4体は2・2、5体は2・3、6体は3・3。ほかのメンバーもいれば、少し小さく）
  private layoutTeam(team: readonly CharacterId[], slots: number) {
    this.teamBox.hidden = team.length === 0;
    if (team.length === 0) return;
    const n = team.length;
    const rows = n <= 3 ? [n] : n === 4 ? [2, 2] : n === 5 ? [2, 3] : [3, 3];
    // 顔の大きさ（幅・高さ）。ほかのメンバーが多いほど小さく（右サイドバーの幅 320 に、名前と状態の欄も残す）
    const sizes: Record<number, [number, number]> =
      slots >= 3
        ? { 3: [30, 34], 4: [28, 32], 5: [26, 29], 6: [24, 27] }
        : slots === 2
          ? { 3: [40, 45], 4: [32, 36], 5: [30, 34], 6: [28, 32] }
          : { 3: [54, 61], 4: [42, 47], 5: [38, 43], 6: [36, 40] };
    const [w, h] = sizes[n] ?? sizes[3];
    const gap = n === 3 && slots === 1 ? 6 : 3;
    const step = w + gap;
    const vstep = h * 0.75 + gap;
    const widest = Math.max(...rows);
    const even = rows.length > 1 && rows[0] === rows[1];
    const width = widest * step - gap + (even ? step / 2 : 0);
    let i = 0;
    rows.forEach((count, r) => {
      const offset = count < widest ? ((widest - count) * step) / 2 : even && r === 1 ? step / 2 : 0;
      for (let k = 0; k < count; k++) {
        const cell = this.cells[team[i++]];
        cell.style.left = `${offset + k * step}px`;
        cell.style.top = `${r * vstep}px`;
        cell.style.width = `${w}px`;
        cell.style.height = `${h}px`;
      }
    });
    this.teamBox.style.width = `${width}px`;
    this.teamBox.style.height = `${(rows.length - 1) * vstep + h}px`;
    // 4体からモミジが代表のときは、モミジの顔に印（金色の枠）。読み上げと、顔の上の説明にも「代表」
    const lead = n > 3 && this.prefs.haiku.speak === 'lead';
    this.cells.momiji.dataset.lead = String(lead);
    if (lead) {
      this.cells.momiji.title = this.cells.momiji.title.replace(/）$/, `・${HAIKU_UNIT_NAME}の代表）`);
      this.cells.momiji.setAttribute('aria-label', `${this.cells.momiji.getAttribute('aria-label') ?? ''}（${HAIKU_UNIT_NAME}の代表）`);
    }
  }

  private targetLabel(target: Target): string {
    if (target === 'team') return HAIKU_UNIT_NAME;
    if (target === 'all') return this.prefs.members.length === 2 ? tr('二人') : tr('みんな');
    return isCharacterId(target) ? this.companion.nameOf(target) : 'Claude';
  }

  // そのキャラが、進化の許可を待っているか
  private evolvePending(id: CharacterId): boolean {
    const c = this.companion;
    return c.state === 'confirm' && c.entries.some((e) => e.speaker === id && e.streaming && e.evolve && !e.evolve.answer);
  }

  private renderBubble() {
    if (!this.prefs.open && this.companion.state === 'confirm') {
      // 確認を待っている：会話を閉じていても気づけるように
      this.bubble.hidden = false;
      this.bubbleText.textContent = this.evolvePending('fable')
        ? tr('🌕 {0}が進化の許可を待っています（押すと開きます）', { 0: this.companion.nameOf('fable') })
        : tr('確認したいことがあります（押すと開きます）');
      this.bubbleActions.replaceChildren(); // 別の文を出すので、リマインダーのボタンは出さない
      this.bubbleActions.hidden = true;
      return;
    }
    const entry = this.bubbleId === null ? undefined : this.companion.entries.find((e) => e.id === this.bubbleId);
    const show = !this.prefs.open && !!entry && !entry.error;
    this.bubble.hidden = !show;
    if (!show || !entry) {
      this.bubbleActions.replaceChildren();
      this.bubbleActions.hidden = true;
      return;
    }
    const text = entry.text || '…';
    this.bubbleText.textContent = text.length > 160 ? `${text.slice(0, 160)}…` : text;
    // リマインダーの吹き出しだけ、ボタンを並べる（AI は呼ばない。押したら吹き出しを閉じる）
    const actions = this.bubbleReminder?.entryId === entry.id && this.host.reminderActions ? this.host.reminderActions(this.bubbleReminder.reminder) : [];
    this.bubbleActions.replaceChildren(
      ...actions.map((action) => {
        const button = el('button', 'ai-small', action.label);
        button.type = 'button';
        button.title = action.title;
        button.addEventListener('click', (e) => {
          e.stopPropagation(); // 吹き出しを押すと会話が開くので、ここで止める
          action.run();
          this.bubbleId = null;
          this.bubbleReminder = null;
          this.render();
        });
        return button;
      }),
    );
    this.bubbleActions.hidden = actions.length === 0;
  }

  private renderWelcome() {
    const text = this.companion.state === 'noKey' && !this.companion.practice
      ? tr('上の ⚙ から API キーを入れると、ページの要約や質問ができます。')
      : tr('こんにちは。下の6つのボタンでページの要約・選んだ言葉の解説・クイズなどができます（✎ で自分の頼みごとに変えられ、Alt+1〜6 でも押せます）。気になることを話しかけてもらっても大丈夫です。ページを最後まで読んだときには、こちらからもひとこと声をかけます（⚙ で変えられます）。「作業用の音楽をかけて」「30分後に休憩をリマインドして」「猫の記事のタブはどれ？」のように、ブラウザの操作も頼めます。上の名前（▾）を押すと、賢者のフェイブル・ソネット三人組・ハイク組を会話に呼べます（Claude も入れて3枠まで。ハイク組は3〜6体で1枠）。');
    const members = this.prefs.members;
    if (members.length > 1 || members[0] !== 'main') {
      const team = teamOf(members);
      const teamNames = team.length > 0 ? [`${HAIKU_UNIT_NAME}（${team.map((id) => nameOf(this.prefs, id)).join(tr('・'))}）`] : [];
      const names = [...members.filter((id) => !isHaiku(id)).map((id) => nameOf(this.prefs, id)), ...teamNames].join(tr('・'));
      const how =
        team.length === 0
          ? tr('入力欄の上で、話しかける相手（ひとり・みんな）を選べます。')
          : isHaikuOnly(members)
            ? tr('入力欄の上の「{0}へ」で組に、顔を押すと組のひとりに話しかけられます。', { 0: HAIKU_UNIT_NAME })
            : tr('入力欄の上で、話しかける相手（ひとり・{0}・みんな）を選べます。{1}のひとりへは、顔を押します。', { 0: HAIKU_UNIT_NAME, 1: HAIKU_UNIT_NAME });
      return el('div', 'ai-notice', tr('いまのメンバー：{0}。{1}\n\n{2}', { 0: names, 1: how, 2: text }));
    }
    return el('div', 'ai-notice', text);
  }

  private renderHistory(): HTMLElement {
    const list = el('div', 'ai-history');
    list.append(el('div', 'ai-history-title', tr('過去の会話（押すと開いて、続きから話せます）')));
    if (this.historyItems.length === 0) list.append(el('div', 'ai-notice', tr('まだ保存された会話はありません')));
    for (const item of this.historyItems) {
      const row = el('div', 'ai-history-item');
      if (item.id === this.companion.id) row.classList.add('current');
      const main = el('button', 'ai-history-open');
      main.append(
        el('span', 'ai-history-name', item.title),
        el('span', 'ai-history-meta', tr('{0}・{1}往復{2}', { 0: dateTimeOf(item.updatedAt), 1: item.turns, 2: item.totalCost > 0 ? `・約 $${item.totalCost.toFixed(3)}` : '' })),
      );
      main.addEventListener('click', () => void this.openConversation(item.id));
      const remove = el('button', 'ai-history-remove', '×');
      remove.title = tr('この会話を削除');
      remove.setAttribute('aria-label', 'この会話を削除');
      remove.addEventListener('click', () => void this.removeConversation(item));
      row.append(main, remove);
      list.append(row);
    }
    return list;
  }

  // ハイク組の、先生への相談の許可（相談する／この会話ではいつも／やめる）。答えたあとは、どうしたかを1行で
  private renderConsult(entry: ChatEntry): HTMLElement {
    const consult = entry.consult;
    const box = el('div', `ai-consult ${consult?.advisor ?? ''}`);
    if (!consult) return box;
    const advisor = ADVISORS[consult.advisor];
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', '先生への相談の許可');
    box.append(el('div', 'ai-consult-q', tr('{0} {1}が{2}（{3}）に相談しようとしています', { 0: advisor.mark, 1: entry.speakerName ?? 'ハイク組', 2: advisor.name, 3: advisor.label })));
    box.append(el('div', 'ai-consult-line', tr('問い：{0}', { 0: consult.question })));
    if (consult.why) box.append(el('div', 'ai-consult-line', tr('理由：{0}', { 0: consult.why })));
    if (consult.sends) box.append(el('div', 'ai-consult-sub', consult.sends));
    box.append(el('div', 'ai-consult-sub', consult.estimate));
    if (!consult.answer && entry.streaming) {
      const settings = this.consultSettings();
      box.append(el('div', 'ai-consult-sub', tr('今日の{0}の残り {1}/{2} 回', { 0: advisor.quotaName, 1: consultRemaining(settings, consult.advisor), 2: limitOf(settings, consult.advisor) })));
      const row = el('div', 'ai-row');
      const yes = el('button', 'ai-small ai-consult-yes', tr('相談する'));
      yes.dataset.key = `consult:${entry.id}:yes`;
      yes.addEventListener('click', () => this.companion.answerConsult(entry.id, 'yes'));
      const always = el('button', 'ai-small', tr('この会話ではいつも'));
      always.dataset.key = `consult:${entry.id}:always`;
      always.addEventListener('click', () => this.companion.answerConsult(entry.id, 'always'));
      const no = el('button', 'ai-small', tr('やめる'));
      no.dataset.key = `consult:${entry.id}:no`;
      no.addEventListener('click', () => this.companion.answerConsult(entry.id, 'no'));
      row.append(yes, always, no);
      box.append(row, el('div', 'ai-consult-sub', tr('{0}秒たっても答えがなければ、相談せずに続けます', { 0: CONSULT_TIMEOUT_MS / 1000 })));
      return box;
    }
    const answers: Record<string, string> = {
      yes: tr('→ 許可しました'),
      always: tr('→ この会話では、いつも許可します'),
      no: tr('→ 見送りました'),
      timeout: tr('→ 答えがなかったので、相談せずに続けました'),
    };
    box.append(el('div', 'ai-confirm-answer', consult.answer ? (answers[consult.answer] ?? '') : tr('（確認の途中で終わりました）')));
    return box;
  }

  // 助言カード：先生の助言の全文・相談の手紙・［役に立った］［外れた］
  private renderAdvice(entry: ChatEntry): HTMLElement {
    const a = entry.advice;
    const box = el('div', `ai-advice ${a?.advisor ?? ''}`);
    if (!a) return box;
    const advisor = ADVISORS[a.advisor];
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', `${advisor.name}の助言`);
    const who = entry.speakerName ?? tr('ハイク組');
    const how = a.by === 'user' ? tr('「先生に聞く」で、{0}が答える前に', { 0: who }) : tr('{0}の相談で', { 0: who });
    box.append(el('div', 'ai-advice-head', tr('{0} {1}の助言（{2}）', { 0: advisor.mark, 1: advisor.name, 2: how })));
    box.append(el('div', 'ai-advice-q', tr('問い：{0}', { 0: a.question })));
    const asking = a.state === 'asking' && entry.streaming;
    if (a.text || asking) box.append(el('div', `ai-advice-body${asking ? ' streaming' : ''}`, a.text || tr('{0}が考えています…', { 0: advisor.name })));
    if (a.state === 'failed') box.append(el('div', 'ai-advice-note', a.note ?? tr('相談できませんでした')));
    else if (a.note) box.append(el('div', 'ai-advice-q', a.note)); // 途中で切れた、など
    if (a.state === 'asking' && !entry.streaming) box.append(el('div', 'ai-advice-note', tr('（相談の途中で終わりました）')));
    const row = el('div', 'ai-row');
    if (a.letter) {
      const open = this.openAdviceLetters.has(entry.id);
      const letter = el('button', 'ai-small', open ? tr('相談の手紙を閉じる') : tr('相談の手紙を見る'));
      letter.dataset.key = `advice:${entry.id}:letter`;
      letter.setAttribute('aria-expanded', String(open));
      letter.addEventListener('click', () => {
        if (this.openAdviceLetters.has(entry.id)) this.openAdviceLetters.delete(entry.id);
        else this.openAdviceLetters.add(entry.id);
        this.render();
      });
      row.append(letter);
    }
    if (a.state === 'done' && !entry.streaming) {
      // 役に立ったかどうかは、ハイクの答えまで見てから
      for (const [value, label] of [
        ['good', tr('役に立った')],
        ['bad', tr('外れた')],
      ] as const) {
        const b = el('button', `ai-small ai-advice-${value}`, label);
        b.dataset.key = `advice:${entry.id}:${value}`;
        b.setAttribute('aria-pressed', String(a.feedback === value));
        b.addEventListener('click', () => this.companion.setAdviceFeedback(entry.id, value));
        row.append(b);
      }
    }
    if (row.childElementCount > 0) box.append(row);
    if (a.letter && this.openAdviceLetters.has(entry.id)) {
      const pre = el('pre', 'ai-advice-letter', a.letter);
      pre.dataset.key = `advice:${entry.id}:letter-text`; // 描き直したあとも、読んでいた位置とキーボードの位置を戻す
      pre.tabIndex = 0;
      pre.setAttribute('aria-label', '相談の手紙');
      box.append(pre);
    }
    const cost = a.cost && a.cost > 0 ? tr('・約 ${0}', { 0: a.cost.toFixed(3) }) : '';
    box.append(el('div', 'ai-advice-foot', `${answeredBy(a.advisor, a.model)}${cost}`));
    return box;
  }

  // フェイブルの進化の許可（許可する／この会話ではいつも／やめる）。答えたあとは、どうしたかを1行で
  private renderEvolve(entry: ChatEntry): HTMLElement {
    const evolve = entry.evolve;
    const box = el('div', 'ai-evolve');
    if (!evolve) return box;
    const name = entry.speakerName ?? tr('フェイブル');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', '進化の許可');
    box.append(el('div', 'ai-evolve-q', tr('🌕 {0}が一時的に進化して、考察を深めようとしています。許可しますか？', { 0: name })));
    if (evolve.reason) box.append(el('div', 'ai-evolve-reason', `「${evolve.reason}」`));
    box.append(el('div', 'ai-evolve-sub', evolve.estimate));
    if (!evolve.answer && entry.streaming) {
      const settings = this.evolveSettings();
      const left = el('div', 'ai-evolve-sub ai-evolve-left');
      left.innerHTML = moonSvg(evolveRemaining(settings) / settings.dailyLimit); // 形だけの SVG
      left.append(document.createTextNode(tr(' 今日の進化の残り {0}/{1} 回', { 0: evolveRemaining(settings), 1: settings.dailyLimit })));
      box.append(left);
    }
    if (!evolve.answer && entry.streaming) {
      const row = el('div', 'ai-row');
      const yes = el('button', 'ai-small ai-evolve-yes', tr('許可する'));
      yes.addEventListener('click', () => this.companion.answerEvolve(entry.id, 'yes'));
      const always = el('button', 'ai-small', tr('この会話ではいつも'));
      always.addEventListener('click', () => this.companion.answerEvolve(entry.id, 'always'));
      const no = el('button', 'ai-small', tr('やめる'));
      no.addEventListener('click', () => this.companion.answerEvolve(entry.id, 'no'));
      row.append(yes, always, no);
      box.append(row, el('div', 'ai-evolve-note', tr('{0}秒たっても答えがなければ、進化せずにそのまま続けます', { 0: EVOLVE_TIMEOUT_MS / 1000 })));
      return box;
    }
    const answers: Record<string, string> = {
      yes: tr('→ 許可しました'),
      always: tr('→ この会話では、いつも許可します'),
      no: tr('→ 見送りました'),
      timeout: tr('→ 答えがなかったので、進化せずに続けました'),
    };
    box.append(el('div', 'ai-confirm-answer', evolve.answer ? (answers[evolve.answer] ?? '') : tr('（確認の途中で終わりました）')));
    return box;
  }

  // フェイブルレターの提案（レターにする／やめておく）。答えたあとは、どうしたかを1行で
  private renderLetterProposal(entry: ChatEntry): HTMLElement {
    const box = el('div', 'ai-letter');
    const letter = entry.letter;
    if (!letter) return box;
    const name = entry.speakerName ?? tr('フェイブル');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', `${name}からのレターの提案`);
    box.append(el('div', 'ai-letter-head', tr('✉ {0}からのレターの提案', { 0: name })), el('div', 'ai-letter-title', letter.title));
    if (letter.points?.length) box.append(pointsList(letter.points));
    box.append(el('div', 'ai-letter-body', letter.body));
    if (letter.mark) box.append(el('div', 'ai-letter-meta', letter.mark));
    if (letter.state === 'proposed' && entry.streaming) {
      box.append(el('div', 'ai-confirm-answer', tr('返事が終わったら、残すかどうか選べます')));
      return box;
    }
    if (letter.state === 'proposed') {
      const row = el('div', 'ai-row');
      const keep = el('button', 'ai-small ai-yes', tr('レターにする'));
      keep.title = tr('「履歴」の「✉ フェイブルレター」に残す（あとで盤面に置く・コピー・教材にするができます）');
      keep.addEventListener('click', () => this.keepLetter(entry));
      const no = el('button', 'ai-small', tr('やめておく'));
      no.addEventListener('click', () => this.companion.setLetterState(entry.id, 'dismissed'));
      row.append(keep, no);
      box.append(row);
      return box;
    }
    if (letter.state === 'dismissed') {
      box.append(el('div', 'ai-confirm-answer', tr('→ レターにしませんでした')));
      return box;
    }
    const kept = this.letters.get(letter.letterId);
    box.append(el('div', 'ai-confirm-answer', kept || !this.letters.ready ? tr('→ レターにしました') : tr('→ レターにしました（一覧からは消してあります）')));
    if (kept) {
      const open = el('button', 'ai-small', tr('✉ 一覧で見る'));
      open.addEventListener('click', () => this.showLetters(kept.id));
      box.append(open);
    }
    return box;
  }

  // 残したレターの一覧（新しい順）
  private renderLetters(): HTMLElement {
    const list = el('div', 'ai-letters');
    const letters = this.letters.list();
    list.append(el('div', 'ai-history-title', tr('残したレター {0}通（新しい順。盤面に置く・コピー・教材にするができます）', { 0: letters.length })));
    if (!this.letters.ready) {
      list.append(el('div', 'ai-notice', tr('読み込んでいます…')));
      return list;
    }
    if (letters.length === 0) {
      list.append(
        el(
          'div',
          'ai-notice',
          tr('まだレターはありません。{0}が一時的に進化して深く考えたとき、あとで読み返す価値のある考察があれば、題名と短い手紙にして提案します（残すかどうかは、あなたが決めます）。', { 0: this.companion.nameOf('fable') }),
        ),
      );
    }
    for (const letter of letters) list.append(this.renderLetter(letter));
    return list;
  }

  private renderLetter(letter: Letter): HTMLElement {
    const item = el('article', 'ai-letter ai-letter-item');
    item.dataset.letter = letter.id;
    item.append(el('div', 'ai-letter-title', letter.title));
    item.append(el('div', 'ai-letter-meta', tr('{0}・{1}{2}', { 0: letter.by.name, 1: dateTimeOf(letter.createdAt), 2: letter.pageTitle ? `・${letter.pageTitle}` : '' })));
    if (letter.question) item.append(el('div', 'ai-letter-meta', `Q. ${letter.question}`));
    if (letter.points?.length) item.append(pointsList(letter.points));
    const body = el('div', 'ai-letter-body', letter.body);
    item.append(body);
    if ([...letter.body].length > 120 || letter.body.split('\n').length > 4) {
      const open = this.openLetters.has(letter.id);
      body.classList.add('clamp');
      body.classList.toggle('open', open);
      const toggle = el('button', 'preview-note-toggle', open ? tr('たたむ ▴') : tr('続きを読む ▾'));
      toggle.dataset.key = `${letter.id}:toggle`;
      toggle.setAttribute('aria-expanded', String(open));
      toggle.addEventListener('click', () => {
        if (this.openLetters.has(letter.id)) this.openLetters.delete(letter.id);
        else this.openLetters.add(letter.id);
        this.render();
      });
      item.append(toggle);
    }
    // 3段目：元の会話（前に残したレターは、会話を開いて見る）
    if (letter.chat) {
      const open = this.openChats.has(letter.id);
      const toggle = el('button', 'preview-note-toggle', open ? tr('会話をたたむ ▴') : tr('元の会話を見る ▾'));
      toggle.dataset.key = `${letter.id}:chat`;
      toggle.setAttribute('aria-expanded', String(open));
      toggle.addEventListener('click', () => {
        if (this.openChats.has(letter.id)) this.openChats.delete(letter.id);
        else this.openChats.add(letter.id);
        this.render();
      });
      item.append(toggle);
      if (open) {
        const chat = el('div', 'ai-letter-chat');
        if (letter.chat.question) chat.append(el('div', 'ai-letter-chat-q', tr('使う人：{0}', { 0: letter.chat.question })));
        chat.append(el('div', 'ai-letter-chat-a', `${letter.by.name}：${letter.chat.reply}`));
        item.append(chat);
      }
    } else if (letter.conversationId) {
      const id = letter.conversationId;
      const open = el('button', 'preview-note-toggle', tr('元の会話を開く'));
      open.dataset.key = `${letter.id}:conversation`;
      open.title = tr('このレターが生まれた会話を開く');
      open.addEventListener('click', () => void this.openConversation(id));
      item.append(open);
    }
    const actions = el('div', 'ai-msg-actions');
    // 公開してよい（月の窓に映す）。使う人だけが付ける
    const publish = el('button', `ai-small ai-letter-publish${letter.publishable ? ' on' : ''}`, letter.publishable ? tr('🌙 月の窓に出しています') : tr('🌙 月の窓に出す'));
    publish.title = letter.publishable ? tr('押すと、月の窓に出すのをやめます') : tr('「公開してよい」の印を付けて、右サイドバーの上の「月の窓」に映します（このブラウザの中だけ）');
    publish.setAttribute('aria-pressed', String(!!letter.publishable));
    publish.dataset.key = `${letter.id}:publish`;
    publish.addEventListener('click', () => this.letters.setPublishable(letter.id, !letter.publishable));
    actions.append(publish);
    const place = el('button', 'ai-small', tr('盤面に置く'));
    place.title = tr('盤面の、表示中のタブの近くに、メモのセルとして置く（「レター」の印つき）');
    place.addEventListener('click', () => this.host.placeMemoCell(letterText(letter), letter.by, 'レター'));
    const copy = el('button', 'ai-small', tr('コピー'));
    copy.title = tr('メモのセル1つとしてコピーする（盤面の空いたセルで Ctrl+V すると、メモのセルになります）');
    copy.addEventListener('click', () => this.host.copyMemoCell(letterText(letter), letter.by, 'レター'));
    const making = this.study?.letterId === letter.id && this.study.making;
    const study = el('button', 'ai-small', making ? tr('作っています…') : this.study?.letterId === letter.id ? tr('案を閉じる') : tr('教材にする'));
    study.title = tr('手紙から、単語帳のカード（言葉・問い）の案を作る。入れるカードは選べます（AI を使います。練習モードでは決まった案）');
    study.disabled = !!this.study?.making;
    study.addEventListener('click', () => void this.studyLetter(letter));
    const armed = this.armedLetter === letter.id;
    const remove = el('button', `ai-small ai-letter-remove${armed ? ' danger' : ''}`, armed ? tr('もう一度押すと消えます') : tr('消す'));
    remove.setAttribute('aria-label', armed ? tr('「{0}」を消す（もう一度押すと消えます）', { 0: letter.title }) : tr('「{0}」を消す', { 0: letter.title }));
    remove.addEventListener('click', () => this.removeLetter(letter));
    if (armed) armConfirm(remove, () => {
      window.clearTimeout(this.armTimer);
      this.armedLetter = null;
      this.render();
    });
    place.dataset.key = `${letter.id}:place`;
    copy.dataset.key = `${letter.id}:copy`;
    study.dataset.key = `${letter.id}:study`;
    remove.dataset.key = `${letter.id}:remove`;
    actions.append(place, copy, study, remove);
    item.append(actions);
    if (letter.studied) item.append(el('div', 'ai-letter-meta', tr('単語帳に入れたカード：{0} 枚', { 0: letter.studied })));
    if (this.study?.letterId === letter.id && !this.study.making) item.append(this.studyView(letter, this.study.cards));
    if (this.letterNote?.id === letter.id) item.append(el('div', 'ai-msg-note', this.letterNote.text));
    return item;
  }

  // レターから作ったカードの案（入れるものに印）
  private studyView(letter: Letter, cards: (CardDraft & { checked: boolean })[]): HTMLElement {
    const box = el('div', 'vocab-proposals');
    for (const card of cards) {
      const row = el('label', 'vocab-proposal');
      const check = el('input');
      check.type = 'checkbox';
      check.checked = card.checked;
      check.addEventListener('change', () => (card.checked = check.checked));
      const text = el('span', 'vocab-proposal-text');
      text.append(el('strong', '', `${card.kind === 'quiz' ? 'Q. ' : ''}${card.front}`), el('span', '', card.back));
      row.append(check, text);
      box.append(row);
    }
    const ok = el('button', 'ai-small', tr('印を付けたものを単語帳に入れる'));
    ok.addEventListener('click', () => {
      const picked = cards.filter((c) => c.checked).map(({ checked: _, ...card }) => card);
      this.study = null;
      let fresh = 0;
      if (picked.length > 0) {
        this.host.addCards(picked);
        fresh = this.letters.markStudied(letter.id, picked.map((c) => c.front));
      }
      this.letterNote = {
        id: letter.id,
        text: picked.length === 0 ? tr('入れるカードがありませんでした') : fresh > 0 ? tr('単語帳に {0} 枚入れました（同じカードがすでにあれば、入りません）', { 0: fresh }) : tr('このレターから、もう入れてあるカードでした'),
      };
      this.render();
    });
    const cancel = el('button', 'ai-small', tr('やめる'));
    cancel.addEventListener('click', () => {
      this.study = null;
      this.letterNote = null;
      this.render();
    });
    const row = el('div', 'ai-row');
    row.append(ok, cancel);
    box.append(row);
    return box;
  }

  // 使う人への確認（タブを閉じる前など）
  private renderConfirm(entry: ChatEntry): HTMLElement {
    const confirm = entry.confirm;
    const box = el('div', 'ai-confirm');
    if (!confirm) return box;
    box.append(el('div', 'ai-confirm-question', confirm.question));
    if (confirm.answer) {
      box.append(el('div', 'ai-confirm-answer', confirm.answer === 'yes' ? tr('→ はい') : tr('→ いいえ')));
    } else if (entry.streaming) {
      const row = el('div', 'ai-row');
      const yes = el('button', 'ai-small ai-yes', tr('はい'));
      yes.addEventListener('click', () => this.companion.answer(entry.id, true));
      const no = el('button', 'ai-small', tr('いいえ'));
      no.addEventListener('click', () => this.companion.answer(entry.id, false));
      row.append(yes, no);
      box.append(row);
    } else {
      box.append(el('div', 'ai-confirm-answer', tr('（確認の途中で終わりました）')));
    }
    return box;
  }

  // 自分の発言の下の道すじ（段階8）。開くと理由と、もう一方への選び直し
  private renderRoute(entry: ChatEntry): HTMLElement {
    const route = entry.route;
    const details = el('details', 'ai-route');
    if (!route) return details;
    details.open = this.openRoutes.has(entry.id);
    details.addEventListener('toggle', () => {
      if (details.open) this.openRoutes.add(entry.id);
      else this.openRoutes.delete(entry.id);
    });
    const summary = el('summary', '', tr('道すじ：{0}', { 0: routeLabel(route.kind) }));
    summary.dataset.key = `route:${entry.id}`;
    details.append(summary);
    const body = el('div', 'ai-route-body');
    body.append(el('div', '', tr('理由：{0}', { 0: route.reason })));
    body.append(el('div', 'ai-route-foot', routeFoot(route)));
    const row = el('div', 'ai-row');
    const button = (kind: RouteKind, label: string) => {
      const b = el('button', 'ai-small', label);
      b.type = 'button';
      b.dataset.key = `route:${entry.id}:${kind}`;
      b.disabled = this.companion.busy || route.kind === kind;
      b.title = route.kind === kind ? tr('いまの道すじです') : tr('道すじを「{0}」に変えて、もう一度聞きます', { 0: label });
      b.addEventListener('click', () => this.companion.reroute(entry.id, kind, this.attach.checked));
      row.append(b);
    };
    button('team', tr('ハイク組だけ'));
    button('consult', tr('＋相談'));
    body.append(row);
    details.append(body);
    return details;
  }

  // 割れた・詰まった・断られたあとのボタン。断られたときは、⚙ で出したときだけ先生に聞く
  private renderPath(entry: ChatEntry): HTMLElement {
    const path = entry.path;
    const box = el('div', 'ai-route-actions');
    if (!path) return box;
    if (path.choice) {
      const done: Record<PathChoice, string> = { redo: tr('言い直す'), other: tr('ほかのハイクに聞く'), advisor: tr('先生に聞く'), keep: tr('このまま') };
      box.append(el('div', 'ai-route-foot', `→ ${done[path.choice]}`));
      return box;
    }
    const row = el('div', 'ai-row');
    const add = (label: string, choice: PathChoice, title: string, enabled = true) => {
      const b = el('button', 'ai-small', label);
      b.type = 'button';
      b.dataset.key = `path:${entry.id}:${choice}`;
      b.disabled = this.companion.busy || !enabled;
      b.title = title;
      b.addEventListener('click', () => this.companion.followPath(entry.id, choice, this.attach.checked));
      row.append(b);
    };
    if (path.kind === 'refusal') {
      add(tr('言い直す'), 'redo', tr('同じハイクに、答えられる範囲で短く言い直してもらいます'));
      const others = teamOf(this.prefs.members).filter((id) => id !== path.speaker);
      if (others.length > 0) add(tr('{0}に聞く', { 0: nameOf(castOf(this.prefs), others[0]) }), 'other', tr('組のほかの体に、同じ頼みを聞きます'));
      if (this.prefs.routeRefusal === 'advisor') {
        const ok = canConsult(this.consultSettings(), 'opus');
        add(tr('先生に聞く'), 'advisor', ok ? tr('Claude 先生に相談してから答えます（きらりを1回使います）') : tr('今日は Claude 先生に聞けません（枠が無いか、相談しない設定です）'), ok);
      }
    } else {
      const ok = canConsult(this.consultSettings(), 'opus');
      add(tr('Claude 先生に確かめてもらう'), 'advisor', ok ? tr('きらりを1回使って、Claude 先生に聞きます') : tr('今日は Claude 先生に聞けません（枠が無いか、相談しない設定です）'), ok);
      add(tr('このまま'), 'keep', tr('相談せずに、この返事のままにします'));
    }
    box.append(row);
    return box;
  }

  // options.export：データ置き場への書き出し用。会話記録に残さない画像（imageTransient）は描かない
  private renderEntry(entry: ChatEntry, options: { export?: boolean } = {}): HTMLElement {
    if (entry.role === 'notice') {
      const line = el('div', 'ai-notice');
      line.append(document.createTextNode(entry.text));
      if (entry.path) line.append(this.renderPath(entry));
      return line;
    }
    if (entry.role === 'user' && entry.auto) {
      // 出来事（自分の発言ではないので、小さな1行で）
      const line = el('div', 'ai-event');
      line.append(el('time', '', timeOf(entry.time)), el('span', 'ai-event-text', entry.text));
      if (entry.pageTitle) line.append(el('span', 'ai-page', entry.pageTitle));
      return line;
    }

    if (entry.role === 'assistant' && entry.passed) {
      return el('div', 'ai-event ai-pass', tr('{0}は、付け足すことはないようです', { 0: entry.speakerName ?? 'Claude' }));
    }
    const box = el('div', `ai-msg ${entry.role}`);
    if (entry.speaker && entry.speaker !== 'main' && isCharacterId(entry.speaker)) box.classList.add(entry.speaker);
    if (entry.awake) box.classList.add('awake');
    if (entry.streaming) box.classList.add('streaming');
    if (entry.error) box.classList.add('error');

    const head = el('div', 'ai-msg-head');
    if (entry.role === 'assistant' && ((entry.speaker && entry.speaker !== 'main') || this.prefs.members.length > 1)) {
      const speaker = entry.speaker && isCharacterId(entry.speaker) ? entry.speaker : 'main';
      head.append(el('span', `ai-speaker ${speaker}${entry.awake ? ' awake' : ''}`, `${entry.speakerName ?? 'Claude'}${entry.awake ? tr('（覚醒）') : ''}`));
    }
    if (entry.role === 'assistant' && entry.action) head.append(el('span', 'ai-tag', ACTION_LABELS[entry.action]));
    if (entry.role === 'user' && entry.to && entry.to !== 'main') {
      head.append(el('span', 'ai-tag', `→ ${entry.to === 'both' ? tr('二人') : this.targetLabel(entry.to)}`));
    }
    head.append(el('time', '', timeOf(entry.time)));
    if (entry.role === 'user' && entry.pageTitle) head.append(el('span', 'ai-page', entry.pageTitle));
    box.append(head);

    // クイズは、答えを「答えを見る」まで隠す
    const mark = entry.action === 'quiz' ? entry.text.lastIndexOf(QUIZ_ANSWER_MARK) : -1;
    if (entry.role === 'assistant' && mark > 0) {
      box.append(el('div', 'ai-msg-body', entry.text.slice(0, mark).trim()));
      if (this.revealed.has(entry.id)) {
        box.append(el('div', 'ai-msg-body ai-answer', entry.text.slice(mark)));
      } else if (!entry.streaming) {
        const reveal = el('button', 'ai-small', tr('答えを見る'));
        reveal.addEventListener('click', () => {
          this.revealed.add(entry.id);
          this.render();
        });
        box.append(reveal);
      }
    } else if (entry.text) {
      box.append(el('div', 'ai-msg-body', entry.text));
    }
    if (entry.role === 'user' && entry.route) box.append(this.renderRoute(entry));
    if (entry.image && !(entry.imageTransient && options.export)) {
      const img = el('img', 'ai-msg-image');
      img.src = entry.image;
      img.alt = tr('見せた画像');
      box.append(img);
      if (entry.imageTransient) box.append(el('div', 'ai-msg-note', tr('この画像は会話記録には残しません')));
    } else if (entry.imageTransient) {
      // 開き直した会話（画像は保存していない）と、書き出し（画像を描かない）
      box.append(el('div', 'ai-msg-note', tr('（撮影の画像を見せました。会話記録には残していません）')));
    }

    if (entry.steps?.length) {
      const steps = el('div', 'ai-steps');
      for (const step of entry.steps) steps.append(el('div', 'ai-step', step));
      box.append(steps);
    }
    if (entry.consult) box.append(this.renderConsult(entry));
    if (entry.advice) box.append(this.renderAdvice(entry));
    if (entry.confirm) box.append(this.renderConfirm(entry));
    if (entry.evolve) box.append(this.renderEvolve(entry));
    if (entry.letter && !entry.error) box.append(this.renderLetterProposal(entry));
    if (entry.sources?.length) {
      // 引用元（Web 検索で見つけたページ）。押すと新しいタブで開く
      const sources = el('div', 'ai-sources');
      sources.append(el('span', 'ai-sources-label', tr('参考')));
      for (const source of entry.sources) {
        const link = el('button', 'ai-source', source.title || source.url);
        link.title = source.url;
        link.addEventListener('click', () => this.host.openUrl(source.url));
        sources.append(link);
      }
      box.append(sources);
    }
    if (entry.note) box.append(el('div', 'ai-msg-note', entry.note));
    if (entry.path) box.append(this.renderPath(entry));

    if (entry.role === 'assistant' && !entry.streaming && entry.text && !entry.error) {
      const actions = el('div', 'ai-msg-actions');
      const keep = el('button', 'ai-small', entry.kept?.tab ? tr('タブに残しました ✓') : tr('タブに残す'));
      keep.title = tr('このページのタブのメモとして残す（拡大表示のカードに出ます）');
      if (!entry.kept?.tab) keep.addEventListener('click', () => this.keepInTab(entry));
      const sendingNow = this.sending.has(entry.id);
      const sentOk = entry.kept?.hexMemo && !entry.kept.hexMemoFailed;
      const hex = el('button', 'ai-small', sendingNow ? tr('送っています…') : sentOk ? tr('六角メモに送りました ✓') : tr('六角メモへ'));
      hex.title = tr('六角メモのノートへ送る（送り先は ⚙ で選ぶ）');
      if (!sendingNow && !sentOk) hex.addEventListener('click', () => void this.sendEntryToHexMemo(entry));
      const vocab = el('button', 'ai-small', entry.kept?.vocab ? tr('単語帳に入れました ✓') : tr('単語帳へ'));
      vocab.title = tr('言葉と意味（問いと答え）のカードにして、単語帳に入れる（入れる前に直せます）');
      if (!entry.kept?.vocab) {
        vocab.addEventListener('click', () => {
          this.cardDraft = this.cardDraft?.entryId === entry.id ? null : cardDraftOf(entry);
          this.render();
          this.log.querySelector<HTMLElement>(`.ai-card-form [data-field="${this.cardDraft?.front ? 'back' : 'front'}"]`)?.focus();
        });
      }
      const vault = el('button', 'ai-small', entry.kept?.vault ? tr('置き場に入れました ✓') : tr('データ置き場へ'));
      vault.title = tr('この返事を、データ置き場（右サイドバーのメモの区画の下）に残す');
      if (!entry.kept?.vault) vault.addEventListener('click', () => void this.replyToVault(entry));
      const copy = el('button', 'ai-small', tr('コピー'));
      copy.addEventListener('click', () => void navigator.clipboard.writeText(entry.text).catch(() => undefined));
      const ask = el('button', 'ai-small', tr('ボットに頼む'));
      ask.title = tr('この返事を、ボットへの依頼の下書きに入れます。小窓が開くだけで、コピーもアプリも動きません。今見ているページは付けません');
      ask.addEventListener('click', () => void this.askBotFrom(entry));
      actions.append(keep, hex, vocab, vault, copy, ask);
      if (entry.talk) actions.prepend(...this.talkButtons(entry, entry.talk)); // やり取りの返事（V5）：▶ 時刻・📌 カードへ
      box.append(actions);
      if (this.cardDraft?.entryId === entry.id) box.append(this.cardForm(entry, this.cardDraft));
      if (entry.kept?.hexMemo) {
        box.append(el('div', entry.kept.hexMemoFailed ? 'ai-msg-note ai-failed' : 'ai-msg-note', entry.kept.hexMemo));
      }
      const usage = usageText(entry);
      if (usage || entry.awake) box.append(el('div', 'ai-msg-foot', `${entry.awake ? tr('🌕 一時的に進化して考えました（max）') : ''}${entry.awake && usage ? tr('・') : ''}${usage}`));
    }
    return box;
  }
}

interface CardFormDraft {
  entryId: number;
  kind: CardKind;
  front: string;
  back: string;
}

// 返事から作るカードの下書き：解説なら「選んだ言葉 → 返事」、クイズなら「問題 → 答え」
function cardDraftOf(entry: ChatEntry): CardFormDraft {
  const clip = (text: string, max: number) => [...text.trim()].slice(0, max).join('');
  const mark = entry.action === 'quiz' ? entry.text.lastIndexOf(QUIZ_ANSWER_MARK) : -1;
  if (mark > 0) {
    return { entryId: entry.id, kind: 'quiz', front: clip(entry.text.slice(0, mark), 400), back: clip(entry.text.slice(mark + QUIZ_ANSWER_MARK.length), 1000) };
  }
  return { entryId: entry.id, kind: 'word', front: clip(entry.term ?? '', 400), back: clip(entry.text, 1000) };
}

// 六角メモへ送るメモ1件
function recordOf(entry: ChatEntry): HexMemoRecord {
  const label = entry.action ? ACTION_LABELS[entry.action] : tr('返信');
  const name = entry.speakerName ?? 'Claude';
  const lines = [tr('{0} の{1}{2}', { 0: name, 1: label, 2: entry.pageTitle ? `：${entry.pageTitle}` : '' })];
  if (entry.action === 'chat' && entry.question) lines.push(`Q. ${entry.question}`);
  lines.push('', entry.text);
  const record: HexMemoRecord = { text: lines.join('\n'), createdAt: new Date(entry.time).toISOString(), tags: [...new Set(['Claude', name, label])] };
  if (entry.pageUrl && /^https?:\/\//i.test(entry.pageUrl)) record.urls = [{ url: entry.pageUrl, title: entry.pageTitle }];
  return record;
}

// 3行の要点（レターの1段目）
function pointsList(points: readonly string[]): HTMLElement {
  const list = el('ul', 'ai-letter-points');
  for (const point of points) list.append(el('li', '', point));
  return list;
}

function usageText(entry: ChatEntry): string {
  if (!entry.usage || entry.model === 'practice') return '';
  const u = entry.usage;
  const input = u.input + u.cacheRead + u.cacheWrite;
  const advice = entry.advice?.cost ? tr('・うち相談 約 ${0}', { 0: entry.advice.cost.toFixed(3) }) : '';
  const cost = entry.cost === undefined ? '' : tr('（約 ${0}{1}）', { 0: entry.cost.toFixed(3), 1: advice });
  return tr('入力 {0}・出力 {1} トークン{2}', { 0: input.toLocaleString(), 1: u.output.toLocaleString(), 2: cost });
}

function timeOf(ms: number) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function dateTimeOf(ms: number) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${timeOf(ms)}`;
}

function modelPrice(model: string): { input: number; output: number } {
  if (model === HAIKU_MODEL.id) return { input: HAIKU_MODEL.input, output: HAIKU_MODEL.output };
  if (model === FABLE_MODEL.id) return { input: FABLE_MODEL.input, output: FABLE_MODEL.output };
  const found = MODELS.find((row) => row.id === model);
  const price = found ?? MODELS[0];
  return { input: price.input, output: price.output };
}

function loadAiPrefs(): AiPrefs {
  const defaults: AiPrefs = {
    model: MODELS[0].id,
    practice: false,
    open: true,
    attachPage: true,
    lastConversation: null,
    hexMemoTarget: null,
    talk: 'quiet',
    dailyLimit: 20,
    useTools: true,
    webSearch: true,
    skipSendPreview: false,
    ...defaultCast(),
    target: 'main',
    evolveMode: DEFAULT_EVOLVE.mode,
    evolveLimit: DEFAULT_EVOLVE.dailyLimit,
    evolveReserve: DEFAULT_EVOLVE.reserve,
    consultOpus: DEFAULT_CONSULT.opus,
    consultFable: DEFAULT_CONSULT.fable,
    consultOpusLimit: DEFAULT_CONSULT.opusLimit,
    consultFableLimit: DEFAULT_CONSULT.fableLimit,
    routeMode: DEFAULT_ROUTE.mode,
    routeStuck: DEFAULT_ROUTE.stuck,
    routeRefusal: DEFAULT_ROUTE.refusal,
  };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    if (typeof saved !== 'object' || saved === null) return defaults;
    const s = saved as Record<string, unknown>;
    const prefs: AiPrefs = {
      model: MODELS.some((m) => m.id === s.model) ? (s.model as ModelId) : defaults.model,
      practice: s.practice === true,
      open: s.open !== false,
      attachPage: s.attachPage !== false,
      lastConversation: typeof s.lastConversation === 'string' ? s.lastConversation : null,
      hexMemoTarget: isHexTarget(s.hexMemoTarget) ? s.hexMemoTarget : null,
      talk: TALK_LEVELS.some(([level]) => level === s.talk) ? (s.talk as TalkLevel) : defaults.talk,
      dailyLimit:
        typeof s.dailyLimit === 'number' && Number.isFinite(s.dailyLimit) ? clamp(Math.round(s.dailyLimit), 1, 200) : defaults.dailyLimit,
      useTools: s.useTools !== false,
      webSearch: s.webSearch !== false,
      skipSendPreview: s.skipSendPreview === true,
      ...parseCast(s),
      target: s.target === 'all' || s.target === 'both' ? 'all' : s.target === 'team' ? 'team' : isCharacterId(s.target) ? s.target : ('main' as Target),
      evolveMode: parseEvolve(s).mode,
      evolveLimit: parseEvolve(s).dailyLimit,
      evolveReserve: parseEvolve(s).reserve,
      consultOpus: parseConsult(s).opus,
      consultFable: parseConsult(s).fable,
      consultOpusLimit: parseConsult(s).opusLimit,
      consultFableLimit: parseConsult(s).fableLimit,
      routeMode: parseRoute(s).mode,
      routeStuck: parseRoute(s).stuck,
      routeRefusal: parseRoute(s).refusal,
    };
    fixTarget(prefs);
    return prefs;
  } catch {
    return defaults;
  }
}

// 宛先は、メンバーのだれか（2体以上なら「みんな」も。ハイク組がいれば「ハイク組」も）。違っていたら、頼みごとに答えるキャラにする
function fixTarget(prefs: AiPrefs) {
  const members = prefs.members;
  // ハイク組だけの会話には「みんなへ」が無い（「ハイク組へ」と同じ）
  const ok =
    prefs.target === 'all' ? slotsOf(members) > 1 : prefs.target === 'team' ? teamOf(members).length > 1 : members.includes(prefs.target);
  if (!ok) prefs.target = members.includes('main') ? 'main' : isHaikuOnly(members) ? 'team' : members[0];
}

function castOf(prefs: AiPrefs): Cast {
  return { members: prefs.members, banter: prefs.banter, second: prefs.second, fable: prefs.fable, trio: prefs.trio, haiku: prefs.haiku };
}

// 短いモデル名（Opus 5.5 など）
function modelLabel(id: ModelId | HaikuModelId): string {
  const model = [...MODELS, FABLE_MODEL, HAIKU_MODEL].find((m) => m.id === id);
  return (model?.label ?? id).replace(/^Claude /, '').replace(/（.*）$/, '');
}

function isHexTarget(value: unknown): value is HexMemoTarget {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (v.appId === null || typeof v.appId === 'string') && typeof v.boardId === 'string' && typeof v.label === 'string';
}

// 今日の日付（このパソコンの時計で）
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function loadDailyCount(): number {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(DAILY_KEY) ?? 'null');
    if (typeof saved !== 'object' || saved === null) return 0;
    const s = saved as Record<string, unknown>;
    return s.date === today() && typeof s.count === 'number' ? s.count : 0;
  } catch {
    return 0;
  }
}

function saveDailyCount(count: number) {
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify({ date: today(), count }));
  } catch {
    // 保存できなくても動作は続ける
  }
}

function saveAiPrefs(prefs: AiPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // 保存できなくても動作は続ける
  }
}

// データ置き場：発言1つの文字のデータ（画像そのものは入れない。見せた画像があったかだけ）
function entryData(entry: ChatEntry) {
  return {
    id: entry.id,
    role: entry.role,
    time: new Date(entry.time).toISOString(),
    speaker: entry.role === 'assistant' ? (entry.speakerName ?? 'Claude') : entry.role === 'user' ? (entry.auto ? tr('出来事') : tr('わたし')) : tr('お知らせ'),
    ...(entry.action ? { action: ACTION_LABELS[entry.action] } : {}),
    text: entry.text,
    ...(entry.question ? { question: entry.question } : {}),
    ...(entry.pageTitle ? { pageTitle: entry.pageTitle } : {}),
    ...(entry.pageUrl ? { pageUrl: entry.pageUrl } : {}),
    ...(entry.model ? { model: entry.model } : {}),
    ...(entry.sources?.length ? { sources: entry.sources } : {}),
    ...(entry.steps?.length ? { steps: entry.steps } : {}),
    ...(entry.image || entry.imageTransient ? { image: true } : {}),
    ...(entry.awake ? { awake: true } : {}),
  };
}

// データ置き場：会話を読める形の文字にする（六角メモへ送る・コピーするときもこれ）
function transcriptOf(title: string, members: string[], entries: readonly ChatEntry[]): string {
  const lines = [tr('会話：{0}', { 0: title }), tr('メンバー：{0}', { 0: members.join('・') }), ''];
  for (const e of entries) {
    if (e.role === 'assistant' && e.passed) continue;
    const at = timeOf(e.time);
    if (e.role === 'notice') {
      lines.push(`[${at}] （${e.text}）`);
      continue;
    }
    if (e.role === 'user' && e.auto) {
      lines.push(tr('[{0}] ・{1}{2}', { 0: at, 1: e.text, 2: e.pageTitle ? `（${e.pageTitle}）` : '' }));
      continue;
    }
    const who = e.role === 'user' ? tr('わたし') : `${e.speakerName ?? 'Claude'}${e.action ? `（${ACTION_LABELS[e.action]}）` : ''}`;
    const page = e.role === 'user' && e.pageTitle ? `［${e.pageTitle}］` : '';
    lines.push(`[${at}] ${who}${page}：${e.text}${e.image || e.imageTransient ? tr('\n（画像を見せました）') : ''}`);
    if (e.sources?.length) lines.push(tr('参考：{0}', { 0: e.sources.map((src) => `${src.title || src.url} <${src.url}>`).join(' / ') }));
    lines.push('');
  }
  return lines.join('\n').trim();
}
