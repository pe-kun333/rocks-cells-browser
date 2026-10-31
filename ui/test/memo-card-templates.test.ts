// コメントカードの「型」の計算（Phase 1a。登録・読み込み・貼る下書き。DOM も保存も使わない）
import { describe, expect, it } from 'vitest';

import { pruneLinks } from '../src/memo-card-links';
import { sendCards } from '../src/memo-card-send';
import {
  addTemplate,
  buildPasteDraft,
  buildTemplateFromCards,
  type CardTemplate,
  cleanCardTags,
  cleanTemplateName,
  composeText,
  normalizeFolder,
  parseTemplate,
  parseTemplateFile,
  splitText,
  TEMPLATE_LIMITS,
  toTemplateFile,
} from '../src/memo-card-templates';
import { MAX_REPLIES, orderedTops, type Reply, topSlots } from '../src/threads';

const card = (partial: Partial<Reply> & Pick<Reply, 'id' | 'text' | 'createdAt'>): Reply => ({ parent: null, ...partial });
const counter = (prefix = 'n') => {
  let n = 0;
  return () => `${prefix}${(n++).toString(36)}`;
};

// 3 枚（a 論点・b 賛成・c 反対）＋外の x。b→a 根拠、c→b 反論、c→x 続き（外へ出る）
function sample(): Reply[] {
  return [
    card({ id: 'a', text: '論点\n何を決めるか', createdAt: 1, rank: 0, tags: ['論点', '宛て:all'] }),
    { id: 'a1', parent: 'a', text: '下の返信', createdAt: 2 },
    card({ id: 'b', text: '賛成', createdAt: 3, rank: 1, tags: ['賛成'], links: [{ to: 'a', kind: 'ground' }], image: 'shotabc' }),
    card({ id: 'c', text: '反対', createdAt: 4, rank: 2, tags: ['反対', '送った:chat'], links: [{ to: 'b', kind: 'counter' }, { to: 'x', kind: 'next' }], quote: { text: '引用', url: 'https://example.com/', title: '頁' } }),
    card({ id: 'x', text: '外のカード', createdAt: 5, rank: 3 }),
  ];
}

describe('小さな整え', () => {
  it('名前：見えない文字・空白を整え、40 字まで。空は断る', () => {
    expect(cleanTemplateName('  賛成 \n 反対\u200b結論  ')).toBe('賛成 反対 結論');
    expect(cleanTemplateName('あ'.repeat(50))).toBe('あ'.repeat(TEMPLATE_LIMITS.name));
    expect(cleanTemplateName('   ')).toBe('');
    expect(cleanTemplateName(42)).toBe('');
  });
  it('フォルダ：4 つのほかは「その他」', () => {
    expect(normalizeFolder('調査')).toBe('調査');
    expect(normalizeFolder('???')).toBe('その他');
    expect(normalizeFolder(undefined)).toBe('その他');
  });
  it('タグ：機械のタグ・重複・空を除く。# は取る。10 個まで', () => {
    expect(cleanCardTags(['#賛成', '賛成', '宛て:all', '送った:g1', '貼った:x', '', 7, '反対'])).toEqual(['賛成', '反対']);
    expect(cleanCardTags(Array.from({ length: 15 }, (_, i) => `t${i}`))).toHaveLength(10);
    expect(cleanCardTags('x')).toEqual([]);
  });
  it('文：題と本文に分けて、また合わせると元の文になる', () => {
    for (const text of ['題だけ', '題\n本文', '題\n\n空行のあと', '題\n  字下げ\n3 行目']) {
      const { title, body } = splitText(text);
      expect(title).not.toContain('\n');
      expect(composeText(title, body)).toBe(text);
    }
  });
});

