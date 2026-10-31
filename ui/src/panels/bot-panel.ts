// 右のボットの欄 ＝ 受け取り箱（第2段 S2.4。docs/ideas-bot-cells.md §9.4・§9.6。置き場所は Q8 の案1：右サイドバーのメモの区画の下、データ置き場のさらに下）
//   ・第3段 S3.8（plan-s3-nest.md の S3.8・見本 request-menu-popup.png の右の上半分）：見出しを「受け取り箱」にし、上に「Grok への依頼 n 件」の一覧
//     （1件ずつ：G の印・#番号・宛て先〔役〕・状態のチップ 送信済み → 調査中 → 回答あり／遅れています／ボットのエラー・時刻・進み具合のバー・途中経過の title）。
//     みんなに聞くの組は1枚の組のカード（席ごとの小さな点。全部そろったら「まとめて読む」で返事を席の順に並べるだけ）。今の中身（ボットごとのやり取り）は下にそのまま
//     頼む文は出さない（巣の設定でオンにしたときだけ、最初の 40 字）
//   ・持ち主は左サイドバー（台帳・pending.json・記録を書くのは左だけ）。ここは左から届く写し（relay の bots・botThread・botOpen・botNotice）を見て、
//     変えたいときは命令（botSelect・botStopWaiting・botMarkRead・botToMemo・botDraft）を返す（memo-pad.ts と同じ形）
//   ・出すボット：右下の Grok Bot で選んだボットか、盤面のボットのセルのカードの「やり取りを見る」で開いたボット
//   ・返事は外から来た文：文字としてだけ出す（textContent。HTML にしない）。リンクは押したときにドメインを見せてから開く。画像は読み込まない
//   ・第3段 S3.9：確かめの済んだ reply と progress の text は、自前の小さな Markdown 表示（bot-markdown.ts。要素を作って文字は textContent。innerHTML は使わない）で整えて出す。
//     灰色（未確認）の返事・エラーの文・メモの候補は今までどおり文字のまま。各返事の「元の文」で、その返事だけ届いたままの文に切り替えられる。
//     コピー・メモにする（botToMemo）・六角メモへ送る文は今までどおり元の文（左が記録から読み直す）
//   ・第3段 S3.10（見本 answer-card-cosmic.png・request-menu-popup.png の「Grok の回答」）：確かめの済んだ reply（check ✓）だけを回答カードにする。
//     Markdown の「## 要約」は太字の1段落、「## 注意」は ⚠ の囲み、出典は links（無ければ「## 出典」の中のリンク）をドメイン名のチップに（押すとドメインを見せてから開く）。
//     見出しが無ければ全体を本文として今までどおり出す。「## Vision」の節は本文から外す（小さな「Vision」札のまま）。「元の文」の切り替えは残す。
//     ボタン：⬡ 六角メモで開く（今の botToMemo hex。送り先は相棒の設定で選んだノートだけ）・タブに残す（命令 botToTab。左が依頼に付けたページのタブか右のメモに）・
//     続けて聞く（同じボットに依頼の小窓を開いて、頼む文の頭に「#0003 の続き：要約の1行」）。灰色の返事・途中経過・エラー・知らせはカードにしない（今のまま）
//     巣の設定 nest.cosmic がオンのときだけ「Grok!」の札と星空の背景（飾りだけ。CSS だけ・動きなし）
//   ・依頼の小窓 v2・R5（D11）：続きとして頼んだ依頼は、一覧で糸に束ねる（写しの thread＝親をたどった根の requestId）。
//     糸の見出しは「糸：（最初の依頼の頭）」と「#0006 → #0009 → #0010」、中は最初の問いから順に今までのカード（みんなに聞くの組の席は組のカードのまま）。
//     頭（40 字）は巣の設定でオンのときだけあるので、無ければ「#0006 から」。回答カードにも糸の 1 行を出す。
//     回答カードの「続けて聞く」は、その返事の依頼（requestId）も渡す（小窓は「続きとして」が選ばれた状態で開く）。糸ごと六角メモへは R10 のあと
//   ・依頼の小窓 v2・R8（D17・D18。見本 ③ 送ったあと）：一覧の上に「送ったあと」の区画を足す（一覧・糸・組のカードの並びはそのまま）。
//     伝票レール（.inbox-rail。横一列・横に送る。待っている＝経過と受領 まだ／あり・途中経過 n/10・期限超え〔巣の設定 noticeHours〕は赤・
//     届いた〔まだ読んでいない〕は緑。古いほど上の帯が濃くなる。「閉じる」は窓が開いている間だけレールから外す）、
//     追跡票（.inbox-track。押した伝票か、いちばん新しい伝票：受け付けた → 貼った？ → 相手が受け取った → 作業中 → 届いた）、
//     中継の見張り（返事を取りに行く常駐の様子と最後に見回った時刻・「いま取りに行く」botInboxCheck・「試し便を送る」botPing。往復の時間と照合の合否だけ）。
//     「貼りましたか？」の札は写しの pasteAsk があるときだけ 1 枚（区画の上。答えは botPasted）。不在票は左の botNotice（notice: absent）から 1 枚。
//     画像と文を一つの貼り付けで送った依頼（依頼の小窓 v2・R7d。pasteAsk の image）の札には、画像が落ちたときの手を足す：
//     「画像のフォルダを開く」（bot-shots の写しを選んで開く。チャットへドラッグ）・「次から 2 回貼りに戻す」（botPasteMode。巣の設定が html のときだけ）。
//     アプリが受けたかはブラウザからは分からないので、聞かずに戻したりはしない
//   ・返し先「六角メモにも届く」（依頼の小窓 v2・R10・D13）：その依頼（一覧の写しの deliverTo）の回答カードの見出しに小さな札「⬡ 六角メモにも届く」、
//     左が写したら（delivered）「⬡ 六角メモに写しました」。カードの下の 1 行は左の知らせ（fileId つき）か、無ければ delivered の 1 行。
//     写せなかったときの理由もカードの下（左の知らせ）。足の「⬡ 六角メモで開く」はそのまま（写したあとは「保存済み」）
//   ・webhook「そのまま送る」（依頼の小窓 v2・R11・D20）：中継へ直接送った依頼（一覧の写しの via: 'hook'）の伝票は「中継へ送った」、
//     追跡票は「貼った？」を飛ばして「受け付けた → 相手が受け取った → …」。中継に届かなかった（hook.ok が false）依頼は、伝票を赤くして
//     「中継に届きません」と「コピーして開く」（命令 botHookFallback：同じ依頼を attempt を 1 増やしてコピーに。左が依頼を覚えているあいだ＝hookCopy）。
//     切り替えたあとは今までのコピーの伝票・追跡票（貼った？あり）。やり取りの行も「中継へ直接送った」「同じ依頼でもう一度（2 回目）」と書き分ける
//     上の下書きの箱は「未送信」（途中で閉じた依頼とコピーに失敗した依頼。「送り方を選び直す…」は小窓を開き直す・「下書きに戻す」は失敗の印を外す）
//   ・受け取り箱 v2（依頼の小窓 v2・R9・D19・D21。見本 ④）：未送信の箱と一覧のあいだに「まず 1 枚」の表（左の写しの away。前の「読んだ」より後に
//     届いた、まだ読んでいない返事：番号・宛て先・頼んだ一言〔設定でオンのときだけ〕・返事の一言・続けて聞く／メモに置く〔右のメモ〕／片づける〔読んだに。
//     箱には残る〕。灰色の返事〔預かり〕は 1 行。不在票の「まず 1 枚へ」でここへ）。回答カードの先頭に軽い返事の 3 つ（一行の答え・次の一手・
//     どのくらい確か。botAnswerParts が見出しから拾う。描き方は今までの Markdown 表示のまま）。足は「⬡ 六角メモで開く／タブに残す／もう一度 ▾／印」：
//     もう一度 ▾ は同じ子に続けて聞く・別の子へ渡す・言い換えてもう一回・頼み方を直す（後ろの 3 つは巣が小窓を開く。host.askAgain）、
//     印は当たり／ずれ／宛て先違い（命令 botMark。もう一度押すと外れる。説明に役の印の数）。一覧の下の隅に今月の量（料金は出さない）。
//     言い換えた依頼の番号は #0010-2（左の写しのまま出す）
//   ・「依頼と合っています ✓」は「この依頼への返事だ」ということだけ（中身が正しい・安全という意味ではない）。check はここには来ない
//   ・送る・送り直すのボタンは出さない（Webhook は S2.7・保留）。依頼は「コピーしてアプリを開く」で作り、使う人がアプリに貼って送る
import { publishQueue } from '../cards-stages';
import { armConfirm } from '../confirm-arm';
import {
  type BotAwayRow,
  type BotAwayView,
  type BotBrief,
  type BotBriefState,
  type BotFullState,
  type BotGroupReply,
  type BotGroupSeat,
  type BotGroupStatus,
  botCellState,
  botFullStateLabel,
  botGroupSeatLabel,
  type BotInboxStatus,
  type BotRequestBrief,
  type BotRequestList,
  botRequestStateLabel,
  requestNo,
  isWaitingState,
  requestProgress,
  type BotThreadItem,
  type BotThreadMessage,
  type BotThreadRequest,
  type BotThreadView,
  inboxWatchText,
  monthlyText,
  THREAD_SHOW_CHARS,
} from '../bots';
import type { BotMark } from '../bot-replies';
import { type BotPasteAsk, cleanPasteAsk } from '../bot-send';
import { openShotFolder } from '../bot-shot';
import { type BotDraft, DRAFT_DAYS, loadDrafts, markDraftCopied, onDrafts, removeDraft, unfailDraft } from '../drafts';
import { roleGroupLabel } from '../bot-roles';
import type { BotTeams } from '../bot-teams';
import type { RelayCommand } from '../types';
import { makeCards } from '../ai/cards';
import type { OrganizeSettings } from '../ai/organize';
import { BUDGET_NEAR_NOTE, budgetStopMessage, loadBudget } from '../ai/budget';
import { describeError } from '../ai/client';
import { formatLesson, lessonFailure, makeLesson, usableLessonText } from '../ai/lesson';
import { BLOCK_NOTE, redactBlockedUrls as redactBlocked } from '../blocklist';
import { type BotAnswerParts, botAnswerLine, botAnswerParts, renderBotMarkdown, safeHttpUrl } from '../bot-markdown';
import { el } from '../util';
import { type CardDraft, cardKey } from '../vocab';
import type { Vision } from '../visions';
import type { CellMenu, MenuEntry } from './cell-menu';

export interface BotPanelHost {
  askLeft(action: RelayCommand): void;
  menu: CellMenu;
  toast(text: string, ms?: number): void;
  selected?(botId: string | null): void; // 欄で見るボットが変わった（右下の Grok Bot の選んだ印をそろえる）
  copyAndOpen?(botId: string): void; // 「コピーしてアプリを開く…」（右下の Grok Bot と同じ。依頼を作るのは左）
  sendDraft?(draft: BotDraft): Promise<boolean>; // 下書きを、今の送り方でコピーする（番号が付くのは、左が依頼を作ったとき）
  reopenDraft?(draft: BotDraft): boolean; // 未送信の「送り方を選び直す…」（R8）：その下書きで依頼の小窓を開き直す（送れたら下書きは外れる）
  // 回答カードの「続けて聞く」：そのボットに依頼の小窓を開き、頼む文の頭に text を入れる（S3.10）。
  //   parentRequestId（R5）：その返事の依頼。小窓は「続きとして」が選ばれた状態で開き、送った依頼は同じ糸に束なる
  followUp?(botId: string, text: string, parentRequestId?: string): boolean;
  // 回答カードの「もう一度 ▾」（R9・D19）：pass 別の子へ渡す・retry 言い換えてもう一回・redo 頼み方を直す。巣が小窓を開く（line：返事の頭の 1 行）
  askAgain?(how: 'pass' | 'retry' | 'redo', item: { botId: string; requestId: string; no: string; head?: string; role?: string; presetIds?: string[] }, line: string): boolean;
  hexTarget?(): string | null; // 六角メモの送り先の名前（相棒の設定。回答カードのボタンの説明だけ。S3.10）
  vision?(botId: string, fileId: string): Vision | undefined; // この返事から残した Grok Vision（S3.7b。カードに小さな「Vision」札）
  removeVision?(id: string): void; // 「Vision」札のメニューの「消す」（確かめてから。消すのは左）
  // 回答カードの次（段階6）。単語帳へ入れる・Deeper Dive の目安と1回・クイズの案。灰色の返事からは呼ばない
  addCards?(cards: CardDraft[]): void;
  existingFronts?(): string[];
  organizeSettings?(): OrganizeSettings;
  diveEstimate?(chars: number): { name: string; line: string; practice: boolean };
  diveReply?(text: string): Promise<boolean>;
  // ボットの返事を相棒に見せる（段階7）。灰色の返事からも。全文は道具が使える会話に残さない
  showEstimate?(chars: number): { name: string; line: string; practice: boolean };
  showReply?(text: string): Promise<boolean>;
}

// 左から届く台帳の写し（relay の bots）
export interface BotPanelState {
  bots: BotBrief[];
  appMissing: boolean;
  ready: boolean;
  states?: BotBriefState[];
  inbox?: BotInboxStatus | null;
  requests?: BotRequestList; // 受け取り箱の一覧（S3.8）
  teams?: BotTeams; // グループの割り当て（まとめ役。G3）
  nest?: { cosmic?: unknown; noticeHours?: unknown; pasteMode?: unknown } | null; // 巣の設定（回答カードの飾り cosmic・知らせの期限 noticeHours〔R8〕・画像の貼り方 pasteMode〔R7d〕だけ見る）
  pasteAsk?: BotPasteAsk | null; // 「貼りましたか？」の札（R8。1 枚だけ。中身は来ない）
  away?: BotAwayView | null; // 「まず 1 枚」の表（R9。返事の一言だけ。本文は来ない）
}

const LIST_SHOWN = 5; // 一覧で最初に出すカードの数（残りは「さらに n 件」）
// 返事の印（R9・D19）。見本 ④ の「当たり／ずれ／宛て先違い」
const MARKS: readonly { mark: BotMark; label: string; hint: string }[] = [
  { mark: 'hit', label: '当たり', hint: '頼んだとおりの返事でした' },
  { mark: 'miss', label: 'ずれ', hint: '頼んだこととずれた返事でした' },
  { mark: 'wrongTo', label: '宛て先違い', hint: 'この子に頼むことではありませんでした' },
];
const ATTACH_WORDS: Record<string, string> = { page: 'ページ', body: '本文', tabs: 'タブ' };

export const MATCH_HINT = 'この依頼への返事だということだけが分かります。中身が正しい・安全という意味ではありません';

type CardFollow =
  | { fileId: string; kind: 'vocab'; front: string; back: string }
  | { fileId: string; kind: 'dive'; line: string; blocked: string; busy: boolean }
  | { fileId: string; kind: 'show'; line: string; blocked: string; busy: boolean }
  | { fileId: string; kind: 'quiz'; making: boolean; cards: (CardDraft & { checked: boolean })[]; note: string }
  | {
      fileId: string;
      kind: 'lesson';
      step: 'confirm' | 'making' | 'ready';
      title: string;
      summary: string;
      points: string[];
      cards: (CardDraft & { checked: boolean })[];
      note: string;
    };

const GREY_LABELS: Record<string, { label: string; hint: string }> = {
  checkMismatch: { label: '確かめられない返事', hint: 'この依頼の check と合わないので、だれが書いたか分かりません。依頼の状態は変えていません（返事ありにしない・待つのもやめない）' },
  unknownRequest: { label: '知らない依頼への返事', hint: '覚えていない依頼（30 日より前・取り消した・知らない依頼）への返事です。状態は変えていません' },
  notice: { label: '頼んでいない知らせ', hint: 'ボットからの知らせです。送り元を確かめられないので、灰色で出しています' },
  unknownVersion: { label: '知らない版の返事', hint: '知らない形（v が 1 でない）の返事です。文だけを出しています。状態は変えていません' },
};

const ERROR_LABELS: Record<string, string> = {
  cannot: 'できませんでした',
  needApproval: 'アプリで承認が要ります',
  tooLarge: '大きすぎました',
  busy: '混んでいました',
  other: 'そのほか',
};

const FOLD_KEY = 'honeycomb.botPanel.folded';

