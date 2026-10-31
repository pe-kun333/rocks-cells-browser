// 六角で見る（動画の区間セル）の区間を繰り返す段取り（plan-reader-video の V3a。段 V3a）
//   ・回し方・回数・休み・速さの段上げ・のりしろの形を整える（cleanLoopOptions）
//   ・区間と回し方から、再生する順の一覧（段取り）を作る（planLoop）。まぜる順は seed から決まる（shuffleOrder）
//   ・保存してある名前つきの組を読む（parseLoopSets）
//   ・純粋な関数だけ（DOM・window・時計・Math.random を使わない）。ほかのファイルを読み込まない

// 回し方：順に一周（を回数だけ）・一つずつ回数だけ・毎回まぜて一周（を回数だけ）
export type LoopMode = 'seq' | 'each' | 'shuffle';

// 回し方の設定
export interface LoopOptions {
  mode: LoopMode;
  times: number; // 回数（1〜10 の整数）
  gap: number; // 区間と区間のあいだの休み（秒。0〜10、0.5 秒きざみ）
  steps: boolean; // 速さの段上げ（くり返すたびに 0.75 → 1 → 1.25）
  pad: number; // のりしろ（区間の前後に足す秒。0〜3、0.5 秒きざみ）
}

// 再生する区間（秒）
export interface LoopSpan {
  start: number; // 秒
  end: number;
}

// 段取りの一段（一区間の一回分）
export interface LoopStep {
  span: number; // 元の spans の何番目か
  start: number; // のりしろを足した始まり（秒）
  end: number; // のりしろを足した終わり（秒）
  rate: number | null; // 速さ（段上げのときだけ。無ければ null ＝ 今の速さのまま）
  rep: number; // 何回目か（0 から）
  gapAfter: number; // このあとの休み（秒。最後の段は 0）
}

// 名前つきの組（回し方と、マスの指紋）
export interface LoopSet extends LoopOptions {
  name: string; // 組の名前（1〜30 字）
  keys: string[]; // マスの指紋（1〜30 個）
}

// 数の上下限（回数・休み・のりしろ・段数）
export const LOOP_LIMITS = { timesMin: 1, timesMax: 10, gapMax: 10, padMax: 3, steps: 400 } as const;
// 速さの段上げの並び（回の番号 0 から順に使い、足りない回は最後の値）
export const STEP_RATES = [0.75, 1, 1.25] as const;
// 既定の回し方
export const DEFAULT_LOOP: LoopOptions = { mode: 'seq', times: 3, gap: 0, steps: false, pad: 0 };
// 名前つきの組の上限（組の数・一組のマスの指紋の数）
export const MAX_LOOP_SETS = 20;
export const MAX_SET_KEYS = 30;

// 組の名前の字数の上限（コードポイント）と、マスの指紋の字数の上限
const SET_NAME_MAX = 30;
const SET_KEY_MAX = 40;

// 秒・回数などとして使える数か（有限の数だけ通す）
const isNum = (raw: unknown): raw is number => typeof raw === 'number' && Number.isFinite(raw);

// 数を範囲に収める
const clamp = (x: number, min: number, max: number): number => Math.min(max, Math.max(min, x));

// 数を範囲に収めてから 0.5 きざみに丸める（休みとのりしろ用）
const halfStep = (x: number, max: number): number => Math.round(clamp(x, 0, max) * 2) / 2;

// 回し方の形を整える（形の合わないものは DEFAULT_LOOP で埋める。オブジェクトでなければ既定の写し）
export function cleanLoopOptions(raw: unknown): LoopOptions {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_LOOP };
  const o = raw as Partial<Record<keyof LoopOptions, unknown>>;
  // 回し方は三つのどれかでなければ順に一周
  const mode: LoopMode = o.mode === 'each' ? 'each' : o.mode === 'shuffle' ? 'shuffle' : 'seq';
  // 回数は四捨五入して 1〜10 に収める（数でなければ既定）
  const times = isNum(o.times)
    ? clamp(Math.round(o.times), LOOP_LIMITS.timesMin, LOOP_LIMITS.timesMax)
    : DEFAULT_LOOP.times;
  // 休みは 0〜10 に収めて 0.5 秒きざみ（数でなければ既定）
  const gap = isNum(o.gap) ? halfStep(o.gap, LOOP_LIMITS.gapMax) : DEFAULT_LOOP.gap;
  // 速さの段上げは true のときだけ
  const steps = o.steps === true;
  // のりしろは 0〜3 に収めて 0.5 秒きざみ（数でなければ既定）
  const pad = isNum(o.pad) ? halfStep(o.pad, LOOP_LIMITS.padMax) : DEFAULT_LOOP.pad;
  return { mode, times, gap, steps, pad };
}

