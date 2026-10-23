// ボットのセル：盤面から外の Grok Bot に頼む窓口（docs/bot-cells/plan.md）
//   ・ボットのセルは、メモのセルの一種（MemoCell.bot にボットの id）。セルが持つのは意味のない id だけ
//     この id の形は、メモのセルを読むとき（memocells.ts の parseMemo）にも確かめる
//     （確かめずに bot を落とすと、起動し直したときにふつうのメモのセルに戻ってしまう）
//   ・名前と Grok Bot のエージェントの id（リンクの id）は、台帳 ui-data\bots\index.json に置く（BotStore）
//   ・セルを消しても、台帳には残す（名前とリンクを残して「置き直す」。Q4）。1体のボットを何個のセルに置いてもよい（Q5）
//   ・台帳には URL・キー・ホスト名を入れない（Webhook の URL とキーは、第2段で C++ の secrets\ だけに置く）
//   ・grokbot:// の URL は C++ が組み立てる。UI が持つのはエージェントの id だけ（openBotApp に渡す）
//   ・持ち主は左サイドバー（台帳を書くのは左だけ）
//   ・右下の Grok Bot（右サイドバーの相棒の並びの下。6体まで）も同じ台帳を使う。並びは台帳の dock（右は写しを見て、左に頼む）
//   ・第3段（plan-s3-nest.md §4）：各ボットに役（role。bot-roles.ts）、台帳に巣の設定（nest）を持つ。どちらも無くてよい（古い台帳もそのまま読める）
//   ・依頼をクリップボードに置くとき（writeClipboardText）は、Windows のクリップボード履歴（Win+V）と同期に入れない印を付ける
//     （依頼の小窓 v2・R2・D6。六角メモ・相棒のコピーは今までどおり印なし〔計画の Q1〕）
//   ・続きとして（依頼の小窓 v2・R5・D11）：依頼に続きの元（parentRequestId）を pending.json に覚え、受け取り箱の一覧の写しに
//     糸の根（thread。親をたどったいちばん上の依頼）を付ける（botThreadRoot）。小窓の「続きとして」の選び口は、写しの一覧の
//     確かめが通った返事から（recentReplies）。要点の行は左が記録から全文を読み直して返す（answerReply → 命令 botAnswerLines の返事）
//   ・送ったあと（依頼の小窓 v2・R8・D17・D18）：巣の設定に「知らせの期限」（noticeHours。既定 3 時間。過ぎた依頼は伝票レールで赤）と
//     「貼りましたか？を聞くまでの秒」（askPastedSec。既定 30 秒。Q5）を足す。受け取り箱の一覧の写しに経過・貼ったか・受け取った時刻・
//     期限超え（overdue）・試し便の印を足す（requestBrief）。貼りましたか？の答えは markPasted で pending.json の pasted へ。
//     相手が受け取った時刻（acceptedAt）は、確かめの合う最初の途中経過を記録するときに覚える（確かめ・二重の見分けは applyBotMessage のまま）。
//     受け取り口の様子に、C++ が最後に見回った時刻（lastScanAt）。試し便（ping）は決まった一文だけの依頼（botRequestCopyText も短い決まりにする）
//   ・受け取り箱 v2（依頼の小窓 v2・R9・D19・D21）：返事の決まりに「はじめに ## 一行の答え／## 次の一手／## どのくらい確か」の 1 行を足す（message.v1 は変えない）。
//     依頼に言い換えの元（retryOf）と使った定型（presetIds）を覚え、印（setMark。pending.json の mark と記録の kind: 'mark'）を付け外しする。
//     一覧の写しに、言い換えの表示の番号（#0010-2。botRetryNos）・印・今月の量（monthly）・印の数（tally：定型ごと・役ごと。R4b の棚の数字の元）を足す。
//     「まず 1 枚」の表の元（away：前の「読んだ」より後に届いた、まだ読んでいない終わりの返事）と、同じあいだの灰色の返事の数（greyAfter）。
//     試し便（ping）は、表・量・印のどれにも入れない
//   ・定型の棚（依頼の小窓 v2・R4b）：印のある依頼が pending.json から片づいたら onPrunedMarks で知らせる（左の BotPresetStore が presets.json の数に積む）
import {
  type BotActivity,
  type BotActivityState,
  type BotFile,
  type BotImage,
  type BotLink,
  type BotLogEntry,
  type BotMark,
  type BotMatch,
  type BotMemoSuggestion,
  type BotMessage,
  type BotMessageType,
  type BotPendingFile,
  type BotAttachment,
  type BotDeliverTo,
  type BotPendingRequest,
  type BotRequestInput,
  type BotRequestV1,
  BOT_LIMITS,
  cleanBotLine,
  cutChars,
  DELIVERED_NOTE_CHARS,
  FILE_ID_RE,
  HOOK_WHY_CHARS,
  applyBotMessage,
  botActivity,
  buildBotRequest,
  cleanPresetIds,
  emptyPending,
  newBotCheck,
  newBotRequestId,
  parseBotMessage,
  parsePending,
  prunePending,
  RELAY_REQUEST_ID_RE,
  requestHead,
} from './bot-replies';
import { type BotRole, type BotRoleGroup, isRoleGroup, normalizeRole } from './bot-roles';
import { type BotAppError, type BotReplyEnvelope, type BotVia, onMessage, request, send } from './bridge';
import { deleteData, listData, readData, writeData } from './data';

// ボットの id（b＋英数字 4〜24 字。例 b7k2m9）。docs/bot-cells/schemas/botcell.v1.schema.json の botId と同じ形
export const BOT_ID_RE = /^b[0-9a-z]{4,24}$/;
// Grok Bot のエージェントの id（英数字・_・- の 1〜128 字）。C++ の IsValidAgentId と同じ形
export const AGENT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export const isBotId = (value: unknown): value is string => typeof value === 'string' && BOT_ID_RE.test(value);
export const isAgentId = (value: unknown): value is string => typeof value === 'string' && AGENT_ID_RE.test(value);

// 頼んでいない知らせの受け取り方（第2段の案。名前は未決。§9.12）
export type BotNoticeMode = 'receive' | 'daily' | 'off';

// 台帳の1件（docs/bot-cells/schemas/botcell.v1.schema.json の botEntry）
export interface BotEntry {
  id: string; // BOT_ID_RE
  name: string; // 表示名
  agentId?: string; // AGENT_ID_RE。無ければ「リンクなし」（押してもアプリを開けない）
  createdAt: number;
  lateMinutes?: number; // （第2段の案）「遅れている」にするまでの分。無ければ 15 分
  notices?: BotNoticeMode; // （第2段の案）
  role?: BotRole; // 巣での役（第3段。無ければ「役なし」）。normalizeRole で直したものだけ
}

// 巣の設定（台帳 index.json の nest。第3段 plan-s3-nest.md §4・§5.1。無ければ DEFAULT_NEST）
//   askAll：「みんなに聞く」の送り方（each：1体ずつ　lead：代表にまとめて）　lead：代表のボットの id（台帳にいるものだけ）
//   merge：合体 Grok の演出（off：なし　effect：軽い効果。演出だけ。既定は effect ＝ オン〔S3.3 で使う人が決めた〕）
//   visions：月の窓に Grok Visions を出す（on：出す〔既定〕　off：出さない。残すのは続ける〔S3.7b。visions.ts〕）
//   headline：受け取り箱の一覧に、頼む文の最初の 40 字を出す（off：出さない〔既定。頼む文は残さない決まり〕　on：pending.json に 40 字だけ残して出す。S3.8）
//   cosmic：受け取り箱の回答カードに「Grok!」の札と星空の背景（off：なし〔既定〕　on：飾りを付ける。見た目だけ。S3.10）
//   noticeHours：知らせの期限（時間。過ぎても返事が無い依頼は、伝票レールと巣の席で赤。既定 3。依頼の小窓 v2・R8・D17）
//   askPastedSec：アプリから戻ってから「貼りましたか？」を聞くまでの秒（既定 30。計画の Q5）
//   pasteMode：画像を付けた依頼の貼り方（two：① 画像 → ② 文の 2 回貼り〔既定〕　html：画像と文を一つの貼り付けで〔試し。
//     CF_HTML に画像を埋める。依頼の小窓 v2・R7d・D16・Q2〕）。アプリが受けるかはブラウザからは分からないので、自動では決めない
export type BotAskAll = 'each' | 'lead';
export type BotMerge = 'off' | 'effect';
export type BotVisions = 'on' | 'off';
export type BotHeadline = 'off' | 'on';
export type BotCosmic = 'off' | 'on';
export type BotPasteMode = 'two' | 'html';
export interface BotNest {
  askAll: BotAskAll;
  lead?: string; // BOT_ID_RE
  merge: BotMerge;
  visions: BotVisions;
  headline: BotHeadline;
  cosmic: BotCosmic;
  noticeHours: number;
  askPastedSec: number;
  pasteMode: BotPasteMode;
}
export const NOTICE_HOURS = { min: 1, max: 72, default: 3 } as const; // 知らせの期限（時間。R8）
export const ASK_PASTED_SEC = { min: 3, max: 600, default: 30 } as const; // 貼りましたか？を聞くまで（秒。R8・Q5）
export const DEFAULT_NEST: Readonly<BotNest> = {
  askAll: 'each',
  merge: 'effect',
  visions: 'on',
  headline: 'off',
  cosmic: 'off',
  noticeHours: NOTICE_HOURS.default,
  askPastedSec: ASK_PASTED_SEC.default,
  pasteMode: 'two',
};

// 整数の範囲に入れる（数でない・範囲の外は既定）
const inRange = (value: unknown, r: { min: number; max: number; default: number }) =>
  typeof value === 'number' && Number.isInteger(value) && value >= r.min && value <= r.max ? value : r.default;

// 巣の設定を使える形に直す（形の違うものは null。知らない値・無い値は既定に戻す〔merge・visions は off と書いてあるときだけ off、headline・cosmic は on と書いてあるときだけ on。
//   noticeHours・askPastedSec は範囲の中の整数だけ。R8 より前の台帳には無いので既定〕。pasteMode は html と書いてあるときだけ html〔R7d〕。
//   代表は has が台帳にいると答えたものだけ）
export function normalizeNest(raw: unknown, has: (botId: string) => boolean): BotNest | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const n = raw as Record<string, unknown>;
  return {
    askAll: n.askAll === 'lead' ? 'lead' : 'each',
    ...(isBotId(n.lead) && has(n.lead) ? { lead: n.lead } : {}),
    merge: n.merge === 'off' ? 'off' : 'effect',
    visions: n.visions === 'off' ? 'off' : 'on',
    headline: n.headline === 'on' ? 'on' : 'off',
    cosmic: n.cosmic === 'on' ? 'on' : 'off',
    noticeHours: inRange(n.noticeHours, NOTICE_HOURS),
    askPastedSec: inRange(n.askPastedSec, ASK_PASTED_SEC),
    pasteMode: n.pasteMode === 'html' ? 'html' : 'two',
  };
}

// セルの顔に出す状態（第1段は3つ。名前は docs/bot-cells/types/bot-cells.ts の BotCellState と同じ）
//   idle：ふつう　noLink：リンクなし（エージェントの id が無い）　noApp：アプリなし（grokbot:// が登録されていない）
export type BotCellState = 'idle' | 'noLink' | 'noApp';

// 右サイドバー（右下の Grok Bot）へ送る、台帳の1件の写し（名前とエージェントの id と役だけ）
export type BotBrief = Pick<BotEntry, 'id' | 'name' | 'agentId' | 'role'>;

// appMissing：openBotApp が noApp を返したことがある（アプリが入っていない）
export function botCellState(bot: Pick<BotEntry, 'agentId'> | undefined, appMissing: boolean): BotCellState {
  if (!bot?.agentId) return 'noLink';
  return appMissing ? 'noApp' : 'idle';
}

// 状態の短い名前（カードの札）
export function botStateLabel(state: BotCellState): string {
  return state === 'noLink' ? 'リンクなし' : state === 'noApp' ? 'アプリなし' : 'ふつう';
}

// 状態の説明（盤面の吹き出し・カード）
export function botStateHint(state: BotCellState): string {
  if (state === 'noLink') return 'リンクがまだありません。右クリック →「リンクを貼る…」で、Grok Bot アプリの「リンクをコピー」から貼ってください';
  if (state === 'noApp') return 'Grok Bot アプリが見つかりません（入っていないようです）。入れてから、もう一度押してください';
  return '押すと、Grok Bot アプリのこのボットのチャットが開きます（返事はアプリの中で読みます）';
}

const FILE = 'bots/index.json';
const MAX_BOTS = 200;
export const MAX_DOCK_BOTS = 6; // 右下（右サイドバーの相棒の並びの下）に置ける Grok Bot の数
export const MAX_BOT_NAME = 40; // 名前の長さ（文字）
export const DEFAULT_BOT_NAME = 'ボット';
const MAX_LATE_MINUTES = 7 * 24 * 60;

// 新しいボットの id（b＋時刻の36進＋乱数。BOT_ID_RE に合う）
export const newBotId = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// 名前：見えない制御文字と、文字の向きを変える文字（U+202A〜U+202E・U+2066〜U+2069）を消し、空白をまとめて、40 字まで
export function cleanBotName(name: unknown): string {
  const text = String(name ?? '')
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [...text].slice(0, MAX_BOT_NAME).join('');
}

// 「リンクか id」の欄（盤面のボットのセルと、右下の Grok Bot で同じ文）
export const BOT_LINK_LABEL = 'Grok Bot のリンクか id（アプリの「リンクをコピー」から貼る）';
export const BOT_LINK_HINT = 'grokbot://app/v1/agent?id=… など';
export const BAD_BOT_LINK = 'この形のリンクは使えません（grokbot://・cursor.com・x.ai のボットのリンクか、英数字・_・- だけの id を貼ってください）';

export type DockResult = 'ok' | 'full' | 'missing' | 'already';

export class BotStore {
  private bots: BotEntry[] = [];
  private dockIds: string[] = []; // 右下に置いているボット（並びの順。MAX_DOCK_BOTS 体まで）
  private nestSaved: BotNest | null = null; // 巣の設定（台帳に無く、変えてもいなければ null。書くときも nest を入れない）
  private readonly listeners: (() => void)[] = [];
  private loaded = false;
  private saveTimer = 0;

