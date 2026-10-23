// Grok-Bot の巣の「役」（ロール）：用意した役 13 個と、自分で作る役（docs/bot-cells/plan-s3-nest.md §4）
//   ・役はボットごとに、台帳 ui-data\bots\index.json の各ボットの role に持つ（書くのは左の UI だけ。bots.ts の BotStore.setRole）
//     右は台帳の写し（relay の bots）で役を見て、変えたいときは命令 setBotRole で左に頼む
//   ・依頼に入れるときは request.v1 に項目を足さない（additionalProperties: false）。text の頭に roleInstructions の文を入れる（S3.4）
//   ・役が無いボットは「役なし」（依頼に説明の文を入れない）。同じ役を何体に付けてもよい（巣では顔の形が同じになり、名前で区別する。S3.3b）
//   ・考え方の段階（thinking。S3.3b）も役の中に持つ（無ければ「おまかせ」）。役の文の「長さ」の次の1行に入る
//   ・このファイルは何も import しない（左の台帳・右の巣・設定の欄のどこからでも使えるように）
//   ・依頼の小窓 v2・R3（plan-request-v2.md D7）：用意した役の文の終わりに LIGHT_LINE を入れる。小窓で直した役の文（roleText）は cleanRoleText で整える

// 用意した役（13個）と、自分で作る役（custom）。台帳に書く名前なので、変えない
export type BotRolePreset =
  | 'research' // 調査
  | 'summary' // 要約
  | 'idea' // 発想
  | 'check' // 確認
  | 'action' // 実行
  | 'reader' // 読者
  | 'synthesis' // 統合と再構築
  | 'situation' // 状況説明
  | 'inquiry' // 疑問と探求
  | 'angle' // 特殊な観点
  | 'value' // 価値判断
  | 'critique' // 批判と検証
  | 'practice' // 調整と実践
  | 'custom'; // 自分で

// 巣の席の顔の形（上の6つは見本 nest-01-ring.png のまま、あとの7つは新しい形）
export type BotRoleShape =
  | 'hexagon' // 六角形
  | 'circle' // 丸
  | 'triangle' // 三角
  | 'diamond' // ひし形
  | 'star' // 星
  | 'doubleCircle' // 二重丸
  | 'square' // 四角
  | 'pentagon' // 五角形
  | 'drop' // 雫
  | 'halfMoon' // 半月
  | 'trapezoid' // 天秤（台形）
  | 'cross' // 十字
  | 'gear'; // 歯車

// 設定の欄で役を並べる5つの組
export type BotRoleGroup =
  | 'gather' // まとめる・調べる
  | 'think' // 考える
  | 'verify' // 確かめる
  | 'act' // 動かす
  | 'compose'; // 伝える・組み立てる

// 役の細かい設定（どれも無くてよい。無いものは既定の値）。台帳には、その役に使う項目だけを残す（normalizeRole）
export interface BotRoleOptions {
  // 全部の役に共通
  length?: 'short' | 'normal' | 'long'; // 長さ（短め／ふつう／くわしく）
  tone?: 'desu' | 'casual'; // 口調（です・ます／くだけた）
  nextStep?: boolean; // 最後に「次の一手」を付ける
  // 調査
  sources?: 0 | 3 | 5; // 出典の数
  recency?: 'any' | 'year'; // 新しさ（指定なし／1年以内）
  // 要約（summaryLength があるので、共通の length は使わない）
  summaryLength?: 'threeLines' | 'normal' | 'detailed'; // 長さ（3行／ふつう／くわしく）
  bullets?: boolean; // 箇条書きにする
  // 発想
  ideas?: 3 | 5; // 案の数
  boldness?: 'normal' | 'bold'; // 突飛さ（ふつう／大胆）
  // 確認
  stance?: 'opposing' | 'both'; // 立場（反対側から／両方から）
  // 確認・批判と検証
  strictness?: 'gentle' | 'normal' | 'strict'; // きびしさ（やさしめ／ふつう／きびしく）
  // 実行
  stepDetail?: 'rough' | 'normal' | 'detailed'; // 手順の細かさ（おおまか／ふつう／細かく）
  deadline?: boolean; // 期限を入れる
  // 読者
  audience?: 'beginner' | 'child' | 'expert'; // 読み手（初心者／子ども／専門家）
  // 統合と再構築
  simplicity?: 'normal' | 'max'; // 簡素さ（ふつう／できるだけ簡素に）
  limits?: boolean; // わからない点や限界を明記する
  checkQuestions?: 0 | 1 | 2 | 3; // 確かめの問い（0〜3）
  // 状況説明
  scope?: 'gist' | 'background'; // 範囲（要点だけ／背景まで）
  timeline?: boolean; // 時系列にする
  // 疑問と探求
  questions?: 3 | 5; // 問いの数
  depth?: 'wide' | 'deep'; // 深さ（広く／深く）
  // 特殊な観点（空ならおまかせ）
  angle?: string;
  // 価値判断
  criteria?: string; // 基準（自由に書く）
  score?: boolean; // 点数を付ける
  // 調整と実践
  constraints?: string; // 制約（時間・お金など自由に書く）
}

