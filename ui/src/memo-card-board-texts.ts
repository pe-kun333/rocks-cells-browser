// ボード（Track B）の面に出す「動かせない・入りきらない・読めない」の文を 1 か所にそろえる（B4-1。文だけで、動きは変えない）
//   型：動作 ＋「できません」＋ 理由。書き込まないときは「（書き込みません）」を付け、読めない理由（boardUnreadableNote）を続ける
//   数え方：台帳のカード＝「件」（1 つのメモに入るのは 300 件まで）。ボードの位置＝「件」（ボードに残せる位置は 300 件まで）。型・選んだカードの枚数＝「枚」
import { BOARD_LIMITS } from './memo-card-board';
import { boardUnreadableNote, type LoadBoardResult } from './memo-card-board-store';
import { MAX_REPLIES } from './threads';

// 読み込み中の文。verb＝「動かして」「足して」「貼って」「操作して」
export const loadingNote = (verb: string) => `ボードを読み込み中です。少し待ってから${verb}ください`;

// 読めないボードに書かない文。action＝「カードは動かせません」など
export const unreadableBlockNote = (action: string, why: Extract<LoadBoardResult, { state: 'unreadable' }>['why']) => `${action}（書き込みません）。${boardUnreadableNote(why)}`;

// 台帳（1 メモ 300 件）がいっぱいの文。action＝「カードを足せません」「型を貼れません」
export const ledgerFullNote = (action: string) => `${action}（1 つのメモに入るのは ${MAX_REPLIES} 件までです）`;

// ボードの位置（300 件）に入りきらない文。room＝あと何件、cards＝型の枚数
export const nodesFullNote = (room: number, cards: number) => `型を貼れませんでした（ボードに残せる位置は ${BOARD_LIMITS.nodes} 件までです。あと ${Math.max(0, room)} 件、型は ${cards} 枚です）`;

export const BOARD_EMPTY_TEXT = 'このメモにはカードがまだありません';
export const BOARD_LOADING_NOTE = 'ボードを読み込み中です…';