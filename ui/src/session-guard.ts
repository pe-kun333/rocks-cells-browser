// 盤面の台帳（session.json）の守り：読めなかった盤面を、新しい盤面で黙って上書きしない
//   C++ は起動のあいさつ（hello）に sessionState（ok・missing・unreadable）と、読めないときの sessionRecovery を添える
//   （src/storage.cpp の LoadSessionForUi）。ここは DOM を使わない決めごとだけ（テストは test/session-guard.test.ts）
//   メモの台帳の守り（memocells.ts の load。読めなければ書かない）と同じ考え：決めるまでは書かない
import { t } from './i18n';
import { parseSession } from './session';
import type { SessionData } from './types';

export type SessionLoadState = 'ok' | 'missing' | 'unreadable';
// open：あるのに開けない（ほかのアプリがつかんでいる・権限）／parse：JSON が壊れている／shape：知らない形（新しい版など）
export type SessionUnreadableReason = 'open' | 'parse' | 'shape';

export interface SessionRecovery {
  reason: SessionUnreadableReason;
  quarantine?: string; // 壊れたファイルの写しの名前（データフォルダの直下）。写せなかったら無い
  backup?: string; // 盤面に使った控え（session.bak1〜3.json）。使える控えが無ければ無い
  backupSavedAt?: number; // 控えの盤面を保存した時刻（ミリ秒）
}

export interface SessionHello {
  session: unknown;
  sessionState?: unknown;
  sessionRecovery?: unknown;
}

export interface SessionStart {
  saved: SessionData | null; // 盤面に並べるもの（控えから戻したときは控え）
  writable: boolean; // すぐに session.json へ書いてよいか（false：使う人が決めるまで書かない）
  recovery: SessionRecovery | null; // 読めなかったとき
}

const REASONS: readonly SessionUnreadableReason[] = ['open', 'parse', 'shape'];

function readRecovery(raw: unknown): SessionRecovery {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const name = (v: unknown) => (typeof v === 'string' && /^session\.[A-Za-z0-9._-]{1,80}\.json$/.test(v) ? v : undefined);
  const reason = REASONS.includes(r.reason as SessionUnreadableReason) ? (r.reason as SessionUnreadableReason) : 'parse';
  const quarantine = name(r.quarantine);
  const backup = name(r.backup);
  const at = typeof r.backupSavedAt === 'number' && Number.isFinite(r.backupSavedAt) && r.backupSavedAt > 0 ? r.backupSavedAt : undefined;
  return { reason, ...(quarantine ? { quarantine } : {}), ...(backup ? { backup } : {}), ...(backup && at ? { backupSavedAt: at } : {}) };
}

// 起動のあいさつから、盤面をどう始めるかを決める
export function decideSessionStart(hello: SessionHello): SessionStart {
  const state = hello.sessionState;
  if (state === 'missing') return { saved: null, writable: true, recovery: null }; // 初めて（本当に無い）
  if (state === 'unreadable') {
    const recovery = readRecovery(hello.sessionRecovery);
    const saved = recovery.backup ? parseSession(hello.session) : null;
    if (!saved) {
      // 控えを C++ が選んでも、UI で読めなければ使わない
      delete recovery.backup;
      delete recovery.backupSavedAt;
    }
    return { saved, writable: false, recovery };
  }
  const saved = parseSession(hello.session);
  if (state === 'ok') {
    // C++ は形を見ているが、UI でも読めなければ同じ扱い（写しは作られていない）
    return saved ? { saved, writable: true, recovery: null } : { saved: null, writable: false, recovery: { reason: 'shape' } };
  }
  // sessionState の無い古い C++：今までどおり（null なら新しい盤面で書く）
  return { saved, writable: true, recovery: null };
}

export interface SessionNoticeText {
  title: string;
  body: string[];
  accept: string; // 書き始める
  decline: string; // この起動では書かない
  recommend: 'accept' | 'decline';
}

const two = (n: number) => String(n).padStart(2, '0');
export function formatSavedAt(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}/${two(d.getMonth() + 1)}/${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

// 読めなかったときの知らせの文（盤面の上の帯に出す）
export function sessionNoticeText(recovery: SessionRecovery): SessionNoticeText {
  const why =
    recovery.reason === 'open'
      ? t('盤面の保存ファイル（session.json）を開けませんでした（ほかのアプリが使っている・権限が無い、など）。')
      : recovery.reason === 'shape'
        ? t('盤面の保存ファイル（session.json）が、この版の知らない形でした（新しい版で保存した、など）。')
        : t('盤面の保存ファイル（session.json）が壊れていて読めませんでした。');
  const copy = recovery.quarantine
    ? t('元のファイルはそのまま残し、写しを {0} に作りました（データフォルダの直下）。', { 0: recovery.quarantine })
    : recovery.reason === 'shape'
      ? t('元のファイルはそのまま残しています。')
      : t('元のファイルはそのまま残しています（写しは作れませんでした）。');
  const now = recovery.backup
    ? t('いまの盤面は、控え {0}{1}から戻したものです。', { 0: recovery.backup, 1: recovery.backupSavedAt ? `（${formatSavedAt(recovery.backupSavedAt)} に保存したもの）` : '' })
    : t('使える控えが無いので、いまの盤面は新しいもの（タブ 1 枚）です。');
  const held = t('決めるまでは、盤面を保存しません。');
  // 開けなかっただけなら、ファイルは無事なことが多い：書き直さず、開き直すのをすすめる。写しが無いときも同じ
  const recommend: 'accept' | 'decline' = recovery.reason === 'open' || !recovery.quarantine || !recovery.backup ? 'decline' : 'accept';
  return {
    title: recovery.backup ? t('盤面を控えから戻しました') : t('前回の盤面を読めませんでした'),
    body: [why, copy, now, held],
    accept: recovery.backup ? t('この盤面で続ける（保存を始める）') : t('新しい盤面で続ける（session.json を書き直す）'),
    decline: t('保存しないで続ける（閉じたあと、ファイルを確かめる）'),
    recommend,
  };
}

// 盤面の保存の成否（C++ の sessionSaved）。変わり目だけを知らせる
export class SaveHealth {
  private failing = false;
  note(ok: boolean): 'failed' | 'recovered' | null {
    if (ok === !this.failing) return null;
    this.failing = !ok;
    return ok ? 'recovered' : 'failed';
  }
  get isFailing() {
    return this.failing;
  }
}

export const SAVE_FAILED_TEXT = t('盤面（session.json）を保存できていません。ディスクの空き・フォルダの権限・ほかのアプリがファイルを開いていないかを確かめてください（直ると、この知らせは消えます）。');
