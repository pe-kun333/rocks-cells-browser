// 段 D0：定型の純粋関数の、今の挙動を固める（ui/src は変えない）
import { describe, expect, it } from 'vitest';
import {
  addDefaultPresetSet,
  DEFAULT_PRESETS,
  type BotPresets,
  fillPreset,
  mergePresetEdit,
  normalizePresets,
  PRESET_HAND_MAX,
  PRESET_TEXT_MAX,
  presetHoles,
  presetOpenEntry,
  presetSetIndex,
  presetTemplate,
} from '../src/bot-presets';

const NOW = Date.parse('2026-10-25T03:04:05.000Z');
const STAMP = '2026-10-25T03:04:05.000Z';

describe('normalizePresets', () => {
  it('形が違う入力は null', () => {
    for (const raw of [null, undefined, 0, 'x', [], { sets: [] }, { presets: [] }, { sets: null, presets: [] }]) {
      expect(normalizePresets(raw, NOW)).toBeNull();
    }
  });

  it('知らない entry の組は落ち、定型の from.entry だけが知らないときはその項目だけ落ちる', () => {
    const out = normalizePresets(
      {
        sets: [
          { id: 'bad', name: '知らない', entry: 'later', hand: [] },
          { id: 'page', name: '読みもの', entry: 'page', hand: ['p1'] },
        ],
        presets: [
          {
            id: 'p1',
            text: '要点',
            from: { requestId: 'hb-20260101-0001-abcd', entry: 'nope' },
          },
          { id: 'p2', text: '残す', from: { entry: 'memo' } },
        ],
      },
      NOW,
    );
    expect(out?.sets.map((s) => s.id)).toEqual(['page']);
    expect(out?.presets.find((p) => p.id === 'p1')?.from).toEqual({ requestId: 'hb-20260101-0001-abcd' });
    expect(out?.presets.find((p) => p.id === 'p2')?.from).toEqual({ entry: 'memo' });
  });

  it('同じ id は先のものだけ、手元は在る定型の先頭 6 つまで、空の組名は入口の名前', () => {
    const presets = Array.from({ length: 8 }, (_, i) => ({ id: `h${i + 1}`, text: `文${i + 1}`, shelf: 'hand' }));
    const out = normalizePresets(
      {
        sets: [
          { id: 'page', name: '', entry: 'page', hand: [...presets.map((p) => p.id), 'h1', 1] },
          { id: 'page', name: '後の組', entry: 'nest', hand: ['h1'] },
        ],
        presets: [...presets, { id: 'h1', text: '後の文' }],
      },
      NOW,
    );
    expect(out?.sets).toEqual([{ id: 'page', name: 'ページ', entry: 'page', hand: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] }]);
    expect(out?.presets.find((p) => p.id === 'h1')?.text).toBe('文1');
    expect(out?.presets.filter((p) => p.shelf === 'hand').map((p) => p.id)).toEqual(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
    expect(out?.presets.find((p) => p.id === 'h7')?.shelf).toBe('shelf');
  });

  it('手元にある定型は hand にそろえ、どの手元にも無い hand は棚へ戻す。棚だけの数は棚にいるときだけ残る', () => {
    const out = normalizePresets(
      {
        sets: [{ id: 'page', name: '読みもの', entry: 'page', hand: ['in'] }],
        presets: [
          { id: 'in', text: '手元', shelf: 'vault', shelfUses: 3, swapAsked: true, lastSet: 'missing' },
          { id: 'out', text: '棚へ', shelf: 'hand', shelfUses: 2, swapAsked: true, lastSet: 'page' },
          { id: 'kept', text: '棚のまま', shelf: 'shelf', shelfUses: 2, swapAsked: true, lastSet: 'page' },
        ],
      },
      NOW,
    );
    const byId = (id: string) => out?.presets.find((p) => p.id === id);
    expect(byId('in')).toMatchObject({ shelf: 'hand' });
    expect(byId('in')).not.toHaveProperty('shelfUses');
    expect(byId('in')).not.toHaveProperty('swapAsked');
    expect(byId('in')).not.toHaveProperty('lastSet');
    // 手元の印なのにどの組の手元にも無いものは棚へ戻る。棚へ着いたので、棚の回数は消さない
    expect(byId('out')).toMatchObject({ shelf: 'shelf', lastSet: 'page', shelfUses: 2, swapAsked: true });
    expect(byId('kept')).toMatchObject({ shelf: 'shelf', shelfUses: 2, swapAsked: true, lastSet: 'page' });
  });

  it('文は 1 行・200 字まで。見えない文字は空白にまとめ、空の文は落とす。回数は正の整数だけ、上限で頭を切る', () => {
    const out = normalizePresets(
      {
        sets: [],
        presets: [
          { id: 'long', text: `あ\u0000\n\t${'い'.repeat(250)}` },
          { id: 'empty', text: ' \n\t ' },
          { id: 'bad id', text: '残さない' },
          { id: 'nums', text: '数', uses: 1_000_000_001, hits: 1.5, misses: 0, wrongTo: -3, life: 'week', shelf: 'else' },
        ],
      },
      NOW,
    );
    expect(out?.presets.map((p) => p.id)).toEqual(['long', 'nums']);
    expect(out?.presets[0].text).toBe(`あ ${'い'.repeat(198)}`);
    expect([...out!.presets[0].text]).toHaveLength(200);
    expect(out?.presets[1]).toMatchObject({ uses: 1_000_000_000, hits: 0, misses: 0, wrongTo: 0, life: 'forever', shelf: 'shelf' });
    expect(out?.presets[0].createdAt).toBe(STAMP);
  });

  it('組は 12、定型は 300 で打ち切る。棚卸しの覚えは形の合うものだけ', () => {
    const presets = Array.from({ length: 301 }, (_, i) => ({ id: `n${i + 1}`, text: '文' }));
    const sets = Array.from({ length: 13 }, (_, i) => ({ id: `s${i + 1}`, name: 'あ'.repeat(21), entry: 'page', hand: [] }));
    const out = normalizePresets(
      {
        sets,
        presets,
        review: { at: '2026-10-01T00:00:00Z', over30: true, apart: ['a|b', 'bad', 'p1|p2', 'p1|p2', 1] },
      },
      NOW,
    );
    expect(out?.sets).toHaveLength(12);
    expect(out?.sets[0].name).toBe('あ'.repeat(20));
    expect(out?.presets.map((p) => p.id)).toEqual(presets.slice(0, 300).map((p) => p.id));
    expect(out?.review).toEqual({ at: '2026-10-01T00:00:00.000Z', over30: true, apart: ['a|b', 'p1|p2'] });
  });

  it('棚卸しの中身が空なら review を付けない', () => {
    const out = normalizePresets({ sets: [], presets: [{ id: 'p1', text: '文' }], review: { apart: ['bad'] } }, NOW);
    expect(out).not.toHaveProperty('review');
  });
});

