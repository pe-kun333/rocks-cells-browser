// 範囲の指定（C5）。ブラウザの窓を撮ったあと、読む画面で四角を囲む。
//   囲んだ中だけを JPEG にして返す。窓全体はカードにしない。Snipping Tool は使わない。
import { el } from '../util';

interface CropHooks {
  onDone: (image: string) => void;
  onCancel: () => void;
}

interface FractionBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

let opened: { close: () => void } | null = null;

export function closeCropView() {
  opened?.close();
  opened = null;
}

export function openCropView(image: string, hooks: CropHooks) {
  closeCropView();
  document.querySelector('.shot')?.remove();
  const root = el('div', 'capture-view capture-crop');
  root.tabIndex = -1;
  const title = el('h1', 'capture-view-title', '範囲を指定');
  const hint = el('p', 'capture-view-hint', '残したい部分をドラッグして囲みます。囲んだ中だけがカードになります。');
  const heading = el('div', 'capture-view-heading');
  heading.append(title, hint);
  const head = el('header', 'capture-view-head');
  head.append(heading, el('span', 'capture-view-status', ''));
  const stage = el('div', 'capture-crop-stage');
  const img = el('img');
  img.alt = '切り取る前の画像';
  img.draggable = false;
  const dim = el('div', 'capture-crop-dim');
  const hole = el('div', 'capture-crop-hole');
  hole.hidden = true;
  stage.append(img, dim, hole);
  const keep = el('button', '', 'この範囲で残す');
  keep.type = 'button';
  keep.disabled = true;
  const cancel = el('button', '', 'やめる');
  cancel.type = 'button';
  const actions = el('div', 'capture-crop-actions');
  actions.append(keep, cancel);
  root.append(head, stage, actions);

  let closed = false;
  let box: FractionBox | null = null;
  let drag: { x: number; y: number } | null = null;

  const onResize = () => paint();
  const finish = () => {
    if (closed) return;
    closed = true;
    root.remove();
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    if (opened?.close === finish) opened = null;
  };
  opened = { close: finish };

  const contentBox = () => {
    const rect = stage.getBoundingClientRect();
    const bitmapW = img.naturalWidth;
    const bitmapH = img.naturalHeight;
    if (bitmapW < 1 || bitmapH < 1 || rect.width < 1 || rect.height < 1) return null;
    const fitted = rect.width / bitmapW < rect.height / bitmapH ? rect.width / bitmapW : rect.height / bitmapH;
    const drawnW = bitmapW * fitted;
    const drawnH = bitmapH * fitted;
    return {
      left: rect.left + (rect.width - drawnW) / 2,
      top: rect.top + (rect.height - drawnH) / 2,
      width: drawnW,
      height: drawnH,
    };
  };

  const paint = () => {
    const content = contentBox();
    const selection = box;
    if (!content || !selection || selection.w <= 0 || selection.h <= 0) {
      hole.hidden = true;
      dim.hidden = false;
      keep.disabled = true;
      return;
    }
    dim.hidden = true;
    hole.hidden = false;
    hole.style.left = `${content.left - stage.getBoundingClientRect().left + selection.x * content.width}px`;
    hole.style.top = `${content.top - stage.getBoundingClientRect().top + selection.y * content.height}px`;
    hole.style.width = `${selection.w * content.width}px`;
    hole.style.height = `${selection.h * content.height}px`;
    keep.disabled = selection.w * img.naturalWidth < 12 || selection.h * img.naturalHeight < 12;
  };

  const pointInImage = (clientX: number, clientY: number) => {
    const content = contentBox();
    if (!content || content.width < 1 || content.height < 1) return null;
    let x = (clientX - content.left) / content.width;
    let y = (clientY - content.top) / content.height;
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x > 1) x = 1;
    if (y > 1) y = 1;
    return { x, y };
  };

  const croppedUrl = () => {
    const selection = box;
    const bitmapW = img.naturalWidth;
    const bitmapH = img.naturalHeight;
    if (!selection || bitmapW < 1 || bitmapH < 1) return null;
    let x = Math.round(selection.x * bitmapW);
    let y = Math.round(selection.y * bitmapH);
    let w = Math.round(selection.w * bitmapW);
    let h = Math.round(selection.h * bitmapH);
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x + w > bitmapW) w = bitmapW - x;
    if (y + h > bitmapH) h = bitmapH - y;
    if (w < 12 || h < 12) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
    const url = canvas.toDataURL('image/jpeg', 0.85);
    return url.startsWith('data:image/jpeg') ? url : null;
  };

  stage.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const point = pointInImage(event.clientX, event.clientY);
    if (!point) return;
    drag = point;
    box = { x: point.x, y: point.y, w: 0, h: 0 };
    stage.setPointerCapture(event.pointerId);
    paint();
  });
  stage.addEventListener('pointermove', (event) => {
    const origin = drag;
    if (!origin) return;
    const point = pointInImage(event.clientX, event.clientY);
    if (!point) return;
    const x = origin.x < point.x ? origin.x : point.x;
    const y = origin.y < point.y ? origin.y : point.y;
    box = { x, y, w: Math.abs(point.x - origin.x), h: Math.abs(point.y - origin.y) };
    paint();
  });
  const endDrag = () => {
    drag = null;
    paint();
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  const stop = () => {
    finish();
    hooks.onCancel();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || closed) return;
    event.preventDefault();
    event.stopPropagation();
    stop();
  };
  cancel.addEventListener('click', () => stop());
  keep.addEventListener('click', () => {
    const url = croppedUrl();
    if (!url || closed) return;
    finish();
    hooks.onDone(url);
  });
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  document.body.append(root);
  img.addEventListener('load', () => paint());
  img.src = image;
  root.focus();
}
