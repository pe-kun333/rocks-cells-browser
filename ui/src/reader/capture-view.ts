// 撮った画像を、読む画面の面いっぱいに出す（C3・C4）。アドレス欄は付けない。
//   スタンプと、矢印・四角・蛍光ペン・文字は台帳の別データ。画像ファイルは変えない。
//   「隠す」だけは、確認のあと、右の店がファイルの画像に塗って置き換える（この画面は場所と隠し方を頼むだけで、画像は送らない）。
//   書き込みの絵は canvas に描く。AI に送る画像を焼く関数（capture-draw.ts の drawAnnotations）と同じ関数で描き、
//   読む画面で見たものと送るものを一致させる（番号つき）。
//   線と文字は、どの道具でも当たれば選べる（capture-hit.ts）。選ぶと、移動・端点のつまみ・矢印キー・消す・書き直しができる（R4-C）。
//   拡大（合わせる・100%・200%・Ctrl+ホイール）は reader/capture-zoom.ts。
import { t } from '../i18n';
import { CellMenu, type MenuEntry } from '../panels/cell-menu';
import {
  BLUR_LIMIT,
  clipMarkNote,
  clipStrokeText,
  MARK_LIMIT,
  MARK_NOTE_MAX,
  newMarkId,
  newStrokeId,
  STAMPS,
  STROKE_COLOR,
  STROKE_LIMIT,
  STROKE_TEXT_MAX,
  stampOf,
  type CaptureBlur,
  type CaptureMark,
  type CaptureStroke,
  type HideRect,
  type StampId,
  type StrokeKind,
} from '../captures';
import { annotationStyle, drawAnnotations, NUMBER_DOT, numberOf, numberPieces, textStartX, type AnnotationLayout } from '../capture-draw';
import { HIDE_MODE_DEFAULT, type HideMode } from '../capture-hide';
import { hitStroke } from '../capture-hit';
import { el } from '../util';
import { attachZoom, type ZoomLevel } from './capture-zoom';

export interface CaptureViewPayload {
  id: string;
  image: string;
  marks: CaptureMark[];
  strokes: CaptureStroke[];
  blur: CaptureBlur[];
  title: string;
  askedAt?: number; // 最後に AI へ送った時刻（送った写しは隠れない、と確認に添える）
  video?: boolean; // 録画の mp4 がある（mp4 は隠れない、と確認に添える）
  undo?: boolean; // 開いた時点で「隠すのを取り消す」で戻せるものがある
}

interface ViewHooks {
  onMarks: (marks: CaptureMark[]) => void;
  onStrokes: (strokes: CaptureStroke[]) => void;
  onHide: (rects: HideRect[], mode: HideMode, seq: number) => void;
  onUnhide: (seq: number) => void;
  onClose: () => void;
}

type DrawTool = StrokeKind | 'stamp' | 'blur';

// 戻す・やり直すの一段（要素と配列は不変として扱う。変えるときは新しく作る）
type Snap = { marks: readonly CaptureMark[]; strokes: readonly CaptureStroke[] };

const KEPT = t('残す画像には焼き付きません（AI に送る画像には入ります）');

// 表示の順＝キー（1〜）の順
const TOOLS: { id: DrawTool; label: string; title: string }[] = [
  { id: 'arrow', label: t('矢印'), title: t('始点から終点へ矢印を引きます。{0}', { 0: KEPT }) },
  { id: 'rect', label: t('四角'), title: t('四角で囲みます。{0}', { 0: KEPT }) },
  { id: 'marker', label: t('蛍光ペン'), title: t('半透明の線を引きます。{0}', { 0: KEPT }) },
  { id: 'text', label: t('文字'), title: t('クリックした場所に、一行を書きます。{0}', { 0: KEPT }) },
  { id: 'stamp', label: t('スタンプ'), title: t('画像をクリックした場所にスタンプを置きます。右クリックでも置けます。AI に送る画像には番号つきで焼き、文も番号で指します') },
  {
    id: 'blur',
    label: t('隠す'),
    title: t('四角で囲むと、確認のあと、その部分を残す画像からも隠します（黒く塗りつぶし。モザイクも選べます）。隠した場所の読んだ文字も「（隠した）」になります'),
  },
];

const HIDE_MODES: { id: HideMode; label: string }[] = [
  { id: 'fill', label: t('塗りつぶし') },
  { id: 'mosaic', label: t('モザイク') },
];

const HISTORY_MAX = 100;
const STAMP_MIN_PX = 28; // 当たり用のボタンの最小の大きさ（CSS px）
const STAMP_FIELD = '.capture-stamp-note input';
const INK_FIELD = '.capture-ink-note input';

// 拡大の段のボタン（見出しの「閉じる」の左）
const ZOOM_BUTTONS: { level: ZoomLevel; label: string; title: string }[] = [
  { level: 'fit', label: t('合わせる'), title: t('画像の全体が見える大きさにします（Ctrl+0）') },
  { level: 1, label: '100%', title: t('画像の 1 画素を、画面の 1 画素にします（Ctrl+= で大きく、Ctrl+- で小さく。Ctrl+ホイールでも）') },
  { level: 2, label: '200%', title: t('100% の 2 倍にします') },
];

const HIT_TOLERANCE_PX = 6; // 線に当たる余裕（CSS px）
const OUTLINE_GROW_PX = 2; // 選んだ要素の囲いを、外接矩形から広げる幅（CSS px）
const MOVE_START_PX = 4; // 本体のドラッグが「動かす」になる距離（CSS px）
const STROKE_MIN = 0.012; // つまみで動かして、これより短く（四角は幅か高さが）なった線は捨てて元に戻す
const NUDGE_STEP = 0.001; // 矢印キー 1 回の移動（画像に対する割合）。Shift で NUDGE_BIG
const NUDGE_BIG = 0.01;
const NUDGE_WAIT_MS = 250; // 矢印キーをこれだけ押さなければ、動かした分を 1 回の操作として台帳へ
const NOTE_PLACEHOLDER = t('ひとこと（空でもよい）');

// つまみ 1 つ。どの端点（台帳の x・y の組）を動かすか
interface HandleSpec {
  x: 'x1' | 'x2';
  y: 'y1' | 'y2';
}

function handlesOf(stroke: CaptureStroke): HandleSpec[] {
  if (stroke.kind === 'text') return [];
  if (stroke.kind === 'rect') {
    return [
      { x: 'x1', y: 'y1' },
      { x: 'x2', y: 'y1' },
      { x: 'x1', y: 'y2' },
      { x: 'x2', y: 'y2' },
    ];
  }
  return [
    { x: 'x1', y: 'y1' },
    { x: 'x2', y: 'y2' },
  ];
}

function round4(value: number) {
  return Math.round(value * 10000) / 10000;
}

// 線を (dx, dy)（画像に対する割合）だけ動かす。4 つの端点がすべて 0〜1 に収まる範囲に挟む（点ごとに挟むと線が歪む）
function shifted(stroke: CaptureStroke, dx: number, dy: number): CaptureStroke {
  const lowX = -Math.min(stroke.x1, stroke.x2);
  const highX = 1 - Math.max(stroke.x1, stroke.x2);
  const lowY = -Math.min(stroke.y1, stroke.y2);
  const highY = 1 - Math.max(stroke.y1, stroke.y2);
  const moveX = dx < lowX ? lowX : dx > highX ? highX : dx;
  const moveY = dy < lowY ? lowY : dy > highY ? highY : dy;
  return {
    ...stroke,
    x1: round4(stroke.x1 + moveX),
    y1: round4(stroke.y1 + moveY),
    x2: round4(stroke.x2 + moveX),
    y2: round4(stroke.y2 + moveY),
  };
}

const BLUR_SAVE_WAIT_MS = 20_000; // 右が隠す・取り消すを保存した知らせ（captureHideDone）を待つ上限

// 隠す・取り消すの頼みの通し番号。画面を閉じて開き直しても戻さない（前の画面への遅い返事を、今の頼みと取り違えないため）
let hideSeq = 0;

// 隠すの失敗の理由（右の店の reason）ごとの文。ほかは「もう一度」。none と write は、頼んだのが隠すか取り消すかで文が変わる
const HIDE_FAIL: Record<string, string> = {
  limit: t('隠す場所は {0} までです', { 0: BLUR_LIMIT }),
  readonly: t('撮影の一覧を読めていないので、隠せません'),
  stale: t('あとで別の場所を隠したので、取り消せません'),
  missing: t('この撮影は消されています。閉じてください'),
  image: t('画像を読めなかったので、隠せませんでした'),
};
const HIDE_FAIL_DEFAULT = t('隠せませんでした。もう一度押してください');
// 成功したが、一覧（captures.json）の保存に失敗した（右の店の saved が false。reason: 'index' で届く）
const INDEX_NOT_SAVED = t('（一覧の保存に失敗しました。開き直すと、読んだ文字が戻ることがあります）');

