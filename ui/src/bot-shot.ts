// 六角スクショを Grok-Bot へ（第3段 S3.12。docs/bot-cells/plan-s3-nest.md §5.2・S3.12）
//   ・送るのは2回貼る：① 画像だけをクリップボードに入れて、アプリのチャットに貼る → ② 文（頼む文＋返事の決まり＋依頼の JSON）を貼る。
//     画像と文を1つのクリップボードに同時に入れるのは、巣の設定で選んだときだけの試し（依頼の小窓 v2・R7d・D16。下の copyShotWithText）
//   ・画像は依頼（request.v1）に入れない。依頼の text には「画像を1枚、チャットに添えました（六角スクショ・題名）」とだけ書く
//   ・貼れなかったときの逃げ道：画像を bot-shots\<shotId>.png に保存して、フォルダを開く（チャットへドラッグで添付）・パスをコピー
//   ・① の画像は、クリップボード履歴（Win+V）とほかの端末への同期に入れない印つきで置く（依頼の小窓 v2・R2・D6）。
//     パスのコピー（copyShotText）は依頼でも画像でもないので、印は付けない（計画の Q1）
//   ・クリップボードの画像の候補（依頼の小窓 v2・R7a・D15）：印を付けたら、先に写しを PNG にして bot-shots に保存し（clipToPng。
//     縮めすぎないよう、上限は長い辺 1600px・Base64 90 万字。越えたら縮め直す）、同じ 2 回貼りで送る。一文は clipImageLine
//   ・画像に書き足した版（依頼の小窓 v2・R7b・D15。panels/bot-image-edit.ts）：一文は editedImageLine（出どころ・書き足した版・印・箱・隠し・指さしの数。
//     元の画像を選んだら「元の画像」）、小窓の画像のカードの 1 行は editedImageNote。① で貼るのは書き足した版の PNG
//   ・隠す候補（依頼の小窓 v2・R7c）：カードの 1 行に「候補 n 未決」など（hintWords）。一文には候補のことを書かない（何も描いていなければ、ふつうの一文）
//   ・画像と文を一つの貼り付けで（依頼の小窓 v2・R7d・D16・Q2。巣の設定 pasteMode が html のときだけ。既定は 2 回貼り）：
//     依頼の文を作るのは左なので、読む画面は渡す画像（書き足した版なら黒塗りを焼き込んだ PNG）を先に bot-shots に保存し、その名前（ShotRef）を
//     左へ渡す。左が copyShotWithText で、C++ の clipboardWriteImage（shotId・text・html）に 1 回で書いてもらう。C++ は保存した写しを読み、
//     CF_UNICODETEXT（文だけ）・HTML Format（その PNG の data: の <img> と、imageTextHtml の文の断片）・PNG・DIBV5 を、履歴に入れない印と同じ Open で置く。
//     アプリが HTML の画像を受けるかはブラウザからは分からない（受けなければ文だけが貼られ、画像は落ちる）ので、自動では決めない
//   ・ここは C++ への頼みごとと、使う人の設定だけ（画面は panels/bot-shot-steps.ts）
import { request, send } from './bridge';
import { cleanBotLine } from './bot-replies';
import type { ImageEditCounts, ImageEditResult, ImageHintCount } from './panels/bot-image-edit';

export type ShotFill = 'white' | 'dark'; // 画像の透明な所の色（クリップボードに入れるときに C++ が塗る。保存するファイルは透明のまま）
export type ShotPaste = 'paste' | 'file'; // paste＝画像を貼る（既定）　file＝貼れないので、はじめからファイルの逃げ道だけ

// 画像と文を一つの貼り付けで書く写し（R7d）：bot-shots\<shotId>.png の名前と、透明な所の色
export interface ShotRef {
  shotId: string;
  fill: ShotFill;
}

