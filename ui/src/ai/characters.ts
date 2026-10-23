// 会話に参加できる AI のキャラクターたち（右サイドバーの相棒）
//   ・main   : いつもの相棒 Claude（ブラウザの操作・Web 検索・出来事への反応）
//   ・second : 二人目の相棒（ミツ。役割とモデルを選べる）
//   ・fable  : 博識な賢者（Claude Fable 5.1）
//   ・trio1〜3: ソネット三人組（Claude Sonnet 5.5 が3体。性格がそれぞれ違う）
//   ・tsukushi〜tombo: ハイク組（Claude Haiku 5.5 が3〜6体。名前は季語。係がそれぞれ違う）
// 一度に会話に参加できるのは、Claude も含めて3枠まで（ハイク組は何体でも1枠）
import { type Effort, FABLE_MODEL, HAIKU_MODEL, type HaikuModelId, MODELS, type ModelId } from './client';
import { SECOND_ROLES, type SecondRole } from './prompts';

export type CharacterId = 'main' | 'second' | 'fable' | 'trio1' | 'trio2' | 'trio3' | HaikuId;

export const TRIO_IDS = ['trio1', 'trio2', 'trio3'] as const;
export type TrioId = (typeof TRIO_IDS)[number];
// ハイク組の6体（この順に増える：3体ならツクシ・ホタル・モミジ、4体目ユキ、5体目カエル、6体目トンボ）
export const HAIKU_IDS = ['tsukushi', 'hotaru', 'momiji', 'yuki', 'kaeru', 'tombo'] as const;
export type HaikuId = (typeof HAIKU_IDS)[number];
export const CHARACTER_IDS: readonly CharacterId[] = ['main', 'second', 'fable', 'trio1', 'trio2', 'trio3', ...HAIKU_IDS];
export const MAX_MEMBERS = 3; // 会話のメンバーの枠（ハイク組は何体でも1枠）
export const HAIKU_MIN = 3;
export const HAIKU_MAX = 6;
export const MAIN_NAME = 'Claude';
const NAME_MAX = 12;
const PERSONA_MAX = 300;

// 二人目の相棒の設定（役割は決まった中から選ぶ）
export interface SecondConfig {
  name: string;
  role: SecondRole;
  model: ModelId;
}

// 性格を自由に書けるキャラ（フェイブル・三人組）
export interface Persona {
  name: string;
  persona: string; // 性格と役割（指示文に入る）
}

export interface TrioConfig {
  unitName: string;
  members: [Persona, Persona, Persona];
}

// ハイク組の話し方（4体から）：lead＝モミジが組を代表して答える／groups＝3体までの班が順番に答える
export type HaikuSpeak = 'lead' | 'groups';

export interface HaikuConfig {
  size: number; // 何体で話すか（3〜6）
  speak: HaikuSpeak;
}

// ハイク組の係・名前・性格（今は決まったもの。⚙ では変えない）
export const HAIKU_UNIT_NAME = 'ハイク組';
export const HAIKU_PERSONAS: Record<HaikuId, Persona & { role: string }> = {
  tsukushi: {
    name: 'ツクシ',
    role: '見る係',
    persona:
      '見る係です。春の土筆のように「まず見てみよう」の好奇心で、タブや順路やページを読み、気づいたことを短く言います。明るく素直な話し方。わからないことは、わからないと言います。',
  },
  hotaru: {
    name: 'ホタル',
    role: '調べ係',
    persona:
      '調べ係です。暗いところを照らす蛍のように、根拠を調べて出典を添えます。静かで手短な話し方。数字や新しい話は、うのみにせず確かめます。',
  },
  momiji: {
    name: 'モミジ',
    role: 'まとめ係',
    persona:
      'まとめ係です。手のひら形の紅葉のように、みんなの話を受け取って、要点と「今日の一歩」にまとめます。やさしく落ち着いた話し方。組が4体以上のときは、組を代表して話すことがあります。',
  },
  yuki: {
    name: 'ユキ',
    role: '確かめ係',
    persona:
      '確かめ係です。雪の結晶のように冷静で正確。数字・日付・答えを、ページや出典と照らして確かめます。迷ったら、迷っていると正直に言います。',
  },
  kaeru: {
    name: 'カエル',
    role: '記録係',
    persona:
      '記録係です。古池の句のように、出来事や考えを一言で書き留めます。残しておくとよいことがあれば、メモに残すことを提案します（残すのは使う人の確認のあと）。',
  },
  tombo: {
    name: 'トンボ',
    role: '見回り係',
    persona:
      '見回り係です。トンボの大きな目のように、一度にたくさんを見渡します。タブの一覧や順路をざっと見て、全体の様子や、手分けするときの下ごしらえを伝えます。',
  },
};