export type BotRoleOptionKey = keyof BotRoleOptions;

// 考え方の段階（S3.3b。役の thinking。無ければ「おまかせ」＝依頼に考え方の行を入れない）
//   quick：さっと（短く直感で）　normal：ふつう　deep：じっくり（理由を確かめながら）
//   steps：段階を踏む（番号を付けて順に考え、最後に結論）　custom：自分で（text に 1〜THINKING_TEXT_MAX 字の自由な文）
export type BotThinkingLevel = 'quick' | 'normal' | 'deep' | 'steps' | 'custom';
export interface BotThinking {
  level: BotThinkingLevel;
  text?: string; // custom のときだけ（制御文字を消した1行。ほかの段階では持たない）
}

// 台帳の各ボットの role（docs/bot-cells/schemas/botcell.v1.schema.json の $defs/botRole）
//   用意した役では name と shape は役の定義のまま（normalizeRole が直す）。自分で作る役（custom）だけ、使う人が決める
export interface BotRole {
  preset: BotRolePreset;
  name: string; // 役の名前（custom は ROLE_NAME_MAX 字まで）
  shape: BotRoleShape;
  options?: BotRoleOptions;
  instructions?: string; // 使う人が書いた役の説明（ROLE_INSTRUCTIONS_MAX 字まで）。依頼に入る
  thinking?: BotThinking; // 考え方の段階（S3.3b。無ければ「おまかせ」）
}

export const ROLE_NAME_MAX = 20; // 自分で作る役の名前（文字。S3.3 で 12 → 20）
export const ROLE_INSTRUCTIONS_MAX = 800; // 役の説明の文（文字）
export const ROLE_OPTION_TEXT_MAX = 100; // 細かい設定の「自由に書く」欄（観点・基準・制約。1行）
export const THINKING_TEXT_MAX = 200; // 考え方を「自分で」書く文（1行。S3.3b）
export const ROLE_TEXT_MAX = 1200; // 依頼の text の頭に入れる役の部分（roleInstructions の出力）
export const ROLE_SEPARATOR = '――――'; // 役の部分と頼む文のあいだの行
export const ROLE_NONE_LABEL = '役なし';
export const CUSTOM_ROLE_DEFAULT_NAME = '自分の役';
// 用意した役の文の終わりの 1 文（依頼の小窓 v2・R3・D7。返事の先頭の「一行の答え・次の一手・どのくらい確か」〔R9 の軽い返事〕とつなぐ）。自分で作る役には入れない
export const LIGHT_LINE = 'はじめに、一行の答え・次の一手・どのくらい確か、を書く。';
const MAX_SEAT = 6; // 巣の席（plan-s3-nest.md N2。bots.ts の MAX_DOCK_BOTS と同じ）

// ---------- 細かい設定の定義（設定の欄の部品と、依頼に入る文） ----------
//   say：依頼に入る文（空ならなにも入れない）。label：設定の欄に出す名前
//   last：依頼に入る文の終わりに回す（「最後に…」の文）

export interface BotRoleChoice {
  value: string | number;
  label: string;
  say: string;
}

export type BotRoleOptionDef =
  | { kind: 'choice'; key: BotRoleOptionKey; label: string; choices: readonly BotRoleChoice[]; default: string | number; last?: true }
  | { kind: 'flag'; key: BotRoleOptionKey; label: string; default: boolean; sayYes: string; sayNo: string; last?: true } // はい／いいえ
  | { kind: 'text'; key: BotRoleOptionKey; label: string; placeholder: string; say: (text: string) => string; sayEmpty: string; last?: true }; // 自由に書く（1行）

