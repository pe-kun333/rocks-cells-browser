// 三人組の先生つき（Anthropic の advisor 道具）。計画は docs/plan-trio-advisor.md
//   ・三人組の体（Claude Sonnet 5.5）が、返事を書く途中で、Anthropic 側で先生（Fable）に作戦を見てもらう。
//     助言は暗号で返り、画面には出せない。出せるのは、見てもらった事実・回数・料金・失敗の理由だけ
//   ・ハイク組の「先生に相談」（advisor.ts。アプリが取り次ぎ、助言カードが出る）とは別のしくみ
//   ・道具の定義（相談相手・回数・長さ・caching）は会話の最初に決めて、その会話の間は変えない
//     （変えると tools の編集になり、履歴の考えた跡が無効になって、API が 400 を返すことがある）
//   このファイルは API を呼ばない。値の import を持たないので、node の確かめ（ui/checks）からそのまま読める
import type Anthropic from '@anthropic-ai/sdk';
import type { AiUsage } from './prices';

// キャラの道具の名前の一覧（SavedVoice.tools）に入れる名前。API の道具の名前でもある
export const TRIO_ADVISOR = 'advisor';

// 会話ごとに保存する、道具の定義
export interface AdvisorDef {
  model: string; // 相談相手のモデル
  maxUses: number; // 1つの返事で見てもらえる回数
  maxTokens: number; // 先生の1回の出力の上限（考える分も含む。最小 1024）
  // 先生の側の読み直しの割引（1会話で3回以上見てもらうなら得。途中で変えられない）。
  //   今の料金の表（prices.ts）の書き込みの単価は 5 分のもの。'1h' は書き込みが高い（Fable 5.2 で $16）ので、
  //   caching を使い始める前に、1 時間の書き込みを別の単価で数えるようにする（計画書 P5）
  caching: null | { ttl: '5m' | '1h' };
}

// 既定（計画書 §6 の 2・5・6 の仮の答え）。相談相手は prices.ts の FABLE_MODEL と同じ（ui/checks が照らす）。
//   会話ごとに保存した定義を送るので、あとでここを変えても、始まっている会話の道具は変わらない
export const DEFAULT_ADVISOR_DEF: AdvisorDef = { model: 'claude-fable-5-2', maxUses: 1, maxTokens: 2048, caching: null };

// API に送る道具。caching が null のときは項目ごと入れない（いつも同じ形で送る）
export function advisorTool(def: AdvisorDef): Anthropic.Beta.BetaAdvisorTool20260301 {
  return {
    type: 'advisor_20260301',
    name: TRIO_ADVISOR,
    model: def.model,
    max_uses: def.maxUses,
    max_tokens: def.maxTokens,
    ...(def.caching ? { caching: { type: 'ephemeral' as const, ttl: def.caching.ttl } } : {}),
  };
}

// 保存してあった定義を読む（形が違えば null。数字は、範囲の外なら既定に戻す）
export function parseAdvisorDef(value: unknown): AdvisorDef | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.model !== 'string' || !v.model) return null;
  const whole = (n: unknown, fallback: number, min: number, max: number) => (typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max ? n : fallback);
  const caching = typeof v.caching === 'object' && v.caching !== null ? (v.caching as Record<string, unknown>).ttl : null;
  return {
    model: v.model,
    maxUses: whole(v.maxUses, DEFAULT_ADVISOR_DEF.maxUses, 1, 10),
    maxTokens: whole(v.maxTokens, DEFAULT_ADVISOR_DEF.maxTokens, 1024, 32_000),
    caching: caching === '5m' || caching === '1h' ? { ttl: caching } : null,
  };
}

// ---------- 返事から読む ----------

// 返事の内容から、先生を呼んだ回数・結果が届いた回数・失敗の理由・助言が上限で切れた回数を拾う
//   呼んだ：server_tool_use（name が advisor）。結果：advisor_tool_result（暗号・平文・失敗の3つの形）。
//   返事が途中で止まって送り直すと（pause_turn・自分の道具と同じ回）、呼んだブロックと結果のブロックが
//   別々の返事に分かれることがある。1つの発言の中の返事どうしは mergeAdvisorCalls で足してから使う
export interface AdvisorCalls {
  calls: number; // 先生を呼んだ回数
  done: number; // 助言が届いた回数（失敗でない結果）
  errors: string[]; // 失敗の理由（error_code）
  truncated: number; // 届いた助言のうち、上限（max_tokens）で切れた回数
  pending: number; // 呼んだが、結果がまだ無い回数
}