const PASTE_KEY = 'honeycomb.shotGrokPaste';
const FILL_KEY = 'honeycomb.shotGrokFill';
const MAX_SIDE = 520; // 画像の縦・横の上限（撮る画面の OUT_MAX と同じ）
const TITLE_CHARS = 80; // 画像の一文に入れる題名の字数
const CLIP_MAX_SIDE = 1600; // クリップボードの画像の写し（R7a）の縦・横の上限（C++ の clipboardReadImage と同じ）
const CLIP_MAX_CHARS = 900_000; // 写しの PNG の Base64 の字数の上限（越えたら 8 割ずつ縮め直す）
const CLIP_MIN_SIDE = 320; // ここまで縮めても越えるなら、写しは取らない

export function loadShotPaste(): ShotPaste {
  try {
    return localStorage.getItem(PASTE_KEY) === 'file' ? 'file' : 'paste';
  } catch {
    return 'paste';
  }
}

// 「貼れない」と決めた（file）・戻した（paste）。覚えられなくても、この小窓のあいだは変える
export function saveShotPaste(paste: ShotPaste) {
  try {
    if (paste === 'file') localStorage.setItem(PASTE_KEY, 'file');
    else localStorage.removeItem(PASTE_KEY);
  } catch {
    // 覚えられなくても動作は続ける
  }
}

export function loadShotFill(): ShotFill {
  try {
    return localStorage.getItem(FILL_KEY) === 'dark' ? 'dark' : 'white';
  } catch {
    return 'white';
  }
}

export function saveShotFill(fill: ShotFill) {
  try {
    if (fill === 'dark') localStorage.setItem(FILL_KEY, 'dark');
    else localStorage.removeItem(FILL_KEY);
  } catch {
    // 覚えられなくても動作は続ける
  }
}

// 保存する画像の名前（英数字とハイフンだけ。C++ も同じ形しか受けない）。例 shot-20261009-193859-k3x9
export function newShotId(now = new Date()): string {
  const two = (n: number) => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}`;
  const time = `${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  return `shot-${day}-${time}-${Math.random().toString(36).slice(2, 6).padEnd(4, '0')}`;
}

// 画像の一文の括弧の中の頭（出どころ）。title：六角スクショの題名（クリップボードの画像の候補なら null）
function imageSource(title: string | null): string {
  if (title === null) return 'クリップボードの画像';
  const line = cleanBotLine(String(title ?? ''));
  return line ? `六角スクショ・${[...line].length > TITLE_CHARS ? `${[...line].slice(0, TITLE_CHARS).join('')}…` : line}` : '六角スクショ';
}

const fileTail = (path?: string) => (path ? `。画像のファイル：${path}` : '');

// 依頼の text に入れる画像の一文（画像の中身は入れない）。path：「パスも添える」にしたとき、保存したフルパス
export function shotImageLine(title: string, path?: string): string {
  return `画像を1枚、チャットに添えました（${imageSource(title)}）${fileTail(path)}`;
}

// クリップボードの画像の候補（R7a）の一文。path：「パスも添える」にしたとき、保存した写しのフルパス
export function clipImageLine(path?: string): string {
  return `画像を1枚、チャットに添えました（${imageSource(null)}）${fileTail(path)}`;
}

// 書き足した画像（R7b）の一文：「（クリップボードの画像・書き足した版・印 2・箱 2・隠し 1・指さし 1）」。元の画像を選んだら「（…・元の画像）」。
//   印＝丸・矢印・番号・文字、隠し＝黒塗り・ぼかし（0 のものは書かない）。title：六角スクショの題名（クリップボードの画像なら null）
export function editedImageLine(edit: ImageEditResult, title: string | null, path?: string): string {
  if (edit.version === 'annotated' && !edit.marks.length) return `画像を1枚、チャットに添えました（${imageSource(title)}）${fileTail(path)}`; // 何も描いていない（隠す候補を見ただけ。R7c）
  const kind = edit.version === 'original' ? '元の画像' : ['書き足した版', ...editBits(edit.counts, true)].join('・');
  return `画像を1枚、チャットに添えました（${imageSource(title)}・${kind}）${fileTail(path)}`;
}

