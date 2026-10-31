// 右下の Grok Bot：右サイドバーの相棒の並びの下に、Grok Bot を6体まで置く（docs/bot-cells/plan-addendum-sidebar-bots.md）
//   第3段 S3.2 から、見た目は「Grok-Bot の巣」（六角形の輪。bot-nest.ts が描く。docs/bot-cells/plan-s3-nest.md）。
//   ここは台帳の写し・メニュー・頼む文の欄・左への命令を持ち、巣から押されたことを受けて動く
//   ・台帳は盤面のボットのセルと同じ（ui-data\bots\index.json の bots と dock）。持ち主は左サイドバーなので、
//     ここは左から届く写し（RelayPayload の bots）を見て、変えたいときは左に頼む（dockBot・undockBot・moveDockBot など）
//   ・席を押すと、そのボットを選ぶ（右のボットの欄で、そのボットのやり取りを出す）。ダブルクリックで Grok Bot アプリのそのボットのチャットを開く
//   ・相棒（ブラウザの中の頭）とは見た目で分ける：ボット専用の顔（石板の色・役の形）と「↗ Grok Bot」の札。
//     相棒の顔・切り替え・入力欄には手を触れない（相棒の並びの下に、別の区画として足すだけ）
//   ・置く（空いた席の ＋）・並び替え（右クリック →「前の席へ」「次の席へ」、Alt+← →）・外す（台帳には残る）。7体目は置けない（空いた席が無い）
//   ・grokbot:// の URL は C++ が組み立てる。ここが持つのはエージェントの id だけ（openBotApp に渡す）
//   ・「コピーしてアプリを開く…」（第2段）：頼む文を送る部品（bot-send.ts の BotSender。右では AskLeftSender）に渡す。
//     左が命令 botDraft を受けて、ClipboardSender で依頼（request.v1。text の頭に台帳の役）を作って覚え、コピーしてアプリを開く（S3.4）。
//   ・巣の「この子に頼む」「みんなに聞く」は、巣の上に依頼の小窓（S3.5。bot-request-form.ts）を開く。宛て先は巣の席と台帳のボットから選べる。
//     添付は右で見ているタブ（host.page）の URL と題名。小窓は BotSender（AskLeftSender → 命令 botDraftV2）で送る。
//     宛て先「みんな」（S3.6。bot-ask-all.ts）：巣の設定の送り方で、A 1体ずつ順に案内（既定）か、B 代表にまとめて1つ。
//     代表が台帳から消えていれば A に戻して小窓で知らせる（そのため、写しの代表の id は台帳にいなくても askLead に残す）
//     定型（依頼の小窓 v2・R4a）：左の写しの presets を小窓に渡す。巣から開く小窓の入口は「巣」（はじめの組は「調べもの」）。
//     押した・取り込んだ定型は命令 botPresetUsed で左に知らせる（使った回数を書くのは左）
//     前と同じで（R6）：左の写しの lastRequest（前回送った依頼の選び方）を小窓に渡す。選び方は小窓が botDraftV2 の choice で左へ送る
//     続きとして（R5）：左の写しの受け取り箱の一覧から、確かめが通った返事 5 件を小窓の選び口に渡す（recentReplies）。
//     要点の行は小窓が命令 botAnswerLines で頼み、relay の botAnswerLines を answerLines で受ける（AnswerLinesAsker）。
//     回答カードの「続けて聞く」（followUp）は、その返事を選んだ状態・入口「続けて聞く」（定型の組を決める）で開く
//   ・合体 Grok（S3.7。bot-nest-merge.ts）：巣の設定の「合体 Grok の演出」がオンなら、小窓が「みんなに聞く」を送る前に、巣の上に
//     「許可しますか？」の窓を重ねる。許可すると巣を合体の見た目にして（見た目だけ）、送った席の依頼が全部終わるか「元に戻す」で戻す。
//     どちらを選んでも、小窓は同じ依頼をそのまま送る（送り方・送る順は変えない）
//   ・送ったあと（依頼の小窓 v2・R8）：席に知らせの期限を過ぎた数（overdue。赤の点線）を渡す。返事が届いて光る席を押したら、
//     受け取り箱のその返事へ（host.openReply）。未送信の「送り方を選び直す…」は openUnsent（下書きで小窓を開き直し、送れたら下書きを外す）
//   ・受け取り箱 v2（依頼の小窓 v2・R9）：回答カードの「もう一度 ▾」の 3 つ（別の子へ渡す・言い換えてもう一回・頼み方を直す）は askAgain で小窓を開く
//   ・巣の ⚙ の設定の欄（S3.3。bot-nest-settings.ts）：並び・役・みんなに聞く（R4b から定型も）。保存すると、写しをすぐ直してから（巣の顔・役の名前がすぐ変わる）
//     左に頼む（dockBot・undockBot・moveDockBot・setBotRole・setNest・setBotTeams。左が直してから台帳に書き、写しを送り直す）
//   ・定型の棚（依頼の小窓 v2・R4b・D10）：⚙ の「定型」タブに写しの presets（蔵も）を渡す。押したらすぐ写しを直してから命令 setPresets、
//     送った依頼から拾うのは命令 presetFromRequest。拾う候補は受け取り箱の一覧の写しの頭（headline がオンのときだけある）と
//     下書き（drafts.json）から、ownWords で自分の文だけにして渡す（presetPickSources）。小窓の「その他 ▾」の「棚を整える…」は、
//     小窓を閉じて（書きかけは「やめる」と同じに残す）⚙ の定型タブを開く（openShelf）。
//     棚から 3 回使った定型が出たら（presetSwapAsk）、一度だけ「⚙ の定型で入れ替えられます」と知らせる（聞くのは ⚙ の定型タブ）
import {
  BAD_BOT_LINK,
  BOT_LINK_HINT,
  BOT_LINK_LABEL,
  type BotBrief,
  type BotBriefState,
  type BotInboxStatus,
  type BotNest,
  type BotRecentReply,
  type BotRequestList,
  botAppErrorText,
  botFullState,
  botRequestStateLabel,
  inboxStatusText,
  isWaitingState,
  cleanBotName,
  DEFAULT_BOT_NAME,
  DEFAULT_NEST,
  MAX_BOT_NAME,
  MAX_DOCK_BOTS,
  normalizeNest,
  openBotApp,
  parseAgentInput,
  recentReplies,
} from '../bots';
import { BOT_ROLE_GROUPS, type BotRole, type BotRoleGroup } from '../bot-roles';
import { type BotPresets, normalizePresets, presetSwapAsk } from '../bot-presets';
import { type BotLastRequest, normalizeLastRequest } from '../bot-last-request';
import { planTeamAsk } from '../bot-ask-all';
import { type BotTeams, normalizeTeams } from '../bot-teams';
import { AnswerLinesAsker, AskLeftSender, type BotSender } from '../bot-send';
import { cardsStageOn, readCardsOpen } from '../cards-stages';
import { groupSent, looksLikeSecret, SECRET_NOTICE } from '../grok-cards-tags';
import { type BotDraft, loadDrafts, removeDraft } from '../drafts';
import { cleanMaterialRefs } from '../draft-materials';
import type { RelayCommand } from '../types';
import { BotNest as BotNestView, type BotNestSeat } from './bot-nest';
import { type BotNestHookHost, type BotNestPlan, type BotNestSnapshot, BotNestSettings, type PresetPickSource } from './bot-nest-settings';
import { ASK_ALL, type BotRequestContext, BotRequestForm, type BotRequestFormOpen, botRequestTargets } from './bot-request-form';
import { BotMergeConfirm, type MergeAskInfo, MergeWatch } from './bot-nest-merge';
import type { AskAllNest } from '../bot-ask-all';
import type { CellMenu, MenuEntry } from './cell-menu';

