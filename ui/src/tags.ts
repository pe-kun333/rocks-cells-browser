// タグ（六角メモと同じ決まり：先頭の # と空白を除く。空白と # は入れない）と、タグ・島の色
const TAG_MAX = 30; // 1つのタグの文字数（六角メモと同じ）
export const MAX_TAGS_PER_TAB = 10;

// 六角メモのタグの色と同じ並び
// theme: fixed begin：データの色（保存する値。描くときは data-colors.css でテーマの明るさの帯へ）
export const TAG_PALETTE = ['#1d9bf0', '#00ba7c', '#f59e0b', '#f91880', '#a78bfa', '#ef4444', '#14b8a6', '#eab308', '#fb7185', '#60a5fa', '#34d399', '#f97316'];
// theme: fixed end

export function normalizeTag(value: unknown): string {
  if (typeof value !== 'string') return '';
  const s = value.replace(/^[#＃\s]+/, '').replace(/[\s#＃]+/g, '').trim();
  return [...s].slice(0, TAG_MAX).join('');
}

export function normalizeTags(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const value of list) {
    const tag = normalizeTag(value);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= MAX_TAGS_PER_TAB) break;
  }
  return out;
}

// その時のタグに対して足し引きする（1 つに MAX_TAGS_PER_TAB 個まで）。tags：変わらなければ null。over：上限を超えた分を捨てた
export function changeTagList(current: readonly string[], add: readonly unknown[], remove: readonly unknown[]): { tags: string[] | null; over: boolean } {
  const drop = new Set(remove.map(normalizeTag));
  const next = current.filter((t) => !drop.has(t));
  for (const value of add) {
    const tag = normalizeTag(value);
    if (tag && !next.includes(tag)) next.push(tag);
  }
  const tags = normalizeTags(next);
  const over = tags.length < next.length;
  return { tags: tags.length === current.length && tags.every((t, i) => t === current[i]) ? null : tags, over };
}

// 六角メモに登録されている色（名前 → 色）。無ければ名前から決まった色
const registered = new Map<string, string>();
let registeredNames: string[] = []; // 六角メモに登録されているタグ（色の無いものも。タグのボタンの「その他」に出す）

export function setRegisteredTagColors(entries: { name: string; color?: string }[]) {
  registered.clear();
  for (const e of entries) if (e.color && /^#[0-9a-f]{6}$/i.test(e.color)) registered.set(e.name, e.color);
  registeredNames = [...new Set(entries.map((e) => e.name).filter(Boolean))];
}

export function registeredTagNames(): readonly string[] {
  return registeredNames;
}

export function tagColor(name: string): string {
  return registered.get(name) ?? TAG_PALETTE[hashOf(name) % TAG_PALETTE.length];
}

function hashOf(text: string) {
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return hash;
}
