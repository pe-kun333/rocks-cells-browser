// 下の区画のカードを、タグで絞る部品（絞りの処理と札の列。app/memo-pane.ts から呼ぶ）
//   タグを持つのは一番上のカード（parent === null）だけ。返信はそのカードと一緒に出る・隠れる
import { t } from './i18n';
import { isMachineTag, visibleTags } from './grok-cards-tags';
import { tagColor } from './tags';
import { byOrder, type Reply } from './threads';
import { el } from './util';

export const FILTER_CHIPS = 12; // 札に出すタグの数（あふれたものは「その他 ▾」）
const CANDIDATE_MAX = 60; // 「＋タグ」の候補の数

const isTop = (r: Reply) => r.parent === null;

// このメモの一番上のカードに付いているタグと、その枚数（多い順、同じなら名前順 'ja'）
export function cardTagCounts(replies: readonly Reply[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const reply of replies) {
    if (!isTop(reply)) continue;
    for (const tag of visibleTags(reply.tags ?? [])) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'));
}

// 見せる一番上のカード（並べた順＝byOrder。並べ替えていなければ作った順）。tag が null なら全部。keep の id は、タグが無くても見せる（絞り中に足したばかりで、タグがまだ届いていないカード）
export function visibleTops(replies: readonly Reply[], tag: string | null, keep: ReadonlySet<string>): Reply[] {
  return replies.filter((r) => isTop(r) && (tag === null || (r.tags ?? []).includes(tag) || keep.has(r.id))).sort(byOrder);
}

// つながり順：tops（見せる一番上のカード）を、関連でつながったひとまとまりごとに分ける
//   chains：2 枚以上のつながり（最初のカードの作った順。中も作った順）／loose：関連の無いカード（作った順）。並べた順（rank）は使わない
//   関連は両端とも tops にあるものだけを見る（絞りで隠れた相手への関連では、つながらない）
export function chainOrder(tops: readonly Reply[]): { chains: Reply[][]; loose: Reply[] } {
  const byId = new Map(tops.map((r): [string, Reply] => [r.id, r]));
  const pos = new Map(tops.map((r, i): [string, number] => [r.id, i]));
  const near = new Map(tops.map((r): [string, Reply[]] => [r.id, []]));
  for (const r of tops) {
    for (const link of r.links ?? []) {
      const to = byId.get(link.to);
      if (!to || to === r) continue;
      near.get(r.id)?.push(to);
      near.get(to.id)?.push(r);
    }
  }
  const byCreated = (a: Reply, b: Reply) => a.createdAt - b.createdAt || (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0);
  const seen = new Set<string>();
  const chains: Reply[][] = [];
  const loose: Reply[] = [];
  for (const start of tops) {
    if (seen.has(start.id)) continue;
    seen.add(start.id);
    const part: Reply[] = [start];
    for (const cur of part) {
      for (const next of near.get(cur.id) ?? []) {
        if (seen.has(next.id)) continue;
        seen.add(next.id);
        part.push(next);
      }
    }
    if (part.length >= 2) chains.push(part.sort(byCreated));
    else loose.push(start);
  }
  chains.sort((a, b) => byCreated(a[0], b[0]));
  loose.sort(byCreated);
  return { chains, loose };
}

// 下の区画の「＋タグ」の候補：このメモのカードのタグ（多い順）→ メモ本体のタグ → 六角メモのタグ。重なりなく 60 個まで
export function cardTagCandidates(replies: readonly Reply[], memoTags: readonly string[], registered: readonly string[]): string[] {
  const out = new Set<string>();
  for (const [tag] of cardTagCounts(replies)) out.add(tag);
  for (const tag of memoTags) if (!isMachineTag(tag)) out.add(tag);
  for (const tag of registered) if (!isMachineTag(tag)) out.add(tag);
  return [...out].slice(0, CANDIDATE_MAX);
}

// タグで絞る札の列。カードにタグが 1 つも無ければ null
export function cardFilterRow(o: { counts: readonly [string, number][]; total: number; selected: string | null; pick(tag: string | null): void }): HTMLElement | null {
  if (o.counts.length === 0) return null;
  const row = el('div', 'memo-card-filter');
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'カードをタグで絞る');
  const all = el('button', 'memo-card-filter-chip', t('すべて {0}', { 0: o.total }));
  all.type = 'button';
  all.title = t('タグで絞らない');
  all.setAttribute('aria-pressed', String(o.selected === null));
  all.dataset.focusKey = 'filter:all';
  all.addEventListener('click', () => o.pick(null));
  row.append(all);
  for (const [tag, n] of o.counts.slice(0, FILTER_CHIPS)) {
    const chip = el('button', 'memo-card-filter-chip', `${tag} ${n}`);
    chip.type = 'button';
    chip.style.setProperty('--tag', tagColor(tag));
    chip.title = t('タグ「{0}」の付いたカードだけを出す', { 0: tag });
    chip.setAttribute('aria-pressed', String(o.selected === tag));
    chip.dataset.focusKey = `filter:tag:${tag}`;
    chip.addEventListener('click', () => o.pick(o.selected === tag ? null : tag));
    row.append(chip);
  }
  const rest = o.counts.slice(FILTER_CHIPS);
  if (rest.length > 0) {
    const more = el('select', 'memo-card-filter-more');
    more.setAttribute('aria-label', 'その他のタグで絞る');
    more.dataset.focusKey = 'filter:more';
    const first = el('option', '', t('その他 ▾'));
    first.value = '';
    more.append(first);
    for (const [tag, n] of rest) {
      const option = el('option', '', `${tag} ${n}`);
      option.value = tag;
      more.append(option);
    }
    if (o.selected !== null && rest.some(([tag]) => tag === o.selected)) more.value = o.selected;
    more.addEventListener('change', () => o.pick(more.value || null));
    row.append(more);
  }
  return row;
}