export interface BotDockHost {
  askLeft(action: RelayCommand): void; // 台帳を変えてもらう（左サイドバーが持ち主）
  menu: CellMenu; // 右クリックのメニュー・名前やリンクを入れる欄
  toast(text: string, ms?: number): void;
  selected?(id: string): void; // ボットを押して選んだ（右のボットの欄で、そのボットのやり取りを出す）
  sender?: BotSender; // 依頼を送る部品（S3.4）。無ければ AskLeftSender（左に botDraft・botDraftV2 で頼む）
  page?(): BotRequestContext | null; // 依頼の小窓に添えられるページ（右で見ているタブの URL と題名。S3.5）
  openInbox?(): void; // 巣の下の1行を押した（S3.8。受け取り箱の一覧へ）
  openDrafts?(): void; // 殻の段 1〜2。受け取り箱の「下書き」へ（畳まない）
  openReply?(botId: string): boolean; // 返事が届いて光っている席を押した（R8。受け取り箱のその返事へ飛び、「読んだ」にする）
  // webhook「そのまま送る」の宛先と鍵（R11。巣の ⚙「送り方」。右が C++ に直接頼む。返すのは「ある／ない」だけ）。無ければ送り方のタブは見るだけ
  hook?: BotNestHookHost;
}

// 左から届く写し
export interface BotDockState {
  bots: BotBrief[];
  dock: string[];
  nest?: BotNest; // 第3段：巣の設定（みんなに聞くの送り方・代表・合体 Grok の演出。無ければ既定）
  teams?: BotTeams; // グループの割り当て（groups.json。左が読み終えるまでは無い）
  presets?: BotPresets; // 依頼の小窓の定型の組・手元・棚（presets.json。R4a。左が読み終えるまでは無い）
  lastRequest?: BotLastRequest; // 前回送った依頼の選び方（last-request.json。R6「前と同じで」。まだ送っていなければ無い）
  appMissing: boolean;
  confirmed: boolean;
  ready: boolean;
  states?: BotBriefState[]; // 第2段：ボットごとの状態と札の数（顔に出す）
  inbox?: BotInboxStatus | null; // 受け取り口の様子（巣の下の1行。S3.8）
  requests?: BotRequestList; // 受け取り箱の一覧の写し（巣の下の1行の「待っている依頼」。S3.8。小窓の「続きとして」の選び口も。R5）
  hook?: boolean; // webhook「そのまま送る」の宛先と鍵があるか（R11。「ある／ない」だけ）
}

// 席の並びを current から target にする命令（外す → 足す〔後ろに〕→ 前から順に場所を合わせる。左の BotStore と同じ動き）
//   外すのを先にするので、6体いても「置けない」にならない
export function dockCommands(current: readonly string[], target: readonly string[]): RelayCommand[] {
  const commands: RelayCommand[] = [];
  const order = [...current];
  for (const id of current) {
    if (target.includes(id)) continue;
    commands.push({ command: 'undockBot', botId: id });
    order.splice(order.indexOf(id), 1);
  }
  for (const id of target) {
    if (order.includes(id)) continue;
    commands.push({ command: 'dockBot', botId: id });
    order.push(id);
  }
  target.forEach((id, to) => {
    const from = order.indexOf(id);
    if (from === to || from < 0) return;
    order.splice(from, 1);
    order.splice(to, 0, id);
    commands.push({ command: 'moveDockBot', botId: id, to });
  });
  return commands;
}

type At = { x: number; y: number };

export class BotDock {
  // 見た目は巣（六角形の輪）。押されたことは、ここの選ぶ・開く・メニュー・置く・頼むにつなぐ
  private readonly nest = new BotNestView({
    select: (id) => this.select(id),
    open: (id) => this.press(id),
    menu: (id, at, keyboard) => {
      this.openMenu(id, at);
      if (keyboard) this.host.menu.focusFirst();
    },
    move: (id, to) => this.move(id, to),
    add: (at) => this.openAddMenu(at),
    askOne: (id, at) => this.askOne(id, at),
    askAll: (at) => this.askAll(at),
    askTeam: (at) => this.askTeamMenu(at),
    settings: () => this.toggleSettings(),
    unmerge: () => this.endMerge(),
    inbox: () => this.host.openInbox?.(),
    cards: () => this.toggleCards(),
  });
  readonly element = this.nest.element;
  // 巣の ⚙ の設定の欄（巣の上に重ねる。閉じるのは「閉じる」か Esc だけ）
  private readonly settings = new BotNestSettings({
    save: (plan) => this.applyPlan(plan),
    closed: () => {
      this.nest.settingsOpen(false);
      this.nest.focusGear();
    },
    savePresets: (next) => this.savePresets(next), // 定型の棚（R4b。押したらすぐ）
    pickPreset: (pick) => this.host.askLeft({ command: 'presetFromRequest', ...pick }), // 送った依頼から拾う（R4b）
    pickSources: () => this.presetPickSources(),
    // 送り方（R11）：右の本体（secondary.ts）が C++ に直接頼む
    hook: {
      state: () => this.host.hook?.state() ?? Promise.resolve(null),
      save: (url, key) => this.host.hook?.save(url, key) ?? Promise.resolve(null),
      remove: () => this.host.hook?.remove() ?? Promise.resolve(null),
    },
  });
  private readonly swapTold = new Set<string>(); // 入れ替えの声かけを知らせた定型（R4b。窓が開いている間だけ。一度だけ）
  // 依頼の小窓（S3.5。巣の上に重ねる。閉じるのは「やめる」・Esc・送ったとき）
  private readonly form: BotRequestForm;
  private formDraft = ''; // 小窓の書きかけの依頼文（やめたときだけ残す。窓が開いている間だけ。保存しない）
  private formReturn = 'ask-one'; // 小窓を閉じたら戻るボタン
  private state: BotDockState | null = null; // 左から写しが届くまでは null（巣ごと出さない）
  private appOk = false; // 撮影の確認で「外のアプリを開く」を済ませた（写しが届くまでのあいだ）
  private askLead: string | undefined; // 写しの代表の id（台帳から消えていても残す。みんなに聞くで「消えている」と知らせるため。S3.6）
  private selected: string | null = null; // 選んでいるボット（右のボットの欄の相手にする。今は窓が開いている間だけ）
  private readonly opening = new Set<string>(); // アプリを開く返事を待っているボット
  private readonly drafts = new Map<string, string>(); // 頼む文（ボットごと。窓が開いている間だけ。保存しない）
  private readonly sender: BotSender; // 依頼を送る部品（S3.4。bot-send.ts）
  private readonly mergeConfirm = new BotMergeConfirm(); // 合体 Grok の許可の確認（S3.7。巣の上に重ねる）
  private merge: MergeWatch | null = null; // 合体の見た目のあいだだけ（組の依頼が全部終わったかを見る）
  private formMerging = false; // 今の小窓の「みんなに聞く」は、許可して合体の見た目で送っている（送った席を数える）
  private cueDraftId: string | null = null; // 合図の「詳しく」で先に置いた下書き。コピーできたときだけ外す
  private cardsOpen = false; // 段 1〜2 の殻の開閉（段 3 からは下の面の札が決める。2 回目は受け取り箱を畳まない）
  private cardId: string | null = null; // 段 5。開いている小窓が、どの札から来たか（閉じたら消す）
  private readonly lines: AnswerLinesAsker; // 「続きとして」の要点の行を左に頼む（R5）
  private readonly asker: AskLeftSender; // 左に頼む送る部品（webhook の結果は hookResult で受ける。R11）

