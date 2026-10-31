// 型の保存（読めなければ書かない・初回だけ写しを取る）と、登録の小窓の文（Phase 1b）。偽の io でファイルの読み書きを真似る
import { describe, expect, it } from 'vitest';

import type { CheckedRead } from '../src/data';
import { buildTemplateFromCards, type CardTemplate, TEMPLATE_LIMITS } from '../src/memo-card-templates';
import {
  describeTemplateReport,
  loadTemplates,
  saveNewTemplate,
  type SaveTemplateResult,
  TEMPLATE_MIN_PICK,
  TEMPLATE_UNTITLED,
  templateNameTaken,
  templatePickState,
  templateSaveMessage,
  TEMPLATES_BACKUP,
  TEMPLATES_FILE,
  type TemplateIo,
} from '../src/memo-card-template-store';
import type { Reply } from '../src/threads';

// 偽のファイル置き場。files に入れた値はそのまま読める（'FAIL' なら読めない）。writes に書いた順が残る
function fakeIo(files: Record<string, unknown> = {}, opts: { failWrite?: string } = {}) {
  const store = new Map<string, unknown>(Object.entries(files));
  const writes: { name: string; value: unknown }[] = [];
  const io: TemplateIo = {
    async read(name): Promise<CheckedRead<unknown>> {
      if (!store.has(name)) return { status: 'missing' };
      const value = store.get(name);
      return value === 'FAIL' ? { status: 'failed' } : { status: 'ok', value };
    },
    async write(name, value) {
      if (opts.failWrite === name) return false;
      writes.push({ name, value: structuredClone(value) });
      store.set(name, structuredClone(value));
      return true;
    },
  };
  return { io, store, writes };
}

const reply = (id: string, text: string, at: number, extra: Partial<Reply> = {}): Reply => ({ id, parent: null, text, createdAt: at, ...extra });

function made(name = '型', id = 'tpl-new'): CardTemplate {
  const done = buildTemplateFromCards([reply('a', '甲', 1), reply('b', '乙', 2, { links: [{ to: 'a', kind: 'ground' }] })], ['a', 'b'], { name, newId: () => id, now: 7 });
  if (!done.ok) throw new Error('型を作れない');
  return done.template;
}

const fileOf = (...templates: CardTemplate[]) => ({ version: 1, templates });

describe('型のファイルを読む', () => {
  it('無ければ missing（空から始める）', async () => {
    const { io } = fakeIo();
    expect(await loadTemplates(io)).toEqual({ state: 'missing', templates: [], skipped: 0, raw: null });
  });
  it('読めれば ok。型と、読めなかった型の数が分かる', async () => {
    const good = made('一つ目', 'a1');
    const { io } = fakeIo({ [TEMPLATES_FILE]: { version: 1, templates: [good, { version: 1, id: 'bad', name: '', cards: [] }] } });
    const done = await loadTemplates(io);
    expect(done.state).toBe('ok');
    if (done.state === 'unreadable') return;
    expect(done.templates).toEqual([good]);
    expect(done.skipped).toBe(1);
  });
  it('返事が無い・壊れている・知らない版・形が違うは unreadable', async () => {
    expect(await loadTemplates(fakeIo({ [TEMPLATES_FILE]: 'FAIL' }).io)).toEqual({ state: 'unreadable', why: 'failed' });
    expect(await loadTemplates(fakeIo({ [TEMPLATES_FILE]: { version: 2, templates: [] } }).io)).toEqual({ state: 'unreadable', why: 'version' });
    expect(await loadTemplates(fakeIo({ [TEMPLATES_FILE]: { version: 1 } }).io)).toEqual({ state: 'unreadable', why: 'shape' });
    expect(await loadTemplates(fakeIo({ [TEMPLATES_FILE]: 'x' }).io)).toEqual({ state: 'unreadable', why: 'shape' });
  });
});