export class BotPanel {
  readonly element = el('section', 'bot-panel');
  private readonly head = el('div', 'bot-panel-head');
  private readonly body = el('div', 'bot-panel-body');
  private state: BotPanelState | null = null;
  private botId: string | null = null;
  private thread: BotThreadView | null = null;
  private folded = loadFolded();
  private seen = false; // 欄が画面に見えている（見えている間だけ「読んだ」にする）
  private confirmStop: string | null = null; // 「待つのをやめる」を確かめている依頼
  private readonly asked = new Set<string>(); // 「読んだ」を頼んだ依頼（同じものを何度も頼まない）
  private target: { botId: string; fileId: string; missing: () => void } | null = null; // 月の窓の「もとの返事へ」で見せる返事
  private listMore = false; // 一覧を全部出している
  private readonly groupOpen = new Set<number>(); // 「まとめて読む」で開いている組
  private readonly groupReplies = new Map<number, BotGroupReply[]>(); // 左から届いた組の返事（開いている間だけ使う）
  private readonly summaryAsked = new Set<string>(); // まとめの文を取りに行った組（group:requestId）
  private readonly summaryMiss = new Set<string>(); // 取りに行ったが、記録にそのまとめが無かった
  private revealStatus = false; // 一覧のカードを押した：やり取りの写しが届いたら、下のボットの欄を見せる
  private readonly rawShown = new Set<string>(); // 「元の文」で、Markdown を整えずに出している返事（fileId）
  private cosmic = false; // 回答カードに「Grok!」の札と星空の背景（巣の設定 nest.cosmic。S3.10）
  private readonly cardNotes = new Map<string, string>(); // 回答カードの下の1行（左からの結果の知らせ。窓が開いている間だけ）
  private follow: CardFollow | null = null; // 回答カードの「単語帳へ・Deeper Dive・クイズにする」（段階6。1枚だけ）
  private readonly tabbed = new Set<string>(); // 「タブに残す」を押した返事（窓が開いている間だけ。2回押さないように ✓）
  private drafts: BotDraft[] = []; // コピーする前（段階3）。待っている依頼とは別
  private copying: string | null = null;
  // 送ったあと（R8）。どれもメモリーだけ（窓が開いている間）
  private trackId: string | null = null; // 追跡票に出す伝票（押した伝票。無ければいちばん新しい伝票）
  private readonly closedTickets = new Set<string>(); // 「閉じる」でレールから外した伝票（受け取り箱の一覧には残る）
  private pasteAsk: BotPasteAsk | null = null; // 写しの「貼りましたか？」の札
  private pasteAnswered: string | null = null; // 答えを送った札（左の写しが届くまで隠す）
  private pasteSeen: string | null = null; // 見える所へ出した札（1 枚につき 1 回だけ開いて見せる）
  private revealPaste = false;
  private absentNote: string | null = null; // 不在票（左の botNotice。閉じるまで 1 枚）
  private noticeHours = 3; // 知らせの期限（巣の設定。レールの言葉だけに使う。期限超えは左が決める）
  private pasteHtml = false; // 巣の設定の画像の貼り方が html（R7d。画像入り 1 回の札に「次から 2 回貼りに戻す」を出すか）
  private greyTidied = 0; // 「まず 1 枚」の預かりの行を「片づける」で隠したときの数（R9。それより増えたら、また出す。窓が開いている間だけ）

