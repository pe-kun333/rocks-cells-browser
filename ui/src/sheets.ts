// シート：ハニカムの盤面を何枚も持つ（タブ・メモのセルは、どれか1枚のシートに置く）
//   ・いつもある「メイン」（id は main）と、作ったシート。どのセルがどのシートにあるかは、セルの sheet に持つ
//   ・シートへの入口は、メモのセルの一種（memo.portal に行き先のシート）。押すと盤面がそのシートに変わる
//   ・台帳と「今見ているシート」は session.json に保存する（タブ・島と同じ所）
import { t as tr } from './i18n';
export const MAIN_SHEET = 'main';
export const MAIN_SHEET_NAME = tr('メイン');
// 右サイドバーの「メモ」の区画のシート（書いたコメントが、ここのメモのセルになる）。左のシートの一覧にも出る
export const RIGHT_MEMO_SHEET = 'shrightmemo';
export const RIGHT_MEMO_NAME = tr('右のメモ');
// 撮影を見返すシート（C9）。セルはメモの capture。撮るボタンは置かない
export const CAPTURE_SHEET = 'shcaptures';
export const CAPTURE_SHEET_NAME = tr('撮ったもの');
export const MAX_SHEETS = 100;
const MAX_HISTORY = 30;
// シートの色（入口の六角形をぬる。白い文字が読める濃さ）
// theme: fixed begin：データの色（保存する値。描くときは data-colors.css でテーマの明るさの帯へ）
export const SHEET_PALETTE = ['#2a9d8f', '#d8668f', '#4a7cc4', '#7d63c9', '#e07a5f', '#3f8f5a', '#b5527b', '#5c6bc0', '#c0603f', '#1f7a6f', '#8a6d3b', '#607d8b'];
// theme: fixed end

export interface Sheet {
  id: string;
  name: string;
  color: string;
  createdAt: number;
}

// セルの sheet が無い・空なら、メイン
export const sheetOf = (cell: { sheet?: string | null }) => cell.sheet || MAIN_SHEET;

