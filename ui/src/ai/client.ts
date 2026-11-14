// Claude API との通信。本物（公式 SDK）と、お金のかからない「練習モード」の2種類
import Anthropic from '@anthropic-ai/sdk';
import { addBudget, assertBudget, BudgetError } from './budget';
import { type AiUsage, costOf, HAIKU_MODEL, type HaikuModelId, type ModelId, priceRowOf } from './prices';
import { buildRequest, type Effort, hasAdvisorTool, latestEffortMessage, requestShape } from './request';
import { ADVISOR_PAUSED_NOTE, ADVISOR_REST_NOTE, type AdvisorReading, type AdvisorSignal, advisorSignalOf, advisorStopEstimate, readAdvisor, readAdvisorCalls, readAdvisorUsage } from './trio-advisor';

// モデルの一覧と料金は prices.ts、request の組み立ては request.ts（どちらも API を呼ばない。node の確かめから読める）。
// ほかのファイルは今までどおり、ここから読む
export { type AiUsage, costOf, FABLE_MODEL, HAIKU_MODEL, type HaikuModelId, LEGACY_FABLE_MODEL, type ModelId, MODELS, PRICED_MODELS, priceRowOf, savedVoiceModel } from './prices';
export { EFFORT_BETA, type Effort, latestEffortMessage } from './request';

// 三人組の先生つき（advisor 道具）：その返事で見てもらった分。先生つきでない request では付かない
//   回数・失敗・使用量は trio-advisor.ts の AdvisorReading（最上位の usage には先生の分が入っていないので、別に読む）
export interface AdvisorResult extends AdvisorReading {
  cost: number; // 相談の料金（ドル。月の上限には、もう足してある。unpriced のときは 0 で、数えられていない）
  // 返事が最後まで届かなかった request の分（onAdvisorLost）にだけ付く
  cut?: number; // 先生が見ている途中で止まった・切れた回数（助言は届いていない）
  estimated?: boolean; // cost は見積もり（使用量が届く前に止まったので、送った入力の量 × 先生の入力の単価）
}

export interface AiResult {
  text: string;
  stopReason: string | null;
  model: string; // 実際に答えたモデル（断られて別のモデルが答えたときは、そちら）
  usage: AiUsage;
  content: Anthropic.Beta.BetaContentBlock[]; // 会話の履歴にそのまま戻す（考えた跡も含む）
  toolUses: Anthropic.Beta.BetaToolUseBlock[]; // 使いたい道具（stopReason が tool_use のとき）
  searches: string[]; // Web 検索で調べた言葉（Anthropic 側で検索したもの）
  fetches: { url: string; title: string; ok: boolean }[]; // Web 取得で読んだページ（Anthropic 側で取得したもの。読めなかったものは ok: false）
  sources: { url: string; title: string }[]; // 返事の引用元（Web 検索の結果）
  advisor?: AdvisorResult; // 先生つきの request のときだけ
}

// 1回の Web 検索の料金（ドル。1,000回で $10）
export const WEB_SEARCH_PRICE = 0.01;

// 相棒の Web 検索（Anthropic 側で検索する。検索結果のページの中の指示には従わないよう、指示文に書いてある）
export const COMPANION_WEB_SEARCH: Anthropic.Beta.BetaWebSearchTool20260209 = {
  type: 'web_search_20260209',
  name: 'web_search',
  max_uses: 3,
  user_location: { type: 'approximate', country: 'JP', timezone: 'Asia/Tokyo' },
};

// Web のページを取得して読む（フェイブル。会話や検索結果に出てきた URL だけを、Anthropic 側で取得する。追加の料金はなく、読んだ分のトークンだけ）
export const COMPANION_WEB_FETCH: Anthropic.Beta.BetaWebFetchTool20260318 = {
  type: 'web_fetch_20260318',
  name: 'web_fetch',
  max_uses: 3,
  max_content_tokens: 20_000,
};

// ハイク組（Haiku 5.5）の Web 検索。Haiku 5.5 では新しい形（web_search_20260209）が使えないので、もとの形を使う
export const HAIKU_WEB_SEARCH: Anthropic.Beta.BetaWebSearchTool20250305 = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 3,
  user_location: { type: 'approximate', country: 'JP', timezone: 'Asia/Tokyo' },
};

