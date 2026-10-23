// 依頼の小窓の定型（依頼の小窓 v2・R4a。docs/bot-cells/plan-request-v2.md D9・D10・§4.1、計画の Q4・Q7・Q8）
//   ・置き場は ui-data\bots\presets.json（書くのは左だけ。bot-preset-store.ts の BotPresetStore）。右と読む画面は写し
//     （relay の bots の presets・botAsk の presets）を見て、使った回数は命令 botPresetUsed で左に頼む
//   ・組（sets）は入口ごとに、数字キーで入る手元（hand）を 6 つまで持つ。組を替える軸は入口だけ（Q7）。
//     棚（shelf）は全部の組で一つで、小窓の「その他 ▾」に出る。蔵（vault）・寿命・当たり／ずれの数を整えるのは R4b（巣の ⚙ の棚）
//   ・穴：{選んだ文}・{題名}・{前の返事の要点}。小窓を開いたとき・付けるものを変えたときに、付けているものだけで埋める。
//     埋まらない穴を含む一文は消え、全部消えたら（1 文だけの定型なら）押せない（fillPreset が null）。
//     {前の返事の要点}（R5）は「続きとして」を選び、要点の行に 1 つでも印があるときだけ「#0010 の要点」で埋まる
//     （要点の中身は頼む文に入れず、添えた情報〔データ〕の枠の「前の返事 #0010（データ）：」に入る。bot-send.ts の attachBlock）
//   ・入口「続けて聞く」（R5）：回答カード・巣の「続けて聞く」で開いた小窓。その組が無い presets.json（R4a で書いたもの）は、
//     R4a までと同じ巣の組で開く（その組は R4b の巣の ⚙ の定型タブで「組『続き』を用意する」で足せる）
//   ・棚（R4b・D10。巣の ⚙ の「定型」タブ）：置き場は手元（組ごとの 6）・棚（全部の組で一つ）・蔵（検索でだけ出る）の三段。
//     棚の定型は 30 日使わないと蔵へ沈む（shelfOf。手元は人が選んだものなので沈めず、灰色にするだけ。消すのは人）。
//     寿命（lifeExpired）：今日だけ＝日付が変わったら・この調べものの間＝7 日使わなかったら、手元・棚から蔵へ（寿命はそこで終わり、ずっとに戻る）。
//     時計の起点は「使った・置いた・寿命を決めた・直した」のうち新しい時刻（presetClock。置き直すと 30 日も寿命も数え直し）。
//     棚から 3 回使ったら、手元の一番使っていない定型と入れ替えるかを名指しで一度だけ聞く（presetSwapAsk。答えたら swapAsked）。
//     言い回しの近い定型（similar）は棚卸しで並べて見せる。声をかけるのは月に一度か、定型が 30 を超えたとき一度だけ（reviewDue）。
//     送った依頼から拾う（presetTemplate）：URL・題名・選んだ文の見本にあたる部分を穴にする。
//     右の編集は命令 setPresets で丸ごと渡し、左は mergePresetEdit で、使った回数・印の数などの数字は左の持ち分のまま混ぜる
//   ・ここは import の無い純粋な関数だけ（DOM もファイルも知らない）。使うのは小窓（panels/bot-request-form.ts）・巣の ⚙（panels/bot-nest-settings.ts）と左の BotPresetStore

// 開いた入口（ページ＝右クリック・Ctrl+Shift+G／メモのセル／六角スクショ／巣／続けて聞く〔R5〕）
export type BotPresetEntry = 'page' | 'memo' | 'shot' | 'nest' | 'follow';
export const PRESET_ENTRY_LABEL: Readonly<Record<BotPresetEntry, string>> = { page: 'ページ', memo: 'メモのセル', shot: '六角スクショ', nest: '巣', follow: '続けて聞く' };
const isEntry = (value: unknown): value is BotPresetEntry => typeof value === 'string' && Object.hasOwn(PRESET_ENTRY_LABEL, value);