describe('presetSetIndex', () => {
  const sets = [
    { id: 'shot', name: 'スクショ', entry: 'shot' as const, hand: [] },
    { id: 'page', name: '読みもの', entry: 'page' as const, hand: [] },
    { id: 'nest', name: '調べもの', entry: 'nest' as const, hand: [] },
  ];

  it('同じ入口の組があればそれを返す', () => {
    expect(presetSetIndex(sets, 'shot')).toBe(0);
    expect(presetSetIndex(sets, 'page')).toBe(1);
    expect(presetSetIndex([{ id: 'memo', name: 'メモ', entry: 'memo', hand: [] }, ...sets], 'memo')).toBe(0);
    expect(presetSetIndex([...sets, { id: 'follow', name: '続き', entry: 'follow', hand: [] }], 'follow')).toBe(3);
  });

  it('メモのセルはページの組、続けて聞くは巣の組へ落ちる', () => {
    expect(presetSetIndex(sets, 'memo')).toBe(1);
    expect(presetSetIndex(sets, 'follow')).toBe(2);
  });

  it('落とし先の組も無ければ先頭、組が無ければ -1', () => {
    expect(presetSetIndex([{ id: 'nest', name: '調べもの', entry: 'nest', hand: [] }], 'memo')).toBe(0);
    expect(presetSetIndex([{ id: 'page', name: '読みもの', entry: 'page', hand: [] }], 'follow')).toBe(0);
    expect(presetSetIndex(sets.filter((s) => s.entry !== 'shot'), 'shot')).toBe(0);
    expect(presetSetIndex([], 'page')).toBe(-1);
    expect(presetSetIndex([], 'memo')).toBe(-1);
  });

  it('用意した定型は、メモが読みもの、続きは続きの組', () => {
    expect(DEFAULT_PRESETS.version).toBe(1);
    expect(DEFAULT_PRESETS.sets.map((s) => [s.entry, s.name, s.hand.length])).toEqual([
      ['page', '読みもの', 6],
      ['nest', '調べもの', 6],
      ['shot', 'スクショ', 6],
      ['follow', '続き', 6],
      ['cells', 'セル', 6],
      ['cards', 'カード', 6],
    ]);
    expect(presetSetIndex(DEFAULT_PRESETS.sets, 'memo')).toBe(0);
    expect(presetSetIndex(DEFAULT_PRESETS.sets, 'follow')).toBe(3);
    expect(DEFAULT_PRESETS.presets.find((p) => p.id === 'p1')?.text).toBe('要点を 5 行に');
    expect(DEFAULT_PRESETS.presets.find((p) => p.id === 'n1')?.text).toBe('評判を日本語の掲示板で');
    expect(DEFAULT_PRESETS.presets.find((p) => p.id === 's1')?.text).toBe('これは何');
    expect(DEFAULT_PRESETS.presets.find((p) => p.id === 'f1')?.text).toBe('{前の返事の要点} の二つ目をもっと詳しく');
    expect(DEFAULT_PRESETS.presets.find((p) => p.id === 'o1')?.text).toBe('{題名} について、{選んだ文} の部分だけ出典を確かめて');
  });

  it('セルは読みものの組、カードは調べものの組へ落ちる。組があればそれを返す', () => {
    expect(presetSetIndex(sets, 'cells')).toBe(1);
    expect(presetSetIndex(sets, 'cards')).toBe(2);
    const withNew = [
      ...sets,
      { id: 'cells', name: 'セル', entry: 'cells' as const, hand: [] },
      { id: 'cards', name: 'カード', entry: 'cards' as const, hand: [] },
    ];
    expect(presetSetIndex(withNew, 'cells')).toBe(3);
    expect(presetSetIndex(withNew, 'cards')).toBe(4);
    expect(presetSetIndex([{ id: 'nest', name: '調べもの', entry: 'nest', hand: [] }], 'cells')).toBe(0);
    expect(presetSetIndex([{ id: 'page', name: '読みもの', entry: 'page', hand: [] }], 'cards')).toBe(0);
  });

  it('用意したセルとカードは、手元 6・id は重ならない・文は 200 字・穴は今の 3 つだけ', () => {
    expect(DEFAULT_PRESETS.version).toBe(1);
    expect(DEFAULT_PRESETS.sets.map((s) => [s.entry, s.name, s.hand.length])).toEqual([
      ['page', '読みもの', 6],
      ['nest', '調べもの', 6],
      ['shot', 'スクショ', 6],
      ['follow', '続き', 6],
      ['cells', 'セル', 6],
      ['cards', 'カード', 6],
    ]);
    const ids = DEFAULT_PRESETS.presets.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const holes = new Set(['選んだ文', '題名', '前の返事の要点']);
    for (const entry of ['cells', 'cards'] as const) {
      const set = DEFAULT_PRESETS.sets.find((s) => s.entry === entry);
      expect(set?.hand).toHaveLength(PRESET_HAND_MAX);
      for (const id of set?.hand ?? []) {
        const text = DEFAULT_PRESETS.presets.find((p) => p.id === id)?.text ?? '';
        expect(text.length).toBeGreaterThan(0);
        expect([...text]).toHaveLength(text.length);
        expect([...text].length).toBeLessThanOrEqual(PRESET_TEXT_MAX);
        expect(text).not.toContain('\n');
        expect(presetHoles(text).every((hole) => holes.has(hole))).toBe(true);
      }
    }
    expect(presetSetIndex(DEFAULT_PRESETS.sets, 'cells')).toBe(4);
    expect(presetSetIndex(DEFAULT_PRESETS.sets, 'cards')).toBe(5);
    expect(presetSetIndex(DEFAULT_PRESETS.sets.filter((s) => s.entry !== 'cells'), 'cells')).toBe(0);
    expect(presetSetIndex(DEFAULT_PRESETS.sets.filter((s) => s.entry !== 'cards'), 'cards')).toBe(1);
  });
});

