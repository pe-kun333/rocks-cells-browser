// 右サイドバーの「撮影」（C1・C5）
//   見出しの「▣ 中央を撮る」の左クリックは、中央に見えているページだけ。右クリックで窓全体・デスクトップ・範囲。
//   窓の上のボタンは置かない。カードの右クリックは、いいね1・2・3の丸いボタン（タグのボタンと同じ顔）。
import { t } from '../i18n';
import { armConfirm } from '../confirm-arm';
import { formatUsd } from '../ai/budget';
import { requestPageText } from '../ai/page';
import { BLOCK_NOTE, pageIsBlocked, redactBlockedUrls } from '../blocklist';
import { copyShotImageResult } from '../bot-shot';
import { botAppErrorText, openBotApp } from '../bots';
import { onMessage, request, send, type HostMessage } from '../bridge';
import {
  ASK_IMAGE_CAP,
  ASK_KINDS,
  ASK_NOTE_MAX,
  SECRET_WARNING,
  type AskCrop,
  type AskKindId,
  type CropTarget,
  askBundleText,
  askDisplay,
  askEstimateUsd,
  burnImage,
  clipAskNote,
  clipboardImageBase64,
  cropTargets,
  effectiveKinds,
  hasAskMarks,
  imageTokens,
  ocrHasSecret,
  prepareAskImages,
  prepareAskPreview,
} from '../capture-ask';
import { attachAnnotationOverlay } from '../capture-overlay';
import { numberOf, numberPieces, type AnnotationOptions, type AnnotationScene } from '../capture-draw';
import { HIDDEN_TEXT, hideCandidates, lineHideRects, type CandidateKind } from '../capture-hide';
import {
  CAPTURE_FROM_KINDS,
  CAPTURE_FROM_LABEL,
  CAPTURE_LIMIT,
  CAPTURE_LONG_EDGE,
  COMMENT_HINT,
  COMMENT_MAX,
  PAGE_TEXT_MAX,
  RECORD_LIMIT_SECONDS,
  captureFromTitle,
  clipComment,
  fitCaptureImage,
  newCaptureId,
  ocrLinesFromHost,
  placeholderRecordImage,
  sourceOf,
  type CaptureFromKind,
  type CaptureItem,
  type CaptureLoadFailure,
  type CaptureOcrLine,
  type CaptureScope,
  type CaptureSource,
  type CaptureStore,
  type CaptureVia,
  type CaptureVideo,
  type FitFailure,
  type HideResult,
} from '../captures';
import { readData } from '../data';
import { LIKE_LABEL, type LikeLevel } from '../likes';
import { stampOf } from '../captures';
import { savedMarkNew } from '../rotate';
import type { RelayCommand } from '../types';
import { el, hostOf } from '../util';
import { type CellMenu, type MenuEntry } from './cell-menu';

export interface CapturePanelHost {
  store: CaptureStore;
  activeTab(): { id: number; url: string; title: string } | null;
  askLeft(action: RelayCommand): void;
  menu: CellMenu;
  toast(text: string): void;
  companions(): { target: string; label: string }[];
  bots(): { id: string; name: string; agentId?: string }[];
  practice(): boolean;
  busy(): boolean;
  companionPrice(target: string): { input: number; output: number };
  sendCapture(text: string, images: string[] | undefined, target: string, display: string): Promise<{ ok: true } | { ok: false; message: string }>;
  botAppConfirmed(): boolean;
  confirmBotApp(): void;
}

interface AskSession {
  id: string;
  image: boolean;
  burn: boolean; // 書き込みを画像に焼く（線・文字・印と番号）。image が off のときは意味がない
  crops: boolean; // 印の周りの切り抜きを添える（相棒だけ。image が off か、送り先が Grok Bot のときは添えない）
  marks: boolean; // 印と書き込みの文
  grokText?: string; // Grok Bot の 2 段（画像をコピー → 文をコピー）で、画像を焼いたときの文。間に書き込みを変えても、貼った画像と番号が合うように
  ocr: boolean;
  url: boolean;
  kinds: Set<AskKindId>;
  note: string;
  dest: string;
  blocked: boolean;
  step: 'form' | 'paste';
  sending: boolean;
  tokens: number;
  preview: string;
  notice: string;
  // 送る画像の下見（書き込みと隠しを焼いたもの）。shotKey は作った（作っている）ときの材料。key が変わったときだけ作り直す
  shot: AskShot | null;
  shotKey: string;
  shotFailed: boolean;
}

interface AskShot {
  key: string;
  dataUrl: string;
  width: number;
  height: number;
  crops: AskCrop[]; // 実際に作れた切り抜き
}

const FOLD_KEY = 'honeycomb.captureFolded';
const READONLY_SHORT = t('撮影の一覧を読めなかったので、撮影の保存を止めています。アプリを開き直してください');
// 隠せたが、一覧（captures.json）の保存に失敗した（店の結果の saved が false）
const INDEX_NOT_SAVED = t('（一覧の保存に失敗しました。開き直すと、読んだ文字が戻ることがあります）');
const NO_JAPANESE = t('この Windows には、日本語の文字認識が入っていません。設定の『時刻と言語』から追加できます');
const LEVELS: LikeLevel[] = [1, 2, 3];
const CANDIDATE_ORDER: CandidateKind[] = ['key', 'mail', 'phone', 'card'];
const CANDIDATE_LABEL: Record<CandidateKind, string> = { key: t('鍵'), mail: t('メール'), phone: t('電話'), card: t('カード') };
const FIT_STAGE: Record<FitFailure, string> = {
  decode: t('読み込み：画像として読めない'),
  empty: t('読み込み：大きさが 0'),
  canvas: t('縮める：canvas が使えない'),
  encode: t('縮める：書き出せない'),
};
// ページの画像の右クリック（I1）：ページの最上位の枠の中で evalInTab が動かす決まったスクリプト（awaitPromise つき）。
//   右クリックで見張りが覚えた画像の、見えている矩形（見えている所の左上からの CSS ピクセル）を測る。ページの値はデータとして扱い、
//   C++ が見えている範囲に切り詰める。位置が落ち着く（続けて 2 フレーム同じ）まで 1 秒まで待つ
const IMAGE_RECT_SCRIPT = `(async () => {
  const rec = window.__honeycombImage;
  if (!rec || typeof rec !== 'object') return { ok: false, reason: 'none' };
  if (typeof rec.at !== 'number' || !(Date.now() - rec.at <= 60000)) return { ok: false, reason: 'old' };
  const img = rec.ref && typeof rec.ref.deref === 'function' ? rec.ref.deref() : null;
  if (!img || !img.isConnected || img.tagName !== 'IMG') return { ok: false, reason: 'gone' };
  if (!img.complete || !(img.naturalWidth > 0)) return { ok: false, reason: 'loading' };
  const vv = window.visualViewport;
  if (vv && Math.abs(vv.scale - 1) > 0.001) return { ok: false, reason: 'pinch' };
  const frame = () => new Promise((resolve) => { requestAnimationFrame(() => resolve()); setTimeout(resolve, 100); });
  const visible = () => {
    const r = img.getBoundingClientRect();
    let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
    for (let el = img.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      const s = getComputedStyle(el);
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const c = el.getBoundingClientRect();
      if (s.overflowX !== 'visible') { x0 = Math.max(x0, c.left); x1 = Math.min(x1, c.right); }
      if (s.overflowY !== 'visible') { y0 = Math.max(y0, c.top); y1 = Math.min(y1, c.bottom); }
    }
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  };
  let last = visible();
  let stable = false;
  const end = performance.now() + 1000;
  while (performance.now() < end) {
    await frame();
    const now = visible();
    const same = Math.abs(now.x - last.x) < 0.5 && Math.abs(now.y - last.y) < 0.5 && Math.abs(now.width - last.width) < 0.5 && Math.abs(now.height - last.height) < 0.5;
    last = now;
    if (same) { stable = true; break; }
  }
  if (!stable) return { ok: false, reason: 'unstable' };
  if (!(last.width >= 8) || !(last.height >= 8)) return { ok: false, reason: 'small' };
  const round = (v) => Math.round(v * 100) / 100;
  return { ok: true, rect: { x: round(last.x), y: round(last.y), width: round(last.width), height: round(last.height) }, srcs: [String(img.currentSrc || '').slice(0, 8192), String(img.src || '').slice(0, 8192)] };
})()`;
// IMAGE_RECT_SCRIPT が返す reason ごとの文（知らない reason は「理由は分かりません」）
const IMAGE_REASON: Record<string, string> = {
  none: t('画像の上で右クリックした記録がありません。読み込みの途中のページや、枠の中の画像では撮れません'),
  old: t('右クリックから時間がたちました'),
  gone: t('画像がページから消えました'),
  loading: t('画像がまだ読み込まれていません'),
  pinch: t('2 本指で拡大しているあいだは撮れません'),
  unstable: t('画像の位置が落ち着きませんでした'),
  small: t('画像が小さすぎます'),
};