export type BotPresetLife = 'forever' | 'today' | 'case'; // ずっと／今日だけ／この調べものの間（R4b）
export type BotPresetShelf = 'hand' | 'shelf' | 'vault'; // 手元（組の 6 つ）／棚（その他 ▾）／蔵（R4b。検索でだけ出る）
export const PRESET_LIFE_LABEL: Readonly<Record<BotPresetLife, string>> = { forever: 'ずっと', today: '今日だけ', case: 'この調べものの間' };
export const PRESET_SHELF_LABEL: Readonly<Record<BotPresetShelf, string>> = { hand: '手元', shelf: '棚', vault: '蔵' };

export interface BotPresetSet {
  id: string;
  name: string; // 小窓の「定型の組 ◀ 読みもの ▶」に出す名前
  entry: BotPresetEntry; // この入口で開いたら、はじめにこの組
  hand: string[]; // 手元の定型の id（数字キー 1〜6 の順）
}

export interface BotPreset {
  id: string;
  text: string; // 1 行（改行は持たない）。穴は {選んだ文}・{題名}・{前の返事の要点}
  createdAt: string; // ISO の時刻
  from?: { requestId?: string; entry?: BotPresetEntry }; // 送った依頼から拾ったとき（R4b）
  lastUsedAt?: string; // 最後に押した・取り込んだ時刻
  uses: number;
  hits: number; // 当たり・ずれ・宛て先違いの数（R9 の印が溜まる）
  misses: number;
  wrongTo: number;
  life: BotPresetLife;
  shelf: BotPresetShelf; // どの組かの手元にあれば hand（normalizePresets がそろえる）
  // 棚（R4b）。どれも R4b より前のファイルには無い（無ければ createdAt・0・まだ聞いていない、として読む）
  keptAt?: string; // 置いた・寿命を決めた・文を直した時刻（30 日と寿命の時計の起点の一つ。presetClock）
  shelfUses?: number; // 棚にいるあいだに使った回数（3 回で入れ替えの声かけ。棚から出たら消す）
  swapAsked?: true; // 入れ替えの声かけに答えた（一度だけ聞く。棚から出たら消す）
  lastSet?: string; // 最後に使ったときの組の id（入れ替える相手の手元を決める）
}

// 棚卸し（R4b）：最後に声をかけた（並べて見た・あとでにした）時刻、30 を超えたときの声かけを済ませたか、「別物」と決めた組の対
export interface BotPresetReview {
  at?: string;
  over30?: true;
  apart?: string[]; // 「a|b」（id の小さい方が先）
}

// 組と定型（右と読む画面の写しもこの形。読む画面の写しには蔵を入れない〔presetsBrief〕）
export interface BotPresets {
  sets: BotPresetSet[];
  presets: BotPreset[];
  review?: BotPresetReview; // 棚卸し（R4b）
}

// 印の数（R9 の bots.ts の BotMarkCount と同じ形。ここは import しないので形だけ書く）
export interface PresetMarkCount {
  hits: number;
  misses: number;
  wrongTo: number;
}

export interface BotPresetFile extends BotPresets {
  version: 1;
}

export const PRESET_HAND_MAX = 6; // 数字キーの 1〜6
export const PRESET_TEXT_MAX = 200; // 定型の文の字数（穴は埋める前の形で数える）
export const PRESET_COUNT_MAX = 1_000_000_000;
export const PRESET_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const PRESET_NAME_MAX = 20;
const PRESET_SETS_MAX = 12;
const PRESET_MAX = 300;
const REQUEST_ID_RE = /^hb-[A-Za-z0-9-]{1,60}$/;
const CANDIDATE_MIN = 2; // 打ちながら候補を出すのは、最後の行が 2 字から
const QUOTE_MAX = 24; // {選んだ文} に入れる見本の字数（全文は添えた情報に入る）
const TITLE_MAX = 40; // {題名} に入れる字数
const DAY = 24 * 60 * 60 * 1000;
export const PRESET_SINK_DAYS = 30; // 棚の定型が蔵へ沈むまで（使わなかった日数。手元は灰色になるだけ）
export const PRESET_CASE_DAYS = 7; // 寿命「この調べものの間」：この日数使わなかったら、調べものは終わったとみなす
export const PRESET_SWAP_USES = 3; // 棚からこの回数使ったら、手元と入れ替えるかを聞く
export const PRESET_REVIEW_COUNT = 30; // 定型がこの数を超えたら、棚卸しの声を一度だけかける
export const PRESET_REVIEW_DAYS = 30; // 棚卸しの声をかける間（月に一度）
const REVIEW_APART_MAX = 200; // 「別物」と決めた対を覚える数

