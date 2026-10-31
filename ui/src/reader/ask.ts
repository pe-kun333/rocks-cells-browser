// 「🔍 Grok に調べてもらう」の依頼の小窓を、ページの上（読む画面の重ね窓）に出す（第3段 S3.11。docs/bot-cells/plan-s3-nest.md）
//   ・左から botAsk が届いたら開く（ページの右クリック・Ctrl+Shift+G・メモのセルの右クリック）。小窓は右の巣の上と同じ部品
//     （panels/bot-request-form.ts）。宛て先は巣の席・台帳の登録ボット・「みんな」。はじめに選ぶのは左が決めた to
//   ・添付は左が決めたもの（ページの URL・題名・選んだ文。本文は付けない）。送るのは AskLeftSender（命令 botDraftV2 → 左の ClipboardSender）。
//     依頼を作る・覚える・コピーしてアプリを開くのは今までどおり左だけ
//   ・後ろには、左が撮ったページの画像を暗くして敷く（ページの上に出ているように見せる。撮れなければ地の色）。
//     六角で読んでいる上（over: reader）では、読む画面を薄く暗くするだけ
//   ・閉じたら（送った・やめる・Esc）：over が page なら読む画面も閉じてページに戻る。reader なら読む画面はそのまま
//   ・合体 Grok の演出（S3.7）は右の巣の上だけのもの。ここでは「みんな」を選んでも、許可は聞かずにそのまま送る
//   ・六角スクショを Grok-Bot へ（S3.12。botAsk の shot）：撮る画面の「Grok に送る」から。小窓は画像のサムネイルつきの二段
//     （① 画像をコピーしてアプリを開く → ② 文をコピー。panels/bot-shot-steps.ts）で、宛て先は1体だけ。コメントは頼む文の最初の行。
//     画像をクリップボードに入れる・bot-shots に保存する・フォルダを開くのはこの面から C++ に頼む（bot-shot.ts）。
//     アプリを開くのは左（命令 botOpenApp。読む画面は openBotApp を使えない）
//   ・定型（依頼の小窓 v2・R4a）：botAsk の presets（左の presets.json の写し）を小窓に渡す。入口は botAsk の entry
//     （ページ・メモのセル・六角スクショ。はじめの組を決める）。押した定型は命令 botPresetUsed で左に知らせる。
//     棚を整える（R4b）は右の巣の ⚙ の「定型」タブなので、ここでは openShelf を渡さない（小窓が「巣の ⚙ で」と知らせる）
//   ・前と同じで（R6）：botAsk の lastRequest（前回送った依頼の選び方）を小窓に渡す。same（Ctrl+Shift+G を素早く 2 回）なら開いたらすぐ当てる。
//     開いているあいだに同じ添付で same が来たら、小窓に戻るだけでなく当てる
//   ・続きとして（R5）：botAsk の replies（確かめが通った返事 5 件）を選び口に渡す。要点の行は命令 botAnswerLines で左に頼み、
//     relay の botAnswerLines を answerLines で受ける（AnswerLinesAsker）
//   ・クリップボードの画像の候補（依頼の小窓 v2・R7a）：botAsk の candidate（左が読んだ画像）を小窓に渡す（六角スクショのときは渡さない）。
//     印を付けたら、写しの保存はこの面から C++ に頼む（bot-shot.ts の saveShotImage。六角スクショの逃げ道と同じ口）
//   ・画像に書き足す（依頼の小窓 v2・R7b）：小窓の画像のカードの「書き足す →」で、同じ重ね窓に書き足しの面（panels/bot-image-edit.ts）を開く。
//     開いているあいだ小窓は隠すだけ（data-edit。閉じない）。新しい botAsk が来た・読む画面を別のことに使う・閉じたら、書き足しの面はやめる
//   ・隠す候補（依頼の小窓 v2・R7c）：書き足しの面に bot-image-hints.ts の readImageHints を渡す（この面から C++ の readCaptureText に頼み、返事もこの面に届く）
//   ・画像と文を一つの貼り付けで（依頼の小窓 v2・R7d）：botAsk の nest.pasteMode を小窓の pasteMode に渡す（html のときだけ。既定は 2 回貼り）
//   ・webhook「そのまま送る」（依頼の小窓 v2・R11）：botAsk の hook（宛先と鍵の「ある／ない」）を小窓に渡す。結果は relay の botHookResult を
//     hookResult で AskLeftSender に渡す。届かなかった依頼の切り替えは命令 botHookFallback
import { t } from '../i18n';
import { askAttachmentKey } from '../draft-materials';
import { normalizeLastRequest } from '../bot-last-request';
import { normalizePresets, presetOpenEntry } from '../bot-presets';
import { AnswerLinesAsker, AskLeftSender } from '../bot-send';
import { cleanRecentReplies } from '../bots';
import { copyShotImage, copyShotText, openShotFolder, saveShotImage } from '../bot-shot';
import { readImageHints } from '../bot-image-hints';
import { BotImageEdit, type ImageEditPrior, type ImageEditResult } from '../panels/bot-image-edit';
import { BotRequestForm, botRequestTargets } from '../panels/bot-request-form';
import type { RelayCommand, RelayPayload } from '../types';
import { el } from '../util';