function hideFailText(reason: string | undefined, kind: 'hide' | 'unhide') {
  if (reason === 'none') {
    return kind === 'unhide' ? t('取り消せるものがありません（読み直したり、別の撮影を隠したりしたあとは、取り消せません）') : t('隠す場所が小さすぎます');
  }
  if (reason === 'write') return kind === 'unhide' ? t('画像を保存できなかったので、取り消せませんでした。もう一度押してください') : t('画像を保存できなかったので、隠せませんでした。もう一度押してください');
  return (reason && HIDE_FAIL[reason]) || HIDE_FAIL_DEFAULT;
}

let menu: CellMenu | null = null;
let opened: {
  id: string;
  close: () => void;
  refresh: (image: string, blur: CaptureBlur[], undo: boolean) => void;
  forgetUndo: () => void;
  settleHide: (seq: number, ok: boolean, reason?: string) => void;
} | null = null;

function menuOf() {
  return menu ?? (menu = new CellMenu());
}

export function closeCaptureView() {
  opened?.close();
  opened = null;
}

// 隠した・取り消した（右のカードから隠したときも）。開いている撮影の id と同じなら、待っていてもいなくても、画像と隠した場所を新しくする。
//   別の撮影の知らせなら、画像は触らない。右の店の取り消しの写しは全カードで 1 枠なので、この撮影はもう取り消せない
export function refreshCaptureView(id: string, image: string, blur: CaptureBlur[], undo: boolean) {
  if (!opened) return;
  if (opened.id !== id) {
    opened.forgetUndo();
    return;
  }
  opened.refresh(image, blur, undo);
}

// 頼んだ隠す・取り消すの返事。開いている撮影の id と、待っている seq が合うときだけ
export function settleCaptureHide(id: string, seq: number, ok: boolean, reason?: string) {
  if (opened?.id !== id) return;
  opened.settleHide(seq, ok, reason);
}

