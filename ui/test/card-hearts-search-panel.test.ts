// 右の検索の［カードの ♥］（MK9。計画 docs/plan-comment-board-marks.md §4.9）：SearchPanel を偽物の DOM の上で動かす試験
//   memo-board-callouts.test.ts と同じ形の小さな偽物（要素・イベント・文書・localStorage）。時計は vitest の偽物（window は globalThis）
//   確かめること：切り替えで並べ方と対象のボタンが押せなくなり、切ると戻る／段を替えると頭から探し直す／たたむと切って ♥ の結果を捨てる／
//   ［まとめてコピー］は出している結果の字と段で頼む（打ちかけの字の待ち・左の返事の待ちの間も）／状態の行の頭（一言にも）と見出しの件数
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// right-search.ts は captures・vault・vocab（bridge と data）を読む（試験では偽物。card-hearts-search.test.ts と同じ）
vi.mock('../src/bridge', () => ({ surface: 'right', send: () => {}, onMessage: () => {}, request: async () => null }));
vi.mock('../src/data', () => ({
  readData: async () => null,
  readDataChecked: async () => ({ status: 'missing' }),
  writeData: async () => true,
  deleteData: () => {},
  listData: async () => [],
}));

import type { LikeLevel } from '../src/likes';
import { SearchPanel, type SearchPanelDeps } from '../src/panels/search-panel';
import type { SearchItem, SearchSort } from '../src/search';

type Handler = (e: FakeEvent) => void;

class FakeEvent {
  prevented = false;
  isComposing = false;
  keyCode = 0;
  constructor(
    readonly type: string,
    readonly key = '',
  ) {}
  preventDefault() {
    this.prevented = true;
  }
}

class FakeText {
  parent: FakeEl | null = null;
  constructor(readonly textContent: string) {}
}

class FakeEl {
  parent: FakeEl | null = null;
  kids: (FakeEl | FakeText)[] = [];
  hidden = false;
  disabled = false;
  className = '';
  textContent = '';
  title = '';
  type = '';
  value = '';
  scrollTop = 0;
  readonly dataset: Record<string, string> = {};
  private readonly attrs = new Map<string, string>();
  private readonly handlers: { type: string; fn: Handler }[] = [];
  readonly classList = {
    toggle: (name: string, on: boolean) => {
      const rest = this.classes().filter((c) => c !== name);
      this.className = (on ? [...rest, name] : rest).join(' ');
    },
    contains: (name: string) => this.classes().includes(name),
  };
  constructor(readonly tag: string) {}
  classes() {
    return this.className.split(' ').filter((c) => c !== '');
  }
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  addEventListener(type: string, fn: Handler) {
    this.handlers.push({ type, fn });
  }
  fire(type: string, key = '') {
    const e = new FakeEvent(type, key);
    for (const h of [...this.handlers]) if (h.type === type) h.fn(e);
    return e;
  }
  // 字の子も受ける（題の枠の append(item.title) など）
  append(...nodes: (FakeEl | FakeText | string)[]) {
    for (const raw of nodes) {
      const n = typeof raw === 'string' ? new FakeText(raw) : raw;
      if (n instanceof FakeEl) n.remove();
      n.parent = this;
      this.kids.push(n);
    }
  }
  replaceChildren(...nodes: (FakeEl | FakeText | string)[]) {
    for (const k of this.kids) k.parent = null;
    this.kids = [];
    this.append(...nodes);
  }
  remove() {
    const p = this.parent;
    if (p) p.kids = p.kids.filter((k) => k !== this);
    this.parent = null;
  }
  contains(node: unknown): boolean {
    for (let n = node instanceof FakeEl ? node : null; n; n = n.parent) if (n === this) return true;
    return false;
  }
  focus() {
    doc.activeElement = this;
  }
  querySelector(): FakeEl | null {
    return null;
  }
  // 中の字（行の題・抜き出し）
  get text(): string {
    return this.textContent + this.kids.map((k) => (k instanceof FakeEl ? k.text : k.textContent)).join('');
  }
}

class FakeDoc {
  readonly body = new FakeEl('body');
  activeElement: FakeEl | null = this.body;
  createElement(tag: string) {
    return new FakeEl(tag);
  }
  createTextNode(text: string) {
    return new FakeText(text);
  }
}

let doc: FakeDoc;

interface Ask {
  seq: number;
  query: string;
  sort: SearchSort;
  limit: number;
  hearts: LikeLevel | null;
}
let asks: Ask[];
let copies: [string, LikeLevel][];
let known: boolean;
let panel: SearchPanel;