  async load() {
    const saved = await readData<{ version?: unknown; bots?: unknown; dock?: unknown; nest?: unknown }>(FILE);
    const list: BotEntry[] = [];
    const dock: string[] = [];
    let nest: BotNest | null = null;
    if (saved && saved.version === 1 && Array.isArray(saved.bots)) {
      for (const raw of saved.bots) {
        const bot = parseBot(raw);
        if (bot && list.length < MAX_BOTS && !list.some((b) => b.id === bot.id)) list.push(bot);
      }
      // 右下の並び：台帳にいるボットだけ、重ねず、6体まで
      if (Array.isArray(saved.dock)) {
        for (const id of saved.dock) {
          if (isBotId(id) && dock.length < MAX_DOCK_BOTS && !dock.includes(id) && list.some((b) => b.id === id)) dock.push(id);
        }
      }
      // 巣の設定（無ければ null のまま ＝ 既定）。代表の id は、台帳から消えていても残す
      //   （S3.6：みんなに聞くで「代表が台帳から消えている」と知らせて A〔1体ずつ〕に戻すため。設定の欄で保存し直すと外れる〔setNest〕）
      nest = normalizeNest(saved.nest, () => true);
    }
    this.bots = list;
    this.dockIds = dock;
    this.nestSaved = nest;
    this.loaded = true;
    this.emit();
  }

  get ready() {
    return this.loaded;
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  // 台帳に入れた順
  list(): BotEntry[] {
    return [...this.bots];
  }

  get(id: string | null | undefined): BotEntry | undefined {
    return id ? this.bots.find((b) => b.id === id) : undefined;
  }

  // 新しいボットを台帳に入れる（多すぎるときは null）。agentId は形が合うときだけ持つ
  add(name: string, agentId?: string | null): BotEntry | null {
    if (this.bots.length >= MAX_BOTS) return null;
    let id = newBotId();
    while (this.get(id)) id = newBotId();
    const bot: BotEntry = { id, name: cleanBotName(name) || DEFAULT_BOT_NAME, ...(isAgentId(agentId) ? { agentId } : {}), createdAt: Date.now() };
    this.bots.push(bot);
    this.changed();
    return bot;
  }

  rename(id: string, name: string): boolean {
    const bot = this.get(id);
    const clean = cleanBotName(name);
    if (!bot || !clean) return false;
    if (bot.name !== clean) {
      bot.name = clean;
      this.changed();
    }
    return true;
  }

  // リンク（エージェントの id）を付ける。null で外す（「リンクなし」に戻る）。形が合わなければ false
  setAgentId(id: string, agentId: string | null): boolean {
    const bot = this.get(id);
    if (!bot || (agentId !== null && !isAgentId(agentId))) return false;
    if (agentId === null) delete bot.agentId;
    else bot.agentId = agentId;
    this.changed();
    return true;
  }

  // 巣での役を付ける（null で外す ＝ 役なし）。role は normalizeRole で直してから持つ（直せない形なら false）
  //   考え方の段階（role.thinking。S3.3b）も役の中にそのまま持つ（normalizeThinking で直したもの。無ければおまかせ）
  //   同じ役をほかのボットが持っていてもよい（重複は禁じない。巣では名前で区別する）
  //   変わらなかったときも false（右の写しを送り直してもらうため）
  setRole(id: string, role: unknown): boolean {
    const bot = this.get(id);
    if (!bot) return false;
    const next = role === null ? null : normalizeRole(role);
    if (role !== null && !next) return false;
    if (JSON.stringify(next) === JSON.stringify(bot.role ?? null)) return false;
    if (next) bot.role = next;
    else delete bot.role;
    this.changed();
    return true;
  }

  // 巣の設定（台帳に無ければ既定 DEFAULT_NEST の写し）
  nest(): BotNest {
    return { ...(this.nestSaved ?? DEFAULT_NEST) };
  }

  // 巣の設定を変える（normalizeNest で直してから。形が違う・変わらないときは false）
  setNest(nest: unknown): boolean {
    const next = normalizeNest(nest, (botId) => !!this.get(botId));
    if (!next || JSON.stringify(next) === JSON.stringify(this.nest())) return false;
    this.nestSaved = next;
    this.changed();
    return true;
  }

  // ---------- 右下の Grok Bot（右サイドバーの相棒の並びの下） ----------

  // 右下に置いているボットの id（並びの順）
  docked(): string[] {
    return [...this.dockIds];
  }

  // 右下の並びの最後に置く。full：もう 6 体いる　missing：台帳にいない　already：もう置いてある
  dock(id: string): DockResult {
    if (!this.get(id)) return 'missing';
    if (this.dockIds.includes(id)) return 'already';
    if (this.dockIds.length >= MAX_DOCK_BOTS) return 'full';
    this.dockIds.push(id);
    this.changed();
    return 'ok';
  }

  // 右下から外す（台帳には残る）
  undock(id: string): boolean {
    const index = this.dockIds.indexOf(id);
    if (index < 0) return false;
    this.dockIds.splice(index, 1);
    this.changed();
    return true;
  }

  // 右下の並びを変える（to：0 から数えた、移したい場所）
  moveDock(id: string, to: number): boolean {
    const from = this.dockIds.indexOf(id);
    if (from < 0 || !Number.isInteger(to)) return false;
    const target = Math.max(0, Math.min(this.dockIds.length - 1, to));
    if (target === from) return false;
    this.dockIds.splice(from, 1);
    this.dockIds.splice(target, 0, id);
    this.changed();
    return true;
  }

  private changed() {
    this.emit();
    if (!this.loaded) return; // 読み込む前に書くと、前の台帳を消してしまう
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flush(), 400);
  }

  // 待たずに書く（終わるとき）
  flush() {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    if (this.loaded) void writeData(FILE, { version: 1, bots: this.bots, dock: this.dockIds, ...(this.nestSaved ? { nest: this.nestSaved } : {}) });
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

function parseBot(raw: unknown): BotEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const b = raw as Record<string, unknown>;
  if (!isBotId(b.id)) return null;
  const late = b.lateMinutes;
  const notices = b.notices;
  const role = b.role === undefined ? null : normalizeRole(b.role); // 直せない役は捨てる（役なし）。thinking の無い古い役はおまかせ
  return {
    id: b.id,
    name: cleanBotName(b.name) || DEFAULT_BOT_NAME,
    ...(isAgentId(b.agentId) ? { agentId: b.agentId } : {}),
    createdAt: typeof b.createdAt === 'number' && Number.isFinite(b.createdAt) ? b.createdAt : Date.now(),
    ...(typeof late === 'number' && Number.isInteger(late) && late >= 1 && late <= MAX_LATE_MINUTES ? { lateMinutes: late } : {}),
    ...(notices === 'receive' || notices === 'daily' || notices === 'off' ? { notices } : {}),
    ...(role ? { role } : {}),
  };
}

// ---------- Grok Bot のリンクから、エージェントの id だけを取り出す ----------
//   受け付けるのは次の3つの形だけ（Grok Bot アプリの中身から分かった形。公開されていないので、変わったらここを直す）
//     grokbot://app/v1/agent?id=<id>
//     https://cursor.com/grok-bot/link/v1/agent?id=<id>
//     https://x.ai/bot/agent/<id>
//   ・取り出すのは id だけ。ほかの部分（別の画面へのパス・ほかの引数）は使わないので、アプリへ渡ることはない
//   ・形の違うもの（ほかのスキーム・ほかのホスト・ユーザー名やポートの付いたもの・id が2つあるもの・id の形が違うもの）は null
//   ・id だけを貼ったもの（リンクでないもの）も null（ほかの文字をまちがって id にしないため）
export function parseAgentId(text: string): string | null {
  const input = String(text ?? '').trim();
  if (!input || input.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(input)) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, ''); // 最後の / は見ない
  let id: string | null = null;
  if (url.protocol === 'grokbot:') {
    if (host === 'app' && path === '/v1/agent') id = onlyParam(url, 'id');
  } else if (url.protocol === 'https:') {
    if ((host === 'cursor.com' || host === 'www.cursor.com') && path === '/grok-bot/link/v1/agent') {
      id = onlyParam(url, 'id');
    } else if (host === 'x.ai' || host === 'www.x.ai') {
      const m = /^\/bot\/agent\/([^/]+)$/.exec(path);
      id = m ? decodeSegment(m[1]) : null;
    }
  }
  return isAgentId(id) ? id : null;
}

// アドレス欄などに入れた文字が grokbot:// か（大文字・小文字を区別しない。前後の空白と、囲んだ " は見ない）
//   ページ・リンク・アドレス欄からは開かない（S1.11）。開くのはボットのセルの openBotApp だけ
export function isGrokBotAddress(text: string): boolean {
  return /^grokbot:/i.test(String(text ?? '').trim().replace(/^"(.*)"$/, '$1').trim());
}

// 「リンクか id」の欄に貼られた文字から、エージェントの id を取り出す（置くとき・リンクを貼るとき）
//   ・リンクなら parseAgentId の3つの形だけ。id だけ（英数字・_・- の 1〜128 字）もそのまま受け付ける
//   ・id だけを受け付けるのは、この欄に人が貼ったときだけ（ほかの所の文字を、まちがって id にしないため）
//   ・覚えるのは id だけ。貼ったリンクそのもの（URL）は、どこにも残さない
export function parseAgentInput(text: string): string | null {
  const input = String(text ?? '').trim();
  return isAgentId(input) ? input : parseAgentId(input);
}

