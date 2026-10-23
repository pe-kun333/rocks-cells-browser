// 順路：リンクをたどった道（調べものの順路）
//   ・タブで表示したページを、来た元のページとつないで「木」の形で覚える
//     同じタブの中でたどった道が「線」、リンクから新しいタブで開いた先が「枝」（六角メモの Dendritic Extensions と同じ考え）
//   ・覚えるのは http(s) のページの URL・題名・時刻だけ。保存先：ui-data\routes.json（このパソコンの中だけ）
//   ・持ち主は左サイドバー（タブの出来事を見ている）。右サイドバーには写しを送り、変えたいときは左に頼む
import { readData, writeData } from './data';
import { type Hex, hexKey } from './hex';
import type { Tab, TabStore } from './tabs';
import { TAG_PALETTE } from './tags';
import { hostOf } from './util';

export interface RouteStep {
  id: string;
  url: string;
  title: string; // 空のこともある（題名が届く前・題名の無いページ）
  at: number; // 初めて開いた時刻
  from: string | null; // 来た元の段（null は出発点）
  lane: string; // どのタブでたどったか（タブごとの印。同じ印が続くところが「線」、変わるところが「枝」）
}

// AI の調べもの日誌
export interface RouteJournal {
  at: number;
  cost: number;
  title: string;
  summary: string;
  flow: { steps: number[]; text: string }[]; // 流れ（どの段の話か）
  findings: string[]; // わかったこと
  questions: string[]; // まだわからないこと・次に調べること
}

export interface Route {
  id: string;
  name: string; // 空なら、最初のページの題名や検索の言葉から決める
  color: string;
  createdAt: number;
  updatedAt: number;
  saved: boolean; // 名前を付けて残した（古くなっても消さない）
  steps: RouteStep[]; // 開いた順
  journal?: RouteJournal;
}

// タブが今いる場所（どの順路の、どの段か。lane はそのタブの線の印）
export interface TabTrail {
  route: string;
  step: string;
  lane: string;
}

export interface RoutesState {
  recording: boolean;
  routes: Route[];
}

const FILE = 'routes.json';
export const MAX_STEPS = 300; // 1本の順路の段の数（超えたら新しい順路にする）
export const MAX_LAYOUT = 40; // 盤面・六角メモに並べる段の数
const MAX_UNSAVED = 40; // 残していない順路は、新しいものからこれだけ
const MAX_SAVED = 100;
const STALE_MS = 3 * 60 * 60_000; // 3時間あいたら、別の調べものとして新しい順路にする
const CHURN_MS = 4_000; // ページの中で URL だけがすぐに変わったら、同じ段として直す（地図を動かす・絞り込みなど）
const DAY_MS = 24 * 60 * 60_000;
const KEEP_MS = 30 * DAY_MS; // 残していない順路を覚えておく日数

const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const newLaneId = () => newId('l');

// ---------- 台帳（左サイドバーが持つ） ----------

export class RouteStore {
  private routes: Route[] = [];
  private on = true;
  private loaded = false;
  private readonly listeners: (() => void)[] = [];
  private saveTimer = 0;

  async load() {
    const saved = await readData<{ version?: unknown; recording?: unknown; routes?: unknown }>(FILE);
    if (saved && saved.version === 1) {
      this.on = saved.recording !== false;
      this.routes = Array.isArray(saved.routes) ? saved.routes.map(parseRoute).filter((r): r is Route => !!r) : [];
    }
    this.loaded = true;
    this.emit();
  }

  get ready() {
    return this.loaded;
  }

  get recording() {
    return this.on;
  }

