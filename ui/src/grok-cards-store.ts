// Grok Cards の下書き（計画の段 4。案 A：専用シートのメモのカード）
//   シートの見つけ方・作り方はここだけ（作者 2 の仮の既定。名前は「Grok Cards」）
//   今見ているシートは変えない。台帳を読めないときは add を呼ばない（メモリーにも残さない）
import { t } from './i18n';
import { CARDS_SHEET_KEY } from './cards-stages';
import { nearestFree } from './hex';
import { isSpecialCell, type MemoStore } from './memocells';
import { NOTICE_ADDRESS, NOTICE_MEMO, NOTICE_REFUSED, NOTICE_SHEET, planAdd } from './grok-cards-plan';
import { addressTag, EVERYONE_ADDRESS, isCardsBotId, isSentRaw, withPastedTag, withoutSent, withSentTag } from './grok-cards-tags';
import { MAX_SHEETS, type Sheet, type SheetStore } from './sheets';

export const GROK_CARDS_SHEET_NAME = 'Grok Cards';
const MEMO_ROOM = 2000; // memocells.ts の MAX_MEMOS と同じ

export interface GrokCardBrief {
  id: string;
  text: string;
  tags: string[];
}

export function findGrokCardsSheet(sheets: SheetStore): Sheet | null {
  let saved = '';
  try {
    saved = localStorage.getItem(CARDS_SHEET_KEY) ?? '';
  } catch {
    saved = '';
  }
  const byId = saved ? sheets.get(saved) : undefined;
  if (byId) return byId;
  return sheets.list().find((sheet) => sheet.name === GROK_CARDS_SHEET_NAME) ?? null;
}

export function ensureGrokCardsSheet(sheets: SheetStore): Sheet | null {
  const found = findGrokCardsSheet(sheets);
  if (found) {
    rememberSheet(found.id);
    return found;
  }
  if (sheets.list().length >= MAX_SHEETS) return null;
  const made = sheets.add(GROK_CARDS_SHEET_NAME);
  if (made) rememberSheet(made.id);
  return made;
}

function rememberSheet(id: string) {
  try {
    localStorage.setItem(CARDS_SHEET_KEY, id);
  } catch {
    /* 覚えられなくても、名前で探し直す */
  }
}

export function grokCardBriefs(memos: MemoStore, sheets: SheetStore): GrokCardBrief[] {
  const sheet = findGrokCardsSheet(sheets);
  if (!sheet) return [];
  return memos
    .inSheet(sheet.id)
    .filter((memo) => !isSpecialCell(memo))
    .map((memo) => ({ id: memo.id, text: memo.text, tags: [...memo.tags] }));
}

export interface CardWrite {
  ok: boolean;
  notice: string;
  keep: boolean;
  id?: string;
}

function knownAddress(address: string): boolean {
  return address === EVERYONE_ADDRESS || isCardsBotId(address);
}

export function addGrokCard(o: { memos: MemoStore; sheets: SheetStore; address: string; text: string }): CardWrite {
  if (!knownAddress(o.address)) return { ok: false, notice: NOTICE_ADDRESS, keep: true };
  const have = findGrokCardsSheet(o.sheets);
  const plan = planAdd({
    text: o.text,
    writable: o.memos.writableLedger,
    loadFailed: o.memos.loadFailed,
    sheetRoom: !!have || o.sheets.list().length < MAX_SHEETS,
    memoRoom: o.memos.list().length < MEMO_ROOM,
  });
  if (!plan.ok) return { ok: false, notice: plan.notice, keep: true };
  const sheet = have ?? ensureGrokCardsSheet(o.sheets);
  if (!sheet) return { ok: false, notice: NOTICE_SHEET, keep: true };
  const pos = nearestFree({ q: 0, r: 0 }, (hex) => !!o.memos.at(hex, sheet.id));
  const cell = o.memos.add({ sheet: sheet.id, pos, text: plan.text, tags: [addressTag(o.address)] });
  if (!cell) return { ok: false, notice: NOTICE_MEMO, keep: true };
  return { ok: true, notice: plan.notice, keep: false, id: cell.id };
}

export function setGrokCardText(o: { memos: MemoStore; sheets: SheetStore; id: string; text: string }): CardWrite {
  const sheet = findGrokCardsSheet(o.sheets);
  const memo = o.memos.get(o.id);
  if (!sheet || !memo || memo.sheet !== sheet.id || isSpecialCell(memo)) {
    return { ok: false, notice: t('その下書きは、もうありません。書いた文はこの欄に残しています'), keep: true };
  }
  const plan = planAdd({
    text: o.text,
    writable: o.memos.writableLedger,
    loadFailed: o.memos.loadFailed,
    sheetRoom: true,
    memoRoom: true,
  });
  if (!plan.ok) return { ok: false, notice: plan.notice, keep: true };
  if (memo.text !== plan.text) o.memos.update(o.id, { text: plan.text });
  return { ok: true, notice: plan.notice, keep: false, id: memo.id };
}

function cardMemo(o: { memos: MemoStore; sheets: SheetStore; id: string }) {
  const sheet = findGrokCardsSheet(o.sheets);
  const memo = o.memos.get(o.id);
  if (!sheet || !memo || memo.sheet !== sheet.id || isSpecialCell(memo)) return null;
  return memo;
}

function canWrite(memos: MemoStore): boolean {
  return memos.writableLedger && !memos.loadFailed;
}

// 文は変えない。台帳を読めないときは印を付けず、札の文はそのまま
export function markGrokCardSent(o: { memos: MemoStore; sheets: SheetStore; id: string; sent: string }): CardWrite {
  if (!isSentRaw(o.sent)) return { ok: false, notice: '', keep: true };
  const memo = cardMemo(o);
  if (!memo) return { ok: false, notice: t('その下書きは、もうありません'), keep: true };
  if (!canWrite(o.memos)) return { ok: false, notice: NOTICE_REFUSED, keep: true };
  const tags = withSentTag(memo.tags, o.sent);
  if (tags.join('\n') !== memo.tags.join('\n')) o.memos.update(o.id, { tags });
  return { ok: true, notice: '', keep: false, id: memo.id };
}

export function markGrokCardPasted(o: { memos: MemoStore; sheets: SheetStore; id: string }): CardWrite {
  const memo = cardMemo(o);
  if (!memo) return { ok: false, notice: t('その下書きは、もうありません'), keep: true };
  const tags = withPastedTag(memo.tags);
  if (!tags) return { ok: false, notice: '', keep: true };
  if (!canWrite(o.memos)) return { ok: false, notice: NOTICE_REFUSED, keep: true };
  o.memos.update(o.id, { tags });
  return { ok: true, notice: '', keep: false, id: memo.id };
}

export function clearGrokCardSent(o: { memos: MemoStore; sheets: SheetStore; id: string }): CardWrite {
  const memo = cardMemo(o);
  if (!memo) return { ok: false, notice: t('その下書きは、もうありません'), keep: true };
  if (!canWrite(o.memos)) return { ok: false, notice: NOTICE_REFUSED, keep: true };
  o.memos.update(o.id, { tags: withoutSent(memo.tags) });
  return { ok: true, notice: '', keep: false, id: memo.id };
}

export function removeGrokCard(o: { memos: MemoStore; sheets: SheetStore; id: string }): CardWrite {
  const memo = cardMemo(o);
  if (!memo) return { ok: false, notice: t('その下書きは、もうありません'), keep: true };
  if (!canWrite(o.memos)) return { ok: false, notice: NOTICE_REFUSED, keep: true };
  o.memos.remove(o.id);
  return { ok: true, notice: '', keep: false };
}
