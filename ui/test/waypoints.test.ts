import { describe, expect, it } from 'vitest';

import { freeWaypointSlot, MAX_SHEETS, parseWaypoints, WAYPOINT_SLOTS, waypointChipsKey, waypointPlaceBlock, waypointSlotRows, WaypointStore } from '../src/waypoints';

const KEY = 'honeycomb.waypoints';

const memory = () => {
  const data = new Map<string, string>();
  let writes = 0;
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      writes++;
      data.set(k, v);
    },
    data,
    writes: () => writes,
  };
};

const stored = (m: ReturnType<typeof memory>) => JSON.parse(m.data.get(KEY) ?? 'null');

describe('parseWaypoints', () => {
  it('鍵が無い・壊れた値・古い版は空（locked でない）', () => {
    for (const raw of [null, undefined, 'x', 3, [], {}, { v: 0, sheets: { sha: { slots: [[1, 1]], at: 1 } } }, { v: 'x' }, { v: 1, sheets: [] }]) {
      expect(parseWaypoints(raw)).toEqual({ sheets: {}, locked: false });
    }
  });

  it('新しい版の値は読まずに locked', () => {
    expect(parseWaypoints({ v: 2, sheets: { sha: { slots: [[1, 1]], at: 1 } } })).toEqual({ sheets: {}, locked: true });
  });

  it('シートの id・マスの範囲・重なり・長さ・空の項・at を確かめる', () => {
    const s = parseWaypoints({
      v: 1,
      sheets: {
        'bad id': { slots: [[1, 1]], at: 1 },
        sha: { slots: [[1, 2], [1.5, 0], [100000, 0], [-99999, 3], [1, 2], 'x', [7, 7], [8, 8]], at: 5 },
        shb: { slots: [null, null, null, null, null, null], at: 9 },
        shc: { slots: [null, [0, 0]], at: -3 },
        shd: { slots: [[0, 0, 0]], at: 2 },
      },
    });
    expect(s.locked).toBe(false);
    expect(Object.keys(s.sheets).sort()).toEqual(['sha', 'shc']);
    expect(s.sheets.sha.slots).toEqual([{ q: 1, r: 2 }, null, null, { q: -99999, r: 3 }, null, null]);
    expect(s.sheets.sha.slots).toHaveLength(WAYPOINT_SLOTS);
    expect(s.sheets.sha.at).toBe(5);
    expect(s.sheets.shc.slots).toEqual([null, { q: 0, r: 0 }, null, null, null, null]);
    expect(s.sheets.shc.at).toBe(0);
  });

  it('200 を超えたら at の新しい順に 200 だけ残す', () => {
    const sheets: Record<string, unknown> = {};
    for (let i = 0; i < MAX_SHEETS + 5; i++) sheets[`sh${i}`] = { slots: [[i, 0]], at: i + 1 };
    const s = parseWaypoints({ v: 1, sheets });
    expect(Object.keys(s.sheets)).toHaveLength(MAX_SHEETS);
    for (let i = 0; i < 5; i++) expect(s.sheets[`sh${i}`]).toBeUndefined();
    expect(s.sheets[`sh${MAX_SHEETS + 4}`]).toBeDefined();
  });
});

