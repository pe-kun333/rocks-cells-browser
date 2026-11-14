// 計算の確かめ（API を呼ばない）。走らせ方： npm --prefix ui run check
//   node がそのまま走らせる（型は消される）ので、読む相手は .ts まで書く。tsc（typecheck）の対象外
import assert from 'node:assert/strict';
import { costOf, FABLE_MODEL, HAIKU_MODEL, knownModelId, LEGACY_FABLE_MODEL, MODELS, priceRowOf, savedVoiceModel } from '../src/ai/prices.ts';
import { ADVISOR_BETA, buildRequest, EFFORT_BETA, FALLBACK_BETA, hasAdvisorTool, latestEffortMessage, requestShape } from '../src/ai/request.ts';
import {
  ADVISOR_PAUSED_NOTE,
  ADVISOR_REST_NOTE,
  advisorBadge,
  advisorBuilt,
  advisorConsentLines,
  advisorCountOf,
  advisorLiveText,
  advisorMarkOf,
  advisorMarkSteps,
  advisorSignalOf,
  advisorStep,
  advisorStopEstimate,
  advisorTool,
  advisorTurnPlan,
  advisorWaitText,
  countFrom,
  DEFAULT_ADVISOR_DEF,
  elapsedLabel,
  elapsedNote,
  hasAdvisorBlocks,
  mergeAdvisorCalls,
  newAdvisorState,
  parseAdvisorDef,
  parseAdvisorState,
  readAdvisor,
  readAdvisorCalls,
  readAdvisorUsage,
} from '../src/ai/trio-advisor.ts';

let passed = 0;
const failed: string[] = [];
function check(name: string, run: () => void) {
  try {
    run();
    passed++;
  } catch (error) {
    failed.push(`${name}\n    ${String((error as Error).message).split('\n').slice(0, 6).join('\n    ')}`);
  }
}
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

// ---------- request の組み立て（切り出す前の client.ts の形を、そのまま書き写したもの） ----------
const user = (text: string) => ({ role: 'user' as const, content: [{ type: 'text' as const, text }] });
const SEARCH = { type: 'web_search_20260209' as const, name: 'web_search' as const, max_uses: 3 };
const CLIENT_TOOL = { name: 'list_tabs', description: 'タブの一覧', input_schema: { type: 'object' as const, properties: {} } };
const messages = [user('こんにちは')];

check('道具つき・ふつうのモデル：今までの形', () => {
  assert.deepEqual(buildRequest({ model: 'claude-opus-5-5', system: 'S', messages, tools: [CLIENT_TOOL, SEARCH] }, true), {
    model: 'claude-opus-5-5',
    max_tokens: 32000,
    system: 'S',
    messages,
    tools: [CLIENT_TOOL, SEARCH],
    tool_choice: { type: 'auto' },
    output_config: { effort: 'medium' },
    cache_control: { type: 'ephemeral' },
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
  });
});

check('道具なし：tools も tool_choice も送らない', () => {
  const r = buildRequest({ model: 'claude-sonnet-5-5', system: 'S', messages, effort: 'high' }, true);
  assert.deepEqual(r, {
    model: 'claude-sonnet-5-5',
    max_tokens: 32000,
    system: 'S',
    messages,
    output_config: { effort: 'high' },
    cache_control: { type: 'ephemeral' },
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
  });
  assert.ok(!('tools' in r) && !('tool_choice' in r));
});

check('空の道具の一覧も、道具なしと同じ', () => {
  const r = buildRequest({ model: 'claude-sonnet-5-5', system: 'S', messages, tools: [] }, true);
  assert.ok(!('tools' in r) && !('tool_choice' in r));
});

check('Haiku：fallbacks もそのベータも送らない', () => {
  assert.deepEqual(buildRequest({ model: HAIKU_MODEL.id, system: 'S', messages, tools: [CLIENT_TOOL] }, false), {
    model: HAIKU_MODEL.id,
    max_tokens: 32000,
    system: 'S',
    messages,
    tools: [CLIENT_TOOL],
    tool_choice: { type: 'auto' },
    output_config: { effort: 'medium' },
    cache_control: { type: 'ephemeral' },
    betas: [],
  });
});

check('noMoreTools：道具の一覧はそのまま、tool_choice だけ none', () => {
  const r = buildRequest({ model: 'claude-opus-5-5', system: 'S', messages, tools: [CLIENT_TOOL], noMoreTools: true }, true);
  assert.deepEqual(r.tools, [CLIENT_TOOL]);
  assert.deepEqual(r.tool_choice, { type: 'none' });
});

check('cache: false：cache_control を送らない。maxTokens はそのまま使う', () => {
  const r = buildRequest({ model: 'claude-opus-5-5', system: 'S', messages, cache: false, maxTokens: 8000 }, true);
  assert.ok(!('cache_control' in r));
  assert.equal(r.max_tokens, 8000);
});

check('深さを max に変える system メッセージ：上限 64000 とベータ', () => {
  const history = [user('a'), { role: 'system' as const, content: [], output_config: { effort: 'max' as const } }, user('b')];
  assert.equal(latestEffortMessage(history), 'max');
  const r = buildRequest({ model: FABLE_MODEL.id, system: 'S', messages: history, effort: 'high' }, true);
  assert.equal(r.max_tokens, 64000);
  assert.deepEqual(r.betas, [FALLBACK_BETA, EFFORT_BETA]);
  assert.equal(r.output_config.effort, 'high');
});