const STRICTNESS: BotRoleOptionDef = {
  kind: 'choice',
  key: 'strictness',
  label: 'きびしさ',
  choices: [
    { value: 'gentle', label: 'やさしめ', say: 'やさしめに。' },
    { value: 'normal', label: 'ふつう', say: '' },
    { value: 'strict', label: 'きびしく', say: 'きびしく。' },
  ],
  default: 'normal',
};

// 全部の役に共通の設定（長さ・口調・次の一手）
export const COMMON_ROLE_OPTIONS: readonly BotRoleOptionDef[] = [
  {
    kind: 'choice',
    key: 'length',
    label: '長さ',
    choices: [
      { value: 'short', label: '短め', say: '短めに。' },
      { value: 'normal', label: 'ふつう', say: '' },
      { value: 'long', label: 'くわしく', say: 'くわしく。' },
    ],
    default: 'normal',
  },
  {
    kind: 'choice',
    key: 'tone',
    label: '口調',
    choices: [
      { value: 'desu', label: 'です・ます', say: 'です・ます。' },
      { value: 'casual', label: 'くだけた', say: 'くだけた口調で。' },
    ],
    default: 'desu',
  },
  { kind: 'flag', key: 'nextStep', label: '最後に「次の一手」を付ける', default: false, sayYes: '最後に「次の一手」を1行。', sayNo: '', last: true },
];

// 考え方の段階（S3.3b。設定の欄の並びもこの順。「おまかせ」は台帳に書かない）
//   label：設定の欄の札　hint：札の説明　say：依頼に入る1行（custom は thinkingLine が text から作る）
export const THINKING_AUTO_LABEL = 'おまかせ';
export const BOT_THINKING_LEVELS: readonly { level: BotThinkingLevel; label: string; hint: string; say: string }[] = [
  { level: 'quick', label: 'さっと', hint: '短く直感で', say: '考え方：さっと。短く直感で答えてください。' },
  { level: 'normal', label: 'ふつう', hint: 'ほどよく考えて', say: '考え方：ふつう。ほどよく考えて答えてください。' },
  { level: 'deep', label: 'じっくり', hint: '理由を確かめながら', say: '考え方：じっくり。理由を確かめながら答えてください。' },
  { level: 'steps', label: '段階を踏む', hint: '番号を付けて順に考え、最後に結論', say: '考え方：段階を踏む。番号を付けて順に考え、最後に結論を書いてください。' },
  { level: 'custom', label: '自分で', hint: `考え方を自分で書く（1〜${THINKING_TEXT_MAX} 字）`, say: '' },
];

// ---------- 用意した役（plan-s3-nest.md §4 の表） ----------

export interface BotRoleDef {
  preset: Exclude<BotRolePreset, 'custom'>;
  name: string;
  shape: BotRoleShape;
  blurb: string; // ひとこと（表の文。巣の説明・設定の欄に出す）
  ask: string; // 依頼に入る、ひとことを頼む形にした文
  options: readonly BotRoleOptionDef[]; // 細かい設定（共通の設定は COMMON_ROLE_OPTIONS）
  ownLength?: true; // 共通の「長さ」の代わりに、自分の長さの設定を使う（要約）
}

