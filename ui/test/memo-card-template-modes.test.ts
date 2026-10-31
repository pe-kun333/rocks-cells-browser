// 型のモード（Phase 3）：骨組み・穴あき・空欄の抽出と埋め込み・登録の小窓の文・内蔵サンプルの穴あき
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/bridge', () => ({ surface: 'left', send: () => {}, onMessage: () => {}, request: async () => null }));
vi.mock('../src/data', () => ({
  readData: async () => null,
  readDataChecked: async (name: string) => (name === 'memocells.json' ? { status: 'ok', value: { version: 1, memos: [] } } : { status: 'missing' }),
  writeData: async () => true,
  deleteData: () => {},
  listData: async () => [],
}));

import {
  buildTemplateFromCards,
  type CardTemplate,
  extractHoles,
  fillTemplate,
  holeNames,
  HOLE_COMMON,
  MODE_LABELS,
  normalizeMode,
  parseTemplate,
  parseTemplateFile,
  TEMPLATE_MODES,
  toTemplateFile,
} from '../src/memo-card-templates';
import { describeTemplateReport, templateMenuLabel, templateModeNote } from '../src/memo-card-template-store';
import { paletteMeta } from '../src/memo-card-template-palette';
import { sampleTemplates } from '../src/memo-card-template-samples';
import { MemoStore } from '../src/memocells';
import { MAX_REPLY_TEXT, orderedTops, type Reply } from '../src/threads';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const card = (id: string, text: string, at: number, extra: Partial<Reply> = {}): Reply => ({ id, parent: null, text, createdAt: at, ...extra });

function source(): Reply[] {
  return [
    card('a', '賛成\n理由を書く。\n二行目', 1, { tags: ['立場'] }),
    card('b', '反対\n別の理由', 2, { links: [{ to: 'a', kind: 'counter' }] }),
    card('c', '結論', 3, { links: [{ to: 'a', kind: 'ground' }] }),
  ];
}

function build(mode: unknown, replies: Reply[] = source()) {
  const done = buildTemplateFromCards(replies, replies.map((r) => r.id), { name: '型', mode, newId: () => 'tpl1', now: 1 });
  if (!done.ok) throw new Error('型を作れない');
  return done;
}

describe('モードの読み込み', () => {
  const base = { version: 1, id: 'x1', name: '型', folder: '議論', cards: [{ key: 'p', title: '題', body: '本文' }, { key: 'q', title: '題2', body: '本文2' }], links: [] };
  it('3 つのモードを読む。知らないモードは断る。モードが無ければ snapshot', () => {
    expect(TEMPLATE_MODES).toEqual(['snapshot', 'skeleton', 'hole']);
    for (const mode of TEMPLATE_MODES) expect(parseTemplate({ ...base, mode })).toMatchObject({ ok: true, template: { mode } });
    expect(parseTemplate({ ...base, mode: 'weird' })).toEqual({ ok: false, why: 'mode' });
    expect(parseTemplate(base)).toMatchObject({ ok: true, template: { mode: 'snapshot' } });
    expect(normalizeMode('hole')).toBe('hole');
    expect(normalizeMode('x')).toBe('snapshot');
  });
  it('骨組みは本文を読まない（手で本文を書いたファイルでも、題だけ）。穴あき・そのままは本文を持つ', () => {
    const sk = parseTemplate({ ...base, mode: 'skeleton' });
    expect(sk.ok && sk.template.cards.map((c) => c.body)).toEqual(['', '']);
    const ho = parseTemplate({ ...base, mode: 'hole' });
    expect(ho.ok && ho.template.cards.map((c) => c.body)).toEqual(['本文', '本文2']);
  });
  it('ファイルに書いて読み直しても、モードは残る', () => {
    const list = TEMPLATE_MODES.map((mode, i) => ({ ...(parseTemplate({ ...base, mode, id: `m${i}` }) as { ok: true; template: CardTemplate }).template }));
    const back = parseTemplateFile(toTemplateFile(list));
    expect(back.ok && back.templates.map((t) => t.mode)).toEqual([...TEMPLATE_MODES]);
    expect(MODE_LABELS).toEqual({ snapshot: 'そのまま', skeleton: '骨組み', hole: '穴あき' });
  });
});