describe('WaypointStore', () => {
  it('置くと一番小さい空き番号。6 つで null。同じマスは断る', () => {
    const w = new WaypointStore(memory());
    expect(w.place('sha', { q: 0, r: 0 }, 1)).toBe(0);
    expect(w.place('sha', { q: 1, r: 0 }, 2)).toBe(1);
    expect(w.place('sha', { q: 0, r: 0 }, 3)).toBeNull();
    expect(w.remove('sha', 0, 4)).toBe(true);
    expect(w.place('sha', { q: 2, r: 0 }, 5)).toBe(0);
    for (let i = 3; i < 7; i++) expect(w.place('sha', { q: i, r: 0 }, 6)).toBe(i - 1);
    expect(w.place('sha', { q: 9, r: 9 }, 7)).toBeNull();
    expect(w.list('sha').map((p) => p.slot)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(w.slotAt('sha', { q: 2, r: 0 })).toBe(0);
    expect(w.slotAt('sha', { q: 9, r: 9 })).toBe(-1);
    expect(w.slotAt('shz', { q: 0, r: 0 })).toBe(-1);
    expect(w.place('bad id', { q: 0, r: 0 }, 1)).toBeNull();
    expect(w.place('shb', { q: 0.5, r: 0 }, 1)).toBeNull();
    expect(w.place('shb', { q: 100000, r: 0 }, 1)).toBeNull();
    // 別のシートなら同じマスに置ける
    expect(w.place('shb', { q: 0, r: 0 }, 1)).toBe(0);
  });

  it('動かす（空の番号・ほかのポータルのマス・自分の同じマスは断る）', () => {
    const w = new WaypointStore(memory());
    w.place('sha', { q: 0, r: 0 }, 1);
    w.place('sha', { q: 1, r: 0 }, 1);
    expect(w.moveTo('sha', 0, { q: 5, r: 5 }, 2)).toBe(true);
    expect(w.hexes('sha')).toEqual([{ q: 5, r: 5 }, { q: 1, r: 0 }]);
    expect(w.moveTo('sha', 0, { q: 1, r: 0 }, 3)).toBe(false);
    expect(w.moveTo('sha', 0, { q: 5, r: 5 }, 3)).toBe(false);
    expect(w.moveTo('sha', 3, { q: 7, r: 7 }, 3)).toBe(false);
    expect(w.moveTo('sha', 0, { q: 1e6, r: 0 }, 3)).toBe(false);
  });

  it('番号を替える（入れ替え・空へ動かす・同じ番号や範囲の外は null）', () => {
    const w = new WaypointStore(memory());
    w.place('sha', { q: 0, r: 0 }, 1);
    w.place('sha', { q: 1, r: 0 }, 1);
    expect(w.setSlot('sha', 0, 1, 2)).toBe('swapped');
    expect(w.list('sha')).toEqual([
      { slot: 0, hex: { q: 1, r: 0 } },
      { slot: 1, hex: { q: 0, r: 0 } },
    ]);
    expect(w.setSlot('sha', 1, 4, 3)).toBe('moved');
    expect(w.list('sha').map((p) => p.slot)).toEqual([0, 4]);
    expect(w.setSlot('sha', 0, 0, 4)).toBeNull();
    expect(w.setSlot('sha', 2, 3, 4)).toBeNull();
    expect(w.setSlot('sha', 0, 6, 4)).toBeNull();
    expect(w.setSlot('sha', -1, 0, 4)).toBeNull();
  });

  it('外す。6 つとも外すと項が消える。作り直しても残る', () => {
    const m = memory();
    const w = new WaypointStore(m);
    w.place('sha', { q: 0, r: 0 }, 10);
    w.place('shb', { q: 3, r: -2 }, 20);
    expect(stored(m)).toEqual({ v: 1, sheets: { sha: { slots: [[0, 0], null, null, null, null, null], at: 10 }, shb: { slots: [[3, -2], null, null, null, null, null], at: 20 } } });
    expect(w.remove('sha', 1, 30)).toBe(false);
    expect(w.remove('sha', 0, 30)).toBe(true);
    expect(stored(m).sheets.sha).toBeUndefined();
    const again = new WaypointStore(m);
    expect(again.all()).toEqual([{ sheet: 'shb', slot: 0, hex: { q: 3, r: -2 } }]);
  });

  it('dropSheet：persist false はメモリだけ。ほかの変更でも書かず、flush で書く', () => {
    const m = memory();
    const w = new WaypointStore(m);
    w.place('sha', { q: 0, r: 0 }, 1);
    w.place('shb', { q: 0, r: 0 }, 2);
    expect(w.dropSheet('sha', false)).toBe(true);
    expect(w.list('sha')).toEqual([]);
    expect(stored(m).sheets.sha).toBeDefined();
    w.place('shb', { q: 1, r: 0 }, 3);
    expect(stored(m).sheets.sha).toBeDefined();
    // 読み直しても、まだ書いていない外しは保つ
    w.reload();
    expect(w.list('sha')).toEqual([]);
    w.flush();
    expect(stored(m).sheets.sha).toBeUndefined();
    expect(stored(m).sheets.shb).toBeDefined();
    expect(w.dropSheet('sha')).toBe(false);
    expect(w.dropSheet('shb')).toBe(true);
    expect(stored(m).sheets).toEqual({});
  });

  it('新しい版の値があると、変える口は全部断り、置き場を書かない', () => {
    const m = memory();
    const raw = JSON.stringify({ v: 2, sheets: { sha: { slots: [[0, 0]], at: 1 } } });
    m.data.set(KEY, raw);
    const w = new WaypointStore(m);
    expect(w.locked).toBe(true);
    expect(w.all()).toEqual([]);
    expect(w.place('sha', { q: 1, r: 1 }, 1)).toBeNull();
    expect(w.moveTo('sha', 0, { q: 1, r: 1 }, 1)).toBe(false);
    expect(w.setSlot('sha', 0, 1, 1)).toBeNull();
    expect(w.remove('sha', 0, 1)).toBe(false);
    expect(w.dropSheet('sha')).toBe(false);
    expect(w.dropSheet('sha', false)).toBe(false);
    w.flush();
    expect(m.writes()).toBe(0);
    expect(m.data.get(KEY)).toBe(raw);
  });

  it('書く前に新しい版を見つけたら、書かずに locked になる', () => {
    const m = memory();
    const w = new WaypointStore(m);
    w.place('sha', { q: 0, r: 0 }, 1);
    const raw = JSON.stringify({ v: 3 });
    m.data.set(KEY, raw);
    expect(w.place('sha', { q: 1, r: 0 }, 2)).toBeNull();
    expect(w.locked).toBe(true);
    expect(m.data.get(KEY)).toBe(raw);
  });

  it('ほかの窓が別のシートを書いていても消さない', () => {
    const m = memory();
    const a = new WaypointStore(m);
    const b = new WaypointStore(m);
    a.place('sha', { q: 0, r: 0 }, 1);
    b.place('shb', { q: 1, r: 1 }, 2);
    a.place('sha', { q: 2, r: 2 }, 3);
    expect(Object.keys(stored(m).sheets).sort()).toEqual(['sha', 'shb']);
    expect(new WaypointStore(m).hexes('sha')).toEqual([{ q: 0, r: 0 }, { q: 2, r: 2 }]);
  });

  it('reload で読み直して onChange が呼ばれる（変わらなければ呼ばない）', () => {
    const m = memory();
    const a = new WaypointStore(m);
    const b = new WaypointStore(m);
    let calls = 0;
    b.onChange(() => calls++);
    a.place('sha', { q: 4, r: 4 }, 1);
    expect(b.list('sha')).toEqual([]);
    b.reload();
    expect(calls).toBe(1);
    expect(b.hexes('sha')).toEqual([{ q: 4, r: 4 }]);
    b.reload();
    expect(calls).toBe(1);
  });

  it('onChange：置く・動かす・番号を替える・外す・dropSheet で呼ばれ、断ったときは呼ばれない', () => {
    const w = new WaypointStore(memory());
    let calls = 0;
    w.onChange(() => calls++);
    w.place('sha', { q: 0, r: 0 }, 1);
    w.moveTo('sha', 0, { q: 1, r: 0 }, 2);
    w.setSlot('sha', 0, 2, 3);
    w.place('sha', { q: 5, r: 0 }, 4);
    w.remove('sha', 0, 5);
    w.dropSheet('sha');
    expect(calls).toBe(6);
    w.remove('sha', 0, 6);
    w.place('bad id', { q: 0, r: 0 }, 6);
    expect(calls).toBe(6);
  });

  it('200 を超えたら、盤面に無いシートの項から at の古い順に落とす（今書くシートは落とさない）', () => {
    const m = memory();
    const w = new WaypointStore(m);
    for (let i = 0; i < MAX_SHEETS; i++) w.place(`sh${i}`, { q: 0, r: 0 }, 100 + i);
    // sh150 と sh160 は盤面に無い。sh0 は一番古いが盤面にある
    w.setExists((id) => id !== 'sh150' && id !== 'sh160');
    w.place('shnew', { q: 0, r: 0 }, 1000);
    let s = stored(m).sheets;
    expect(Object.keys(s)).toHaveLength(MAX_SHEETS);
    expect(s.sh150).toBeUndefined();
    expect(s.sh160).toBeDefined();
    expect(s.sh0).toBeDefined();
    w.place('shnew2', { q: 0, r: 0 }, 1001);
    w.place('shnew3', { q: 0, r: 0 }, 1002);
    s = stored(m).sheets;
    expect(Object.keys(s)).toHaveLength(MAX_SHEETS);
    expect(s.sh160).toBeUndefined();
    expect(s.sh0).toBeUndefined();
    expect(s.sh1).toBeDefined();
    expect(s.shnew3).toBeDefined();
    expect(w.list('sh0')).toEqual([]);
  });

  it('200 のとき、今書くシートは盤面に無く一番古くても落とさない', () => {
    const m = memory();
    const w = new WaypointStore(m);
    for (let i = 0; i < MAX_SHEETS; i++) w.place(`sh${i}`, { q: 0, r: 0 }, 100 + i);
    w.setExists((id) => id !== 'shnew');
    w.place('shnew', { q: 0, r: 0 }, 1);
    const s = stored(m).sheets;
    expect(Object.keys(s)).toHaveLength(MAX_SHEETS);
    expect(s.shnew).toBeDefined();
    expect(s.sh0).toBeUndefined();
  });

  it('200 のとき、まだ書いていない外しがあっても、メモリと置き場のシートが同じ', () => {
    for (const gone of [[], ['sh5', 'sh150']]) {
      const m = memory();
      const w = new WaypointStore(m);
      for (let i = 0; i < MAX_SHEETS; i++) w.place(`sh${i}`, { q: 0, r: 0 }, 100 + i);
      w.setExists((id) => !gone.includes(id));
      const drop = gone.length ? 'sh150' : 'sh199';
      expect(w.dropSheet(drop, false)).toBe(true);
      w.place('shnew', { q: 0, r: 0 }, 1000);
      const ids = (x: { sheet: string }[]) => [...new Set(x.map((p) => p.sheet))].sort();
      expect(Object.keys(stored(m).sheets).sort()).toEqual(ids(w.all()));
      expect(w.list(drop)).toEqual([]);
      expect(w.list('sh0')).toHaveLength(1);
      expect(w.list('sh5')).toHaveLength(1);
      let calls = 0;
      w.onChange(() => calls++);
      w.reload();
      w.flush();
      expect(calls).toBe(0);
      expect(Object.keys(stored(m).sheets)).toHaveLength(MAX_SHEETS);
      expect(stored(m).sheets[drop]).toBeUndefined();
    }
  });

  it('locked のあいだも、まだ書いていない外しは保つ', () => {
    const m = memory();
    const w = new WaypointStore(m);
    w.place('sha', { q: 0, r: 0 }, 1);
    const v1 = m.data.get(KEY)!;
    w.dropSheet('sha', false);
    m.data.set(KEY, JSON.stringify({ v: 2 }));
    w.reload();
    expect(w.locked).toBe(true);
    m.data.set(KEY, v1);
    w.reload();
    expect(w.locked).toBe(false);
    expect(w.list('sha')).toEqual([]);
    w.flush();
    expect(stored(m).sheets.sha).toBeUndefined();
  });

  it('locked が変わると onChange が呼ばれる', () => {
    const m = memory();
    const w = new WaypointStore(m);
    let calls = 0;
    w.onChange(() => calls++);
    m.data.set(KEY, JSON.stringify({ v: 2 }));
    w.reload();
    expect(w.locked).toBe(true);
    expect(calls).toBe(1);
    m.data.delete(KEY);
    w.reload();
    expect(w.locked).toBe(false);
    expect(calls).toBe(2);
    m.data.set(KEY, JSON.stringify({ v: 2 }));
    expect(w.place('sha', { q: 0, r: 0 }, 1)).toBeNull();
    expect(w.locked).toBe(true);
    expect(calls).toBe(3);
  });

  it('置き場が直れば、reload を呼ばなくても変える口で戻る', () => {
    const m = memory();
    const w = new WaypointStore(m);
    w.place('sha', { q: 0, r: 0 }, 1);
    const v1 = m.data.get(KEY)!;
    m.data.set(KEY, JSON.stringify({ v: 2 }));
    expect(w.place('sha', { q: 1, r: 0 }, 2)).toBeNull();
    expect(w.locked).toBe(true);
    m.data.set(KEY, v1);
    expect(w.place('sha', { q: 1, r: 0 }, 3)).toBe(1);
    expect(w.locked).toBe(false);
    expect(new WaypointStore(m).hexes('sha')).toEqual([{ q: 0, r: 0 }, { q: 1, r: 0 }]);
    m.data.set(KEY, JSON.stringify({ v: 2 }));
    w.reload();
    m.data.set(KEY, v1);
    expect(w.remove('sha', 0, 4)).toBe(true);
    expect(w.locked).toBe(false);
    m.data.set(KEY, JSON.stringify({ v: 2 }));
    w.reload();
    m.data.set(KEY, v1);
    expect(w.dropSheet('sha')).toBe(true);
    expect(stored(m).sheets).toEqual({});
  });

  it('置き場が null・書けなくても、メモリの中では動く', () => {
    const w = new WaypointStore(null);
    expect(w.place('sha', { q: 0, r: 0 }, 1)).toBe(0);
    expect(w.hexes('sha')).toEqual([{ q: 0, r: 0 }]);
    const broken = {
      getItem: () => null,
      setItem: () => {
        throw new Error('full');
      },
    };
    const b = new WaypointStore(broken);
    expect(b.place('sha', { q: 0, r: 0 }, 1)).toBe(0);
    expect(b.place('sha', { q: 1, r: 0 }, 2)).toBe(1);
    expect(b.hexes('sha')).toEqual([{ q: 0, r: 0 }, { q: 1, r: 0 }]);
  });
});

describe('waypointPlaceBlock', () => {
  it('locked・loading・taken・full の順に見る', () => {
    expect(waypointPlaceBlock({ ready: false, taken: true, locked: true, full: true })).toBe('locked');
    expect(waypointPlaceBlock({ ready: false, taken: true, locked: false, full: true })).toBe('loading');
    expect(waypointPlaceBlock({ ready: true, taken: true, locked: false, full: true })).toBe('taken');
    expect(waypointPlaceBlock({ ready: true, taken: false, locked: false, full: true })).toBe('full');
    expect(waypointPlaceBlock({ ready: true, taken: false, locked: false, full: false })).toBeNull();
  });
});

describe('waypointChipsKey', () => {
  it('シートと番号の並びが同じなら同じ字', () => {
    expect(waypointChipsKey('sha', [0, 2])).toBe(waypointChipsKey('sha', [0, 2]));
    expect(waypointChipsKey('sha', [0, 2])).not.toBe(waypointChipsKey('sha', [2, 0]));
    expect(waypointChipsKey('sha', [0, 2])).not.toBe(waypointChipsKey('shb', [0, 2]));
    expect(waypointChipsKey('sha', [1, 2])).not.toBe(waypointChipsKey('sha', [12]));
  });
});

describe('WaypointStore の読む口', () => {
  it('オブジェクトに元からある名前を渡しても、空として答える', () => {
    const w = new WaypointStore(memory());
    expect(w.list('constructor')).toEqual([]);
    expect(w.hexes('toString')).toEqual([]);
    expect(w.slotAt('__proto__', { q: 0, r: 0 })).toBe(-1);
  });
});

describe('freeWaypointSlot', () => {
  it('空いている一番小さい番号。全部埋まっていれば -1', () => {
    expect(freeWaypointSlot([])).toBe(0);
    expect(freeWaypointSlot([0, 1, 3])).toBe(2);
    expect(freeWaypointSlot([5, 0])).toBe(1);
    expect(freeWaypointSlot([0, 1, 2, 3, 4, 5])).toBe(-1);
  });
});

describe('waypointSlotRows', () => {
  it('1〜6 番の順に、今の番号・使っている番号・空いた番号を分ける', () => {
    const rows = waypointSlotRows(1, [1, 3]);
    expect(rows.map((r) => r.slot)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(rows.map((r) => r.state)).toEqual(['free', 'current', 'free', 'used', 'free', 'free']);
  });
});