// その名前の引数が1つだけなら、その値
function onlyParam(url: URL, name: string): string | null {
  const values = url.searchParams.getAll(name);
  return values.length === 1 ? values[0] : null;
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

// ---------- アプリとの行き来（コピーで。Webhook までのつなぎ。S1.12・Q2） ----------
//   ・「コピーしてアプリを開く」：頼む文をクリップボードに入れてから、アプリのチャットを開く（貼って送るのは使う人）
//   ・「クリップボードの返事をメモにする」：アプリでコピーした返事を、メモのセルにする。メモにする前に最初の 200 字を見せて確かめる
//     （前にコピーしたパスワードなどが、まちがってメモにならないように）
//   ・返事は外から来た文：相棒の返事の印（by）は付けず、先頭に「どこから来たか」の行を付ける。リンクは押したときだけ開く
//   ・頼む文・返事の本文は、台帳にもやり取りの記録にも残さない（メモにしたものだけが、メモのセルとして残る）

export const REPLY_PREVIEW_CHARS = 200; // メモにする前に見せる字数

// 外から来た文を、メモにできる形に：改行を \n にそろえ、改行・タブ以外の制御文字と、文字の向きを変える文字を消す
export function cleanExternalText(text: unknown): string {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim();
}

// 最初の n 字（サロゲートペアを割らない）。切ったかどうかも返す
export function headOf(text: string, n: number): { text: string; cut: boolean } {
  const chars = [...text];
  return chars.length > n ? { text: chars.slice(0, n).join(''), cut: true } : { text, cut: false };
}

// ボットの返事をメモにするときの本文：1行目に「どこから来たか」、1行あけて返事。max 字に収める
export function botReplyMemoText(botName: string, reply: string, max: number): { text: string; cut: boolean } {
  const head = `〔Grok Bot「${cleanBotName(botName) || DEFAULT_BOT_NAME}」の返事・クリップボードから〕\n\n`;
  const body = headOf(reply, Math.max(0, max - [...head].length));
  return { text: head + body.text, cut: body.cut };
}

// ボットの欄の返事をメモにするときの本文（botToMemo）：1行目に「どこから来たか」（番号・未確認の印）、1行あけて返事。max 字に収める
//   grey：check が合わない・知らない依頼・知らせ・知らない版（「未確認」の印と、確かめられないわけの行を付ける）
//   suggestion：返事の「メモにしてね」の提案の1件（その文だけ）
export function botMessageMemoText(
  botName: string,
  m: BotMessage,
  o: { grey: boolean; no?: string; suggestion?: BotMemoSuggestion },
  max: number,
): { text: string; cut: boolean } {
  const kind = o.suggestion ? '返事の中の提案' : m.type === 'error' ? 'エラー' : m.type === 'notice' ? '知らせ' : m.type === 'progress' ? '途中経過' : '返事';
  const head =
    `〔Grok Bot「${cleanBotName(botName) || DEFAULT_BOT_NAME}」の${kind}${o.no ? `・${o.no}` : ''}${o.grey ? '・未確認' : ''}〕\n` +
    (o.grey ? '（確かめられない返事：依頼の check と合わないか、頼んでいない知らせです。中身が正しいかは分かりません）\n' : '') +
    '\n';
  const body = o.suggestion
    ? o.suggestion.text
    : [
        m.title ?? '',
        m.error ? `エラー：${m.error.code}${m.error.message ? `（${m.error.message}）` : ''}` : '',
        m.text,
        ...(m.links ?? []).map((l) => `${l.title ? `${l.title} ` : ''}${l.url}`),
      ]
        .filter(Boolean)
        .join('\n');
  const more = '\n…（続きは、ボットの欄のやり取りに）';
  const room = Math.max(0, max - [...head].length);
  const cut = headOf(body, room);
  if (!cut.cut) return { text: head + body, cut: false };
  return { text: head + headOf(body, Math.max(0, room - [...more].length)).text + more, cut: true };
}

// クリップボードの文字（読めなければ null）
export async function readClipboardText(): Promise<string | null> {
  const reply = await request((requestId) => ({ type: 'clipboardRead', requestId }), 5_000);
  return reply?.type === 'clipboard' ? reply.text : null;
}

// クリップボードに文字だけを書く（HTML は付けない。盤面に貼ってもセルにはならない）
//   ボットの依頼（ClipboardSender の writeClipboard）だけが使うので、Windows のクリップボード履歴（Win+V）と同期に入れない印を付ける（R2・D6）
export async function writeClipboardText(text: string): Promise<boolean> {
  const reply = await request((requestId) => ({ type: 'clipboardWrite', requestId, text, html: '', noHistory: true }), 5_000);
  return reply?.type === 'clipboardWritten' && reply.ok;
}

// ---------- Grok Bot アプリを開く ----------

export type OpenBotAppResult = { ok: true } | { ok: false; error: BotAppError | 'timeout' };

// 開けなかったときの知らせ（何が起きたかと、次にどうすればよいか）
export function botAppErrorText(error: BotAppError | 'timeout'): string {
  switch (error) {
    case 'noApp':
      return 'Grok Bot アプリが見つかりません（この PC に入っていないようです）。アプリを入れてから、もう一度押してください';
    case 'badId':
      return 'このボットのリンクの形が正しくないので、開けませんでした。右クリック →「リンクを貼り直す…」で貼り直してください';
    case 'timeout':
      return 'Grok Bot アプリを開けたか分かりません（ブラウザの本体から返事がありません）。アプリが開いていなければ、もう一度押してください';
    default:
      return 'Grok Bot アプリを開けませんでした（Windows が開けませんでした）。アプリを一度自分で起動してから、もう一度押してください';
  }
}

// Grok Bot アプリの、そのボットのチャットを開く（C++ の openBotApp。渡すのはエージェントの id だけ）
//   timeout：C++ から返事が無かった（開けたかどうか分からない。もう一度押してもアプリが2回開くだけ）
export async function openBotApp(agentId: string): Promise<OpenBotAppResult> {
  if (!isAgentId(agentId)) return { ok: false, error: 'badId' };
  const reply = await request((requestId) => ({ type: 'openBotApp', agentId, requestId }));
  if (reply?.type !== 'botAppOpened') return { ok: false, error: 'timeout' };
  return reply.ok ? { ok: true } : { ok: false, error: reply.error ?? 'failed' };
}

// ---------- 返事の受け取り（第2段 S2.3。左の UI だけ。docs/ideas-bot-cells.md §9.6） ----------
//   ・C++ が bot-inbox\ から取った返事（botReply）を確かめ（bot-replies.ts）、待っている依頼に当てはめて、
//     bots\<id>\pending.json と bots\<id>\log-NNNN.json に書いてから、C++ に botReplyTaken（done／rejected）で答える
//   ・どのボットの返事かは requestId で決める（覚えている依頼に無ければ、返事の bot が台帳にいればそのボット）。
//     どちらでもない返事と、形の読めない返事は bots\_unrouted\ に記録する
//   ・書く順番は ai/history.ts と同じく1列に並べる（pending.json と記録が前後しないように）
//   ・同じデータフォルダの別の窓が受け取っているとき（botInboxState の owner が false）は、依頼を作らない（pending.json を2つの窓で書かない）
//   ・画面にはまだ出さない（右のボットの欄・セルの顔は S2.4・S2.5）。右へ送る写しは briefs() で作れる（relay の種類は次の回で決める）

// 返事の写しから check を外す（記録と右の欄へ送る写しには入れない）
function withoutCheck(message: BotMessage): BotMessage {
  const copy = { ...message };
  delete copy.check;
  return copy;
}

// 記録の1件から、右の欄へ送る返事の写しを作る（文は THREAD_SHOW_CHARS 字まで）
function threadMessage(e: BotLogEntry, m: BotMessage, sent: ('cell' | 'right' | 'hex')[]): BotThreadMessage {
  const chars = [...m.text];
  const shownCut = chars.length > THREAD_SHOW_CHARS;
  return {
    kind: 'message',
    fileId: e.fileId ?? '',
    at: e.at,
    ...(e.requestId ? { requestId: e.requestId, no: requestNo(e.requestId) } : {}),
    match: e.match ?? 'unknownVersion',
    grey: e.grey === true || e.match !== 'ok',
    folded: e.folded === true,
    late: e.late === true,
    faint: e.faint === true,
    afterDone: e.afterDone === true,
    ...(e.via ? { via: e.via } : {}),
    transportOk: e.transportOk === true,
    type: m.type,
    ...(m.at ? { botAt: m.at } : {}),
    ...(m.title ? { title: m.title } : {}),
    text: shownCut ? chars.slice(0, THREAD_SHOW_CHARS).join('') : m.text,
    chars: chars.length,
    shownCut,
    cutOnReceive: e.notes?.includes('textCut') === true,
    ...(m.step ? { step: m.step } : {}),
    ...(m.links ? { links: m.links } : {}),
    ...(m.images ? { images: m.images } : {}),
    ...(m.files ? { files: m.files } : {}),
    ...(m.memos ? { memos: m.memos } : {}),
    ...(m.error ? { error: m.error } : {}),
    sent,
  };
}

const UNROUTED = '_unrouted'; // どのボットか分からない返事の置き場（ボットの id は b で始まるので、ぶつからない）
const pendingFile = (key: string) => `bots/${key}/pending.json`;
const logFile = (key: string, n: number) => `bots/${key}/log-${String(n).padStart(4, '0')}.json`;
const byteLength = (text: string) => new TextEncoder().encode(text).length;

export const lateMinutesOf = (bot: Pick<BotEntry, 'lateMinutes'> | undefined) => bot?.lateMinutes ?? BOT_LIMITS.lateMinutes;

// セルの顔に出す「いちばん大事な1つ」：返事・遅れ・作業中があればそれ、無ければ第1段の状態（ふつう・リンクなし・アプリなし）
export type BotFullState = BotCellState | BotActivityState;
export function botFullState(bot: Pick<BotEntry, 'agentId'> | undefined, appMissing: boolean, activity: BotActivity | undefined): BotFullState {
  return activity && activity.state !== 'idle' ? activity.state : botCellState(bot, appMissing);
}

// 状態の短い名前（第2段の状態も。カード・ボットの欄・吹き出し）
export function botFullStateLabel(state: BotFullState): string {
  switch (state) {
    case 'accepted':
      return '待っています';
    case 'working':
      return '作業中';
    case 'replied':
      return '返事あり';
    case 'late':
      return '遅れています';
    case 'botError':
      return 'ボットのエラー';
    default:
      return botStateLabel(state);
  }
}

// 状態の説明（第2段の状態。無ければ第1段の説明）
export function botFullStateHint(state: BotFullState): string {
  switch (state) {
    case 'accepted':
      return '依頼の返事を待っています（右のボットの欄で見られます）。押すと、Grok Bot アプリのチャットが開きます';
    case 'working':
      return 'ボットから途中経過が届きました。返事を待っています（右のボットの欄で見られます）';
    case 'replied':
      return '返事が届きました。右のボットの欄で読めます（カードの「やり取りを見る」から）';
    case 'late':
      return '返事が遅れています（まだ待っています）。アプリで動いているか見るか、ボットの欄で「待つのをやめる」';
    case 'botError':
      return 'ボットからエラーが届きました。右のボットの欄で、わけを読めます';
    default:
      return botStateHint(state);
  }
}

// 右へ送る写しの1件（右のボットの欄・右下の Grok Bot の顔。本文は入れない）
export interface BotBriefState extends BotActivity {
  id: string;
  overdue?: number; // 待っている依頼のうち、知らせの期限（巣の設定 noticeHours）を過ぎたもの（R8。巣の席を赤の点線に。新しい状態は増やさない）
}

// ---------- 右のボットの欄へ送る、1体のやり取りの写し（S2.4） ----------
//   ・左が pending.json と記録（log-NNNN.json）から作る。check は入れない（右は check を知らない）
//   ・返事の文は、受け取ったとき 2 万字で切ってある（cutOnReceive）。右へ送るのは、そのうち最初の 4,000 字まで（shownCut）。
//     全文は欄には出さない（メモにすると、メモの上限 5,000 字まで残せる）

export const THREAD_SHOW_CHARS = 4000; // 右の欄に出す、1通の文の字数
const THREAD_ITEMS = 40; // 右の欄に出す、やり取りの行の数（新しいものから）
const THREAD_REQUESTS = 20; // 右の欄に出す、依頼の数（新しいものから）
export const LOG_FILES_KEPT = 20; // ボットごとに残す記録のファイルの数（1 ファイル 100 件まで。それより古いものは消す）

export interface BotThreadRequest {
  requestId: string;
  no: string; // #0003
  createdAt: number;
  status: 'waiting' | 'done' | 'stopped';
  late: boolean; // 待っていて、lateMinutes を過ぎた
  textChars: number;
  progress: number;
  lastProgressAt?: number;
  final?: { type: 'reply' | 'error'; fileId: string; at: number; late: boolean; faint: boolean; read: boolean };
  extra: number;
  mark?: BotMark; // 当たり／ずれ／宛て先違い（R9。回答カードの印）
}

export interface BotThreadMessage {
  kind: 'message';
  fileId: string;
  at: number; // 受け取った時刻（こちらの時計）
  requestId?: string;
  no?: string;
  match: BotMatch;
  grey: boolean;
  folded: boolean;
  late: boolean;
  faint: boolean;
  afterDone: boolean;
  via?: BotVia;
  transportOk: boolean;
  type: BotMessageType;
  botAt?: string; // ボットが書いた時刻（表示だけ）
  title?: string;
  text: string;
  chars: number; // 受け取った文の字数
  shownCut: boolean; // 右の欄には最初の THREAD_SHOW_CHARS 字だけ
  cutOnReceive: boolean; // 受け取るときに、上限（2 万字）で切った
  step?: { n: number; of?: number };
  links?: BotLink[];
  images?: BotImage[]; // 読み込まない（ドメインだけ見せる）
  files?: BotFile[];
  memos?: BotMemoSuggestion[];
  error?: { code: string; message?: string };
  sent: ('cell' | 'right' | 'hex')[]; // メモにした先（六角メモへは2回送らない）
}

export type BotThreadItem =
  | { kind: 'request'; at: number; requestId: string; no: string; textChars: number; hook?: true; attempt?: number } // hook：中継へ直接（R11）　attempt：2 回目から
  | { kind: 'stopped'; at: number; requestId: string; no: string; notCopied: boolean }
  | BotThreadMessage;

export interface BotThreadView {
  botId: string;
  requests: BotThreadRequest[]; // 新しいものから
  items: BotThreadItem[]; // 古いものから（role="log" の並び）
  earlier: boolean; // 出していない、もっと古い記録がある
}

// 返事を1通記録した知らせ（BotInbox.onArrival）。final：check の合う、1通目の終わりの返事（reply・error）
export interface BotArrival {
  botId: string | null; // どのボットか分からないときは null
  type: BotMessageType;
  grey: boolean;
  final: boolean;
  faint: boolean; // 待つのをやめたあとに届いた
  requestId?: string; // どの依頼への返事か（R8：貼りましたか？を待っている依頼に届いたら、聞かずに済ませる。灰色なら書いてあった値）
}

// 依頼と合う1通目の reply（BotInbox.onReply。灰色・2通目から・途中経過・エラーは来ない）。message は check を外したもの
//   role・group：その依頼に入れた役の名前・みんなに聞くの組の番号（pending.json から）
export interface BotReplyArrival {
  botId: string;
  fileId: string;
  message: BotMessage;
  role?: string;
  group?: number;
}

// 受け取り口の様子（C++ の botInboxState）。lastScanAt：C++ が最後に見回った時刻（R8。まだ見回っていなければ無い。鍵や置き場の場所は来ない）
export interface BotInboxStatus {
  owner: boolean;
  relay: boolean;
  watching: boolean;
  lastScanAt?: number;
}

export type CreateBotRequestError = 'notReady' | 'otherWindow' | 'badBot' | 'emptyText' | 'badUrl' | 'tooLarge' | 'save';
// no：画面に出す番号（#0003。言い換えなら #0003-2〔R9〕）
export type CreateBotRequestResult = { ok: true; request: BotRequestV1; json: string; no: string } | { ok: false; error: CreateBotRequestError };

// 依頼を作れなかったときの知らせ
export function botRequestErrorText(error: CreateBotRequestError): string {
  switch (error) {
    case 'notReady':
      return 'ボットのやり取りの記録を読み込んでいます。少し待ってから、もう一度どうぞ';
    case 'otherWindow':
      return 'ボットの返事は、別の窓で受け取っています。依頼は、その窓のボットのセルから作ってください（返事がこの窓には届かないため）';
    case 'badBot':
      return 'このボットが台帳に見つかりません';
    case 'emptyText':
      return '頼む文が空です。書いてから、もう一度どうぞ';
    case 'tooLarge':
      return '依頼が大きすぎます（256 KB まで）。頼む文を短くしてください';
    case 'badUrl':
      return 'ページの URL が http(s) ではないので、依頼に付けられません';
    default:
      return '依頼を保存できませんでした（ボットのやり取りの記録を書けませんでした）。アプリは開いていません';
  }
}

// 画面に出す依頼の番号（hb-20261009-0003-k3x9 → #0003）。乱数の部分と check は画面に出さない
export function requestNo(requestId: string | undefined): string {
  const m = /^hb-\d{8}-(\d{4,6})/.exec(requestId ?? '');
  return m ? `#${m[1]}` : '#?';
}

// 「コピーしてアプリを開く」でクリップボードに入れる文：頼む文＋返事の決まり＋依頼の JSON（request.v1）
//   ・Grok Bot のチャットに、使う人が貼って送る。ボットは返事を中継へ返す（replyTo: relay）
//   ・check はここ（クリップボード）と pending.json にだけ入る。画面・お知らせ・記録には出さない
//   ・返事の決まりには、Markdown の見出し（要約・注意・出典 → カード）・出典の URL を links にも・途中経過の step と title を足した（S3.4。plan-s3-nest.md §4）。
//     返事の形（message.v1）は変えない。中継が通す項目（step・title・links）だけを使う
//   ・Grok Vision（S3.7b）：ボットが自分で「有意義な発言ができた」と判断したときだけ、text の最後に「## Vision」の節を足してもらう
//     （JSON の項目は足さない。中継の項目も request.v1 も変えない。取り出して残すのは visions.ts）
export const BOT_VISION_RULE =
  'この返事が、使う人にとって特に有意義な発見や洞察になったと自分で判断したら、本文の最後に `## Vision` の見出しで、短い題名と1〜3行の要点を足してください。自信がなければ足さないでください。';
export const BOT_VISION_FORM = 'Vision の形：「## Vision」の次の行に題名（30 字ほど）、その下に要点を1行ずつ（text の中だけ。JSON の項目は足さない）';
export function botRequestCopyText(request: BotRequestV1): string {
  if (request.type === 'ping') {
    // 試し便（R8）：決まった一文と、pong だけの返事の形と、依頼の JSON（返事の決まりは短く。ページの文は入れない）
    const pong = { v: 1, type: 'reply', requestId: request.requestId, check: request.check, bot: request.bot, id: 'p1', text: 'pong' };
    return [
      request.text,
      '',
      '―――― 返事の決まり ――――',
      `次の JSON 1つだけを、中継へ返してください（replyTo: "${request.replyTo}"）。requestId・check・bot は下の「依頼」の値のまま（変えると照合できません）。`,
      JSON.stringify(pong),
      '',
      '―――― 依頼（request.v1） ――――',
      JSON.stringify(request, null, 2),
    ].join('\n');
  }
  const sample = { v: 1, type: 'reply', requestId: request.requestId, check: request.check, bot: request.bot, id: 'r1', text: '（返事の文）' };
  return [
    request.text,
    '',
    '―――― 返事の決まり ――――',
    `この依頼への返事は、次の形の JSON 1つにして、中継へ返してください（replyTo: "${request.replyTo}"）。`,
    'requestId・check・bot は、下の「依頼」の JSON の値を、そのまま入れてください（変えると受け取れません）。',
    JSON.stringify(sample),
    '・text に HTML は使わない。リンクは "links": [{"url": "https://…", "title": "…"}] に入れる',
    '・text は Markdown でよい。「## 要約」「## 注意」「## 出典」の見出しで分けると、カードになる（無くても読める）',
    '・はじめに「## 一行の答え」「## 次の一手」「## どのくらい確か」の見出しで、それぞれ 1〜2 行ずつ書く（カードの先頭に出る。そのあとに「## 要約」など）',
    '・出典の URL は "links" にも入れる（チップになる）',
    '・できなかったときは "type": "error" にして、"error": {"code": "cannot", "message": "わけ"} を付ける',
    '・途中経過は "type": "progress"（10 通まで）。終わりの返事（reply か error）は、同じ requestId に1通だけ',
    '・途中経過には "step": {"n": 2, "of": 4} と短い "title"（60 字まで）を付ける（進み具合のバーになる）',
    `・${BOT_VISION_RULE}`,
    `・${BOT_VISION_FORM}`,
    '',
    '―――― 依頼（request.v1） ――――',
    JSON.stringify(request, null, 2),
  ].join('\n');
}

// ---------- みんなに聞くの組（第3段 S3.6。plan-s3-nest.md §5.1） ----------
//   A（1体ずつ）は、同じ問いから席の数だけ依頼を作る（requestId は別々、pending.json の group は同じ番号）。
//   ここは、その組の席ごとの状態と「全部そろったか」をまとめるだけ（計算だけ。見せ方は受け取り箱の組のカード〔S3.8〕）

// 席ごとの状態：unsent 送信前（まだ依頼を作っていない）・sent 送信済み（返事待ち）・working 調査中（途中経過が届いた）・
//   replied 回答あり・late 遅れ（返事待ちのまま lateMinutes を過ぎた）・error エラー・stopped 待つのをやめた
export type BotGroupSeatState = 'unsent' | 'sent' | 'working' | 'replied' | 'late' | 'error' | 'stopped';

export interface BotGroupSeat {
  botId: string;
  state: BotGroupSeatState;
  requestId?: string; // 送信前なら無し
  no?: string; // #0003
  role?: string; // 依頼に入れた役の名前（役なしなら無し）
  createdAt?: number;
}

export interface BotGroupStatus {
  group: number;
  seats: BotGroupSeat[]; // planned の順（無ければ依頼を作った順）。planned に無いボットの依頼は後ろに
  sent: number; // 依頼を作った席の数
  replied: number; // 回答ありの席の数
  complete: boolean; // 全部そろった（席が1つ以上あり、どの席も 回答あり・エラー・待つのをやめた のどれか）
  team?: BotRoleGroup; // グループに頼んだ組（G2。無ければみんなに聞く）
  summary?: BotGroupSeat; // まとめ役に渡した依頼のいちばん新しいもの（G3。席の点には入れない）
}

export function botGroupSeatState(request: BotPendingRequest | undefined, now: number, lateMinutes: number): BotGroupSeatState {
  if (!request) return 'unsent';
  if (request.final) return request.final.type === 'error' ? 'error' : 'replied';
  if (request.status === 'stopped') return 'stopped';
  if (now - request.createdAt > lateMinutes * 60_000) return 'late';
  return request.progress > 0 ? 'working' : 'sent';
}

// 状態の短い名前（組のカード・案内）
export function botGroupSeatLabel(state: BotGroupSeatState): string {
  const labels: Record<BotGroupSeatState, string> = { unsent: '送信前', sent: '送信済み', working: '調査中', replied: '回答あり', late: '遅れ', error: 'エラー', stopped: '待つのをやめた' };
  return labels[state];
}

// 組の状態のまとめ
//   requests：ボットごとの依頼（pending.json の中身。ほかの組・組の無い依頼が混ざっていてよい）
//   planned：聞くと決めた席のボットの id（案内の順）。あれば、まだ依頼を作っていない席を「送信前」にする。無ければ作った依頼だけ
//   同じボットに同じ組の依頼が2つ以上あれば、新しいほうを見る（グループは役ごとに1つずつ。同じボットが2役なら、作った順に分ける）
//   extras.team：グループに頼んだ組。extras.roles：planned と同じ順の役の名前（まだ依頼を作っていない席の点）
export function botGroupStatus(
  group: number,
  requests: readonly { botId: string; request: BotPendingRequest }[],
  now: number,
  lateMinutes: (botId: string) => number,
  planned?: readonly string[],
  extras?: { team?: BotRoleGroup; roles?: readonly string[] },
): BotGroupStatus {
  const inGroupAll = requests.filter((x) => x.request.group === group).sort((a, b) => a.request.createdAt - b.request.createdAt);
  const inGroup = inGroupAll.filter((x) => !x.request.summary); // まとめ役への依頼は席に数えない
  const team = extras?.team ?? inGroupAll.find((x) => x.request.team)?.request.team;
  const seatOf = (botId: string, request: BotPendingRequest | undefined, role?: string): BotGroupSeat => {
    const state = botGroupSeatState(request, now, lateMinutes(botId));
    const name = request?.role || role;
    if (!request) return { botId, state, ...(name ? { role: name } : {}) };
    return { botId, state, requestId: request.requestId, no: requestNo(request.requestId), ...(name ? { role: name } : {}), createdAt: request.createdAt };
  };
  let seats: BotGroupSeat[];
  if (team) {
    const queue = new Map<string, BotPendingRequest[]>();
    for (const { botId, request } of inGroup) {
      const list = queue.get(botId) ?? [];
      list.push(request);
      queue.set(botId, list);
    }
    const used = new Set<string>();
    seats = (planned ?? []).map((botId, i) => {
      const request = (queue.get(botId) ?? []).find((r) => !used.has(r.requestId));
      if (request) used.add(request.requestId);
      return seatOf(botId, request, extras?.roles?.[i] || undefined);
    });
    for (const { botId, request } of inGroup) if (!used.has(request.requestId)) seats.push(seatOf(botId, request));
  } else {
    const newest = new Map<string, BotPendingRequest>();
    for (const { botId, request } of inGroup) newest.set(botId, request);
    const made = [...newest].sort((a, b) => a[1].createdAt - b[1].createdAt).map(([botId]) => botId);
    const order = planned ? [...new Set(planned), ...made.filter((id) => !planned.includes(id))] : made;
    seats = order.map((botId) => seatOf(botId, newest.get(botId)));
  }
  const done = (s: BotGroupSeat) => s.state === 'replied' || s.state === 'error' || s.state === 'stopped';
  const lastSummary = inGroupAll.filter((x) => x.request.summary).at(-1);
  return {
    group,
    seats,
    sent: seats.filter((s) => s.requestId).length,
    replied: seats.filter((s) => s.state === 'replied').length,
    complete: seats.length > 0 && seats.every(done),
    ...(team ? { team } : {}),
    ...(lastSummary ? { summary: seatOf(lastSummary.botId, lastSummary.request) } : {}),
  };
}

// ---------- 受け取り箱の一覧（第3段 S3.8。plan-s3-nest.md の S3.8） ----------
//   左が pending.json から作る、依頼1件ずつの要約（右の受け取り箱の「Grok への依頼 n 件」）。check・頼む文は入れない
//   （頼む文の最初の 40 字だけは、巣の設定 headline がオンのときだけ pending.json に残して入れる）。記録（log）は読まない
//   組（みんなに聞く）は botGroupStatus でまとめる（聞くと決めた席は、送るときに左がメモリーにだけ覚える。起動し直すと作った依頼だけ）

export const REQUEST_LIST_MAX = 30; // 右へ送る依頼の数（全部のボットの、新しいものから）
const GROUP_PLANS_KEPT = 20; // 覚えておく組の席の並び（新しいものから）

// 一覧の1件の状態（送信前は無い。依頼を作ったものだけ）
export type BotRequestState = Exclude<BotGroupSeatState, 'unsent'>;

export interface BotRequestBrief {
  botId: string;
  requestId: string;
  no: string; // #0003
  createdAt: number;
  state: BotRequestState; // 送信済み → 調査中 → 回答あり／遅れ／エラー／待つのをやめた（botGroupSeatState と同じ決め方）
  role?: string; // 依頼に入れた役の名前
  attached?: BotAttachment[];
  progress: number; // 届いた途中経過の数（10 通まで）
  step?: { n: number; of?: number }; // いちばん新しい途中経過の step
  title?: string; // いちばん新しい途中経過の title
  final?: { type: 'reply' | 'error'; fileId: string; at: number; faint: boolean; read: boolean };
  group?: number;
  head?: string; // 頼む文の最初の 40 字（設定でオンのときだけ）
  parentRequestId?: string; // 続きとして頼んだ元の依頼（R5）
  thread?: string; // 糸の根（R5。親をたどったいちばん上の依頼の requestId）。続きのある依頼と、その根の依頼だけに付く
  // 送ったあと（R8。伝票レールと追跡票）
  elapsedSec: number; // 経過の秒（待っていれば今まで、終わっていれば返事まで。写しを作った時点。右は createdAt から数え直してよい）
  pasted?: 'yes' | 'no'; // 貼りましたか？の答え（無ければ、まだ分からない）
  acceptedAt?: number; // 相手が受け取った時刻（最初の途中経過）
  overdue?: true; // 待っていて、知らせの期限（巣の設定 noticeHours）を過ぎた（レールで赤）
  ping?: true; // 試し便
  pingMismatch?: true; // 試し便に check の合わない返事が届いた（照合 ✗）
  // 受け取り箱 v2（R9）。no は言い換えなら #0010-2（requestList が入れる）
  retryOf?: string; // 言い換えてもう一回の元の依頼
  mark?: BotMark; // 当たり／ずれ／宛て先違い
  presetIds?: string[]; // 使った定型の id（「言い換えてもう一回」「頼み方を直す」で小窓に戻す）
  // 返し先「六角メモにも届く」（R10）。回答カードの札「六角メモにも届く」／写したあとは delivered の 1 行
  deliverTo?: BotDeliverTo;
  delivered?: { at: string; note: string };
  // webhook「そのまま送る」（R11）。伝票・追跡票は「貼った？」を飛ばす（コピーへ切り替えたあとは今までと同じ）
  via?: 'hook';
  hook?: { at: number; ok: boolean; why?: string }; // 中継の答え（無ければ答えを待っている）
  copiedAt?: number; // 届かなかったので、同じ依頼をコピーしてアプリを開くに切り替えた時刻
  hookCopy?: true; // 届かなかった依頼を、まだ同じ依頼でコピーに切り替えられる（この窓のあいだ左が依頼を覚えているときだけ）
}

// 今月の量の目安（R9・D21）：今月作った依頼の数と、頼む文の字数の合計（料金は出さない。試し便は数えない。30 日・200 件で片づけた分は入らない）
export interface BotMonthly {
  count: number;
  chars: number;
}

// 印の数（R9）：定型の id ごと・役の名前ごと（R4b の棚の数字の元。pending.json にある依頼〔30 日・200 件〕から数える）
export interface BotMarkCount {
  hits: number;
  misses: number;
  wrongTo: number;
}
export interface BotMarkTally {
  presets: Record<string, BotMarkCount>;
  roles: Record<string, BotMarkCount>;
}

export interface BotRequestList {
  total: number; // 覚えている依頼の数（全部のボット）
  waiting: number; // そのうち待っているもの
  items: BotRequestBrief[]; // 新しいものから REQUEST_LIST_MAX 件
  groups: BotGroupStatus[]; // items に出てくる組の状態
  monthly?: BotMonthly; // 今月の量の目安（R9。受け取り箱の隅）
  tally?: BotMarkTally; // 印の数（R9。回答カードの印の説明・R4b の棚）
}

// 「まず 1 枚」の表の 1 行（R9・D19）：前の「読んだ」より後に届いた、まだ読んでいない終わりの返事（確かめが通ったもの。試し便は入れない）
//   line：返事の一言（左が記録から読み直して入れる。読み終えるまでは無い）
export interface BotAwayRow {
  botId: string;
  requestId: string;
  no: string;
  role?: string;
  head?: string; // 頼む文の最初の 40 字（設定でオンのときだけ）
  type: 'reply' | 'error';
  fileId: string;
  at: number;
  line?: string;
}

// 「まず 1 枚」の表の写し（R9）。since：前の「読んだ」の時刻（無ければ、まだ一度も読んでいない）　total：行の全部の数（rows は AWAY_ROWS_MAX まで）
//   grey：同じあいだに届いた灰色の返事（check が合わない・知らない依頼・知らせ）の数　greyBot：そのうちボットの分かる最初のもの
export interface BotAwayView {
  since?: number;
  rows: BotAwayRow[];
  total: number;
  grey: number;
  greyBot?: string;
}

export const AWAY_ROWS_MAX = 12;
const HOOK_HELD_MAX = 20; // webhook で送った依頼を、届かなかったときのためにメモリーに置く数（R11）

// 一覧の状態の短い名前（受け取り箱のチップ・巣の下の1行）
export function botRequestStateLabel(state: BotRequestState): string {
  const labels: Record<BotRequestState, string> = { sent: '送信済み', working: '調査中', replied: '回答あり', late: '遅れています', error: 'ボットのエラー', stopped: '待つのをやめた' };
  return labels[state];
}

export const isWaitingState = (state: BotGroupSeatState) => state === 'sent' || state === 'working' || state === 'late';

// 進み具合のバー：step.of があれば n/of、無ければ届いた途中経過の数／10
export function requestProgress(r: Pick<BotRequestBrief, 'progress' | 'step'>): { value: number; max: number; label: string } {
  if (r.step?.of) {
    const max = r.step.of;
    const value = Math.min(r.step.n, max);
    return { value, max, label: `${value}/${max}` };
  }
  const max = BOT_LIMITS.progressPerRequest;
  const value = Math.min(r.progress, max);
  return { value, max, label: `${value}/${max}` };
}

//   noticeHours：知らせの期限（巣の設定。R8）。待っていて過ぎたものに overdue
export function requestBrief(botId: string, r: BotPendingRequest, now: number, lateMinutes: number, headline: boolean, noticeHours: number = NOTICE_HOURS.default): BotRequestBrief {
  const end = r.final ? r.final.at : r.status === 'waiting' ? now : r.createdAt;
  return {
    botId,
    requestId: r.requestId,
    no: requestNo(r.requestId),
    createdAt: r.createdAt,
    state: botGroupSeatState(r, now, lateMinutes) as BotRequestState,
    ...(r.role ? { role: r.role } : {}),
    ...(r.attached?.length ? { attached: [...r.attached] } : {}),
    progress: r.progress,
    ...(r.lastStep ? { step: { ...r.lastStep } } : {}),
    ...(r.lastTitle ? { title: r.lastTitle } : {}),
    ...(r.final ? { final: { type: r.final.type, fileId: r.final.fileId, at: r.final.at, faint: r.final.faint, read: r.final.read } } : {}),
    ...(r.group ? { group: r.group } : {}),
    ...(headline && r.head ? { head: r.head } : {}),
    ...(r.parentRequestId ? { parentRequestId: r.parentRequestId } : {}),
    elapsedSec: Math.max(0, Math.round((end - r.createdAt) / 1000)),
    ...(r.pasted === 'yes' || r.pasted === 'no' ? { pasted: r.pasted } : {}),
    ...(r.acceptedAt ? { acceptedAt: r.acceptedAt } : {}),
    ...(r.status === 'waiting' && !r.final && now - r.createdAt > noticeHours * 3_600_000 ? { overdue: true as const } : {}),
    ...(r.ping ? { ping: true as const, ...(r.pingMismatch ? { pingMismatch: true as const } : {}) } : {}),
    ...(r.retryOf ? { retryOf: r.retryOf } : {}),
    ...(r.mark ? { mark: r.mark } : {}),
    ...(r.presetIds?.length ? { presetIds: [...r.presetIds] } : {}),
    ...(r.deliverTo ? { deliverTo: r.deliverTo } : {}),
    ...(r.delivered ? { delivered: { ...r.delivered } } : {}),
    ...(r.via === 'hook' ? { via: 'hook' as const, ...(r.hook ? { hook: { ...r.hook } } : {}), ...(r.copiedAt ? { copiedAt: r.copiedAt } : {}) } : {}),
  };
}

// 言い換えてもう一回の表示の番号（R9）：元（retryOf をたどった、いちばん上の依頼）の番号に、作った順で -2・-3…。言い換えでない依頼は入らない
//   元が片づいて（30 日・200 件）覚えていなくても、その元の番号を使う（botThreadRoot と同じたどり方）
export function botRetryNos(requests: readonly Pick<BotPendingRequest, 'requestId' | 'retryOf' | 'createdAt'>[]): Map<string, string> {
  const of = new Map<string, string>();
  for (const r of requests) if (r.retryOf) of.set(r.requestId, r.retryOf);
  const byRoot = new Map<string, { requestId: string; createdAt: number }[]>();
  for (const r of requests) {
    if (!r.retryOf) continue;
    const root = botThreadRoot(r.requestId, of);
    byRoot.set(root, [...(byRoot.get(root) ?? []), r]);
  }
  const out = new Map<string, string>();
  for (const [root, list] of byRoot) {
    list.sort((a, b) => a.createdAt - b.createdAt).forEach((r, i) => out.set(r.requestId, `${requestNo(root)}-${i + 2}`));
  }
  return out;
}

// 今月の量の目安（R9・D21。こちらの時計の暦の月。試し便は数えない）
export function botMonthly(requests: readonly Pick<BotPendingRequest, 'createdAt' | 'textChars' | 'ping'>[], now: number): BotMonthly {
  const at = new Date(now);
  const month = requests.filter((r) => {
    const d = new Date(r.createdAt);
    return !r.ping && d.getFullYear() === at.getFullYear() && d.getMonth() === at.getMonth();
  });
  return { count: month.length, chars: month.reduce((sum, r) => sum + r.textChars, 0) };
}

// 印の数（R9）：印のある依頼の、使った定型ごと・役ごと
export function botMarkTally(requests: readonly Pick<BotPendingRequest, 'mark' | 'presetIds' | 'role'>[]): BotMarkTally {
  const presets = new Map<string, BotMarkCount>();
  const roles = new Map<string, BotMarkCount>();
  const add = (map: Map<string, BotMarkCount>, key: string, mark: BotMark) => {
    const count = map.get(key) ?? { hits: 0, misses: 0, wrongTo: 0 };
    if (mark === 'hit') count.hits += 1;
    else if (mark === 'miss') count.misses += 1;
    else count.wrongTo += 1;
    map.set(key, count);
  };
  for (const r of requests) {
    if (!r.mark) continue;
    for (const id of r.presetIds ?? []) add(presets, id, r.mark);
    if (r.role) add(roles, r.role, r.mark);
  }
  return { presets: Object.fromEntries(presets), roles: Object.fromEntries(roles) };
}

// 量の目安の言葉（R9。「今月 38 通・約 4.1 万字」。1 万字より少なければ字のまま）
export function monthlyText(m: BotMonthly): string {
  const chars = m.chars >= 10_000 ? `約 ${(m.chars / 10_000).toFixed(1)} 万字` : `${m.chars.toLocaleString('ja-JP')} 字`;
  return `今月 ${m.count.toLocaleString('ja-JP')} 通・${chars}`;
}

const THREAD_DEPTH_MAX = 200; // 糸をたどる深さ（pending.json はボットごとに 200 件まで）

// 糸の根（R5）：親（parentRequestId）をたどった、いちばん上の依頼の requestId。
//   親が片づいて（30 日・200 件）覚えていなくても、その親の id を根にする（同じ親から続けた依頼は、同じ糸のまま）。輪になっていたら止める
export function botThreadRoot(requestId: string, parentOf: ReadonlyMap<string, string>): string {
  const seen = new Set([requestId]);
  let root = requestId;
  for (let i = 0; i < THREAD_DEPTH_MAX; i++) {
    const parent = parentOf.get(root);
    if (!parent || seen.has(parent)) break;
    seen.add(parent);
    root = parent;
  }
  return root;
}

// 「続きとして」の選び口に出す返事（R5。受け取り箱の一覧の写しから。確かめが通った reply だけ、返事の新しいものから）
export interface BotRecentReply {
  botId: string;
  requestId: string;
  no: string; // #0010
  at: number; // 返事を受け取った時刻
  role?: string;
  head?: string; // 頼む文の最初の 40 字（設定でオンのときだけ）
}

export const RECENT_REPLIES_MAX = 5;

export function recentReplies(list: BotRequestList | null | undefined, max = RECENT_REPLIES_MAX): BotRecentReply[] {
  return (list?.items ?? [])
    .filter((i) => i.final?.type === 'reply' && !i.ping) // 試し便（R8）の pong は続きにしない
    .sort((a, b) => (b.final?.at ?? 0) - (a.final?.at ?? 0))
    .slice(0, max)
    .map((i) => ({ botId: i.botId, requestId: i.requestId, no: i.no, at: i.final?.at ?? i.createdAt, ...(i.role ? { role: i.role } : {}), ...(i.head ? { head: i.head } : {}) }));
}

// 写しの選び口を確かめ直す（読む画面の受け口。形の違うものは落とす）
export function cleanRecentReplies(raw: unknown): BotRecentReply[] {
  if (!Array.isArray(raw)) return [];
  const out: BotRecentReply[] = [];
  for (const r of raw.slice(0, RECENT_REPLIES_MAX)) {
    if (typeof r !== 'object' || r === null) continue;
    const v = r as Record<string, unknown>;
    if (!isBotId(v.botId) || typeof v.requestId !== 'string' || !RELAY_REQUEST_ID_RE.test(v.requestId)) continue;
    const head = typeof v.head === 'string' ? cutChars(cleanBotLine(v.head), 40).text : '';
    const role = typeof v.role === 'string' ? cutChars(cleanBotLine(v.role), 40).text : '';
    const no = typeof v.no === 'string' && /^#\d{4,6}(-\d{1,3})?$/.test(v.no) ? v.no : requestNo(v.requestId); // 言い換えの #0010-2（R9）はそのまま
    out.push({ botId: v.botId, requestId: v.requestId, no, at: Number.isFinite(v.at) ? (v.at as number) : 0, ...(role ? { role } : {}), ...(head ? { head } : {}) });
  }
  return out;
}

// 「続きとして」の要点の行（R5。命令 botAnswerLines の返事）。found：記録に確かめが通った返事があった
//   line：「#0010 の続き：」の後ろに入れる 1 行（botAnswerLine）　lines：要点の行（botAnswerPoints。1 行 200 字まで）
export interface BotAnswerLines {
  botId: string;
  requestId: string;
  found: boolean;
  no: string;
  line: string;
  lines: string[];
}

export const ANSWER_LINES_MAX = 8;
export const ANSWER_LINE_CHARS = 200;

// 返事の写しを確かめ直す（右・読む画面の受け口。形の違うものは null）
export function cleanAnswerLines(raw: unknown): BotAnswerLines | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const v = raw as Record<string, unknown>;
  if (!isBotId(v.botId) || typeof v.requestId !== 'string' || !RELAY_REQUEST_ID_RE.test(v.requestId)) return null;
  const line = (value: unknown) => (typeof value === 'string' ? cutChars(cleanBotLine(value), ANSWER_LINE_CHARS).text : '');
  const lines = Array.isArray(v.lines) ? v.lines.slice(0, ANSWER_LINES_MAX).map(line).filter(Boolean) : [];
  return { botId: v.botId, requestId: v.requestId, found: v.found === true, no: requestNo(v.requestId), line: line(v.line), lines };
}

