// Grok Cards の機械のタグ（計画の段 4。作者 1 の仮の既定）
//   宛て先はメモのタグの頭に付ける。ふつうのタグの一覧・候補には出さない（付いていなければ、今までと変わらない）
//   頭の字はここだけ。段 5 の「送った:」も、同じ置き場にする
import { t } from './i18n';
//   カードの印（♥・色。MK5）も隠す。こちらは頭の字でなく、likes.ts の値の一覧とぴったり同じタグだけ（isMarkTag）
import { MARK_COUNT_NOTE, markValues } from './likes';
import { normalizeTag } from './tags';

export const ADDRESS_PREFIX = '宛て:';
export const SENT_PREFIX = '送った:';
export const PASTED_PREFIX = '貼った:';
// アプリのチャットだけ（依頼を作らない）の印。仮。requestId は無い
export const CHAT_SENT = 'chat';
// みんなの列。ボットの id ではない（ボットの id は b で始まる）
export const EVERYONE_ADDRESS = 'all';

// bots.ts の BOT_ID_RE と同じ形（ここから bots.ts を読むと、テストが橋まで読んでしまう）
const BOT_ID_RE = /^b[0-9a-z]{4,24}$/;

export function isCardsBotId(value: string): boolean {
  return BOT_ID_RE.test(value);
}

const MARK_SET: ReadonlySet<string> = new Set(markValues);

// カードの印（♥:1〜3・⬢:水・⬢:若草・⬢:赤紫）か。値の一覧とぴったり同じものだけ（人が手で付けた「♥:9」「色:赤」などは印でない）
export function isMarkTag(tag: string): boolean {
  return MARK_SET.has(tag);
}

export function isMachineTag(tag: string): boolean {
  return tag.startsWith(ADDRESS_PREFIX) || tag.startsWith(SENT_PREFIX) || tag.startsWith(PASTED_PREFIX) || isMarkTag(tag);
}

// ふつうのタグの上限の断りの後ろに足す一言（印が付いているカードのときだけ。付いていなければ空）
export const markCountNote = (tags: readonly string[]): string => (tags.some(isMarkTag) ? MARK_COUNT_NOTE : '');

// ふつうのタグの命令（changeReplyTags）の add・remove から、印の値を捨てる（印は setReplyMark だけで変わる）。配列でなければ空
//   整えたあとの字で見る（「#♥:1」「＃⬢:水」も印）。ほかの値は、字でないものもそのまま残す（左の changeTagList が整えて読み捨てる）
export function dropMarkValues(list: unknown): unknown[] {
  return Array.isArray(list) ? list.filter((value) => !isMarkTag(normalizeTag(value))) : [];
}

export function visibleTags(tags: readonly string[]): string[] {
  return tags.filter((tag) => !isMachineTag(tag));
}

// 最初の「宛て:」を使う。2 つ以上あれば duplicate（札に「宛て先が二つ」）
export function parseAddress(tags: readonly string[]): { address: string | null; duplicate: boolean } {
  const found: string[] = [];
  for (const tag of tags) {
    if (!tag.startsWith(ADDRESS_PREFIX)) continue;
    const value = tag.slice(ADDRESS_PREFIX.length);
    if (!value) continue;
    found.push(value);
  }
  if (found.length === 0) return { address: null, duplicate: false };
  return { address: found[0], duplicate: found.length > 1 };
}

// 仮の既定：並びのうしろの「送った:」を新しい方とする（段 5 で付ける。この PR は読むだけ）
export function parseSent(tags: readonly string[]): { raw: string; group: number | null } | null {
  let raw: string | null = null;
  for (const tag of tags) {
    if (!tag.startsWith(SENT_PREFIX)) continue;
    const value = tag.slice(SENT_PREFIX.length);
    if (value) raw = value;
  }
  if (raw === null) return null;
  const group = /^g(\d+)$/.exec(raw);
  return { raw, group: group ? Number(group[1]) : null };
}

export function addressTag(address: string): string {
  return `${ADDRESS_PREFIX}${address}`;
}

// 依頼の番号・組・チャットだけの印。これ以外は札に書かない
const REQUEST_SENT = /^hb-\d{8}-\d{4,6}-[0-9a-z]{4}$/;
const GROUP_SENT = /^g[1-9]\d{0,8}$/;

export function isSentRaw(raw: string): boolean {
  return raw === CHAT_SENT || REQUEST_SENT.test(raw) || GROUP_SENT.test(raw);
}

export function groupSent(group: number): string {
  return `g${group}`;
}

export function parsePasted(tags: readonly string[]): string | null {
  let raw: string | null = null;
  for (const tag of tags) {
    if (!tag.startsWith(PASTED_PREFIX)) continue;
    const value = tag.slice(PASTED_PREFIX.length);
    if (value) raw = value;
  }
  return raw;
}

// 送った印は最後の 1 件。付け直すと、前の「貼った」も外れる（また貼る前に戻る）
export function withSentTag(tags: readonly string[], raw: string): string[] {
  return [...tags.filter((tag) => !tag.startsWith(SENT_PREFIX) && !tag.startsWith(PASTED_PREFIX)), `${SENT_PREFIX}${raw}`];
}

// 今の「送った」と同じ印を「貼った」に足す。送った印が無ければ null
export function withPastedTag(tags: readonly string[]): string[] | null {
  const sent = parseSent(tags);
  if (!sent) return null;
  return [...tags.filter((tag) => !tag.startsWith(PASTED_PREFIX)), `${PASTED_PREFIX}${sent.raw}`];
}

export function withoutSent(tags: readonly string[]): string[] {
  return tags.filter((tag) => !tag.startsWith(SENT_PREFIX) && !tag.startsWith(PASTED_PREFIX));
}

// 作者 5 の仮の既定。止めない。外へは送らない。型の並びはここだけ
export const SECRET_PATTERNS: readonly RegExp[] = [/sk-[A-Za-z0-9_-]{8,}/, /password\s*=/i, /[A-Za-z0-9_-]{24,}/];

export const SECRET_NOTICE = t('鍵のような字があります');

export function looksLikeSecret(text: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(text));
}