  constructor(private readonly host: BotDockHost) {
    // 札（Grok Cards の段 5）から開いた小窓の依頼には cardId を付ける
    const askLeft = (action: RelayCommand) => {
      if (this.cardId && (action.command === 'botDraft' || action.command === 'botDraftV2')) {
        this.host.askLeft({ ...action, cardId: this.cardId });
        return;
      }
      this.host.askLeft(action);
    };
    this.asker = new AskLeftSender(askLeft);
    this.sender = host.sender ?? this.asker;
    this.lines = new AnswerLinesAsker((action) => host.askLeft(action));
    this.form = new BotRequestForm({
      sender: this.sender,
      confirmed: () => {
        if (this.state) this.state.confirmed = true; // 左の写しが届くまでの間も、聞き直さない
        this.host.askLeft({ command: 'botAppSeen', confirmed: true });
      },
      beforeAskAll: (info) => this.confirmMerge(info),
      saveRole: (botId, role) => this.host.askLeft({ command: 'setBotRole', botId, role }), // 役の文の「この役として保存」（依頼の小窓 v2・R3）
      presetUsed: (id, set) => this.host.askLeft({ command: 'botPresetUsed', id, ...(set ? { set } : {}) }), // 定型を押した・取り込んだ（R4a。回数を書くのは左。set はそのときの組。R4b）
      openShelf: () => this.openShelf(), // その他 ▾ の「棚を整える…」（R4b）
      answerLines: (botId, requestId) => this.lines.ask(botId, requestId), // 続きとして選んだ返事の要点の行（R5）
      hookFallback: (botId, requestId) => this.host.askLeft({ command: 'botHookFallback', botId, requestId }), // 届かなかった依頼をコピーに（R11）
      sent: (req, target) => {
        if (this.cueDraftId) {
          void removeDraft(this.cueDraftId); // 番号つきの依頼になったので、先の下書きは外す
          this.cueDraftId = null;
        }
        // 合体のあいだに送った席を数える（アプリのチャットだけは記録しないので数えない）
        if (this.formMerging && this.merge && !req.chatOnly) this.merge.add(target.id, this.waitingOf(target.id));
        if (this.docked().some((b) => b.id === target.id) && this.selected !== target.id) {
          this.selected = target.id;
          this.nest.select(target.id);
        }
      },
      secret: (text) => (this.cardId && looksLikeSecret(text) ? SECRET_NOTICE : ''),
      askAllRun: (group) => {
        if (!this.cardId || !cardsStageOn('5')) return;
        this.host.askLeft({ command: 'markGrokCardSent', id: this.cardId, sent: groupSent(group) });
      },
      closed: (text, sent) => {
        this.cardId = null;
        if (!sent) this.cueDraftId = null; // コピーしていない下書きは、列に残す
        if (this.formMerging) {
          this.formMerging = false;
          this.merge?.stop();
          this.checkMerge();
        }
        this.formDraft = sent ? '' : text;
        this.nest.formOpen(false);
        this.nest.focusKey(this.formReturn);
      },
    });
    this.element.hidden = true;
    this.element.append(this.settings.element, this.form.element, this.mergeConfirm.element);
  }

  // 左から写しが届いた
  setState(state: BotDockState) {
    const bots = Array.isArray(state.bots) ? state.bots : [];
    const presets = state.presets ? normalizePresets(state.presets) : null; // 定型の写し（R4a。形を確かめ直す）
    const lastRequest = state.lastRequest ? normalizeLastRequest(state.lastRequest) : null; // 前回送った依頼の選び方（R6）
    this.tellSwap(this.state?.presets, presets);
    this.askLead = normalizeNest(state.nest, () => true)?.lead;
    this.state = {
      bots,
      dock: Array.isArray(state.dock) ? state.dock.slice(0, MAX_DOCK_BOTS) : [],
      nest: normalizeNest(state.nest, (id) => bots.some((b) => b.id === id)) ?? { ...DEFAULT_NEST },
      ...(state.teams ? { teams: normalizeTeams(state.teams, (id) => bots.some((b) => b.id === id)) } : {}),
      ...(presets ? { presets } : {}),
      ...(lastRequest ? { lastRequest } : {}),
      appMissing: state.appMissing === true,
      confirmed: state.confirmed === true,
      ready: state.ready === true,
      states: Array.isArray(state.states) ? state.states : [],
      inbox: state.inbox ?? null,
      ...(state.requests && Array.isArray(state.requests.items) ? { requests: state.requests } : {}),
      hook: state.hook === true,
    };
    this.form.setHook(state.hook === true); // webhook「そのまま送る」を押せるか（R11。「ある／ない」だけ）
    this.render();
  }

  // 右下に置いているボット（台帳にいるものだけ、並びの順）
  private docked(): BotBrief[] {
    const s = this.state;
    if (!s) return [];
    return s.dock.map((id) => s.bots.find((b) => b.id === id)).filter((b): b is BotBrief => !!b);
  }

  private find(id: string): BotBrief | undefined {
    return this.state?.bots.find((b) => b.id === id);
  }

  private render() {
    const s = this.state;
    this.element.hidden = !s;
    if (!s) return;
    const docked = this.docked();
    if (this.selected && !docked.some((b) => b.id === this.selected)) this.selected = null;
    const seats: BotNestSeat[] = docked.map((bot) => {
      const brief = s.states?.find((b) => b.id === bot.id);
      return { bot, state: botFullState(bot, s.appMissing, brief), unread: brief?.unread ?? 0, waiting: brief?.waiting ?? 0, overdue: brief?.overdue ?? 0 };
    });
    this.nest.render({ seats, selected: this.selected, ready: s.ready, cardsOpen: this.cardsOpen });
    // 下の1行（S3.8）：待っている依頼の数と、いちばん新しい待っている依頼・受け取り口の様子
    const first = s.requests?.items.find((r) => isWaitingState(r.state));
    this.nest.footer(
      s.ready && this.host.openInbox
        ? { waiting: s.requests?.waiting ?? 0, ...(first ? { first: { no: first.no, label: botRequestStateLabel(first.state) } } : {}), inbox: inboxStatusText(s.inbox) }
        : null,
    );
    if (this.settings.isOpen) this.settings.update(this.snapshot());
    if (this.form.isOpen) {
      this.form.setLastRequest(s.lastRequest); // 送った直後の写しで、1 行の色の比べる元を新しくする（R6）
      this.form.setReplies(recentReplies(s.requests)); // 「続きとして」の選び口（R5。選んでいる返事は残る）
      this.form.updateTargets(botRequestTargets(s.bots, docked.map((b) => b.id)), this.askAllNest(), s.presets);
    }
    this.checkMerge();
  }

  // ---------- 合体 Grok（S3.7） ----------

  // ボットの待っている依頼の数（左の写しの札の数）
  private waitingOf(id: string): number {
    return this.state?.states?.find((b) => b.id === id)?.waiting ?? 0;
  }

  // 小窓が「みんなに聞く」を送る前：演出がオンなら許可を聞く（聞いているあいだ、小窓は押せない）。許可したら合体の見た目にする
  private async confirmMerge(info: MergeAskInfo) {
    this.formMerging = false;
    if ((this.state?.nest?.merge ?? 'effect') === 'off') return;
    this.form.element.inert = true;
    let allowed = false;
    try {
      allowed = await this.mergeConfirm.ask(info);
    } finally {
      this.form.element.inert = false;
    }
    if (!allowed) return;
    this.merge ??= new MergeWatch(); // 合体のあいだにもう一度許可したら、同じ見た目のまま数える席を足す
    this.merge.begin();
    this.formMerging = true;
    this.nest.merged(true);
  }

  // 写しが届いた・小窓を閉じた：送った席の依頼が全部終わっていたら戻す
  //   設定の欄で演出をオフにしたら、すぐ戻す
  private checkMerge() {
    if (!this.merge) return;
    if (this.state?.nest?.merge === 'off' || this.merge.update((id) => this.waitingOf(id))) this.endMerge();
  }

  // 元に戻す（組の依頼が全部終わった・「元に戻す」を押した）。依頼はそのまま
  private endMerge() {
    this.merge = null;
    this.formMerging = false;
    this.nest.merged(false);
  }

  // 設定の欄に渡す写し（定型の棚は R4b）
  private snapshot(): BotNestSnapshot {
    const s = this.state;
    const pickKey = (s?.requests?.items ?? []).filter((r) => r.head && !r.ping).map((r) => r.requestId).join(' '); // 拾う候補を集め直す手がかり
    return { bots: s?.bots ?? [], dock: this.docked().map((b) => b.id), nest: s?.nest ?? { ...DEFAULT_NEST }, teams: s?.teams ?? null, ready: s?.ready === true, presets: s?.presets ?? null, pickKey };
  }

