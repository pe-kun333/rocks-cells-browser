// YouTube の動画を「区間セル」で読む：字幕（文字起こし）を時刻つきで取り出し、約70字ずつのマスにまとめる
//   ・文字起こしは、YouTube 自身が取り寄せたものを読む（YouTube の印が要るので、こちらからは直接取り寄せられない）
//     0) 字幕を出していれば、プレーヤーが取り寄せた字幕  1) 「文字起こしを表示」の行（チャプターも）
//     2) 字幕を一度オンにして、プレーヤーが取り寄せた字幕（すぐ元に戻す）。開いたパネルも閉じておく
//   ・再生位置を見る・その位置へ移る・再生と一時停止も、決まったスクリプトだけをページで動かす（C++ の evalInTab 経由）
import { request } from '../bridge';
import { CHUNK, type Chunk, sentences } from './ribbon';

export interface TranscriptSegment {
  start: number; // 秒
  end: number;
  text: string;
}

export interface Transcript {
  videoId: string;
  title: string;
  duration: number;
  chapters: { start: number; title: string }[];
  segments: TranscriptSegment[];
  source: 'panel' | 'captions';
}

export type TranscriptResult = Transcript | { error: 'notVideo' | 'noTranscript' | 'failed'; videoId?: string; title?: string };

export interface VideoState {
  videoId: string | null; // YouTube の動画のときだけ
  hasMedia: boolean; // ページに動画・音声がある
  time: number;
  paused: boolean;
  duration: number;
  ad: boolean; // 広告の再生中
}

export interface TimedChunk extends Chunk {
  start: number;
  end: number;
}

// ---------- URL ----------

export function videoIdOf(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
    if (u.pathname === '/watch') return u.searchParams.get('v');
    return u.pathname.match(/^\/(?:shorts|live)\/([\w-]{11})/)?.[1] ?? null;
  } catch {
    return null;
  }
}

export const isVideoUrl = (url: string) => !!videoIdOf(url);
export const canonicalVideoUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

// その時刻から再生する URL
export function timedUrl(url: string, sec: number) {
  const id = videoIdOf(url);
  return id ? `${canonicalVideoUrl(id)}&t=${Math.max(0, Math.floor(sec))}s` : url;
}

