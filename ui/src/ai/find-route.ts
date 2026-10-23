// 順路の記録から、言葉に合うページを探す（段階9a）
//   渡すのは題名・アドレス・時刻・読んだ量・ハートだけ。ページの本文は見ない
import { isBlockedUrl } from '../blocklist';
import { normalizeRouteUrl, type Route, routeName, searchQueryOf } from '../routes';
import type { Tab } from '../tabs';

const DAY = 24 * 60 * 60_000;

export interface FindHit {
  title: string;
  url: string; // 相棒に返すアドレス。渡し止めは空
  rawUrl: string; // 開くときに使う。渡し止めでは開かない
  blocked: boolean;
  at: number;
  route: string;
  liked: number;
  read: number;
  search?: string;
  score: number;
}

// 時刻の言葉が無ければ null（題名の言葉だけで探す）
function timeWindow(query: string, now: number): { from: number; to: number } | null {
  const today = new Date(now);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (/さっき|先ほど/.test(query)) return { from: now - 3 * 60 * 60_000, to: now + 1 };
  if (/おととい|一昨日/.test(query)) return { from: start - 2 * DAY, to: start - DAY };
  if (/昨日/.test(query)) return { from: start - DAY, to: start };
  if (/今日/.test(query)) return { from: start, to: now + 1 };
  if (/先週/.test(query)) return { from: start - 7 * DAY, to: start };
  if (/今週/.test(query)) {
    const monday = (today.getDay() + 6) % 7;
    return { from: start - monday * DAY, to: now + 1 };
  }
  return null;
}

// 長い言葉を先に消す（「で」だけの消し方が、「ビデオ」の中を割らないように、ひらがなの助詞だけ）
const FILLER =
  /開いてください|見せてください|探してください|開いて|探して|見つけて|見せて|ください|お願い|記事|ページ|サイト|動画|見た|見て|さっき|先ほど|おととい|一昨日|昨日|今日|先週|今週|まで|から|の|を|に|は|が|で|と|も|へ/g;

function needles(query: string): string[] {
  const q = query.toLowerCase().replace(FILLER, ' ');
  const parts = q
    .split(/[\s　、。,.！？!?「」『』]+/)
    .map((s) => s.trim())
    .filter((s) => (/[^\x00-\x7f]/.test(s) ? [...s].length >= 1 : s.length >= 2));
  return [...new Set(parts)].slice(0, 6);
}

// 同じアドレスは1件（点数の高いほう、同じなら新しいほう）
export function findInRoutes(routes: readonly Route[], tabs: readonly Tab[], hosts: readonly string[], query: string, now = Date.now()): { hits: FindHit[]; reason: 'ok' | 'empty' } {
  const when = timeWindow(query, now);
  const words = needles(query);
  if (!when && words.length === 0) return { hits: [], reason: 'empty' };
  const tabByUrl = new Map<string, { liked: number; read: number }>();
  for (const tab of tabs) {
    const key = normalizeRouteUrl(tab.url);
    if (!key) continue;
    const prev = tabByUrl.get(key);
    tabByUrl.set(key, { liked: Math.max(prev?.liked ?? 0, tab.liked), read: Math.max(prev?.read ?? 0, tab.readEdges) });
  }
  const best = new Map<string, FindHit>();
  for (const route of routes) {
    for (const step of route.steps) {
      if (when && (step.at < when.from || step.at >= when.to)) continue;
      const key = normalizeRouteUrl(step.url);
      if (!key) continue;
      const title = step.title.slice(0, 120);
      const hayTitle = title.toLowerCase();
      const hayUrl = key.toLowerCase();
      let wordScore = 0;
      if (words.length === 0) wordScore = 1;
      else {
        for (const w of words) {
          if (hayTitle.includes(w)) wordScore += 4;
          else if (hayUrl.includes(w)) wordScore += 2;
        }
        if (wordScore === 0) continue;
      }
      const extra = tabByUrl.get(key);
      const liked = extra?.liked ?? 0;
      const read = extra?.read ?? 0;
      const blocked = isBlockedUrl(step.url, hosts);
      const hit: FindHit = {
        title,
        url: blocked ? '' : key.slice(0, 200),
        rawUrl: key,
        blocked,
        at: step.at,
        route: routeName(route),
        liked,
        read,
        search: blocked ? undefined : (searchQueryOf(step.url) ?? undefined),
        score: wordScore * 10 + liked * 2 + read,
      };
      const prev = best.get(key);
      if (!prev || hit.score > prev.score || (hit.score === prev.score && hit.at > prev.at)) best.set(key, hit);
    }
  }
  const hits = [...best.values()].sort((a, b) => b.score - a.score || b.at - a.at).slice(0, 8);
  return { hits, reason: 'ok' };
}
