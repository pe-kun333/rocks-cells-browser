// 画像に書き足す面（依頼の小窓 v2・R7b・D15。docs/bot-cells/plan-request-v2.md §6 R7b、見本 mock-ask-grok.html の ②）
//   ・小窓の画像のカード（六角スクショ・クリップボードの画像の候補）の「書き足す →」から、読む画面の重ね窓に開く（reader/ask.ts）。
//     開いているあいだ小窓は隠すだけ（閉じない。書きかけはそのまま）。「小窓に戻る（画像を付けて）」で onDone、「やめる」・Esc で onCancel
//   ・道具：書き足す（丸・矢印・四角〔箱〕・番号・文字）・隠す（黒塗り・ぼかし）・指さすだけ（● ここ）。一つ戻す（Ctrl+Z）・全部消す（一つ戻すで戻せる）。
//     丸・矢印・四角・黒塗り・ぼかしは引いて描く（押しただけなら決まった大きさ）。番号・文字・指さしは押した所に。
//     文字は押した所に出る小さな入力欄に書く（prompt は使わない。Enter で決める・Esc でやめる）
//   ・四角を引くたびに「箱ごとに問い」の行が増え、箱の角に番号を焼き込む（小窓に戻ると、小窓が依頼文の末尾に「①の箱：…」を並べる）
//   ・指さすだけ：押した一点の周りの小さな切り抜きを「指さした所」に並べる（画面だけ。送る画像には点と点線の枠を焼く）。
//     小窓に戻ると、小窓が依頼文に「ここは何？」を入れる
//   ・描くのは canvas。下の層（base）に元の画像と隠す印（黒塗り・ぼかし）、上の層（ink）にほかの印。印は一覧（marks）で持ち、
//     戻るときに 2 つの層を 1 枚の PNG に焼く。ぼかしは filter: blur でその領域だけ描き直し、黒塗りは塗りつぶし（黒塗りはいつもぼかしの上）
//   ・渡す画像：書き足した版（既定）か元の画像（印なし・隠しなし。描いた印は持っておき、書き足した版に戻せば続きから）
//   ・隠す候補（依頼の小窓 v2・R7c・D15）：開いたら、元の画像を JPEG にして findHints（bot-image-hints.ts。Windows の文字読み取りは C++ の中だけ）に渡し、
//     メール・電話番号・鍵らしき文字の行に、hints の層で点線の枠と「…らしき文字。隠しますか？［黒塗りで隠す］［そのまま］」を出す。隠すかは本人が押す。
//     「黒塗りで隠す」は黒塗りの道具と同じ印（hide）を行の矩形に足す。黒塗り（かぼかし）の印が枠をほぼ覆えば、その枠は消える。
//     「そのまま」も一つ戻すで戻せる（kept。戻す元に印と一緒に残す）。全部消すと、隠した・そのままの決めごとも消えて枠が戻る。
//     「元の画像」を選ぶと隠しは付かないので枠が戻り、「黒塗りで隠す」は押せない。行の文字（鍵の生の値も）はこの面に来ない（種類と矩形だけ）。
//     読み取りの無いビルド・日本語の認識データ無しでは、枠を出さず「読み取りが使えません」と小さく出す。同じ画像の結果は覚えておき、開き直しても読み直さない
//   ・焼き込む色は CSS 変数（sheets.css の .bie の --bie-*。送る画像の色なので、画面の明るさでは変えない）。動き（アニメーション）は使わない。文は textContent
//   ・DOM と canvas だけ。import は util と型だけ（画像を外へ出さない。写しの保存・クリップボードは小窓の側）
import { clamp, el } from '../util';

export type ImageTool = 'circle' | 'arrow' | 'box' | 'num' | 'text' | 'black' | 'blur' | 'point';
export type ImageEditVersion = 'annotated' | 'original'; // 書き足した版／元の画像

// 印 1 つ（座標は描く面の画素）。丸・四角・黒塗り・ぼかし：x,y が左上で w,h が大きさ。矢印：x,y が根元で w,h が先までの差。
//   番号・文字・指さし：x,y がその点（w,h は 0）。text：文字の印　question：箱の問い
export interface ImageMark {
  kind: ImageTool;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  question?: string;
}

export type ImageEditCounts = Record<ImageTool, number>;

// 箱ごとの問い（n は箱の番号。1 から）
export interface ImageEditBox {
  n: number;
  question: string;
}

// 前に書き足した分（もう一度開いたとき、続きから描ける）。kept：隠す候補で「そのまま」にした候補の番号（R7c）
export interface ImageEditPrior {
  marks: ImageMark[];
  version: ImageEditVersion;
  kept?: number[];
}

// 隠す候補（R7c）：種類（鍵らしき文字・メール・電話番号）と、行の矩形（画像に対する 0〜1）。行の文字は持たない
export type ImageHintKind = 'secret' | 'mail' | 'phone';
export interface ImageHintFound {
  kind: ImageHintKind;
  x: number;
  y: number;
  w: number;
  h: number;
}
// 候補を探した結果。読めないときはわけ（unavailable：読み取りの無いビルド　noJapanese：日本語の認識データ無し　busy：ほかで読んでいる）
export type ImageHintsOutcome = { ok: true; hints: ImageHintFound[] } | { ok: false; why: 'unavailable' | 'noJapanese' | 'busy' | 'failed' };
// 候補の数：見つけた・隠した（黒塗りかぼかしの印が覆う）・そのまま。残り（found - hidden - kept）が未決
export interface ImageHintCount {
  found: number;
  hidden: number;
  kept: number;
}

// 戻ったときに小窓へ渡すもの
export interface ImageEditResult extends ImageEditPrior {
  image: string; // 渡す画像（書き足した版の PNG の data URL。元の画像を選んだ・何も描いていないなら original のまま）
  original: string; // 元の画像（手元に残す。もう一度書き足すときの元）
  boxes: ImageEditBox[]; // 箱ごとの問い（元の画像なら空）
  points: number; // 指さした所の数（元の画像なら 0）
  counts: ImageEditCounts; // 印の数（元の画像なら全部 0）
  hints: ImageHintCount; // 隠す候補の数（R7c。探せなかったときは全部 0。元の画像なら隠したは 0）
}

export interface ImageEditHooks {
  onDone(result: ImageEditResult): void;
  onCancel(): void;
}

