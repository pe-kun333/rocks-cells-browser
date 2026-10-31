// 型の窓（パレット）の純粋な部分（計画書 docs/plan-card-templates.md の Phase 2。DOM・台帳は触らない）
//   ・検索：名前・フォルダ・カードの文・タグを、空白で区切った語すべてに当てる（全角・半角・大文字小文字をそろえる）
//   ・選び方：矢印・Home・End で、見えている並びの中を動く
//   ・ゴースト：貼ると入る番地を、実際の貼り付けと同じ計算（buildPasteDraft ＋ topSlots）で予告する
//   ・サムネイル：カードの位置（dx・dy）を、小さな箱に収めた四角と線にする
import { t as tr } from './i18n';
import { linkKindInfo, type LinkKind } from './memo-card-links';
import { buildPasteDraft, type CardTemplate, MODE_LABELS, TEMPLATE_GRID, type TemplateFolder } from './memo-card-templates';
import { templateMenuGroups } from './memo-card-template-store';
import { topSlots, type Reply } from './threads';

// ---------- 検索・絞り込み ----------

const normalize = (s: string) => s.normalize('NFKC').toLowerCase();

export function queryWords(query: string): string[] {
  return normalize(query)
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

// 型 1 件を探すための文（名前・フォルダ・カードの題と本文・タグ）
export function templateHaystack(t: CardTemplate): string {
  const parts = [t.name, t.folder];
  for (const card of t.cards) parts.push(card.title, card.body, ...card.tags);
  return normalize(parts.join('\n'));
}

// 語が無ければ全部。語は全部（AND）当たった型だけ。folder があれば、そのフォルダだけ。並びは元のまま
export function searchTemplates(list: readonly CardTemplate[], query: string, folder: TemplateFolder | null = null): CardTemplate[] {
  const words = queryWords(query);
  return list.filter((t) => {
    if (folder !== null && t.folder !== folder) return false;
    if (words.length === 0) return true;
    const hay = templateHaystack(t);
    return words.every((w) => hay.includes(w));
  });
}

// 見えている並び（フォルダの順にまとめた、そのままの上から下）
export function paletteOrder(list: readonly CardTemplate[]): CardTemplate[] {
  return templateMenuGroups(list).flatMap((g) => g.items);
}

// ---------- キーボードで選ぶ ----------

export type PaletteKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';

export function isPaletteKey(key: string): key is PaletteKey {
  return key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End';
}

// ids：見えている並びの id。current：今選んでいる id（無い・並びに無いときは null 扱い）。端では反対の端へ回る。並びが空なら null
export function moveSelection(ids: readonly string[], current: string | null, key: PaletteKey): string | null {
  if (ids.length === 0) return null;
  if (key === 'Home') return ids[0];
  if (key === 'End') return ids[ids.length - 1];
  const at = current === null ? -1 : ids.indexOf(current);
  if (at < 0) return key === 'ArrowDown' ? ids[0] : ids[ids.length - 1];
  const next = key === 'ArrowDown' ? (at + 1) % ids.length : (at - 1 + ids.length) % ids.length;
  return ids[next];
}

// 見えている並びの中に current があればそれ、無ければ先頭（絞り込みで選びが消えたとき）
export function keepSelection(ids: readonly string[], current: string | null): string | null {
  if (current !== null && ids.includes(current)) return current;
  return ids[0] ?? null;
}

// ---------- ゴースト（貼ると入る番地の予告） ----------

export type GhostResult =
  | { ok: true; slots: number[]; first: number; rows: number }
  | { ok: false; why: 'invalid' | 'full'; room?: number; need?: number };

// existing：今見せている並びの返信（待ちの並べ替えを当てたもの）。slots は型のカードの順に、貼ったあとの番地（行 × 3 ＋ 列）
export function ghostSlots(template: CardTemplate, existing: readonly Reply[]): GhostResult {
  let n = 0;
  const draft = buildPasteDraft(template, { existing, newId: () => `~ghost${(n++).toString(36)}`, now: 0 });
  if (!draft.ok) return draft;
  const slots = topSlots([...existing, ...draft.replies]);
  const out = draft.newTopIds.map((id) => slots.get(id) ?? -1);
  if (out.some((s) => s < 0)) return { ok: false, why: 'invalid' };
  const first = Math.min(...out);
  const last = Math.max(...out);
  return { ok: true, slots: out, first, rows: Math.floor(last / 3) - Math.floor(first / 3) + 1 };
}

// ---------- サムネイル ----------

export interface ThumbCard {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ThumbLink {
  from: string;
  to: string;
  kind: LinkKind;
  dashed: boolean;
  x1: number; // 元のカードの縁
  y1: number;
  x2: number; // 相手のカードの縁
  y2: number;
}

export interface ThumbLayout {
  w: number;
  h: number;
  cards: ThumbCard[];
  links: ThumbLink[];
}

// 中心 c の四角（半幅 hw・半高 hh）から、相手の中心 p の向きへ出る縁の点
function edgePoint(cx: number, cy: number, hw: number, hh: number, px: number, py: number): { x: number; y: number } {
  const dx = px - cx;
  const dy = py - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const t = Math.min(dx === 0 ? Number.POSITIVE_INFINITY : hw / Math.abs(dx), dy === 0 ? Number.POSITIVE_INFINITY : hh / Math.abs(dy));
  return { x: cx + dx * t, y: cy + dy * t };
}

// box（w × h）に、型のカードの並び（dx・dy は左上。1 枚は TEMPLATE_GRID の大きさ）を収める。大きくしすぎない（maxScale）
export function thumbLayout(template: CardTemplate, box: { w: number; h: number; pad?: number; maxScale?: number }): ThumbLayout {
  const pad = box.pad ?? 4;
  const cw = TEMPLATE_GRID.cardW;
  const ch = TEMPLATE_GRID.cardH;
  const cards = template.cards;
  if (cards.length === 0) return { w: box.w, h: box.h, cards: [], links: [] };
  const minX = Math.min(...cards.map((c) => c.dx));
  const minY = Math.min(...cards.map((c) => c.dy));
  const bw = Math.max(...cards.map((c) => c.dx)) - minX + cw;
  const bh = Math.max(...cards.map((c) => c.dy)) - minY + ch;
  const scale = Math.min((box.w - pad * 2) / bw, (box.h - pad * 2) / bh, box.maxScale ?? 0.4);
  const ox = (box.w - bw * scale) / 2;
  const oy = (box.h - bh * scale) / 2;
  const r = (v: number) => Math.round(v * 100) / 100;
  const placed = new Map<string, ThumbCard>();
  const outCards: ThumbCard[] = cards.map((c) => {
    const item = { key: c.key, x: r(ox + (c.dx - minX) * scale), y: r(oy + (c.dy - minY) * scale), w: r(cw * scale), h: r(ch * scale) };
    placed.set(c.key, item);
    return item;
  });
  const links: ThumbLink[] = [];
  for (const link of template.links) {
    const a = placed.get(link.from);
    const b = placed.get(link.to);
    if (!a || !b || a === b) continue;
    const acx = a.x + a.w / 2;
    const acy = a.y + a.h / 2;
    const bcx = b.x + b.w / 2;
    const bcy = b.y + b.h / 2;
    const p = edgePoint(acx, acy, a.w / 2, a.h / 2, bcx, bcy);
    const q = edgePoint(bcx, bcy, b.w / 2, b.h / 2, acx, acy);
    links.push({ from: link.from, to: link.to, kind: link.kind, dashed: linkKindInfo(link.kind).dashed, x1: r(p.x), y1: r(p.y), x2: r(q.x), y2: r(q.y) });
  }
  return { w: box.w, h: box.h, cards: outCards, links };
}

// 一覧の 2 行目：フォルダ・枚数・関連の本数
export function paletteMeta(t: CardTemplate): string {
  return tr('{0}・{1}枚・関連 {2}本・{3}', { 0: t.folder, 1: t.cards.length, 2: t.links.length, 3: MODE_LABELS[t.mode] });
}

// ゴーストの文：入る番地を、行と列で言う（読み上げにも使う）
export function ghostSummary(result: GhostResult): string {
  if (!result.ok) {
    return result.why === 'full' ? tr('このメモには入りきりません（あと {0} 枚まで、型は {1} 枚です）', { 0: result.room ?? 0, 1: result.need ?? 0 }) : tr('型の中身を読めません');
  }
  const at = (slot: number) => tr('{0} 行目の {1} 列目', { 0: Math.floor(slot / 3) + 1, 1: (slot % 3) + 1 });
  const last = result.slots[result.slots.length - 1];
  return result.slots.length === 1 ? tr('{0}に入ります', { 0: at(result.first) }) : tr('{0}から {1}まで、{2} 枚が入ります', { 0: at(result.first), 1: at(last), 2: result.slots.length });
}

// ---------- 窓の型を、カードの区画へドラッグして貼る（Phase 2 の残り。つまみは pointer-grab.ts） ----------

export type DropAction = 'paste' | 'refuse' | 'none';

// 離したときにすること：区画の外なら何もしない／区画の上で、入りきらなければ断る（貼る道で理由を出す）／入れば貼る
export function dropAction(over: boolean, blocked: string | null): DropAction {
  if (!over) return 'none';
  return blocked ? 'refuse' : 'paste';
}

// つまんでいる間の知らせ：札（ポインターの横）・窓の下の行・赤字にするか
export function dragNote(t: Pick<CardTemplate, 'name' | 'cards'>, over: boolean, blocked: string | null): { chip: string; info: string; error: boolean } {
  const head = tr('＋ {0}（{1}枚）', { 0: t.name, 1: t.cards.length });
  if (!over) return { chip: head, info: tr('カードの区画の上で離すと貼ります。ここで離しても何もしません（Esc でやめます）'), error: false };
  if (blocked) return { chip: tr('{0}：貼れません', { 0: head }), info: blocked, error: true };
  return { chip: tr('{0}：離すと貼る', { 0: head }), info: tr('離すと「{0}」を貼ります（点線の所に入ります）', { 0: t.name }), error: false };
}