export function timeLabel(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

// ---------- ページで動かすスクリプト ----------

const TRANSCRIPT_SCRIPT = `(async () => {
  const MAX_SEGMENTS = 4000;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const idOf = (href) => {
    try {
      const u = new URL(href);
      return u.searchParams.get('v') || (u.pathname.match(/^\\/(?:shorts|live)\\/([\\w-]{11})/) || [])[1] || null;
    } catch {
      return null;
    }
  };
  const videoId = idOf(location.href);
  if (!videoId) return { error: 'notVideo' };
  // ページの中で別の動画へ移った直後は、プレーヤーが新しい動画に切り替わるまで待つ
  const moviePlayer = () => document.querySelector('#movie_player');
  const responseOf = () => moviePlayer()?.getPlayerResponse?.();
  for (let i = 0; i < 32 && responseOf()?.videoDetails?.videoId !== videoId; i++) await sleep(250);
  const response = responseOf();
  const player = response?.videoDetails?.videoId === videoId ? response : null;
  const title = player?.videoDetails?.title || document.title.replace(/^\\(\\d+\\)\\s*/, '').replace(/ - YouTube$/, '');
  const video = document.querySelector('video');
  const duration = Number(player?.videoDetails?.lengthSeconds) || (video && Number.isFinite(video.duration) ? video.duration : 0);
  const toSec = (s) => (s || '').trim().split(':').reduce((a, b) => a * 60 + (Number(b) || 0), 0);
  const cleanChapter = (s) => s.replace(/^(?:チャプター|Chapter)\\s*\\d+\\s*[:：]\\s*/i, '').trim();
  const done = (segments, chapters, source) => ({ videoId, title, duration, chapters, segments: segments.slice(0, MAX_SEGMENTS), source });

  // ---- 字幕：プレーヤーが取り寄せた字幕（YouTube の印 pot 付きの URL）を、もう一度取り寄せて読む ----
  const isCaptionUrl = (n) => n.includes('/api/timedtext') && n.includes('v=' + videoId) && /[?&]pot=/.test(n);
  const fromCaptions = async (url) => {
    try {
      const u = new URL(url);
      u.searchParams.set('fmt', 'json3');
      const body = await (await fetch(u.toString(), { credentials: 'include' })).text();
      const events = body ? JSON.parse(body).events || [] : [];
      return events
        .filter((e) => e.segs)
        .map((e) => ({ start: (e.tStartMs || 0) / 1000, end: ((e.tStartMs || 0) + (e.dDurationMs || 0)) / 1000, text: e.segs.map((s) => s.utf8 || '').join('').replace(/\\s+/g, ' ').trim() }))
        .filter((s) => s.text);
    } catch {
      return [];
    }
  };

  // 0) 字幕をもう出している（プレーヤーが取り寄せてある）なら、それを読む。画面は何も変えない
  const known = performance.getEntriesByType('resource').map((e) => e.name).filter(isCaptionUrl);
  if (known.length) {
    const segments = await fromCaptions(known[known.length - 1]);
    if (segments.length) return done(segments, [], 'captions');
  }

  // 1) 「文字起こしを表示」を開いて、並んだ行を読む（チャプターも分かる）
  const SEG = 'transcript-segment-view-model, ytd-transcript-segment-renderer';
  const rows = () => [...document.querySelectorAll(SEG)];
  const signature = () => {
    const r = rows();
    return r.length ? r.length + '|' + r[0].textContent + '|' + r[r.length - 1].textContent : '';
  };
  // 行が並び終わる（続けて3回同じになる）まで待つ。並べ直している途中を読まないように
  const settle = async (limit) => {
    const start = Date.now();
    let last = signature();
    let same = 0;
    while (Date.now() - start < limit) {
      await sleep(300);
      const now = signature();
      same = now && now === last ? same + 1 : 0;
      last = now;
      if (same >= 2) return true;
    }
    return !!last;
  };
  const button = document.querySelector('ytd-video-description-transcript-section-renderer button');
  let ready = false;
  let opened = false;
  if (window.__hcTranscriptFor === videoId && rows().length) {
    ready = await settle(3000); // この動画の行はもう読み込んである（パネルは開かない）
  } else if (button) {
    const before = signature();
    button.click();
    opened = true;
    // 前の動画の行が残っていることがあるので、入れ替わるのを待つ
    const start = Date.now();
    while (Date.now() - start < 6000) {
      await sleep(250);
      const now = signature();
      if (now && (now !== before || Date.now() - start > 2500)) break;
    }
    ready = !!signature() && (await settle(4000));
  }
  let segments = [];
  const chapters = [];
  if (ready) {
    let pending = null;
    for (const el of document.querySelectorAll(SEG + ', timeline-chapter-view-model, ytd-transcript-section-header-renderer')) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'timeline-chapter-view-model' || tag === 'ytd-transcript-section-header-renderer') {
        const name = cleanChapter((el.querySelector('h3, h2, [role="heading"]') || el).textContent || '');
        if (name) pending = name;
        continue;
      }
      const stamp = el.querySelector('.ytwTranscriptSegmentViewModelTimestamp, .segment-timestamp')?.textContent;
      const text = (el.querySelector('.ytAttributedStringHost, .segment-text, [role="text"]')?.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!text) continue;
      const at = toSec(stamp);
      if (pending) {
        chapters.push({ start: at, title: pending });
        pending = null;
      }
      segments.push({ start: at, text });
    }
  }
  if (opened) {
    // 開いたパネルは閉じておく（読めなかったときも）
    const panel = [...document.querySelectorAll('ytd-engagement-panel-section-list-renderer')].find(
      (p) => p.getAttribute('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED' && /transcript/.test(p.getAttribute('target-id') || ''),
    );
    panel?.querySelector('#visibility-button button, button[aria-label*="閉じる"], button[aria-label*="Close"]')?.click();
  }
  if (segments.length) {
    window.__hcTranscriptFor = videoId;
    segments = segments.map((s, i, a) => ({ ...s, end: a[i + 1]?.start ?? (duration || s.start + 5) }));
    return done(segments, chapters, 'panel');
  }

  // 2) 字幕（CC）を一度オンにして、プレーヤーが取り寄せた字幕を読む。終わったら元に戻す
  const cc = document.querySelector('.ytp-subtitles-button');
  if (cc && cc.getAttribute('aria-disabled') !== 'true' && getComputedStyle(cc).display !== 'none') {
    for (let i = 0; i < 60 && moviePlayer()?.classList.contains('ad-showing'); i++) await sleep(250); // 広告が終わるのを待つ
    const seen = [];
    const observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (isCaptionUrl(e.name)) seen.push(e.name);
    });
    observer.observe({ type: 'resource' });
    const wasOn = cc.getAttribute('aria-pressed') === 'true';
    if (wasOn) {
      cc.click(); // 一度オフにしてからオンにすると、取り寄せ直す
      await sleep(300);
    }
    cc.click();
    for (let i = 0; i < 32 && !seen.length; i++) await sleep(250);
    observer.disconnect();
    if (!wasOn && cc.getAttribute('aria-pressed') === 'true') cc.click(); // 元に戻す
    if (seen.length) {
      const list = await fromCaptions(seen[seen.length - 1]);
      if (list.length) return done(list, [], 'captions');
    }
  }
  return { videoId, title, duration, error: button || cc ? 'noTranscript' : 'noButton' };
})()`;

// 再生・位置を扱うメディア：YouTube のプレーヤー、無ければページの中の動画・音声（再生中のもの、無ければいちばん長いもの）
const PICK_MEDIA = `const pickMedia = () => {
    const yt = document.querySelector('#movie_player video');
    if (yt) return yt;
    const list = [...document.querySelectorAll('video, audio')];
    const len = (m) => (Number.isFinite(m.duration) ? m.duration : 0);
    return list.find((m) => !m.paused) || list.sort((a, b) => len(b) - len(a))[0] || null;
  };`;

const STATE_SCRIPT = `(() => {
  ${PICK_MEDIA}
  const v = pickMedia();
  const u = new URL(location.href);
  const id = u.hostname.endsWith('youtube.com') ? u.searchParams.get('v') || (u.pathname.match(/^\\/(?:shorts|live)\\/([\\w-]{11})/) || [])[1] || null : null;
  const p = document.querySelector('#movie_player');
  return { videoId: id, hasMedia: !!v, time: v ? v.currentTime : 0, paused: v ? v.paused : true, duration: v && Number.isFinite(v.duration) ? v.duration : 0, ad: !!(p && p.classList.contains('ad-showing')) };
})()`;

const seekScript = (sec: number, play: boolean) => `(() => {
  ${PICK_MEDIA}
  const p = document.querySelector('#movie_player');
  const v = pickMedia();
  if (p && p.seekTo) p.seekTo(${sec}, true);
  else if (v) v.currentTime = ${sec};
  if (${play}) { if (p && p.playVideo) p.playVideo(); else if (v) v.play(); }
  return true;
})()`;

const TOGGLE_SCRIPT = `(() => {
  ${PICK_MEDIA}
  const p = document.querySelector('#movie_player');
  const v = pickMedia();
  if (!v) return null;
  const play = v.paused;
  if (p && p.playVideo) { if (play) p.playVideo(); else p.pauseVideo(); }
  else if (play) v.play(); else v.pause();
  return play;
})()`;

async function evalIn(tabId: number, script: string, timeoutMs: number): Promise<unknown> {
  const reply = await request((requestId) => ({ type: 'evalInTab', requestId, id: tabId, script }), timeoutMs);
  return reply?.type === 'evalResult' && reply.ok ? reply.value : undefined;
}

// 文字起こしを取り出す。ページを読み込んでいる途中（ボタンがまだ無い）なら、少し待ってやり直す
export async function fetchTranscript(tabId: number): Promise<TranscriptResult> {
  let noButton: { videoId?: string; title?: string } | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const value = (await evalIn(tabId, TRANSCRIPT_SCRIPT, 30_000)) as (Partial<Transcript> & { error?: string }) | undefined;
    if (value && Array.isArray(value.segments) && value.segments.length > 0 && value.videoId) {
      return {
        videoId: value.videoId,
        title: value.title ?? '',
        duration: Number(value.duration) || 0,
        chapters: Array.isArray(value.chapters) ? value.chapters : [],
        segments: value.segments,
        source: value.source === 'captions' ? 'captions' : 'panel',
      };
    }
    if (value?.error === 'notVideo') return { error: 'notVideo' };
    // 開いた直後は YouTube の文字起こしが空のことがある：一度だけ、少し待ってやり直す
    if (value?.error === 'noTranscript') {
      if (attempt >= 1) return { error: 'noTranscript', videoId: value.videoId, title: value.title };
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    if (value?.error === 'noButton') noButton = { videoId: value.videoId, title: value.title };
    await new Promise((r) => setTimeout(r, 1500)); // 説明欄がまだ出ていない（読み込み中）：待ってもう一度
  }
  // 待っても「文字起こしを表示」が出てこない動画は、文字起こしが無い
  return noButton ? { error: 'noTranscript', ...noButton } : { error: 'failed' };
}

export async function videoState(tabId: number): Promise<VideoState | null> {
  const v = (await evalIn(tabId, STATE_SCRIPT, 3_000)) as VideoState | undefined;
  return v && typeof v.time === 'number' ? v : null;
}

export function seekVideo(tabId: number, sec: number, play = false) {
  return evalIn(tabId, seekScript(Math.max(0, Math.round(sec * 10) / 10), play), 3_000);
}

// 再生の速さ。0.75 / 1 / 1.25 だけ（決まったスクリプト。YouTube の速さの一覧に入っている値）
const SPEEDS = [0.75, 1, 1.25] as const;
export type PlaybackSpeed = (typeof SPEEDS)[number];

const rateScript = (rate: PlaybackSpeed) => `(() => {
  ${PICK_MEDIA}
  const rate = ${rate};
  const p = document.querySelector('#movie_player');
  if (p && p.setPlaybackRate) { try { p.setPlaybackRate(rate); } catch (e) {} }
  const v = pickMedia();
  const list = [...document.querySelectorAll('video, audio')];
  if (v && !list.includes(v)) list.unshift(v);
  for (const m of list) { try { m.playbackRate = rate; } catch (e) {} }
  return v && typeof v.playbackRate === 'number' ? v.playbackRate : null;
})()`;

export async function setPlaybackRate(tabId: number, rate: PlaybackSpeed): Promise<number | null> {
  const v = await evalIn(tabId, rateScript(rate), 3_000);
  return typeof v === 'number' ? v : null;
}

// 再生・一時停止を切り替える。再生を始めたら true
export async function togglePlay(tabId: number): Promise<boolean | null> {
  const v = await evalIn(tabId, TOGGLE_SCRIPT, 3_000);
  return typeof v === 'boolean' ? v : null;
}

// ---------- 区間セルにまとめる ----------

const MIN_BREAK = 36; // これだけたまって文が終わったら、そこで区切る
const MAX_SPAN = 40; // 1マスの長さ（秒）の上限
const GAP = 4; // これだけ間があいたら、段落を分ける

const len = (s: string) => [...s].length;
const ENDS = /[。．！？!?」』）)]$|[a-z0-9][.!?]$/i;