  // 巣の ⚙：設定の欄を開く（開いていれば閉じる。書きかけなら確かめる）。依頼の小窓が開いていれば開かない
  private toggleSettings() {
    const s = this.state;
    if (!s || !s.ready || this.form.isOpen) return;
    if (this.settings.isOpen) {
      this.settings.requestClose();
      return;
    }
    this.nest.settingsOpen(true);
    this.settings.open(this.snapshot(), this.selected);
  }

  // ---------- 定型の棚（R4b・D10） ----------

  // 小窓の「その他 ▾」の「棚を整える…」：小窓を閉じて（書きかけは「やめる」と同じに残る）、⚙ の定型タブを開く
  private openShelf() {
    const s = this.state;
    if (!s || !s.ready) return;
    if (this.form.isOpen) this.form.close(false);
    if (this.form.isOpen) return; // 閉じられなかった（案内の途中など）
    this.nest.settingsOpen(true);
    if (this.settings.isOpen) this.settings.update(this.snapshot());
    else this.settings.open(this.snapshot(), this.selected, 'presets');
  }

  // 定型の棚を変えた：写しをすぐ直してから（続けて押しても前の変更の上に重ねる）、左に命令 setPresets。
  //   左は文・寿命・置き場・並びだけを取り、数字は左の持ち分のまま混ぜて写しを送り直す（受けなければ今の棚に戻る）
  private savePresets(next: BotPresets) {
    const s = this.state;
    const clean = normalizePresets(next);
    if (!s || !s.ready || !clean) return;
    s.presets = clean;
    this.host.askLeft({ command: 'setPresets', sets: clean.sets, presets: clean.presets, ...(clean.review ? { review: clean.review } : {}) });
    this.render();
  }

  // 送った依頼から拾う候補：受け取り箱の一覧の写しの頭（巣の設定 headline がオンのときだけある）と、下書き（drafts.json）。
  //   どちらも ownWords で、定型の行・朱書き・添えた情報の枠を外した自分の文だけ。続きの頭（#0010 の続き：）も外す。試し便は入れない
  private async presetPickSources(): Promise<PresetPickSource[]> {
    const s = this.state;
    const texts = s?.presets?.presets.map((p) => p.text) ?? [];
    const out: PresetPickSource[] = [];
    for (const r of s?.requests?.items ?? []) {
      if (r.ping || !r.head) continue;
      const text = ownWords(dropFollowHead(r.head), texts);
      if (text) out.push({ kind: 'request', id: r.requestId, label: r.no, at: r.createdAt, text });
    }
    let drafts: BotDraft[] = [];
    try {
      drafts = await loadDrafts();
    } catch {
      drafts = []; // 読めなければ、受け取り箱の分だけ
    }
    for (const d of drafts) {
      const lines = d.text.split('\n').map((line) => line.trim()).filter((line) => line && !FOLLOW_HEAD_RE.test(line));
      const text = ownWords(lines.join(' '), texts);
      const page = d.req.page;
      if (text) out.push({ kind: 'draft', id: d.id, label: '下書き', at: d.createdAt, text, ...(page ? { page: { title: page.title, url: page.url, ...(page.selection ? { selection: page.selection } : {}) } } : {}) });
    }
    return out.sort((a, b) => b.at - a.at);
  }

  // 棚から 3 回使った定型が新しく出たら、一度だけ知らせる（聞くのは ⚙ の定型タブ。窓を開いて最初の写しでは知らせない）
  private tellSwap(before: BotPresets | undefined, after: BotPresets | null) {
    const ask = after ? presetSwapAsk(after) : null;
    if (!ask || !before || this.swapTold.has(ask.preset.id) || this.settings.isOpen) return; // ⚙ が開いていれば、そこで聞いている
    const was = before.presets.find((p) => p.id === ask.preset.id);
    if (was && presetSwapAsk(before)?.preset.id === was.id) return; // 前の写しでも出ていた
    this.swapTold.add(ask.preset.id);
    const name = ask.preset.text.length > 20 ? `${[...ask.preset.text].slice(0, 20).join('')}…` : ask.preset.text;
    this.host.toast(`棚の『${name}』を 3 回使いました。巣の ⚙ の「定型」で、手元と入れ替えられます`, 6000);
  }

  // 設定の欄の「保存」：写しをすぐ直してから（巣の顔・役の名前がすぐ変わる）、左に頼む。左が直してから台帳に書き、写しを送り直す
  //   左が受け付けなかったもの（直せない役・台帳から消えたボットなど）は、送り直される写しで元に戻る
  private applyPlan(plan: BotNestPlan) {
    const s = this.state;
    if (!s || !s.ready) return;
    const known = (id: string) => s.bots.some((b) => b.id === id);
    if (plan.dock) {
      const target = plan.dock.filter((id, i, all) => known(id) && all.indexOf(id) === i).slice(0, MAX_DOCK_BOTS);
      for (const command of dockCommands(this.docked().map((b) => b.id), target)) this.host.askLeft(command);
      s.dock = target;
    }
    for (const { botId, role } of plan.roles) {
      if (!known(botId)) continue;
      s.bots = s.bots.map((b) => {
        if (b.id !== botId) return b;
        const next: BotBrief = { ...b };
        if (role) next.role = role;
        else delete next.role;
        return next;
      });
      this.host.askLeft({ command: 'setBotRole', botId, role });
    }
    if (plan.nest) {
      s.nest = plan.nest;
      this.host.askLeft({ command: 'setNest', nest: plan.nest });
    }
    if (plan.teams) {
      s.teams = plan.teams;
      this.host.askLeft({ command: 'setBotTeams', teams: plan.teams });
    }
    this.render();
  }

  // 席を押した：そのボットを選ぶ（輪の下に説明と「この子に頼む」。右のボットの欄で、そのボットのやり取りを出す）。アプリは開かない
  //   返事が届いて光っている席（R8）：受け取り箱のその返事へ飛び、「読んだ」にする（光が消える）
  private select(id: string) {
    if (!this.find(id)) return;
    if (this.selected !== id) {
      this.selected = id;
      this.nest.select(id); // 席は描き直さない（ダブルクリックの2回目が同じボタンに届くように）
    }
    this.host.selected?.(id);
    if ((this.state?.states?.find((b) => b.id === id)?.unread ?? 0) > 0) this.host.openReply?.(id);
  }

  // ダブルクリック・メニューの「Grok Bot アプリで開く」：そのボットを選び、Grok Bot アプリのそのボットのチャットを開く
  //   はじめての1回だけ確かめる（盤面のボットのセルと同じ設定）
  private press(id: string) {
    const s = this.state;
    const bot = this.find(id);
    if (!s || !bot) return;
    this.select(id);
    if (!bot.agentId) {
      this.host.toast(`「${bot.name}」にはリンクがまだありません。右クリック →「リンクを貼る…」で、Grok Bot アプリの「リンクをコピー」から貼ってください`, 6000);
      return;
    }
    if (s.confirmed) {
      void this.launch(bot);
      return;
    }
    const at = this.near(id);
    this.host.menu.open(at.x, at.y, [
      { section: '外のアプリ（Grok Bot）を開きます' },
      { label: `「${bot.name}」のチャットを、Grok Bot アプリで開きます。次からは聞きません`, disabled: true },
      {
        label: '開く',
        run: () => {
          s.confirmed = true; // 左の写しが届くまでの間も、聞き直さない
          this.host.askLeft({ command: 'botAppSeen', confirmed: true });
          void this.launch(bot);
        },
      },
      { label: 'やめる', run: () => undefined },
    ]);
    this.host.menu.focusFirst();
  }

  // 殻を押した。段 3 は下の Grok Cards。それより前は、受け取り箱の下書きへ一度だけ移す（2 回目は畳まない）
  private toggleCards() {
    if (!cardsStageOn('1')) return;
    if (cardsStageOn('3')) {
      this.host.askLeft({ command: readCardsOpen() ? 'closeGrokCards' : 'openGrokCards' });
      return;
    }
    this.cardsOpen = !this.cardsOpen;
    if (this.cardsOpen) this.host.openDrafts?.();
    this.render();
  }