describe('選んだカードから型を作る（登録）', () => {
  it('選んだ一番上のカードだけを、並びの順に。内側の関連だけ入り、外へ出る関連は数だけ数える', () => {
    const replies = sample();
    const before = structuredClone(replies);
    const done = buildTemplateFromCards(replies, ['c', 'a', 'b'], { name: '賛成・反対', folder: '議論', newId: () => 'tpl1', now: 99 });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const t = done.template;
    expect(t).toMatchObject({ version: 1, id: 'tpl1', name: '賛成・反対', folder: '議論', mode: 'snapshot', createdAt: 99 });
    expect(t.cards.map((c) => [c.key, c.title, c.body])).toEqual([
      ['k0', '論点', '何を決めるか'],
      ['k1', '賛成', ''],
      ['k2', '反対', ''],
    ]);
    expect(t.links).toEqual([
      { from: 'k1', to: 'k0', kind: 'ground' },
      { from: 'k2', to: 'k1', kind: 'counter' },
    ]);
    expect(done.report).toEqual({ cards: 3, links: 2, cutLinks: 1, skipped: { children: 1, images: 1, quotes: 1, machineTags: 2 } });
    expect(replies).toEqual(before); // 元は変わらない
  });
  it('機械のタグ（宛て:・送った:・貼った:）は入らない。ふつうのタグは残る', () => {
    const done = buildTemplateFromCards(sample(), ['a', 'c'], { name: 'n' });
    expect(done.ok && done.template.cards.map((c) => c.tags)).toEqual([['論点'], ['反対']]);
  });
  it('id・rank・返信・引用・画像は型に入らない（文字だけ）', () => {
    const done = buildTemplateFromCards(sample(), ['b', 'c'], { name: 'n' });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const json = JSON.stringify(done.template);
    for (const word of ['shotabc', 'example.com', '"rank"', '"parent"', '"a1"']) expect(json).not.toContain(word);
    expect(Object.keys(done.template.cards[0]).sort()).toEqual(['body', 'dx', 'dy', 'key', 'tags', 'title']);
  });
  it('文が空のカード（引用か画像だけ）は、題だけの文にする', () => {
    const replies = [card({ id: 'p', text: '', image: 'shotp', createdAt: 1 }), card({ id: 'q', text: '', quote: { text: '', url: 'https://example.com/', title: '記事の題' }, createdAt: 2 })];
    const done = buildTemplateFromCards(replies, ['p', 'q'], { name: 'n' });
    expect(done.ok && done.template.cards.map((c) => c.title)).toEqual(['（画像）', '記事の題']);
  });
  it('dx・dy は番地（3 列）から：選んだ中でいちばん左の列・上の行が 0', () => {
    const grid = [card({ id: 'p', text: 'p', createdAt: 1, rank: 0 }), card({ id: 'q', text: 'q', createdAt: 2, rank: 1 }), card({ id: 'r', text: 'r', createdAt: 3, rank: 3 }), card({ id: 's', text: 's', createdAt: 4, rank: 4 })];
    const at = (ids: string[]) => {
      const done = buildTemplateFromCards(grid, ids, { name: 'n' });
      return done.ok ? done.template.cards.map((c) => [c.title, c.dx, c.dy]) : null;
    };
    // q（行 0・列 1）r（行 1・列 0）s（行 1・列 1）
    expect(at(['q', 'r', 's'])).toEqual([['q', 210, 0], ['r', 0, 116], ['s', 210, 116]]);
    expect(at(['r', 's'])).toEqual([['r', 0, 0], ['s', 210, 0]]);
    expect(at(['q', 's'])).toEqual([['q', 0, 0], ['s', 0, 116]]);
  });
  it('rank の無いカードも、番地の順（作った順）に並ぶ', () => {
    const done = buildTemplateFromCards([card({ id: 'u', text: 'u', createdAt: 2 }), card({ id: 'v', text: 'v', createdAt: 1 })], ['u', 'v'], { name: 'n' });
    expect(done.ok && done.template.cards.map((c) => c.title)).toEqual(['v', 'u']);
  });
  it('断る：選ばない・無い／返信（一番上でない）のカード・31 枚・名前が空', () => {
    const replies = sample();
    expect(buildTemplateFromCards(replies, [], { name: 'n' })).toEqual({ ok: false, why: 'empty' });
    expect(buildTemplateFromCards(replies, ['a', 'zz'], { name: 'n' })).toEqual({ ok: false, why: 'missing' });
    expect(buildTemplateFromCards(replies, ['a1'], { name: 'n' })).toEqual({ ok: false, why: 'missing' });
    expect(buildTemplateFromCards(replies, ['a'], { name: ' ' })).toEqual({ ok: false, why: 'name' });
    const many = Array.from({ length: 31 }, (_, i) => card({ id: `m${i}`, text: `m${i}`, createdAt: i + 1 }));
    expect(buildTemplateFromCards(many, many.map((r) => r.id), { name: 'n' })).toEqual({ ok: false, why: 'too-many', max: 30 });
    expect(buildTemplateFromCards(many, many.slice(0, 30).map((r) => r.id), { name: 'n' }).ok).toBe(true);
  });
  it('1 枚でも作れる（画面で 2 枚以上にするのは Phase 1b）。同じ id を 2 度渡しても 1 枚', () => {
    const done = buildTemplateFromCards(sample(), ['a', 'a'], { name: 'n' });
    expect(done.ok && done.template.cards).toHaveLength(1);
  });
  it('6 つの関連の種類（補足を含む）は id のまま入る', () => {
    const kinds = ['ground', 'counter', 'next', 'same', 'ask', 'supplement'] as const;
    const replies = [card({ id: 'h', text: 'h', createdAt: 1 }), ...kinds.map((_, i) => card({ id: `k${i}`, text: `k${i}`, createdAt: i + 2 }))];
    replies[0] = { ...replies[0], links: kinds.map((kind, i) => ({ to: `k${i}`, kind })) };
    const done = buildTemplateFromCards(replies, replies.map((r) => r.id), { name: 'n' });
    expect(done.ok && done.template.links.map((l) => l.kind)).toEqual([...kinds]);
  });
});