// 受け取り口の様子の短い言葉（巣の下の1行）。ok：返事を受け取れる
export function inboxStatusText(status: BotInboxStatus | null | undefined): { text: string; ok: boolean; hint: string } {
  if (!status) return { text: '受け取り口 …', ok: false, hint: '受け取り口の様子を待っています' };
  if (!status.owner) return { text: '受け取り口：別の窓', ok: false, hint: '同じデータフォルダの、もう1つの窓が返事を受け取っています' };
  if (!status.watching) return { text: '受け取り口：休み', ok: false, hint: '台帳にボットがいないので、返事の見回りを止めています' };
  if (!status.relay) return { text: '受け取り口 ✓（中継なし）', ok: true, hint: '返事の置き場は見ていますが、中継の置き場（RocksCellsRelay）は見ていません' };
  return { text: '受け取り口 ✓', ok: true, hint: '返事の受け取り口を見ています（4 秒おき）' };
}

// 中継の見張り（R8・D18）：返事を取りに行く常駐（C++ の 4 秒おきの見回り）の様子の 1 行。鍵や中継・置き場の場所は出さない。
//   最後に見回った時刻は、左が 1 分おきに C++ に聞く（見回りそのものは知らせない）ので、3 分より古ければ「止まっているかも」
export const SCAN_STALE_MS = 3 * 60_000;
export function inboxWatchText(status: BotInboxStatus | null | undefined, now: number): { text: string; ok: boolean; hint: string } {
  const head = '返事を取りに行く常駐：';
  if (!status) return { text: `${head}様子を待っています`, ok: false, hint: 'ブラウザの本体から、受け取り口の様子がまだ届いていません' };
  if (!status.owner) return { text: `${head}別の窓で動いています`, ok: false, hint: '同じデータフォルダの、もう1つの窓が返事を取りに行っています（この窓には届きません）' };
  const at = status.lastScanAt ? new Date(status.lastScanAt) : null;
  const last = at ? `（最後 ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}）` : '';
  if (!status.watching) return { text: `${head}止まっています${last}`, ok: false, hint: '台帳にボットがいないので、見回りを止めています。「いま取りに行く」で 1 回だけ見に行けます' };
  if (status.lastScanAt && now - status.lastScanAt > SCAN_STALE_MS) {
    return { text: `${head}止まっているかもしれません${last}`, ok: false, hint: 'しばらく見回った様子がありません。「いま取りに行く」で、すぐに 1 回見に行けます' };
  }
  return { text: `${head}動いています${last}`, ok: true, hint: `4 秒おきに、返事の置き場を見に行っています${status.relay ? '' : '（中継の置き場は見ていません）'}` };
}

