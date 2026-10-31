// 届いた k/n（段 8。計画 §1）
//   k は「回答あり」の席だけ。遅れ・エラー・待つのをやめた・調査中は数えない
//   殻と帯は、いま届きかけの組（終わっていない組）のいちばん新しいもの。札は、その札の組
//   組が終わったあとの殻は暗いまま（届いた数の記念にはしない）。札には、その組の k/n を残す
import { t } from './i18n';
export interface ArrivedGroup {
  group: number;
  states: readonly string[];
}

export interface ArrivedCount {
  k: number;
  n: number;
  group: number | null;
}

const DONE = new Set(['replied', 'error', 'stopped']);

export function countArrived(states: readonly string[]): { k: number; n: number } {
  let k = 0;
  for (const state of states) if (state === 'replied') k += 1;
  return { k, n: states.length };
}

export function arrivedLabel(k: number, n: number): string {
  return t('届いた {0}/{1}', { 0: Math.max(0, Math.floor(k)), 1: Math.max(0, Math.floor(n)) });
}

export function groupInFlight(states: readonly string[]): boolean {
  return states.length > 0 && states.some((state) => !DONE.has(state));
}

// 送った組のうち、まだ終わっていないいちばん新しい組。無ければ 0（殻は静か）
export function shellArrived(groups: readonly ArrivedGroup[]): ArrivedCount {
  let best: ArrivedGroup | null = null;
  for (const item of groups) {
    if (item.group <= 0 || !groupInFlight(item.states)) continue;
    if (!best || item.group > best.group) best = item;
  }
  if (!best) return { k: 0, n: 0, group: null };
  const counted = countArrived(best.states);
  return { k: counted.k, n: counted.n, group: best.group };
}

// 組の札。席が無いときは空（数を作らない）
export function cardArrivedLabel(states: readonly string[] | null | undefined): string {
  if (!states || states.length === 0) return '';
  const counted = countArrived(states);
  return arrivedLabel(counted.k, counted.n);
}

const REQUEST_STATES = new Set(['unsent', 'sent', 'working', 'replied', 'late', 'error', 'stopped']);

// 1 件の札。返事が届いていれば 1/1、まだなら 0/1。状態が無いときは空
export function requestArrivedLabel(state: string | null | undefined): string {
  if (!state || !REQUEST_STATES.has(state)) return '';
  return arrivedLabel(state === 'replied' ? 1 : 0, 1);
}

// 帯・タブ・合体の行。k が 0 のときは足さない（静か）
export function withArrivedLine(line: string, k: number, n: number): string {
  if (k <= 0 || n <= 0) return line;
  const arrived = arrivedLabel(k, n);
  return line ? t('{0}・{1}', { 0: line, 1: arrived }) : arrived;
}
