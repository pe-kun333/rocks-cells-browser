// ボード（Track B）：旗は廃止した（2026-10-25・利用者の指示「旗を本体に反映」）。
//   「ボード」タブ・［上に出す］・メモの選び口は、**常にオン**のコードになった。localStorage の旧い鍵
//   honeycomb.cardBoardStages・honeycomb.boardMemoPicker は、もう**読まない**（残っていても無視。消す処理も無い）。
//   Grok Cards の旗（honeycomb.cardsStages）の段 "3"（ボードが入る枠）も cards-stages.ts で常にオン。ほかの段（1・2・4〜9）は今までどおりその旗のまま。
//   置き場（honeycomb.boardPlace）と境目の割合（honeycomb.boardUpperRatio）は旗ではなく保存値なので、そのまま使う（初期の置き場は下）。
//   旗の版に戻す方法は docs/plan-board-memo-switch.md の §7（`git revert` で戻る）。
export const CARD_BOARD_EVENT = 'honeycomb-cardboard';
export const BOARD_PLACE_KEY = 'honeycomb.boardPlace';
export const BOARD_UPPER_RATIO_KEY = 'honeycomb.boardUpperRatio';

import { CARDS_PLACE_KEY, CARDS_STAGES_KEY, cardsStageOn, writeCardsPlace } from './cards-stages';
import { readUpperRatioRaw } from './grok-cards-place';
import { bumpNote, changePlaces, normalizeBoardPlace, normalizePlaces, type BoardPlace, type PlaceChange, type PlaceGates, type PlaceRequest, type Places } from './memo-card-board-place';

// ---------- 案 C「上に出す」の置き場と割合 ----------

// ボードを上に出せるか：常にオン（旗は廃止）。呼ぶ側の分岐（置き場の組み替えなど）は今までの形のまま
export function boardUpperEnabled(): boolean {
  return true;
}
function readRawJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

// 同じ面への通知（別の面には storage が飛ぶ）
function pokeBoard() {
  try {
    window.dispatchEvent(new Event(CARD_BOARD_EVENT));
  } catch {
    return;
  }
}

function writeBoardJson(key: string, value: unknown): boolean {
  try {
    const text = JSON.stringify(value);
    if (localStorage.getItem(key) === text) return false;
    localStorage.setItem(key, text);
    return true;
  } catch {
    return false;
  }
}

// 置き場の鍵が無い・壊れているときは下
export function readBoardPlace(): BoardPlace {
  return normalizeBoardPlace(boardUpperEnabled(), readRawJson(BOARD_PLACE_KEY));
}

// 値が同じなら書かない。書いたときだけ同じ面へ知らせる
export function writeBoardPlace(place: BoardPlace): boolean {
  if (!boardUpperEnabled()) return false;
  const wrote = writeBoardJson(BOARD_PLACE_KEY, place === 'upper' ? 'upper' : 'bottom');
  if (wrote) pokeBoard();
  return wrote;
}

// 境目の割合。0 以下・1 以上・数でないときは半分（保存はしない）。下の帯の高さ・Grok Cards の割合とは別の鍵
export function readBoardUpperRatio(): number {
  return readUpperRatioRaw(boardUpperEnabled(), readRawJson(BOARD_UPPER_RATIO_KEY));
}

// 範囲外や数でない値は書かない。ドラッグの途中で再描画させないので、同じ面への知らせも出さない（Grok Cards の割合と同じ）
export function writeBoardUpperRatio(ratio: number): boolean {
  if (!boardUpperEnabled()) return false;
  if (readUpperRatioRaw(true, ratio) !== ratio) return false;
  return writeBoardJson(BOARD_UPPER_RATIO_KEY, ratio);
}

export function placeGates(): PlaceGates {
  return { stage9: cardsStageOn('9'), stage2: boardUpperEnabled() };
}

// いまの置き場（Grok Cards とボード）。両方が上と読めたら Grok Cards を残し、ボードを下と読む（書き換えはしない。書き換えは settleBoardPlace）
export function readPlaces(): { places: Places; bumped: 'cards' | 'board' | null } {
  return normalizePlaces(placeGates(), readRawJson(CARDS_PLACE_KEY), readRawJson(BOARD_PLACE_KEY));
}

// 起動時など：両方が上と残っていたら、下へ戻すほうの鍵を bottom に書き戻す（再読み込みのたびに同じ取り合いをしないため）。知らせる一言を返す（無ければ空）
export function settleBoardPlace(): string {
  const { bumped } = readPlaces();
  if (bumped === 'board') writeBoardPlace('bottom');
  return bumpNote(bumped);
}

// 「上に出す」「下に戻す」を保存する。取り合いで下へ戻されたほうの鍵も bottom に書き戻す。
//   書く順は、下へ戻すほうを先・上へ出すほうを後（別の面の storage 通知が「両方上」を見ないように）。Grok Cards の鍵は既存の writeCardsPlace（段 9 が無ければ書かない）
export function requestPlace(req: PlaceRequest): PlaceChange & { note: string } {
  const gates = placeGates();
  const current = normalizePlaces(gates, readRawJson(CARDS_PLACE_KEY), readRawJson(BOARD_PLACE_KEY)).places;
  const change = changePlaces(gates, current, req);
  if (change.changed) {
    // 変わったほうの鍵だけ書く（関係のない鍵を新しく作らない）
    const writeCards = () => void (change.places.cards !== current.cards && writeCardsPlace(change.places.cards));
    const writeBoard = () => void (change.places.board !== current.board && writeBoardPlace(change.places.board));
    if (req.who === 'cards') {
      writeBoard(); // 取り合いで下へ戻されるボードを先に
      writeCards();
    } else {
      writeCards(); // 取り合いで下へ戻される Grok Cards を先に
      writeBoard();
    }
  }
  return { ...change, note: bumpNote(change.bumped) };
}

// 置き場・割合・旗が変わったときの通知（別の面からは storage、同じ面からは CARD_BOARD_EVENT・Grok Cards の事件）。外す関数を返す
//   C3 が使う
export function onBoardPlace(fn: () => void): () => void {
  const keys = new Set([CARDS_STAGES_KEY, BOARD_PLACE_KEY, BOARD_UPPER_RATIO_KEY, CARDS_PLACE_KEY]);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || keys.has(e.key)) fn();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CARD_BOARD_EVENT, fn);
  window.addEventListener('honeycomb-cards', fn);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CARD_BOARD_EVENT, fn);
    window.removeEventListener('honeycomb-cards', fn);
  };
}