// 見えない制御文字・向きを変える文字・BOM（bot-replies.ts の cleanBotText と同じ字）を空白にして、1 行にまとめる
const INVISIBLE_RE = /[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩﻿]/g;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function cleanLine(value: unknown, max: number): string {
  const text = String(value ?? '')
    .replace(INVISIBLE_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = [...text];
  return chars.length > max ? chars.slice(0, max).join('').trim() : text;
}

function isoTime(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 40) return undefined;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

const count = (value: unknown) => (Number.isInteger(value) && (value as number) > 0 ? Math.min(PRESET_COUNT_MAX, value as number) : 0);

function parsePreset(raw: unknown, now: number): BotPreset | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !PRESET_ID_RE.test(raw.id)) return null;
  const text = cleanLine(raw.text, PRESET_TEXT_MAX);
  if (!text) return null;
  const from = isRecord(raw.from)
    ? {
        ...(typeof raw.from.requestId === 'string' && REQUEST_ID_RE.test(raw.from.requestId) ? { requestId: raw.from.requestId } : {}),
        ...(isEntry(raw.from.entry) ? { entry: raw.from.entry } : {}),
      }
    : null;
  const lastUsedAt = isoTime(raw.lastUsedAt);
  const keptAt = isoTime(raw.keptAt);
  const shelfUses = count(raw.shelfUses);
  return {
    id: raw.id,
    text,
    createdAt: isoTime(raw.createdAt) ?? new Date(now).toISOString(),
    ...(from && Object.keys(from).length ? { from } : {}),
    ...(lastUsedAt ? { lastUsedAt } : {}),
    uses: count(raw.uses),
    hits: count(raw.hits),
    misses: count(raw.misses),
    wrongTo: count(raw.wrongTo),
    life: raw.life === 'today' || raw.life === 'case' ? raw.life : 'forever',
    shelf: raw.shelf === 'hand' || raw.shelf === 'vault' ? raw.shelf : 'shelf',
    ...(keptAt ? { keptAt } : {}),
    ...(shelfUses ? { shelfUses } : {}),
    ...(raw.swapAsked === true ? { swapAsked: true as const } : {}),
    ...(typeof raw.lastSet === 'string' && PRESET_ID_RE.test(raw.lastSet) ? { lastSet: raw.lastSet } : {}),
  };
}

// 棚卸しの覚え（形の違うものは捨てる。「別物」の対は形の合うものだけ、新しい 200 対まで）
function parseReview(raw: unknown): BotPresetReview | undefined {
  if (!isRecord(raw)) return undefined;
  const at = isoTime(raw.at);
  const apart = Array.isArray(raw.apart)
    ? [...new Set(raw.apart.filter((key): key is string => typeof key === 'string' && key.split('|').length === 2 && key.split('|').every((id) => PRESET_ID_RE.test(id))))].slice(-REVIEW_APART_MAX)
    : [];
  const review: BotPresetReview = { ...(at ? { at } : {}), ...(raw.over30 === true ? { over30: true as const } : {}), ...(apart.length ? { apart } : {}) };
  return Object.keys(review).length ? review : undefined;
}

function parseSet(raw: unknown, presets: readonly BotPreset[]): BotPresetSet | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !PRESET_ID_RE.test(raw.id) || !isEntry(raw.entry)) return null;
  const hand: string[] = [];
  for (const id of Array.isArray(raw.hand) ? raw.hand : []) {
    if (hand.length >= PRESET_HAND_MAX) break;
    if (typeof id === 'string' && !hand.includes(id) && presets.some((p) => p.id === id)) hand.push(id);
  }
  return { id: raw.id, name: cleanLine(raw.name, PRESET_NAME_MAX) || PRESET_ENTRY_LABEL[raw.entry], entry: raw.entry, hand };
}