  setRecording(on: boolean) {
    this.on = on;
    this.changed();
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  get(id: string | null | undefined) {
    return id ? this.routes.find((r) => r.id === id) : undefined;
  }

  // 新しく使ったものから
  list(): Route[] {
    return [...this.routes].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  snapshot(): RoutesState {
    return { recording: this.on, routes: this.list() };
  }

  // 新しい順路を始める
  create(url: string, title: string, lane: string): { route: Route; step: RouteStep } {
    const now = Date.now();
    const step: RouteStep = { id: newId('s'), url, title, at: now, from: null, lane };
    const route: Route = { id: newId('r'), name: '', color: this.nextColor(), createdAt: now, updatedAt: now, saved: false, steps: [step] };
    this.routes.push(route);
    this.changed();
    return { route, step };
  }

  addStep(route: Route, fields: Omit<RouteStep, 'id' | 'at'>): RouteStep {
    const step: RouteStep = { id: newId('s'), at: Date.now(), ...fields };
    route.steps.push(step);
    route.updatedAt = step.at;
    this.changed();
    return step;
  }

  updateStep(route: Route, stepId: string, patch: Partial<Pick<RouteStep, 'url' | 'title'>>) {
    const step = route.steps.find((s) => s.id === stepId);
    if (!step) return;
    Object.assign(step, patch);
    route.updatedAt = Date.now();
    this.changed();
  }

  // 先の段が無い段を外す（開いてすぐに転送されて、別の段と同じページだったとき）
  removeLeaf(route: Route, stepId: string) {
    if (route.steps.some((s) => s.from === stepId)) return;
    route.steps = route.steps.filter((s) => s.id !== stepId);
    this.changed();
  }

  touch(route: Route) {
    route.updatedAt = Date.now();
    this.changed();
  }

  update(id: string, patch: { name?: string; color?: string; saved?: boolean }) {
    const route = this.get(id);
    if (!route) return;
    if (patch.name !== undefined) route.name = cleanName(patch.name);
    if (patch.color !== undefined && /^#[0-9a-f]{6}$/i.test(patch.color)) route.color = patch.color;
    if (patch.saved !== undefined) route.saved = patch.saved;
    this.changed();
  }

  setJournal(id: string, journal: RouteJournal | null) {
    const route = this.get(id);
    if (!route) return;
    if (journal) route.journal = journal;
    else delete route.journal;
    this.changed();
  }

  remove(id: string) {
    this.routes = this.routes.filter((r) => r.id !== id);
    this.changed();
  }

  private nextColor() {
    const recent = new Set(this.list().slice(0, 6).map((r) => r.color));
    return TAG_PALETTE.find((c) => !recent.has(c)) ?? TAG_PALETTE[this.routes.length % TAG_PALETTE.length];
  }

  // 古いものを片付ける：残した順路はそのまま（100本まで）。残していないものは、1段だけのものは1日、
  //   それ以外は30日で消し、新しいものから40本まで
  private prune() {
    const now = Date.now();
    const sorted = this.list();
    const saved = sorted.filter((r) => r.saved).slice(0, MAX_SAVED);
    const unsaved = sorted
      .filter((r) => !r.saved)
      .filter((r) => now - r.updatedAt < (r.steps.length <= 1 ? DAY_MS : KEEP_MS))
      .slice(0, MAX_UNSAVED);
    if (saved.length + unsaved.length !== this.routes.length) {
      const keep = new Set([...saved, ...unsaved]);
      this.routes = this.routes.filter((r) => keep.has(r));
    }
  }

  private changed() {
    this.emit();
    if (!this.loaded) return; // 読み込む前に書くと、前の記録を消してしまう
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.prune();
      void writeData(FILE, { version: 1, recording: this.on, routes: this.routes });
    }, 800);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

// ---------- 記録係：タブの出来事から順路を伸ばす ----------

export class RouteRecorder {
  private readonly fresh = new Set<number>(); // 枝として作った直後のタブ（最初に表示した URL が違えば、転送とみなしてその段を直す）
  private readonly expect = new Map<number, string>(); // 順路の段を開くよう頼んだタブ → その段（転送されても新しい段にしない）

  constructor(
    private readonly tabs: TabStore,
    private readonly routes: RouteStore,
    private readonly homeUrl: string,
  ) {}

  private get active() {
    return this.routes.ready && this.routes.recording;
  }

  // 記録する URL か（ホームのページは出発点にしない）
  private recordable(url: string): string | null {
    const u = normalizeRouteUrl(url);
    return u && u !== normalizeRouteUrl(this.homeUrl) ? u : null;
  }

  // リンクから新しいタブで開かれた：開いた元のタブの順路から、枝を伸ばす
  branch(tabId: number, parentId: number, url: string) {
    if (!this.active) return;
    const parent = this.tabs.get(parentId);
    const u = this.recordable(url);
    if (!parent || !u) return;
    let trail = this.liveTrail(parent);
    if (!trail) {
      // 開いた元のタブにまだ順路が無い：元のページを出発点にする
      const start = this.recordable(parent.url);
      if (!start) return;
      const lane = newLaneId();
      const { route, step } = this.routes.create(start, parent.title, lane);
      trail = { route: route.id, step: step.id, lane };
      this.tabs.setTrail(parent.id, trail);
    }
    const route = this.routes.get(trail.route);
    if (!route) return;
    const lane = newLaneId();
    const existing = route.steps.find((s) => s.url === u);
    if (existing) {
      this.routes.touch(route);
      this.tabs.setTrail(tabId, { route: route.id, step: existing.id, lane });
      return;
    }
    if (route.steps.length >= MAX_STEPS) return;
    const step = this.routes.addStep(route, { url: u, title: '', from: trail.step, lane });
    this.tabs.setTrail(tabId, { route: route.id, step: step.id, lane });
    this.fresh.add(tabId);
  }

  // 順路の段を、このタブで開くよう頼んだ（順に読む・段を開く）
  expectStep(tabId: number, trail: TabTrail) {
    this.expect.set(tabId, trail.step);
    this.tabs.setTrail(tabId, trail);
  }

  // タブで表示しているページが変わった（before：変わる前の URL、newDocument：新しいページを読み込んだか）
  navigated(tabId: number, url: string, before: string, newDocument = true) {
    const tab = this.tabs.get(tabId);
    if (!this.active || !tab) return;
    const u = this.recordable(url);
    const wasFresh = this.fresh.delete(tabId);
    const expected = this.expect.get(tabId);
    this.expect.delete(tabId);
    if (!u) return;
    const trail = this.liveTrail(tab);
    const route = trail && this.routes.get(trail.route);
    const cur = route?.steps.find((s) => s.id === trail?.step);
    if (!trail || !route || !cur) {
      // まだ順路が無い・古くなった：前のページ（あれば）を出発点に、新しい順路を始める
      const prev = this.recordable(before);
      if (prev === u) return; // 起こしたとき・読み込み直したとき
      this.start(tab, prev, u);
      return;
    }
    if (cur.url === u) return;
    const hasNext = route.steps.some((s) => s.from === cur.id);
    if ((wasFresh && !cur.title && !hasNext) || expected === cur.id) {
      // 開いてすぐに転送された：その段の URL を直す（同じページの段がもうあれば、そちらへ）
      const other = route.steps.find((s) => s.url === u);
      if (expected === cur.id) {
        if (!other) return; // 頼んだ段のまま（転送先は覚えない）
      } else if (!other) {
        this.routes.updateStep(route, cur.id, { url: u });
        return;
      } else {
        this.routes.removeLeaf(route, cur.id);
      }
      this.tabs.setTrail(tab.id, { ...trail, step: other.id });
      return;
    }
    const existing = route.steps.find((s) => s.url === u);
    if (existing) {
      // 前に来たページ（戻る・同じリンク）：段は増やさず、今いる場所だけ動かす
      this.routes.touch(route);
      this.tabs.setTrail(tab.id, { ...trail, step: existing.id });
      return;
    }
    if (route.steps.length >= MAX_STEPS) {
      this.start(tab, cur.url, u);
      return;
    }
    const sharing = this.tabs.all().some((t) => t.id !== tab.id && t.trail?.step === cur.id);
    if (!newDocument && Date.now() - cur.at < CHURN_MS && sameOrigin(cur.url, u) && !hasNext && !sharing) {
      this.routes.updateStep(route, cur.id, { url: u, title: '' });
      return;
    }
    const step = this.routes.addStep(route, { url: u, title: '', from: cur.id, lane: trail.lane });
    this.tabs.setTrail(tab.id, { ...trail, step: step.id });
  }

  // 題名が届いた
  titled(tabId: number) {
    const tab = this.tabs.get(tabId);
    const route = tab?.trail ? this.routes.get(tab.trail.route) : undefined;
    const step = route?.steps.find((s) => s.id === tab?.trail?.step);
    const title = tab?.title.trim() ?? '';
    if (!tab || !route || !step || !title || step.title === title) return;
    if (normalizeRouteUrl(tab.url) !== step.url) return;
    // 題名はページを開いてしばらくの間だけ直す（後で「(3) 通知」のように変わるサイトで、段の名前が揺れないように）
    if (step.title && Date.now() - step.at > 60_000) return;
    this.routes.updateStep(route, step.id, { title: [...title].slice(0, 200).join('') });
  }

  // まだ続けられる順路（無い・古い・長すぎるものは null）
  private liveTrail(tab: Tab): TabTrail | null {
    const trail = tab.trail;
    const route = trail ? this.routes.get(trail.route) : undefined;
    if (!trail || !route || !route.steps.some((s) => s.id === trail.step)) return null;
    if (Date.now() - route.updatedAt > STALE_MS) return null;
    return trail;
  }

  private start(tab: Tab, prev: string | null, url: string) {
    const lane = newLaneId();
    if (prev && prev !== url) {
      const { route, step } = this.routes.create(prev, '', lane);
      const next = this.routes.addStep(route, { url, title: '', from: step.id, lane });
      this.tabs.setTrail(tab.id, { route: route.id, step: next.id, lane });
    } else {
      const { route, step } = this.routes.create(url, '', lane);
      this.tabs.setTrail(tab.id, { route: route.id, step: step.id, lane });
    }
  }
}

// ---------- URL と見出し ----------

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|yclid|msclkid|mc_[a-z]+|igshid|si|ref_src|ref_url)$/i;

// 順路で同じページかどうかを見分ける形（http(s) だけ。# 以降と、広告の追跡用の引数は外す）
export function normalizeRouteUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
  return url.toString();
}

function sameOrigin(a: string, b: string) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

// 検索結果のページなら、検索した言葉
export function searchQueryOf(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '');
  const get = (key: string) => url.searchParams.get(key)?.trim() || null;
  if (/(^|\.)google\.[a-z.]+$/.test(host) && url.pathname === '/search') return get('q');
  if (host === 'bing.com' && url.pathname === '/search') return get('q');
  if (host === 'duckduckgo.com') return get('q');
  if (/(^|\.)search\.yahoo\.co(m|\.jp)$/.test(host)) return get('p');
  if (/(^|\.)youtube\.com$/.test(host) && url.pathname === '/results') return get('search_query');
  return null;
}

