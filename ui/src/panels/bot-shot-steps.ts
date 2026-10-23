// 依頼の小窓の「六角スクショ」の部分（第3段 S3.12。docs/bot-cells/plan-s3-nest.md §5.2）
//   BotRequestForm が画像つきで開いたときだけ出す（撮る画面の「Grok に送る」→ 読む画面の重ね窓。reader/ask.ts）
//   ・上（top）：サムネイル・「画像は Grok Bot に送られます」・透明な所の色（白／暗い色。クリップボードに入れるときだけ）
//   ・下（steps）：貼るのは2回。① 画像をコピーしてアプリを開く → 案内「① 画像を貼ってください（Ctrl+V）→ 貼れたら ②」→
//     ② 文をコピー（小窓の主のボタン。①を済ませるまで押せない）。①を飛ばす「画像を貼らずに ② へ」も小さく残す
//   ・貼れなかったとき：画像をファイルに保存してフォルダを開く（チャットへドラッグで添付）・画像のパスをコピー・依頼の文にパスも添える。
//     画像のコピーに失敗したら、自動でこちらに切り替える（アプリは開かない）。
//     「貼れない：次からはファイルで送る」を押すと、次からははじめから逃げ道だけ（① が「画像を保存してフォルダを開く」になる。隅の「画像の貼り付けを試す」で戻す）
//   ・DOM だけ。C++ への頼みごとは host（reader/ask.ts が bot-shot.ts の関数を渡す）。アプリを開くのは左（命令 botOpenApp）
//   ・クリップボードの画像の候補（依頼の小窓 v2・R7a・D15）：小窓が先に取った写し（copy：shotId・PNG・保存したパス）で開く。
//     上（サムネイル・透明な所の色）は出さない（縮小図と「画像は Grok Bot に送られます」は小窓の送るもののカード）。
//     ① はその PNG を貼り、逃げ道もその保存したファイルを使う（もう一度保存しない）。一文は「（クリップボードの画像）」
//   ・画像に書き足す（依頼の小窓 v2・R7b・D15）：上のカードに「書き足す →」（小窓が edit を渡したときだけ。読む画面の重ね窓）。
//     書き足した版で開き直すときは look（一文と「この画像で送るもの」の 1 行）を渡す。① で貼るのはその画像（書き足した版の PNG）。
//     画像が変わったら ① からやり直す（open）。同じ画像のまま一文だけ変わるときは setLook
//   ・画像と文を一つの貼り付けで（依頼の小窓 v2・R7d・D16。巣の設定 pasteMode が html のとき。小窓が setOneShot で渡す）：① は出さず、
//     「貼るのは1回：画像と文を一つの貼り付けで（試し。受けないと画像が落ちる）」と「この回は 2 回貼りで」。小窓の主のボタンは「コピーしてアプリを開く」。
//     押したら prepareOne が渡す画像（いま開いている画像。書き足した版なら黒塗りを焼き込んだ PNG）の写しを bot-shots に保存して名前を返し、
//     小窓がその名前を左へ渡す（左が依頼の文と一緒に 1 回で書く）。保存できなければ、この回は 2 回貼りに戻す。
//     ファイルの逃げ道（「貼れない：次からはファイルで送る」）にしてあれば、画像は貼らないので 2 回の道のまま
import { clipImageLine, loadShotFill, loadShotPaste, newShotId, saveShotFill, saveShotPaste, type ShotFill, shotImageLine, type ShotPaste, type ShotRef, shotToPng } from '../bot-shot';
import { el } from '../util';

export interface ShotStepsHost {
  copyImage(png: string, fill: ShotFill): Promise<boolean>; // 画像だけをクリップボードへ（clipboardWriteImage）
  saveImage(shotId: string, png: string): Promise<string | null>; // bot-shots に保存（botShotSave）。保存したフルパス
  openFolder(shotId: string): void; // bot-shots を開く（botShotOpenFolder）
  copyText(text: string): Promise<boolean>; // 文字をクリップボードへ（画像のパス）
  openApp(botId: string): void; // そのボットのチャットを開く（左に頼む）
}

// 先に取った写し（R7a。クリップボードの画像の候補）。shotId は bot-shots\<shotId>.png の名前、png は Base64（data: の頭なし）、path は保存したフルパス
export interface ShotCopy {
  shotId: string;
  png: string;
  path: string;
}

