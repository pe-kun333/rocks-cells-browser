// 合図（段階4）。印を出すかどうかの決まりだけ。画面も、送ることも、ここには無い。
//   見守る：印を出さない。合図だけ：人が押すまで下書きまで。アプリもクリップボードも動かさない。
import { t } from './i18n';
import { hostOf } from './util';

export type CueMode = 'watch' | 'cue';
export type CueKind = 'page' | 'selection' | 'stay';

export const CUE_SKIP_LIMIT = 3; // 同じサイトで「今は不要」がこの回数続くと、その種類を控える
export const CUE_DAILY_DEFAULT = 8; // はじめは少なめ。相棒が自分から話す回数より小さい
export const CUE_DAILY_MAX = 40;
export const CUE_STAY_MS = 45_000;
export const CUE_SELECTION_MIN = 12;

export interface CueSettings {
  mode: CueMode;
  paused: boolean;
  dailyLimit: number;
  day: string;
  shown: number;
  skips: Record<string, number>;
}

const KEY = 'honeycomb.cue';

export function cueDay(now = new Date()): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

// http(s) のホストだけ。それ以外は空（手元のページ）
export function cueHost(url: string): string {
  const host = hostOf(url);
  if (!host) return '';
  try {
    const protocol = new URL(url).protocol;
    if (protocol !== 'http:' && protocol !== 'https:') return '';
  } catch {
    return '';
  }
  return host.toLowerCase();
}

export function skipKey(host: string, kind: CueKind): string {
  return `${host}|${kind}`;
}

export function defaultCueSettings(now = new Date()): CueSettings {
  return { mode: 'cue', paused: false, dailyLimit: CUE_DAILY_DEFAULT, day: cueDay(now), shown: 0, skips: {} };
}

export function loadCueSettings(now = new Date()): CueSettings {
  const base = defaultCueSettings(now);
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return base;
    const s = raw as Record<string, unknown>;
    const skips: Record<string, number> = {};
    if (typeof s.skips === 'object' && s.skips !== null) {
      for (const [key, value] of Object.entries(s.skips)) {
        if (typeof value === 'number' && value > 0) skips[key] = Math.min(CUE_SKIP_LIMIT, Math.floor(value));
      }
    }
    const limit = typeof s.dailyLimit === 'number' && Number.isFinite(s.dailyLimit) ? Math.min(CUE_DAILY_MAX, Math.max(1, Math.round(s.dailyLimit))) : base.dailyLimit;
    return rollCueDay(
      {
        mode: s.mode === 'watch' ? 'watch' : 'cue',
        paused: s.paused === true,
        dailyLimit: limit,
        day: typeof s.day === 'string' ? s.day : base.day,
        shown: typeof s.shown === 'number' && s.shown > 0 ? Math.floor(s.shown) : 0,
        skips,
      },
      now,
    );
  } catch {
    return base;
  }
}

export function saveCueSettings(settings: CueSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // 保存できなくても、今開いているあいだの合図は続ける
  }
}

export function rollCueDay(settings: CueSettings, now = new Date()): CueSettings {
  const day = cueDay(now);
  return settings.day === day ? settings : { ...settings, day, shown: 0 };
}

export function kindQuiet(settings: CueSettings, host: string, kind: CueKind): boolean {
  return (settings.skips[skipKey(host, kind)] ?? 0) >= CUE_SKIP_LIMIT;
}

export function noteCueSkip(settings: CueSettings, host: string, kind: CueKind): CueSettings {
  const key = skipKey(host, kind);
  const count = Math.min(CUE_SKIP_LIMIT, (settings.skips[key] ?? 0) + 1);
  return { ...settings, skips: { ...settings.skips, [key]: count } };
}

export function noteCueAccept(settings: CueSettings, host: string, kind: CueKind): CueSettings {
  const key = skipKey(host, kind);
  if (!settings.skips[key]) return settings;
  const skips = { ...settings.skips };
  delete skips[key];
  return { ...settings, skips };
}

export function canShowCue(settings: CueSettings, host: string, kind: CueKind): boolean {
  if (!host || settings.mode !== 'cue' || settings.paused) return false;
  if (settings.shown >= settings.dailyLimit) return false;
  return !kindQuiet(settings, host, kind);
}

export const CUE_KIND_LABEL: Record<CueKind, string> = {
  page: t('ページが変わった'),
  selection: t('文を選んだ'),
  stay: t('同じページにいた'),
};

export function cueLine(kind: CueKind, title: string, selection: string): string {
  const name = title.trim() || t('このページ');
  if (kind === 'selection') {
    const bit = [...selection.trim()].slice(0, 42).join('');
    return `文を選びました：「${bit}${[...selection.trim()].length > 42 ? '…' : ''}」`;
  }
  if (kind === 'stay') return `このページに少しいました：「${name}」`;
  return `ページが変わりました：「${name}」`;
}

export function cueAsk(kind: CueKind): string {
  if (kind === 'selection') return 'この選んだ文を、分かりやすく説明してください。';
  if (kind === 'stay') return 'このページの次に調べるとよさそうなことを、一つ教えてください。';
  return 'このページの要点を、短く教えてください。';
}

// 今見ている範囲。見守るなら「見ていません」。外に出さないページなら「このページは手元だけ」
export function cueScope(settings: CueSettings, local: boolean): string {
  if (settings.paused) return t('一時停止中');
  if (settings.mode === 'watch') return t('見ていません');
  if (local) return t('このページは手元だけ');
  if (settings.shown >= settings.dailyLimit) return t('今日の合図は {0}/{1} 回までです', { 0: settings.shown, 1: settings.dailyLimit });
  return t('合図だけ（今日 {0}/{1} 回）', { 0: settings.shown, 1: settings.dailyLimit });
}
