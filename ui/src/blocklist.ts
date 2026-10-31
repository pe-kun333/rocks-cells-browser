// 渡し止めリスト（計画第2版の段階1）
//   指定したサイトの本文・選んだ文・アドレス・画像・字幕を、相棒と Grok Bot に自動で添付しない。
//   人が自分で書いた頼む文は止めない。ホストの照合と文の中の置き換えは blocklist-match.ts。C++ は文を取るだけ。
//   三つの画面（左・右・読む画面）はそれぞれ、送る直前にファイルを読み直す。
import { hostFromUrl, isBlockedHost, isBlockedUrl, normalizeHost, redactBlockedUrlText } from './blocklist-match';
import { readData, writeData } from './data';

export { hostFromUrl, isBlockedHost, isBlockedUrl, normalizeHost, redactBlockedUrlText };

export const BLOCK_NOTE = 'このサイトは渡しません';

const FILE = 'blocklist.json';
const MAX_HOSTS = 200;

export interface BlocklistFile {
  v: 1;
  hosts: string[];
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

// 文の中の http(s) のアドレスだけを見る。置き方は blocklist-match.ts（材料を組むときと同じ）
export async function redactBlockedUrls(text: string | undefined): Promise<string> {
  const raw = text ?? '';
  if (!raw) return '';
  return redactBlockedUrlText(raw, await ensureBlocklist());
}

// 保存して、実際に残った一覧を返す（形の違うものは落ちる。200件まで）
export async function setBlocklist(hosts: readonly string[]): Promise<string[]> {
  const saved = cleanHosts(hosts);
  await writeData(FILE, { v: 1, hosts: saved } satisfies BlocklistFile);
  return saved;
}

export const BLOCKLIST_MAX = MAX_HOSTS;