// 組と定型を使える形に直す（形の違うものは null。知らない値は既定に、同じ id は前のものだけ、組の手元は在る定型だけ 6 つまで）。
//   どれかの組の手元にある定型は shelf を hand に、どの手元にも無い hand は棚（shelf）に戻す（数字キーで入るのは手元だけ）
export function normalizePresets(raw: unknown, now = Date.now()): BotPresets | null {
  if (!isRecord(raw) || !Array.isArray(raw.sets) || !Array.isArray(raw.presets)) return null;
  const presets: BotPreset[] = [];
  for (const item of raw.presets) {
    if (presets.length >= PRESET_MAX) break;
    const p = parsePreset(item, now);
    if (p && !presets.some((x) => x.id === p.id)) presets.push(p);
  }
  const sets: BotPresetSet[] = [];
  for (const item of raw.sets) {
    if (sets.length >= PRESET_SETS_MAX) break;
    const s = parseSet(item, presets);
    if (s && !sets.some((x) => x.id === s.id)) sets.push(s);
  }
  const inHand = new Set(sets.flatMap((s) => s.hand));
  for (const p of presets) {
    if (inHand.has(p.id)) p.shelf = 'hand';
    else if (p.shelf === 'hand') p.shelf = 'shelf';
    if (p.shelf !== 'shelf') {
      // 棚にいるあいだだけの数（R4b）。手元・蔵に移ったら消す
      delete p.shelfUses;
      delete p.swapAsked;
    }
    if (p.lastSet && !sets.some((s) => s.id === p.lastSet)) delete p.lastSet;
  }
  const review = parseReview(raw.review);
  return { sets, presets, ...(review ? { review } : {}) };
}

// 右と読む画面に送る写し（組・手元・棚。vault：蔵も入れる〔右の巣の ⚙ の棚。読む画面の小窓には要らない〕。
//   counts：印の数を足す分〔R4b。左が pending.json の印を数えたもの〕。ファイルの数に足して載せる。右から戻ってきても左は数字を使わない）
export function presetsBrief(presets: BotPresets, opts: { vault?: boolean; counts?: Readonly<Record<string, PresetMarkCount>> } = {}): BotPresets {
  return {
    sets: presets.sets.map((s) => ({ ...s, hand: [...s.hand] })),
    presets: presets.presets
      .filter((p) => opts.vault || p.shelf !== 'vault')
      .map((p) => {
        const add = opts.counts && Object.hasOwn(opts.counts, p.id) ? opts.counts[p.id] : null;
        const sum = (a: number, b: number | undefined) => Math.min(PRESET_COUNT_MAX, a + (Number.isInteger(b) && (b as number) > 0 ? (b as number) : 0));
        return {
          ...p,
          ...(p.from ? { from: { ...p.from } } : {}),
          ...(add ? { hits: sum(p.hits, add.hits), misses: sum(p.misses, add.misses), wrongTo: sum(p.wrongTo, add.wrongTo) } : {}),
        };
      }),
    ...(presets.review ? { review: { ...presets.review, ...(presets.review.apart ? { apart: [...presets.review.apart] } : {}) } } : {}),
  };
}

// 開いた入口の組（無ければ、メモのセルはページの組・続けて聞くは巣の組〔R4a までと同じ〕・ほかは最初の組。組が無ければ -1）
export function presetSetIndex(sets: readonly BotPresetSet[], entry: BotPresetEntry): number {
  const i = sets.findIndex((s) => s.entry === entry);
  if (i >= 0) return i;
  const near = entry === 'memo' ? 'page' : entry === 'follow' ? 'nest' : null;
  const j = near ? sets.findIndex((s) => s.entry === near) : -1;
  return j >= 0 ? j : sets.length ? 0 : -1;
}

// 組の手元の定型（手元の順。無くなった id は飛ばす）
export function presetHand(presets: BotPresets, set: BotPresetSet | undefined): BotPreset[] {
  return (set?.hand ?? []).map((id) => presets.presets.find((p) => p.id === id)).filter((p): p is BotPreset => !!p);
}

// 棚の定型（その他 ▾。並びはファイルの順）
export function presetShelf(presets: BotPresets): BotPreset[] {
  return presets.presets.filter((p) => p.shelf === 'shelf');
}

// ---------- 棚（R4b・D10） ----------

const timeOf = (iso: string | undefined) => (iso ? Date.parse(iso) : Number.NaN);

// 時計の起点：使った・置いた・寿命を決めた・直した・作ったのうち、いちばん新しい時刻
export function presetClock(p: BotPreset): number {
  const times = [p.lastUsedAt, p.keptAt, p.createdAt].map(timeOf).filter(Number.isFinite);
  return times.length ? Math.max(...times) : 0;
}