// 小窓の画像のカードの「この画像で送るもの」の 1 行（R7b）：「書き足した版（丸 1・箱 2・隠し 1・指さし 1）」／「元の画像（印なし・隠しなし）」。
//   隠す候補（R7c）があれば「・候補 1 未決」「・候補は隠した」など
export function editedImageNote(edit: ImageEditResult): string {
  const bits = editBits(edit.counts, false);
  const what =
    edit.version === 'original' ? '元の画像（印なし・隠しなし）' : edit.marks.length ? `書き足した版${bits.length ? `（${bits.join('・')}）` : ''}` : '元の画像のまま';
  const hints = hintWords(edit.hints);
  return `この画像で送るもの：${what}${hints ? `・${hints}` : ''}`;
}

// 隠す候補の数の言葉（R7c）：未決があれば「候補 1 未決」、無ければ「候補は隠した」「候補はそのまま」「候補：隠した 1・そのまま 1」。候補が無ければ空
export function hintWords(count: ImageHintCount | undefined): string {
  if (!count?.found) return '';
  const open = count.found - count.hidden - count.kept;
  if (open > 0) return `候補 ${open} 未決`;
  if (count.hidden === count.found) return '候補は隠した';
  if (count.kept === count.found) return '候補はそのまま';
  return `候補：隠した ${count.hidden}・そのまま ${count.kept}`;
}

// 送る前の 1 行に足す、未決の候補の数（R7c。無ければ 0）
export function openHints(count: ImageHintCount | undefined): number {
  return count?.found ? Math.max(0, count.found - count.hidden - count.kept) : 0;
}

// 印の数の言葉。short：一文用（印・箱・隠し・指さし）　でなければカード用（丸・矢印・箱・番号・文字・隠し・指さし）
function editBits(c: ImageEditCounts, short: boolean): string[] {
  const pairs: [string, number][] = short
    ? [
        ['印', c.circle + c.arrow + c.num + c.text],
        ['箱', c.box],
        ['隠し', c.black + c.blur],
        ['指さし', c.point],
      ]
    : [
        ['丸', c.circle],
        ['矢印', c.arrow],
        ['箱', c.box],
        ['番号', c.num],
        ['文字', c.text],
        ['隠し', c.black + c.blur],
        ['指さし', c.point],
      ];
  return pairs.filter(([, n]) => n > 0).map(([name, n]) => `${name} ${n}`);
}

// data URL の画像を読む（decode() は描いていない面で終わらないことがあるので、load を待つ）
async function decodeImage(dataUrl: string): Promise<HTMLImageElement | null> {
  if (!/^data:image\//.test(dataUrl)) return null;
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('load'));
      img.src = dataUrl;
    });
    return img;
  } catch {
    return null;
  }
}

// 長い辺を maxSide までに縮めて PNG の Base64（data: の頭なし）にする。透明はそのまま
function drawPng(img: HTMLImageElement, maxSide: number): string | null {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight, 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const png = canvas.toDataURL('image/png');
  const comma = png.indexOf(',');
  return png.startsWith('data:image/png;base64,') && comma > 0 ? png.slice(comma + 1) : null;
}

// 切り取った六角形（data URL。撮る画面は webp）を PNG の Base64（data: の頭なし）にする。透明はそのまま。520px を超えていたら縮める
export async function shotToPng(dataUrl: string): Promise<string | null> {
  const img = await decodeImage(dataUrl);
  try {
    return img ? drawPng(img, MAX_SIDE) : null;
  } catch {
    return null;
  }
}

// クリップボードの画像の候補（R7a。左が読んだ長い辺 1600px の JPEG）の写しを PNG の Base64 にする。
//   長い辺 1600px まで。Base64 が 90 万字を越えたら 8 割ずつ縮め直す（320px でも越えるなら null）
export async function clipToPng(dataUrl: string): Promise<string | null> {
  const img = await decodeImage(dataUrl);
  if (!img) return null;
  try {
    let side = Math.min(CLIP_MAX_SIDE, Math.max(img.naturalWidth, img.naturalHeight, 1));
    for (;;) {
      const png = drawPng(img, side);
      if (!png) return null;
      if (png.length <= CLIP_MAX_CHARS) return png;
      if (side <= CLIP_MIN_SIDE) return null;
      side = Math.max(CLIP_MIN_SIDE, Math.floor(side * 0.8));
    }
  } catch {
    return null;
  }
}