// まとめて読む（組のカード。返事を役の順〔席の順〕に並べるだけ。AI でまとめ直さない）
export interface BotGroupReply {
  botId: string;
  no: string;
  role?: string;
  fileId: string;
  type: 'reply' | 'error';
  at: number;
  title?: string;
  text: string; // THREAD_SHOW_CHARS 字まで
  shownCut: boolean;
  error?: { code: string; message?: string };
  summary?: true; // まとめ役の返事（G3。席の返事とは分けて出す）
  requestId?: string; // まとめがどの依頼のものか（渡し直したとき、前のまとめと取り違えない）
}

export class BotInbox {
  private readonly pendings = new Map<string, BotPendingFile>(); // ボットの id（と _unrouted）→ pending.json
  private readonly logs = new Map<string, { n: number; entries: BotLogEntry[] }>(); // 書いている途中の記録
  private readonly incoming: BotReplyEnvelope[] = []; // 読み込む前に届いた返事
  private readonly listeners: (() => void)[] = [];
  private readonly arrivals: ((arrival: BotArrival) => void)[] = [];
  private readonly replies: ((reply: BotReplyArrival) => void)[] = [];
  private readonly pruned: ((requests: Pick<BotPendingRequest, 'mark' | 'presetIds' | 'role'>[]) => void)[] = [];
  private queue: Promise<unknown> = Promise.resolve(); // 書く順番を1列に
  private loaded = false;
  private loading: Promise<void> | null = null;
  private draining = false;
  private watching: boolean | null = null;
  private status: BotInboxStatus | null = null;
  private readonly plans = new Map<number, { ids: string[]; roles: string[]; team?: BotRoleGroup }>(); // 組の番号 → 聞くと決めた席（S3.8・G2。メモリーだけ）
  // Grok の提案（type が "patch" のファイル）を受け取る口。返すのは null（受け取った）か断る理由（英数字の短い名前）
  private patchHandler: ((reply: unknown, fileId: string) => Promise<string | null>) | null = null;
  // webhook（R11）で送った依頼の JSON（requestId → ボットと依頼）。届かなかったとき、同じ依頼をコピーに切り替えるためだけに、この窓のあいだメモリーに置く
  //   （頼む文は記録に残さない決まりのまま。中継が受けた・コピーに切り替えた・待つのをやめたら捨てる。HOOK_HELD_MAX 件まで）
  private readonly hookHeld = new Map<string, { botId: string; request: BotRequestV1 }>();

  constructor(private readonly store: BotStore) {}

  // 左の UI の起動のときに1回（send({ type: 'ready' }) より前に。ready のあとで C++ が取ったままの返事を渡し直すため）
  start() {
    onMessage((msg) => {
      if (msg.type === 'botReply') {
        this.receive(msg);
      } else if (msg.type === 'botInboxState') {
        this.applyStatus(msg);
      }
    });
    this.store.onChange(() => {
      this.updateWatch();
      void this.load();
      this.dropHeads();
    });
    if (this.store.ready) {
      this.updateWatch();
      void this.load();
    }
  }

  get ready() {
    return this.loaded;
  }