export const BOT_ROLE_DEFS: readonly BotRoleDef[] = [
  {
    preset: 'research',
    name: '調査',
    shape: 'hexagon',
    blurb: '事実と出典を確かめる',
    ask: '事実と出典を確かめてください。',
    options: [
      {
        kind: 'choice',
        key: 'sources',
        label: '出典の数',
        choices: [
          { value: 0, label: '0', say: '出典は付けなくてかまいません。' },
          { value: 3, label: '3', say: '出典は3つまで。' },
          { value: 5, label: '5', say: '出典は5つまで。' },
        ],
        default: 3,
      },
      {
        kind: 'choice',
        key: 'recency',
        label: '新しさ',
        choices: [
          { value: 'any', label: '指定なし', say: '' },
          { value: 'year', label: '1年以内', say: '1年以内の情報を優先してください。' },
        ],
        default: 'any',
      },
    ],
  },
  {
    preset: 'summary',
    name: '要約',
    shape: 'circle',
    blurb: '短くまとめる',
    ask: '短くまとめてください。',
    ownLength: true,
    options: [
      {
        kind: 'choice',
        key: 'summaryLength',
        label: '長さ',
        choices: [
          { value: 'threeLines', label: '3行', say: '3行で。' },
          { value: 'normal', label: 'ふつう', say: '' },
          { value: 'detailed', label: 'くわしく', say: '要点を落とさず、くわしめに。' },
        ],
        default: 'normal',
      },
      { kind: 'flag', key: 'bullets', label: '箇条書きにする', default: false, sayYes: '箇条書きで。', sayNo: '' },
    ],
  },
  {
    preset: 'idea',
    name: '発想',
    shape: 'triangle',
    blurb: '別の見方・たとえを出す',
    ask: '別の見方やたとえを出してください。',
    options: [
      {
        kind: 'choice',
        key: 'ideas',
        label: '案の数',
        choices: [
          { value: 3, label: '3', say: '案は3つ。' },
          { value: 5, label: '5', say: '案は5つ。' },
        ],
        default: 3,
      },
      {
        kind: 'choice',
        key: 'boldness',
        label: '突飛さ',
        choices: [
          { value: 'normal', label: 'ふつう', say: '' },
          { value: 'bold', label: '大胆', say: '突飛でもよいので、大胆な案も。' },
        ],
        default: 'normal',
      },
    ],
  },
  {
    preset: 'check',
    name: '確認',
    shape: 'diamond',
    blurb: '穴・反論・危ないところを指摘する',
    ask: '穴・反論・危ないところを指摘してください。',
    options: [
      {
        kind: 'choice',
        key: 'stance',
        label: '立場',
        choices: [
          { value: 'opposing', label: '反対側から', say: '反対側の立場から。' },
          { value: 'both', label: '両方から', say: '賛成と反対の両方の立場から。' },
        ],
        default: 'opposing',
      },
      STRICTNESS,
    ],
  },
  {
    preset: 'action',
    name: '実行',
    shape: 'star',
    blurb: '次の一手と手順を出す',
    ask: '次の一手と手順を出してください。',
    options: [
      {
        kind: 'choice',
        key: 'stepDetail',
        label: '手順の細かさ',
        choices: [
          { value: 'rough', label: 'おおまか', say: '手順はおおまかに。' },
          { value: 'normal', label: 'ふつう', say: '' },
          { value: 'detailed', label: '細かく', say: '手順は細かく。' },
        ],
        default: 'normal',
      },
      { kind: 'flag', key: 'deadline', label: '期限を入れる', default: false, sayYes: '手順ごとに期限の目安を入れてください。', sayNo: '' },
    ],
  },
  {
    preset: 'reader',
    name: '読者',
    shape: 'doubleCircle',
    blurb: '初めての人の目でわかりにくさを言う',
    ask: '初めて読む人の目で、わかりにくいところを言ってください。',
    options: [
      {
        kind: 'choice',
        key: 'audience',
        label: '読み手',
        choices: [
          { value: 'beginner', label: '初心者', say: '読み手は初心者。' },
          { value: 'child', label: '子ども', say: '読み手は子ども。' },
          { value: 'expert', label: '専門家', say: '読み手は専門家。' },
        ],
        default: 'beginner',
      },
    ],
  },
  {
    preset: 'synthesis',
    name: '統合と再構築',
    shape: 'square',
    blurb: '簡素化して要素を統合し、全体を組み立て直して、筋の通った誠実な説明にする',
    ask: '簡素化して要素を統合し、全体を組み立て直して、筋の通った誠実な説明にしてください。',
    options: [
      {
        kind: 'choice',
        key: 'simplicity',
        label: '簡素さ',
        choices: [
          { value: 'normal', label: 'ふつう', say: '' },
          { value: 'max', label: 'できるだけ簡素に', say: 'できるだけ簡素に。' },
        ],
        default: 'normal',
      },
      { kind: 'flag', key: 'limits', label: 'わからない点や限界を明記する', default: true, sayYes: 'わからない点や限界は、はっきり書いてください。', sayNo: '' },
      {
        kind: 'choice',
        key: 'checkQuestions',
        label: '確かめの問い',
        choices: [
          { value: 0, label: '0', say: '' },
          { value: 1, label: '1', say: '最後に、確かめの問いを1つ。' },
          { value: 2, label: '2', say: '最後に、確かめの問いを2つ。' },
          { value: 3, label: '3', say: '最後に、確かめの問いを3つ。' },
        ],
        default: 0,
        last: true,
      },
    ],
  },
  {
    preset: 'situation',
    name: '状況説明',
    shape: 'pentagon',
    blurb: 'いま何が起きているか・前提と背景を整理する',
    ask: 'いま何が起きているか、前提と背景を整理してください。',
    options: [
      {
        kind: 'choice',
        key: 'scope',
        label: '範囲',
        choices: [
          { value: 'gist', label: '要点だけ', say: '要点だけ。' },
          { value: 'background', label: '背景まで', say: '背景まで含めて。' },
        ],
        default: 'gist',
      },
      { kind: 'flag', key: 'timeline', label: '時系列にする', default: false, sayYes: '時系列で並べてください。', sayNo: '' },
    ],
  },
  {
    preset: 'inquiry',
    name: '疑問と探求',
    shape: 'drop',
    blurb: '問いを立て、わかっていないことを掘り下げる',
    ask: '問いを立てて、わかっていないことを掘り下げてください。',
    options: [
      {
        kind: 'choice',
        key: 'questions',
        label: '問いの数',
        choices: [
          { value: 3, label: '3', say: '問いは3つ。' },
          { value: 5, label: '5', say: '問いは5つ。' },
        ],
        default: 3,
      },
      {
        kind: 'choice',
        key: 'depth',
        label: '深さ',
        choices: [
          { value: 'wide', label: '広く', say: '広く見渡して。' },
          { value: 'deep', label: '深く', say: '1つずつ深く。' },
        ],
        default: 'wide',
      },
    ],
  },
  {
    preset: 'angle',
    name: '特殊な観点',
    shape: 'halfMoon',
    blurb: 'ふつうと違う立場・分野・時代から見る',
    ask: 'ふつうと違う立場・分野・時代から見てください。',
    options: [
      {
        kind: 'text',
        key: 'angle',
        label: '観点の指定',
        placeholder: '例：江戸時代の商人から（空ならおまかせ）',
        say: (text) => `観点：${text}。`,
        sayEmpty: '観点はおまかせします。',
      },
    ],
  },
  {
    preset: 'value',
    name: '価値判断',
    shape: 'trapezoid',
    blurb: 'よい・わるい・大事さを理由つきで判断する',
    ask: 'よい・わるい・大事さを、理由つきで判断してください。',
    options: [
      { kind: 'text', key: 'criteria', label: '基準', placeholder: '例：初心者が続けやすいか', say: (text) => `基準：${text}。`, sayEmpty: '' },
      { kind: 'flag', key: 'score', label: '点数を付ける', default: false, sayYes: '10点満点の点数も付けてください。', sayNo: '' },
    ],
  },
  {
    preset: 'critique',
    name: '批判と検証',
    shape: 'cross',
    blurb: '主張を疑い、根拠と反例で確かめる',
    ask: '主張を疑い、根拠と反例で確かめてください。',
    options: [STRICTNESS],
  },
  {
    preset: 'practice',
    name: '調整と実践',
    shape: 'gear',
    blurb: '案を現実に合わせて調整し、実際の進め方にする',
    ask: '案を現実に合わせて調整し、実際の進め方にしてください。',
    options: [{ kind: 'text', key: 'constraints', label: '制約', placeholder: '例：週末の2時間・予算1万円', say: (text) => `制約：${text}。`, sayEmpty: '' }],
  },
];