// 書き足した画像（R7b）で開いたときの、依頼の text に足す一文（path：パスも添えるときのフルパス）と、カードの「この画像で送るもの」の 1 行
export interface ShotLook {
  line(path?: string): string;
  note: string;
}

export class ShotSteps {
  readonly top = el('div', 'brf-shot');
  readonly steps = el('div', 'brf-shot-steps');
  private readonly thumb = el('img', 'brf-shot-thumb');
  private readonly fillRow = el('label', 'brf-shot-fill');
  private readonly fillSelect = el('select', 'brf-shot-select');
  private readonly firstButton = el('button', 'brf-button brf-primary');
  private readonly skipButton = el('button', 'brf-link', '画像を貼らずに ② へ');
  private readonly msg = el('p', 'brf-shot-msg');
  private readonly fallback = el('details', 'brf-shot-fallback');
  private readonly saveButton = el('button', 'brf-button', '画像をファイルに保存してフォルダを開く');
  private readonly pathButton = el('button', 'brf-button', '画像のパスをコピー');
  private readonly withPath = el('input', 'brf-checkbox');
  private readonly giveUpButton = el('button', 'brf-link', '貼れない：次からはファイルで送る');
  private readonly backButton = el('button', 'brf-link brf-shot-back', '画像の貼り付けを試す（戻す）');
  private readonly editButton = el('button', 'brf-button brf-shot-edit', '書き足す →'); // R7b
  private readonly editNote = el('span', 'brf-shot-edit-note');
  private readonly how = el('p', 'brf-shot-how');
  private readonly twoButton = el('button', 'brf-link', 'この回は 2 回貼りで'); // R7d
  private look: ShotLook | null = null; // 書き足した画像の一文と 1 行（R7b）
  private image = '';
  private title = '';
  private shotId = '';
  private png: Promise<string | null> | null = null; // PNG にした画像（はじめて要るときに1回だけ作る）
  private path = ''; // 保存したフルパス
  private mode: ShotPaste = 'paste';
  private done = false; // ① を済ませた（か、飛ばした）：② を押せる
  private busy = false;
  private linked = false; // 宛て先にリンクがある（① でアプリを開ける）
  private clip = false; // クリップボードの画像の候補の写しで開いた（R7a）
  private oneWanted = false; // 巣の設定が画像入り 1 回（R7d）。「この回は 2 回貼りで」・保存できなかったときは、この小窓のあいだ false