  // 受け取り口の様子（まだ知らせが無ければ null）。owner が false なら、同じデータフォルダの別の窓が受け取っている
  get inbox(): BotInboxStatus | null {
    return this.status;
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  // 返事を1通記録した（光る・吹き出し・点滅を決めるため。中身は渡さない）
  onArrival(fn: (arrival: BotArrival) => void) {
    this.arrivals.push(fn);
  }

  // 依頼と合う1通目の reply を記録した（Grok Visions〔S3.7b〕が「## Vision」の節を取り出すため。check は外してある）
  //   確かめ（check・二重の見分け）は applyBotMessage のまま。記録に書けたあとで呼ぶだけで、受け取り方は変えない
  onReply(fn: (reply: BotReplyArrival) => void) {
    this.replies.push(fn);
  }

  // Grok の提案（patch.v1。grok-patch.ts）を受け取り口で受け取る（左の UI が起動のときに1回）。
  //   type が "patch" のものだけ、ボットの返事として読まずに渡す。決めたら、受け取り口をボットがいなくても見る
  onPatch(fn: (reply: unknown, fileId: string) => Promise<string | null>) {
    this.patchHandler = fn;
    this.watching = null;
    this.updateWatch();
  }

  // 印のある依頼が pending.json から片づいた（30 日・200 件。R4b：定型の棚が、その印を presets.json の数に積む）。
  //   今ある依頼の印は一覧の写しの tally で数えるので、片づいた分だけを渡す（同じ印を二度数えない）
  onPrunedMarks(fn: (requests: Pick<BotPendingRequest, 'mark' | 'presetIds' | 'role'>[]) => void) {
    this.pruned.push(fn);
  }

  // 今すぐ受け取り口を見てもらう（C++ の botCheck）
  check() {
    send({ type: 'botCheck' });
  }

  // 受け取り口の様子を聞き直す（R8 の中継の見張り）。scan：今すぐ取りに行ってから答えてもらう（「いま取りに行く」）。
  //   false なら見回らずに様子だけ（peek。最後に見回った時刻を知るため）。答えが無ければ null
  async refreshStatus(scan: boolean): Promise<BotInboxStatus | null> {
    const reply = await request((requestId) => ({ type: 'botCheck', requestId, ...(scan ? {} : { peek: true }) }), 5_000);
    if (reply?.type !== 'botInboxState') return null;
    this.applyStatus(reply);
    return this.status;
  }

  // ボットの状態（返事・遅れ・作業中）と、札の数
  activity(botId: string, now = Date.now()): BotActivity {
    return botActivity(this.pendings.get(botId), now, lateMinutesOf(this.store.get(botId)));
  }

  // 右へ送る写し（台帳にいるボットだけ。本文は入れない）。overdue：知らせの期限を過ぎた待っている依頼の数（R8。無ければ入れない）
  briefs(now = Date.now()): BotBriefState[] {
    const limit = this.store.nest().noticeHours * 3_600_000;
    return this.store.list().map((bot) => {
      const overdue = (this.pendings.get(bot.id)?.requests ?? []).filter((r) => r.status === 'waiting' && !r.final && now - r.createdAt > limit).length;
      return { id: bot.id, ...this.activity(bot.id, now), ...(overdue ? { overdue } : {}) };
    });
  }

  // みんなに聞くの組の状態（S3.6。planned：聞くと決めた席のボットの id。あれば、まだ作っていない席を「送信前」に）
  groupStatus(group: number, now = Date.now()): BotGroupStatus {
    const plan = this.plans.get(group);
    const requests = [...this.pendings].flatMap(([botId, p]) => (botId === UNROUTED ? [] : p.requests.map((request) => ({ botId, request }))));
    return botGroupStatus(group, requests, now, (botId) => lateMinutesOf(this.store.get(botId)), plan?.ids, plan ? { team: plan.team, roles: plan.roles } : undefined);
  }

  // 受け取り箱の一覧（S3.8。台帳にいるボットの依頼だけ。新しいものから）
  //   糸（R5）：続きの元をたどった根を thread に。続きのある依頼と、続きを持つ根の依頼だけに付ける（ほかは今までどおり）
  //   受け取り箱 v2（R9）：言い換えの表示の番号（#0010-2）・今月の量（monthly）・印の数（tally）。どれも台帳にいるボットの依頼から
  requestList(now = Date.now()): BotRequestList {
    const nest = this.store.nest();
    const headline = nest.headline === 'on';
    const all: BotRequestBrief[] = [];
    const pendings: BotPendingRequest[] = [];
    for (const bot of this.store.list()) {
      const late = lateMinutesOf(bot);
      for (const r of this.pendings.get(bot.id)?.requests ?? []) {
        all.push(requestBrief(bot.id, r, now, late, headline, nest.noticeHours));
        pendings.push(r);
      }
    }
    all.sort((a, b) => b.createdAt - a.createdAt);
    const parentOf = this.parentMap();
    const rooted = new Set([...parentOf.keys()].map((id) => botThreadRoot(id, parentOf)));
    const retryNos = botRetryNos(pendings);
    const items = all.slice(0, REQUEST_LIST_MAX).map((item) => {
      const root = botThreadRoot(item.requestId, parentOf);
      const no = retryNos.get(item.requestId);
      const copyable = item.via === 'hook' && item.hook?.ok === false && !item.copiedAt && isWaitingState(item.state) && this.hookHeld.has(item.requestId); // R11
      return { ...item, ...(no ? { no } : {}), ...(root !== item.requestId || rooted.has(item.requestId) ? { thread: root } : {}), ...(copyable ? { hookCopy: true as const } : {}) };
    });
    const groups = [...new Set(items.flatMap((i) => (i.group ? [i.group] : [])))];
    return {
      total: all.length,
      waiting: all.filter((r) => isWaitingState(r.state)).length,
      items,
      groups: groups.map((g) => this.groupStatus(g, now)),
      monthly: botMonthly(pendings, now),
      tally: botMarkTally(pendings),
    };
  }

  // 画面に出す依頼の番号（言い換えなら #0010-2。R9）
  noOf(requestId: string): string {
    return this.retryNos().get(requestId) ?? requestNo(requestId);
  }

  // 「まず 1 枚」の表の元（R9・D19）：since（前の「読んだ」の時刻）より後に届いた、まだ読んでいない終わりの返事
  //   （確かめが通ったもの。待つのをやめたあとの返事・試し便は入れない）。新しい返事から AWAY_ROWS_MAX 行と、全部の数
  away(since: number): { rows: BotAwayRow[]; total: number } {
    const headline = this.store.nest().headline === 'on';
    const nos = this.retryNos();
    const rows: BotAwayRow[] = [];
    for (const bot of this.store.list()) {
      for (const r of this.pendings.get(bot.id)?.requests ?? []) {
        const f = r.final;
        if (!f || f.read || f.faint || r.ping || f.at <= since) continue;
        rows.push({
          botId: bot.id,
          requestId: r.requestId,
          no: nos.get(r.requestId) ?? requestNo(r.requestId),
          ...(r.role ? { role: r.role } : {}),
          ...(headline && r.head ? { head: r.head } : {}),
          type: f.type,
          fileId: f.fileId,
          at: f.at,
        });
      }
    }
    rows.sort((a, b) => b.at - a.at);
    return { rows: rows.slice(0, AWAY_ROWS_MAX), total: rows.length };
  }

  // since より後に届いた灰色の返事（check が合わない・知らない依頼・知らせ・版違い。途中経過は数えない）の数（R9 の「まず 1 枚」の預かりの行）。
  //   記録の新しいものから見る（ボットごとに THREAD_ITEMS の 2 倍まで）。botId：ボットの分かる最初のもの（どれも分からなければ無し）
  async greyAfter(since: number): Promise<{ count: number; botId?: string }> {
    if (!this.loaded) return { count: 0 };
    let count = 0;
    let botId: string | undefined;
    for (const key of [...this.store.list().map((b) => b.id), UNROUTED]) {
      const { entries } = await this.recentLog(key, THREAD_ITEMS * 2);
      const n = entries.filter((e) => e.kind === 'message' && e.grey === true && e.at > since && e.message?.type !== 'progress').length;
      if (n && key !== UNROUTED && !botId) botId = key;
      count += n;
    }
    return { count, ...(botId ? { botId } : {}) };
  }

  // 試し便の依頼か（R9：不在票・「まず 1 枚」の表に数えない）
  isPing(botId: string, requestId: string): boolean {
    return this.pendings.get(botId)?.requests.find((r) => r.requestId === requestId)?.ping === true;
  }

  // まとめて読む（S3.8）：組の席の順に、終わりの返事（reply・error）を記録から読む。check は入れない
  async groupReplies(group: number): Promise<BotGroupReply[]> {
    const out: BotGroupReply[] = [];
    for (const seat of this.groupStatus(group).seats) {
      const final = this.pendings.get(seat.botId)?.requests.find((r) => r.requestId === seat.requestId)?.final;
      if (!final) continue;
      const found = await this.findMessage(seat.botId, final.fileId);
      if (!found) continue;
      const m = found.message;
      const cut = cutChars(m.text, THREAD_SHOW_CHARS);
      out.push({
        botId: seat.botId,
        no: seat.no ?? '#?',
        ...(seat.role ? { role: seat.role } : {}),
        fileId: final.fileId,
        type: final.type,
        at: final.at,
        ...(m.title ? { title: m.title } : {}),
        text: cut.text,
        shownCut: cut.cut,
        ...(m.error ? { error: m.error } : {}),
      });
    }
    const summary = this.groupStatus(group).summary;
    const summaryFinal = summary?.requestId ? this.pendings.get(summary.botId)?.requests.find((r) => r.requestId === summary.requestId)?.final : undefined;
    if (summary && summaryFinal) {
      const found = await this.findMessage(summary.botId, summaryFinal.fileId);
      if (found) {
        const cut = cutChars(found.message.text, THREAD_SHOW_CHARS);
        out.push({
          botId: summary.botId,
          no: summary.no ?? '#?',
          ...(summary.role ? { role: summary.role } : {}),
          fileId: summaryFinal.fileId,
          type: summaryFinal.type,
          at: summaryFinal.at,
          ...(found.message.title ? { title: found.message.title } : {}),
          text: cut.text,
          shownCut: cut.cut,
          ...(found.message.error ? { error: found.message.error } : {}),
          summary: true,
          requestId: summary.requestId,
        });
      }
    }
    return out;
  }

  // まとめ役に渡すための、役ごとの返事（全文。無い役は text なし＝「まだ届いていません」）。画面用の 4,000 字では切らない
  async handoffSources(group: number): Promise<{ role: string; name: string; text?: string }[]> {
    const out: { role: string; name: string; text?: string }[] = [];
    for (const seat of this.groupStatus(group).seats) {
      const role = seat.role || '役なし';
      const name = this.store.get(seat.botId)?.name ?? '';
      if (seat.state !== 'replied' || !seat.requestId) {
        out.push({ role, name });
        continue;
      }
      const final = this.pendings.get(seat.botId)?.requests.find((r) => r.requestId === seat.requestId)?.final;
      if (!final || final.type !== 'reply') {
        out.push({ role, name });
        continue;
      }
      const found = await this.findMessage(seat.botId, final.fileId);
      out.push({ role, name, text: found?.message.text ?? '（返事が記録に見つかりませんでした）' });
    }
    return out;
  }

  // 依頼を作って覚える（送らない。クリップボードに入れてアプリを開くのは bot-send.ts の ClipboardSender。人が押したときだけ）
  //   requestId は hb-YYYYMMDD-NNNN-xxxx、check は英数字 10 字、attempt は 1。頼む文そのものは記録に残さない（字数だけ）
  //   役（S3.4）：input.role が undefined なら台帳のそのボットの役（null なら役なし）。席の番号は、巣に置いていればその席（1〜6）
  //   pending.json には役の名前（role）と、みんなに聞くの組の番号（group。あれば）も覚える
  async createRequest(botId: string, input: BotRequestInput): Promise<CreateBotRequestResult> {
    if (!this.loaded) return { ok: false, error: 'notReady' };
    if (this.status?.owner !== true) return { ok: false, error: this.status ? 'otherWindow' : 'notReady' };
    const bot = this.store.get(botId);
    if (!bot) return { ok: false, error: 'badBot' };
    const now = new Date();
    const used = [...this.pendings.values()].flatMap((p) => p.requests.map((r) => r.requestId));
    const seat = this.store.docked().indexOf(botId) + 1;
    const withRole: BotRequestInput = { ...input, role: input.role === undefined ? (bot.role ?? null) : input.role, seat: input.seat ?? (seat > 0 ? seat : undefined) };
    const built = buildBotRequest(botId, newBotRequestId(now, used), newBotCheck(), withRole, now);
    if (!built.ok) return built;
    const { request: req } = built;
    const pending = this.pendingOf(botId);
    const group = Number.isInteger(input.group) && (input.group ?? 0) >= 1 ? input.group : undefined;
    const team = group && isRoleGroup(input.team) ? input.team : undefined;
    const summary = !!(group && input.summary);
    if (group && Array.isArray(input.planned)) this.planGroup(group, input.planned, team, input.plannedRoles);
    const ping = req.type === 'ping'; // 試し便（R8）：頭の 40 字・続きの元は覚えない
    const head = !ping && this.store.nest().headline === 'on' ? requestHead(input.text) : ''; // 設定でオンのときだけ 40 字（S3.8）
    // 続きの元（R5）：覚えている依頼のときだけ（知らない id は糸にしない。依頼はそのまま作る）
    const parent = !ping && typeof input.parentRequestId === 'string' && RELAY_REQUEST_ID_RE.test(input.parentRequestId) && this.knows(input.parentRequestId) ? input.parentRequestId : undefined;
    // 言い換えの元（R9）：覚えている依頼のときだけ（知らない id は #0010-2 にしない）。使った定型の id は形の合うものだけ
    const retryOf = !ping && typeof input.retryOf === 'string' && RELAY_REQUEST_ID_RE.test(input.retryOf) && this.knows(input.retryOf) ? input.retryOf : undefined;
    const presetIds = ping ? [] : cleanPresetIds(input.presetIds);
    const deliverTo = !ping && input.deliverTo === 'hex' ? input.deliverTo : undefined; // 六角メモにも届く（R10）
    const hook = !ping && input.via === 'hook'; // 中継へ直接（R11。試し便は今までどおりコピーで）
    pending.requests.push({
      requestId: req.requestId,
      check: req.check,
      attempt: req.attempt,
      createdAt: now.getTime(),
      status: 'waiting',
      textChars: [...req.text].length,
      ...(built.attached.length ? { attached: built.attached } : {}),
      progress: 0,
      progressOver: 0,
      extra: 0,
      ...(built.role ? { role: built.role } : {}),
      ...(group ? { group, ...(team ? { team } : {}), ...(summary ? { summary: true as const } : {}) } : {}),
      ...(head ? { head } : {}),
      ...(req.page?.url ? { page: req.page.url } : {}), // 回答カードの「タブに残す」で、そのタブを探す（S3.10。依頼の JSON に入れたのと同じ URL）
      ...(parent ? { parentRequestId: parent } : {}),
      ...(ping ? { ping: true as const } : {}),
      ...(retryOf ? { retryOf } : {}),
      ...(presetIds.length ? { presetIds } : {}),
      ...(deliverTo ? { deliverTo } : {}),
      ...(hook ? { via: 'hook' as const } : {}),
    });
    if (hook) this.holdHook(botId, req);
    const marked = pending.requests.filter((r) => r.mark);
    prunePending(pending, now.getTime());
    const gone = marked.filter((r) => !pending.requests.includes(r)).map((r) => ({ mark: r.mark, ...(r.presetIds ? { presetIds: [...r.presetIds] } : {}), ...(r.role ? { role: r.role } : {}) }));
    if (gone.length) for (const fn of this.pruned) fn(gone); // 印のある依頼が片づいた（R4b。定型の数に積む）
    const saved = await this.commit(botId, {
      at: now.getTime(),
      kind: 'request',
      requestId: req.requestId,
      attempt: req.attempt,
      textChars: [...req.text].length,
      ...(built.attached.length ? { attached: built.attached } : {}),
      ...(hook ? { sentBy: 'hook' as const } : {}),
    });
    this.emit();
    return saved ? { ok: true, request: req, json: built.json, no: this.noOf(req.requestId) } : { ok: false, error: 'save' };
  }

  // 作った依頼を取り消す（クリップボードに入れられず、アプリも開かなかったとき。使う人の手元に依頼が無いので、待たない）
  dropRequest(botId: string, requestId: string) {
    const pending = this.pendings.get(botId);
    const index = pending?.requests.findIndex((r) => r.requestId === requestId) ?? -1;
    if (!pending || index < 0) return;
    pending.requests.splice(index, 1);
    void this.commit(botId, { at: Date.now(), kind: 'stopped', requestId, reason: 'notCopied' });
    this.emit();
  }

  // ---------- webhook「そのまま送る」（依頼の小窓 v2・R11・D20） ----------

  // 中継の答えを覚える（ok：受けた　false：届かなかった。why は短いわけ〔鍵・URL は入れない〕）。botId が null なら全部のボットから探す
  //   （答えを待ちきれずに届かなかったことにしたあと、受けたという答えが遅れて届いたとき）。受けた答えはもう変えない・
  //   2 回目の「届かなかった」は書かない・コピーへ切り替えた依頼は変えない。変わったら true
  markHook(botId: string | null, requestId: string, outcome: { ok: true } | { ok: false; why: string }): boolean {
    const ids = botId ? [botId] : [...this.pendings.keys()];
    for (const id of ids) {
      const request = this.pendings.get(id)?.requests.find((r) => r.requestId === requestId);
      if (!request) continue;
      if (request.via !== 'hook' || request.copiedAt || request.hook?.ok || (request.hook && !outcome.ok)) return false;
      const why = outcome.ok ? '' : cutChars(cleanBotLine(outcome.why), HOOK_WHY_CHARS).text;
      request.hook = { at: Date.now(), ok: outcome.ok, ...(why ? { why } : {}) };
      if (outcome.ok) this.hookHeld.delete(requestId); // 中継が受けた：同じ依頼をコピーし直すことは無い
      void this.commit(id, null);
      this.emit();
      return true;
    }
    return false;
  }

  // 届かなかった依頼を、同じ依頼（requestId・check は同じ）でコピーに切り替える前に：attempt を 1 増やし、送った時刻を今にした依頼を返す（まだ書かない）。
  //   why：unknown＝知らない依頼　notFailed＝中継が受けた・まだ答えが無い　done＝もう返事が来た・待つのをやめた・もう切り替えた
  //        gone＝窓を開き直して、依頼をもう覚えていない（頼む文は記録に残さないので、同じ依頼は作れない）
  hookRetry(botId: string, requestId: string): { ok: true; request: BotRequestV1; no: string } | { ok: false; why: 'unknown' | 'notFailed' | 'done' | 'gone' } {
    const request = this.pendings.get(botId)?.requests.find((r) => r.requestId === requestId);
    if (!request || request.via !== 'hook') return { ok: false, why: 'unknown' };
    if (request.copiedAt || request.status !== 'waiting' || request.final) return { ok: false, why: 'done' };
    if (request.hook?.ok !== false) return { ok: false, why: 'notFailed' };
    const held = this.hookHeld.get(requestId);
    if (!held || held.botId !== botId) return { ok: false, why: 'gone' };
    const attempt = Math.min(request.attempt + 1, 1000);
    return { ok: true, request: { ...held.request, attempt, sentAt: new Date().toISOString() }, no: this.noOf(requestId) };
  }

  // コピーに切り替えた（クリップボードに書けた）：attempt と copiedAt を覚え、持っていた依頼を捨てる。記録には今までの kind: 'request' を attempt つきで足す
  markCopied(botId: string, requestId: string, attempt: number): boolean {
    const request = this.pendings.get(botId)?.requests.find((r) => r.requestId === requestId);
    if (!request || request.via !== 'hook' || request.copiedAt) return false;
    request.attempt = Math.max(request.attempt, Math.min(attempt, 1000));
    request.copiedAt = Date.now();
    this.hookHeld.delete(requestId);
    void this.commit(botId, { at: request.copiedAt, kind: 'request', requestId, attempt: request.attempt, textChars: request.textChars, ...(request.attached?.length ? { attached: [...request.attached] } : {}) });
    this.emit();
    return true;
  }

  // webhook で送る依頼を、この窓のあいだだけ覚える（古いものから捨てる）
  private holdHook(botId: string, request: BotRequestV1) {
    this.hookHeld.set(request.requestId, { botId, request: { ...request } });
    while (this.hookHeld.size > HOOK_HELD_MAX) {
      const oldest = this.hookHeld.keys().next().value;
      if (oldest === undefined) break;
      this.hookHeld.delete(oldest);
    }
  }

  // 依頼に付けたページの URL（? と # を消したもの。回答カードの「タブに残す」。S3.10）。付けていない・覚えていない依頼は undefined
  requestPage(botId: string, requestId: string): string | undefined {
    return this.pendings.get(botId)?.requests.find((r) => r.requestId === requestId)?.page;
  }

  // 終わりの返事を読んだ（右上の札から外す）。変わったら true（R9：左が「前の読んだ」の時刻を覚える）
  markRead(botId: string, requestId: string): boolean {
    const request = this.pendings.get(botId)?.requests.find((r) => r.requestId === requestId);
    if (!request?.final || request.final.read) return false;
    request.final.read = true;
    void this.commit(botId, null);
    this.emit();
    return true;
  }

  // 返事の印（R9・D19）：当たり／ずれ／宛て先違い。null で外す。終わりの返事が届いた依頼だけ（試し便は付けない）。
  //   pending.json の mark と、記録の kind: 'mark'（noteToMemo と同じ作法）。変わらなければ false
  setMark(botId: string, requestId: string, mark: BotMark | null): boolean {
    const request = this.pendings.get(botId)?.requests.find((r) => r.requestId === requestId);
    if (!request?.final || request.ping || (request.mark ?? null) === mark) return false;
    if (mark) request.mark = mark;
    else delete request.mark;
    void this.commit(botId, { at: Date.now(), kind: 'mark', requestId, mark });
    this.emit();
    return true;
  }

  // 貼りましたか？の答え（R8・D17）。yes：貼った　no：「消す」（クリップボードの依頼を消した＝貼らない。待つのもやめる）。
  //   変わらなければ false。答えは pending.json の pasted にだけ残す（頼む文・クリップボードの中身は残さない）
  markPasted(botId: string, requestId: string, answer: 'yes' | 'no'): boolean {
    const request = this.pendings.get(botId)?.requests.find((r) => r.requestId === requestId);
    if (!request || request.pasted === answer) return false;
    request.pasted = answer;
    const stop = answer === 'no' && request.status === 'waiting';
    if (stop) request.status = 'stopped';
    void this.commit(botId, stop ? { at: Date.now(), kind: 'stopped', requestId, reason: 'notPasted' } : null);
    this.emit();
    return true;
  }

  // 相手に届いたことが分かっている依頼か（確かめの合う途中経過か、終わりの返事が来た。R8：貼りましたか？を聞かずに済ませる）
  reached(botId: string, requestId: string): boolean {
    const request = this.pendings.get(botId)?.requests.find((r) => r.requestId === requestId);
    return !!(request && (request.acceptedAt || request.progress > 0 || request.final));
  }

  // 待つのをやめる（ボットの作業は止められないので、あとから届いた返事は薄く出す）
  stopWaiting(botId: string, requestId: string) {
    const request = this.pendings.get(botId)?.requests.find((r) => r.requestId === requestId);
    if (!request || request.status !== 'waiting') return;
    request.status = 'stopped';
    this.hookHeld.delete(requestId); // webhook で届かなかった依頼も、もうコピーし直さない（R11）
    void this.commit(botId, { at: Date.now(), kind: 'stopped', requestId });
    this.emit();
  }

  // 右のボットの欄へ送る、1体のやり取りの写し（新しい記録から THREAD_ITEMS 行。check は入れない）
  async thread(botId: string, now = Date.now()): Promise<BotThreadView | null> {
    if (!this.loaded || !this.store.get(botId)) return null;
    const pending = this.pendings.get(botId) ?? emptyPending();
    const lateMs = lateMinutesOf(this.store.get(botId)) * 60_000;
    const requests: BotThreadRequest[] = pending.requests
      .slice(-THREAD_REQUESTS)
      .reverse()
      .map((r) => ({
        requestId: r.requestId,
        no: requestNo(r.requestId),
        createdAt: r.createdAt,
        status: r.status,
        late: r.status === 'waiting' && now - r.createdAt > lateMs,
        textChars: r.textChars,
        progress: r.progress,
        ...(r.lastProgressAt ? { lastProgressAt: r.lastProgressAt } : {}),
        ...(r.final ? { final: { type: r.final.type, fileId: r.final.fileId, at: r.final.at, late: r.final.late, faint: r.final.faint, read: r.final.read } } : {}),
        extra: r.extra,
        ...(r.mark ? { mark: r.mark } : {}),
      }));
    // 言い換えの表示の番号（R9。#0010-2）：依頼・やり取りの行の番号を入れ替える
    const nos = this.retryNos();
    for (const r of requests) r.no = nos.get(r.requestId) ?? r.no;
    const { entries, earlier } = await this.recentLog(botId, THREAD_ITEMS * 2);
    const sent = new Map<string, Set<'cell' | 'right' | 'hex'>>();
    for (const e of entries) {
      if (e.kind === 'toMemo' && e.fileId && e.to) {
        const set = sent.get(e.fileId) ?? new Set();
        set.add(e.to);
        sent.set(e.fileId, set);
      }
    }
    const items: BotThreadItem[] = [];
    const noOf = (id: string) => nos.get(id) ?? requestNo(id);
    for (const e of entries) {
      if (e.kind === 'request' && e.requestId) {
        items.push({
          kind: 'request',
          at: e.at,
          requestId: e.requestId,
          no: noOf(e.requestId),
          textChars: e.textChars ?? 0,
          ...(e.sentBy === 'hook' ? { hook: true as const } : {}), // 中継へ直接（R11）
          ...(typeof e.attempt === 'number' && Number.isInteger(e.attempt) && e.attempt > 1 ? { attempt: e.attempt } : {}), // 届かずコピーへ切り替えた 2 回目から
        });
      } else if (e.kind === 'stopped' && e.requestId) {
        items.push({ kind: 'stopped', at: e.at, requestId: e.requestId, no: noOf(e.requestId), notCopied: e.reason === 'notCopied' });
      } else if (e.kind === 'message' && e.message && e.fileId) {
        const m = threadMessage(e, e.message, [...(sent.get(e.fileId) ?? [])]);
        items.push(m.requestId && nos.has(m.requestId) ? { ...m, no: nos.get(m.requestId) } : m);
      }
    }
    return { botId, requests, items: items.slice(-THREAD_ITEMS), earlier: earlier || items.length > THREAD_ITEMS };
  }

  // 依頼への確かめが通った返事（reply）の全文を記録から読む（R5「続きとして」の要点の行。check は外してある）。無ければ null
  async answerReply(botId: string, requestId: string): Promise<{ no: string; text: string } | null> {
    const final = this.pendings.get(botId)?.requests.find((r) => r.requestId === requestId)?.final;
    if (!this.loaded || final?.type !== 'reply') return null;
    const found = await this.findMessage(botId, final.fileId);
    if (!found || found.entry.grey === true || found.entry.match !== 'ok' || found.message.type !== 'reply') return null;
    return { no: requestNo(requestId), text: found.message.text ?? '' };
  }

  // 記録から、受け取った返事を1通探す（メモにするとき。check は外してある）
  async findMessage(botId: string, fileId: string): Promise<{ entry: BotLogEntry; message: BotMessage } | null> {
    const { entries } = await this.recentLog(botId, BOT_LIMITS.logEntries * 3);
    const entry = entries.find((e) => e.kind === 'message' && e.fileId === fileId && e.message);
    return entry?.message ? { entry, message: entry.message } : null;
  }

  // メモにしたことを記録に残す（六角メモへは2回送らない。右の欄に「送った ✓」と出す）
  noteToMemo(botId: string, fileId: string, to: 'cell' | 'right' | 'hex') {
    void this.commit(botId, { at: Date.now(), kind: 'toMemo', fileId, to }).then(() => this.emit());
  }

  // 返し先「六角メモにも届く」（R10・D13）：その依頼の返事を、まだ写していなければ写す先（写さない・写した・知らない依頼なら null）
  deliveryOf(botId: string, requestId: string): BotDeliverTo | null {
    const request = this.pendings.get(botId)?.requests.find((r) => r.requestId === requestId);
    return request?.deliverTo && !request.delivered && !request.ping ? request.deliverTo : null;
  }

  // 写したことを pending.json の delivered に残す（2 回は写さない。note はカードの下の 1 行。noteToMemo と同じく commit で保存）。
  //   もう写してある・写す先の無い依頼なら false
  markDelivered(botId: string, requestId: string, note: string): boolean {
    const request = this.pendings.get(botId)?.requests.find((r) => r.requestId === requestId);
    if (!request?.deliverTo || request.delivered) return false;
    request.delivered = { at: new Date().toISOString(), note: cutChars(cleanBotLine(note), DELIVERED_NOTE_CHARS).text };
    void this.commit(botId, null);
    this.emit();
    return true;
  }

  // ---------- 内側 ----------

  // C++ の受け取り口の様子を覚える（lastScanAt は ISO の時刻を数に。読めなければ無し）
  private applyStatus(msg: { owner: boolean; relay: boolean; watching: boolean; lastScanAt?: string }) {
    const wasOwner = this.status?.owner;
    const scanned = typeof msg.lastScanAt === 'string' ? Date.parse(msg.lastScanAt) : NaN;
    this.status = { owner: msg.owner === true, relay: msg.relay === true, watching: msg.watching === true, ...(Number.isFinite(scanned) ? { lastScanAt: scanned } : {}) };
    // 別の窓が閉じて、この窓が受け取るようになった：その窓が書いた pending.json を読み直す
    if (wasOwner === false && this.status.owner) this.reload();
    this.emit();
  }

  // 覚えている依頼か（どのボットの pending.json でも。続きの元を確かめる。R5）
  private knows(requestId: string): boolean {
    for (const pending of this.pendings.values()) if (pending.requests.some((r) => r.requestId === requestId)) return true;
    return false;
  }

  // 言い換えの表示の番号（全部のボット。R9）
  private retryNos(): Map<string, string> {
    return botRetryNos([...this.pendings.values()].flatMap((p) => p.requests));
  }

  // 依頼 → 続きの元（全部のボット。糸の根をたどる。R5）
  private parentMap(): Map<string, string> {
    const map = new Map<string, string>();
    for (const pending of this.pendings.values()) for (const r of pending.requests) if (r.parentRequestId) map.set(r.requestId, r.parentRequestId);
    return map;
  }

  // 組の席の並びを覚える（台帳にいるボットだけ・6体まで。新しい組から GROUP_PLANS_KEPT 個）
  //   グループは同じボットが2役を持つことがあるので、id は重ねても残す（みんなに聞くは席ごとに別のボット）
  private planGroup(group: number, planned: readonly unknown[], team?: BotRoleGroup, roles?: readonly unknown[]) {
    const ids: string[] = [];
    const names: string[] = [];
    planned.forEach((id, i) => {
      if (ids.length >= MAX_DOCK_BOTS || !isBotId(id) || !this.store.get(id)) return;
      ids.push(id);
      const role = roles?.[i];
      names.push(typeof role === 'string' ? [...role].slice(0, 40).join('') : '');
    });
    if (!ids.length) return;
    this.plans.delete(group);
    this.plans.set(group, { ids, roles: names, ...(team ? { team } : {}) });
    while (this.plans.size > GROUP_PLANS_KEPT) this.plans.delete(this.plans.keys().next().value as number);
  }

  // 設定「依頼の最初の40字を一覧に出す」がオフなら、残してある 40 字を pending.json から消す（S3.8。この窓が受け取っているときだけ書く）
  private dropHeads() {
    if (!this.loaded || this.status?.owner !== true || this.store.nest().headline === 'on') return;
    for (const [key, pending] of this.pendings) {
      if (!pending.requests.some((r) => r.head)) continue;
      for (const r of pending.requests) delete r.head;
      void this.commit(key, null);
    }
  }

  // いちばん新しい記録から max 件（足りなければ、1つ前のファイルからも）。書いている途中の記録はそのまま使う（ここでは覚え直さない）
  private async recentLog(key: string, max: number): Promise<{ entries: BotLogEntry[]; earlier: boolean }> {
    const files: number[] = [];
    for (const file of await listData(`bots/${key}`)) {
      const m = /\/log-(\d{4,6})\.json$/.exec(file.name);
      if (m) files.push(Number(m[1]));
    }
    files.sort((a, b) => b - a);
    const current = this.logs.get(key);
    let entries: BotLogEntry[] = [];
    let used = 0;
    for (const n of files) {
      if (entries.length >= max) break;
      used += 1;
      const list =
        current && current.n === n
          ? current.entries
          : await readData<{ version?: unknown; entries?: unknown }>(logFile(key, n)).then((saved) =>
              saved?.version === 1 && Array.isArray(saved.entries) ? (saved.entries as BotLogEntry[]) : [],
            );
      entries = [...list, ...entries];
    }
    return { entries: entries.slice(-max), earlier: entries.length > max || used < files.length };
  }

  // 台帳にボットが1体もいないときは、C++ の見回りを止める（変わったときだけ知らせる）
  private updateWatch() {
    if (!this.store.ready) return;
    const on = this.store.list().length > 0 || this.patchHandler !== null;
    if (on === this.watching) return;
    this.watching = on;
    send({ type: 'botInboxWatch', on });
    void this.refreshStatus(false); // botInboxWatch には返事が無いので、見回りが動いたか（watching）を聞き直す（R8 の中継の見張り）
  }

  private reload() {
    if (this.loading) return;
    this.pendings.clear();
    this.logs.clear();
    this.loaded = false;
    void this.load();
  }

  // 台帳のボットの pending.json を読む（台帳を読んでから。あとで足されたボットの分も）
  private load(): Promise<void> {
    if (!this.store.ready) return Promise.resolve();
    if (this.loading) return this.loading;
    const keys = [UNROUTED, ...this.store.list().map((b) => b.id)].filter((key) => !this.pendings.has(key));
    if (this.loaded && !keys.length) return Promise.resolve();
    this.loading = (async () => {
      const files = await Promise.all(keys.map((key) => readData<unknown>(pendingFile(key))));
      keys.forEach((key, i) => {
        if (!this.pendings.has(key)) this.pendings.set(key, parsePending(files[i]));
      });
      this.loaded = true;
      this.loading = null;
      this.dropHeads();
      this.emit();
      void this.drain();
    })();
    return this.loading;
  }

  private pendingOf(key: string): BotPendingFile {
    let pending = this.pendings.get(key);
    if (!pending) {
      pending = emptyPending();
      this.pendings.set(key, pending);
    }
    return pending;
  }

  private receive(envelope: BotReplyEnvelope) {
    if (typeof envelope.fileId !== 'string' || !FILE_ID_RE.test(envelope.fileId)) return; // C++ が付ける名前。合わなければ C++ も動かせない
    this.incoming.push(envelope);
    void this.drain();
  }

  // 届いた順に1通ずつ
  private async drain() {
    if (!this.loaded || this.draining) return;
    this.draining = true;
    try {
      for (let next = this.incoming.shift(); next; next = this.incoming.shift()) await this.handle(next);
    } finally {
      this.draining = false;
    }
  }

  // どのボットの返事か：覚えている依頼の requestId → 返事の bot（台帳にいれば）→ どちらでもなければ _unrouted
  private route(requestId: string | undefined, bot: string | undefined): string {
    if (requestId) {
      for (const [key, pending] of this.pendings) {
        if (key !== UNROUTED && pending.requests.some((r) => r.requestId === requestId)) return key;
      }
    }
    return bot && this.store.get(bot) ? bot : UNROUTED;
  }

  private async handle(envelope: BotReplyEnvelope) {
    const now = Date.now();
    const base: BotLogEntry = {
      at: now,
      kind: 'message',
      fileId: envelope.fileId,
      via: envelope.via,
      receivedAt: typeof envelope.receivedAt === 'string' ? envelope.receivedAt.slice(0, 64) : '',
      transportOk: envelope.transportOk === true,
      ...(typeof envelope.sourceName === 'string' && /^[A-Za-z0-9_.-]{1,160}$/.test(envelope.sourceName) ? { sourceName: envelope.sourceName } : {}),
    };
    // Grok の提案（type:"patch"）と取り込みファイル（format:"hcb-memo-interchange"）：ボットの記録には書かない。
    //   受け取ったか断ったかだけ C++ に返す（done\・rejected\ へ移る）。どちらかの振り分けは patchHandler の中（primary.ts）
    const raw = envelope.reply as { type?: unknown; format?: unknown } | null;
    if (this.patchHandler && typeof raw === 'object' && raw !== null && !Array.isArray(raw) && (raw.type === 'patch' || raw.format === 'hcb-memo-interchange')) {
      let reason: string | null;
      try {
        reason = await this.patchHandler(envelope.reply, envelope.fileId);
      } catch {
        reason = 'patchError';
      }
      send(reason ? { type: 'botReplyTaken', fileId: envelope.fileId, result: 'rejected', reason } : { type: 'botReplyTaken', fileId: envelope.fileId, result: 'done' });
      return;
    }
    const parsed = parseBotMessage(envelope.reply);
    if (!parsed.ok) {
      // 形が読めない：受け取らない。記録してから、C++ に rejected と理由を返す（rejected\<fileId>.reason.json）
      await this.commit(UNROUTED, { ...base, kind: 'rejected', reason: parsed.reason });
      send({ type: 'botReplyTaken', fileId: envelope.fileId, result: 'rejected', reason: parsed.reason });
      return;
    }
    const { message } = parsed;
    const key = this.route(message.requestId, message.bot);
    const decision = applyBotMessage(this.pendingOf(key), envelope.fileId, message, parsed.unknownVersion, now, lateMinutesOf(this.store.get(key)));
    // 受け取り箱の一覧用（S3.8）：数えた途中経過の title と step を、その依頼に覚える（確かめ・二重の見分けは applyBotMessage のまま）
    if (decision.action === 'record' && decision.match === 'ok' && decision.stateChanged && message.type === 'progress') {
      const request = this.pendingOf(key).requests.find((r) => r.requestId === decision.requestId);
      const title = message.title ? cutChars(cleanBotLine(message.title), BOT_LIMITS.titleChars).text : '';
      if (request && title) request.lastTitle = title;
      if (request && message.step) request.lastStep = { ...message.step };
      if (request && !request.acceptedAt) request.acceptedAt = now; // 追跡票の「相手が受け取った」（R8。最初の途中経過が受領の印）
    }
    // 試し便（R8）：check の合わない返事が届いたら、照合 ✗ の印だけ覚える（状態は変えない。灰色のまま）
    if (decision.action === 'record' && decision.match === 'checkMismatch' && decision.requestId) {
      const request = this.pendingOf(key).requests.find((r) => r.requestId === decision.requestId);
      if (request?.ping) request.pingMismatch = true;
    }
    let entry: BotLogEntry | null = null;
    if (decision.action === 'record' && !decision.overLimit) {
      entry = {
        ...base,
        match: decision.match,
        ...(decision.grey ? { grey: true } : {}),
        ...(decision.requestId ? { requestId: decision.requestId } : {}),
        ...(decision.folded ? { folded: true } : {}),
        ...(decision.late ? { late: true } : {}),
        ...(decision.faint ? { faint: true } : {}),
        ...(decision.afterDone ? { afterDone: true } : {}),
        ...(parsed.notes.length ? { notes: parsed.notes } : {}),
        message: withoutCheck(message), // check は pending.json にだけ置く（記録・画面には出さない）
      };
    }
    // 書けたときだけ done と答える（書けなければ .taking のまま残り、次に左の UI が読み込み直したとき、もう一度届く）
    const saved = await this.commit(key, entry);
    if (saved) send({ type: 'botReplyTaken', fileId: envelope.fileId, result: 'done' });
    if (decision.action !== 'record') return;
    this.emit(); // 状態が変わらない灰色の返事も、右の欄には出す
    if (!saved || decision.overLimit) return;
    const final = (message.type === 'reply' || message.type === 'error') && !decision.grey && !decision.folded;
    const arrival: BotArrival = { botId: key === UNROUTED ? null : key, type: message.type, grey: decision.grey, final, faint: decision.faint === true, ...(decision.requestId ? { requestId: decision.requestId } : {}) };
    for (const fn of this.arrivals) fn(arrival);
    if (final && message.type === 'reply' && key !== UNROUTED && this.replies.length) {
      const request = this.pendingOf(key).requests.find((r) => r.requestId === decision.requestId);
      const reply: BotReplyArrival = {
        botId: key,
        fileId: envelope.fileId,
        message: withoutCheck(message),
        ...(request?.role ? { role: request.role } : {}),
        ...(request?.group ? { group: request.group } : {}),
      };
      for (const fn of this.replies) fn(reply);
    }
  }

  // pending.json を書き、記録を1件足す（entry が null なら pending.json だけ）。書く順番は1列
  private commit(key: string, entry: BotLogEntry | null): Promise<boolean> {
    const run = this.queue.then(async () => {
      const pending = this.pendingOf(key);
      let ok = await writeData(pendingFile(key), pending);
      if (entry) ok = (await this.appendLog(key, entry)) && ok;
      return ok;
    });
    const settled = run.catch(() => false);
    this.queue = settled;
    return settled;
  }

  // 記録は log-0001.json から。100 件か 1 MB を超えるなら、次の番号のファイルへ
  private async appendLog(key: string, entry: BotLogEntry): Promise<boolean> {
    let log = this.logs.get(key);
    if (!log) {
      log = await this.openLog(key);
      this.logs.set(key, log);
    }
    let entries = [...log.entries, entry];
    if (log.entries.length && (entries.length > BOT_LIMITS.logEntries || byteLength(JSON.stringify({ version: 1, entries })) > BOT_LIMITS.logBytes)) {
      log = { n: log.n + 1, entries: [] };
      this.logs.set(key, log);
      entries = [entry];
      void this.pruneLogs(key, log.n);
    }
    const ok = await writeData(logFile(key, log.n), { version: 1, entries });
    if (ok) log.entries = entries;
    return ok;
  }

  // 古い記録のファイルを消す（新しいものから LOG_FILES_KEPT 個を残す。待っている依頼の状態は pending.json にあるので、消しても変わらない）
  private async pruneLogs(key: string, newest: number) {
    for (const file of await listData(`bots/${key}`)) {
      const m = /\/log-(\d{4,6})\.json$/.exec(file.name);
      if (m && Number(m[1]) <= newest - LOG_FILES_KEPT) deleteData(logFile(key, Number(m[1])));
    }
  }

  // いちばん新しい記録のファイル（無ければ log-0001.json）
  private async openLog(key: string): Promise<{ n: number; entries: BotLogEntry[] }> {
    let n = 0;
    for (const file of await listData(`bots/${key}`)) {
      const m = /\/log-(\d{4,6})\.json$/.exec(file.name);
      if (m) n = Math.max(n, Number(m[1]));
    }
    if (!n) return { n: 1, entries: [] };
    const saved = await readData<{ version?: unknown; entries?: unknown }>(logFile(key, n));
    const entries = saved?.version === 1 && Array.isArray(saved.entries) ? (saved.entries as BotLogEntry[]) : [];
    return { n, entries };
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}