  // 段 5。札の「コピーして開く」。小窓に文を入れるだけ（押すまで送らない。drafts.json には足さない）
  openCard(input: { cardId: string; address: string; text: string; secret: boolean }) {
    if (!cardsStageOn('5')) return;
    const s = this.state;
    if (!s || !s.ready || this.settings.isOpen) return;
    if (this.form.isOpen) {
      this.host.toast('開いている欄を閉じてから、もう一度どうぞ');
      return;
    }
    this.cardId = input.cardId;
    this.formReturn = 'foot';
    this.nest.formOpen(true);
    this.form.open({
      targets: botRequestTargets(s.bots, this.docked().map((b) => b.id)),
      to: input.address === 'all' ? ASK_ALL : input.address,
      context: {},
      text: input.text,
      confirmApp: !s.confirmed,
      nest: this.askAllNest(),
      heading: 'コピーして開く',
      note: input.secret ? SECRET_NOTICE : undefined,
      skipCloseDraft: true,
      ...this.openExtras(), // 定型の入口は「巣」・前回の選び方・続きとしての選び口（依頼の小窓 v2）
    });
  }

  // 段 5・6。札の「アプリを開く」（コピーはしない）
  openApp(botId: string) {
    const bot = this.find(botId);
    if (bot) void this.launch(bot);
  }

  // 段 3 の「＋下書き」（段 4 が無いとき）。今の依頼の小窓を、その宛て先で開く
  openAddressed(address: string) {
    if (address === 'all') this.askAll({ x: 0, y: 0 });
    else this.askOne(address, { x: 0, y: 0 });
  }

  // 「この子に頼む」：依頼の小窓を、宛て先をこの子にして開く（S3.5）
  private askOne(id: string, _at: At) {
    const bot = this.find(id);
    if (!bot) return;
    if (!bot.agentId) {
      this.host.toast(`「${bot.name}」にはリンクがまだありません。右クリック →「リンクを貼る…」で、Grok Bot アプリの「リンクをコピー」から貼ってください`, 6000);
      return;
    }
    this.openForm(bot.id, 'ask-one');
  }

  // 「⬡ みんなに聞く（n体）」：依頼の小窓を宛て先「みんな」で開く（S3.6。送り方は巣の設定：A 1体ずつの案内／B 代表にまとめて）
  //   席にリンクのあるボットが1体もいなければ開かない（B の代表にリンクがあっても、A に戻ったときに聞けないので、まず知らせる）
  private askAll(_at: At) {
    const docked = this.docked();
    if (!docked.length) {
      this.host.toast('巣にボットがいません。空いた席の ＋ から置いてください');
      return;
    }
    if (!docked.some((b) => b.agentId) && this.state?.nest?.askAll !== 'lead') {
      this.host.toast('巣のボットにリンクがまだありません。右クリック →「リンクを貼る…」で貼ってから、もう一度どうぞ', 6000);
      return;
    }
    this.openForm(ASK_ALL, 'all');
  }

  // 「グループに頼む ▾」：5つのグループから選ぶ（G2）。空のグループは選べない
  private askTeamMenu(at: At) {
    const s = this.state;
    if (!s?.ready) return;
    const bots = s.bots;
    this.host.menu.open(
      at.x,
      at.y,
      BOT_ROLE_GROUPS.map((g) => {
        const ask = planTeamAsk(g.group, s.teams, bots);
        const who = ask.seats.map((t) => `${t.role?.name ?? ''}・${t.name}`).join('、');
        return {
          label: g.label,
          hint: who || (ask.skipped.length ? 'リンクがありません' : 'まだだれもいません'),
          disabled: ask.seats.length === 0,
          run: () => this.openTeam(ask),
        };
      }),
    );
  }

  // 選んだグループの依頼の小窓（宛て先は、そのグループの役のボットに固定）
  private openTeam(ask: ReturnType<typeof planTeamAsk>): boolean {
    const s = this.state;
    if (!s?.ready || this.settings.isOpen || !ask.seats.length) return false;
    this.formReturn = 'team';
    this.nest.formOpen(true);
    this.form.open({
      targets: botRequestTargets(s.bots, this.docked().map((b) => b.id)),
      teamAsk: ask,
      context: this.host.page?.() ?? undefined,
      text: this.formDraft,
      confirmApp: !s.confirmed,
      nest: this.askAllNest(),
      ...this.openExtras(),
      heading: `グループ：${ask.label}`,
    });
    return true;
  }

  // 小窓に渡す定型の写しと入口（R4a。巣から開く小窓は入口「巣」、回答カードの「続けて聞く」は入口「続けて聞く」〔R5〕）と、
  //   前回送った依頼の選び方（R6）と、「続きとして」の選び口（R5。確かめが通った返事 5 件）
  private openExtras(entry: 'nest' | 'follow' = 'nest'): { entry: 'nest' | 'follow'; presets?: BotPresets; lastRequest?: BotLastRequest; replies: BotRecentReply[] } {
    const s = this.state;
    return { entry, ...(s?.presets ? { presets: s.presets } : {}), ...(s?.lastRequest ? { lastRequest: s.lastRequest } : {}), replies: recentReplies(s?.requests) };
  }

  // 左からの「続きとして」の要点の行（R5。relay の botAnswerLines。頼んだものだけを小窓へ）
  answerLines(payload: unknown) {
    this.lines.receive(payload);
  }

  // 左からの webhook の結果（R11。relay の botHookResult。頼んだ ticket だけを小窓へ）
  hookResult(payload: unknown) {
    this.asker.receive(payload);
  }

  // 小窓に渡す、みんなに聞くの送り方と代表（代表の id は台帳から消えていても渡す。小窓が A に戻して知らせる）
  private askAllNest(): AskAllNest {
    const way = this.state?.nest?.askAll ?? 'each';
    return { askAll: way, ...(this.askLead ? { lead: this.askLead } : {}) };
  }

  // 回答カードの「続けて聞く」（S3.10）：同じボットに依頼の小窓を開き、頼む文の頭に text（「#0003 の続き：要約の1行」）を入れる
  //   開くだけ（依頼の作り方・送り方は今の小窓のまま）。開けなかったら false（知らせはここで出す）
  //   parentRequestId（R5）：その返事の依頼。小窓は「続きとして」が選ばれた状態・入口「続けて聞く」で開く（要点の行は小窓が左に頼む）
  followUp(id: string, text: string, parentRequestId?: string): boolean {
    const bot = this.find(id);
    if (!bot) {
      this.host.toast('このボットは台帳にいません（続けて聞けません）');
      return false;
    }
    if (!bot.agentId) {
      this.host.toast(`「${bot.name}」にはリンクがまだありません。右クリック →「リンクを貼る…」で貼ってから、もう一度どうぞ`, 6000);
      return false;
    }
    if (this.settings.isOpen) {
      this.host.toast('巣の設定の欄を閉じてから、もう一度どうぞ');
      return false;
    }
    return this.openForm(bot.id, 'ask-one', text, parentRequestId ? { botId: bot.id, requestId: parentRequestId } : undefined);
  }