  // changed：② を押せるかが変わった（小窓の refresh）　first：① を押した（小窓が、はじめての確かめをしてから runFirst を呼ぶ）
  //   edit：「書き足す →」を押した（R7b。無ければボタンを出さない）
  constructor(
    private readonly host: ShotStepsHost,
    private readonly changed: () => void,
    first: () => void,
    edit?: () => void,
  ) {
    this.top.hidden = true;
    this.steps.hidden = true;

    // 上：サムネイル・画像は Grok Bot に送られます・透明な所の色
    this.thumb.alt = '送る六角スクショ';
    const info = el('div', 'brf-shot-info');
    const warn = el('p', 'brf-shot-warn', '⚠ 画像は Grok Bot に送られます');
    warn.title = '貼った画像は Grok Bot アプリを通って、外（x.ai）に送られます';
    for (const [value, label] of [
      ['white', '白'],
      ['dark', '暗い色'],
    ] as const) {
      const o = el('option', '', label);
      o.value = value;
      this.fillSelect.append(o);
    }
    this.fillSelect.addEventListener('change', () => saveShotFill(this.fillSelect.value === 'dark' ? 'dark' : 'white'));
    this.fillRow.title = '六角形の外の透明な所を塗る色（クリップボードに入れる画像だけ。保存するファイルは透明のまま）';
    this.fillRow.append(el('span', '', '透明な所'), this.fillSelect);
    // 書き足す（R7b）：ボタンと、書き足したあとの「この画像で送るもの」の 1 行
    const editRow = el('div', 'brf-shot-edit-row');
    this.editButton.type = 'button';
    this.editButton.title = '画像に丸・矢印・四角（箱ごとに問い）・番号・文字を書き足したり、黒塗り・ぼかしで隠したり、一点を指さしたりします。元の画像は手元に残ります';
    this.editButton.hidden = !edit;
    if (edit) this.editButton.addEventListener('click', () => edit());
    this.editNote.hidden = true;
    editRow.append(this.editButton, this.editNote);
    info.append(el('span', 'brf-shot-name', '六角スクショ（画像1枚）'), warn, this.fillRow, editRow);
    this.top.append(this.thumb, info);

    // 下：① と案内・飛ばす・貼れなかったとき
    this.firstButton.type = 'button';
    this.firstButton.addEventListener('click', () => first());
    this.skipButton.type = 'button';
    this.skipButton.title = '画像は貼らずに（ドラッグで添付するなど）、② 文をコピーへ進みます';
    this.skipButton.addEventListener('click', () => {
      this.done = true;
      this.say('① を飛ばしました。画像をチャットに添えたら（ドラッグでも）、「② 文をコピー」を押してください');
      this.update();
    });
    this.msg.setAttribute('aria-live', 'polite');

    this.saveButton.type = 'button';
    this.saveButton.addEventListener('click', () => void this.saveAndOpen());
    this.pathButton.type = 'button';
    this.pathButton.title = '保存した画像のフルパスを、文字としてコピーします（アプリの添付のファイル選びに貼れます）';
    this.pathButton.addEventListener('click', () => void this.copyPath());
    this.withPath.type = 'checkbox';
    this.withPath.addEventListener('change', () => void this.togglePath());
    const pathRow = el('label', 'brf-check');
    pathRow.title = '依頼の文の「画像を1枚、チャットに添えました」の後ろに、保存した画像のフルパスを書きます（パスには Windows のユーザー名が入ります）';
    pathRow.append(this.withPath, el('span', 'brf-check-label', '依頼の文に画像のパスも添える'));
    this.giveUpButton.type = 'button';
    this.giveUpButton.title = 'Grok Bot アプリのチャットに画像を貼れないとき。次からは、はじめから「画像を保存してフォルダを開く」にします（小窓の隅で戻せます）';
    this.giveUpButton.addEventListener('click', () => this.setMode('file', true));
    this.backButton.type = 'button';
    this.backButton.title = '「① 画像をコピーしてアプリを開く」に戻します（次からも）';
    this.backButton.addEventListener('click', () => this.setMode('paste', true));
    const fallbackBox = el('div', 'brf-shot-fallback-box');
    fallbackBox.append(
      this.saveButton,
      el('p', 'brf-note', '開いたフォルダの画像を、アプリのチャットへドラッグして添付してください'),
      this.pathButton,
      pathRow,
      this.giveUpButton,
    );
    this.fallback.append(el('summary', 'brf-shot-summary', '貼れなかったとき'), fallbackBox);

    this.twoButton.type = 'button';
    this.twoButton.title = 'この依頼だけ、① 画像 → ② 文の 2 回に分けて貼ります（巣の設定は変えません）';
    this.twoButton.addEventListener('click', () => {
      this.oneWanted = false;
      this.say('この回は 2 回貼り（① 画像 → ② 文）で送ります');
      this.update();
    });

    const row = el('div', 'brf-shot-row');
    row.append(this.firstButton, this.skipButton, this.twoButton);
    this.steps.append(this.how, row, this.msg, this.fallback, this.backButton);
  }

  get active() {
    return !!this.image;
  }

  // ② を押せる（① を済ませた・飛ばした）。画像入り 1 回（R7d）なら、はじめから押せる（① は無い）
  get ready() {
    return this.active && (this.done || this.oneShot);
  }

  // 画像と文を一つの貼り付けで送る（R7d。巣の設定が html で、ファイルの逃げ道にしていない）
  get oneShot() {
    return this.active && this.oneWanted && this.mode === 'paste';
  }

  // 巣の設定の貼り方（R7d。小窓が開くたびに渡す。「この回は 2 回貼りで」も戻る）
  setOneShot(on: boolean) {
    this.oneWanted = on;
    if (this.active) this.render();
  }

  // ① でアプリを開く（はじめての「外のアプリを開きます」の確かめが要る）
  get opensApp() {
    return this.mode === 'paste';
  }

