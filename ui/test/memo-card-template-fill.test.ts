// Phase 5d：穴埋めファイル honeycomb-cardtpl-fill の検査と先入れの値づくり（純粋な部分）
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FILL_FORMAT, FILL_LIMITS, fillFailText, fillPlanText, findFailText, findFillTemplate, isFillText, parseFillText, planFill } from '../src/memo-card-template-fill';
import { parseImportText } from '../src/memo-card-template-io';
import { extractHoles, fillTemplate, type CardTemplate } from '../src/memo-card-templates';

const read = (name: string) => readFileSync(new URL(`../../samples/${name}`, import.meta.url), 'utf8');
const file = (over: Record<string, unknown> = {}) => JSON.stringify({ format: FILL_FORMAT, version: 1, template: { id: 't1', name: '週の振り返り' }, values: { テーマ: '読書会' }, ...over });
const ok = (text: string) => {
  const r = parseFillText(text);
  if (!r.ok) throw new Error(`読めません：${r.why}`);
  return r;
};

const holeTpl = (over: Partial<CardTemplate> = {}): CardTemplate => ({
  version: 1,
  id: 't1',
  name: '週の振り返り',
  folder: '計画',
  mode: 'hole',
  cards: [
    { key: 'k0', title: '今週のテーマ', body: '\n{{テーマ}}', tags: [], dx: 0, dy: 0 },
    { key: 'k1', title: 'できたこと', body: '\n{{できたこと}}', tags: [], dx: 240, dy: 0 },
  ],
  links: [],
  ...over,
});

