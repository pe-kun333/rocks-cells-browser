// 札の状態（段 5〜7）。入力と答えだけ。DOM も台帳も見ない
//   段 6 が無いあいだは、送った札は灰の「コピーした」。琥珀の「貼る前」は段 6 から
import { t } from './i18n';
import { parsePasted, parseSent } from './grok-cards-tags';

export const RECORD_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

export type CardKind = 'draft' | 'copied' | 'unpasted' | 'waiting' | 'late' | 'replied' | 'error' | 'stopped' | 'expired';

export interface FaceRequest {
  state: string;
  createdAt: number;
}

export function cardFace(input: {
  tags: readonly string[];
  stage6: boolean;
  stage7: boolean;
  now: number;
  request: FaceRequest | null;
  groupStates: readonly string[] | null;
  requestsReady: boolean;
  queueLeft: boolean;
  overdue: boolean;
  recordDays?: number;
}): { kind: CardKind; label: string } {
  const sent = parseSent(input.tags);
  if (!sent) return { kind: 'draft', label: '' };
  if (input.overdue) return expired();
  const days = input.recordDays ?? RECORD_DAYS;
  if (input.stage7 && input.request && finished(input.request.state) && input.now - input.request.createdAt > days * DAY) return expired();
  if (input.stage7 && input.requestsReady && sent.group === null && sent.raw !== 'chat' && !input.request) return expired();
  if (input.stage7 && input.requestsReady && sent.group !== null && !input.groupStates && !input.queueLeft) return expired();
  const live = input.stage7 ? liveKind(input.request?.state ?? null, input.groupStates) : null;
  if (live === 'error' || live === 'late' || live === 'replied' || live === 'stopped') return labeled(live);
  const pasted = parsePasted(input.tags) === sent.raw;
  if (input.stage6 && !pasted) return { kind: 'unpasted', label: t('貼る前') };
  if (input.stage6 && pasted) return { kind: 'waiting', label: t('返事待ち') };
  return { kind: 'copied', label: t('コピーした（貼ったかは分かりません）') };
}

function expired(): { kind: CardKind; label: string } {
  return { kind: 'expired', label: t('記録は期限で消えました') };
}

function finished(state: string): boolean {
  return state === 'replied' || state === 'error' || state === 'stopped';
}

function labeled(kind: 'error' | 'late' | 'replied' | 'stopped'): { kind: CardKind; label: string } {
  if (kind === 'error') return { kind, label: t('エラー !') };
  if (kind === 'late') return { kind, label: t('遅れ') };
  if (kind === 'replied') return { kind, label: t('返事あり') };
  return { kind, label: t('待つのをやめた') };
}

function liveKind(state: string | null, group: readonly string[] | null): 'error' | 'late' | 'replied' | 'stopped' | 'waiting' | null {
  if (group) return groupKind(group);
  if (!state) return null;
  if (state === 'error' || state === 'late' || state === 'replied' || state === 'stopped') return state;
  if (state === 'sent' || state === 'working') return 'waiting';
  return null;
}

export function groupKind(states: readonly string[]): 'error' | 'late' | 'replied' | 'stopped' | 'waiting' {
  if (states.some((state) => state === 'error')) return 'error';
  if (states.some((state) => state === 'late')) return 'late';
  if (!states.length) return 'waiting';
  if (states.every((state) => state === 'replied' || state === 'stopped')) {
    return states.some((state) => state === 'replied') ? 'replied' : 'stopped';
  }
  return 'waiting';
}

export function heldGroups(cards: readonly { tags: readonly string[] }[]): Set<number> {
  const groups = new Set<number>();
  for (const card of cards) {
    const sent = parseSent(card.tags);
    if (sent?.group != null) groups.add(sent.group);
  }
  return groups;
}

// 1 日前から強くする。文は「7 日で…」、残りが 1 日以内なら「あと 1 日で…」
export function queueNote(createdAt: number, now: number, days = 7): { text: string; soon: boolean } {
  const soon = createdAt + days * DAY - now <= DAY;
  return { text: soon ? t('あと 1 日で順番待ちから外れます') : t('{0} 日で順番待ちから外れます', { 0: days }), soon };
}