export const DEFAULT_HAIKU: HaikuConfig = { size: HAIKU_MIN, speak: 'lead' };

// キャラたちの設定と、今の会話のメンバー
export interface Cast {
  members: CharacterId[]; // 会話に参加しているキャラ（1〜3体。並びは CHARACTER_IDS の順）
  banter: boolean; // 掛け合い：だれかが答えたら、ほかのメンバーがひとことずつ返す
  second: SecondConfig;
  fable: Persona;
  trio: TrioConfig;
  haiku: HaikuConfig;
}

export const DEFAULT_SECOND: SecondConfig = { name: 'ミツ', role: 'tsukkomi', model: MODELS[0].id };

export const DEFAULT_FABLE: Persona = {
  name: 'フェイブル',
  persona:
    '博識な賢者です。急がずにじっくり考え、物事の本質や背景、意外なつながりを見抜いて、わかりやすい言葉で伝えます。ほかのキャラクターの話を受けて全体をまとめ直したり、一段深い問いを投げたりするのが得意です。穏やかで落ち着いた、ていねいな話し方。不確かなことは、正直にそう言います。',
};

export const DEFAULT_TRIO: TrioConfig = {
  unitName: 'ソネット三人組',
  members: [
    {
      name: 'ルカ',
      persona:
        '好奇心いっぱいの質問役です。明るく元気で、少しせっかち。「なんで？」「それってつまり？」と素朴な疑問を投げ、ほかの人が見落とした意外なところに目をつけて話を広げます。知ったかぶりはしません。',
    },
    {
      name: 'ジン',
      persona:
        '慎重で冷静な確かめ役です。少し辛口で皮肉屋。根拠・数字・出典を気にして、うのみにせず、穴や反例を指摘します。ただし言いっぱなしにせず、どうすれば確かめられるかも添えます。',
    },
    {
      name: 'モモ',
      persona:
        'やさしい実践役です。相手の気持ちに寄り添い、話を「じゃあ、今日から何をする？」という小さな一歩にまとめます。三人の意見が割れたら、それぞれのいいところを拾ってつなぎます。',
    },
  ],
};

export function defaultCast(): Cast {
  return {
    members: ['main'],
    banter: false,
    second: { ...DEFAULT_SECOND },
    fable: { ...DEFAULT_FABLE },
    trio: { unitName: DEFAULT_TRIO.unitName, members: DEFAULT_TRIO.members.map((p) => ({ ...p })) as TrioConfig['members'] },
    haiku: { ...DEFAULT_HAIKU },
  };
}

export function isCharacterId(value: unknown): value is CharacterId {
  return typeof value === 'string' && (CHARACTER_IDS as readonly string[]).includes(value);
}

export function isTrio(id: CharacterId): id is TrioId {
  return (TRIO_IDS as readonly string[]).includes(id);
}

export function isHaiku(id: unknown): id is HaikuId {
  return typeof id === 'string' && (HAIKU_IDS as readonly string[]).includes(id);
}

// メンバーの中のハイク組（会話に入っていなければ空）
export function teamOf(members: readonly CharacterId[]): HaikuId[] {
  return members.filter(isHaiku);
}

// メンバーが使っている枠の数（ハイク組は何体でも1枠）
export function slotsOf(members: readonly CharacterId[]): number {
  return members.filter((id) => !isHaiku(id)).length + (members.some(isHaiku) ? 1 : 0);
}

// ハイク組だけで話しているか
export function isHaikuOnly(members: readonly CharacterId[]): boolean {
  return members.length > 0 && members.every(isHaiku);
}

export function clampHaikuSize(size: unknown): number {
  return typeof size === 'number' && Number.isFinite(size) ? Math.min(HAIKU_MAX, Math.max(HAIKU_MIN, Math.round(size))) : DEFAULT_HAIKU.size;
}

// メンバーを決まった順に並べ、重複と上限を整える（空なら Claude）。
// ハイク組が入っていれば、組の人数（haikuSize）の分だけ、決まった順に入れる（1枠に数える）
export function normalizeMembers(members: readonly unknown[], haikuSize: number = DEFAULT_HAIKU.size): CharacterId[] {
  const team = members.some(isHaiku) ? HAIKU_IDS.slice(0, clampHaikuSize(haikuSize)) : [];
  const others = CHARACTER_IDS.filter((id) => !isHaiku(id) && members.includes(id)).slice(0, MAX_MEMBERS - (team.length > 0 ? 1 : 0));
  const picked = [...others, ...team];
  return picked.length > 0 ? picked : ['main'];
}