describe('normalizePresets の新しい入口', () => {
  it('cells と cards は残し、知らない entry の組は落とす', () => {
    const out = normalizePresets(
      {
        sets: [
          { id: 'cells', name: 'セル', entry: 'cells', hand: ['ce1'] },
          { id: 'cards', name: 'カード', entry: 'cards', hand: ['cd1'] },
          { id: 'bad', name: '知らない', entry: 'later', hand: ['ce1'] },
        ],
        presets: [
          { id: 'ce1', text: '比べる', from: { entry: 'cells' } },
          { id: 'cd1', text: '弱い主張', from: { entry: 'cards' } },
        ],
      },
      NOW,
    );
    expect(out?.sets.map((s) => s.entry)).toEqual(['cells', 'cards']);
    expect(out?.presets.find((p) => p.id === 'ce1')?.from).toEqual({ entry: 'cells' });
    expect(out?.presets.find((p) => p.id === 'cd1')?.from).toEqual({ entry: 'cards' });
  });
});

describe('組を足す', () => {
  const old = (): BotPresets => ({
    sets: [
      { id: 'page', name: '読みもの', entry: 'page', hand: ['p1'] },
      { id: 'nest', name: '調べもの', entry: 'nest', hand: ['n1'] },
    ],
    presets: [
      { id: 'p1', text: '残すページ', createdAt: STAMP, uses: 3, hits: 1, misses: 0, wrongTo: 0, life: 'forever', shelf: 'hand' },
      { id: 'n1', text: '残す巣', createdAt: STAMP, uses: 2, hits: 0, misses: 0, wrongTo: 0, life: 'forever', shelf: 'hand' },
    ],
  });

  it('無い組と手元 6 つだけ足し、今ある定型は消さない。もうあれば何もしない', () => {
    const before = old();
    const cells = addDefaultPresetSet(before, 'cells', NOW);
    expect(cells?.sets.map((s) => s.id)).toEqual(['page', 'nest', 'cells']);
    expect(cells?.sets[2]).toMatchObject({ name: 'セル', entry: 'cells' });
    expect(cells?.sets[2]?.hand).toHaveLength(6);
    expect(cells?.presets.slice(0, 2)).toEqual(before.presets);
    expect(before.sets).toHaveLength(2);
    expect(cells?.presets.slice(2).map((p) => p.id)).toEqual(cells?.sets[2]?.hand);
    expect(cells?.presets[2]?.createdAt).toBe(STAMP);
    expect(addDefaultPresetSet(cells!, 'cells', NOW)).toBeNull();
    const cards = addDefaultPresetSet(before, 'cards', NOW);
    expect(cards?.sets.map((s) => s.entry)).toEqual(['page', 'nest', 'cards']);
    expect(cards?.presets.slice(0, 2)).toEqual(before.presets);
    expect(addDefaultPresetSet(before, 'page', NOW)).toBeNull();
  });
});