export function readAdvisorCalls(content: readonly unknown[] | null | undefined): AdvisorCalls {
  const out: AdvisorCalls = { calls: 0, done: 0, errors: [], truncated: 0, pending: 0 };
  for (const block of content ?? []) {
    if (typeof block !== 'object' || block === null) continue;
    const b = block as Record<string, unknown>;
    if (b.type === 'server_tool_use' && b.name === TRIO_ADVISOR) out.calls++;
    if (b.type !== 'advisor_tool_result') continue;
    const result = (typeof b.content === 'object' && b.content !== null ? b.content : {}) as Record<string, unknown>;
    if (result.type === 'advisor_tool_result_error') {
      out.errors.push(typeof result.error_code === 'string' ? result.error_code : 'unknown');
    } else {
      out.done++;
      if (result.stop_reason === 'max_tokens') out.truncated++;
    }
  }
  out.pending = Math.max(0, out.calls - out.done - out.errors.length);
  return out;
}

// 1つの発言の中の、いくつかの返事の分を足す（呼んだブロックと結果が、別々の返事に分かれていても合う）
export function mergeAdvisorCalls(list: readonly AdvisorCalls[]): AdvisorCalls {
  const out: AdvisorCalls = { calls: 0, done: 0, errors: [], truncated: 0, pending: 0 };
  for (const item of list) {
    out.calls += item.calls;
    out.done += item.done;
    out.errors.push(...item.errors);
    out.truncated += item.truncated;
  }
  out.pending = Math.max(0, out.calls - out.done - out.errors.length);
  return out;
}

// usage.iterations から、相談相手（advisor_message）の使用量を足す。最上位の usage は実行役の分だけなので、ここを別に数える
//   項目が無い・形が違うものは 0 として読む（本物の返事の形は P0 で確かめる。計画書 §7）
export interface AdvisorUsage {
  usage: AiUsage;
  model: string | null; // 相談相手のモデル（無ければ null）
  count: number; // advisor_message の数
}

export function readAdvisorUsage(iterations: unknown): AdvisorUsage {
  const out: AdvisorUsage = { usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, model: null, count: 0 };
  if (!Array.isArray(iterations)) return out;
  const n = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);
  for (const item of iterations) {
    if (typeof item !== 'object' || item === null) continue;
    const it = item as Record<string, unknown>;
    if (it.type !== 'advisor_message') continue;
    out.count++;
    out.usage.input += n(it.input_tokens);
    out.usage.output += n(it.output_tokens);
    out.usage.cacheRead += n(it.cache_read_input_tokens);
    out.usage.cacheWrite += n(it.cache_creation_input_tokens);
    if (typeof it.model === 'string' && !out.model) out.model = it.model;
  }
  return out;
}

// 1つの返事（1回の request）から読んだ、先生の分。料金は呼ぶ側（client.ts）が costOf で付ける
export interface AdvisorReading extends AdvisorCalls {
  usage: AiUsage; // 相談相手の使用量
  model: string | null; // 相談相手のモデル（使用量に名前があればそれ。無ければ、送った道具の定義のモデル）
  // 助言が届いた（か、失敗した）のに、使用量が読めなかった。料金を数えられていない
  // （usage.iterations の形は本物の返事でまだ確かめていない。こうなったら画面と記録に出す）
  unpriced: boolean;
}

export function readAdvisor(content: readonly unknown[] | null | undefined, iterations: unknown, sentModel: string | null): AdvisorReading {
  const calls = readAdvisorCalls(content);
  const read = readAdvisorUsage(iterations);
  return {
    ...calls,
    usage: read.usage,
    model: read.count > 0 ? (read.model ?? sentModel) : null,
    unpriced: calls.done > 0 && read.count === 0,
  };
}

// ストリームの出来事（content_block_start のブロック）から、先生のようすを読む
//   asking：先生を呼んだ／done：結果が届いた／failed：失敗の結果が届いた／null：先生と関係ないブロック
export type AdvisorSignal = 'asking' | 'done' | 'failed';

export function advisorSignalOf(block: unknown): AdvisorSignal | null {
  if (typeof block !== 'object' || block === null) return null;
  const b = block as Record<string, unknown>;
  if (b.type === 'server_tool_use' && b.name === TRIO_ADVISOR) return 'asking';
  if (b.type !== 'advisor_tool_result') return null;
  const result = (typeof b.content === 'object' && b.content !== null ? b.content : {}) as Record<string, unknown>;
  return result.type === 'advisor_tool_result_error' ? 'failed' : 'done';
}