describe('型の読み込み・検証', () => {
  const good = (): Record<string, unknown> => ({
    version: 1,
    id: 'tpl1',
    name: '型',
    folder: '調査',
    mode: 'snapshot',
    cards: [
      { key: 'p', title: '問い', body: '', tags: ['問い'], dx: 0, dy: 0 },
      { key: 'q', title: '答え', body: '本文', tags: [], dx: 210, dy: 0 },
    ],
    links: [{ from: 'q', to: 'p', kind: 'ground' }],
  });
  it('正しい型はそのまま読める。key は k0, k1… に付け直る', () => {
    const done = parseTemplate(good());
    expect(done.ok && done.template).toEqual({
      version: 1,
      id: 'tpl1',
      name: '型',
      folder: '調査',
      mode: 'snapshot',
      cards: [
        { key: 'k0', title: '問い', body: '', tags: ['問い'], dx: 0, dy: 0 },
        { key: 'k1', title: '答え', body: '本文', tags: [], dx: 210, dy: 0 },
      ],
      links: [{ from: 'k1', to: 'k0', kind: 'ground' }],
    });
  });
  it('書き出して読み直すと同じ（往復）', () => {
    const built = buildTemplateFromCards(sample(), ['a', 'b', 'c'], { name: '往復', folder: '議論', newId: () => 'tpl9', now: 5 });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const file = JSON.parse(JSON.stringify(toTemplateFile([built.template])));
    const read = parseTemplateFile(file);
    expect(read).toEqual({ ok: true, templates: [built.template], skipped: [] });
  });
  it('断る：形・版・モード・名前・カード無し・31 枚・空の文', () => {
    expect(parseTemplate(null)).toEqual({ ok: false, why: 'shape' });
    expect(parseTemplate({ ...good(), version: 2 })).toEqual({ ok: false, why: 'version' });
    expect(parseTemplate({ ...good(), mode: 'weird' })).toEqual({ ok: false, why: 'mode' });
    expect(parseTemplate({ ...good(), name: '  ' })).toEqual({ ok: false, why: 'name' });
    expect(parseTemplate({ ...good(), cards: [] })).toEqual({ ok: false, why: 'no-cards' });
    expect(parseTemplate({ ...good(), cards: Array.from({ length: 31 }, (_, i) => ({ key: `k${i}`, title: 't', body: '' })) })).toEqual({ ok: false, why: 'too-many-cards' });
    expect(parseTemplate({ ...good(), cards: [{ key: 'p', title: '  ', body: '' }] })).toEqual({ ok: false, why: 'text' });
    expect(parseTemplate({ ...good(), cards: ['x'] })).toEqual({ ok: false, why: 'shape' });
  });
  it('関連の整理：不明な種類・無い端点・自分自身・同じ相手の 2 本目・11 本目以降を捨てる', () => {
    const cards = Array.from({ length: 12 }, (_, i) => ({ key: `c${i}`, title: `t${i}`, body: '' }));
    const links = [
      { from: 'c0', to: 'c1', kind: 'ground' },
      { from: 'c0', to: 'c1', kind: 'counter' }, // 同じ相手の 2 本目
      { from: 'c0', to: 'c0', kind: 'next' }, // 自分自身
      { from: 'c0', to: 'zz', kind: 'next' }, // 無い端点
      { from: 'c0', to: 'c2', kind: 'badkind' }, // 不明な種類
      ...Array.from({ length: 10 }, (_, i) => ({ from: 'c0', to: `c${i + 2}`, kind: 'next' })), // c0 → c2…c11（10 本。c1 は上の 1 本目で 11 本め）
    ];
    const done = parseTemplate({ ...good(), cards, links });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const mine = done.template.links.filter((l) => l.from === 'k0');
    expect(mine).toHaveLength(10);
    expect(mine[0]).toEqual({ from: 'k0', to: 'k1', kind: 'ground' });
    expect(done.template.links.every((l) => l.from !== l.to)).toBe(true);
  });
  it('逆向きの「同じ」は 1 本だけ残る（pruneLinks と同じ決まり）', () => {
    const done = parseTemplate({ ...good(), links: [{ from: 'p', to: 'q', kind: 'same' }, { from: 'q', to: 'p', kind: 'same' }] });
    expect(done.ok && done.template.links).toEqual([{ from: 'k0', to: 'k1', kind: 'same' }]);
  });
  it('機械のタグ・範囲外の座標・長すぎる文を整える', () => {
    const raw = good();
    raw.cards = [{ key: 'p', title: 'あ'.repeat(3000), body: '', tags: ['宛て:all', '問い', '貼った:x'], dx: 99999.6, dy: -0.2 }];
    raw.links = [];
    const done = parseTemplate(raw);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const c = done.template.cards[0];
    expect(c.tags).toEqual(['問い']);
    expect(c.dx).toBe(10000);
    expect(c.dy).toBe(0);
    expect([...composeText(c.title, c.body)]).toHaveLength(TEMPLATE_LIMITS.text);
  });
  it('使えない id は採番し直す。renewId なら必ず採番し直す。知らない項目は読まない', () => {
    expect(parseTemplate({ ...good(), id: '../x' }, { newId: () => 'fresh' })).toMatchObject({ ok: true, template: { id: 'fresh' } });
    expect(parseTemplate({ ...good(), id: 'ok1' }, { newId: () => 'fresh', renewId: true })).toMatchObject({ ok: true, template: { id: 'fresh' } });
    const done = parseTemplate({ ...good(), secret: 'x', cards: [{ key: 'p', title: 't', body: '', extra: 1 }], links: [] });
    expect(done.ok && JSON.stringify(done.template)).not.toMatch(/secret|extra/);
  });
  it('関連の種類は 6 つ（補足を含む）とも読める', () => {
    const done = parseTemplate({ ...good(), links: [{ from: 'q', to: 'p', kind: 'supplement' }] });
    expect(done.ok && done.template.links[0].kind).toBe('supplement');
  });
});

