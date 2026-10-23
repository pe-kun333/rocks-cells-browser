// 画像の上に、書き込み（capture-draw.ts の drawAnnotations）を重ねる canvas の世話（R4-B）。
//   使うのは右の「撮影」のカードの縮図と、拡大（lightbox）。読む画面（reader/capture-view.ts）は自前で同じことをしている。
//   img の表示の大きさ × devicePixelRatio に canvas の画素を合わせ、img.naturalWidth/Height（保存画像の px）→ canvas の画素へ変換して描く。
//   canvas の見た目の大きさ・位置（img にぴったり重ねる）は CSS の仕事。ここは画素の数と絵だけ。
import { drawAnnotations, type AnnotationOptions, type AnnotationScene } from './capture-draw';

export interface AnnotationOverlay {
  repaint(): void; // 材料（scene・options）が変わったときに描き直す。画素の大きさが決まっていなければ、合わせ直してから描く
  dispose(): void; // 見張りをやめる。canvas は消さない
}

export function attachAnnotationOverlay(
  img: HTMLImageElement,
  canvas: HTMLCanvasElement,
  scene: () => AnnotationScene,
  options: () => AnnotationOptions,
): AnnotationOverlay {
  let disposed = false;
  const ctx = canvas.getContext('2d');

  const paint = () => {
    if (disposed || !ctx) return;
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (width < 1 || height < 1 || canvas.width < 1 || canvas.height < 1) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    try {
      drawAnnotations(ctx, width, height, scene(), options());
    } catch {
      // 書き込みが描けなくても、画像そのものは見える
    }
  };

  // 画像の表示の大きさ（画面の画素）に canvas の画素を合わせる。合わせたら描き直す
  const fit = (entry?: ResizeObserverEntry) => {
    if (disposed || img.naturalWidth < 1) return;
    let width: number;
    let height: number;
    const device = entry?.devicePixelContentBoxSize?.[0];
    if (device) {
      width = device.inlineSize;
      height = device.blockSize;
    } else {
      const size = entry ? entry.contentRect : img.getBoundingClientRect();
      width = Math.round(size.width * window.devicePixelRatio);
      height = Math.round(size.height * window.devicePixelRatio);
    }
    if (width < 1 || height < 1) return;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    paint();
  };

  const observer = new ResizeObserver((entries) => fit(entries[entries.length - 1]));
  try {
    observer.observe(img, { box: 'device-pixel-content-box' });
  } catch {
    observer.observe(img);
  }
  const onLoad = () => fit();
  img.addEventListener('load', onLoad);

  // 画面の倍率（dppx）が変わったときの保険。変わったら、新しい倍率で張り直す
  let dppx: MediaQueryList | null = null;
  const onDppx = () => {
    watchDppx();
    fit();
  };
  const watchDppx = () => {
    dppx?.removeEventListener('change', onDppx);
    dppx = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dppx.addEventListener('change', onDppx);
  };
  watchDppx();

  // すでに読み込み済みの img（load はもう来ない）
  if (img.complete) fit();

  return {
    repaint() {
      if (disposed) return;
      if (canvas.width < 1 || canvas.height < 1) fit();
      else paint();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      img.removeEventListener('load', onLoad);
      dppx?.removeEventListener('change', onDppx);
      dppx = null;
    },
  };
}