// 「みんなへ」・掛け合いで、ハイク組から答える体（3体までは全員。4体からは話し方の設定で）
//   lead：モミジが代表／groups：3体までの班（4体は2・2、5体は3・2、6体は3・3）の、turn 番目の班
export function teamSpeakers(team: readonly HaikuId[], speak: HaikuSpeak, turn: number): HaikuId[] {
  if (team.length <= 3) return [...team];
  if (speak === 'lead') return [team.includes('momiji') ? 'momiji' : team[0]];
  const groups = teamGroups(team);
  return groups[((turn % groups.length) + groups.length) % groups.length];
}

export function teamGroups(team: readonly HaikuId[]): HaikuId[][] {
  if (team.length <= 3) return [[...team]];
  const first = Math.ceil(team.length / 2);
  return [team.slice(0, first), team.slice(first)];
}

export function nameOf(cast: Cast, id: CharacterId): string {
  switch (id) {
    case 'main':
      return MAIN_NAME;
    case 'second':
      return cast.second.name;
    case 'fable':
      return cast.fable.name;
    default:
      if (isHaiku(id)) return HAIKU_PERSONAS[id].name;
      return cast.trio.members[TRIO_IDS.indexOf(id)].name;
  }
}

// 性格と役割（指示文に入る文。Claude は無し）
export function personaOf(cast: Cast, id: CharacterId): string {
  switch (id) {
    case 'main':
      return '';
    case 'second':
      return SECOND_ROLES[cast.second.role].text;
    case 'fable':
      return cast.fable.persona;
    default:
      if (isHaiku(id)) return HAIKU_PERSONAS[id].persona;
      return cast.trio.members[TRIO_IDS.indexOf(id)].persona;
  }
}

// 画面に出す短い説明（性格の最初の一文）
export function blurbOf(cast: Cast, id: CharacterId): string {
  if (id === 'main') return 'いつもの相棒（ブラウザの操作・Web 検索）';
  if (id === 'second') return SECOND_ROLES[cast.second.role].label;
  if (isHaiku(id)) return HAIKU_PERSONAS[id].role;
  return firstSentence(personaOf(cast, id));
}

// 答えるモデル（Claude と二人目は ⚙ で選ぶ。フェイブルは Fable 5.1、三人組は Sonnet 5.5、ハイク組は Haiku 5.5）
export function modelOf(cast: Cast, id: CharacterId, mainModel: ModelId): ModelId | HaikuModelId {
  if (id === 'main') return mainModel;
  if (id === 'second') return cast.second.model;
  if (id === 'fable') return FABLE_MODEL.id;
  if (isHaiku(id)) return HAIKU_MODEL.id;
  return 'claude-sonnet-5-5';
}

// キャラごとの道具（ブラウザの操作〈開く・閉じる・休眠など〉は Claude だけ）
//   client：このパソコンで動かす道具（⚙ の「ブラウザの操作を任せる」が入っているとき）
//   search・fetch：Web 検索・Web 取得（⚙ の「Web 検索を使う」が入っているとき）
//   confirm：使う前に、使う人に確認する道具
//   どれも、そのキャラがその会話で初めて話すときに決め、その会話の間は変えない（前の部分の読み直しの割引のため）
export const CHARACTER_TOOLS: Partial<Record<CharacterId, { client: string[]; search?: boolean; fetch?: boolean; confirm?: string[] }>> = {
  fable: { client: ['read_tab', 'list_tabs', 'list_routes', 'list_memories', 'vocab_status', 'list_topics', 'save_insight'], search: true, fetch: true },
  trio1: { client: ['list_tabs', 'list_routes'] }, // ルカ：見るだけ
  trio2: { client: [], search: true }, // ジン：事実を確かめる
  trio3: { client: ['set_reminder', 'add_vocab_card'], confirm: ['set_reminder', 'add_vocab_card'] }, // モモ：確認してから
  tsukushi: { client: ['list_tabs', 'list_routes', 'read_tab'] }, // ツクシ：見るだけ（ほかのタブも読む）
  hotaru: { client: [], search: true }, // ホタル：Web 検索で調べる
  momiji: { client: ['set_reminder', 'add_vocab_card'], confirm: ['set_reminder', 'add_vocab_card'] }, // モミジ：確認してから
  yuki: { client: [] }, // ユキ：話すだけ（確かめの道具は、あとの段階で）
  kaeru: { client: ['list_tabs', 'save_insight'] }, // カエル：考察を残す（使う人に確認してから。タブのメモに残すときは、タブの一覧で id を見る）
  tombo: { client: ['list_tabs', 'list_routes'] }, // トンボ：見るだけ
};