describe('型を保存する', () => {
  it('ファイルが無ければ、新しく作る（写しは取らない）', async () => {
    const { io, writes } = fakeIo();
    const t = made();
    const done = await saveNewTemplate(io, t);
    expect(done).toMatchObject({ ok: true, count: 1 });
    expect(writes.map((w) => w.name)).toEqual([TEMPLATES_FILE]);
    expect(writes[0].value).toEqual({ version: 1, templates: [t] });
  });
  it('すでにファイルがあれば、先にもとの写しを 1 回だけ取ってから、1 件足して書く', async () => {
    const old = made('古い', 'old1');
    const original = fileOf(old);
    const { io, writes, store } = fakeIo({ [TEMPLATES_FILE]: original });
    const done = await saveNewTemplate(io, made('新しい', 'new1'));
    expect(done).toMatchObject({ ok: true, count: 2 });
    expect(writes.map((w) => w.name)).toEqual([TEMPLATES_BACKUP, TEMPLATES_FILE]);
    expect(writes[0].value).toEqual(original); // 写しは、足す前の中身
    expect((store.get(TEMPLATES_FILE) as { templates: CardTemplate[] }).templates.map((t) => t.id)).toEqual(['old1', 'new1']);
    // 2 回目は写しを取り直さない
    const second = await saveNewTemplate(io, made('三つ目', 'new2'));
    expect(second).toMatchObject({ ok: true, count: 3 });
    expect(writes.map((w) => w.name)).toEqual([TEMPLATES_BACKUP, TEMPLATES_FILE, TEMPLATES_FILE]);
    expect(store.get(TEMPLATES_BACKUP)).toEqual(original);
  });
  it('写しが読めない（壊れている）ときは、何も書かない', async () => {
    const { io, writes } = fakeIo({ [TEMPLATES_FILE]: fileOf(made('古い', 'old1')), [TEMPLATES_BACKUP]: 'FAIL' });
    expect(await saveNewTemplate(io, made())).toEqual({ ok: false, why: 'backup' });
    expect(writes).toEqual([]);
  });
  it('写しを書けなければ、本体も書かない', async () => {
    const { io, writes } = fakeIo({ [TEMPLATES_FILE]: fileOf(made('古い', 'old1')) }, { failWrite: TEMPLATES_BACKUP });
    expect(await saveNewTemplate(io, made())).toEqual({ ok: false, why: 'backup' });
    expect(writes).toEqual([]);
  });
  it('読めない・知らない版・形が違うファイルには、書かない', async () => {
    for (const bad of ['FAIL', { version: 2, templates: [] }, { version: 1 }, 'x']) {
      const { io, writes } = fakeIo({ [TEMPLATES_FILE]: bad });
      expect(await saveNewTemplate(io, made())).toEqual({ ok: false, why: 'unreadable' });
      expect(writes).toEqual([]);
    }
  });
  it('読めない型が混ざったファイルには、書かない（書くとその型が消える）', async () => {
    const { io, writes } = fakeIo({ [TEMPLATES_FILE]: { version: 1, templates: [made('良い', 'ok1'), { id: 'bad' }] } });
    expect(await saveNewTemplate(io, made())).toEqual({ ok: false, why: 'partial' });
    expect(writes).toEqual([]);
  });
  it('200 件あれば断る', async () => {
    const t = made();
    const many = Array.from({ length: TEMPLATE_LIMITS.templates }, (_, i) => ({ ...t, id: `f${i}` }));
    const { io, writes } = fakeIo({ [TEMPLATES_FILE]: fileOf(...many) });
    expect(await saveNewTemplate(io, made('新しい', 'zzz'))).toEqual({ ok: false, why: 'full' });
    expect(writes).toEqual([]);
  });
  it('同じ id があれば、新しい id にして足す', async () => {
    const { io, store } = fakeIo({ [TEMPLATES_FILE]: fileOf(made('古い', 'same')) });
    let n = 0;
    const done = await saveNewTemplate(io, made('新しい', 'same'), { newId: () => `fresh${n++}` });
    expect(done).toMatchObject({ ok: true, count: 2 });
    expect((store.get(TEMPLATES_FILE) as { templates: CardTemplate[] }).templates.map((t) => t.id)).toEqual(['same', 'fresh0']);
    // 新しい id も重なり続けるなら、断る
    const stuck = await saveNewTemplate(io, made('また', 'same'), { newId: () => 'same' });
    expect(stuck).toEqual({ ok: false, why: 'duplicate' });
  });
  it('書き込みに失敗したら write', async () => {
    const { io } = fakeIo({}, { failWrite: TEMPLATES_FILE });
    expect(await saveNewTemplate(io, made())).toEqual({ ok: false, why: 'write' });
  });
  it('保存した型を読み直すと、同じ型が出てくる', async () => {
    const { io } = fakeIo();
    const t = made('往復', 'rt1');
    await saveNewTemplate(io, t);
    const back = await loadTemplates(io);
    expect(back.state === 'ok' && back.templates).toEqual([t]);
  });
});