// 日時は「m/d hh:mm」（右のカードの表示と同じ書き方）
function whenOf(ms: number) {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 中身が同じか（台帳の値は JSON にできるものだけ）
function same(a: unknown, b: unknown) {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

// 矩形がほぼ同じか（x・y・w・h がそれぞれ 0.002 以内。店は矩形を丸めて持つことがある）
const RECT_NEAR = 0.002;
function sameRect(a: HideRect, b: HideRect) {
  return Math.abs(a.x - b.x) <= RECT_NEAR && Math.abs(a.y - b.y) <= RECT_NEAR && Math.abs(a.w - b.w) <= RECT_NEAR && Math.abs(a.h - b.h) <= RECT_NEAR;
}

export function openCaptureView(payload: CaptureViewPayload, hooks: ViewHooks) {
  closeCaptureView();
  document.querySelector('.shot')?.remove();
  const root = el('div', 'capture-view');
  root.tabIndex = -1;
  const title = el('h1', 'capture-view-title', payload.title || t('撮った画像'));
  const hint = el(
    'p',
    'capture-view-hint',
    t('スタンプ・矢印・四角・蛍光ペン・文字は、残す画像のファイルには焼き付きません。AI に送る画像には、書き込みと、スタンプ・四角の番号を焼きます。隠すだけは、確認のあと残す画像にも焼きます。'),
  );
  const heading = el('div', 'capture-view-heading');
  heading.append(title, hint);
  const close = el('button', 'capture-view-close', t('閉じる'));
  close.type = 'button';
  const zoomGroup = el('div', 'capture-zoom-group');
  zoomGroup.setAttribute('role', 'group');
  zoomGroup.setAttribute('aria-label', '拡大');
  const zoomButtons = new Map<ZoomLevel, HTMLButtonElement>();
  for (const item of ZOOM_BUTTONS) {
    const button = el('button', 'capture-tool', item.label);
    button.type = 'button';
    button.title = item.title;
    button.addEventListener('click', () => zoom.set(item.level));
    zoomButtons.set(item.level, button);
    zoomGroup.append(button);
  }
  const headActions = el('div', 'capture-view-actions');
  headActions.append(zoomGroup, close);
  const head = el('header', 'capture-view-head');
  head.append(heading, headActions);
  const tools = el('div', 'capture-tools');
  const stampRow = el('div', 'capture-tools capture-stamp-kinds');
  stampRow.hidden = true;
  // 囲んだ四角のそばに出す確認（frame の中。位置は placeConfirm が決める）
  const confirm = el('div', 'capture-hide-confirm');
  confirm.hidden = true;
  const hideRow = el('div', 'capture-hide-row');
  const modeGroup = el('div', 'capture-hide-modes');
  modeGroup.setAttribute('role', 'group');
  modeGroup.setAttribute('aria-label', '隠し方');
  const modeButtons = new Map<HideMode, HTMLButtonElement>();
  for (const item of HIDE_MODES) {
    const button = el('button', 'capture-tool', item.label);
    button.type = 'button';
    button.addEventListener('click', () => {
      if (hiding) return;
      hideMode = item.id;
      paintConfirm();
    });
    modeButtons.set(item.id, button);
    modeGroup.append(button);
  }
  const hide = el('button', 'capture-tool', t('隠す'));
  hide.type = 'button';
  const cancelBlur = el('button', 'capture-tool', t('やめる'));
  cancelBlur.type = 'button';
  hideRow.append(modeGroup, hide, cancelBlur);
  confirm.append(hideRow);
  // 隠れないものの注意（該当するときだけ）
  if (payload.askedAt) confirm.append(el('p', 'capture-hide-note', t('{0} に送っています。送った写しは隠れません', { 0: whenOf(payload.askedAt) })));
  if (payload.video) confirm.append(el('p', 'capture-hide-note', t('mp4 は隠れません（カードの「mp4 だけ消す」で消せます）')));
  const status = el('p', 'capture-view-status');
  status.setAttribute('role', 'status');
  const stage = el('div', 'capture-stage');
  const frame = el('div', 'capture-frame');
  const img = el('img', 'capture-view-image');
  img.alt = t('撮った画像');
  const canvas = el('canvas', 'capture-draw');
  canvas.width = 0; // 大きさは fitCanvas で決める
  canvas.height = 0;
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  frame.append(img, canvas, confirm);
  stage.append(frame);
  root.append(head, tools, stampRow, status, stage);
  document.body.append(root);

  let zoomLevel: ZoomLevel = 'fit';
  const zoom = attachZoom({
    img,
    stage,
    frame,
    onChange: (level) => {
      zoomLevel = level;
      paintTools();
    },
  });

  let tool: DrawTool = 'arrow';
  let stampKind: StampId = 'good';
  let marks: readonly CaptureMark[] = payload.marks.map((mark) => ({ ...mark }));
  let strokes: readonly CaptureStroke[] = payload.strokes.map((stroke) => ({ ...stroke }));
  let blurs = payload.blur.map((region) => ({ ...region }));
  let draft: { id: string; fresh: boolean } | null = null;
  let textAt: { x: number; y: number } | null = null;
  let drawing: { x1: number; y1: number; x2: number; y2: number } | null = null;
  // スタンプをドラッグしている間の位置。mark 自体は書き換えず、見せるときだけ差し替える
  let dragging: { id: string; x: number; y: number } | null = null;
  let blurPending: { x: number; y: number; w: number; h: number } | null = null;
  let hideMode: HideMode = HIDE_MODE_DEFAULT; // 囲むたびに、塗りつぶしへ戻す
  let hiding = false;
  // 隠す・取り消すの返事待ち。seq が合う返事（settleHide）か上限（expireHide）まで、候補は消さない
  let hideWait: { seq: number; kind: 'hide' | 'unhide'; mode: HideMode; timer: number } | null = null;
  let undoable = payload.undo === true; // 「隠すのを取り消す」で戻せるものが右にあるか
  let suppressClick = false;
  let closed = false;
  // 選んでいる線・文字（台帳の stroke の id）。戻す・やり直すの山には入れない。道具を替えても外さない
  let selected: string | null = null;
  // 動かしている途中の線（つまみ・本体のドラッグ・矢印キー）。見せるだけで、離すか 250ms 待つまで台帳に入れない
  let live: CaptureStroke | null = null;
  // ポインタで線を動かしている間の印。Esc・戻す・やり直すで捨てる（捨てたあと離しても、何もしない）
  let gesture: object | null = null;
  let nudgeTimer: number | null = null;
  // 書き直している文字・ひとこと。anchor は入力欄を出す位置（画像に対する割合。文字は台帳の x1・y1、ひとことは描き手が置く位置のそば）
  let rewrite: { id: string; anchor: { x: number; y: number } } | null = null;
  // 描き手が返した、描いた要素の外接矩形（画像 px）。当たり判定と、選んだ要素の囲いに使う
  let layout: AnnotationLayout = { boxes: [] };
  const handleNodes: HTMLButtonElement[] = [];
  const handleSpecs: HandleSpec[] = [];

  // 戻す・やり直すの山。history[cursor] が今。底は、開いたときの印と線そのまま（選んで消せるので、線は一本ずつ積まない）。
  //   開く前の状態には戻れない
  let history: Snap[] = [{ marks, strokes }];
  let cursor = 0;

  const undoButton = el('button', 'capture-tool capture-undo', t('戻す'));
  undoButton.type = 'button';
  undoButton.title = t('最後の操作を戻します（スタンプ・矢印・四角・蛍光ペン・文字）。隠すのは「隠すのを取り消す」で');
  const redoButton = el('button', 'capture-tool capture-redo', t('やり直す'));
  redoButton.type = 'button';
  redoButton.title = t('戻した操作をやり直します');
  const unhideButton = el('button', 'capture-tool capture-unhide', t('隠すのを取り消す'));
  unhideButton.type = 'button';
  unhideButton.title = t('最後に隠した 1 か所を元に戻します（この画面を閉じるまで）。読んだ文字も戻ります');
  const toolButtons = new Map<DrawTool, HTMLButtonElement>();
  for (const item of TOOLS) {
    const button = el('button', 'capture-tool', item.label);
    button.type = 'button';
    button.title = item.title;
    button.addEventListener('click', () => selectTool(item.id));
    toolButtons.set(item.id, button);
    tools.append(button);
  }
  undoButton.addEventListener('click', () => undo());
  redoButton.addEventListener('click', () => redo());
  unhideButton.addEventListener('click', () => unhide());
  tools.append(undoButton, redoButton, unhideButton);
  const kindButtons = new Map<StampId, HTMLButtonElement>();
  for (const item of STAMPS) {
    const button = el('button', 'capture-tool', `${item.emoji} ${item.label}`);
    button.type = 'button';
    button.title = t('{0} {1} のスタンプを置きます', { 0: item.emoji, 1: item.label });
    button.addEventListener('click', () => {
      stampKind = item.id;
      paintTools();
    });
    kindButtons.set(item.id, button);
    stampRow.append(button);
  }

  // 待ちを捨てる（タイマーも消す）。待っていなければ何もしない
  const takeHideWait = () => {
    const wait = hideWait;
    hideWait = null;
    if (wait) window.clearTimeout(wait.timer);
    return wait;
  };

  const fieldValue = (selector: string) => {
    const node = frame.querySelector(selector);
    return node instanceof HTMLInputElement ? node.value : '';
  };
  const publishMarks = () => hooks.onMarks(marks.map((mark) => ({ ...mark })));
  const publishStrokes = () => hooks.onStrokes(strokes.map((stroke) => ({ ...stroke })));
  // 送りは一段につき、変わった方だけ
  const publishDiff = (a: Snap, b: Snap) => {
    if (!same(a.marks, b.marks)) publishMarks();
    if (!same(a.strokes, b.strokes)) publishStrokes();
  };

  // 台帳に残る変更は、すべてここを通す。今の段と中身が同じなら何もしない（false を返す）
  //   矢印キーで動かした分がまだ台帳に入っていなければ、先に 1 回の操作として入れる
  //   （strokes を渡す呼び出し元は、その前に settleNudge を呼んでおくこと。渡した配列は、入れる前の strokes から作ってあるため）
  const apply = (next: Partial<Snap>) => {
    settleNudge();
    const before = history[cursor];
    const after: Snap = { marks: next.marks ?? marks, strokes: next.strokes ?? strokes };
    if (same(before.marks, after.marks) && same(before.strokes, after.strokes)) return false;
    history = [...history.slice(0, cursor + 1), after];
    if (history.length > HISTORY_MAX) history = history.slice(history.length - HISTORY_MAX);
    cursor = history.length - 1;
    marks = after.marks;
    strokes = after.strokes;
    publishDiff(before, after);
    paint();
    return true;
  };

  // 山の中の別の段へ移る。開いている入力欄は捨てる（置いたばかりのスタンプは、段の印に戻るので消える）。
  //   選んでいた要素が無くなれば選択を外す。書き直し・動かしている途中も捨てる
  const travel = (to: number) => {
    const before = history[cursor];
    cursor = to;
    const after = history[cursor];
    marks = after.marks;
    strokes = after.strokes;
    draft = null;
    textAt = null;
    rewrite = null;
    live = null;
    gesture = null;
    if (selected && !strokes.some((stroke) => stroke.id === selected)) selected = null;
    status.textContent = '';
    publishDiff(before, after);
    paint();
  };

  const undo = () => {
    settleNudge();
    if (textAt || rewrite) {
      textAt = null;
      rewrite = null;
      paint();
      return;
    }
    if (draft?.fresh) {
      // 置いたばかりのスタンプ。段にも送りにも入っていないので、外すだけ
      marks = history[cursor].marks;
      draft = null;
      paint();
      return;
    }
    if (cursor > 0) travel(cursor - 1);
  };

  // 置いたばかりのスタンプの一行を書いている間は、やり直さない（段に戻ると、その印が黙って消える）
  const redo = () => {
    if (draft?.fresh) return;
    settleNudge();
    if (cursor < history.length - 1) travel(cursor + 1);
  };

  const paintTools = () => {
    for (const [id, button] of toolButtons) button.classList.toggle('is-current', id === tool);
    for (const [id, button] of kindButtons) button.classList.toggle('is-current', id === stampKind);
    for (const [level, button] of zoomButtons) button.classList.toggle('is-current', level === zoomLevel);
    stampRow.hidden = tool !== 'stamp';
    undoButton.disabled = cursor === 0 && !textAt && !rewrite && !draft?.fresh;
    redoButton.disabled = cursor >= history.length - 1 || !!draft?.fresh;
    unhideButton.disabled = !undoable || hiding;
    frame.dataset.tool = tool;
  };

  const shownMarks = () => {
    const moving = dragging;
    if (!moving) return marks;
    return marks.map((mark) => (mark.id === moving.id ? { ...mark, x: moving.x, y: moving.y } : mark));
  };

  // 画面に描く線。動かしている途中の線は差し替え、書き直している文字は描かない（入力欄と重ねない）。
  //   書き直している矢印・四角は、ひとこと以外を描く
  const shownStrokes = (): readonly CaptureStroke[] => {
    const moving = live;
    const editing = rewrite;
    if (!moving && !editing) return strokes;
    const list: CaptureStroke[] = [];
    for (const stroke of strokes) {
      const current = moving?.id === stroke.id ? moving : stroke;
      if (editing?.id === stroke.id) {
        if (stroke.kind !== 'text') list.push({ ...current, text: '' });
        continue;
      }
      list.push(current);
    }
    return list;
  };

  // つまみを出す線（選んでいて、文字でなく、書き直し中でもないもの）。動かしている途中は、その位置
  const handled = (): CaptureStroke | null => {
    if (!selected || rewrite?.id === selected) return null;
    const stroke = live?.id === selected ? live : strokes.find((item) => item.id === selected);
    return stroke && stroke.kind !== 'text' ? stroke : null;
  };

  // 札の当たり用ボタンの大きさ（CSS px）。描く札の直径を、画面の大きさに直した値と、最小の大きい方
  const stampPx = () => {
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    const shown = img.getBoundingClientRect().width;
    if (!width || !height || !shown) return STAMP_MIN_PX;
    return Math.max(STAMP_MIN_PX, annotationStyle(width, height).badge * (shown / width));
  };

  const sizeStamps = () => {
    const size = stampPx();
    const px = `${size}px`;
    frame.querySelectorAll<HTMLElement>('.capture-stamp').forEach((node) => {
      node.style.width = px;
      node.style.height = px;
    });
    // 拡大で札が大きくなっても、一行の欄が札に重ならないように
    frame.querySelectorAll<HTMLElement>('.capture-stamp-note').forEach((node) => {
      node.style.marginTop = `${Math.round(size / 2) + 4}px`;
    });
  };

  // 選んでいる要素の囲い。外接矩形を 2 CSS px 広げ、白の実線の上に濃い破線（画面だけ。描き手には入れない）
  const outlineSelected = (width: number) => {
    if (!ctx || !selected) return;
    const box = layout.boxes.find((item) => item.piece === 'stroke' && item.id === selected);
    const shown = img.getBoundingClientRect().width;
    if (!box || shown < 1) return;
    const unit = width / shown; // 画像の px ÷ CSS px
    const grow = OUTLINE_GROW_PX * unit;
    ctx.save();
    ctx.lineWidth = 1.5 * unit;
    ctx.lineJoin = 'miter';
    ctx.setLineDash([]);
    // theme: fixed begin：画像の上の選んだ枠（白と黒の二重線）
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(box.x - grow, box.y - grow, box.w + 2 * grow, box.h + 2 * grow);
    ctx.setLineDash([4 * unit, 3 * unit]);
    ctx.strokeStyle = '#2b2b2b';
    // theme: fixed end
    ctx.strokeRect(box.x - grow, box.y - grow, box.w + 2 * grow, box.h + 2 * grow);
    ctx.restore();
  };

  // つまみ（選んだ矢印・蛍光ペンの両端、四角の 4 隅）。ボタンは使い回して位置だけ入れ直す（動かしている最中も掴んだまま）
  const syncHandles = () => {
    const stroke = closed ? null : handled();
    const specs = stroke ? handlesOf(stroke) : [];
    while (handleNodes.length > specs.length) {
      handleNodes.pop()?.remove();
      handleSpecs.pop();
    }
    while (handleNodes.length < specs.length) {
      const index = handleNodes.length;
      const button = el('button', 'capture-handle');
      button.type = 'button';
      button.addEventListener('pointerdown', (event) => startHandle(event, button, handleSpecs[index]));
      handleNodes.push(button);
      handleSpecs.push(specs[index]);
      frame.append(button);
    }
    specs.forEach((spec, index) => {
      if (!stroke) return;
      handleSpecs[index] = spec;
      const node = handleNodes[index];
      node.style.left = `${stroke[spec.x] * 100}%`;
      node.style.top = `${stroke[spec.y] * 100}%`;
      const text = stroke.kind === 'rect' ? t('四角の角を動かす') : stroke.kind === 'marker' ? t('蛍光ペンの端を動かす') : t('矢印の端を動かす');
      node.setAttribute('aria-label', text);
      node.title = text;
    });
  };

  // つまみを、描き直したスタンプ（同じ z-index）の上に置き直す。掴んでいる間は触らない（DOM を動かすと掴みが外れる）
  const raiseHandles = () => {
    if (gesture) return;
    for (const node of handleNodes) frame.append(node);
  };

  const paintOverlay = () => {
    if (closed) return;
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (ctx && width > 0 && height > 0 && canvas.width > 0 && canvas.height > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
      const pending =
        drawing && (tool === 'arrow' || tool === 'rect' || tool === 'marker')
          ? { kind: tool, x1: drawing.x1, y1: drawing.y1, x2: drawing.x2, y2: drawing.y2, color: STROKE_COLOR[tool] }
          : null;
      layout = drawAnnotations(
        ctx,
        width,
        height,
        { strokes: shownStrokes(), marks: shownMarks(), blur: blurs, pending },
        { marks: 'numbered', blur: 'outline', minLinePx: window.devicePixelRatio, scale: canvas.width / width },
      );
      outlineSelected(width);
    }
    syncHandles();
    frame.querySelectorAll('.capture-blur-shade').forEach((node) => node.remove());
    const region = shadeOf();
    if (!region) return;
    const shade = el('div', 'capture-blur-shade');
    shade.style.left = `${region.x * 100}%`;
    shade.style.top = `${region.y * 100}%`;
    shade.style.width = `${region.w * 100}%`;
    shade.style.height = `${region.h * 100}%`;
    frame.append(shade);
    placeConfirm(); // 画面の大きさが変わったときも、確認を四角のそばに付け直す
  };

  const shadeOf = () => {
    if (blurPending) return blurPending;
    if (tool !== 'blur' || !drawing) return null;
    const x = drawing.x1 < drawing.x2 ? drawing.x1 : drawing.x2;
    const y = drawing.y1 < drawing.y2 ? drawing.y1 : drawing.y2;
    return { x, y, w: Math.abs(drawing.x2 - drawing.x1), h: Math.abs(drawing.y2 - drawing.y1) };
  };

  const paint = () => {
    if (closed) return; // 閉じる途中の確定からも呼ばれる
    paintOverlay();
    // 描き直しで欄を作り直しても、打ちかけの文字は引き継ぐ（同じスタンプ・同じ場所の欄のときだけ）
    const typedNote = frame.querySelector<HTMLElement>('.capture-stamp-note')?.dataset.mark === draft?.id ? frame.querySelector<HTMLInputElement>(STAMP_FIELD)?.value : undefined;
    // 文字を新しく置く欄と、書き直す欄は同じ形（片方しか出ない）。同じ場所・同じ線の欄のときだけ、打ちかけを引き継ぐ
    const inkKey = textAt ? `${textAt.x},${textAt.y}` : rewrite ? `rewrite:${rewrite.id}` : null;
    const typedInk = inkKey !== null && frame.querySelector<HTMLElement>('.capture-ink-note')?.dataset.at === inkKey ? frame.querySelector<HTMLInputElement>(INK_FIELD)?.value : undefined;
    frame.querySelectorAll('.capture-stamp, .capture-stamp-note, .capture-ink-note').forEach((node) => node.remove());
    const px = stampPx();
    const numbers = numberPieces(shownMarks(), shownStrokes());
    for (const mark of shownMarks()) {
      const stamp = stampOf(mark.stamp);
      const button = el('button', 'capture-stamp');
      button.type = 'button';
      button.style.left = `${mark.x * 100}%`;
      button.style.top = `${mark.y * 100}%`;
      button.style.width = `${px}px`;
      button.style.height = `${px}px`;
      const text = t('{0} {1}{2}。ドラッグで動かせます', { 0: stamp?.emoji ?? '•', 1: stamp?.label ?? 'スタンプ', 2: mark.note ? `：${mark.note}` : '' });
      const n = numberOf(numbers, 'mark', mark.id);
      button.setAttribute('aria-label', n === undefined ? text : t('印 {0}　{1}', { 0: n, 1: text }));
      button.title = text;
      button.dataset.mark = mark.id;
      button.addEventListener('pointerdown', (event) => startDrag(event, mark.id));
      button.addEventListener('click', () => {
        if (suppressClick) {
          suppressClick = false;
          return;
        }
        edit(mark.id, false);
      });
      button.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        stampMenu(event.clientX, event.clientY, mark.id);
      });
      frame.append(button);
    }
    if (draft) {
      const mark = marks.find((item) => item.id === draft?.id);
      if (mark) {
        const form = el('form', 'capture-stamp-note');
        form.dataset.mark = mark.id;
        form.style.left = `${mark.x * 100}%`;
        form.style.top = `${mark.y * 100}%`;
        form.style.marginTop = `${Math.round(px / 2) + 4}px`;
        const input = el('input');
        input.type = 'text';
        input.value = typedNote ?? mark.note;
        input.placeholder = t('一行（空でもよい）');
        input.maxLength = MARK_NOTE_MAX;
        input.setAttribute('aria-label', 'スタンプの一行');
        input.addEventListener('input', () => {
          const text = clipMarkNote(input.value);
          if (text !== input.value) input.value = text;
        });
        form.append(input);
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          commit(input.value);
        });
        frame.append(form);
        input.focus();
        if (typedNote === undefined) input.select();
      }
    }
    const inkAt = textAt ?? rewrite?.anchor ?? null;
    if (inkAt && inkKey !== null) {
      const target = rewrite ? strokes.find((stroke) => stroke.id === rewrite?.id) : undefined;
      const isNote = !!target && target.kind !== 'text'; // 矢印・四角のひとこと
      const form = el('form', 'capture-ink-note');
      form.dataset.at = inkKey;
      // 描き手が文字を置く位置（右の端では左へ寄せる）に合わせる。入力欄が画像からはみ出さないようにもする
      const natural = img.naturalWidth;
      const start = natural > 0 ? (textStartX(natural, inkAt.x * natural) / natural) * 100 : inkAt.x * 100;
      form.style.left = `min(${start}%, calc(100% - min(60%, 420px)))`;
      form.style.top = `${inkAt.y * 100}%`;
      const input = el('input');
      input.type = 'text';
      input.placeholder = isNote ? NOTE_PLACEHOLDER : t('一行');
      input.maxLength = STROKE_TEXT_MAX;
      input.setAttribute('aria-label', isNote ? t('ひとこと') : t('書き込む文字'));
      input.value = typedInk ?? target?.text ?? '';
      input.addEventListener('input', () => {
        const text = clipStrokeText(input.value);
        if (text !== input.value) input.value = text;
      });
      form.append(input);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (rewrite) commitRewrite(input.value);
        else commitText(input.value);
      });
      frame.append(form);
      input.focus();
      if (typedInk === undefined && rewrite) input.select();
    }
    raiseHandles();
    paintConfirm();
    paintTools();
  };

  // 確認を、囲んだ四角のそばに置く（四角の下。下に余りがなければ上）。上にも下にも収まらないときは、四角の内側の上端に置く
  //   （確認は影より上の z-index なので、内側でも押せる）。右へはみ出すときは、はみ出す分だけ左へ寄せる
  const placeConfirm = () => {
    const region = blurPending;
    if (!region || confirm.hidden) return;
    const gap = 6;
    const frameHeight = frame.clientHeight;
    const boxHeight = confirm.offsetHeight;
    let where: 'below' | 'above' | 'inside';
    if (region.y + region.h <= 0.8) {
      where = (region.y + region.h) * frameHeight + gap + boxHeight <= frameHeight ? 'below' : 'inside';
    } else {
      where = region.y * frameHeight >= boxHeight + gap ? 'above' : 'inside';
    }
    confirm.style.left = `${region.x * 100}%`;
    confirm.style.top = where === 'below' ? `calc(${(region.y + region.h) * 100}% + ${gap}px)` : where === 'inside' ? `calc(${region.y * 100}% + ${gap}px)` : '';
    confirm.style.bottom = where === 'above' ? `calc(${(1 - region.y) * 100}% + ${gap}px)` : '';
    const over = confirm.offsetLeft + confirm.offsetWidth - frame.clientWidth;
    if (over > 0) confirm.style.left = `max(0px, calc(${region.x * 100}% - ${over}px))`;
  };

  const paintConfirm = () => {
    confirm.hidden = !blurPending;
    for (const [id, button] of modeButtons) {
      button.classList.toggle('is-current', id === hideMode);
      button.setAttribute('aria-pressed', String(id === hideMode));
      button.disabled = hiding;
    }
    hide.disabled = hiding;
    cancelBlur.disabled = hiding;
    placeConfirm();
  };

  // 画像の大きさ（保存画像の px）に、画面の画素の数を合わせる。合わせたら描き直す
  const fitCanvas = (entry?: ResizeObserverEntry) => {
    if (closed || img.naturalWidth === 0) return;
    let width: number;
    let height: number;
    const device = entry?.devicePixelContentBoxSize?.[0];
    if (device) {
      width = device.inlineSize;
      height = device.blockSize;
    } else {
      const size = entry ? entry.contentRect : img.getBoundingClientRect();
      width = Math.round(size.width * window.devicePixelRatio);
      height = Math.round(size.height * window.devicePixelRatio);
    }
    sizeStamps();
    if (width < 1 || height < 1) return;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    paintOverlay();
  };

  const observer = new ResizeObserver((entries) => fitCanvas(entries[entries.length - 1]));
  try {
    observer.observe(img, { box: 'device-pixel-content-box' });
  } catch {
    observer.observe(img);
  }
  // 画面の倍率（dppx）が変わったときの保険。変わったら、新しい倍率で張り直す
  let dppx: MediaQueryList | null = null;
  const onDppx = () => {
    watchDppx();
    zoom.refresh(); // 100%・200% の幅は画面の倍率で決まるので入れ直す
    fitCanvas();
  };
  const watchDppx = () => {
    dppx?.removeEventListener('change', onDppx);
    dppx = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dppx.addEventListener('change', onDppx);
  };
  watchDppx();

  const commit = (text: string) => {
    if (!draft) return;
    const id = draft.id;
    const note = clipMarkNote(text);
    draft = null;
    if (!apply({ marks: marks.map((mark) => (mark.id === id ? { ...mark, note } : mark)) })) paint();
  };

  const commitDraft = () => {
    if (draft) commit(fieldValue(STAMP_FIELD));
  };

  const edit = (id: string, fresh: boolean) => {
    if (draft?.id === id) {
      frame.querySelector<HTMLInputElement>(STAMP_FIELD)?.focus();
      return;
    }
    commitDraft();
    commitInk();
    draft = { id, fresh };
    textAt = null;
    paint();
  };

  const remove = (id: string) => {
    if (draft && draft.id !== id) commitDraft(); // 別のスタンプの一行を書いている途中なら、先に確定する（置いたばかりの印を、この段に紛れさせない）
    if (draft?.id === id) {
      const fresh = draft.fresh;
      draft = null;
      if (fresh) {
        // 置いたばかりで、段にも送りにも入っていない
        marks = marks.filter((mark) => mark.id !== id);
        paint();
        return;
      }
    }
    if (!apply({ marks: marks.filter((mark) => mark.id !== id) })) paint();
  };

  // 置いたスタンプの種類を変える（一行を書いている途中なら、先に確定する）
  const changeKind = (id: string, kind: StampId) => {
    commitDraft(); // どのスタンプの一行でも、書いている途中なら先に確定する
    apply({ marks: marks.map((mark) => (mark.id === id ? { ...mark, stamp: kind } : mark)) });
  };

  const stampMenu = (x: number, y: number, id: string) => {
    const current = marks.find((mark) => mark.id === id)?.stamp;
    menuOf().open(x, y, [
      { section: t('このスタンプ') },
      {
        pills: STAMPS.map((stamp) => ({
          label: `${stamp.emoji} ${stamp.label}`,
          title: t('{0} {1} にする', { 0: stamp.emoji, 1: stamp.label }),
          current: stamp.id === current,
          close: true,
          run: () => changeKind(id, stamp.id),
        })),
      },
      { label: t('一行を書き直す'), run: () => edit(id, false) },
      { label: t('消す'), run: () => remove(id) },
    ]);
  };

  // 置くだけ。段にも送りにも入れない（一行を確定したときに、commit が積んで送る）
  const place = (stamp: StampId, x: number, y: number) => {
    if (marks.length >= MARK_LIMIT) {
      status.textContent = t('スタンプは {0} までです', { 0: MARK_LIMIT });
      return;
    }
    status.textContent = '';
    commitDraft();
    commitInk();
    const id = newMarkId();
    marks = [...marks, { id, stamp, x, y, note: '' }];
    draft = { id, fresh: true };
    textAt = null;
    paint();
  };

  const commitText = (text: string) => {
    if (!textAt) return;
    settleNudge();
    const line = clipStrokeText(text);
    const at = textAt;
    textAt = null;
    if (!line) {
      paint();
      return;
    }
    if (strokes.length >= STROKE_LIMIT) {
      status.textContent = t('線と文字は {0} までです', { 0: STROKE_LIMIT });
      paint();
      return;
    }
    status.textContent = '';
    apply({
      strokes: [...strokes, { id: newStrokeId(), kind: 'text', x1: at.x, y1: at.y, x2: at.x, y2: at.y, color: STROKE_COLOR.text, text: line }],
    });
  };

  // 書き直しの確定。文字は空にしたら要素ごと消す。矢印・四角のひとことは、空ならひとことを消して線は残す
  const commitRewrite = (text: string) => {
    const current = rewrite;
    if (!current) return;
    settleNudge();
    rewrite = null;
    const target = strokes.find((stroke) => stroke.id === current.id);
    if (!target) {
      paint();
      return;
    }
    const line = clipStrokeText(text).trim();
    status.textContent = '';
    if (target.kind === 'text' && !line) {
      if (selected === target.id) selected = null;
      if (!apply({ strokes: strokes.filter((stroke) => stroke.id !== target.id) })) paint();
      return;
    }
    if (!apply({ strokes: strokes.map((stroke) => (stroke.id === target.id ? { ...stroke, text: line } : stroke)) })) paint();
  };

  // 書きかけの文字（新しく置く欄・書き直す欄）を確定する。無ければ何もしない
  const commitInk = () => {
    if (!textAt && !rewrite) return;
    if (rewrite && !frame.querySelector(INK_FIELD)) {
      // 欄が出ていないのに書き直し中（起きないはず）。空の値で文字を消してしまわないよう、書き直しをやめるだけにする
      rewrite = null;
      paint();
      return;
    }
    const value = fieldValue(INK_FIELD);
    if (textAt) commitText(value);
    else commitRewrite(value);
  };

  // 文字・矢印・四角を選んで書き直す（文字は今の文字、矢印・四角はひとこと）。入力欄は描き手が置く位置のそばに出す
  const beginRewrite = (id: string) => {
    settleNudge();
    if (rewrite?.id === id) {
      frame.querySelector<HTMLInputElement>(INK_FIELD)?.focus();
      return;
    }
    commitDraft();
    commitInk();
    const stroke = strokes.find((item) => item.id === id);
    if (!stroke || stroke.kind === 'marker') return;
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    let anchor = { x: stroke.x1, y: stroke.y1 };
    if (stroke.kind !== 'text' && width > 0 && height > 0) {
      // 今ひとことが描いてあれば、その位置（描き手が返した矩形）。無ければ、描き手がひとことを置く位置と同じ式で見積もる
      const label = layout.boxes.find((box) => box.piece === 'stroke' && box.id === id)?.label;
      const style = annotationStyle(width, height);
      if (label) {
        anchor = { x: label.x / width, y: (label.y + style.text) / height };
      } else {
        const rect = stroke.kind === 'rect';
        const labelX = (rect ? Math.min(stroke.x1, stroke.x2) : stroke.x1) * width + (rect ? style.badge * NUMBER_DOT : 0) + style.pad;
        const top = (rect ? Math.min(stroke.y1, stroke.y2) : stroke.y1) * height;
        let baseline = top - style.pad;
        if (baseline - style.text < 0) baseline = top + style.text + style.pad;
        anchor = { x: labelX / width, y: baseline / height };
      }
    }
    textAt = null;
    selected = id;
    rewrite = { id, anchor };
    paint();
  };

  // 線・文字を消す（右クリック・Delete）。一つの操作として山に積む
  const removeStroke = (id: string) => {
    settleNudge();
    if (rewrite?.id === id) rewrite = null;
    commitDraft();
    commitInk();
    if (selected === id) selected = null;
    status.textContent = '';
    if (!apply({ strokes: strokes.filter((stroke) => stroke.id !== id) })) paint();
  };

  // 矢印キーで動かした分を、まとめて 1 回の操作として台帳へ入れる（無ければ false）
  const settleNudge = () => {
    if (nudgeTimer === null) return false;
    window.clearTimeout(nudgeTimer);
    nudgeTimer = null;
    const end = live;
    live = null;
    if (end && strokes.some((stroke) => stroke.id === end.id)) {
      if (!apply({ strokes: strokes.map((stroke) => (stroke.id === end.id ? end : stroke)) })) paintOverlay();
    } else {
      paintOverlay();
    }
    return true;
  };

  // 矢印キーで、選んでいる線を (dx, dy) だけ動かす。押すたびには山に積まず、止まってから（か keyup）まとめて入れる
  const nudge = (dx: number, dy: number) => {
    const id = selected;
    if (!id) return;
    const base = live?.id === id ? live : strokes.find((stroke) => stroke.id === id);
    if (!base) return;
    live = shifted(base, dx, dy);
    if (nudgeTimer !== null) window.clearTimeout(nudgeTimer);
    nudgeTimer = window.setTimeout(settleNudge, NUDGE_WAIT_MS);
    paintOverlay();
  };

  // 動かしている途中をやめる（Esc）。矢印キーの分も、台帳に入れずに捨てる
  const cancelMove = () => {
    if (nudgeTimer !== null) {
      window.clearTimeout(nudgeTimer);
      nudgeTimer = null;
    }
    gesture = null;
    live = null;
    paintOverlay();
  };

  // 隠す処理と保存の知らせを待つ間は、候補を消さない（失敗したとき、もう一度「隠す」を押せるように）
  const dropBlur = () => {
    if (hiding) return;
    blurPending = null;
    paintOverlay();
    paintConfirm();
  };

  const selectTool = (next: DrawTool) => {
    settleNudge();
    if (blurPending) dropBlur();
    commitInk();
    tool = next;
    paintTools();
  };

  const startDrag = (event: PointerEvent, id: string) => {
    if (event.button !== 0) return;
    settleNudge();
    const mark = marks.find((item) => item.id === id);
    if (!mark || draft?.id === id) return;
    event.preventDefault();
    // settleNudge が描き直してボタンを作り直したことがあるので、いまのボタンを引き直す
    const pointer = frame.querySelector<HTMLElement>(`.capture-stamp[data-mark="${CSS.escape(id)}"]`) ?? event.currentTarget;
    if (!(pointer instanceof HTMLElement)) return;
    capturePointer(pointer, event.pointerId);
    const origin = { x: event.clientX, y: event.clientY };
    let moved = false;
    const move = (next: PointerEvent) => {
      const box = img.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) return;
      if (Math.hypot(next.clientX - origin.x, next.clientY - origin.y) > 4) moved = true;
      if (!moved) return;
      const x = clampUnit((next.clientX - box.left) / box.width);
      const y = clampUnit((next.clientY - box.top) / box.height);
      dragging = { id, x, y };
      pointer.style.left = `${x * 100}%`;
      pointer.style.top = `${y * 100}%`;
      paintOverlay();
    };
    const release = () => {
      pointer.removeEventListener('pointermove', move);
      pointer.removeEventListener('pointerup', stop);
      pointer.removeEventListener('pointercancel', abort);
    };
    const stop = (next: PointerEvent) => {
      release();
      const end = dragging;
      dragging = null;
      if (!moved || !end) return;
      // 描き直しで押したボタンが入れ替わると click が来ないことがあるので、次の瞬間には必ず戻す
      suppressClick = true;
      window.setTimeout(() => (suppressClick = false), 0);
      next.preventDefault();
      next.stopPropagation();
      commitDraft();
      if (!apply({ marks: marks.map((item) => (item.id === id ? { ...item, x: end.x, y: end.y } : item)) })) paint();
    };
    const abort = () => {
      release();
      dragging = null;
      if (moved) paint();
    };
    pointer.addEventListener('pointermove', move);
    pointer.addEventListener('pointerup', stop);
    pointer.addEventListener('pointercancel', abort);
  };

  const pointOf = (event: { clientX: number; clientY: number }) => {
    const box = img.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return null;
    return {
      x: clampUnit((event.clientX - box.left) / box.width),
      y: clampUnit((event.clientY - box.top) / box.height),
    };
  };

  // 点（画像に対する割合）に当たる線・文字。上に描いたものから。隠した矩形は当てない（描き手が boxes に入れない）
  const hitAt = (point: { x: number; y: number }) => {
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    const shown = img.getBoundingClientRect().width;
    if (!width || !height || shown < 1) return null;
    return hitStroke(strokes, layout.boxes, width, height, point.x * width, point.y * height, (HIT_TOLERANCE_PX * width) / shown);
  };

  // 本体のドラッグで線を動かす。4 CSS px 動いたら平行移動を始め、離したら 1 回の操作として台帳へ。動かなければ選ぶだけ
  const startStrokeMove = (event: PointerEvent, id: string, point: { x: number; y: number }) => {
    event.preventDefault();
    commitDraft();
    commitInk();
    const base = strokes.find((stroke) => stroke.id === id);
    if (!base) return;
    selected = id;
    root.focus({ preventScroll: true }); // 押していた道具のボタンに Enter・矢印を取られないように
    paintOverlay();
    const token = {};
    gesture = token;
    capturePointer(img, event.pointerId);
    const origin = { x: event.clientX, y: event.clientY };
    let moved = false;
    const move = (next: PointerEvent) => {
      if (gesture !== token) return;
      const at = pointOf(next);
      if (!at) return;
      if (!moved) {
        if (Math.hypot(next.clientX - origin.x, next.clientY - origin.y) <= MOVE_START_PX) return;
        moved = true;
      }
      live = shifted(base, at.x - point.x, at.y - point.y);
      paintOverlay();
    };
    const release = () => {
      img.removeEventListener('pointermove', move);
      img.removeEventListener('pointerup', stop);
      img.removeEventListener('pointercancel', abort);
    };
    const stop = () => {
      release();
      if (gesture !== token) return;
      gesture = null;
      const end = live;
      live = null;
      if (!moved || !end) return;
      if (!apply({ strokes: strokes.map((stroke) => (stroke.id === id ? end : stroke)) })) paintOverlay();
    };
    const abort = () => {
      release();
      if (gesture !== token) return;
      gesture = null;
      live = null;
      paintOverlay();
    };
    img.addEventListener('pointermove', move);
    img.addEventListener('pointerup', stop);
    img.addEventListener('pointercancel', abort);
  };

  // つまみのドラッグで、端点（四角は角）を動かす。離したとき長さ（四角は幅か高さ）が STROKE_MIN 未満なら、捨てて元に戻す
  const startHandle = (event: PointerEvent, node: HTMLElement, spec: HandleSpec) => {
    if (event.button !== 0 || hiding || blurPending) return;
    event.preventDefault();
    event.stopPropagation();
    settleNudge();
    commitDraft();
    commitInk();
    const base = selected ? strokes.find((stroke) => stroke.id === selected) : undefined;
    if (!base) return;
    const token = {};
    gesture = token;
    capturePointer(node, event.pointerId);
    const move = (next: PointerEvent) => {
      if (gesture !== token) return;
      const at = pointOf(next);
      if (!at) return;
      const moved: CaptureStroke = { ...base };
      moved[spec.x] = at.x;
      moved[spec.y] = at.y;
      live = moved;
      paintOverlay();
    };
    const release = () => {
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', stop);
      node.removeEventListener('pointercancel', abort);
    };
    const stop = () => {
      release();
      if (gesture !== token) return;
      gesture = null;
      const end = live;
      live = null;
      if (!end) return;
      const dx = end.x2 - end.x1;
      const dy = end.y2 - end.y1;
      const tooShort = end.kind === 'rect' ? Math.abs(dx) < STROKE_MIN || Math.abs(dy) < STROKE_MIN : Math.hypot(dx, dy) < STROKE_MIN;
      if (tooShort || !apply({ strokes: strokes.map((stroke) => (stroke.id === base.id ? end : stroke)) })) paintOverlay();
    };
    const abort = () => {
      release();
      if (gesture !== token) return;
      gesture = null;
      live = null;
      paintOverlay();
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', stop);
    node.addEventListener('pointercancel', abort);
  };

  const beginText = (point: { x: number; y: number }) => {
    commitDraft();
    commitInk();
    textAt = point;
    paint();
  };

  const finishDraw = (x2: number, y2: number) => {
    const current = drawing;
    drawing = null;
    if (!current) return;
    current.x2 = x2;
    current.y2 = y2;
    const dx = current.x2 - current.x1;
    const dy = current.y2 - current.y1;
    if (Math.hypot(dx, dy) < 0.012) {
      paintOverlay();
      return;
    }
    if (tool === 'blur') {
      const x = current.x1 < current.x2 ? current.x1 : current.x2;
      const y = current.y1 < current.y2 ? current.y1 : current.y2;
      const w = Math.abs(dx);
      const h = Math.abs(dy);
      if (w < 0.02 || h < 0.02) {
        status.textContent = t('もう少し大きく囲んでください');
        paintOverlay();
        return;
      }
      if (blurs.length >= BLUR_LIMIT) {
        status.textContent = t('隠す場所は {0} までです', { 0: BLUR_LIMIT });
        paintOverlay();
        return;
      }
      status.textContent = '';
      blurPending = { x, y, w, h };
      hideMode = HIDE_MODE_DEFAULT; // 開くたびに塗りつぶし
      paint();
      // 拡大して見ているときは、確認の小窓が画面の外にならないよう、できたときに 1 回だけ見える所へ寄せる（描き直しのたびには呼ばない）
      if (zoomLevel !== 'fit') confirm.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return;
    }
    if (tool === 'text' || tool === 'stamp') return;
    if (strokes.length >= STROKE_LIMIT) {
      status.textContent = t('線と文字は {0} までです', { 0: STROKE_LIMIT });
      paintOverlay();
      return;
    }
    status.textContent = '';
    const kind = tool;
    apply({
      strokes: [...strokes, { id: newStrokeId(), kind, x1: current.x1, y1: current.y1, x2: current.x2, y2: current.y2, color: STROKE_COLOR[kind], text: '' }],
    });
  };

  img.addEventListener('pointerdown', (event) => {
    settleNudge(); // 矢印キーで動かした分は、ここまでで 1 回の操作にする
    if (event.button !== 0 || hiding || blurPending) return;
    const point = pointOf(event);
    if (!point) return;
    // どの道具でも、線・文字に当たれば選ぶ（動かせる）。「隠す」の道具と Shift は当てず、新しく引く（蛍光ペンの上などに引く逃げ道）
    if (tool !== 'blur' && !event.shiftKey) {
      const hit = hitAt(point);
      if (hit) {
        startStrokeMove(event, hit.id, point);
        return;
      }
      if (selected) {
        selected = null;
        paintOverlay();
      }
    }
    if (tool === 'text') {
      event.preventDefault();
      beginText(point);
      return;
    }
    if (tool === 'stamp') {
      event.preventDefault();
      place(stampKind, point.x, point.y);
      return;
    }
    event.preventDefault();
    commitDraft();
    commitInk();
    drawing = { x1: point.x, y1: point.y, x2: point.x, y2: point.y };
    capturePointer(img, event.pointerId);
    const move = (next: PointerEvent) => {
      const at = pointOf(next);
      if (!at || !drawing) return;
      drawing.x2 = at.x;
      drawing.y2 = at.y;
      paintOverlay();
    };
    const release = () => {
      img.removeEventListener('pointermove', move);
      img.removeEventListener('pointerup', stop);
      img.removeEventListener('pointercancel', abort);
    };
    const stop = (next: PointerEvent) => {
      release();
      const at = pointOf(next);
      finishDraw(at?.x ?? drawing?.x2 ?? point.x, at?.y ?? drawing?.y2 ?? point.y);
    };
    const abort = () => {
      release();
      drawing = null;
      paintOverlay();
    };
    img.addEventListener('pointermove', move);
    img.addEventListener('pointerup', stop);
    img.addEventListener('pointercancel', abort);
  });

  // ダブルクリック：文字は今の文字を、矢印・四角はひとことを書き直す（蛍光ペンは何もしない）
  img.addEventListener('dblclick', (event) => {
    if (hiding || blurPending || tool === 'blur' || event.shiftKey) return;
    const point = pointOf(event);
    const hit = point ? hitAt(point) : null;
    if (!hit || hit.kind === 'marker') return;
    event.preventDefault();
    beginRewrite(hit.id);
  });

  // 右クリックの「この線」。矢印・四角はひとこと、文字は書き直し、どれも消せる
  const strokeMenu = (x: number, y: number, stroke: CaptureStroke) => {
    const entries: MenuEntry[] = [{ section: t('この線') }];
    if (stroke.kind === 'text') entries.push({ label: t('書き直す'), run: () => beginRewrite(stroke.id) });
    else if (stroke.kind !== 'marker') entries.push({ label: stroke.text ? t('ひとことを書き直す') : t('ひとことを書く'), run: () => beginRewrite(stroke.id) });
    entries.push({ label: t('消す'), run: () => removeStroke(stroke.id) });
    menuOf().open(x, y, entries);
  };

  frame.addEventListener('contextmenu', (event) => {
    if (!(event.target instanceof Node) || event.target === frame.querySelector('input')) return;
    if (event.target instanceof HTMLElement && event.target.closest('.capture-handle')) {
      event.preventDefault(); // つまみの右クリックで、ブラウザのメニューを出さない
      return;
    }
    if (event.target instanceof HTMLElement && event.target.closest('.capture-stamp, .capture-ink-note, .capture-stamp-note, .capture-hide-confirm')) return;
    const box = img.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return;
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    if (x < 0 || y < 0 || x > 1 || y > 1) return;
    event.preventDefault();
    if (blurPending || hiding) return; // 隠すの確認のあいだは、スタンプを置くメニューを出さない
    settleNudge();
    const hit = hitAt({ x, y });
    if (hit) {
      strokeMenu(event.clientX, event.clientY, hit);
      return;
    }
    menuOf().open(event.clientX, event.clientY, [
      { section: t('ここにスタンプ') },
      {
        pills: STAMPS.map((stamp) => ({
          label: stamp.label,
          title: `${stamp.emoji} ${stamp.label}`,
          close: true,
          run: () => place(stamp.id, clampUnit(x), clampUnit(y)),
        })),
      },
    ]);
  });

  // Esc。線を引いている途中 → スタンプ・線を動かしている途中（やめるだけ）→ 隠す候補 → 文字の入力・書き直し → スタンプの一行
  //   → 選んでいる要素（外すだけ）→ 隠すの保存待ち（閉じない）→ 閉じる（閉じるボタンと同じ）
  const onEscape = () => {
    if (drawing) {
      drawing = null;
      paintOverlay();
      return;
    }
    if (dragging) {
      dragging = null;
      paint();
      return;
    }
    if (gesture || live) {
      cancelMove(); // つまみ・本体のドラッグ・矢印キーで動かしている途中。元の位置のまま
      return;
    }
    if (blurPending && !hiding) {
      dropBlur();
      return;
    }
    if (textAt || rewrite) {
      textAt = null;
      rewrite = null;
      paint();
      return;
    }
    if (draft) {
      if (draft.fresh) {
        commit(''); // 一行なしで確定。取りやめは「戻す」で行う
      } else {
        draft = null;
        paint();
      }
      return;
    }
    if (selected) {
      selected = null;
      paint();
      return;
    }
    // 隠す・取り消すの保存を待っている間は、Esc では閉じない（うっかり閉じると、保存できたかが分からなくなる）
    if (hiding) {
      status.textContent = t('{0}…（保存を待っています）。閉じるときは「閉じる」を押してください', { 0: hideWait?.kind === 'unhide' ? '取り消しています' : '隠しています' });
      return;
    }
    closeView();
  };

  // 画面全体のキー（capture 相）。日本語変換中は何もしない。入力欄の中は Esc だけ扱う
  const onKey = (event: KeyboardEvent) => {
    if (closed || event.isComposing || event.keyCode === 229) return;
    const target = event.target;
    // この画面の外（上に重なった Grok の小窓など）に向いたキーは、その持ち主に任せる
    if (target instanceof Node && target !== document.body && target !== document.documentElement && !root.contains(target)) return;
    const inField = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    if (event.key === 'Escape') {
      if (menu?.isOpen) return; // 右クリックのメニューが開いているときは、メニューを閉じるのが先
      event.preventDefault();
      event.stopPropagation();
      onEscape();
      return;
    }
    if (inField) return;
    if (event.ctrlKey || event.metaKey) {
      if (event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (key === 'y' && !event.shiftKey) {
        event.preventDefault();
        redo();
      } else if (key === '0') {
        event.preventDefault();
        zoom.set('fit');
      } else if (key === '=' || key === ';' || key === '+') {
        event.preventDefault();
        zoom.step(1);
      } else if (key === '-') {
        event.preventDefault();
        zoom.step(-1);
      }
      return;
    }
    if (event.altKey) return;
    // 選んでいる線・文字があれば、Delete・Backspace で消す。Enter で書き直す。矢印キーで動かす（Shift で大きく）
    if (selected && !hiding && !blurPending && !gesture && !drawing && !dragging && selectedKey(event, target)) return;
    if (event.shiftKey || drawing) return;
    const item = /^[1-9]$/.test(event.key) ? TOOLS[Number(event.key) - 1] : undefined;
    if (item) {
      event.preventDefault();
      selectTool(item.id);
    }
  };
  window.addEventListener('keydown', onKey, true);

  // 選んでいる要素へのキー。扱ったら true
  const selectedKey = (event: KeyboardEvent, target: EventTarget | null) => {
    const id = selected;
    if (!id) return false;
    const stroke = strokes.find((item) => item.id === id);
    if (!stroke) return false;
    switch (event.key) {
      case 'Delete':
      case 'Backspace':
        if (event.shiftKey) return false;
        event.preventDefault();
        removeStroke(id);
        return true;
      case 'Enter':
        // ボタンに合っているときは、そのボタンの Enter（押す）に任せる
        if (event.shiftKey || stroke.kind === 'marker' || target instanceof HTMLButtonElement) return false;
        event.preventDefault();
        beginRewrite(id);
        return true;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        const step = event.shiftKey ? NUDGE_BIG : NUDGE_STEP;
        event.preventDefault();
        nudge(event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0);
        return true;
      }
      default:
        return false;
    }
  };

  // 矢印キーを離したら、動かした分をすぐ 1 回の操作にする
  const onKeyUp = (event: KeyboardEvent) => {
    if (!closed && event.key.startsWith('Arrow')) settleNudge();
  };
  window.addEventListener('keyup', onKeyUp, true);

  // どの閉じ方でも、入力の途中の一行と文字は確定して送る（closed にする前に、欄の値を読む）
  const finish = () => {
    if (closed) return;
    settleNudge(); // 矢印キーで動かした分は、閉じる前に台帳へ
    const draftText = draft ? fieldValue(STAMP_FIELD) : '';
    const inkText = textAt || rewrite ? fieldValue(INK_FIELD) : '';
    closed = true;
    if (draft) commit(draftText);
    if (textAt) commitText(inkText);
    else if (rewrite) commitRewrite(inkText);
    takeHideWait();
    menuOf().close();
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKeyUp, true);
    zoom.dispose();
    observer.disconnect();
    dppx?.removeEventListener('change', onDppx);
    dppx = null;
    root.remove();
    if (opened?.close === finish) opened = null;
  };
  opened = {
    id: payload.id,
    close: finish,
    refresh: (image, blur, undo) => refreshView(image, blur, undo),
    forgetUndo: () => forgetUndo(),
    settleHide: (seq, ok, reason) => settleHide(seq, ok, reason),
  };

  const closeView = () => {
    finish();
    hooks.onClose();
  };

  // 隠した・取り消した知らせ（待っていてもいなくても、右のカードから隠したときも）。画像と隠した場所と取り消せるかを差し替える
  //   blurPending（候補）と待ちは触らない。ただし、待ちが無い（期限切れのあと）のに、候補と同じ矩形が新しく入ってきたときは、
  //   遅れて隠せていたのだから、候補を捨てる（残すと、もう一度押して同じ矩形が二重に増える）
  const refreshView = (image: string, blur: CaptureBlur[], undo: boolean) => {
    if (closed) return;
    blurs = blur.map((region) => ({ ...region }));
    undoable = undo;
    if (img.src !== image) img.src = image; // 読み込めたら load で描き直す
    const pending = blurPending;
    if (pending && !hideWait && blurs.some((region) => sameRect(region, pending))) {
      blurPending = null;
      status.textContent = t('隠せていました（右のカードでも確かめられます）');
      paintOverlay();
      paintConfirm();
    } else {
      paintOverlay();
    }
    paintTools();
  };

  // 別の撮影を隠した・取り消した知らせ。右の店の取り消しの写しは 1 枠なので、この撮影の「隠すのを取り消す」は使えなくなる
  const forgetUndo = () => {
    if (closed) return;
    undoable = false;
    paintTools();
  };

  // 隠す・取り消すの頼みを出す（seq を進め、返事を待つ）
  const startHide = (kind: 'hide' | 'unhide', message: string, ask: (seq: number) => void) => {
    hideSeq += 1;
    const seq = hideSeq;
    takeHideWait();
    hiding = true;
    hideWait = { seq, kind, mode: hideMode, timer: window.setTimeout(expireHide, BLUR_SAVE_WAIT_MS) };
    status.textContent = message;
    paintConfirm();
    paintTools();
    ask(seq);
  };

  // 右の返事が来た。ここで初めて「隠しました」と言う。失敗なら候補を残す（もう一度「隠す」を押せる）
  const settleHide = (seq: number, ok: boolean, reason?: string) => {
    const wait = hideWait;
    if (!wait || wait.seq !== seq || closed) return;
    takeHideWait();
    hiding = false;
    // 成功でも reason: 'index' が付くことがある（画像は直したが、一覧の保存に失敗した）
    const unsaved = ok && reason === 'index' ? INDEX_NOT_SAVED : '';
    if (!ok) {
      status.textContent = hideFailText(reason, wait.kind);
    } else if (wait.kind === 'unhide') {
      status.textContent = t('隠すのを取り消しました{0}', { 0: unsaved });
    } else {
      blurPending = null;
      const label = HIDE_MODES.find((item) => item.id === wait.mode)?.label ?? '';
      status.textContent = t('隠しました（{0}）。右のカードと盤面の画像も、この部分は読めません。重なる読んだ文字も「（隠した）」にしました。「隠すのを取り消す」で、この画面を閉じるまでは戻せます{1}', { 0: label, 1: unsaved });
    }
    paint();
  };

  // 返事が来ないまま上限を過ぎた。候補は残す（右がいつもファイルの最新の画像に塗るので、続けて押しても前の画素は戻らない）
  const expireHide = () => {
    if (!takeHideWait() || closed) return;
    hiding = false;
    status.textContent = t('保存できたか分かりません。右のカードで確かめてください');
    paint();
  };

  hide.addEventListener('click', () => {
    const region = blurPending;
    if (!region || hiding) return;
    startHide('hide', t('隠しています…（保存を待っています）'), (seq) => hooks.onHide([{ x: region.x, y: region.y, w: region.w, h: region.h }], hideMode, seq));
  });
  cancelBlur.addEventListener('click', () => {
    if (hiding) return;
    dropBlur();
    status.textContent = '';
  });

  // Ctrl+Z には結ばない（戻す・やり直すの山は、スタンプ・線の分だけ）
  const unhide = () => {
    if (!undoable || hiding) return;
    startHide('unhide', t('取り消しています…（保存を待っています）'), (seq) => hooks.onUnhide(seq));
  };

  close.addEventListener('click', closeView);

  img.addEventListener('load', () => {
    fitCanvas();
    paint();
  });
  img.src = payload.image;
  paintTools();
  root.focus();
}

// ポインタを掴む。掴めない（すでに離れたポインタなど）ときも、線やドラッグは続ける
function capturePointer(node: Element, pointerId: number) {
  try {
    node.setPointerCapture(pointerId);
  } catch {
    // 掴めなくても pointermove・pointerup は要素の上で届く
  }
}

function clampUnit(value: number) {
  const clamped = value < 0 ? 0 : value > 1 ? 1 : value;
  return Math.round(clamped * 10000) / 10000;
}
