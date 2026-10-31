// タブ（とシートへの入口・ボットのセル）の見た目の欄：画像・コメント・見え方を選ぶ（盤面の上、セルの近くに出す）
//   画像：パソコンの画像を選ぶ・ページの画面から・六角形に切り取る・Ctrl+V で貼る。小さくしてから残す（長い辺 256px）
//   コメント：1行・40文字まで。見え方：全体に合わせる・おまかせ・アイコン・画像・コメント・ページの画面（タブだけ）
//   ボットのセル：画像とコメントだけ（見本はボットの顔。名前とリンクは台帳のもので、ここでは変えない）
import { t as tr } from '../i18n';
import { type BotFaceInfo, drawBotFace, drawPortalFace, drawTabFace, type FaceSources, type PortalInfo, resolveFace, svgEl } from '../cellface';
import { hexCorners } from '../hex';
import { MAX_TAB_COMMENT, type Tab, TAB_LOOKS, type TabLook } from '../tabs';
import { el } from '../util';

const IMAGE_MAX = 256; // 残す画像の長い辺（px）
const R = 19.5;

export type FaceTarget =
  | {
      kind: 'tab';
      tab: Tab;
      imageHref?: string; // 今の画像（data URL）
      thumb?: string; // ページの画面（表示したことがあれば）
      globalLook: TabLook;
      canCrop: boolean; // 六角形に切り取れるか（表示中のタブだけ）
    }
  | {
      kind: 'portal';
      name: string; // 行き先のシートの名前
      info: PortalInfo | null;
      imageHref?: string;
      comment: string;
    }
  | {
      kind: 'bot';
      name: string; // ボットの名前（台帳）
      info: BotFaceInfo; // 顔の状態（リンクなし・アプリなし）
      imageHref?: string;
      comment: string;
    };

export interface FaceResult {
  image: string | null | undefined; // 新しい画像の data URL・null は外す・undefined は変えない
  comment: string;
  look: TabLook | null | undefined; // null は全体に合わせる（タブだけ）
}

interface Draft {
  href: string | undefined;
  imageChanged: boolean;
  comment: string;
  look: TabLook | null;
}

export class FaceEditor {
  private readonly element = el('form', 'face-editor');
  private readonly file = el('input');
  private target: FaceTarget | null = null;
  private draft: Draft = { href: undefined, imageChanged: false, comment: '', look: null };
  private onSave: ((result: FaceResult) => void) | null = null;
  private onCrop: ((result: FaceResult) => void) | null = null;
  private status = el('div', 'face-status');
  private loading = 0; // 読み込み中の画像の数（終わるまで「残す」を待つ）

