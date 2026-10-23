// 下のメモの区画：見出しで絞る欄の下に出す、ワードのボタン（6つまで）
//   登録のしかたは、右サイドバーの区画タグと、盤面のシートボタンと同じ
//     1つのワードは1つの番号だけ。空の番号はボタンにしない。別の番号に入れると、前の番号からは外れる
//   6つを1組のセットにして、保存して切り替える（タグのボタンのセットと同じ考え。切り替えても、いま絞っている字は変えない）
//   覚え方は下の区画だけの localStorage。メモの台帳も、一覧の開き方（honeycomb.memoPane）も変えない
import { armConfirm } from './confirm-arm';
import { el } from './util';

const STORE_KEY = 'honeycomb.memoFilterWords';
const SLOT_COUNT = 6;
const MAX_SETS = 12;
const NAME_MAX = 20;
const WORD_MAX = 40;
const RECENT_MAX = 12;

export interface FilterWordSet {
  id: string;
  name: string;
  words: (string | null)[]; // いつも6つ（null は空き）
}

interface Book {
  version: 1;
  current: string;
  sets: FilterWordSet[];
  recent: string[]; // 最近絞ったワード（新しい順）。ボタンに入っていても残す
}

type Clip = { ok: true; word: string } | { ok: false; reason: 'empty' | 'long' };

export type RegisterResult =
  | { kind: 'invalid'; reason: 'empty' | 'long' }
  | { kind: 'same' }
  | { kind: 'ok'; previous: string | null; movedFrom: number | null };

type PanelView =
  | { kind: 'home' }
  | { kind: 'slots' }
  | { kind: 'sets' }
  | { kind: 'others' }
  | { kind: 'name'; mode: 'new' | 'copy' | 'rename' };

function trimEnds(raw: string) {
  return raw.replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
}

export function clipFilterWord(raw: string): Clip {
  const word = trimEnds(raw);
  if (!word) return { ok: false, reason: 'empty' };
  if ([...word].length > WORD_MAX) return { ok: false, reason: 'long' };
  return { ok: true, word };
}

function cleanSetName(name: string) {
  return [...name.replace(/[\s\u3000]+/g, ' ').trim()].slice(0, NAME_MAX).join('');
}

function freshId(sets: readonly { id: string }[]) {
  let id = '';
  do {
    id = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  } while (sets.some((set) => set.id === id));
  return id;
}

function normalizeSlots(raw: unknown): (string | null)[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  return Array.from({ length: SLOT_COUNT }, (_, index) => {
    const value: unknown = list[index];
    const clip = clipFilterWord(typeof value === 'string' ? value : '');
    if (!clip.ok || seen.has(clip.word.toLowerCase())) return null;
    seen.add(clip.word.toLowerCase());
    return clip.word;
  });
}

function defaultBook(): Book {
  return { version: 1, current: 'usual', sets: [{ id: 'usual', name: 'いつもの', words: normalizeSlots(null) }], recent: [] };
}

function normalizeBook(raw: unknown): Book {
  if (typeof raw !== 'object' || raw === null) return defaultBook();
  const record = raw as Record<string, unknown>;
  if (record.version !== 1) return defaultBook();
  const sets: FilterWordSet[] = [];
  const used = new Set<string>();
  for (const item of Array.isArray(record.sets) ? record.sets : []) {
    if (typeof item !== 'object' || item === null) continue;
    const row = item as Record<string, unknown>;
    let id = typeof row.id === 'string' && /^[0-9a-z_-]{1,40}$/i.test(row.id) ? row.id : freshId(sets);
    if (used.has(id)) id = freshId(sets);
    used.add(id);
    sets.push({
      id,
      name: cleanSetName(typeof row.name === 'string' ? row.name : '') || `セット${sets.length + 1}`,
      words: normalizeSlots(row.words),
    });
    if (sets.length >= MAX_SETS) break;
  }
  if (sets.length === 0) return defaultBook();
  const current = typeof record.current === 'string' && sets.some((set) => set.id === record.current) ? record.current : sets[0].id;
  const seen = new Set<string>();
  const recent: string[] = [];
  for (const item of Array.isArray(record.recent) ? record.recent : []) {
    if (typeof item !== 'string') continue;
    const clip = clipFilterWord(item);
    if (!clip.ok || seen.has(clip.word.toLowerCase())) continue;
    seen.add(clip.word.toLowerCase());
    recent.push(clip.word);
    if (recent.length >= RECENT_MAX) break;
  }
  return { version: 1, current, sets, recent };
}