export class CapturePanel {
  readonly element = el('section', 'capture-panel');
  private readonly head = el('div', 'capture-head');
  private readonly body = el('div', 'capture-body');
  private readonly status = el('div', 'capture-status');
  // 撮影の一覧を読めなかったときの、消えない注記（上書きしないように保存を止めている）
  private readonly readonlyNote = el('p', 'capture-note capture-ask-warn');
  private readonly list = el('div', 'capture-list');
  private folded: boolean;
  private shooting = false;
  private recording = false;
  private stopping = false;
  private recordReady: boolean | null = null;
  private ocrReady: boolean | null = null;
  private readingId: string | null = null;
  // 隠している間のカード（この間は、隠す操作を重ねない）
  private hidingId: string | null = null;
  // 「行を選んで隠す…」の選ぶ状態。ids は選んだ行
  private pick: { id: string; ids: Set<string> } | null = null;
  // 「mp4 だけ消す」の 1 回目を押したカード
  private dropVideoId: string | null = null;
  private recordSeconds = 0;
  private recordLimit = RECORD_LIMIT_SECONDS;
  private recordSource: CaptureSource | undefined;
  private live = false;
  private regionVia: CaptureVia | undefined;
  private statusText = '';
  private statusTimer = 0;
  private commentTimer = 0;
  private confirmId: string | null = null;
  private dirty = false;
  private ask: AskSession | null = null;
  private askToken = 0;
  private bundleToken = 0;
  private shotToken = 0;
  private lightbox: HTMLElement | null = null;
  private lightboxOverlay: { repaint(): void; dispose(): void } | null = null;
  // カードの縮図に書き込みを重ねている見張り（カードの id ごと）。一覧を作り直すたびに、前のをまとめて止める
  private readonly thumbOverlays = new Map<string, { dispose(): void }>();
  private revealedId: string | null = null;
  private revealTimer = 0;
  private readonly images = new Map<string, string | null>();
  private readonly loading = new Set<string>();
  // 画像の世代（id ごと）。replaceImage（隠した・取り消した）のたびに進め、読んでいる間に進んだ読み込みの結果は写しに入れない
  private readonly imageGen = new Map<string, number>();
  private readonly onLightboxKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    this.closeLightbox();
  };

  constructor(private readonly host: CapturePanelHost) {
    this.folded = loadFolded();
    this.element.setAttribute('aria-label', '撮影');
    this.status.setAttribute('role', 'status');
    this.readonlyNote.hidden = true;
    this.body.append(this.status, this.readonlyNote, el('p', 'capture-note', t('残した画像は、このパソコンの中だけです。設定の画面や鍵が写っていたら消してください。外に出すのは、「AIに頼む」で中身を見て、送るを押したときだけです。')), this.list);
    this.element.append(this.head, this.body);
    host.store.onChange(() => this.render());
    this.element.addEventListener('focusout', () => {
      window.setTimeout(() => {
        if (this.dirty && !this.writing()) this.render();
      }, 0);
    });
    this.render();
    void this.askRecord();
    void this.askOcr();
    onMessage((msg) => {
      if (msg.type === 'recordProgress') this.onProgress(msg.seconds, msg.limit);
      else if (msg.type === 'recordDone') void this.onRecorded(msg);
    });
  }

  get header() {
    return this.head;
  }

  isCollapsed() {
    return this.folded;
  }

  expand() {
    if (this.folded) this.setFolded(false);
  }

  // 盤面の「撮ったもの」をダブルクリックしたとき。そのカードを出して、少しだけ枠を付ける。新しくは撮らない
  reveal(id: string) {
    this.expand();
    this.revealedId = id;
    window.clearTimeout(this.revealTimer);
    this.revealTimer = window.setTimeout(() => {
      if (this.revealedId !== id) return;
      this.revealedId = null;
      this.list.querySelector('.capture-card.is-revealed')?.classList.remove('is-revealed');
    }, 1800);
    this.render();
    this.list.querySelector(`[data-capture="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  // ページの右クリックと Ctrl+Shift+Y（C2）、および窓・デスクトップ・範囲（C5）
  // 録画中の Ctrl+Shift+Y と「中央の見えている所」は、停止（もう1本は始めない）
  captureCenter() {
    if (this.recording) void this.stopRecord();
    else void this.shoot();
  }

  isRecording() {
    return this.recording;
  }

  startRecord() {
    void this.beginRecord();
  }

  stopRecord() {
    void this.endRecord();
  }

  captureScope(scope: CaptureScope) {
    if (this.recording) {
      if (scope === 'center') void this.stopRecord();
      else this.say(t('録画中です。止めてから撮ってください'));
      return;
    }
    if (scope === 'center') void this.shoot();
    else if (scope === 'region') void this.beginRegion();
    else void this.shootScreen(scope);
  }

  async finishCrop(image: string) {
    const via = this.regionVia;
    this.regionVia = undefined;
    if (!image.startsWith('data:image/')) {
      this.say(t('囲んだ範囲を残せませんでした'));
      return;
    }
    const addedId = await this.keepImage(image, 'region', undefined, via);
    if (addedId) this.list.querySelector(`[data-capture="${addedId}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  cancelCrop() {
    this.regionVia = undefined;
    this.say(t('範囲の指定をやめました'));
  }

  // 盤面・下の区画の画像（shots\<id>.json）を撮影に残し、大きく開く（I4）。画面は撮らず、元の画像を縮めて入れる
  //   録画中でも断らない（画面を撮らないので、録画とぶつからない）
  async keepShot(shot: string, kind: CaptureFromKind, name: string) {
    if (!/^shot[0-9a-z]+$/.test(shot) || shot.length > 64 || !(CAPTURE_FROM_KINDS as readonly string[]).includes(kind)) {
      this.say(t('画像を撮影に残せませんでした（画像の名前が違います）'));
      return;
    }
    if (this.shooting) {
      this.say(t('撮っています。終わってからもう一度送ってください'));
      return;
    }
    this.shooting = true;
    let added: CaptureItem | null = null;
    try {
      if (this.host.store.state === 'loading') {
        this.say(t('撮影の一覧を読み込んでいます'), 0);
        await Promise.race([this.host.store.ready, new Promise<void>((resolve) => window.setTimeout(resolve, 8_000))]);
      }
      const state = this.host.store.state;
      if (state === 'loading') {
        this.say(t('撮影の一覧の読み込みが終わらないので、画像を残しませんでした'));
        return;
      }
      if (state === 'readonly') {
        this.say(READONLY_SHORT);
        return;
      }
      if (this.host.store.items.length >= CAPTURE_LIMIT) {
        this.say(t('撮影は {0} 件までです。古いカードを消してから撮ってください', { 0: CAPTURE_LIMIT }));
        return;
      }
      const saved = await readData<{ data?: unknown }>(`shots/${shot}.json`);
      const data = saved?.data;
      if (typeof data !== 'string' || !data.startsWith('data:image/')) {
        this.say(t('元の画像を読めませんでした（もう無いか、壊れています）'));
        return;
      }
      const fit = await fitCaptureImage(data);
      if ('error' in fit) {
        this.say(t('画像を整えられませんでした（{0}）', { 0: FIT_STAGE[fit.error] }));
        return;
      }
      const result = await this.host.store.add(fit.dataUrl, undefined, 'region', undefined, { kind, ...(name ? { name } : {}) });
      if (!result.ok) {
        this.say(addFailure(result.reason));
        return;
      }
      this.images.set(result.item.id, fit.dataUrl);
      added = result.item;
      if (this.folded) this.setFolded(false);
      this.say(t('画像を撮影に残しました（AI には送りません）'));
    } finally {
      this.shooting = false;
      this.render();
      if (added) this.list.querySelector(`[data-capture="${added.id}"]`)?.scrollIntoView({ block: 'nearest' });
    }
    // 写しから開くので、ファイルを読み直さない
    if (added) await this.openLarge(added);
  }

  // ページの画像の右クリック「🖼 画像を撮影に送る」（I1）。ページに画像の見えている矩形を測ってもらい、その部分だけを撮って残し、大きく開く
  //   画像は左から運ばれない（url は照合だけに使う）。位置が分からないときは撮らずに理由を知らせる（カードは増えない）
  async shootImage(req: { tabId: number; url: string; tabUrl: string; at: number }) {
    if (this.recording) {
      this.say(t('録画中です。止めてから撮ってください'));
      return;
    }
    if (this.shooting) {
      this.say(t('撮っています。終わってからもう一度送ってください'));
      return;
    }
    if (Date.now() - req.at > 20_000) {
      this.say(t('時間がたったので、画像は撮りませんでした'));
      return;
    }
    this.shooting = true;
    let added: CaptureItem | null = null;
    try {
      if (this.host.store.state === 'loading') {
        this.say(t('撮影の一覧を読み込んでいます'), 0);
        await Promise.race([this.host.store.ready, new Promise<void>((resolve) => window.setTimeout(resolve, 8_000))]);
      }
      const state = this.host.store.state;
      if (state === 'loading') {
        this.say(t('撮影の一覧の読み込みが終わらないので、画像は撮りませんでした'));
        return;
      }
      if (state === 'readonly') {
        this.say(READONLY_SHORT);
        return;
      }
      if (this.host.store.items.length >= CAPTURE_LIMIT) {
        this.say(t('撮影は {0} 件までです。古いカードを消してから撮ってください', { 0: CAPTURE_LIMIT }));
        return;
      }
      const tab = this.host.activeTab();
      if (!tab) {
        this.say(t('中央にページがありません'));
        return;
      }
      if (tab.id !== req.tabId) {
        this.say(t('右クリックしたページが、今は中央に出ていないので撮りませんでした'));
        return;
      }
      if (req.tabUrl && withoutHash(req.tabUrl) !== withoutHash(tab.url)) {
        this.say(t('ページが変わったので、画像は撮りませんでした'));
        return;
      }
      this.say(t('画像を撮っています'), 0);
      // 画像の位置はページに測ってもらう（右クリックの時の矩形は、右を開いたときの組み直しで当てにならない）
      const asked = await request((requestId) => ({ type: 'evalInTab', requestId, id: tab.id, script: IMAGE_RECT_SCRIPT }), 3_000);
      if (asked?.type !== 'evalResult' || !asked.ok) {
        this.say(imageLost(t('ページに聞けませんでした')));
        return;
      }
      // ページの返事はデータとして読む
      const value = asked.value as { ok?: unknown; reason?: unknown; rect?: unknown; srcs?: unknown } | null | undefined;
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        this.say(imageLost(t('ページの返事が変でした')));
        return;
      }
      if (value.ok !== true) {
        const reason = typeof value.reason === 'string' ? value.reason : '';
        this.say(imageLost(Object.prototype.hasOwnProperty.call(IMAGE_REASON, reason) ? IMAGE_REASON[reason] : t('理由は分かりません')));
        return;
      }
      const box = (value.rect && typeof value.rect === 'object' ? value.rect : {}) as Record<string, unknown>;
      const { x, y, width, height } = box;
      if (
        typeof x !== 'number' || !Number.isFinite(x) ||
        typeof y !== 'number' || !Number.isFinite(y) ||
        typeof width !== 'number' || !Number.isFinite(width) || width < 1 ||
        typeof height !== 'number' || !Number.isFinite(height) || height < 1
      ) {
        this.say(imageLost(t('ページの返事が変でした')));
        return;
      }
      const rect = { x, y, width, height };
      const srcs = Array.isArray(value.srcs) ? value.srcs.filter((src): src is string => typeof src === 'string') : [];
      // 右クリックした画像か：C++ が渡した URL があるときだけ、ページが覚えた currentSrc・src と照合する（# から後ろは外す）
      if (req.url) {
        const want = withoutHash(req.url);
        if (!srcs.some((src) => withoutHash(src) === want)) {
          this.say(imageLost(t('右クリックした画像と違う画像でした')));
          return;
        }
      }
      const reply = await request((requestId) => ({ type: 'captureFull', requestId, id: tab.id, maxEdge: CAPTURE_LONG_EDGE, rect }), 8_000);
      if (reply?.type !== 'capture' || !reply.ok || !reply.image) {
        this.say(captureFailure(reply));
        return;
      }
      const fit = await fitCaptureImage(reply.image);
      if ('error' in fit) {
        this.say(t('撮った画像を整えられませんでした（{0}）', { 0: FIT_STAGE[fit.error] }));
        return;
      }
      const result = await this.host.store.add(fit.dataUrl, sourceOf(tab.url, tab.title));
      if (!result.ok) {
        this.say(addFailure(result.reason));
        return;
      }
      this.images.set(result.item.id, fit.dataUrl);
      added = result.item;
      if (this.folded) this.setFolded(false);
      let note = reply.cropped ? t('画像の見えている部分だけを残しました（AI には送りません）') : t('画像を撮影に残しました（AI には送りません）');
      if (reply.reduced) note += t('。大きすぎたので細かさを下げました');
      this.say(note);
    } finally {
      this.shooting = false;
      this.render();
      if (added) this.list.querySelector(`[data-capture="${added.id}"]`)?.scrollIntoView({ block: 'nearest' });
    }
    // 写しから開くので、ファイルを読み直さない
    if (added) await this.openLarge(added);
  }

  private setFolded(folded: boolean) {
    this.folded = folded;
    saveFolded(folded);
    this.render();
  }

  private writing() {
    const active = document.activeElement;
    return active instanceof HTMLTextAreaElement && this.element.contains(active);
  }

  private say(text: string, ms = 6000, live = false) {
    this.statusText = text;
    this.live = live && text.length > 0;
    this.status.classList.toggle('is-live', this.live);
    window.clearTimeout(this.statusTimer);
    if (ms > 0) {
      this.statusTimer = window.setTimeout(() => {
        this.statusText = '';
        this.live = false;
        this.status.classList.remove('is-live');
        this.render();
      }, ms);
    }
    if (!this.onScreen()) this.host.toast(text);
    this.render();
  }

  // 送る操作の結果。上の状態行に加え、送るボタンの下と、画面下の知らせにも出す（状態行はスクロールで隠れる）
  private announce(text: string, ms = 8000) {
    if (this.ask) this.ask.notice = text;
    this.host.toast(text);
    this.say(text, ms);
    this.element.querySelector('.capture-ask-notice')?.scrollIntoView({ block: 'nearest' });
  }

  private onScreen() {
    const box = this.element.getBoundingClientRect();
    if (box.height === 0) return false;
    const scroller = this.element.closest('.panels-scroll');
    const view = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    return box.bottom > view.top && box.top < view.bottom;
  }

  // 撮影の一覧を読めていないときは、撮る操作を始めない。理由を言って true を返す（待たせて無反応にしない）
  private storeBlocks() {
    const state = this.host.store.state;
    if (state === 'ready') return false;
    this.say(state === 'loading' ? t('撮影の一覧を読み込んでいます。少し待ってから押してください') : READONLY_SHORT);
    return true;
  }

  private async askOcr() {
    const reply = await request((requestId) => ({ type: 'readCaptureText', requestId, command: 'query' }), 4_000);
    this.ocrReady = reply?.type === 'captureText' && reply.ok;
    this.render();
  }

  private async readText(shown: CaptureItem) {
    if (this.readingId || this.ocrReady !== true) return;
    // 描いたときの写しではなく、いまの台帳の項目で読む（書いている間に、隠した結果が保存されていることがある）
    const item = this.host.store.items.find((row) => row.id === shown.id);
    if (!item) return;
    if (this.recording) {
      this.say(t('録画中です。止めてから読んでください'));
      return;
    }
    const cached = this.images.get(item.id);
    const image = typeof cached === 'string' ? cached : await this.fetchImage(item.id);
    if (!image) {
      this.say(t('画像を読めませんでした'));
      return;
    }
    this.readingId = item.id;
    if (this.pick?.id === item.id) this.pick = null;
    this.say(t('文字を読んでいます'), 0);
    const body = item.scope === 'center' ? this.pageBody() : Promise.resolve(null);
    // 隠した所があると、録画の時刻ごとの画面は隠れていない。代表の画像だけから読む
    //   （文字だけ隠した行が 1 つでもあるときも同じ。時刻ごとの画面を読み直すと、隠した文字が戻ってしまう）
    const hiddenSome = item.blur.length > 0 || (item.ocr ?? []).some((line) => line.text === HIDDEN_TEXT);
    const times = hiddenSome ? undefined : item.video?.times.slice(0, 20);
    const reply = await request(
      (requestId) => ({ type: 'readCaptureText', requestId, command: 'read', id: item.id, image, ...(times ? { times } : {}) }),
      90_000,
    );
    const pageText = await body;
    if (this.readingId === item.id) this.readingId = null;
    if (!reply || reply.type !== 'captureText') {
      this.say(t('文字の返事が来ませんでした'));
      return;
    }
    if (!reply.ok) {
      if (reply.error === 'noJapanese') this.say(NO_JAPANESE, 12_000);
      else this.say(ocrFailure(reply.error));
      return;
    }
    const lines = ocrLinesFromHost(reply.lines);
    await this.host.store.setOcr(item.id, lines, item.scope === 'center' ? pageText : null);
    if (lines.length === 0) this.say(t('文字は見つかりませんでした'));
    else if (item.video && hiddenSome) this.say(t('{0} 行読みました（隠した所があるので、代表の画面だけを読みました）', { 0: lines.length }), 6000);
    else this.say(t('{0} 行読みました', { 0: lines.length }), 4000);
  }

  private async pageBody(): Promise<string | undefined> {
    const tab = this.host.activeTab();
    if (!tab) return undefined;
    const page = await requestPageText(tab.id);
    if (page.error) return undefined;
    const chosen = page.selection && page.selection.trim() ? page.selection : (page.text ?? '');
    return [...chosen].slice(0, PAGE_TEXT_MAX).join('');
  }

  // 描いたときの写し（item）ではなく、いまの台帳の行を切り替える（読み直しや隠したあとに古い行を戻さない）
  private toggleLine(item: CaptureItem, lineId: string, on: boolean) {
    const latest = this.host.store.items.find((row) => row.id === item.id);
    if (!latest) return;
    const lines = (latest.ocr ?? []).map((line) => (line.id === lineId ? { ...line, on } : line));
    void this.host.store.setOcr(latest.id, lines);
  }

  private async askRecord() {
    const reply = await request((requestId) => ({ type: 'recordCenter', requestId, command: 'query' }), 4_000);
    this.recordReady = reply?.type === 'record' && reply.ok;
    this.render();
  }

  private onProgress(seconds: number, limit: number) {
    if (!this.recording) return;
    const cap = limit > 0 ? limit : RECORD_LIMIT_SECONDS;
    const shown = seconds < 0 ? 0 : seconds > cap ? cap : seconds;
    this.recordSeconds = shown;
    this.recordLimit = cap;
    const label = this.head.querySelector('.capture-rec');
    if (label) label.textContent = recLabel(shown, cap);
    else this.render();
  }

  private async onRecorded(msg: Extract<HostMessage, { type: 'recordDone' }>) {
    const id = msg.id;
    const source = this.recordSource;
    this.recording = false;
    this.stopping = false;
    this.recordSource = undefined;
    try {
      await this.keepRecorded(msg, source);
    } finally {
      // 保存し終えた（あきらめた）ことを C++ に知らせる。閉じる途中の C++ が、これを待つ
      if (id) send({ type: 'recordCenter', command: 'saved', id });
    }
  }

  // 録画のカードを台帳に足す。代表の画像が作れなくても、仮の画像でカードは作る。mp4 は、上限のときだけ消す
  private async keepRecorded(msg: Extract<HostMessage, { type: 'recordDone' }>, source: CaptureSource | undefined) {
    const id = msg.id;
    if (!msg.ok || !id || !msg.times) {
      this.say(recordFailure(msg.error));
      return;
    }
    const video: CaptureVideo = {
      seconds: typeof msg.seconds === 'number' ? msg.seconds : 0,
      bytes: typeof msg.bytes === 'number' ? msg.bytes : 0,
      times: msg.times,
    };
    let image: string | null = null;
    if (msg.image) {
      const fit = await fitCaptureImage(msg.image);
      if (!('error' in fit)) image = fit.dataUrl;
    }
    if (!image) image = placeholderRecordImage(video.seconds);
    if (!image) {
      this.say(t('録画の代表の画像を作れませんでした。動画は ui-data\\captures に残っています'));
      return;
    }
    this.images.set(id, image);
    const saved = await this.host.store.addRecorded(id, image, source, video);
    if (!saved.ok) {
      this.images.delete(id);
      if (saved.reason === 'full') {
        await this.deleteVideo(id);
        this.say(t('撮影は {0} 件までです。古いカードを消してから撮ってください', { 0: CAPTURE_LIMIT }));
      } else {
        this.say(t('録画のカードを保存できませんでした。動画は ui-data\\captures に残っています'));
      }
      return;
    }
    if (this.folded) this.setFolded(false);
    this.say(msg.note ? t('録画は途中で止まりました。そこまでを残しました') : t('このパソコンの中に残しました。AI には送りません'));
    this.list.querySelector(`[data-capture="${saved.item.id}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  private async beginRecord() {
    if (this.recording || this.stopping || this.shooting) return;
    if (this.recordReady === false) {
      this.say(t('このパソコンでは録画できません'));
      return;
    }
    if (this.storeBlocks()) return;
    if (this.host.store.items.length >= CAPTURE_LIMIT) {
      this.say(t('撮影は {0} 件までです。古いカードを消してから撮ってください', { 0: CAPTURE_LIMIT }));
      return;
    }
    const tab = this.host.activeTab();
    if (!tab) {
      this.say(t('中央にページがありません'));
      return;
    }
    const id = newCaptureId();
    this.recording = true;
    this.recordSeconds = 0;
    this.recordLimit = RECORD_LIMIT_SECONDS;
    this.recordSource = sourceOf(tab.url, tab.title);
    if (this.folded) this.setFolded(false);
    this.render();
    const reply = await request((requestId) => ({ type: 'recordCenter', requestId, command: 'start', id }), 8_000);
    if (reply?.type !== 'record' || !reply.ok) {
      this.recording = false;
      this.recordSource = undefined;
      if (reply?.type === 'record' && reply.error === 'unavailable') this.recordReady = false;
      this.say(recordFailure(reply?.type === 'record' ? reply.error : undefined));
      return;
    }
  }

  private async endRecord() {
    if (!this.recording || this.stopping) return;
    this.stopping = true;
    this.render();
    const reply = await request((requestId) => ({ type: 'recordCenter', requestId, command: 'stop' }), 8_000);
    if (reply?.type === 'record' && !reply.ok) {
      this.recording = false;
      this.stopping = false;
      this.recordSource = undefined;
      this.say(recordFailure(reply.error));
    }
  }

  // mp4 を消してもらう。返事（無ければ null）を返す。busy は、読み取りか再生で使っている途中
  private deleteVideo(id: string) {
    return request((requestId) => ({ type: 'recordCenter', requestId, command: 'delete', id }), 4_000);
  }

  // 録画のカードを消す。mp4 を先に消し、消せた（または元から無い）ときだけカードを消す。消せなければカードは残す
  private async removeRecorded(id: string) {
    this.render();
    const reply = await this.deleteVideo(id);
    if (reply?.type === 'record' && (reply.ok || reply.error === 'badId')) {
      this.images.delete(id);
      await this.host.store.remove(id);
      return;
    }
    if (reply?.type === 'record' && reply.error === 'busy') {
      this.say(t('動画を使っている途中なので消せませんでした（文字を読んでいるか、再生中です）'));
      return;
    }
    this.say(t('動画を消せたか確かめられませんでした。もう一度押してください'));
  }

  // 「mp4 だけ消す」。2 段（1 回目で「本当に mp4 を消す」）。mp4 を消せた（または元から無い）ときだけ、台帳の video を外す
  private askDropVideo(item: CaptureItem) {
    if (this.recording) {
      this.say(t('録画中です。止めてから消してください'));
      return;
    }
    if (this.readingId === item.id) {
      this.say(t('文字を読んでいる間は消せません。読み終えてから消してください'));
      return;
    }
    if (this.dropVideoId !== item.id) {
      this.dropVideoId = item.id;
      this.render();
      return;
    }
    this.dropVideoId = null;
    void this.dropMp4(item.id);
  }

  private async dropMp4(id: string) {
    this.render();
    const reply = await this.deleteVideo(id);
    if (reply?.type === 'record' && (reply.ok || reply.error === 'badId')) {
      if (await this.host.store.dropVideo(id)) this.say(t('mp4 を消しました。代表の画像のカードとして残ります'));
      else this.say(t('mp4 は消しましたが、一覧の保存に失敗しました。アプリを開き直すと、録画のカードのまま残ることがあります'));
      return;
    }
    if (reply?.type === 'record' && reply.error === 'busy') {
      this.say(t('動画を使っている途中なので消せませんでした（文字を読んでいるか、再生中です）'));
      return;
    }
    this.say(t('mp4 を消せたか確かめられませんでした。もう一度押してください'));
  }

  private hideBusy(item: CaptureItem) {
    return this.readingId !== null || this.hidingId !== null || (this.ask?.id === item.id && this.ask.sending);
  }

  // 行から隠す共通の入口（行ごとの「隠す」・選んだ行・候補）。最新の項目を引き直してから、塗る矩形と文字だけ隠す行に分ける。
  //   録画で、代表の画像（最後のコマ）と別の時刻の行は、矩形が代表の画像の別の場所を塗ってしまうので、文字だけ隠す
  private async hideLines(shown: CaptureItem, lineIds: readonly string[]) {
    if (this.hidingId !== null || this.readingId !== null) return;
    const item = this.host.store.items.find((row) => row.id === shown.id);
    if (!item) return;
    const wanted = new Set(lineIds);
    const lines = (item.ocr ?? []).filter((line) => wanted.has(line.id) && line.text !== HIDDEN_TEXT);
    if (lines.length === 0) {
      this.say(t('隠す行がありません（もう隠してあるか、読み直されました）'));
      return;
    }
    const last = item.video ? item.video.times[item.video.times.length - 1] : undefined;
    const drawn: CaptureOcrLine[] = [];
    let textOnly = 0;
    // 代表の画像（最後の時刻）に無い行は、文字だけ隠す（矩形で塗ると、代表の画像の別の場所を塗ってしまう）。
    //   「mp4 だけ消す」のあとは、代表の画像の行だけ at を外してあるので、at が残る行は別の時刻の行
    for (const line of lines) {
      if (typeof line.at === 'number' && (!item.video || line.at !== last)) textOnly += 1;
      else drawn.push(line);
    }
    const rects = lineHideRects(drawn);
    if (rects.length === 0 && textOnly === 0) {
      this.say(t('行の場所が分からないので、隠せませんでした'));
      return;
    }
    const before = hiddenLineCount(item);
    this.hidingId = item.id;
    this.render();
    let result: HideResult = { ok: false, reason: 'write' };
    try {
      result = await this.host.store.hide(item.id, { rects, mode: 'fill', lineIds: lines.map((line) => line.id) });
    } catch {
      // 落ちたときは、書けなかったものとして扱う
    } finally {
      this.hidingId = null;
    }
    if (!result.ok) {
      this.say(hideFailure(result.reason));
      return;
    }
    // 右の起動時の購読も画像を差し替えるが、ここでも差し替えておく（同じ画像なので重なっても害は無い）
    this.replaceImage(item.id, result.image);
    if (this.pick?.id === item.id) this.pick = null;
    const now = this.host.store.items.find((row) => row.id === item.id);
    // 重なって一緒に隠れた行も数える
    const count = Math.max(lines.length, now ? hiddenLineCount(now) - before : 0);
    let text =
      rects.length > 0
        ? t('{0} 行を隠しました（画像と読んだ文字）。取り消しは「大きく開く」の画面で', { 0: count })
        : t('{0} 行を隠しました（読んだ文字だけ。録画の別の時刻の行なので、代表の画像は塗っていません）。取り消しは「大きく開く」の画面で', { 0: count });
    if (item.askedAt) text += t('。送った写しは隠れません');
    if (item.video) text += t('。mp4 は隠れません');
    if (!result.saved) text += INDEX_NOT_SAVED;
    this.say(text, 10000);
  }

  // 候補の行をまとめて隠す。候補は、押した時点の最新の行から引き直す
  private hideCandidateLines(shown: CaptureItem) {
    const item = this.host.store.items.find((row) => row.id === shown.id);
    if (!item) return;
    const ids = hideCandidates(item.ocr ?? []).map((row) => row.id);
    if (ids.length === 0) {
      this.say(t('隠す候補の行はありません'));
      return;
    }
    void this.hideLines(item, ids);
  }

  private async playVideo(id: string) {
    const reply = await request((requestId) => ({ type: 'recordCenter', requestId, command: 'open', id }), 4_000);
    if (reply?.type === 'record' && reply.ok) return;
    if (reply?.type === 'record' && reply.error === 'busy') this.say(t('動画を使っている途中です'));
    else this.say(t('動画を開けませんでした'));
  }

  private async shoot() {
    if (this.recording) {
      this.say(t('録画中です。止めてから撮ってください'));
      return;
    }
    if (this.shooting) return;
    if (this.storeBlocks()) return;
    if (this.host.store.items.length >= CAPTURE_LIMIT) {
      this.say(t('撮影は {0} 件までです。古いカードを消してから撮ってください', { 0: CAPTURE_LIMIT }));
      return;
    }
    const tab = this.host.activeTab();
    if (!tab) {
      this.say(t('中央にページがありません'));
      return;
    }
    this.shooting = true;
    this.say(t('中央の見えている所を撮っています'), 0);
    let addedId: string | null = null;
    try {
      const reply = await request((requestId) => ({ type: 'captureFull', requestId, id: tab.id, maxEdge: CAPTURE_LONG_EDGE }), 8_000);
      if (reply?.type !== 'capture' || !reply.ok || !reply.image) {
        this.say(captureFailure(reply));
        return;
      }
      const fit = await fitCaptureImage(reply.image);
      if ('error' in fit) {
        this.say(t('撮った画像を整えられませんでした（{0}）', { 0: FIT_STAGE[fit.error] }));
        return;
      }
      const saved = await this.host.store.add(fit.dataUrl, sourceOf(tab.url, tab.title));
      if (!saved.ok) {
        this.say(addFailure(saved.reason));
        return;
      }
      this.images.set(saved.item.id, fit.dataUrl);
      addedId = saved.item.id;
      if (this.folded) this.setFolded(false);
      this.say(t('このパソコンの中に残しました。AI には送りません'));
    } finally {
      this.shooting = false;
      this.render();
      if (addedId) this.list.querySelector(`[data-capture="${addedId}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  }

  private async shootScreen(scope: 'window' | 'desktop') {
    if (this.recording) {
      this.say(t('録画中です。止めてから撮ってください'));
      return;
    }
    if (this.shooting) return;
    if (this.storeBlocks()) return;
    if (this.host.store.items.length >= CAPTURE_LIMIT) {
      this.say(t('撮影は {0} 件までです。古いカードを消してから撮ってください', { 0: CAPTURE_LIMIT }));
      return;
    }
    this.shooting = true;
    this.say(t('● 撮っています'), 0, true);
    await paintWait();
    let addedId: string | null = null;
    try {
      const reply = await request((requestId) => ({ type: 'captureScreen', requestId, scope }), 12_000);
      if (reply?.type !== 'capture' || !reply.ok || !reply.image) {
        this.say(screenFailure(reply, scope));
        return;
      }
      const via = reply.via === 'wgc' || reply.via === 'gdi' ? reply.via : undefined;
      addedId = (await this.keepImage(reply.image, scope, undefined, via)) ?? null;
    } finally {
      this.shooting = false;
      this.render();
      if (addedId) this.list.querySelector(`[data-capture="${addedId}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  }

  private async beginRegion() {
    if (this.recording) {
      this.say(t('録画中です。止めてから撮ってください'));
      return;
    }
    if (this.shooting) return;
    if (this.storeBlocks()) return;
    if (this.host.store.items.length >= CAPTURE_LIMIT) {
      this.say(t('撮影は {0} 件までです。古いカードを消してから撮ってください', { 0: CAPTURE_LIMIT }));
      return;
    }
    this.shooting = true;
    this.regionVia = undefined;
    this.say(t('● 撮っています'), 0, true);
    await paintWait();
    try {
      const reply = await request((requestId) => ({ type: 'captureScreen', requestId, scope: 'window' }), 12_000);
      if (reply?.type !== 'capture' || !reply.ok || !reply.image) {
        this.say(screenFailure(reply, 'window'));
        return;
      }
      const fit = await fitCaptureImage(reply.image);
      if ('error' in fit) {
        this.say(t('撮った画像を整えられませんでした（{0}）', { 0: FIT_STAGE[fit.error] }));
        return;
      }
      this.regionVia = reply.via === 'wgc' || reply.via === 'gdi' ? reply.via : undefined;
      this.host.askLeft({ command: 'openCrop', image: fit.dataUrl });
      this.say(t('囲む範囲を、読む画面で指定してください'), 0);
    } finally {
      this.shooting = false;
      this.render();
    }
  }

  private async keepImage(image: string, scope: CaptureScope, source: ReturnType<typeof sourceOf>, via?: CaptureVia) {
    const fit = await fitCaptureImage(image);
    if ('error' in fit) {
      this.say(t('撮った画像を整えられませんでした（{0}）', { 0: FIT_STAGE[fit.error] }));
      return;
    }
    const saved = await this.host.store.add(fit.dataUrl, source, scope, via);
    if (!saved.ok) {
      this.say(addFailure(saved.reason));
      return;
    }
    this.images.set(saved.item.id, fit.dataUrl);
    if (this.folded) this.setFolded(false);
    this.say(t('このパソコンの中に残しました。AI には送りません'));
    return saved.item.id;
  }

  private imageOf(id: string): string | null | undefined {
    if (this.images.has(id)) return this.images.get(id) ?? null;
    if (this.loading.has(id)) return undefined;
    this.loading.add(id);
    void this.fetchImage(id).then(() => {
      this.loading.delete(id);
      this.render();
    });
    return undefined;
  }

  // ファイルから画像を読んで、写し（images）に入れて返す。読んでいる間に replaceImage（隠した・取り消した）が来ていたら、
  //   読んだ古い画像は写しに入れず、新しい写しを返す（カードが消えていれば null）
  private async fetchImage(id: string): Promise<string | null> {
    const generation = this.imageGen.get(id) ?? 0;
    const data = await this.host.store.loadImage(id);
    if ((this.imageGen.get(id) ?? 0) !== generation) {
      const fresh = this.images.get(id);
      return typeof fresh === 'string' ? fresh : null;
    }
    this.images.set(id, data);
    return data;
  }

  private menuFor(item: CaptureItem): MenuEntry[] {
    const entries: MenuEntry[] = [
      { section: t('いいね') },
      {
        pills: LEVELS.map((level) => ({
          label: LIKE_LABEL[level],
          current: item.liked === level,
          close: true,
          title: item.liked === level ? t('もう一度押すと、いいねを外します') : t('この撮影を{0}にする', { 0: LIKE_LABEL[level] }),
          run: () => {
            const next = item.liked === level ? 0 : level;
            void this.host.store.setLiked(item.id, next);
            this.host.toast(next === 0 ? t('いいねを外しました') : t('{0}にしました', { 0: LIKE_LABEL[level] }));
          },
        })),
      },
      {
        label: t('書き込みつきでコピー'),
        hint: t('線・文字・スタンプを焼いた画像をクリップボードへ'),
        run: () => void this.copyBurned(item),
      },
    ];
    if (item.source) {
      const source = item.source;
      entries.push({
        label: t('ページを開く'),
        hint: hostOf(source.url),
        run: () => this.host.askLeft({ command: 'openUrl', url: source.url, background: false }),
      });
    }
    entries.push({ label: t('単語カードにする…'), hint: t('画像を指すカード'), run: () => this.makeCard(item) });
    entries.push('sep', {
      label: t('この撮影を消す…'),
      run: () => {
        this.confirmId = item.id;
        this.render();
        this.host.toast(t('もう一度、カードの「本当に消す」を押してください'));
      },
    });
    return entries;
  }

  // 単語カードにする（K6c-2）：この撮影の画像を指すカードを、入れる小窓で直してから左の単語帳へ頼む（画像は写さない・元の撮影は変えない）
  private makeCard(item: CaptureItem) {
    const oneLine = (text: string, max: number) => [...text.replace(/\s+/g, ' ').trim()].slice(0, max).join('');
    // 表の候補：印の付いた行を先に（表をつないだ追加の行とぼかした行は使わない）。小窓で直せる
    const lines = (item.ocr ?? []).filter((line: CaptureOcrLine) => !line.table && line.text.trim() !== '' && line.text !== HIDDEN_TEXT);
    const firstLine = lines.find((line) => line.on) ?? lines[0];
    this.host.menu.confirmVocab(
      {
        kind: 'word',
        front: oneLine(firstLine?.text ?? item.comment, 400),
        back: '',
        example: '',
        note: t('右の単語帳に入ります。カードはこの撮影の画像を指します（撮影は 80 件まで。古いものから消えます）'),
        rotate: savedMarkNew(),
      },
      (value) => {
        this.host.askLeft({
          command: 'addCards',
          cards: [{ ...value, image: { kind: 'capture', id: item.id }, ...(item.source ? { source: { url: item.source.url, title: item.source.title } } : {}) }],
        });
        this.host.toast(t('単語帳に入れました（右の「単語帳」で見られます）'));
      },
    );
  }

  // 拡大。scene を渡したときだけ、書き込みを画像の上に重ねる（カードの画像から開くとき）。
  //   送る画像の下見・切り抜きから開くときは、書き込みを焼いた画像なので scene は渡さない（重ねると二重になる）
  private openLightbox(dataUrl: string, note: string, alt = t('撮った画像'), scene?: () => AnnotationScene) {
    this.closeLightbox();
    const view = el('div', 'capture-lightbox');
    const img = el('img');
    img.src = dataUrl;
    img.alt = alt;
    const bar = el('div', 'capture-lightbox-bar');
    const close = el('button', '', t('閉じる（Esc）'));
    close.type = 'button';
    close.addEventListener('click', () => this.closeLightbox());
    bar.append(el('span', '', note), close);
    if (scene) {
      // 画像と canvas を同じ枠に入れる（canvas を画像にぴったり重ねるため）
      const frame = el('div', 'capture-lightbox-frame');
      const canvas = el('canvas', 'capture-lightbox-draw capture-draw');
      canvas.setAttribute('aria-hidden', 'true');
      frame.append(img, canvas);
      view.append(frame, bar);
      this.lightboxOverlay = attachAnnotationOverlay(img, canvas, scene, () => overlayOptions(img, canvas));
    } else {
      view.append(img, bar);
    }
    view.addEventListener('click', (event) => {
      if (event.target === view || (event.target instanceof HTMLElement && event.target.classList.contains('capture-lightbox-frame'))) this.closeLightbox();
    });
    document.body.append(view);
    this.lightbox = view;
    window.addEventListener('keydown', this.onLightboxKey, true);
    close.focus();
  }

  private closeLightbox() {
    this.lightboxOverlay?.dispose();
    this.lightboxOverlay = null;
    this.lightbox?.remove();
    this.lightbox = null;
    window.removeEventListener('keydown', this.onLightboxKey, true);
  }

  // 書き込みつきでコピー（人が見る用）。等倍で、隠した場所を塗り、線・文字・絵文字のスタンプを焼いて、クリップボードの画像にする。
  //   「送った」の印は付けない（外には出さない）。コピーした画像は、あとで隠しても変わらない
  private async copyBurned(shown: CaptureItem) {
    const item = this.host.store.items.find((row) => row.id === shown.id) ?? shown;
    const src = await this.imageReady(item.id);
    if (!src) {
      this.say(t('書き込みつきの画像をコピーできませんでした（画像を読めません）'));
      return;
    }
    const burned = await burnImage(src, askScene(item), { marks: 'badge' });
    if (!burned) {
      this.say(t('書き込みつきの画像をコピーできませんでした（画像を作れません）'));
      return;
    }
    const payload = await clipboardImageBase64(burned);
    if (!payload) {
      this.say(t('書き込みつきの画像をコピーできませんでした（大きすぎるか、読めません）'));
      return;
    }
    const copied = await copyShotImageResult(payload, 'white');
    if (!copied.ok) {
      // 「アプリは開いていません」は Grok Bot へ送るときの言い回しなので、ここでは外す
      this.say(copied.message.replace(/。?アプリは開いていません$/, ''));
      return;
    }
    this.say(t('書き込みつきの画像をコピーしました。コピーした画像は、あとで隠しても変わりません'));
  }

  private queueComment(id: string, text: string) {
    window.clearTimeout(this.commentTimer);
    this.commentTimer = window.setTimeout(() => void this.host.store.setComment(id, text), 500);
  }

  // いまの台帳の、その撮影の書き込み（拡大を開いたまま書き込みが変わっても、描き直しで追いつくため）
  private latestScene(id: string): AnnotationScene | undefined {
    const latest = this.host.store.items.find((row) => row.id === id);
    return latest ? askScene(latest) : undefined;
  }

  render() {
    // 拡大を開いているなら、いまの書き込みで描き直す（ひとことを書いている間も）
    this.lightboxOverlay?.repaint();
    if (this.writing()) {
      this.dirty = true;
      return;
    }
    this.dirty = false;
    const store = this.host.store;
    this.element.classList.toggle('folded', this.folded);

    const fold = el('button', 'capture-fold', this.folded ? '▸' : '▾');
    fold.type = 'button';
    fold.title = this.folded ? t('撮影を開く') : t('撮影をたたむ');
    fold.setAttribute('aria-label', fold.title);
    fold.setAttribute('aria-expanded', String(!this.folded));
    fold.addEventListener('click', () => this.setFolded(!this.folded));
    const title = el('span', 'capture-title', t('撮影'));
    const state = store.state;
    const count = el('span', 'capture-count', state === 'ready' ? `${store.items.length}` : state === 'loading' ? '…' : '!');
    count.title = state === 'ready' ? t('{0} / {1} 件', { 0: store.items.length, 1: CAPTURE_LIMIT }) : state === 'loading' ? t('読み込んでいます') : t('撮影の一覧を読めていません');
    if (this.recording) {
      const live = el('span', 'capture-rec', recLabel(this.recordSeconds, this.recordLimit));
      live.setAttribute('role', 'status');
      const stop = el('button', 'capture-stop', this.stopping ? t('止めています…') : t('停止'));
      stop.type = 'button';
      stop.disabled = this.stopping;
      stop.addEventListener('click', () => this.stopRecord());
      this.head.replaceChildren(fold, title, count, live, stop);
    } else {
      const shoot = el('button', 'capture-shoot', this.shooting ? t('撮っています…') : t('▣ 中央を撮る'));
      shoot.type = 'button';
      shoot.disabled = this.shooting;
      shoot.title = this.recordReady
        ? t('左クリックは、中央に見えているページです。右クリックで、録画・窓全体・この画面のデスクトップ・範囲を選べます')
        : t('左クリックは、中央に見えているページです。右クリックで、窓全体・この画面のデスクトップ・範囲を選べます');
      shoot.addEventListener('click', () => void this.shoot());
      shoot.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (this.shooting) return;
        const entries: MenuEntry[] = [{ label: t('中央の見えている所'), run: () => void this.shoot() }];
        if (this.recordReady) entries.push({ label: t('中央を録画'), run: () => this.startRecord() });
        entries.push(
          { label: t('ブラウザの窓全体'), run: () => void this.shootScreen('window') },
          { label: t('この画面のデスクトップ'), run: () => void this.shootScreen('desktop') },
          { label: t('範囲を指定…'), run: () => void this.beginRegion() },
        );
        this.host.menu.open(event.clientX, event.clientY, entries);
      });
      this.head.replaceChildren(fold, title, count, shoot);
    }

    this.status.textContent = this.statusText;
    const warning = state === 'readonly' ? readonlyText(store.failure) : '';
    if (this.readonlyNote.textContent !== warning) this.readonlyNote.textContent = warning;
    this.readonlyNote.hidden = warning === '';
    // 一覧を作り直す。前のカードの縮図に重ねていた書き込みの見張りは、まとめて止める
    for (const overlay of this.thumbOverlays.values()) overlay.dispose();
    this.thumbOverlays.clear();
    this.list.replaceChildren();
    if (state === 'loading') {
      this.list.append(el('p', 'capture-empty', t('読み込んでいます…')));
      return;
    }
    if (state === 'readonly') return;
    if (this.pick && !store.items.some((item) => item.id === this.pick?.id)) this.pick = null;
    if (store.items.length === 0) {
      const hint = this.recordReady
        ? t('まだありません。中央にページを出してから「中央を撮る」を押すと、見えている所が残ります。右クリックの「中央を録画」で、同じ範囲を mp4 にできます。')
        : t('まだありません。中央にページを出してから「中央を撮る」を押すと、見えている所が残ります。');
      this.list.append(el('p', 'capture-empty', hint));
      return;
    }
    for (const item of store.items) this.list.append(this.card(item));
    if (this.ask && !store.items.some((item) => item.id === this.ask?.id)) this.ask = null;
    else if (this.ask) {
      void this.refreshBundle();
      this.refreshShot();
    }
  }

  private async openLarge(shown: CaptureItem) {
    // 描いたときの写しではなく、いまの台帳の項目で開く（隠した・描き足したあとの矩形や線を渡す）
    const item = this.host.store.items.find((row) => row.id === shown.id) ?? shown;
    const cached = this.images.get(item.id);
    const image = typeof cached === 'string' ? cached : await this.fetchImage(item.id);
    if (!image) {
      this.say(t('画像を読めませんでした'));
      return;
    }
    this.host.askLeft({
      command: 'openCapture',
      id: item.id,
      image,
      marks: item.marks,
      strokes: item.strokes,
      blur: item.blur,
      title: item.source?.title || (item.from ? captureFromTitle(item.from) : '') || t('撮った画像'),
      ...(item.askedAt ? { askedAt: item.askedAt } : {}),
      video: !!item.video,
      undo: this.host.store.canUndo(item.id),
    });
  }

  // 隠したあと。カードのサムネイルを、置き換えた JPEG にする
  replaceImage(id: string, dataUrl: string) {
    this.imageGen.set(id, (this.imageGen.get(id) ?? 0) + 1);
    this.images.set(id, dataUrl);
    this.closeLightbox();
    this.render();
  }

  private card(item: CaptureItem) {
    const card = el('article', 'capture-card');
    card.dataset.capture = item.id;
    if (item.id === this.revealedId) card.classList.add('is-revealed');
    card.addEventListener('contextmenu', (event) => {
      if (event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      this.host.menu.open(event.clientX, event.clientY, this.menuFor(item));
    });

    const data = this.imageOf(item.id);
    const thumb = el('button', 'capture-thumb');
    thumb.type = 'button';
    if (typeof data === 'string') {
      const img = el('img');
      img.src = data;
      img.alt = t('撮った画像');
      thumb.append(img);
      // 書き込み（線・文字・スタンプと番号）と、隠した場所の枠は、読む画面と同じ描き手で重ねる
      const scene: AnnotationScene = { strokes: item.strokes, marks: item.marks, blur: item.blur };
      const draw = el('canvas', 'capture-thumb-draw capture-draw');
      draw.setAttribute('aria-hidden', 'true');
      thumb.append(draw);
      this.thumbOverlays.get(item.id)?.dispose();
      this.thumbOverlays.set(
        item.id,
        attachAnnotationOverlay(img, draw, () => scene, () => overlayOptions(img, draw)),
      );
      // 読んだ行の青い枠は、そのまま残す
      for (const line of item.ocr ?? []) {
        if (line.on) thumb.append(rectBox('capture-ocr-box', line));
      }
      thumb.title = t('大きく見る');
      // 拡大は開いている間も、いまの台帳の書き込みで描く（読む画面で書き込みを変えたら、描き直しで追いつく）
      thumb.addEventListener('click', () => this.openLightbox(data, lightboxNote(item), t('撮った画像'), () => this.latestScene(item.id) ?? scene));
    } else {
      thumb.disabled = true;
      thumb.textContent = data === null ? t('画像を読めませんでした') : t('画像を読んでいます…');
    }

    const when = el('p', 'capture-when', `${scopeLabel(item)} · ${whenOf(item.createdAt)}`);
    const comment = el('textarea', 'capture-comment');
    comment.rows = 2;
    comment.maxLength = COMMENT_MAX;
    comment.placeholder = t('ひとこと（なくてもよい）');
    comment.value = item.comment;
    comment.setAttribute('aria-label', 'ひとこと');
    const counter = el('span', [...item.comment].length > COMMENT_HINT ? 'capture-count-line is-long' : 'capture-count-line', countLabel(item.comment));
    const paintCount = () => {
      const text = clipComment(comment.value);
      if (text !== comment.value) comment.value = text;
      counter.textContent = countLabel(text);
      counter.classList.toggle('is-long', [...text].length > COMMENT_HINT);
    };
    comment.addEventListener('input', () => {
      paintCount();
      this.queueComment(item.id, comment.value);
    });
    comment.addEventListener('blur', () => {
      window.clearTimeout(this.commentTimer);
      void this.host.store.setComment(item.id, comment.value);
    });

    const actions = el('div', 'capture-actions');
    if (this.ocrReady) {
      const read = el('button', 'capture-read', this.readingId === item.id ? t('読んでいます…') : t('文字を読む'));
      read.type = 'button';
      read.disabled = this.readingId !== null;
      read.title = t('画像の中の文字を、行にして残します。表に見えるところは | でつながります');
      read.addEventListener('click', () => void this.readText(item));
      actions.append(read);
    }
    const askOpen = el('button', 'capture-ask-open', this.ask?.id === item.id ? t('閉じる') : t('AIに頼む'));
    askOpen.type = 'button';
    askOpen.title = t('送る前に、画像・文字・URLを確かめます。勝手には送りません');
    askOpen.addEventListener('click', () => this.toggleAsk(item));
    actions.append(askOpen);
    if (item.video) {
      const play = el('button', 'capture-play', t('再生'));
      play.type = 'button';
      play.title = t('このパソコンの動画アプリで、mp4 を開きます');
      play.addEventListener('click', () => void this.playVideo(item.id));
      actions.append(play);
      const confirming = this.dropVideoId === item.id;
      const dropMp4 = el('button', confirming ? 'capture-drop-video is-confirm' : 'capture-drop-video', confirming ? t('本当に mp4 を消す') : t('mp4 だけ消す'));
      dropMp4.type = 'button';
      dropMp4.title = t('このパソコンの mp4 だけを消します。代表の画像のカードは残ります。元には戻せません');
      dropMp4.addEventListener('click', () => this.askDropVideo(item));
      if (confirming) armConfirm(dropMp4, () => {
        this.dropVideoId = null;
        this.render();
      });
      actions.append(dropMp4);
    }
    const widen = el('button', 'capture-widen', t('大きく開く'));
    widen.type = 'button';
    widen.title = t('読む画面に、この画像だけを出します。アドレス欄はありません');
    widen.addEventListener('click', () => void this.openLarge(item));
    const like = el('button', item.liked > 0 ? 'capture-like is-on' : 'capture-like', item.liked > 0 ? `♥${item.liked}` : '♡');
    like.type = 'button';
    like.title = t('いいね（押すたびに 1→2→3→なし）。右クリックで、いいね1・2・3を直接選べます');
    like.addEventListener('click', () => void this.host.store.setLiked(item.id, (item.liked + 1) % 4));
    const remove = el('button', this.confirmId === item.id ? 'capture-delete is-confirm' : 'capture-delete', this.confirmId === item.id ? '本当に消す' : t('消す'));
    remove.type = 'button';
    if (this.confirmId === item.id) armConfirm(remove, () => {
      this.confirmId = null;
      this.render();
    });
    remove.addEventListener('click', () => {
      // 録画は、文字を読んでいる間は mp4 を開いているので、消さない
      if (item.video && this.readingId === item.id) {
        this.say(t('文字を読んでいる間は消せません。読み終えてから消してください'));
        return;
      }
      if (this.confirmId !== item.id) {
        this.confirmId = item.id;
        this.render();
        return;
      }
      this.confirmId = null;
      if (item.video) {
        void this.removeRecorded(item.id);
        return;
      }
      this.images.delete(item.id);
      void this.host.store.remove(item.id);
    });
    actions.append(widen, like, remove);

    card.append(thumb, when);
    if (item.askedAt) card.append(el('p', 'capture-asked', t('頼んだ {0}', { 0: whenOf(item.askedAt) })));
    if (item.video && item.video.times.length > 0) {
      const times = el('ul', 'capture-times');
      for (const ms of item.video.times) times.append(el('li', '', clockLabel(ms)));
      card.append(times);
    }
    for (const line of scopeNotes(item)) card.append(el('p', 'capture-scope-note', line));
    const pieces = pieceLines(item);
    if (pieces.length > 0) {
      const list = el('ul', 'capture-mark-list');
      for (const text of pieces) list.append(el('li', '', text));
      card.append(list);
    }
    if (item.source) {
      const source = item.source;
      const line = el('p', 'capture-source');
      line.append(el('span', 'capture-source-title', source.title || hostOf(source.url) || t('ページ')));
      const open = el('button', 'capture-open', t('ページを開く'));
      open.type = 'button';
      open.title = source.url;
      open.addEventListener('click', () => this.host.askLeft({ command: 'openUrl', url: source.url, background: false }));
      line.append(open);
      card.append(line);
    }
    if (item.pageText) {
      const body = el('p', 'capture-page-text', t('本文 {0}', { 0: item.pageText }));
      body.title = item.pageText;
      card.append(body);
    }
    if (item.ocr && item.ocr.length > 0) card.append(...this.ocrBlock(item));
    card.append(comment, counter, actions);
    if (this.ask?.id === item.id) card.append(this.askSheet(item, this.ask));
    return card;
  }

  // 読んだ行の一覧。各行の「隠す」、行を選んで隠す、隠す候補（示すだけ。既定では何も外さない）
  private ocrBlock(item: CaptureItem): HTMLElement[] {
    const lines = item.ocr ?? [];
    const kinds = new Map<string, CandidateKind>(hideCandidates(lines).map((row) => [row.id, row.kind]));
    const picking = this.pick?.id === item.id ? this.pick : null;
    const busy = this.hideBusy(item);
    const out: HTMLElement[] = [];

    const tools = el('div', 'capture-ocr-tools');
    if (kinds.size > 0) {
      tools.append(el('span', 'capture-ocr-summary', candidateSummary([...kinds.values()])));
      const all = el('button', 'capture-ocr-hide-cands', t('候補をまとめて隠す'));
      all.type = 'button';
      all.disabled = busy;
      all.title = t('候補の行を塗りつぶし、読んだ文字も「（隠した）」にします。取り消しは「大きく開く」の画面で');
      all.addEventListener('click', () => this.hideCandidateLines(item));
      tools.append(all);
    }
    if (!picking) {
      const choose = el('button', 'capture-ocr-pick-start', t('行を選んで隠す…'));
      choose.type = 'button';
      choose.disabled = busy;
      choose.title = t('隠す行を選んで、まとめて隠します。候補の行は、初めから選んであります');
      choose.addEventListener('click', () => {
        const latest = this.host.store.items.find((row) => row.id === item.id);
        if (!latest) return;
        this.pick = { id: latest.id, ids: new Set(hideCandidates(latest.ocr ?? []).map((row) => row.id)) };
        this.render();
      });
      tools.append(choose);
    }
    out.push(tools);

    // 選んでいる行（隠してある行は選べない）。数えるのは、いま選べる行のうちの選んだ数
    const selectable = new Set(lines.filter((line) => line.text !== HIDDEN_TEXT).map((line) => line.id));
    const go = el('button', 'capture-ocr-pick-go');
    go.type = 'button';
    const syncGo = () => {
      const count = picking ? [...picking.ids].filter((id) => selectable.has(id)).length : 0;
      go.textContent = t('選んだ {0} 行を隠す', { 0: count });
      go.disabled = busy || count === 0;
    };

    const list = el('ul', 'capture-ocr');
    for (const line of lines) {
      const hidden = line.text === HIDDEN_TEXT;
      const row = el('li', hidden ? 'is-hidden' : '');
      const label = el('label');
      const tick = document.createElement('input');
      tick.type = 'checkbox';
      tick.checked = line.on;
      tick.disabled = hidden; // 隠した行は送る文に入らない（「出るもの：読んだ文字」の数え方と合わせる）
      tick.addEventListener('click', (event) => event.stopPropagation());
      tick.addEventListener('change', () => this.toggleLine(item, line.id, tick.checked));
      label.append(tick, el('span', 'capture-ocr-text', line.text));
      row.append(label);
      const kind = kinds.get(line.id);
      if (kind) row.append(el('span', 'capture-ocr-cand', t('候補：{0}', { 0: CANDIDATE_LABEL[kind] })));
      if (typeof line.at === 'number') row.append(el('span', 'capture-ocr-at', clockLabel(line.at)));
      if (!hidden && picking) {
        // 「送る／送らない」のチェックとは別。隠す行を選ぶチェック
        const pick = document.createElement('input');
        pick.type = 'checkbox';
        pick.className = 'capture-ocr-pick';
        pick.checked = picking.ids.has(line.id);
        pick.disabled = busy;
        pick.title = t('隠す行に選ぶ（左の「送る／送らない」のチェックとは別です）');
        pick.setAttribute('aria-label', 'この行を隠す行に選ぶ');
        pick.addEventListener('click', (event) => event.stopPropagation());
        pick.addEventListener('change', () => {
          if (pick.checked) picking.ids.add(line.id);
          else picking.ids.delete(line.id);
          syncGo();
        });
        row.append(pick);
      } else if (!hidden) {
        const hide = el('button', 'capture-ocr-hide', t('隠す'));
        hide.type = 'button';
        hide.disabled = busy;
        hide.title = t('この行を塗りつぶし、読んだ文字も「（隠した）」にします。取り消しは「大きく開く」の画面で');
        hide.addEventListener('click', () => void this.hideLines(item, [line.id]));
        row.append(hide);
      }
      list.append(row);
    }
    out.push(list);

    if (picking) {
      const bar = el('div', 'capture-ocr-pickbar');
      go.addEventListener('click', () => void this.hideLines(item, [...picking.ids].filter((id) => selectable.has(id))));
      const cancel = el('button', 'capture-ocr-pick-cancel', t('やめる'));
      cancel.type = 'button';
      cancel.disabled = this.hidingId !== null;
      cancel.addEventListener('click', () => {
        this.pick = null;
        this.render();
      });
      syncGo();
      bar.append(go, cancel);
      out.push(bar);
    }
    return out;
  }

  private toggleAsk(item: CaptureItem) {
    if (this.ask?.id === item.id) {
      if (this.ask.sending) return;
      this.ask = null;
      this.askToken += 1;
      this.render();
      return;
    }
    void this.beginAsk(item);
  }

  private async beginAsk(item: CaptureItem) {
    const token = ++this.askToken;
    const image = await this.imageReady(item.id);
    if (token !== this.askToken) return;
    const blocked = item.source ? await pageIsBlocked(item.source.url) : false;
    if (token !== this.askToken) return;
    const latest = this.host.store.items.find((row) => row.id === item.id) ?? item;
    // 開いた時点で鍵らしき文字があれば、画像のチェックは初めから外す（警告そのものは askSheet が描くたびに引き直す）
    const secret = ocrHasSecret(latest.ocr ?? []);
    const companions = this.host.companions();
    const bots = this.host.bots();
    const dest = companions[0] ? `c:${companions[0].target}` : bots[0] ? `b:${bots[0].id}` : '';
    // ❓・⚠ のスタンプがあれば、頼み方「印について答えて」は初めから選んでおく（外せる）。切り抜きも初めから添える
    const withAskMarks = hasAskMarks(latest.marks);
    this.ask = {
      id: latest.id,
      image: typeof image === 'string' && !secret,
      burn: true,
      crops: withAskMarks,
      marks: hasMarkText(latest),
      ocr: sendableLines(latest.ocr ?? []).length > 0,
      url: !!latest.source && !blocked,
      kinds: new Set<AskKindId>(withAskMarks ? ['marks'] : []),
      note: '',
      dest,
      blocked,
      step: 'form',
      sending: false,
      tokens: 0,
      preview: '',
      notice: '',
      shot: null,
      shotKey: '',
      shotFailed: false,
    };
    this.render();
    this.element.querySelector('.capture-ask')?.scrollIntoView({ block: 'nearest' });
  }

  private async imageReady(id: string): Promise<string | null> {
    const cached = this.images.get(id);
    if (typeof cached === 'string' || cached === null) return cached;
    return this.fetchImage(id);
  }

  private askSheet(item: CaptureItem, ask: AskSession) {
    const sheet = el('div', 'capture-ask');
    sheet.addEventListener('contextmenu', (event) => event.stopPropagation());
    // 鍵らしき文字の警告は、描くたびに今の行から引き直す。画像を送るときは、チェックを外した行も画像には写っているので、
    //   隠していない行すべてで見る。文字だけを送るときは、チェックの入った行で見る。隠せば消える
    const secretLines = ask.image ? (item.ocr ?? []).filter((line) => line.text !== HIDDEN_TEXT) : ask.ocr ? sendableLines(item.ocr ?? []) : [];
    if (ocrHasSecret(secretLines)) sheet.append(el('p', 'capture-ask-warn', SECRET_WARNING));
    // 送り先の一覧。一覧に無い送り先は先頭へ戻す（切り抜きのチェックが押せるかも、ここで決まる送り先で決める）
    const options = [
      ...this.host.companions().map((row) => ({ value: `c:${row.target}`, label: row.label })),
      ...this.host.bots().map((row) => ({ value: `b:${row.id}`, label: `Grok Bot：${row.name}` })),
    ];
    if (!options.some((row) => row.value === ask.dest)) ask.dest = options[0]?.value ?? '';
    sheet.append(el('p', 'capture-ask-head', t('出ていくもの')));
    const hasImage = typeof this.images.get(item.id) === 'string';
    sheet.append(this.askCheck(t('画像') + (item.video ? t('（録画の代表1枚。mp4 は出ません）') : ''), ask.image, ask.sending || !hasImage, (on) => {
      ask.image = on;
      if (!on) ask.step = 'form';
    }));
    // 画像の下に字下げで置く、画像の出し方。画像を外すと、どちらも押せない（表示は、いま実際にそうなるかどうか）
    const companion = ask.dest.startsWith('c:');
    sheet.append(this.askCheck(t('書き込みを焼く（線・文字・印と番号）'), ask.burn && ask.image, ask.sending || !ask.image, (on) => {
      ask.burn = on;
    }, true));
    const cropCount = cropTargets(item.marks, item.strokes).length;
    if (cropCount > 0) {
      sheet.append(this.askCheck(t('印の周りを添える（{0} 枚・相棒だけ）', { 0: cropCount }), ask.crops && ask.image && companion, ask.sending || !ask.image || !companion, (on) => {
        ask.crops = on;
      }, true));
    }
    sheet.append(this.askCheck(t('印と書き込みの文'), ask.marks, ask.sending, (on) => {
      ask.marks = on;
    }));
    sheet.append(this.askCheck(t('読んだ文字（外した行は除く）'), ask.ocr, ask.sending, (on) => {
      ask.ocr = on;
    }));
    if (item.source && !ask.blocked) {
      sheet.append(this.askCheck(t('元のページの URL'), ask.url, ask.sending, (on) => {
        ask.url = on;
      }));
    }
    if (ask.blocked) sheet.append(el('p', 'capture-ask-block', BLOCK_NOTE));
    if (ask.image && hasImage) sheet.append(this.shotBlock(item, ask));
    const leave = el('p', 'capture-ask-leave', leavingLine(item, ask, this.cropsOf(item, ask).length));
    sheet.append(leave);
    const textNote = ask.ocr ? ocrSendNote(item.ocr ?? []) : '';
    if (textNote) sheet.append(el('p', 'capture-ask-textnote', textNote));
    const candidates = hideCandidates(item.ocr ?? []);
    if (candidates.length > 0 && (ask.image || ask.ocr)) {
      const warn = el('p', 'capture-ask-warn', t('隠す候補が {0} 行あります（まだ隠していません）。上の一覧で確かめてください', { 0: candidates.length }));
      const all = el('button', 'capture-ask-hide-cands', t('候補をまとめて隠す'));
      all.type = 'button';
      all.disabled = this.hideBusy(item);
      all.title = t('候補の行を塗りつぶし、読んだ文字も「（隠した）」にします。取り消しは「大きく開く」の画面で');
      all.addEventListener('click', () => this.hideCandidateLines(item));
      warn.append(' ', all);
      sheet.append(warn);
    }
    sheet.append(el('p', 'capture-ask-head', t('頼み方')));
    const kinds = el('div', 'capture-kinds');
    for (const kind of ASK_KINDS) {
      if (kind.id === 'marks' && !hasAskMarks(item.marks)) continue; // 「印について答えて」は、❓・⚠ があるときだけ
      const on = ask.kinds.has(kind.id);
      const button = el('button', on ? 'sidebar-tag is-current' : 'sidebar-tag', kind.label);
      button.type = 'button';
      // 「印について答えて」は、「印と書き込みの文」を送らないときは押せない（頼みの文が入らないので）
      const needsMarks = kind.id === 'marks' && !ask.marks;
      button.disabled = ask.sending || needsMarks;
      button.title = needsMarks ? t('「印と書き込みの文」のチェックを入れると選べます') : kind.text;
      button.setAttribute('aria-pressed', String(on));
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        if (ask.sending) return;
        if (ask.kinds.has(kind.id)) ask.kinds.delete(kind.id);
        else ask.kinds.add(kind.id);
        this.render();
      });
      button.addEventListener('contextmenu', (event) => event.stopPropagation());
      kinds.append(button);
    }
    sheet.append(kinds);
    const note = el('textarea', 'capture-ask-note');
    note.rows = 2;
    note.placeholder = t('ひとこと（500字まで。なくてもよい）');
    note.value = ask.note;
    note.disabled = ask.sending;
    note.setAttribute('aria-label', 'ひとこと');
    note.addEventListener('input', () => {
      const text = clipAskNote(note.value);
      if (text !== note.value) note.value = text;
      ask.note = text;
      void this.refreshBundle();
    });
    const noteCount = el('span', 'capture-count-line', `${[...ask.note].length} / ${ASK_NOTE_MAX}`);
    note.addEventListener('input', () => {
      noteCount.textContent = `${[...ask.note].length} / ${ASK_NOTE_MAX}`;
    });
    sheet.append(note, noteCount);
    sheet.append(el('p', 'capture-ask-head', t('送り先')));
    const dest = el('select', 'capture-ask-dest');
    dest.disabled = ask.sending;
    dest.setAttribute('aria-label', '送り先');
    if (options.length === 0) dest.append(new Option(t('送り先がありません'), ''));
    for (const row of options) dest.append(new Option(row.label, row.value));
    dest.value = ask.dest;
    dest.addEventListener('change', () => {
      ask.dest = dest.value;
      if (ask.step === 'paste' && !ask.dest.startsWith('b:')) ask.step = 'form';
      // 送り先で、切り抜きのチェックが押せるかどうかが変わる。下見（切り抜き）と送る文も引き直す
      this.render();
    });
    sheet.append(dest);
    sheet.append(el('p', 'capture-ask-head', t('送る文')));
    sheet.append(el('pre', 'capture-ask-preview', ask.preview || t('下見を作っています…')));
    sheet.append(el('p', 'capture-ask-cost', this.costLine(ask, [...ask.preview].length)));
    const send = el('button', 'capture-send', ask.sending ? t('送っています…') : ask.step === 'paste' ? t('文をコピー') : t('送る'));
    send.type = 'button';
    send.disabled = ask.sending || options.length === 0;
    send.addEventListener('click', () => void this.submitAsk());
    sheet.append(send);
    if (ask.notice) {
      const notice = el('p', 'capture-ask-notice', ask.notice);
      notice.setAttribute('role', 'status');
      sheet.append(notice);
    }
    return sheet;
  }

  // sub：画像のチェックの下に字下げで置く、画像の出し方のチェック
  private askCheck(label: string, on: boolean, disabled: boolean, set: (on: boolean) => void, sub = false) {
    const row = el('label', sub ? 'capture-ask-check capture-ask-sub' : 'capture-ask-check');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = on;
    box.disabled = disabled;
    box.addEventListener('click', (event) => event.stopPropagation());
    box.addEventListener('change', () => {
      set(box.checked);
      this.render();
    });
    row.append(box, el('span', '', label));
    return row;
  }

  // 添えようとしている切り抜きの印（相棒に送り、画像を出し、切り抜きのチェックが入っているときだけ）
  private plannedCrops(item: CaptureItem, ask: AskSession): CropTarget[] {
    return ask.image && ask.crops && ask.dest.startsWith('c:') ? cropTargets(item.marks, item.strokes) : [];
  }

  // 下見の材料。書き込み・スタンプ・隠した矩形・焼くか・切り抜く印・送り先が相棒か・元の画像の長さ。これが変わったときだけ作り直す
  private shotKeyOf(item: CaptureItem, ask: AskSession) {
    const src = this.images.get(item.id);
    return JSON.stringify({
      strokes: item.strokes,
      marks: item.marks,
      blur: item.blur,
      burn: ask.burn,
      crops: this.plannedCrops(item, ask).map((target) => `${target.piece}:${target.id}`),
      companion: ask.dest.startsWith('c:'),
      length: typeof src === 'string' ? src.length : 0,
    });
  }

  // 送る切り抜き。下見ができていれば、実際に作れたもの。まだなら、添えようとしているもの
  private cropsOf(item: CaptureItem, ask: AskSession): CropTarget[] {
    const planned = this.plannedCrops(item, ask);
    if (planned.length === 0) return [];
    const shot = ask.shot;
    return shot && shot.key === this.shotKeyOf(item, ask) ? shot.crops.map((crop) => crop.target) : planned;
  }

  // 実際に送る画像（隠した所を塗り、書き込みを焼き、印の周りを切り抜いたもの）を作る。render() からも呼ばれるので、材料が同じなら何もしない
  private refreshShot() {
    const ask = this.ask;
    if (!ask || !ask.image) return;
    const item = this.host.store.items.find((row) => row.id === ask.id);
    const src = item ? this.images.get(item.id) : undefined;
    if (!item || typeof src !== 'string') return;
    const key = this.shotKeyOf(item, ask);
    if (ask.shotKey === key) return;
    ask.shotKey = key;
    ask.shotFailed = false;
    ask.shot = null;
    const token = ++this.shotToken;
    void prepareAskPreview(src, askScene(item), { burn: ask.burn, crops: this.plannedCrops(item, ask) }).then((made) => {
      // 材料が変わったあとに届いた古い結果は捨てる
      if (token !== this.shotToken || this.ask !== ask || ask.shotKey !== key) return;
      ask.shot = made ? { key, ...made } : null;
      ask.shotFailed = !made;
      // 費用の見積もりは、全体と切り抜きの合計
      if (made) ask.tokens = imageTokens(made.width, made.height) + made.crops.reduce((sum, crop) => sum + imageTokens(crop.width, crop.height), 0);
      const latest = this.host.store.items.find((row) => row.id === ask.id);
      if (this.writing() && latest) {
        // ひとことを書いている途中は描き直さない。下見と、出るもの・送る文・目安の行だけ差し替える
        this.element.querySelector('.capture-ask-image')?.replaceWith(this.shotBlock(latest, ask));
        const cost = this.element.querySelector('.capture-ask-cost');
        if (cost) cost.textContent = this.costLine(ask, [...ask.preview].length);
        void this.refreshBundle();
        return;
      }
      this.render();
    });
  }

  private shotBlock(item: CaptureItem, ask: AskSession) {
    const box = el('div', 'capture-ask-image');
    const key = this.shotKeyOf(item, ask);
    const shot = ask.shot && ask.shot.key === key ? ask.shot : null;
    if (!shot) {
      const failed = ask.shotFailed && ask.shotKey === key;
      box.append(el('p', 'capture-ask-image-wait', failed ? t('送る画像を作れませんでした') : t('送る画像を作っています…')));
      return box;
    }
    const open = el('button', 'capture-ask-image-open');
    open.type = 'button';
    open.title = t('大きく見る（これが送る画像です）');
    const img = el('img');
    img.src = shot.dataUrl;
    img.alt = t('送る画像');
    open.append(img);
    // 焼いた画像なので、書き込みは重ねない
    const burned = ask.burn ? t('書き込みを焼き、') : '';
    open.addEventListener('click', () => this.openLightbox(shot.dataUrl, t('これが送る画像です（{0}隠した所を塗ったもの）', { 0: burned }), t('送る画像')));
    box.append(open);
    if (shot.crops.length > 0) {
      const row = el('div', 'capture-ask-crops');
      for (const crop of shot.crops) {
        const button = el('button', 'capture-ask-crop');
        button.type = 'button';
        button.title = t('大きく見る（印 {0} の周り。これが送る切り抜きです）', { 0: crop.target.n });
        const small = el('img');
        small.src = crop.dataUrl;
        small.alt = t('印 {0} の切り抜き', { 0: crop.target.n });
        button.append(small, el('span', 'capture-ask-crop-label', t('印 {0}', { 0: crop.target.n })));
        button.addEventListener('click', () => this.openLightbox(crop.dataUrl, t('印 {0} の周り（これが送る切り抜きです）', { 0: crop.target.n }), t('印 {0} の切り抜き', { 0: crop.target.n })));
        row.append(button);
      }
      box.append(row);
    }
    box.append(el('p', 'capture-ask-image-note', shotNote(shot, item.blur.length)));
    return box;
  }

  private async refreshBundle() {
    const ask = this.ask;
    const token = ++this.bundleToken;
    if (!ask) return;
    const item = this.host.store.items.find((row) => row.id === ask.id);
    if (!item) return;
    const crops = this.cropsOf(item, ask);
    const text = await this.bundleOf(item, ask, crops);
    if (token !== this.bundleToken || this.ask !== ask) return;
    ask.preview = text;
    const preview = this.element.querySelector('.capture-ask-preview');
    if (preview) preview.textContent = text;
    const leave = this.element.querySelector('.capture-ask-leave');
    if (leave) leave.textContent = leavingLine(item, ask, crops.length);
    const cost = this.element.querySelector('.capture-ask-cost');
    if (cost) cost.textContent = this.costLine(ask, [...text].length);
  }

  // 送る文。crops は、実際に添える切り抜き（送るときは、作れたもの。下見は、添えようとしているもの）
  private bundleOf(item: CaptureItem, ask: AskSession, crops: readonly CropTarget[] = this.cropsOf(item, ask)) {
    const raw = askBundleText(item, {
      kinds: ASK_KINDS.map((kind) => kind.id).filter((id) => ask.kinds.has(id)),
      note: ask.note,
      image: ask.image,
      video: !!item.video,
      marks: ask.marks,
      burn: ask.burn,
      crops: ask.image ? crops : [],
      ocr: ask.ocr,
      url: ask.url && !ask.blocked,
    });
    return redactBlockedUrls(raw);
  }

  private costLine(ask: AskSession, chars: number) {
    if (!ask.dest) return t('送り先を選んでください');
    if (ask.dest.startsWith('b:')) return t('Grok Bot の料金は、このブラウザでは分かりません');
    if (this.host.practice()) return t('練習モードなので料金はかかりません');
    const price = this.host.companionPrice(ask.dest.slice(2));
    const tokens = ask.image ? ask.tokens : 0;
    const usd = askEstimateUsd(price.input, price.output, tokens, chars);
    return t('目安 約 {0}。表示は目安で、請求そのものではありません', { 0: formatUsd(usd) });
  }

  private async submitAsk(skipConfirm = false) {
    const ask = this.ask;
    if (!ask) return;
    if (ask.sending) {
      this.announce(t('まだ送っています。終わってから、もう一度押してください'));
      return;
    }
    const picked = this.element.querySelector('.capture-ask-dest');
    if (picked instanceof HTMLSelectElement) ask.dest = picked.value;
    const item = this.host.store.items.find((row) => row.id === ask.id);
    if (!item) {
      this.announce(t('この撮影が台帳に見つかりません'));
      return;
    }
    // 「印について答えて」は、❓・⚠ が無いか、印と書き込みの文を送らないときは頼みに入らない。それを除いて数える
    if (effectiveKinds(item, { kinds: [...ask.kinds], marks: ask.marks }).length === 0) {
      this.announce(ask.kinds.size > 0 ? t('「印について答えて」だけでは頼めません（❓・⚠ のスタンプと、「印と書き込みの文」のチェックが要ります）。頼み方を足してください') : t('頼み方を1つ以上選んでください'));
      return;
    }
    if (!hasOutgoing(item, ask)) {
      this.announce(t('出すものを1つ以上選んでください'));
      return;
    }
    if (!ask.dest) {
      this.announce(t('送り先を選んでください'));
      return;
    }
    const dest = ask.dest;
    ask.sending = true;
    ask.notice = '';
    this.render();
    // 描き直しは、一覧に無い送り先を先頭へ戻す。押したときの選択を、そのあとで使う
    ask.dest = dest;
    try {
      const text = await this.bundleOf(item, ask);
      if (this.ask !== ask) return;
      ask.preview = text;
      if (ask.dest.startsWith('c:')) {
        await this.sendCompanion(item, ask, text);
        return;
      }
      if (ask.dest.startsWith('b:')) {
        const botId = ask.dest.slice(2);
        const bot = this.host.bots().find((row) => row.id === botId);
        if (!bot) {
          ask.sending = false;
          this.announce(t('送り先の Grok Bot が見つかりません'));
          return;
        }
        if (!bot.agentId) {
          ask.sending = false;
          this.announce(t('「{0}」にはリンクがまだありません。右クリック →「リンクを貼る…」で貼ってから、もう一度どうぞ', { 0: bot.name }), 6000);
          return;
        }
        if (!skipConfirm && !this.host.botAppConfirmed()) {
          ask.sending = false;
          this.render();
          this.confirmGrok(bot.name, ask.image && ask.step !== 'paste');
          return;
        }
        await this.sendGrok(item, ask, text, botId);
        return;
      }
      ask.sending = false;
      this.announce(t('送り先を選んでください'));
    } catch (error) {
      if (this.ask === ask) ask.sending = false;
      const why = error instanceof Error && error.message ? error.message : t('理由が分かりません');
      this.announce(t('送れませんでした（{0}）', { 0: why }));
    }
  }

  private confirmGrok(name: string, imageFirst: boolean) {
    const button = this.element.querySelector('.capture-send');
    const box = button instanceof HTMLElement ? button.getBoundingClientRect() : { left: 24, bottom: 24 };
    const what = imageFirst ? t('画像をコピーしてから') : t('依頼をコピーしてから');
    this.host.menu.open(box.left, box.bottom, [
      { section: t('外のアプリ（Grok Bot）を開きます') },
      { label: t('{0}、「{1}」のチャットを Grok Bot アプリで開きます。次からは聞きません', { 0: what, 1: name }), disabled: true },
      {
        label: t('コピーして開く'),
        run: () => {
          this.host.confirmBotApp();
          void this.submitAsk(true);
        },
      },
      { label: t('やめる'), run: () => undefined },
    ]);
    this.host.menu.focusFirst();
  }

  private async sendCompanion(item: CaptureItem, ask: AskSession, text: string) {
    if (this.host.busy()) {
      ask.sending = false;
      this.announce(t('相棒が話し終わってから押してください'));
      return;
    }
    let images: string[] | undefined;
    let body = text;
    if (ask.image) {
      const src = await this.imageReady(item.id);
      if (this.ask !== ask) return;
      const latest = this.host.store.items.find((row) => row.id === item.id) ?? item;
      // 画像を先に作る。送る文の【画像】は、実際に作れた切り抜きの印で書く（切り抜きが作れなくても、全体だけで送れる）
      const made = src ? await prepareAskPreview(src, askScene(latest), { burn: ask.burn, crops: this.plannedCrops(latest, ask) }) : null;
      if (this.ask !== ask) return;
      if (!made) {
        ask.sending = false;
        this.announce(t('画像を準備できませんでした'));
        return;
      }
      const crops = made.crops.slice(0, ASK_IMAGE_CAP - 1);
      images = [made.dataUrl, ...crops.map((crop) => crop.dataUrl)];
      body = await this.bundleOf(latest, ask, crops.map((crop) => crop.target));
      if (this.ask !== ask) return;
      ask.preview = body;
    }
    const result = await this.host.sendCapture(body, images, ask.dest.slice(2), askDisplay(effectiveKinds(item, { kinds: [...ask.kinds], marks: ask.marks })));
    if (this.ask !== ask) return;
    if (!result.ok) {
      ask.sending = false;
      this.announce(result.message, 8000);
      return;
    }
    this.ask = null;
    await this.host.store.setAsked(item.id);
    this.say(this.host.practice() ? t('練習モードで送りました。相棒の会話に返事が出ます。料金はかかりません') : t('相棒に送りました'));
  }

  private async sendGrok(item: CaptureItem, ask: AskSession, text: string, botId: string) {
    const bot = this.host.bots().find((row) => row.id === botId);
    if (!bot?.agentId) {
      ask.sending = false;
      this.announce(bot ? t('「{0}」にはリンクがまだありません。右クリック →「リンクを貼る…」で貼ってから、もう一度どうぞ', { 0: bot.name }) : t('送り先の Grok Bot が見つかりません'));
      return;
    }
    if (ask.image && ask.step !== 'paste') {
      const src = await this.imageReady(item.id);
      if (this.ask !== ask) return;
      const latest = this.host.store.items.find((row) => row.id === item.id) ?? item;
      // Grok Bot へはクリップボードに 1 枚だけ。切り抜きは添えない
      const jpeg = src ? await prepareAskImages(src, askScene(latest), { burn: ask.burn, crops: [] }) : [];
      const payload = jpeg[0] ? await clipboardImageBase64(jpeg[0]) : null;
      if (this.ask !== ask) return;
      if (!payload) {
        ask.sending = false;
        this.announce(t('画像を用意できませんでした（大きすぎるか、読めません）。アプリは開いていません'));
        return;
      }
      const copied = await copyShotImageResult(payload, 'white');
      if (this.ask !== ask) return;
      if (!copied.ok) {
        ask.sending = false;
        this.announce(copied.message);
        return;
      }
      // 画像はもう外に出た（クリップボードに入った）。「送った」の印をここで付ける
      await this.host.store.setAsked(item.id);
      if (this.ask !== ask) return;
      // 右から直接開く（巣の「Grok Bot アプリで開く」と同じ openBotApp）。開けたかはここで分かる。依頼はまだ作らない
      const opened = await openBotApp(bot.agentId);
      if (this.ask !== ask) return;
      if (opened.ok || opened.error === 'noApp') this.host.askLeft({ command: 'botAppSeen', missing: !opened.ok });
      if (!opened.ok) {
        ask.sending = false;
        this.announce(t('{0} 画像はコピーしてあります。アプリは開いていません', { 0: botAppErrorText(opened.error) }));
        return;
      }
      ask.sending = false;
      ask.step = 'paste';
      ask.grokText = text;
      this.announce(t('画像をコピーして、アプリを開きました。チャットに貼ってください（Ctrl+V）。貼れたら「文をコピー」'), 10000);
      return;
    }
    // 画像を先にコピーしたときは、そのときの文を使う（貼った画像の番号と、文の番号を揃える）
    const body = (ask.grokText ?? text).trim();
    if (!body) {
      ask.sending = false;
      this.announce(t('送る文が空なので、コピーしませんでした。アプリは開いていません'));
      return;
    }
    // 巣の「コピーしてアプリを開く」と同じ。右 → 左の命令 botDraft。左の ClipboardSender が依頼番号を付け、文をコピーし、アプリを開く
    this.host.askLeft({ command: 'botDraft', botId, text: body });
    this.ask = null;
    await this.host.store.setAsked(item.id);
    this.announce(t('文をコピーしてアプリを開きました。チャットに貼って送ってください。受け取り箱が返事を待ちます'), 10000);
  }
}

// 送る画像・送る文の材料。最新の項目の書き込み・スタンプ・隠した場所（番号は、画像に焼くものも文に書くものも、この材料から numberPieces が決める）
function askScene(item: CaptureItem) {
  return { strokes: item.strokes, marks: item.marks, blur: item.blur };
}

// カードの縮図・拡大に書き込みを重ねるときの描き方。読む画面と同じ（札と番号・隠した場所の枠・縮図でも線が消えない）
function overlayOptions(img: HTMLImageElement, canvas: HTMLCanvasElement): AnnotationOptions {
  return {
    marks: 'numbered',
    blur: 'outline',
    minLinePx: window.devicePixelRatio,
    scale: img.naturalWidth > 0 ? canvas.width / img.naturalWidth : 1,
  };
}

// カードの一覧の行。「1 ⭐ 大事 一行」「3 四角 ひとこと」「矢印：ひとこと」「文字：…」。番号は numberPieces（画像・送る文と同じ）。
//   スタンプ → 線の順で、台帳の並びのまま。ひとことの無い矢印・蛍光ペンは書かない
function pieceLines(item: CaptureItem): string[] {
  const numbers = numberPieces(item.marks, item.strokes);
  const lines: string[] = [];
  for (const mark of item.marks) {
    const stamp = stampOf(mark.stamp);
    lines.push(`${numberOf(numbers, 'mark', mark.id) ?? ''} ${stamp?.emoji ?? '•'} ${stamp?.label ?? ''}${mark.note ? ` ${mark.note}` : ''}`);
  }
  for (const stroke of item.strokes) {
    const text = stroke.text.trim();
    if (stroke.kind === 'rect') lines.push(t('{0} 四角{1}', { 0: numberOf(numbers, 'stroke', stroke.id) ?? '', 1: text ? ` ${text}` : '' }));
    else if (stroke.kind === 'arrow' && text) lines.push(t('矢印：{0}', { 0: text }));
    else if (stroke.kind === 'text' && text) lines.push(t('文字：{0}', { 0: text }));
  }
  return lines;
}

// 下見の目安の行。全体の大きさとトークン、隠した数。切り抜きがあれば、その枚数とトークン、合計
function shotNote(shot: AskShot, hidden: number) {
  const whole = imageTokens(shot.width, shot.height);
  let line = t('送る画像 {0}×{1}・約 {2} トークン・隠した {3} か所', { 0: shot.width, 1: shot.height, 2: whole, 3: hidden });
  if (shot.crops.length > 0) {
    const cropped = shot.crops.reduce((sum, crop) => sum + imageTokens(crop.width, crop.height), 0);
    line += t('／切り抜き {0} 枚・約 {1} トークン（計 約 {2}）', { 0: shot.crops.length, 1: cropped, 2: whole + cropped });
  }
  return line;
}

// 送る文に入る読んだ行（チェックが入っていて、空でなく、隠した行でない）
function sendableLines(lines: readonly CaptureOcrLine[]) {
  return lines.filter((line) => line.on && line.text.trim() && line.text !== HIDDEN_TEXT);
}

// 「印と書き込みの文」に入るものがあるか（スタンプ・四角・コメント・文字の書き込み・ひとことつきの矢印。capture-ask.ts の marksSections と同じ範囲）
function hasMarkText(item: CaptureItem) {
  if (item.marks.length > 0 || item.comment.trim().length > 0) return true;
  return item.strokes.some((stroke) => stroke.kind === 'rect' || ((stroke.kind === 'arrow' || stroke.kind === 'text') && stroke.text.trim().length > 0));
}

function hasOutgoing(item: CaptureItem, ask: AskSession) {
  if (ask.image) return true;
  if (ask.marks && hasMarkText(item)) return true;
  if (ask.ocr && sendableLines(item.ocr ?? []).length > 0) return true;
  if (ask.url && item.source && !ask.blocked) return true;
  return false;
}

// 出るものの一行。crops は、実際に添える切り抜きの枚数
function leavingLine(item: CaptureItem, ask: AskSession, crops: number) {
  const parts: string[] = [];
  if (ask.image) {
    const how: string[] = [];
    if (ask.burn && (item.marks.length > 0 || item.strokes.length > 0)) how.push(t('書き込みを焼く'));
    if (crops > 0) how.push(t('切り抜き {0} 枚', { 0: crops }));
    if (item.video) parts.push(t('画像（録画の代表1枚。mp4 は出ません{0}）', { 0: how.length > 0 ? `。${how.join('・')}` : '' }));
    else parts.push(how.length > 0 ? t('画像（{0}）', { 0: how.join('・') }) : t('画像'));
  }
  if (ask.marks && hasMarkText(item)) parts.push(t('印と書き込みの文'));
  if (ask.ocr && sendableLines(item.ocr ?? []).length > 0) parts.push(t('読んだ文字'));
  if (ask.url && item.source && !ask.blocked) parts.push('URL');
  return parts.length ? t('出るもの：{0}', { 0: parts.join('、') }) : t('出るもの：まだありません');
}

// 読んだ文字の行。隠した行と、チェックを外した行は送らない（0 の部分は書かない）
function ocrSendNote(lines: readonly CaptureOcrLine[]) {
  const hidden = lines.filter((line) => line.text === HIDDEN_TEXT).length;
  const off = lines.filter((line) => !line.on && line.text !== HIDDEN_TEXT).length;
  if (hidden > 0 && off > 0) return t('読んだ文字：隠した {0} 行は送りません。外した {1} 行も送りません', { 0: hidden, 1: off });
  if (hidden > 0) return t('読んだ文字：隠した {0} 行は送りません', { 0: hidden });
  if (off > 0) return t('読んだ文字：外した {0} 行は送りません', { 0: off });
  return '';
}

function hiddenLineCount(item: CaptureItem) {
  return (item.ocr ?? []).filter((line) => line.text === HIDDEN_TEXT).length;
}

// 「隠す候補 n 行（鍵 a・メール b・電話 c・カード d）」。0 の種類は書かない
function candidateSummary(kinds: readonly CandidateKind[]) {
  const parts = CANDIDATE_ORDER.map((kind) => ({ kind, count: kinds.filter((one) => one === kind).length }))
    .filter((row) => row.count > 0)
    .map((row) => `${CANDIDATE_LABEL[row.kind]} ${row.count}`);
  return t('隠す候補 {0} 行（{1}）', { 0: kinds.length, 1: parts.join('・') });
}

function hideFailure(reason: Extract<HideResult, { ok: false }>['reason']) {
  if (reason === 'limit') return t('隠す場所は 20 までです。読む画面で広く囲ってから、もう一度どうぞ');
  if (reason === 'readonly') return READONLY_SHORT;
  if (reason === 'missing') return t('この撮影が見つかりませんでした');
  if (reason === 'image') return t('画像を読めなかったので、隠せませんでした');
  if (reason === 'write') return t('保存できなかったので、隠せませんでした');
  if (reason === 'none') return t('隠す行がありません（もう隠してあります）');
  return t('画像が先に変わっていたので、隠せませんでした。もう一度どうぞ');
}

// 縮図の上に重ねる枠。rect は画像に対する割合
function rectBox(className: string, rect: { x: number; y: number; w: number; h: number }) {
  const box = el('span', className);
  box.style.left = `${rect.x * 100}%`;
  box.style.top = `${rect.y * 100}%`;
  box.style.width = `${rect.w * 100}%`;
  box.style.height = `${rect.h * 100}%`;
  return box;
}

// 拡大の帯の文。送ったあとは、送った写しが隠れないことを言う
function lightboxNote(item: CaptureItem) {
  return item.askedAt ? t('{0} に送っています。送った写しは隠れません', { 0: whenOf(item.askedAt) }) : t('この画像は、まだ外に送っていません');
}

function countLabel(text: string) {
  const count = [...text].length;
  return count > COMMENT_HINT ? t('{0} / {1}（長め）', { 0: count, 1: COMMENT_HINT }) : `${count} / ${COMMENT_HINT}`;
}

function whenOf(ms: number) {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function scopeLabel(item: CaptureItem) {
  if (item.video) return t('録画 · {0}秒', { 0: item.video.seconds });
  if (item.from) return CAPTURE_FROM_LABEL[item.from.kind];
  if (item.scope === 'window') return t('ブラウザの窓');
  if (item.scope === 'desktop') return t('この画面');
  if (item.scope === 'region') return t('囲んだ範囲');
  return t('中央のページ');
}

function recLabel(seconds: number, limit: number) {
  return t('● 録画中 {0} / {1}秒', { 0: seconds, 1: limit });
}

function clockLabel(ms: number) {
  const total = ms < 0 ? 0 : Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function addFailure(reason: 'full' | 'write' | 'readonly') {
  if (reason === 'full') return t('撮影は {0} 件までです。古いカードを消してから撮ってください', { 0: CAPTURE_LIMIT });
  if (reason === 'readonly') return READONLY_SHORT;
  return t('撮影を保存できませんでした');
}

// 台帳の目次（captures.json）を読めなかったときの注記。理由は failure ごと
function readonlyText(failure: CaptureLoadFailure | null) {
  const why =
    failure === 'timeout' ? t('返事が来ませんでした') : failure === 'broken' ? t('中身が壊れています') : failure === 'version' ? t('新しい版の形です') : failure === 'unreadable' ? t('ファイルを開けませんでした') : t('理由は分かりません');
  // 返事が来ないだけなら開き直せば読めることがある。中身やファイルの問題は、開き直しても同じなので置き場を伝える
  const fix =
    failure === 'timeout'
      ? t('アプリを開き直してください')
      : t('ui-data の captures.json を別の場所へ移してから開き直すと、空の一覧から始められます（撮った画像は ui-data\\captures に残ります）');
  return t('撮影の一覧（captures.json）を読めませんでした（{0}）。上書きしないように、撮影の保存を止めています。{1}', { 0: why, 1: fix });
}

function ocrFailure(error: string | undefined) {
  if (error === 'unavailable') return t('このパソコンでは文字を読めません');
  if (error === 'busy') return t('いまは文字を読めません。録画か、ほかの読み取りが終わってからもう一度押してください');
  if (error === 'decode') return t('画像を文字用に読み取れませんでした');
  if (error === 'engine') return t('文字認識を始められませんでした');
  return t('文字を読めませんでした');
}

function recordFailure(error: string | undefined) {
  if (error === 'unavailable') return t('このパソコンでは録画できません');
  if (error === 'busy') return t('すでに録画しています');
  if (error === 'popout') return t('小窓に出しているページは録画できません');
  if (error === 'noPage') return t('中央にページが無いので録画できません');
  if (error === 'empty') return t('フレームが無かったので、録画は残しませんでした');
  if (error === 'write' || error === 'badId') return t('動画を書けませんでした');
  if (error === 'shot') return t('中央のページを録画できませんでした');
  return t('録画を始められませんでした');
}

function scopeNotes(item: CaptureItem) {
  const lines: string[] = [];
  if (item.scope === 'window') lines.push(t('別の窓に出しているアプリのセルは、写っていないことがあります'));
  if (item.scope === 'desktop') lines.push(t('ほかのアプリも写ります'));
  if (item.via === 'gdi') lines.push(t('画面のコピーで撮りました。黄色い枠は出ていません'));
  if (item.blur.length > 0 && (item.ocr ?? []).some((line) => typeof line.at === 'number')) {
    lines.push(t('隠す前に読んだ録画の行は、隠した場所と同じ位置の行しか隠していません（スクロールした時刻の行は残ることがあります）。行ごとの「隠す」で文字だけ隠せます。「文字を読む」で、代表の画面だけを読み直すこともできます'));
  }
  if (item.video && item.blur.length > 0) lines.push(t('mp4 の動画は隠れていません（「mp4 だけ消す」で消せます）'));
  return lines;
}

function screenFailure(reply: HostMessage | null, scope: 'window' | 'desktop') {
  const which = scope === 'desktop' ? t('この画面') : t('ブラウザの窓');
  if (!reply || reply.type !== 'capture') return t('{0}の返事が来ませんでした', { 0: which });
  if (reply.error === 'busy') return t('録画中です。止めてから撮ってください');
  if (reply.error === 'hidden') return t('窓が見えていないので撮れませんでした');
  if (reply.error === 'tooBig') return t('画像が大きすぎて渡せませんでした');
  if (reply.error === 'grab') return t('{0}を撮れませんでした', { 0: which });
  if (reply.ok) return t('{0}を画像にできませんでした', { 0: which });
  return t('撮れませんでした（{0}）', { 0: reply.error ?? '理由なし' });
}

function paintWait() {
  return new Promise((resolve) => window.setTimeout(resolve, 40));
}

function imageLost(why: string) {
  return t('画像の場所が分からないので撮りませんでした（{0}）', { 0: why });
}

// URL の # から後ろを外す（画像の URL・タブの URL の照合用）
function withoutHash(url: string) {
  const at = url.indexOf('#');
  return at < 0 ? url : url.slice(0, at);
}

function captureFailure(reply: HostMessage | null): string {
  if (!reply || reply.type !== 'capture') return t('中央からの返事が来ませんでした（撮る：返事なし）');
  if (reply.error === 'rect') return t('画像が見えている所にほとんど無いので撮れませんでした（撮る：rect）');
  if (reply.error === 'popout') return t('小窓に出しているページは、ここからは撮れません（撮る：popout）');
  if (reply.error === 'notActive') return t('今、中央に出ているページではないので撮れませんでした（撮る：notActive）');
  if (reply.error === 'noPage') return t('中央にページが無いので撮れませんでした（撮る：noPage）');
  if (reply.error === 'tooBig') return t('画像が大きすぎて渡せませんでした（撮る：tooBig）');
  if (reply.error === 'metrics') return t('見えている範囲を聞けませんでした（撮る：metrics）');
  if (reply.error === 'viewport') return t('見えている範囲の大きさが変なので撮れませんでした（撮る：viewport）');
  if (reply.error === 'shot' || reply.error === 'capture') return t('中央のページを画像にできませんでした（撮る：{0}）', { 0: reply.error });
  if (reply.ok) return t('中央のページを画像にできませんでした（撮る：画像が空）');
  return t('撮れませんでした（ページが眠っていることがあります。撮る：{0}）', { 0: reply.error ?? '理由なし' });
}

function loadFolded() {
  try {
    return localStorage.getItem(FOLD_KEY) === '1';
  } catch {
    return false;
  }
}

function saveFolded(folded: boolean) {
  try {
    localStorage.setItem(FOLD_KEY, folded ? '1' : '0');
  } catch {
    // 覚えられなくても、今は開ける
  }
}
