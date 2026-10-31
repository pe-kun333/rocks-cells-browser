// ボードが見るメモの「名札」と「選び口のメニュー」の決まり（plan-board-memo-switch の M3）。DOM を持たない
//   名札：ボードがいまどのメモを見ているか。下の区画と別のメモを見ているとき（other）は目立たせ、同じときは控えめにする
//   選び口：上に出しているとき（かつ旗が入っているとき）だけメモを選べる。下のボードでは選べない
//     （ただし別のメモを見たままになっているときは、「下の区画と同じに戻す」だけは押せる。戻れなくなるのを防ぐため）
//   下の区画の写し（MemoPaneView）の text から見出しを作る（memocells.ts の memoTitle と同じ決まり）。メモの一覧は下の面がすでに持っている（sheetItems・recentItems）
import { t } from './i18n';
import type { MenuEntry } from './panels/cell-menu';
import type { MemoIndexItem } from './memocells'; // 型だけ（memocells は bridge を読むので、実行時には読み込まない）

export interface BoardMemoRef {
  id: string;
  text: string;
}

export interface BoardMemoInfo {
  shownId: string;
  shownTitle: string; // ボードが見ているメモの見出し
  lowerId: string | null;
  lowerTitle: string; // 下の区画のメモの見出し（無ければ空）
  chosen: boolean; // 選んでいる（memoBoardView が来ている）
  other: boolean; // 選んでいて、しかも下の区画とは別のメモ
}

const EMPTY_TITLE = t('（空のメモ）');
export const TAG_MAX = 16;
export const RESET_LABEL = t('下の区画と同じに戻す');

// メモの見出し（最初の空でない行。memocells.ts の memoTitle と同じ決まり）。max 字を超えたら …
export function titleOf(text: string, max = TAG_MAX): string {
  const line = text.split('\n').find((l) => l.trim())?.trim() ?? '';
  const chars = [...line];
  return (chars.length > max ? chars.slice(0, max).join('') + '…' : line) || EMPTY_TITLE;
}

// 選んだメモ（無ければ null）と下の区画のメモから。見るメモが何も無ければ null（名札は出さない）
export function boardMemoInfo(chosen: BoardMemoRef | null, lower: BoardMemoRef | null): BoardMemoInfo | null {
  const shown = chosen ?? lower;
  if (!shown) return null;
  return {
    shownId: shown.id,
    shownTitle: titleOf(shown.text),
    lowerId: lower?.id ?? null,
    lowerTitle: lower ? titleOf(lower.text) : '',
    chosen: chosen !== null,
    other: chosen !== null && chosen.id !== lower?.id,
  };
}

export type PickMode = 'full' | 'reset' | 'static';

// full：メモを選べる（上に出しているとき。選び口の旗は廃止した）／reset：「下と同じに戻す」だけ（別のメモを見たままの下のボードなど）／static：押せない名札
export function pickMode(info: BoardMemoInfo | null, o: { available: boolean; upper: boolean }): PickMode {
  if (!info || !o.available) return 'static';
  if (o.upper) return 'full';
  return info.other ? 'reset' : 'static';
}

export interface MemoTag {
  text: string;
  title: string; // マウスを乗せたときの説明
  tone: 'other' | 'same';
  pickable: boolean;
}

export function memoTagOf(info: BoardMemoInfo | null, mode: PickMode): MemoTag | null {
  if (!info) return null;
  const arrow = mode === 'static' ? '' : ' ▾';
  if (info.other) {
    return {
      text: t('メモ：{0}{1}', { 0: info.shownTitle, 1: arrow }),
      tone: 'other',
      title: t('ボードは、下の区画（「{0}」）とは別のメモを見ています。{1}', { 0: info.lowerTitle || 'なし', 1: mode === 'full' ? '押すと選び直せます。' : mode === 'reset' ? '押すと下の区画と同じに戻せます。' : '' }),
      pickable: mode !== 'static',
    };
  }
  return {
    text: t('メモ：{0}{1}', { 0: info.shownTitle, 1: arrow }),
    title: mode === 'full' ? t('ボードで見るメモを選べます（いまは下の区画と同じメモです）') : t('ボードは下の区画と同じメモを見ています'),
    tone: 'same',
    pickable: mode === 'full',
  };
}