export type BotAskPayload = Extract<RelayPayload, { kind: 'botAsk' }>;

export interface ReaderAskHost {
  askLeft(action: RelayCommand): void;
  // 小窓を閉じた。leaveReader：この小窓のために出した読む画面なので、閉じてページに戻る
  closed(leaveReader: boolean): void;
}

export class ReaderAsk {
  readonly element = el('div', 'reader-ask');
  private readonly page = el('img', 'reader-ask-page');
  private readonly form: BotRequestForm;
  private readonly edit = new BotImageEdit(readImageHints); // 画像に書き足す面（R7b）。隠す候補は Windows の文字読み取りで（R7c）
  private over: BotAskPayload['over'] = 'page';
  private key = ''; // 今の添付（同じものでもう一度頼まれたかを見る）
  private readonly lines: AnswerLinesAsker; // 「続きとして」の要点の行を左に頼む（R5）
  private readonly sender: AskLeftSender; // 左に頼む送る部品（webhook の結果は hookResult で受ける。R11）

  constructor(private readonly host: ReaderAskHost) {
    this.lines = new AnswerLinesAsker((action) => host.askLeft(action));
    this.sender = new AskLeftSender((action) => host.askLeft(action));
    this.form = new BotRequestForm({
      sender: this.sender,
      hookFallback: (botId, requestId) => host.askLeft({ command: 'botHookFallback', botId, requestId }), // 届かなかった依頼をコピーに（R11）
      confirmed: () => host.askLeft({ command: 'botAppSeen', confirmed: true }),
      saveRole: (botId, role) => host.askLeft({ command: 'setBotRole', botId, role }), // 役の文の「この役として保存」（依頼の小窓 v2・R3）
      presetUsed: (id, set) => host.askLeft({ command: 'botPresetUsed', id, ...(set ? { set } : {}) }), // 定型を押した・取り込んだ（R4a。set はそのときの組。R4b）
      answerLines: (botId, requestId) => this.lines.ask(botId, requestId), // 続きとして選んだ返事の要点の行（R5）
      closed: () => this.finish(),
      shot: {
        copyImage: copyShotImage,
        saveImage: saveShotImage,
        openFolder: openShotFolder,
        copyText: copyShotText,
        openApp: (botId) => host.askLeft({ command: 'botOpenApp', botId }),
      },
      editImage: (image, prior) => this.openEdit(image, prior), // 画像に書き足す（R7b）
    });
    this.element.hidden = true;
    this.page.alt = '';
    this.page.setAttribute('aria-hidden', 'true');
    this.element.append(this.page, this.form.element, this.edit.element);
  }

  get isOpen() {
    return !this.element.hidden;
  }

  // 左からの「続きとして」の要点の行（R5。relay の botAnswerLines。頼んだものだけを小窓へ）
  answerLines(payload: unknown) {
    this.lines.receive(payload);
  }

  // 左からの webhook の結果（R11。relay の botHookResult。頼んだ ticket だけを小窓へ）
  hookResult(payload: unknown) {
    this.sender.receive(payload);
  }

