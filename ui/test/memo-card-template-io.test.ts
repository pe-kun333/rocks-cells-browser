// 型の JSON の書き出し・読み込み（Phase 4）。偽の io でファイルの読み書きを真似る
import { describe, expect, it } from 'vitest';

import type { CheckedRead } from '../src/data';
import {
  buildExport,
  exportFileName,
  exportFitsImportLimit,
  importFailText,
  importSummaryText,
  mergeImported,
  parseImportText,
  skipReasonText,
  TEMPLATE_FORMAT,
  uniqueName,
} from '../src/memo-card-template-io';
import { importStoredTemplates, loadTemplates, TEMPLATES_BACKUP, TEMPLATES_FILE, type TemplateIo } from '../src/memo-card-template-store';
import { sampleTemplates } from '../src/memo-card-template-samples';
import { buildTemplateFromCards, type CardTemplate, parseTemplate, TEMPLATE_LIMITS } from '../src/memo-card-templates';
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
const exportText = (...templates: CardTemplate[]) => JSON.stringify(buildExport(templates));
let seq = 0;
const nextId = () => `new-${++seq}`;

describe('書き出し', () => {
  it('format・version・templates の 3 つだけ。型は写しで、元は変わらない', () => {
    const t = made('甲乙', 't1');
    const out = buildExport([t]);
    expect(Object.keys(out)).toEqual(['format', 'version', 'templates']);
    expect(out.format).toBe('honeycomb-cardtpl');
    expect(out.version).toBe(1);
    expect(out.templates).toEqual([t]);
    out.templates[0].name = '変えた';
    out.templates[0].cards[0].title = '変えた';
    expect(t.name).toBe('甲乙');
    expect(t.cards[0].title).not.toBe('変えた');
  });

  it('書き出した文は、そのまま読み込める（全部・1 件・モードも同じ）', () => {
    const list = sampleTemplates();
    const back = parseImportText(JSON.stringify(buildExport(list)));
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.skipped).toEqual([]);
      expect(back.templates).toEqual(list);
      expect(new Set(back.templates.map((t) => t.mode))).toEqual(new Set(['snapshot', 'skeleton', 'hole']));
    }
    const one = parseImportText(exportText(list[1]));
    expect(one.ok && one.templates.map((t) => t.id)).toEqual([list[1].id]);
  });

  it('ファイル名は ui-data\\exports の下の card-templates-日時.json（書き込み名の決まりに合う）', () => {
    const name = exportFileName(new Date(2026, 9, 24, 8, 5, 3));
    expect(name).toBe('exports/card-templates-20261024-080503.json');
    expect(name).toMatch(/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+){0,3}(\.[A-Za-z0-9_-]+)?$/);
  });

  it('読み込みの上限（1 MB）を超える書き出しは見分けられる', () => {
    expect(exportFitsImportLimit(buildExport([made('小', 'a')]))).toBe(true);
    const big = made('大', 'b');
    big.cards[0].body = 'あ'.repeat(400_000);
    expect(exportFitsImportLimit(buildExport([big]))).toBe(false);
  });
});

