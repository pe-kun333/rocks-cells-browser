// 表示の設定（次に起動したときも覚えておく）
import { type BoardLinkNames, parseBoardLinkNames } from './board-links';
import { type CardWin, parseCardWins } from './card-wins';
import { MAIN_SHEET } from './sheets';
import type { BoardView, LargeShape, ViewMode } from './sidebar';
import { isTabLook, type TabLook } from './tabs';
import type { PreviewPlacement, SleepSettings } from './types';

export const DEFAULT_SLEEP: SleepSettings = { suspendMinutes: 5, discardMinutes: 25 };

export interface Prefs {
  mode: ViewMode;
  shape: LargeShape;
  showNumbers: boolean;
  showRoute: boolean; // 盤面に順路（タブどうしの線と段の番号）を出す
  showIslandNames: boolean; // 盤面に島の名前を出す（枠と色の面はいつも出す）
  boardLinkNames: BoardLinkNames; // 盤面の関連の線の、種類の名前（無い種類は元の名前）
  preview: PreviewPlacement;
  floatPos: { x: number; y: number }; // 拡大表示を「自由に配置」したときの位置
  rightSidebar: boolean;
  boards: Record<string, BoardView>; // 盤面の位置と拡大率（シートごと）
  sleep: SleepSettings;
  tabLook: TabLook; // タブのセルの見え方（すべてのシート）
  pasteSetAs: 'here' | 'portal'; // 「セットを貼る」の貼り方（ここに並べる・入口を1つ置く）
  linkOpen: 'front' | 'back'; // ページのリンクから開く新しいタブ（表に出す・いつも裏で開く）
  botAppConfirmed: boolean; // ボットのセルで「外のアプリ（Grok Bot）を開きます」を確かめ終えた（はじめての1回だけ聞く）
  shelfView: ShelfView; // 試し：左の下の棚で見ている欄
  shelfOpen: boolean; // 試し：左の下の棚を開いている（▾ でたたむ）
  popupDetail: boolean; // 試し：固定したポップアップは詳しく（ボタン・タグも出す）。マウスを乗せただけのときは小さいまま
  cardWins: CardWin[]; // P1：盤面に出しているカードの小窓（どのセルか・位置）
  popoutPlaces: PopoutPlace[]; // P2：ライブの小窓の位置と大きさ（窓の番号 0〜3 ごと。物理ピクセル）
}

export interface PopoutPlace {
  x: number;
  y: number;
  w: number;
  h: number;
  top: boolean; // 最前面に固定
}

export const MAX_POPOUTS = 4;

export function parsePopoutPlaces(raw: unknown): PopoutPlace[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_POPOUTS).map((item) => {
    const v = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    const n = (k: string) => (typeof v[k] === 'number' && Number.isFinite(v[k]) ? Math.round(v[k] as number) : 0);
    return { x: n('x'), y: n('y'), w: n('w'), h: n('h'), top: v.top !== false };
  });
}

export type ShelfView = 'downloads' | 'closed' | 'captures' | 'sheets';

const KEY = 'honeycomb.view';

export function loadPrefs(): Prefs {
  let saved: Record<string, unknown> = {};
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (typeof raw === 'object' && raw !== null) saved = raw as Record<string, unknown>;
  } catch {
    // 読めなければ初期設定で動けばよい
  }
  return {
    mode: pick(saved.mode, ['small', 'large'], 'small'),
    shape: pick(saved.shape, ['regular', 'wide'], 'regular'),
    showNumbers: saved.showNumbers === true,
    showRoute: saved.showRoute !== false,
    showIslandNames: saved.showIslandNames !== false,
    boardLinkNames: parseBoardLinkNames(saved.boardLinkNames),
    preview: pick(saved.preview, ['dock', 'float', 'popup', 'right', 'off'], 'dock'),
    floatPos: isPoint(saved.floatPos) ? saved.floatPos : { x: 12, y: 12 },
    rightSidebar: saved.rightSidebar === true,
    boards: parseBoards(saved.boards, saved.board),
    sleep: isSleepSettings(saved.sleep) ? saved.sleep : { ...DEFAULT_SLEEP },
    tabLook: isTabLook(saved.tabLook) ? saved.tabLook : 'auto',
    pasteSetAs: saved.pasteSetAs === 'portal' ? 'portal' : 'here',
    linkOpen: saved.linkOpen === 'back' ? 'back' : 'front',
    botAppConfirmed: saved.botAppConfirmed === true,
    shelfView: pick(saved.shelfView, ['downloads', 'closed', 'captures', 'sheets'], 'downloads'),
    shelfOpen: saved.shelfOpen !== false,
    popupDetail: saved.popupDetail !== false,
    cardWins: parseCardWins(saved.cardWins),
    popoutPlaces: parsePopoutPlaces(saved.popoutPlaces),
  };
}

// シートごとの盤面の位置（前の版の1つだけの board は、メインのものにする）
function parseBoards(raw: unknown, oldBoard: unknown): Record<string, BoardView> {
  const boards: Record<string, BoardView> = {};
  if (typeof raw === 'object' && raw !== null) {
    for (const [id, view] of Object.entries(raw as Record<string, unknown>).slice(0, 200)) if (isBoardView(view)) boards[id] = view;
  }
  if (!boards[MAIN_SHEET] && isBoardView(oldBoard)) boards[MAIN_SHEET] = oldBoard;
  return boards;
}

function isBoardView(value: unknown): value is BoardView {
  return isPoint(value) && typeof (value as BoardView).zoom === 'number';
}

// 一時停止が先、休眠が後になっていること
export function isSleepSettings(value: unknown): value is SleepSettings {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.suspendMinutes === 'number' &&
    typeof v.discardMinutes === 'number' &&
    v.suspendMinutes > 0 &&
    v.discardMinutes > v.suspendMinutes
  );
}

export function savePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // 保存できない環境でも動作は続ける
  }
}

function pick<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function isPoint(value: unknown): value is { x: number; y: number } {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.x === 'number' && typeof v.y === 'number';
}