export interface ReplyOptions {
  model: ModelId | HaikuModelId;
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  tools?: Anthropic.Beta.BetaToolUnion[];
  noMoreTools?: boolean; // 道具を使う回数の上限に来た：道具を使わずに答えてもらう
  cache?: boolean; // 前の部分を読み直しの割引のために残す（標準は残す。1回きりの頼み方では、書く分だけ高くなるので残さない）
  effort?: Effort; // 考える深さ（標準は medium）
  maxTokens?: number; // 返事の上限（考える分も含む。無ければ 32000、深さ max なら 64000）
  // 先生つき：この返事の中で、もう先生を呼んだあとの送り直し（道具の往復・pause_turn の続き）。
  // このときだけ、月の上限で途中で切らない（先生の料金だけかかって、答えが取り消されるのを防ぐ）。
  // 先生を呼んでいない返事・先生つきでない request では、送り直しのたびに今までどおり上限を見る
  afterAdvisor?: boolean;
  onText: (delta: string) => void;
  // 先生つき：先生を呼んだ（asking）・結果が届いた（done）・失敗の結果が届いた（failed）。先生つきでない request では呼ばれない
  onAdvisor?: (state: AdvisorSignal) => void;
  // 先生つき：先生を呼んだ・助言が届いたあとで、返事が最後まで届かなかった（止めた・切れた）。
  // 途中までに届いた使用量があればそれで、無ければ見積もりで料金を数え、月の上限に足してから、呼ぶ側に渡す。
  // 呼ぶ側は、返事の料金・会話の合計・回数・印に残す（月の上限には、もう足してある）
  onAdvisorLost?: (lost: AdvisorResult) => void;
  signal: AbortSignal;
}

export interface AiTransport {
  readonly practice: boolean;
  reply(options: ReplyOptions): Promise<AiResult>;
}

export function createTransport(apiKey: string | null, practice: boolean): AiTransport | null {
  if (practice) return practiceTransport;
  if (!apiKey) return null;
  // この UI はパソコンの中だけで動き、キーは使う人本人のもの。ページ（タブ）とは別の WebView なので、
  // ページのスクリプトからこのキーは見えない。そのうえで、公式 SDK に「ブラウザの中で使う」ことを明示する
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  return {
    practice: false,
    async reply({ model, system, messages, tools, noMoreTools, cache, effort, maxTokens, afterAdvisor, onText, onAdvisor, onAdvisorLost, signal }) {
      const withAdvisor = hasAdvisorTool(tools);
      // 月の上限に達していたら、ここで止める（練習モードはこの関数に来ない）。
      // 先生をもう呼んだ返事の送り直しでだけ止めない（ReplyOptions.afterAdvisor）
      if (!(afterAdvisor && withAdvisor)) await assertBudget();
      // 断られたときに、別のモデルで答え直してもらう（fallbacks）。Haiku 5.5 にはこのしくみが無いので送らない
      // （'default' を送っても答え直さず、モデルの一覧を送ると 400 になる）。先生つきの request にも付けない（buildRequest）
      const fallback = model !== HAIKU_MODEL.id;
      const stream = client.beta.messages.stream(buildRequest({ model, system, messages, tools, noMoreTools, cache, effort, maxTokens }, fallback), { signal });
      stream.on('text', onText);
      const advisorBlocks: unknown[] = []; // 届いた先生のブロック（呼んだ・結果）。返事が最後まで届かなかったときに数える
      // 前の request（pause_turn・体の道具の往復）から持ち越した、結果待ちの相談の数。この request の頭で先生が読む
      const carried = withAdvisor ? pendingAdvisorOf(messages) : 0;
      let sentInput: { input: number; cacheRead: number; cacheWrite: number } | null = null; // この request で送った入力の量（最初の出来事で届く）
      if (withAdvisor) {
        stream.on('streamEvent', (event) => {
          if (event.type === 'message_start') {
            const u = event.message.usage;
            sentInput = { input: u.input_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 };
            return;
          }
          if (event.type !== 'content_block_start') return;
          const state = advisorSignalOf(event.content_block);
          if (!state) return;
          advisorBlocks.push(event.content_block);
          try {
            onAdvisor?.(state); // 画面への合図。ここで転んでも、返事の受け取りは続ける
          } catch {
            // 合図を出せなくても、返事は壊さない
          }
        });
      }
      let final: Anthropic.Beta.BetaMessage;
      try {
        final = await stream.finalMessage();
      } catch (error) {
        // 止めた・切れた：最後の使用量は届かない。先生をもう呼んでいたら、その分を数えて呼ぶ側に渡す
        // 持ち越した相談だけのとき（この request では先生のブロックが届いていない）は、request が始まっていた
        // （最初の出来事が届いた）ときだけ数える。つながる前の失敗（オフライン・429・鍵の誤り・すぐ止めた）では、先生は読んでいない
        if (advisorBlocks.length > 0 || (carried > 0 && sentInput !== null)) {
          try {
            let partial: unknown;
            try {
              partial = stream.currentMessage?.usage?.iterations; // 途中までに届いた使用量（先生の分が入っていれば、それを使う）
            } catch {
              partial = undefined;
            }
            const lost = lostAdvisorOf(readAdvisorCalls(advisorBlocks), carried, partial, sentInput, tools);
            await addBudget(lost.cost).catch(() => undefined);
            onAdvisorLost?.(lost);
          } catch {
            // 数えられなくても・渡せなくても、もとのエラーをそのまま返す
          }
        }
        throw error;
      }
      const usage = {
        input: final.usage.input_tokens,
        output: final.usage.output_tokens,
        cacheRead: final.usage.cache_read_input_tokens ?? 0,
        cacheWrite: final.usage.cache_creation_input_tokens ?? 0,
      };
      const searches = searchesOf(final.content);
      // 料金は、実行役の分（最上位の usage）と、先生の分（usage.iterations の advisor_message）を別々に数えて足す
      const executorCost = costOf(usage, final.model);
      const advisor = withAdvisor ? advisorResultOf(final, tools) : undefined;
      await addBudget(executorCost + (advisor?.cost ?? 0) + searches.length * WEB_SEARCH_PRICE).catch(() => undefined);
      return {
        text: final.content
          .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
          .map((block) => block.text)
          .join(''),
        stopReason: final.stop_reason,
        model: final.model,
        usage,
        content: final.content,
        toolUses: final.content.filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === 'tool_use'),
        searches,
        fetches: fetchesOf(final.content),
        sources: sourcesOf(final.content),
        ...(advisor ? { advisor } : {}),
      };
    },
  };
}

