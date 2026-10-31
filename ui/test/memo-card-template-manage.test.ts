// 型の名前の変更・削除・内蔵サンプルの復元（Phase 2 の残り）。偽の io でファイルの読み書きを真似る
import { describe, expect, it } from 'vitest';

import type { CheckedRead } from '../src/data';
import { buildTemplateFromCards, type CardTemplate, parseTemplate, TEMPLATE_FOLDERS, TEMPLATE_LIMITS } from '../src/memo-card-templates';
import { missingSamples, sampleTemplates } from '../src/memo-card-template-samples';
import {
  deleteStoredTemplate,
  loadTemplates,
  removeFromList,
  renameInList,
  renameStoredTemplate,
  restoreSampleTemplates,
  templateSaveMessage,
  TEMPLATES_BACKUP,
  TEMPLATES_FILE,
  type TemplateIo,
} from '../src/memo-card-template-store';
import { MAX_LINKS_PER_CARD } from '../src/memo-card-links';
import type { Reply } from '../src/threads';

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

const card = (id: string, text: string, at: number): Reply => ({ id, parent: null, text, createdAt: at });
function made(name: string, id: string, folder: CardTemplate['folder'] = '議論'): CardTemplate {
  const done = buildTemplateFromCards([card('a', '甲', 1), card('b', '乙', 2)], ['a', 'b'], { name, folder, newId: () => id, now: 1 });
  if (!done.ok) throw new Error('型を作れない');
  return done.template;
}
const fileOf = (...templates: CardTemplate[]) => ({ version: 1, templates });
const idsOf = (v: unknown) => (v as { templates: CardTemplate[] }).templates.map((t) => t.id);

describe('内蔵サンプル', () => {
  it('どれも検査を通り、決まった id・フォルダ・上限の内に収まる', () => {
    const list = sampleTemplates();
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(new Set(list.map((t) => t.id)).size).toBe(list.length);
    for (const t of list) {
      expect(t.id).toMatch(/^sample-/);
      expect(TEMPLATE_FOLDERS).toContain(t.folder);
      expect(parseTemplate(t).ok).toBe(true);
      expect(t.cards.length).toBeLessThanOrEqual(TEMPLATE_LIMITS.cards);
      expect(t.cards.every((c) => c.tags.length === 1)).toBe(true);
      const perFrom = new Map<string, number>();
      for (const l of t.links) perFrom.set(l.from, (perFrom.get(l.from) ?? 0) + 1);
      expect([...perFrom.values()].every((n) => n <= MAX_LINKS_PER_CARD)).toBe(true);
    }
  });
  it('「賛成・反対・結論」：派生は子から親への「続き」、対立は反論 1 本、結論は「根拠」', () => {
    const t = sampleTemplates().find((x) => x.id === 'sample-proscons');
    expect(t?.cards.map((c) => c.title)).toEqual(['論点', '賛成', '反対', '結論']);
    expect(t?.links).toEqual([
      { from: 'k1', to: 'k0', kind: 'next' },
      { from: 'k1', to: 'k3', kind: 'ground' },
      { from: 'k2', to: 'k0', kind: 'next' },
      { from: 'k2', to: 'k1', kind: 'counter' },
      { from: 'k2', to: 'k3', kind: 'ground' },
    ]);
  });
  it('呼ぶたびに新しい写し。足りない分だけを id で見分ける', () => {
    const a = sampleTemplates();
    a[0].name = '書き換えた';
    expect(sampleTemplates()[0].name).not.toBe('書き換えた');
    expect(missingSamples([])).toHaveLength(a.length);
    expect(missingSamples(a).map((t) => t.id)).toEqual([]);
    expect(missingSamples([a[0]]).map((t) => t.id)).toEqual(a.slice(1).map((t) => t.id));
  });
});

