// テストの道具：色の計算（見本帳 docs/mocks/themes.html と同じ式）
// WCAG 2 のコントラスト比・APCA（0.0.98G-4g）の Lc・OKLab の色差・色覚の見え方の近似（Machado 2009）

export type Rgb = [number, number, number];

// #rgb・#rrggbb・#rrggbbaa・rgb()・rgba()（コンマ区切りと空白区切り）を読む。不透明でない色は地 under に重ねる
export function parseColor(text: string, under: Rgb = [255, 255, 255]): Rgb {
  const s = text.trim().toLowerCase();
  if (s.startsWith('color-mix(')) return parseMix(s, under);
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(h)) throw new Error(`色が読めない: ${text}`);
    const rgb: Rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return over(rgb, a, under);
  }
  const m = /^rgba?\((.*)\)$/.exec(s);
  if (!m) throw new Error(`色が読めない: ${text}`);
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  const num = (p: string, max: number) => (p.endsWith('%') ? (parseFloat(p) / 100) * max : parseFloat(p));
  const rgb = parts.slice(0, 3).map((p) => num(p, 255)) as Rgb;
  const a = parts[3] === undefined ? 1 : num(parts[3], 1);
  return over(rgb, a, under);
}

// color-mix(in srgb, A p%, B)：B が transparent なら A を p の濃さで地に重ねる。色なら sRGB で混ぜる（p が無ければ半々）
function parseMix(s: string, under: Rgb): Rgb {
  const args: string[] = [];
  let depth = 0;
  let start = 'color-mix('.length;
  for (let i = start; i < s.length - 1; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === ',' && depth === 0) {
      args.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(s.slice(start, s.length - 1).trim());
  if (args[0] !== 'in srgb' || args.length !== 3) throw new Error(`色が読めない: ${s}`);
  const part = (a: string) => {
    const m = /^(.*?)(?:\s+([\d.]+)%)?$/.exec(a) as RegExpExecArray;
    return { color: m[1], p: m[2] === undefined ? undefined : parseFloat(m[2]) / 100 };
  };
  const a = part(args[1]);
  const b = part(args[2]);
  const p = a.p ?? (b.p === undefined ? 0.5 : 1 - b.p);
  if (b.color === 'transparent') return over(parseColor(a.color, under), p, under);
  const A = parseColor(a.color, under);
  const B = parseColor(b.color, under);
  return A.map((v, i) => v * p + B[i] * (1 - p)) as Rgb;
}

function over(rgb: Rgb, a: number, under: Rgb): Rgb {
  return rgb.map((v, i) => v * a + under[i] * (1 - a)) as Rgb;
}

// 半透明の色を、地 under に重ねた不透明の色にする
export function flatten(color: string, under: string): string {
  return toHex(parseColor(color, parseColor(under)));
}

export function toHex([r, g, b]: Rgb): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

const lin = (c: number) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const unlin = (c: number) => 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

export function luminance(color: string): number {
  const [r, g, b] = parseColor(color).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// WCAG 2 の比（1〜21。順は問わない）
export function wcag(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// APCA の Lc（暗い文字は正、明るい文字は負）。目安で、テストでは落とさない
export function apca(text: string, bg: string): number {
  const Y = (c: string) => {
    const [r, g, b] = parseColor(c).map((v) => (v / 255) ** 2.4);
    return 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  };
  const clamp = (y: number) => (y > 0.022 ? y : y + (0.022 - y) ** 1.414);
  const t = clamp(Y(text));
  const b = clamp(Y(bg));
  if (Math.abs(b - t) < 0.0005) return 0;
  let out: number;
  if (b > t) {
    const s = (b ** 0.56 - t ** 0.57) * 1.14;
    out = s < 0.1 ? 0 : s - 0.027;
  } else {
    const s = (b ** 0.65 - t ** 0.62) * 1.14;
    out = s > -0.1 ? 0 : s + 0.027;
  }
  return out * 100;
}

function oklab(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb([L, a, b]: [number, number, number]): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (v: Rgb) => v.every((c) => c >= -1e-4 && c <= 1 + 1e-4);
const encode = (v: Rgb): Rgb => v.map((c) => unlin(Math.max(0, Math.min(1, c)))) as Rgb;

// CSS の oklch(from <色> clamp(lo, l, hi) c h)：明るさだけを帯に収める。sRGB の外に出たら、
// clip は成分ごとに切る、gamut は明るさを保って彩度を下げる（ブラウザの寄せ方の両方で確かめるため）
export function bandColor(color: string, lo: number, hi: number, mode: 'clip' | 'gamut'): string {
  const [L, a, b] = oklab(parseColor(color));
  const l = Math.min(hi, Math.max(lo, L));
  if (l === L) return toHex(parseColor(color));
  const C = Math.hypot(a, b);
  const h = Math.atan2(b, a);
  const at = (c: number) => oklabToRgb([l, c * Math.cos(h), c * Math.sin(h)]);
  if (mode === 'clip' || inGamut(at(C))) return toHex(encode(at(C)));
  let lo2 = 0;
  let hi2 = C;
  for (let i = 0; i < 30; i++) {
    const mid = (lo2 + hi2) / 2;
    if (inGamut(at(mid))) lo2 = mid;
    else hi2 = mid;
  }
  return toHex(encode(at(lo2)));
}

export type Vision = 'normal' | 'protan' | 'deutan' | 'tritan';

const CVD: Record<Exclude<Vision, 'normal'>, number[][]> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

function simulate(rgb: Rgb, vision: Vision): Rgb {
  if (vision === 'normal') return rgb;
  const v = rgb.map(lin);
  return CVD[vision].map((row) => unlin(Math.max(0, Math.min(1, row[0] * v[0] + row[1] * v[1] + row[2] * v[2])))) as Rgb;
}

// OKLab の距離（×100）。カテゴリの色どうしは 10 以上あると見分けやすい
export function deltaE(a: string, b: string, vision: Vision = 'normal'): number {
  const A = oklab(simulate(parseColor(a), vision));
  const B = oklab(simulate(parseColor(b), vision));
  return 100 * Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}