// 30 日使っていない（手元なら灰色、棚なら蔵へ沈む）
export function presetSleeping(p: BotPreset, now: number): boolean {
  return now - presetClock(p) >= PRESET_SINK_DAYS * DAY;
}

// 寿命が切れたか。今日だけ：寿命を決めた日（無ければ作った日）の、こちらの時計の日付が変わった。
//   この調べものの間：7 日使わなかった（使えば延びる）。ずっと：切れない
export function lifeExpired(p: BotPreset, now: number): boolean {
  if (p.life === 'today') {
    const from = timeOf(p.keptAt ?? p.createdAt);
    if (!Number.isFinite(from)) return false;
    const end = new Date(from);
    end.setHours(24, 0, 0, 0); // 次の日の 0 時
    return now >= end.getTime();
  }
  if (p.life === 'case') return now - presetClock(p) >= PRESET_CASE_DAYS * DAY;
  return false;
}

// いま、どの段にいるべきか（hand／shelf／vault）。寿命が切れたら蔵。棚で 30 日使わなければ蔵。手元は時間では沈めない
export function shelfOf(p: BotPreset, now: number): BotPresetShelf {
  if (p.shelf === 'vault' || lifeExpired(p, now)) return 'vault';
  if (p.shelf === 'shelf' && presetSleeping(p, now)) return 'vault';
  return p.shelf;
}

// 定型を蔵へ（手元から外す。寿命はそこで終わり＝ずっとに戻す。棚にいるあいだの数も消す）。変えたら true
export function sinkPreset(presets: BotPresets, id: string): boolean {
  const p = presets.presets.find((x) => x.id === id);
  if (!p || p.shelf === 'vault') return false;
  for (const s of presets.sets) s.hand = s.hand.filter((x) => x !== id);
  p.shelf = 'vault';
  p.life = 'forever';
  delete p.shelfUses;
  delete p.swapAsked;
  return true;
}

// 棚から 3 回使った定型に、入れ替えを聞く相手（一度だけ。答えると swapAsked）。
//   組は最後に使ったときの組（無ければ最初の組）。手元に空きがあれば with 無し（上げるだけ）、
//   いっぱいなら一番使っていない手元の定型（使った時刻の古い順、同じなら回数の少ない順）
export function presetSwapAsk(presets: BotPresets): { preset: BotPreset; set: BotPresetSet; with?: BotPreset } | null {
  for (const p of presets.presets) {
    if (p.shelf !== 'shelf' || p.swapAsked || (p.shelfUses ?? 0) < PRESET_SWAP_USES) continue;
    const set = presets.sets.find((s) => s.id === p.lastSet) ?? presets.sets[0];
    if (!set) return null;
    const hand = presetHand(presets, set);
    if (hand.length < PRESET_HAND_MAX) return { preset: p, set };
    const least = [...hand].sort((a, b) => presetClock(a) - presetClock(b) || a.uses - b.uses)[0];
    return { preset: p, set, with: least };
  }
  return null;
}

// 入れ替える（棚の定型を組の手元の with の場所へ、with を棚へ。with が無ければ手元の終わりへ）。
//   どちらも置き直したので keptAt を今に（棚へ下げた定型がすぐ沈まないように）。変えたら true
export function swapPreset(presets: BotPresets, id: string, setId: string, withId: string | undefined, now: number): boolean {
  const p = presets.presets.find((x) => x.id === id);
  const set = presets.sets.find((s) => s.id === setId);
  if (!p || !set || p.shelf === 'hand') return false;
  const stamp = new Date(now).toISOString();
  const at = withId ? set.hand.indexOf(withId) : -1;
  if (at >= 0) {
    set.hand[at] = id;
    const out = presets.presets.find((x) => x.id === withId);
    if (out && !presets.sets.some((s) => s.hand.includes(out.id))) {
      out.shelf = 'shelf';
      out.keptAt = stamp;
    }
  } else if (set.hand.length < PRESET_HAND_MAX) {
    set.hand.push(id);
  } else {
    return false;
  }
  p.shelf = 'hand';
  p.keptAt = stamp;
  delete p.shelfUses;
  delete p.swapAsked;
  return true;
}