// 自分で作る役（名前・形・説明の文を使う人が決める。細かい設定は共通の3つだけ）
export const CUSTOM_ROLE = {
  preset: 'custom',
  label: '自分で',
  blurb: '説明の文を自分で書く',
  defaultShape: 'hexagon',
} as const satisfies { preset: BotRolePreset; label: string; blurb: string; defaultShape: BotRoleShape };

// 形の名前（設定の欄・席の顔の説明。自分で作る役は、この中から選ぶ）
export const BOT_ROLE_SHAPES: readonly { shape: BotRoleShape; label: string }[] = [
  { shape: 'hexagon', label: '六角形' },
  { shape: 'circle', label: '丸' },
  { shape: 'triangle', label: '三角' },
  { shape: 'diamond', label: 'ひし形' },
  { shape: 'star', label: '星' },
  { shape: 'doubleCircle', label: '二重丸' },
  { shape: 'square', label: '四角' },
  { shape: 'pentagon', label: '五角形' },
  { shape: 'drop', label: '雫' },
  { shape: 'halfMoon', label: '半月' },
  { shape: 'trapezoid', label: '天秤（台形）' },
  { shape: 'cross', label: '十字' },
  { shape: 'gear', label: '歯車' },
];

// 設定の欄で役を並べる5つの組（並びもこの順。自分で作る役は組の外に出す）
//   「確認」と「批判と検証」は近いが、確認は穴や危ないところの指摘、批判と検証は主張そのものを根拠と反例で確かめる
export const BOT_ROLE_GROUPS: readonly { group: BotRoleGroup; label: string; presets: readonly Exclude<BotRolePreset, 'custom'>[] }[] = [
  { group: 'gather', label: 'まとめる・調べる', presets: ['research', 'summary', 'situation'] },
  { group: 'think', label: '考える', presets: ['idea', 'inquiry', 'angle'] },
  { group: 'verify', label: '確かめる', presets: ['check', 'critique', 'value'] },
  { group: 'act', label: '動かす', presets: ['action', 'practice'] },
  { group: 'compose', label: '伝える・組み立てる', presets: ['reader', 'synthesis'] },
];