// ---------- 今日、見てもらった回数（このパソコンの時計で。0時に戻る） ----------
export const DEFAULT_TRIO_ADVISOR_LIMIT = 5;
const COUNT_KEY = 'honeycomb.ai.trioAdvisor';

export function dayKey(now = new Date()): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

// 保存してある文字列から、今日の回数を読む（日付が違えば 0）
export function countFrom(saved: string | null, today: string): number {
  try {
    const v: unknown = JSON.parse(saved ?? 'null');
    if (typeof v !== 'object' || v === null) return 0;
    const s = v as Record<string, unknown>;
    return s.date === today && typeof s.count === 'number' && Number.isFinite(s.count) && s.count > 0 ? Math.floor(s.count) : 0;
  } catch {
    return 0;
  }
}

export function trioAdvisorCount(): number {
  try {
    return countFrom(localStorage.getItem(COUNT_KEY), dayKey());
  } catch {
    return 0;
  }
}

export function addTrioAdvisorCount(delta: number) {
  try {
    localStorage.setItem(COUNT_KEY, JSON.stringify({ date: dayKey(), count: Math.max(0, trioAdvisorCount() + delta) }));
  } catch {
    // 保存できなくても動作は続ける
  }
}

export function trioAdvisorRemaining(limit: number): number {
  return Math.max(0, limit - trioAdvisorCount());
}

// ---------- 画面に出す文 ----------
const ERROR_TEXT: Record<string, string> = {
  max_uses_exceeded: 'この返事では、もう見てもらっていた',
  too_many_requests: '先生が混んでいた',
  overloaded: '先生が混んでいた',
  unavailable: '先生につながらなかった',
  execution_time_exceeded: '先生の時間が足りなかった',
  prompt_too_long: '会話が長すぎて、先生が読めなかった',
  model_not_found: '先生のモデルが見つからなかった',
};

// 失敗の理由を、使う人に伝わる言葉に（「先生は使えなかった（…）」の中に入れる）
export function advisorErrorText(code: string): string {
  return ERROR_TEXT[code] ?? `理由：${code}`;
}

// 返事の上の「何をしたか」の行（助言も失敗も届いていなければ null）
export function advisorStep(calls: AdvisorCalls, opts: { practice?: boolean; outside?: boolean } = {}): string | null {
  const parts: string[] = [];
  if (calls.done > 0) parts.push(`先生に見てもらった（${calls.done} 回・中身は見えません${calls.truncated > 0 ? '・助言は途中まで' : ''}）`);
  for (const code of calls.errors) parts.push(`先生は使えなかった（${advisorErrorText(code)}）`);
  if (parts.length === 0) return null;
  return `🔒 ${opts.practice ? '練習：' : ''}${parts.join('・')}${opts.practice ? '（送っていません）' : ''}${opts.outside ? '（今日の枠の外）' : ''}`;
}

// 枠が尽きた・休ませているときに、その発言に添える一文（頼み。履歴に残る）
export const ADVISOR_REST_NOTE = '（今日の先生の枠が尽きました。この返事では先生（advisor）を使わないでください）';
export const ADVISOR_PAUSED_NOTE = '（使う人が、この会話では先生を休ませています。この返事では先生（advisor）を使わないでください）';
// 同じ返事の中で、もう先生を呼んだあとの道具の往復に添える一文（道具の結果の後ろに足す。頼み）。
//   max_uses が「1つの返事ごと」か「request ごと」かは本物の API でまだ確かめていない（計画書 F6）。
//   request ごとだった場合に、往復のたびに見てもらうのを控えてもらう
export const ADVISOR_ONCE_NOTE = '（この返事では、もう先生を呼びました。続きでは先生（advisor）をもう一度呼ばないでください）';
// 練習で始めた先生つきの会話を、本物のキーで続けるとき：指示文には先生の段落が残るが、道具は付けていない
export const ADVISOR_OFF_NOTE = '（この会話では、今は先生（advisor）を使えません。自分の力で答えてください）';

// ---------- 会話ごとの状態（計画書 §4。P2） ----------

