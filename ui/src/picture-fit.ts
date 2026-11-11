// カードの顔に出す小さな絵（CB16）。保存した写真の data: を、長い辺 400px の JPEG に縮めて覚える（保存はしない）
//   UI の画面の決まり（CSP）は blob: の画像を通さないので、data: のまま読む
export const FACE_LONG_EDGE = 400;

export async function shrinkPicture(src: string, longEdge = FACE_LONG_EDGE): Promise<string | null> {
  const img = await new Promise<HTMLImageElement | null>((resolve) => {
    const node = new Image();
    node.onload = () => resolve(node);
    node.onerror = () => resolve(null);
    node.src = src;
  });
  if (!img || img.naturalWidth < 1 || img.naturalHeight < 1) return null;
  try {
    const long = Math.max(img.naturalWidth, img.naturalHeight);
    const scale = long > longEdge ? longEdge / long : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // theme: fixed begin：透明な写真の下地（絵の色）
    ctx.fillStyle = '#fff';
    // theme: fixed end
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL('image/jpeg', 0.8);
    return /^data:image\/jpeg;base64,./.test(out) ? out : null;
  } catch {
    return null;
  }
}
