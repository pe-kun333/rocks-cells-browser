// データ置き場：会話を見たままの画像にする
//   (B) 全体：会話を、画面の外（下）に置いた書き出し用の入れ物に全部の高さで描き、C++ に DevTools の Page.captureScreenshot
//       （captureBeyondViewport）で撮ってもらう。高すぎる会話は、上から順に何枚かに分ける（1枚の高さに上限がある）
//   (A) 見えている範囲：全体を撮れなかったときの予備。今の会話の欄の、見えている所だけを撮る
import { request, send } from './bridge';
import { el } from './util';
import type { VaultImage } from './vault';

const MAX_DEVICE_PX = 8000; // 1枚の高さの上限（画面の拡大率をかけたあとのピクセル。Chromium の上限より十分小さく）
const CAPTURE_TIMEOUT_MS = 30_000;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const settle = async () => {
  await nextFrame();
  await nextFrame();
};

async function captureClip(name: string, clip: { x: number; y: number; width: number; height: number }, beyond: boolean) {
  const reply = await request((requestId) => ({ type: 'captureSurface', requestId, name, clip, beyond }), CAPTURE_TIMEOUT_MS);
  return reply?.type === 'surfaceCaptured' && reply.ok ? (reply.bytes ?? 0) : null;
}

// (B) 全体。nodes は会話の欄と同じ見た目で描いたもの（.ai-log の中身）。撮れなければ null（途中まで撮った画像は消す）
export async function captureFull(id: string, width: number, nodes: HTMLElement[], caption: HTMLElement): Promise<VaultImage[] | null> {
  const dpr = window.devicePixelRatio || 1;
  const top = Math.ceil(window.innerHeight + 40); // 画面の外（下）。使う人には見えない
  const frame = el('div', 'vault-export');
  frame.style.top = `${top}px`;
  frame.style.width = `${width}px`;
  const inner = el('div', 'ai-log vault-export-log');
  inner.append(caption, ...nodes);
  frame.append(inner);
  document.body.append(frame);
  const images: VaultImage[] = [];
  try {
    // 画像（見せたスクショなど）と文字の形が読み終わるのを待つ
    await Promise.all([...inner.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined)));
    await document.fonts?.ready;
    await settle();
    const total = Math.ceil(inner.getBoundingClientRect().height);
    if (total < 1) return null;
    const chunk = Math.max(200, Math.floor(MAX_DEVICE_PX / dpr));
    const count = Math.ceil(total / chunk);
    for (let n = 0; n < count; n++) {
      const height = Math.min(chunk, total - n * chunk);
      frame.style.height = `${height}px`;
      inner.style.transform = `translateY(${-n * chunk}px)`; // 撮る窓は動かさず、中身を上へずらす
      await settle();
      const name = `vault/img/${id}-${n + 1}.png`;
      const bytes = await captureClip(name, { x: 0, y: top, width, height }, true);
      if (bytes === null || bytes === 0) {
        for (const image of images) send({ type: 'deleteVaultImage', name: image.name });
        return null;
      }
      images.push({ name, width: Math.round(width * dpr), height: Math.round(height * dpr), bytes });
    }
    return images;
  } finally {
    frame.remove();
  }
}

// (A) 見えている範囲だけ（会話の欄が開いていて、画面に出ているとき）
export async function captureVisible(id: string, log: HTMLElement): Promise<VaultImage[] | null> {
  if (!log.isConnected || log.getClientRects().length === 0) return null;
  const r = log.getBoundingClientRect();
  const x = Math.max(0, Math.floor(r.left));
  const y = Math.max(0, Math.floor(r.top));
  const width = Math.floor(Math.min(r.right, window.innerWidth) - x);
  const height = Math.floor(Math.min(r.bottom, window.innerHeight) - y);
  if (width < 10 || height < 10) return null;
  const name = `vault/img/${id}-1.png`;
  const bytes = await captureClip(name, { x, y, width, height }, false);
  if (!bytes) return null;
  const dpr = window.devicePixelRatio || 1;
  return [{ name, width: Math.round(width * dpr), height: Math.round(height * dpr), bytes }];
}