describe('型のファイル', () => {
  const one = (id: string, name = '型') => ({ version: 1, id, name, folder: '議論', mode: 'snapshot', cards: [{ key: 'p', title: 't', body: '' }], links: [] });
  it('版が 1 でない・形が違うファイルは読まない（呼ぶ側は書かない）', () => {
    expect(parseTemplateFile({ version: 2, templates: [] })).toEqual({ ok: false, why: 'version' });
    expect(parseTemplateFile({ templates: [] })).toEqual({ ok: false, why: 'version' });
    expect(parseTemplateFile({ version: 1 })).toEqual({ ok: false, why: 'shape' });
    expect(parseTemplateFile('x')).toEqual({ ok: false, why: 'shape' });
    expect(parseTemplateFile(null)).toEqual({ ok: false, why: 'shape' });
  });
  it('不正な 1 件は捨てて理由を残す。ほかは読める', () => {
    const done = parseTemplateFile({ version: 1, templates: [one('a1'), { version: 1, id: 'bad', name: '', cards: [] }, one('a2')] });
    expect(done.ok && done.templates.map((t) => t.id)).toEqual(['a1', 'a2']);
    expect(done.ok && done.skipped).toEqual([{ index: 1, why: 'name' }]);
  });
  it('200 件を超えた分は捨てる', () => {
    const list = Array.from({ length: 201 }, (_, i) => one(`t${i}`));
    const done = parseTemplateFile({ version: 1, templates: list });
    expect(done.ok && done.templates).toHaveLength(200);
    expect(done.ok && done.skipped).toEqual([{ index: 200, why: 'limit' }]);
  });
  it('id の重なりは新しい id にする', () => {
    const done = parseTemplateFile({ version: 1, templates: [one('same'), one('same', '二つ目')] }, { newId: counter('z') });
    expect(done.ok && done.templates.map((t) => t.id)).toEqual(['same', 'z0']);
  });
  it('addTemplate：200 件・同じ id は断る（元の並びは変えない）', () => {
    const read = parseTemplateFile({ version: 1, templates: [one('a1')] });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const t = read.templates[0];
    expect(addTemplate(read.templates, t)).toBeNull();
    const second = { ...t, id: 'a2' };
    expect(addTemplate(read.templates, second)).toEqual([t, second]);
    expect(read.templates).toHaveLength(1);
    const full = Array.from({ length: 200 }, (_, i) => ({ ...t, id: `f${i}` }));
    expect(addTemplate(full, second)).toBeNull();
  });
});