describe('読み込みの検査', () => {
  it('壊れた JSON・空の文は json で断る', () => {
    expect(parseImportText('{ broken')).toEqual({ ok: false, why: 'json' });
    expect(parseImportText('')).toEqual({ ok: false, why: 'json' });
  });

  it('format が違うもの（Grok の提案・配列・数）は format で断る', () => {
    expect(parseImportText(JSON.stringify({ format: 'hcb-memo-interchange', version: 1, templates: [] }))).toEqual({ ok: false, why: 'format' });
    expect(parseImportText(JSON.stringify({ version: 1, templates: [made('a', 'a')] }))).toEqual({ ok: false, why: 'format' });
    expect(parseImportText('[]')).toEqual({ ok: false, why: 'format' });
    expect(parseImportText('42')).toEqual({ ok: false, why: 'format' });
    expect(parseImportText('null')).toEqual({ ok: false, why: 'format' });
  });

  it('version が 1 でない・templates が一覧でない・空は、それぞれの理由で断る', () => {
    expect(parseImportText(JSON.stringify({ format: TEMPLATE_FORMAT, version: 2, templates: [made('a', 'a')] }))).toEqual({ ok: false, why: 'version' });
    expect(parseImportText(JSON.stringify({ format: TEMPLATE_FORMAT, templates: [] }))).toEqual({ ok: false, why: 'version' });
    expect(parseImportText(JSON.stringify({ format: TEMPLATE_FORMAT, version: 1, templates: 'x' }))).toEqual({ ok: false, why: 'shape' });
    expect(parseImportText(JSON.stringify({ format: TEMPLATE_FORMAT, version: 1, templates: [] }))).toEqual({ ok: false, why: 'empty' });
    for (const why of ['json', 'format', 'version', 'shape', 'empty'] as const) expect(importFailText(why)).toContain('何も変えていません');
  });

  it('先頭の BOM があっても読める', () => {
    const back = parseImportText(`\uFEFF${exportText(made('甲乙', 't1'))}`);
    expect(back.ok && back.templates.length).toBe(1);
  });

  it('読めない型は理由つきで飛ばし、読める型だけ残す（番号は元の並びの位置）', () => {
    const good = made('良い', 'g1');
    const text = JSON.stringify({
      format: TEMPLATE_FORMAT,
      version: 1,
      templates: [{ ...good, name: '   ' }, good, { ...good, id: 'x', cards: [] }, 'bad', { ...good, id: 'm', mode: 'weird' }],
    });
    const back = parseImportText(text);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.total).toBe(5);
    expect(back.templates.map((t) => t.id)).toEqual(['g1']);
    expect(back.skipped.map((s) => s.index)).toEqual([0, 2, 3, 4]);
    for (const s of back.skipped) expect(skipReasonText(s.why).length).toBeGreaterThan(0);
  });

  it('全部読めないファイルは、読める型 0 件として返す（足すものが無い）', () => {
    const back = parseImportText(JSON.stringify({ format: TEMPLATE_FORMAT, version: 1, templates: [{ nope: 1 }] }));
    expect(back.ok && back.templates).toEqual([]);
    expect(back.ok && back.skipped.length).toBe(1);
  });

  it('同じ id が 1 つのファイルに 2 回あっても、型は 2 件とも読む（id は別になる）', () => {
    const a = made('甲', 'same');
    const b = made('乙', 'same');
    const back = parseImportText(exportText(a, b));
    expect(back.ok).toBe(true);
    if (back.ok) expect(new Set(back.templates.map((t) => t.id)).size).toBe(2);
  });
});

describe('名前の重なり', () => {
  it('重ならなければそのまま・重なれば (2)(3)…', () => {
    expect(uniqueName('甲', new Set())).toBe('甲');
    expect(uniqueName('甲', new Set(['甲']))).toBe('甲 (2)');
    expect(uniqueName('甲', new Set(['甲', '甲 (2)']))).toBe('甲 (3)');
  });
  it('40 字いっぱいの名前でも 40 字に収まる', () => {
    const long = 'あ'.repeat(TEMPLATE_LIMITS.name);
    const next = uniqueName(long, new Set([long]));
    expect([...next].length).toBeLessThanOrEqual(TEMPLATE_LIMITS.name);
    expect(next.endsWith(' (2)')).toBe(true);
  });
});

