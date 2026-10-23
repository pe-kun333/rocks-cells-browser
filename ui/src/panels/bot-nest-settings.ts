// Grok-Bot の巣の設定の欄（⚙。第3段 S3.3：docs/bot-cells/plan-s3-nest.md §3・§4・§5.1・S3.3）
//   ・巣の見出しの ⚙ で、巣の上に重ねて開く（相棒の ⚙ の ai-settings と同じ作り：小さな見出し・縦に流れる中身・入力欄）。
//     下の端を巣の下の端にそろえて上へ伸ばし、高さは窓（WebView）の中に収まるだけにする（fit）。幅は巣と同じ
//   ・タブは4つ
//       並び　　　　：席1〜6 に座るボットを台帳から選ぶ・空ける・前の席へ／次の席へ（席は前から順に座る。dock の順）
//       役　　　　　：席を選び、用意した役 13 個（5つの組）か「自分で」か「役なし」。細かい設定・説明の文・依頼に入る文のプレビュー
//                     上の「席の役」「グループ」で切り替えると、5つのグループの役ごとのボットとまとめ役（bot-teams.ts。席・役とは別に持つ）
//       みんなに聞く：送り方（A 1体ずつ順に案内〔既定〕／B 代表にまとめて）・B の代表・合体 Grok の演出（既定オン）
//       定型　　　　：依頼の小窓の定型の棚（依頼の小窓 v2・R4b・D10・Q7。bot-presets.ts）。下の「定型（R4b）」の節
//       送り方　　　：webhook「そのまま送る」の宛先（https の URL）と鍵（依頼の小窓 v2・R11・D20）。下の「送り方（R11）」の節
//   ・書きかけはこの欄の中だけに持つ。「保存」で、変えたところだけを host.save に渡す（台帳を書くのは左。命令は BotDock が送る）
//   ・閉じるのは「閉じる」か Esc だけ（欄の外を押しても閉じない）。保存していない変更があれば、閉じる前に確かめる
//   ・プレビューは bot-roles.ts の roleInstructions の結果そのもの（同じ関数を呼ぶだけ）。役を依頼に入れるのは S3.4
//   ・役のタブには、役ごとの考え方の段階（おまかせ／さっと／ふつう／じっくり／段階を踏む／自分で。S3.3b）も置く
//     同じ役を何席に付けてもよい（ほかの席が同じ役なら「この役は他の席でも使えます」と添える。巣では名前で区別する）
//   ・文字はすべて textContent で入れる（innerHTML は使わない）。動き（アニメーション）は使わない
//   ・依頼の小窓 v2・R8（D17・Q5）：「みんなに聞く」のタブの下に「送ったあと」：知らせの期限（時間。既定 3）と、
//     アプリから戻って「貼りましたか？」を聞くまでの秒（既定 30）。どちらも範囲の中の整数だけ（bots.ts の NOTICE_HOURS・ASK_PASTED_SEC）
//   ・依頼の小窓 v2・R7d（D16・Q2）：その下に「画像の貼り方」：2 回貼る（既定）／画像と文を一つの貼り付けで（試し）。
//     Grok Bot アプリが受けるかはブラウザからは分からないので、選ぶのは使う人（受けないと文だけが貼られ、画像は落ちる）
//   ・定型（R4b）：左の presets.json の写し（蔵も。印の数は左が今ある依頼の印を足した数）を見る。ほかのタブと違い、押したときにすぐ
//     host.savePresets（命令 setPresets）で左へ渡す（保存のボタンは要らない。数字は左が持ち分のまま混ぜる）。
//       上から：声かけ（棚から 3 回使った定型を、手元の一番使っていない定型と入れ替えるか名指しで一度だけ／棚卸しの時期）・
//       組を替える軸（入口だけ。サイト・子は「次の版で」。Q7）・組の札・手元（6）・棚（その他。並べ替え）・蔵（検索でだけ出る）。
//       行を押すと、その下に直す欄（文・寿命〔ずっと／今日だけ／この調べものの間〕・手元へ／棚へ／蔵へ・↑ ↓・消す）。
//       新しい定型（寿命を決めて作る）・棚卸し（言い回しの近い定型を並べる：これを残す〔ほかは蔵へ〕／別物）・
//       送った依頼から拾う（受け取り箱の依頼の頭の 40 字〔巣の設定でオンのときだけ残る〕と下書きの自分の文を、穴に置き換えた形で。
//       host.pickSources が集め、「定型にする」で host.pickPreset〔命令 presetFromRequest〕）
//   ・送り方（R11）：宛先の URL と鍵は host.hook.save（右が C++ の setBotHook に直接。DPAPI の bot-hook.bin にしまう）。ほかのタブと違い、
//     押したときにすぐ。欄の値は渡したらすぐ空にする（描き直しても残さない）。出すのは「ある／ない」だけ（host.hook.state。値・ホスト名は出さない）。
//     「鍵を消す」は host.hook.remove。左には右が命令 botHookChanged で知らせる（左が「ある／ない」を読み直して、小窓に写しで渡す）
import { ASK_PASTED_SEC, type BotBrief, type BotNest, DEFAULT_NEST, MAX_DOCK_BOTS, NOTICE_HOURS, requestNo } from '../bots';
import {
  BOT_ROLE_GROUPS,
  BOT_ROLE_SHAPES,
  BOT_THINKING_LEVELS,
  CUSTOM_ROLE,
  CUSTOM_ROLE_DEFAULT_NAME,
  ROLE_INSTRUCTIONS_MAX,
  ROLE_NAME_MAX,
  ROLE_NONE_LABEL,
  ROLE_OPTION_TEXT_MAX,
  ROLE_SEPARATOR,
  ROLE_TEXT_MAX,
  THINKING_AUTO_LABEL,
  THINKING_TEXT_MAX,
  type BotRole,
  type BotRoleGroup,
  type BotRoleOptionDef,
  type BotRoleOptions,
  type BotRolePreset,
  type BotRoleShape,
  type BotThinkingLevel,
  normalizeRole,
  roleDef,
  roleInstructions,
  roleOptionDefs,
} from '../bot-roles';
import { type BotTeam, type BotTeamPreset, type BotTeams, normalizeTeams } from '../bot-teams';
import {
  apartKey,
  type BotPreset,
  type BotPresetLife,
  type BotPresets,
  type BotPresetSet,
  DEFAULT_PRESETS,
  newPresetId,
  normalizePresets,
  PRESET_CASE_DAYS,
  PRESET_ENTRY_LABEL,
  PRESET_HAND_MAX,
  PRESET_LIFE_LABEL,
  PRESET_REVIEW_COUNT,
  PRESET_SINK_DAYS,
  PRESET_SWAP_USES,
  PRESET_TEXT_MAX,
  presetClock,
  presetHand,
  presetParts,
  presetSleeping,
  presetSwapAsk,
  presetTemplate,
  reviewDue,
  similar,
  similarGroups,
  sinkPreset,
  swapPreset,
} from '../bot-presets';
import { svgEl } from '../cellface';
import { hexCorners } from '../hex';
import { el } from '../util';
import { drawRoleFace, drawSeatFace } from './bot-nest';

// 欄が見る台帳の写し（BotDock が左から届いた写しから作る）
export interface BotNestSnapshot {
  bots: BotBrief[]; // 台帳のボット（名前・リンクの id・役）
  dock: string[]; // 席の順（台帳にいるものだけ。6体まで）
  nest: BotNest; // 巣の設定
  teams: BotTeams | null; // グループの割り当て（null：左がまだ groups.json を読み終えていない）
  ready: boolean; // 台帳を読み終えた（まだなら保存できない）
  presets?: BotPresets | null; // 定型の棚の写し（R4b。蔵も。印の数は左が足した数。無い・null：左がまだ presets.json を読み終えていない）
  pickKey?: string; // 送った依頼から拾う候補の手がかり（R4b。頭のある依頼の id。変わったら候補を集め直す）
}

// 送った依頼から拾う候補（R4b。巣〔bot-dock.ts〕が受け取り箱の一覧の写しと下書きから集める。text は自分の文だけ〔ownWords〕）
export interface PresetPickSource {
  kind: 'request' | 'draft';
  id: string; // requestId か下書きの id
  label: string; // #0005 ／ 下書き
  at: number;
  text: string;
  page?: { title?: string; url?: string; selection?: string }; // 下書きなら付けていたもの（穴に置き換える手がかり）
}

// 「保存」で渡す、変えたところだけ（変えていないものは null・空）
export interface BotNestPlan {
  dock: string[] | null; // 新しい席の順
  roles: { botId: string; role: BotRole | null }[]; // 役を変えたボット（null は役なし）
  nest: BotNest | null; // 新しい巣の設定
  teams: BotTeams | null; // 新しいグループの割り当て（全部のグループ）
}

export interface BotNestSettingsHost {
  save(plan: BotNestPlan): void; // 左に頼む（setNest・setBotRole・dockBot／undockBot／moveDockBot・setBotTeams）
  closed(): void; // 閉じた（キーボードの位置を ⚙ に戻す）
  // 定型の棚（R4b）：押したときにすぐ左へ（命令 setPresets。巣が写しをすぐ直してから送る）。無ければ定型のタブは見るだけ
  savePresets?(next: BotPresets): void;
  pickPreset?(pick: { requestId?: string; draftId?: string; text: string }): void; // 送った依頼から拾う（命令 presetFromRequest）
  pickSources?(): Promise<PresetPickSource[]>; // 拾う候補（受け取り箱の依頼の頭・下書き）
  hook?: BotNestHookHost; // 送り方（R11）。無ければ送り方のタブは見るだけ
}

// webhook「そのまま送る」の宛先と鍵（R11）。どれも C++ の答えの「ある／ない」だけ（答えが無ければ null）。値は返らない
export interface BotNestHookHost {
  state(): Promise<boolean | null>;
  save(url: string, key: string): Promise<{ has: boolean; error?: string } | null>;
  remove(): Promise<boolean | null>;
}

export type BotNestSettingsTab = 'seats' | 'roles' | 'askAll' | 'presets' | 'send';
type RoleView = 'seats' | 'teams'; // 役のタブの中の切り替え（席の役／グループ）

// 書きかけの役（自分で作る役の名前・説明の文は、書いている途中の文のまま持つ。保存とプレビューでは toRole で直す）
//   考え方は段階（null ＝ おまかせ）と「自分で」の文を分けて持つ（ほかの段階を選んでも、書いた文は残す。台帳に書くのは custom のときだけ）
interface RoleDraft {
  preset: BotRolePreset;
  name: string;
  shape: BotRoleShape;
  options: BotRoleOptions;
  instructions: string;
  thinking: BotThinkingLevel | null;
  thinkingText: string;
}

const TABS: readonly { tab: BotNestSettingsTab; label: string; hint: string }[] = [
  { tab: 'seats', label: '並び', hint: '席1〜6 に座るボット（選ぶ・空ける・前の席へ／次の席へ）' },
  { tab: 'roles', label: '役', hint: '席ごとの役・細かい設定・考え方・依頼に入る文のプレビュー。「グループ」に切り替えると、グループごとの役のボットとまとめ役' },
  { tab: 'askAll', label: 'みんなに聞く', hint: '送り方（1体ずつ／代表にまとめて）・代表・合体 Grok の演出・月の窓の Grok Visions・受け取り箱の一覧に依頼の最初の40字・送ったあと・画像の貼り方' },
  { tab: 'presets', label: '定型', hint: '依頼の小窓の定型の棚：手元（6）・棚・蔵、寿命、使った日と回数、当たり／ずれの数、棚卸し、送った依頼から拾う' },
  { tab: 'send', label: '送り方', hint: 'webhook「そのまま送る」：中継の受け口の URL と鍵（Windows の暗号化でこの PC にだけしまう。画面には「ある／ない」だけ）' },
];

type PresetSort = 'recent' | 'hits' | 'misses';
const VAULT_SHOW_MAX = 30; // 蔵の検索で出す数
const PICK_SHOW_MAX = 8; // 送った依頼から拾う候補の数
const DAY = 24 * 60 * 60 * 1000;

const VIEW_BOX = '-22 -22 44 44'; // 顔の SVG（bot-nest.ts と同じ箱）
const MAX_HEIGHT = 560; // 欄のいちばん高いとき（px。窓が低ければ、窓に収まるだけ）