describe('型から貼る下書きを作る', () => {
  const tpl = (): CardTemplate => {
    const built = buildTemplateFromCards(sample(), ['a', 'b', 'c'], { name: '三つ', newId: () => 'tpl1' });
    if (!built.ok) throw new Error('型を作れない');
    return built.template;
  };
  it('新しい id・作った時刻つきで、関連は新しい id に付け替わる。rank は無い', () => {
    const t = tpl();
    const before = structuredClone(t);
    const done = buildPasteDraft(t, { newId: counter('d'), now: 1000 });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.replies.map((r) => [r.id, r.parent, r.text, r.createdAt, r.tags])).toEqual([
      ['d0', null, '論点\n何を決めるか', 1000, ['論点']],
      ['d1', null, '賛成', 1001, ['賛成']],
      ['d2', null, '反対', 1002, ['反対']],
    ]);
    expect(done.replies.map((r) => r.links)).toEqual([undefined, [{ to: 'd0', kind: 'ground' }], [{ to: 'd1', kind: 'counter' }]]);
    expect(done.replies.some((r) => r.rank !== undefined || r.by || r.quote || r.image)).toBe(false);
    expect(done.newTopIds).toEqual(['d0', 'd1', 'd2']);
    expect(done.added).toBe(3);
    expect(t).toEqual(before); // 型は変わらない
  });
  it('同じ型を 2 度作っても id は重ならない（独立のコピー）', () => {
    const t = tpl();
    const first = buildPasteDraft(t);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = buildPasteDraft(t, { existing: first.replies });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const ids = [...first.replies, ...second.replies].map((r) => r.id);
    expect(new Set(ids).size).toBe(6);
  });
  it('既存の id と重なる id は引き直す。作った時刻は既存の最新より後', () => {
    const existing = [card({ id: 'd0', text: '先', createdAt: 5000 }), card({ id: 'd1', text: '先', createdAt: 9 })];
    const done = buildPasteDraft(tpl(), { existing, newId: counter('d'), now: 10 });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const ids = done.replies.map((r) => r.id);
    expect(ids.every((id) => id !== 'd0' && id !== 'd1')).toBe(true);
    expect(new Set(ids).size).toBe(3);
    expect(done.replies.map((r) => r.createdAt)).toEqual([5001, 5002, 5003]);
  });
  it('300 枚を超えるなら全体を断る（貼れる数は room）', () => {
    const existing = Array.from({ length: MAX_REPLIES - 2 }, (_, i) => card({ id: `e${i}`, text: 'e', createdAt: i + 1 }));
    expect(buildPasteDraft(tpl(), { existing })).toEqual({ ok: false, why: 'full', room: 2, need: 3 });
    expect(buildPasteDraft(tpl(), { existing: existing.slice(0, MAX_REPLIES - 3) }).ok).toBe(true);
    expect(buildPasteDraft(tpl(), { existing: [...existing, card({ id: 'e1', text: 'e', createdAt: 1 }), card({ id: 'e2', text: 'e', createdAt: 2 }), card({ id: 'e3', text: 'e', createdAt: 3 })] })).toMatchObject({ ok: false, why: 'full', room: 0 });
  });
  it('壊れた型からは作らない。型に混ざった機械のタグは入らない', () => {
    expect(buildPasteDraft({ ...tpl(), cards: [] })).toEqual({ ok: false, why: 'invalid' });
    const dirty = tpl();
    dirty.cards[0].tags = ['宛て:all', '論点'];
    const done = buildPasteDraft(dirty);
    expect(done.ok && done.replies[0].tags).toEqual(['論点']);
  });
  it('同じカードに逆向きの「同じ」があっても、下書きでは 1 本だけ', () => {
    const t = tpl();
    t.links = [{ from: 'k0', to: 'k1', kind: 'same' }, { from: 'k1', to: 'k0', kind: 'same' }];
    const done = buildPasteDraft(t, { newId: counter('d') });
    expect(done.ok && done.replies.flatMap((r) => (r.links ?? []).map((l) => `${r.id}>${l.to}`))).toEqual(['d0>d1']);
  });
});