describe('骨組みで登録', () => {
  it('各カードの題（1 行目）だけを残す。タグ・関連・位置・数は変わらない', () => {
    const snap = build('snapshot');
    const sk = build('skeleton');
    expect(sk.template.mode).toBe('skeleton');
    expect(sk.template.cards.map((c) => c.title)).toEqual(['賛成', '反対', '結論']);
    expect(sk.template.cards.every((c) => c.body === '')).toBe(true);
    expect(sk.template.cards.map((c) => c.tags)).toEqual(snap.template.cards.map((c) => c.tags));
    expect(sk.template.links).toEqual(snap.template.links);
    expect(sk.template.cards.map((c) => [c.dx, c.dy])).toEqual(snap.template.cards.map((c) => [c.dx, c.dy]));
    expect(sk.report).toEqual(snap.report);
    expect(parseTemplate(sk.template).ok).toBe(true);
  });
  it('そのまま（既定）は、今までどおり本文も残る。知らないモードも、そのまま扱い', () => {
    expect(build(undefined).template.mode).toBe('snapshot');
    expect(build('weird').template.cards[0].body).toBe('理由を書く。\n二行目');
  });
});

describe('穴あきで登録', () => {
  it('本文に空欄が無いカードは、本文を「{{テーマ}}：{{題}}」にする。題はそのまま', () => {
    const t = build('hole').template;
    expect(t.mode).toBe('hole');
    expect(t.cards.map((c) => c.title)).toEqual(['賛成', '反対', '結論']);
    expect(t.cards.map((c) => c.body)).toEqual(['{{テーマ}}：{{賛成}}', '{{テーマ}}：{{反対}}', '{{テーマ}}：{{結論}}']);
    expect(extractHoles(t)).toEqual([HOLE_COMMON, '賛成', '反対', '結論']);
    expect(parseTemplate(t).ok).toBe(true);
  });
  it('すでに本文に {{…}} があるカードは、そのまま空欄として扱う（作り直さない）', () => {
    const replies = [card('a', '賛成\n{{理由}}を書く', 1), card('b', '反対', 2)];
    const t = build('hole', replies).template;
    expect(t.cards[0].body).toBe('{{理由}}を書く');
    expect(t.cards[1].body).toBe('{{テーマ}}：{{反対}}');
    expect(extractHoles(t)).toEqual(['理由', HOLE_COMMON, '反対']);
  });
  it('同じ題のカードや、すでにある空欄名と重なるときは、空欄名を重ねない', () => {
    const replies = [card('a', '出典', 1), card('b', '出典', 2), card('c', '{{出典}}の話\n本文あり{{出典（2）}}', 3)];
    const t = build('hole', replies).template;
    const names = extractHoles(t);
    expect(new Set(names).size).toBe(names.length);
    expect(t.cards[0].body).toMatch(/\{\{出典（3）\}\}|\{\{出典（4）\}\}/);
    expect(t.cards[0].body).not.toBe(t.cards[1].body);
  });
  it('題に波かっこがあっても、空欄名には使わない。空の題は「本文」', () => {
    const t = build('hole', [card('a', '{題}と{{何}}', 1)]).template;
    expect(t.cards[0].body).toBe('{{テーマ}}：{{題と何}}');
    expect(extractHoles(t)).toEqual(['何', HOLE_COMMON, '題と何']);
  });
  it('登録の報告に空欄の数が入る（穴あきのときだけ）', () => {
    const r = build('hole').report;
    expect(r.holes).toBe(4);
    expect(build('snapshot').report.holes).toBeUndefined();
    expect(describeTemplateReport(r).counts).toBe('3枚・関連 2本・空欄 4個');
    expect(describeTemplateReport(build('skeleton').report).counts).toBe('3枚・関連 2本');
  });
});