// 先生つきの返事から、見てもらった分を読む。相談相手のモデルは、使用量に名前があればそれ、無ければ送った道具の定義から
function advisorResultOf(final: Anthropic.Beta.BetaMessage, tools: readonly Anthropic.Beta.BetaToolUnion[] | undefined): AdvisorResult {
  const sent = (tools ?? []).find((tool): tool is Anthropic.Beta.BetaAdvisorTool20260301 => 'type' in tool && tool.type === 'advisor_20260301');
  const read = readAdvisor(final.content, final.usage.iterations, sent?.model ?? null);
  // 助言は届いたのに使用量が読めなかった：料金を数えられていない。黙って 0 にせず、記録に出す（画面には呼ぶ側が出す）
  if (read.unpriced) console.warn('先生つき：助言は届いたが、usage.iterations に advisor_message が無く、料金を数えられなかった', final.usage);
  return { ...read, cost: read.model ? costOf(read.usage, read.model) : 0 };
}

// 返事が最後まで届かなかった request の、先生の分（ReplyOptions.onAdvisorLost に渡す）。
//   途中までに届いた使用量に先生の分があれば、その料金。無ければ、助言が届いていた・見ている途中だったときだけ、
//   送った入力の量 × 先生の入力の単価で見積もる（先生が失敗を返していただけなら 0）。見積もれなければ unpriced
//   carried：前の request から持ち越した、結果待ちの相談の数（この request では呼んだブロックが届かない）
function lostAdvisorOf(
  calls: ReturnType<typeof readAdvisorCalls>,
  carried: number,
  partialIterations: unknown,
  sentInput: { input: number; cacheRead: number; cacheWrite: number } | null,
  tools: readonly Anthropic.Beta.BetaToolUnion[] | undefined,
): AdvisorResult {
  const sent = (tools ?? []).find((tool): tool is Anthropic.Beta.BetaAdvisorTool20260301 => 'type' in tool && tool.type === 'advisor_20260301');
  const read = readAdvisorUsage(partialIterations);
  // 見ている途中だった数：持ち越した分と、この request で呼んだ分から、結果（助言・失敗）が届いた分を引く
  const cut = Math.max(0, carried + calls.calls - calls.done - calls.errors.length);
  const base = { ...calls, pending: cut, usage: read.usage, cut };
  if (read.count > 0) {
    const model = read.model ?? sent?.model ?? null;
    return { ...base, model, unpriced: false, cost: model ? costOf(read.usage, model) : 0 };
  }
  const model = sent?.model ?? null;
  if (calls.done === 0 && cut === 0) return { ...base, model, unpriced: false, cost: 0 }; // 失敗の結果だけ：先生は読んでいない
  const estimate = advisorStopEstimate(sentInput, model ? priceRowOf(model)?.input : null, calls.done + cut);
  if (estimate === null) return { ...base, model, unpriced: true, cost: 0 };
  return { ...base, model, unpriced: false, cost: estimate, estimated: true };
}

// 送る履歴の最後の返事（assistant）に残っている、結果待ちの相談の数（先生を呼んだまま、返事が区切られた）
function pendingAdvisorOf(messages: readonly Anthropic.Beta.BetaMessageParam[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== 'assistant') continue;
    return typeof message.content === 'string' ? 0 : readAdvisorCalls(message.content).pending;
  }
  return 0;
}

// 練習モードで、最後に組んだ request の形（道具・ベータ・tool_choice など。本文は入らない）を dev のときだけ置く。
// どの体の request に何が入るかを、API を呼ばずに見るため（docs/plan-trio-advisor.md の確かめ方）
function recordPracticeRequest(options: ReplyOptions) {
  if (!import.meta.env.DEV) return;
  try {
    const { model, system, messages, tools, noMoreTools, cache, effort, maxTokens } = options;
    const shape = requestShape(buildRequest({ model, system, messages, tools, noMoreTools, cache, effort, maxTokens }, model !== HAIKU_MODEL.id));
    const target = globalThis as { __lastAiRequest?: unknown; __aiRequests?: unknown[] };
    target.__lastAiRequest = shape;
    target.__aiRequests = [...(target.__aiRequests ?? []).slice(-49), shape];
  } catch {
    // 記録に失敗しても、練習の返事は続ける
  }
}

