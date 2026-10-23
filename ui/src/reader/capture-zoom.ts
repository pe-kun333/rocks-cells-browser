// 読む画面の拡大（R4-C）。段は 合わせる（'fit'）・100%（1）・200%（2）。
//   1 は画像の 1px を画面の 1 画素に（img の幅 ＝ 実際の幅 ÷ devicePixelRatio ＝ CSS px）。2 はその 2 倍。
//   1・2 のときは CSS（.capture-frame[data-zoom]）が img と frame の max-width・max-height を外す。
//   canvas・スタンプ・つまみ・入力欄・確認の小窓は、img の大きさの変化（ResizeObserver）と % の配置で追いつく。
//   段を替えるときは、指した点（無ければ stage の真ん中）が動かないように、stage をスクロールして合わせる。
export type ZoomLevel = 'fit' | 1 | 2;

const LEVELS: readonly ZoomLevel[] = ['fit', 1, 2];
const WHEEL_GAP_MS = 100; // Ctrl+ホイールの連続した目盛り（タッチパッドのつまみ操作など）で、一気に段が飛ばないように

export interface ZoomOptions {
  img: HTMLImageElement;
  stage: HTMLElement;
  frame: HTMLElement;
  onChange: (level: ZoomLevel) => void;
}

export interface ZoomControl {
  get: () => ZoomLevel;
  set: (level: ZoomLevel, anchor?: { x: number; y: number }) => void; // anchor は画面の座標（clientX・clientY）
  step: (direction: 1 | -1, anchor?: { x: number; y: number }) => void;
  refresh: () => void; // 画像を読み込み直したとき・画面の倍率が変わったときに、幅を入れ直す
  dispose: () => void;
}

export function attachZoom({ img, stage, frame, onChange }: ZoomOptions): ZoomControl {
  let level: ZoomLevel = 'fit';
  let wheelAt = 0;

  const size = () => {
    frame.dataset.zoom = String(level);
    if (level === 'fit' || img.naturalWidth < 1) {
      img.style.width = '';
      return;
    }
    img.style.width = `${(img.naturalWidth / window.devicePixelRatio) * level}px`;
  };

  const set = (next: ZoomLevel, anchor?: { x: number; y: number }) => {
    if (next === level) return;
    const before = img.getBoundingClientRect();
    const view = stage.getBoundingClientRect();
    const pointX = anchor?.x ?? view.left + stage.clientWidth / 2;
    const pointY = anchor?.y ?? view.top + stage.clientHeight / 2;
    // 指した点の、画像の中での割合（画像の外を指していても、同じ割合で延ばして扱う）
    const fx = before.width > 0 ? (pointX - before.left) / before.width : 0.5;
    const fy = before.height > 0 ? (pointY - before.top) / before.height : 0.5;
    level = next;
    size();
    const after = img.getBoundingClientRect(); // 幅を変えたあとの位置を読み直す
    if (after.width > 0 && after.height > 0) {
      stage.scrollLeft += after.left + fx * after.width - pointX;
      stage.scrollTop += after.top + fy * after.height - pointY;
    }
    onChange(level);
  };

  const step = (direction: 1 | -1, anchor?: { x: number; y: number }) => {
    const index = LEVELS.indexOf(level) + direction;
    const next = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, index))];
    set(next, anchor);
  };

  const onWheel = (event: WheelEvent) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    if (event.deltaY === 0) return;
    const now = performance.now();
    if (now - wheelAt < WHEEL_GAP_MS) return;
    wheelAt = now;
    step(event.deltaY < 0 ? 1 : -1, { x: event.clientX, y: event.clientY });
  };

  stage.addEventListener('wheel', onWheel, { passive: false });
  img.addEventListener('load', size);
  size();

  return {
    get: () => level,
    set,
    step,
    refresh: size,
    dispose: () => {
      stage.removeEventListener('wheel', onWheel);
      img.removeEventListener('load', size);
    },
  };
}