  // 画像つきで開く（開くたびに、はじめから）。copy：先に取った写し（R7a のクリップボードの画像。あれば上は出さない）
  //   look：書き足した画像の一文と 1 行（R7b。無ければ六角スクショ・クリップボードの画像のふつうの一文）
  open(image: string, title: string, copy?: ShotCopy, look?: ShotLook) {
    this.image = image;
    this.title = title;
    this.clip = !!copy;
    this.shotId = copy?.shotId ?? newShotId();
    this.png = copy ? Promise.resolve(copy.png) : null;
    this.path = copy?.path ?? '';
    this.done = false;
    this.busy = false;
    this.mode = loadShotPaste();
    this.fillSelect.value = loadShotFill();
    this.withPath.checked = false;
    this.thumb.src = image;
    this.fallback.open = this.mode === 'file';
    this.say('');
    this.setLook(look);
    this.top.hidden = this.clip;
    this.steps.hidden = false;
    this.render(); // 小窓は開き終えてから refresh する
  }

  // 一文と「この画像で送るもの」の 1 行だけを替える（R7b。画像は同じまま。① はやり直さない）
  setLook(look?: ShotLook) {
    this.look = look ?? null;
    this.editNote.textContent = look?.note ?? '';
    this.editNote.hidden = !look;
  }

  // 「書き足す →」に戻る（書き足しの面から戻ったとき。R7b）
  focusEdit() {
    if (!this.top.hidden && !this.editButton.hidden) this.editButton.focus({ preventScroll: true });
  }

  // 閉じる（画像を持ち続けない）
  close() {
    this.image = '';
    this.clip = false;
    this.png = null;
    this.setLook();
    this.thumb.removeAttribute('src');
    this.top.hidden = true;
    this.steps.hidden = true;
  }

  // 依頼の text の後ろに付ける画像の一文（パスも添えるなら、保存したフルパスも）
  imageLine(): string {
    const path = this.withPath.checked && this.path ? this.path : undefined;
    if (this.look) return this.look.line(path); // 書き足した画像（R7b）
    return this.clip ? clipImageLine(path) : shotImageLine(this.title, path);
  }

  // 小窓の宛て先が変わった・押せるかが変わった
  refresh(linked: boolean) {
    this.linked = linked;
    if (this.active) this.render();
  }

  // ① を行う（小窓が、はじめての確かめを済ませてから呼ぶ）
  //   貼る：画像をクリップボードへ → 書けたらアプリを開く。書けなければ逃げ道に切り替える（アプリは開かない。設定は変えない）
  //   ファイル：保存してフォルダを開く
  async runFirst(botId: string | undefined) {
    if (!this.active || this.busy) return;
    if (this.mode === 'file') {
      await this.saveAndOpen();
      return;
    }
    if (!botId) return;
    this.busy = true;
    this.say('画像をコピーしています…');
    this.update();
    const png = await this.pngData();
    const ok = !!png && (await this.host.copyImage(png, this.fillSelect.value === 'dark' ? 'dark' : 'white'));
    this.busy = false;
    if (!this.active) return; // 待つあいだに閉じた
    if (!ok) {
      this.mode = 'file';
      this.fallback.open = true;
      this.say('画像をコピーできませんでした（アプリは開いていません）。「① 画像を保存してフォルダを開く」から、ドラッグで添付できます');
      this.update();
      return;
    }
    this.host.openApp(botId);
    this.done = true;
    this.say('① 画像をコピーして、アプリを開きました。チャットに画像を貼ってください（Ctrl+V）→ 貼れたら「② 文をコピー」');
    this.update();
  }

  // 画像入り 1 回の準備（R7d）：渡す画像の写しを bot-shots に保存して（保存済みならそのまま）、名前と透明な所の色を返す。
  //   保存できなければ null（この回は 2 回貼りに戻して知らせる）
  async prepareOne(): Promise<ShotRef | null> {
    if (!this.oneShot || this.busy) return null;
    this.busy = true;
    this.say('画像の写しを保存しています…');
    this.update();
    const path = await this.ensureSaved();
    this.busy = false;
    if (!this.active) return null; // 待つあいだに閉じた
    if (!path) {
      this.oneWanted = false;
      this.say('画像の写しを保存できなかったので、この回は 2 回貼り（① 画像 → ② 文）に戻しました');
      this.update();
      return null;
    }
    this.say('');
    this.render();
    return { shotId: this.shotId, fill: this.fillSelect.value === 'dark' ? 'dark' : 'white' };
  }

  // ---------- 内側 ----------