// ① 画像だけをクリップボードへ（C++ の clipboardWriteImage → clipboard.cpp。navigator.clipboard は使わない）
//   書けなかった理由を返す。postMessage が投げた例外も、ここで文にする（呼び出し側で消さない）
//   Grok Bot に送る画像（六角スクショ・撮ったもの）なので、クリップボード履歴（Win+V）と同期に入れない印を付ける（R2・D6）
export async function copyShotImageResult(png: string, fill: ShotFill): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!png) return { ok: false, message: `画像をコピーできませんでした（画像が空です）。アプリは開いていません` };
  try {
    const reply = await request((requestId) => ({ type: 'clipboardWriteImage', requestId, png, fill, noHistory: true }), 8_000);
    if (!reply) return { ok: false, message: '画像をコピーできませんでした（ブラウザの本体から返事がありません）。アプリは開いていません' };
    if (reply.type !== 'clipboardWritten' || !reply.ok) return { ok: false, message: '画像をコピーできませんでした（クリップボードに書けませんでした）。アプリは開いていません' };
    return { ok: true };
  } catch (error) {
    const why = error instanceof Error && error.message ? error.message : '理由が分かりません';
    return { ok: false, message: `画像をコピーできませんでした（${why}）。アプリは開いていません` };
  }
}

export async function copyShotImage(png: string, fill: ShotFill): Promise<boolean> {
  const copied = await copyShotImageResult(png, fill);
  return copied.ok;
}

// 依頼の文を、HTML Format の文の断片にする（R7d。画像は C++ が頭に足す）。& < > " は文字のまま見えるように直し、改行は <br>、
//   続く空白はそのまま残す（white-space: pre-wrap。依頼の JSON の形を崩さない）
export function imageTextHtml(text: string): string {
  const escaped = text
    .replace(/\r\n?/g, '\n')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<div style="white-space:pre-wrap">${escaped.split('\n').join('<br>')}</div>`;
}

// 画像と文を一つの貼り付けで（R7d。左の ClipboardSender の writeImageText）：保存した写しと依頼の文を 1 回でクリップボードへ。
//   Grok Bot への依頼とその画像なので、履歴（Win+V）と同期に入れない印を付ける（R2・D6。文・HTML・PNG・DIBV5 の同じ Open に置く）
export async function copyShotWithText(text: string, image: ShotRef): Promise<boolean> {
  const reply = await request((requestId) => ({ type: 'clipboardWriteImage', requestId, shotId: image.shotId, fill: image.fill, text, html: imageTextHtml(text), noHistory: true }), 8_000);
  return reply?.type === 'clipboardWritten' && reply.ok;
}

// 逃げ道：bot-shots\<shotId>.png に保存する。保存したフルパス（できなければ null）
export async function saveShotImage(shotId: string, png: string): Promise<string | null> {
  const reply = await request((requestId) => ({ type: 'botShotSave', requestId, shotId, png }), 8_000);
  return reply?.type === 'botShotSaved' && reply.ok && typeof reply.path === 'string' && reply.path ? reply.path : null;
}

// 文字をクリップボードへ（画像のパスをコピー）
export async function copyShotText(text: string): Promise<boolean> {
  const reply = await request((requestId) => ({ type: 'clipboardWrite', requestId, text, html: '' }), 5_000);
  return reply?.type === 'clipboardWritten' && reply.ok;
}

// 逃げ道：bot-shots をエクスプローラーで開く（shotId の画像を選んだ状態で。アプリのチャットへドラッグで添付）
export function openShotFolder(shotId: string) {
  send({ type: 'botShotOpenFolder', shotId });
}