export function roleDef(preset: unknown): BotRoleDef | undefined {
  return BOT_ROLE_DEFS.find((d) => d.preset === preset);
}

export function isRoleGroup(value: unknown): value is BotRoleGroup {
  return BOT_ROLE_GROUPS.some((g) => g.group === value);
}

export function roleGroupLabel(group: BotRoleGroup): string {
  return BOT_ROLE_GROUPS.find((g) => g.group === group)?.label ?? group;
}

export function roleGroupOf(preset: BotRolePreset): BotRoleGroup | undefined {
  return BOT_ROLE_GROUPS.find((g) => (g.presets as readonly string[]).includes(preset))?.group;
}

export function isRoleShape(value: unknown): value is BotRoleShape {
  return BOT_ROLE_SHAPES.some((s) => s.shape === value);
}

export function roleShapeLabel(shape: BotRoleShape): string {
  return BOT_ROLE_SHAPES.find((s) => s.shape === shape)?.label ?? shape;
}

// 席の下などに出す役の名前（役なしは「役なし」）
export function roleLabel(role: BotRole | null | undefined): string {
  return role?.name || ROLE_NONE_LABEL;
}

// その役で使う細かい設定（役の設定のあとに共通の設定。要約は共通の「長さ」を使わない）
export function roleOptionDefs(preset: BotRolePreset): BotRoleOptionDef[] {
  const def = roleDef(preset);
  const common = COMMON_ROLE_OPTIONS.filter((o) => !(def?.ownLength && o.key === 'length'));
  return [...(def?.options ?? []), ...common];
}

// ---------- きれいにする ----------

const CONTROL_LINE = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g; // 1行の欄：制御文字と、文字の向きを変える文字
const CONTROL_TEXT = /[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g; // 説明の文：改行（\n）とタブだけ残す

// 最初の n 字（サロゲートペアを割らない）
const cut = (text: string, n: number) => [...text].slice(0, n).join('');

// 1行の欄（名前・観点・基準・制約）：制御文字を空白に、空白をまとめて、max 字まで
function cleanLine(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return cut(value.replace(CONTROL_LINE, ' ').replace(/\s+/g, ' ').trim(), max).trim();
}

// 役の説明の文：改行を \n にそろえ、改行とタブ以外の制御文字を消し、3行以上の空行を1つに、ROLE_INSTRUCTIONS_MAX 字まで
export function cleanRoleInstructions(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_TEXT, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cut(text, ROLE_INSTRUCTIONS_MAX).trim();
}

// 考え方の段階を、使える形に直す（知らない段階・形の違うもの・自分で書く文が空のものは null ＝ おまかせ）
//   自分で書く文は1行（制御文字・改行は空白にして、空白をまとめる）で THINKING_TEXT_MAX 字まで。ほかの段階の text は捨てる
export function normalizeThinking(raw: unknown): BotThinking | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const t = raw as Record<string, unknown>;
  const level = BOT_THINKING_LEVELS.find((l) => l.level === t.level)?.level;
  if (!level) return null;
  if (level !== 'custom') return { level };
  const text = cleanLine(t.text, THINKING_TEXT_MAX);
  return text ? { level, text } : null;
}

