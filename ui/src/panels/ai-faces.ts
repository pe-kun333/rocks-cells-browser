// 相棒たちの顔（オリジナルのデザイン）。中身は固定の図形だけ（innerHTML に入れる）
// 待機中はまばたき（.ai-eyes）、考え中は目が動き（.ai-pupil）、話すときは口が動く（.ai-mouth）
import type { CharacterId } from '../ai/characters';

const HEX = '<polygon class="ai-hex" points="50,4 95,30 95,82 50,108 5,82 5,30"/>';
// 三人組（ハチのように、頭に触角）
// フェイブルの金の外枠（六角形を、顔の中心から広げたもの）と、満月の光
const ring = (scale: number) =>
  [[50, 4], [95, 30], [95, 82], [50, 108], [5, 82], [5, 30]].map(([x, y]) => `${(50 + (x - 50) * scale).toFixed(1)},${(56 + (y - 56) * scale).toFixed(1)}`).join(' ');
const RAYS = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2;
  const p = (r: number) => `${(50 + Math.cos(a) * r).toFixed(1)} ${(19 + Math.sin(a) * r).toFixed(1)}`;
  return `M${p(11.5)} L${p(16)}`;
}).join(' ');
const ANTENNAE = '<path class="ai-antenna" d="M43 16 Q39 7 34 4 M57 16 Q61 7 66 4"/><circle class="ai-antenna-tip" cx="34" cy="4" r="3.2"/><circle class="ai-antenna-tip" cx="66" cy="4" r="3.2"/>';
// ハイク組の印：右上の短冊（頭の飾りは、それぞれの季語）
const TANZAKU = '<path class="hk-string" d="M81.2 9 V14"/><rect class="hk-tanzaku" x="78" y="14" width="6.5" height="17" rx="1.2"/>';