describe('空欄の抽出', () => {
  it('出てきた順・重なりなし・前後の空白は取る。空・長すぎる・改行をまたぐ・波かっこ入りは空欄にしない', () => {
    expect(holeNames(['{{a}} {{ b }} {{a}}', 'x{{c}}'])).toEqual(['a', 'b', 'c']);
    expect(holeNames(['{{ }}', '{{}}', '{{a\nb}}', `{{${'あ'.repeat(31)}}}`, '{{{x}}}'])).toEqual(['x']);
    expect(holeNames([`{{${'あ'.repeat(30)}}}`])).toEqual(['あ'.repeat(30)]);
  });
});

describe('空欄を埋める', () => {
  const t = build('hole').template;
  it('値を入れた空欄は、題と本文のすべての所で置き換わる。mode は snapshot になり、元の型は変わらない', () => {
    const before = structuredClone(t);
    const done = fillTemplate(t, { テーマ: 'AI導入', 賛成: '早い' });
    expect(done.template.mode).toBe('snapshot');
    expect(done.template.cards.map((c) => c.body)).toEqual(['AI導入：早い', 'AI導入：{{反対}}', 'AI導入：{{結論}}']);
    expect(done).toMatchObject({ filled: 2, empty: 2, truncated: 0 });
    expect(t).toEqual(before);
    expect(parseTemplate(done.template).ok).toBe(true);
  });
  it('空・空白だけ・値が無い空欄は {{名前}} のまま。全部空なら、本文だけが入れ替わらない', () => {
    const done = fillTemplate(t, { テーマ: '   ', 賛成: '' });
    expect(done.template.cards.map((c) => c.body)).toEqual(t.cards.map((c) => c.body));
    expect(done).toMatchObject({ filled: 0, empty: 4 });
  });
  it('値は文字として入れる：HTML も $ の特別な書き方も、{{…}} に見える値も、そのまま。制御文字は除く', () => {
    const tt = parseTemplate({ version: 1, id: 'h', name: 'h', mode: 'hole', cards: [{ key: 'a', title: '{{x}}', body: '{{y}}と{{x}}' }], links: [] }) as { ok: true; template: CardTemplate };
    const done = fillTemplate(tt.template, { x: '<script>alert(1)</script>', y: "$& $1 $$ {{x}}\u0007" });
    expect(done.template.cards[0].title).toBe('<script>alert(1)</script>');
    expect(done.template.cards[0].body).toBe('$& $1 $$ {{x}}と<script>alert(1)</script>');
  });
  it('題に入れる値は 1 行にする。本文は改行を残す', () => {
    const tt = parseTemplate({ version: 1, id: 'h', name: 'h', mode: 'hole', cards: [{ key: 'a', title: '{{x}}', body: '{{x}}' }], links: [] }) as { ok: true; template: CardTemplate };
    const done = fillTemplate(tt.template, { x: '一行目\n二行目' });
    expect(done.template.cards[0].title).toBe('一行目 二行目');
    expect(done.template.cards[0].body).toBe('一行目\n二行目');
  });
  it('埋めたあと 2,000 字を超えるカードは切って、切った数を数える', () => {
    const tt = parseTemplate({ version: 1, id: 'h', name: 'h', mode: 'hole', cards: [{ key: 'a', title: '題', body: '{{x}}' }, { key: 'b', title: '短い', body: '{{y}}' }], links: [] }) as { ok: true; template: CardTemplate };
    const done = fillTemplate(tt.template, { x: 'あ'.repeat(3000), y: 'い' });
    expect(done.truncated).toBe(1);
    const text = `${done.template.cards[0].title}\n${done.template.cards[0].body}`;
    expect([...text].length).toBeLessThanOrEqual(MAX_REPLY_TEXT);
    expect(done.template.cards[1].body).toBe('い');
  });
  it('関連・タグ・位置は埋めても変わらない', () => {
    const done = fillTemplate(t, { テーマ: 'x' });
    expect(done.template.links).toEqual(t.links);
    expect(done.template.cards.map((c) => [c.tags, c.dx, c.dy])).toEqual(t.cards.map((c) => [c.tags, c.dx, c.dy]));
  });
});