function pushRecent(recent: readonly string[], word: string) {
  return [word, ...recent.filter((item) => item.toLowerCase() !== word.toLowerCase())].slice(0, RECENT_MAX);
}

export class MemoFilterWords {
  private book: Book;

  constructor() {
    this.book = this.load();
  }

  get sets(): readonly FilterWordSet[] {
    return this.book.sets;
  }

  get current(): FilterWordSet {
    return this.book.sets.find((set) => set.id === this.book.current) ?? this.book.sets[0];
  }

  get canAdd() {
    return this.book.sets.length < MAX_SETS;
  }

  // いまの6つに入っていない、最近絞ったワード
  others(): string[] {
    const used = new Set(this.current.words.filter((word): word is string => !!word).map((word) => word.toLowerCase()));
    return this.book.recent.filter((word) => !used.has(word.toLowerCase()));
  }

  register(raw: string, slot: number): RegisterResult {
    const clip = clipFilterWord(raw);
    if (!clip.ok) return { kind: 'invalid', reason: clip.reason };
    if (slot < 0 || slot >= SLOT_COUNT) return { kind: 'invalid', reason: 'empty' };
    const word = clip.word;
    const words = [...this.current.words];
    const existing = words.findIndex((item) => item !== null && item.toLowerCase() === word.toLowerCase());
    if (existing === slot) return { kind: 'same' };
    const occupant = words[slot];
    const previous = occupant && occupant.toLowerCase() !== word.toLowerCase() ? occupant : null;
    if (existing >= 0) words[existing] = null;
    words[slot] = word;
    let recent = pushRecent(this.book.recent, word);
    if (previous) recent = [word, ...pushRecent(recent, previous).filter((item) => item.toLowerCase() !== word.toLowerCase())].slice(0, RECENT_MAX);
    this.replace({ words, recent });
    return { kind: 'ok', previous, movedFrom: existing >= 0 ? existing : null };
  }

  // 絞りに使ったワードを覚える（空・長すぎる字は覚えない。絞り込みそのものは変えない）
  remember(raw: string) {
    const clip = clipFilterWord(raw);
    if (!clip.ok || this.book.recent[0] === clip.word) return;
    this.write({ ...this.book, recent: pushRecent(this.book.recent, clip.word) });
  }

  setCurrent(id: string) {
    if (id === this.book.current || !this.book.sets.some((set) => set.id === id)) return false;
    this.write({ ...this.book, current: id });
    return true;
  }

  add(name: string, words?: (string | null)[]): FilterWordSet | null {
    if (!this.canAdd) return null;
    const set: FilterWordSet = {
      id: freshId(this.book.sets),
      name: cleanSetName(name) || `セット${this.book.sets.length + 1}`,
      words: words ? normalizeSlots(words) : normalizeSlots(null),
    };
    this.write({ ...this.book, current: set.id, sets: [...this.book.sets, set] });
    return set;
  }

  rename(name: string) {
    const clean = cleanSetName(name);
    const current = this.current;
    if (!clean || clean === current.name) return false;
    const sets = this.book.sets.map((set) => (set.id === current.id ? { ...set, name: clean } : set));
    this.write({ ...this.book, sets });
    return true;
  }

  remove() {
    if (this.book.sets.length <= 1) return false;
    const current = this.current;
    const at = this.book.sets.findIndex((set) => set.id === current.id);
    const sets = this.book.sets.filter((set) => set.id !== current.id);
    const next = sets[Math.max(0, at - 1)] ?? sets[0];
    this.write({ ...this.book, current: next.id, sets });
    return true;
  }

  private replace(change: { words: (string | null)[]; recent: string[] }) {
    const current = this.current;
    const sets = this.book.sets.map((set) => (set.id === current.id ? { ...set, words: change.words } : set));
    this.write({ ...this.book, sets, recent: change.recent });
  }

  private load(): Book {
    try {
      return normalizeBook(JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null'));
    } catch {
      return defaultBook();
    }
  }

  private write(book: Book) {
    this.book = book;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(book));
    } catch {
      // 保存できなくても、今は絞れる
    }
  }
}