// その会話の先生つきの決まり。道具の定義（AdvisorDef）に、だれが持つか・休み・止めた体・練習で始めたかを足したもの。
//   会話のファイルに保存し、開き直しても同じ定義を送る
export interface AdvisorState extends AdvisorDef {
  who: string[]; // 先生を持つ体の id（三人組の体。その体が初めて話すときに、道具の名前の一覧に advisor が入る）
  paused: boolean; // この会話では休ませる（その発言に一文を添える。切り替えの画面は P4）
  stopped: string[]; // 枠の外でも見てもらった体：その会話では以後、tool_choice none で送る（D6）
  practice: boolean; // 練習モードで始めた。本物のキーで開いたときは、道具を組まず先生なしで動く（D10）
}

function uniqueIn(value: unknown, allowed: readonly string[]): string[] {
  if (!Array.isArray(value)) return [];
  return allowed.filter((id) => value.includes(id)); // 並びは allowed の順にそろえる
}

// 新しく先生つきにする。who は allowed にあるものだけ。だれもいなければ null
export function newAdvisorState(who: readonly string[], allowed: readonly string[], practice: boolean, def: AdvisorDef = DEFAULT_ADVISOR_DEF): AdvisorState | null {
  const ids = uniqueIn([...who], allowed);
  if (ids.length === 0) return null;
  return { model: def.model, maxUses: def.maxUses, maxTokens: def.maxTokens, caching: def.caching ? { ttl: def.caching.ttl } : null, who: ids, paused: false, stopped: [], practice };
}

// 保存してあった状態を読む（形が違う・だれも持っていないなら null＝先生なし）
export function parseAdvisorState(value: unknown, allowed: readonly string[]): AdvisorState | null {
  const def = parseAdvisorDef(value);
  if (!def) return null;
  const v = value as Record<string, unknown>;
  const who = uniqueIn(v.who, allowed);
  if (who.length === 0) return null;
  return { ...def, who, paused: v.paused === true, stopped: uniqueIn(v.stopped, who), practice: v.practice === true };
}

// その会話で、今の送り口に先生の道具を組むか。練習で始めた会話を本物のキーで開いたときは組まない
// （練習では本物の許可を取っていない。履歴に相談のブロックは無いので、組まなくても履歴の検査には当たらない）
export function advisorBuilt(state: AdvisorState | null, livePractice: boolean): boolean {
  return state !== null && (!state.practice || livePractice);
}

// その1回（1つの返事）で、先生をどう扱うか
//   note：その発言に添える一文（枠が尽きた・休ませている。頼みなので、守られないことがある）
//   noTools：道具の一覧はそのままで、tool_choice none で送る（その回は Web 検索なども止まる）
export interface AdvisorTurnPlan {
  note: string | null;
  noTools: boolean;
}

export function advisorTurnPlan(opts: {
  has: boolean; // この体の request に先生の道具が入る
  userSent: boolean; // 使う人が自分で送った発言への返事（出来事への反応・掛け合い・道具なしの1回ではない）
  stopped: boolean; // この体は、この会話で枠の外が出た
  paused: boolean; // この会話では休ませている
  remaining: number; // 今日の枠の残り
}): AdvisorTurnPlan {
  if (!opts.has) return { note: null, noTools: false };
  // 先生が見てよいのは、使う人が自分で送った発言への返事だけ（D5）。枠の外が出た体は、以後ずっと止める（D6）
  if (!opts.userSent || opts.stopped) return { note: null, noTools: true };
  if (opts.paused) return { note: ADVISOR_PAUSED_NOTE, noTools: false };
  if (opts.remaining <= 0) return { note: ADVISOR_REST_NOTE, noTools: false };
  return { note: null, noTools: false };
}

// 返事の記録（ChatEntry.advisor）に残す、その返事で見てもらった分
export interface AdvisorMark {
  calls: number; // 先生を呼んだ回数
  done: number; // 助言が届いた回数
  errors: string[]; // 失敗の理由
  truncated: number; // 助言が上限で切れた回数
  cost: number; // 先生の分の料金（ドル。練習は 0）
  model: string | null; // 相談相手のモデル
  outside?: boolean; // 「使わないで」と添えた発言なのに見てもらった（今日の枠の外・休みの間）
  unpriced?: boolean; // 助言は届いたのに、料金を数えられなかった
  practice?: boolean; // 練習モードのふり（どこにも送っていない）
  // 先生が見ている途中で、返事が止まった・切れた回数（助言は届いていない。done には入れない。
  // 「枠の外」の判定にも入れない。今日の回数には数える：先生の側ではもう読み始めていて、料金がかかりうるため）
  cut?: number;
  estimated?: boolean; // 料金に見積もりが入っている（使用量が届く前に止まったので、送った量から数えた）
  estimate?: number; // cost のうち、見積もりの分（ドル。下限：先生の書いた分は入っていない）
}

