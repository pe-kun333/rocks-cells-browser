// モデルの一覧と料金の目安（API を呼ばない。値の import を持たないので、node の確かめ〈ui/checks〉からそのまま読める）
//   client.ts がここから出し直すので、ほかのファイルは今までどおり './client' から読む

// 料金（1M トークンあたりのドル。2026年9月時点。Fable 5.2 は 2026年11月）は、目安の表示にだけ使う
// ⚙ で選べるモデル
export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5（標準）', input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5（速い・安い）', input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
] as const;

// ハイク組（Claude Haiku 5.5）のモデル。⚙ では選べない（ハイク組だけが使う）
//   料金は、1回に読み込む量で2段：10万トークン以下は 入力 $0.10・出力 $0.50、超えると 入力 $0.50・出力 $2.50
//   （読み直しは入力の 0.1倍、書き込みは 1.25倍）。Opus・Sonnet・Fable と違い、断られたときに
//   Anthropic 側で別のモデルが答え直すしくみ（fallbacks）が無い
export const HAIKU_MODEL = { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 } as const;
const HAIKU_LONG_PRICE = { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 } as const;
const HAIKU_LONG_PROMPT = 100_000; // これを超えて読み込んだ回は、高いほうの料金
export type HaikuModelId = typeof HAIKU_MODEL.id;

// いちばん賢いモデル（賢者のキャラ「フェイブル」・ハイク組のフェイブル先生・三人組の先生つきの相談相手。料金は Opus 5.5 の約2倍）
//   Claude Fable 5.2 は、どの口座でも「履歴の検査」をする：考えた跡（thinking）を戻すとき、それより前の
//   system・道具の一覧・メッセージが変わっていると 400 になる。フェイブルの会話では、道具の一覧と指示文を
//   会話の途中で変えず、履歴は後ろに足すだけにする（道具を渡さない1回も、一覧はそのまま tool_choice none で送る）
export const FABLE_MODEL = { id: 'claude-fable-5-2', label: 'Claude Fable 5.2', input: 8, output: 40, cacheRead: 0.2, cacheWrite: 10 } as const;

// 前のフェイブル（Claude Fable 5.1）。5.1 で話し始めた会話は、その会話の間 5.1 のまま続ける
// （モデルは会話ごとに固定。途中で変えると、考えた跡と読み直しの割引が使えなくなる）
export const LEGACY_FABLE_MODEL = { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 } as const;

// 今は新しく選ばないが、料金を数え・名前を出すことがあるモデル。
//   ここに無いモデルは Opus 5.5 の値段で数えてしまうので、使うモデルは足しておく
export const OTHER_PRICED_MODELS = [LEGACY_FABLE_MODEL] as const;

export type ModelId = (typeof MODELS)[number]['id'] | typeof FABLE_MODEL.id | typeof LEGACY_FABLE_MODEL.id;

export interface AiUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface PriceRow {
  id: string;
  label: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

// 料金と名前を引けるモデルの全部（ハイク組は読み込む量で料金が変わるので、costOf は別に見る）
export const PRICED_MODELS: readonly PriceRow[] = [...MODELS, FABLE_MODEL, ...OTHER_PRICED_MODELS, HAIKU_MODEL];

// モデルの名前から料金の行を引く（返事に付いてくる名前は、後ろに日付などが付くことがあるので前方一致）
export function priceRowOf(model: string): PriceRow | undefined {
  return PRICED_MODELS.find((m) => model.startsWith(m.id));
}

// 保存してあったモデルの名前を、使えるモデルなら返す（知らない名前や、前の形で無いときは undefined）
export function knownModelId(value: unknown): ModelId | HaikuModelId | undefined {
  return typeof value === 'string' && PRICED_MODELS.some((m) => m.id === value) ? (value as ModelId | HaikuModelId) : undefined;
}

// 保存してあったキャラの会話の流れが使うモデル。
//   モデルを保存していない前の形で、もう話しているフェイブルは、前のフェイブル（5.1）のまま続ける
//   （5.2 は履歴の検査をするので、前の形の履歴をそのまま 5.2 に送ると 400 になることがある）
export function savedVoiceModel(characterId: string, saved: unknown, hasHistory: boolean): ModelId | HaikuModelId | undefined {
  return knownModelId(saved) ?? (characterId === 'fable' && hasHistory ? LEGACY_FABLE_MODEL.id : undefined);
}

// 目安の料金（ドル）。知らないモデルは Opus 5.5 の値段で数える
export function costOf(usage: AiUsage, model: string): number {
  const price = model.startsWith(HAIKU_MODEL.id) ? haikuPrice(usage) : (priceRowOf(model) ?? MODELS[0]);
  return (
    (usage.input * price.input + usage.output * price.output + usage.cacheRead * price.cacheRead + usage.cacheWrite * price.cacheWrite) /
    1_000_000
  );
}

// ハイク組の料金：1回の頼みごとで読み込んだ量（読み直し・書き込みも含む）が10万トークンを超えたら、高いほうの料金
// （何回分かを足した量では決めない。呼ぶ側は1回ごとに costOf を呼んで足す）
function haikuPrice(usage: AiUsage) {
  return usage.input + usage.cacheRead + usage.cacheWrite > HAIKU_LONG_PROMPT ? HAIKU_LONG_PRICE : HAIKU_MODEL;
}