const MENU_MAX = 40; // メニューが長くなりすぎないように（一覧は下の面の更新の新しい順）

export interface PickerInput {
  items: readonly MemoIndexItem[]; // 下の区画のメモと同じシートのメモ
  recent: readonly MemoIndexItem[]; // 最近開いたメモ
  sheetName: string;
  info: BoardMemoInfo;
  mode: PickMode;
  run: (id: string | null) => void; // null＝下の区画と同じに戻す
}

// メニューの中身。先頭に「下の区画と同じに戻す」（選んでいないときは押せない）、次に最近開いたメモ、次に同じシートのメモ
export function pickerEntries(o: PickerInput): MenuEntry[] {
  const reset: MenuEntry = o.info.chosen
    ? { label: RESET_LABEL, hint: o.info.lowerTitle || undefined, run: () => o.run(null) }
    : { label: RESET_LABEL, hint: t('いまは同じです'), disabled: true };
  if (o.mode !== 'full') {
    return [{ section: t('ボードで見るメモ') }, reset, { note: t('別のメモを選べるのは、ボードを上に出しているあいだです。') }];
  }
  const entry = (item: MemoIndexItem): MenuEntry => {
    const here = item.id === o.info.shownId;
    const lower = item.id === o.info.lowerId;
    return { label: item.title, hint: here ? t('見ています') : lower ? t('下の区画') : undefined, disabled: here, run: () => o.run(item.id) };
  };
  const out: MenuEntry[] = [{ section: t('ボードで見るメモ') }, reset];
  const recent = o.recent.slice(0, MENU_MAX);
  const seen = new Set(recent.map((m) => m.id));
  const sheet = o.items.filter((m) => !seen.has(m.id)).slice(0, MENU_MAX);
  if (recent.length > 0) out.push('sep', { section: t('最近開いたメモ') }, ...recent.map(entry));
  if (sheet.length > 0) out.push('sep', { section: t('{0}のメモ', { 0: o.sheetName || 'このシート' }) }, ...sheet.map(entry));
  if (recent.length === 0 && sheet.length === 0) out.push({ note: t('選べるメモがありません。') });
  return out;
}

// 左の知らせ（memoPaneNotice）を出す先。知らせにメモ id（memo）が付いていて、ボードが下の区画とは別のメモを選んでいるとき、
//   そのメモのことなら、そのメモを見ているほうだけに出す（board＝ボードの一言だけ／lower＝下の区画の状態欄だけ）。
//   id が無い・選んでいない・同じメモ・どちらでもないメモなら、今までどおり両方（both）
export type NoticeTarget = 'both' | 'lower' | 'board';
export function noticeTarget(o: { memo: string | undefined; lowerId: string | null; chosenId: string | null }): NoticeTarget {
  if (!o.memo || o.chosenId === null || o.chosenId === o.lowerId) return 'both';
  if (o.memo === o.chosenId) return 'board';
  if (o.memo === o.lowerId) return 'lower';
  return 'both';
}

// 型の貼り付けの「元に戻す」「送り先を開く」の帯（左の知らせ）を、下の区画に出さなくてよいか。
//   ボードが（下の区画とは別の）選んだメモへ貼った直後だけ。選んでいないとき・下の区画から送ったときは、今までどおり出す
//   boardSentAt：ボードが sendReplies を送った時刻（無ければ null）。WINDOW_MS 以内に届いた知らせだけを、ボードの貼り付けのものとみなす
export const BOARD_SEND_WINDOW_MS = 10_000;
export function skipLowerSentBar(o: { openMemo: string; lowerId: string | null; chosenId: string | null; boardSentAt: number | null; now: number }): boolean {
  if (o.boardSentAt === null || o.now - o.boardSentAt > BOARD_SEND_WINDOW_MS || o.now < o.boardSentAt) return false;
  return o.chosenId !== null && o.chosenId !== o.lowerId && o.openMemo === o.chosenId;
}