describe('足し方（mergeImported）', () => {
  it('重ならない型はそのまま後ろに足す。今の型と元の入力は変わらない', () => {
    const existing = [made('今の', 'e1')];
    const incoming = [made('新しい', 'n1')];
    const before = JSON.stringify([existing, incoming]);
    const m = mergeImported(existing, incoming, { newId: nextId });
    expect(m.next.map((t) => `${t.id}:${t.name}`)).toEqual(['e1:今の', 'n1:新しい']);
    expect(m.summary).toEqual({ added: 1, nameChanged: 0, idChanged: 0, dropped: 0 });
    expect(JSON.stringify([existing, incoming])).toBe(before);
    m.next[1].cards[0].title = '変えた';
    expect(incoming[0].cards[0].title).not.toBe('変えた');
  });

  it('id が今の型と重なれば新しい id（上書きしない）', () => {
    const existing = [made('今の', 'dup')];
    const m = mergeImported(existing, [made('別の名前', 'dup')], { newId: () => 'fresh-1' });
    expect(m.next.map((t) => t.id)).toEqual(['dup', 'fresh-1']);
    expect(m.next[0].name).toBe('今の');
    expect(m.summary.idChanged).toBe(1);
    expect(m.summary.nameChanged).toBe(0);
  });

  it('新しい id も重なるなら、重ならない id が出るまで作り直す', () => {
    const ids = ['dup', 'dup', 'ok-id'];
    const m = mergeImported([made('今の', 'dup')], [made('別', 'dup')], { newId: () => ids.shift() as string });
    expect(m.next[1].id).toBe('ok-id');
  });

  it('名前が重なれば (2)。ファイルの中で同じ名前が続けば (2)(3)', () => {
    const existing = [made('同じ', 'e1')];
    const m = mergeImported(existing, [made('同じ', 'n1'), made('同じ', 'n2'), made('同じ', 'n3')], { newId: nextId });
    expect(m.next.map((t) => t.name)).toEqual(['同じ', '同じ (2)', '同じ (3)', '同じ (4)']);
    expect(m.summary.nameChanged).toBe(3);
    expect(m.items[0].fromName).toBe('同じ');
    expect(m.items[0].nameChanged).toBe(true);
  });

  it('フォルダ・モード・カードは変えない', () => {
    const skeleton = sampleTemplates().find((t) => t.mode === 'hole') as CardTemplate;
    const m = mergeImported([], [skeleton], { newId: nextId });
    expect(m.next[0]).toEqual(skeleton);
  });

  it('200 件を超える分は足さない（入る分だけ。順に）', () => {
    const existing = Array.from({ length: TEMPLATE_LIMITS.templates - 2 }, (_, i) => made(`既存${i}`, `e${i}`));
    const incoming = [made('入る1', 'n1'), made('入る2', 'n2'), made('入らない', 'n3')];
    const m = mergeImported(existing, incoming, { newId: nextId });
    expect(m.next.length).toBe(TEMPLATE_LIMITS.templates);
    expect(m.next.map((t) => t.name)).toContain('入る2');
    expect(m.next.map((t) => t.name)).not.toContain('入らない');
    expect(m.summary).toEqual({ added: 2, nameChanged: 0, idChanged: 0, dropped: 1 });
  });

  it('もう 200 件ならひとつも足さない', () => {
    const existing = Array.from({ length: TEMPLATE_LIMITS.templates }, (_, i) => made(`既存${i}`, `e${i}`));
    const m = mergeImported(existing, [made('入らない', 'n')], { newId: nextId });
    expect(m.items).toEqual([]);
    expect(m.summary.dropped).toBe(1);
  });

  it('足したあとの型は、保存前と同じ検査を通る', () => {
    const m = mergeImported([made('今の', 'dup')], [made('今の', 'dup')], { newId: nextId });
    for (const t of m.next) expect(parseTemplate(t).ok).toBe(true);
  });

  it('知らせの文：件数・名前・収まらない分', () => {
    expect(importSummaryText({ added: 3, nameChanged: 0, idChanged: 0, dropped: 0 })).toBe('3 件を読み込みました');
    const s = importSummaryText({ added: 3, nameChanged: 2, idChanged: 1, dropped: 4 });
    expect(s).toContain('2 件');
    expect(s).toContain('4 件');
  });
});