describe('見本 samples/grok-cardtpl-fill-sample.json', () => {
  it('検査を通り、5 つの値と型の目印が読める', () => {
    const r = ok(read('grok-cardtpl-fill-sample.json'));
    expect(r.template).toEqual({ id: 'grok-reading-club', name: '読書会の準備' });
    expect(Object.keys(r.values)).toEqual(['書名', '著者', '要点', '問い', '進め方']);
    expect(r.ignored).toBe(0);
    expect(r.note).toContain('見本');
  });
  it('5b の見本の返答の穴あき型を探せて、空欄が全部入る（先入れの値になる）', () => {
    const fill = ok(read('grok-cardtpl-fill-sample.json'));
    const resp = parseImportText(read('grok-cardtpl-response-sample.json'));
    if (!resp.ok) throw new Error('読めません');
    const found = findFillTemplate(resp.templates, fill.template);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    const plan = planFill(found.template, fill);
    expect(plan.used).toBe(5);
    expect(plan.unknown).toEqual([]);
    expect(plan.missing).toEqual([]);
    const done = fillTemplate(found.template, plan.values);
    expect(done.empty).toBe(0);
    expect(done.template.cards.some((c) => /\{\{/.test(`${c.title}${c.body}`))).toBe(false);
  });
  it('型のファイルの読み込み（parseImportText）は、この形を断る', () => {
    expect(parseImportText(read('grok-cardtpl-fill-sample.json'))).toEqual({ ok: false, why: 'format' });
  });
});

describe('isFillText', () => {
  it('format が穴埋めのときだけ true（型のファイル・壊れた文は false）', () => {
    expect(isFillText(file())).toBe(true);
    expect(isFillText(read('grok-cardtpl-response-sample.json'))).toBe(false);
    expect(isFillText('これは JSON ではない')).toBe(false);
    expect(isFillText('[]')).toBe(false);
    expect(isFillText('\ufeff' + file())).toBe(true);
  });
});

describe('断る（何も変えない）', () => {
  it('JSON でない・format 違い・版違い', () => {
    expect(parseFillText('```json\n' + file() + '\n```')).toEqual({ ok: false, why: 'json' });
    expect(parseFillText('[1]')).toEqual({ ok: false, why: 'format' });
    expect(parseFillText(read('grok-cardtpl-response-sample.json'))).toEqual({ ok: false, why: 'format' });
    expect(parseFillText(file({ format: 'honeycomb-cardtpl' }))).toEqual({ ok: false, why: 'format' });
    expect(parseFillText(file({ version: 2 }))).toEqual({ ok: false, why: 'version' });
    expect(parseFillText(file({ version: '1' }))).toEqual({ ok: false, why: 'version' });
  });
  it('template・values の形違い、型の目印なし、値なし', () => {
    expect(parseFillText(file({ template: 'x' }))).toEqual({ ok: false, why: 'shape' });
    expect(parseFillText(file({ template: null }))).toEqual({ ok: false, why: 'shape' });
    expect(parseFillText(file({ values: ['a'] }))).toEqual({ ok: false, why: 'shape' });
    expect(parseFillText(file({ values: 'x' }))).toEqual({ ok: false, why: 'shape' });
    expect(parseFillText(file({ template: { id: '', name: ' ' } }))).toEqual({ ok: false, why: 'template' });
    expect(parseFillText(file({ template: {} }))).toEqual({ ok: false, why: 'template' });
    expect(parseFillText(file({ values: {} }))).toEqual({ ok: false, why: 'empty' });
    expect(parseFillText(file({ values: { テーマ: '  ', 本: 3 } }))).toEqual({ ok: false, why: 'empty' });
  });
  it('どの理由にも、何も変えていない旨の日本語がある', () => {
    for (const why of ['json', 'format', 'version', 'shape', 'template', 'empty'] as const) expect(fillFailText(why)).toContain('何も変えていません');
  });
});

describe('値の整え（空欄名・文字数・40 個・制御文字）', () => {
  it('id だけ・name だけでもよい（目印が 1 つあれば）', () => {
    expect(ok(file({ template: { id: 'abc' } })).template).toEqual({ id: 'abc', name: '' });
    expect(ok(file({ template: { name: '週の振り返り' } })).template).toEqual({ id: '', name: '週の振り返り' });
  });
  it('決まりに合わない空欄名（波かっこ・長すぎ・空）と、文字でない値は無視し、数える', () => {
    const r = ok(file({ values: { テーマ: '読書会', '{{x}}': 'a', [`${'あ'.repeat(31)}`]: 'b', '': 'c', 数: 5, 空: '   ', '改\u0000行': 'ok' } }));
    expect(Object.keys(r.values)).toEqual(['テーマ']);
    expect(r.ignored).toBe(6);
  });
  it('空欄名の前後の空白は取る。取ったあと重なる名前は 2 つ目を捨てる', () => {
    const r = ok(file({ values: { ' テーマ ': '最初', テーマ: '二つ目' } }));
    expect(r.values.テーマ).toBe('最初');
    expect(r.ignored).toBe(1);
  });
  it('値は制御文字を除き、改行をそろえ、前後の空白を取り、2,000 字まで', () => {
    const r = ok(file({ values: { テーマ: ' 一行目\r\n二行目\u0007 ', 長い: 'あ'.repeat(5000) } }));
    expect(r.values.テーマ).toBe('一行目\n二行目');
    expect([...r.values.長い]).toHaveLength(FILL_LIMITS.text);
  });
  it('値は 40 個まで（先頭から。残りは無視）', () => {
    const values: Record<string, string> = {};
    for (let i = 0; i < 55; i++) values[`空欄${i}`] = `値${i}`;
    const r = ok(file({ values }));
    expect(Object.keys(r.values)).toHaveLength(FILL_LIMITS.values);
    expect(r.values['空欄39']).toBe('値39');
    expect(r.values['空欄40']).toBeUndefined();
    expect(r.ignored).toBe(15);
  });
  it('HTML や {{…}} に見える値は、文字のまま持つ（実行・再展開はしない）', () => {
    const r = ok(file({ values: { テーマ: '<img src=x onerror=alert(1)> {{できたこと}}' } }));
    expect(r.values.テーマ).toBe('<img src=x onerror=alert(1)> {{できたこと}}');
    const done = fillTemplate(holeTpl(), planFill(holeTpl(), r).values);
    expect(done.template.cards[0].body).toContain('{{できたこと}}'); // 二度は埋めない
    expect(done.template.cards[1].body).toBe('\n{{できたこと}}');
  });
  it('__proto__ などの名前でも、道具の元（prototype）を汚さない', () => {
    const r = ok('{"format":"honeycomb-cardtpl-fill","version":1,"template":{"name":"x"},"values":{"__proto__":"a","constructor":"b","テーマ":"c"}}');
    expect(Object.getPrototypeOf(r.values)).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(r.values.テーマ).toBe('c');
  });
  it('タグ（機械タグを含む）を運ぶ欄は読まない：あっても結果に出ない', () => {
    const r = ok(file({ tags: ['宛て:all'], values: { テーマ: '読書会' }, cards: [{ tags: ['送った:x'] }] }));
    expect(JSON.stringify(r)).not.toMatch(/宛て:|送った:|貼った:/);
  });
  it('note は 1 行にして 200 字までの文字だけ（無ければ空）', () => {
    expect(ok(file({ note: '一行目\n二行目\u0007' })).note).toBe('一行目 二行目');
    expect([...ok(file({ note: 'あ'.repeat(500) })).note]).toHaveLength(FILL_LIMITS.note);
    expect(ok(file()).note).toBe('');
    expect(ok(file({ note: 5 })).note).toBe('');
  });
});

describe('型を探す（id が先、無ければ名前。穴あきだけ）', () => {
  const a = holeTpl({ id: 'a', name: '同じ名前' });
  const b = holeTpl({ id: 'b', name: '別の型' });
  it('id で探す。id が合わなければ名前で探す', () => {
    expect(findFillTemplate([a, b], { id: 'b', name: '' })).toEqual({ ok: true, template: b });
    expect(findFillTemplate([a, b], { id: 'zzz', name: '別の型' })).toEqual({ ok: true, template: b });
    expect(findFillTemplate([a, b], { id: 'a', name: '別の型' })).toEqual({ ok: true, template: a }); // id が先
  });
  it('見つからなければ断る', () => {
    expect(findFillTemplate([a, b], { id: 'x', name: 'y' })).toEqual({ ok: false, why: 'missing' });
    expect(findFillTemplate([], { id: 'a', name: '' })).toEqual({ ok: false, why: 'missing' });
    expect(findFailText('missing', { id: 'x', name: '型Z' })).toContain('「型Z」という型が見つかりません');
  });
  it('穴あきでない型・空欄のない穴あきは断る', () => {
    expect(findFillTemplate([holeTpl({ mode: 'snapshot' })], { id: 't1', name: '' })).toEqual({ ok: false, why: 'no-holes' });
    expect(findFillTemplate([holeTpl({ cards: [{ key: 'k0', title: '題', body: '', tags: [], dx: 0, dy: 0 }] })], { id: 't1', name: '' })).toEqual({ ok: false, why: 'no-holes' });
    expect(findFailText('no-holes', { id: 't1', name: '週' })).toContain('穴あきの型ではありません');
  });
});

describe('先入れの値（planFill）', () => {
  const tpl = holeTpl();
  it('型の空欄に当たる値だけ入れ、知らない空欄名は無視し、値のない空欄は空のまま', () => {
    const r = ok(file({ values: { テーマ: '読書会', 知らない: 'x' } }));
    const plan = planFill(tpl, r);
    expect(plan.values).toEqual({ テーマ: '読書会' });
    expect(plan.used).toBe(1);
    expect(plan.unknown).toEqual(['知らない']);
    expect(plan.missing).toEqual(['できたこと']);
    expect(Object.keys(plan.values).every((k) => extractHoles(tpl).includes(k))).toBe(true);
  });
  it('型と読んだ中身は変えない', () => {
    const before = JSON.stringify(tpl);
    const r = ok(file());
    const valuesBefore = JSON.stringify(r.values);
    planFill(tpl, r);
    expect(JSON.stringify(tpl)).toBe(before);
    expect(JSON.stringify(r.values)).toBe(valuesBefore);
  });
  it('空欄が 40 個を超える型でも、先頭の 40 個までしか入れない（小窓の上限と同じ）', () => {
    const cards = Array.from({ length: 30 }, (_, i) => ({ key: `k${i}`, title: `題${i}`, body: `\n{{a${i}}} {{b${i}}}`, tags: [], dx: 0, dy: 0 }));
    const big = holeTpl({ cards });
    const values: Record<string, string> = {};
    for (let i = 0; i < 30; i++) {
      values[`a${i}`] = 'x';
      values[`b${i}`] = 'y';
    }
    const plan = planFill(big, { values });
    expect(plan.used).toBe(40);
  });
  it('知らせの文：貼らないこと・空のまま・入れなかった数を言う', () => {
    const r = ok(file({ values: { テーマ: '読書会', 知らない: 'x', 空: '' } }));
    const text = fillPlanText(planFill(tpl, r), r.ignored);
    expect(text).toContain('値を 1 個入れました');
    expect(text).toContain('押すまで貼りません');
    expect(text).toContain('値のない 1 個は空のまま');
    expect(text).toContain('2 個は入れませんでした');
  });
});

describe('依頼文 B（見本の md）は読み込み方を案内している', () => {
  it('md に、型の窓の「読み込む…」と空欄の小窓のボタンの両方の読み込み方がある', () => {
    const md = readFileSync(new URL('../../samples/grok-cardtpl-request-sample.ja.md', import.meta.url), 'utf8');
    expect(md).toContain('穴埋めファイルを読み込む…');
    expect(md).toContain('honeycomb-cardtpl-fill');
    expect(md).toContain('40 個まで');
    expect(md).toContain('2000 字まで');
  });
});