check('深さを high に戻したあと：上限 32000、ベータは付いたまま', () => {
  const history = [
    user('a'),
    { role: 'system' as const, content: [], output_config: { effort: 'max' as const } },
    user('b'),
    { role: 'system' as const, content: [], output_config: { effort: 'high' as const } },
  ];
  const r = buildRequest({ model: FABLE_MODEL.id, system: 'S', messages: history }, true);
  assert.equal(r.max_tokens, 32000);
  assert.deepEqual(r.betas, [FALLBACK_BETA, EFFORT_BETA]);
});

check('Haiku で深さを変える system メッセージ：ベータは深さの分だけ', () => {
  const history = [user('a'), { role: 'system' as const, content: [], output_config: { effort: 'high' as const } }, user('b')];
  assert.deepEqual(buildRequest({ model: HAIKU_MODEL.id, system: 'S', messages: history }, false).betas, [EFFORT_BETA]);
});

check('max の深さでも、maxTokens を渡せばそちらを使う', () => {
  const history = [user('a'), { role: 'system' as const, content: [], output_config: { effort: 'max' as const } }, user('b')];
  assert.equal(buildRequest({ model: FABLE_MODEL.id, system: 'S', messages: history, maxTokens: 8000 }, true).max_tokens, 8000);
});

// ---------- 先生つきの request ----------
const ADVISOR = advisorTool(DEFAULT_ADVISOR_DEF);

check('道具の定義：caching が null なら項目ごと無い', () => {
  assert.deepEqual(ADVISOR, { type: 'advisor_20260301', name: 'advisor', model: 'claude-fable-5-2', max_uses: 1, max_tokens: 2048 });
  assert.deepEqual(advisorTool({ ...DEFAULT_ADVISOR_DEF, caching: { ttl: '1h' } }).caching, { type: 'ephemeral', ttl: '1h' });
});

check('先生つき：ベータが足され、fallbacks が無い。ほかは同じ', () => {
  assert.ok(hasAdvisorTool([SEARCH, ADVISOR]));
  assert.ok(!hasAdvisorTool([SEARCH, CLIENT_TOOL]));
  assert.ok(!hasAdvisorTool(undefined));
  assert.deepEqual(buildRequest({ model: 'claude-sonnet-5-5', system: 'S', messages, tools: [SEARCH, ADVISOR], effort: 'high' }, true), {
    model: 'claude-sonnet-5-5',
    max_tokens: 32000,
    system: 'S',
    messages,
    tools: [SEARCH, ADVISOR],
    tool_choice: { type: 'auto' },
    output_config: { effort: 'high' },
    cache_control: { type: 'ephemeral' },
    betas: [ADVISOR_BETA],
  });
});

check('先生つきで noMoreTools：道具は外れず、tool_choice だけ none', () => {
  const r = buildRequest({ model: 'claude-sonnet-5-5', system: 'S', messages, tools: [SEARCH, ADVISOR], noMoreTools: true }, true);
  assert.deepEqual(r.tools, [SEARCH, ADVISOR]);
  assert.deepEqual(r.tool_choice, { type: 'none' });
  assert.deepEqual(r.betas, [ADVISOR_BETA]);
});

check('先生つきで深さのベータもあるとき・fallback が無いモデルのとき', () => {
  const history = [user('a'), { role: 'system' as const, content: [], output_config: { effort: 'high' as const } }, user('b')];
  const r = buildRequest({ model: 'claude-sonnet-5-5', system: 'S', messages: history, tools: [SEARCH, ADVISOR] }, true);
  assert.deepEqual(r.betas, [EFFORT_BETA, ADVISOR_BETA]);
  assert.ok(!('fallbacks' in r));
  const none = buildRequest({ model: HAIKU_MODEL.id, system: 'S', messages, tools: [ADVISOR] }, false);
  assert.deepEqual(none.betas, [ADVISOR_BETA]);
  assert.ok(!('fallbacks' in none));
});

check('記録用の形：本文は入らない', () => {
  const shape = requestShape(buildRequest({ model: 'claude-sonnet-5-5', system: 'S', messages, tools: [SEARCH, ADVISOR] }, true));
  assert.deepEqual(shape, {
    model: 'claude-sonnet-5-5',
    tools: ['web_search', 'advisor(claude-fable-5-2)'],
    tool_choice: 'auto',
    betas: [ADVISOR_BETA],
    fallbacks: null,
    effort: 'medium',
    cache: true,
    max_tokens: 32000,
    messages: 1,
  });
});

check('保存した定義を読む：形が違えば null、数字は範囲に丸める', () => {
  assert.equal(parseAdvisorDef(null), null);
  assert.equal(parseAdvisorDef({ maxUses: 1 }), null);
  assert.deepEqual(parseAdvisorDef({ model: 'claude-fable-5-2', maxUses: 0, maxTokens: 10, caching: { ttl: '5m' } }), { model: 'claude-fable-5-2', maxUses: 1, maxTokens: 2048, caching: { ttl: '5m' } });
  assert.deepEqual(parseAdvisorDef({ model: 'm', maxUses: 999, maxTokens: 9_999_999, caching: { ttl: '2h' } }), { model: 'm', maxUses: 1, maxTokens: 2048, caching: null });
  assert.deepEqual(parseAdvisorDef({ model: 'm', maxUses: 2, maxTokens: 4096, caching: null }), { model: 'm', maxUses: 2, maxTokens: 4096, caching: null });
});