// 日本語の字幕の行の中の空白（自動の字幕の折り返し）は詰める
const CJK = '\\u3000-\\u30ff\\u3400-\\u9fff\\uff00-\\uffef';
const CJK_SPACE = new RegExp(`([${CJK}])\\s+(?=[${CJK}])`, 'g');
const tidy = (text: string) => text.replace(CJK_SPACE, '$1').trim();

function join(a: string, b: string) {
  if (!a) return b;
  // 英語などは、字幕の行の間に空白を入れる
  return /[\x21-\x7e]$/.test(a) && /^[\x21-\x7e]/.test(b) ? `${a} ${b}` : a + b;
}

// 長すぎる字幕の行は、文の区切りで分け、時刻を字数で割り振る
function splitLong(seg: TranscriptSegment): TranscriptSegment[] {
  if (len(seg.text) <= CHUNK * 1.4) return [seg];
  const parts: string[] = [];
  for (const s of sentences(seg.text)) {
    const last = parts[parts.length - 1];
    if (last !== undefined && len(last) + len(s) <= CHUNK) parts[parts.length - 1] = join(last, s);
    else parts.push(s);
  }
  const total = parts.reduce((n, p) => n + len(p), 0) || 1;
  let t = seg.start;
  return parts.map((text) => {
    const span = ((seg.end - seg.start) * len(text)) / total;
    const piece = { start: t, end: t + span, text };
    t += span;
    return piece;
  });
}

