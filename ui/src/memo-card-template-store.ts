// コメントカードの「型」の保存と、登録の小窓の文（計画書 docs/plan-card-templates.md の Phase 1b）
//   ・ここは DOM を使わない。ファイルの読み書きは、呼ぶ側が io（readDataChecked と writeData）を渡す（テストでは偽物を渡す）
//   ・ui-data/card-templates.json は { version: 1, templates: [...] }。読めなかった・版が違う・形が違うときは、書かない（上書きしない）
//   ・読めない型が混ざっているファイルにも書かない（書くと、その型が消えるため）
//   ・初めて書く前に、すでにあるファイルの写しを card-templates-before-v1.json に 1 回だけ取る（写せなければ書かない）
import { t as tr } from './i18n';
import type { CheckedRead } from './data';
import {
  addTemplate,
  type CardTemplate,
  cleanTemplateName,
  HOLE_COMMON,
  MODE_LABELS,
  newTemplateId,
  parseTemplateFile,
  TEMPLATE_FOLDERS,
  TEMPLATE_LIMITS,
  type TemplateMode,
  type TemplateReport,
  toTemplateFile,
} from './memo-card-templates';
import { type ImportSummary, mergeImported } from './memo-card-template-io';
import { missingSamples } from './memo-card-template-samples';
import { MAX_REPLIES } from './threads';

export const TEMPLATES_FILE = 'card-templates.json';
export const TEMPLATES_BACKUP = 'card-templates-before-v1.json';

// 型にするために選ぶカードの数（画面は 2 枚以上。1 枚の型は、純粋関数では作れる）
export const TEMPLATE_MIN_PICK = 2;

export interface TemplateIo {
  read(name: string): Promise<CheckedRead<unknown>>;
  write(name: string, value: unknown): Promise<boolean>;
}

export type LoadTemplatesResult =
  | { state: 'ok' | 'missing'; templates: CardTemplate[]; skipped: number; raw: unknown }
  | { state: 'unreadable'; why: 'failed' | 'version' | 'shape' };

// 型のファイルを読む。ok：読めた／missing：ファイルが無い（初めて）／unreadable：返事が無い・壊れている・知らない版・形が違う（書かない）
export async function loadTemplates(io: TemplateIo): Promise<LoadTemplatesResult> {
  const read = await io.read(TEMPLATES_FILE);
  if (read.status === 'missing') return { state: 'missing', templates: [], skipped: 0, raw: null };
  if (read.status === 'failed') return { state: 'unreadable', why: 'failed' };
  const parsed = parseTemplateFile(read.value);
  if (!parsed.ok) return { state: 'unreadable', why: parsed.why };
  return { state: 'ok', templates: parsed.templates, skipped: parsed.skipped.length, raw: read.value };
}

export type SaveFailure = 'unreadable' | 'partial' | 'full' | 'duplicate' | 'backup' | 'write' | 'notfound' | 'name';
export type SaveTemplateResult = { ok: true; count: number; templates: CardTemplate[]; added?: number; summary?: ImportSummary } | { ok: false; why: SaveFailure };

// 読み直した型の一覧を書き換えて保存する共通の道（登録・名前の変更・削除・サンプルの復元）
//   読めない・知らない版・形が違うファイル、読めない型が混ざったファイルには書かない。edit が null を返したら何も書かない。
//   すでにファイルがあるときだけ、初めての書き込みの前に写し（card-templates-before-v1.json）を 1 回だけ取る（取れなければ書かない）
async function updateStored(io: TemplateIo, edit: (list: CardTemplate[]) => { next: CardTemplate[]; added?: number } | { fail: SaveFailure } | null): Promise<SaveTemplateResult> {
  const loaded = await loadTemplates(io);
  if (loaded.state === 'unreadable') return { ok: false, why: 'unreadable' };
  if (loaded.skipped > 0) return { ok: false, why: 'partial' };
  const edited = edit(loaded.templates);
  if (edited === null) return { ok: true, count: loaded.templates.length, templates: loaded.templates, added: 0 };
  if ('fail' in edited) return { ok: false, why: edited.fail };
  if (loaded.state === 'ok') {
    const backup = await io.read(TEMPLATES_BACKUP);
    if (backup.status === 'failed') return { ok: false, why: 'backup' };
    if (backup.status === 'missing' && !(await io.write(TEMPLATES_BACKUP, loaded.raw))) return { ok: false, why: 'backup' };
  }
  if (!(await io.write(TEMPLATES_FILE, toTemplateFile(edited.next)))) return { ok: false, why: 'write' };
  return { ok: true, count: edited.next.length, templates: edited.next, ...(edited.added !== undefined ? { added: edited.added } : {}) };
}