// エラーを、使う人に伝わる言葉にする
export function describeError(error: unknown): string {
  if (error instanceof BudgetError) return error.message;
  if (error instanceof Anthropic.APIUserAbortError) return '止めました';
  if (error instanceof Anthropic.AuthenticationError) return 'API キーが正しくないようです。⚙ の設定で確かめてください';
  if (error instanceof Anthropic.PermissionDeniedError) return 'このキーでは、このモデルを使えないようです';
  if (error instanceof Anthropic.RateLimitError) return '混み合っているか、使える量の上限に達しています。少し待ってからもう一度どうぞ';
  // 時間切れは、つながらないエラーの仲間なので、先に見る
  if (error instanceof Anthropic.APIConnectionTimeoutError) return '時間がかかりすぎて、途中で切れました。少し待ってから、もう一度どうぞ';
  if (error instanceof Anthropic.APIConnectionError) return 'Claude につながりませんでした。インターネットの接続を確かめてください';
  if (error instanceof Anthropic.APIError) return `うまくいきませんでした（${error.status ?? ''} ${error.message}）`;
  // 返事が流れ始めたあとで接続が切れた：SDK は読み出しのエラーを AnthropicError に包み、もとのエラーを cause に入れる
  if (error instanceof Anthropic.AnthropicError && (error as { cause?: unknown }).cause instanceof Error) return '返事の途中で、接続が切れました。インターネットの接続を確かめて、もう一度どうぞ';
  return 'うまくいきませんでした';
}

// ---------- 練習モード（API を使わない。画面の動きを試す用） ----------