  // 受け取り箱の回答カードの「もう一度 ▾」（R9・D19）。小窓を開くだけ（コピーもアプリも動かない）。開けなかったら false（知らせはここで出す）
  //   pass：別の子へ渡す（巣の次の席の、リンクのある子へ。その返事を続きとして選び、印を付けた要点の行を添えた情報の枠に。R5 の道）
  //   retry：言い換えてもう一回（同じ子。依頼文は空から。前の頼み方は注に一言。送ると retryOf が付き、受け取り箱では #0010-2）
  //   redo：頼み方を直す（同じ子。役の文は小窓の「役の文」の欄、使った定型は依頼文の行、自分の文は残っていれば頭の 40 字。無ければ「残っていません」）
  //   line：その返事の頭の 1 行（続けて聞くと同じ）
  askAgain(how: 'pass' | 'retry' | 'redo', item: { botId: string; requestId: string; no: string; head?: string; role?: string; presetIds?: string[] }, line: string): boolean {
    const bot = this.find(item.botId);
    if (!bot) {
      this.host.toast('このボットは台帳にいません（もう一度は頼めません）');
      return false;
    }
    if (this.settings.isOpen) {
      this.host.toast('巣の設定の欄を閉じてから、もう一度どうぞ');
      return false;
    }
    const head = item.head ? `「${item.head}${[...item.head].length >= 40 ? '…' : ''}」` : '';
    const presetTexts = (item.presetIds ?? []).flatMap((id) => {
      const text = this.state?.presets?.presets.find((p) => p.id === id)?.text;
      return text ? [`「${text}」`] : [];
    });
    if (how === 'pass') {
      // 巣の次の席から、リンクのある別の子（巣に置いていなければ、台帳のリンクのある別の子）
      const docked = this.docked();
      const at = docked.findIndex((b) => b.id === bot.id);
      const order = at >= 0 ? [...docked.slice(at + 1), ...docked.slice(0, at)] : docked;
      const next = order.find((b) => b.agentId && b.id !== bot.id) ?? this.state?.bots.find((b) => b.agentId && b.id !== bot.id);
      if (!next) {
        this.host.toast('渡す先がいません（リンクのある別の Grok Bot を巣に置いてから、もう一度どうぞ）', 6000);
        return false;
      }
      return this.openForm(next.id, 'ask-one', `${item.no} の続き：${line}\n`, { botId: bot.id, requestId: item.requestId, no: item.no }, {
        passTo: next.id,
        heading: `別の子へ渡す（${item.no} の返事を添えて）`,
        note: `${item.no} の返事の要点のうち、印を付けた行だけを添えた情報の枠に入れて「${next.name}」に渡します。送る前に下の 1 行で確かめてください`,
      });
    }
    if (!bot.agentId) {
      this.host.toast(`「${bot.name}」にはリンクがまだありません。右クリック →「リンクを貼る…」で貼ってから、もう一度どうぞ`, 6000);
      return false;
    }
    if (how === 'retry') {
      const root = item.no.replace(/-\d+$/, '');
      const n = (this.state?.requests?.items ?? []).filter((i) => i.no.startsWith(`${root}-`)).length + 2;
      const before = [head ? `前の頼み方：${head}` : '前の頼む文は残っていません', presetTexts.length ? `使った定型：${presetTexts.join('・')}` : ''].filter(Boolean).join('／');
      return this.openForm(bot.id, 'ask-one', '', undefined, {
        retryOf: { requestId: item.requestId, no: item.no },
        heading: `言い換えてもう一回（${root}-${n}）`,
        note: `${before}。打ち直すか、定型の別の言い回しを選んでください（送ると受け取り箱では ${root}-${n}）`,
      });
    }
    const role = bot.role?.name;
    const roleNote = item.role ? `役の文：上の欄（元は「${item.role}」${role && role !== item.role ? `・今は「${role}」` : ''}）` : `役の文：上の欄（元は役なし${role ? `・今は「${role}」` : ''}）`;
    const own = item.head ? ownWords(item.head, presetTexts.map((t) => t.slice(1, -1))) : '';
    return this.openForm(bot.id, 'ask-one', own, undefined, {
      heading: `頼み方を直す（${item.no}）`,
      note: [roleNote, presetTexts.length ? `定型：${presetTexts.join('・')} を依頼文の行に戻しました` : '定型：使っていません', own ? '自分の文：最初の 40 字だけ残っていました' : '自分の文：文は残っていません'].join('／'),
      ...(item.presetIds?.length ? { presetIds: item.presetIds } : {}),
    });
  }

  // 合図の「詳しく」（段階4）。下書き用の小窓を開くだけ。コピーもアプリも開かない
  openCue(input: { text: string; url?: string; title?: string; selection?: string; draftId: string }): boolean {
    const s = this.state;
    const target = this.cueTarget();
    if (!s || !s.ready || !target || this.settings.isOpen) return false;
    this.cueDraftId = input.draftId;
    this.formReturn = 'ask-one';
    this.nest.formOpen(true);
    this.form.open({
      targets: botRequestTargets(s.bots, this.docked().map((b) => b.id)),
      to: target.id,
      context: { url: input.url, title: input.title, selection: input.selection },
      text: input.text,
      confirmApp: !s.confirmed,
      nest: this.askAllNest(),
      ...this.openExtras(),
      heading: '合図から下書き',
      note: 'コピーするまで、クリップボードもアプリも動きません',
      skipCloseDraft: true,
    });
    return true;
  }

  // 未送信の「送り方を選び直す…」（R8・D18）：その下書きで小窓を開き直す（宛て先はその下書きのボット。送れたら下書きを外す）。
  //   付けていたページの題名・URL・選んだ文は付け直す（本文は付け直せないので、そのことを小窓の注に書く）。コピーもアプリも開かない
  openUnsent(draft: BotDraft): boolean {
    const s = this.state;
    if (!s || !s.ready || this.form.isOpen || this.settings.isOpen) return false;
    const bot = this.find(draft.botId);
    const target = bot?.agentId ? { id: bot.id } : this.cueTarget();
    if (!target) {
      this.host.toast('リンクのある Grok Bot がいないので、小窓は開けません。右クリック →「リンクを貼る…」で貼ってから、もう一度どうぞ', 6000);
      return true;
    }
    const page = draft.req.page;
    const refs = cleanMaterialRefs(draft.materialRefs);
    const reopen = [draft.attach.body ? 'ページの本文は付け直していません' : '', refs.length ? '材料は名前だけ残しています（中身は読み直せず、見つかりませんとして外してあります）' : ''].filter(Boolean);
    this.cueDraftId = draft.id;
    this.formReturn = 'ask-one';
    this.nest.formOpen(true);
    this.form.open({
      targets: botRequestTargets(s.bots, this.docked().map((b) => b.id)),
      to: target.id,
      context: page ? { url: page.url, title: page.title, ...(page.selection ? { selection: page.selection } : {}) } : {},
      ...(refs.length ? { materialRefs: refs } : {}),
      text: draft.text,
      confirmApp: !s.confirmed,
      nest: this.askAllNest(),
      ...this.openExtras(),
      heading: draft.failed ? 'コピーできなかった依頼を、送り直す' : '未送信の依頼を、送り直す',
      note: `コピーするまで、クリップボードもアプリも動きません。宛て先・返し先・付けるものを選び直せます${reopen.length ? `（${reopen.join('。')}）` : ''}`,
      skipCloseDraft: true,
    });
    return true;
  }

  // 相棒の返事の「ボットに頼む」（段階7）。返事の文を小窓に入れるだけ。今見ているページは付けない。コピーもアプリも開かない
  openCompanion(text: string): boolean {
    const s = this.state;
    if (this.form.isOpen || this.settings.isOpen) {
      this.host.toast('開いている欄を閉じてから、もう一度どうぞ');
      return false;
    }
    if (!s || !s.ready) {
      this.host.toast('ボットの台帳がまだ届いていません。少し待ってから、もう一度どうぞ');
      return false;
    }
    const target = this.cueTarget();
    if (!target) {
      this.host.toast('リンクのある Grok Bot がいないので、小窓は開けません。右クリック →「リンクを貼る…」で貼ってから、もう一度どうぞ', 6000);
      return false;
    }
    this.formReturn = 'ask-one';
    this.nest.formOpen(true);
    this.form.open({
      targets: botRequestTargets(s.bots, this.docked().map((b) => b.id)),
      to: target.id,
      context: {},
      text,
      confirmApp: !s.confirmed,
      nest: this.askAllNest(),
      ...this.openExtras(),
      heading: '相棒の返事から下書き',
      note: 'コピーするまで、クリップボードもアプリも動きません。今見ているページは付けていません',
    });
    return true;
  }