describe('小窓へ渡す入口', () => {
  it('セルとカードはそのまま。六角スクショは shot。知らない続きはページ', () => {
    expect(presetOpenEntry('cells', false)).toBe('cells');
    expect(presetOpenEntry('cards', false)).toBe('cards');
    expect(presetOpenEntry('nest', false)).toBe('nest');
    expect(presetOpenEntry('memo', false)).toBe('memo');
    expect(presetOpenEntry('cells', true)).toBe('shot');
    expect(presetOpenEntry('follow', false)).toBe('page');
    expect(presetOpenEntry(undefined, false)).toBe('page');
  });
});

describe('fillPreset', () => {
  it('埋まらない穴を含む一文は消え、全部消えたら null', () => {
    expect(fillPreset('これは残る。{選んだ文} は穴。次も残る。', {})).toBe('これは残る。次も残る。');
    expect(fillPreset('{選んだ文}だけ', {})).toBeNull();
    expect(fillPreset('{選んだ文}と{題名}。', { selection: '本文' })).toBeNull();
    expect(fillPreset('   ', {})).toBeNull();
    expect(fillPreset('', { selection: '本文' })).toBeNull();
  });

  it('埋まった一文だけ残り、選んだ文は 24 字、題名は 40 字まで「」で囲む。要点は囲まず 200 字', () => {
    expect(fillPreset('{選んだ文} を見て。{題名} は題。', { selection: '本文です' })).toBe('「本文です」 を見て。');
    expect(fillPreset('{選んだ文}', { selection: 'あ'.repeat(25) })).toBe(`「${'あ'.repeat(24)}…」`);
    expect(fillPreset('{選んだ文}', { selection: 'あ'.repeat(24) })).toBe(`「${'あ'.repeat(24)}」`);
    expect(fillPreset('{題名}', { title: 'あ'.repeat(41) })).toBe(`「${'あ'.repeat(40)}…」`);
    expect(fillPreset('{題名}', { title: 'あ'.repeat(40) })).toBe(`「${'あ'.repeat(40)}」`);
    expect(fillPreset('{前の返事の要点} を続けて', { summary: '#0010 の要点' })).toBe('#0010 の要点 を続けて');
    expect(fillPreset('{前の返事の要点}', { summary: `a\u0000b${'う'.repeat(250)}` })).toBe(`a b${'う'.repeat(197)}`);
    expect(fillPreset('{選んだ文}', { selection: ' \n ' })).toBeNull();
  });

  it('知らない括弧はそのまま。文の区切りは 。！？ と半角の !?', () => {
    expect(fillPreset('{foo}は穴ではない。', {})).toBe('{foo}は穴ではない。');
    expect(fillPreset('Keep this! {選んだ文} drops?', {})).toBe('Keep this!');
  });
});

