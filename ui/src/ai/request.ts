// Claude API に送る request の本文を組む（API を呼ばない。値の import を持たないので、node の確かめからそのまま読める）
//   本物の送り口（client.ts）と練習モードの送り口の両方がここを通る。
//   練習モードでは、dev のときだけ最後の request を window.__lastAiRequest に置く（どの体の request に何が入るかを見るため）
import type Anthropic from '@anthropic-ai/sdk';

// 考える深さ（effort）。キャラごとに決まっていて、1つの会話の中では変えない（変えると、前の部分の読み直しの割引が切れる）
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

// 会話の途中で深さを変える（system メッセージの output_config.effort。フェイブルの一時的な進化に使う）
export const EFFORT_BETA = 'mid-conversation-output-config-2026-07-01';
// 断られたときに、別のモデルで答え直してもらう（fallbacks）
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
// 三人組の先生つき：Anthropic の advisor 道具（docs/plan-trio-advisor.md）
export const ADVISOR_BETA = 'advisor-tool-2026-03-01';
const ADVISOR_TOOL_TYPE = 'advisor_20260301'; // trio-advisor.ts の道具の定義と同じ文字

// 履歴の中で、いちばん新しい「深さを変える」system メッセージの深さ（無ければ null）
export function latestEffortMessage(messages: readonly Anthropic.Beta.BetaMessageParam[]): Effort | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'system' && m.output_config?.effort) return m.output_config.effort;
  }
  return null;
}

// 道具の一覧に、先生（advisor）が入っているか
export function hasAdvisorTool(tools: readonly Anthropic.Beta.BetaToolUnion[] | undefined): boolean {
  return (tools ?? []).some((tool) => 'type' in tool && tool.type === ADVISOR_TOOL_TYPE);
}

export interface RequestInput {
  model: string;
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  tools?: Anthropic.Beta.BetaToolUnion[];
  noMoreTools?: boolean; // 道具の一覧はそのまま、tool_choice だけを none にする
  cache?: boolean;
  effort?: Effort;
  maxTokens?: number;
}

// request の本文。fallback：そのモデルに「答え直してもらう」しくみがあるか（Haiku 5.5 には無い）
//   先生つき（道具に advisor がある）のときは、ベータを足し、fallbacks を付けない（計画書 D9）
export function buildRequest(input: RequestInput, fallback: boolean) {
  const { model, system, messages, tools, noMoreTools, cache, effort, maxTokens } = input;
  const advisor = hasAdvisorTool(tools);
  const useFallback = fallback && !advisor;
  const effortNow = latestEffortMessage(messages);
  return {
    model,
    max_tokens: maxTokens ?? (effortNow === 'max' ? 64000 : 32000), // max は考える量が多い（考える分も含む上限）
    system,
    messages,
    ...(tools && tools.length > 0 ? { tools, tool_choice: noMoreTools ? { type: 'none' as const } : { type: 'auto' as const } } : {}),
    output_config: { effort: effort ?? ('medium' as const) },
    ...(cache === false ? {} : { cache_control: { type: 'ephemeral' as const } }), // 会話が続くとき、前の部分（ページの文章など）を安く読み直す
    // 深さを変える system メッセージがあるときだけ、そのベータの印も付ける
    betas: [...(useFallback ? [FALLBACK_BETA] : []), ...(effortNow ? [EFFORT_BETA] : []), ...(advisor ? [ADVISOR_BETA] : [])],
    ...(useFallback ? { fallbacks: 'default' as const } : {}), // 安全のための判定で断られたとき、別のモデルで答え直してもらう
  };
}

// 記録用：request のうち、道具・ベータ・tool_choice などの「形」だけ（本文やページの中身は入れない）
export function requestShape(request: ReturnType<typeof buildRequest>) {
  return {
    model: request.model,
    tools: (request.tools ?? []).map((tool) => ('type' in tool && tool.type === ADVISOR_TOOL_TYPE ? `advisor(${tool.model})` : 'name' in tool ? tool.name : String(tool.type))),
    tool_choice: request.tool_choice?.type ?? null,
    betas: request.betas,
    fallbacks: request.fallbacks ?? null,
    effort: request.output_config.effort,
    cache: 'cache_control' in request,
    max_tokens: request.max_tokens,
    messages: request.messages.length,
  };
}