export function newSheetId() {
  return `sh${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// シートの名前（空白は1つに、20文字まで）
export function normalizeSheetName(name: string): string {
  return [...String(name ?? '').replace(/\s+/g, ' ').trim()].slice(0, 20).join('');
}

export class SheetStore {
  // メインの次は、最初から「撮ったもの」（保存済みの一覧を読む前でも、左上のシート名から開ける）
  private items: Sheet[] = orderedSheets([]);
  private currentId = MAIN_SHEET;
  private history: string[] = []; // 戻る（← ボタン）ためのシートの順
  private readonly listeners: (() => void)[] = [];

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  get current() {
    return this.currentId;
  }

  get currentSheet(): Sheet {
    return this.get(this.currentId) ?? this.items[0];
  }

  // 戻る先（無ければ null）
  get backTo(): string | null {
    return this.history.at(-1) ?? null;
  }

  list(): Sheet[] {
    return [...this.items];
  }

  // 最近見た順（戻る順の新しいもの → 残りは作った順）
  recent(): Sheet[] {
    const seen = new Set<string>();
    const out: Sheet[] = [];
    for (const id of [this.currentId, ...[...this.history].reverse(), ...this.items.map((s) => s.id)]) {
      const sheet = this.get(id);
      if (sheet && !seen.has(id)) {
        seen.add(id);
        out.push(sheet);
      }
    }
    return out;
  }

  get(id: string | null | undefined): Sheet | undefined {
    return id ? this.items.find((s) => s.id === id) : undefined;
  }

  // 保存してあった台帳を読み込む（メインと「撮ったもの」はいつもある。古い session.json に無くても、ここで足す）
  replaceAll(sheets: Sheet[], current?: string) {
    this.items = orderedSheets(sheets);
    this.currentId = current && this.get(current) ? current : MAIN_SHEET;
    this.history = [];
    this.emit();
  }

  add(name: string, color?: string): Sheet | null {
    if (this.items.length >= MAX_SHEETS) return null;
    const sheet: Sheet = { id: newSheetId(), name: normalizeSheetName(name) || tr('シート'), color: color || this.nextColor(), createdAt: Date.now() };
    this.items = [...this.items, sheet];
    this.emit();
    return sheet;
  }

  // アーカイブから同じ id で戻す（AR1）。無ければ足す（added）。空の仮のシートがあれば名前と色を上書き（replaced）
  //   isEmpty：そのシートにタブもメモも無いか（呼ぶ側が決める）。空でなければ何も変えない（kept）。100 枚なら null
  restore(sheet: Sheet, isEmpty: boolean): 'added' | 'replaced' | 'kept' | null {
    if (!isSheetId(sheet.id) || sheet.id === MAIN_SHEET || sheet.id === CAPTURE_SHEET || sheet.id === RIGHT_MEMO_SHEET) return null;
    const have = this.get(sheet.id);
    const clean: Sheet = { id: sheet.id, name: normalizeSheetName(sheet.name) || tr('シート'), color: /^#[0-9a-f]{6}$/i.test(sheet.color) ? sheet.color : this.nextColor(), createdAt: Number.isFinite(sheet.createdAt) ? sheet.createdAt : Date.now() };
    if (have) {
      if (!isEmpty) return 'kept';
      have.name = clean.name;
      have.color = clean.color;
      this.emit();
      return 'replaced';
    }
    if (this.items.length >= MAX_SHEETS) return null;
    this.items = [...this.items, clean];
    this.emit();
    return 'added';
  }

  rename(id: string, name: string) {
    const sheet = this.get(id);
    const clean = normalizeSheetName(name);
    if (!sheet || !clean) return;
    sheet.name = clean;
    this.emit();
  }

  // シートを消す（メインと「撮ったもの」は消せない）。見ていたシートなら、戻る先かメインへ
  remove(id: string) {
    if (id === MAIN_SHEET || id === CAPTURE_SHEET || !this.get(id)) return;
    this.items = this.items.filter((s) => s.id !== id);
    this.history = this.history.filter((h) => h !== id && !!this.get(h));
    if (this.currentId === id) this.currentId = this.history.pop() ?? MAIN_SHEET;
    this.emit();
  }

  // 見るシートを変える（push：戻る先に今のシートを積む）
  setCurrent(id: string, push = true): boolean {
    if (!this.get(id) || id === this.currentId) return false;
    if (push) this.history = [...this.history.filter((h) => h !== this.currentId), this.currentId].slice(-MAX_HISTORY);
    else this.history = this.history.filter((h) => h !== id);
    this.currentId = id;
    this.emit();
    return true;
  }

  // ← で戻る。戻ったシートの id（戻れなければ null）
  back(): string | null {
    while (this.history.length > 0) {
      const id = this.history.pop() as string;
      if (this.get(id) && id !== this.currentId) {
        this.currentId = id;
        this.emit();
        return id;
      }
    }
    return null;
  }

  // セルが指しているのに台帳に無いシート（保存の途中で終わったときなど）を、名前だけの仮のシートとして足す
  //   name：決まった名前で足すとき（右のメモ）
  ensure(ids: Iterable<string>, name = tr('シート')) {
    let added = false;
    for (const id of ids) {
      if (!id || this.get(id)) continue;
      if (id === CAPTURE_SHEET) {
        this.items = orderedSheets(this.items);
        added = true;
        continue;
      }
      if (this.items.length >= MAX_SHEETS) continue;
      const fixed = id === RIGHT_MEMO_SHEET ? RIGHT_MEMO_NAME : name;
      this.items.push({ id, name: normalizeSheetName(fixed) || tr('シート'), color: this.nextColor(), createdAt: Date.now() });
      added = true;
    }
    if (added) this.emit();
  }

  // まだ使われていない色（無ければ順番に）
  nextColor(): string {
    const used = new Set(this.items.map((s) => s.color));
    return SHEET_PALETTE.find((c) => !used.has(c)) ?? SHEET_PALETTE[this.items.length % SHEET_PALETTE.length];
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

function mainSheet(): Sheet {
  // theme: fixed begin：データの色（保存する値。描くときは data-colors.css でテーマの明るさの帯へ）
  return { id: MAIN_SHEET, name: MAIN_SHEET_NAME, color: '#d9891a', createdAt: 0 };
  // theme: fixed end
}

function captureSheet(): Sheet {
  // theme: fixed begin：データの色（保存する値。描くときは data-colors.css でテーマの明るさの帯へ）
  return { id: CAPTURE_SHEET, name: CAPTURE_SHEET_NAME, color: '#2a9d8f', createdAt: 0 };
  // theme: fixed end
}

// メインの次に「撮ったもの」。保存済みの一覧に無くても足す。枚数の上限でも、この2枚は残す
function orderedSheets(sheets: Sheet[]): Sheet[] {
  const main = sheets.find((s) => s.id === MAIN_SHEET) ?? mainSheet();
  const capture = sheets.find((s) => s.id === CAPTURE_SHEET) ?? captureSheet();
  const rest = sheets.filter((s) => s.id !== MAIN_SHEET && s.id !== CAPTURE_SHEET);
  return [main, capture, ...rest].slice(0, MAX_SHEETS);
}

// 保存されていた台帳を確かめながら読む
export function parseSheets(raw: unknown): Sheet[] {
  if (!Array.isArray(raw)) return [];
  const sheets: Sheet[] = [];
  for (const s of raw) {
    if (typeof s !== 'object' || s === null) continue;
    const x = s as Record<string, unknown>;
    if (typeof x.id !== 'string' || !/^(main|sh[0-9a-z]+)$/.test(x.id) || sheets.some((t) => t.id === x.id)) continue;
    sheets.push({
      id: x.id,
      name: (typeof x.name === 'string' && normalizeSheetName(x.name)) || (x.id === MAIN_SHEET ? MAIN_SHEET_NAME : x.id === CAPTURE_SHEET ? CAPTURE_SHEET_NAME : tr('シート')),
      // theme: fixed begin：データの色（保存する値。描くときは data-colors.css でテーマの明るさの帯へ）
      color: typeof x.color === 'string' && /^#[0-9a-f]{6}$/i.test(x.color) ? x.color : '#2a9d8f',
      // theme: fixed end
      createdAt: typeof x.createdAt === 'number' ? x.createdAt : 0,
    });
  }
  return orderedSheets(sheets);
}

// シートの id として使えるもの
export function isSheetId(value: unknown): value is string {
  return typeof value === 'string' && /^(main|sh[0-9a-z]+)$/.test(value);
}