describe('名前の変更・削除（一覧の計算）', () => {
  const list = [made('一', 'a'), made('二', 'b')];
  it('名前だけを替える。空・見えない文字だけ・無い id は断る', () => {
    const r = renameInList(list, 'b', '  新しい　名前 ');
    expect(r).toMatchObject({ next: [list[0], { ...list[1], name: '新しい 名前' }] });
    expect(renameInList(list, 'b', '   ')).toEqual({ fail: 'name' });
    expect(renameInList(list, 'b', '\u200b')).toEqual({ fail: 'name' });
    expect(renameInList(list, 'zz', 'x')).toEqual({ fail: 'notfound' });
    expect(list[1].name).toBe('二');
  });
  it('消す：その id だけ。無い id は断る', () => {
    expect(removeFromList(list, 'a')).toEqual({ next: [list[1]] });
    expect(removeFromList(list, 'zz')).toEqual({ fail: 'notfound' });
  });
});

describe('名前の変更・削除・復元（保存）', () => {
  it('名前の変更：初めての書き込みの前に写しを 1 回だけ取り、その型だけが変わる', async () => {
    const original = fileOf(made('一', 'a'), made('二', 'b'));
    const { io, writes, store } = fakeIo({ [TEMPLATES_FILE]: original });
    const done = await renameStoredTemplate(io, 'b', '二番');
    expect(done).toMatchObject({ ok: true, count: 2 });
    expect(writes.map((w) => w.name)).toEqual([TEMPLATES_BACKUP, TEMPLATES_FILE]);
    expect(writes[0].value).toEqual(original);
    const after = (store.get(TEMPLATES_FILE) as { templates: CardTemplate[] }).templates;
    expect(after.map((t) => t.name)).toEqual(['一', '二番']);
    await renameStoredTemplate(io, 'a', '一番');
    expect(writes.map((w) => w.name)).toEqual([TEMPLATES_BACKUP, TEMPLATES_FILE, TEMPLATES_FILE]); // 写しは取り直さない
    expect(store.get(TEMPLATES_BACKUP)).toEqual(original);
  });
  it('名前が空・型が無いときは、何も書かない（写しも取らない）', async () => {
    const { io, writes } = fakeIo({ [TEMPLATES_FILE]: fileOf(made('一', 'a')) });
    expect(await renameStoredTemplate(io, 'a', ' ')).toEqual({ ok: false, why: 'name' });
    expect(await renameStoredTemplate(io, 'zz', 'x')).toEqual({ ok: false, why: 'notfound' });
    expect(await deleteStoredTemplate(io, 'zz')).toEqual({ ok: false, why: 'notfound' });
    expect(writes).toEqual([]);
  });
  it('削除：その型だけが消え、並びは変わらない。最後の 1 件も消せる（空の一覧になる）', async () => {
    const { io, store } = fakeIo({ [TEMPLATES_FILE]: fileOf(made('一', 'a'), made('二', 'b'), made('三', 'c')) });
    expect(await deleteStoredTemplate(io, 'b')).toMatchObject({ ok: true, count: 2 });
    expect(idsOf(store.get(TEMPLATES_FILE))).toEqual(['a', 'c']);
    await deleteStoredTemplate(io, 'a');
    await deleteStoredTemplate(io, 'c');
    expect(store.get(TEMPLATES_FILE)).toEqual({ version: 1, templates: [] });
  });
  it('読めない・知らない版・形が違う・読めない型が混ざったファイルには、書かない（名前の変更・削除・復元とも）', async () => {
    const mixed = { version: 1, templates: [made('良い', 'ok1'), { id: 'bad' }] };
    for (const bad of ['FAIL', { version: 2, templates: [] }, { version: 1 }, mixed]) {
      const expected = bad === mixed ? 'partial' : 'unreadable';
      const { io, writes } = fakeIo({ [TEMPLATES_FILE]: bad });
      expect(await renameStoredTemplate(io, 'ok1', 'x')).toEqual({ ok: false, why: expected });
      expect(await deleteStoredTemplate(io, 'ok1')).toEqual({ ok: false, why: expected });
      expect(await restoreSampleTemplates(io)).toEqual({ ok: false, why: expected });
      expect(writes).toEqual([]);
    }
  });
  it('写しを取れない（読めない・書けない）ときは、本体も書かない', async () => {
    const a = fakeIo({ [TEMPLATES_FILE]: fileOf(made('一', 'a')), [TEMPLATES_BACKUP]: 'FAIL' });
    expect(await deleteStoredTemplate(a.io, 'a')).toEqual({ ok: false, why: 'backup' });
    expect(a.writes).toEqual([]);
    const b = fakeIo({ [TEMPLATES_FILE]: fileOf(made('一', 'a')) }, { failWrite: TEMPLATES_BACKUP });
    expect(await renameStoredTemplate(b.io, 'a', 'x')).toEqual({ ok: false, why: 'backup' });
    expect(b.writes).toEqual([]);
    const c = fakeIo({ [TEMPLATES_FILE]: fileOf(made('一', 'a')) }, { failWrite: TEMPLATES_FILE });
    expect(await renameStoredTemplate(c.io, 'a', 'x')).toEqual({ ok: false, why: 'write' });
  });
  it('初期サンプルの復元：ファイルが無ければ全部で新しく作る（写しは取らない）', async () => {
    const { io, writes, store } = fakeIo();
    const done = await restoreSampleTemplates(io);
    expect(done).toMatchObject({ ok: true, added: sampleTemplates().length });
    expect(writes.map((w) => w.name)).toEqual([TEMPLATES_FILE]);
    expect(idsOf(store.get(TEMPLATES_FILE))).toEqual(sampleTemplates().map((t) => t.id));
  });
  it('復元は、足りない内蔵サンプルだけを後ろに足す。今ある型・名前を変えたサンプルには触らない', async () => {
    const [first, ...rest] = sampleTemplates();
    const mine = made('自分の型', 'mine1');
    const renamed = { ...first, name: '私の名前' };
    const { io, store } = fakeIo({ [TEMPLATES_FILE]: fileOf(mine, renamed) });
    const done = await restoreSampleTemplates(io);
    expect(done).toMatchObject({ ok: true, added: rest.length });
    const after = (store.get(TEMPLATES_FILE) as { templates: CardTemplate[] }).templates;
    expect(after.map((t) => t.id)).toEqual(['mine1', first.id, ...rest.map((t) => t.id)]);
    expect(after[1].name).toBe('私の名前');
    expect(store.get(TEMPLATES_BACKUP)).toEqual(fileOf(mine, renamed));
  });
  it('復元：すべてそろっていれば何も書かない（added: 0）。消したサンプルは、また足せる', async () => {
    const all = sampleTemplates();
    const { io, writes, store } = fakeIo({ [TEMPLATES_FILE]: fileOf(...all) });
    expect(await restoreSampleTemplates(io)).toMatchObject({ ok: true, added: 0 });
    expect(writes).toEqual([]);
    await deleteStoredTemplate(io, all[1].id);
    expect(idsOf(store.get(TEMPLATES_FILE))).not.toContain(all[1].id);
    expect(await restoreSampleTemplates(io)).toMatchObject({ ok: true, added: 1 });
    expect(idsOf(store.get(TEMPLATES_FILE))).toContain(all[1].id);
  });
  it('復元で 200 件を超えるなら、断る（何も書かない）', async () => {
    const t = made('型', 'x');
    const many = Array.from({ length: TEMPLATE_LIMITS.templates - 1 }, (_, i) => ({ ...t, id: `f${i}` }));
    const { io, writes } = fakeIo({ [TEMPLATES_FILE]: fileOf(...many) });
    expect(await restoreSampleTemplates(io)).toEqual({ ok: false, why: 'full' });
    expect(writes).toEqual([]);
  });
  it('書いたあとに読み直しても同じ。断りの文がそろっている', async () => {
    const { io } = fakeIo();
    await restoreSampleTemplates(io);
    const back = await loadTemplates(io);
    expect(back.state === 'ok' && back.templates).toEqual(sampleTemplates());
    for (const why of ['notfound', 'name'] as const) expect(templateSaveMessage(why).length).toBeGreaterThan(0);
  });
});