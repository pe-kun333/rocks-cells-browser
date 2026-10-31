// 六角形スクショ（六角メモの「六角形スクショ」と同じ操作）
//   ページを静止画にして、マウスの位置を中心に六角形の枠を出す。ホイール・＋−・↑↓ で大きさ、1〜9 で登録した大きさ（S で登録）、
//   クリック・Enter で切り取り、コメントを書いて「左のセルに置く」「相棒に見せる」「Grok に送る」（S3.12）。Esc・右クリックでやめる
//   六角形の外は透明な画像にする
import { t } from '../i18n';
import { el } from '../util';
import { BOT_FEATURES } from '../features';

// grok：Grok-Bot 1体に、画像とコメントを送る（S3.12。左が依頼の小窓を開いてもらう。タブの画像・リンクの表紙のときは出さない）
export type ShotTarget = 'cell' | 'companion' | 'both' | 'grok';

export interface ShotResult {
  image: string; // 六角形に切り取った画像（data URL・外は透明）
  comment: string;
  to: ShotTarget;
}

const PREFS_KEY = 'honeycomb.shot';
const MIN_R = 40;
const MAX_R = 1000;
const OUT_MAX = 520; // 切り取った画像の大きさの上限（px）
const SQRT3 = Math.sqrt(3);

interface ShotPrefs {
  radius: number;
  sizes: number[]; // 登録した大きさ（1〜9）
}

function loadPrefs(): ShotPrefs {
  try {
    const s = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<ShotPrefs>;
    return {
      radius: typeof s.radius === 'number' ? Math.min(MAX_R, Math.max(MIN_R, s.radius)) : 160,
      sizes: Array.isArray(s.sizes) ? s.sizes.filter((n) => typeof n === 'number').slice(0, 9) : [],
    };
  } catch {
    return { radius: 160, sizes: [] };
  }
}

function savePrefs(p: ShotPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // 覚えられなくても動作は続ける
  }
}

const hexPoints = (cx: number, cy: number, r: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 90);
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });

// 撮る画面を出す。終わったら（やめたら null で）onDone
//   purpose が tabImage なら、切り取った六角形はタブの画像になる（ボタンは「タブの画像にする」だけ。コメントはタブのコメント）
//   linkCover なら、切り取った六角形を表紙にして、右クリックしたリンクを新しいタブとしてセルに追加する（ページはそのまま）
export function startShot(image: string, pageTitle: string, onDone: (result: ShotResult | null) => void, purpose?: 'tabImage' | 'linkCover'): () => void {
  const prefs = loadPrefs();
  const root = el('div', 'shot');
  const img = el('img', 'shot-image');
  img.alt = '';
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'shot-frame');
  const dim = document.createElementNS(NS, 'path');
  dim.setAttribute('class', 'shot-dim');
  dim.setAttribute('fill-rule', 'evenodd');
  const hex = document.createElementNS(NS, 'polygon');
  hex.setAttribute('class', 'shot-hex');
  svg.append(dim, hex);
  const bar = el('div', 'shot-bar');
  const sizesBox = el('span', 'shot-sizes');
  const radiusLabel = el('span', 'shot-radius');
  bar.append(
    el('strong', '', t('六角形スクショ')),
    radiusLabel,
    sizesBox,
    el('span', 'shot-help', t('ホイール・＋−で大きさ／1〜9 登録した大きさ（S で登録）／クリックで切り取る／Esc でやめる')),
  );
  root.append(img, svg, bar);
  document.body.append(root);

  let center = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  let mode: 'frame' | 'comment' = 'frame';
  let finished = false;
  let panel: HTMLElement | null = null;

  const draw = () => {
    const r = prefs.radius;
    const pts = hexPoints(center.x, center.y, r);
    const poly = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    hex.setAttribute('points', poly);
    const w = window.innerWidth;
    const h = window.innerHeight;
    dim.setAttribute('d', `M0,0H${w}V${h}H0Z M${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L')}Z`);
    radiusLabel.textContent = t('半径 {0}px', { 0: Math.round(r) });
    sizesBox.replaceChildren(
      ...prefs.sizes.map((size, i) => {
        const b = el('button', 'shot-size', `${i + 1}: ${Math.round(size)}`);
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          setRadius(size);
        });
        return b;
      }),
    );
  };

  const setRadius = (r: number) => {
    prefs.radius = Math.min(MAX_R, Math.max(MIN_R, r));
    savePrefs(prefs);
    draw();
  };

  const finish = (result: ShotResult | null) => {
    if (finished) return;
    finished = true;
    window.removeEventListener('keydown', onKey, true);
    root.remove();
    onDone(result);
  };

  // 六角形で切り取る（外は透明）
  const cut = (): string => {
    const scale = img.naturalWidth / img.clientWidth || 1; // 画面の px → 画像の px
    const r = prefs.radius;
    const w = SQRT3 * r;
    const h = 2 * r;
    const out = Math.min(1, OUT_MAX / (h * scale)) * scale; // 出力の縮尺
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * out));
    canvas.height = Math.max(1, Math.round(h * out));
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    const pts = hexPoints(canvas.width / 2, canvas.height / 2, canvas.height / 2);
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.clip();
    const sx = (center.x - w / 2) * scale;
    const sy = (center.y - h / 2) * scale;
    ctx.drawImage(img, sx, sy, w * scale, h * scale, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/webp', 0.9);
  };

  const showComment = (shot: string) => {
    mode = 'comment';
    svg.classList.add('frozen');
    panel = el('form', 'shot-panel');
    const preview = el('img', 'shot-preview');
    preview.src = shot;
    preview.alt = t('切り取った六角形');
    const forTab = purpose === 'tabImage' || purpose === 'linkCover'; // どちらも、切り取った六角形がタブの表紙になる
    const okLabel = purpose === 'linkCover' ? t('表紙にしてセルに追加') : forTab ? t('タブの画像にする') : t('左のセルに置く');
    const text = el('textarea', 'shot-comment');
    text.rows = forTab ? 1 : 3;
    if (forTab) text.maxLength = 40;
    text.placeholder = forTab
      ? t('タブのコメント（なくてもよい・40文字まで）\nEnter で「{0}」', { 0: okLabel })
      : t('コメント（なくてもよい）{0}\nEnter で「左のセルに置く」・Shift+Enter で改行', { 0: pageTitle ? `｜${pageTitle}` : '' });
    const buttons = el('div', 'shot-buttons');
    const send = (to: ShotTarget) => finish({ image: shot, comment: text.value.trim(), to });
    const cell = el('button', 'reader-tool', okLabel);
    cell.type = 'submit';
    const ask = el('button', 'reader-tool', t('相棒に見せる'));
    ask.type = 'button';
    ask.title = t('右の相棒に画像を見せて、説明してもらう（画像が Anthropic に送られます）');
    ask.addEventListener('click', () => send('companion'));
    const both = el('button', 'reader-tool', t('両方'));
    both.type = 'button';
    both.title = t('左のセルに置いて、右の相棒にも見せる');
    both.addEventListener('click', () => send('both'));
    const grok = el('button', 'reader-tool', t('Grok に送る'));
    grok.type = 'button';
    grok.title = t('Grok-Bot 1体に、画像とコメントを送る（依頼の小窓が開きます。貼るのは画像と文の2回。画像は Grok Bot に送られます）');
    grok.addEventListener('click', () => send('grok'));
    if (!BOT_FEATURES) grok.hidden = true;
    const again = el('button', 'reader-tool', t('選び直す'));    again.type = 'button';
    again.addEventListener('click', () => {
      panel?.remove();
      panel = null;
      mode = 'frame';
      svg.classList.remove('frozen');
    });
    const cancel = el('button', 'reader-tool', t('やめる'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => finish(null));
    if (forTab) buttons.append(cell, again, cancel);
    else buttons.append(cell, ask, both, grok, again, cancel);
    panel.append(preview, text, buttons);
    panel.addEventListener('submit', (e) => {
      e.preventDefault();
      send('cell');
    });
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send('cell');
      }
    });
    // 切り取った場所の近くに出す（画面からはみ出さないように）
    root.append(panel);
    const pw = panel.offsetWidth;
    const ph = panel.offsetHeight;
    const x = Math.min(Math.max(8, center.x - pw / 2), window.innerWidth - pw - 8);
    const below = center.y + prefs.radius + 10;
    const y = below + ph < window.innerHeight - 8 ? below : Math.max(8, center.y - prefs.radius - ph - 10);
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
    text.focus();
  };

  root.addEventListener('pointermove', (e) => {
    if (mode !== 'frame') return;
    center = { x: e.clientX, y: e.clientY };
    draw();
  });
  root.addEventListener('wheel', (e) => {
    if (mode !== 'frame') return;
    e.preventDefault();
    setRadius(prefs.radius * (e.deltaY > 0 ? 0.92 : 1 / 0.92));
  }, { passive: false });
  root.addEventListener('click', (e) => {
    if (mode !== 'frame' || (e.target as Element).closest('.shot-bar')) return;
    center = { x: e.clientX, y: e.clientY };
    showComment(cut());
  });
  root.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    finish(null);
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (mode === 'comment' && panel) {
        panel.remove();
        panel = null;
        mode = 'frame';
        svg.classList.remove('frozen');
      } else {
        finish(null);
      }
      return;
    }
    if (mode !== 'frame') return;
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      showComment(cut());
    } else if (e.key === '+' || e.key === 'ArrowUp' || e.key === ';') {
      e.preventDefault();
      setRadius(prefs.radius * 1.1);
    } else if (e.key === '-' || e.key === 'ArrowDown') {
      e.preventDefault();
      setRadius(prefs.radius / 1.1);
    } else if (/^[1-9]$/.test(e.key)) {
      const size = prefs.sizes[Number(e.key) - 1];
      if (size) setRadius(size);
    } else if (e.key === 's' || e.key === 'S') {
      if (!prefs.sizes.some((s) => Math.abs(s - prefs.radius) < 1)) {
        prefs.sizes = [...prefs.sizes, Math.round(prefs.radius)].slice(-9);
        savePrefs(prefs);
        draw();
      }
    }
  };
  window.addEventListener('keydown', onKey, true);

  img.addEventListener('load', () => {
    // 撮った画像は、ページと同じ大きさで重ねる（画面の px = 画像の px ÷ 拡大率）
    img.style.width = `${img.naturalWidth / (window.devicePixelRatio || 1)}px`;
    draw();
  });
  img.src = image;
  draw();
  root.focus();
  return () => finish(null);
}