  constructor(private readonly host: HTMLElement) {
    this.element.hidden = true;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-labelledby', 'face-editor-title');
    this.element.tabIndex = -1;
    this.status.setAttribute('role', 'status'); // 読み込み中・読めなかったことを、読み上げにも伝える
    this.file.type = 'file';
    this.file.accept = 'image/*';
    this.file.hidden = true;
    this.file.addEventListener('change', () => {
      const f = this.file.files?.[0];
      this.file.value = '';
      if (f) void this.useBlob(f);
    });
    this.element.addEventListener('submit', (e) => {
      e.preventDefault();
      this.save();
    });
    // 盤面のキー（Ctrl+C・Ctrl+V・Esc）に取られないように。Esc でやめる
    this.element.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.close();
    });
    // 画像を貼る（欄が開いている間）
    document.addEventListener('paste', (e) => {
      if (this.element.hidden) return;
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
      const blob = item?.getAsFile();
      if (!blob) return;
      e.preventDefault();
      void this.useBlob(blob);
    });
    // 欄の外を押したら閉じる（まだ何も変えていないときだけ。変えた後は「残す」か「やめる」で）
    document.addEventListener('pointerdown', (e) => {
      if (!this.element.hidden && !this.element.contains(e.target as Node) && !this.isDirty) this.close();
    });
    host.append(this.element, this.file);
  }

  get isOpen() {
    return !this.element.hidden;
  }

  // anchor：セルの画面上の四角。その下（入らなければ上）に出す
  open(anchor: DOMRect, target: FaceTarget, onSave: (result: FaceResult) => void, onCrop?: (result: FaceResult) => void) {
    this.target = target;
    this.onSave = onSave;
    this.onCrop = onCrop ?? null;
    this.draft = {
      href: target.imageHref,
      imageChanged: false,
      comment: target.kind === 'tab' ? (target.tab.comment ?? '') : target.comment,
      look: target.kind === 'tab' ? (target.tab.look ?? null) : null,
    };
    this.status.textContent = '';
    this.build();
    this.element.hidden = false;
    this.place(anchor);
    this.element.querySelector<HTMLInputElement>('.face-comment')?.focus();
  }

  close() {
    this.element.hidden = true;
    this.element.replaceChildren();
    this.target = null;
    this.onSave = null;
    this.onCrop = null;
    this.loading = 0;
  }

  // 開いたときから変えたか（画像を読み込んでいる途中も）
  get isDirty(): boolean {
    const t = this.target;
    if (!t || this.element.hidden) return false;
    if (this.loading > 0) return true;
    const comment = t.kind === 'tab' ? (t.tab.comment ?? '') : t.comment;
    const look = t.kind === 'tab' ? (t.tab.look ?? null) : null;
    return this.draft.imageChanged || this.draft.comment.trim() !== comment || this.draft.look !== look;
  }

  private result(): FaceResult {
    return {
      image: this.draft.imageChanged ? (this.draft.href ?? null) : undefined,
      comment: this.draft.comment.trim(),
      look: this.target?.kind === 'tab' ? this.draft.look : undefined,
    };
  }

  private save() {
    if (this.loading > 0) {
      this.status.textContent = tr('画像を読み込んでいます。終わってから「残す」を押してください');
      return;
    }
    const save = this.onSave;
    const result = this.result();
    this.close();
    save?.(result);
  }

  private build() {
    const t = this.target;
    if (!t) return;
    const head = el('div', 'face-head');
    const title = el('strong', '', t.kind === 'tab' ? tr('タブの見た目') : t.kind === 'bot' ? tr('ボットのセルの見た目') : tr('入口の見た目'));
    title.id = 'face-editor-title';
    head.append(title, el('span', 'face-sub', t.kind === 'tab' ? t.tab.title || t.tab.url : t.kind === 'bot' ? tr('ボット「{0}」', { 0: t.name }) : tr('シート「{0}」へ', { 0: t.name })));

    const top = el('div', 'face-top');
    const preview = el('div', 'face-preview');
    preview.append(this.previewSvg());
    const imageBox = el('div', 'face-image-box');
    imageBox.append(el('div', 'face-label', tr('画像')));
    const row = el('div', 'face-row');
    row.append(this.button(tr('画像を選ぶ…'), () => this.file.click(), tr('パソコンの画像を選ぶ')));
    if (t.kind === 'tab') {
      const fromPage = this.button(tr('ページの画面から'), () => void this.useUrl(t.thumb ?? ''), tr('このタブのページの画面を画像にする'));
      fromPage.disabled = !t.thumb;
      if (!t.thumb) fromPage.title = tr('一度表示したページだけ（眠ったまま開いていないタブは、開いてから）');
      const crop = this.button(tr('六角形に切り取る…'), () => {
        const run = this.onCrop;
        const result = this.result();
        this.close();
        run?.(result);
      }, tr('ページを六角形に切り取って、このタブの画像にする'));
      crop.disabled = !t.canCrop || !this.onCrop;
      if (!t.canCrop) crop.title = tr('表示中のタブだけ切り取れます');
      row.append(fromPage, crop);
    }
    const clear = this.button(tr('外す'), () => {
      this.draft.href = undefined;
      this.draft.imageChanged = true;
      this.refresh();
    }, tr('画像を外す'));
    clear.disabled = !this.draft.href;
    clear.dataset.key = 'clear';
    row.append(clear);
    imageBox.append(row, el('div', 'face-hint', tr('Ctrl+V で画像を貼れます')));
    top.append(preview, imageBox);

    const commentLabel = el('label', 'face-label', tr('コメント'));
    commentLabel.htmlFor = 'face-comment';
    const commentRow = el('div', 'face-comment-row');
    const input = el('input', 'face-comment');
    input.id = 'face-comment';
    input.maxLength = MAX_TAB_COMMENT;
    input.value = this.draft.comment;
    input.placeholder = t.kind === 'tab' ? tr('短いひとこと（40文字まで）') : t.kind === 'bot' ? tr('セルのコメント（40文字まで）') : tr('入口のコメント（40文字まで）');
    input.spellcheck = false;
    const count = el('span', 'face-count', `${[...this.draft.comment].length}/${MAX_TAB_COMMENT}`);
    input.addEventListener('input', () => {
      this.draft.comment = input.value;
      count.textContent = `${[...input.value].length}/${MAX_TAB_COMMENT}`;
      preview.replaceChildren(this.previewSvg());
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        this.save();
      }
    });
    commentRow.append(input, count);

    const parts: HTMLElement[] = [head, top, commentLabel, commentRow];
    if (t.kind === 'tab') {
      const looks = el('div', 'face-looks');
      looks.setAttribute('role', 'group');
      looks.setAttribute('aria-label', 'このタブの見え方');
      const options: { id: TabLook | null; label: string; hint: string }[] = [
        { id: null, label: tr('全体に合わせる'), hint: tr('盤面の左上の ▾ で選んだ見え方（今は「{0}」）', { 0: TAB_LOOKS.find((l) => l.id === t.globalLook)?.label ?? 'おまかせ' }) },
        ...TAB_LOOKS,
      ];
      for (const o of options) {
        const b = this.button(o.label, () => {
          this.draft.look = o.id;
          this.refresh();
        }, o.hint);
        b.className = 'face-look';
        b.dataset.key = `look:${o.id ?? 'inherit'}`;
        b.setAttribute('aria-pressed', String(this.draft.look === o.id));
        looks.append(b);
      }
      parts.push(el('div', 'face-label', tr('このタブの見え方')), looks);
    }
    const actions = el('div', 'face-actions');
    const save = el('button', 'preview-button primary', tr('残す'));
    save.type = 'submit';
    actions.append(this.status, save, this.button(tr('やめる'), () => this.close()));
    parts.push(actions);
    this.element.replaceChildren(...parts);
  }

  // 下書きを変えた：見本と、ボタンの押した状態を描き直す（入力中の文字と、キーボードの位置はそのまま）
  private refresh() {
    const focused = document.activeElement;
    const comment = this.element.querySelector<HTMLInputElement>('.face-comment');
    const selection = comment ? [comment.selectionStart, comment.selectionEnd] : null;
    const key = focused instanceof HTMLElement && this.element.contains(focused) ? focused.dataset.key : undefined;
    this.build();
    if (focused === comment) {
      const next = this.element.querySelector<HTMLInputElement>('.face-comment');
      next?.focus();
      if (next && selection) next.setSelectionRange(selection[0], selection[1]);
    } else {
      const same = key ? this.element.querySelector<HTMLElement>(`[data-key="${key}"]`) : null;
      if (same && !(same as HTMLButtonElement).disabled) same.focus();
      else this.element.focus();
    }
  }

  private previewSvg(): SVGElement {
    const t = this.target;
    const svg = svgEl('svg', { class: 'face-preview-svg', viewBox: '-23 -23 46 47', role: 'img', 'aria-label': tr('盤面ではこう見えます') });
    if (!t) return svg;
    const c = { x: 0, y: 0 };
    if (t.kind === 'tab') {
      const href = this.draft.href;
      const tab: Tab = { ...t.tab, ...(href ? { image: 'draft' } : { image: undefined }), comment: this.draft.comment.trim() || undefined, look: this.draft.look ?? undefined };
      const src: FaceSources = { image: (id) => (id === 'draft' ? href : undefined), thumb: () => t.thumb, iconOk: () => true, iconFailed: () => undefined };
      const shown = resolveFace(tab, t.globalLook, src);
      const g = svgEl('g', { class: shown.mode === 'image' ? 'cell has-image' : 'cell' });
      g.append(svgEl('polygon', { class: 'hex', points: hexCorners(0, 0, R) }));
      drawTabFace(g, tab, c, R, shown, 'face-editor-clip', src);
      svg.append(g);
    } else if (t.kind === 'bot') {
      const g = svgEl('g', { class: 'cell bot' });
      drawBotFace(g, c, R, t.info, this.draft.href, this.draft.comment.trim(), 'face-editor-clip');
      svg.append(g);
    } else {
      const g = svgEl('g', { class: 'cell portal' });
      drawPortalFace(g, c, R, t.info, this.draft.href, this.draft.comment.trim(), 'face-editor-clip');
      svg.append(g);
    }
    return svg;
  }

  private button(label: string, run: () => void, title?: string) {
    const b = el('button', 'preview-button', label);
    b.type = 'button';
    if (title) b.title = title;
    b.addEventListener('click', run);
    return b;
  }

  private async useBlob(blob: Blob) {
    if (!blob.type.startsWith('image/')) {
      this.status.textContent = tr('画像のファイルを選んでください');
      return;
    }
    const target = this.target;
    this.loading++;
    this.status.textContent = tr('読み込んでいます…');
    // blob: の URL は画面の決まり（CSP）で画像に使えないので、data: の URL にして読む
    const url = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });
    if (this.target !== target) return; // 読んでいる間に欄を閉じた・ほかのタブの欄を開いた
    this.loading--;
    if (!url) {
      this.status.textContent = tr('この画像は読めませんでした');
      return;
    }
    await this.useUrl(url);
  }

  private async useUrl(src: string) {
    const target = this.target;
    if (!src || !target) return;
    this.loading++;
    this.status.textContent = tr('読み込んでいます…');
    const small = await shrinkImage(src, IMAGE_MAX).catch(() => null);
    if (this.target !== target) return; // 読んでいる間に欄を閉じた・ほかのタブの欄を開いた
    this.loading--;
    if (!small) {
      this.status.textContent = tr('この画像は読めませんでした');
      return;
    }
    this.draft.href = small;
    this.draft.imageChanged = true;
    this.status.textContent = '';
    this.refresh();
  }

  private place(anchor: DOMRect) {
    const box = this.host.getBoundingClientRect();
    const width = Math.min(268, box.width - 12);
    this.element.style.width = `${width}px`;
    this.element.style.maxHeight = `${Math.max(160, box.height - 12)}px`;
    const x = Math.max(6, Math.min(anchor.left + anchor.width / 2 - box.left - width / 2, box.width - width - 6));
    const height = Math.min(this.element.offsetHeight, box.height - 12);
    const below = anchor.bottom - box.top + 6;
    const y = below + height <= box.height - 6 ? below : Math.max(6, Math.min(anchor.top - box.top - height - 6, box.height - height - 6));
    this.element.style.left = `${x}px`;
    this.element.style.top = `${y}px`;
  }
}

// 画像を、長い辺 max px までに小さくして data URL に（透明な所は残す）
export async function shrinkImage(src: string, max: number): Promise<string> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight, 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/webp', 0.85);
}
