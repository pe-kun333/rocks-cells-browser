// 渡し止めの照合（ファイルは読まない）。文の中のアドレスの置き換えもここ。
//   blocklist.ts が送る直前に一覧を読み、材料を組む makeMaterial も、同じ関数を使う。

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

// 文の中の http(s) のアドレスだけを見る。渡し止めのものは「（渡し止めのアドレス）」に置き換える。人が書いた文そのものは消さない
export function redactBlockedUrlText(text: string, hosts: readonly string[]): string {
  if (!text || hosts.length === 0) return text;
  return text.replace(/https?:\/\/[^\s<>)\]]+/gi, (url) => {
    const clean = url.replace(/[.,。、]+$/g, '');
    return isBlockedUrl(clean, hosts) ? '（渡し止めのアドレス）' : url;
  });
}