export const FACES: Record<CharacterId, string> = {
  // Claude：まるい目と、右上にきらり
  main: `<svg viewBox="0 0 100 112" aria-hidden="true">
  ${HEX}
  <g class="ai-eyes">
    <ellipse class="ai-eye" cx="37" cy="54" rx="7.5" ry="9"/>
    <ellipse class="ai-eye" cx="63" cy="54" rx="7.5" ry="9"/>
    <circle class="ai-pupil" cx="38" cy="56" r="3.6"/>
    <circle class="ai-pupil" cx="64" cy="56" r="3.6"/>
  </g>
  <path class="ai-mouth" d="M41 74 Q50 81 59 74"/>
  <path class="ai-spark" d="M78 16 l2.5 6 6 2.5 -6 2.5 -2.5 6 -2.5 -6 -6 -2.5 6 -2.5z"/>
</svg>`,
  // 二人目（ミツ）：丸い目と、上に小さな葉っぱ
  second: `<svg viewBox="0 0 100 112" aria-hidden="true">
  ${HEX}
  <path class="ai-leaf" d="M50 22 q9 -3 13 -13 q-11 0 -13 13z"/>
  <g class="ai-eyes">
    <circle class="ai-eye" cx="36" cy="56" r="8.5"/>
    <circle class="ai-eye" cx="64" cy="56" r="8.5"/>
    <circle class="ai-pupil" cx="37" cy="57" r="4.2"/>
    <circle class="ai-pupil" cx="65" cy="57" r="4.2"/>
  </g>
  <path class="ai-mouth" d="M42 75 q4 4 8 0 q4 4 8 0"/>
  <path class="ai-spark" d="M22 20 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z"/>
</svg>`,
  // フェイブル（賢者）：まるい眼鏡と白い眉、上に三日月
  //   進化した姿（data-form="evolved"）：六角形が夜空の色になって星座が浮かび、月は満月になって光り、外側に金の二重枠
  fable: `<svg viewBox="0 0 100 112" aria-hidden="true">
  <defs>
    <linearGradient id="fable-robe" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" style="stop-color: var(--evo-robe-top)"/>
      <stop offset="1" style="stop-color: var(--evo-robe-bottom)"/>
    </linearGradient>
  </defs>
  <polygon class="fable-evo fable-ring outer" points="${ring(1.26)}"/>
  <polygon class="fable-evo fable-ring inner" points="${ring(1.13)}"/>
  ${HEX}
  <polygon class="fable-evo fable-robe" points="50,5.3 93.8,30.6 93.8,81.4 50,106.7 6.2,81.4 6.2,30.6" fill="url(#fable-robe)"/>
  <g class="fable-evo fable-stars">
    <path d="M18 72 L28 88 L40 96 M72 92 L84 76 L86 62"/>
    <circle cx="18" cy="72" r="1.3"/><circle cx="28" cy="88" r="1.1"/><circle cx="40" cy="96" r="1.4"/>
    <circle cx="72" cy="92" r="1.2"/><circle cx="84" cy="76" r="1.4"/><circle cx="86" cy="62" r="1"/>
    <circle cx="16" cy="44" r="0.9"/><circle cx="82" cy="40" r="1"/>
  </g>
  <path class="fable-evo fable-rays" d="${RAYS}"/>
  <path class="ai-spark fable-crescent" d="M54 10 A9 9 0 1 0 54 28 A12 12 0 0 1 54 10z"/>
  <circle class="fable-evo fable-moon" cx="50" cy="19" r="8.5"/>
  <path class="ai-brow" d="M27 39 q8 -5 16 -1 M57 38 q8 -4 16 1"/>
  <g class="ai-eyes">
    <ellipse class="ai-eye" cx="36" cy="56" rx="6.5" ry="7.5"/>
    <ellipse class="ai-eye" cx="64" cy="56" rx="6.5" ry="7.5"/>
    <circle class="ai-pupil" cx="37" cy="57" r="3.2"/>
    <circle class="ai-pupil" cx="65" cy="57" r="3.2"/>
  </g>
  <g class="ai-glasses">
    <circle cx="36" cy="56" r="11"/>
    <circle cx="64" cy="56" r="11"/>
    <path d="M47 55 q3 -3 6 0"/>
  </g>
  <path class="ai-mouth" d="M43 79 Q50 84 57 79"/>
</svg>`,
  // ルカ（好奇心）：大きなきらきらの目
  trio1: `<svg viewBox="0 0 100 112" aria-hidden="true">
  ${HEX}
  ${ANTENNAE}
  <g class="ai-eyes">
    <circle class="ai-eye" cx="36" cy="56" r="9.5"/>
    <circle class="ai-eye" cx="64" cy="56" r="9.5"/>
    <circle class="ai-pupil" cx="37" cy="57" r="5"/>
    <circle class="ai-pupil" cx="65" cy="57" r="5"/>
    <circle class="ai-shine" cx="39" cy="54" r="1.8"/>
    <circle class="ai-shine" cx="67" cy="54" r="1.8"/>
  </g>
  <path class="ai-mouth" d="M41 76 Q50 85 59 76"/>
  <path class="ai-spark" d="M80 22 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z"/>
</svg>`,
  // ジン（慎重）：半分閉じた目と、片方だけ上がった眉
  trio2: `<svg viewBox="0 0 100 112" aria-hidden="true">
  ${HEX}
  ${ANTENNAE}
  <path class="ai-brow dark" d="M28 44 l15 1 M57 42 q8 -6 16 -3"/>
  <g class="ai-eyes">
    <ellipse class="ai-eye" cx="36" cy="57" rx="7.5" ry="5.5"/>
    <ellipse class="ai-eye" cx="64" cy="57" rx="7.5" ry="5.5"/>
    <circle class="ai-pupil" cx="37" cy="58" r="3.4"/>
    <circle class="ai-pupil" cx="65" cy="58" r="3.4"/>
    <path class="ai-lid" d="M28 55 h16 M56 55 h16"/>
  </g>
  <path class="ai-mouth" d="M42 78 L58 75"/>
  <path class="ai-spark" d="M20 24 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z"/>
</svg>`,
  // モモ（やさしい）：にっこり閉じた目とほっぺ
  trio3: `<svg viewBox="0 0 100 112" aria-hidden="true">
  ${HEX}
  ${ANTENNAE}
  <ellipse class="ai-blush" cx="27" cy="68" rx="7" ry="4"/>
  <ellipse class="ai-blush" cx="73" cy="68" rx="7" ry="4"/>
  <g class="ai-eyes">
    <path class="ai-eye-arc" d="M29 58 q7 -9 14 0 M57 58 q7 -9 14 0"/>
  </g>
  <path class="ai-mouth" d="M42 74 Q50 82 58 74"/>
  <path class="ai-spark" d="M78 22 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z"/>
</svg>`,
  // ツクシ（見る係）：頭に土筆の穂。上を見上げる丸い目
  tsukushi: `<svg viewBox="0 0 100 112" aria-hidden="true">
  ${HEX}
  <path class="hk-orn-line" d="M50 34 V24"/>
  <rect class="hk-orn" x="44.5" y="8" width="11" height="18" rx="5.5"/>
  <path class="hk-orn-seg" d="M45.5 14 h9 M45.5 19.5 h9"/>
  ${TANZAKU}
  <g class="ai-eyes">
    <circle class="ai-eye" cx="36" cy="58" r="8"/>
    <circle class="ai-eye" cx="64" cy="58" r="8"/>
    <circle class="ai-pupil" cx="37" cy="55" r="3.8"/>
    <circle class="ai-pupil" cx="65" cy="55" r="3.8"/>
  </g>
  <path class="ai-mouth" d="M43 78 Q50 83 57 78"/>
</svg>`,
  // ホタル（調べ係）：頭の上に光の玉。きらきらの大きな目
  hotaru: `<svg viewBox="0 0 100 112" aria-hidden="true">
  ${HEX}
  <circle class="hk-glow" cx="50" cy="18" r="10.5"/>
  <circle class="hk-orn" cx="50" cy="18" r="5.5"/>
  <path class="hk-orn-line" d="M43 33 Q45 26 47.5 23 M57 33 Q55 26 52.5 23"/>
  ${TANZAKU}
  <g class="ai-eyes">
    <circle class="ai-eye" cx="36" cy="57" r="9.5"/>
    <circle class="ai-eye" cx="64" cy="57" r="9.5"/>
    <circle class="ai-pupil" cx="37" cy="58" r="4.6"/>
    <circle class="ai-pupil" cx="65" cy="58" r="4.6"/>
    <circle class="ai-shine" cx="39.5" cy="55" r="1.7"/>
    <circle class="ai-shine" cx="67.5" cy="55" r="1.7"/>
  </g>
  <path class="ai-mouth" d="M44 78 Q50 82 56 78"/>
</svg>`,
  // モミジ（まとめ係）：頭に紅葉の葉。やさしいまつげとほっぺ
  momiji: `<svg viewBox="0 0 100 112" aria-hidden="true">
  ${HEX}
  <path class="hk-orn" d="M50 7 L53 14 L60 11 L57.5 18.5 L65 20.5 L57 24 L58.5 29.5 L50 26.5 L41.5 29.5 L43 24 L35 20.5 L42.5 18.5 L40 11 L47 14 Z"/>
  <path class="hk-leaf-stem" d="M50 26 V33"/>
  ${TANZAKU}
  <ellipse class="hk-blush" cx="27" cy="69" rx="6.5" ry="3.8"/>
  <ellipse class="hk-blush" cx="73" cy="69" rx="6.5" ry="3.8"/>
  <g class="ai-eyes">
    <ellipse class="ai-eye" cx="36" cy="57" rx="7" ry="7.5"/>
    <ellipse class="ai-eye" cx="64" cy="57" rx="7" ry="7.5"/>
    <circle class="ai-pupil" cx="36.5" cy="58.5" r="3.4"/>
    <circle class="ai-pupil" cx="64.5" cy="58.5" r="3.4"/>
  </g>
  <path class="hk-lash" d="M28 47.5 q8 -3.5 16 1.5 M56 49 q8 -5 16 -1.5"/>
  <path class="ai-mouth" d="M42 77 Q50 84 58 77"/>
</svg>`,
  // ユキ（確かめ係）：頭に六角の雪の結晶。細い切れ長の目
  yuki: `<svg viewBox="0 0 100 112" aria-hidden="true">
  ${HEX}
  <path class="hk-flake" d="M50 8 V30 M40.5 13.5 L59.5 24.5 M40.5 24.5 L59.5 13.5 M46.5 10 L50 13 L53.5 10 M46.5 28 L50 25 L53.5 28"/>
  ${TANZAKU}
  <g class="ai-eyes">
    <ellipse class="ai-eye" cx="36" cy="58" rx="8.5" ry="4.2"/>
    <ellipse class="ai-eye" cx="64" cy="58" rx="8.5" ry="4.2"/>
    <circle class="ai-pupil" cx="37" cy="58" r="2.8"/>
    <circle class="ai-pupil" cx="65" cy="58" r="2.8"/>
  </g>
  <path class="ai-mouth" d="M44 78 Q50 80 56 78"/>
</svg>`,
  // カエル（記録係）：六角の上の辺から目玉が2つ。横長の口
  kaeru: `<svg viewBox="0 0 100 112" aria-hidden="true">
  ${HEX}
  <circle class="hk-frog-eye" cx="32" cy="25" r="10.5"/>
  <circle class="hk-frog-eye" cx="64" cy="25" r="10.5"/>
  ${TANZAKU}
  <g class="ai-eyes">
    <circle class="ai-eye" cx="32" cy="25" r="6.8"/>
    <circle class="ai-eye" cx="64" cy="25" r="6.8"/>
    <circle class="ai-pupil" cx="33" cy="26" r="3.3"/>
    <circle class="ai-pupil" cx="65" cy="26" r="3.3"/>
  </g>
  <path class="ai-mouth" d="M27 66 Q50 84 73 66"/>
</svg>`,
  // トンボ（見回り係）：頭に透明な羽が2対。大きな複眼
  tombo: `<svg viewBox="0 0 100 112" aria-hidden="true">
  ${HEX}
  <ellipse class="hk-wing" cx="37" cy="15" rx="12.5" ry="4.2" transform="rotate(-12 37 15)"/>
  <ellipse class="hk-wing" cx="63" cy="15" rx="12.5" ry="4.2" transform="rotate(12 63 15)"/>
  <ellipse class="hk-wing" cx="39" cy="24" rx="10.5" ry="3.6" transform="rotate(10 39 24)"/>
  <ellipse class="hk-wing" cx="61" cy="24" rx="10.5" ry="3.6" transform="rotate(-10 61 24)"/>
  <path class="hk-tail" d="M50 11 V31"/>
  <g class="ai-eyes">
    <ellipse class="ai-eye" cx="35" cy="57" rx="10.5" ry="11.5"/>
    <ellipse class="ai-eye" cx="65" cy="57" rx="10.5" ry="11.5"/>
    <g class="hk-compound">
      <circle cx="30" cy="52" r="1.2"/><circle cx="35" cy="50" r="1.2"/><circle cx="40" cy="52" r="1.2"/><circle cx="30" cy="62" r="1.2"/><circle cx="40" cy="62" r="1.2"/>
      <circle cx="60" cy="52" r="1.2"/><circle cx="65" cy="50" r="1.2"/><circle cx="70" cy="52" r="1.2"/><circle cx="60" cy="62" r="1.2"/><circle cx="70" cy="62" r="1.2"/>
    </g>
    <circle class="ai-pupil" cx="36" cy="57" r="3.8"/>
    <circle class="ai-pupil" cx="66" cy="57" r="3.8"/>
  </g>
  ${TANZAKU}
  <path class="ai-mouth" d="M45 82 Q50 85 55 82"/>
</svg>`,
};