const practiceTransport: AiTransport = {
  practice: true,
  async reply(options) {
    const { system, messages, tools, noMoreTools, onText, signal } = options;
    recordPracticeRequest(options);
    // ハイク組の先生への相談（1回きり）：決まった助言を、少し待ってから流す（先生への指示文の決まった書き出しで見分ける）
    const advisor = /^あなたは「Rocks-cells Browser」というブラウザに住む AI の相棒たちの相談役「(.+?)」/.exec(system)?.[1];
    if (advisor) {
      await wait(1200, signal);
      const advice = `（練習モード・${advisor}の助言）結論から言うと、ページで言えるのはここまでです。数字はページの表の値どうしで比べ、言い切れないところは「〜といわれる」と書くとよいでしょう。`;
      for (let i = 0; i < advice.length; i += 6) {
        if (signal.aborted) throw new Anthropic.APIUserAbortError();
        onText(advice.slice(i, i + 6));
        await new Promise((r) => setTimeout(r, 15));
      }
      return {
        text: advice,
        stopReason: 'end_turn',
        model: 'practice',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        content: [{ type: 'text', text: advice, citations: null }],
        toolUses: [],
        searches: [],
        fetches: [],
        sources: [],
      };
    }
    // 道具なしの1回（段階6の Deeper Dive、段階7の相棒に見せる）。届いた返事はデータのまま
    const askedEarly = lastText(messages);
    if (askedEarly.includes('<data>') && askedEarly.includes('相棒に見せる')) {
      await wait(700, signal);
      const text = '（練習モード・相棒に見せる）道具は使っていません。届いた返事の全文は、この会話には残していません。要点は、小さく始めること、同じ時刻にすること、できた日に印を付けること、の3つです。API は使っていません。';
      for (let i = 0; i < text.length; i += 4) {
        if (signal.aborted) throw new Anthropic.APIUserAbortError();
        onText(text.slice(i, i + 4));
        await new Promise((r) => setTimeout(r, 16));
      }
      return {
        text,
        stopReason: 'end_turn',
        model: 'practice',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        content: [{ type: 'text', text, citations: null }],
        toolUses: [],
        searches: [],
        fetches: [],
        sources: [],
      };
    }
    if (askedEarly.includes('道すじ') && askedEarly.includes('<ask>')) {
      await wait(400, signal);
      const ask = /<ask>\n([\s\S]*?)\n<\/ask>/.exec(askedEarly)?.[1] ?? '';
      const consult = /本当|10年|見通し|将来|すごい|英語/.test(ask);
      const text = consult ? 'consult\n先生に聞いた方がよい' : 'team\n組だけで足りる';
      for (let i = 0; i < text.length; i += 4) {
        if (signal.aborted) throw new Anthropic.APIUserAbortError();
        onText(text.slice(i, i + 4));
        await new Promise((r) => setTimeout(r, 12));
      }
      return {
        text,
        stopReason: 'end_turn',
        model: 'practice',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        content: [{ type: 'text', text, citations: null }],
        toolUses: [],
        searches: [],
        fetches: [],
        sources: [],
      };
    }
    if (askedEarly.includes('<data>') && askedEarly.includes('Deeper Dive')) {
      await wait(700, signal);
      const text = '（練習モード・Deeper Dive）道具は使っていません。届いた返事をデータとして読み、もう一段わかりやすくすると、小さく始めること、同じ時刻にすること、できた日に印を付けること、の3つが中心です。API は使っていません。';
      for (let i = 0; i < text.length; i += 4) {
        if (signal.aborted) throw new Anthropic.APIUserAbortError();
        onText(text.slice(i, i + 4));
        await new Promise((r) => setTimeout(r, 16));
      }
      return {
        text,
        stopReason: 'end_turn',
        model: 'practice',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        content: [{ type: 'text', text, citations: null }],
        toolUses: [],
        searches: [],
        fetches: [],
        sources: [],
      };
    }
    // 道具の練習：決まった言葉に反応して道具を使う（本物の Claude は、言葉から自分で選ぶ）。持っている道具だけ
    const toolResult = lastToolResult(messages);
    const names = new Set((tools ?? []).map((t) => ('name' in t ? t.name : '')));
    // 「先生に聞く」で助言をもらった発言では、道具でもう一度は相談しない
    const lastUser = messages.at(-1);
    if (lastUser && typeof lastUser.content !== 'string' && lastUser.content.some((b) => b.type === 'text' && b.text.startsWith('<advice '))) names.delete('ask_advisor');
    // すでに深く考えている（max）ときは、進化の合図を出さない
    if (latestEffortMessage(messages) === 'max') names.delete('think_deeper');
    const picked = tools && tools.length > 0 && !noMoreTools && !toolResult ? practiceTool(lastText(messages), names) : null;
    const tool = picked && names.has(picked.name) ? picked : null;
    if (tool) {
      const block: Anthropic.Beta.BetaToolUseBlock = { type: 'tool_use', id: `toolu_practice_${Date.now().toString(36)}`, name: tool.name, input: tool.input };
      const intro = '（練習モード）道具を使います。';
      onText(intro);
      return {
        text: intro,
        stopReason: 'tool_use',
        model: 'practice',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        content: [{ type: 'text', text: intro, citations: null }, block],
        toolUses: [block],
        searches: [],
        fetches: [],
        sources: [],
      };
    }
    const asked = lastText(messages);
    // 三人組の先生つきのふり：先生の道具を持つ体が「本当・確か・出典」を含む問いに答えるとき、見てもらうふりをする
    //   （どこにも送らない。履歴に偽のブロックは入れない。道具を使う形の返事・道具を止めた回では、ふりをしない）
    //   「先生を使わないで」と添えてある発言では控える。問いに「枠の外」があれば、頼みを守らないふり（枠の外の扱いを試す）
    //   問いに「混んで」があれば、先生が使えなかったふり。「途中まで」があれば、助言が上限で切れたふり。
    //   「長く」があれば、20 秒待つ（経過時間と、見ている途中で止めたときの見え方を試す）
    let watched: AdvisorResult | undefined;
    if (hasAdvisorTool(tools) && !noMoreTools && toolResult === null && /本当|確か|出典/.test(asked)) {
      const rested = lastUserHas(messages, [ADVISOR_REST_NOTE, ADVISOR_PAUSED_NOTE]);
      if (!rested || asked.includes('枠の外')) {
        const failed = asked.includes('混んで');
        const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
        options.onAdvisor?.('asking');
        try {
          await wait(asked.includes('長く') ? 20_000 : 2000, signal);
        } catch (error) {
          // 見ている途中で止めた：本物と同じ道（onAdvisorLost）を通す。料金は 0（どこにも送っていない）
          options.onAdvisorLost?.({ calls: 1, done: 0, errors: [], truncated: 0, pending: 1, usage: zero, model: null, unpriced: false, cost: 0, cut: 1 });
          throw error;
        }
        options.onAdvisor?.(failed ? 'failed' : 'done');
        watched = {
          calls: 1,
          done: failed ? 0 : 1,
          errors: failed ? ['overloaded'] : [],
          truncated: !failed && asked.includes('途中まで') ? 1 : 0,
          pending: 0,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          model: null,
          unpriced: false,
          cost: 0,
        };
      }
    }
    // Claude 以外のキャラ（指示文から名前を読む。前の二人目の指示文も）
    const character = /AI のキャラクター「(.+?)」/.exec(system)?.[1] ?? /二人目の AI の相棒「(.+?)」/.exec(system)?.[1];
    // 深く考えている（進化した）ときは、考える時間を長めに見せる
    const deep = latestEffortMessage(messages) === 'max';
    if (deep) await wait(2600, signal);
    const text = toolResult?.includes('からの助言。アプリが取り次いだもの')
      ? `（練習モード・${character ?? 'Claude'}）先生の助言をもとに、自分の言葉で答えます。${practiceLine(system, character ?? 'Claude', false)}`
      : toolResult?.startsWith('使う人に、レターを提案しました')
      ? `（練習モード・${character ?? 'Claude'}・進化）考えたことを、レターにまとめてみました。残すかどうかは、あなたが決めてください。`
      : toolResult?.startsWith('許可されました')
      ? `（練習モード・${character ?? 'Claude'}・進化）深く考えてみると、二つの見方は同じことを逆の側から見ています。一方は「きっかけを足す」話、もう一方は「迷いを引く」話です。重ねると、続く習慣は迷いを減らす工夫から生まれる、という仮説が立ちます。`
      : toolResult !== null && character
      ? `（練習モード・${character}）では、いつもの深さで続けます。${practiceLine(system, character, false)}`
      : asked.startsWith('【掛け合い】')
      ? `（練習モード）${character ? `${character}です。` : ''}${practiceLine(system, character ?? 'Claude', true)}`
      : character
      ? `（練習モード・${character}${deep ? '・進化' : ''}）${asked.includes('すでに答えています') ? 'みんなの答えに足すと、' : ''}${deep ? '深く考えてみると、前提そのものを問い直す余地がありそうです。' : ''}${practiceLine(system, character, false)}`
      : toolResult !== null
      ? `（練習モード）道具の結果です：${toolResult.slice(0, 160)}`
      : asked.startsWith('【出来事】')
      ? practiceReaction(asked)
      : asked.includes('クイズ')
        ? '（練習モードの返事です）\n問題：このページで、習慣を作る仕組みとして挙げられている3つは何でしょう？\n\n答え：きっかけ・行動・報酬。報酬があると、きっかけを見ただけで次の行動に移りやすくなります。'
        : `（練習モードの返事です。API は使っていません）\n・聞かれたこと：${asked.slice(0, 60)}\n・本物の返事は、⚙ で API キーを入れて練習モードを切ると届きます`;
    for (let i = 0; i < text.length; i += 4) {
      if (signal.aborted) throw new Anthropic.APIUserAbortError();
      onText(text.slice(i, i + 4));
      await new Promise((r) => setTimeout(r, deep ? 45 : 20));
    }
    return {
      text,
      stopReason: 'end_turn',
      model: 'practice',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      content: [{ type: 'text', text, citations: null }],
      toolUses: [],
      searches: [],
      fetches: [],
      sources: [],
      ...(watched ? { advisor: watched } : {}),
    };
  },
};