const HEAD = 'カードの ♥（新しい順）';
const root = () => panel.element as unknown as FakeEl;
const all = (cls: string, from: FakeEl = root()): FakeEl[] => {
  const out: FakeEl[] = [];
  const walk = (n: FakeEl) => {
    for (const k of n.kids) {
      if (!(k instanceof FakeEl)) continue;
      if (k.classes().includes(cls)) out.push(k);
      walk(k);
    }
  };
  walk(from);
  return out;
};
const one = (cls: string): FakeEl => {
  const found = all(cls);
  if (found.length !== 1) throw new Error(`${cls} が ${found.length} 個`);
  return found[0];
};
const byText = (cls: string, text: string): FakeEl => {
  const found = all(cls).find((b) => b.textContent === text);
  if (!found) throw new Error(`見つかりません：${cls} ${text}`);
  return found;
};
const click = (node: FakeEl) => node.fire('click');
const status = () => one('search-panel-status').textContent;
const sub = () => one('search-panel-sub').textContent;
const rows = () => one('search-panel-list').kids.length;
const toggle = () => one('search-panel-heartbtn');
const copyButton = () => one('search-panel-heartcopy');
const plainButtons = () => [...all('search-panel-sortbtn'), ...all('search-panel-kindbtn')];
const last = (): Ask => {
  const a = asks.at(-1);
  if (!a) throw new Error('まだ頼んでいません');
  return a;
};
const card = (n: number, over: Partial<SearchItem> = {}): SearchItem => ({ kind: 'reply', memoId: `m${n}`, replyId: `r${n}`, title: `題${n}`, sheet: 'main', at: n, cardLike: 1, cardHead: `文${n}`, ...over });
const reply = (items: SearchItem[], total = items.length, ready = true) => panel.receive({ seq: last().seq, ready, items, total });
// 字を打つ（input の知らせ。待ちは 250ms）
const type = (text: string) => {
  one('search-panel-input').value = text;
  one('search-panel-input').fire('input');
};
// ♥ を入れて、♥ の結果を出す
const heartsShown = (items: SearchItem[] = [card(2), card(1)], total = items.length) => {
  click(toggle());
  reply(items, total);
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
  doc = new FakeDoc();
  vi.stubGlobal('document', doc);
  vi.stubGlobal('HTMLElement', FakeEl);
  vi.stubGlobal('CSS', { escape: (s: string) => s });
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
  asks = [];
  copies = [];
  known = true;
  const deps: SearchPanelDeps = {
    ask: (seq, query, sort, limit, hearts) => void asks.push({ seq, query, sort, limit, hearts }),
    copyHearts: (query, min) => void copies.push([query, min]),
    memoKnown: () => known,
    sheetName: () => null,
    openMemo: () => {},
    openBoard: () => {},
    showMemo: () => {},
    local: () => ({ items: [], notes: [] }),
    openLocal: () => true,
  };
  panel = new SearchPanel(deps);
  panel.refresh(); // 左から memoIndex が届いた（初めて探す）
  vi.advanceTimersByTime(250);
  reply([]); // ふつうの検索（字が空）
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('切り替えと段', () => {
  it('入れると左に段 1 で頼み、並べ方と対象のボタンは押せない・段と［まとめてコピー］の箱が見える。切ると戻り、段なしで頼む', () => {
    expect(asks).toHaveLength(1);
    expect(last().hearts).toBeNull();
    expect(plainButtons().every((b) => !b.disabled)).toBe(true);
    expect(one('search-panel-heartopts').hidden).toBe(true);

    click(toggle());
    expect(last()).toMatchObject({ query: '', limit: 30, hearts: 1 });
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    expect(plainButtons().length).toBeGreaterThan(0);
    expect(plainButtons().every((b) => b.disabled)).toBe(true);
    expect(one('search-panel-heartopts').hidden).toBe(false);

    click(toggle());
    expect(last().hearts).toBeNull();
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
    expect(plainButtons().every((b) => !b.disabled)).toBe(true);
    expect(one('search-panel-heartopts').hidden).toBe(true);
  });
  it('段を替えると、その段で頭から（30 件）探し直す。切って入れ直しても段はそのまま', () => {
    heartsShown();
    click(one('search-panel-more')); // ほかを見る（limit 60）
    expect(last().limit).toBe(60);
    click(byText('search-panel-heartmin', '♥2 以上'));
    expect(last()).toMatchObject({ limit: 30, hearts: 2 });
    expect(byText('search-panel-heartmin', '♥2 以上').getAttribute('aria-pressed')).toBe('true');
    click(toggle());
    click(toggle());
    expect(last().hearts).toBe(2);
  });
});

describe('状態の行と見出しの件数', () => {
  it('字が空：0 件なら頭だけ・件数なし。当たれば頭と「n 件」（ふつうの検索は字が空なら件数を出さない）', () => {
    expect(status()).toBe('最近のもの（新しい順）');
    expect(sub()).toBe('');
    click(toggle());
    reply([]);
    expect(status()).toBe(HEAD);
    expect(sub()).toBe('');
    click(byText('search-panel-heartmin', '♥1 以上'));
    reply([card(2), card(1)]);
    expect(status()).toBe(HEAD);
    expect(sub()).toBe('2 件');
    expect(rows()).toBe(2);
    expect(one('search-panel-list').text).toContain('♥1 題2');
  });
  it('字があって 0 件なら頭と「見つかりませんでした」。左が読み込み中なら頭と準備中の知らせ', () => {
    click(toggle());
    type('無い語');
    vi.advanceTimersByTime(250);
    expect(last()).toMatchObject({ query: '無い語', hearts: 1 });
    reply([]);
    expect(status()).toBe(`${HEAD}　見つかりませんでした`);
    expect(sub()).toBe('');
    one('search-panel-input').fire('keydown', 'Escape'); // 字を消して、すぐ探す
    expect(last()).toMatchObject({ query: '', hearts: 1 });
    reply([], 0, false);
    expect(status()).toBe(`${HEAD}　メモ・コメントは準備中です（左がメモを読み込んでいます）`);
  });
  it('300 件まで出して 301 件あれば、頭と上限の文', () => {
    click(toggle());
    for (let i = 0; i < 9; i += 1) click(one('search-panel-more'));
    expect(last().limit).toBe(300);
    reply(
      Array.from({ length: 300 }, (_, n) => card(n)),
      301,
    );
    expect(status()).toBe(`${HEAD}　300 件まで出します。字を足して絞ってください`);
    expect(sub()).toBe('301 件');
  });
  it('一言（左からの notice・もう無いメモ・左の返事が無い）にも、♥ の結果を出している間は頭を付ける。ふつうの検索に戻れば付けない', () => {
    heartsShown();
    panel.notice('2 件をコピーしました');
    expect(status()).toBe(`${HEAD}　2 件をコピーしました`);
    known = false;
    click(all('search-row-main')[0]);
    expect(status()).toBe(`${HEAD}　そのメモは、もうありません`);
    click(byText('search-panel-heartmin', '♥3'));
    vi.advanceTimersByTime(3000); // 左が答えない
    expect(status()).toBe(`${HEAD}　左の準備ができていません。少し待ってから探してください`);
    click(toggle());
    reply([]);
    panel.notice('知らせ');
    expect(status()).toBe('知らせ');
  });
});

describe('［まとめてコピー］', () => {
  it('出している結果の字と段で頼む（打ちかけの字の待ち・段を替えて左の返事を待つ間も、見えている一覧の条件）', () => {
    heartsShown();
    type('会議'); // まだ探していない（250ms 待ち）
    click(copyButton());
    expect(copies).toEqual([['', 1]]);
    vi.advanceTimersByTime(250); // 「会議」で頼んだ。返事はまだ
    expect(last().query).toBe('会議');
    click(copyButton());
    click(byText('search-panel-heartmin', '♥2 以上'));
    click(copyButton());
    expect(copies).toEqual([
      ['', 1],
      ['', 1],
      ['', 1],
    ]);
    reply([card(5, { cardLike: 2 })]);
    click(copyButton());
    expect(copies.at(-1)).toEqual(['会議', 2]);
  });
  it('入れた直後で ♥ の結果をまだ出していない（ふつうの検索の一覧のまま）ときは、何も頼まない', () => {
    click(toggle());
    click(copyButton());
    expect(copies).toEqual([]);
  });
});

describe('たたむと切る', () => {
  it('♥ の結果を出しているときにたたむと、切って一覧・状態の行・件数を空にする。開くと段なしで頼み、返事の前に古い ♥ の行は出さない', () => {
    heartsShown();
    expect(rows()).toBe(2);
    click(one('search-panel-fold'));
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
    expect(rows()).toBe(0);
    expect(status()).toBe('');
    expect(sub()).toBe('');
    const before = asks.length;
    click(one('search-panel-fold'));
    expect(asks).toHaveLength(before + 1);
    expect(last().hearts).toBeNull();
    expect(rows()).toBe(0);
    expect(status()).toBe('');
    expect(plainButtons().every((b) => !b.disabled)).toBe(true);
  });
  it('♥ の返事を待つ間にたたむと、あとから届いた ♥ の返事は捨てる', () => {
    click(toggle());
    const pending = last().seq;
    click(one('search-panel-fold'));
    panel.receive({ seq: pending, ready: true, items: [card(1)], total: 1 });
    panel.expand();
    expect(rows()).toBe(0);
    expect(status()).toBe('');
    expect(last().hearts).toBeNull();
  });
  it('ふつうの検索の結果は、たたんで開いても今のまま残る（MK9 の前と同じ）', () => {
    one('search-panel-input').fire('keydown', 'Enter');
    reply([{ kind: 'memo', memoId: 'm1', title: '題1', sheet: 'main', at: 1 }], 1);
    click(one('search-panel-fold'));
    expect(rows()).toBe(1);
    panel.expand();
    expect(rows()).toBe(1);
  });
});