describe('保存（importStoredTemplates）', () => {
  it('ファイルが無いときは新しく書く（元が無いのでバックアップは作らない）', async () => {
    const { io, store, writes } = fakeIo();
    const res = await importStoredTemplates(io, [made('甲', 'a'), made('乙', 'b')], { newId: nextId });
    expect(res.ok && res.summary?.added).toBe(2);
    expect(writes.map((w) => w.name)).toEqual([TEMPLATES_FILE]);
    expect(store.has(TEMPLATES_BACKUP)).toBe(false);
    const loaded = await loadTemplates(io);
    expect(loaded.state === 'ok' && loaded.templates.map((t) => t.name)).toEqual(['甲', '乙']);
  });

  it('今のファイルがあれば、最初の 1 回だけ書き換え前の写しを作る', async () => {
    const original = fileOf(made('今の', 'e1'));
    const { io, store, writes } = fakeIo({ [TEMPLATES_FILE]: original });
    const first = await importStoredTemplates(io, [made('甲', 'a')], { newId: nextId });
    expect(first.ok).toBe(true);
    expect(store.get(TEMPLATES_BACKUP)).toEqual(original);
    expect(writes.map((w) => w.name)).toEqual([TEMPLATES_BACKUP, TEMPLATES_FILE]);
    await importStoredTemplates(io, [made('乙', 'b')], { newId: nextId });
    expect(store.get(TEMPLATES_BACKUP)).toEqual(original);
    expect(writes.filter((w) => w.name === TEMPLATES_BACKUP).length).toBe(1);
  });

  it('同じファイルを 2 回読み込んでも壊れず、(2) と新しい id で並ぶ', async () => {
    const { io } = fakeIo();
    const incoming = [made('甲', 'a')];
    await importStoredTemplates(io, incoming, { newId: nextId });
    const second = await importStoredTemplates(io, incoming, { newId: nextId });
    expect(second.ok && second.summary).toEqual({ added: 1, nameChanged: 1, idChanged: 1, dropped: 0 });
    const loaded = await loadTemplates(io);
    expect(loaded.state === 'ok' && loaded.templates.map((t) => t.name)).toEqual(['甲', '甲 (2)']);
    expect(loaded.state === 'ok' && new Set(loaded.templates.map((t) => t.id)).size).toBe(2);
  });

  it('今のファイルが読めない・版が違うときは何も書かない', async () => {
    const failed = fakeIo({ [TEMPLATES_FILE]: 'FAIL' });
    expect(await importStoredTemplates(failed.io, [made('甲', 'a')])).toEqual({ ok: false, why: 'unreadable' });
    expect(failed.writes).toEqual([]);
    const wrong = fakeIo({ [TEMPLATES_FILE]: { version: 9, templates: [] } });
    expect((await importStoredTemplates(wrong.io, [made('甲', 'a')])).ok).toBe(false);
    expect(wrong.writes).toEqual([]);
  });

  it('今のファイルに読めない型が混じるときも何も書かない（残りを消さない）', async () => {
    const { io, writes } = fakeIo({ [TEMPLATES_FILE]: { version: 1, templates: [made('今の', 'e1'), { broken: true }] } });
    expect(await importStoredTemplates(io, [made('甲', 'a')])).toEqual({ ok: false, why: 'partial' });
    expect(writes).toEqual([]);
  });

  it('バックアップが書けなければ、本体も書かない', async () => {
    const { io, store } = fakeIo({ [TEMPLATES_FILE]: fileOf(made('今の', 'e1')) }, { failWrite: TEMPLATES_BACKUP });
    expect(await importStoredTemplates(io, [made('甲', 'a')])).toEqual({ ok: false, why: 'backup' });
    expect(idsOf(store.get(TEMPLATES_FILE))).toEqual(['e1']);
  });

  it('本体が書けなければ失敗を返す', async () => {
    const { io } = fakeIo({}, { failWrite: TEMPLATES_FILE });
    expect(await importStoredTemplates(io, [made('甲', 'a')])).toEqual({ ok: false, why: 'write' });
  });

  it('200 件に 1 件も入らなければ断り、何も書かない。一部だけ入るなら入る分を書く', async () => {
    const full = Array.from({ length: TEMPLATE_LIMITS.templates }, (_, i) => made(`既存${i}`, `e${i}`));
    const a = fakeIo({ [TEMPLATES_FILE]: fileOf(...full) });
    expect(await importStoredTemplates(a.io, [made('甲', 'a')])).toEqual({ ok: false, why: 'full' });
    expect(a.writes).toEqual([]);
    const b = fakeIo({ [TEMPLATES_FILE]: fileOf(...full.slice(0, TEMPLATE_LIMITS.templates - 1)) });
    const res = await importStoredTemplates(b.io, [made('甲', 'a'), made('乙', 'b')], { newId: nextId });
    expect(res.ok && res.summary).toEqual({ added: 1, nameChanged: 0, idChanged: 0, dropped: 1 });
    expect(res.ok && res.count).toBe(TEMPLATE_LIMITS.templates);
  });

  it('壊れたファイルを読み込もうとしても、保存済みの型は変わらない（検査で断られ、書き込みまで進まない）', async () => {
    const original = fileOf(made('今の', 'e1'));
    const { store, writes } = fakeIo({ [TEMPLATES_FILE]: original });
    for (const text of ['{ broken', JSON.stringify({ format: 'x' }), JSON.stringify({ format: TEMPLATE_FORMAT, version: 3, templates: [] })]) {
      expect(parseImportText(text).ok).toBe(false);
    }
    expect(writes).toEqual([]);
    expect(store.get(TEMPLATES_FILE)).toEqual(original);
  });
});

function idsOf(v: unknown): string[] {
  return (v as { templates: CardTemplate[] }).templates.map((t) => t.id);
}