// 細かい設定：その役で使う項目だけ、決まった値だけを残す（型の違う値・知らない値・知らない項目は捨てる）
function normalizeOptions(preset: BotRolePreset, raw: unknown): BotRoleOptions | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  const options: Record<string, string | number | boolean> = {};
  for (const def of roleOptionDefs(preset)) {
    const value = source[def.key];
    if (def.kind === 'choice') {
      if (def.choices.some((c) => c.value === value)) options[def.key] = value as string | number;
    } else if (def.kind === 'flag') {
      if (typeof value === 'boolean') options[def.key] = value;
    } else {
      const text = cleanLine(value, ROLE_OPTION_TEXT_MAX);
      if (text) options[def.key] = text;
    }
  }
  return Object.keys(options).length ? (options as BotRoleOptions) : undefined;
}

// 台帳・命令から来た役を、使える形に直す（直せなければ null ＝ 役なし）
//   ・用意した役：name と shape は定義のまま（台帳に書いてあっても使わない）。説明の文は付けてもよい
//   ・自分で作る役：名前は ROLE_NAME_MAX 字まで（無ければ「自分の役」）、形は決まった13個から（違えば六角形）
//   ・知らない preset（新しい版で足した役など）：名前か説明の文があれば、自分で作る役として残す。どちらも無ければ null
//   ・説明の文は ROLE_INSTRUCTIONS_MAX 字まで（超えた分は切る）。細かい設定は normalizeOptions、考え方の段階は normalizeThinking
//   ・古い台帳（thinking の無い役）はそのまま読める（おまかせ）
export function normalizeRole(raw: unknown): BotRole | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const def = roleDef(r.preset);
  const instructions = cleanRoleInstructions(r.instructions);
  let role: BotRole;
  if (def) {
    role = { preset: def.preset, name: def.name, shape: def.shape };
  } else {
    const name = cleanLine(r.name, ROLE_NAME_MAX);
    if (!name && !instructions) return null;
    role = { preset: 'custom', name: name || CUSTOM_ROLE_DEFAULT_NAME, shape: isRoleShape(r.shape) ? r.shape : CUSTOM_ROLE.defaultShape };
  }
  const options = normalizeOptions(role.preset, r.options);
  if (options) role.options = options;
  if (instructions) role.instructions = instructions;
  const thinking = normalizeThinking(r.thinking);
  if (thinking) role.thinking = thinking;
  return role;
}

// ---------- 依頼に入れる文 ----------

// 細かい設定の1つを、依頼に入る文に（設定が無ければ既定の値で）
function sayOption(def: BotRoleOptionDef, options: BotRoleOptions): string {
  const value = options[def.key];
  if (def.kind === 'choice') return (def.choices.find((c) => c.value === value) ?? def.choices.find((c) => c.value === def.default))?.say ?? '';
  if (def.kind === 'flag') return (typeof value === 'boolean' ? value : def.default) ? def.sayYes : def.sayNo;
  return typeof value === 'string' && value ? def.say(value) : def.sayEmpty;
}

// 依頼に入る文の並び：ひとこと → 長さ → 役の設定 → 口調 → 「最後に…」の文（§4 の見本「出典は3つまで。です・ます。最後に…」の順）
//   要約の長さ（summaryLength）も「長さ」に数える（要約の設定のいちばん前なので、並びは変わらない）
const isLengthOption = (o: BotRoleOptionDef) => o.key === 'length' || o.key === 'summaryLength';
const sayRank = (o: BotRoleOptionDef) => (isLengthOption(o) ? 0 : o.last ? 3 : o.key === 'tone' ? 2 : 1);

