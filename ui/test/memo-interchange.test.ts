// 取り込み（hcb-memo-interchange v1）の純粋な関数のテスト（設計 §13）
import { describe, expect, it, vi } from 'vitest';
// memocells.ts は data.ts → bridge.ts（location・window を使う）を読み込むので、bridge だけ偽物にする（parseMemo との突き合わせ用）
vi.mock('../src/bridge', () => ({ surface: 'left', send: () => {}, onMessage: () => {}, request: async () => ({}) }));
import { MAX_MEMO_TEXT, newMemoId, parseMemo } from '../src/memocells';
import { newIslandId } from '../src/islands';
import { newSheetId } from '../src/sheets';
import { normalizeIslandName } from '../src/session';
import { newReplyId } from '../src/threads';
import {
  attributeAuthor,
  buildIdMap,
  clampTime,
  CONTINUED,
  detectJsonKind,
  idMapCollides,
  islandName,
  IMPORT_WHO,
  IX_LIMITS,
  MEMO_OVERFLOW,
  normalizeRanks,
  parseInterchange,
  parseInterchangeText,
  placeMemos,
  planInterchange,
  problemText,
  shortHash,
  sourceName,
  splitLongText,
  splitMemoText,
  type InterchangeDoc,
  type IxProblem,
} from '../src/memo-interchange';
import { clone, counterIds, NOW, world } from './helpers';
import synthetic from './fixtures/interchange-synthetic.json';
import patchSample from '../../samples/grok-patch-sample.json';

const realIds = { sheet: newSheetId, island: newIslandId, memo: newMemoId, reply: newReplyId };

function parsed(raw: unknown): { doc: InterchangeDoc; problems: IxProblem[] } {
  const r = parseInterchange(raw);
  if (!r.ok) throw new Error(`parse failed: ${r.reason}`);
  return { doc: r.doc, problems: r.problems };
}
const problem = (list: IxProblem[], code: IxProblem['code']) => list.find((p) => p.code === code)?.count ?? 0;

describe('detectJsonKind', () => {
  it('取り込み・提案・それ以外', () => {
    expect(detectJsonKind(synthetic)).toBe('interchange');
    expect(detectJsonKind(patchSample)).toBe('patch');
    for (const v of [{}, [], null, 1, 'x', { format: 'other' }]) expect(detectJsonKind(v)).toBe('unknown');
  });
});