describe('穴あきを貼る（台帳。ふつうの型と同じ道）', () => {
  it('埋めた型を sendReplies の copy で貼り、元に戻せる。骨組みもそのまま貼れる', async () => {
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    const memos = new MemoStore();
    await memos.load();
    const to = memos.add({ pos: { q: 0, r: 0 }, text: '先' });
    if (!to) throw new Error('add');
    const hole = sampleTemplates().find((s) => s.id === 'sample-review6');
    if (!hole) throw new Error('sample');
    const filled = fillTemplate(hole, { テーマ: '新機能' });
    expect(filled.empty).toBe(0);
    const done = memos.sendReplies({ template: filled.template, toId: to.id });
    expect(done).toMatchObject({ ok: true, tops: 7, name: '6観点レビュー' });
    if (!done.ok) return;
    const tops = orderedTops(memos.get(to.id)?.replies ?? []);
    expect(tops[0].text).toBe('新機能をレビュー\n対象：新機能');
    expect(tops.some((r) => r.text.includes('{{'))).toBe(false);
    expect(memos.undoSend(done.token)).toEqual({ ok: true });
    expect(memos.get(to.id)?.replies ?? []).toEqual([]);
    const sk = sampleTemplates().find((s) => s.id === 'sample-proscons');
    if (!sk) throw new Error('sample');
    const skDone = memos.sendReplies({ template: sk, toId: to.id });
    expect(skDone).toMatchObject({ ok: true, tops: 4 });
    expect(orderedTops(memos.get(to.id)?.replies ?? []).map((r) => r.text)).toEqual(['論点', '賛成', '反対', '結論']);
  });
});

describe('内蔵サンプルのモード', () => {
  const byId = (id: string) => sampleTemplates().find((s) => s.id === id) as CardTemplate;
  it('モックの 5 件がそろい、骨組み 2・穴あき 2・そのまま 1', () => {
    const list = sampleTemplates();
    expect(list).toHaveLength(5);
    expect(list.map((t) => t.mode)).toEqual(['skeleton', 'hole', 'snapshot', 'hole', 'skeleton']);
    expect(byId('sample-proscons').cards.every((c) => c.body === '')).toBe(true);
    expect(byId('sample-research').cards.every((c) => c.body === '')).toBe(true);
  });
  it('穴あきの空欄：賛成・反対・結論は 4 つ、6観点は「テーマ」だけ', () => {
    expect(extractHoles(byId('sample-proscons-hole'))).toEqual(['テーマ', '賛成理由', '反対理由', '結論']);
    expect(extractHoles(byId('sample-review6'))).toEqual(['テーマ']);
    expect(byId('sample-review6').cards).toHaveLength(7);
  });
});

describe('登録の小窓・窓の文', () => {
  it('モードの説明が 3 つとも違い、穴あきは共通の空欄名を示す', () => {
    const notes = TEMPLATE_MODES.map(templateModeNote);
    expect(new Set(notes).size).toBe(3);
    expect(templateModeNote('hole')).toContain('{{テーマ}}');
    expect(templateModeNote('skeleton')).toContain('題');
  });
  it('一覧のモード表示：窓の 2 行目は全部に、「型を貼る ▾」の名前はそのまま以外に付く', () => {
    const snap = build('snapshot').template;
    const sk = build('skeleton').template;
    const ho = build('hole').template;
    expect(paletteMeta(sk)).toBe('その他・3枚・関連 2本・骨組み');
    expect(paletteMeta(ho)).toBe('その他・3枚・関連 2本・穴あき');
    expect(templateMenuLabel(snap)).toBe('型（3枚）');
    expect(templateMenuLabel(sk)).toBe('型（3枚・骨組み）');
    expect(templateMenuLabel(ho)).toBe('型（3枚・穴あき）');
  });
});