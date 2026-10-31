// 下書きを足す前の判断（台帳を読めないときは書かない。書いた文は残す）
//   鍵に似た字は知らせるだけ（作者 5。止めない。この段では外へ送らない）
import { t } from './i18n';
import { looksLikeSecret, SECRET_NOTICE } from './grok-cards-tags';

export const PLAN_TEXT_MAX = 5000;

export const NOTICE_EMPTY = t('頼む文を書いてから、下書きにしてください');
export const NOTICE_REFUSED = t('台帳を読めていないので、下書きは保存できません。書いた文はこの欄に残しています');
export const NOTICE_SHEET = t('シートがいっぱいなので、下書きは保存できません。書いた文はこの欄に残しています');
export const NOTICE_MEMO = t('メモがいっぱいなので、下書きは保存できません。書いた文はこの欄に残しています');
export const NOTICE_ADDRESS = t('宛て先が分かりません。書いた文はこの欄に残しています');

export function planText(text: string): string {
  return [...String(text ?? '').replace(/\r\n?/g, '\n')].slice(0, PLAN_TEXT_MAX).join('').trim();
}

export type PlanAdd = { ok: true; text: string; secret: boolean; notice: string } | { ok: false; notice: string; keep: true };

export function planAdd(input: { text: string; writable: boolean; loadFailed: boolean; sheetRoom: boolean; memoRoom: boolean }): PlanAdd {
  const text = planText(input.text);
  if (!text) return { ok: false, notice: NOTICE_EMPTY, keep: true };
  if (!input.writable || input.loadFailed) return { ok: false, notice: NOTICE_REFUSED, keep: true };
  if (!input.sheetRoom) return { ok: false, notice: NOTICE_SHEET, keep: true };
  if (!input.memoRoom) return { ok: false, notice: NOTICE_MEMO, keep: true };
  const secret = looksLikeSecret(text);
  return { ok: true, text, secret, notice: secret ? SECRET_NOTICE : '' };
}