// Web 検索で調べた言葉
function searchesOf(content: Anthropic.Beta.BetaContentBlock[]): string[] {
  return content.flatMap((block) => {
    if (block.type !== 'server_tool_use' || block.name !== 'web_search') return [];
    const query = (block.input as { query?: unknown }).query;
    return typeof query === 'string' ? [query] : [];
  });
}

// Web 取得で読んだページ（読めなかったものは、頼んだ URL を ok: false で）
function fetchesOf(content: Anthropic.Beta.BetaContentBlock[]): { url: string; title: string; ok: boolean }[] {
  const asked = new Map<string, string>(); // 道具を使った id → 頼んだ URL
  for (const block of content) {
    if (block.type !== 'server_tool_use' || block.name !== 'web_fetch') continue;
    const url = (block.input as { url?: unknown }).url;
    if (typeof url === 'string') asked.set(block.id, url);
  }
  return content.flatMap((block): { url: string; title: string; ok: boolean }[] => {
    if (block.type !== 'web_fetch_tool_result') return [];
    const result = block.content;
    if (result.type === 'web_fetch_result') return [{ url: result.url, title: result.content.title || result.url, ok: true }];
    const url = asked.get(block.tool_use_id);
    return url ? [{ url, title: url, ok: false }] : [];
  });
}

// 返事の引用元（同じページは1回だけ）
function sourcesOf(content: Anthropic.Beta.BetaContentBlock[]): { url: string; title: string }[] {
  const out = new Map<string, { url: string; title: string }>();
  for (const block of content) {
    if (block.type !== 'text' || !block.citations) continue;
    for (const c of block.citations) {
      if (c.type === 'web_search_result_location' && !out.has(c.url)) out.set(c.url, { url: c.url, title: c.title ?? c.url });
    }
  }
  return [...out.values()];
}

// 止められるまで待つ（練習モード）
async function wait(ms: number, signal: AbortSignal) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (signal.aborted) throw new Anthropic.APIUserAbortError();
    await new Promise((r) => setTimeout(r, 100));
  }
}