const TOOLS: { tool: ImageTool; label: string; title: string }[] = [
  { tool: 'circle', label: '○ 丸', title: '引いて丸で囲む（押しただけなら決まった大きさ）' },
  { tool: 'arrow', label: '→ 矢印', title: '根元から先へ引く（押しただけなら、押した所を指す矢印）' },
  { tool: 'box', label: '□ 四角（箱）', title: '引いて四角で囲む。箱ごとに問いの行が増え、角に番号が入る（9 つまで）' },
  { tool: 'num', label: '① 番号', title: '押した所に番号（1, 2, 3…）' },
  { tool: 'text', label: 'あ 文字', title: '押した所に短い文字（小さな入力欄に書いて Enter）' },
  { tool: 'black', label: '■ 黒塗り', title: '引いた所を黒く塗る（読めなくなる）' },
  { tool: 'blur', label: '▒ ぼかし', title: '引いた所をぼかす（薄いと読めることがあるので、確かに隠すなら黒塗り）' },
  { tool: 'point', label: '● ここ', title: '一点を押すだけ。周りの小さな切り抜きが並び、小窓に戻ると依頼文に「ここは何？」が入る' },
];
const TOOL_NAME: Record<ImageTool, string> = { circle: '丸', arrow: '矢印', box: '箱', num: '番号', text: '文字', black: '黒塗り', blur: 'ぼかし', point: '指さし' };
const CIRCLED = '①②③④⑤⑥⑦⑧⑨';
const MAX_SIDE = 2400; // 描く面の長い辺の上限（大きい画像は縮めて描く）
const MAX_MARKS = 60;
const MAX_BOXES = 9; // 箱の番号は ①〜⑨
const MAX_POINTS = 9;
const MAX_NUMS = 20;
const TEXT_MAX = 40; // 文字の印の字数
const QUESTION_MAX = 200; // 箱の問いの字数
const CROP_PX = 56; // 指さした所の切り抜きの大きさ（画面の px）
const MOVE_PX = 6; // 押してからこれより動かなければ「押しただけ」

const HINT_LABEL: Record<ImageHintKind, string> = { secret: '鍵らしき文字', mail: 'メールらしき文字', phone: '電話番号らしき文字' };
const HINT_PAD = 0.25; // 「黒塗りで隠す」で行の矩形を広げる割合（行の高さに対して。文字の読み取りの矩形は字にぴったりなので）
const HINT_COVER = 0.9; // 隠す印が候補の矩形をこれだけ覆えば、隠したとみなす
const HINT_JPEG_MAX = 1_900_000; // 読み取りに渡す JPEG の data URL の字数の上限（C++ の JpegPayload は 200 万字まで）

const isHide = (kind: ImageTool) => kind === 'black' || kind === 'blur';

// 隠す候補 1 つ（描く面の画素。id は読み取りの結果の中の順）
interface ImageHint extends ImageHintFound {
  id: number;
}

// 一つ戻すの元：印の一覧と「そのまま」にした候補（どちらも置き換えるだけで、中は書き換えない）
interface EditSnapshot {
  marks: ImageMark[];
  kept: number[];
}

type HintState = 'off' | 'reading' | 'ready' | 'unavailable' | 'noJapanese' | 'busy' | 'failed';

// 同じ画像か（読み取りの結果を覚えておく鍵。画像そのものは覚えない）
const imageKey = (dataUrl: string) => `${dataUrl.length}:${dataUrl.slice(-96)}`;

// 印 mark が矩形 hint をどれだけ覆うか（0〜1）
function coverOf(mark: ImageMark, hint: ImageHintFound): number {
  const w = Math.min(mark.x + mark.w, hint.x + hint.w) - Math.max(mark.x, hint.x);
  const h = Math.min(mark.y + mark.h, hint.y + hint.h) - Math.max(mark.y, hint.y);
  return w > 0 && h > 0 ? (w * h) / Math.max(1, hint.w * hint.h) : 0;
}

export function countMarks(marks: readonly ImageMark[]): ImageEditCounts {
  const counts: ImageEditCounts = { circle: 0, arrow: 0, box: 0, num: 0, text: 0, black: 0, blur: 0, point: 0 };
  for (const mark of marks) counts[mark.kind]++;
  return counts;
}