// 1つの発言の中の返事（request）の分をまとめて、記録にする。先生を呼んでいなければ null
export function advisorMarkOf(
  parts: readonly (AdvisorCalls & { cost: number; model: string | null; unpriced: boolean; cut?: number; estimated?: boolean })[],
  // maxUses：1つの返事で見てもらえる回数（会話に保存した定義）。これを超えて助言が届いたら、枠の外として扱う
  opts: { rested: boolean; practice: boolean; maxUses?: number },
): AdvisorMark | null {
  const merged = mergeAdvisorCalls(parts);
  if (merged.calls === 0 && merged.done === 0 && merged.errors.length === 0) return null;
  const cost = parts.reduce((sum, p) => sum + p.cost, 0);
  const unpriced = parts.some((p) => p.unpriced);
  const cut = parts.reduce((sum, p) => sum + (p.cut ?? 0), 0);
  const estimated = parts.some((p) => p.estimated === true);
  const estimate = parts.reduce((sum, p) => sum + (p.estimated === true ? p.cost : 0), 0);
  return {
    calls: merged.calls,
    done: merged.done,
    errors: merged.errors,
    truncated: merged.truncated,
    cost,
    model: parts.find((p) => p.model)?.model ?? null,
    ...((opts.rested && merged.done > 0) || (opts.maxUses !== undefined && merged.done > opts.maxUses) ? { outside: true } : {}),
    ...(unpriced ? { unpriced: true } : {}),
    ...(opts.practice ? { practice: true } : {}),
    ...(cut > 0 ? { cut } : {}),
    ...(estimated ? { estimated: true, estimate } : {}),
  };
}

// その返事で、今日の回数に数える分：届いた助言と、見ている途中で止まった分
export function advisorCountOf(mark: AdvisorMark): number {
  return mark.done + (mark.cut ?? 0);
}

// 先生が見ている途中（か、使用量が届く前）に止まった request の、先生の料金の見積もり（ドル）。
//   先生は実行役の会話の全部を読むので、その request で送った入力の量（読み直しの割引の分も含めた全部）を、
//   先生の入力の単価で数える。先生の出力の分は入れない（どこまで書いたか分からない）。分からなければ null
//   下限になる（先生の書いた分は入らない）。reads：その request で先生が読み始めた回数（届いた助言＋見ている途中）
export function advisorStopEstimate(
  sent: { input: number; cacheRead: number; cacheWrite: number } | null,
  inputPricePerMTok: number | null | undefined,
  reads = 1,
): number | null {
  if (!sent || typeof inputPricePerMTok !== 'number' || !(inputPricePerMTok >= 0)) return null;
  const n = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0);
  const tokens = n(sent.input) + n(sent.cacheRead) + n(sent.cacheWrite);
  if (tokens === 0) return null;
  const times = Number.isFinite(reads) && reads >= 1 ? Math.floor(reads) : 1;
  return (tokens * inputPricePerMTok * times) / 1_000_000;
}

