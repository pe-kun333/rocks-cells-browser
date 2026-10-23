// フェイブルの「一時的な進化」：深く考えたいときに合図の道具（think_deeper）を使い、使う人が許可したら、
// その返事の続きだけ考える深さ（effort）を max に上げる。返事が終わったら、いつもの深さ（high）に戻す
//   ・深さを変えるのは、会話の途中に足す system メッセージ（content は空で output_config.effort だけ）。
//     ベータ mid-conversation-output-config-2026-07-01。前の部分の読み直しの割引は切れない
//   ・新しい深さは、次の user（道具の結果）から効く。履歴は後ろに足すだけにする
//   ・使う人が自分でボタン（さらに考える）を押したときは、確認なしで、その返事の初めから max にする
//   ・進化の枠は、合図とボタンで1日の回数を分け合う（0時に戻る。残りは持ち越さない）。
//     「フェイブルの合図用に1回残す」にすると、ボタンでは最後の1回を使わない
import type Anthropic from '@anthropic-ai/sdk';
import { type AiUsage, costOf, type Effort } from './client';

export const THINK_DEEPER = 'think_deeper';
export const EVOLVE_TIMEOUT_MS = 30_000; // 許可の答えを待つ時間（過ぎたら、進化せずに続ける）

// 進化の許可：毎回聞く／この会話ではいつも許可（会話ごとに最初の1回だけ聞く）／進化しない
export type EvolveMode = 'ask' | 'conversation' | 'never';
export interface EvolveSettings {
  mode: EvolveMode;
  dailyLimit: number; // 1日に進化できる回数（合図とボタンで分け合う）
  reserve: boolean; // フェイブルの合図用に1回残す（ボタンでは最後の1回を使わない）
}
export const DEFAULT_EVOLVE: EvolveSettings = { mode: 'ask', dailyLimit: 3, reserve: false };
export const EVOLVE_MODES: [EvolveMode, string][] = [
  ['ask', '毎回聞く'],
  ['conversation', 'この会話ではいつも許可（会話ごとに最初の1回だけ聞く）'],
  ['never', '進化しない'],
];

// 許可の答え（limit：今日の上限・off：進化しない設定・already：この返事ではもう進化している）
export type EvolveAnswer = 'yes' | 'always' | 'no' | 'timeout' | 'limit' | 'off' | 'already';

export const THINK_DEEPER_TOOL: Anthropic.Beta.BetaTool = {
  name: THINK_DEEPER,
  description:
    'もう一段深く考えたいときの合図。面白い分析・意見・論点が出せそうなとき（複数の見方を比べる・前提を問い直す・新しい仮説を立てる など）にだけ使う。使う人に許可を聞き、許可されたら、この返事の続きを、ふだんより深く考えて書ける。ふつうの質問・短い返事・事実の確認・あいさつでは使わない。1回の返事で1回まで。許可されなくても、いつもの深さで返事を続ける。',
  input_schema: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: '何を深く考えたいか（使う人に見せる。40字くらいまで）' },
    },
    required: ['reason'],
  },
};

// 深さを変える system メッセージ（content は空）
export function effortMessage(effort: Effort): Anthropic.Beta.BetaMessageParam {
  return { role: 'system', content: [], output_config: { effort } };
}

// 道具の結果として、フェイブルに返す言葉
export function evolveResult(answer: EvolveAnswer): string {
  switch (answer) {
    case 'yes':
    case 'always':
      return '許可されました。ここから、ふだんより深く考えて（進化して）、考察を続けてください。';
    case 'no':
      return '使う人が、今回は進化を見送りました。いつもの深さで返事を続けてください。';
    case 'timeout':
      return '使う人から答えがなかったので、今回は進化しません。いつもの深さで返事を続けてください。';
    case 'limit':
      return '今日はもう進化できません（1日の上限）。いつもの深さで返事を続けてください。';
    case 'off':
      return '進化しない設定になっています。いつもの深さで返事を続けてください。';
    case 'already':
      return 'この返事では、もう深く考えています。そのまま続けてください。';
  }
}

// 返事の上に出す「何をしたか」
export function evolveStep(name: string, answer: EvolveAnswer): string {
  switch (answer) {
    case 'yes':
      return `🌕 ${name}が一時的に進化しました（考える深さ max）`;
    case 'always':
      return `🌕 ${name}が一時的に進化しました（この会話ではいつも許可）`;
    case 'no':
      return '進化は見送りました';
    case 'timeout':
      return '答えがなかったので、進化せずに続けました';
    case 'limit':
      return '今日の進化の上限に達していたので、進化しませんでした';
    case 'off':
      return '進化しない設定なので、そのまま続けました';
    case 'already':
      return 'すでに進化しています';
  }
}

// 料金の目安：今の会話を読み直す分（ほぼ割引の読み直し）＋深く考えて書く分（4千〜2万トークン）
export function evolveEstimate(round: AiUsage, model: string, practice: boolean): string {
  if (practice) return '練習モードなので料金はかかりません';
  const read = { input: round.input, output: 0, cacheRead: round.cacheRead + round.cacheWrite, cacheWrite: 0 };
  const low = costOf({ ...read, output: 4_000 }, model);
  const high = costOf({ ...read, output: 20_000 }, model);
  return `目安：数分・約 $${low.toFixed(2)}〜$${high.toFixed(2)}（考える量しだい）`;
}

// ---------- 今日、進化した回数（このパソコンの時計で） ----------
const COUNT_KEY = 'honeycomb.ai.evolve';

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function loadEvolveCount(): number {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(COUNT_KEY) ?? 'null');
    if (typeof saved !== 'object' || saved === null) return 0;
    const s = saved as Record<string, unknown>;
    return s.date === today() && typeof s.count === 'number' ? s.count : 0;
  } catch {
    return 0;
  }
}

export function addEvolveCount(delta = 1) {
  try {
    localStorage.setItem(COUNT_KEY, JSON.stringify({ date: today(), count: Math.max(0, loadEvolveCount() + delta) }));
  } catch {
    // 保存できなくても動作は続ける
  }
}

// 今日の進化の枠の残り
export function evolveRemaining(settings: EvolveSettings): number {
  return Math.max(0, settings.dailyLimit - loadEvolveCount());
}

// 進化できるか（by：フェイブルの合図／使う人のボタン。ボタンは、合図用に残した1回を使わない）
export function canEvolve(settings: EvolveSettings, by: 'signal' | 'button'): boolean {
  if (settings.mode === 'never') return false;
  return evolveRemaining(settings) > (by === 'button' && settings.reserve ? 1 : 0);
}

export function parseEvolve(saved: Record<string, unknown>): EvolveSettings {
  const mode = EVOLVE_MODES.some(([m]) => m === saved.evolveMode) ? (saved.evolveMode as EvolveMode) : DEFAULT_EVOLVE.mode;
  const limit = Number(saved.evolveLimit);
  return {
    mode,
    dailyLimit: Number.isInteger(limit) && limit >= 1 ? Math.min(20, limit) : DEFAULT_EVOLVE.dailyLimit,
    reserve: saved.evolveReserve === true,
  };
}