// 言い回しの近さ：穴・記号・空白を除いた文の、先頭 6 字が同じか、短い方（4 字から）が長い方に入っている
const SIMILAR_HEAD = 6;
const SIMILAR_MIN = 4;
function bare(text: string): string {
  return text.replace(HOLE_RE, '').replace(/[\s\p{P}\p{S}]/gu, '');
}
export function similar(a: string, b: string): boolean {
  const x = [...bare(a)];
  const y = [...bare(b)];
  if (!x.length || !y.length) return false;
  const head = (s: string[]) => s.slice(0, SIMILAR_HEAD).join('');
  if (x.length >= SIMILAR_HEAD && y.length >= SIMILAR_HEAD && head(x) === head(y)) return true;
  const [short, long] = x.length <= y.length ? [x.join(''), y.join('')] : [y.join(''), x.join('')];
  return [...short].length >= SIMILAR_MIN && long.includes(short);
}

export const apartKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// 棚卸しで並べる組（手元・棚の定型のうち、言い回しの近いものの塊。2 つ以上。「別物」と決めた対はつながない）
export function similarGroups(presets: BotPresets): BotPreset[][] {
  const live = presets.presets.filter((p) => p.shelf !== 'vault');
  const apart = new Set(presets.review?.apart ?? []);
  const root = live.map((_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      if (apart.has(apartKey(live[i].id, live[j].id)) || !similar(live[i].text, live[j].text)) continue;
      root[find(j)] = find(i);
    }
  }
  const groups = new Map<number, BotPreset[]>();
  live.forEach((p, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), p]));
  return [...groups.values()].filter((g) => g.length >= 2);
}

// 棚卸しの声をかけるか：近い定型が 2 つ以上あり、定型が 30 を超えて初めて（over30）か、前の声かけから 30 日たった（month）。
//   前の声かけの時刻が無ければ、かけない（左が読み込んだときに今の時刻を入れる＝初めての月の終わりから）
export function reviewDue(presets: BotPresets, now: number): 'over30' | 'month' | null {
  if (!similarGroups(presets).length) return null;
  if (presets.presets.length > PRESET_REVIEW_COUNT && !presets.review?.over30) return 'over30';
  const at = timeOf(presets.review?.at);
  return Number.isFinite(at) && now - at >= PRESET_REVIEW_DAYS * DAY ? 'month' : null;
}