  // 情報収集の「ボットに頼む」（段階5）。話題の文を小窓に入れるだけ。今見ているページは付けない。コピーもアプリも開かない
  openTopic(text: string): boolean {
    const s = this.state;
    if (this.form.isOpen || this.settings.isOpen) {
      this.host.toast('開いている欄を閉じてから、もう一度どうぞ');
      return false;
    }
    if (!s || !s.ready) {
      this.host.toast('ボットの台帳がまだ届いていません。少し待ってから、もう一度どうぞ');
      return false;
    }
    const target = this.cueTarget();
    if (!target) {
      this.host.toast('リンクのある Grok Bot がいないので、小窓は開けません。右クリック →「リンクを貼る…」で貼ってから、もう一度どうぞ', 6000);
      return false;
    }
    this.formReturn = 'ask-one';
    this.nest.formOpen(true);
    this.form.open({
      targets: botRequestTargets(s.bots, this.docked().map((b) => b.id)),
      to: target.id,
      context: {},
      text,
      confirmApp: !s.confirmed,
      nest: this.askAllNest(),
      ...this.openExtras(),
      heading: '情報収集から頼む',
      note: 'コピーするまで、クリップボードもアプリも動きません。結果の本文は入れていません',
    });
    return true;
  }

  // まとめ役に渡す（G3）。左が作った文を小窓に入れるだけ。コピーするまでアプリは開かない
  openHandoff(input: { botId: string; text: string; group: number; team: BotRoleGroup }): boolean {
    const s = this.state;
    if (this.form.isOpen || this.settings.isOpen) {
      this.host.toast('開いている欄を閉じてから、もう一度どうぞ');
      return false;
    }
    if (!s?.ready) {
      this.host.toast('ボットの台帳がまだ届いていません。少し待ってから、もう一度どうぞ');
      return false;
    }
    const bot = this.find(input.botId);
    if (!bot?.agentId) {
      this.host.toast('まとめ役にリンクがまだありません。右クリック →「リンクを貼る…」で貼ってから、もう一度どうぞ', 6000);
      return false;
    }
    this.cardId = null;
    this.formReturn = 'foot';
    this.nest.formOpen(true);
    this.form.open({
      targets: botRequestTargets(s.bots, this.docked().map((b) => b.id)),
      to: bot.id,
      context: {},
      text: input.text,
      confirmApp: !s.confirmed,
      nest: this.askAllNest(),
      ...this.openExtras(),
      heading: `まとめ役に渡す（${bot.name}）`,
      note: '中身を見てから「コピーしてアプリを開く」を押してください。押すまでアプリは開きません',
      skipCloseDraft: true,
      handoff: { group: input.group, team: input.team },
    });
    return true;
  }

  // 合図の宛て先：巣の、リンクのある最初のボット（無ければ台帳の最初）
  cueTarget(): { id: string; name: string; roleName?: string; role?: BotRole | null } | null {
    const linked = this.docked().find((b) => b.agentId) ?? this.state?.bots.find((b) => b.agentId);
    if (!linked) return null;
    return { id: linked.id, name: linked.name, ...(linked.role ? { roleName: linked.role.name, role: linked.role } : {}) };
  }

  // 依頼の小窓を巣の上に開く（to：宛て先。back：閉じたら戻るボタン。text：はじめに入れておく依頼文〔無ければ書きかけ〕。
  //   follow：続きとして選んでおく返事〔R5。あれば入口は「続けて聞く」〕。extra：見出し・注・「もう一度 ▾」の開き方〔R9〕）。設定の欄が開いていれば開かない
  private openForm(
    to: string,
    back: string,
    text = this.formDraft,
    follow?: { botId: string; requestId: string; no?: string },
    extra: Pick<BotRequestFormOpen, 'heading' | 'note' | 'passTo' | 'retryOf' | 'presetIds'> = {},
  ): boolean {
    this.cardId = null;
    const s = this.state;
    if (!s || !s.ready || this.settings.isOpen) return false;
    this.formReturn = back;
    this.nest.formOpen(true);
    this.form.open({
      targets: botRequestTargets(s.bots, this.docked().map((b) => b.id)),
      to,
      context: this.host.page?.() ?? undefined,
      text,
      confirmApp: !s.confirmed,
      nest: this.askAllNest(),
      ...this.openExtras(follow ? 'follow' : 'nest'),
      ...(follow ? { follow } : {}),
      ...extra,
    });
    return true;
  }

  // C++ に頼んで Grok Bot アプリを開く（渡すのはエージェントの id だけ）。アプリの有無は左にも伝え、盤面のセルの顔もそろえる
  private async launch(bot: BotBrief) {
    if (!bot.agentId || this.opening.has(bot.id)) return;
    this.opening.add(bot.id);
    const result = await openBotApp(bot.agentId);
    this.opening.delete(bot.id);
    const missing = !result.ok && result.error === 'noApp';
    if ((result.ok || missing) && this.state && this.state.appMissing !== missing) {
      this.state.appMissing = missing;
      this.render();
      this.host.askLeft({ command: 'botAppSeen', missing });
    }
    if (result.ok) this.host.toast(`Grok Bot アプリで「${bot.name}」のチャットを開きました`);
    else this.host.toast(botAppErrorText(result.error), 7000);
  }

  // 右のボットの欄で選んだボット（選んだ印と輪の下の説明だけそろえる。アプリは開かない）
  choose(id: string | null) {
    if (this.selected === id) return;
    this.selected = id && this.docked().some((b) => b.id === id) ? id : null;
    this.nest.select(this.selected);
  }

  // 右のボットの欄の「コピーしてアプリを開く…」（右下に置いていないボットでもよい）
  copyAndOpenFor(id: string) {
    const bot = this.find(id);
    if (bot) this.copyAndOpen(bot, this.near(id));
  }

  // 撮影の「AIに頼む」が、はじめてアプリを開く前に使う（巣の「コピーして開く」と同じ確認）
  appConfirmed() {
    return this.appOk || this.state?.confirmed === true;
  }

  confirmAppOpen() {
    this.appOk = true;
    if (this.state) this.state.confirmed = true;
    this.host.askLeft({ command: 'botAppSeen', confirmed: true });
  }

  // コピーしてアプリを開く：頼む文を書いてもらい、送る部品に渡す（依頼を作ってクリップボードに入れ、アプリを開くのは左の ClipboardSender）
  //   はじめての1回だけ「外のアプリを開きます」と確かめる（盤面のボットのセルと同じ設定）
  private copyAndOpen(bot: BotBrief, at: At) {
    if (!bot.agentId) return;
    this.host.menu.prompt(
      `「${bot.name}」に頼む文（依頼にしてコピーしてから、アプリを開きます）`,
      this.drafts.get(bot.id) ?? '',
      (text) => {
        this.drafts.set(bot.id, text);
        const s = this.state;
        if (!s) return;
        if (this.docked().some((b) => b.id === bot.id)) this.selected = bot.id;
        this.render();
        if (s.confirmed) {
          void this.sender.send({ botId: bot.id, text });
          return;
        }
        this.host.menu.open(at.x, at.y, [
          { section: '外のアプリ（Grok Bot）を開きます' },
          { label: `依頼をコピーしてから、「${bot.name}」のチャットを Grok Bot アプリで開きます。次からは聞きません`, disabled: true },
          {
            label: 'コピーして開く',
            run: () => {
              s.confirmed = true;
              this.host.askLeft({ command: 'botAppSeen', confirmed: true });
              void this.sender.send({ botId: bot.id, text });
            },
          },
          { label: 'やめる', run: () => undefined },
        ]);
        this.host.menu.focusFirst();
      },
      at,
      { maxLength: 2000, placeholder: '頼む文（Enter で依頼にしてコピーし、アプリを開く・Esc でやめる）' },
    );
  }

  // 右クリックのメニュー
  private openMenu(id: string, at: At) {
    const bot = this.find(id);
    const docked = this.docked();
    const index = docked.findIndex((b) => b.id === id);
    if (!bot || index < 0) return;
    const entries: MenuEntry[] = [
      { section: `席${index + 1}：Grok Bot「${bot.name}」` },
      { label: 'Grok Bot アプリで開く', hint: 'ダブルクリック', disabled: !bot.agentId, run: () => this.press(id) },
      { label: 'コピーしてアプリを開く…', disabled: !bot.agentId, run: () => this.copyAndOpen(bot, at) },
      { label: bot.agentId ? 'リンクを貼り直す…' : 'リンクを貼る…', run: () => this.editLink(bot, at) },
      { label: '名前を変える…', run: () => this.rename(bot, at) },
      'sep',
      { label: '前の席へ', hint: 'Alt+←', disabled: index === 0, run: () => this.move(id, index - 1) },
      { label: '次の席へ', hint: 'Alt+→', disabled: index === docked.length - 1, run: () => this.move(id, index + 1) },
      { label: '右下から外す（台帳には残る）', run: () => this.undock(bot) },
    ];
    this.host.menu.open(at.x, at.y, entries);
  }