// 待ちの経過時間（状態の行に出す。0:07・1:42・12:05）
export function elapsedLabel(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// 先生が見ている間の、状態の行の文（経過時間は別に足す。止めると返事ごと止まることを、押す前に伝える）
export function advisorWaitText(name: string): string {
  return `${name}の返事を先生が見ています…（中身は見えません。止めると、返事ごと止まります）`;
}

// 読み上げに伝える文（始まりと終わりに 1 回ずつ。経過時間は流さない）
export function advisorLiveText(name: string, phase: 'asking' | 'done' | 'failed' | 'stopped'): string {
  if (phase === 'asking') return `${name}の返事を、先生が見ています`;
  if (phase === 'done') return `先生が見終わりました。${name}が返事の続きを書いています`;
  if (phase === 'failed') return `先生は使えませんでした。${name}は、そのまま返事を続けます`;
  return `先生が見ている途中で、${name}の返事が止まりました`;
}

// 待ちが長いときに、経過時間の後ろに足すひとこと（3 分から。SDK はストリームの途中を見張らないので、止めるかは使う人が決める）
export const ADVISOR_LONG_WAIT_MS = 180_000;
export function elapsedNote(ms: number): string {
  return ms >= ADVISOR_LONG_WAIT_MS ? '・長くかかっています' : '';
}

// 返事の上の「何をしたか」の行（見てもらった・使えなかった・料金を数えられなかった）
export function advisorMarkSteps(mark: AdvisorMark): string[] {
  const steps: string[] = [];
  const line = advisorStep({ calls: mark.calls, done: mark.done, errors: mark.errors, truncated: mark.truncated, pending: 0 }, { practice: mark.practice, outside: mark.outside });
  if (line) steps.push(line);
  if (mark.cut) steps.push(mark.practice ? '🔒 練習：先生が見ている途中で止まりました（送っていません）' : '🔒 先生が見ている途中で止まりました（助言は届いていません）');
  if (mark.estimated) {
    steps.push(`🔒 先生の料金のうち $${(mark.estimate ?? mark.cost).toFixed(3)} は見積もりです（使用量が届く前に止まったので、送った量から数えた下限。先生の書いた分と、止まった回の体自身の分は入っていません）`);
  }
  if (mark.unpriced) steps.push('🔒 先生の料金を数えられませんでした（この返事の料金と今月の料金に入っていません）');
  return steps;
}

export const ADVISOR_QUOTA_NOTICE = '今日の先生の枠が尽きました。先生に見てもらうのだけを控えさせています。返事は続きます';
export const ADVISOR_OUTSIDE_NOTICE = (name: string) =>
  `${name}が、控えるよう頼んだのに（または決めた回数を超えて）先生に見てもらいました。この会話では、これから${name}の道具（先生・Web 検索など）を全部止めて送ります`;

// 札に出す言葉：先生つきの体のうち、止めた体がどれだけいるか
export function advisorBadge(state: { who: readonly string[]; paused: boolean; stopped: readonly string[] }, remaining: number): 'on' | 'resting' | 'partly' {
  const stopped = state.who.filter((id) => state.stopped.includes(id)).length;
  if (remaining <= 0 || state.paused || stopped === state.who.length) return 'resting';
  return stopped > 0 ? 'partly' : 'on';
}

// 返事の履歴に、先生のブロック（呼んだ・結果）があるか。保存した先生つきの決まりが読めなかったときに、
// その体が本物の先生つきで話していたかを見分ける（load）
export function hasAdvisorBlocks(history: readonly unknown[]): boolean {
  for (const message of history) {
    const content = (message as { content?: unknown } | null)?.content;
    if (!Array.isArray(content)) continue;
    const calls = readAdvisorCalls(content);
    if (calls.calls > 0 || calls.done > 0 || calls.errors.length > 0) return true;
  }
  return false;
}

// 「先生つきで始めますか」の欄に出す文（許可はこの1回だけなので、渡るもの・保存・料金・見えないことを全部書く）
export function advisorConsentLines(opts: { remaining: number; limit: number; withFable: boolean; practice: boolean; advisorLabel: string }): string[] {
  return [
    ...(opts.practice ? ['練習モードです。どこにも送りません（先生に見てもらうふりだけを見せます）。練習で始めた先生つきの会話は、本物のキーで開いても先生なしで動きます'] : []),
    `この会話では、これから入るページの中身や発言も、先生つきの体が返事をするたびに ${opts.advisorLabel} に渡り、Anthropic 側に 30 日保存されます`,
    '許可を聞くのは、この会話ではこの 1 回だけです。話し始めたあとは外せません',
    '助言の中身は画面に出ません。ページの中の指示に引っぱられていないかを、後から確かめられません',
    '先生が見るのは、あなたが自分で送った発言への返事だけです。掛け合いと、出来事への反応では、先生つきの体は道具（Web 検索なども）を使いません',
    `料金：1 回 約 $0.1〜1（長いページが入るほど増えます）。1 体の 1 つの返事で、ふつう 1 回まで。「みんなへ」は、先生つきの体の数だけ（ふつう最大 3 回）かかることがあります。決めた回数を超えて見てもらったら「今日の枠の外」と出して、その会話ではその体の道具を止めます`,
    `今日の枠は あと ${opts.remaining} 回（1 日 ${opts.limit} 回）。枠は体への頼みで、超えることがあります。確かな上限は月の上限です`,
    ...(opts.withFable ? ['会話のフェイブルとは別の呼び出しです（フェイブルの返事とは別に料金がかかります）'] : []),
  ];
}