// ---------- 返事から読む（形は公式の資料と SDK の型から。本物の返事ではまだ確かめていない） ----------
const TEXT = { type: 'text', text: '答え' };
const CALL = { type: 'server_tool_use', id: 's1', name: 'advisor', input: {} };
const OK = { type: 'advisor_tool_result', tool_use_id: 's1', content: { type: 'advisor_redacted_result', encrypted_content: 'xxxx', stop_reason: 'end_turn' } };
const CUT = { type: 'advisor_tool_result', tool_use_id: 's1', content: { type: 'advisor_redacted_result', encrypted_content: 'xxxx', stop_reason: 'max_tokens' } };
const BUSY = { type: 'advisor_tool_result', tool_use_id: 's1', content: { type: 'advisor_tool_result_error', error_code: 'overloaded' } };
const SEARCH_CALL = { type: 'server_tool_use', id: 's2', name: 'web_search', input: { query: 'q' } };

check('見てもらっていない返事', () => {
  assert.deepEqual(readAdvisorCalls([TEXT, SEARCH_CALL]), { calls: 0, done: 0, errors: [], truncated: 0, pending: 0 });
  assert.deepEqual(readAdvisorCalls(null), { calls: 0, done: 0, errors: [], truncated: 0, pending: 0 });
  assert.equal(advisorStep(readAdvisorCalls([TEXT])), null);
});

check('1 回見てもらった', () => {
  const calls = readAdvisorCalls([CALL, OK, TEXT]);
  assert.deepEqual(calls, { calls: 1, done: 1, errors: [], truncated: 0, pending: 0 });
  assert.equal(advisorStep(calls), '🔒 先生に見てもらった（1 回・中身は見えません）');
  assert.equal(advisorStep(calls, { outside: true }), '🔒 先生に見てもらった（1 回・中身は見えません）（今日の枠の外）');
  assert.equal(advisorStep(calls, { practice: true }), '🔒 練習：先生に見てもらった（1 回・中身は見えません）（送っていません）');
});

check('先生が混んでいた・助言が途中で切れた・結果がまだ無い', () => {
  const busy = readAdvisorCalls([CALL, BUSY, TEXT]);
  assert.deepEqual(busy, { calls: 1, done: 0, errors: ['overloaded'], truncated: 0, pending: 0 });
  assert.equal(advisorStep(busy), '🔒 先生は使えなかった（先生が混んでいた）');
  assert.deepEqual(readAdvisorCalls([CALL, CUT, TEXT]), { calls: 1, done: 1, errors: [], truncated: 1, pending: 0 });
  assert.equal(advisorStep(readAdvisorCalls([CALL, CUT, TEXT])), '🔒 先生に見てもらった（1 回・中身は見えません・助言は途中まで）');
  assert.deepEqual(readAdvisorCalls([CALL]), { calls: 1, done: 0, errors: [], truncated: 0, pending: 1 });
  assert.equal(advisorStep(readAdvisorCalls([CALL])), null);
  const unknown = readAdvisorCalls([CALL, { type: 'advisor_tool_result', tool_use_id: 's1', content: { type: 'advisor_tool_result_error', error_code: 'new_code' } }]);
  assert.equal(advisorStep(unknown), '🔒 先生は使えなかった（理由：new_code）');
});

check('返事が途中で分かれたとき：呼んだブロックと結果が別々の返事にあっても、足せば合う', () => {
  const first = readAdvisorCalls([TEXT, CALL]); // pause_turn で止まった返事
  const second = readAdvisorCalls([OK, TEXT]); // 送り直しの返事（結果だけがある）
  assert.deepEqual(first, { calls: 1, done: 0, errors: [], truncated: 0, pending: 1 });
  assert.deepEqual(second, { calls: 0, done: 1, errors: [], truncated: 0, pending: 0 });
  assert.equal(advisorStep(second), '🔒 先生に見てもらった（1 回・中身は見えません）');
  const whole = mergeAdvisorCalls([first, second]);
  assert.deepEqual(whole, { calls: 1, done: 1, errors: [], truncated: 0, pending: 0 });
  assert.equal(advisorStep(whole), '🔒 先生に見てもらった（1 回・中身は見えません）');
  assert.deepEqual(mergeAdvisorCalls([first, readAdvisorCalls([BUSY, TEXT])]), { calls: 1, done: 0, errors: ['overloaded'], truncated: 0, pending: 0 });
  assert.deepEqual(mergeAdvisorCalls([]), { calls: 0, done: 0, errors: [], truncated: 0, pending: 0 });
});

check('形の違うブロックが混ざっても落ちない', () => {
  assert.deepEqual(readAdvisorCalls([null, 3, 'x', { type: 'advisor_tool_result' }, { type: 'advisor_tool_result', content: { type: 'advisor_tool_result_error' } }]), { calls: 0, done: 1, errors: ['unknown'], truncated: 0, pending: 0 });
});

check('ストリームの合図', () => {
  assert.equal(advisorSignalOf(CALL), 'asking');
  assert.equal(advisorSignalOf(OK), 'done');
  assert.equal(advisorSignalOf(BUSY), 'failed');
  assert.equal(advisorSignalOf(SEARCH_CALL), null);
  assert.equal(advisorSignalOf(TEXT), null);
  assert.equal(advisorSignalOf(undefined), null);
});