  // 空いた席の ＋：台帳のボットを置く・新しいボットを台帳に入れて置く（at：押した席の場所）
  private openAddMenu(at: At) {
    const s = this.state;
    if (!s || !s.ready) return;
    const docked = this.docked();
    if (docked.length >= MAX_DOCK_BOTS) {
      this.host.toast(`右下の巣に座れる Grok Bot は ${MAX_DOCK_BOTS} 体までです。どれかを右クリック →「右下から外す」と、ほかのボットを置けます（外しても台帳には残ります）`, 6000);
      return;
    }
    const entries: MenuEntry[] = [
      { section: `巣の空いた席に Grok Bot を置く（あと ${MAX_DOCK_BOTS - docked.length} 体）` },
      { label: '新しいボット（リンクか id を貼る）…', run: () => this.newBot(at) },
    ];
    const rest = s.bots.filter((b) => !docked.some((d) => d.id === b.id));
    if (rest.length > 0) {
      entries.push('sep', { section: '台帳のボット（盤面のボットのセルと同じ）' });
      for (const bot of rest) entries.push({ label: bot.name, hint: bot.agentId ? undefined : 'リンクなし', run: () => this.dock(bot) });
    }
    this.host.menu.open(at.x, at.y, entries);
  }

  // 新しいボット：リンクか id を貼ってもらい、名前を決めて、台帳に入れて右下に置く（覚えるのは id だけ）
  //   同じ id のボットが台帳にいれば、新しく作らずにそのボットを置く
  private newBot(at: At, initial = '') {
    this.host.menu.prompt(
      BOT_LINK_LABEL,
      initial,
      (text) => {
        const s = this.state;
        const agentId = parseAgentInput(text);
        if (!s) return;
        if (!agentId) {
          this.host.toast(BAD_BOT_LINK, 6000);
          this.newBot(at, text); // 貼り直せるように、欄を開き直す
          return;
        }
        const known = s.bots.find((b) => b.agentId === agentId);
        if (known) {
          if (this.docked().some((b) => b.id === known.id)) this.host.toast(`このボットは、もう右下にいます（「${known.name}」）`);
          else this.dock(known, `このボットは台帳にいました（「${known.name}」）。`);
          return;
        }
        this.host.menu.prompt(
          'ボットの名前',
          `ボット${s.bots.length + 1}`,
          (name) => {
            if (this.docked().length >= MAX_DOCK_BOTS) {
              this.host.toast(`右下の巣に座れる Grok Bot は ${MAX_DOCK_BOTS} 体までです`);
              return;
            }
            this.host.askLeft({ command: 'newDockBot', name, agentId });
            this.host.toast(`ボット「${cleanBotName(name) || DEFAULT_BOT_NAME}」を台帳に入れて、右下の巣に置きました（ダブルクリックで Grok Bot アプリのチャットが開きます）`, 5000);
          },
          at,
          { maxLength: MAX_BOT_NAME },
        );
      },
      at,
      { maxLength: 2048, placeholder: BOT_LINK_HINT },
    );
  }

  // 台帳のボットを右下の最後に置く（写しをすぐ直してから、左に頼む）
  private dock(bot: BotBrief, lead = '') {
    const s = this.state;
    if (!s) return;
    if (this.docked().length >= MAX_DOCK_BOTS) {
      this.host.toast(`右下の巣に座れる Grok Bot は ${MAX_DOCK_BOTS} 体までです`);
      return;
    }
    s.dock = [...s.dock.filter((id) => id !== bot.id), bot.id];
    this.render();
    this.host.askLeft({ command: 'dockBot', botId: bot.id });
    this.host.toast(`${lead}「${bot.name}」を右下の巣に置きました${bot.agentId ? '（ダブルクリックで Grok Bot アプリのチャットが開きます）' : '（リンクがまだありません。右クリック →「リンクを貼る…」）'}`, 5000);
  }

  // 右下から外す（台帳には残る。＋ からまた置ける）
  private undock(bot: BotBrief) {
    const s = this.state;
    if (!s) return;
    s.dock = s.dock.filter((id) => id !== bot.id);
    this.render();
    this.host.askLeft({ command: 'undockBot', botId: bot.id });
    this.host.toast(`「${bot.name}」を右下から外しました（台帳には残っています。＋ からまた置けます）`, 5000);
  }

  // 並びを変える（to：0 から数えた場所）
  private move(id: string, to: number) {
    const s = this.state;
    if (!s) return;
    const order = this.docked().map((b) => b.id);
    const from = order.indexOf(id);
    if (from < 0 || to < 0 || to >= order.length || to === from) return;
    order.splice(from, 1);
    order.splice(to, 0, id);
    s.dock = order;
    this.render();
    this.host.askLeft({ command: 'moveDockBot', botId: id, to });
  }

  // リンクを貼る・貼り直す（覚えるのは id だけ。欄には今の id もリンクも出さない）
  private editLink(bot: BotBrief, at: At, initial = '') {
    this.host.menu.prompt(
      BOT_LINK_LABEL,
      initial,
      (text) => {
        const agentId = parseAgentInput(text);
        if (!agentId) {
          this.host.toast(BAD_BOT_LINK, 6000);
          this.editLink(bot, at, text);
          return;
        }
        this.host.askLeft({ command: 'setBotLink', botId: bot.id, agentId });
        this.host.toast(`「${bot.name}」にリンクを付けました（id：${agentId}）。ダブルクリックで Grok Bot アプリのチャットが開きます`, 5000);
      },
      at,
      { maxLength: 2048, placeholder: BOT_LINK_HINT },
    );
  }

  // 名前を変える（台帳の名前なので、盤面のボットのセルも同じ名前になる）
  private rename(bot: BotBrief, at: At) {
    this.host.menu.prompt('ボットの新しい名前', bot.name, (name) => this.host.askLeft({ command: 'renameBot', botId: bot.id, name }), at, { maxLength: MAX_BOT_NAME });
  }

  // メニューを出す場所（そのボットの席の上のあたり。はみ出す分はメニューが自分でずらす）
  private near(id: string): At {
    return this.nest.near(id);
  }
}

// 続きの頭（R5 の「#0010 の続き：返事の頭の 1 行」）。送った依頼から拾うときは外す（R4b。1 行にまとめた頭では、最初の空白まで）
const FOLLOW_HEAD_RE = /^#\d{4,}(?:-\d+)? の続き[：:]/;
function dropFollowHead(head: string): string {
  if (!FOLLOW_HEAD_RE.test(head)) return head;
  const space = head.indexOf(' ');
  return space >= 0 ? head.slice(space + 1) : '';
}

// 頼み方を直す（R9）：残っていた頭の 40 字（1 行にまとめた文）から、自分の文だけを取り出す。
//   使った定型の行（穴の無いもの）・朱書きの行・添えた情報の枠は空白でつながって入っているので外す。40 字で切れた途中の定型も外す
export function ownWords(head: string, presetTexts: readonly string[]): string {
  let own = head.replace(/…$/, '');
  const frame = own.indexOf(' ―――― ');
  if (frame >= 0) own = own.slice(0, frame);
  const stamp = own.indexOf(' （朱書き');
  if (stamp >= 0) own = own.slice(0, stamp);
  const texts = presetTexts.filter((t) => t && !t.includes('{'));
  for (const text of texts) own = own.split(` ${text}`).join('');
  const tail = own.lastIndexOf(' ');
  const rest = tail >= 0 ? own.slice(tail + 1) : '';
  if (rest && texts.some((t) => t.startsWith(rest))) own = own.slice(0, tail);
  return own.trim();
}
