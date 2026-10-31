// Phase 5b：Grok Bot への依頼文の見本（samples/grok-cardtpl-request-sample.ja.md）が約束する返答の形を、アプリの読み込みの検査で確かめる
//   ・型の下書きは parseImportText を通る（読み込む… と同じ検査）。穴埋めの fill ファイルの読み込みは 5d の領分なので、ここでは値の見本が fillTemplate で全部埋まることだけを見る
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseImportText, TEMPLATE_FORMAT } from '../src/memo-card-template-io';
import { extractHoles, fillTemplate, TEMPLATE_FOLDERS, TEMPLATE_LIMITS } from '../src/memo-card-templates';
import { isMachineTag } from '../src/grok-cards-tags';
import { LINK_KINDS } from '../src/memo-card-links';

const read = (name: string) => readFileSync(new URL(`../../samples/${name}`, import.meta.url), 'utf8');
const RESPONSE = 'grok-cardtpl-response-sample.json';

describe('見本の返答 samples/grok-cardtpl-response-sample.json', () => {
  const parsed = parseImportText(read(RESPONSE));

  it('「読み込む…」の検査を通り、3 件とも読め、飛ばされる型がない', () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.total).toBe(3);
    expect(parsed.skipped).toEqual([]);
    expect(parsed.templates.map((t) => t.name)).toEqual(['読書会の準備', '意見の整理（6種の線）', '会議メモ']);
    expect(parsed.templates.map((t) => t.mode)).toEqual(['hole', 'skeleton', 'snapshot']);
  });

  it('依頼文の上限・決まりの範囲に収まっている（件数・枚数・名前・文の長さ・フォルダ・機械タグ・升目）', () => {
    if (!parsed.ok) throw new Error('読めません');
    expect(parsed.templates.length).toBeLessThanOrEqual(5);
    for (const t of parsed.templates) {
      expect(t.cards.length).toBeGreaterThanOrEqual(2);
      expect(t.cards.length).toBeLessThanOrEqual(TEMPLATE_LIMITS.cards);
      expect([...t.name].length).toBeLessThanOrEqual(TEMPLATE_LIMITS.name);
      expect(TEMPLATE_FOLDERS).toContain(t.folder);
      for (const c of t.cards) {
        expect([...`${c.title}\n${c.body}`].length).toBeLessThanOrEqual(TEMPLATE_LIMITS.text);
        expect(c.tags.some(isMachineTag)).toBe(false);
        expect(c.dx % 240).toBe(0);
        expect(c.dy % 150).toBe(0);
      }
    }
  });

  it('6 つの線の種類が全部使われ、1 件も捨てられていない（読む前と読んだあとの線の数が同じ）', () => {
    if (!parsed.ok) throw new Error('読めません');
    const raw = JSON.parse(read(RESPONSE)) as { templates: { links: { kind: string }[] }[] };
    const rawLinks = raw.templates.reduce((n, t) => n + t.links.length, 0);
    const links = parsed.templates.flatMap((t) => t.links);
    expect(links).toHaveLength(rawLinks);
    for (const info of LINK_KINDS) expect(links.some((l) => l.kind === info.kind)).toBe(true);
  });

  it('穴あきの型は空欄が取れ、骨組みの型は本文が空', () => {
    if (!parsed.ok) throw new Error('読めません');
    const [hole, skeleton] = parsed.templates;
    expect(extractHoles(hole)).toEqual(['書名', '著者', '要点', '問い', '進め方']);
    expect(skeleton.cards.every((c) => c.body === '')).toBe(true);
  });

  it('id は何でもよく、重なれば付け直される前提：ファイルの id は読み込みで保たれる（重なったときだけ mergeImported が直す）', () => {
    if (!parsed.ok) throw new Error('読めません');
    expect(parsed.templates.map((t) => t.id)).toEqual(['grok-reading-club', 'grok-opinion-map', 'grok-meeting-note']);
  });

  it('format は honeycomb-cardtpl（依頼文が約束する名前）', () => {
    expect((JSON.parse(read(RESPONSE)) as { format: string }).format).toBe(TEMPLATE_FORMAT);
  });
});

describe('依頼文の「JSON だけ」の約束を守らない返事は、何も変えずに断られる', () => {
  const body = read(RESPONSE);
  it('コードの囲みで包んだ返事は JSON ではないとして断る', () => {
    expect(parseImportText('```json\n' + body + '\n```')).toEqual({ ok: false, why: 'json' });
  });
  it('前に説明の文が付いた返事も断る', () => {
    expect(parseImportText('はい、作りました。\n' + body)).toEqual({ ok: false, why: 'json' });
  });
  it('穴埋め用（honeycomb-cardtpl-fill）のファイルは、型のファイルとしては断る', () => {
    expect(parseImportText(read('grok-cardtpl-fill-sample.json'))).toEqual({ ok: false, why: 'format' });
  });
});

describe('見本の穴埋め samples/grok-cardtpl-fill-sample.json', () => {
  const fill = JSON.parse(read('grok-cardtpl-fill-sample.json')) as { format: string; version: number; template: { id: string; name: string }; values: Record<string, string> };

  it('形の約束どおり（format・version・template・values）', () => {
    expect(fill.format).toBe('honeycomb-cardtpl-fill');
    expect(fill.version).toBe(1);
    expect(typeof fill.template.id).toBe('string');
    expect(typeof fill.template.name).toBe('string');
  });

  it('値の名前が、見本の穴あきの型の空欄と一致し、fillTemplate で全部埋まる', () => {
    const parsed = parseImportText(read(RESPONSE));
    if (!parsed.ok) throw new Error('読めません');
    const target = parsed.templates.find((t) => t.id === fill.template.id && t.name === fill.template.name);
    expect(target).toBeDefined();
    if (!target) return;
    expect(Object.keys(fill.values).sort()).toEqual(extractHoles(target).sort());
    const r = fillTemplate(target, fill.values);
    expect(r.filled).toBe(extractHoles(target).length);
    expect(r.empty).toBe(0);
    expect(r.truncated).toBe(0);
    expect(r.template.cards.some((c) => /\{\{/.test(`${c.title}${c.body}`))).toBe(false);
  });
});