  constructor(private readonly host: BotPanelHost) {
    this.element.setAttribute('aria-label', '受け取り箱（Grok Bot への依頼とやり取り）');
    this.element.append(this.head, this.body);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        this.seen = entries.some((e) => e.isIntersecting);
        if (this.seen) this.markSeen();
      }).observe(this.element);
    } else {
      this.seen = true;
    }
    onDrafts((drafts) => {
      this.drafts = drafts;
      publishQueue(drafts.map((draft) => ({ id: draft.id, botId: draft.botId, ...(draft.group !== undefined ? { group: draft.group } : {}) })));
      this.render();
    });
    void this.reloadDrafts();
    window.addEventListener('focus', () => void this.reloadDrafts());
    window.setInterval(() => this.tickElapsed(), 30_000); // 伝票の「経過」だけを書き換える（描き直さない）
    this.render();
  }

  private async reloadDrafts() {
    this.drafts = await loadDrafts();
    this.render();
  }

  // ---------- 左から届く写し ----------

  listBots(): { id: string; name: string; agentId?: string }[] {
    return (this.state?.bots ?? []).map((bot) => ({ id: bot.id, name: bot.name, ...(bot.agentId ? { agentId: bot.agentId } : {}) }));
  }

  setState(state: BotPanelState) {
    this.state = {
      bots: Array.isArray(state.bots) ? state.bots : [],
      appMissing: state.appMissing === true,
      ready: state.ready === true,
      states: Array.isArray(state.states) ? state.states : [],
      inbox: state.inbox ?? null,
      ...(state.requests && Array.isArray(state.requests.items) ? { requests: state.requests } : {}),
      ...(state.teams ? { teams: state.teams } : {}),
      ...(state.away && Array.isArray(state.away.rows) ? { away: state.away } : {}),
    };
    this.cosmic = state.nest?.cosmic === 'on';
    const hours = state.nest?.noticeHours;
    this.noticeHours = typeof hours === 'number' && Number.isInteger(hours) && hours >= 1 && hours <= 72 ? hours : 3;
    this.pasteHtml = state.nest?.pasteMode === 'html';
    // 貼りましたか？の札（R8）：左の写しにあるときだけ。新しい札は 1 回だけ見える所へ出す
    this.pasteAsk = cleanPasteAsk(state.pasteAsk);
    if (!this.pasteAsk) this.pasteAnswered = null;
    if (this.pasteAsk && this.pasteAsk.requestId !== this.pasteSeen) {
      this.pasteSeen = this.pasteAsk.requestId;
      this.revealPaste = true;
      if (this.folded) this.setFolded(false);
    }
    if (this.botId && this.state.ready && !this.state.bots.some((b) => b.id === this.botId)) this.choose(null);
    this.render();
  }

  // 不在票（R8。左の botNotice の notice: absent）：受け取り箱の上に 1 枚（閉じるまで）
  absent(text: string) {
    if (!text) return;
    this.absentNote = text;
    this.render();
  }

  // 巣の届いた席を押した（R8）：そのボットの、まだ読んでいない返事のうち新しいものへ飛び、「読んだ」にする（席の光が消える）。無ければ false
  openUnread(botId: string): boolean {
    const item = (this.state?.requests?.items ?? []).filter((i) => i.botId === botId && i.final && !i.final.read && !i.final.faint).sort((a, b) => (b.final?.at ?? 0) - (a.final?.at ?? 0))[0];
    if (!item) return false;
    this.openRequest(item);
    this.host.askLeft({ command: 'botMarkRead', botId, requestIds: [item.requestId] });
    return true;
  }

  setThread(thread: BotThreadView) {
    if (!thread || thread.botId !== this.botId) return; // ほかのボットの写し（選び直した直後など）
    this.thread = thread;
    this.render();
  }

  // 右下の Grok Bot で選んだ（欄はたたんだまま。見えていれば中身が変わる）
  show(botId: string) {
    if (botId !== this.botId) this.choose(botId);
  }

  // 盤面のボットのセルのカードの「やり取りを見る」：このボットを出し、欄を開いて見える所へ
  open(botId: string) {
    this.choose(botId);
    if (this.folded) this.setFolded(false);
    this.element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // 月の窓の「もとの返事へ」（S3.7b）：このボットを出し、欄を開いて、その返事のカードへ（やり取りの写しが届いてから）
  //   台帳にいないボットなら false（呼んだ側が要点を開く）。写しに無い返事（古いやり取り）なら missing を呼ぶ
  openMessage(botId: string, fileId: string, missing: () => void): boolean {
    if (!this.state?.bots.some((b) => b.id === botId)) return false;
    this.target = { botId, fileId, missing };
    this.choose(botId);
    if (this.folded) this.setFolded(false);
    else this.render();
    return true;
  }

  // 殻の段 1〜2：下書きの節へ移す（欄は畳まない）
  openDrafts() {
    if (this.folded) this.setFolded(false);
    const list = this.body.querySelector<HTMLElement>('.bot-drafts');
    if (!list) return;
    list.tabIndex = -1;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    list.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
    list.focus({ preventScroll: true });
  }

  // 巣の下の1行（S3.8）：受け取り箱を開いて、一覧を見える所へ
  openList() {
    if (this.folded) this.setFolded(false);
    const list = this.body.querySelector<HTMLElement>('.bot-reqs');
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    (list ?? this.element).scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
    list?.querySelector<HTMLElement>('.bot-reqs-title')?.focus({ preventScroll: true });
  }

  // まとめて読む（S3.8）：左から届いた組の返事（開いている組だけ出す）
  setGroupReplies(group: number, replies: BotGroupReply[]) {
    if (!Array.isArray(replies)) return;
    this.groupReplies.set(group, replies);
    const prefix = `${group}:`;
    for (const key of this.summaryAsked) {
      if (!key.startsWith(prefix)) continue;
      const requestId = key.slice(prefix.length);
      if (replies.some((r) => r.summary && r.requestId === requestId)) this.summaryMiss.delete(key);
      else this.summaryMiss.add(key);
    }
    this.render();
  }

  // 回答カードの下の1行（六角メモ・タブに残すの結果。左の botNotice の fileId。S3.10）
  cardNote(fileId: string, text: string) {
    if (!fileId || !text) return;
    this.cardNotes.set(fileId, text);
    if (this.cardNotes.size > 50) this.cardNotes.delete(this.cardNotes.keys().next().value ?? '');
    this.render();
  }

  // このボットのやり取りが、もう見えているか（見えていれば、返事の吹き出しは出さない）
  isShowing(botId: string): boolean {
    return this.botId === botId && !this.folded && this.seen && document.visibilityState === 'visible';
  }

  // ---------- 内側 ----------

  private choose(botId: string | null) {
    if (botId === this.botId) return;
    this.botId = botId;
    this.thread = null;
    this.confirmStop = null;
    this.host.selected?.(botId);
    this.host.askLeft({ command: 'botSelect', botId });
    this.render();
  }

  // 上のタグから開く（右クリックの登録先）。たたむボタンは、これまでどおり見出しの ▾
  get header() {
    return this.head;
  }

  isCollapsed() {
    return this.folded;
  }

  expand() {
    if (this.folded) this.setFolded(false);
  }

  private setFolded(folded: boolean) {
    this.folded = folded;
    try {
      localStorage.setItem(FOLD_KEY, folded ? 'folded' : 'open');
    } catch {
      // 覚えられなくても、今は開け閉めできる
    }
    this.render();
  }

  private bot(): BotBrief | undefined {
    return this.botId ? this.state?.bots.find((b) => b.id === this.botId) : undefined;
  }

  private brief(id: string): BotBriefState | undefined {
    return this.state?.states?.find((s) => s.id === id);
  }

  // セルの顔と同じ「いちばん大事な1つ」
  private fullState(bot: BotBrief): BotFullState {
    const brief = this.brief(bot.id);
    return brief && brief.state !== 'idle' ? brief.state : botCellState(bot, this.state?.appMissing ?? false);
  }

  render() {
    // 書き換えても、キーボードの位置を同じボタンに残す
    const active = document.activeElement instanceof HTMLElement && this.element.contains(document.activeElement) ? document.activeElement.dataset.key : undefined;
    this.element.classList.toggle('folded', this.folded);
    this.renderHead();
    if (this.folded) {
      this.body.replaceChildren();
    } else {
      this.body.replaceChildren(...this.bodyNodes());
    }
    if (active) this.element.querySelector<HTMLElement>(`[data-key="${CSS.escape(active)}"]`)?.focus({ preventScroll: true });
    this.markSeen();
    this.revealTarget();
    this.revealStatusRow();
    this.revealPasteCard();
  }

  // 新しい「貼りましたか？」の札を、見える所へ（1 枚につき 1 回だけ。キーボードの位置は動かさない）
  private revealPasteCard() {
    if (!this.revealPaste || this.folded) return;
    const card = this.body.querySelector<HTMLElement>('.inbox-paste');
    if (!card) return;
    this.revealPaste = false;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
  }

  // 一覧のカードを押したあと：そのボットのやり取り（下の欄）を見える所へ（写しが届いたときに1回だけ）
  private revealStatusRow() {
    if (!this.revealStatus || this.folded || !this.thread || this.thread.botId !== this.botId) return;
    this.revealStatus = false;
    const row = this.body.querySelector<HTMLElement>('.bot-panel-status');
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    row?.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
  }

  // 「もとの返事へ」で頼まれた返事のカードを見せる（そのボットのやり取りの写しが届いたときに1回だけ）
  private revealTarget() {
    const t = this.target;
    if (!t || this.folded || t.botId !== this.botId || this.thread?.botId !== t.botId) return;
    this.target = null;
    const card = [...this.body.querySelectorAll<HTMLElement>('[data-file-id]')].find((c) => c.dataset.fileId === t.fileId);
    if (!card) {
      t.missing();
      return;
    }
    const fold = card.closest('details');
    if (fold) fold.open = true;
    card.tabIndex = -1;
    card.classList.add('bot-msg-target');
    window.setTimeout(() => card.classList.remove('bot-msg-target'), 2400);
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
    card.focus({ preventScroll: true });
  }

  private renderHead() {
    const fold = el('button', 'bot-panel-fold', this.folded ? '▸' : '▾');
    fold.type = 'button';
    fold.dataset.key = 'fold';
    fold.title = this.folded ? '受け取り箱を開く' : '受け取り箱をたたむ';
    fold.setAttribute('aria-label', fold.title);
    fold.setAttribute('aria-expanded', String(!this.folded));
    fold.addEventListener('click', () => this.setFolded(!this.folded));
    const mark = el('span', 'bot-panel-mark', '↗');
    mark.setAttribute('aria-hidden', 'true');
    const title = el('span', 'bot-panel-title', '受け取り箱');
    title.title = 'Grok Bot（外のアプリ）への依頼の一覧と、ボットごとのやり取り。相棒（ブラウザの中の AI）とは別です';
    const nodes: HTMLElement[] = [fold, mark, title];
    const s = this.state;
    if (s?.bots.length) {
      const select = el('select', 'bot-panel-select');
      select.dataset.key = 'select';
      select.setAttribute('aria-label', 'やり取りを見るボット');
      const none = el('option', '', 'ボットを選ぶ…');
      none.value = '';
      select.append(none);
      for (const bot of s.bots) {
        const brief = this.brief(bot.id);
        const marks = [brief?.unread ? `返事 ${brief.unread}` : '', brief?.waiting ? `待ち ${brief.waiting}` : ''].filter(Boolean).join('・');
        const option = el('option', '', marks ? `${bot.name}（${marks}）` : bot.name);
        option.value = bot.id;
        select.append(option);
      }
      select.value = this.botId ?? '';
      select.addEventListener('change', () => this.choose(select.value || null));
      nodes.push(select);
    }
    const unread = (s?.states ?? []).reduce((n, b) => n + b.unread, 0);
    if (unread > 0) {
      const count = el('span', 'bot-panel-unread', String(unread > 99 ? '99+' : unread));
      count.title = `まだ読んでいない返事 ${unread} 通（全部のボット）`;
      nodes.push(count);
    }
    this.head.replaceChildren(...nodes);
  }

  private bodyNodes(): HTMLElement[] {
    const s = this.state;
    if (!s) return [el('div', 'bot-panel-empty', 'ボットの台帳を待っています…')];
    const nodes: HTMLElement[] = [];
    if (s.inbox && !s.inbox.owner) {
      const other = el('div', 'bot-panel-banner', '別の窓で使っています');
      other.append(el('span', 'bot-panel-banner-note', '同じデータフォルダの、もう1つの窓がボットの返事を受け取っています。依頼と返事は、その窓で見てください'));
      other.setAttribute('role', 'status');
      nodes.push(other);
    }
    const ask = this.pasteAsk && this.pasteAnswered !== this.pasteAsk.requestId ? this.pasteAsk : null;
    if (ask) nodes.push(this.pasteCard(ask));
    if (this.absentNote) nodes.push(this.absentSlip(this.absentNote));
    nodes.push(this.afterSend(s)); // 送ったあと（R8）：伝票レール・追跡票・中継の見張り。下の一覧の並びは変えない
    nodes.push(this.draftList());
    const first = this.firstTable(s); // 帰ってきたら、まず 1 枚（R9）：一覧の前に
    if (first) nodes.push(first);
    nodes.push(this.requestList(s));
    nodes.push(el('div', 'bot-panel-subtitle bot-panel-section', 'ボットごとのやり取り'));
    const bot = this.bot();
    if (!bot) {
      nodes.push(
        el(
          'div',
          'bot-panel-empty',
          s.bots.length
            ? '右下の Grok Bot を押すか、盤面のボットのセルのカードの「やり取りを見る」で、そのボットの依頼と返事がここに出ます'
            : 'ボットがまだいません。右下の ＋ か、盤面の空いたセルを右クリック →「ボットのセルを置く…」から置けます',
        ),
      );
      return nodes;
    }
    nodes.push(this.statusRow(bot));
    if (!this.thread) {
      nodes.push(el('div', 'bot-panel-empty', 'やり取りを読み込んでいます…'));
      return nodes;
    }
    const waiting = this.thread.requests.filter((r) => r.status === 'waiting');
    if (waiting.length) nodes.push(this.waitingList(bot, waiting));
    nodes.push(this.log(bot, this.thread));
    return nodes;
  }

  // ---------- 送ったあと（R8・D17・D18） ----------

  // 「貼りましたか？」の札（1 枚だけ。ブラウザは貼ったかどうかを知れないので、聞くだけ）
  private pasteCard(ask: BotPasteAsk): HTMLElement {
    const card = el('section', 'inbox-paste');
    card.setAttribute('role', 'status');
    card.setAttribute('aria-label', `${ask.no} の「貼りましたか？」`);
    const line = el('p', 'inbox-paste-text');
    line.append(el('b', '', ask.no), document.createTextNode(' がクリップボードに残っています（履歴・同期には入れていません）。貼りましたか？'));
    const row = el('div', 'inbox-paste-actions');
    const button = (label: string, answer: 'yes' | 'again' | 'no', title: string) => {
      const b = el('button', answer === 'yes' ? 'ai-small inbox-paste-yes' : 'ai-small', label);
      b.type = 'button';
      b.dataset.key = `paste-${answer}`;
      b.title = title;
      b.addEventListener('click', () => {
        this.pasteAnswered = ask.requestId;
        this.host.askLeft({ command: 'botPasted', botId: ask.botId, requestId: ask.requestId, answer });
        this.render();
      });
      return b;
    };
    const back = ask.held === 'image' ? '預かっておいた前の画像（長い辺 1600px までの写し）' : ask.held === 'text' ? '預かっておいた前の中身' : '— 戻せる中身はありません。依頼の文だけ消します —';
    row.append(
      button('貼った', 'yes', `貼った、と記録して、クリップボードを${back}に戻します`),
      button('もう一度開く', 'again', 'Grok Bot アプリのチャットを、もう一度開きます（依頼はクリップボードに残したまま。戻ってから、もう 1 回だけ聞きます）'),
      button('消す', 'no', `クリップボードの依頼を消して${ask.held === 'none' ? '' : `、${back}に戻し`}ます（この依頼は貼らなかったものとして、待つのをやめます）`),
    );
    const hint = el(
      'p',
      'inbox-paste-hint',
      `「貼った」で、${ask.held === 'none' ? 'クリップボードの依頼の文を消します（前の中身は戻せる形ではありませんでした）' : `${back}に戻します`}。預かりはメモリの中だけ・画面に出しません・戻したら捨てます・閉じれば消えます。`,
    );
    card.append(line, row, hint);
    if (ask.image) card.append(this.pasteOneShot(ask, ask.image)); // 画像入り 1 回で送った依頼（R7d）
    return card;
  }

  // 画像と文を一つの貼り付けで送った依頼の札に足す手（R7d）。画像が落ちたかは分からないので、落ちたときに使う手を出すだけ
  private pasteOneShot(ask: BotPasteAsk, shotId: string): HTMLElement {
    const box = el('div', 'inbox-paste-one');
    box.append(el('p', 'inbox-paste-text', '画像と文を一つの貼り付けで送りました。チャットに画像が入らず、文だけになっていたら：'));
    const row = el('div', 'inbox-paste-actions');
    const folder = el('button', 'ai-small', '画像のフォルダを開く');
    folder.type = 'button';
    folder.dataset.key = 'paste-folder';
    folder.title = '送った画像（bot-shots に保存した写し。7 日で消えます）を選んだ状態でフォルダを開きます。チャットへドラッグして添付できます';
    folder.addEventListener('click', () => openShotFolder(shotId));
    row.append(folder);
    if (this.pasteHtml) {
      const two = el('button', 'ai-small', '次から 2 回貼りに戻す');
      two.type = 'button';
      two.dataset.key = 'paste-two';
      two.title = '巣の設定の「画像の貼り方」を 2 回貼り（① 画像 → ② 文）に戻します。巣の ⚙「みんなに聞く」で、また選べます';
      two.addEventListener('click', () => this.host.askLeft({ command: 'botPasteMode', mode: 'two', botId: ask.botId }));
      row.append(two);
    } else row.append(el('span', 'inbox-paste-hint', '次からは 2 回貼り（① 画像 → ② 文）です'));
    box.append(row);
    return box;
  }

  // 不在票（閉じるまで 1 枚）。「まず 1 枚」の表があれば、そこへ飛ぶボタン（R9。数は表と同じものを左が書いている）
  private absentSlip(text: string): HTMLElement {
    const slip = el('div', 'inbox-absent');
    slip.setAttribute('role', 'status');
    slip.append(el('span', 'inbox-absent-text', text));
    if (this.state?.away?.rows.length) {
      const go = el('button', 'ai-small', 'まず 1 枚へ');
      go.type = 'button';
      go.dataset.key = 'absent-first';
      go.title = '留守中に届いた返事の表（受け取り箱の「まず 1 枚」）へ移ります';
      go.addEventListener('click', () => this.revealFirst());
      slip.append(go);
    }
    const close = el('button', 'ai-small', '閉じる');
    close.type = 'button';
    close.dataset.key = 'absent-close';
    close.title = '不在票を閉じます（返事は受け取り箱に残っています）';
    close.addEventListener('click', () => {
      this.absentNote = null;
      this.render();
    });
    slip.append(close);
    return slip;
  }

  // 「まず 1 枚」の表を見える所へ（見出しに移る。キーボードでもそのまま表を読める）
  private revealFirst() {
    const table = this.body.querySelector<HTMLElement>('.inbox-first');
    if (!table) return;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    table.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
    table.querySelector<HTMLElement>('.bot-reqs-title')?.focus({ preventScroll: true });
  }

  // ---------- 帰ってきたら、まず 1 枚（R9・D19。見本 ④ の表） ----------

  // 前の「読んだ」より後に届いた、まだ読んでいない返事の表と、同じあいだの灰色の返事（預かり）の 1 行。どちらも無ければ出さない。
  //   番号を押すとその返事へ。続けて聞く・メモに置く（右のメモ）・片づける（読んだにする。受け取り箱には残る）
  private firstTable(s: BotPanelState): HTMLElement | null {
    const away = s.away;
    const grey = away && away.grey > this.greyTidied ? away.grey : 0;
    if (!away || (!away.rows.length && !grey)) return null;
    const box = el('section', 'inbox-first');
    const head = el('div', 'bot-reqs-head');
    const title = el('span', 'bot-reqs-title', `まず 1 枚：${away.since ? '前に読んだあとに届いた' : 'まだ読んでいない'}返事 ${away.total} 通`);
    title.tabIndex = -1; // 不在票の「まず 1 枚へ」から来たとき、ここに移る
    title.title = away.since
      ? `前に「読んだ」にした ${timeOf(away.since)} より後に届いて、まだ読んでいない返事です`
      : 'まだ一度も「読んだ」にしていないので、読んでいない返事を全部並べています';
    head.append(title);
    if (away.rows.length > 1) {
      const all = el('button', 'ai-small', '全部片づける');
      all.type = 'button';
      all.dataset.key = 'first-tidy-all';
      all.title = '表の返事を全部「読んだ」にします（返事は受け取り箱に残ります）';
      all.addEventListener('click', () => {
        const byBot = new Map<string, string[]>();
        for (const row of away.rows) byBot.set(row.botId, [...(byBot.get(row.botId) ?? []), row.requestId]);
        for (const [botId, requestIds] of byBot) this.host.askLeft({ command: 'botMarkRead', botId, requestIds });
      });
      head.append(all);
    }
    box.setAttribute('aria-label', `まず 1 枚（届いた返事 ${away.total} 通${grey ? `・合わない返事 ${grey} 通` : ''}）`);
    box.append(head);
    const table = el('table', 'inbox-first-table');
    const headRow = el('tr');
    for (const name of ['番号', '宛て先', '頼んだ一言', '返事の一言']) {
      const th = el('th', '', name);
      th.scope = 'col';
      headRow.append(th);
    }
    const thead = el('thead');
    thead.append(headRow);
    const tbody = el('tbody');
    for (const row of away.rows) tbody.append(...this.firstRow(row));
    if (grey) tbody.append(...this.heldRow(grey, away.greyBot));
    table.append(thead, tbody);
    box.append(table);
    if (away.total > away.rows.length) box.append(el('div', 'bot-log-note', `ほかに ${away.total - away.rows.length} 通（下の一覧と、ボットごとのやり取りで）`));
    box.append(el('p', 'inbox-first-hint', '1 行ずつ見て振り分けます。「片づける」は読んだにするだけで、受け取り箱に残ります'));
    return box;
  }

  // 表の 1 通：中身の行と、その下のボタンの行（狭い欄でも読めるように、ボタンは 1 行下に）
  private firstRow(row: BotAwayRow): HTMLElement[] {
    const tr = el('tr', `inbox-first-row${row.type === 'error' ? ' error' : ''}`);
    tr.dataset.requestId = row.requestId;
    const who = this.targetName(row.botId, row.role);
    const no = el('button', 'inbox-first-no', row.no);
    no.type = 'button';
    no.dataset.key = `first-${row.requestId}`;
    no.title = `${row.no}：${who} の返事を、下のやり取りで開きます`;
    no.addEventListener('click', () => {
      if (!this.openMessage(row.botId, row.fileId, () => this.host.toast('この返事は、いまのやり取りの写しには出ていません（古いやり取りです）'))) this.openBot(row.botId);
    });
    const noCell = el('td');
    noCell.append(no);
    const toCell = el('td', 'inbox-first-to', row.role ?? this.state?.bots.find((b) => b.id === row.botId)?.name ?? '（不明）');
    toCell.title = who;
    const head = row.head?.split(' ―――― ')[0]; // R9 より前に残した頭は、添えた情報の枠の頭まで入っていることがある
    const asked = el('td', 'inbox-first-asked', head ? `${head}${head === row.head && [...head].length >= 40 ? '…' : ''}` : '—');
    if (!row.head) asked.title = '頼む文は残さない決まりです（巣の ⚙ で「依頼の最初の 40 字を一覧に出す」をオンにすると、ここに出ます）';
    const line = row.line === undefined ? '読んでいます…' : row.line || '—';
    const answer = el('td', 'inbox-first-line', row.type === 'error' ? `エラー：${line}` : line);
    if (row.line === '') answer.title = 'この返事は記録に見つかりませんでした（古い記録は片づけています）';
    tr.append(noCell, toCell, asked, answer);
    const ops = el('tr', 'inbox-first-ops');
    const cell = el('td');
    cell.colSpan = 4;
    const actions = el('div', 'inbox-first-actions');
    const button = (label: string, key: string, title: string, run: () => void, disabled = false) => {
      const b = el('button', 'ai-small', label);
      b.type = 'button';
      b.dataset.key = `first-${key}-${row.requestId}`;
      b.title = title;
      b.disabled = disabled;
      b.addEventListener('click', run);
      actions.append(b);
    };
    if (row.type === 'reply') {
      button(
        '続けて聞く',
        'follow',
        `${who} に依頼の小窓を開き、頭に「${row.no} の続き：」と返事の一言を入れます（要点の行は小窓で選べます）`,
        () => void this.host.followUp?.(row.botId, `${row.no} の続き：${row.line ?? ''}\n`, row.requestId),
        !this.host.followUp,
      );
    }
    button('メモに置く', 'memo', 'この返事を、右のメモの区画で見ているシートにメモとして置きます', () =>
      this.host.askLeft({ command: 'botToMemo', botId: row.botId, fileId: row.fileId, to: 'right' }),
    );
    button('片づける', 'tidy', 'この返事を「読んだ」にして、表から外します（受け取り箱には残ります）', () =>
      this.host.askLeft({ command: 'botMarkRead', botId: row.botId, requestIds: [row.requestId] }),
    );
    cell.append(actions);
    ops.append(cell);
    return [tr, ops];
  }

  // 合わない返事（灰色・預かり）の 1 行。中身はボットごとのやり取りに灰色で出ている（状態は変えていない）
  private heldRow(count: number, botId: string | undefined): HTMLElement[] {
    const tr = el('tr', 'inbox-first-row held');
    const name = botId ? (this.state?.bots.find((b) => b.id === botId)?.name ?? '（不明）') : '（不明）';
    const text = el('td', 'inbox-first-line', `合わない返事 ${count} 通。預かりに入れました（状態は変えていません）。データとして扱い、リンクは押したときだけ開きます`);
    text.colSpan = 2;
    tr.append(el('td', '', '—'), el('td', 'inbox-first-to', name), text);
    const ops = el('tr', 'inbox-first-ops held');
    const cell = el('td');
    cell.colSpan = 4;
    const actions = el('div', 'inbox-first-actions');
    const see = el('button', 'ai-small', '見る');
    see.type = 'button';
    see.dataset.key = 'first-held-see';
    see.disabled = !botId;
    see.title = botId ? `「${name}」とのやり取りで、灰色の返事を見ます` : 'どのボットの返事か分からないので、ボットごとのやり取りには出せません（記録には残っています）';
    see.addEventListener('click', () => {
      if (botId) this.openBot(botId);
    });
    const tidy = el('button', 'ai-small', '片づける');
    tidy.type = 'button';
    tidy.dataset.key = 'first-held-tidy';
    tidy.title = 'この行を表から外します（また届いたら出します。灰色の返事は記録に残っています）';
    tidy.addEventListener('click', () => {
      this.greyTidied = count;
      this.render();
    });
    actions.append(see, tidy);
    cell.append(actions);
    ops.append(cell);
    return [tr, ops];
  }

  // 送ったあとの区画：伝票レール・追跡票・中継の見張り
  private afterSend(s: BotPanelState): HTMLElement {
    const box = el('section', 'inbox-after');
    box.setAttribute('aria-label', '送ったあと（伝票と追跡票・中継の見張り）');
    const now = Date.now();
    const items = s.requests?.items ?? [];
    // レールに出す伝票：待っている依頼と、まだ読んでいない終わりの返事（閉じたものは除く）。新しいものから
    const tickets = items.filter((i) => !this.closedTickets.has(i.requestId) && (isWaitingState(i.state) || (i.final && !i.final.read && !i.final.faint)));
    if (tickets.length) {
      const rail = el('div', 'inbox-rail');
      rail.setAttribute('role', 'list');
      rail.setAttribute('aria-label', `伝票 ${tickets.length} 枚（待っている依頼と、届いた返事）`);
      for (const item of tickets) rail.append(this.ticket(item, now));
      box.append(rail);
    }
    const tracked = items.find((i) => i.requestId === this.trackId) ?? tickets[0] ?? items[0];
    if (tracked) box.append(this.track(tracked));
    if (s.bots.length) box.append(this.watchRow(s, items, now));
    return box;
  }

  // 伝票 1 枚（古いほど上の帯が濃い：15 分〔遅れ〕で --accent、知らせの期限を過ぎたら赤。届いたら緑）
  private ticket(item: BotRequestBrief, now: number): HTMLElement {
    const hook = hookState(item, now); // webhook（R11）：中継の様子（コピーで送った依頼は null）
    const failed = hook === 'failed' && isWaitingState(item.state);
    const kind = item.final ? (item.final.type === 'error' ? 'error' : 'done') : item.overdue || failed ? 'overdue' : item.state === 'late' ? 'late' : 'wait';
    const card = el('article', `inbox-ticket kind-${kind}${this.trackId === item.requestId ? ' chosen' : ''}`);
    card.setAttribute('role', 'listitem');
    card.dataset.requestId = item.requestId;
    const p = requestProgress(item);
    const label =
      (item.ping ? '試し便・' : '') +
      (kind === 'done'
        ? '届きました ✓'
        : kind === 'error'
          ? 'エラーが届きました'
          : failed
            ? '中継に届きません'
            : kind === 'overdue'
              ? 'まだ届きません'
              : item.state === 'working'
                ? `途中経過 ${p.label}`
                : kind === 'late'
                  ? '遅れています'
                  : hook === 'sending'
                    ? '中継へ送っています…'
                    : '待っています');
    const pick = el('button', 'inbox-ticket-pick');
    pick.type = 'button';
    pick.dataset.key = `ticket-${item.requestId}`;
    pick.append(el('b', 'inbox-ticket-no', item.no), el('span', 'inbox-ticket-label', label));
    pick.title = `${item.no} の追跡票を下に出します`;
    pick.setAttribute('aria-pressed', String(this.trackId === item.requestId));
    pick.addEventListener('click', () => {
      this.trackId = item.requestId;
      this.render();
    });
    card.append(pick);
    const who = this.targetName(item.botId, item.role);
    const meta = el('div', 'inbox-ticket-meta');
    if (item.final) meta.append(document.createTextNode(`${who} ／ ${timeOf(item.createdAt)} → ${timeOf(item.final.at)}`));
    else {
      const elapsed = el('span', 'inbox-elapsed', elapsedText(now - item.createdAt));
      elapsed.dataset.since = String(item.createdAt);
      meta.append(document.createTextNode(`${who} ／ ${timeOf(item.createdAt)} に${hook ? '中継へ送った' : '送った'} ／ 経過 `), elapsed);
    }
    card.append(meta);
    const bar = el('div', 'inbox-ticket-bar');
    bar.setAttribute('aria-hidden', 'true');
    const fill = el('i', '');
    fill.style.width = `${item.final || kind === 'overdue' ? 100 : Math.max(8, Math.round((p.value / Math.max(1, p.max)) * 100))}%`;
    bar.append(fill);
    card.append(bar);
    const line = item.ping && (item.final || item.pingMismatch)
      ? pingResult(item)
      : item.final
        ? item.final.type === 'error'
          ? 'エラーの返事です（わけは下のやり取りで）'
          : '回答カードになりました（押すと読めます）'
        : failed
          ? `中継に届きませんでした（${item.hook?.why ?? 'わけは分かりません'}）。同じ依頼をコピーに切り替えられます`
          : kind === 'overdue'
            ? `知らせの期限（${this.noticeHours} 時間。巣の ⚙ で変えられます）を過ぎました`
            : hook === 'sending'
              ? '中継の答えを待っています（15 秒ほど）'
              : hook === 'unknown' && !item.acceptedAt
                ? '中継の答えを受け取る前に窓を閉じました（届いたかは分かりません）'
                : item.state === 'working' && item.title
            ? `「${item.title}」`
            : item.acceptedAt
              ? `受領：あり（${timeOf(item.acceptedAt)}）`
              : '受領：まだ（相手の最初の途中経過が受領の印）';
    card.append(el('div', 'inbox-ticket-line', line));
    const ops = el('div', 'inbox-ticket-ops');
    if (item.final) {
      const read = el('button', 'ai-small', '読む');
      read.type = 'button';
      read.dataset.key = `ticket-read-${item.requestId}`;
      read.title = `${item.no} の返事を、下のやり取りで開きます`;
      read.addEventListener('click', () => this.openRequest(item));
      ops.append(read);
    } else if (failed) {
      ops.append(this.hookCopyButton(item, `ticket-copy-${item.requestId}`)); // 届かなかった依頼をコピーに（R11）
    } else if (this.state?.bots.find((b) => b.id === item.botId)?.agentId) {
      const app = el('button', 'ai-small', 'アプリで見る');
      app.type = 'button';
      app.dataset.key = `ticket-app-${item.requestId}`;
      app.title = 'Grok Bot アプリで、このボットのチャットを開きます（依頼はコピーしません）';
      app.addEventListener('click', () => this.host.askLeft({ command: 'botOpenApp', botId: item.botId }));
      ops.append(app);
    }
    const close = el('button', 'ai-small', '閉じる');
    close.type = 'button';
    close.dataset.key = `ticket-close-${item.requestId}`;
    close.title = 'この伝票をレールから外します（受け取り箱の一覧には残ります。窓を開き直すと戻ります）';
    close.addEventListener('click', () => {
      this.closedTickets.add(item.requestId);
      if (this.trackId === item.requestId) this.trackId = null;
      this.render();
    });
    ops.append(close);
    card.append(ops);
    return card;
  }

  // 追跡票：受け付けた → 貼った？ → 相手が受け取った → 作業中 → 届いた
  //   webhook で送った依頼（R11）は「貼った？」を飛ばす。中継に届かなければ「中継に届かない」と、同じ依頼をコピーに切り替えるボタン
  private track(item: BotRequestBrief): HTMLElement {
    const box = el('div', 'inbox-track-box');
    box.append(el('div', 'inbox-track-title', `${item.no} の追跡票${item.ping ? '（試し便）' : ''}`));
    const reached = !!(item.acceptedAt || item.final || item.progress > 0);
    const pastedOn = item.pasted === 'yes' || reached;
    const hook = hookState(item, Date.now());
    const failed = hook === 'failed';
    const via = item.via === 'hook' ? (item.copiedAt ? `・中継に届かず ${timeOf(item.copiedAt)} にコピーへ` : '・中継へ直接') : '';
    const pasteStep: { label: string; hint: string; on: boolean; bad?: boolean } | null = failed
      ? { label: '中継に届かない', hint: item.hook?.why ?? '', on: false, bad: true }
      : hook
        ? null
        : item.pasted === 'no'
          ? { label: '消した', hint: '貼らずに、待つのをやめました', on: false, bad: true }
          : { label: pastedOn ? '貼った' : '貼った？', hint: pastedOn ? (item.pasted === 'yes' ? '貼った、と答えました' : '相手に届いたので') : 'アプリから戻って少したったら、1 回だけ聞きます', on: pastedOn };
    const steps: { label: string; hint: string; on: boolean; bad?: boolean }[] = [
      { label: '受け付けた', hint: timeOf(item.createdAt) + via, on: true },
      ...(pasteStep ? [pasteStep] : []),
      { label: '相手が受け取った', hint: item.acceptedAt ? timeOf(item.acceptedAt) : item.final ? timeOf(item.final.at) : '途中経過 1 通目', on: reached },
      { label: '作業中', hint: item.progress > 0 ? `途中経過 ${requestProgress(item).label}` : '', on: !!item.final }, // 途中経過が来ている間は「今の段」
      { label: '届いた', hint: item.final ? timeOf(item.final.at) : '', on: !!item.final },
    ];
    const waiting = isWaitingState(item.state);
    const nowIndex = waiting && !failed ? steps.findIndex((st) => !st.on && !st.bad) : -1;
    const list = el('ol', 'inbox-track');
    list.setAttribute('aria-label', `${item.no} の追跡票`);
    steps.forEach((st, i) => {
      const li = el('li', `inbox-step${st.on ? ' on' : ''}${i === nowIndex ? ' now' : ''}${st.bad ? ' bad' : ''}`);
      if (i === nowIndex) li.setAttribute('aria-current', 'step');
      li.append(el('span', 'inbox-step-label', st.label));
      if (st.hint) li.append(el('span', 'inbox-step-hint', st.hint));
      list.append(li);
    });
    box.append(list);
    if (failed && waiting) {
      // 中継に届かなかった（R11）：同じ依頼（2 回目）を「コピーしてアプリを開く」に切り替える
      const row = el('div', 'inbox-track-hook');
      row.append(el('span', 'bot-log-note', 'この依頼は中継に届いていません。同じ依頼（requestId は同じ・2 回目）を、コピーしてアプリで送れます'), this.hookCopyButton(item, `track-copy-${item.requestId}`));
      box.append(row);
    }
    if (item.state === 'stopped' && item.pasted !== 'no') box.append(el('div', 'bot-log-note', '待つのをやめた依頼です（あとから届いた返事は薄く出します）'));
    return box;
  }

  // 届かなかった依頼を、同じ依頼でコピーに切り替えるボタン（R11。左が依頼を覚えているあいだだけ押せる）
  private hookCopyButton(item: BotRequestBrief, key: string): HTMLButtonElement {
    const button = el('button', 'ai-small', 'コピーして開く');
    button.type = 'button';
    button.dataset.key = key;
    button.disabled = !item.hookCopy;
    button.title = item.hookCopy
      ? `同じ依頼 ${item.no}（2 回目）をコピーして、Grok Bot アプリのチャットを開きます。貼って（Ctrl+V）送ってください`
      : '窓を開き直したので、同じ依頼はもう出せません（頼む文は記録に残さないため）。「待つのをやめる」で片づけて、小窓から頼み直してください';
    button.addEventListener('click', () => this.host.askLeft({ command: 'botHookFallback', botId: item.botId, requestId: item.requestId }));
    return button;
  }

  // 中継の見張り：返事を取りに行く常駐の様子・いま取りに行く・試し便（鍵や中継の場所は出さない）
  private watchRow(s: BotPanelState, items: readonly BotRequestBrief[], now: number): HTMLElement {
    const row = el('div', 'inbox-watch');
    const watch = inboxWatchText(s.inbox, now);
    const status = el('span', `inbox-watch-text${watch.ok ? ' ok' : ''}`, watch.text);
    status.title = watch.hint;
    row.append(status);
    const owner = s.inbox?.owner !== false;
    const check = el('button', 'ai-small', 'いま取りに行く');
    check.type = 'button';
    check.dataset.key = 'watch-check';
    check.disabled = !owner;
    check.title = '返事の置き場を、今すぐ 1 回見に行きます';
    check.addEventListener('click', () => this.host.askLeft({ command: 'botInboxCheck' }));
    row.append(check);
    // 試し便の宛て先：下で見ているボット（リンクあり）か、リンクのある最初のボット
    const target = s.bots.find((b) => b.id === this.botId && b.agentId) ?? s.bots.find((b) => b.agentId);
    const ping = el('button', 'ai-small', '試し便を送る');
    ping.type = 'button';
    ping.dataset.key = 'watch-ping';
    ping.disabled = !owner || !target;
    ping.title = target
      ? `「${target.name}」に、決まった一文だけの試し便をコピーしてアプリを開きます（ページの文は入りません。貼るのは自分で）。出すのは往復の時間と照合の合否だけ`
      : 'リンクのある Grok Bot がいないので、試し便は送れません';
    ping.addEventListener('click', () => {
      if (target) this.host.askLeft({ command: 'botPing', botId: target.id });
    });
    row.append(ping);
    const last = items.find((i) => i.ping);
    if (last) {
      const text = last.final || last.pingMismatch ? pingResult(last) : isWaitingState(last.state) ? '待っています' : '待つのをやめました';
      row.append(el('span', 'inbox-watch-ping', `試し便 ${last.no}：${text}`));
    }
    return row;
  }

  // 伝票の「経過」だけを書き換える（30 秒おき。描き直さないので、キーボードの位置もそのまま）
  private tickElapsed() {
    const now = Date.now();
    for (const node of this.body.querySelectorAll<HTMLElement>('.inbox-elapsed[data-since]')) {
      const since = Number(node.dataset.since);
      if (Number.isFinite(since)) node.textContent = elapsedText(now - since);
    }
  }

  // ---------- 未送信の箱（段階3 の下書き。R8・D18 で「未送信」に。コピーする前。番号は付いていない） ----------

  private draftList(): HTMLElement {
    const box = el('section', 'bot-drafts');
    box.setAttribute('aria-label', '未送信（小窓を途中で閉じた依頼・コピーできなかった依頼）');
    const head = el('div', 'bot-reqs-head');
    const failed = this.drafts.filter((d) => d.failed).length;
    head.append(el('span', 'bot-reqs-title', `未送信 ${this.drafts.length} 件`));
    if (failed) head.append(el('span', 'bot-reqs-waiting bot-draft-failed-count', `コピーできなかった ${failed}`));
    head.append(el('span', 'bot-reqs-waiting', `${DRAFT_DAYS}日で消えます`));
    box.append(head);
    if (!this.drafts.length) {
      box.append(el('div', 'bot-panel-empty bot-reqs-empty', '小窓を途中で閉じた依頼と、コピーできなかった依頼がここに出ます。待っている依頼とは別です。コピーしてアプリが開いたものだけ、下の一覧に番号が付きます。'));
      return box;
    }
    const rows = el('div', 'bot-reqs-list');
    const ordered = [...this.drafts].sort((a, b) => {
      if (a.group && b.group && a.group === b.group) return (a.step ?? 0) - (b.step ?? 0);
      return b.createdAt - a.createdAt;
    });
    for (const draft of ordered) rows.append(this.draftCard(draft));
    box.append(rows);
    return box;
  }

  private draftCard(draft: BotDraft): HTMLElement {
    const card = el('article', `bot-draft${draft.next ? ' next' : ''}${draft.failed ? ' failed' : ''}`);
    const who = [draft.roleName, draft.botName].filter(Boolean).join('・');
    const step = draft.steps ? `${draft.step}/${draft.steps} ` : '';
    const mark = draft.group ? (draft.next ? `次の${draft.req.team ? '役' : '席'} ` : 'まだ ') : '';
    const top = el('div', 'bot-draft-top');
    top.append(el('span', 'bot-draft-who', `${mark}${step}${who}`));
    card.append(top);
    const text = el('p', 'bot-draft-text', draft.text);
    card.append(text);
    const flags = [
      draft.attach.title ? '題名' : '',
      draft.attach.url ? 'アドレス' : '',
      draft.attach.selection ? '選んだ文' : '',
      draft.attach.body ? '本文' : '',
      draft.attach.image ? '画像' : '',
      draft.attach.materials ? `材料 ${draft.attach.materials} 件` : '',
    ].filter(Boolean);
    card.append(el('div', 'bot-draft-meta', `${flags.length ? flags.join('・') : '付けるものなし'}。${draft.chatOnly ? 'アプリのチャットだけ（受け取り箱には残りません）' : 'コピーすると受け取り箱に番号が付きます'}`));
    if (draft.failed) {
      const why = el('div', 'bot-draft-why', `コピーできませんでした：${draft.why ?? 'わけは分かりません'}`);
      why.setAttribute('role', 'note');
      card.append(why);
    }
    const row = el('div', 'bot-draft-actions');
    // 送り方を選び直す…（R8）：この下書きで小窓を開き直す（1体の下書きだけ。みんなに聞くの席は今までどおり順にコピー）
    if (this.host.reopenDraft && draft.group == null) {
      const reopen = el('button', 'ai-small', '送り方を選び直す…');
      reopen.type = 'button';
      reopen.dataset.key = `draft-reopen-${draft.id}`;
      reopen.title = 'この下書きで依頼の小窓を開き直します。宛て先・返し先・付けるものを選び直してから送れます（送れたら、この下書きは外れます）';
      const reopenDraft = this.host.reopenDraft;
      reopen.addEventListener('click', () => {
        if (!reopenDraft(draft)) this.host.toast('いまは小窓を開けません（巣の設定の欄や、ほかの小窓を閉じてから、もう一度どうぞ）');
      });
      row.append(reopen);
    }
    if (draft.failed) {
      const back = el('button', 'ai-small', '下書きに戻す');
      back.type = 'button';
      back.dataset.key = `draft-unfail-${draft.id}`;
      back.title = '「コピーできなかった」の印を外して、ふつうの下書きにします（中身はそのまま）';
      back.addEventListener('click', () => void unfailDraft(draft.id));
      row.append(back);
    }
    if (draft.next && this.host.sendDraft) {
      const copy = el('button', 'ai-small', 'コピーしてアプリを開く');
      copy.type = 'button';
      copy.disabled = this.copying === draft.id;
      copy.addEventListener('click', () => void this.copyDraft(draft));
      row.append(copy);
    }
    const drop = el('button', 'ai-small', '捨てる');
    drop.type = 'button';
    drop.title = 'この下書きを消します。依頼は作りません';
    drop.addEventListener('click', () => void removeDraft(draft.id));
    row.append(drop);
    card.append(row);
    return card;
  }

  private async copyDraft(draft: BotDraft) {
    if (!draft.next || !this.host.sendDraft || this.copying) return;
    this.copying = draft.id;
    this.render();
    const ok = await this.host.sendDraft(draft);
    this.copying = null;
    if (!ok) {
      this.render();
      return;
    }
    if (draft.group != null && draft.step) await markDraftCopied(draft.group, draft.step - 1);
    else await removeDraft(draft.id);
  }

  // ---------- 受け取り箱の一覧（S3.8） ----------

  // 「Grok への依頼 n 件」：新しいものから。組（みんなに聞く）は1枚にまとめる
  private requestList(s: BotPanelState): HTMLElement {
    const box = el('section', 'bot-reqs');
    const list = s.requests;
    const head = el('div', 'bot-reqs-head');
    const title = el('span', 'bot-reqs-title', `Grok への依頼 ${list?.total ?? 0} 件`);
    title.tabIndex = -1; // 巣の下の1行から来たとき、ここに移る
    title.title = '覚えている依頼（終わったものは 30 日まで）。頼む文そのものは残さないので出しません';
    head.append(title);
    if (list?.waiting) head.append(el('span', 'bot-reqs-waiting', `待っている ${list.waiting}`));
    box.setAttribute('aria-label', `Grok への依頼の一覧（${list?.total ?? 0} 件）`);
    box.append(head);
    if (!list?.items.length) {
      box.append(el('div', 'bot-panel-empty bot-reqs-empty', s.ready ? 'まだ依頼はありません。巣の「この子に頼む」「⬡ みんなに聞く」「グループに頼む」か、ボットのセルの「コピーしてアプリを開く…」から頼めます' : '依頼の一覧を読み込んでいます…'));
      return box;
    }
    const groups = new Map(list.groups.map((g) => [g.group, g]));
    const done = new Set<number>();
    const threads = new Set<string>();
    const cards: HTMLElement[] = [];
    for (const item of list.items) {
      const group = item.group ? groups.get(item.group) : undefined;
      if (item.thread && !group) {
        // 糸（R5）：いちばん新しい依頼の場所に 1 つ（中は最初の問いから順に）
        if (threads.has(item.thread)) continue;
        threads.add(item.thread);
        cards.push(this.threadCard(item.thread, list.items, groups));
      } else if (!group) {
        cards.push(this.requestCard(item));
      } else if (!done.has(group.group)) {
        done.add(group.group);
        cards.push(this.groupCard(group, list.items.filter((i) => i.group === group.group)));
      }
    }
    const rows = el('div', 'bot-reqs-list');
    rows.append(...(this.listMore ? cards : cards.slice(0, LIST_SHOWN)));
    box.append(rows);
    if (cards.length > LIST_SHOWN) {
      const more = el('button', 'bot-reqs-more', this.listMore ? '新しい 5 件だけにする' : `さらに ${cards.length - LIST_SHOWN} 件`);
      more.type = 'button';
      more.dataset.key = 'reqs-more';
      more.setAttribute('aria-expanded', String(this.listMore));
      more.addEventListener('click', () => {
        this.listMore = !this.listMore;
        this.render();
      });
      box.append(more);
    }
    if (list.total > list.items.length) box.append(el('div', 'bot-log-note', `ここには新しい ${list.items.length} 件だけ出しています（ほかはボットごとのやり取りで）`));
    // 量の目安（R9・D21）：受け取り箱の隅に。料金は出さない（Grok Bot 側なので分からない）
    if (list.monthly?.count) {
      const amount = el('div', 'bot-reqs-amount', `${monthlyText(list.monthly)}（量の目安。料金は出ません）`);
      amount.title = '今月作った依頼の数と、頼む文の字数の合計です（覚えている依頼から。試し便とアプリのチャットだけの依頼は数えません）';
      box.append(amount);
    }
    return box;
  }

  // 糸の名前と並び（R5）：名前は最初の依頼（根）の頭（巣の設定でオンのときだけ。無い・根が一覧の外なら「#0006 から」。
  //   続きの依頼の頭は「#0006 の続き：…」なので名前には使わない）、並びは古い順の #番号（根が一覧の外〔30 件より前・片づけた〕なら「… →」から）
  private threadInfo(root: string, items: readonly BotRequestBrief[]): { name: string; chain: string; members: BotRequestBrief[] } {
    const members = items.filter((i) => i.thread === root).sort((a, b) => a.createdAt - b.createdAt);
    const first = members.find((i) => i.requestId === root);
    const head = first?.head;
    const name = head ? `${head}${[...head].length >= 40 ? '…' : ''}` : `${requestNo(root)} から`;
    const chain = `${first ? '' : '… → '}${members.map((i) => i.no).join(' → ')}`;
    return { name, chain, members };
  }

  // 糸のカード（R5）：見出し（糸：名前・#番号の並び）と、最初の問いから順の依頼のカード（組の席は組のカードに出すので、ここには入れない）
  private threadCard(root: string, items: readonly BotRequestBrief[], groups: ReadonlyMap<number, BotGroupStatus>): HTMLElement {
    const info = this.threadInfo(root, items);
    const box = el('section', 'bot-thread');
    box.dataset.thread = root;
    box.setAttribute('aria-label', `糸：${info.name}（${info.chain}）`);
    const head = el('div', 'bot-thread-head');
    const chain = el('span', 'bot-thread-chain', info.chain);
    chain.title = '続きとして頼んだ依頼の並び（最初の問いから）';
    head.append(el('b', 'bot-thread-name', `糸：${info.name}`), chain);
    head.title = '「続けて聞く」「続きとして」で頼んだ依頼を、最初の問いから順に束ねています';
    const list = el('div', 'bot-thread-list');
    list.append(...info.members.filter((i) => !(i.group && groups.has(i.group))).map((i) => this.requestCard(i)));
    box.append(head, list);
    return box;
  }

  // 宛て先の言葉（役の名前（ボットの名前）。役なしはボットの名前）
  private targetName(botId: string, role?: string): string {
    const name = this.state?.bots.find((b) => b.id === botId)?.name ?? '（台帳にいないボット）';
    return role ? `${role}（${name}）` : name;
  }

  // 1件のカード：G の印・#番号・宛て先（役）・状態のチップ・時刻／進み具合のバー・途中経過の title／（設定でオンなら）頼む文の最初の 40 字
  private requestCard(item: BotRequestBrief): HTMLElement {
    const card = el('article', ['bot-req', `state-${item.state}`, item.final?.faint ? 'faint' : '', item.final && !item.final.read && !item.final.faint ? 'unread' : ''].filter(Boolean).join(' '));
    card.dataset.requestId = item.requestId;
    const top = el('div', 'bot-req-top');
    const mark = el('span', 'bot-req-g', 'G');
    mark.setAttribute('aria-hidden', 'true');
    const to = this.targetName(item.botId, item.role);
    const open = el('button', 'bot-req-open');
    open.type = 'button';
    open.dataset.key = `req-${item.requestId}`;
    open.append(el('b', 'bot-req-no', item.no), el('span', 'bot-req-to', to));
    open.title = item.final?.type === 'reply' ? `${item.no}：${to} の返事を下のやり取りで見る` : `${item.no}：${to} とのやり取りを下で見る`;
    open.setAttribute('aria-label', `${item.no} ${to}・${botRequestStateLabel(item.state)}。${open.title}`);
    open.addEventListener('click', () => this.openRequest(item));
    top.append(mark, open, this.stateChip(item.state));
    const marked = MARKS.find((x) => x.mark === item.mark); // 印（R9）
    if (marked) top.append(pill(`bot-pill bot-req-mark mark-${marked.mark}`, marked.label, `印：${marked.hint}（回答カードで外せます）`));
    const vision = item.final?.type === 'reply' ? this.host.vision?.(item.botId, item.final.fileId) : undefined;
    if (vision) top.append(this.visionPill(vision));
    top.append(el('time', 'bot-log-time', timeOf(item.final?.at ?? item.createdAt)));
    card.append(top);
    const waiting = isWaitingState(item.state);
    if (waiting && item.progress > 0) card.append(this.progressBar(item));
    if (waiting && item.title) {
      const t = el('div', 'bot-req-title', item.title);
      t.title = `いちばん新しい途中経過：${item.title}`;
      card.append(t);
    }
    if (item.head) card.append(el('div', 'bot-req-head', `「${item.head}${[...item.head].length >= 40 ? '…' : ''}」`));
    const attached = (item.attached ?? []).map((a) => ATTACH_WORDS[a] ?? a);
    if (attached.length) card.append(el('div', 'bot-req-meta', `添付：${attached.join('・')}`));
    return card;
  }

  private stateChip(state: BotRequestBrief['state']): HTMLElement {
    const chip = el('span', `bot-req-chip chip-${state}`, botRequestStateLabel(state));
    chip.title = {
      sent: '依頼を作りました（アプリに貼って送ったら、返事を待ちます）',
      working: 'ボットから途中経過が届きました（調べています）',
      replied: '依頼と合う返事が届きました',
      late: '返事が遅れています（まだ待っています）。下のやり取りで「待つのをやめる」もできます',
      error: 'ボットからエラーの返事が届きました',
      stopped: '待つのをやめました（あとから届いた返事は薄く出します）',
    }[state];
    return chip;
  }

  // 進み具合のバー（step.of があれば n/of、無ければ届いた途中経過の数／10）
  private progressBar(item: BotRequestBrief): HTMLElement {
    const p = requestProgress(item);
    const row = el('div', 'bot-req-progress');
    const bar = el('div', 'bot-req-bar');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(p.max));
    bar.setAttribute('aria-valuenow', String(p.value));
    bar.setAttribute('aria-label', `${item.no} の進み具合 ${p.label}${item.step?.of ? '' : '（途中経過の数。10 通まで）'}`);
    const fill = el('span', 'bot-req-fill');
    fill.style.width = `${Math.round((p.value / Math.max(1, p.max)) * 100)}%`;
    bar.append(fill);
    row.append(bar, el('span', 'bot-req-count', p.label));
    return row;
  }

  // 組のカード（みんなに聞く）：席ごとの小さな点。全部そろったら「まとめて読む」
  private groupCard(g: BotGroupStatus, items: BotRequestBrief[]): HTMLElement {
    const card = el('article', `bot-req group${g.complete ? ' complete' : ''}`);
    card.dataset.group = String(g.group);
    const top = el('div', 'bot-req-top');
    const mark = el('span', 'bot-req-g', 'G');
    mark.setAttribute('aria-hidden', 'true');
    const nos = g.seats.flatMap((s) => (s.no ? [s.no] : [])).sort();
    const range = nos.length > 1 ? `${nos[0]}〜${nos[nos.length - 1]}` : (nos[0] ?? '');
    const name = el('span', 'bot-req-group-name');
    name.append(el('b', '', g.team ? `グループ：${roleGroupLabel(g.team)}（${g.seats.length}体）` : `⬡ みんなに聞く（${g.seats.length}体）`), el('span', 'bot-req-no', range));
    const chip = el('span', `bot-req-chip ${g.complete ? 'chip-replied' : 'chip-working'}`, g.complete ? 'そろいました' : `回答あり ${g.replied}/${g.seats.length}`);
    chip.title = g.complete ? 'どの席も、回答あり・エラー・待つのをやめた のどれかになりました' : `送信済み ${g.sent}/${g.seats.length}・回答あり ${g.replied}`;
    const first = Math.min(...g.seats.map((s) => s.createdAt ?? Infinity));
    top.append(mark, name, chip, el('time', 'bot-log-time', Number.isFinite(first) ? timeOf(first) : ''));
    card.append(top);
    this.wantSummary(g);
    const leadId = g.team ? this.state?.teams?.[g.team]?.lead : undefined;
    const lead = leadId ? this.state?.bots.find((b) => b.id === leadId) : undefined;
    if (lead) card.append(this.handoffButton(g, lead.name));
    if (g.summary) card.append(this.summaryBox(g));
    const head = items.find((i) => i.head && i.requestId !== g.summary?.requestId)?.head;
    if (head) card.append(el('div', 'bot-req-head', `「${head}${[...head].length >= 40 ? '…' : ''}」`));
    const dots = el('div', 'bot-req-dots');
    dots.setAttribute('role', 'list');
    dots.setAttribute('aria-label', g.team ? '役ごとの状態' : '席ごとの状態');
    g.seats.forEach((seat, i) => dots.append(this.seatDot(seat, i, items)));
    card.append(dots);
    const working = items.find((i) => i.state === 'working' && i.title && i.requestId !== g.summary?.requestId);
    if (!g.complete && working?.title) card.append(el('div', 'bot-req-title', `${working.role ?? this.targetName(working.botId)}：${working.title}`));
    if ((g.complete || g.summary) && g.replied > 0) card.append(...this.groupRead(g));
    return card;
  }

  // 席の小さな点（送信前・送信済み・調査中・回答あり・遅れ・エラー・待つのをやめた）。押すとそのボットのやり取りへ
  private seatDot(seat: BotGroupSeat, i: number, items: BotRequestBrief[]): HTMLElement {
    const label = botGroupSeatLabel(seat.state);
    const who = this.targetName(seat.botId, seat.role);
    const b = el('button', `bot-req-dot dot-${seat.state}`);
    b.type = 'button';
    b.setAttribute('role', 'listitem');
    b.dataset.key = `dot-${seat.requestId ?? `${seat.botId}-${i}`}`;
    const dot = el('span', 'bot-req-dot-mark');
    dot.setAttribute('aria-hidden', 'true');
    b.append(dot, el('span', 'bot-req-dot-name', seat.role ?? this.state?.bots.find((x) => x.id === seat.botId)?.name ?? `席${i + 1}`));
    b.title = `${i + 1}. ${who}${seat.no ? ` ${seat.no}` : ''}：${label}`;
    b.setAttribute('aria-label', `${b.title}。押すとこのボットのやり取りを下で見ます`);
    b.addEventListener('click', () => {
      const item = items.find((r) => r.requestId === seat.requestId);
      if (item) this.openRequest(item);
      else this.openBot(seat.botId);
    });
    return b;
  }

  // 「まとめて読む」：返事を席（役）の順に並べるだけ（AI でまとめ直さない。文字としてだけ出す）
  private groupRead(g: BotGroupStatus): HTMLElement[] {
    const open = this.groupOpen.has(g.group);
    const button = el('button', 'bot-req-read-toggle', open ? '閉じる' : `まとめて読む（${g.replied} 通）`);
    button.type = 'button';
    button.dataset.key = `read-${g.group}`;
    button.setAttribute('aria-expanded', String(open));
    button.title = g.team ? '組の返事を、役の順に並べて出します（並べるだけ。まとめ役へは渡しません）' : '組の返事を、席（役）の順に並べて出します（並べるだけ。まとめ直しはしません）';
    button.addEventListener('click', () => {
      if (this.groupOpen.has(g.group)) {
        this.groupOpen.delete(g.group);
        // まとめの文は、たたんでも残す（消すと「読み込んでいます」のまま戻らない）
        const kept = (this.groupReplies.get(g.group) ?? []).filter((r) => r.summary);
        if (kept.length) this.groupReplies.set(g.group, kept);
        else this.groupReplies.delete(g.group);
      } else {
        this.groupOpen.add(g.group);
        this.host.askLeft({ command: 'botGroupRead', group: g.group });
      }
      this.render();
    });
    if (!open) return [button];
    const replies = this.groupReplies.get(g.group);
    const box = el('div', 'bot-req-read');
    const members = (replies ?? []).filter((r) => !r.summary);
    if (!replies) box.append(el('div', 'bot-panel-empty', '返事を読み込んでいます…'));
    else if (!members.length) box.append(el('div', 'bot-panel-empty', '返事が記録に見つかりませんでした（古いやり取りかもしれません）'));
    for (const r of members) {
      const part = el('section', `bot-req-part${r.type === 'error' ? ' error' : ''}`);
      part.dataset.fileId = r.fileId;
      const h = el('div', 'bot-req-part-head');
      h.append(el('b', '', this.targetName(r.botId, r.role)), el('span', 'bot-req-no', r.no), el('time', 'bot-log-time', timeOf(r.at)));
      part.append(h);
      if (r.title) part.append(el('div', 'bot-msg-title', r.title));
      if (r.type === 'error' && r.error) part.append(el('div', 'bot-msg-error', `${ERROR_LABELS[r.error.code] ?? r.error.code}${r.error.message ? `：${r.error.message}` : ''}`));
      if (r.text) part.append(el('div', 'bot-msg-text', r.text)); // 文字としてだけ（textContent）
      if (r.shownCut) part.append(el('div', 'bot-msg-cut', `✂ ここには最初の ${THREAD_SHOW_CHARS.toLocaleString()} 字だけ出しています`));
      box.append(part);
    }
    return [button, box];
  }

  // まとめの返事を、届いたら取りに行く（1つの依頼につき1回）
  private wantSummary(g: BotGroupStatus) {
    const id = g.summary?.requestId;
    const state = g.summary?.state;
    if (!id || (state !== 'replied' && state !== 'error')) return;
    const key = `${g.group}:${id}`;
    if (this.summaryAsked.has(key)) return;
    this.summaryAsked.add(key);
    this.host.askLeft({ command: 'botGroupRead', group: g.group });
  }

  // 「まとめ役に渡す」。1通でも届いていれば押せる。押しても、コピーするまでアプリは開かない
  private handoffButton(g: BotGroupStatus, leadName: string): HTMLButtonElement {
    const got = g.seats.some((seat) => seat.state === 'replied');
    const button = el('button', 'bot-req-read-toggle', `まとめ役に渡す（${leadName}）`);
    button.type = 'button';
    button.dataset.key = `handoff-${g.group}`;
    button.disabled = !got;
    button.title = got
      ? '届いた返事を役の順に並べ、まとめ役への依頼を小窓に入れます。届いていない役は「まだ届いていません」と書きます。コピーするまでアプリは開きません'
      : '返事が1通届いてから押せます';
    button.addEventListener('click', () => this.host.askLeft({ command: 'botTeamHandoff', group: g.group }));
    return button;
  }

  // まとめ役の返事（カードの上）。元の返事は下の「まとめて読む」
  private summaryBox(g: BotGroupStatus): HTMLElement {
    const seat = g.summary;
    const box = el('div', 'bot-req-summary');
    if (!seat) return box;
    const head = el('div', 'bot-req-part-head');
    head.append(el('b', '', 'まとめ'), el('span', 'bot-req-to', this.targetName(seat.botId)), ...(seat.no ? [el('span', 'bot-req-no', seat.no)] : []));
    box.append(head);
    const key = `${g.group}:${seat.requestId ?? ''}`;
    const reply = (this.groupReplies.get(g.group) ?? []).find((r) => r.summary && r.requestId === seat.requestId);
    if (seat.state === 'replied' || seat.state === 'error') {
      if (!reply) box.append(el('div', 'bot-panel-empty', this.summaryMiss.has(key) ? 'まとめの返事が記録に見つかりませんでした' : 'まとめを読み込んでいます…'));
      else {
        if (reply.title) box.append(el('div', 'bot-msg-title', reply.title));
        if (reply.type === 'error' && reply.error) box.append(el('div', 'bot-msg-error', `${ERROR_LABELS[reply.error.code] ?? reply.error.code}${reply.error.message ? `：${reply.error.message}` : ''}`));
        if (reply.text) box.append(el('div', 'bot-req-summary-text', reply.text));
        if (reply.shownCut) box.append(el('div', 'bot-msg-cut', `✂ ここには最初の ${THREAD_SHOW_CHARS.toLocaleString()} 字だけ出しています`));
      }
    } else box.append(el('div', 'bot-panel-empty', `まとめ役の返事を待っています（${botGroupSeatLabel(seat.state)}）`));
    return box;
  }

  // 一覧のカードを押した：返事があれば下のやり取りでそのカードへ、無ければそのボットのやり取りへ
  private openRequest(item: BotRequestBrief) {
    if (item.final && this.openMessage(item.botId, item.final.fileId, () => this.host.toast('この返事は、いまのやり取りの写しには出ていません（古いやり取りです）'))) return;
    this.openBot(item.botId);
  }

  private openBot(botId: string) {
    if (!this.state?.bots.some((b) => b.id === botId)) {
      this.host.toast('このボットは台帳にいません（やり取りは出せません）');
      return;
    }
    this.revealStatus = true;
    if (botId !== this.botId) this.choose(botId);
    else this.render();
  }

  // 状態の1行と「コピーしてアプリを開く…」
  private statusRow(bot: BotBrief): HTMLElement {
    const row = el('div', 'bot-panel-status');
    const state = this.fullState(bot);
    const brief = this.brief(bot.id);
    const pill = el('span', `bot-panel-state state-${state}`, botFullStateLabel(state));
    pill.title = `「${bot.name}」の今の状態`;
    row.append(el('b', 'bot-panel-name', bot.name), pill);
    const counts = [brief?.waiting ? `待っている ${brief.waiting}` : '', brief?.unread ? `まだ読んでいない ${brief.unread}` : ''].filter(Boolean).join('・');
    if (counts) row.append(el('span', 'bot-panel-counts', counts));
    if (this.host.copyAndOpen && bot.agentId && this.state?.inbox?.owner !== false) {
      const copy = el('button', 'bot-panel-copy', 'コピーしてアプリを開く…');
      copy.type = 'button';
      copy.dataset.key = 'copy';
      copy.title = '頼む文を書くと、依頼（番号つき）にしてクリップボードに入れ、Grok Bot アプリのチャットを開きます（貼って送るのは自分で）';
      const copyAndOpen = this.host.copyAndOpen;
      copy.addEventListener('click', () => copyAndOpen(bot.id));
      row.append(copy);
    }
    return row;
  }

  // 待っている依頼（遅れていても待つ。「待つのをやめる」は2段階）
  private waitingList(bot: BotBrief, waiting: BotThreadRequest[]): HTMLElement {
    const box = el('div', 'bot-panel-waiting');
    box.append(el('div', 'bot-panel-subtitle', '待っている依頼'));
    for (const r of waiting) {
      const row = el('div', `bot-wait${r.late ? ' late' : ''}`);
      const minutes = Math.max(0, Math.round((Date.now() - r.createdAt) / 60_000));
      row.append(el('b', 'bot-wait-no', r.no), el('span', 'bot-wait-text', `${timeOf(r.createdAt)} から ${minutes} 分${r.progress ? `・途中経過 ${r.progress}` : ''}`));
      if (r.late) row.append(el('span', 'bot-pill warn', '遅れています'));
      const confirming = this.confirmStop === r.requestId;
      const stop = el('button', confirming ? 'bot-wait-stop danger' : 'bot-wait-stop', confirming ? '本当にやめる' : '待つのをやめる');
      stop.type = 'button';
      stop.dataset.key = `stop-${r.requestId}`;
      stop.title = confirming
        ? 'もう一度押すと、この依頼を待つのをやめます'
        : 'この依頼を待つのをやめます（ボットの作業は止められません。あとから届いた返事は、薄く出します）';
      if (confirming) armConfirm(stop, () => {
        this.confirmStop = null;
        this.render();
      });
      stop.addEventListener('click', () => {
        if (this.confirmStop !== r.requestId) {
          this.confirmStop = r.requestId;
          this.render();
          return;
        }
        this.confirmStop = null;
        this.host.askLeft({ command: 'botStopWaiting', botId: bot.id, requestId: r.requestId });
        this.host.toast(`依頼 ${r.no} を待つのをやめました（あとから届いた返事は薄く出します）`);
      });
      row.append(stop);
      box.append(row);
    }
    return box;
  }

  // やり取り（古いものから。role="log"）
  private log(bot: BotBrief, thread: BotThreadView): HTMLElement {
    const log = el('div', 'bot-log');
    log.setAttribute('role', 'log');
    log.setAttribute('aria-label', `「${bot.name}」とのやり取り`);
    log.setAttribute('aria-live', 'polite');
    if (thread.earlier) log.append(el('div', 'bot-log-note', 'これより前のやり取りは出していません（記録には残っています）'));
    if (!thread.items.length) log.append(el('div', 'bot-panel-empty', 'まだやり取りがありません。「コピーしてアプリを開く…」で依頼を作り、アプリのチャットに貼って送ると、返事がここに届きます'));
    const unread = new Set(thread.requests.filter((r) => r.final && !r.final.read && !r.final.faint).map((r) => r.final?.fileId));
    for (const item of thread.items) log.append(this.item(item, unread));
    return log;
  }

  private item(item: BotThreadItem, unread: Set<string | undefined>): HTMLElement {
    if (item.kind === 'request') {
      const row = el('div', 'bot-log-line out');
      // 送り方（R11）：中継へ直接・コピーしてアプリで。届かずコピーへ切り替えた 2 回目は、そう書く
      const how = item.hook ? '中継へ直接送った' : 'コピーしてアプリで送る';
      const said = item.attempt && item.attempt > 1 ? `${item.no} を同じ依頼でもう一度頼みました（${item.attempt} 回目。中継に届かなかったので、${how}）` : `${item.no} を頼みました（頼む文 ${item.textChars} 字。${how}）`;
      row.append(el('span', 'bot-log-dir', '→'), el('span', '', said), el('time', 'bot-log-time', timeOf(item.at)));
      return row;
    }
    if (item.kind === 'stopped') {
      const row = el('div', 'bot-log-line muted');
      row.append(el('span', '', item.notCopied ? `${item.no} はコピーできなかったので、取り消しました` : `${item.no} を待つのをやめました`), el('time', 'bot-log-time', timeOf(item.at)));
      return row;
    }
    const message = this.message(item, unread.has(item.fileId));
    if (!item.folded) return message;
    // ② 同じ依頼への2通目からの終わりの返事：1通目の下にたたむ（札には足さない）
    const fold = el('details', 'bot-msg-fold');
    fold.append(el('summary', '', `もう1通届きました（${item.no ?? ''} の送り直しの分かもしれません）`), message);
    return fold;
  }

  private message(m: BotThreadMessage, unread: boolean): HTMLElement {
    if (m.type === 'reply' && !m.grey) return this.answerCard(m, unread); // 確かめの済んだ返事だけ回答カードに（S3.10）
    const box = el('article', ['bot-msg', `type-${m.type}`, m.grey ? 'grey' : '', m.faint ? 'faint' : '', unread ? 'unread' : ''].filter(Boolean).join(' '));
    const head = el('div', 'bot-msg-head');
    const kind = m.type === 'reply' ? '返事' : m.type === 'progress' ? '途中経過' : m.type === 'error' ? 'エラー' : '知らせ';
    head.append(el('span', 'bot-log-dir', '←'), el('b', '', `${kind}${m.no ? ` ${m.no}` : ''}${m.step ? `（${m.step.n}${m.step.of ? `/${m.step.of}` : ''}）` : ''}`));
    if (m.grey) {
      const g = GREY_LABELS[m.match] ?? GREY_LABELS.unknownVersion;
      head.append(pill('bot-pill grey', g.label, g.hint));
    } else {
      head.append(pill('bot-pill match', '依頼と合っています ✓', MATCH_HINT));
    }
    if (m.late) head.append(pill('bot-pill warn', '遅れて届きました', '待ち始めてから、遅れている時間を過ぎて届きました'));
    if (m.faint) head.append(pill('bot-pill', '待つのをやめたあと', '待つのをやめた依頼に届いた返事です'));
    if (m.afterDone) head.append(pill('bot-pill', '終わったあとの途中経過', '終わった依頼に届いた途中経過です（状態は戻しません）'));
    if (unread) head.append(pill('bot-pill new', '新着', 'まだ読んでいない返事'));
    const vision = this.botId ? this.host.vision?.(this.botId, m.fileId) : undefined;
    if (vision) head.append(this.visionPill(vision));
    // 本文（S3.9）：確かめの済んだ reply と progress は Markdown を整えて出す。灰色（確かめられない返事は見た目を整えない）・エラー・知らせは文字のまま
    const md =
      m.text && !m.grey && (m.type === 'reply' || m.type === 'progress')
        ? renderBotMarkdown(m.text, { openLink: (url, from) => this.confirmLink(url, 'リンク', from), keyPrefix: `md-${m.fileId}` })
        : null;
    const raw = this.rawShown.has(m.fileId);
    if (md?.formatted) head.append(this.rawToggle(m.fileId, raw)); // 段落と改行だけなら、元の文と同じなので出さない
    head.append(el('time', 'bot-log-time', timeOf(m.at)));
    box.dataset.fileId = m.fileId;
    box.append(head);
    if (m.title) box.append(el('div', 'bot-msg-title', m.title));
    if (m.type === 'error' && m.error) box.append(el('div', 'bot-msg-error', `${ERROR_LABELS[m.error.code] ?? m.error.code}${m.error.message ? `：${m.error.message}` : ''}`));
    if (md && !raw) box.append(md.element);
    else if (m.text) box.append(el('div', 'bot-msg-text', m.text)); // 文字としてだけ（textContent）
    const cut = cutNote(m);
    if (cut) box.append(cut);
    const links = this.links(m);
    if (links) box.append(links);
    if (m.type !== 'progress') {
      const memos = this.suggestions(m);
      if (memos) box.append(memos);
      box.append(this.memoActions(m));
    }
    if (m.type === 'reply' && m.grey && m.text) box.append(this.showNext(m));
    return box;
  }

  // ---------- 回答カード（S3.10） ----------

  // 確かめの済んだ reply のカード：見出し（G・Grok の回答 #番号・札・時刻）／（設定でオンなら）頼む文の頭／題／本文（要約・残り・注意）／出典のチップ／ボタン3つ／結果の1行
  private answerCard(m: BotThreadMessage, unread: boolean): HTMLElement {
    const brief = m.requestId ? this.state?.requests?.items.find((i) => i.requestId === m.requestId) : undefined;
    const box = el('article', ['bot-msg', 'type-reply', 'bot-card', this.cosmic ? 'cosmic' : '', m.faint ? 'faint' : '', unread ? 'unread' : ''].filter(Boolean).join(' '));
    box.dataset.fileId = m.fileId;
    box.setAttribute('aria-label', `Grok の回答${m.no ? ` ${m.no}` : ''}`);
    const parts = botAnswerParts(m.text);
    const raw = this.rawShown.has(m.fileId);
    const openLink = (url: string, from: HTMLElement) => this.confirmLink(url, 'リンク', from);
    const md = (text: string, key: string) => renderBotMarkdown(text, { openLink, keyPrefix: `${key}-${m.fileId}` });
    const bodyMd = parts.body ? md(parts.body, 'md') : null;

    const head = el('div', 'bot-msg-head bot-card-head');
    const g = el('span', 'bot-card-g', 'G');
    g.setAttribute('aria-hidden', 'true');
    head.append(g, el('b', 'bot-card-title', `Grok の回答${m.no ? ` ${m.no}` : ''}`), pill('bot-pill match', '依頼と合っています ✓', MATCH_HINT));
    if (m.late) head.append(pill('bot-pill warn', '遅れて届きました', '待ち始めてから、遅れている時間を過ぎて届きました'));
    if (m.faint) head.append(pill('bot-pill', '待つのをやめたあと', '待つのをやめた依頼に届いた返事です'));
    if (unread) head.append(pill('bot-pill new', '新着', 'まだ読んでいない返事'));
    // 返し先「六角メモにも届く」（R10）の依頼：写す前は「六角メモにも届く」、写したら「六角メモに写しました」
    if (brief?.deliverTo === 'hex') {
      head.append(
        brief.delivered
          ? pill('bot-pill hex done', '⬡ 六角メモに写しました', brief.delivered.note)
          : pill('bot-pill hex', '⬡ 六角メモにも届く', '返し先「六角メモにも届く」の依頼です。確かめが通った返事を、ブラウザが六角メモ（相棒の設定で選んだノート）に 1 マス写します（2 回は写しません）'),
      );
    }
    if (this.cosmic) {
      const badge = el('span', 'bot-card-badge', 'Grok!');
      badge.setAttribute('aria-hidden', 'true'); // 飾りだけ（巣の設定でオン）
      head.append(badge);
    }
    const vision = this.botId ? this.host.vision?.(this.botId, m.fileId) : undefined;
    if (vision) head.append(this.visionPill(vision));
    if (parts.found || parts.vision || parts.light || bodyMd?.formatted) head.append(this.rawToggle(m.fileId, raw));
    head.append(el('time', 'bot-log-time', timeOf(m.at)));
    box.append(head);
    const about = brief?.head;
    if (about) box.append(el('div', 'bot-card-about', `「${about}${[...about].length >= 40 ? '…' : ''}」への回答`));
    if (brief?.thread && this.state?.requests) {
      // 糸（R5）：この依頼がどの糸のどこにあるか
      const info = this.threadInfo(brief.thread, this.state.requests.items);
      const line = el('div', 'bot-card-thread', `糸：${info.name}（${info.chain}）`);
      line.title = '続きとして頼んだ依頼の並び。受け取り箱の一覧で、糸ごとに最初の問いから読めます';
      box.append(line);
    }
    if (m.title) box.append(el('div', 'bot-msg-title', m.title));

    const inner = el('div', 'bot-card-body');
    if (raw) {
      if (m.text) inner.append(el('div', 'bot-msg-text', m.text)); // 届いたままの文（textContent）
    } else {
      // 軽い返事（R9）：一行の答え・次の一手・どのくらい確か（見出しがあったものだけ。中は今までの Markdown 表示）
      const light: [string, string, string][] = [
        ['一行の答え', parts.oneLine, 'one'],
        ['次の一手', parts.next, 'next'],
        ['どのくらい確か', parts.confidence, 'sure'],
      ];
      if (light.some(([, text]) => text)) {
        const dl = el('dl', 'bot-card-light');
        dl.setAttribute('aria-label', '軽い返事');
        for (const [label, text, key] of light) {
          if (!text) continue;
          const dd = el('dd');
          dd.append(md(text, key).element);
          dl.append(el('dt', '', label), dd);
        }
        inner.append(dl);
      }
      if (parts.summary) {
        const s = md(parts.summary, 'sum');
        s.element.classList.add('bot-card-summary');
        const label = el('span', 'bot-card-label', '要約：');
        const first = s.element.firstElementChild;
        if (first) first.prepend(label);
        else s.element.prepend(label);
        inner.append(s.element);
      }
      if (bodyMd) inner.append(bodyMd.element);
      if (parts.caution) {
        const c = el('div', 'bot-card-caution');
        c.setAttribute('role', 'note');
        c.setAttribute('aria-label', '注意');
        const mark = el('span', 'bot-card-caution-mark', '⚠');
        mark.setAttribute('aria-hidden', 'true');
        c.append(mark, md(parts.caution, 'warn').element);
        inner.append(c);
      }
    }
    if (inner.childElementCount) box.append(inner);
    const cut = cutNote(m);
    if (cut) box.append(cut);
    // 出典のチップ（見出しのある返事だけ。見出しが無い・元の文のときは、今までどおりのリンクの並び）
    const chips = parts.found && !raw ? this.sourceChips(m, parts) : null;
    if (chips) box.append(chips.element);
    const links = this.links(m, !chips?.usedLinks);
    if (links) box.append(links);
    box.append(this.cardActions(m));
    const next = this.cardNext(m);
    if (next) box.append(next);
    // 六角メモへ送った返事：左の知らせ（この窓のあいだ）か、自動で写した依頼なら delivered の 1 行（R10）か、今までの「保存しました」
    const note =
      this.cardNotes.get(m.fileId) ?? (m.sent.includes('hex') ? (brief?.delivered?.note ?? `六角メモ${this.hexBoard() ? `「${this.hexBoard()}」ノート` : ''}に保存しました ✓`) : '');
    if (note) {
      const line = el('div', 'bot-card-note', note);
      line.setAttribute('role', 'status');
      box.append(line);
    }
    const memos = this.suggestions(m);
    if (memos) box.append(memos);
    box.append(this.memoActions(m, false));
    return box;
  }

  // 出典：links があれば links、無ければ「## 出典」の中のリンク（http(s) だけ）。チップはドメイン名。リンクの無い出典は文字だけのチップ
  private sourceChips(m: BotThreadMessage, parts: BotAnswerParts): { element: HTMLElement; usedLinks: boolean } | null {
    const fromLinks = (m.links ?? []).flatMap((l) => {
      const url = safeHttpUrl(l.url);
      return url ? [{ url, label: l.title ?? '' }] : [];
    });
    const list: { url: string | null; label: string }[] = fromLinks.length ? fromLinks : parts.sources;
    if (!list.length) return null;
    const row = el('div', 'bot-card-sources');
    const label = el('span', 'bot-card-sources-label', '出典');
    row.append(label);
    const chips = el('ul', 'bot-card-chips');
    chips.setAttribute('aria-label', '出典');
    list.forEach((s, i) => {
      const li = el('li');
      if (s.url) {
        const host = hostOf(s.url);
        const b = el('button', 'bot-card-chip', host);
        b.type = 'button';
        b.dataset.key = `src-${m.fileId}-${i}`;
        b.title = `${s.label && s.label !== host ? `${s.label}\n` : ''}${s.url}\n押すと、ドメイン（${host}）を見せてから開きます`;
        b.setAttribute('aria-label', `出典：${s.label || host}（${host}）。押すとドメインを見せてから開きます`);
        b.addEventListener('click', () => this.confirmLink(s.url ?? '', '出典', b));
        li.append(b);
      } else {
        const t = el('span', 'bot-card-chip plain', s.label);
        t.title = `${s.label}（リンクの無い出典。文字だけ）`;
        li.append(t);
      }
      chips.append(li);
    });
    row.append(chips);
    return { element: row, usedLinks: fromLinks.length > 0 };
  }

  // 回答カードのボタン：⬡ 六角メモで開く・タブに残す・もう一度 ▾（R9。続けて聞くはこの中）・印（R9）
  private cardActions(m: BotThreadMessage): HTMLElement {
    const row = el('div', 'bot-card-actions');
    const button = (label: string, key: string, hint: string, run: (b: HTMLButtonElement) => void, extra = '') => {
      const b = el('button', ['bot-card-button', extra].filter(Boolean).join(' '), label);
      b.type = 'button';
      b.dataset.key = `card-${key}-${m.fileId}`;
      b.title = hint;
      b.addEventListener('click', () => run(b));
      row.append(b);
      return b;
    };
    const hexSent = m.sent.includes('hex');
    const board = this.hexBoard();
    const hex = button(
      hexSent ? '⬡ 六角メモに保存済み ✓' : '⬡ 六角メモで開く',
      'hex',
      hexSent
        ? 'この返事は、もう六角メモへ送ってあります（2回は送りません）'
        : `六角メモの${board ? `「${board}」ノート` : '決まったノート（相棒の設定の「六角メモへ」で選んだ送り先）'}に、この返事を保存します（今の「六角メモへ」と同じ。タグ GrokBot・ボットの名前。画像は送りません）`,
      (b) => this.toMemo(m, 'hex', undefined, b),
      'primary',
    );
    hex.disabled = hexSent;
    const tabbed = this.tabbed.has(m.fileId);
    button(
      tabbed ? 'タブに残した ✓' : 'タブに残す',
      'tab',
      '依頼に付けたページのタブがまだあれば、そのタブのメモに要約と出典を残します（無ければ右のメモへ）',
      () => {
        const botId = this.botId;
        if (!botId) return;
        this.tabbed.add(m.fileId);
        this.host.askLeft({ command: 'botToTab', botId, fileId: m.fileId });
        this.render();
      },
    );
    // 段 D6：出どころのカードがある返事だけ。押すまで台帳は変わらない。複数なら番号つき（1 から）
    const origins = this.originsOf(m.requestId);
    origins.forEach((_, i) => {
      button(
        origins.length === 1 ? 'カードにする' : `カードにする（${i + 1}）`,
        `tocard-${i}`,
        '押すまで台帳は変わりません。新しい一番上のカードを足し、元のカードから関連「補足」を 1 本引きます',
        () => {
          const botId = this.botId;
          if (!botId) return;
          this.host.askLeft({ command: 'botToCard', botId, fileId: m.fileId, origin: i });
        },
      );
    });
    const again = button('もう一度 ▾', 'again', '同じ子に続けて聞く・別の子へ渡す・言い換えてもう一回・頼み方を直す（どれも小窓を開くだけ。送るのは小窓から）', (b) => this.againMenu(m, b));
    again.setAttribute('aria-haspopup', 'menu');
    again.disabled = !this.host.followUp && !this.host.askAgain;
    row.append(this.markButtons(m));
    return row;
  }

  // 一覧の写しにある、その依頼の要約（無ければ undefined。新しい 30 件まで）
  private briefOf(requestId: string | undefined): BotRequestBrief | undefined {
    return requestId ? this.state?.requests?.items.find((i) => i.requestId === requestId) : undefined;
  }

  // 段 D6：その依頼の出どころ。やり取りの写しを先に、無ければ一覧（30 件）。文は持たない
  private originsOf(requestId: string | undefined) {
    if (!requestId) return [];
    const fromThread = this.thread?.requests.find((request) => request.requestId === requestId)?.origin;
    if (fromThread?.length) return fromThread;
    return this.briefOf(requestId)?.origin ?? [];
  }

  // もう一度 ▾（R9・見本 ④）：同じ子に続けて聞く（今までの「続けて聞く」）・別の子へ渡す・言い換えてもう一回・頼み方を直す
  private againMenu(m: BotThreadMessage, from: HTMLElement) {
    const botId = this.botId;
    if (!botId) return;
    const no = m.no ?? '前の回答';
    const line = botAnswerLine(m.text);
    const brief = this.briefOf(m.requestId);
    const ask = this.host.askAgain;
    const item = m.requestId
      ? { botId, requestId: m.requestId, no, ...(brief?.head ? { head: brief.head } : {}), ...(brief?.role ? { role: brief.role } : {}), ...(brief?.presetIds?.length ? { presetIds: brief.presetIds } : {}) }
      : null;
    const rect = from.getBoundingClientRect();
    this.host.menu.open(rect.left, rect.bottom + 2, [
      { section: `${no} をもう一度（小窓を開くだけ）` },
      {
        label: '同じ子に続けて聞く',
        hint: `小窓が開き、頭に「${no} の続き」。要点の行は印で選べます（同じ糸に束なります）`,
        disabled: !this.host.followUp,
        run: () => void this.host.followUp?.(botId, `${no} の続き：${line}\n`, m.requestId), // 続きの元（R5）
      },
      { label: '別の子へ渡す', hint: '返事の要点を添えた情報にして、巣の次の子へ。送る前に下の 1 行で確かめます', disabled: !ask || !item, run: () => item && void ask?.('pass', item, line) },
      { label: '言い換えてもう一回', hint: `自分で打ち直すか、定型の別の言い回しで。${no.replace(/-\d+$/, '')}-2 のような番号が付きます`, disabled: !ask || !item, run: () => item && void ask?.('retry', item, line) },
      { label: '頼み方を直す', hint: '役の文・定型・自分の文に分けて開きます（頼む文は、残っていれば最初の 40 字だけ）', disabled: !ask || !item, run: () => item && void ask?.('redo', item, line) },
    ]);
    this.host.menu.focusFirst();
  }

  // 印（R9・D19）：当たり／ずれ／宛て先違い。押すと付き、もう一度押すと外れる（左が pending.json と記録に書く。写しが届くと押した印が変わる）。
  //   使った定型と役に溜まる（説明に、この役の印の数。定型の数は R4b の棚に出る）
  private markButtons(m: BotThreadMessage): HTMLElement {
    const box = el('div', 'bot-card-marks');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', '返事の印（もう一度押すと外れます）');
    const botId = this.botId;
    const requestId = m.requestId;
    const brief = this.briefOf(requestId);
    const now = (requestId ? this.thread?.requests.find((r) => r.requestId === requestId)?.mark : undefined) ?? brief?.mark;
    const count = brief?.role ? this.state?.requests?.tally?.roles[brief.role] : undefined;
    const tally = count ? `（役「${brief?.role}」の印：当たり ${count.hits}・ずれ ${count.misses}・宛て先違い ${count.wrongTo}）` : '';
    for (const { mark, label, hint } of MARKS) {
      const on = now === mark;
      const b = el('button', `bot-card-mark mark-${mark}`, label);
      b.type = 'button';
      b.dataset.key = `mark-${mark}-${m.fileId}`;
      b.setAttribute('aria-pressed', String(on));
      b.disabled = !botId || !requestId;
      b.title = `${hint}。${on ? 'もう一度押すと外します' : '押すと印を付けます'}。印は、使った定型と役に溜まります${tally}`;
      b.addEventListener('click', () => {
        if (botId && requestId) this.host.askLeft({ command: 'botMark', botId, requestId, mark: on ? null : mark });
      });
      box.append(b);
    }
    return box;
  }

  // 確かめの済んだ返事だけ。単語帳へ・Deeper Dive・クイズにする（段階6）・教材にする（段階15）
  private cardNext(m: BotThreadMessage): HTMLElement {
    const box = el('div', 'bot-card-next');
    const row = el('div', 'bot-card-actions');
    const button = (label: string, key: string, hint: string, run: () => void) => {
      const b = el('button', 'bot-card-button', label);
      b.type = 'button';
      b.dataset.key = `next-${key}-${m.fileId}`;
      b.title = hint;
      b.addEventListener('click', () => run());
      row.append(b);
      return b;
    };
    button('単語帳へ', 'vocab', 'この返事を、言葉と意味のカードにして単語帳に入れます。入れる前に直せます。AI は使いません', () => void this.openVocab(m));
    button('Deeper Dive', 'dive', 'Deeper Dive。料金の目安を出してから、相棒に道具なしで1回だけ聞きます', () => void this.openDive(m));
    button('相棒に見せる', 'show', 'この返事を、相棒に道具なしで1回だけ説明してもらいます。全文は、道具が使える会話には入れません。料金の目安を出してから聞きます', () => void this.openShow(m));
    const quiz = button('クイズにする', 'quiz', 'この返事から、問いのカードの案を作ります。印を付けたものだけ単語帳に入ります', () => void this.openQuiz(m));
    if (this.follow?.fileId === m.fileId && this.follow.kind === 'quiz' && this.follow.making) quiz.disabled = true;
    const lesson = button(
      '教材にする',
      'lesson',
      'この返事から要点と問いを作ります。ページの本文は送りません。作るまで送りません。印を付けた問いは単語帳に入ります',
      () => void this.openLesson(m),
    );
    if (this.follow?.fileId === m.fileId && this.follow.kind === 'lesson' && this.follow.step === 'making') lesson.disabled = true;
    box.append(row);
    const extra = this.follow?.fileId === m.fileId ? this.followBox(m, this.follow) : null;
    if (extra) box.append(extra);
    return box;
  }

  private followBox(m: BotThreadMessage, follow: CardFollow): HTMLElement | null {
    if (follow.kind === 'vocab') return this.vocabBox(m, follow);
    if (follow.kind === 'dive') return this.diveBox(m, follow);
    if (follow.kind === 'show') return this.showBox(m, follow);
    if (follow.kind === 'lesson') return this.lessonBox(m, follow);
    return this.quizBox(m, follow);
  }

  // 灰色の返事（確かめられない返事）にも「相棒に見せる」だけ出す。途中経過・エラー・知らせには出さない
  private showNext(m: BotThreadMessage): HTMLElement {
    const box = el('div', 'bot-card-next');
    const row = el('div', 'bot-card-actions');
    const b = el('button', 'bot-card-button', '相棒に見せる');
    b.type = 'button';
    b.dataset.key = `next-show-${m.fileId}`;
    b.title = 'この返事を、相棒に道具なしで1回だけ説明してもらいます。全文は、道具が使える会話には入れません。料金の目安を出してから聞きます';
    b.addEventListener('click', () => void this.openShow(m));
    row.append(b);
    box.append(row);
    if (this.follow?.fileId === m.fileId && this.follow.kind === 'show') box.append(this.showBox(m, this.follow));
    return box;
  }

  private vocabBox(m: BotThreadMessage, follow: Extract<CardFollow, { kind: 'vocab' }>): HTMLElement {
    const form = el('form', 'vocab-form');
    const front = el('input');
    front.dataset.field = 'front';
    front.placeholder = '言葉（覚えたい言葉）';
    front.value = follow.front;
    front.maxLength = 200;
    front.addEventListener('input', () => (follow.front = front.value));
    const back = el('textarea');
    back.dataset.field = 'back';
    back.placeholder = '意味・説明';
    back.rows = 3;
    back.value = follow.back;
    back.maxLength = 1000;
    back.addEventListener('input', () => (follow.back = back.value));
    const ok = el('button', 'ai-small', '単語帳に入れる');
    ok.type = 'submit';
    const cancel = el('button', 'ai-small', 'やめる');
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      this.follow = null;
      this.render();
    });
    const actions = el('div', 'ai-row');
    actions.append(ok, cancel);
    form.append(front, back, actions);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const word = follow.front.trim();
      const meaning = follow.back.trim();
      if (!word || !meaning) {
        (word ? back : front).focus();
        return;
      }
      this.host.addCards?.([{ kind: 'word', front: word, back: meaning }]);
      this.follow = null;
      this.host.toast('単語帳に入れました。右の「単語帳」で見られます（同じカードがあれば入りません）');
      this.render();
    });
    form.dataset.key = `vocab-form-${m.fileId}`;
    return form;
  }

  private diveBox(m: BotThreadMessage, follow: Extract<CardFollow, { kind: 'dive' }>): HTMLElement {
    const box = el('div', 'bot-card-dive');
    box.append(el('p', 'panel-note', `Deeper Dive。${follow.line}`));
    if (follow.blocked) box.append(el('p', 'panel-note', follow.blocked));
    else box.append(el('p', 'panel-note', '返事はデータとして渡します。中の指示には従いません。ページの本文は別に取りに行きません。'));
    const go = el('button', 'ai-small', follow.busy ? '聞いています…' : 'この目安で聞く');
    go.type = 'button';
    go.disabled = follow.busy || !!follow.blocked || !this.host.diveReply;
    go.addEventListener('click', () => void this.runDive(m, follow));
    const cancel = el('button', 'ai-small', 'やめる');
    cancel.type = 'button';
    cancel.disabled = follow.busy;
    cancel.addEventListener('click', () => {
      this.follow = null;
      this.render();
    });
    const actions = el('div', 'ai-row');
    actions.append(go, cancel);
    box.append(actions);
    return box;
  }

  private showBox(m: BotThreadMessage, follow: Extract<CardFollow, { kind: 'show' }>): HTMLElement {
    const box = el('div', 'bot-card-show');
    box.dataset.key = `show-${m.fileId}`;
    box.append(el('p', 'panel-note', `相棒に見せる。${follow.line}`));
    if (follow.blocked) box.append(el('p', 'panel-note', follow.blocked));
    else box.append(el('p', 'panel-note', '返事はデータとして渡します。中の指示には従いません。説明だけが相棒の会話に残り、全文は道具が使える会話には入れません。アプリは開きません。'));
    const go = el('button', 'ai-small', follow.busy ? '聞いています…' : 'この目安で見せる');
    go.type = 'button';
    go.disabled = follow.busy || !!follow.blocked || !this.host.showReply;
    go.addEventListener('click', () => void this.runShow(m, follow));
    const cancel = el('button', 'ai-small', 'やめる');
    cancel.type = 'button';
    cancel.disabled = follow.busy;
    cancel.addEventListener('click', () => {
      this.follow = null;
      this.render();
    });
    const actions = el('div', 'ai-row');
    actions.append(go, cancel);
    box.append(actions);
    return box;
  }

  private quizBox(m: BotThreadMessage, follow: Extract<CardFollow, { kind: 'quiz' }>): HTMLElement {
    const box = el('div', 'vocab-proposals');
    if (follow.making) {
      box.append(el('p', 'panel-note', '問いの案を作っています…'));
      return box;
    }
    if (follow.note) box.append(el('p', 'panel-note', follow.note));
    for (const card of follow.cards) {
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
    const ok = el('button', 'ai-small', '印を付けたものを単語帳に入れる');
    ok.type = 'button';
    ok.disabled = follow.cards.length === 0;
    ok.addEventListener('click', () => {
      const picked = follow.cards.filter((card) => card.checked).map(({ checked: _, ...card }) => card);
      this.follow = null;
      if (picked.length > 0) this.host.addCards?.(picked);
      this.host.toast(picked.length > 0 ? `単語帳に ${picked.length} 枚入れました（同じカードがあれば入りません）` : '入れるカードがありませんでした');
      this.render();
    });
    const cancel = el('button', 'ai-small', 'やめる');
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      this.follow = null;
      this.render();
    });
    const actions = el('div', 'ai-row');
    actions.append(ok, cancel);
    box.append(actions);
    box.dataset.key = `quiz-${m.fileId}`;
    return box;
  }

  private async openVocab(m: BotThreadMessage) {
    if (this.follow?.fileId === m.fileId && this.follow.kind === 'vocab') {
      this.follow = null;
      this.render();
      return;
    }
    const text = await redactBlocked(m.text);
    const title = await redactBlocked(m.title);
    const parts = botAnswerParts(text);
    this.follow = { fileId: m.fileId, kind: 'vocab', front: clip(title || botAnswerLine(text, 80), 200), back: clip(parts.summary || parts.body || text, 1000) };
    this.render();
  }

  private async openDive(m: BotThreadMessage) {
    if (this.follow?.fileId === m.fileId && this.follow.kind === 'dive') {
      this.follow = null;
      this.render();
      return;
    }
    const budget = await loadBudget();
    const preview = this.host.diveEstimate?.([...m.text].length) ?? { name: '', line: '相棒に聞けません', practice: false };
    this.follow = { fileId: m.fileId, kind: 'dive', line: preview.line, blocked: budget.blocked ? budgetStopMessage(budget) : '', busy: false };
    this.render();
  }

  private async runDive(m: BotThreadMessage, follow: Extract<CardFollow, { kind: 'dive' }>) {
    if (this.follow !== follow || follow.busy || follow.blocked || !this.host.diveReply) return;
    follow.busy = true;
    this.render();
    try {
      const text = clip(await redactBlocked(m.text), 12_000, true);
      const ok = await this.host.diveReply(text);
      this.follow = null;
      this.host.toast(ok ? '相棒に聞きました。右サイドバーの下の相棒の会話に出ます。アプリは開いていません' : '相棒には聞けませんでした');
    } catch (error) {
      this.follow = null;
      this.host.toast(describeError(error));
    }
    this.render();
  }

  private async openShow(m: BotThreadMessage) {
    if (this.follow?.fileId === m.fileId && this.follow.kind === 'show') {
      this.follow = null;
      this.render();
      return;
    }
    const budget = await loadBudget();
    const preview = this.host.showEstimate?.([...m.text].length) ?? { name: '', line: '相棒に見せられません', practice: false };
    this.follow = { fileId: m.fileId, kind: 'show', line: preview.line, blocked: budget.blocked ? budgetStopMessage(budget) : '', busy: false };
    this.render();
  }

  private async runShow(m: BotThreadMessage, follow: Extract<CardFollow, { kind: 'show' }>) {
    if (this.follow !== follow || follow.busy || follow.blocked || !this.host.showReply) return;
    follow.busy = true;
    this.render();
    try {
      const text = clip(await redactBlocked(m.text), 12_000, true);
      if (!text.trim()) {
        this.follow = null;
        this.host.toast('この返事には、見せる文がありません');
        this.render();
        return;
      }
      const ok = await this.host.showReply(text);
      this.follow = null;
      this.host.toast(
        ok
          ? '相棒が説明しました。右サイドバーの下の会話に出ます。全文は、道具が使える会話には入れていません。アプリは開いていません'
          : '相棒には見せられませんでした',
      );
    } catch (error) {
      this.follow = null;
      this.host.toast(describeError(error));
    }
    this.render();
  }

  private lessonBox(m: BotThreadMessage, follow: Extract<CardFollow, { kind: 'lesson' }>): HTMLElement {
    const box = el('div', 'vocab-lesson');
    box.dataset.key = `lesson-${m.fileId}`;
    if (follow.step === 'making') {
      box.append(el('p', 'panel-note', '教材を作っています…'));
      return box;
    }
    if (follow.note) box.append(el('p', 'panel-note', follow.note));
    if (follow.step === 'confirm') {
      const go = el('button', 'ai-small', '作る');
      go.type = 'button';
      go.addEventListener('click', () => void this.runLesson(m, follow));
      const cancel = el('button', 'ai-small', 'やめる');
      cancel.type = 'button';
      cancel.addEventListener('click', () => {
        this.follow = null;
        this.render();
      });
      const actions = el('div', 'ai-row');
      actions.append(go, cancel);
      box.append(actions);
      return box;
    }
    if (follow.title) box.append(el('div', 'route-list-label', follow.title));
    if (follow.summary) box.append(el('p', 'panel-note', follow.summary));
    if (follow.points.length > 0) {
      const list = el('ul', 'vocab-points');
      for (const point of follow.points) list.append(el('li', '', point));
      box.append(list);
    }
    for (const card of follow.cards) {
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
    if (follow.summary || follow.points.length > 0 || follow.cards.length > 0) {
      box.append(el('p', 'panel-note', '問いは今の単語帳に入ります。要点は、今見ているシートのメモに残ります。'));
    }
    const ok = el('button', 'ai-small', '選んだ問いを単語帳へ');
    ok.type = 'button';
    ok.disabled = follow.cards.length === 0;
    ok.addEventListener('click', () => {
      const picked = follow.cards.filter((card) => card.checked).map(({ checked: _, ...card }) => card);
      if (picked.length > 0) this.host.addCards?.(picked);
      this.host.toast(picked.length > 0 ? `単語帳に ${picked.length} 枚入れました（同じカードがあれば入りません）` : '入れる問いに印を付けてください');
      if (picked.length > 0) this.render();
    });
    const keep = el('button', 'ai-small', '盤面に残す');
    keep.type = 'button';
    keep.disabled = !follow.summary && follow.points.length === 0 && follow.cards.length === 0;
    keep.addEventListener('click', () => {
      const text = formatLesson({
        title: follow.title,
        summary: follow.summary,
        points: follow.points,
        cards: follow.cards.filter((card) => card.checked),
      });
      this.host.askLeft({ command: 'addMemoCell', text, label: '教材' });
      this.host.toast('今見ているシートのメモに残すよう頼みました');
    });
    const cancel = el('button', 'ai-small', '閉じる');
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      this.follow = null;
      this.render();
    });
    const actions = el('div', 'ai-row');
    actions.append(ok, keep, cancel);
    box.append(actions);
    return box;
  }

  private async openLesson(m: BotThreadMessage) {
    if (this.follow?.kind === 'quiz' && this.follow.making) return;
    if (this.follow?.kind === 'lesson' && this.follow.step === 'making') return;
    if (this.follow?.fileId === m.fileId && this.follow.kind === 'lesson') {
      this.follow = null;
      this.render();
      return;
    }
    const settings = this.host.organizeSettings?.();
    if (!settings) return;
    this.follow = {
      fileId: m.fileId,
      kind: 'lesson',
      step: 'confirm',
      title: '',
      summary: '',
      points: [],
      cards: [],
      note: settings.practice
        ? '練習モードです。この返事から、決まった形の要点と問いを作ります。ページの本文は送りません。料金はかかりません。作るまで何も送りません。'
        : 'この返事から要点と問いを作ります。ページの本文は送りません。作るまで送りません。',
    };
    this.render();
  }

  private async runLesson(m: BotThreadMessage, follow: Extract<CardFollow, { kind: 'lesson' }>) {
    if (this.follow !== follow || follow.step !== 'confirm') return;
    const settings = this.host.organizeSettings?.();
    if (!settings) return;
    follow.step = 'making';
    this.render();
    try {
      const text = clip(await redactBlocked(m.text), 12_000, true);
      const title = clip(await redactBlocked(m.title), 200);
      if ([...usableLessonText(text)].length < 20) {
        if (this.follow !== follow) return;
        const blocked = text.includes('（渡し止めのアドレス）');
        this.follow = {
          fileId: m.fileId,
          kind: 'lesson',
          step: 'ready',
          title: '',
          summary: '',
          points: [],
          cards: [],
          note: blocked ? `${BLOCK_NOTE}。この返事は、渡し止めのアドレス以外に教材の材料がありません` : 'この返事から、教材にする文がありません',
        };
        this.render();
        return;
      }
      const fronts = this.host.existingFronts?.() ?? [];
      const known = new Set(fronts.map((front) => cardKey('quiz', front)));
      const result = await makeLesson({ title, url: '', text }, settings);
      const cards = result.cards.filter((card) => !known.has(cardKey(card.kind, card.front))).map((card) => ({ ...card, source: undefined, checked: true }));
      const cost = result.cost > 0 ? `（約 $${result.cost.toFixed(3)}）` : '';
      const near = result.near ? ` ${BUDGET_NEAR_NOTE}` : '';
      if (this.follow !== follow) return;
      this.follow = {
        fileId: m.fileId,
        kind: 'lesson',
        step: 'ready',
        title: result.title,
        summary: result.summary,
        points: result.points,
        cards,
        note: `教材ができました。印を付けた問いだけ単語帳に入ります${cost}${near}`,
      };
    } catch (error) {
      if (this.follow !== follow) return;
      this.follow = {
        fileId: m.fileId,
        kind: 'lesson',
        step: 'ready',
        title: '',
        summary: '',
        points: [],
        cards: [],
        note: lessonFailure(error),
      };
    }
    this.render();
  }

  private async openQuiz(m: BotThreadMessage) {
    if (this.follow?.kind === 'lesson' && this.follow.step === 'making') return;
    if (this.follow?.fileId === m.fileId && this.follow.kind === 'quiz' && !this.follow.making) {
      this.follow = null;
      this.render();
      return;
    }
    if (this.follow?.kind === 'quiz' && this.follow.making) return;
    const settings = this.host.organizeSettings?.();
    if (!settings) return;
    this.follow = { fileId: m.fileId, kind: 'quiz', making: true, cards: [], note: '' };
    this.render();
    try {
      const text = clip(await redactBlocked(m.text), 12_000, true);
      const title = clip(await redactBlocked(m.title), 200);
      if (!text.trim()) {
        this.follow = { fileId: m.fileId, kind: 'quiz', making: false, cards: [], note: 'この返事から、カードの材料になる文がありません' };
        this.render();
        return;
      }
      const fronts = this.host.existingFronts?.() ?? [];
      const known = new Set(fronts.flatMap((front) => [cardKey('word', front), cardKey('quiz', front)]));
      const result = await makeCards({ title, url: '', text, selection: '' }, fronts, settings);
      const cards = result.cards
        .filter((card) => !known.has(cardKey(card.kind, card.front)))
        .map((card) => ({ ...card, source: undefined, checked: true }));
      const cost = result.cost > 0 ? `（約 $${result.cost.toFixed(3)}）` : '';
      this.follow = {
        fileId: m.fileId,
        kind: 'quiz',
        making: false,
        cards,
        note: cards.length > 0 ? `${cards.length} 枚の案です。印を付けたものだけ入ります${cost}` : `新しいカードは作れませんでした${cost}`,
      };
    } catch (error) {
      this.follow = { fileId: m.fileId, kind: 'quiz', making: false, cards: [], note: followError(error) };
    }
    this.render();
  }

  // 六角メモの送り先のノートの名前（「アプリ › 親 › ノート」の最後）
  private hexBoard(): string {
    const label = this.host.hexTarget?.() ?? '';
    return label.split(' › ').pop() ?? '';
  }

  // 「元の文」（S3.9）：この返事だけ、Markdown を整えない届いたままの文（記号もそのまま・textContent）に切り替える。もう一度押すと戻る
  private rawToggle(fileId: string, raw: boolean): HTMLElement {
    const b = el('button', 'bot-msg-raw', '元の文');
    b.type = 'button';
    b.dataset.key = `raw-${fileId}`;
    b.setAttribute('aria-pressed', String(raw));
    b.title = raw ? '押すと、見出し・表・リンクなどを整えた表示に戻します' : '押すと、この返事だけ、届いたままの元の文（Markdown の記号もそのまま）で見ます';
    b.addEventListener('click', () => {
      if (this.rawShown.has(fileId)) this.rawShown.delete(fileId);
      else this.rawShown.add(fileId);
      this.render();
    });
    return b;
  }

  // 「Vision」札（S3.7b。札の表示だけ。受け取り箱の作り込みは S3.8）：押すと題名と「消す」（2回押す）のメニュー
  private visionPill(vision: Vision): HTMLElement {
    const b = el('button', 'bot-pill vision', 'Vision');
    b.type = 'button';
    b.dataset.key = `vision-${vision.id}`;
    b.title = `この返事から Grok Vision「${vision.title}」を残しました（月の窓に映ります）`;
    b.setAttribute('aria-label', `Vision：${vision.title}`);
    b.addEventListener('click', () => {
      const r = b.getBoundingClientRect();
      const entries: MenuEntry[] = [{ section: 'Grok Vision' }, { note: `${vision.title}\n${vision.points.map((p) => `・${p}`).join('\n')}` }];
      if (this.host.removeVision) {
        const remove = this.host.removeVision;
        entries.push({ row: 'この Vision を', buttons: [{ label: '消す', confirm: 'もう一度押すと消えます', aria: `Vision「${vision.title}」を消す`, run: () => remove(vision.id) }] });
      }
      this.host.menu.open(r.left, r.bottom + 2, entries);
    });
    return b;
  }

  // 返事をメモにする（押したときだけ。左が記録から読み直して置く）：メモのセル・右のメモ・六角メモ
  //   灰色の返事は「未確認」の印付き。六角メモへは、送る前に確かめ、送ったら「送った ✓」にして2回送らない
  //   回答カード（S3.10）では、六角メモはカードのボタンで送るので、ここには出さない（withHex false。メモのセル・右のメモは小さく残す）
  private memoActions(m: BotThreadMessage, withHex = true): HTMLElement {
    const row = el('div', withHex ? 'bot-msg-actions' : 'bot-msg-actions bot-card-more');
    const add = (label: string, to: 'cell' | 'right' | 'hex', hint: string) => {
      const sent = m.sent.includes(to);
      const b = el('button', '', to === 'hex' && sent ? '六角メモへ送った ✓' : `${label}${sent ? ' ✓' : ''}`);
      b.type = 'button';
      b.dataset.key = `memo-${m.fileId}-${to}`;
      b.title = hint;
      b.disabled = to === 'hex' && sent;
      b.addEventListener('click', () => this.toMemo(m, to, undefined, b));
      row.append(b);
    };
    add('メモのセルに', 'cell', `ボットのセルの隣に、メモのセルとして置きます（「ボットから届いた${m.grey ? '・未確認の' : ''}返事」の印付き）`);
    add('右のメモへ', 'right', '右のメモの区画で見ているシートに、メモとして置きます');
    if (withHex) add('六角メモへ', 'hex', '相棒の設定で選んだ六角メモのノートへ送ります（タグ GrokBot・ボットの名前。画像は送りません）');
    if (m.grey) row.append(pill('bot-pill unconfirmed', '未確認の印が付きます', 'メモにすると「未確認」のタグと印が付きます（六角メモへ送るときも）'));
    return row;
  }

  // 返事の「メモにしてね」の提案（人が押したときだけ、1件ずつメモのセルにする）
  private suggestions(m: BotThreadMessage): HTMLElement | null {
    if (!m.memos?.length) return null;
    const list = el('ul', 'bot-msg-memos');
    list.setAttribute('aria-label', 'ボットからのメモの提案');
    m.memos.forEach((memo, i) => {
      const li = el('li');
      li.append(el('span', '', `✎ ${memo.text}${memo.tags?.length ? `（${memo.tags.map((t) => `#${t}`).join(' ')}）` : ''}`));
      const b = el('button', '', 'メモにする');
      b.type = 'button';
      b.dataset.key = `suggest-${m.fileId}-${i}`;
      b.title = 'この提案を、ボットのセルの隣にメモのセルとして置きます';
      b.addEventListener('click', () => this.toMemo(m, 'cell', i, b));
      li.append(b);
      list.append(li);
    });
    return list;
  }

  private toMemo(m: BotThreadMessage, to: 'cell' | 'right' | 'hex', memo: number | undefined, from: HTMLElement) {
    const botId = this.botId;
    if (!botId) return;
    const run = () => this.host.askLeft({ command: 'botToMemo', botId, fileId: m.fileId, to, ...(memo !== undefined ? { memo } : {}) });
    if (to !== 'hex' || !m.grey) {
      run();
      return;
    }
    const rect = from.getBoundingClientRect();
    this.host.menu.open(rect.left, rect.bottom + 2, [
      { section: '確かめられない返事です。六角メモへ送りますか？' },
      { label: '「未確認」のタグを付けて送ります', disabled: true },
      { label: '送る', run },
      { label: 'やめる', run: () => undefined },
    ]);
    this.host.menu.focusFirst();
  }

  // リンク・画像・ファイル：押したときに、ドメインを見せてから開く。画像は読み込まない
  //   withLinks false：links は回答カードの出典のチップで出したので、ファイルと画像だけ
  private links(m: BotThreadMessage, withLinks = true): HTMLElement | null {
    const entries: { label: string; url: string; kind: string }[] = [
      ...(withLinks ? (m.links ?? []) : []).map((l) => ({ label: l.title ?? l.url, url: l.url, kind: 'リンク' })),
      ...(m.files ?? []).map((f) => ({ label: `${f.name}${f.size !== undefined ? `（${formatSize(f.size)}）` : ''}`, url: f.url, kind: 'ファイル' })),
      ...(m.images ?? []).map((i) => ({ label: `${i.alt ?? '画像'}（読み込みません）`, url: i.url, kind: '画像' })),
    ];
    if (!entries.length) return null;
    const list = el('ul', 'bot-msg-links');
    entries.forEach((entry, i) => {
      const li = el('li');
      const b = el('button', 'bot-msg-link', `${entry.kind}：${entry.label}`);
      b.type = 'button';
      b.dataset.key = `link-${m.fileId}-${i}`;
      b.append(el('span', 'bot-msg-host', hostOf(entry.url)));
      b.title = `押すと、ドメイン（${hostOf(entry.url)}）を見せてから開きます`;
      b.addEventListener('click', () => this.confirmLink(entry.url, entry.kind, b));
      li.append(b);
      list.append(li);
    });
    return list;
  }

  private confirmLink(url: string, kind: string, from: HTMLElement) {
    const rect = from.getBoundingClientRect();
    const entries: MenuEntry[] = [
      { section: `ボットの返事の${kind}を開きます` },
      { note: `ドメイン：${hostOf(url)}\n${url}` },
      { label: 'このドメインを確かめた。新しいタブで開く', run: () => this.host.askLeft({ command: 'openUrl', url, background: false }) },
      { label: 'やめる', run: () => undefined },
    ];
    this.host.menu.open(rect.left, rect.bottom + 2, entries);
    this.host.menu.focusFirst();
  }

  // 欄が見えていて開いているとき、そのボットのまだ読んでいない終わりの返事を「読んだ」にする（右上の札から外す）
  private markSeen() {
    if (!this.seen || this.folded || !this.botId || !this.thread || document.visibilityState !== 'visible') return;
    const ids = this.thread.requests.filter((r) => r.final && !r.final.read && !r.final.faint && !this.asked.has(r.requestId)).map((r) => r.requestId);
    if (!ids.length) return;
    for (const id of ids) this.asked.add(id);
    this.host.askLeft({ command: 'botMarkRead', botId: this.botId, requestIds: ids });
  }
}