// 名前を替える（空・見えない文字だけの名前は断る）。ほかの項目は変えない
export function renameInList(list: readonly CardTemplate[], id: string, rawName: unknown): { next: CardTemplate[] } | { fail: 'notfound' | 'name' } {
  if (!list.some((t) => t.id === id)) return { fail: 'notfound' };
  const name = cleanTemplateName(rawName);
  if (!name) return { fail: 'name' };
  return { next: list.map((t) => (t.id === id ? { ...t, name } : t)) };
}

export function removeFromList(list: readonly CardTemplate[], id: string): { next: CardTemplate[] } | { fail: 'notfound' } {
  if (!list.some((t) => t.id === id)) return { fail: 'notfound' };
  return { next: list.filter((t) => t.id !== id) };
}

// 読み込んだ型を足す：合わせて 200 件までの入る分だけ（足りなければ断る）。id・名前の重なりは mergeImported が直す。何も足せないときは何も書かない
export async function importStoredTemplates(io: TemplateIo, incoming: readonly CardTemplate[], opts: { newId?: () => string } = {}): Promise<SaveTemplateResult> {
  let summary: ImportSummary | undefined;
  const done = await updateStored(io, (list) => {
    const merged = mergeImported(list, incoming, opts);
    summary = merged.summary;
    if (merged.items.length === 0) return incoming.length > 0 ? { fail: 'full' } : null;
    return { next: merged.next, added: merged.items.length };
  });
  return done.ok && summary ? { ...done, summary } : done;
}

export const renameStoredTemplate = (io: TemplateIo, id: string, rawName: unknown) => updateStored(io, (list) => renameInList(list, id, rawName));
export const deleteStoredTemplate = (io: TemplateIo, id: string) => updateStored(io, (list) => removeFromList(list, id));

// 「初期サンプルを復元」：まだ無い内蔵サンプルだけを足す。すべてそろっていれば何も書かない（added: 0）。200 件に収まらなければ断る
export const restoreSampleTemplates = (io: TemplateIo) =>
  updateStored(io, (list) => {
    const add = missingSamples(list);
    if (add.length === 0) return null;
    if (list.length + add.length > TEMPLATE_LIMITS.templates) return { fail: 'full' };
    return { next: [...list, ...add], added: add.length };
  });

// 型を 1 件、ファイルに足す。断ったときは何も書かない（ファイルの写しも取らない）
export async function saveNewTemplate(io: TemplateIo, template: CardTemplate, opts: { newId?: () => string } = {}): Promise<SaveTemplateResult> {
  const loaded = await loadTemplates(io);
  if (loaded.state === 'unreadable') return { ok: false, why: 'unreadable' };
  if (loaded.skipped > 0) return { ok: false, why: 'partial' };
  if (loaded.templates.length >= TEMPLATE_LIMITS.templates) return { ok: false, why: 'full' };

  // 同じ id がすでにあれば、新しい id にして足す（5 回まで）
  const make = opts.newId ?? newTemplateId;
  let next: CardTemplate[] | null = null;
  let item = template;
  for (let guard = 0; guard < 5 && !next; guard++) {
    next = addTemplate(loaded.templates, item);
    if (!next) item = { ...template, id: make() };
  }
  if (!next) return { ok: false, why: 'duplicate' };

  // すでにファイルがあるときだけ、写しを 1 回だけ取る（写しがもうあれば取らない）
  if (loaded.state === 'ok') {
    const backup = await io.read(TEMPLATES_BACKUP);
    if (backup.status === 'failed') return { ok: false, why: 'backup' };
    if (backup.status === 'missing' && !(await io.write(TEMPLATES_BACKUP, loaded.raw))) return { ok: false, why: 'backup' };
  }
  if (!(await io.write(TEMPLATES_FILE, toTemplateFile(next)))) return { ok: false, why: 'write' };
  return { ok: true, count: next.length, templates: next };
}

// 同じ名前の型がもうあるか（ボードの「型にする…」が、登録の前に見る。名前は cleanTemplateName を通した形で比べる）
export function templateNameTaken(list: readonly CardTemplate[], rawName: unknown): boolean {
  const name = cleanTemplateName(rawName);
  return name !== '' && list.some((t) => t.name === name);
}

// ボードの「型にする…」で名前を空のまま決めたときの名前
export const TEMPLATE_UNTITLED = tr('無題の型');