// 一行の短い文にする（制御文字と改行を空白に。字数で切る）
const oneLine = (text: string, max: number) =>
  [...String(text ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, max).join('');

// data URL の画像を読む（decode() は描いていない面で終わらないことがあるので、load を待つ）
function loadImage(dataUrl: string): Promise<HTMLImageElement | null> {
  if (!/^data:image\//.test(dataUrl)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0 && img.naturalHeight > 0 ? img : null);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

export class BotImageEdit {
  readonly element = el('section', 'bie');
  readonly hints = el('div', 'bie-hints'); // 隠す候補の枠の層（R7c。画像の上に重ねる。枠の位置は size に対する % で置く）
  private readonly stage = el('div', 'bie-stage');
  private readonly frame = el('div', 'bie-frame'); // 画像の大きさの枠（2 つの層・候補の枠・文字の入力欄を重ねる）
  private readonly base = el('canvas', 'bie-base');
  private readonly ink = el('canvas', 'bie-ink');
  private readonly textInput = el('input', 'bie-text-input');
  private readonly toolButtons = new Map<ImageTool, HTMLButtonElement>();
  private readonly undoButton = el('button', 'brf-button', '一つ戻す');
  private readonly clearButton = el('button', 'brf-button', '全部消す');
  private readonly boxList = el('ol', 'bie-boxes');
  private readonly boxNote = el('p', 'brf-note', '四角（箱）を引くと、ここに問いの行が増えます。番号は箱の角に焼き込まれ、小窓に戻ると依頼文の末尾に「①の箱：…」と並びます');
  private readonly crops = el('div', 'bie-crops');
  private readonly cropNote = el('p', 'brf-note', '「● ここ」で一点を押すと、その周りの小さな切り抜きが並び、小窓に戻ると依頼文に「ここは何？」が入ります。丸を描かず、文も書かない頼み方です');
  private readonly annotatedRadio = el('input', 'bie-radio');
  private readonly originalRadio = el('input', 'bie-radio');
  private readonly summary = el('p', 'bie-sum');
  private readonly hintLine = el('p', 'bie-hint-line'); // 隠す候補のいま（R7c）
  private readonly hintText = el('span', '');
  private readonly hintRetry = el('button', 'brf-link', '探し直す');
  private readonly adds = el('p', 'brf-note');
  private readonly status = el('p', 'bie-status');
  private readonly doneButton = el('button', 'brf-button brf-primary', '小窓に戻る（画像を付けて）');
  private readonly cancelButton = el('button', 'brf-button', 'やめる');
  private hooks: ImageEditHooks | null = null;
  private img: HTMLImageElement | null = null;
  private original = '';
  private marks: ImageMark[] = [];
  private kept: number[] = []; // 隠す候補で「そのまま」にした候補の id（R7c）
  private history: EditSnapshot[] = []; // 一つ戻す（変える前の印と「そのまま」。全部消すも 1 つ）
  private found: ImageHint[] = []; // 隠す候補（R7c）
  private hintState: HintState = 'off';
  private hintCache: { key: string; found: ImageHintFound[] } | null = null; // 同じ画像の読み取りの結果（種類と矩形だけ）
  private tool: ImageTool = 'circle';
  private version: ImageEditVersion = 'annotated';
  private drag: { mark: ImageMark; startX: number; startY: number; pointerId: number; moved: boolean } | null = null;
  private textAt: { x: number; y: number } | null = null; // 文字の入力欄を出している点
  private loads = 0; // 開き直した・閉じたら、読み終えた古い画像を捨てる
  private changed = false; // 開いてから印を変えた（Esc を 2 回で捨てる）
  private escArmed = false;
  private readonly resize = new ResizeObserver(() => this.fitFrame()); // 置き場の大きさが変わったら（窓・横の欄の伸び縮み）枠を合わせ直す

  // findHints：隠す候補を探す（R7c。bot-image-hints.ts の readImageHints。無ければ探さない）
  constructor(private readonly findHints?: (jpeg: string) => Promise<ImageHintsOutcome>) {
    this.element.hidden = true;
    this.element.tabIndex = -1;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-label', '画像に書き足す');

    // 頭
    const head = el('div', 'bie-head');
    head.append(el('h2', 'bie-title', '画像に書き足す'), el('span', 'brf-note', '描いた画像はこの画面の中だけで作ります（外へは、小窓の ① で貼ったときだけ出ます）'));

    // 道具の列：書き足す・隠す・指さすだけ・一つ戻す・全部消す
    const tools = el('div', 'bie-tools');
    tools.setAttribute('role', 'toolbar');
    tools.setAttribute('aria-label', '書き足す道具');
    const group = (label: string, names: ImageTool[]) => {
      tools.append(el('span', 'bie-tools-label', label));
      for (const name of names) {
        const def = TOOLS.find((t) => t.tool === name);
        if (!def) continue;
        const button = el('button', `bie-tool${name === 'point' ? ' bie-tool-point' : ''}`, def.label);
        button.type = 'button';
        button.title = def.title;
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => this.setTool(name));
        this.toolButtons.set(name, button);
        tools.append(button);
      }
    };
    group('書き足す：', ['circle', 'arrow', 'box', 'num', 'text']);
    tools.append(el('span', 'bie-sep'));
    group('隠す：', ['black', 'blur']);
    tools.append(el('span', 'bie-sep'));
    group('指さすだけ：', ['point']);
    this.undoButton.type = 'button';
    this.undoButton.title = '最後の印を消す（Ctrl+Z）。全部消したのも戻せます';
    this.undoButton.addEventListener('click', () => this.undo());
    this.clearButton.type = 'button';
    this.clearButton.title = '印をすべて消す（一つ戻すで戻せます）';
    this.clearButton.addEventListener('click', () => this.clearAll());
    tools.append(el('span', 'bie-spacer'), this.undoButton, this.clearButton);

    // 画像：下の層（元の画像と隠す印）・上の層（ほかの印。ここを押して描く）・候補の枠・文字の入力欄
    this.base.setAttribute('aria-hidden', 'true');
    this.ink.tabIndex = 0;
    this.ink.setAttribute('role', 'img');
    this.ink.setAttribute('aria-label', '書き足す画像（押すと、選んだ道具の印が付きます）');
    this.ink.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.ink.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.ink.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.ink.addEventListener('pointercancel', () => this.cancelDrag());
    this.hints.setAttribute('role', 'group');
    this.hints.setAttribute('aria-label', '隠す候補');
    this.textInput.type = 'text';
    this.textInput.hidden = true;
    this.textInput.maxLength = TEXT_MAX;
    this.textInput.placeholder = '短い文字（Enter で決める・Esc でやめる）';
    this.textInput.setAttribute('aria-label', '画像に書く文字');
    this.textInput.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        this.commitText();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.closeText();
        this.say('文字はやめました');
        this.ink.focus({ preventScroll: true });
      }
    });
    this.textInput.addEventListener('blur', () => {
      if (this.textAt) this.commitText();
    });
    this.frame.append(this.base, this.ink, this.hints, this.textInput);
    this.stage.append(this.frame);
    const main = el('div', 'bie-main');
    main.append(
      tools,
      this.stage,
      el(
        'p',
        'brf-note',
        '画像の上を押すと、選んだ道具の印が付きます。点線の枠は、Windows の文字読み取り（手元）で見つけた隠す候補です（画像は外に出ません）。隠すかはあなたが決めます。ぼかしは薄いと読めることがあるので、確かに隠すなら黒塗りに。Ctrl+Enter で小窓に戻る・Esc でやめる',
      ),
    );

    // 横：箱ごとに問い・指さした所・渡す画像・この画像で送るもの
    const card = (title: string, ...children: HTMLElement[]) => {
      const box = el('div', 'bie-card');
      box.append(el('h3', 'bie-card-title', title), ...children);
      return box;
    };
    const radios = el('div', 'bie-radios');
    const name = `bie${Math.random().toString(36).slice(2, 8)}`;
    for (const [input, value, label] of [
      [this.annotatedRadio, 'annotated', '書き足した版（元は手元に残す）'],
      [this.originalRadio, 'original', '元の画像（印なし・隠しなし）'],
    ] as const) {
      input.type = 'radio';
      input.name = name;
      input.value = value;
      input.addEventListener('change', () => this.setVersion(value));
      const row = el('label', 'bie-radio-row');
      row.append(input, el('span', '', label));
      radios.append(row);
    }
    this.status.setAttribute('aria-live', 'polite');
    this.doneButton.type = 'button';
    this.doneButton.title = '書き足した版（か元の画像）を付けて小窓に戻ります（Ctrl+Enter）。① で貼るのはこの画像です';
    this.doneButton.addEventListener('click', () => this.finish());
    this.cancelButton.type = 'button';
    this.cancelButton.title = 'この画面で書き足した分を捨てて、小窓に戻ります（Esc）';
    this.cancelButton.addEventListener('click', () => this.cancel());
    const foot = el('div', 'bie-foot');
    foot.append(this.doneButton, this.cancelButton);
    this.hintRetry.type = 'button';
    this.hintRetry.title = 'もう一度、画像の文字を読んで隠す候補を探します';
    this.hintRetry.addEventListener('click', () => void this.loadHints(this.loads, true));
    this.hintLine.append(this.hintText, this.hintRetry);
    this.hintLine.hidden = true;
    const side = el('div', 'bie-side');
    side.append(
      card('箱ごとに問い', this.boxList, this.boxNote),
      card('指さした所', this.crops, this.cropNote),
      card('渡す画像', radios),
      card('この画像で送るもの', this.summary, this.hintLine, this.adds, this.status, foot),
    );

    this.element.append(head, main, side);
    this.element.addEventListener('keydown', (e) => this.onKey(e));
  }

  get isOpen() {
    return !this.element.hidden;
  }

  // 描く面の大きさ（画素。R7c：候補の枠を hints に重ねるとき、画素から % にする）
  get size(): { width: number; height: number } {
    return this.img ? { width: this.base.width, height: this.base.height } : { width: 0, height: 0 };
  }

  // 開く（開いていれば、前の分はやめたことにして開き直す）。prior：前に書き足した分（続きから）
  open(image: string, prior: ImageEditPrior | null, hooks: ImageEditHooks) {
    if (this.isOpen) this.cancel();
    const loads = ++this.loads;
    this.hooks = hooks;
    this.original = image;
    this.marks = prior ? prior.marks.map((mark) => ({ ...mark })) : [];
    this.kept = [...(prior?.kept ?? [])];
    this.version = prior?.version === 'original' ? 'original' : 'annotated';
    this.history = this.marks.map((_, i) => ({ marks: this.marks.slice(0, i), kept: this.kept })); // 前に描いた印も、一つ戻すで 1 つずつ戻せる
    this.found = [];
    this.hintState = this.findHints ? 'reading' : 'off';
    this.drag = null;
    this.changed = false;
    this.escArmed = false;
    this.img = null;
    this.closeText();
    this.annotatedRadio.checked = this.version === 'annotated';
    this.originalRadio.checked = this.version === 'original';
    this.element.hidden = false;
    this.say('画像を読んでいます…');
    this.renderSide();
    this.updateTools();
    this.resize.observe(this.stage);
    this.toolButtons.get(this.tool)?.focus({ preventScroll: true });
    void loadImage(image).then((img) => {
      if (loads !== this.loads || !this.isOpen) return;
      if (!img) {
        this.say('画像を読めませんでした。「やめる」で小窓に戻れます');
        this.updateTools();
        return;
      }
      this.img = img;
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));
      for (const canvas of [this.base, this.ink]) {
        canvas.width = width;
        canvas.height = height;
      }
      this.say('');
      this.fitFrame();
      this.renderBase();
      this.renderInk();
      this.renderSide();
      this.updateTools();
      void this.loadHints(loads); // 隠す候補を探す（R7c）
    });
  }

  // やめる（書き足した分を捨てて、小窓に戻る）。開いていなければ何もしない
  cancel() {
    if (!this.isOpen) return;
    const hooks = this.hooks;
    this.close();
    hooks?.onCancel();
  }

  // 隠す印を足す（R7c：候補の枠で「黒塗りで隠す」を選んだとき。黒塗り・ぼかしの道具と同じ印。座標は描く面の画素。一つ戻すで戻せる）。足せたら true
  hide(rect: { x: number; y: number; w: number; h: number }, kind: 'black' | 'blur' = 'black'): boolean {
    if (!this.img || this.version === 'original' || this.marks.length >= MAX_MARKS) return false;
    this.commit(this.fitRect({ kind, ...rect }));
    return true;
  }

  // ---------- 内側 ----------

  private close() {
    this.loads++;
    this.element.hidden = true;
    this.hooks = null;
    this.img = null;
    this.original = '';
    this.marks = [];
    this.kept = [];
    this.history = [];
    this.found = [];
    this.hintState = 'off';
    this.hints.replaceChildren();
    this.drag = null;
    this.closeText();
    for (const canvas of [this.base, this.ink]) {
      canvas.width = 1; // 画像を持ち続けない
      canvas.height = 1;
    }
    this.boxList.replaceChildren();
    this.crops.replaceChildren();
    this.resize.disconnect();
  }

  private say(text: string) {
    this.status.textContent = text;
  }

  // 画像の枠を、置き場（stage）に収まる大きさにする（縦横の比はそのまま。小さい画像は 2 倍まで大きく見せる）
  private fitFrame() {
    if (!this.isOpen || !this.img) return;
    const box = this.stage.getBoundingClientRect();
    const { width, height } = this.base;
    const scale =
      box.width > 40 && box.height > 40 ? Math.min(2, (box.width - 4) / width, (box.height - 4) / height) : Math.min(1, 640 / Math.max(width, height));
    this.frame.style.width = `${Math.max(1, Math.round(width * scale))}px`;
    this.frame.style.height = `${Math.max(1, Math.round(height * scale))}px`;
  }

  // 焼き込む色（sheets.css の .bie の --bie-*）
  private colors() {
    const style = getComputedStyle(this.element);
    const pick = (name: string) => style.getPropertyValue(name).trim() || style.color;
    return {
      ink: pick('--bie-ink'),
      on: pick('--bie-ink-on'),
      hide: pick('--bie-hide'),
      point: pick('--bie-point'),
      label: pick('--bie-label'),
      labelText: pick('--bie-label-text'),
      font: style.fontFamily || 'sans-serif',
    };
  }

  // 下の層：元の画像 → 黒塗り → ぼかし（黒塗りしたあとの絵をぼかす）→ もう一度黒塗り（ぼかしがにじんでも、黒塗りはいつも上）
  private renderBase() {
    const ctx = this.base.getContext('2d');
    const img = this.img;
    if (!ctx || !img) return;
    const { width, height } = this.base;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    if (this.version === 'original') return;
    const colors = this.colors();
    const blacks = this.marks.filter((mark) => mark.kind === 'black');
    const blurs = this.marks.filter((mark) => mark.kind === 'blur');
    const paintBlacks = () => {
      ctx.fillStyle = colors.hide;
      for (const mark of blacks) ctx.fillRect(mark.x, mark.y, mark.w, mark.h);
    };
    paintBlacks();
    if (!blurs.length) return;
    const source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    source.getContext('2d')?.drawImage(this.base, 0, 0);
    for (const mark of blurs) {
      const radius = Math.min(48, Math.max(8, Math.round(Math.min(mark.w, mark.h) / 3), Math.round(Math.max(width, height) / 120)));
      const pad = radius * 2;
      const sx = clamp(Math.floor(mark.x - pad), 0, width);
      const sy = clamp(Math.floor(mark.y - pad), 0, height);
      const sw = clamp(Math.ceil(mark.x + mark.w + pad), 0, width) - sx;
      const sh = clamp(Math.ceil(mark.y + mark.h + pad), 0, height) - sy;
      if (sw < 1 || sh < 1) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(mark.x, mark.y, mark.w, mark.h);
      ctx.clip();
      ctx.filter = `blur(${radius}px)`;
      ctx.drawImage(source, sx, sy, sw, sh, sx, sy, sw, sh);
      ctx.restore();
    }
    source.width = 1;
    source.height = 1;
    paintBlacks();
  }

  // 上の層：印（引いているあいだの draft も）。元の画像を渡すときは何も描かない
  private renderInk(draft?: ImageMark) {
    const ctx = this.ink.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, this.ink.width, this.ink.height);
    if (!this.img || this.version === 'original') return;
    this.paintInk(ctx, draft);
  }

  // 印を描く（上の層にも、焼き込む 1 枚にも使う）。箱と番号は描いた順に 1 から
  private paintInk(ctx: CanvasRenderingContext2D, draft?: ImageMark) {
    const { width, height } = this.ink;
    const colors = this.colors();
    const long = Math.max(width, height);
    const short = Math.min(width, height);
    const lw = Math.max(2, Math.round(long / 320));
    let boxes = 0;
    let nums = 0;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const mark of draft ? [...this.marks, draft] : this.marks) {
      const left = Math.min(mark.x, mark.x + mark.w);
      const top = Math.min(mark.y, mark.y + mark.h);
      const w = Math.abs(mark.w);
      const h = Math.abs(mark.h);
      ctx.strokeStyle = colors.ink;
      ctx.fillStyle = colors.ink;
      ctx.lineWidth = lw;
      ctx.setLineDash([]);
      switch (mark.kind) {
        case 'circle':
          ctx.beginPath();
          ctx.ellipse(left + w / 2, top + h / 2, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'arrow': {
          const x2 = mark.x + mark.w;
          const y2 = mark.y + mark.h;
          const angle = Math.atan2(mark.h, mark.w);
          const head = Math.max(10, lw * 4);
          ctx.beginPath();
          ctx.moveTo(mark.x, mark.y);
          ctx.lineTo(x2 - Math.cos(angle) * head * 0.6, y2 - Math.sin(angle) * head * 0.6);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - Math.cos(angle - 0.45) * head, y2 - Math.sin(angle - 0.45) * head);
          ctx.lineTo(x2 - Math.cos(angle + 0.45) * head, y2 - Math.sin(angle + 0.45) * head);
          ctx.closePath();
          ctx.fill();
          break;
        }
        case 'box': {
          boxes++;
          ctx.strokeRect(left, top, w, h);
          const tag = Math.max(16, lw * 7);
          ctx.fillRect(left, top, tag, tag);
          this.paintLabel(ctx, String(boxes), left + tag / 2, top + tag / 2, tag * 0.72, colors.on, colors.font);
          break;
        }
        case 'num': {
          nums++;
          const r = Math.max(10, lw * 5);
          ctx.beginPath();
          ctx.arc(mark.x, mark.y, r, 0, Math.PI * 2);
          ctx.fill();
          this.paintLabel(ctx, String(nums), mark.x, mark.y, r * 1.15, colors.on, colors.font);
          break;
        }
        case 'text': {
          const text = mark.text ?? '';
          if (!text) break;
          const size = Math.max(14, Math.round(long / 40));
          ctx.font = `700 ${size}px ${colors.font}`;
          const pad = Math.round(size * 0.35);
          const boxW = Math.min(width, ctx.measureText(text).width + pad * 2);
          const boxH = Math.round(size * 1.5);
          const x = clamp(mark.x, 0, Math.max(0, width - boxW));
          const y = clamp(mark.y - boxH, 0, Math.max(0, height - boxH));
          ctx.fillStyle = colors.label;
          ctx.fillRect(x, y, boxW, boxH);
          ctx.lineWidth = Math.max(1, lw / 2);
          ctx.strokeRect(x, y, boxW, boxH);
          ctx.fillStyle = colors.labelText;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, x + pad, y + boxH / 2, boxW - pad * 2);
          break;
        }
        case 'point': {
          const side = this.cropSide(short);
          ctx.strokeStyle = colors.point;
          ctx.lineWidth = Math.max(1.5, lw * 0.75);
          ctx.setLineDash([lw * 2.5, lw * 1.5]);
          ctx.strokeRect(mark.x - side / 2, mark.y - side / 2, side, side);
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.arc(mark.x, mark.y, Math.max(4, lw * 2.2), 0, Math.PI * 2);
          ctx.fillStyle = colors.point;
          ctx.fill();
          ctx.strokeStyle = colors.on;
          ctx.lineWidth = Math.max(1, lw * 0.6);
          ctx.stroke();
          break;
        }
        case 'black':
        case 'blur':
          // 隠す印は下の層に描く。引いているあいだだけ、点線の枠を見せる（焼き込まない）
          if (mark === draft) {
            ctx.setLineDash([lw * 2, lw * 1.5]);
            ctx.strokeRect(left, top, w, h);
          }
          break;
      }
    }
    ctx.restore();
  }

  // 丸や四角の中に、白い字で番号を書く
  private paintLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, font: string) {
    ctx.font = `700 ${Math.round(size)}px ${font}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + size * 0.04);
  }

  // 指さした所の点線の枠・切り抜きの一辺（描く面の画素）
  private cropSide(short: number) {
    return Math.max(36, Math.round(short / 6));
  }

  // 横の欄（箱ごとの問い・指さした所の切り抜き・この画像で送るもの）と、一つ戻す・全部消すが押せるか
  private renderSide() {
    const original = this.version === 'original';
    // 箱ごとの問い（描き直しても、打っている欄の当たりは残す）
    const focused = this.boxList.contains(document.activeElement) ? [...this.boxList.querySelectorAll('input')].indexOf(document.activeElement as HTMLInputElement) : -1;
    const boxes = this.marks.filter((mark) => mark.kind === 'box');
    this.boxList.replaceChildren(
      ...boxes.map((mark, i) => {
        const row = el('li', 'bie-box');
        const label = `${CIRCLED[i] ?? String(i + 1)}の箱`;
        const input = el('input', 'bie-box-input');
        input.type = 'text';
        input.maxLength = QUESTION_MAX;
        input.value = mark.question ?? '';
        input.placeholder = `${label}の問い（例：ここの数字の意味は？）`;
        input.setAttribute('aria-label', `${label}の問い`);
        input.disabled = original;
        input.addEventListener('input', () => {
          mark.question = input.value;
          this.renderSummary();
        });
        row.append(el('span', 'bie-box-no', label), input);
        return row;
      }),
    );
    if (focused >= 0) this.boxList.querySelectorAll('input')[focused]?.focus({ preventScroll: true });
    this.boxNote.hidden = boxes.length > 0;
    // 指さした所の切り抜き（下の層から。隠した所は隠れたまま）
    const points = this.marks.filter((mark) => mark.kind === 'point');
    const short = Math.min(this.base.width, this.base.height);
    this.crops.replaceChildren(
      ...points.map((mark, i) => {
        const crop = el('canvas', 'bie-crop');
        crop.width = CROP_PX;
        crop.height = CROP_PX;
        crop.title = `指さした所 ${i + 1}`;
        crop.setAttribute('role', 'img');
        crop.setAttribute('aria-label', `指さした所 ${i + 1} の切り抜き`);
        const side = this.cropSide(short);
        if (this.img) crop.getContext('2d')?.drawImage(this.base, mark.x - side / 2, mark.y - side / 2, side, side, 0, 0, CROP_PX, CROP_PX);
        return crop;
      }),
    );
    this.cropNote.hidden = points.length > 0;
    this.renderHints();
    this.renderSummary();
    this.updateTools();
  }

  // ---------- 隠す候補（R7c） ----------

  // 元の画像を JPEG の data URL にして、隠す候補を探す（同じ画像の結果は覚えておく。retry：覚えた結果を使わず探し直す）
  private async loadHints(loads: number, retry = false) {
    const find = this.findHints;
    if (!find || !this.img || loads !== this.loads) return;
    const key = imageKey(this.original);
    let found = !retry && this.hintCache?.key === key ? this.hintCache.found : null;
    if (!found) {
      this.hintState = 'reading';
      this.renderHints();
      const jpeg = this.hintJpeg();
      const outcome: ImageHintsOutcome = jpeg ? await find(jpeg) : { ok: false, why: 'failed' };
      if (loads !== this.loads || !this.isOpen) return; // 待つあいだに閉じた・開き直した
      if (!outcome.ok) {
        this.found = [];
        this.hintState = outcome.why;
        this.renderSide();
        return;
      }
      found = outcome.hints;
      this.hintCache = { key, found };
    }
    const { width, height } = this.base;
    this.found = found.map((hint, id) => ({ id, kind: hint.kind, x: hint.x * width, y: hint.y * height, w: hint.w * width, h: hint.h * height }));
    this.kept = this.kept.filter((id) => id < this.found.length);
    this.hintState = 'ready';
    this.renderSide();
  }

  // 読み取りに渡す元の画像（印なし。透明な所は白に）。大きすぎれば質を下げる
  private hintJpeg(): string | null {
    const img = this.img;
    if (!img) return null;
    const canvas = document.createElement('canvas');
    canvas.width = this.base.width;
    canvas.height = this.base.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = this.colors().on; // 白（--bie-ink-on）
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.9, 0.75, 0.6]) {
      const jpeg = canvas.toDataURL('image/jpeg', quality);
      if (jpeg.length <= HINT_JPEG_MAX) return jpeg;
    }
    return null;
  }

  // 候補のいま：隠した（書き足した版で、黒塗りかぼかしの印が覆う）・そのまま・未決
  private hintStatus(hint: ImageHint): 'open' | 'hidden' | 'kept' {
    if (this.kept.includes(hint.id)) return 'kept';
    if (this.version === 'annotated' && this.marks.some((mark) => isHide(mark.kind) && coverOf(mark, hint) >= HINT_COVER)) return 'hidden';
    return 'open';
  }

  private hintCount(): ImageHintCount {
    const count: ImageHintCount = { found: 0, hidden: 0, kept: 0 };
    if (this.hintState !== 'ready') return count;
    for (const hint of this.found) {
      count.found++;
      const status = this.hintStatus(hint);
      if (status === 'hidden') count.hidden++;
      else if (status === 'kept') count.kept++;
    }
    return count;
  }

  // 未決の候補に点線の枠と問いを出し、「この画像で送るもの」の候補の 1 行を直す
  private renderHints() {
    const { width, height } = this.base;
    const open = this.img && this.hintState === 'ready' ? this.found.filter((hint) => this.hintStatus(hint) === 'open') : [];
    this.hints.replaceChildren(...open.map((hint) => this.hintFrame(hint, width, height)));
    this.renderHintLine();
  }

  private hintFrame(hint: ImageHint, width: number, height: number): HTMLElement {
    const label = HINT_LABEL[hint.kind];
    const frame = el('div', 'bie-hint');
    frame.style.left = `${(hint.x / width) * 100}%`;
    frame.style.top = `${(hint.y / height) * 100}%`;
    frame.style.width = `${(hint.w / width) * 100}%`;
    frame.style.height = `${(hint.h / height) * 100}%`;
    frame.title = `${label}（Windows の文字読み取りで見つけた行）`;
    const ask = el('div', 'bie-hint-ask');
    ask.classList.toggle('bie-hint-ask-up', hint.y + hint.h > height * 0.72); // 下の方の行は、問いを枠の上に
    ask.classList.toggle('bie-hint-ask-left', hint.x + hint.w / 2 < width / 2); // 左寄りの行は、問いを左にそろえる
    const original = this.version === 'original';
    const hide = el('button', 'brf-button bie-hint-hide', '黒塗りで隠す');
    hide.type = 'button';
    hide.disabled = original;
    hide.title = original ? '「元の画像」を渡すので隠せません（「書き足した版」に戻すと隠せます）' : 'この行を黒塗りで隠します（黒塗りの道具と同じ印。一つ戻すで戻せます）';
    hide.addEventListener('click', () => this.hideHint(hint));
    const keep = el('button', 'brf-button', 'そのまま');
    keep.type = 'button';
    keep.title = '隠さずにそのまま渡します（一つ戻すで戻せます）';
    keep.addEventListener('click', () => this.keepHint(hint));
    ask.append(el('span', 'bie-hint-q', `${label}。隠しますか？`), hide, keep);
    frame.append(ask);
    return frame;
  }

  // 「黒塗りで隠す」：行の矩形を少し広げて、黒塗りの印を足す
  private hideHint(hint: ImageHint) {
    if (this.version === 'original') return;
    const pad = Math.max(2, hint.h * HINT_PAD);
    if (!this.hide({ x: hint.x - pad, y: hint.y - pad, w: hint.w + pad * 2, h: hint.h + pad * 2 }, 'black')) {
      this.say(`印は ${MAX_MARKS} までです（一つ戻すか、全部消してから）`);
      return;
    }
    this.say(`${HINT_LABEL[hint.kind]}を黒塗りで隠しました（一つ戻すで戻せます）`);
    this.focusHint();
  }

  // 「そのまま」：枠を消す（一つ戻すで戻せる）
  private keepHint(hint: ImageHint) {
    this.history.push(this.snapshot());
    this.kept = [...this.kept, hint.id];
    this.changed = true;
    this.escArmed = false;
    this.renderSide();
    this.say(`${HINT_LABEL[hint.kind]}は隠さずに渡します（一つ戻すで戻せます）`);
    this.focusHint();
  }

  // 次の未決の候補へ（無ければ画像へ）。押したボタンが消えても、キーが面に届くように
  private focusHint() {
    const next = this.hints.querySelector<HTMLButtonElement>('.bie-hint-hide:not(:disabled)');
    (next ?? this.ink).focus({ preventScroll: true });
  }

  private renderHintLine() {
    const count = this.hintCount();
    const open = count.found - count.hidden - count.kept;
    const state = this.hintState;
    let text = '';
    if (state === 'reading') text = '隠す候補：文字を読んでいます…（Windows の文字読み取り。画像は外に出ません）';
    else if (state === 'unavailable') text = '隠す候補：読み取りが使えません（このビルドには Windows の文字読み取りがありません）';
    else if (state === 'noJapanese') text = '隠す候補：読み取りが使えません（日本語の読み取りデータがありません）';
    else if (state === 'busy') text = '隠す候補：いまは読めません（ほかで文字を読んでいます）';
    else if (state === 'failed') text = '隠す候補：文字を読めませんでした';
    else if (state === 'ready' && !count.found) text = '隠す候補：見つかりませんでした（メール・電話番号・鍵らしき文字）';
    else if (state === 'ready' && count.found === 1) {
      const hint = this.found[0];
      const hidden = count.hidden ? (this.marks.some((mark) => mark.kind === 'black' && coverOf(mark, hint) >= HINT_COVER) ? '黒塗りで隠した' : 'ぼかしで隠した') : '';
      text = `候補（${HINT_LABEL[hint.kind]}）：${open ? 'まだ決めていない' : hidden || 'そのまま'}`;
    } else if (state === 'ready') {
      const parts = [open ? `まだ決めていない ${open}` : '', count.hidden ? `隠した ${count.hidden}` : '', count.kept ? `そのまま ${count.kept}` : ''].filter(Boolean);
      text = `候補 ${count.found}：${parts.join('・')}`;
    }
    if (state === 'ready' && count.found && this.version === 'original') text += '（元の画像なので、候補の文字もそのまま写ります）';
    this.hintText.textContent = text;
    this.hintRetry.hidden = state !== 'busy' && state !== 'failed';
    this.hintLine.hidden = !text;
  }

  private snapshot(): EditSnapshot {
    return { marks: this.marks, kept: this.kept };
  }

  // この画像で送るもの：渡す画像と印の数、小窓に戻ると依頼文に入る行
  private renderSummary() {
    const counts = countMarks(this.marks);
    if (this.version === 'original') {
      this.summary.textContent = '元の画像を渡す：印なし・隠しなし。描いた印は持っておきます（「書き足した版」に戻すと続きから描けます）';
      this.adds.textContent = '依頼文には何も足しません';
      return;
    }
    if (!this.marks.length) {
      this.summary.textContent = '書き足した版を渡す：まだ何も書き足していません（このまま戻ると、元の画像のまま付けます）';
      this.adds.textContent = '';
      return;
    }
    this.summary.textContent = `書き足した版を渡す：${(['circle', 'arrow', 'box', 'num', 'text', 'black', 'blur', 'point'] as const).map((kind) => `${TOOL_NAME[kind]} ${counts[kind]}`).join('・')}`;
    const adds = [...(counts.box ? [`「①の箱：…」〜（${counts.box} 行）`] : []), ...(counts.point ? ['「ここは何？」'] : [])];
    this.adds.textContent = adds.length ? `小窓に戻ると、依頼文の末尾に ${adds.join('と')} が入ります` : '';
  }

  // 道具のボタン（選んでいる印・押せるか）と、一つ戻す・全部消す・小窓に戻る
  private updateTools() {
    const usable = !!this.img && this.version === 'annotated';
    for (const [tool, button] of this.toolButtons) {
      button.setAttribute('aria-pressed', tool === this.tool ? 'true' : 'false');
      button.disabled = !usable;
    }
    this.undoButton.disabled = !this.history.length;
    this.clearButton.disabled = (!this.marks.length && !this.kept.length) || !usable;
    this.doneButton.disabled = !this.img;
    this.ink.classList.toggle('bie-ink-off', !usable);
  }

  private setTool(tool: ImageTool) {
    if (this.textAt) this.commitText();
    this.tool = tool;
    this.escArmed = false;
    this.updateTools();
    this.say(TOOLS.find((t) => t.tool === tool)?.title ?? '');
  }

  private setVersion(version: ImageEditVersion) {
    if (version === this.version) return;
    if (this.textAt) this.commitText();
    this.cancelDrag();
    this.version = version;
    this.changed = true;
    this.renderBase();
    this.renderInk();
    this.renderSide();
    this.say(version === 'original' ? '元の画像を渡します（印は付けられません。描いた印は持っておきます）' : '書き足した版を渡します');
  }

  // 画像の上の点（描く面の画素）
  private pointOf(e: PointerEvent): { x: number; y: number } {
    const rect = this.ink.getBoundingClientRect();
    return {
      x: clamp(((e.clientX - rect.left) / Math.max(1, rect.width)) * this.ink.width, 0, this.ink.width),
      y: clamp(((e.clientY - rect.top) / Math.max(1, rect.height)) * this.ink.height, 0, this.ink.height),
    };
  }

  // その道具でもう描けないわけ（無ければ空）
  private fullWhy(tool: ImageTool): string {
    if (this.marks.length >= MAX_MARKS) return `印は ${MAX_MARKS} までです（一つ戻すか、全部消してから）`;
    const counts = countMarks(this.marks);
    if (tool === 'box' && counts.box >= MAX_BOXES) return `箱は ${MAX_BOXES} つまでです（①〜⑨）`;
    if (tool === 'point' && counts.point >= MAX_POINTS) return `指さしは ${MAX_POINTS} か所までです`;
    if (tool === 'num' && counts.num >= MAX_NUMS) return `番号は ${MAX_NUMS} までです`;
    return '';
  }

  private onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || !this.img) return;
    this.escArmed = false;
    if (this.textAt) {
      this.commitText(); // 書いていた文字を決めるだけ（次の印は、もう一度押す）
      return;
    }
    if (this.version === 'original') {
      this.say('「元の画像」を渡すので、印は付けません（「書き足した版」に戻すと付けられます）');
      return;
    }
    const why = this.fullWhy(this.tool);
    if (why) {
      this.say(why);
      return;
    }
    const p = this.pointOf(e);
    if (this.tool === 'num' || this.tool === 'point') {
      this.commit({ kind: this.tool, x: p.x, y: p.y, w: 0, h: 0 });
      return;
    }
    if (this.tool === 'text') {
      this.openText(p);
      return;
    }
    e.preventDefault();
    this.drag = { mark: { kind: this.tool, x: p.x, y: p.y, w: 0, h: 0 }, startX: e.clientX, startY: e.clientY, pointerId: e.pointerId, moved: false };
    try {
      this.ink.setPointerCapture(e.pointerId); // 画像の外へ引いても追う
    } catch {
      // 指が離れたあとなど、捕まえられなくても描ける
    }
    this.ink.focus({ preventScroll: true });
  }

  private onPointerMove(e: PointerEvent) {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) >= MOVE_PX) drag.moved = true;
    if (!drag.moved) return;
    const p = this.pointOf(e);
    drag.mark.w = p.x - drag.mark.x;
    drag.mark.h = p.y - drag.mark.y;
    this.renderInk(drag.mark);
  }

  private onPointerUp(e: PointerEvent) {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    this.drag = null;
    const mark = drag.moved ? drag.mark : this.sized(drag.mark.kind, drag.mark.x, drag.mark.y);
    this.commit(mark.kind === 'arrow' ? mark : this.fitRect(mark));
  }

  private cancelDrag() {
    if (!this.drag) return;
    this.drag = null;
    this.renderInk();
  }

  // 押しただけのときの決まった大きさ（画像の短い辺に合わせる）
  private sized(kind: ImageTool, x: number, y: number): ImageMark {
    const short = Math.min(this.ink.width, this.ink.height);
    if (kind === 'arrow') {
      const len = Math.max(40, short * 0.18);
      const sx = clamp(x - len * 0.75, 0, this.ink.width);
      const sy = clamp(y + len * 0.55, 0, this.ink.height);
      return { kind, x: sx, y: sy, w: x - sx, h: y - sy };
    }
    const [w, h] = kind === 'circle' ? [Math.max(24, short * 0.16), Math.max(24, short * 0.16)] : kind === 'box' ? [Math.max(40, short * 0.3), Math.max(28, short * 0.2)] : [Math.max(40, short * 0.3), Math.max(14, short * 0.07)];
    return { kind, x: x - w / 2, y: y - h / 2, w, h };
  }

  // 四角の印を、左上と正の大きさにそろえて画像の中に収める（細すぎるものは 4 画素に）
  private fitRect(mark: ImageMark): ImageMark {
    const { width, height } = this.ink;
    const x1 = clamp(Math.min(mark.x, mark.x + mark.w), 0, width);
    const y1 = clamp(Math.min(mark.y, mark.y + mark.h), 0, height);
    const x2 = clamp(Math.max(mark.x, mark.x + mark.w), 0, width);
    const y2 = clamp(Math.max(mark.y, mark.y + mark.h), 0, height);
    const w = Math.max(4, x2 - x1);
    const h = Math.max(4, y2 - y1);
    return { ...mark, x: Math.min(x1, Math.max(0, width - w)), y: Math.min(y1, Math.max(0, height - h)), w, h };
  }

  // 印を 1 つ足す（一つ戻すの元を残す）
  private commit(mark: ImageMark) {
    this.history.push(this.snapshot());
    this.marks = [...this.marks, mark];
    this.changed = true;
    this.escArmed = false;
    if (isHide(mark.kind)) this.renderBase();
    this.renderInk();
    this.renderSide();
    this.say(`${TOOL_NAME[mark.kind]}を付けました`);
    if (mark.kind === 'box') [...this.boxList.querySelectorAll('input')].at(-1)?.focus({ preventScroll: true }); // 箱の問いをすぐ書ける
  }

  private undo() {
    const before = this.history.pop();
    if (!before) return;
    if (this.textAt) this.closeText();
    this.cancelDrag();
    this.marks = before.marks;
    this.kept = before.kept;
    this.changed = true;
    this.renderBase();
    this.renderInk();
    this.renderSide();
    this.say('一つ戻しました');
  }

  private clearAll() {
    if (!this.marks.length && !this.kept.length) return;
    if (this.textAt) this.closeText();
    const decided = this.kept.length > 0 || this.hintCount().hidden > 0;
    this.history.push(this.snapshot());
    this.marks = [];
    this.kept = []; // 隠す候補の決めごと（そのまま）も消して、枠を戻す
    this.changed = true;
    this.renderBase();
    this.renderInk();
    this.renderSide();
    this.say(decided ? '印を全部消し、隠す候補の枠も戻しました（一つ戻すで戻せます）' : '印を全部消しました（一つ戻すで戻せます）');
  }

  // 文字の印：押した所に小さな入力欄を出す
  private openText(p: { x: number; y: number }) {
    this.textAt = p;
    this.textInput.value = '';
    this.textInput.style.left = `${(p.x / this.ink.width) * 100}%`;
    this.textInput.style.top = `${(p.y / this.ink.height) * 100}%`;
    this.textInput.hidden = false;
    this.say('短い文字を書いて Enter（やめるなら Esc）');
    window.setTimeout(() => {
      if (this.textAt) this.textInput.focus({ preventScroll: true }); // 押したあとの当たりの移りより後に
    }, 0);
  }

  private commitText() {
    const at = this.textAt;
    if (!at) return;
    const text = oneLine(this.textInput.value, TEXT_MAX);
    this.closeText();
    if (text) this.commit({ kind: 'text', x: at.x, y: at.y, w: 0, h: 0, text });
    else this.say('文字が空なので、付けませんでした');
  }

  private closeText() {
    this.textAt = null;
    this.textInput.hidden = true;
    this.textInput.value = '';
  }

  // 小窓に戻る：書き足した版を 1 枚の PNG に焼く（元の画像・何も描いていないなら元のまま）
  private finish() {
    const hooks = this.hooks;
    if (!this.img || !hooks) return;
    if (this.textAt) this.commitText();
    this.cancelDrag();
    const annotated = this.version === 'annotated';
    let image = this.original;
    if (annotated && this.marks.length) {
      const out = document.createElement('canvas');
      out.width = this.base.width;
      out.height = this.base.height;
      const ctx = out.getContext('2d');
      if (!ctx) {
        this.say('書き足した版を作れませんでした。もう一度押すか、「元の画像」にしてください');
        return;
      }
      ctx.drawImage(this.base, 0, 0);
      this.paintInk(ctx);
      image = out.toDataURL('image/png');
    }
    const counts = annotated ? countMarks(this.marks) : countMarks([]);
    const boxes = annotated ? this.marks.filter((mark) => mark.kind === 'box').map((mark, i) => ({ n: i + 1, question: oneLine(mark.question ?? '', QUESTION_MAX) })) : [];
    const result: ImageEditResult = {
      version: this.version,
      image,
      original: this.original,
      marks: this.marks.map((mark) => ({ ...mark })),
      boxes,
      points: counts.point,
      counts,
      kept: [...this.kept],
      hints: this.hintCount(),
    };
    this.close();
    hooks.onDone(result);
  }

  // Esc：引いている印をやめる → 何か変えていれば 2 回めでやめる。Ctrl+Enter：小窓に戻る。Ctrl+Z：一つ戻す（文字の欄の中では欄の戻し）
  private onKey(e: KeyboardEvent) {
    if (e.isComposing || e.keyCode === 229 || e.defaultPrevented) return;
    const inField = e.target instanceof HTMLInputElement && e.target.type === 'text';
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (this.drag) {
        this.cancelDrag();
        return;
      }
      if (this.changed && !this.escArmed) {
        this.escArmed = true;
        this.say('もう一度 Esc で、書き足した分を捨てて小窓に戻ります（残すなら「小窓に戻る」）');
        return;
      }
      this.cancel();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      this.finish();
    } else if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && !inField) {
      e.preventDefault();
      e.stopPropagation();
      this.undo();
    } else if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) this.escArmed = false;
  }
}