describe('登録の小窓の文', () => {
  it('「型にする…」は 2 枚以上 30 枚までで押せる', () => {
    expect(TEMPLATE_MIN_PICK).toBe(2);
    expect(templatePickState(0).enabled).toBe(false);
    expect(templatePickState(1).enabled).toBe(false);
    expect(templatePickState(1).hint).toContain('2枚以上');
    expect(templatePickState(2).enabled).toBe(true);
    expect(templatePickState(30).enabled).toBe(true);
    const over = templatePickState(31);
    expect(over.enabled).toBe(false);
    expect(over.hint).toContain('30');
  });
  it('数の 2 行：枚数・関連と、含めないもの（画像・引用・返信・外へ出る関連）', () => {
    expect(describeTemplateReport({ cards: 3, links: 2, cutLinks: 1, skipped: { children: 1, images: 2, quotes: 3, machineTags: 4 } })).toEqual({
      counts: '3枚・関連 2本',
      excluded: '含めないもの：画像 2・引用 3・返信 1・外へ出る関連 1本',
    });
    expect(describeTemplateReport({ cards: 2, links: 0, cutLinks: 0, skipped: { children: 0, images: 0, quotes: 0, machineTags: 0 } })).toEqual({
      counts: '2枚・関連 0本',
      excluded: '含めないもの：なし',
    });
  });
  it('断った理由の文が、すべての理由に用意されている', () => {
    const whys: Extract<SaveTemplateResult, { ok: false }>['why'][] = ['unreadable', 'partial', 'full', 'duplicate', 'backup', 'write'];
    const texts = whys.map(templateSaveMessage);
    expect(texts.every((s) => s.length > 0)).toBe(true);
    expect(new Set(texts).size).toBe(whys.length);
    expect(templateSaveMessage('unreadable')).toContain('変えていません');
  });
});

describe('同じ名前の型（ボードの「型にする…」。B3-1）', () => {
  const t = (name: string): CardTemplate => ({ version: 1, id: name, name, folder: '議論', mode: 'snapshot', cards: [{ key: 'k0', title: 'a', body: '', tags: [], dx: 0, dy: 0 }], links: [] });
  it('同じ名前（整えたあと）があれば true。空の名前・別の名前は false', () => {
    expect(templateNameTaken([t('賛成・反対'), t('結論')], '賛成・反対')).toBe(true);
    expect(templateNameTaken([t('賛成 反対')], '  賛成 \n 反対  ')).toBe(true);
    expect(templateNameTaken([t('結論')], '結論の型')).toBe(false);
    expect(templateNameTaken([t('結論')], '')).toBe(false);
    expect(templateNameTaken([], '結論')).toBe(false);
  });
  it('名前を空にして決めたときの名前は「無題の型」', () => {
    expect(TEMPLATE_UNTITLED).toBe('無題の型');
  });
});