describe('貼る位置（最後に置いてある番地の次）と、既存の写しの仕組みとのつながり', () => {
  // 並べた番地 0・1・5（空きあり）＋ rank の無いカード 1 枚
  const memo = (): Reply[] => [
    card({ id: 'e0', text: 'e0', createdAt: 1, rank: 0 }),
    card({ id: 'e1', text: 'e1', createdAt: 2, rank: 1 }),
    card({ id: 'e5', text: 'e5', createdAt: 3, rank: 5 }),
    card({ id: 'eu', text: 'eu', createdAt: 4 }),
  ];
  const tpl = (): CardTemplate => {
    const built = buildTemplateFromCards(sample(), ['a', 'b', 'c'], { name: '三つ', newId: () => 'tpl1' });
    if (!built.ok) throw new Error('型を作れない');
    return built.template;
  };
  it('下書きを sendCards（copy）に渡すと、既存の番地は変わらず、新しいカードは最後の番地の次から並ぶ', () => {
    const to = memo();
    const slotsBefore = topSlots(to);
    expect([...slotsBefore]).toEqual([['e0', 0], ['e1', 1], ['e5', 5], ['eu', 6]]);
    const draft = buildPasteDraft(tpl(), { existing: to, newId: counter('d') });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    const sent = sendCards({ from: draft.replies, to, ids: draft.newTopIds, mode: 'copy', newId: counter('n') });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    const after = topSlots(sent.to);
    for (const [id, slot] of slotsBefore) expect(after.get(id)).toBe(slot); // 既存は動かない
    expect(sent.newTopIds.map((id) => after.get(id))).toEqual([7, 8, 9]); // 最後（6）の次から。型の順
    expect(sent.to.filter((r) => r.rank !== undefined).map((r) => r.id)).toEqual(['e0', 'e1', 'e5']); // rank は振り直さない
    expect(sent.added).toBe(3);
    expect(draft.replies.every((r) => r.rank === undefined)).toBe(true); // 下書き（元）は変わらない
  });
  it('貼った関連は、貼ったカード同士だけ。関連の数は型と同じ。既存のカードとはつながらない', () => {
    const to = memo();
    const draft = buildPasteDraft(tpl(), { existing: to, newId: counter('d') });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    const sent = sendCards({ from: draft.replies, to, ids: draft.newTopIds, mode: 'copy', newId: counter('n') });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    const fresh = new Set(sent.newTopIds);
    const pasted = sent.to.filter((r) => fresh.has(r.id));
    const links = pasted.flatMap((r) => (r.links ?? []).map((l) => ({ from: r.id, to: l.to, kind: l.kind })));
    expect(links).toHaveLength(2);
    expect(links.every((l) => fresh.has(l.to))).toBe(true);
    expect(sent.to.filter((r) => !fresh.has(r.id)).every((r) => !r.links)).toBe(true);
    expect(sent.cut).toBe(0);
  });
  it('そのまま末尾に足しても（rank なし）、同じ並びになる', () => {
    const to = memo();
    const draft = buildPasteDraft(tpl(), { existing: to, newId: counter('d') });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    const merged = pruneLinks([...to, ...draft.replies]);
    const slots = topSlots(merged);
    expect(draft.newTopIds.map((id) => slots.get(id))).toEqual([7, 8, 9]);
    expect(orderedTops(merged).map((r) => r.id)).toEqual(['e0', 'e1', 'e5', 'eu', ...draft.newTopIds]);
  });
  it('登録→貼るで、元のカードは増えるだけで変わらない（独立のコピー）', () => {
    const replies = sample();
    const before = structuredClone(replies);
    const t = tpl();
    const draft = buildPasteDraft(t, { existing: replies });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    const sent = sendCards({ from: draft.replies, to: replies, ids: draft.newTopIds, mode: 'copy' });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    expect(replies).toEqual(before);
    expect(sent.to).toHaveLength(replies.length + 3);
    expect(new Set(sent.to.map((r) => r.id)).size).toBe(sent.to.length);
  });
});