// 段の見出し：検索なら「🔍 言葉」、題名が無ければ サイト名＋パス
export function stepLabel(step: RouteStep): string {
  const query = searchQueryOf(step.url);
  if (query) return `🔍 ${query}`;
  if (step.title) return step.title;
  try {
    const u = new URL(step.url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : decodeURIComponent(u.pathname)}`;
  } catch {
    return step.url;
  }
}

export function routeName(route: Route): string {
  if (route.name) return route.name;
  const first = route.steps.find((s) => searchQueryOf(s.url)) ?? route.steps[0];
  if (!first) return '順路';
  const label = searchQueryOf(first.url) ?? (first.title || hostOf(first.url) || '順路');
  return cleanName(label) || '順路';
}

function cleanName(name: string) {
  return [...name.replace(/\s+/g, ' ').trim()].slice(0, 30).join('');
}

// ---------- 形（一覧の木・盤面の線・並べる形） ----------

// 段 → その先の段（開いた順）。来た元が見つからない段は出発点として扱う
function childrenMap(route: Route, include?: Set<string>): Map<string | null, RouteStep[]> {
  const ids = new Set(route.steps.map((s) => s.id));
  const map = new Map<string | null, RouteStep[]>();
  for (const s of route.steps) {
    if (include && !include.has(s.id)) continue;
    const from = s.from && ids.has(s.from) && (!include || include.has(s.from)) ? s.from : null;
    map.set(from, [...(map.get(from) ?? []), s]);
  }
  return map;
}

export interface RouteRow {
  step: RouteStep;
  n: number; // 開いた順の番号（1 から）
  depth: number; // 枝の深さ
  branch: boolean; // ここから枝が始まる
}

// 一覧に出す並び：線はそのまま下へ、枝はその段のすぐ下に1段ずらして出す
export function routeTree(route: Route): RouteRow[] {
  const numbers = new Map(route.steps.map((s, i) => [s.id, i + 1]));
  const kids = childrenMap(route);
  const rows: RouteRow[] = [];
  const seen = new Set<string>();
  const walk = (start: RouteStep, depth: number, branch: boolean) => {
    let cur: RouteStep | undefined = start;
    let first = true;
    while (cur && !seen.has(cur.id)) {
      const step: RouteStep = cur;
      seen.add(step.id);
      rows.push({ step, n: numbers.get(step.id) ?? 0, depth, branch: first && branch });
      first = false;
      const children = kids.get(step.id) ?? [];
      const next = children.find((c) => c.lane === step.lane);
      for (const c of children) if (c !== next) walk(c, depth + 1, true);
      cur = next;
    }
  };
  for (const root of kids.get(null) ?? []) walk(root, 0, false);
  return rows;
}

// 盤面や六角メモに並べる形（最初の段が (0,0)）：線は右へ、枝は1段下から右へ。重なるときはさらに下へ
export function routeLayout(route: Route, max = MAX_LAYOUT): { steps: RouteStep[]; offsets: Map<string, Hex> } {
  const steps = route.steps.slice(0, max); // 開いた順なので、来た元は必ず先に入っている
  const kids = childrenMap(route, new Set(steps.map((s) => s.id)));
  const taken = new Set<string>();
  const offsets = new Map<string, Hex>();
  const lineOf = (start: RouteStep) => {
    const line: RouteStep[] = [];
    let cur: RouteStep | undefined = start;
    while (cur && !offsets.has(cur.id) && !line.includes(cur)) {
      const step: RouteStep = cur;
      line.push(step);
      cur = (kids.get(step.id) ?? []).find((c) => c.lane === step.lane);
    }
    return line;
  };
  // 線を、at から右へまるごと置ける行に置く（置けなければ下へずらす。ずらしても横の位置はなるべく保つ）
  const place = (start: RouteStep, at: Hex) => {
    const line = lineOf(start);
    let origin = at;
    for (let k = 0; k < 400; k++) {
      origin = { q: at.q - Math.floor(k / 2), r: at.r + k };
      if (line.every((_, i) => !taken.has(hexKey({ q: origin.q + i, r: origin.r })))) break;
    }
    line.forEach((s, i) => {
      const cell = { q: origin.q + i, r: origin.r };
      offsets.set(s.id, cell);
      taken.add(hexKey(cell));
    });
    for (const s of line) {
      const cell = offsets.get(s.id) as Hex;
      for (const c of kids.get(s.id) ?? []) {
        if (!offsets.has(c.id)) place(c, { q: cell.q, r: cell.r + 1 });
      }
    }
  };
  let row = 0;
  for (const root of kids.get(null) ?? []) {
    if (offsets.has(root.id)) continue;
    place(root, { q: 0, r: row });
    row = Math.max(...[...offsets.values()].map((h) => h.r)) + 2;
  }
  return { steps: steps.filter((s) => offsets.has(s.id)), offsets };
}

export interface RouteLink {
  from: Tab;
  to: Tab;
  branch: boolean; // 枝をまたぐ（新しいタブで開いた先）
}

// 盤面に描く線：順路にいるタブどうしを、来た元をさかのぼって最初に出会うタブとつなぐ
export function routeLinks(route: Route, tabs: Tab[]): { links: RouteLink[]; numbers: Map<number, number> } {
  const byId = new Map(route.steps.map((s, i) => [s.id, { step: s, n: i + 1 }]));
  const members = tabs.filter((t) => t.trail?.route === route.id && byId.has(t.trail.step));
  const atStep = new Map<string, Tab>();
  const inLane = new Map<string, Tab>();
  for (const t of members) {
    const trail = t.trail as TabTrail;
    if (!atStep.has(trail.step)) atStep.set(trail.step, t);
    if (!inLane.has(trail.lane)) inLane.set(trail.lane, t);
  }
  const links: RouteLink[] = [];
  for (const t of members) {
    const trail = t.trail as TabTrail;
    let cur = byId.get(trail.step)?.step;
    let crossed = false;
    const seen = new Set<string>();
    while (cur?.from && !seen.has(cur.id)) {
      seen.add(cur.id);
      const parent: RouteStep | undefined = byId.get(cur.from)?.step;
      if (!parent) break;
      if (parent.lane !== cur.lane) crossed = true;
      const here = atStep.get(parent.id);
      const other = here && here !== t ? here : parent.lane !== trail.lane ? inLane.get(parent.lane) : undefined;
      if (other && other !== t) {
        links.push({ from: other, to: t, branch: crossed });
        break;
      }
      cur = parent;
    }
  }
  const numbers = new Map(members.map((t) => [t.id, byId.get((t.trail as TabTrail).step)?.n ?? 0]));
  return { links, numbers };
}

// ---------- 読み込み ----------

function parseRoute(raw: unknown): Route | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !Array.isArray(r.steps)) return null;
  const steps: RouteStep[] = [];
  for (const s of r.steps) {
    if (typeof s !== 'object' || s === null) continue;
    const x = s as Record<string, unknown>;
    if (typeof x.id !== 'string' || typeof x.url !== 'string' || typeof x.lane !== 'string') continue;
    steps.push({
      id: x.id,
      url: x.url,
      title: typeof x.title === 'string' ? x.title : '',
      at: typeof x.at === 'number' ? x.at : 0,
      from: typeof x.from === 'string' ? x.from : null,
      lane: x.lane,
    });
  }
  if (steps.length === 0) return null;
  const route: Route = {
    id: r.id,
    name: typeof r.name === 'string' ? cleanName(r.name) : '',
    color: typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : TAG_PALETTE[0],
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : steps[0].at,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : steps[0].at,
    saved: r.saved === true,
    steps: steps.slice(0, MAX_STEPS),
  };
  const j = r.journal as Record<string, unknown> | undefined;
  if (j && typeof j === 'object' && typeof j.summary === 'string') {
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    route.journal = {
      at: typeof j.at === 'number' ? j.at : 0,
      cost: typeof j.cost === 'number' ? j.cost : 0,
      title: typeof j.title === 'string' ? j.title : '',
      summary: j.summary,
      flow: Array.isArray(j.flow)
        ? j.flow
            .filter((f): f is { steps: unknown; text: string } => typeof f === 'object' && f !== null && typeof (f as { text?: unknown }).text === 'string')
            .map((f) => ({ steps: Array.isArray(f.steps) ? f.steps.filter((n): n is number => Number.isInteger(n)) : [], text: f.text }))
        : [],
      findings: strings(j.findings),
      questions: strings(j.questions),
    };
  }
  return route;
}

export function isTabTrail(value: unknown): value is TabTrail {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as Record<string, unknown>;
  return typeof t.route === 'string' && typeof t.step === 'string' && typeof t.lane === 'string';
}