  private render() {
    const file = this.mode === 'file';
    const one = this.oneShot;
    this.how.textContent = one ? '貼るのは1回：画像と文を一つの貼り付けで（試し。アプリが受けないと、文だけが貼られて画像は落ちます）' : '貼るのは2回：① 画像 → ② 文';
    this.firstButton.hidden = one; // 1 回のときは ① が無い（小窓の「コピーしてアプリを開く」でまとめて）
    this.twoButton.hidden = !one;
    this.twoButton.disabled = this.busy;
    this.firstButton.textContent = file ? '① 画像を保存してフォルダを開く' : '① 画像をコピーしてアプリを開く';
    this.firstButton.title = file
      ? '画像を bot-shots フォルダに保存して、エクスプローラーで開きます。画像をアプリのチャットへドラッグして添付してください'
      : this.linked
        ? '画像だけをクリップボードに入れて、Grok Bot アプリのチャットを開きます。チャットに貼って（Ctrl+V）から ② へ'
        : '宛て先を選ぶと押せます';
    this.firstButton.disabled = this.busy || (!file && !this.linked);
    this.firstButton.classList.toggle('brf-primary', !this.done); // ① を済ませたら、主のボタンは ②
    this.skipButton.hidden = this.done || one;
    this.fillRow.hidden = file; // 塗るのはクリップボードの画像だけ
    this.saveButton.hidden = file; // ファイルのときは ① と同じ
    this.saveButton.disabled = this.busy;
    this.pathButton.disabled = this.busy;
    this.editButton.disabled = this.busy; // 画像をコピー・保存しているあいだは書き足さない（R7b）
    this.giveUpButton.hidden = loadShotPaste() === 'file';
    this.backButton.hidden = loadShotPaste() !== 'file';
  }

  // 描き直して、小窓にも知らせる（② を押せるかが変わったかもしれない）。小窓の refresh からは render だけ（呼び合わないように）
  private update() {
    this.render();
    this.changed();
  }

  private say(text: string) {
    this.msg.textContent = text;
  }

  private pngData(): Promise<string | null> {
    this.png ??= shotToPng(this.image);
    return this.png;
  }

  // 保存する（1枚の画像は1回だけ。同じ小窓でもう一度押したら、同じファイルを使う）
  private async ensureSaved(): Promise<string> {
    if (this.path) return this.path;
    const png = await this.pngData();
    const path = png ? await this.host.saveImage(this.shotId, png) : null;
    if (path && this.active) this.path = path;
    return this.path;
  }

  private async saveAndOpen() {
    if (this.busy) return;
    this.busy = true;
    this.say('画像を保存しています…');
    this.update();
    const path = await this.ensureSaved();
    this.busy = false;
    if (!this.active) return;
    if (!path) {
      this.say('画像を保存できませんでした。もう一度押せます');
      this.update();
      return;
    }
    this.host.openFolder(this.shotId);
    this.done = true;
    this.say('① 画像を保存して、フォルダを開きました。画像をアプリのチャットへドラッグして添付してから、「② 文をコピー」を押してください');
    this.update();
  }

  private async copyPath() {
    if (this.busy) return;
    this.busy = true;
    this.update();
    const path = await this.ensureSaved();
    const ok = !!path && (await this.host.copyText(path));
    this.busy = false;
    if (!this.active) return;
    this.say(ok ? `画像のパスをコピーしました（アプリの添付のファイル選びに貼れます）。② を押すと、クリップボードは依頼の文に変わります` : '画像のパスをコピーできませんでした');
    this.update();
  }

  // パスも添える：まだ保存していなければ、先に保存する（できなければ外す）
  private async togglePath() {
    if (!this.withPath.checked || this.path) {
      this.changed();
      return;
    }
    const path = await this.ensureSaved();
    if (!this.active) return;
    if (!path) {
      this.withPath.checked = false;
      this.say('画像を保存できなかったので、パスは添えられません');
    }
    this.changed();
  }

  // 貼るか・ファイルか。remember：次からも（「貼れない」と決めた・戻した）
  private setMode(mode: ShotPaste, remember: boolean) {
    if (remember) saveShotPaste(mode);
    this.mode = mode;
    this.fallback.open = mode === 'file';
    this.say(
      mode === 'file'
        ? '次からは、はじめから「画像を保存してフォルダを開く」にします（小窓の隅の「画像の貼り付けを試す」で戻せます）'
        : '「① 画像をコピーしてアプリを開く」に戻しました',
    );
    this.update();
  }
}