// 選ぶ帯の「型にする…」を押せるか（n：選んでいる枚数）と、ボタンの説明
export function templatePickState(n: number): { enabled: boolean; hint: string } {
  if (n < TEMPLATE_MIN_PICK) return { enabled: false, hint: tr('{0}枚以上選ぶと、型にできます', { 0: TEMPLATE_MIN_PICK }) };
  if (n > TEMPLATE_LIMITS.cards) return { enabled: false, hint: tr('型にできるのは {0} 枚までです（今 {1} 枚）', { 0: TEMPLATE_LIMITS.cards, 1: n }) };
  return { enabled: true, hint: tr('選んだカードと、そのあいだの関連を、型として登録します') };
}

// 登録の小窓に出す、数の 2 行
export function describeTemplateReport(report: TemplateReport): { counts: string; excluded: string } {
  const { children, images, quotes } = report.skipped;
  const spans = report.skipped.spans ?? 0;
  const none = children + images + quotes + report.cutLinks + spans === 0;
  return {
    counts: tr('{0}枚・関連 {1}本{2}', { 0: report.cards, 1: report.links, 2: report.holes !== undefined ? `・空欄 ${report.holes}個` : '' }),
    excluded: none ? tr('含めないもの：なし') : tr('含めないもの：画像 {0}・引用 {1}・返信 {2}・外へ出る関連 {3}本{4}', { 0: images, 1: quotes, 2: children, 3: report.cutLinks, 4: spans > 0 ? `・結んだ区間 ${spans}` : '' }),
  };
}

export function templateSaveMessage(why: SaveFailure): string {
  switch (why) {
    case 'notfound':
      return tr('その型はもうありません。窓を開き直してください');
    case 'name':
      return tr('名前を入れてください');
    case 'unreadable':
      return tr('型の保存ファイルを読めなかったので、保存しませんでした（ファイルは変えていません）');
    case 'partial':
      return tr('型の保存ファイルに読めない型があるので、保存しませんでした（ファイルは変えていません）');
    case 'full':
      return tr('型は {0} 件までです。これ以上は登録できません', { 0: TEMPLATE_LIMITS.templates });
    case 'duplicate':
      return tr('型の印が重なって保存できませんでした。もう一度押してください');
    case 'backup':
      return tr('もとの型の写しを取れなかったので、保存しませんでした');
    case 'write':
      return tr('型を保存できませんでした（書き込み：失敗）');
  }
}

// ---------- 「型を貼る ▾」のメニュー（Phase 1c） ----------

export const TEMPLATE_EMPTY_HINT = tr('まだ型がありません。カードを 2 枚以上選んで「型にする…」で登録できます');

export const templateMenuLabel = (t: CardTemplate) => tr('{0}（{1}枚{2}）', { 0: t.name, 1: t.cards.length, 2: t.mode === 'snapshot' ? '' : `・${MODE_LABELS[t.mode]}` });

// 登録の小窓の、モードの説明
export function templateModeNote(mode: TemplateMode): string {
  switch (mode) {
    case 'snapshot':
      return tr('カードの文を、そのまま型にします');
    case 'skeleton':
      return tr('各カードの題（1 行目）だけを型にします。本文は入りません');
    case 'hole':
      return `本文を「{{${HOLE_COMMON}}}：{{題}}」の空欄にします（本文に {{…}} があるカードはそのまま）。貼るときに値を入れます`;
  }
}

// フォルダごとの並び（TEMPLATE_FOLDERS の順。型が無いフォルダは出さない。フォルダの中は保存順）
export function templateMenuGroups(list: readonly CardTemplate[]): { folder: string; items: CardTemplate[] }[] {
  const groups: { folder: string; items: CardTemplate[] }[] = [];
  for (const folder of TEMPLATE_FOLDERS) {
    const items = list.filter((t) => t.folder === folder);
    if (items.length > 0) groups.push({ folder, items });
  }
  return groups;
}

// 貼る前の確かめ（existing：今のメモの返信の数。cards：型の枚数）。貼れなければ断りの文、貼れれば null。左の台帳も同じ上限で断る
export function pasteBlocked(existing: number, cards: number): string | null {
  const room = Math.max(0, MAX_REPLIES - existing);
  if (cards <= room) return null;
  return tr('型を貼れませんでした（このメモに入りきりません。あと {0} 枚まで、型は {1} 枚です。上限は {2} 枚）', { 0: room, 1: cards, 2: MAX_REPLIES });
}