// 書いている途中の文から消す文字（bot-roles.ts の cleanRoleInstructions・cleanLine と同じ文字。説明の文は改行とタブを残す）
const CONTROL_TEXT = /[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g;
const CONTROL_LINE = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g;

const charCount = (text: string) => [...text].length;

function option(value: string, label: string): HTMLOptionElement {
  const o = el('option', '', label);
  o.value = value;
  return o;
}

function toDraft(role: BotRole | null | undefined): RoleDraft | null {
  if (!role) return null;
  return {
    preset: role.preset,
    name: role.name,
    shape: role.shape,
    options: { ...(role.options ?? {}) },
    instructions: role.instructions ?? '',
    thinking: role.thinking?.level ?? null,
    thinkingText: role.thinking?.text ?? '',
  };
}

// 書きかけの役を、台帳に書く形に（normalizeRole で直す。自分で作る役の名前が空なら「自分の役」）
//   考え方を「自分で」にして文が空なら、おまかせ（normalizeThinking が捨てる）
function toRole(draft: RoleDraft | null): BotRole | null {
  if (!draft) return null;
  const thinking = draft.thinking ? { level: draft.thinking, ...(draft.thinking === 'custom' ? { text: draft.thinkingText } : {}) } : undefined;
  const raw = { preset: draft.preset, name: draft.name, shape: draft.shape, options: { ...draft.options }, instructions: draft.instructions, thinking };
  if (draft.preset !== 'custom') return normalizeRole(raw);
  return normalizeRole(raw) ?? normalizeRole({ ...raw, name: CUSTOM_ROLE_DEFAULT_NAME });
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// 同じ役か（用意した役は preset、自分で作る役は名前で見る。細かい設定・考え方が違っても同じ役）
const sameRoleKind = (a: BotRole, b: BotRole) => a.preset === b.preset && (a.preset !== 'custom' || a.name === b.name);

// 入力欄から消す文字を消し、カーソルの位置をそろえる（消したときだけ値を入れ直す。変換中は触らない）
function stripField(field: HTMLInputElement | HTMLTextAreaElement, pattern: RegExp, composing: boolean) {
  if (composing) return;
  const value = field.value;
  const clean = value.replace(pattern, '');
  if (clean === value) return;
  const caret = field.selectionStart ?? clean.length;
  const before = value.slice(0, caret).replace(pattern, '').length;
  field.value = clean;
  field.setSelectionRange(before, before);
}

export class BotNestSettings {
  readonly element = el('section', 'bns');
  private readonly uid = `bns${Math.random().toString(36).slice(2, 8)}`;
  private readonly tabButtons = new Map<BotNestSettingsTab, HTMLButtonElement>();
  private readonly body = el('div', 'bns-body');
  private readonly foot = el('div', 'bns-foot');
  private readonly status = el('div', 'bns-status');
  private readonly saveButton = el('button', 'bns-button bns-primary', '保存');
  private readonly closeButton = el('button', 'bns-button', '閉じる');
  private readonly confirmBar = el('div', 'bns-confirm');
  private base: BotNestSnapshot = { bots: [], dock: [], nest: { ...DEFAULT_NEST }, teams: null, ready: false };
  private signature = ''; // 前の写し（名前・役・並び・巣の設定が同じなら描き直さない。書いている途中の変換を壊さないように）
  private draftDock: string[] = [];
  private readonly draftRoles = new Map<string, RoleDraft | null>(); // 役のタブで触ったボットだけ
  private readonly lastRoles = new Map<string, RoleDraft>(); // 「役なし」にする前の役（もう一度役を選んだとき、設定と説明の文を戻す）
  private draftNest: BotNest = { ...DEFAULT_NEST };
  private draftTeams: BotTeams = {};
  private tab: BotNestSettingsTab = 'seats';
  private roleView: RoleView = 'seats';
  private roleBot: string | null = null; // 役のタブで選んでいる席のボット（並びが変わっても同じボットを見る）
  private saved = false; // 「保存しました」を出す（次に書き換えるまで）
  // 役のタブで、文を書くたびに直す所（タブを描き直さない）
  private preview: HTMLElement | null = null;
  private previewCount: HTMLElement | null = null;
  private instructionsCount: HTMLElement | null = null;
  private thinkingCount: HTMLElement | null = null;
  private sharedNote: HTMLElement | null = null; // 「この役は他の席でも使えます」（自分で作る役の名前を書くたびにも直す）
  // 定型のタブ（R4b）。押したらすぐ左へ渡すので、ここに持つのは見せ方と書きかけの文だけ（閉じたら捨てる）
  private presetSetId: string | null = null; // 手元を見ている組
  private presetPick: string | null = null; // 直す欄を開いている定型
  private presetEditText: string | null = null; // 直す欄の書きかけの文（presetPick の。押して決めるまで左へは渡さない）
  private presetSort: PresetSort = 'recent';
  private vaultQuery = '';
  private newPresetText = '';
  private newPresetLife: BotPresetLife = 'forever';
  private presetNote = ''; // タブの中の 1 行（「蔵へ入れました」など）
  private hookHas: boolean | null = null; // 送り方（R11）：宛先と鍵があるか（C++ の答え。確かめる前・答えが無ければ null）
  private hookNote = ''; // 送り方のタブの 1 行（「しまいました」など。値は入れない）
  private hookBusy = false;
  private presetDelete: string | null = null; // 「消す」を一度押した定型（もう一度で消す）
  private reviewOpen = false; // 棚卸しを並べている
  private axisNote = false; // サイト・子を押した（「次の版で」を出す）
  private pickSources: PresetPickSource[] | null = null; // 拾う候補（null：集めている途中・まだ）
  private readonly pickTexts = new Map<string, string>(); // 候補ごとの書きかけの文（kind:id → 文）
  private readonly onResize = () => this.fit();
  // 押したボタンが消えた・押せなくなったとき（キーボードの位置が欄の外へ落ちたとき）も、Esc で閉じられるように
  private readonly onDocumentKey = (e: KeyboardEvent) => {
    const active = document.activeElement;
    if (!active || active === document.body) this.onKey(e);
  };

  constructor(private readonly host: BotNestSettingsHost) {
    this.element.hidden = true;
    this.element.setAttribute('role', 'dialog');
    const title = el('span', 'bns-title', '⚙ 巣の設定');
    title.id = `${this.uid}-title`;
    this.element.setAttribute('aria-labelledby', title.id);

    const tabs = el('div', 'bns-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', '巣の設定のタブ（← → で切り替え）');
    for (const t of TABS) {
      const b = el('button', 'bns-tab', t.label);
      b.type = 'button';
      b.id = `${this.uid}-tab-${t.tab}`;
      b.dataset.key = `bns-tab-${t.tab}`;
      b.title = t.hint;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', `${this.uid}-panel`);
      b.addEventListener('click', () => this.showTab(t.tab));
      this.tabButtons.set(t.tab, b);
      tabs.append(b);
    }
    // ← → Home End：タブを移る（移った先を開く）
    tabs.addEventListener('keydown', (e) => {
      const order = TABS.map((t) => t.tab);
      const i = order.indexOf(this.tab);
      const next = e.key === 'ArrowRight' ? (i + 1) % order.length : e.key === 'ArrowLeft' ? (i + order.length - 1) % order.length : e.key === 'Home' ? 0 : e.key === 'End' ? order.length - 1 : -1;
      if (next < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      this.showTab(order[next]);
      this.tabButtons.get(order[next])?.focus();
    });
    const head = el('div', 'bns-head');
    head.append(title, tabs);

    this.body.id = `${this.uid}-panel`;
    this.body.setAttribute('role', 'tabpanel');

    this.status.setAttribute('role', 'status');
    this.saveButton.type = 'button';
    this.saveButton.dataset.key = 'bns-save';
    this.saveButton.title = '変えたところを台帳に書きます（盤面のボットのセルと同じ台帳）';
    this.saveButton.addEventListener('click', () => this.save());
    this.closeButton.type = 'button';
    this.closeButton.dataset.key = 'bns-close';
    this.closeButton.title = '閉じる（Esc）。保存していない変更があれば、閉じる前に聞きます';
    this.closeButton.addEventListener('click', () => this.requestClose());
    this.foot.append(this.status, this.saveButton, this.closeButton);
    this.confirmBar.hidden = true;
    this.confirmBar.setAttribute('role', 'group');
    this.confirmBar.setAttribute('aria-label', '保存していない変更があります');

    this.element.append(head, this.body, this.foot, this.confirmBar);
    this.element.addEventListener('keydown', (e) => this.onKey(e));
  }

  // Esc：確かめの最中なら「戻る」、ふだんは閉じる（変換中の Esc は変換を消すだけ）
  private onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented || !this.isOpen) return;
    e.preventDefault();
    e.stopPropagation();
    if (!this.confirmBar.hidden) this.hideConfirm(true);
    else this.requestClose();
  }

  get isOpen() {
    return !this.element.hidden;
  }

  // 開く（botId：巣で選んでいるボット。役のタブでその席を出す。tab：はじめに出すタブ〔小窓の「棚を整える…」は定型。R4b〕）
  open(snapshot: BotNestSnapshot, botId?: string | null, tab?: BotNestSettingsTab) {
    this.setBase(snapshot);
    this.resetDraft();
    if (botId && this.draftDock.includes(botId)) this.roleBot = botId;
    if (tab) this.tab = tab;
    this.saved = false;
    this.hideConfirm(false);
    this.element.hidden = false;
    if (this.tab === 'presets') this.loadPickSources();
    if (this.tab === 'send') void this.loadHook();
    this.renderAll(false);
    this.body.scrollTop = 0;
    this.fit();
    window.addEventListener('resize', this.onResize);
    document.addEventListener('keydown', this.onDocumentKey);
    this.tabButtons.get(this.tab)?.focus({ preventScroll: true });
  }

  // 左から新しい写しが届いた（ほかの所で並び・名前・役が変わった・保存した分が台帳に入った）
  //   並び・巣の設定・ボットごとの役のそれぞれで、ここで書き換えていなければ新しい写しに合わせ、書き換えていれば書きかけを残す
  //   （台帳から消えたボットだけ書きかけから外す）。書きかけを残したものは、保存すると新しい写しの上に書く
  update(snapshot: BotNestSnapshot) {
    if (!this.isOpen) return;
    if (this.signatureOf(snapshot) === this.signature) return;
    const old = this.base;
    const dockSame = this.draftDock.join(' ') === old.dock.join(' ');
    const nestSame = sameJson(this.cleanNest(this.draftNest), this.cleanNest(old.nest));
    const rolesSame = [...this.draftRoles].filter(([id, draft]) => sameJson(toRole(draft), normalizeRole(old.bots.find((b) => b.id === id)?.role ?? null))).map(([id]) => id);
    const teamsSame = sameJson(this.cleanTeams(this.draftTeams), this.cleanTeams(old.teams ?? {}));
    if (this.tab === 'presets' && (snapshot.pickKey ?? '') !== (old.pickKey ?? '')) this.loadPickSources(true); // 新しい依頼の頭が届いた（R4b）
    this.setBase(snapshot);
    if (dockSame) this.draftDock = [...this.base.dock];
    if (nestSame) this.draftNest = { ...this.base.nest };
    if (teamsSame) this.draftTeams = this.cleanTeams(this.base.teams ?? {});
    for (const id of rolesSame) this.draftRoles.delete(id);
    this.pruneDraft();
    this.renderAll(true);
  }

  // 閉じたい（「閉じる」・Esc・⚙）。保存していない変更があれば確かめる
  requestClose() {
    if (!this.isOpen) return;
    if (this.plan()) this.showConfirm();
    else this.close();
  }

  // ---------- 内側 ----------

  private close() {
    this.element.hidden = true;
    this.hideConfirm(false);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('keydown', this.onDocumentKey);
    this.draftRoles.clear();
    this.lastRoles.clear();
    this.preview = this.previewCount = this.instructionsCount = this.thinkingCount = this.sharedNote = null;
    this.resetPresetView();
    this.body.replaceChildren();
    this.host.closed();
  }

  // 高さを窓に収める（下の端は巣の下の端。そこから上に使えるだけ）
  private fit() {
    if (!this.isOpen) return;
    const bottom = this.element.parentElement?.getBoundingClientRect().bottom ?? window.innerHeight;
    const room = Math.floor(Math.min(bottom, window.innerHeight) - 8);
    this.element.style.maxHeight = `${Math.max(160, Math.min(MAX_HEIGHT, room))}px`;
  }

  private signatureOf(s: BotNestSnapshot): string {
    return JSON.stringify([s.ready, s.dock, s.nest, s.teams, s.bots.map((b) => [b.id, b.name, !!b.agentId, b.role ?? null]), s.presets ?? null, s.pickKey ?? '']);
  }

  private setBase(snapshot: BotNestSnapshot) {
    this.base = {
      bots: [...snapshot.bots],
      dock: snapshot.dock.filter((id) => snapshot.bots.some((b) => b.id === id)).slice(0, MAX_DOCK_BOTS),
      nest: { ...snapshot.nest },
      teams: snapshot.teams ? normalizeTeams(snapshot.teams, (id) => snapshot.bots.some((b) => b.id === id)) : null,
      ready: snapshot.ready,
      presets: snapshot.presets ? normalizePresets(snapshot.presets) : null,
      pickKey: snapshot.pickKey ?? '',
    };
    this.signature = this.signatureOf(snapshot);
    if (this.presetPick && !this.base.presets?.presets.some((p) => p.id === this.presetPick)) this.closePresetEditor(); // 消えた定型の直す欄は閉じる
  }

  private bot(id: string | null | undefined): BotBrief | undefined {
    return id ? this.base.bots.find((b) => b.id === id) : undefined;
  }

  private resetDraft() {
    this.draftDock = [...this.base.dock];
    this.draftRoles.clear();
    this.lastRoles.clear();
    this.draftNest = { ...this.base.nest };
    this.draftTeams = this.cleanTeams(this.base.teams ?? {});
    this.fixRoleBot();
  }

  // 書きかけを残したまま、台帳から消えたボットだけ外す
  private pruneDraft() {
    this.draftDock = this.draftDock.filter((id) => this.bot(id));
    this.draftTeams = this.cleanTeams(this.draftTeams);
    for (const id of [...this.draftRoles.keys()]) if (!this.bot(id)) this.draftRoles.delete(id);
    if (this.draftNest.lead && !this.bot(this.draftNest.lead)) {
      const next = { ...this.draftNest };
      delete next.lead;
      this.draftNest = next;
    }
    this.fixRoleBot();
  }

  private fixRoleBot() {
    if (!this.roleBot || !this.draftDock.includes(this.roleBot)) this.roleBot = this.draftDock[0] ?? null;
  }

  // 巣の設定を、台帳に書く形に（代表は台帳にいるボットだけ。項目の順は bots.ts の normalizeNest と同じ）
  private cleanNest(n: BotNest): BotNest {
    return {
      askAll: n.askAll === 'lead' ? 'lead' : 'each',
      ...(n.lead && this.bot(n.lead) ? { lead: n.lead } : {}),
      merge: n.merge === 'off' ? 'off' : 'effect',
      visions: n.visions === 'off' ? 'off' : 'on',
      headline: n.headline === 'on' ? 'on' : 'off',
      cosmic: n.cosmic === 'on' ? 'on' : 'off',
      noticeHours: clampInt(n.noticeHours, NOTICE_HOURS),
      askPastedSec: clampInt(n.askPastedSec, ASK_PASTED_SEC),
      pasteMode: n.pasteMode === 'html' ? 'html' : 'two',
    };
  }

  // グループの割り当てを、groups.json に書く形に（台帳にいるボットだけ。並びは組の順・役の順）
  private cleanTeams(t: BotTeams): BotTeams {
    return normalizeTeams(t, (id) => !!this.bot(id));
  }

  // 今の書きかけの役（触っていなければ台帳の役）
  private draftRoleOf(botId: string): RoleDraft | null {
    return this.draftRoles.has(botId) ? (this.draftRoles.get(botId) ?? null) : toDraft(this.bot(botId)?.role);
  }

  // 書き換える役（台帳の役なら写しを作って書きかけに入れる）
  private editableRole(botId: string): RoleDraft | null {
    const draft = this.draftRoleOf(botId);
    if (draft && !this.draftRoles.has(botId)) this.draftRoles.set(botId, draft);
    return draft;
  }

  // 保存するもの（変えていなければ null）
  private plan(): BotNestPlan | null {
    const dockChanged = this.draftDock.join(' ') !== this.base.dock.join(' ');
    const roles: BotNestPlan['roles'] = [];
    for (const [botId, draft] of this.draftRoles) {
      const bot = this.bot(botId);
      if (!bot) continue;
      const role = toRole(draft);
      if (!sameJson(role, normalizeRole(bot.role ?? null))) roles.push({ botId, role });
    }
    const nest = this.cleanNest(this.draftNest);
    const nestChanged = !sameJson(nest, this.cleanNest(this.base.nest));
    const teams = this.cleanTeams(this.draftTeams);
    const teamsChanged = this.base.teams !== null && !sameJson(teams, this.base.teams);
    if (!dockChanged && roles.length === 0 && !nestChanged && !teamsChanged) return null;
    return { dock: dockChanged ? [...this.draftDock] : null, roles, nest: nestChanged ? nest : null, teams: teamsChanged ? teams : null };
  }

  private save(): boolean {
    const plan = this.plan();
    if (!plan || !this.base.ready) return false;
    const fromButton = document.activeElement === this.saveButton;
    this.host.save(plan); // BotDock が写しをすぐ直して update を呼ぶ（巣の顔・役の名前もすぐ変わる）
    this.saved = true;
    this.renderStatus();
    if (fromButton) this.closeButton.focus(); // 保存のボタンは押せなくなるので、キーボードの位置を「閉じる」へ
    return true;
  }

  // 書き換えた（「保存しました」を消して、保存のボタンと札を直す）
  private changed() {
    this.saved = false;
    this.renderStatus();
  }

  private renderStatus() {
    const plan = this.plan();
    const count = plan ? (plan.dock ? 1 : 0) + plan.roles.length + (plan.nest ? 1 : 0) + (plan.teams ? 1 : 0) : 0;
    this.saveButton.disabled = !plan || !this.base.ready;
    // 定型のタブ（R4b）は押したときにすぐ書くので、変更が無ければタブの 1 行（「蔵へ入れました」など）を出す
    const presetLine = this.tab === 'presets' ? this.presetNote || '定型は、押したときにすぐ書きます' : this.tab === 'send' ? this.hookNote || '送り方は、押したときにすぐしまいます' : '';
    this.status.textContent = !this.base.ready ? 'ボットの台帳を読み込んでいます' : plan ? `● 未保存の変更 ${count} か所` : presetLine || (this.saved ? '保存しました' : '変更はありません');
    this.status.title = plan ? '「保存」で台帳に書きます。保存しないで閉じると、元に戻ります' : '';
    this.status.dataset.kind = plan ? 'dirty' : this.saved ? 'saved' : '';
    this.element.dataset.dirty = String(!!plan);
  }

  private showConfirm() {
    const text = el('span', 'bns-confirm-text', '保存していない変更があります。閉じますか？');
    const saveClose = el('button', 'bns-button bns-primary', '保存して閉じる');
    saveClose.type = 'button';
    saveClose.disabled = !this.base.ready;
    saveClose.addEventListener('click', () => {
      if (this.save()) this.close();
    });
    const discard = el('button', 'bns-button', '保存せず閉じる');
    discard.type = 'button';
    discard.addEventListener('click', () => this.close());
    const back = el('button', 'bns-button', '戻る');
    back.type = 'button';
    back.title = '閉じずに続ける（Esc）';
    back.addEventListener('click', () => this.hideConfirm(true));
    this.confirmBar.replaceChildren(text, saveClose, discard, back);
    this.confirmBar.hidden = false;
    this.foot.hidden = true;
    (saveClose.disabled ? back : saveClose).focus();
  }

  private hideConfirm(focus: boolean) {
    if (this.confirmBar.hidden) return;
    this.confirmBar.hidden = true;
    this.confirmBar.replaceChildren();
    this.foot.hidden = false;
    if (focus) this.closeButton.focus();
  }

  private showTab(tab: BotNestSettingsTab) {
    if (this.tab === tab) return;
    this.tab = tab;
    if (tab === 'presets') this.loadPickSources();
    if (tab === 'send') void this.loadHook();
    this.renderAll(false);
    this.body.scrollTop = 0;
  }

  // 描き直す（restore：キーボードの位置・書いている所・巻き上げた位置を残す。focus：描き直したあと、ここに移る）
  private renderAll(restore: boolean, focus?: string) {
    const active = document.activeElement instanceof HTMLElement && this.element.contains(document.activeElement) ? document.activeElement : null;
    const key = focus ?? (restore ? active?.dataset.key : undefined);
    const selection = restore && !focus && (active instanceof HTMLTextAreaElement || (active instanceof HTMLInputElement && active.type === 'text')) ? [active.selectionStart ?? 0, active.selectionEnd ?? 0] : null;
    const scroll = this.body.scrollTop;
    for (const [tab, b] of this.tabButtons) {
      const on = tab === this.tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    this.body.setAttribute('aria-labelledby', `${this.uid}-tab-${this.tab}`);
    this.preview = this.previewCount = this.instructionsCount = this.thinkingCount = this.sharedNote = null;
    this.body.replaceChildren(
      ...(this.tab === 'seats' ? this.renderSeats() : this.tab === 'roles' ? this.renderRoles() : this.tab === 'askAll' ? this.renderAskAll() : this.tab === 'send' ? this.renderSend() : this.renderPresets()),
    );
    this.renderStatus();
    if (restore) this.body.scrollTop = scroll;
    if (!key) return;
    const target = this.element.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    if (target && !target.matches(':disabled')) {
      target.focus({ preventScroll: !focus });
      if (selection && (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)) target.setSelectionRange(selection[0], selection[1]);
    } else if (active && !active.isConnected) {
      this.tabButtons.get(this.tab)?.focus({ preventScroll: true }); // 押したものが消えた：キーボードの位置を欄の中に残す
    }
  }

  // ---------- 並び ----------

  private renderSeats(): HTMLElement[] {
    const nodes: HTMLElement[] = [
      el('p', 'bns-note', '席は上から時計回りに 席1〜6。前の席から順に座ります。ボットは台帳（盤面のボットのセルと同じ）から選びます。空けても台帳には残ります'),
    ];
    if (this.base.bots.length === 0) nodes.push(el('p', 'bns-empty', '台帳にボットがいません。この欄を閉じて、巣の空いた席の ＋ →「新しいボット」から置いてください'));
    const list = el('ol', 'bns-seats');
    list.setAttribute('aria-label', '巣の席（席1〜6）');
    for (let i = 0; i < MAX_DOCK_BOTS; i++) list.append(this.seatRow(i));
    nodes.push(list);
    return nodes;
  }

  private seatRow(i: number): HTMLElement {
    const n = this.draftDock.length;
    const id = this.draftDock[i];
    const bot = this.bot(id);
    const row = el('li', 'bns-seat-row');
    row.dataset.empty = String(!bot);
    const face = el('span', 'bns-face');
    face.append(this.faceSvg(bot, bot ? toRole(this.draftRoleOf(bot.id)) : null, `seats-${i}`));
    const select = el('select', 'bns-select');
    select.dataset.key = `bns-seat-${i}`;
    // 選べるのは、この席のボットと、どの席にもいないボット（どれを選んでも、ほかの席は動かない）
    const free = this.base.bots.filter((b) => !this.draftDock.includes(b.id) || b.id === bot?.id);
    const label = (b: BotBrief) => (b.agentId ? b.name : `${b.name}（リンクなし）`);
    if (bot) {
      for (const b of free) select.append(option(b.id, label(b)));
      select.value = bot.id;
      select.setAttribute('aria-label', `席${i + 1}のボット（今は「${bot.name}」）`);
      select.title = `席${i + 1}：${bot.name}。ほかのボットを選ぶと入れ替わります（今のボットは台帳に残ります）`;
    } else {
      select.append(option('', i === n && free.length > 0 ? '＋ 選ぶ…' : '（空き）'));
      if (i === n) for (const b of free) select.append(option(b.id, label(b)));
      select.value = '';
      select.disabled = i !== n || select.options.length <= 1;
      select.setAttribute('aria-label', `席${i + 1}：空き`);
      select.title = i === n ? (select.options.length <= 1 ? '台帳のボットは、みんな席にいます' : `席${i + 1}に座るボットを選ぶ`) : `前の席から順に座ります（次は席${n + 1}）`;
    }
    select.addEventListener('change', () => this.pickSeat(i, select.value));
    const up = this.miniButton('↑', `席${i + 1}のボットを前の席へ`, `bns-up-${i}`, !bot || i === 0, () => this.moveSeat(i, i - 1, 'up'));
    const down = this.miniButton('↓', `席${i + 1}のボットを次の席へ`, `bns-down-${i}`, !bot || i >= n - 1, () => this.moveSeat(i, i + 1, 'down'));
    const clear = this.miniButton('×', `席${i + 1}を空ける（台帳には残る）`, `bns-clear-${i}`, !bot, () => this.clearSeat(i));
    row.append(el('span', 'bns-seat-no', `席${i + 1}`), face, select, up, down, clear);
    return row;
  }

  private miniButton(text: string, label: string, key: string, disabled: boolean, run: () => void): HTMLButtonElement {
    const b = el('button', 'bns-mini', text);
    b.type = 'button';
    b.dataset.key = key;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.disabled = disabled;
    b.addEventListener('click', run);
    return b;
  }

  // 席 i に id のボットを座らせる（空いた席なら後ろに足す。座っている席なら入れ替える）
  private pickSeat(i: number, id: string) {
    if (!id || !this.bot(id) || (this.draftDock.includes(id) && this.draftDock[i] !== id)) return;
    if (i < this.draftDock.length) this.draftDock[i] = id;
    else if (this.draftDock.length < MAX_DOCK_BOTS) this.draftDock.push(id);
    this.fixRoleBot();
    this.changed();
    this.renderAll(true, `bns-seat-${Math.min(i, this.draftDock.length - 1)}`);
  }

  private moveSeat(from: number, to: number, dir: 'up' | 'down') {
    if (to < 0 || to >= this.draftDock.length) return;
    const [id] = this.draftDock.splice(from, 1);
    this.draftDock.splice(to, 0, id);
    this.changed();
    // 動かしたボットの行の、同じ向きのボタンへ（端まで来て押せなければ、その行の選ぶ欄へ）
    const canGo = dir === 'up' ? to > 0 : to < this.draftDock.length - 1;
    this.renderAll(true, canGo ? `bns-${dir}-${to}` : `bns-seat-${to}`);
  }

  private clearSeat(i: number) {
    if (i >= this.draftDock.length) return;
    this.draftDock.splice(i, 1);
    this.fixRoleBot();
    this.changed();
    const n = this.draftDock.length;
    this.renderAll(true, i < n ? `bns-clear-${i}` : `bns-seat-${n}`);
  }

  // ---------- 役 ----------

  private renderRoles(): HTMLElement[] {
    return [this.roleViewSwitch(), ...(this.roleView === 'teams' ? this.renderTeams() : this.renderSeatRoles())];
  }

  // 「席の役」「グループ」の切り替え（書きかけはどちらも残す）
  private roleViewSwitch(): HTMLElement {
    const views: { view: RoleView; label: string; hint: string }[] = [
      { view: 'seats', label: '席の役', hint: '巣の席ごとのボットの役' },
      { view: 'teams', label: 'グループ', hint: '5つのグループで、役ごとに受け持つボットとまとめ役（席とは別）' },
    ];
    const chips = el('div', 'bns-chips bns-seg bns-viewswitch');
    chips.setAttribute('role', 'radiogroup');
    chips.setAttribute('aria-label', '役の画面');
    for (const v of views) {
      const key = `bns-view-${v.view}`;
      const chip = this.radio(`${this.uid}-roleview`, v.view, key, this.roleView === v.view, false, `${v.label}：${v.hint}`, () => {
        this.roleView = v.view;
        this.renderAll(false, key);
        this.body.scrollTop = 0;
      });
      chip.title = v.hint;
      chip.append(el('span', 'bns-chip-text', v.label));
      chips.append(chip);
    }
    return chips;
  }

  private renderSeatRoles(): HTMLElement[] {
    this.fixRoleBot();
    const botId = this.roleBot;
    const bot = this.bot(botId);
    if (!botId || !bot) return [el('p', 'bns-empty', '席にボットがいません。「並び」のタブで席にボットを置くと、役を決められます')];
    const seat = this.draftDock.indexOf(botId) + 1;
    const draft = this.draftRoleOf(botId);
    const nodes: HTMLElement[] = [];

    // 席を選ぶ（6つの小さな顔。空いた席は選べない）
    const seats = el('div', 'bns-seatpick');
    seats.setAttribute('role', 'radiogroup');
    seats.setAttribute('aria-label', '役を決める席（← → で移る）');
    for (let i = 0; i < MAX_DOCK_BOTS; i++) {
      const b = this.bot(this.draftDock[i]);
      const role = b ? toRole(this.draftRoleOf(b.id)) : null;
      const text = b ? `席${i + 1}：${b.name}（${role ? `役：${role.name}` : ROLE_NONE_LABEL}）` : `席${i + 1}：空き`;
      const chip = this.radio(`${this.uid}-seat`, String(i), `bns-pick-${i}`, b?.id === botId, !b, text, () => {
        if (!b) return;
        this.roleBot = b.id;
        this.renderAll(true);
      });
      chip.classList.add('bns-seatchip');
      chip.title = text;
      chip.append(this.faceSvg(b, role, `pick-${i}`), el('span', 'bns-seatchip-no', String(i + 1)));
      seats.append(chip);
    }
    nodes.push(seats);

    const who = el('div', 'bns-who');
    who.append(el('span', 'bns-who-seat', `席${seat}`), el('span', 'bns-who-name', `「${bot.name}」の役`));
    who.title = `席${seat}：${bot.name}`;
    nodes.push(who);

    // 役を選ぶ（5つの組＋そのほか。1つの radio の組なので、← → ↑ ↓ で全部を順に移れる）
    const pick = el('div', 'bns-rolepick');
    pick.setAttribute('role', 'radiogroup');
    pick.setAttribute('aria-label', `席${seat}「${bot.name}」の役`);
    const current = draft ? draft.preset : 'none';
    for (const group of BOT_ROLE_GROUPS) {
      const chips = el('div', 'bns-chips');
      for (const preset of group.presets) {
        const def = roleDef(preset);
        if (!def) continue;
        chips.append(this.roleChip(botId, preset, def.name, def.shape, current === preset, `${def.name}：${def.blurb}`));
      }
      const box = el('div', 'bns-rolegroup');
      box.append(el('div', 'bns-rolegroup-label', group.label), chips);
      pick.append(box);
    }
    const others = el('div', 'bns-chips');
    others.append(
      this.roleChip(botId, 'custom', CUSTOM_ROLE.label, draft?.preset === 'custom' ? draft.shape : CUSTOM_ROLE.defaultShape, current === 'custom', `${CUSTOM_ROLE.label}：名前・形・説明の文を自分で決める`),
      this.roleChip(botId, 'none', ROLE_NONE_LABEL, null, current === 'none', `${ROLE_NONE_LABEL}：依頼に役の文を入れない`),
    );
    const otherBox = el('div', 'bns-rolegroup');
    otherBox.append(el('div', 'bns-rolegroup-label', 'そのほか'), others);
    pick.append(otherBox);
    nodes.push(pick);

    const blurb = !draft ? '依頼に役の文を入れません（頼む文だけが届きます）' : draft.preset === 'custom' ? '名前・形・説明の文を自分で決める役です。説明の文が依頼に入ります' : (roleDef(draft.preset)?.blurb ?? '');
    nodes.push(el('p', 'bns-role-blurb', blurb));
    this.sharedNote = el('p', 'bns-note bns-role-shared');
    this.sharedNote.setAttribute('role', 'note');
    nodes.push(this.sharedNote); // 中身は renderPreview が入れる

    if (draft) nodes.push(this.roleDetails(botId, draft));

    // 依頼に入る文のプレビュー（roleInstructions の結果そのもの）
    const previewBox = el('div', 'bns-field');
    const previewTitle = el('div', 'bns-field-label', '依頼に入る文のプレビュー');
    previewTitle.id = `${this.uid}-preview`;
    this.preview = el('div', 'bns-preview');
    this.preview.setAttribute('aria-labelledby', previewTitle.id);
    this.preview.tabIndex = 0; // キーボードでも読める・選べる
    this.preview.dataset.key = 'bns-preview';
    this.previewCount = el('div', 'bns-note');
    previewBox.append(previewTitle, this.preview, this.previewCount);
    nodes.push(previewBox);
    this.renderPreview();
    return nodes;
  }

  // 役の選択肢の1つ（preset：用意した役・custom・none）
  private roleChip(botId: string, preset: BotRolePreset | 'none', label: string, shape: BotRoleShape | null, checked: boolean, hint: string): HTMLElement {
    const chip = this.radio(`${this.uid}-role`, preset, `bns-role-${preset}`, checked, false, hint, () => this.chooseRole(botId, preset));
    chip.title = hint;
    if (shape) chip.append(this.shapeSvg(shape));
    else chip.append(el('span', 'bns-chip-none', '—'));
    chip.append(el('span', 'bns-chip-text', label));
    return chip;
  }

  // 同じ役をほかの席でも使っているときの注記の文（使っていなければ空。重複は禁じない）
  private sharedText(botId: string, role: BotRole | null): string {
    if (!role) return '';
    const others: string[] = [];
    this.draftDock.forEach((id, i) => {
      const b = this.bot(id);
      const r = b && id !== botId ? toRole(this.draftRoleOf(id)) : null;
      if (b && r && sameRoleKind(r, role)) others.push(`席${i + 1}「${b.name}」`);
    });
    return others.length ? `この役は他の席でも使えます（${others.join('・')}も「${role.name}」。巣では顔の下の名前で区別します）` : '';
  }

  private chooseRole(botId: string, preset: BotRolePreset | 'none') {
    const prev = this.draftRoleOf(botId);
    const from = prev ?? this.lastRoles.get(botId) ?? null; // 設定と説明の文は、前の役から引き継ぐ（使わない設定は保存のときに捨てる）
    let next: RoleDraft | null;
    if (preset === 'none') {
      if (prev) this.lastRoles.set(botId, prev);
      next = null;
    } else if (preset === 'custom') {
      next = {
        preset: 'custom',
        name: from?.preset === 'custom' ? from.name : '',
        shape: from?.shape ?? CUSTOM_ROLE.defaultShape,
        options: { ...(from?.options ?? {}) },
        instructions: from?.instructions ?? '',
        thinking: from?.thinking ?? null,
        thinkingText: from?.thinkingText ?? '',
      };
    } else {
      const def = roleDef(preset);
      if (!def) return;
      next = {
        preset: def.preset,
        name: def.name,
        shape: def.shape,
        options: { ...(from?.options ?? {}) },
        instructions: from?.instructions ?? '',
        thinking: from?.thinking ?? null, // 考え方も前の役から引き継ぐ
        thinkingText: from?.thinkingText ?? '',
      };
    }
    this.draftRoles.set(botId, next);
    this.changed();
    this.renderAll(true, `bns-role-${preset}`);
  }

  // 選んだ役の細かい設定（自分で作る役は名前と形も）と説明の文
  private roleDetails(botId: string, draft: RoleDraft): HTMLElement {
    const box = el('div', 'bns-opts');
    if (draft.preset === 'custom') {
      const name = el('input', 'bns-input');
      name.type = 'text';
      name.maxLength = ROLE_NAME_MAX;
      name.value = draft.name;
      name.placeholder = CUSTOM_ROLE_DEFAULT_NAME;
      name.spellcheck = false;
      name.dataset.key = 'bns-custom-name';
      let composing = false;
      name.addEventListener('compositionstart', () => (composing = true));
      name.addEventListener('compositionend', () => {
        composing = false;
        name.dispatchEvent(new Event('input'));
      });
      name.addEventListener('input', () => {
        stripField(name, CONTROL_LINE, composing);
        const d = this.editableRole(botId);
        if (!d) return;
        d.name = name.value;
        this.renderPreview();
        this.changed();
      });
      box.append(this.field(`役の名前（${ROLE_NAME_MAX} 字まで。空なら「${CUSTOM_ROLE_DEFAULT_NAME}」）`, name));

      const shapes = el('div', 'bns-chips bns-shapes');
      shapes.setAttribute('role', 'radiogroup');
      shapes.setAttribute('aria-label', '形');
      for (const s of BOT_ROLE_SHAPES) {
        const chip = this.radio(`${this.uid}-shape`, s.shape, `bns-shape-${s.shape}`, draft.shape === s.shape, false, `形：${s.label}`, () => {
          const d = this.editableRole(botId);
          if (!d) return;
          d.shape = s.shape;
          this.changed();
          this.renderAll(true, `bns-shape-${s.shape}`);
        });
        chip.classList.add('bns-shapechip');
        chip.title = s.label;
        chip.append(this.shapeSvg(s.shape));
        shapes.append(chip);
      }
      box.append(this.labeled('形（席の顔）', shapes));
    }

    for (const def of roleOptionDefs(draft.preset)) box.append(this.optionControl(botId, draft, def));
    box.append(this.thinkingControl(botId, draft));

    // 説明の文（自分で作る役は役の中身。用意した役では足す文。どちらも依頼に入る）
    const text = el('textarea', 'bns-textarea');
    text.maxLength = ROLE_INSTRUCTIONS_MAX;
    text.rows = 3;
    text.value = draft.instructions;
    text.placeholder = draft.preset === 'custom' ? '例：反論を先に1つ出してから、答えをまとめてください' : '（任意）この役に足したいこと';
    text.dataset.key = 'bns-instructions';
    let composing = false;
    text.addEventListener('compositionstart', () => (composing = true));
    text.addEventListener('compositionend', () => {
      composing = false;
      text.dispatchEvent(new Event('input'));
    });
    text.addEventListener('input', () => {
      stripField(text, CONTROL_TEXT, composing);
      const d = this.editableRole(botId);
      if (!d) return;
      d.instructions = text.value;
      this.renderPreview();
      this.changed();
    });
    this.instructionsCount = el('div', 'bns-count');
    const textField = this.field(draft.preset === 'custom' ? `役の説明の文（${ROLE_INSTRUCTIONS_MAX} 字まで。依頼に入ります）` : `説明の文を足す（任意・${ROLE_INSTRUCTIONS_MAX} 字まで。依頼に入ります）`, text);
    textField.append(this.instructionsCount);
    box.append(textField);
    return box;
  }

  // 細かい設定の1つ（choice：並んだ札から1つ　flag：はい／いいえ　text：1行）。既定の値にしたときは、台帳に書かない（無い ＝ 既定）
  private optionControl(botId: string, draft: RoleDraft, def: BotRoleOptionDef): HTMLElement {
    const set = (value: string | number | boolean | undefined) => {
      const d = this.editableRole(botId);
      if (!d) return;
      const options = { ...d.options } as Record<string, unknown>;
      if (value === undefined) delete options[def.key];
      else options[def.key] = value;
      d.options = options as BotRoleOptions;
      this.changed();
    };
    const value = draft.options[def.key];
    if (def.kind === 'choice') {
      const now = def.choices.some((c) => c.value === value) ? value : def.default;
      const chips = el('div', 'bns-chips bns-seg');
      chips.setAttribute('role', 'radiogroup');
      chips.setAttribute('aria-label', def.label);
      for (const c of def.choices) {
        const key = `bns-opt-${def.key}-${c.value}`;
        const chip = this.radio(`${this.uid}-opt-${def.key}`, String(c.value), key, c.value === now, false, `${def.label}：${c.label}`, () => {
          set(c.value === def.default ? undefined : c.value);
          this.renderAll(true, key);
        });
        chip.append(el('span', 'bns-chip-text', c.label));
        chips.append(chip);
      }
      return this.labeled(def.label, chips);
    }
    if (def.kind === 'flag') {
      const box = el('input');
      box.type = 'checkbox';
      box.checked = typeof value === 'boolean' ? value : def.default;
      box.dataset.key = `bns-opt-${def.key}`;
      box.addEventListener('change', () => {
        set(box.checked === def.default ? undefined : box.checked);
        this.renderPreview();
      });
      const label = el('label', 'bns-check');
      label.append(box, el('span', '', def.label));
      return label;
    }
    const input = el('input', 'bns-input');
    input.type = 'text';
    input.maxLength = ROLE_OPTION_TEXT_MAX;
    input.value = typeof value === 'string' ? value : '';
    input.placeholder = def.placeholder;
    input.dataset.key = `bns-opt-${def.key}`;
    let composing = false;
    input.addEventListener('compositionstart', () => (composing = true));
    input.addEventListener('compositionend', () => {
      composing = false;
      input.dispatchEvent(new Event('input'));
    });
    input.addEventListener('input', () => {
      stripField(input, CONTROL_LINE, composing);
      set(input.value.trim() ? input.value : undefined);
      this.renderPreview();
    });
    return this.labeled(def.label, input);
  }

  // 考え方の段階（おまかせ＋5つの札。「自分で」のときだけ 1行の文を書く欄。おまかせは台帳に書かない）
  private thinkingControl(botId: string, draft: RoleDraft): HTMLElement {
    const choices: { value: BotThinkingLevel | null; label: string; hint: string }[] = [
      { value: null, label: THINKING_AUTO_LABEL, hint: '依頼に考え方の行を入れない' },
      ...BOT_THINKING_LEVELS.map((l) => ({ value: l.level, label: l.label, hint: l.hint })),
    ];
    const chips = el('div', 'bns-chips bns-seg');
    chips.setAttribute('role', 'radiogroup');
    chips.setAttribute('aria-label', '考え方');
    for (const c of choices) {
      const key = `bns-think-${c.value ?? 'auto'}`;
      const chip = this.radio(`${this.uid}-think`, c.value ?? 'auto', key, draft.thinking === c.value, false, `考え方：${c.label}。${c.hint}`, () => {
        const d = this.editableRole(botId);
        if (!d) return;
        d.thinking = c.value;
        this.changed();
        this.renderAll(true, key);
      });
      chip.title = c.hint;
      chip.append(el('span', 'bns-chip-text', c.label));
      chips.append(chip);
    }
    const box = this.labeled('考え方', chips);
    const now = choices.find((c) => c.value === draft.thinking) ?? choices[0];
    if (draft.thinking !== 'custom') {
      box.append(el('span', 'bns-note', `${now.label}：${now.hint}`)); // 選んだ段階の説明（自分では、下の欄の見出しが説明）
      return box;
    }

    // 自分で：1行・THINKING_TEXT_MAX 字まで（改行・制御文字は入れない。空のままなら、おまかせとして保存）
    const input = el('input', 'bns-input');
    input.type = 'text';
    input.maxLength = THINKING_TEXT_MAX;
    input.value = draft.thinkingText;
    input.placeholder = '例：前提を1つずつ疑ってから、結論を1つにしぼって';
    input.spellcheck = false;
    input.dataset.key = 'bns-think-text';
    let composing = false;
    input.addEventListener('compositionstart', () => (composing = true));
    input.addEventListener('compositionend', () => {
      composing = false;
      input.dispatchEvent(new Event('input'));
    });
    input.addEventListener('input', () => {
      stripField(input, CONTROL_LINE, composing);
      const d = this.editableRole(botId);
      if (!d) return;
      d.thinkingText = input.value;
      this.renderPreview();
      this.changed();
    });
    this.thinkingCount = el('div', 'bns-count');
    const field = this.field(`自分で書く考え方（1行・${THINKING_TEXT_MAX} 字まで。空なら「${THINKING_AUTO_LABEL}」）`, input);
    field.append(this.thinkingCount);
    box.append(field);
    return box;
  }

  // プレビューと字数（文を書くたびに、ここだけ直す）
  private renderPreview() {
    const botId = this.roleBot;
    if (!botId) return;
    const draft = this.draftRoleOf(botId);
    if (this.instructionsCount) {
      const n = charCount(draft?.instructions ?? '');
      this.instructionsCount.textContent = `${n} / ${ROLE_INSTRUCTIONS_MAX} 字`;
      this.instructionsCount.dataset.full = String(n >= ROLE_INSTRUCTIONS_MAX);
    }
    if (this.thinkingCount) {
      const n = charCount(draft?.thinkingText ?? '');
      this.thinkingCount.textContent = `${n} / ${THINKING_TEXT_MAX} 字`;
      this.thinkingCount.dataset.full = String(n >= THINKING_TEXT_MAX);
    }
    const role = toRole(draft);
    if (this.sharedNote) {
      this.sharedNote.textContent = this.sharedText(botId, role);
      this.sharedNote.hidden = !this.sharedNote.textContent;
    }
    if (!this.preview || !this.previewCount) return;
    const seat = this.draftDock.indexOf(botId) + 1;
    const text = roleInstructions(role, seat > 0 ? seat : undefined);
    this.preview.dataset.empty = String(!text);
    this.preview.textContent = text || `（${ROLE_NONE_LABEL}：依頼に役の文は入りません）`;
    this.previewCount.textContent = text
      ? `${charCount(text)} / ${ROLE_TEXT_MAX} 字。依頼では、このあとに「${ROLE_SEPARATOR}」の行と頼む文が続きます（役を依頼に入れるのは S3.4 から）`
      : '依頼には頼む文だけが入ります';
  }

  // ---------- グループ ----------

  private renderTeams(): HTMLElement[] {
    const nodes: HTMLElement[] = [
      el(
        'p',
        'bns-note',
        'グループは巣の6つの席とは別に持ちます。ここで選んでも、席の並びと各ボットの「席の役」は変わりません。1体をいくつかの役・いくつかのグループに選んでもかまいません。まとめ役は、みんなの返事を受け取って1つの答えにするボットです（置かなくてもよい）',
      ),
    ];
    if (this.base.teams === null) {
      nodes.push(el('p', 'bns-empty', 'グループを読み込んでいます'));
      return nodes;
    }
    if (this.base.bots.length === 0) {
      nodes.push(el('p', 'bns-empty', '台帳にボットがいません。この欄を閉じて、巣の空いた席の ＋ →「新しいボット」から置いてください'));
      return nodes;
    }
    for (const g of BOT_ROLE_GROUPS) nodes.push(this.teamBox(g.group, g.label, g.presets, this.draftTeams[g.group]));
    nodes.push(el('p', 'bns-note', '巣の下の「グループに頼む」から、ここで選んだボットに同じ問いを頼めます。まとめ役がいる組は、受け取り箱の組のカードから「まとめ役に渡す」が使えます'));
    return nodes;
  }

  private teamBox(group: BotRoleGroup, label: string, presets: readonly BotTeamPreset[], team: BotTeam | undefined): HTMLElement {
    const box = el('div', 'bns-team');
    box.setAttribute('role', 'group');
    const head = el('div', 'bns-team-head');
    head.id = `${this.uid}-team-${group}`;
    box.setAttribute('aria-labelledby', head.id);
    const n = team?.members.length ?? 0;
    head.append(el('span', 'bns-team-name', `グループ：${label}`), el('span', 'bns-team-count', n ? `${n}体` : 'まだだれもいません'));
    box.append(head);
    for (const preset of presets) {
      const def = roleDef(preset);
      if (!def) continue;
      const now = team?.members.find((m) => m.preset === preset)?.botId ?? '';
      const select = this.teamSelect(`bns-team-${group}-${preset}`, '選ばない', now, (botId) => this.setTeamMember(group, preset, botId));
      select.title = `${def.name}：${def.blurb}`;
      box.append(this.field(`${def.name}（${def.blurb}）`, select));
    }
    const lead = this.teamSelect(`bns-team-${group}-lead`, '置かない', team?.lead ?? '', (botId) => this.setTeamLead(group, botId));
    lead.title = 'みんなの返事を受け取って、1つの答えにするボット（役のボットと同じでもよい）';
    const leadField = this.field('まとめ役', lead);
    leadField.classList.add('bns-team-lead');
    box.append(leadField);
    return box;
  }

  // 台帳のボットから1体を選ぶ欄（none：選ばないときの札）
  private teamSelect(key: string, none: string, value: string, pick: (botId: string) => void): HTMLSelectElement {
    const select = el('select', 'bns-select');
    select.dataset.key = key;
    select.append(option('', none));
    for (const b of this.base.bots) select.append(option(b.id, b.agentId ? b.name : `${b.name}（リンクなし）`));
    select.value = value && this.bot(value) ? value : '';
    select.disabled = !this.base.ready;
    select.addEventListener('change', () => {
      pick(select.value);
      this.changed();
      this.renderAll(true, key);
    });
    return select;
  }

  private setTeamMember(group: BotRoleGroup, preset: BotTeamPreset, botId: string) {
    const team = this.draftTeams[group];
    const members = (team?.members ?? []).filter((m) => m.preset !== preset);
    if (botId) members.push({ preset, botId });
    this.draftTeams = this.cleanTeams({ ...this.draftTeams, [group]: { ...team, members } });
  }

  private setTeamLead(group: BotRoleGroup, botId: string) {
    const team: BotTeam = { members: [...(this.draftTeams[group]?.members ?? [])] };
    if (botId) team.lead = botId;
    this.draftTeams = this.cleanTeams({ ...this.draftTeams, [group]: team });
  }

  // ---------- みんなに聞く ----------

  private renderAskAll(): HTMLElement[] {
    const n = this.draftNest;
    const nodes: HTMLElement[] = [];
    const ways = el('div', 'bns-ways');
    ways.setAttribute('role', 'radiogroup');
    ways.setAttribute('aria-label', '「みんなに聞く」の送り方');
    ways.append(
      this.wayChoice('each', 'A　1体ずつ順に案内（既定）', '同じ問いで席の数だけ依頼を作り、1体ずつ「コピーしてアプリを開く」を案内します。貼るのは席の数だけ。返事はそれぞれの役で届きます（おすすめ）', n.askAll !== 'lead'),
      this.wayChoice('lead', 'B　代表にまとめて頼む', '代表の1体に、全員の役を並べた依頼を1つ送ります。貼るのは1回（1体がすべての役を演じます）', n.askAll === 'lead'),
    );
    nodes.push(this.labeled('送り方', ways));

    // 代表（B のとき）。席のボットから。決めなければ席1
    const lead = el('select', 'bns-select');
    lead.dataset.key = 'bns-lead';
    const first = this.bot(this.draftDock[0]);
    lead.append(option('', first ? `決めない（席1の「${first.name}」）` : '決めない（席1のボット）'));
    this.draftDock.forEach((id, i) => {
      const b = this.bot(id);
      if (b) lead.append(option(id, `席${i + 1}：${b.name}`));
    });
    const away = n.lead && !this.draftDock.includes(n.lead) ? this.bot(n.lead) : undefined;
    if (away) lead.append(option(away.id, `${away.name}（席にいない）`));
    lead.value = n.lead && this.bot(n.lead) ? n.lead : '';
    lead.disabled = n.askAll !== 'lead';
    lead.title = lead.disabled ? '「B 代表にまとめて頼む」のときに選べます' : '代表のボット（このボットに1つの依頼を送ります）';
    lead.addEventListener('change', () => {
      const next: BotNest = { ...this.draftNest };
      if (lead.value) next.lead = lead.value;
      else delete next.lead;
      this.draftNest = next;
      this.changed();
    });
    nodes.push(this.field('B の代表のボット', lead));

    // 合体 Grok の演出（既定オン）
    const merge = el('input');
    merge.type = 'checkbox';
    merge.checked = n.merge !== 'off';
    merge.dataset.key = 'bns-merge';
    merge.addEventListener('change', () => {
      this.draftNest = { ...this.draftNest, merge: merge.checked ? 'effect' : 'off' };
      this.changed();
    });
    const mergeLabel = el('label', 'bns-check bns-merge');
    const mergeText = el('span', 'bns-merge-text');
    mergeText.append(
      el('span', 'bns-way-title', '合体 Grok の演出（既定オン）'),
      el('span', 'bns-way-text', '「みんなに聞く」の前に「許可しますか？」と聞き、許可すると巣が「合体 Grok」の見た目になります。「今回はしない」なら演出なしで同じ依頼を送ります。演出だけです（SuperGrok Heavy の機能とはまだつながっていません）'),
    );
    mergeLabel.append(merge, mergeText);
    nodes.push(mergeLabel);

    // 月の窓に Grok Visions を出す（S3.7b。既定オン。オフでも残すのは続ける）
    const visions = el('input');
    visions.type = 'checkbox';
    visions.checked = n.visions !== 'off';
    visions.dataset.key = 'bns-visions';
    visions.addEventListener('change', () => {
      this.draftNest = { ...this.draftNest, visions: visions.checked ? 'on' : 'off' };
      this.changed();
    });
    const visionsLabel = el('label', 'bns-check bns-merge bns-visions');
    const visionsText = el('span', 'bns-merge-text');
    visionsText.append(
      el('span', 'bns-way-title', '月の窓に Visions を出す（既定オン）'),
      el('span', 'bns-way-text', 'ボットが自分で「有意義な発見」と判断して返事の最後に足した「## Vision」を、右上の月の窓に「Grok Visions」として映します。オフでも残すのは続けます（ボットの欄の「Vision」札から、いつでも1件ずつ消せます）'),
    );
    visionsLabel.append(visions, visionsText);
    nodes.push(visionsLabel);

    // 依頼の最初の40字を一覧に出す（S3.8。既定オフ。頼む文は残さない決まりなので、オンにしたときだけ pending.json に 40 字を残す）
    const headline = el('input');
    headline.type = 'checkbox';
    headline.checked = n.headline === 'on';
    headline.dataset.key = 'bns-headline';
    headline.addEventListener('change', () => {
      this.draftNest = { ...this.draftNest, headline: headline.checked ? 'on' : 'off' };
      this.changed();
    });
    const headlineLabel = el('label', 'bns-check bns-merge bns-headline');
    const headlineText = el('span', 'bns-merge-text');
    headlineText.append(
      el('span', 'bns-way-title', '依頼の最初の40字を一覧に出す（既定オフ）'),
      el('span', 'bns-way-text', 'オンにすると、これから作る依頼の頼む文の最初の 40 字だけを記録（pending.json）に残し、受け取り箱の「Grok への依頼」の一覧に出します。オフに戻すと、残した 40 字も消します（頼む文そのものは、どちらでも残しません）'),
    );
    headlineLabel.append(headline, headlineText);
    nodes.push(headlineLabel);

    // 回答カードの飾り（S3.10。既定オフ。見た目だけ：「Grok!」の札と星空の背景。文字の後ろには暗い下地を敷く）
    const cosmic = el('input');
    cosmic.type = 'checkbox';
    cosmic.checked = n.cosmic === 'on';
    cosmic.dataset.key = 'bns-cosmic';
    cosmic.addEventListener('change', () => {
      this.draftNest = { ...this.draftNest, cosmic: cosmic.checked ? 'on' : 'off' };
      this.changed();
    });
    const cosmicLabel = el('label', 'bns-check bns-merge bns-cosmic');
    const cosmicText = el('span', 'bns-merge-text');
    cosmicText.append(
      el('span', 'bns-way-title', '回答カードに「Grok!」の札と星空（既定オフ）'),
      el('span', 'bns-way-text', '受け取り箱の回答カード（確かめの済んだ返事）に「Grok!」の札と、星空の背景を付けます。飾りだけです（中身・ボタンは同じ。文字の後ろには暗い下地を敷きます。動きはありません）'),
    );
    cosmicLabel.append(cosmic, cosmicText);
    nodes.push(cosmicLabel);
    nodes.push(el('p', 'bns-note', 'B の代表が台帳から消えている・リンクが無いときは、A（1体ずつ）で聞きます（小窓で知らせます）'));

    // 送ったあと（R8・D17・Q5）：知らせの期限と、「貼りましたか？」を聞くまでの秒
    nodes.push(el('div', 'bns-section-title', '送ったあと'));
    nodes.push(
      this.field(
        `知らせの期限（時間。既定 ${NOTICE_HOURS.default}）`,
        this.numberInput('bns-notice-hours', n.noticeHours, NOTICE_HOURS, '過ぎても返事が無い依頼は、受け取り箱の伝票レールと巣の席で赤くなります', (v) => ({ noticeHours: v })),
      ),
    );
    nodes.push(
      this.field(
        `「貼りましたか？」を聞くまで（秒。既定 ${ASK_PASTED_SEC.default}）`,
        this.numberInput('bns-ask-pasted', n.askPastedSec, ASK_PASTED_SEC, 'コピーしてアプリを開き、アプリから戻ってからこの秒数のあと、クリップボードに依頼が残っていれば 1 回だけ聞きます', (v) => ({ askPastedSec: v })),
      ),
    );

    // 画像の貼り方（R7d・D16・Q2）：2 回貼る（既定）／画像と文を一つの貼り付けで（試し）。受けるかは自動では決めない
    nodes.push(el('div', 'bns-section-title', '画像の貼り方'));
    nodes.push(
      this.pasteChoice('two', '2 回貼る（既定）', '六角スクショ・クリップボードの画像を付けた依頼は、① 画像 → ② 文の順に、2 回に分けて貼ります', n.pasteMode !== 'html'),
      this.pasteChoice(
        'html',
        '画像と文を一つの貼り付けで（試し）',
        '画像と依頼の文を 1 回の貼り付けにまとめます（HTML に画像を埋めます）。Grok Bot アプリが受けないと、文だけが貼られて画像は落ちます。受けたかはブラウザからは分からないので、貼ったあとチャットで確かめてください（落ちたら「貼りましたか？」の札か、ここで 2 回貼りに戻せます）',
        n.pasteMode === 'html',
      ),
    );
    return nodes;
  }

  // 画像の貼り方の選び（R7d）。押したら書きかけの nest に入れる（「保存」で台帳へ）
  private pasteChoice(value: 'two' | 'html', title: string, text: string, checked: boolean): HTMLElement {
    const label = el('label', 'bns-way');
    const input = el('input');
    input.type = 'radio';
    input.name = `${this.uid}-paste`;
    input.value = value;
    input.checked = checked;
    input.dataset.key = `bns-paste-${value}`;
    input.addEventListener('change', () => {
      if (!input.checked) return;
      this.draftNest = { ...this.draftNest, pasteMode: value };
      this.changed();
    });
    const words = el('span', 'bns-way-words');
    words.append(el('span', 'bns-way-title', title), el('span', 'bns-way-text', text));
    label.append(input, words);
    return label;
  }

  // 整数の入力欄（範囲の外・数でないものは、離れたときに範囲へ戻す）
  private numberInput(key: string, value: number, range: { min: number; max: number; default: number }, hint: string, patch: (v: number) => Partial<BotNest>): HTMLInputElement {
    const input = el('input', 'bns-input bns-number');
    input.type = 'number';
    input.min = String(range.min);
    input.max = String(range.max);
    input.step = '1';
    input.value = String(value);
    input.dataset.key = key;
    input.title = `${hint}（${range.min}〜${range.max}）`;
    input.addEventListener('change', () => {
      const v = clampInt(Number(input.value), range);
      input.value = String(v);
      this.draftNest = { ...this.draftNest, ...patch(v) };
      this.changed();
    });
    return input;
  }

  private wayChoice(value: 'each' | 'lead', title: string, text: string, checked: boolean): HTMLElement {
    const label = el('label', 'bns-way');
    const input = el('input');
    input.type = 'radio';
    input.name = `${this.uid}-askall`;
    input.value = value;
    input.checked = checked;
    input.dataset.key = `bns-way-${value}`;
    input.addEventListener('change', () => {
      if (!input.checked) return;
      this.draftNest = { ...this.draftNest, askAll: value };
      this.changed();
      this.renderAll(true, `bns-way-${value}`);
    });
    const words = el('span', 'bns-way-words');
    words.append(el('span', 'bns-way-title', title), el('span', 'bns-way-text', text));
    label.append(input, words);
    return label;
  }

  // ---------- 定型（R4b・D10・Q7） ----------

  // 定型のタブの見せ方と書きかけを捨てる（閉じたとき）
  private resetPresetView() {
    this.closePresetEditor();
    this.vaultQuery = '';
    this.newPresetText = '';
    this.newPresetLife = 'forever';
    this.presetNote = '';
    this.reviewOpen = false;
    this.axisNote = false;
    this.pickSources = null;
    this.pickTexts.clear();
  }

  private closePresetEditor() {
    this.presetPick = null;
    this.presetEditText = null;
    this.presetDelete = null;
  }

  // 拾う候補を集める（タブを開いたとき・新しい依頼の頭が届いたとき。集め終えたら描き直す）。keep：集め直すあいだ、今の候補を出したまま
  private loadPickSources(keep = false) {
    const pick = this.host.pickSources;
    if (!pick) return;
    if (!keep) this.pickSources = null;
    const done = (list: PresetPickSource[]) => {
      if (!this.isOpen) return;
      this.pickSources = list;
      if (this.tab === 'presets') this.renderAll(true);
    };
    void pick().then(done, () => done([]));
  }

  private presetsCopy(): BotPresets | null {
    return this.base.presets ? structuredClone(this.base.presets) : null;
  }

  // 変えた棚を、すぐ左へ（巣が写しを直してから命令 setPresets。描き直しは巣が呼ぶ update で）。note：下の 1 行。focus：描き直したあとのキーボードの位置
  private commitPresets(next: BotPresets, note: string, focus?: string) {
    if (!this.host.savePresets) return;
    this.presetNote = note;
    this.presetDelete = null;
    this.host.savePresets(next);
    this.renderAll(true, focus);
  }

  private say(note: string) {
    this.presetNote = note;
    this.renderStatus();
  }

  // ---------- 送り方（依頼の小窓 v2・R11・D20） ----------

  // webhook「そのまま送る」の宛先と鍵。値は C++ の DPAPI（bot-hook.bin）にだけしまい、ここには「ある／ない」だけを出す
  private renderSend(): HTMLElement[] {
    const nodes: HTMLElement[] = [
      el('div', 'bns-section-title', '中継へ直接送る（webhook）'),
      el('p', 'bns-note', '依頼の小窓の「そのまま送る（webhook）」で、依頼の JSON を中継の受け口へ直接送ります。貼る手は要りません。返事は今までどおり受け取り箱に届きます。'),
      el('p', 'bns-note', '宛先の URL と鍵は、Windows の暗号化（DPAPI）でこの PC のこのユーザーにだけしまいます。画面・記録・依頼文には出しません。ここに出るのは「ある／ない」だけです。'),
    ];
    const state = el('p', `bns-hook-state${this.hookHas ? ' on' : ''}`, this.hookHas === null ? '宛先と鍵：確かめています…' : this.hookHas ? '宛先と鍵：あり（しまってあります）' : '宛先と鍵：なし（「そのまま送る」は押せません）');
    state.setAttribute('role', 'status');
    nodes.push(state);
    if (!this.host.hook) {
      nodes.push(el('p', 'bns-empty', 'この画面からは、宛先と鍵をしまえません'));
      return nodes;
    }
    const url = el('input', 'bns-input');
    url.type = 'url';
    url.autocomplete = 'off';
    url.spellcheck = false;
    url.placeholder = 'https://…（中継の受け口）';
    url.dataset.key = 'bns-hook-url';
    const key = el('input', 'bns-input');
    key.type = 'password';
    key.autocomplete = 'new-password';
    key.spellcheck = false;
    key.placeholder = 'しまったら、欄は空になります';
    key.dataset.key = 'bns-hook-key';
    nodes.push(this.field('中継の受け口の URL（https:// から）', url), this.field('鍵（Bearer。空白なしの英数字・記号で 1,024 字まで）', key));
    const row = el('div', 'bns-hook-row');
    const save = el('button', 'bns-button bns-primary', 'しまう');
    save.type = 'button';
    save.dataset.key = 'bns-hook-save';
    save.disabled = this.hookBusy;
    save.title = 'URL と鍵を Windows の暗号化でしまい、欄を空にします（前にしまったものは置き換えます）';
    save.addEventListener('click', () => void this.saveHook(url, key));
    const remove = el('button', 'bns-button', '鍵を消す');
    remove.type = 'button';
    remove.dataset.key = 'bns-hook-remove';
    remove.disabled = this.hookBusy || this.hookHas !== true;
    remove.title = 'しまってある宛先と鍵を消します（「そのまま送る」は押せなくなります）';
    remove.addEventListener('click', () => void this.removeHook());
    row.append(save, remove);
    nodes.push(row);
    nodes.push(el('p', 'bns-note', '中継の側に受け口（POST・Bearer の鍵）ができるまでは、送っても届きません。届かなかった依頼は、同じ依頼のまま「コピーしてアプリを開く」に切り替えられます。'));
    return nodes;
  }

  private async loadHook() {
    if (!this.host.hook) return;
    const has = await this.host.hook.state();
    if (has !== null) this.hookHas = has;
    if (this.isOpen && this.tab === 'send') this.renderAll(true);
  }

  // しまう：欄の値は渡したらすぐ空にする（形が違っても入れ直してもらう）
  private async saveHook(urlInput: HTMLInputElement, keyInput: HTMLInputElement) {
    const hook = this.host.hook;
    if (!hook || this.hookBusy) return;
    const url = urlInput.value.trim();
    const key = keyInput.value.trim();
    urlInput.value = '';
    keyInput.value = '';
    if (!url || !key) {
      this.hookNote = 'URL と鍵の両方を入れてから「しまう」を押してください';
      this.renderAll(true, 'bns-hook-url');
      return;
    }
    this.hookBusy = true;
    this.hookNote = 'しまっています…';
    this.renderAll(true);
    const result = await hook.save(url, key);
    this.hookBusy = false;
    if (result) this.hookHas = result.has;
    const errors: Record<string, string> = {
      badUrl: 'しまえませんでした：https:// から始まる URL を入れてください（ユーザー名・パスワード入りの URL は使えません）',
      badKey: 'しまえませんでした：鍵は空白・改行の無い英数字・記号で、1,024 字までです',
      save: 'しまえませんでした（暗号化したファイルを書けませんでした）。前の設定のままです',
    };
    this.hookNote = !result ? 'ブラウザの本体から答えがありませんでした。もう一度どうぞ' : result.error ? (errors[result.error] ?? 'しまえませんでした') : 'しまいました（欄は空にしました。値は画面に出しません）';
    this.renderAll(true, 'bns-hook-save');
  }

  private async removeHook() {
    const hook = this.host.hook;
    if (!hook || this.hookBusy) return;
    this.hookBusy = true;
    this.renderAll(true);
    const has = await hook.remove();
    this.hookBusy = false;
    if (has !== null) this.hookHas = has;
    this.hookNote = has === null ? 'ブラウザの本体から答えがありませんでした。もう一度どうぞ' : has ? '消せませんでした' : '宛先と鍵を消しました';
    this.renderAll(true, 'bns-hook-save');
  }

  private renderPresets(): HTMLElement[] {
    const presets = this.base.presets;
    if (!presets) return [el('p', 'bns-empty', '定型の棚を読み込んでいます')];
    const now = Date.now();
    const nodes: HTMLElement[] = [
      el('p', 'bns-note', '依頼の小窓の定型です。押したときにすぐ書きます（「保存」は要りません）。手元の 6 は組ごと、棚と蔵は全部の組で一つ。消すのは人だけです'),
    ];
    const swap = this.swapBanner(presets);
    if (swap) nodes.push(swap);
    const review = this.reviewBanner(presets, now);
    if (review) nodes.push(review);
    nodes.push(...this.axisRows(), ...this.handRows(presets, now), ...this.shelfRows(presets, now), ...this.vaultRows(presets, now));
    nodes.push(...this.newPresetRows(presets), ...this.reviewRows(presets, now), ...this.pickRows(presets));
    return nodes;
  }

  private presetButton(text: string, key: string, title: string, run: () => void, primary = false): HTMLButtonElement {
    const b = el('button', primary ? 'bns-button bns-primary bns-pre-btn' : 'bns-button bns-pre-btn', text);
    b.type = 'button';
    b.dataset.key = key;
    b.title = title;
    b.disabled = !this.host.savePresets;
    b.addEventListener('click', run);
    return b;
  }

  // 声かけ①：棚から 3 回使った定型を、手元の一番使っていない定型と入れ替えるか（名指しで一度だけ。答えると swapAsked）
  private swapBanner(presets: BotPresets): HTMLElement | null {
    const ask = presetSwapAsk(presets);
    if (!ask) return null;
    const box = el('div', 'bns-pre-ask');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', '入れ替えの声かけ');
    const head = `棚の${quoteText(ask.preset.text)}を ${PRESET_SWAP_USES} 回使いました。`;
    const text = ask.with
      ? `${head}組「${ask.set.name}」の手元の、一番使っていない${quoteText(ask.with.text)}と入れ替えますか？`
      : `${head}組「${ask.set.name}」の手元に空きがあります。手元に上げますか？`;
    const yesHint = ask.with ? `手元の${quoteText(ask.with.text)}は棚へ下がります（消えません）` : '手元の終わりに入ります';
    const yes = this.presetButton(
      ask.with ? '入れ替える' : '手元に上げる',
      'bns-pre-swap-yes',
      yesHint,
      () => {
        const next = this.presetsCopy();
        if (!next || !swapPreset(next, ask.preset.id, ask.set.id, ask.with?.id, Date.now())) return;
        this.presetSetId = ask.set.id;
        this.commitPresets(next, ask.with ? `入れ替えました：${quoteText(ask.preset.text)}が手元、${quoteText(ask.with.text)}が棚に` : `${quoteText(ask.preset.text)}を手元に上げました`, `bns-pre-${ask.preset.id}`);
      },
      true,
    );
    const no = this.presetButton('このまま', 'bns-pre-swap-no', 'このまま棚に置きます（この定型については、もう聞きません）', () => {
      const next = this.presetsCopy();
      const p = this.findPreset(next, ask.preset.id);
      if (!next || !p) return;
      p.swapAsked = true;
      this.commitPresets(next, `${quoteText(p.text)}は棚のままにしました（もう聞きません）`);
    });
    box.append(el('span', 'bns-pre-ask-text', text), yes, no);
    return box;
  }

  // 声かけ②：棚卸しの時期（言い回しの近い定型があり、月に一度か、30 を超えたとき一度だけ）
  private reviewBanner(presets: BotPresets, now: number): HTMLElement | null {
    const due = reviewDue(presets, now);
    if (!due || this.reviewOpen) return null;
    const box = el('div', 'bns-pre-ask');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', '棚卸しの声かけ');
    const why = due === 'over30' ? `定型が ${PRESET_REVIEW_COUNT} を超えました` : '月に一度の棚卸しの時期です';
    const look = this.presetButton('並べて見る', 'bns-pre-review-open', '言い回しの近い定型を並べます（下の「棚卸し」）', () => this.openReview(true), true);
    const later = this.presetButton('あとで', 'bns-pre-review-later', '次は来月（30 日後）に声をかけます', () => {
      const next = this.presetsCopy();
      if (!next) return;
      markReviewed(next);
      this.commitPresets(next, '棚卸しは来月にしました');
    });
    box.append(el('span', 'bns-pre-ask-text', `${why}。言い回しの近い定型が ${similarGroups(presets).length} 組あります`), look, later);
    return box;
  }

  // 棚卸しを並べる（声かけの時期なら、声をかけた時刻を覚える）
  private openReview(fromBanner: boolean) {
    this.reviewOpen = true;
    const presets = this.base.presets;
    const next = presets && reviewDue(presets, Date.now()) ? this.presetsCopy() : null;
    if (next) {
      markReviewed(next);
      this.commitPresets(next, '言い回しの近い定型を並べました', 'bns-pre-review-close');
    } else {
      this.renderAll(true, 'bns-pre-review-close');
    }
    if (fromBanner) this.element.querySelector<HTMLElement>('[data-key="bns-pre-review-close"]')?.scrollIntoView({ block: 'nearest' });
  }

  // 組を替える軸（Q7：入口だけ。サイト・子は選べるが「次の版で」と出して、入口のまま）
  private axisRows(): HTMLElement[] {
    const axes: { value: string; label: string; hint: string }[] = [
      { value: 'entry', label: '入口', hint: 'ページ／メモのセル／六角スクショ／巣／続けて聞く。開いた入口で、はじめの組が決まります' },
      { value: 'site', label: 'サイト', hint: 'サイトごとに、最後に使った組をはじめの組に（次の版で）' },
      { value: 'bot', label: '子', hint: '宛て先の役で組が替わる（次の版で）' },
    ];
    const chips = el('div', 'bns-chips bns-seg');
    chips.setAttribute('role', 'radiogroup');
    for (const a of axes) {
      const key = `bns-pre-axis-${a.value}`;
      const chip = this.radio(`${this.uid}-axis`, a.value, key, a.value === 'entry', false, `${a.label}：${a.hint}`, () => {
        this.axisNote = a.value !== 'entry';
        this.renderAll(true, key);
      });
      chip.title = a.hint;
      chip.append(el('span', 'bns-chip-text', a.value === 'entry' ? a.label : `${a.label}（次の版で）`));
      chips.append(chip);
    }
    const nodes = [this.labeled('組を替える軸', chips)];
    if (this.axisNote) nodes.push(el('p', 'bns-note', 'サイト・子で組を替えるのは次の版で。いまは入口で替えます'));
    return nodes;
  }

  // 組の札と、その組の手元（6）
  private handRows(presets: BotPresets, now: number): HTMLElement[] {
    const set = presets.sets.find((s) => s.id === this.presetSetId) ?? presets.sets[0];
    if (!set) return [el('p', 'bns-empty', '定型の組がありません')];
    this.presetSetId = set.id;
    const chips = el('div', 'bns-chips bns-seg');
    chips.setAttribute('role', 'radiogroup');
    for (const s of presets.sets) {
      const key = `bns-pre-set-${s.id}`;
      const chip = this.radio(`${this.uid}-preset-set`, s.id, key, s.id === set.id, false, `組「${s.name}」：入口「${PRESET_ENTRY_LABEL[s.entry]}」で開いたら、はじめにこの組`, () => {
        this.presetSetId = s.id;
        this.closePresetEditor();
        this.renderAll(true, key);
      });
      chip.append(el('span', 'bns-chip-text', `${s.name}（${PRESET_ENTRY_LABEL[s.entry]}）`));
      chips.append(chip);
    }
    const hand = presetHand(presets, set);
    const list = el('ol', 'bns-pre-list');
    list.setAttribute('aria-label', `手元：組「${set.name}」`);
    for (let i = 0; i < PRESET_HAND_MAX; i++) {
      const p = hand[i];
      if (!p) {
        list.append(el('li', 'bns-pre-slot', `${i + 1}　（空き）`));
        continue;
      }
      list.append(this.presetRow(p, now, i + 1));
      if (this.presetPick === p.id) list.append(this.presetEditor(p, now, set));
    }
    const title = el('div', 'bns-section-title bns-pre-title');
    title.append(el('span', '', `手元（${PRESET_HAND_MAX}）：組「${set.name}」`), el('span', 'bns-pre-hint', '小窓で数字キー 1〜6 で入る'));
    const nodes = [this.labeled('組（入口ごと）', chips)];
    // R4a で書いた presets.json には「続けて聞く」の組が無い（R5 で用意した組。無ければ小窓は「調べもの」の組で開く）。押したときだけ足す
    const follow = DEFAULT_PRESETS.sets.find((s) => s.entry === 'follow');
    if (follow && !presets.sets.some((s) => s.entry === 'follow')) {
      const add = this.presetButton(`組「${follow.name}」を用意する`, 'bns-pre-add-follow', `入口「${PRESET_ENTRY_LABEL.follow}」の組と、用意した定型 6 つを足します（いまは「調べもの」の組で開きます）`, () => {
        const next = this.presetsCopy();
        if (!next) return;
        const stamp = new Date().toISOString();
        for (const id of follow.hand) {
          const p = DEFAULT_PRESETS.presets.find((x) => x.id === id);
          if (p && !next.presets.some((x) => x.id === id)) next.presets.push({ ...p, createdAt: stamp, keptAt: stamp });
        }
        next.sets.push({ ...follow, hand: [...follow.hand] });
        this.presetSetId = follow.id;
        this.commitPresets(next, `組「${follow.name}」を用意しました（入口「${PRESET_ENTRY_LABEL.follow}」）`, `bns-pre-set-${follow.id}`);
      });
      nodes.push(add);
    }
    return [...nodes, title, list, el('p', 'bns-note', `手元は時間では沈みません（${PRESET_SINK_DAYS} 日使わないと灰色になるだけ）`)];
  }

  // 棚（その他 ▾。全部の組で一つ）。並びは最近使った順・当たりの多い順・ずれの多い順
  private shelfRows(presets: BotPresets, now: number): HTMLElement[] {
    const sort = el('select', 'bns-select bns-pre-sort');
    sort.dataset.key = 'bns-pre-sort';
    sort.setAttribute('aria-label', '棚の並び');
    sort.append(option('recent', '並び：最近使った順'), option('hits', '並び：当たりの多い順'), option('misses', '並び：ずれの多い順'));
    sort.value = this.presetSort;
    sort.addEventListener('change', () => {
      this.presetSort = sort.value === 'hits' || sort.value === 'misses' ? sort.value : 'recent';
      this.renderAll(true, 'bns-pre-sort');
    });
    const title = el('div', 'bns-section-title bns-pre-title');
    title.append(el('span', '', '棚（その他）'), el('span', 'bns-pre-hint', '全部の組で一つ。小窓の「その他 ▾」に出ます'), sort);
    const by = (p: BotPreset) => (this.presetSort === 'hits' ? p.hits : this.presetSort === 'misses' ? p.misses : 0);
    const shelf = presets.presets.filter((p) => p.shelf === 'shelf').sort((a, b) => by(b) - by(a) || presetClock(b) - presetClock(a));
    const nodes: HTMLElement[] = [title];
    if (!shelf.length) {
      nodes.push(el('p', 'bns-empty', '棚は空です（直す欄の「棚へ」・下の「新しい定型」・「送った依頼から拾う」で入ります）'));
    } else {
      const list = el('ul', 'bns-pre-list');
      list.setAttribute('aria-label', '棚の定型');
      for (const p of shelf) {
        list.append(this.presetRow(p, now));
        if (this.presetPick === p.id) list.append(this.presetEditor(p, now, presets.sets.find((s) => s.id === this.presetSetId)));
      }
      nodes.push(list);
    }
    nodes.push(el('p', 'bns-note', `棚から ${PRESET_SWAP_USES} 回使ったら、手元と入れ替えるかを一度だけ聞きます。${PRESET_SINK_DAYS} 日使わないと灰色になって蔵へ沈みます（消えません）`));
    return nodes;
  }

  // 蔵（検索でだけ出る）。打つたびに結果だけを入れ替える（変換中の文を壊さない）
  private vaultRows(presets: BotPresets, now: number): HTMLElement[] {
    const vault = presets.presets.filter((p) => p.shelf === 'vault');
    const title = el('div', 'bns-section-title bns-pre-title');
    title.append(el('span', '', '蔵'), el('span', 'bns-pre-hint', '検索でだけ出ます'));
    const input = el('input', 'bns-input');
    input.type = 'search';
    input.dataset.key = 'bns-pre-vault-q';
    input.placeholder = '蔵を探す（例：手順）';
    input.setAttribute('aria-label', '蔵の定型を探す');
    input.value = this.vaultQuery;
    const results = el('ul', 'bns-pre-list');
    results.setAttribute('aria-label', '蔵の定型');
    const hint = el('p', 'bns-note');
    hint.setAttribute('role', 'status');
    const fill = () => {
      const q = this.vaultQuery.trim().toLowerCase();
      const hits = q ? vault.filter((p) => p.text.toLowerCase().includes(q)) : [];
      const rows: HTMLElement[] = [];
      for (const p of hits.slice(0, VAULT_SHOW_MAX)) {
        rows.push(this.presetRow(p, now));
        if (this.presetPick === p.id) rows.push(this.presetEditor(p, now, presets.sets.find((s) => s.id === this.presetSetId)));
      }
      results.replaceChildren(...rows);
      const n = (v: number) => v.toLocaleString('ja-JP');
      hint.textContent = !vault.length ? '蔵は空です' : !q ? `何か打つと出ます（${n(vault.length)} 個）` : !hits.length ? '見つかりません' : hits.length > VAULT_SHOW_MAX ? `${n(hits.length)} 個（はじめの ${VAULT_SHOW_MAX} 個）` : `${n(hits.length)} 個`;
    };
    input.addEventListener('input', () => {
      this.vaultQuery = input.value;
      fill();
    });
    fill();
    return [title, input, results, hint];
  }

  // 定型の 1 行（押すと、この下に直す欄）。num：手元の数字。灰色：蔵か、30 日使っていない
  private presetRow(p: BotPreset, now: number, num?: number): HTMLElement {
    const li = el('li', 'bns-pre-row');
    const b = el('button', 'bns-pre-item');
    b.type = 'button';
    b.dataset.key = `bns-pre-${p.id}`;
    b.setAttribute('aria-expanded', String(this.presetPick === p.id));
    b.dataset.sleep = String(p.shelf === 'vault' || presetSleeping(p, now));
    if (num) b.append(el('span', 'bns-pre-key', String(num)));
    const text = el('span', 'bns-pre-text');
    text.append(...presetParts(p.text).map((part) => el('span', part.hole ? 'bns-pre-hole' : '', part.text)));
    if (p.life !== 'forever') text.append(el('span', 'bns-pre-life', PRESET_LIFE_LABEL[p.life]));
    const meta = el('span', 'bns-pre-meta');
    const used = p.uses ? `${dayText(p.lastUsedAt, now)}・${p.uses.toLocaleString('ja-JP')} 回` : 'まだ使っていない';
    meta.append(el('span', '', p.shelf !== 'vault' && presetSleeping(p, now) ? `${used}・眠っている` : used));
    const marks = markText(p);
    if (marks) meta.append(el('span', '', marks));
    b.append(text, meta);
    b.title = '押すと、この下に直す欄を出します（文・寿命・置き場・消す）。もう一度押すと閉じます';
    b.addEventListener('click', () => {
      const open = this.presetPick !== p.id;
      this.closePresetEditor();
      if (open) this.presetPick = p.id;
      this.renderAll(true, open ? 'bns-pre-edit-text' : b.dataset.key);
    });
    li.append(b);
    return li;
  }

  // 直す欄（文・寿命・置き場・並び・消す）。set：いま手元を見ている組（「手元へ」の行き先）
  private presetEditor(p: BotPreset, now: number, set: BotPresetSet | undefined): HTMLElement {
    const box = el('li', 'bns-pre-edit');
    box.setAttribute('aria-label', `定型を直す：${p.text}`);
    const input = el('input', 'bns-input');
    input.type = 'text';
    input.dataset.key = 'bns-pre-edit-text';
    input.value = this.presetEditText ?? p.text;
    input.setAttribute('aria-label', '定型の文');
    input.addEventListener('input', () => {
      this.presetEditText = input.value;
    });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      this.editPresetText(p.id);
    });
    const save = this.presetButton('文を直す', 'bns-pre-edit-save', '文を書き換えます（Enter でも）。使った回数・印の数はそのまま', () => this.editPresetText(p.id));
    const row = el('div', 'bns-pre-edit-row');
    row.append(input, save);
    box.append(this.field(`文（穴：{選んだ文}・{題名}・{前の返事の要点}。${PRESET_TEXT_MAX} 字まで）`, row));

    // 寿命
    const lives = el('div', 'bns-chips bns-seg');
    lives.setAttribute('role', 'radiogroup');
    const lifeHint: Record<BotPresetLife, string> = {
      forever: `ずっと（棚なら ${PRESET_SINK_DAYS} 日使わないと蔵へ。手元は沈まない）`,
      today: '今日だけ（日付が変わったら蔵へ）',
      case: `この調べものの間（${PRESET_CASE_DAYS} 日使わなかったら蔵へ。使えば延びる）`,
    };
    for (const life of ['forever', 'today', 'case'] as const) {
      const key = `bns-pre-life-${life}`;
      const chip = this.radio(`${this.uid}-life`, life, key, p.life === life, !this.host.savePresets, lifeHint[life], () => this.setPresetLife(p.id, life, key));
      chip.title = lifeHint[life];
      chip.append(el('span', 'bns-chip-text', PRESET_LIFE_LABEL[life]));
      lives.append(chip);
    }
    box.append(this.labeled('寿命（決め直すと、今日から数え直し）', lives));

    // 置き場・並び・消す
    const acts = el('div', 'bns-pre-acts');
    if (set && set.hand.includes(p.id)) {
      const i = set.hand.indexOf(p.id);
      acts.append(
        this.miniButton('↑', '手元の前へ', 'bns-pre-up', !this.host.savePresets || i === 0, () => this.movePresetInHand(p.id, set.id, -1)),
        this.miniButton('↓', '手元の後ろへ', 'bns-pre-down', !this.host.savePresets || i >= set.hand.length - 1, () => this.movePresetInHand(p.id, set.id, 1)),
        this.presetButton('棚へ', 'bns-pre-to-shelf', `組「${set.name}」の手元から外して棚へ（ほかの組の手元にあれば、そこには残ります）`, () => this.presetToShelf(p.id, set.id)),
      );
    } else if (set) {
      const full = set.hand.length >= PRESET_HAND_MAX;
      const hint = full ? `組「${set.name}」の手元はいっぱいです。手元の定型を「棚へ」下げてから` : `組「${set.name}」の手元の終わりに入れます`;
      const toHand = this.presetButton(`手元へ（${set.name}）`, 'bns-pre-to-hand', hint, () => this.presetToHand(p.id, set.id));
      toHand.disabled ||= full;
      acts.append(toHand);
    }
    if (p.shelf === 'vault') acts.append(this.presetButton('棚へ戻す', 'bns-pre-to-shelf', '蔵から棚へ戻します（今日から数え直し）', () => this.presetToShelf(p.id)));
    else acts.append(this.presetButton('蔵へ', 'bns-pre-to-vault', '蔵へ入れます（消えません。検索で出ます。手元からも外れます）', () => this.presetToVault(p.id)));
    const armed = this.presetDelete === p.id;
    const del = this.presetButton(armed ? '本当に消す' : '消す', 'bns-pre-delete', armed ? 'もう一度押すと消します（元に戻せません）' : '消します（もう一度押して確かめます）', () => this.removePreset(p.id));
    if (armed) del.classList.add('bns-pre-danger');
    acts.append(del);
    box.append(acts);

    // わけの 1 行：置き場・寿命の終わり・作った日・拾った元
    const where = this.base.presets?.sets.filter((s) => s.hand.includes(p.id)).map((s) => `手元「${s.name}」`) ?? [];
    const end =
      p.life === 'today'
        ? '今日が終わると蔵へ'
        : p.life === 'case'
          ? `${PRESET_CASE_DAYS} 日使わないと蔵へ`
          : p.shelf === 'shelf'
            ? `${PRESET_SINK_DAYS} 日使わないと蔵へ`
            : p.shelf === 'vault'
              ? '蔵（検索でだけ出る）'
              : '手元（沈まない）';
    const born = dayText(p.createdAt, now);
    const info = [where.join('・') || (p.shelf === 'shelf' ? '棚' : ''), end, `作った日：${born === 'まだ使っていない' ? '―' : born}`, p.from?.requestId ? `${requestNo(p.from.requestId)} から拾った` : '']
      .filter(Boolean)
      .join('　');
    box.append(el('p', 'bns-note', info));
    return box;
  }

  private findPreset(next: BotPresets | null | undefined, id: string): BotPreset | undefined {
    return next?.presets.find((p) => p.id === id);
  }

  private editPresetText(id: string) {
    const text = (this.presetEditText ?? this.findPreset(this.base.presets, id)?.text ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return this.say('文が空なので直せません（要らなければ「消す」）');
    if ([...text].length > PRESET_TEXT_MAX) return this.say(`定型の文は ${PRESET_TEXT_MAX} 字までです`);
    const next = this.presetsCopy();
    const p = this.findPreset(next, id);
    if (!next || !p) return;
    if (p.text === text) return this.say('文は変わっていません');
    p.text = text;
    this.presetEditText = null;
    this.commitPresets(next, `文を直しました：${quoteText(text)}`, 'bns-pre-edit-text');
  }

  private setPresetLife(id: string, life: BotPresetLife, key: string) {
    const next = this.presetsCopy();
    const p = this.findPreset(next, id);
    if (!next || !p || p.life === life) return;
    p.life = life;
    this.commitPresets(next, `${quoteText(p.text)}の寿命を「${PRESET_LIFE_LABEL[life]}」にしました`, key);
  }

  private movePresetInHand(id: string, setId: string, delta: number) {
    const next = this.presetsCopy();
    const set = next?.sets.find((s) => s.id === setId);
    const i = set ? set.hand.indexOf(id) : -1;
    const j = i + delta;
    if (!next || !set || i < 0 || j < 0 || j >= set.hand.length) return;
    [set.hand[i], set.hand[j]] = [set.hand[j], set.hand[i]];
    const edge = delta < 0 ? j === 0 : j === set.hand.length - 1;
    this.commitPresets(next, `手元の ${j + 1} 番めにしました`, edge ? 'bns-pre-to-shelf' : delta < 0 ? 'bns-pre-up' : 'bns-pre-down');
  }

  private presetToHand(id: string, setId: string) {
    const next = this.presetsCopy();
    const set = next?.sets.find((s) => s.id === setId);
    const p = this.findPreset(next, id);
    if (!next || !set || !p || set.hand.includes(id) || set.hand.length >= PRESET_HAND_MAX) return;
    set.hand.push(id);
    p.shelf = 'hand';
    this.commitPresets(next, `${quoteText(p.text)}を組「${set.name}」の手元（${set.hand.length}）に入れました`, `bns-pre-${id}`);
  }

  // 棚へ：setId があればその組の手元から外す（ほかの組の手元に無ければ棚。蔵からなら棚へ戻す）
  private presetToShelf(id: string, setId?: string) {
    const next = this.presetsCopy();
    const p = this.findPreset(next, id);
    if (!next || !p) return;
    const set = setId ? next.sets.find((s) => s.id === setId) : undefined;
    if (set) set.hand = set.hand.filter((x) => x !== id);
    if (!next.sets.some((s) => s.hand.includes(id))) p.shelf = 'shelf';
    this.commitPresets(next, set ? `${quoteText(p.text)}を組「${set.name}」の手元から外しました` : `${quoteText(p.text)}を棚へ戻しました`, `bns-pre-${id}`);
  }

  private presetToVault(id: string) {
    const next = this.presetsCopy();
    const p = this.findPreset(next, id);
    if (!next || !p || !sinkPreset(next, id)) return;
    this.closePresetEditor();
    this.commitPresets(next, `${quoteText(p.text)}を蔵へ入れました（検索で出ます）`);
  }

  // 消す（一度めは確かめるだけ。消した定型の id は二度と使わない）
  private removePreset(id: string) {
    if (this.presetDelete !== id) {
      this.presetDelete = id;
      this.renderAll(true, 'bns-pre-delete');
      return;
    }
    const next = this.presetsCopy();
    const p = this.findPreset(next, id);
    if (!next || !p) return;
    next.presets = next.presets.filter((x) => x.id !== id);
    for (const s of next.sets) s.hand = s.hand.filter((x) => x !== id);
    this.closePresetEditor();
    this.commitPresets(next, `${quoteText(p.text)}を消しました`);
  }

  // 新しい定型（寿命を決めて作る。棚に入る）
  private newPresetRows(presets: BotPresets): HTMLElement[] {
    const title = el('div', 'bns-section-title bns-pre-title');
    title.append(el('span', '', '新しい定型'), el('span', 'bns-pre-hint', '棚に入ります'));
    const input = el('input', 'bns-input');
    input.type = 'text';
    input.dataset.key = 'bns-pre-new-text';
    input.placeholder = '例：{選んだ文} の反対の意見を 3 つ';
    input.setAttribute('aria-label', '新しい定型の文');
    input.value = this.newPresetText;
    const add = this.presetButton('棚に足す', 'bns-pre-new-add', '棚に足します（Enter でも）', () => this.addPreset(presets));
    input.addEventListener('input', () => {
      this.newPresetText = input.value;
    });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      this.addPreset(presets);
    });
    const row = el('div', 'bns-pre-edit-row');
    row.append(input, add);
    const lives = el('div', 'bns-chips bns-seg');
    lives.setAttribute('role', 'radiogroup');
    for (const life of ['forever', 'today', 'case'] as const) {
      const key = `bns-pre-new-life-${life}`;
      const chip = this.radio(`${this.uid}-new-life`, life, key, this.newPresetLife === life, false, `寿命：${PRESET_LIFE_LABEL[life]}`, () => {
        this.newPresetLife = life;
      });
      chip.append(el('span', 'bns-chip-text', PRESET_LIFE_LABEL[life]));
      lives.append(chip);
    }
    return [title, row, this.labeled('寿命', lives)];
  }

  private addPreset(presets: BotPresets) {
    const text = this.newPresetText.replace(/\s+/g, ' ').trim();
    if (!text) return this.say('新しい定型の文を書いてください');
    if ([...text].length > PRESET_TEXT_MAX) return this.say(`定型の文は ${PRESET_TEXT_MAX} 字までです`);
    const same = presets.presets.find((p) => p.text === text);
    if (same) return this.say(`同じ文の定型が、もう${same.shelf === 'hand' ? '手元' : same.shelf === 'shelf' ? '棚' : '蔵'}にあります`);
    const next = this.presetsCopy();
    if (!next) return;
    const now = Date.now();
    const stamp = new Date(now).toISOString();
    next.presets.push({ id: newPresetId(next.presets, now), text, createdAt: stamp, keptAt: stamp, uses: 0, hits: 0, misses: 0, wrongTo: 0, life: this.newPresetLife, shelf: 'shelf' });
    this.newPresetText = '';
    this.commitPresets(next, `棚に足しました：${quoteText(text)}（寿命：${PRESET_LIFE_LABEL[this.newPresetLife]}）`, 'bns-pre-new-text');
  }

  // 棚卸し：言い回しの近い定型を並べる（これを残す＝ほかは蔵へ／別物＝もう並べない）
  private reviewRows(presets: BotPresets, now: number): HTMLElement[] {
    const groups = similarGroups(presets);
    const title = el('div', 'bns-section-title bns-pre-title');
    title.append(el('span', '', '棚卸し'), el('span', 'bns-pre-hint', '言い回しの近い定型'));
    if (!this.reviewOpen) {
      const open = this.presetButton(`似た定型を並べる（${groups.length} 組）`, 'bns-pre-review-open2', '言い回しの近い定型を並べます', () => this.openReview(false));
      open.disabled = !groups.length;
      return [title, open, el('p', 'bns-note', `月に一度か、定型が ${PRESET_REVIEW_COUNT} を超えたときに一度だけ、上で声をかけます`)];
    }
    const nodes: HTMLElement[] = [title];
    if (!groups.length) nodes.push(el('p', 'bns-empty', '言い回しの近い定型はありません'));
    groups.forEach((group, g) => {
      const box = el('div', 'bns-pre-group');
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', `似た定型 ${g + 1}`);
      for (const p of group) {
        const row = el('div', 'bns-pre-group-row');
        const where = presets.sets.filter((s) => s.hand.includes(p.id)).map((s) => `手元「${s.name}」`).join('・') || '棚';
        const text = el('span', 'bns-pre-text');
        text.append(...presetParts(p.text).map((part) => el('span', part.hole ? 'bns-pre-hole' : '', part.text)));
        const meta = el('span', 'bns-pre-meta', [where, p.uses ? `${dayText(p.lastUsedAt, now)}・${p.uses} 回` : 'まだ使っていない', markText(p)].filter(Boolean).join('　'));
        const keep = this.presetButton('これを残す', `bns-pre-keep-${p.id}`, 'この定型を残し、同じ組のほかの定型を蔵へ入れます（消えません）', () => {
          const next = this.presetsCopy();
          if (!next) return;
          for (const other of group) if (other.id !== p.id) sinkPreset(next, other.id);
          this.commitPresets(next, `${quoteText(p.text)}を残し、ほかの ${group.length - 1} つを蔵へ入れました`, 'bns-pre-review-close');
        });
        row.append(text, meta, keep);
        box.append(row);
      }
      const apart = this.presetButton('別物（もう並べない）', `bns-pre-apart-${g}`, 'この組の定型は別のものとして、次からは並べません', () => {
        const next = this.presetsCopy();
        if (!next) return;
        const keys = new Set(next.review?.apart ?? []);
        for (const a of group) for (const b of group) if (a.id < b.id) keys.add(apartKey(a.id, b.id));
        next.review = { ...next.review, apart: [...keys] };
        this.commitPresets(next, '別物として覚えました（次からは並べません）', 'bns-pre-review-close');
      });
      box.append(apart);
      nodes.push(box);
    });
    const close = el('button', 'bns-button bns-pre-btn', '並べるのをやめる');
    close.type = 'button';
    close.dataset.key = 'bns-pre-review-close';
    close.addEventListener('click', () => {
      this.reviewOpen = false;
      this.renderAll(true, 'bns-pre-review-open2');
    });
    nodes.push(close, el('p', 'bns-note', '一つにまとめたいときは、残す方の文を直して（違いは穴 {…} で吸う）、ほかを蔵へ'));
    return nodes;
  }

  // 送った依頼から拾う：受け取り箱の依頼の頭の 40 字（巣の設定でオンのときだけ残る）と下書きの自分の文を、穴に置き換えて候補に。
  //   言い回しの近い候補は 1 つにまとめて「似た依頼 n つ」（新しいものを見せる）
  private pickRows(presets: BotPresets): HTMLElement[] {
    if (!this.host.pickSources) return [];
    const title = el('div', 'bns-section-title bns-pre-title');
    title.append(el('span', '', '送った依頼から拾う'), el('span', 'bns-pre-hint', '受け取り箱の依頼と下書きから'));
    if (this.pickSources === null) return [title, el('p', 'bns-note', '候補を集めています…')];
    const groups: { src: PresetPickSource; text: string; count: number }[] = [];
    for (const src of [...this.pickSources].sort((a, b) => b.at - a.at)) {
      const text = presetTemplate(src.text, src.page);
      if ([...text.replace(/\{[^}]*\}/g, '').trim()].length < 2) continue; // 穴だけ・短すぎるものは拾わない
      const near = groups.find((g) => similar(g.text, text));
      if (near) near.count += 1;
      else groups.push({ src, text, count: 1 });
    }
    const nodes: HTMLElement[] = [title];
    if (!groups.length) {
      const off = this.base.nest.headline !== 'on';
      nodes.push(
        el(
          'p',
          'bns-empty',
          off
            ? '拾える文がありません。受け取り箱の依頼の頭は、「みんなに聞く」のタブの「依頼の最初の40字を一覧に出す」がオンのときだけ残ります（下書きは 7 日）'
            : '拾える文がありません（受け取り箱の依頼の頭と、下書きから探します）',
        ),
      );
      return nodes;
    }
    const list = el('ul', 'bns-pre-list');
    list.setAttribute('aria-label', '拾える依頼');
    const now = Date.now();
    for (const g of groups.slice(0, PICK_SHOW_MAX)) {
      const key = `${g.src.kind}:${g.src.id}`;
      const li = el('li', 'bns-pre-pick');
      const head = `${g.src.label}　${dayText(new Date(g.src.at).toISOString(), now)}${g.count > 1 ? `　似た依頼 ${g.count} つ` : ''}`;
      const input = el('input', 'bns-input');
      input.type = 'text';
      input.dataset.key = `bns-pre-pick-text-${key}`;
      input.setAttribute('aria-label', `${g.src.label} から作る定型の文`);
      input.value = this.pickTexts.get(key) ?? g.text;
      const go = el('button', 'bns-button bns-pre-btn');
      go.type = 'button';
      go.dataset.key = `bns-pre-pick-${key}`;
      const paint = () => {
        const text = input.value.replace(/\s+/g, ' ').trim();
        const same = presets.presets.find((p) => p.text === text);
        go.textContent = same ? (same.shelf === 'vault' ? '蔵から戻す' : 'もうある') : '定型にする';
        go.disabled = !this.host.pickPreset || !text || [...text].length > PRESET_TEXT_MAX || (!!same && same.shelf !== 'vault');
        go.title = same ? (same.shelf === 'vault' ? '同じ文の定型が蔵にあります。棚へ戻します' : `同じ文の定型が、もう${same.shelf === 'hand' ? '手元' : '棚'}にあります`) : '棚に入れます（文は直してから押せます）';
      };
      input.addEventListener('input', () => {
        this.pickTexts.set(key, input.value);
        paint();
      });
      go.addEventListener('click', () => {
        const text = input.value.replace(/\s+/g, ' ').trim();
        if (!text || !this.host.pickPreset) return;
        this.host.pickPreset({ ...(g.src.kind === 'request' ? { requestId: g.src.id } : { draftId: g.src.id }), text });
        this.pickTexts.delete(key);
        this.say(presets.presets.some((p) => p.text === text) ? `蔵から棚へ戻しました：${quoteText(text)}` : `棚に入れました：${quoteText(text)}`);
      });
      paint();
      const row = el('div', 'bns-pre-edit-row');
      row.append(input, go);
      li.append(el('span', 'bns-pre-meta', head), row);
      list.append(li);
    }
    nodes.push(list, el('p', 'bns-note', '選んだ文・題名・URL にあたる部分は、穴 {選んだ文}・{題名} に置き換えてあります。直してから「定型にする」で棚へ'));
    return nodes;
  }

  // ---------- 部品 ----------

  // 札の形の radio（本物の radio を見えなくして重ねる。同じ name の組は ← → で移れる）
  private radio(name: string, value: string, key: string, checked: boolean, disabled: boolean, label: string, run: () => void): HTMLLabelElement {
    const chip = el('label', 'bns-chip');
    const input = el('input');
    input.type = 'radio';
    input.name = name;
    input.value = value;
    input.checked = checked;
    input.disabled = disabled;
    input.dataset.key = key;
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => {
      if (input.checked) run();
    });
    chip.append(input);
    return chip;
  }

  // 見出しの付いた欄（label で包む：見出しを押すと入力欄へ）
  private field(title: string, control: HTMLElement): HTMLElement {
    const label = el('label', 'bns-field');
    label.append(el('span', 'bns-field-label', title), control);
    return label;
  }

  // 見出しの付いた組（radio の組などは label で包まない）
  private labeled(title: string, control: HTMLElement): HTMLElement {
    const box = el('div', 'bns-opt');
    const head = el('span', 'bns-opt-label', title);
    head.id = `${this.uid}-l${Math.random().toString(36).slice(2, 8)}`;
    if (!control.hasAttribute('aria-label')) control.setAttribute('aria-labelledby', head.id);
    box.append(head, control);
    return box;
  }

  // 席の小さな顔（役ありは役の形、役なしは石板の顔、空いた席は点線の六角形）
  private faceSvg(bot: BotBrief | undefined, role: BotRole | null, clip: string): SVGElement {
    const svg = svgEl('svg', { class: 'bns-icon', viewBox: VIEW_BOX, 'aria-hidden': 'true' });
    if (!bot) svg.append(svgEl('polygon', { class: 'bot-nest-empty-plate', points: hexCorners(0, 0, 18) }));
    else drawSeatFace(svg, { ...bot, role: role ?? undefined }, 'idle', `${this.uid}-${clip}`);
    return svg;
  }

  // 役の形だけ（札の印）
  private shapeSvg(shape: BotRoleShape): SVGElement {
    const svg = svgEl('svg', { class: 'bns-icon', viewBox: VIEW_BOX, 'aria-hidden': 'true' });
    const g = svgEl('g', {});
    drawRoleFace(g, shape, 'idle');
    svg.append(g);
    return svg;
  }
}