// 切り詰めた返事：切ったことが分かる印と、全文は出さない旨
function cutNote(m: BotThreadMessage): HTMLElement | null {
  if (!m.shownCut && !m.cutOnReceive) return null;
  const notes = [
    m.shownCut ? `ここには最初の ${THREAD_SHOW_CHARS.toLocaleString()} 字だけ出しています（受け取ったのは ${m.chars.toLocaleString()} 字。全文はここには出しません）` : '',
    m.cutOnReceive ? '長すぎたので、受け取るときに 20,000 字で切りました（その先は受け取っていません）' : '',
  ].filter(Boolean);
  return el('div', 'bot-msg-cut', `✂ ${notes.join('。')}`);
}

function pill(className: string, text: string, hint: string): HTMLElement {
  const p = el('span', className, text);
  p.title = hint;
  p.tabIndex = 0; // キーボードでも説明を読めるように
  p.setAttribute('aria-label', `${text}。${hint}`);
  return p;
}

function followError(error: unknown): string {
  const described = describeError(error);
  if (described !== 'うまくいきませんでした') return described;
  return error instanceof Error && error.message ? error.message : described;
}

function clip(text: string, max: number, note = false): string {
  const chars = [...text.trim()];
  if (chars.length <= max) return chars.join('');
  const cut = chars.slice(0, max).join('');
  return note ? `${cut}\n…（長すぎるので、ここまで）` : cut;
}