// 練習モードで使う道具（言葉の中の決まった単語で選ぶ。数字はタブの id）。names：持っている道具
function practiceTool(asked: string, names: ReadonlySet<string>): { name: string; input: Record<string, unknown> } | null {
  // 撮影の「AIに頼む」（C8）。文の中の URL は、開いてほしい合図ではなく、画面の出所
  if (asked.includes('【頼み方】')) return null;
  // ハイク組の先生への相談（「先生」「相談」と頼まれたとき。フェイブルの名前があればフェイブル先生）
  if (names.has('ask_advisor') && /先生|相談/.test(asked)) {
    return { name: 'ask_advisor', input: { advisor: /フェイブル/.test(asked) ? 'fable' : 'opus', question: asked.replace(/^（.*?）\n/s, '').slice(0, 80), why: '（練習）自分だけでは自信が持てないので' } };
  }
  // フェイブルの進化の合図（深く考えたいとき）
  if (names.has('think_deeper') && /深く|考察|掘り下げ|じっくり/.test(asked) && !/残して/.test(asked)) return { name: 'think_deeper', input: { reason: '二つの見方の違いを、もう一段掘り下げたい' } };
  // フェイブルの道具：ほかのタブを読む・考察を残す
  const tabNo = /(\d+)\s*番?のタブ|タブ\s*(\d+)/.exec(asked);
  if (names.has('read_tab') && /読んで|比べ/.test(asked) && tabNo) return { name: 'read_tab', input: { tab_id: Number(tabNo[1] ?? tabNo[2]) } };
  if (names.has('propose_letter_v2') && /レター/.test(asked)) {
    return {
      name: 'propose_letter_v2',
      input: {
        title: '（練習）迷いを引く習慣',
        points: ['習慣が続く理由を、二つの記事から考えた', 'きっかけを足すより、迷いを引くほうが効く', '次は「やめる理由」を一つ取り除いてみる'],
        body: '（練習モードのレターです）二つの記事を読み比べて、見えてきたことがあります。習慣は、きっかけを足すよりも、迷いを引くことで続きやすくなるのかもしれません。朝の準備を前の晩に済ませておくように、始めるまでの小さな選択を減らすのです。次に何かを続けたくなったら、まず「やめてしまう理由」を一つ取り除いてみてください。',
      },
    };
  }
  if (names.has('propose_letter') && /レター/.test(asked)) {
    return {
      name: 'propose_letter',
      input: {
        title: '（練習）迷いを引く習慣',
        body: '（練習モードのレターです）二つの記事を読み比べて、見えてきたことがあります。習慣は、きっかけを足すよりも、迷いを引くことで続きやすくなるのかもしれません。朝の準備を前の晩に済ませておくように、始めるまでの小さな選択を減らすのです。次に何かを続けたくなったら、まず「やめてしまう理由」を一つ取り除いてみてください。',
      },
    };
  }
  if (names.has('save_insight') && /残して/.test(asked)) return { name: 'save_insight', input: { place: 'memo_cell', text: '（練習）フェイブルの考察：二つの記事は、同じことを逆の側から見ている' } };
  const ids = [...asked.matchAll(/(\d+)\s*番?のタブ|タブ\s*(\d+)/g)].map((m) => Number(m[1] ?? m[2]));
  const minutes = /(\d+)\s*分後/.exec(asked);
  const url = /https?:\/\/\S+/.exec(asked);
  if (/リマインダー/.test(asked) && /一覧/.test(asked)) return { name: 'list_reminders', input: {} };
  const remember = /「(.+?)」と?覚えて/.exec(asked);
  if (remember) return { name: 'remember', input: { text: remember[1] } };
  const forget = /\[(\w+)\]\s*を?忘れて/.exec(asked);
  if (forget) return { name: 'forget', input: { memory_id: forget[1] } };
  if (/覚えていること/.test(asked)) return { name: 'list_memories', input: {} };
  const addTopic = /「(.+?)」をトピック/.exec(asked);
  if (addTopic) return { name: 'add_topic', input: { name: addTopic[1], query: `${addTopic[1]}の新しい情報`, every_hours: 0 } };
  const runTopic = /「(.+?)」の情報を集めて/.exec(asked);
  if (runTopic) return { name: 'run_topic', input: { name: runTopic[1] } };
  if (/トピックの一覧/.test(asked)) return { name: 'list_topics', input: {} };
  if (names.has('find_route') && /昨日|おととい|一昨日|先週|今週|さっき|見た記事|言葉で|順路から/.test(asked)) {
    return { name: 'find_route', input: { query: asked.replace(/^（.*?）\n/s, '').slice(0, 80) } };
  }
  if (/順路/.test(asked)) return { name: 'list_routes', input: {} };
  const card = /「(.+?)」を単語帳/.exec(asked);
  if (card) return { name: 'add_vocab_card', input: { kind: 'word', front: card[1], back: '（練習モード）意味がここに入ります' } };
  if (/単語帳|復習/.test(asked)) return { name: 'vocab_status', input: {} };
  if (minutes) return { name: 'set_reminder', input: { text: '練習のリマインダー', in_minutes: Number(minutes[1]) } };
  if (/音楽/.test(asked) && /止め|一時停止/.test(asked)) return { name: 'control_media', input: { action: 'pause' } };
  if (/音楽/.test(asked) && /再開/.test(asked)) return { name: 'control_media', input: { action: 'resume' } };
  if (/音楽/.test(asked)) return { name: 'play_music', input: { query: asked.replace(/.*音楽[をで]?/, '').replace(/[をかけて。]/g, '').trim() || 'lofi' } };
  if (url) return { name: 'open_url', input: { url: url[0], background: /あとで|後で/.test(asked) } };
  if (/閉じ/.test(asked) && ids.length) return { name: 'close_tabs', input: { tab_ids: ids, reason: '練習' } };
  if (/休眠|眠らせ/.test(asked) && ids.length) return { name: 'sleep_tabs', input: { tab_ids: ids } };
  if (/切り替え|表示して/.test(asked) && ids.length) return { name: 'switch_to_tab', input: { tab_id: ids[0] } };
  const island = /「(.+?)」の島/.exec(asked);
  if (island && ids.length) return { name: 'make_island', input: { name: island[1], tab_ids: ids } };
  const tag = /「(.+?)」タグ/.exec(asked);
  if (tag && ids.length) return { name: 'tag_tabs', input: { tab_ids: ids, add: [tag[1]] } };
  if (/タブ/.test(asked) && /一覧|探/.test(asked)) return { name: 'list_tabs', input: {} };
  return null;
}

