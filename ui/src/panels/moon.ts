// 月の満ち欠け（進化の枠の残りを表す）。fraction：明るい部分（0 は新月、1 は満月）。右から満ちる
//   形だけの SVG（innerHTML に入れる）。色は style.css の .moon-dark・.moon-lit
export function moonSvg(fraction: number, size = 16): string {
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const r = 7;
  const c = 8;
  // 明るい部分：右半分の円と、明暗の境目（だ円）で囲む。半月より細いときは境目が右に、太いときは左にふくらむ
  const rx = (r * Math.abs(1 - 2 * f)).toFixed(2);
  const sweep = f < 0.5 ? 0 : 1;
  const lit = f <= 0.001 ? '' : f >= 0.999 ? `<circle class="moon-lit" cx="${c}" cy="${c}" r="${r}"/>` : `<path class="moon-lit" d="M${c} ${c - r} A${r} ${r} 0 0 1 ${c} ${c + r} A${rx} ${r} 0 0 ${sweep} ${c} ${c - r}z"/>`;
  return `<svg class="moon" viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true"><circle class="moon-dark" cx="${c}" cy="${c}" r="${r}"/>${lit}</svg>`;
}