// 道具の名前（指示文に書く、できること）
export const TOOL_ABILITIES: Record<string, string> = {
  read_tab: 'ほかのタブの本文を読む',
  list_tabs: 'タブの一覧を見る',
  list_routes: '順路（リンクをたどった道）を見る',
  list_memories: '相棒が覚えていることを見る',
  vocab_status: '単語帳の様子を見る',
  list_topics: '情報収集のトピックを見る',
  save_insight: '考察をメモのセル・タブのメモ・スレッドに残す（使う人に確認してから）',
  web_search: 'Web 検索',
  web_fetch: 'Web のページを取得して読む',
  set_reminder: 'リマインダーを置く（使う人に確認してから）',
  add_vocab_card: '単語帳にカードを入れる（使う人に確認してから）',
};

// 考える深さ：フェイブル（賢者）と三人組（Sonnet 5.5）は high、Claude と二人目とハイク組は medium
//   1つの会話の中では変えない（変えると、前の部分の読み直しの割引が切れる）
export function effortOf(id: CharacterId): Effort {
  return id === 'fable' || isTrio(id) ? 'high' : 'medium';
}

// 「三人組だけ」で話しているか
export function isTrioOnly(members: readonly CharacterId[]): boolean {
  return members.length === TRIO_IDS.length && TRIO_IDS.every((id) => members.includes(id));
}

export function firstSentence(text: string): string {
  const end = text.indexOf('。');
  const head = end >= 0 ? text.slice(0, end) : text;
  return head.length > 40 ? `${head.slice(0, 40)}…` : head;
}

export function cleanName(value: string, fallback: string): string {
  return [...value.trim()].slice(0, NAME_MAX).join('') || fallback;
}

export function cleanPersona(value: string, fallback: string): string {
  return [...value.trim()].slice(0, PERSONA_MAX).join('') || fallback;
}

// 保存してあった設定を読む（前の形「二人目を出す・掛け合い」も読む）
export function parseCast(saved: Record<string, unknown>): Cast {
  const cast = defaultCast();
  const second = isObject(saved.second) ? saved.second : null;
  if (second) {
    cast.second = {
      name: typeof second.name === 'string' ? cleanName(second.name, DEFAULT_SECOND.name) : DEFAULT_SECOND.name,
      role: typeof second.role === 'string' && second.role in SECOND_ROLES ? (second.role as SecondRole) : DEFAULT_SECOND.role,
      model: MODELS.some((m) => m.id === second.model) ? (second.model as ModelId) : DEFAULT_SECOND.model,
    };
  }
  cast.fable = parsePersona(saved.fable, DEFAULT_FABLE);
  if (isObject(saved.trio)) {
    const t = saved.trio;
    const list = Array.isArray(t.members) ? t.members : [];
    cast.trio = {
      unitName: typeof t.unitName === 'string' ? cleanName(t.unitName, DEFAULT_TRIO.unitName) : DEFAULT_TRIO.unitName,
      members: DEFAULT_TRIO.members.map((p, i) => parsePersona(list[i], p)) as TrioConfig['members'],
    };
  }
  if (isObject(saved.haiku)) {
    cast.haiku = {
      size: clampHaikuSize(saved.haiku.size),
      speak: saved.haiku.speak === 'groups' ? 'groups' : 'lead',
    };
  }
  if (Array.isArray(saved.members)) {
    cast.members = normalizeMembers(saved.members, cast.haiku.size);
  } else if (second?.enabled === true) {
    cast.members = ['main', 'second']; // 前の形：二人目を出していた
  }
  cast.banter = typeof saved.banter === 'boolean' ? saved.banter : second?.banter === true;
  return cast;
}

function parsePersona(value: unknown, fallback: Persona): Persona {
  if (!isObject(value)) return { ...fallback };
  return {
    name: typeof value.name === 'string' ? cleanName(value.name, fallback.name) : fallback.name,
    persona: typeof value.persona === 'string' ? cleanPersona(value.persona, fallback.persona) : fallback.persona,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
