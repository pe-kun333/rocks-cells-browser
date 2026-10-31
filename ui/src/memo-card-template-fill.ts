// 穴埋めファイル honeycomb-cardtpl-fill の検査と、空欄の小窓への先入れの値づくり（計画書 docs/plan-card-templates-grok-draft.md の Phase 5d。純粋な部分）
//   形：{ format: 'honeycomb-cardtpl-fill', version: 1, template: { id?, name? }, values: { 空欄名: 文 }, note? }
//   ・値だけのファイル。型は持たない（型は id か name で、今ある型から探す）。台帳・型の保存ファイルは変えない
//   ・読み込んでも貼らない：空欄の小窓の入力欄に先に入れるだけ（貼るのは、使う人が小窓で「貼る」を押したとき）
//   ・空欄名は穴あきの決まり（1〜30 字・波かっこと改行なし）。型に無い空欄名は無視。値は 40 個まで・1 つ 2,000 字まで・制御文字は除く
//   ・タグ・機械タグ（宛て:・送った:・貼った:）を運ぶ欄は無い（あっても読まない）。値は文字として入れる（HTML にしない。{{…}} に見える値も、あとで fillTemplate が再び埋めない）
import { cleanTemplateName, type CardTemplate, extractHoles } from './memo-card-templates';
import { MAX_REPLY_TEXT } from './threads';

export const FILL_FORMAT = 'honeycomb-cardtpl-fill';
export const FILL_VERSION = 1;

export const FILL_LIMITS = {
  values: 40, // 空欄の小窓の上限と同じ
  name: 30, // 空欄名の字数
  text: MAX_REPLY_TEXT, // 1 つの値の字数
  note: 200, // 画面に出す補足（note）の字数
} as const;

export interface FillFile {
  template: { id: string; name: string };
  values: Record<string, string>; // 空でない値だけ（先頭の 40 個まで）
  note: string; // 画面に出す補足（文字だけ。無ければ ''）
  ignored: number; // 読まなかった値の数（空欄名が決まりに合わない・文字でない・40 個を超えた・空の値）
}

export type FillFail = 'json' | 'format' | 'version' | 'shape' | 'template' | 'empty';

export type FillParse = ({ ok: true } & FillFile) | { ok: false; why: FillFail };

const HOLE_NAME_RE = /^[^{}\r\n]{1,30}$/;
// eslint-disable-next-line no-control-regex
const NAME_CONTROL = /[\u0000-\u001f\u007f]/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return undefined;
  }
}

// 穴埋めファイルか（format だけを見る。読み込み口が、型のファイルと見分けるために使う）
export function isFillText(text: string): boolean {
  const raw = parseJson(text);
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) && (raw as Record<string, unknown>).format === FILL_FORMAT;
}

// 1 つの値を整える：改行をそろえ、制御文字を除き、前後の空白を取り、2,000 字まで。空なら ''
function cleanValue(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const s = raw.replace(/\r\n?/g, '\n').replace(CONTROL, '').trim();
  return [...s].slice(0, FILL_LIMITS.text).join('').trim();
}

// ファイルの文字を読む。断るときは理由だけを返す（何も変えない）
export function parseFillText(text: string): FillParse {
  const raw = parseJson(text);
  if (raw === undefined) return { ok: false, why: 'json' };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, why: 'format' };
  const f = raw as Record<string, unknown>;
  if (f.format !== FILL_FORMAT) return { ok: false, why: 'format' };
  if (f.version !== FILL_VERSION) return { ok: false, why: 'version' };
  const t = f.template;
  if (typeof t !== 'object' || t === null || Array.isArray(t)) return { ok: false, why: 'shape' };
  const values = f.values;
  if (typeof values !== 'object' || values === null || Array.isArray(values)) return { ok: false, why: 'shape' };
  const ref = t as Record<string, unknown>;
  const id = typeof ref.id === 'string' ? ref.id.trim().slice(0, 80) : '';
  const name = cleanTemplateName(ref.name);
  if (!id && !name) return { ok: false, why: 'template' };

  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  let kept = 0;
  let ignored = 0;
  for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
    const holeName = key.trim();
    const v = cleanValue(value);
    if (!HOLE_NAME_RE.test(holeName) || NAME_CONTROL.test(holeName) || !v || kept >= FILL_LIMITS.values || holeName in out) {
      ignored += 1;
      continue;
    }
    out[holeName] = v;
    kept += 1;
  }
  if (kept === 0) return { ok: false, why: 'empty' };
  const note = typeof f.note === 'string' ? [...f.note.replace(/\s+/g, ' ').replace(CONTROL, '').trim()].slice(0, FILL_LIMITS.note).join('').trim() : '';
  return { ok: true, template: { id, name }, values: out, note, ignored };
}