  // 開く（開いていれば中身を入れ替える）
  //   開いているあいだに同じ添付でもう一度頼まれた（Ctrl+Shift+G をもう一度など）：書きかけを消さないよう、小窓に戻るだけ
  //   開いているあいだに別の添付で頼まれた（メモのセルなど）：入れ替える。ページの上に出していたなら、ページの上のまま（閉じたら読む画面も閉じる）
  open(p: BotAskPayload) {
    const context = p.context ?? {};
    const shot = p.shot && typeof p.shot.image === 'string' && /^data:image\//.test(p.shot.image) ? p.shot : null;
    const candidate = !shot && p.candidate && typeof p.candidate.image === 'string' && /^data:image\//.test(p.candidate.image) ? p.candidate.image : ''; // R7a
    const key = askAttachmentKey(
      [context.url ?? '', context.title ?? '', context.selection ?? '', shot ? [shot.image.length, shot.image.slice(-64), shot.comment] : ''],
      (p.materials?.items ?? []).map((item) => item.key),
    );
    const lastRequest = p.lastRequest ? normalizeLastRequest(p.lastRequest) : null; // 前回送った依頼の選び方（R6。形を確かめ直す）
    const same = p.same === true;
    if (this.isOpen && key === this.key) {
      if (this.edit.isOpen) return; // 書き足しているあいだは、そのまま書き足しの面に（R7b）
      this.form.element.querySelector<HTMLTextAreaElement>('textarea')?.focus();
      if (same) {
        this.form.setLastRequest(lastRequest);
        this.form.applySame(); // Ctrl+Shift+G の 2 回め（書きかけは消さず、選び方だけ戻す）
      }
      return;
    }
    const keepPage = this.isOpen && this.over === 'page';
    this.edit.cancel(); // 書き足しの面はやめる（R7b。小窓は入れ替わる）
    this.key = key;
    this.over = keepPage || p.over !== 'reader' ? 'page' : 'reader';
    this.element.dataset.over = this.over;
    if (p.image && /^data:image\//.test(p.image)) {
      this.page.src = p.image;
      this.page.hidden = false;
    } else if (!keepPage) {
      this.page.removeAttribute('src');
      this.page.hidden = true;
    }
    this.element.hidden = false;
    const nest = p.nest ?? {};
    const presets = p.presets ? normalizePresets(p.presets) : null; // 定型の写し（R4a。形を確かめ直す）
    this.form.setHook(p.hook === true); // webhook「そのまま送る」を押せるか（R11。「ある／ない」だけ）
    this.form.open({
      targets: botRequestTargets(Array.isArray(p.bots) ? p.bots : [], Array.isArray(p.dock) ? p.dock : []),
      to: p.to,
      context,
      confirmApp: p.confirmed !== true,
      nest: { askAll: nest.askAll === 'lead' ? 'lead' : 'each', ...(typeof nest.lead === 'string' ? { lead: nest.lead } : {}) },
      pasteMode: nest.pasteMode === 'html' ? 'html' : 'two', // 画像の貼り方（R7d。巣の設定。html と書いてあるときだけ 1 回）
      heading: shot ? t('Grok に送る（六角スクショ）') : t('Grok に調べてもらう'),
      entry: presetOpenEntry(p.entry, !!shot),
      ...(presets ? { presets } : {}),
      ...(lastRequest ? { lastRequest } : {}),
      ...(same ? { same } : {}),
      replies: cleanRecentReplies(p.replies), // 「続きとして」の選び口（R5。形を確かめ直す）
      ...(p.note ? { note: p.note } : {}),
      ...(shot ? { image: shot.image, text: String(shot.comment ?? '') } : typeof p.text === 'string' ? { text: p.text } : {}),
      ...(candidate ? { candidate: { image: candidate } } : {}), // クリップボードの画像の候補（R7a。印は外した状態）
      ...(p.materials?.items.length ? { materials: p.materials } : {}), // 材料（段 D2）
    });
  }

  // 読む画面を別のことに使う・閉じられた：小窓だけを片づける（読む画面は閉じない）
  dismiss() {
    if (!this.isOpen) return;
    this.over = 'reader';
    this.edit.cancel();
    this.form.close(false);
  }

  // 画像に書き足す面を開く（R7b。小窓の host.editImage）。開いているあいだ小窓は隠す。戻ったら結果、やめたら null
  private openEdit(image: string, prior: ImageEditPrior | null): Promise<ImageEditResult | null> {
    return new Promise((resolve) => {
      this.element.dataset.edit = 'open';
      this.edit.open(image, prior, {
        onDone: (result) => {
          delete this.element.dataset.edit;
          resolve(result);
        },
        onCancel: () => {
          delete this.element.dataset.edit;
          resolve(null);
        },
      });
    });
  }

  // 小窓が閉じた（送った・やめた）
  private finish() {
    if (this.element.hidden) return;
    this.edit.cancel();
    this.element.hidden = true;
    this.page.removeAttribute('src'); // 撮った画像を持ち続けない
    this.host.closed(this.over === 'page');
  }
}