// 最後の発言が道具の結果なら、その中身
// 最後の発言（user）の文のどれかが、notes のどれかと同じか（「先生を使わないで」の一文が添えてあるかを見る）
function lastUserHas(messages: Anthropic.Beta.BetaMessageParam[], notes: readonly string[]): boolean {
  const last = messages.at(-1);
  if (!last || typeof last.content === 'string') return false;
  return last.content.some((block) => block.type === 'text' && notes.includes(block.text));
}

function lastToolResult(messages: Anthropic.Beta.BetaMessageParam[]): string | null {
  const last = messages.at(-1);
  if (!last || typeof last.content === 'string') return null;
  const result = last.content.find((block) => block.type === 'tool_result');
  if (!result || result.type !== 'tool_result') return null;
  return typeof result.content === 'string' ? result.content : '';
}

// キャラごとに少し違う返事（練習モード。指示文の性格の言葉で選び、無ければ名前で選ぶ）
const PRACTICE_LINES: [RegExp, string, string][] = [
  [/賢者/, 'ふむ、根っこにあるのは「なぜそれが大事なのか」という問いですね。', 'みなさんの話をまとめると、ひとつの筋が見えてきます。'],
  [/質問役/, 'ねえ、それってつまりどういうこと？ そもそも、なぜそうなるのかが気になります！', 'えっ、それ面白い！ もっと聞きたいです。'],
  [/確かめ役/, '根拠はどこに書いてあるか、まず確かめてみましょう。', 'ちょっと待って、本当にそうでしょうか？'],
  [/実践役/, 'じゃあ、今日できる小さな一歩から始めてみませんか。', 'いいですね、それならすぐ試せそうです。'],
  [/ツッコミ|別の視点/, '別の角度から見ると、ちょっと違う景色もありますよ。', 'なるほど、でも反対の見方もできそうですね。'],
  [/学習サポート/, 'ここで一つ質問です。いちばん大事なところはどこだと思いますか？', '覚えるなら、例を一つ作ってみるといいですよ。'],
  [/盛り上げ/, 'わあ、それはワクワクしますね！', 'いいですね、そこが面白いところです！'],
  // ハイク組（係で選ぶ）
  [/見る係/, 'まず見てみたよ！ ページの中に、気になるところがひとつあったよ。', 'へえ、そこ見てみたい！'],
  [/調べ係/, '調べてみると、出典がひとつ見つかりました。数字は確かめてから使いましょう。', '根拠を照らしておきますね。'],
  [/まとめ係/, 'まとめると、大事なのは2つ。今日の一歩は、ひとつだけ試してみることです。', 'うん、いい流れ。まとめておくね。'],
  [/確かめ係/, 'ページと照らすと、ここは合っています。ひとつだけ、出典がはっきりしません。', 'そこは確かめておきます。'],
  [/記録係/, 'ひとことで書き留めると「迷いを引くと続く」。メモに残しますか？', 'それ、書き留めておきます。'],
  [/見回り係/, 'ざっと見渡すと、似たタブがいくつか並んでいます。まとめて見ると早そうです。', '全体はこんな感じです。'],
];

function practiceLine(system: string, name: string, short: boolean): string {
  // 自分の性格の行だけを見る（三人組の指示文には、仲間の性格も書いてある）
  const persona = /(?:あなたの性格と役割|役割)：(.+)/.exec(system)?.[1] ?? '';
  const hit = PRACTICE_LINES.find(([pattern]) => pattern.test(persona));
  if (hit) return short ? hit[2] : hit[1];
  const lines = short ? ['なるほど、そこは別の見方もできそうですね。', 'うんうん、大事なところですね。'] : ['別の角度から見ると面白いところがありますよ。', 'それ、もう少し考えてみたいですね。'];
  const sum = [...name].reduce((n, ch) => n + (ch.codePointAt(0) ?? 0), 0);
  return lines[sum % lines.length];
}

// 出来事へのひとこと（練習モード）
function practiceReaction(asked: string): string {
  if (asked.includes('最後まで読みました')) return '（練習モード）読み終えましたね、おつかれさまです。いちばん残ったところを、あとで一行メモしておくと思い出しやすいですよ。';
  if (asked.includes('♥×3')) return '（練習モード）♥×3、よほど響いたんですね。どこが良かったのか、あとで聞かせてください。';
  return '（練習モード）メモ、受け取りました。本物の返事は、⚙ で API キーを入れて練習モードを切ると届きます。';
}

function lastText(messages: Anthropic.Beta.BetaMessageParam[]): string {
  const last = messages.at(-1);
  if (!last) return '';
  if (typeof last.content === 'string') return last.content;
  const texts = last.content.flatMap((block) => (block.type === 'text' ? [block.text] : []));
  return texts.at(-1) ?? '';
}
