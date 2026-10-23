// 「消す → 本当に消す」のような 2 段の確かめを、ほかの場所を押す・Esc で取り消せるようにする共通のしくみ。
// 確かめ中のボタン（data-armed-confirm）の外を押すと、その押下は飲み込んで（下の物は動かさない）、ボタンを元に戻す。
// 確かめ中のボタンそのものを押したときは、そのまま実行させる。
type Armed = { el: HTMLElement; disarm: () => void };

const ATTR = 'data-armed-confirm';
let current: Armed | null = null;
let swallowUntil = 0;
const installed = new WeakSet<Document>();

function liveArmed(doc: Document): boolean {
  if (!current) return false;
  if (current.el.isConnected && current.el.hasAttribute(ATTR)) return true;
  // 描き直しで同じ確かめのボタンが作り直されていることもある
  if (doc.querySelector(`[${ATTR}]`)) return true;
  current = null;
  return false;
}

function inside(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(`[${ATTR}]`);
}

/** いま確かめ中のものがあれば元に戻す（戻したら true） */
export function disarmConfirm(): boolean {
  const c = current;
  current = null;
  for (const n of Array.from(document.querySelectorAll(`[${ATTR}]`))) n.removeAttribute(ATTR);
  if (!c) return false;
  c.el.removeAttribute(ATTR);
  c.disarm();
  return true;
}

function install(doc: Document): void {
  if (installed.has(doc)) return;
  installed.add(doc);
  const win = doc.defaultView ?? window;
  const swallow = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };
  win.addEventListener('pointerdown', (e) => {
    if (!liveArmed(doc) || inside(e.target)) return;
    swallow(e);
    swallowUntil = Date.now() + 800; // この押下に続く mousedown / click / contextmenu も飲み込む
    disarmConfirm();
  }, true);
  for (const type of ['mousedown', 'mouseup', 'pointerup', 'click', 'dblclick', 'contextmenu', 'auxclick']) {
    win.addEventListener(type, (e) => {
      if (Date.now() >= swallowUntil) return;
      swallow(e);
      if (type === 'click' || type === 'contextmenu' || type === 'auxclick') swallowUntil = 0;
    }, true);
  }
  // 確かめ中のボタンを押して実行したら、印は外す（同じボタンが元の字に戻って残る作りでも、次の外押しを飲み込まない）
  win.addEventListener('click', (e) => {
    if (!current || !inside(e.target)) return;
    const el = (e.target as Element).closest(`[${ATTR}]`);
    setTimeout(() => {
      el?.removeAttribute(ATTR);
      if (current && (current.el === el || !doc.querySelector(`[${ATTR}]`))) current = null;
    }, 0);
  }, true);
  win.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !liveArmed(doc)) return;
    swallow(e);
    disarmConfirm();
  }, true);
}

/**
 * ボタンを「確かめ中」にする。字や色を変える前に呼ぶ。
 * disarm を渡さなければ、呼んだときの字・title・aria-label・class に戻す。
 * 状態を持って描き直す作りでは、描くたびに呼び、disarm で状態を消して描き直す。
 */
export function armConfirm(el: HTMLElement, disarm?: () => void): void {
  install(el.ownerDocument);
  let restore = disarm;
  if (!restore) {
    const text = el.textContent;
    const title = el.getAttribute('title');
    const aria = el.getAttribute('aria-label');
    const cls = el.className;
    restore = () => {
      el.textContent = text;
      if (title === null) el.removeAttribute('title'); else el.setAttribute('title', title);
      if (aria === null) el.removeAttribute('aria-label'); else el.setAttribute('aria-label', aria);
      el.className = cls;
    };
  }
  if (current && current.el !== el && current.el.isConnected && current.el.hasAttribute(ATTR)) {
    // 別のボタンが確かめ中なら、先に戻す（同時に確かめ中は1つだけ）
    const prev = current;
    current = null;
    prev.el.removeAttribute(ATTR);
    prev.disarm();
  }
  el.setAttribute(ATTR, '');
  current = { el, disarm: restore };
}