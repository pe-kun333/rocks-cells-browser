// 単語カードの指す画像（K6。計画書 §5 の 19）：右が shots・撮影の画像を読んで覚えておく
//   ・指すだけ（写さない）。読めなかったものは「消えた」として null を覚える（撮影は 80 件で古いものから消える）
//   ・読み終えたら onChange で知らせる（単語帳の区画と月の窓が描き直す）
//   ・ここは DOM を知らない
import type { CardImage } from './vocab';

export interface CardImageLoaders {
  shot(id: string): Promise<string | null>;
  capture(id: string): Promise<string | null>;
}

const keyOf = (image: CardImage) => `${image.kind}:${image.id}`;

export class CardImages {
  private readonly cache = new Map<string, string | null>(); // null は読めなかった（消えた）
  private readonly loading = new Set<string>();
  private readonly listeners: (() => void)[] = [];

  constructor(private readonly loaders: CardImageLoaders) {}

  // data URL。読んでいる間は undefined、消えていれば null
  get(image: CardImage): string | null | undefined {
    const key = keyOf(image);
    if (this.cache.has(key)) return this.cache.get(key);
    if (!this.loading.has(key)) {
      this.loading.add(key);
      // 読み始めは次の小さな区切りで（描いている途中に呼ばれても、読む側の用意ができてから読む）
      void Promise.resolve()
        .then(() => (image.kind === 'shot' ? this.loaders.shot(image.id) : this.loaders.capture(image.id)))
        .catch(() => null)
        .then((url) => {
          this.loading.delete(key);
          this.cache.set(key, typeof url === 'string' && url.startsWith('data:image/') ? url : null);
          for (const fn of this.listeners) fn();
        });
    }
    return undefined;
  }

  // 撮影の目次が変わったとき：「消えた」と覚えたものだけ、次に読み直す（撮り直した・戻したもの）
  forgetMissing() {
    for (const [key, url] of this.cache) if (url === null) this.cache.delete(key);
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }
}