export function fillFailText(why: FillFail): string {
  switch (why) {
    case 'json':
      return '穴埋めのファイルとして読めません（JSON ではありません）。何も変えていません';
    case 'format':
      return '穴埋めのファイルではありません（format が honeycomb-cardtpl-fill ではありません）。何も変えていません';
    case 'version':
      return 'このファイルの版は読めません（version が 1 ではありません）。何も変えていません';
    case 'shape':
      return '穴埋めのファイルの形が違います（template か values がありません）。何も変えていません';
    case 'template':
      return '穴埋めのファイルに、どの型か（template の id か name）がありません。何も変えていません';
    case 'empty':
      return '入れられる値が 1 つもありません（空欄名が決まりに合わない・値が空）。何も変えていません';
  }
}

export type FindFill = { ok: true; template: CardTemplate } | { ok: false; why: 'missing' | 'no-holes' };

// 今ある型から、ファイルが指す型を探す（id が先。無ければ名前が同じもの）。穴あきで空欄がある型だけ使える
export function findFillTemplate(list: readonly CardTemplate[], ref: { id: string; name: string }): FindFill {
  const found = (ref.id ? list.find((t) => t.id === ref.id) : undefined) ?? (ref.name ? list.find((t) => t.name === ref.name) : undefined);
  if (!found) return { ok: false, why: 'missing' };
  if (found.mode !== 'hole' || extractHoles(found).length === 0) return { ok: false, why: 'no-holes' };
  return { ok: true, template: found };
}

export function findFailText(why: 'missing' | 'no-holes', ref: { id: string; name: string }): string {
  const label = ref.name || ref.id;
  return why === 'missing' ? `「${label}」という型が見つかりません。何も開いていません（型の名前が変わっていないか見てください）` : `「${label}」は穴あきの型ではありません（入れる空欄がありません）。何も開いていません`;
}

export interface FillPlan {
  values: Record<string, string>; // 型の空欄に当たる値だけ
  used: number; // 入れる値の数
  unknown: string[]; // 型に無い空欄名（無視した）
  missing: string[]; // 値が無く、空のままの空欄名
}

// ファイルの値を、型の空欄に合わせる（型に無い空欄名は捨てる）。型と file の中身は変えない
export function planFill(template: Pick<CardTemplate, 'cards'>, file: Pick<FillFile, 'values'>): FillPlan {
  const holes = extractHoles(template);
  const values: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const name of holes.slice(0, FILL_LIMITS.values)) {
    const v = file.values[name];
    if (typeof v === 'string' && v) values[name] = v;
  }
  const unknown = Object.keys(file.values).filter((k) => !holes.includes(k));
  const used = Object.keys(values).length;
  return { values, used, unknown, missing: holes.filter((h) => !(h in values)) };
}

// 先入れしたあとの知らせ
export function fillPlanText(plan: FillPlan, ignored: number): string {
  const parts = [`空欄に値を ${plan.used} 個入れました。内容を確かめて、よければ「貼る」を押してください（押すまで貼りません）`];
  if (plan.missing.length > 0) parts.push(`値のない ${plan.missing.length} 個は空のままです`);
  const skipped = plan.unknown.length + ignored;
  if (skipped > 0) parts.push(`${skipped} 個は入れませんでした（型に無い空欄名・空の値・決まりに合わないもの）`);
  return parts.join('。');
}