// ドメイン（日本語などのドメインは xn-- の形のまま）
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '？';
  }
}

// 試し便の結果（R8）：往復の時間と照合の合否だけ。照合 ✓＝check の合う返事が届いた（ボットのエラーでも照合は通っている）。
//   check の合わない返事は、届いていれば添える（合う返事が無ければ ✗）
function pingResult(item: BotRequestBrief): string {
  if (!item.final) return '照合 ✗（確かめられない返事だけが届きました）';
  const trip = `往復 ${elapsedText(item.final.at - item.createdAt, true)}・照合 ✓`;
  return trip + (item.final.type === 'error' ? '（返事はエラー）' : '') + (item.pingMismatch ? '・合わない返事も届きました' : '');
}

// webhook で送った依頼の、中継の様子（R11）。コピーで送った・コピーへ切り替えた依頼は null（今までの伝票・追跡票のまま）。
//   sending：答えを待っている（送ってから 1 分まで）　unknown：答えの前に窓を閉じた（届いたかは分からない）　sent：受けた　failed：届かなかった
function hookState(item: BotRequestBrief, now: number): 'sending' | 'unknown' | 'sent' | 'failed' | null {
  if (item.via !== 'hook' || item.copiedAt) return null;
  if (!item.hook) return now - item.createdAt < 60_000 ? 'sending' : 'unknown';
  return item.hook.ok ? 'sent' : 'failed';
}

// 経過の言葉（R8 の伝票）。seconds：1 分より短いときは秒で（試し便の往復）
function elapsedText(ms: number, seconds = false): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (seconds && sec < 60) return `${sec} 秒`;
  const min = Math.floor(sec / 60);
  if (min < 1) return '1 分未満';
  if (min < 60) return `${min} 分`;
  return `${Math.floor(min / 60)} 時間 ${min % 60} 分`;
}

function timeOf(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toDateString() === now.toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function loadFolded(): boolean {
  try {
    return localStorage.getItem(FOLD_KEY) === 'folded';
  } catch {
    return false;
  }
}