// 範囲の中の整数に（数でないものは既定。R8 の送ったあとの欄）
function clampInt(value: number, range: { min: number; max: number; default: number }): number {
  if (!Number.isFinite(value)) return range.default;
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

// 定型の名前の見せ方（『…』。長ければ 24 字で切る。R4b の棚）
function quoteText(text: string): string {
  const chars = [...text];
  return `『${chars.length > 24 ? `${chars.slice(0, 24).join('')}…` : text}』`;
}

// 使った日（今日・きのう・月/日。R4b の棚）
function dayText(iso: string | undefined, now: number): string {
  const t = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(t)) return 'まだ使っていない';
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (t >= today.getTime()) return '今日';
  if (t >= today.getTime() - DAY) return 'きのう';
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 印の数の言葉（0 のものは出さない。R9 の印。左が今ある依頼の分を足してある）
function markText(p: BotPreset): string {
  return [p.hits ? `当たり ${p.hits}` : '', p.misses ? `ずれ ${p.misses}` : '', p.wrongTo ? `宛て先違い ${p.wrongTo}` : ''].filter(Boolean).join('・');
}

// 棚卸しの声をかけた（並べた・あとで）：時刻と、30 を超えていれば一度だけの声かけを済ませた印
function markReviewed(next: BotPresets) {
  next.review = { ...next.review, at: new Date().toISOString(), ...(next.presets.length > PRESET_REVIEW_COUNT ? { over30: true as const } : {}) };
}
