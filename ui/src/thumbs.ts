// タブのサムネイル（C++ が撮ったページの画像を、小さくして持っておく）
const MAX_WIDTH = 480;

export class Thumbnails {
  private readonly images = new Map<number, string>();
  private readonly listeners: (() => void)[] = [];

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  get(id: number) {
    return this.images.get(id);
  }

  async add(id: number, dataUrl: string) {
    try {
      this.images.set(id, await shrink(dataUrl));
      this.emit();
    } catch {
      // 読めない画像は使わない
    }
  }

  delete(id: number) {
    if (this.images.delete(id)) this.emit();
  }

  // 他のサイドバーへ渡す用（すでに小さくしてあるので、受け取った側は put でそのまま入れる）
  entries(): [number, string][] {
    return [...this.images.entries()];
  }

  put(images: [number, string][]) {
    for (const [id, image] of images) this.images.set(id, image);
    this.emit();
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

async function shrink(dataUrl: string) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const scale = Math.min(1, MAX_WIDTH / img.naturalWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}
