// 自分の音声・動画のファイルと、字幕のファイル（.srt / .vtt / Whisper の JSON / 「0:05 本文」の行）
import { request } from '../bridge';
import type { TranscriptSegment } from './youtube';

const MEDIA_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|mp4|m4v|webm|mkv|mov)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i;

// 音声・動画のファイルを直接開いているページか（file:// でも http(s):// でも）
export function isMediaFileUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (u.protocol === 'file:' || u.protocol === 'http:' || u.protocol === 'https:') && MEDIA_EXT.test(decodeURIComponent(u.pathname));
  } catch {
    return false;
  }
}

// 画像ファイルを直接開いているページか（file:// でも http(s):// でも）
export function isImageFileUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (u.protocol === 'file:' || u.protocol === 'http:' || u.protocol === 'https:') && IMAGE_EXT.test(decodeURIComponent(u.pathname));
  } catch {
    return false;
  }
}

// file:///C:/a/b.mp3 → C:\a\b.mp3
export function pathOfFileUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'file:') return null;
    return decodeURIComponent(u.pathname).replace(/^\/([a-zA-Z]:)/, '$1').replace(/\//g, '\\');
  } catch {
    return null;
  }
}

export function fileNameOf(raw: string): string {
  try {
    return decodeURIComponent(new URL(raw).pathname.split('/').pop() ?? '') || raw;
  } catch {
    return raw;
  }
}

// メディアのファイルと同じ名前の字幕（横に置いた .srt / .vtt）
export async function readSidecarSubtitle(url: string): Promise<{ name: string; text: string } | null> {
  const path = pathOfFileUrl(url);
  if (!path) return null;
  const reply = await request((requestId) => ({ type: 'readSubtitle', requestId, path }), 8_000);
  return reply?.type === 'subtitle' && reply.ok && typeof reply.text === 'string' ? { name: reply.name ?? '', text: reply.text } : null;
}

// 音声・動画のファイルを選んでもらう（C++ のダイアログ）。やめたら null
export async function chooseMediaFile(): Promise<string | null> {
  const reply = await request((requestId) => ({ type: 'openMediaFile', requestId }), 10 * 60_000);
  return reply?.type === 'mediaFile' ? reply.path : null;
}

// ---------- 字幕の読み取り ----------

const toSec = (h: string | undefined, m: string, s: string, ms = '0') => Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(`0.${ms}`);

// .srt / .vtt / Whisper の JSON / 「0:05 本文」の行（YouTube の「文字起こし」をコピーしたもの）
export function parseSubtitles(text: string): TranscriptSegment[] {
  const body = text.replace(/\r\n?/g, '\n').trim();
  if (!body) return [];
  // Whisper などの JSON（{ segments: [{ start, end, text }] }）
  if (body.startsWith('{') || body.startsWith('[')) {
    try {
      const v = JSON.parse(body) as { segments?: unknown } | unknown[];
      const list = Array.isArray(v) ? v : Array.isArray((v as { segments?: unknown }).segments) ? ((v as { segments: unknown[] }).segments) : [];
      const segments = list
        .map((x) => {
          const r = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
          return { start: Number(r.start), end: Number(r.end), text: String(r.text ?? '').trim() };
        })
        .filter((s) => Number.isFinite(s.start) && s.text);
      return segments.map((s, i, a) => ({ ...s, end: Number.isFinite(s.end) && s.end > s.start ? s.end : (a[i + 1]?.start ?? s.start + 4) }));
    } catch {
      // JSON でなければ、ほかの形として読む
    }
  }
  // .srt / .vtt：「00:00:01,000 --> 00:00:04,000」の行と、その下の文
  const cue = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;
  if (cue.test(body)) {
    const out: TranscriptSegment[] = [];
    for (const block of body.split(/\n{2,}/)) {
      const lines = block.split('\n');
      const at = lines.findIndex((l) => cue.test(l));
      if (at < 0) continue;
      const m = cue.exec(lines[at]);
      if (!m) continue;
      const text = lines
        .slice(at + 1)
        .join(' ')
        .replace(/<[^>]+>/g, '')
        .replace(/\{\\[^}]*\}/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) out.push({ start: toSec(m[1], m[2], m[3], m[4]), end: toSec(m[5], m[6], m[7], m[8]), text });
    }
    return out;
  }
  // 「0:05 本文」「0:05」の次の行に本文（YouTube の文字起こしのコピー）
  const stamp = /^(?:(\d+):)?(\d{1,2}):(\d{2})\s*(.*)$/;
  const out: TranscriptSegment[] = [];
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const m = stamp.exec(lines[i]);
    if (!m) {
      if (out.length > 0 && !stamp.test(lines[i])) out[out.length - 1].text += ` ${lines[i]}`;
      continue;
    }
    out.push({ start: toSec(m[1], m[2], m[3]), end: 0, text: m[4].trim() });
  }
  const list = out.filter((s) => s.text.trim());
  return list.map((s, i, a) => ({ ...s, text: s.text.trim(), end: a[i + 1]?.start ?? s.start + 5 }));
}
