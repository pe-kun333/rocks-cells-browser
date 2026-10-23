// 渡し止めリスト（計画第2版の段階1）
//   指定したサイトの本文・選んだ文・アドレス・画像・字幕を、相棒と Grok Bot に自動で添付しない。
//   人が自分で書いた頼む文は止めない。判断はここ（TypeScript）。C++ は文を取るだけ。
//   三つの画面（左・右・読む画面）はそれぞれ、送る直前にファイルを読み直す。
import { readData, writeData } from './data';

export const BLOCK_NOTE = 'このサイトは渡しません';

const FILE = 'blocklist.json';
const MAX_HOSTS = 200;

export interface BlocklistFile {
  v: 1;
  hosts: string[];
}

// 一覧に書いてよいホストか。ドットの無い名前（com など）は、世界中を止めてしまうので受け取らない。
function acceptHost(host: string): string | null {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (!h || h.length > 253 || h.startsWith('.') || h.includes('..') || /\s/.test(h)) return null;
  if (h === 'localhost') return h;
  if (isIpv4(h) || isIpv6(h)) return h;
  if (!h.includes('.')) return null;
  if (!/^[a-z0-9.-]+$/.test(h)) return null;
  return h;
}

function isIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  return !!m && m.slice(1).every((n) => Number(n) <= 255);
}

function isIpv6(host: string): boolean {
  return host.includes(':') && /^[0-9a-f:.]+$/.test(host);
}

// 入力（mail.example.com、https://www.mail.example.com/path、*.bank.example）をホストだけにする。受け取れなければ null。
export function normalizeHost(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith('*.')) s = s.slice(2);
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//.test(s) ? s : `https://${s}`;
  try {
    const url = new URL(withScheme);
    return acceptHost(url.hostname);
  } catch {
    return null;
  }
}

export function hostFromUrl(url: string): string | null {
  try {
    return acceptHost(new URL(url).hostname);
  } catch {
    return null;
  }
}

// 一覧のホストと、そのサブドメイン（bank.example なら www.bank.example）を止める。IP は同じアドレスだけ。
export function isBlockedHost(host: string, hosts: readonly string[]): boolean {
  const h = host.toLowerCase();
  for (const listed of hosts) {
    if (h === listed) return true;
    if (!isIpv4(listed) && !isIpv6(listed) && h.endsWith(`.${listed}`)) return true;
  }
  return false;
}

export function isBlockedUrl(url: string | null | undefined, hosts: readonly string[]): boolean {
  if (!url || hosts.length === 0) return false;
  const host = hostFromUrl(url);
  return !!host && isBlockedHost(host, hosts);
}

function cleanHosts(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const host = normalizeHost(item);
    if (host && !out.includes(host)) out.push(host);
    if (out.length >= MAX_HOSTS) break;
  }
  return out;
}

// 送る直前に必ず読み直す（画面ごとにメモリが別なので、覚えた一覧は使わない）
export async function ensureBlocklist(): Promise<string[]> {
  const file = await readData<BlocklistFile>(FILE);
  return cleanHosts(file?.hosts);
}

export async function pageIsBlocked(url: string | null | undefined): Promise<boolean> {
  if (!url) return false;
  return isBlockedUrl(url, await ensureBlocklist());
}

// 文の中の http(s) のアドレスだけを見る。渡し止めのものは「（渡し止めのアドレス）」に置き換える。人が書いた文そのものは消さない
export async function redactBlockedUrls(text: string | undefined): Promise<string> {
  const raw = text ?? '';
  if (!raw) return '';
  const hosts = await ensureBlocklist();
  if (!hosts.length) return raw;
  return raw.replace(/https?:\/\/[^\s<>)\]]+/gi, (url) => {
    const clean = url.replace(/[.,。、]+$/g, '');
    return isBlockedUrl(clean, hosts) ? '（渡し止めのアドレス）' : url;
  });
}

// 保存して、実際に残った一覧を返す（形の違うものは落ちる。200件まで）
export async function setBlocklist(hosts: readonly string[]): Promise<string[]> {
  const saved = cleanHosts(hosts);
  await writeData(FILE, { v: 1, hosts: saved } satisfies BlocklistFile);
  return saved;
}

export const BLOCKLIST_MAX = MAX_HOSTS;