const ITER_MESSAGE = { type: 'message', input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const ITER_ADVISOR = { type: 'advisor_message', model: 'claude-fable-5-2', input_tokens: 1500, output_tokens: 600, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 };

check('iterations が無い・null・知らない形', () => {
  for (const value of [null, undefined, 'x', {}, [null, 3, { type: 'compaction' }]]) {
    assert.deepEqual(readAdvisorUsage(value), { usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, model: null, count: 0 });
  }
});

check('advisor_message だけを足す（message・fallback_message は足さない）', () => {
  const read = readAdvisorUsage([ITER_MESSAGE, ITER_ADVISOR, ITER_MESSAGE, { type: 'fallback_message', model: 'claude-opus-5', input_tokens: 9, output_tokens: 9 }, { ...ITER_ADVISOR, output_tokens: 400, cache_read_input_tokens: undefined }]);
  assert.deepEqual(read, { usage: { input: 3000, output: 1000, cacheRead: 100, cacheWrite: 0 }, model: 'claude-fable-5-2', count: 2 });
});

check('1 つの返事の先生の分：相談相手のモデルは使用量の名前、無ければ送った定義。使用量が無ければ「数えられていない」', () => {
  const full = readAdvisor([CALL, OK, TEXT], [ITER_MESSAGE, ITER_ADVISOR], 'claude-fable-5-1');
  assert.equal(full.model, 'claude-fable-5-2');
  assert.equal(full.unpriced, false);
  assert.deepEqual(full.usage, { input: 1500, output: 600, cacheRead: 100, cacheWrite: 0 });
  const noName = readAdvisor([CALL, OK], [{ ...ITER_ADVISOR, model: undefined }], 'claude-fable-5-2');
  assert.equal(noName.model, 'claude-fable-5-2');
  const missing = readAdvisor([CALL, OK, TEXT], null, 'claude-fable-5-2');
  assert.equal(missing.unpriced, true);
  assert.equal(missing.model, null);
  assert.equal(missing.done, 1);
  const none = readAdvisor([TEXT], [ITER_MESSAGE], 'claude-fable-5-2');
  assert.equal(none.unpriced, false);
  assert.equal(none.model, null);
  assert.equal(readAdvisor([CALL, BUSY, TEXT], [ITER_MESSAGE], 'claude-fable-5-2').unpriced, false);
});

// ---------- 料金 ----------
check('今までの料金は変わらない', () => {
  near(costOf({ input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }, 'claude-opus-5-5'), 4);
  near(costOf({ input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0 }, 'claude-sonnet-5-5'), 10);
  near(costOf({ input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 }, FABLE_MODEL.id), FABLE_MODEL.input + FABLE_MODEL.output + FABLE_MODEL.cacheRead + FABLE_MODEL.cacheWrite);
  near(costOf({ input: 50_000, output: 1000, cacheRead: 0, cacheWrite: 0 }, HAIKU_MODEL.id), (50_000 * 0.1 + 1000 * 0.5) / 1e6);
  near(costOf({ input: 150_000, output: 1000, cacheRead: 0, cacheWrite: 0 }, HAIKU_MODEL.id), (150_000 * 0.5 + 1000 * 2.5) / 1e6);
  near(costOf({ input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }, 'claude-unknown-9'), MODELS[0].input);
});

check('Fable 5.2 は Opus の値段で数えない（入力 $8・出力 $40・読み直し $0.20）', () => {
  near(costOf({ input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }, 'claude-fable-5-2'), 8);
  near(costOf({ input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0 }, 'claude-fable-5-2'), 40);
  near(costOf({ input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 0 }, 'claude-fable-5-2'), 0.2);
  assert.equal(priceRowOf('claude-fable-5-2')?.label, 'Claude Fable 5.2');
});

check('先生つきの返事の料金：実行役の分と相談の分を別々に数えて足す', () => {
  const executor = costOf({ input: 3100, output: 200, cacheRead: 0, cacheWrite: 0 }, 'claude-sonnet-5-5');
  const read = readAdvisorUsage([ITER_MESSAGE, ITER_ADVISOR, ITER_MESSAGE]);
  const advisor = costOf(read.usage, read.model ?? DEFAULT_ADVISOR_DEF.model);
  near(executor, (3100 * 2 + 200 * 10) / 1e6);
  near(advisor, (1500 * 8 + 600 * 40 + 100 * 0.2) / 1e6);
  near(executor + advisor, 0.0082 + 0.03602);
});

// ---------- フェイブルを Fable 5.2 に ----------
check('フェイブルは Fable 5.2。5.1 も、名前と料金を引ける', () => {
  assert.equal(FABLE_MODEL.id, 'claude-fable-5-2');
  assert.equal(DEFAULT_ADVISOR_DEF.model, FABLE_MODEL.id);
  near(costOf({ input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 0 }, LEGACY_FABLE_MODEL.id), 10 + 50 + 0.25);
  assert.equal(priceRowOf('claude-fable-5-1')?.label, 'Claude Fable 5.1');
});

check('保存した会話：5.1 で話し始めた会話は 5.1 のまま。知らない名前は今の設定に任せる', () => {
  assert.equal(knownModelId('claude-fable-5-1'), 'claude-fable-5-1');
  assert.equal(knownModelId('claude-fable-5-2'), 'claude-fable-5-2');
  assert.equal(knownModelId('claude-haiku-5-5'), 'claude-haiku-5-5');
  assert.equal(knownModelId('claude-fable-9'), undefined);
  assert.equal(knownModelId(undefined), undefined);
  assert.equal(savedVoiceModel('fable', 'claude-fable-5-1', true), 'claude-fable-5-1');
  assert.equal(savedVoiceModel('fable', 'claude-fable-5-2', true), 'claude-fable-5-2');
});

check('保存した会話：モデルを保存していない前の形で、もう話しているフェイブルは 5.1。まだ話していなければ今の設定', () => {
  assert.equal(savedVoiceModel('fable', undefined, true), 'claude-fable-5-1');
  assert.equal(savedVoiceModel('fable', undefined, false), undefined);
  assert.equal(savedVoiceModel('trio2', undefined, true), undefined);
  assert.equal(savedVoiceModel('trio2', 'claude-sonnet-5-5', true), 'claude-sonnet-5-5');
});

// ---------- 今日の回数 ----------
check('今日の回数：日付が違えば 0、壊れていても 0', () => {
  assert.equal(countFrom(JSON.stringify({ date: '2026-11-13', count: 3 }), '2026-11-13'), 3);
  assert.equal(countFrom(JSON.stringify({ date: '2026-11-12', count: 3 }), '2026-11-13'), 0);
  assert.equal(countFrom('{', '2026-11-13'), 0);
  assert.equal(countFrom(null, '2026-11-13'), 0);
  assert.equal(countFrom(JSON.stringify({ date: '2026-11-13', count: -2 }), '2026-11-13'), 0);
  assert.equal(countFrom('{"date":"2026-11-13","count":1e999}', '2026-11-13'), 0);
});

// ---------- P2：会話ごとの状態・その回の扱い・記録 ----------
const TRIO = ['trio1', 'trio2', 'trio3'];

check('先生つきの状態：新しく作る（who は三人組だけ・並びは決まった順・だれもいなければ null）', () => {
  const s = newAdvisorState(['trio3', 'fable', 'trio1', 'trio1'], TRIO, false);
  assert.deepEqual(s, { model: 'claude-fable-5-2', maxUses: 1, maxTokens: 2048, caching: null, who: ['trio1', 'trio3'], paused: false, stopped: [], practice: false });
  assert.equal(newAdvisorState(['fable', 'main'], TRIO, false), null);
  assert.equal(newAdvisorState([], TRIO, true), null);
  assert.equal(newAdvisorState(['trio2'], TRIO, true)?.practice, true);
  // 既定を変えても、作った状態は変わらない（別の入れ物）
  const def = { model: 'm', maxUses: 2, maxTokens: 4096, caching: { ttl: '5m' as const } };
  const t = newAdvisorState(['trio2'], TRIO, false, def);
  def.caching.ttl = '5m';
  assert.notEqual(t?.caching, def.caching);
});

check('先生つきの状態：保存したものを読む（既定でない定義がそのまま戻る）', () => {
  const saved = { model: 'claude-fable-5-1', maxUses: 2, maxTokens: 4096, caching: { ttl: '1h' }, who: ['trio2', 'trio1'], paused: true, stopped: ['trio2', 'trio3'], practice: true };
  const s = parseAdvisorState(JSON.parse(JSON.stringify(saved)), TRIO);
  assert.deepEqual(s, { model: 'claude-fable-5-1', maxUses: 2, maxTokens: 4096, caching: { ttl: '1h' }, who: ['trio1', 'trio2'], paused: true, stopped: ['trio2'], practice: true });
  // 保存 → 読む → 送る道具が、保存したときと同じ
  assert.deepEqual(advisorTool(s!), { type: 'advisor_20260301', name: 'advisor', model: 'claude-fable-5-1', max_uses: 2, max_tokens: 4096, caching: { type: 'ephemeral', ttl: '1h' } });
  // 作る → 保存 → 読む で同じ
  const fresh = newAdvisorState(TRIO, TRIO, false);
  assert.deepEqual(parseAdvisorState(JSON.parse(JSON.stringify(fresh)), TRIO), fresh);
});

check('先生つきの状態：無い・壊れている・だれも持っていないなら先生なし', () => {
  assert.equal(parseAdvisorState(undefined, TRIO), null);
  assert.equal(parseAdvisorState(null, TRIO), null);
  assert.equal(parseAdvisorState('x', TRIO), null);
  assert.equal(parseAdvisorState({ who: ['trio1'] }, TRIO), null); // モデルが無い
  assert.equal(parseAdvisorState({ model: 'm', who: [] }, TRIO), null);
  assert.equal(parseAdvisorState({ model: 'm', who: ['fable'] }, TRIO), null);
  assert.equal(parseAdvisorState({ model: 'm', who: 'trio1' }, TRIO), null);
  const s = parseAdvisorState({ model: 'm', who: ['trio1'], paused: 'yes', stopped: 'trio1', practice: 1 }, TRIO);
  assert.deepEqual(s, { model: 'm', maxUses: 1, maxTokens: 2048, caching: null, who: ['trio1'], paused: false, stopped: [], practice: false });
});

check('道具を組むか：練習で始めた会話は、本物のキーでは組まない', () => {
  const real = newAdvisorState(TRIO, TRIO, false);
  const practice = newAdvisorState(TRIO, TRIO, true);
  assert.equal(advisorBuilt(null, false), false);
  assert.equal(advisorBuilt(null, true), false);
  assert.equal(advisorBuilt(real, false), true);
  assert.equal(advisorBuilt(real, true), true); // 本物で始めた会話を練習で開く：形だけ組む（送らない）
  assert.equal(advisorBuilt(practice, true), true);
  assert.equal(advisorBuilt(practice, false), false);
});

check('その回の扱い：先生を持たない体は、何も変えない', () => {
  for (const userSent of [true, false]) {
    assert.deepEqual(advisorTurnPlan({ has: false, userSent, stopped: true, paused: true, remaining: 0 }), { note: null, noTools: false });
  }
});

check('その回の扱い：出来事・掛け合い・道具なしの1回は tool_choice none（一文は添えない）', () => {
  assert.deepEqual(advisorTurnPlan({ has: true, userSent: false, stopped: false, paused: false, remaining: 5 }), { note: null, noTools: true });
  assert.deepEqual(advisorTurnPlan({ has: true, userSent: false, stopped: false, paused: true, remaining: 0 }), { note: null, noTools: true });
});

check('その回の扱い：枠が尽きた・休ませているときは一文、枠の外が出た体は tool_choice none', () => {
  assert.deepEqual(advisorTurnPlan({ has: true, userSent: true, stopped: false, paused: false, remaining: 3 }), { note: null, noTools: false });
  assert.deepEqual(advisorTurnPlan({ has: true, userSent: true, stopped: false, paused: false, remaining: 0 }), { note: ADVISOR_REST_NOTE, noTools: false });
  assert.deepEqual(advisorTurnPlan({ has: true, userSent: true, stopped: false, paused: true, remaining: 3 }), { note: ADVISOR_PAUSED_NOTE, noTools: false });
  assert.deepEqual(advisorTurnPlan({ has: true, userSent: true, stopped: true, paused: false, remaining: 3 }), { note: null, noTools: true });
  assert.deepEqual(advisorTurnPlan({ has: true, userSent: true, stopped: true, paused: true, remaining: 0 }), { note: null, noTools: true });
});

const part = (over: Record<string, unknown> = {}) => ({ calls: 0, done: 0, errors: [] as string[], truncated: 0, pending: 0, cost: 0, model: null as string | null, unpriced: false, ...over });

check('返事の記録：先生を呼んでいなければ null', () => {
  assert.equal(advisorMarkOf([], { rested: false, practice: false }), null);
  assert.equal(advisorMarkOf([part(), part()], { rested: true, practice: false }), null);
});

check('返事の記録：呼んだ回と結果の回が分かれても足す。料金は全部の回の合計', () => {
  const mark = advisorMarkOf(
    [part({ calls: 1, pending: 1, cost: 0 }), part({ done: 1, truncated: 1, cost: 0.21, model: 'claude-fable-5-2' }), part({ cost: 0 })],
    { rested: false, practice: false },
  );
  assert.deepEqual(mark, { calls: 1, done: 1, errors: [], truncated: 1, cost: 0.21, model: 'claude-fable-5-2' });
  assert.deepEqual(advisorMarkSteps(mark!), ['🔒 先生に見てもらった（1 回・中身は見えません・助言は途中まで）']);
});

check('返事の記録：控えるよう頼んだのに見てもらったら「枠の外」。失敗だけなら付かない', () => {
  const outside = advisorMarkOf([part({ calls: 1, done: 1, cost: 0.3, model: 'm' })], { rested: true, practice: false });
  assert.equal(outside?.outside, true);
  assert.deepEqual(advisorMarkSteps(outside!), ['🔒 先生に見てもらった（1 回・中身は見えません）（今日の枠の外）']);
  const failed = advisorMarkOf([part({ calls: 1, errors: ['overloaded'] })], { rested: true, practice: false });
  assert.equal(failed?.outside, undefined);
  assert.deepEqual(advisorMarkSteps(failed!), ['🔒 先生は使えなかった（先生が混んでいた）']);
});

check('返事の記録：料金を数えられなかったら、その行を出す。練習は「練習」と付く', () => {
  const unpriced = advisorMarkOf([part({ calls: 1, done: 1, unpriced: true })], { rested: false, practice: false });
  assert.equal(unpriced?.unpriced, true);
  assert.equal(advisorMarkSteps(unpriced!).length, 2);
  assert.match(advisorMarkSteps(unpriced!)[1], /料金を数えられませんでした/);
  const practice = advisorMarkOf([part({ calls: 1, done: 1 })], { rested: false, practice: true });
  assert.equal(practice?.practice, true);
  assert.deepEqual(advisorMarkSteps(practice!), ['🔒 練習：先生に見てもらった（1 回・中身は見えません）（送っていません）']);
});

check('確認の欄の文：30 日保存・この 1 回だけ・見えない・料金・枠が入る。練習とフェイブルは条件つき', () => {
  const base = advisorConsentLines({ remaining: 4, limit: 5, withFable: false, practice: false, advisorLabel: 'Claude Fable 5.2' });
  const all = base.join('\n');
  for (const word of ['Claude Fable 5.2', '30 日保存', 'この 1 回だけ', '外せません', '画面に出ません', '最大 3 回', 'あと 4 回', '1 日 5 回', '月の上限']) assert.ok(all.includes(word), word);
  assert.ok(!all.includes('練習モード') && !all.includes('会話のフェイブル'));
  const more = advisorConsentLines({ remaining: 4, limit: 5, withFable: true, practice: true, advisorLabel: 'Claude Fable 5.2' });
  assert.equal(more.length, base.length + 2);
  assert.match(more[0], /練習モード/);
  assert.match(more.at(-1)!, /会話のフェイブルとは別/);
});

check('先生つきの request：三人組の体の道具に advisor が最後に付き、ベータが入り、fallbacks は無い', () => {
  const state = newAdvisorState(TRIO, TRIO, false)!;
  const r = buildRequest({ model: 'claude-sonnet-5-5', system: 'S', messages, tools: [SEARCH, advisorTool(state)] }, true);
  const shape = requestShape(r);
  assert.deepEqual(shape.tools, ['web_search', 'advisor(claude-fable-5-2)']);
  assert.ok(shape.betas.includes(ADVISOR_BETA));
  assert.equal(shape.fallbacks, null);
  // 出来事・掛け合いの回：道具の一覧は同じで、tool_choice だけ none
  const quiet = requestShape(buildRequest({ model: 'claude-sonnet-5-5', system: 'S', messages, tools: [SEARCH, advisorTool(state)], noMoreTools: true }, true));
  assert.deepEqual(quiet.tools, shape.tools);
  assert.equal(quiet.tool_choice, 'none');
});

check('返事の記録：決めた回数（maxUses）を超えて助言が届いたら「枠の外」', () => {
  const twice = [part({ calls: 1, done: 1, cost: 0.2, model: 'm' }), part({ calls: 1, done: 1, cost: 0.2, model: 'm' })];
  assert.equal(advisorMarkOf(twice, { rested: false, practice: false, maxUses: 1 })?.outside, true);
  assert.equal(advisorMarkOf(twice, { rested: false, practice: false, maxUses: 2 })?.outside, undefined);
  assert.equal(advisorMarkOf(twice, { rested: false, practice: false })?.outside, undefined);
  assert.equal(advisorMarkOf([part({ calls: 1, done: 1 })], { rested: false, practice: false, maxUses: 1 })?.outside, undefined);
  // 呼んだ数だけ多くて、届いた助言が 1 つ（あとの分は max_uses_exceeded で断られた）なら、枠の外ではない
  const refused = [part({ calls: 1, done: 1 }), part({ calls: 1, errors: ['max_uses_exceeded'] })];
  assert.equal(advisorMarkOf(refused, { rested: false, practice: false, maxUses: 1 })?.outside, undefined);
});

check('返事の記録：止めた request の分（料金が届かない）は、回数と「料金を数えられませんでした」が残る', () => {
  const lost = advisorMarkOf([part({ calls: 1, done: 1, unpriced: true, model: 'claude-fable-5-2' })], { rested: false, practice: false, maxUses: 1 });
  assert.deepEqual(lost, { calls: 1, done: 1, errors: [], truncated: 0, cost: 0, model: 'claude-fable-5-2', unpriced: true });
  // 呼んだだけで結果が届く前に止めた：回数（done）は 0。印の行は出ない
  const asking = advisorMarkOf([part({ calls: 1, pending: 1 })], { rested: false, practice: false, maxUses: 1 });
  assert.equal(asking?.done, 0);
  assert.deepEqual(advisorMarkSteps(asking!), []);
});

check('札：全部の体が止まった・枠が尽きた・休ませているときだけ「休み中」。一部なら「一部」', () => {
  const s = (stopped: string[], paused = false) => ({ who: ['trio1', 'trio2', 'trio3'], paused, stopped });
  assert.equal(advisorBadge(s([]), 5), 'on');
  assert.equal(advisorBadge(s(['trio2']), 5), 'partly');
  assert.equal(advisorBadge(s(['trio1', 'trio2', 'trio3']), 5), 'resting');
  assert.equal(advisorBadge(s([]), 0), 'resting');
  assert.equal(advisorBadge(s([], true), 5), 'resting');
  assert.equal(advisorBadge({ who: ['trio2'], paused: false, stopped: ['trio2'] }, 5), 'resting');
});

check('履歴に先生のブロックがあるか（保存した決まりが読めなかったときの見分け）', () => {
  const said = (content: unknown) => ({ role: 'assistant', content });
  assert.equal(hasAdvisorBlocks([]), false);
  assert.equal(hasAdvisorBlocks([{ role: 'user', content: 'こんにちは' }, said([{ type: 'text', text: 'はい' }])]), false);
  assert.equal(hasAdvisorBlocks([said([SEARCH_CALL])]), false); // Web 検索の server_tool_use は数えない
  assert.equal(hasAdvisorBlocks([said([{ type: 'server_tool_use', id: 'a1', name: 'advisor', input: {} }])]), true);
  assert.equal(hasAdvisorBlocks([said([{ type: 'advisor_tool_result', tool_use_id: 'a1', content: { type: 'advisor_redacted_result', encrypted_content: 'x' } }])]), true);
  assert.equal(hasAdvisorBlocks([null, 3, { role: 'user' }] as unknown[]), false);
});

// ---------- P3：待ちと、止めたときの見積もり ----------
check('止めたときの見積もり：送った入力の全部（読み直しの割引の分も）× 先生の入力の単価', () => {
  // 入力 1,000 + 読み直し 18,000 + 書き込み 1,000 = 20,000 トークン。Fable 5.2 の入力は $8 / 100万
  near(advisorStopEstimate({ input: 1000, cacheRead: 18_000, cacheWrite: 1000 }, FABLE_MODEL.input)!, 0.16);
  // 読み直しの割引の分を落とすと 0.008 になってしまう（そうなっていないこと）
  assert.ok(advisorStopEstimate({ input: 1000, cacheRead: 18_000, cacheWrite: 1000 }, FABLE_MODEL.input)! > 0.1);
  near(advisorStopEstimate({ input: 50_000, cacheRead: 0, cacheWrite: 0 }, 10)!, 0.5);
});

check('止めたときの見積もり：送った量・単価が分からなければ null（0 として黙って数えない）', () => {
  assert.equal(advisorStopEstimate(null, 8), null);
  assert.equal(advisorStopEstimate({ input: 1000, cacheRead: 0, cacheWrite: 0 }, null), null);
  assert.equal(advisorStopEstimate({ input: 1000, cacheRead: 0, cacheWrite: 0 }, undefined), null);
  assert.equal(advisorStopEstimate({ input: 0, cacheRead: 0, cacheWrite: 0 }, 8), null);
  assert.equal(advisorStopEstimate({ input: Number.NaN, cacheRead: -5, cacheWrite: 0 }, 8), null);
  assert.equal(advisorStopEstimate({ input: 1000, cacheRead: 0, cacheWrite: 0 }, Number.NaN), null);
  assert.equal(advisorStopEstimate({ input: 1000, cacheRead: 0, cacheWrite: 0 }, 0), 0); // 単価 0 は 0 ドル
});

check('経過時間の札：0:07・1:42・12:05。負・数でないものは 0:00', () => {
  assert.equal(elapsedLabel(0), '0:00');
  assert.equal(elapsedLabel(7_900), '0:07');
  assert.equal(elapsedLabel(102_000), '1:42');
  assert.equal(elapsedLabel(725_000), '12:05');
  assert.equal(elapsedLabel(-3), '0:00');
  assert.equal(elapsedLabel(Number.NaN), '0:00');
});

check('返事の記録：見ている途中で止まった分は cut。届いた数（done）にも「枠の外」にも入らない。今日の回数には数える', () => {
  const lost = part({ calls: 1, pending: 1, cut: 1, cost: 0.16, model: 'claude-fable-5-2', estimated: true });
  const mark = advisorMarkOf([lost], { rested: true, practice: false, maxUses: 1 })!;
  assert.deepEqual(mark, { calls: 1, done: 0, errors: [], truncated: 0, cost: 0.16, model: 'claude-fable-5-2', cut: 1, estimated: true, estimate: 0.16 });
  assert.equal(mark.outside, undefined); // 控えるよう頼んだ回で止めても、その体を止めない
  assert.equal(advisorCountOf(mark), 1);
  assert.equal(advisorMarkSteps(mark).length, 2);
  assert.equal(advisorMarkSteps(mark)[0], '🔒 先生が見ている途中で止まりました（助言は届いていません）');
  assert.match(advisorMarkSteps(mark)[1], /料金のうち \$0\.160 は見積もり/);
});

check('返事の記録：助言が届いたあとに止まった分は、届いた数に入り、料金は見積もり', () => {
  const mark = advisorMarkOf([part({ calls: 1, done: 1, cut: 0, cost: 0.2, model: 'm', estimated: true })], { rested: false, practice: false, maxUses: 1 })!;
  assert.equal(mark.done, 1);
  assert.equal(mark.cut, undefined);
  assert.equal(mark.estimated, true);
  assert.equal(advisorCountOf(mark), 1);
  assert.equal(advisorMarkSteps(mark).length, 2);
  // ふつうに終わった返事には、cut も見積もりも付かない
  const plain = advisorMarkOf([part({ calls: 1, done: 1, cost: 0.2, model: 'm' })], { rested: false, practice: false, maxUses: 1 })!;
  assert.equal(plain.cut, undefined);
  assert.equal(plain.estimated, undefined);
  assert.equal(advisorCountOf(plain), 1);
});

check('返事の記録：練習で見ている途中に止めた分は「練習」と出て、料金の行は出ない', () => {
  const mark = advisorMarkOf([part({ calls: 1, pending: 1, cut: 1 })], { rested: false, practice: true })!;
  assert.deepEqual(advisorMarkSteps(mark), ['🔒 練習：先生が見ている途中で止まりました（送っていません）']);
});

check('待ちの文と読み上げの文：止めると返事ごと止まると分かる。読み上げは始まりと終わりだけ', () => {
  assert.match(advisorWaitText('ジン'), /ジンの返事を先生が見ています/);
  assert.match(advisorWaitText('ジン'), /止めると、返事ごと止まります/);
  assert.match(advisorLiveText('ジン', 'asking'), /先生が見ています/);
  assert.match(advisorLiveText('ジン', 'done'), /見終わりました/);
  assert.match(advisorLiveText('ジン', 'failed'), /使えませんでした/);
});

check('止めたときの見積もり：その request で先生が読み始めた回数だけ掛ける', () => {
  const sent = { input: 1000, cacheRead: 18_000, cacheWrite: 1000 };
  near(advisorStopEstimate(sent, 8, 2)!, 0.32);
  near(advisorStopEstimate(sent, 8, 1)!, 0.16);
  near(advisorStopEstimate(sent, 8, 0)!, 0.16); // 0・負・数でないものは 1 回として数える
  near(advisorStopEstimate(sent, 8, Number.NaN)!, 0.16);
});

check('返事の記録：本当の料金と見積もりが混ざった返事は、見積もりの分だけを別に持つ', () => {
  const mark = advisorMarkOf(
    [part({ calls: 1, done: 1, cost: 0.21, model: 'm' }), part({ calls: 1, pending: 1, cut: 1, cost: 0.16, model: 'm', estimated: true })],
    { rested: false, practice: false, maxUses: 2 },
  )!;
  near(mark.cost, 0.37);
  near(mark.estimate!, 0.16);
  assert.equal(mark.estimated, true);
  assert.match(advisorMarkSteps(mark).at(-1)!, /料金のうち \$0\.160 は見積もり/);
  assert.match(advisorMarkSteps(mark).at(-1)!, /下限/);
});

check('待ちが長いとき：3 分からひとこと足す。止まった知らせは読み上げにも出る', () => {
  assert.equal(elapsedNote(0), '');
  assert.equal(elapsedNote(179_000), '');
  assert.equal(elapsedNote(180_000), '・長くかかっています');
  assert.match(advisorLiveText('ジン', 'stopped'), /途中で、ジンの返事が止まりました/);
});

console.log(`trio-advisor.check：${passed} 通った・${failed.length} 落ちた`);
for (const line of failed) console.log(`  ✗ ${line}`);
if (failed.length > 0) process.exit(1);