describe('parseInterchange', () => {
  it('全体を断る（§4.1）', () => {
    expect(parseInterchangeText('{')).toEqual({ ok: false, reason: 'notJson' });
    expect(parseInterchange({ format: 'x', version: 1, memos: [{}] })).toEqual({ ok: false, reason: 'badFormat' });
    expect(parseInterchange({ format: 'hcb-memo-interchange', version: 2, memos: [{}] })).toEqual({ ok: false, reason: 'badVersion', version: 2 });
    expect(parseInterchange({ format: 'hcb-memo-interchange', version: 1 })).toEqual({ ok: false, reason: 'noMemos' });
    expect(parseInterchange({ format: 'hcb-memo-interchange', version: 1, memos: [] })).toEqual({ ok: false, reason: 'noMemos' });
    expect(parseInterchange({ format: 'hcb-memo-interchange', version: 1, memos: [1, 'x'] })).toEqual({ ok: false, reason: 'noMemos' });
  });
  it('合成の見本：知らない項目・受けない項目・重なった id・崩れたものを数える', () => {
    const { doc, problems } = parsed(synthetic);
    expect(doc.memos).toHaveLength(6); // 42 は崩れたメモ
    expect(doc.memos.map((m) => m.key)).toEqual(['m1', 'm2', '#2', 'm4', 'm5', 'm6']);
    expect(doc.memos[0].cards.map((c) => c.key)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', '#0.5', 'c6', 'c7', 'c8']);
    expect(doc.islands.map((i) => i.key)).toEqual(['isA', 'isB']);
    expect(doc.botName).toBe('Grok Bot');
    expect(doc.top).toHaveProperty('x_grokBot');
    expect(doc.top).toHaveProperty('x_custom');
    expect(doc.topUnknown).toEqual({ mystery: '知らない最上位の項目' });
    expect(problem(problems, 'dupMemoId')).toBe(1);
    expect(problem(problems, 'dupCardId')).toBe(1);
    expect(problem(problems, 'dupIslandId')).toBe(1);
    expect(problem(problems, 'badMemo')).toBe(1);
    expect(problem(problems, 'badCard')).toBe(1);
    expect(problem(problems, 'badIsland')).toBe(1);
    expect(problem(problems, 'badBoardLink')).toBe(1);
    expect(problem(problems, 'unknownKey')).toBe(3); // mystery・mysteryMemo・unknownCardKey
    expect(problem(problems, 'droppedField')).toBe(3); // m5 の portal・image、c8 の image
    expect(problem(problems, 'otherSheet')).toBe(1);
    expect(doc.memos[4].dropped).toEqual({ portal: 'shxx', image: 'shot1' });
    expect(doc.memos[0].keep).toEqual({ x_memoMeta: { k: 'v' } });
    expect(doc.dropped.map((d) => d.where)).toEqual(['islands[2]', 'islands[3]', 'memos[0].replies[9]', 'memos[6]', 'boardLinks[8]']);
    for (const p of problems) expect(problemText(p)).toMatch(/\d/);
  });
});

describe('buildIdMap', () => {
  it('全部新しい id で重ならない（同じ値しか返さない作り手でも・手元の id とも）', () => {
    const { doc } = parsed(synthetic);
    const same = { sheet: () => 'shX', island: () => 'iX', memo: () => 'mX', reply: () => 'rX' };
    const taken = new Set(['shX', 'mX', 'rX']);
    const map = buildIdMap(doc, same, taken);
    const all = [map.sheet.to, ...map.islands.values(), ...map.memos.values(), ...[...map.cards.values()].flatMap((m) => [...m.values()])];
    expect(new Set(all).size).toBe(all.length);
    for (const id of all) expect(taken.has(id)).toBe(false);
    expect(idMapCollides(map, taken)).toBe(false);
    expect(idMapCollides(map, new Set([map.sheet.to]))).toBe(true);
    expect(map.sheet.from).toBe('shsynth01');
  });
  it('本物の作り手：69 枚を同じミリ秒で作っても重ならない', () => {
    const { doc } = parsed(clone(sampleRaw()));
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const map = buildIdMap(doc, realIds);
    vi.useRealTimers();
    const cards = [...map.cards.values()].flatMap((m) => [...m.values()]);
    expect(cards).toHaveLength(69);
    expect(new Set(cards).size).toBe(69);
    expect(map.sheet.to).toMatch(/^sh[0-9a-z]+$/);
  });
});

describe('小さな関数', () => {
  it('clampTime', () => {
    expect(clampTime(NOW - 1000, NOW)).toEqual({ value: NOW - 1000, fixed: false });
    expect(clampTime(Number.NaN, NOW)).toEqual({ value: NOW, fixed: true });
    expect(clampTime(0, NOW)).toEqual({ value: NOW, fixed: true }); // 1970 年
    expect(clampTime(NOW + 2 * 86400000, NOW)).toEqual({ value: NOW, fixed: true });
    expect(clampTime(undefined, NOW, 5)).toEqual({ value: 5, fixed: false });
  });
  it('attributeAuthor（D1）', () => {
    const src = sourceName('Grok Bot');
    expect(src).toBe('Grok Botの下書き');
    expect(sourceName()).toBe('取り込み');
    expect([...sourceName('あ'.repeat(30))].length).toBe(IX_LIMITS.byName);
    expect(attributeAuthor({ who: 'bot', name: 'Grok Bot' }, src)).toEqual({ by: { who: 'bot', name: 'Grok Bot' }, label: '意見', replaced: false });
    expect(attributeAuthor(undefined, src)).toEqual({ by: { who: IMPORT_WHO, name: src }, label: '取り込み', replaced: false });
    const main = attributeAuthor({ who: 'main', name: '相棒' }, src);
    expect(main.by.who).toBe(IMPORT_WHO);
    expect(main.original).toEqual({ who: 'main', name: '相棒' });
    expect(main.replaced).toBe(true);
    expect(attributeAuthor(null, src).by.who).toBe(IMPORT_WHO);
    expect(attributeAuthor({ who: 'user', name: '私' }, src).by.who).toBe(IMPORT_WHO);
    const bot = attributeAuthor({ who: 'bot', name: 'x'.repeat(40), model: 'm' }, src, 'ラベルがとても長いラベル');
    expect(bot.by).toEqual({ who: 'bot', name: 'x'.repeat(20) });
    expect(bot.original).toEqual({ who: 'bot', name: 'x'.repeat(40), model: 'm' });
    expect([...bot.label].length).toBe(10);
  });
  it('splitLongText（D2：2,000 字は変えず「（続き）」に分ける）', () => {
    expect(splitLongText('a'.repeat(2000))).toEqual(['a'.repeat(2000)]);
    const parts = splitLongText('a'.repeat(2001));
    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveLength(2000);
    expect(parts[1]).toBe(`${CONTINUED}\na`);
    const many = splitLongText('😀'.repeat(6000));
    for (const p of many) expect([...p].length).toBeLessThanOrEqual(2000);
    expect(many.map((p) => p.replace(`${CONTINUED}\n`, '')).join('')).toBe('😀'.repeat(6000)); // 捨てない・割らない
  });
  it('splitMemoText（5,001 字 → 本文＋本文の続き）', () => {
    expect(splitMemoText('a'.repeat(5000)).overflow).toBeNull();
    const s = splitMemoText('a'.repeat(5001));
    expect(s.text).toHaveLength(5000);
    expect(s.overflow).toBe(`${MEMO_OVERFLOW}\na`);
  });
  it('normalizeRanks', () => {
    // [5, 5, undefined, -1] → 0..3 で順が安定（同じ rank はファイルの順。rank の無いものは後ろ）
    const items = [5, 5, undefined, -1, 0.5, 'x'].map((rank) => ({ rank }));
    const r = normalizeRanks(items, (v) => v.rank);
    expect(items.map((i) => r.get(i))).toEqual([2, 3, 4, 0, 1, 5]);
  });
  it('placeMemos', () => {
    const p = placeMemos([
      { key: 'a', pos: { q: 0, r: 0 }, island: 'x' },
      { key: 'b', pos: { q: 0, r: 0 }, island: 'x' },
      { key: 'c', pos: undefined, island: 'x' },
      { key: 'd', pos: { q: 1.4, r: 2.6 }, island: null },
      { key: 'e', pos: { q: 1001, r: 0 }, island: null },
    ]);
    expect(p.pos.get('a')).toEqual({ q: 0, r: 0 });
    expect(p.pos.get('b')).not.toEqual({ q: 0, r: 0 });
    expect(p.pos.get('d')).toEqual({ q: 1, r: 3 });
    expect(p.moved).toBe(1);
    expect(p.auto).toBe(2);
    const keys = [...p.pos.values()].map((h) => `${h.q},${h.r}`);
    expect(new Set(keys).size).toBe(5);
  });
  it('shortHash', () => {
    expect(shortHash('abc')).toBe(shortHash('abc'));
    expect(shortHash('abc')).not.toBe(shortHash('abd'));
    expect(shortHash('')).toMatch(/^[0-9a-f]{8}$/);
  });
  it('台帳の上限・直し方と同じ', () => {
    expect(IX_LIMITS.memoText).toBe(MAX_MEMO_TEXT);
    for (const name of ['  島   A ', '', '#タグ', 'あ'.repeat(30), '   ']) expect(islandName(name)).toBe(normalizeIslandName(name));
  });
});

// 実の形の見本（レビューのメモとコメント。中身は作りもの）
import sample from './fixtures/sample-review-notes.json';
function sampleRaw(): unknown {
  return sample;
}

// ---------- 計画（§13.3 の planInterchange） ----------

const allLinksInside = (cells: ReturnType<typeof planInterchange>['cells']) => {
  for (const cell of cells) {
    const tops = new Set((cell.replies ?? []).filter((r) => r.parent === null).map((r) => r.id));
    const ids = new Set((cell.replies ?? []).map((r) => r.id));
    for (const r of cell.replies ?? []) {
      if (r.parent !== null) expect(ids.has(r.parent)).toBe(true);
      for (const l of r.links ?? []) expect(tops.has(l.to)).toBe(true);
    }
  }
};

describe('実の形の見本（sample-review-notes.json）を通しで', () => {
  const { doc, problems } = parsed(clone(sampleRaw()));
  const w = world({ ids: realIds });
  const plan = planInterchange(doc, w, {}, undefined, problems);
  const raw = sample as unknown as { memos: { id: string; replies?: { id: string; links?: { to: string }[] }[] }[]; boardLinks: { from: string; to: string }[]; islands: { id: string }[] };

  it('形の検査で気づくことが無い', () => {
    expect(problems).toEqual([]);
    expect(plan.problems).toEqual([]);
    expect(plan.blocked).toBeNull();
  });
  it('数：メモ 11・カード 69（Grok Bot 8・取り込み 61）・カードの関連 40・盤面の線 13・島 4', () => {
    expect(plan.totals).toEqual({ memos: 11, cards: 69, botCards: 8, importCards: 61, cardLinks: 40, boardLinks: 13, islands: 4 });
    expect(plan.cells).toHaveLength(11);
    expect(plan.islands.filter((i) => i.create)).toHaveLength(4);
    expect(plan.boardLinks.filter((l) => l.selected)).toHaveLength(13);
  });
  it('全部新しい id につなぎ直され、相手のいない関連・線が無い', () => {
    const oldIds = new Set<string>([...raw.memos.map((m) => m.id), ...raw.memos.flatMap((m) => (m.replies ?? []).map((r) => r.id)), ...raw.islands.map((i) => i.id)]);
    const memoIds = new Set(plan.cells.map((c) => c.id));
    const islandIds = new Set(plan.islands.map((i) => i.id));
    expect(plan.sheet.id).not.toBe('shmvbx7my6s0a1');
    for (const cell of plan.cells) {
      expect(oldIds.has(cell.id)).toBe(false);
      expect(cell.sheet).toBe(plan.sheet.id);
      expect(cell.island === null || islandIds.has(cell.island)).toBe(true);
      expect(cell.island).not.toBeNull(); // 見本は全部のメモが島に入っている
      for (const r of cell.replies ?? []) {
        expect(oldIds.has(r.id)).toBe(false);
        for (const l of r.links ?? []) expect(oldIds.has(l.to)).toBe(false);
      }
    }
    allLinksInside(plan.cells);
    for (const l of plan.boardLinks) {
      expect(memoIds.has(l.from.slice(2))).toBe(true);
      expect(memoIds.has(l.to.slice(2))).toBe(true);
    }
    // 元の線と同じ組がつながっている（付け替え表で引き直して比べる）
    const back = new Map([...plan.map.memos].map(([k, v]) => [v, k]));
    const pairs = plan.boardLinks.map((l) => `${back.get(l.from.slice(2))}>${back.get(l.to.slice(2))}`).sort();
    expect(pairs).toEqual(raw.boardLinks.map((l) => `${l.from.slice(2)}>${l.to.slice(2)}`).sort());
  });
  it('by の無いものは取り込みの印（Grok Botの下書き）、by.who=bot は残る', () => {
    let imports = 0;
    let bots = 0;
    for (const cell of plan.cells) {
      expect(cell.by).toBeDefined();
      if (cell.by?.who === 'bot') expect(cell.label).toBe('意見');
      else {
        expect(cell.by).toEqual({ who: 'import', name: 'Grok Botの下書き' });
        expect(cell.label).toBe('取り込み');
      }
      for (const r of cell.replies ?? []) {
        expect(r.by).toBeDefined();
        if (r.by?.who === 'bot') bots++;
        else {
          expect(r.by).toEqual({ who: 'import', name: 'Grok Botの下書き' });
          imports++;
        }
      }
    }
    expect([bots, imports]).toEqual([8, 61]);
    expect(plan.cells.filter((c) => c.by?.who === 'bot')).toHaveLength(1);
  });
  it('位置・並び・時刻はファイルのまま', () => {
    raw.memos.forEach((m, i) => {
      const cell = plan.cells[i];
      const src = m as unknown as { pos: { q: number; r: number }; createdAt: number; updatedAt: number; replies?: { createdAt: number; rank?: number }[] };
      expect(cell.pos).toEqual(src.pos);
      expect(cell.createdAt).toBe(src.createdAt);
      expect(cell.updatedAt).toBe(src.updatedAt);
      expect((cell.replies ?? []).map((r) => r.rank)).toEqual((src.replies ?? []).map((r) => r.rank));
      expect((cell.replies ?? []).map((r) => r.createdAt)).toEqual((src.replies ?? []).map((r) => r.createdAt));
    });
  });
  it('x_* は extra に（x_grokBot・x_layout 69・x_opinion 8 の targets も新しい id に）', () => {
    const extra = plan.buildExtra('ixtest', 'inbox', NOW);
    expect(extra.top.x_grokBot).toEqual((sample as { x_grokBot: unknown }).x_grokBot);
    expect(extra.sheet.from).toEqual({ id: 'shmvbx7my6s0a1', createdAt: 1792212774126 });
    expect(extra.generatedAt).toBe((sample as { generatedAt: string }).generatedAt);
    const cards = Object.entries(extra.cards).flatMap(([memoId, byCard]) => Object.entries(byCard).map(([cardId, x]) => ({ memoId, cardId, x })));
    expect(cards.filter((c) => c.x.x_layout)).toHaveLength(69);
    const opinions = cards.filter((c) => c.x.x_opinion);
    expect(opinions).toHaveLength(8);
    for (const o of opinions) {
      const op = o.x.x_opinion as { targets: string[]; unmappedTargets?: unknown };
      const cell = plan.cells.find((c) => c.id === o.memoId);
      const ids = new Set((cell?.replies ?? []).map((r) => r.id));
      expect(op.unmappedTargets).toBeUndefined();
      for (const t of op.targets) expect(ids.has(t)).toBe(true);
      expect(ids.has(o.cardId)).toBe(true);
    }
    expect(Object.keys(extra.ids.memos)).toHaveLength(11);
    expect(extra.dropped).toEqual([]);
    expect(JSON.stringify(extra).length).toBeLessThan(1024 * 1024);
  });
  it('出てくるメモは全部 parseMemo を通り、通したあとも同じ（台帳が捨てる項目を持っていない）', () => {
    for (const cell of plan.cells) expect(parseMemo(clone(cell))).toEqual(cell);
  });
  it('一覧の行：島ごとの数・意見の印', () => {
    expect(plan.islands.map((i) => i.memoKeys.length)).toEqual([6, 2, 2, 1]);
    const opinions = plan.rows.flatMap((r) => r.opinions);
    expect(opinions).toHaveLength(8);
    expect(opinions).toContain('補足 0.85');
    expect(plan.portal).toEqual({ sheet: 'main', pos: { q: 4, r: 4 } });
  });
});

describe('合成の見本（全部の項目と崩れ方）を通しで', () => {
  const { doc, problems } = parsed(synthetic);
  const plan = planInterchange(doc, world(), {}, undefined, problems);
  const cell = (key: string) => plan.cells.find((c) => c.id === plan.map.memos.get(key)) as (typeof plan.cells)[number];
  const card = (memo: string, key: string) => cell(memo).replies?.find((r) => r.id === plan.map.cards.get(memo)?.get(key));

  it('シートの名前（空白をまとめ 20 字）と色', () => {
    expect(plan.sheet.name).toBe('合成の 見本シート（全部の項目）');
    expect(plan.sheet.color).toBe('#123abc');
  });
  it('島：名前を 20 字に・色が違えば空いた色・知らない島を指すメモは島なし', () => {
    expect(plan.islands.map((i) => [i.name.length <= 20, i.color])).toEqual([
      [true, '#60a5fa'],
      [true, '#00ba7c'],
    ]);
    expect(cell('m5').island).toBeNull();
    expect(problem(plan.problems, 'islandMissing')).toBe(1);
  });
  it('カード：親の無い返信は一番上へ・相手のいない／別のメモ／知らない種類の関連は落ちる・逆向きの「同じ」は新しい方が落ちる', () => {
    expect(card('m1', 'c5')?.parent).toBeNull();
    expect(card('m1', 'c4')?.parent).toBe(card('m1', 'c1')?.id);
    expect(card('m1', 'c4')?.tags).toBeUndefined(); // 返信のタグは台帳が読まない（extra へ）
    expect(card('m1', 'c1')?.links).toEqual([{ to: card('m1', 'c2')?.id, kind: 'ground' }]);
    expect(card('m1', 'c2')?.links).toEqual([{ to: card('m1', 'c3')?.id, kind: 'same' }]);
    expect(card('m1', 'c3')?.links).toBeUndefined();
    expect(problem(plan.problems, 'orphanCard')).toBe(1);
    expect(problem(plan.problems, 'danglingCardLink')).toBe(2); // nope と c2 の二本目
    expect(problem(plan.problems, 'crossMemoLink')).toBe(1);
    expect(problem(plan.problems, 'badLinkKind')).toBe(2); // weird・bogus
    expect(problem(plan.problems, 'sameBack')).toBe(1);
    allLinksInside(plan.cells);
  });
  it('長いカード・長いメモは分けて捨てない', () => {
    const c6 = card('m1', 'c6');
    expect(c6?.text).toHaveLength(2000);
    expect(c6?.rank).toBe(0); // rank -1 → 詰め直して先頭
    const more = cell('m1').replies?.filter((r) => r.parent === c6?.id) ?? [];
    expect(more).toHaveLength(1);
    expect(more[0].text.startsWith(CONTINUED)).toBe(true);
    const m5 = cell('m5');
    expect([...m5.text].length).toBe(5000);
    const head = m5.replies?.find((r) => r.rank === 0);
    expect(head?.text.startsWith(MEMO_OVERFLOW)).toBe(true);
    expect(problem(plan.problems, 'longCard')).toBe(1);
    expect(problem(plan.problems, 'longMemo')).toBe(1);
  });
  it('書き手：キャラのふりは import に・元の値は extra に。bot の model・cost も extra', () => {
    expect(card('m1', 'c7')?.by?.who).toBe('import');
    expect(card('m1', 'c3')?.by).toEqual({ who: 'bot', name: 'Grok Bot' });
    const extra = plan.buildExtra('ix1', 'file', NOW);
    const m1 = plan.map.memos.get('m1');
    expect(extra.by[`${m1}/${plan.map.cards.get('m1')?.get('c7')}`]).toEqual({ who: 'main', name: '相棒' });
    expect(extra.by[`${m1}/${plan.map.cards.get('m1')?.get('c3')}`]).toEqual({ who: 'bot', name: 'Grok Bot', model: 'grok-x', cost: 0.01 });
    expect(cell('m4').label).toBe('考察メモのラベル長い'); // ちょうど 10 字は切らない
    expect(problem(plan.problems, 'authorReplaced')).toBe(1);
  });
  it('位置：重なれば近くへ・無ければ島のそば・遠すぎれば自動・小数は丸め', () => {
    expect(cell('m1').pos).toEqual({ q: 0, r: 0 });
    expect(cell('m2').pos).not.toEqual({ q: 0, r: 0 });
    expect(cell('m5').pos).toEqual({ q: 3, r: -1 });
    const keys = plan.cells.map((c) => `${c.pos.q},${c.pos.r}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(problem(plan.problems, 'posMoved')).toBe(1);
    expect(problem(plan.problems, 'posAuto')).toBe(2);
  });
  it('時刻：範囲の外は今に・updatedAt < createdAt は直す', () => {
    expect(cell('m5').createdAt).toBe(NOW);
    expect(cell('m2').updatedAt).toBe(cell('m2').createdAt);
    expect(card('m1', 'c8')?.createdAt).toBe(NOW);
    expect(problem(plan.problems, 'timeFixed')).toBeGreaterThanOrEqual(2);
  });
  it('タグ：10 個に直して数える', () => {
    expect(cell('m5').tags).toHaveLength(10);
    expect(problem(plan.problems, 'tagsCut')).toBe(2);
  });
  it('盤面の線：先の m1 につなぐ・相手のいない／タブ／自分／重なり／知らない種類は落ちる', () => {
    expect(plan.boardLinks.map((l) => l.kind)).toEqual(['ground', 'ground', 'supplement']);
    expect(plan.boardLinks[0].fromKey).toBe('m1');
    expect(problem(plan.problems, 'danglingBoardLink')).toBe(1);
    expect(problem(plan.problems, 'tabBoardLink')).toBe(1);
    expect(problem(plan.problems, 'dupBoardLink')).toBe(2); // 自分への線・m1→m2 の同じ
  });
  it('extra：x_*・知らない項目・受けない項目・落としたものの原文', () => {
    const extra = plan.buildExtra('ix1', 'file', NOW);
    expect(extra.top).toMatchObject({ x_custom: { anything: [1, 2, 3] }, unknown: { mystery: '知らない最上位の項目' } });
    expect(extra.sheet.keep).toEqual({ x_sheetNote: '残す' });
    expect(extra.islands[plan.map.islands.get('isA') as string]).toEqual({ x_islandMeta: 1 });
    expect(extra.memos[plan.map.memos.get('m1') as string]).toMatchObject({ x_memoMeta: { k: 'v' }, from: 'm1' });
    expect(extra.memos[plan.map.memos.get('m5') as string]).toMatchObject({ unknown: { mysteryMemo: 1 }, dropped: { portal: 'shxx', image: 'shot1' } });
    const xc = extra.cards[plan.map.memos.get('m1') as string];
    expect(xc[plan.map.cards.get('m1')?.get('c8') as string]).toMatchObject({ x_cardMeta: true, unknown: { unknownCardKey: 1 }, dropped: { image: 'shotabc' } });
    expect(xc[plan.map.cards.get('m1')?.get('c4') as string]).toMatchObject({ onReply: { tags: ['返信のタグ'], rank: 1 } });
    const op = xc[plan.map.cards.get('m1')?.get('c3') as string].x_opinion as { targets: string[]; unmappedTargets: string[] };
    expect(op.targets).toEqual([plan.map.cards.get('m1')?.get('c1')]);
    expect(op.unmappedTargets).toEqual(['ghost']);
    const reasons = extra.dropped.map((d) => d.reason);
    for (const r of ['badMemo', 'badCard', 'badIsland', 'dupIslandId', 'danglingCardLink', 'crossMemoLink', 'badLinkKind', 'tabBoardLink', 'danglingBoardLink', 'dupBoardLink']) expect(reasons).toContain(r);
  });
  it('全部 parseMemo を通り、通したあとも同じ', () => {
    for (const c of plan.cells) expect(parseMemo(clone(c))).toEqual(c);
  });
});

describe('上限と選び方', () => {
  const { doc } = parsed(clone(sampleRaw()));
  it('メモ 1990 個ある世界に 11 個（＋入口）→ 押せない・あと 2 個', () => {
    const plan = planInterchange(doc, world({ counts: { sheets: 3, memos: 1990, islands: 2, boardLinks: 0 } }));
    expect(plan.overMemos).toBe(2);
    expect(plan.blocked).toMatch(/あと 2 個/);
    const noPortal = planInterchange(doc, world({ counts: { sheets: 3, memos: 1990, islands: 2, boardLinks: 0 } }), { portal: false });
    expect(noPortal.overMemos).toBe(1);
  });
  it('シート 100 枚 → 押せない', () => {
    expect(planInterchange(doc, world({ counts: { sheets: 100, memos: 0, islands: 0, boardLinks: 0 } })).blocked).toMatch(/シート/);
  });
  it('島 48 個の世界 → 後の 2 島は作らず、そのメモは島なし', () => {
    const plan = planInterchange(doc, world({ counts: { sheets: 3, memos: 0, islands: 48, boardLinks: 0 } }));
    expect(plan.islands.map((i) => i.create)).toEqual([true, true, false, false]);
    expect(problem(plan.problems, 'islandsOver')).toBe(2);
    expect(plan.cells.filter((c) => c.island === null)).toHaveLength(3);
  });
  it('選んだメモだけ。線は両端を選んだものだけ。島を作らない選び方', () => {
    const keys = doc.memos.map((m) => m.key);
    const choice = { memos: new Set(keys.slice(0, 6)), skipIslands: new Set([doc.islands[0].key]) };
    const plan = planInterchange(doc, world(), choice);
    expect(plan.cells).toHaveLength(6);
    expect(plan.cells.every((c) => c.island === null)).toBe(true);
    const chosen = new Set(keys.slice(0, 6));
    for (const l of plan.boardLinks) expect(l.selected).toBe(chosen.has(l.fromKey) && chosen.has(l.toKey));
    expect(plan.totals.boardLinks).toBe(plan.boardLinks.filter((l) => l.selected).length);
    expect(planInterchange(doc, world(), { memos: new Set() }).blocked).toMatch(/選んで/);
  });
  it('同じ付け替え表を渡せば id が変わらない。台帳と重なれば作り直す', () => {
    const first = planInterchange(doc, world());
    const again = planInterchange(doc, world(), {}, first.map);
    expect(again.cells.map((c) => c.id)).toEqual(first.cells.map((c) => c.id));
    const clash = planInterchange(doc, world({ taken: new Set([first.cells[0].id]), ids: counterIds('z') }), {}, first.map);
    expect(clash.cells[0].id).not.toBe(first.cells[0].id);
  });
  it('盤面の線の上限（500）', () => {
    const plan = planInterchange(doc, world({ counts: { sheets: 3, memos: 0, islands: 0, boardLinks: 495 } }));
    expect(plan.totals.boardLinks).toBe(5);
    expect(problem(plan.problems, 'boardLinksOver')).toBe(8);
  });
  it('1 メモ 300 枚を超えたら rank の後ろから落とす', () => {
    const raw = { format: 'hcb-memo-interchange', version: 1, memos: [{ id: 'a', replies: Array.from({ length: 299 }, (_, i) => ({ id: `c${i}`, text: i === 0 ? 'x'.repeat(4500) : `c${i}`, rank: i })) }] };
    const plan = planInterchange(parsed(raw).doc, world());
    expect(plan.cells[0].replies).toHaveLength(300);
    expect(problem(plan.problems, 'cardsOver')).toBe(1); // 4,500 字は 3 枚に分かれて 301 枚 → rank の一番後ろの 1 枚を落とす
    expect(plan.cells[0].replies?.some((r) => r.text === 'c298')).toBe(false);
    expect(parseMemo(clone(plan.cells[0]))).toEqual(plan.cells[0]);
  });
});

describe('samples/interchange-sample.json（試しのフォルダの見本）', () => {
  it('気づくこと無しで、メモ 2・カード 3・関連 1・線 1・島 1', async () => {
    const raw = (await import('../../samples/interchange-sample.json')).default;
    const { doc, problems } = parsed(clone(raw));
    const plan = planInterchange(doc, world(), {}, undefined, problems);
    expect(plan.problems).toEqual([]);
    expect(plan.totals).toEqual({ memos: 2, cards: 3, botCards: 1, importCards: 2, cardLinks: 1, boardLinks: 1, islands: 1 });
  });
});