// 考え方の段階の1行（おまかせ・直せないものは空）。自分で書いた文は「考え方：（文）」、終わりに句点が無ければ足す
export function thinkingLine(thinking: BotThinking | null | undefined): string {
  const clean = normalizeThinking(thinking);
  if (!clean) return '';
  if (clean.level !== 'custom') return BOT_THINKING_LEVELS.find((l) => l.level === clean.level)?.say ?? '';
  const text = clean.text ?? '';
  return `考え方：${text}${/[。．.！!？?]$/.test(text) ? '' : '。'}`;
}

// 考え方の段階の名前（設定の欄・説明。おまかせ・直せないものは「おまかせ」）
export function thinkingLabel(thinking: BotThinking | null | undefined): string {
  const clean = normalizeThinking(thinking);
  return clean ? (BOT_THINKING_LEVELS.find((l) => l.level === clean.level)?.label ?? THINKING_AUTO_LABEL) : THINKING_AUTO_LABEL;
}

// 依頼の text の頭に入れる、役の部分（plan-s3-nest.md §4「依頼にどう入れるか」。ROLE_TEXT_MAX 字まで）
//   【あなたの役：調査（巣の席1）】
//   事実と出典を確かめてください。出典は3つまで。です・ます。最後に「次の一手」を1行。
//   （使う人の説明の文）
//   ・考え方の段階（thinking）があれば、「長さ」の次で行を分けて1行入れる（S3.3b）
//       事実と出典を確かめてください。くわしく。
//       考え方：じっくり。理由を確かめながら答えてください。
//       出典は3つまで。です・ます。最後に「次の一手」を1行。
//     おまかせ（thinking が無い）なら、今までどおり1行のまま
//   ・seat：巣の席の番号（1〜6。dock の順）。無ければ席の番号は入れない
//   ・役なし（role が無い・直せない）なら空の文字（依頼に何も入れない。考え方の行も入れない）
//   ・頼む文とのあいだの「――――」は入れない（つなぐのは textWithRole）
//   ・全体で ROLE_TEXT_MAX 字まで（超えたら終わりを切って「…」。切れるのは終わりの説明の文から）
//   ・用意した役は、使う人の説明の文の前に LIGHT_LINE の 1 行を入れる（依頼の小窓 v2・R3。自分で作る役には入れない）
export function roleInstructions(role: BotRole | null | undefined, seat?: number): string {
  const clean = normalizeRole(role);
  if (!clean) return '';
  const def = roleDef(clean.preset);
  const options = clean.options ?? {};
  const seatText = typeof seat === 'number' && Number.isInteger(seat) && seat >= 1 && seat <= MAX_SEAT ? `（巣の席${seat}）` : '';
  const defs = roleOptionDefs(clean.preset).sort((a, b) => sayRank(a) - sayRank(b));
  const say = (list: BotRoleOptionDef[]) => list.map((o) => sayOption(o, options)).filter(Boolean).join('');
  const lead = (def?.ask ?? '') + say(defs.filter(isLengthOption)); // ひとこと＋長さ
  const rest = say(defs.filter((o) => !isLengthOption(o))); // 役の設定・口調・「最後に…」
  const thinking = thinkingLine(clean.thinking);
  const asks = thinking ? [lead, thinking, rest] : [lead + rest];
  const text = [`【あなたの役：${clean.name}${seatText}】`, ...asks, def ? LIGHT_LINE : '', clean.instructions ?? ''].filter(Boolean).join('\n');
  const chars = [...text];
  return chars.length > ROLE_TEXT_MAX ? `${chars.slice(0, ROLE_TEXT_MAX - 1).join('')}…` : text;
}

// 依頼の小窓で直した役の文（R3・D7。botDraftV2 の roleText）：改行を \n にそろえ、改行とタブ以外の制御文字を消して、ROLE_TEXT_MAX 字まで。
//   文字列でなければ空（受け口では「文字列か」を先に見て、無いときは今までどおり roleInstructions を使う）
export function cleanRoleText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return cut(value.replace(/\r\n?/g, '\n').replace(CONTROL_TEXT, '').trim(), ROLE_TEXT_MAX).trim();
}

// 役の部分と頼む文をつなぐ（役なしなら頼む文のまま）。依頼に入れるのは S3.4、設定の欄のプレビューは S3.3
export function textWithRole(text: string, role: BotRole | null | undefined, seat?: number): string {
  const head = roleInstructions(role, seat);
  return head ? `${head}\n${ROLE_SEPARATOR}\n${text}` : text;
}
