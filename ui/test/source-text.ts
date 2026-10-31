// ソースの形を見る試験の下ごしらえ（英語版 E1）：画面の文字を t('…') / tr('…') で包んでも、元の形（'…'）で比べられるように外す
//   差し込みのあるもの（t('…', { … })）は外さない
export function unwrapT(src: string): string {
  return src.replace(/\btr?\(('(?:[^'\\\r\n]|\\.)*')\)/g, '$1');
}