export function transcriptChunks(t: Transcript): TimedChunk[] {
  const out: TimedChunk[] = [];
  const chapters = [...t.chapters].sort((a, b) => a.start - b.start);
  let ci = 0;
  let cur: TimedChunk | null = null;
  let para = true;
  const flush = () => {
    if (cur && cur.text.trim()) out.push({ ...cur, text: cur.text.trim() });
    cur = null;
  };
  for (const seg of t.segments.map((x) => ({ ...x, text: tidy(x.text) })).flatMap(splitLong)) {
    while (ci < chapters.length && chapters[ci].start <= seg.start + 0.01) {
      flush();
      out.push({ text: chapters[ci].title, head: true, para: true, start: chapters[ci].start, end: chapters[ci].start });
      ci++;
      para = true;
    }
    let text = seg.text.trim();
    const open = cur as TimedChunk | null;
    if (!open) {
      text = text.replace(/^[、。，．,.\s]+/, ''); // 行の頭に来た句読点は、前のマスのもの
      if (!text) {
        const prev = out[out.length - 1];
        if (prev && !prev.head) prev.text += seg.text.trim();
        continue;
      }
    }
    if (open) {
      const gap = seg.start - open.end;
      if (gap > GAP || len(open.text) + len(text) > CHUNK || seg.start - open.start > MAX_SPAN) {
        flush();
        if (gap > GAP) para = true;
        text = text.replace(/^[、。，．,.\s]+/, '') || text;
      }
    }
    if (!cur) {
      cur = { text: '', head: false, para, start: seg.start, end: seg.end };
      para = false;
    }
    const c = cur as TimedChunk;
    c.text = join(c.text, text);
    c.end = Math.max(c.end, seg.end);
    if (len(c.text) >= MIN_BREAK && ENDS.test(c.text)) flush();
  }
  flush();
  return out;
}