describe('presetTemplate', () => {
  it('URL と題名は {題名}、見本のかぎ括弧と 8 字以上の選んだ文は {選んだ文}。同じ穴が続いたら 1 つ', () => {
    expect(
      presetTemplate('見て https://ex.com/a?q=1#h 題名そのもの と 「大事なところ…」 選んだ全文ですよ', {
        title: '題名そのもの',
        selection: '選んだ全文ですよ',
      }),
    ).toBe('見て {題名} と {選んだ文}');
    expect(presetTemplate('題名そのもの題名そのもの', { title: '題名そのもの' })).toBe('{題名}');
    expect(presetTemplate('https://ex.com/a 題名そのもの', { title: '題名そのもの' })).toBe('{題名}');
  });

  it('題名が 1 字、選んだ文が 7 字のときは、文中のそのままの置換はしない。かぎ括弧は別の条件', () => {
    expect(presetTemplate('題を見る', { title: '題' })).toBe('題を見る');
    expect(presetTemplate('「abcd」とabcdefg', { selection: 'abcdefg' })).toBe('{選んだ文}とabcdefg');
    expect(presetTemplate('「題名」は題名そのもの', { title: '題名そのもの' })).toBe('{題名}は{題名}');
    expect(presetTemplate('「関係ない」', { title: '題名', selection: '選んだ全文ですよ' })).toBe('「関係ない」');
    expect(presetTemplate('「…」', { selection: '選んだ全文ですよ' })).toBe('「…」');
  });

  it('200 字で切る。ftp の URL は穴にしない', () => {
    expect(presetTemplate('あ'.repeat(250))).toBe('あ'.repeat(200));
    expect(presetTemplate('ftp://ex.com/a を見る')).toBe('ftp://ex.com/a を見る');
  });
});

