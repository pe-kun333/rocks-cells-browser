// 型の JSON の書き出し・読み込み（計画書 docs/plan-card-templates.md の Phase 4。DOM・台帳・ファイルは触らない純粋な部分）
//   書き出し形式：{ format: 'honeycomb-cardtpl', version: 1, templates: [...] }
//   読み込み：JSON として読めない・format が違う・版が違うファイルは、何も変えずに断る。型 1 件ごとの検査は parseTemplateFile（読めない型は理由つきで飛ばす）
//   足し方：id が重なれば新しい id・名前が重なれば「名前 (2)」「名前 (3)」…・合わせて 200 件まで（入る分だけ。残りは足さない）
import { type CardTemplate, cleanTemplateName, newTemplateId, parseTemplateFile, type SkipReason, TEMPLATE_LIMITS, TEMPLATE_VERSION } from './memo-card-templates';
import { withinImportBytes } from './import-limits';

export const TEMPLATE_FORMAT = 'honeycomb-cardtpl';

export interface TemplateExport {
  format: typeof TEMPLATE_FORMAT;
  version: 1;
  templates: CardTemplate[];
}

// 書き出す中身（型の写し。ほかの項目は足さない）
export function buildExport(list: readonly CardTemplate[]): TemplateExport {
  return { format: TEMPLATE_FORMAT, version: TEMPLATE_VERSION, templates: list.map((t) => structuredClone(t)) };
}

// 書き出すファイルの名前（ui-data\exports\card-templates-YYYYMMDD-HHMMSS.json。Grok の書き出しと同じ置き場）
export function exportFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `exports/card-templates-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.json`;
}

// 読み込み側の上限（1 MB。import-limits.ts）に収まる書き出しか（収まらないと、書き出しても読み込めない）
export function exportFitsImportLimit(data: TemplateExport): boolean {
  return withinImportBytes(JSON.stringify(data));
}

export type ImportFail = 'json' | 'format' | 'version' | 'shape' | 'empty';

export type ImportParse = { ok: true; templates: CardTemplate[]; skipped: { index: number; why: SkipReason }[]; total: number } | { ok: false; why: ImportFail };

// ファイルの文字を読む。断るときは、どの理由かだけを返す（何も変えない）。先頭の BOM は無視する
export function parseImportText(text: string): ImportParse {
  let raw: unknown;
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return { ok: false, why: 'json' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, why: 'format' };
  const f = raw as Record<string, unknown>;
  if (f.format !== TEMPLATE_FORMAT) return { ok: false, why: 'format' };
  if (f.version !== TEMPLATE_VERSION) return { ok: false, why: 'version' };
  if (!Array.isArray(f.templates)) return { ok: false, why: 'shape' };
  if (f.templates.length === 0) return { ok: false, why: 'empty' };
  const done = parseTemplateFile({ version: TEMPLATE_VERSION, templates: f.templates });
  if (!done.ok) return { ok: false, why: done.why };
  return { ok: true, templates: done.templates, skipped: done.skipped, total: f.templates.length };
}

export function importFailText(why: ImportFail): string {
  switch (why) {
    case 'json':
      return '型のファイルとして読めません（JSON ではありません）。何も変えていません';
    case 'format':
      return '型のファイルではありません（format が honeycomb-cardtpl ではありません）。何も変えていません';
    case 'version':
      return 'このファイルの版は読めません（version が 1 ではありません）。何も変えていません';
    case 'shape':
      return '型のファイルの形が違います（templates が一覧ではありません）。何も変えていません';
    case 'empty':
      return '型が 1 件も入っていません。何も変えていません';
  }
}

export function skipReasonText(why: SkipReason): string {
  switch (why) {
    case 'shape':
      return '形が違います';
    case 'version':
      return '版が違います';
    case 'mode':
      return 'モードが分かりません';
    case 'name':
      return '名前がありません';
    case 'no-cards':
      return 'カードがありません';
    case 'too-many-cards':
      return `カードが ${TEMPLATE_LIMITS.cards} 枚を超えています`;
    case 'text':
      return 'カードの文が空です';
    case 'limit':
      return `${TEMPLATE_LIMITS.templates} 件を超えています`;
  }
}

// ---------- 足し方 ----------

export interface ImportedItem {
  template: CardTemplate; // 足したあとの型（id・名前を直したもの）
  fromName: string; // 読み込んだときの名前
  nameChanged: boolean;
  idChanged: boolean;
}

export interface ImportSummary {
  added: number;
  nameChanged: number;
  idChanged: number;
  dropped: number; // 200 件に収まらず、足さなかった数
}

export interface MergeResult {
  next: CardTemplate[]; // 今の型の並びの後ろに、足した型
  items: ImportedItem[];
  summary: ImportSummary;
}

// 名前が重なるときの名前：「名前 (2)」「名前 (3)」…（40 字に収める。収まらなければ元の名前を削る）
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  for (let n = 2; n < 10_000; n++) {
    const suffix = ` (${n})`;
    const candidate = `${[...name].slice(0, Math.max(1, TEMPLATE_LIMITS.name - suffix.length)).join('').trim()}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return name;
}

// 読み込んだ型 incoming を、今の型 existing の後ろに足す（existing・incoming の中身は変えない）
//   id の重なり（今の型・先に足した型）は新しい id に。名前の重なりは uniqueName で。existing と合わせて 200 件まで（入る分だけ足し、残りは dropped）
export function mergeImported(existing: readonly CardTemplate[], incoming: readonly CardTemplate[], opts: { newId?: () => string } = {}): MergeResult {
  const make = opts.newId ?? newTemplateId;
  const ids = new Set(existing.map((t) => t.id));
  const names = new Set(existing.map((t) => t.name));
  const room = Math.max(0, TEMPLATE_LIMITS.templates - existing.length);
  const items: ImportedItem[] = [];
  let dropped = 0;
  for (const source of incoming) {
    if (items.length >= room) {
      dropped += 1;
      continue;
    }
    let id = source.id;
    for (let guard = 0; ids.has(id) && guard < 40; guard++) id = make();
    if (ids.has(id)) {
      dropped += 1;
      continue;
    }
    const name = cleanTemplateName(uniqueName(source.name, names)) || source.name;
    ids.add(id);
    names.add(name);
    items.push({ template: { ...structuredClone(source), id, name }, fromName: source.name, nameChanged: name !== source.name, idChanged: id !== source.id });
  }
  return {
    next: [...existing, ...items.map((i) => i.template)],
    items,
    summary: { added: items.length, nameChanged: items.filter((i) => i.nameChanged).length, idChanged: items.filter((i) => i.idChanged).length, dropped },
  };
}

// 足したあとの知らせの文
export function importSummaryText(s: ImportSummary): string {
  const parts = [`${s.added} 件を読み込みました`];
  if (s.nameChanged > 0) parts.push(`名前が重なった ${s.nameChanged} 件は「(2)」などを付けました`);
  if (s.dropped > 0) parts.push(`${TEMPLATE_LIMITS.templates} 件に収まらない ${s.dropped} 件は足していません`);
  return parts.join('。');
}