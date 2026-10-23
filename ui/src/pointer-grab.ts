// 押してつまむ小さな補助：押す → threshold を超えて動いたらつまむ（ドラッグ）→ 離す・やめる（plan-memo-card-order の O3）
//   ・左ボタン（タッチ・ペンは主の指）だけ。押した要素に捕まえ（setPointerCapture）を頼む。捕まえ損ねても、window で動きと離すを受ける
//   ・pointerId を照合する。押している間に pointercancel・捕まえが外れる・ボタンが離れているのに離すが来ない・窓の blur・隠れる、ではやめる
//   ・つまんで動かしたあとの最初の click は一度捨てる（押して離しただけなら click は通す。つまみの欄はその click で開く）
//   ・Esc・自動スクロール・印は持たない（使う側が持つ）。今は下の区画のカードのつまみだけが使う（M5 の札と区画の高さのつまみは作り替えない）
export interface GrabHandlers {
  threshold?: number; // つまんだとみなす動き（px。既定 4）
  onPress?(e: PointerEvent): boolean | void; // 押した。false を返すと始めない（捕まえも頼まない）
  onStart?(e: PointerEvent): void; // threshold を超えて動いた（つまんだ）
  onMove?(e: PointerEvent): void; // つまんでいる間の動き
  onEnd?(e: PointerEvent, moved: boolean): void; // 離した（moved：つまんで動かしていた）
  onCancel?(moved: boolean): void; // やめた（pointercancel・捕まえが外れた・blur・隠れた・cancel()）
}

export interface Grab {
  cancel(): void; // 押している・つまんでいるのをやめる（onCancel が呼ばれる）
  readonly active: boolean; // 押している（つまむ前も含む）
  readonly moving: boolean; // つまんで動かしている
}

export function grabPointer(el: HTMLElement, h: GrabHandlers): Grab {
  const threshold = h.threshold ?? 4;
  let press: { id: number; x: number; y: number; moved: boolean } | null = null;
  let swallow = false; // つまんだあとの click を一度捨てる
  let swallowTimer = 0;
  const off: (() => void)[] = [];

  const on = (target: EventTarget, type: string, fn: (e: Event) => void, capture = true) => {
    target.addEventListener(type, fn, capture);
    off.push(() => target.removeEventListener(type, fn, capture));
  };

  const swallowNextClick = () => {
    swallow = true;
    window.clearTimeout(swallowTimer);
    swallowTimer = window.setTimeout(() => (swallow = false), 0); // 離したすぐあとの click だけ（同じ手番の中で来る）
  };

  // 押しの終わり（離した・やめたのどちらでも）：window の受け口を外し、捕まえを返す
  const finish = () => {
    const id = press?.id;
    press = null;
    for (const f of off.splice(0)) f();
    if (id !== undefined) {
      try {
        if (el.hasPointerCapture(id)) el.releasePointerCapture(id);
      } catch {
        // 捕まえていなければ何もしない
      }
    }
  };

  const cancel = () => {
    if (!press) return;
    const moved = press.moved;
    if (moved) swallowNextClick();
    finish();
    h.onCancel?.(moved);
  };

  const move = (e: Event) => {
    const p = e as PointerEvent;
    if (!press || p.pointerId !== press.id) return;
    if (p.buttons === 0 && p.pointerType === 'mouse') {
      cancel(); // ボタンはもう離れているのに、離すが届いていない（窓の外で離したなど）
      return;
    }
    if (!press.moved) {
      if (Math.hypot(p.clientX - press.x, p.clientY - press.y) < threshold) return;
      press.moved = true;
      h.onStart?.(p);
      if (!press) return; // onStart の中でやめた
    }
    h.onMove?.(p);
  };

  const up = (e: Event) => {
    const p = e as PointerEvent;
    if (!press || p.pointerId !== press.id) return;
    const moved = press.moved;
    if (moved) swallowNextClick();
    finish();
    h.onEnd?.(p, moved);
  };

  const lost = (e: Event) => {
    const p = e as PointerEvent;
    if (press && p.pointerId === press.id) cancel();
  };

  el.addEventListener('pointerdown', (e) => {
    if (press || !e.isPrimary || e.button !== 0) return;
    if (h.onPress?.(e) === false) return;
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // 捕まえられないときも、window で動きと離すを受ける
    }
    on(window, 'pointermove', move);
    on(window, 'pointerup', up);
    on(window, 'pointercancel', lost);
    on(el, 'lostpointercapture', lost, false);
    on(window, 'blur', () => cancel(), false);
    on(document, 'visibilitychange', () => {
      if (document.hidden) cancel();
    }, false);
  });
  el.addEventListener(
    'click',
    (e) => {
      if (!swallow) return;
      swallow = false;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );

  return {
    cancel,
    get active() {
      return press !== null;
    },
    get moving() {
      return press?.moved === true;
    },
  };
}