describe('mergePresetEdit', () => {
  const current: BotPresets = {
    sets: [{ id: 'page', name: '読みもの', entry: 'page', hand: ['p1'] }],
    presets: [
      {
        id: 'p1',
        text: '要点を 5 行に',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastUsedAt: '2026-02-01T00:00:00.000Z',
        uses: 4,
        hits: 2,
        misses: 1,
        wrongTo: 3,
        life: 'forever',
        shelf: 'hand',
        keptAt: '2026-01-15T00:00:00.000Z',
        from: { requestId: 'hb-20260101-0001-abcd', entry: 'page' },
        lastSet: 'page',
        shelfUses: 9,
        swapAsked: true,
      },
    ],
  };

  const rawOf = (presets: Record<string, unknown>[], sets = [{ id: 'page', name: '読みもの', entry: 'page', hand: ['p1'] }]) => ({ sets, presets });

  it('形が違う編集は null', () => {
    expect(mergePresetEdit(current, null, NOW)).toBeNull();
    expect(mergePresetEdit(current, { presets: [] }, NOW)).toBeNull();
  });

  it('使った回数・印・作った時刻・拾った元・最後に使った時刻は、右の数字を使わず左のまま', () => {
    const out = mergePresetEdit(
      current,
      rawOf([
        {
          id: 'p1',
          text: '要点を 5 行に',
          uses: 999,
          hits: 999,
          misses: 999,
          wrongTo: 999,
          createdAt: STAMP,
          lastUsedAt: STAMP,
          life: 'forever',
          shelf: 'hand',
          from: { entry: 'shot' },
        },
      ]),
      NOW,
    );
    expect(out?.presets[0]).toMatchObject({
      text: '要点を 5 行に',
      uses: 4,
      hits: 2,
      misses: 1,
      wrongTo: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastUsedAt: '2026-02-01T00:00:00.000Z',
      keptAt: '2026-01-15T00:00:00.000Z',
      from: { requestId: 'hb-20260101-0001-abcd', entry: 'page' },
      shelf: 'hand',
    });
    expect(out?.presets[0]).not.toHaveProperty('shelfUses');
    expect(out?.presets[0]).not.toHaveProperty('swapAsked');
  });

  it('文を変えたら keptAt を今にし、回数は左のまま。新しい id の数字は 0', () => {
    const out = mergePresetEdit(
      current,
      rawOf([
        { id: 'p1', text: '別の文', uses: 999, life: 'forever', shelf: 'hand' },
        { id: 'p2', text: '新しい', uses: 9, hits: 9, life: 'today', shelf: 'hand', createdAt: '2020-01-01T00:00:00.000Z' },
      ], [{ id: 'page', name: '読みもの', entry: 'page', hand: ['p1', 'p2'] }]),
      NOW,
    );
    expect(out?.presets.find((p) => p.id === 'p1')).toMatchObject({ text: '別の文', uses: 4, hits: 2, keptAt: STAMP });
    expect(out?.presets.find((p) => p.id === 'p2')).toMatchObject({
      text: '新しい',
      uses: 0,
      hits: 0,
      misses: 0,
      wrongTo: 0,
      life: 'today',
      shelf: 'hand',
      createdAt: STAMP,
      keptAt: STAMP,
    });
  });

  it('clean で直した文を使い、空になった定型は落とす', () => {
    const out = mergePresetEdit(current, rawOf([{ id: 'p1', text: '要点を 5 行に', life: 'forever', shelf: 'hand' }]), NOW, (t) => t.replace('要点', '〔鍵1〕'));
    expect(out?.presets[0]).toMatchObject({ text: '〔鍵1〕を 5 行に', uses: 4, keptAt: STAMP });
    const dropped = mergePresetEdit(current, rawOf([{ id: 'p1', text: '要点', life: 'forever', shelf: 'hand' }]), NOW, () => '  ');
    expect(dropped?.presets).toEqual([]);
  });

  it('組が全部落ちて手元から外れると棚へ戻り、棚に来た回数は数え直す', () => {
    const out = mergePresetEdit(
      current,
      rawOf([{ id: 'p1', text: '要点を 5 行に', life: 'forever', shelf: 'hand', shelfUses: 3, swapAsked: true }], [{ id: 'bad', name: 'x', entry: 'later', hand: ['p1'] }]),
      NOW,
    );
    expect(out?.sets).toEqual([]);
    expect(out?.presets[0]).toMatchObject({ shelf: 'shelf', uses: 4, keptAt: STAMP });
    expect(out?.presets[0]).not.toHaveProperty('shelfUses');
    expect(out?.presets[0]).not.toHaveProperty('swapAsked');
  });

  it('答えた印は、右が省いても棚に残るあいだは残る', () => {
    const shelf: BotPresets = {
      sets: [{ id: 'page', name: '読みもの', entry: 'page', hand: [] }],
      presets: [{ ...current.presets[0], shelf: 'shelf' }],
    };
    const out = mergePresetEdit(shelf, rawOf([{ id: 'p1', text: '要点を 5 行に', life: 'forever', shelf: 'shelf' }], [{ id: 'page', name: '読みもの', entry: 'page', hand: [] }]), NOW);
    expect(out?.presets[0]).toMatchObject({ shelf: 'shelf', swapAsked: true, uses: 4, keptAt: '2026-01-15T00:00:00.000Z' });
  });
});