// まぜる順の乱数（mulberry32。seed から決まる 0 以上 1 未満の数を次々に返す）
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 0〜n-1 を、seed から決まる順に並べ替えた配列（同じ seed なら同じ順。n が 0 以下・有限でなければ []。整数でない正の数は切り捨て）
export function shuffleOrder(n: number, seed: number): number[] {
  if (!isNum(n) || n < 1) return [];
  const count = Math.floor(n);
  const order = Array.from({ length: count }, (_, i) => i);
  const rand = mulberry32(seed);
  // 後ろから一つずつ、まだ決まっていない範囲の中から選んで入れ替える（Fisher–Yates）
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

// 使える区間（始まり・終わりが有限の数で 0 <= start < end のもの）を、元の番号つきで取り出す
interface UsableSpan {
  span: number; // 元の spans の何番目か
  start: number;
  end: number;
}

function usableSpans(spans: readonly LoopSpan[]): UsableSpan[] {
  const out: UsableSpan[] = [];
  if (!Array.isArray(spans)) return out;
  for (let i = 0; i < spans.length; i++) {
    const raw: unknown = spans[i];
    if (typeof raw !== 'object' || raw === null) continue;
    const { start, end } = raw as { start?: unknown; end?: unknown };
    if (isNum(start) && isNum(end) && 0 <= start && start < end) out.push({ span: i, start, end });
  }
  return out;
}

// 区間と回し方から、再生する順の段取りを作る（純粋。seed はまぜる順の種、duration があればその秒で終わりを切る）
export function planLoop(spans: readonly LoopSpan[], options: unknown, seed = 1, duration?: number): LoopStep[] {
  const opts = cleanLoopOptions(options);
  const usable = usableSpans(spans);
  if (usable.length === 0) return [];
  const out: LoopStep[] = [];
  // 一段を足す（上限の段数に達していれば足さない。のりしろを足し、duration があれば終わりをそこで切る）
  const add = (u: UsableSpan, rep: number): void => {
    if (out.length >= LOOP_LIMITS.steps) return;
    const end = u.end + opts.pad;
    out.push({
      span: u.span,
      start: Math.max(0, u.start - opts.pad),
      end: isNum(duration) && duration > 0 ? Math.min(end, duration) : end,
      rate: opts.steps ? STEP_RATES[Math.min(rep, STEP_RATES.length - 1)] : null,
      rep,
      gapAfter: opts.gap,
    });
  };
  // 回の番号（0 から回数の手前まで）
  const reps = Array.from({ length: opts.times }, (_, i) => i);
  if (opts.mode === 'each') {
    // 一つずつ：区間ごとに、回数だけくり返す
    for (const u of usable) for (const rep of reps) add(u, rep);
  } else if (opts.mode === 'shuffle') {
    // まぜて一周：回ごとに、区間の順を shuffleOrder(区間の数, seed + 回の番号) の順にする
    for (const rep of reps) for (const k of shuffleOrder(usable.length, seed + rep)) add(usable[k], rep);
  } else {
    // 順に一周：回ごとに、区間を元の順に通す
    for (const rep of reps) for (const u of usable) add(u, rep);
  }
  // 最後の段の休みは 0（上限で切ったときも、切った後の最後の段）
  if (out.length > 0) out[out.length - 1].gapAfter = 0;
  return out;
}

// 組の名前を整える（空白をまとめて前後を取り、30 字〈コードポイント〉まで。文字列でなければ、空なら null）
function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name === '') return null;
  return Array.from(name).slice(0, SET_NAME_MAX).join('');
}

// マスの指紋を整える（空でなく 40 字以下の文字列だけ。同じものは一つに、30 個まで）
function cleanKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const key of raw as unknown[]) {
    if (keys.length >= MAX_SET_KEYS) break;
    if (typeof key !== 'string' || key === '' || Array.from(key).length > SET_KEY_MAX) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

// 保存してある名前つきの組を読む（配列でなければ []。名前・指紋の形が合わない項目は捨て、同じ名前は後のものを捨て、20 組まで）
export function parseLoopSets(raw: unknown): LoopSet[] {
  if (!Array.isArray(raw)) return [];
  const sets: LoopSet[] = [];
  const names = new Set<string>();
  for (const item of raw as unknown[]) {
    if (sets.length >= MAX_LOOP_SETS) break;
    if (typeof item !== 'object' || item === null) continue;
    const { name: rawName, keys: rawKeys } = item as { name?: unknown; keys?: unknown };
    const name = cleanName(rawName);
    if (name === null || names.has(name)) continue;
    const keys = cleanKeys(rawKeys);
    if (keys.length === 0) continue;
    names.add(name);
    sets.push({ name, keys, ...cleanLoopOptions(item) });
  }
  return sets;
}