// 新しい定型の id（u＋時刻＋乱数。PRESET_ID_RE に合う。使った id は二度と使わない〔印の数が別の定型に付かないように〕）
export function newPresetId(taken: readonly { id: string }[], now: number): string {
  for (;;) {
    const id = `u${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    if (!taken.some((p) => p.id === id)) return id;
  }
}

// 右の編集（命令 setPresets）を、左の今の定型に混ぜる（形の違うものは null）。
//   右から取るのは、組（並び・手元）・定型の文・寿命・置き場・並び・入れ替えに答えた印・棚卸しの覚え。
//   使った時刻と回数・印の数・作った時刻・拾った元・棚で使った数・最後の組は左の持ち分のまま（右の写しの数字は印の数を足してあるので使わない）。
//   無くなった id は消す（消すのは人）。新しい id は今作ったものとして数字 0 で入れる。文・寿命・置き場を変えたら keptAt を今に。
//   clean：文を直す関数（左が鍵らしき文字を〔鍵1〕に置き換える）
export function mergePresetEdit(current: BotPresets, raw: unknown, now: number, clean: (text: string) => string = (t) => t): BotPresets | null {
  if (!isRecord(raw) || !Array.isArray(raw.sets) || !Array.isArray(raw.presets)) return null;
  const stamp = new Date(now).toISOString();
  const merged = raw.presets.map((item) => {
    if (!isRecord(item) || typeof item.id !== 'string') return item;
    const text = clean(cleanLine(item.text, PRESET_TEXT_MAX));
    const old = current.presets.find((p) => p.id === item.id);
    if (!old) return { id: item.id, text, createdAt: stamp, keptAt: stamp, uses: 0, hits: 0, misses: 0, wrongTo: 0, life: item.life, shelf: item.shelf };
    return { ...old, text, life: item.life, shelf: item.shelf, ...(item.swapAsked === true ? { swapAsked: true } : {}) }; // 答えた印は右が忘れても残す（old のまま）
  });
  const next = normalizePresets({ sets: raw.sets, presets: merged, review: raw.review }, now);
  if (!next) return null;
  for (const p of next.presets) {
    const old = current.presets.find((x) => x.id === p.id);
    if (!old) continue;
    if (old.text !== p.text || old.life !== p.life || old.shelf !== p.shelf) p.keptAt = stamp;
    if (old.shelf !== 'shelf' && p.shelf === 'shelf') {
      delete p.shelfUses; // 棚に来たところから数え直す
      delete p.swapAsked;
    }
  }
  return next;
}

// ---------- 送った依頼から拾う（R4b） ----------

const URL_RE = /https?:\/\/[^\s「」<>"]+/g;
const QUOTED_RE = /「([^「」]{1,80})」/g;

// 依頼の文（自分の文だけ。1 行）を定型の形に：URL と題名は {題名}、選んだ文の見本（「…」で終わるかぎかっこ・選んだ文の頭と同じかぎかっこ）は {選んだ文}。
//   page：その依頼に付けていたもの（下書きなら分かる。受け取り箱の頭からは分からないので無し）。200 字まで
export function presetTemplate(text: string, page: { title?: string; url?: string; selection?: string } = {}): string {
  const title = cleanLine(page.title, Number.MAX_SAFE_INTEGER);
  const selection = cleanLine(page.selection, Number.MAX_SAFE_INTEGER);
  let out = cleanLine(text, Number.MAX_SAFE_INTEGER).replace(URL_RE, '{題名}');
  out = out.replace(QUOTED_RE, (whole, inner: string) => {
    const core = inner.replace(/…$/, '').trim();
    if (!core) return whole;
    if (title && title.startsWith(core)) return '{題名}';
    if (inner.endsWith('…') || (selection && [...core].length >= SIMILAR_MIN && selection.startsWith(core))) return '{選んだ文}';
    return whole;
  });
  if (title && [...title].length >= 2) out = out.split(title).join('{題名}');
  if (selection && [...selection].length >= 8) out = out.split(selection).join('{選んだ文}');
  out = out.replace(/(\{(?:選んだ文|題名)\})(?:\s*\1)+/g, '$1'); // 同じ穴が続いたら 1 つに
  return cleanLine(out, PRESET_TEXT_MAX);
}

// ---------- 穴 ----------

export interface PresetFillValues {
  selection?: string; // 付けている選んだ文（外していれば無し）
  title?: string; // 付けている題名
  summary?: string; // 前の返事の要点（R5。続きとして選び、要点の行に印があるときだけ「#0010 の要点」。中身は添えた情報の枠に入る）
}

const HOLE_NAMES = ['選んだ文', '題名', '前の返事の要点'] as const;
type HoleName = (typeof HOLE_NAMES)[number];
const HOLE_RE = /\{(選んだ文|題名|前の返事の要点)\}/g;
const SENTENCE_RE = /[^。！？!?]+[。！？!?]*|[。！？!?]+/g;

function quote(value: string | undefined, max: number): string {
  const line = cleanLine(value, Number.MAX_SAFE_INTEGER);
  if (!line) return '';
  const chars = [...line];
  return chars.length > max ? `「${chars.slice(0, max).join('')}…」` : `「${line}」`;
}

// 穴を埋めた文（1 行）。埋まらない穴を含む一文は消し、全部消えたら null（押せない）
//   {選んだ文} は頭の 24 字の見本（全文は添えた情報に入る）、{題名} は 40 字まで、どちらも「」で囲む
export function fillPreset(text: string, values: PresetFillValues): string | null {
  const fill: Record<HoleName, string> = {
    選んだ文: quote(values.selection, QUOTE_MAX),
    題名: quote(values.title, TITLE_MAX),
    前の返事の要点: cleanLine(values.summary, PRESET_TEXT_MAX),
  };
  const kept: string[] = [];
  for (const sentence of text.match(SENTENCE_RE) ?? []) {
    let ok = true;
    const out = sentence.replace(HOLE_RE, (_, name: HoleName) => {
      if (!fill[name]) ok = false;
      return fill[name];
    });
    if (ok) kept.push(out);
  }
  return cleanLine(kept.join(''), Number.MAX_SAFE_INTEGER) || null;
}

// 定型の文を、穴とそれ以外に分ける（ボタンで穴に色を付けるため）
export function presetParts(text: string): { text: string; hole: boolean }[] {
  return text
    .split(/(\{(?:選んだ文|題名|前の返事の要点)\})/)
    .filter(Boolean)
    .map((part) => ({ text: part, hole: HOLE_NAMES.some((name) => part === `{${name}}`) }));
}

// 定型が使う穴の名前（埋まらないときの知らせに使う）
export function presetHoles(text: string): string[] {
  return [...new Set([...text.matchAll(HOLE_RE)].map((m) => m[1]))];
}

// ---------- 打ちながら候補 ----------

// 依頼文の最後の行（typed）が、定型の頭と同じか。頭は、埋めた文の頭と、穴のあとに続く言葉の頭
//   （「{選んだ文} の出典を 3 つ」なら「出典を 3 つ」。前の「の・を・は・が・に・で・と・も・へ」と空白・読点は飛ばす）。2 字から
export function presetMatches(template: string, filled: string, typed: string): boolean {
  const t = typed.trim();
  if ([...t].length < CANDIDATE_MIN || filled === t) return false;
  if (filled.startsWith(t)) return true;
  return template
    .split(HOLE_RE)
    .filter((_, i) => i >= 2 && i % 2 === 0) // 穴のあとに続く言葉だけ（奇数番めは split が捕まえた穴の名前。0 番めの頭は filled で見た）
    .map((part) => part.replace(/^[\s、，,。]*(?:[のをはがにでともへ](?=[^\s、，,。]))?[\s、，,]*/, '').trim())
    .some((head) => head.length > 0 && head.startsWith(t));
}

// ---------- 用意した定型（ファイルが無いとき。文面は見本 mock-ask-grok.html の ① と ⑤。続きの組は R5 で足した） ----------

const BORN = '2026-10-22T00:00:00.000Z';
const preset = (id: string, text: string, shelf: BotPresetShelf): BotPreset => ({ id, text, createdAt: BORN, uses: 0, hits: 0, misses: 0, wrongTo: 0, life: 'forever', shelf });
const hand = (prefix: string, texts: string[]) => texts.map((text, i) => preset(`${prefix}${i + 1}`, text, 'hand'));

const PAGE_HAND = hand('p', ['要点を 5 行に', '反対の意見を探して', '{選んだ文} の出典を 3 つ、一次資料で', '用語をやさしく', '本当か確かめて', '次に読むべきもの']);
const NEST_HAND = hand('n', ['評判を日本語の掲示板で', '似た製品と比べて', '最近 1 年の変化', '落とし穴を挙げて', '買う前に確かめること', '専門家の見解を']);
const SHOT_HAND = hand('s', ['これは何', '文字に起こして', '数字を表に', '反対の見方は', 'この図を文章に', '分かりにくい所は']);
const FOLLOW_HAND = hand('f', ['{前の返事の要点} の二つ目をもっと詳しく', '{前の返事の要点} の根拠と出典を', '反対の見方は', '具体的な例を 3 つ', '次に何をすればいい？', '分かりにくい所をやさしく']);
const SHELF = ['{題名} について、{選んだ文} の部分だけ出典を確かめて', 'この表を日本語で整理して', 'この条文の改正前と後を', '改善案を 3 つ', '手順を文章に'].map((text, i) => preset(`o${i + 1}`, text, 'shelf'));

export const DEFAULT_PRESETS: Readonly<BotPresetFile> = {
  version: 1,
  sets: [
    { id: 'page', name: '読みもの', entry: 'page', hand: PAGE_HAND.map((p) => p.id) },
    { id: 'nest', name: '調べもの', entry: 'nest', hand: NEST_HAND.map((p) => p.id) },
    { id: 'shot', name: 'スクショ', entry: 'shot', hand: SHOT_HAND.map((p) => p.id) },
    { id: 'follow', name: '続き', entry: 'follow', hand: FOLLOW_HAND.map((p) => p.id) },
  ],
  presets: [...PAGE_HAND, ...NEST_HAND, ...SHOT_HAND, ...FOLLOW_HAND, ...SHELF],
};
