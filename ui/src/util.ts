// 小さな道具

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

// タブの頭文字（ファビコンが無いときの代わり）
export function initialOf(tab: { title: string; url: string }) {
  const source = tab.title || hostOf(tab.url) || '?';
  return ([...source.trim()][0] ?? '?').toUpperCase();
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

// 続けて呼ばれたら、最後の呼び出しから ms 待ってから1回だけ実行する
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: number | undefined;
  return (...args: A) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  };
}

// ms に1回までしか実行しない
export function throttle(fn: () => void, ms: number) {
  let last = 0;
  return () => {
    const now = Date.now();
    if (now - last < ms) return;
    last = now;
    fn();
  };
}