export function mountMemoFilterWords(host: { filter: HTMLInputElement; onApply: () => void; status: (text: string) => void }) {
  const store = new MemoFilterWords();
  const box = el('div', 'memo-filter-box');
  const panel = el('div', 'memo-filter-words');
  panel.id = 'memo-filter-words';
  panel.hidden = true;
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', '絞るワード');
  host.filter.setAttribute('aria-controls', panel.id);
  host.filter.setAttribute('aria-expanded', 'false');
  box.append(host.filter, panel);

  let view: PanelView = { kind: 'home' };
  let armDelete = false;
  let closeTimer = 0;

  function show() {
    if (!panel.hidden) return;
    view = { kind: 'home' };
    armDelete = false;
    panel.hidden = false;
    host.filter.setAttribute('aria-expanded', 'true');
    render();
  }

  function close() {
    if (panel.hidden) return;
    panel.hidden = true;
    host.filter.setAttribute('aria-expanded', 'false');
    view = { kind: 'home' };
    armDelete = false;
    store.remember(host.filter.value);
  }

  function scheduleClose() {
    window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => {
      if (panel.hidden) return;
      const active = document.activeElement;
      if (active instanceof Node && box.contains(active)) return;
      close();
    }, 0);
  }

  function apply(word: string) {
    host.filter.value = word;
    host.onApply();
    store.remember(word);
    view = { kind: 'home' };
    armDelete = false;
    render({ restoreFilter: true });
  }

  function go(next: PanelView, focusName = false) {
    view = next;
    if (next.kind !== 'sets') armDelete = false;
    render(focusName ? { focusName: true } : { restoreFilter: true });
  }

  function render(options: { focusName?: boolean; restoreFilter?: boolean } = {}) {
    panel.replaceChildren();
    if (view.kind === 'home') panel.append(...homeView());
    else if (view.kind === 'slots') panel.append(...slotsView());
    else if (view.kind === 'sets') panel.append(...setsView());
    else if (view.kind === 'others') panel.append(...othersView());
    else panel.append(nameView(view.mode));
    if (options.focusName) {
      const input = panel.querySelector('input');
      if (input instanceof HTMLInputElement) {
        input.focus();
        input.select();
      }
      return;
    }
    if (options.restoreFilter) host.filter.focus({ preventScroll: true });
  }

  function homeView() {
    const nodes: HTMLElement[] = [];
    const typed = clipFilterWord(host.filter.value);
    const pills = el('div', 'memo-filter-pills');
    let any = false;
    store.current.words.forEach((word, index) => {
      if (!word) return;
      any = true;
      const current = typed.ok && typed.word.toLowerCase() === word.toLowerCase();
      const button = el('button', current ? 'memo-filter-pill is-current' : 'memo-filter-pill');
      button.type = 'button';
      const title = current ? `ワード${index + 1}：${word}（いま絞っているワード）` : `ワード${index + 1}：${word}。押すと、このワードで絞ります`;
      button.title = title;
      button.setAttribute('aria-label', title);
      if (current) button.setAttribute('aria-current', 'true');
      button.append(el('span', 'memo-filter-pill-text', word));
      button.addEventListener('click', () => apply(word));
      pills.append(button);
    });
    if (any) nodes.push(pills);
    else nodes.push(el('p', 'memo-filter-note', 'まだありません（「このワードをボタンに登録」で入れられます）'));
    const at = typed.ok ? store.current.words.findIndex((word) => word !== null && word.toLowerCase() === typed.word.toLowerCase()) : -1;
    nodes.push(
      row(
        'このワードをボタンに登録…',
        typed.ok ? (at >= 0 ? `ワード${at + 1}` : typed.word) : undefined,
        typed.ok
          ? at >= 0
            ? `「${typed.word}」はワード${at + 1}のボタンです。別の番号に入れかえられます`
            : `いまの「${typed.word}」を、ワード1〜6のどれかに入れます`
          : '先に、絞るワードを書いてください',
        () => {
          if (!typed.ok) {
            host.status(typed.reason === 'long' ? `ワードは ${WORD_MAX} 字までです` : '先に、絞るワードを書いてください');
            return;
          }
          go({ kind: 'slots' });
        },
      ),
    );
    nodes.push(row('ワードのセット…', store.current.name, `セット「${store.current.name}」を保存・切り替え`, () => go({ kind: 'sets' })));
    nodes.push(row('その他のワード…', undefined, '6つのボタンに入っていない、最近絞ったワード', () => go({ kind: 'others' })));
    return nodes;
  }

  function slotsView() {
    const typed = clipFilterWord(host.filter.value);
    const nodes: HTMLElement[] = [back(() => go({ kind: 'home' }))];
    if (!typed.ok) {
      nodes.push(el('p', 'memo-filter-note', typed.reason === 'long' ? `ワードは ${WORD_MAX} 字までです` : '先に、絞るワードを書いてください'));
    } else {
      nodes.push(el('p', 'memo-filter-section', `「${typed.word}」をボタンに登録`));
    }
    for (let index = 0; index < SLOT_COUNT; index++) {
      const occupant = store.current.words[index];
      const here = typed.ok && occupant !== null && occupant.toLowerCase() === typed.word.toLowerCase();
      const hint = here ? 'このワード' : (occupant ?? undefined);
      const title = !typed.ok
        ? '先に、絞るワードを書いてください'
        : here
          ? `すでにワード${index + 1}のボタンです`
          : occupant
            ? `ワード${index + 1}に登録します。いまの「${occupant}」は外れます`
            : `ワード${index + 1}に登録します（空いています）`;
      const slot = index;
      nodes.push(
        row(`ワード${index + 1}に登録`, hint, title, () => register(slot), !typed.ok),
      );
    }
    return nodes;
  }

  function register(slot: number) {
    const result = store.register(host.filter.value, slot);
    if (result.kind === 'invalid') {
      host.status(result.reason === 'long' ? `ワードは ${WORD_MAX} 字までです` : '先に、絞るワードを書いてください');
      return;
    }
    if (result.kind === 'same') {
      host.status(`すでにワード${slot + 1}のボタンです`);
      return;
    }
    const bits: string[] = [];
    if (result.previous) bits.push(`前の「${result.previous}」は外れます`);
    if (result.movedFrom !== null) bits.push(`ワード${result.movedFrom + 1}からは外れます`);
    const clip = clipFilterWord(host.filter.value);
    const word = clip.ok ? clip.word : host.filter.value.trim();
    host.status(`「${word}」をワード${slot + 1}のボタンにしました${bits.length ? `（${bits.join('。')}）` : ''}`);
    go({ kind: 'home' });
  }

  function setsView() {
    const nodes: HTMLElement[] = [
      back(() => go({ kind: 'home' })),
      el('p', 'memo-filter-section', 'ワードのセット'),
      el('p', 'memo-filter-note', '切り替えると、6つのボタンが入れかわります。いま絞っている字はそのままです。'),
    ];
    for (const set of store.sets) {
      const names = set.words.filter((word): word is string => !!word);
      const current = set.id === store.current.id;
      const title = names.length ? `${set.name}（${names.join('、')}）` : `${set.name}（空き）`;
      nodes.push(
        row(current ? `✓ ${set.name}` : set.name, names.slice(0, 2).join('・') || '空き', current ? `${title}。いまのセットです` : `${title}。押すと、このセットに切り替えます`, () => {
          armDelete = false;
          if (!current) {
            store.setCurrent(set.id);
            host.status(`セット「${store.current.name}」に切り替えました`);
          }
          go({ kind: 'home' });
        }),
      );
    }
    nodes.push(
      row('＋ 新しいセット…', undefined, '空の6つで、新しいセットを作ります', () => go({ kind: 'name', mode: 'new' }, true), !store.canAdd),
      row('このセットを複製…', undefined, 'いまの6つを、別のセットとして保存します', () => go({ kind: 'name', mode: 'copy' }, true), !store.canAdd),
      row('このセットの名前を変える…', undefined, 'いまのセットの名前を変えます', () => go({ kind: 'name', mode: 'rename' }, true)),
    );
    if (store.sets.length > 1) {
      const del = row(
          armDelete ? '本当に消す' : `「${store.current.name}」を消す`,
          undefined,
          armDelete ? `セット「${store.current.name}」を消します。登録したワードのボタンは、このセットから外れます` : 'もう一度押すと消します（最後の1つは消せません）',
          () => {
            if (!armDelete) {
              armDelete = true;
              render({ restoreFilter: true });
              return;
            }
            const name = store.current.name;
            armDelete = false;
            store.remove();
            host.status(`セット「${name}」を消しました`);
            go({ kind: 'home' });
          },
        );
      // 外を押す・Esc で「本当に消す」をやめる
      if (armDelete) armConfirm(del, () => {
        armDelete = false;
        render({ restoreFilter: true });
      });
      nodes.push(
        del,
      );
    } else {
      nodes.push(row('このセットを消す（最後の1つは消せません）', undefined, 'セットは1つ残します', () => undefined, true));
    }
    if (!store.canAdd) nodes.push(el('p', 'memo-filter-note', `セットは ${MAX_SETS} 個までです`));
    return nodes;
  }

  function othersView() {
    const nodes: HTMLElement[] = [
      back(() => go({ kind: 'home' })),
      el('p', 'memo-filter-section', 'その他のワード'),
      el('p', 'memo-filter-note', '6つのボタンに入っていない、最近絞ったワードです。'),
    ];
    const words = store.others();
    if (words.length === 0) {
      nodes.push(el('p', 'memo-filter-note', 'まだありません（見出しで絞って、この欄から離れると残ります）'));
      return nodes;
    }
    for (const word of words) {
      nodes.push(row(word, undefined, `${word}。押すと、このワードで絞ります。ボタンに入れるときは、そのあと「このワードをボタンに登録」`, () => apply(word)));
    }
    return nodes;
  }

  function nameView(mode: 'new' | 'copy' | 'rename') {
    const form = el('form', 'memo-filter-form');
    const label = mode === 'new' ? '新しいセットの名前' : mode === 'copy' ? '複製したセットの名前' : 'セットの名前';
    const initial = mode === 'new' ? `セット${store.sets.length + 1}` : mode === 'copy' ? cleanSetName(`${store.current.name}のコピー`) || `セット${store.sets.length + 1}` : store.current.name;
    form.append(el('p', 'memo-filter-section', label));
    const input = el('input', 'memo-filter-name');
    input.type = 'text';
    input.value = initial;
    input.maxLength = NAME_MAX;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', label);
    const row = el('div', 'memo-filter-form-row');
    const ok = el('button', 'memo-filter-mini', '決める');
    ok.type = 'submit';
    const cancel = el('button', 'memo-filter-mini', 'やめる');
    cancel.type = 'button';
    cancel.addEventListener('click', () => go({ kind: 'sets' }));
    row.append(ok, cancel);
    form.append(input, row);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = input.value;
      if (mode === 'rename') {
        const changed = store.rename(name);
        if (changed) host.status(`セットの名前を「${store.current.name}」にしました`);
        go({ kind: 'sets' });
        return;
      }
      const set = store.add(name, mode === 'copy' ? [...store.current.words] : undefined);
      if (!set) {
        host.status(`セットは ${MAX_SETS} 個までです`);
        go({ kind: 'sets' });
        return;
      }
      host.status(mode === 'copy' ? `「${set.name}」として保存しました` : `セット「${set.name}」を作りました。空いた番号に、ワードを登録できます`);
      go({ kind: 'home' });
    });
    return form;
  }

  host.filter.addEventListener('focus', show);
  host.filter.addEventListener('click', () => {
    if (panel.hidden) show();
    else if (view.kind !== 'home') go({ kind: 'home' });
  });
  host.filter.addEventListener('input', () => {
    if (panel.hidden) return;
    if (view.kind === 'home' || view.kind === 'slots') render();
  });
  host.filter.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    store.remember(host.filter.value);
  });
  box.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || event.isComposing || panel.hidden) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    },
    true,
  );
  box.addEventListener('focusout', scheduleClose);
  panel.addEventListener('mousedown', (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    event.preventDefault();
  });
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (panel.hidden) return;
      if (event.target instanceof Node && box.contains(event.target)) return;
      close();
    },
    true,
  );

  return { box, close };
}

function back(run: () => void) {
  return row('← 戻る', undefined, 'ワードのボタンに戻る', run);
}

function row(label: string, hint: string | undefined, title: string, run: () => void, disabled = false) {
  const button = el('button', 'memo-filter-item');
  button.type = 'button';
  button.title = title;
  button.setAttribute('aria-label', hint ? `${label}（${hint}）` : label);
  button.disabled = disabled;
  button.append(el('span', 'memo-filter-label', label));
  if (hint) button.append(el('span', 'memo-filter-hint', hint));
  button.addEventListener('click', run);
  return button;
}