describe('ボードの座標の差から作る配置（B3-1。input.offsets）', () => {
  const rs = sample();
  const offsets = { a: { dx: 0, dy: 0 }, b: { dx: 230, dy: 40 }, c: { dx: 15, dy: 310 } };

  it('offsets を渡すと、dx・dy は番地ではなくその値になる（カードの並び・文・タグ・関連は変わらない）', () => {
    const grid = buildTemplateFromCards(rs, ['a', 'b', 'c'], { name: '型', newId: () => 't1', now: 1 });
    const board = buildTemplateFromCards(rs, ['a', 'b', 'c'], { name: '型', newId: () => 't1', now: 1, offsets });
    if (!grid.ok || !board.ok) throw new Error('作れるはず');
    expect(board.template.cards.map((c) => [c.dx, c.dy])).toEqual([[0, 0], [230, 40], [15, 310]]);
    expect(board.template.cards.map(({ dx: _dx, dy: _dy, ...rest }) => rest)).toEqual(grid.template.cards.map(({ dx: _dx, dy: _dy, ...rest }) => rest));
    expect(board.template.links).toEqual(grid.template.links);
    expect(board.report).toEqual(grid.report);
  });
  it('offsets を渡さない呼び出しは今までどおり（番地から。190+20 の升目）', () => {
    const grid = buildTemplateFromCards(rs, ['a', 'b', 'c'], { name: '型' });
    if (!grid.ok) throw new Error('作れるはず');
    expect(grid.template.cards.map((c) => [c.dx, c.dy])).toEqual([[0, 0], [210, 0], [420, 0]]);
  });
  it('選んだカードの 1 枚でも欠けていれば、offsets は使わず番地から作る', () => {
    const partial = buildTemplateFromCards(rs, ['a', 'b', 'c'], { name: '型', offsets: { a: { dx: 0, dy: 0 }, b: { dx: 9, dy: 9 } } });
    if (!partial.ok) throw new Error('作れるはず');
    expect(partial.template.cards.map((c) => [c.dx, c.dy])).toEqual([[0, 0], [210, 0], [420, 0]]);
  });
  it('選んだ以外のカードの offsets は無視する', () => {
    const r = buildTemplateFromCards(rs, ['a', 'b'], { name: '型', offsets: { ...offsets, x: { dx: 5000, dy: 5000 } } });
    if (!r.ok) throw new Error('作れるはず');
    expect(r.template.cards.map((c) => [c.dx, c.dy])).toEqual([[0, 0], [230, 40]]);
  });
  it('範囲（±10,000）に収める・丸める・数でない値は 0', () => {
    const r = buildTemplateFromCards(rs, ['a', 'b', 'c'], { name: '型', offsets: { a: { dx: 20_000, dy: -20_000 }, b: { dx: 12.6, dy: -0.4 }, c: { dx: Number.NaN, dy: Number.POSITIVE_INFINITY } } });
    if (!r.ok) throw new Error('作れるはず');
    expect(r.template.cards.map((c) => [c.dx, c.dy])).toEqual([[10_000, -10_000], [13, 0], [0, 0]]);
  });
  it('作った型は、書き出して読み直しても同じ配置（parseTemplate）', () => {
    const r = buildTemplateFromCards(rs, ['a', 'b', 'c'], { name: '型', newId: () => 't1', now: 1, offsets });
    if (!r.ok) throw new Error('作れるはず');
    const back = parseTemplate(JSON.parse(JSON.stringify(r.template)));
    expect(back.ok && back.template.cards.map((c) => [c.dx, c.dy])).toEqual([[0, 0], [230, 40], [15, 310]]);
  });
  it('骨組み・穴あきでも配置は変わらない', () => {
    for (const mode of ['skeleton', 'hole'] as const) {
      const r = buildTemplateFromCards(rs, ['a', 'b', 'c'], { name: '型', mode, offsets });
      if (!r.ok) throw new Error('作れるはず');
      expect(r.template.cards.map((c) => [c.dx, c.dy])).toEqual([[0, 0], [230, 40], [15, 310]]);
    }
  });
  it('30 枚を超える選びは、offsets があっても断る', () => {
    const many = Array.from({ length: 31 }, (_, i) => card({ id: `m${i}`, text: `m${i}`, createdAt: i, rank: i }));
    const off = Object.fromEntries(many.map((r, i) => [r.id, { dx: i, dy: 0 }]));
    expect(buildTemplateFromCards(many, many.map((r) => r.id), { name: '型', offsets: off })).toEqual({ ok: false, why: 'too-many', max: 30 });
  });
});