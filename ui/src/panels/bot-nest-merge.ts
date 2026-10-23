// 合体 Grok の演出と許可の確認（第3段 S3.7。docs/bot-cells/plan-s3-nest.md S3.7・N4、見本 docs/bot-cells/mocks/nest-02-confirm.png〔文言〕）
//   ・巣の設定（⚙ の「みんなに聞く」）の「合体 Grok の演出」がオンのとき、依頼の小窓で「みんなに聞く」を送る前に、巣の上に小さな確認の窓を重ねる
//       「Grok が Heavy に進化して回答しようとしています。許可しますか？」＋「演出です（SuperGrok Heavy の機能とはまだつながっていません）」
//       許可する：巣が「合体 Grok」の見た目になる（BotNest.merged。見た目だけ）→ そのまま送る
//       今回はしない（Esc も）：演出なしで、同じ依頼をそのまま送る
//     どちらを選んでも、送り方（A 1体ずつの案内／B 代表にまとめて）・送る順・依頼の中身は変えない（演出は見た目だけ）
//   ・合体の見た目は、組の依頼が全部終わるか「元に戻す」で戻る（MergeWatch）
//   ・動きは CSS だけ（sheets.css の .bnm・.bot-nest[data-merge]）。JS のアニメーションのループは使わない
import { el } from '../util';

// 確認の窓に出す、これから送る「みんなに聞く」のこと
export interface MergeAskInfo {
  way: 'each' | 'lead'; // A 1体ずつ／B 代表にまとめて
  count: number; // A：聞く席の数　B：並べる役の数
  lead?: string; // B：代表の名前
}

// 許可の確認（巣の上に重ねる小さな窓。幅 296px で崩れないように、文は折り返す・ボタンは2つを1行に）
//   開いている間にもう一度 ask されても、窓は重ねない（同じ答えを待つ）
//   送るボタンの連打（ダブルクリック）の2回目が、出たばかりの窓のボタンに当たっても選ばない（開いてから CLICK_GUARD_MS のあいだのマウスの押し）
const CLICK_GUARD_MS = 400;

export class BotMergeConfirm {
  readonly element = el('section', 'bnm');
  private readonly uid = `bnm${Math.random().toString(36).slice(2, 8)}`;
  private readonly what = el('p', 'bnm-what');
  private readonly allow = el('button', 'brf-button brf-primary bnm-allow', '許可する');
  private readonly skip = el('button', 'brf-button bnm-skip', '今回はしない');
  private waiting: Promise<boolean> | null = null;
  private answer: ((allowed: boolean) => void) | null = null;
  private openedAt = 0;

  constructor() {
    this.element.hidden = true;
    this.element.setAttribute('role', 'alertdialog');
    this.element.setAttribute('aria-modal', 'true');
    const head = el('div', 'bnm-head');
    const icon = el('span', 'bnm-icon', 'G'); // 小さな黒い円と光の輪（CSS）
    icon.setAttribute('aria-hidden', 'true');
    const title = el('h3', 'bnm-title', 'Grok が Heavy に進化して回答しようとしています。許可しますか？');
    title.id = `${this.uid}-title`;
    head.append(icon, title);
    const note = el('p', 'bnm-note', '演出です（SuperGrok Heavy の機能とはまだつながっていません）');
    note.id = `${this.uid}-note`;
    this.what.id = `${this.uid}-what`;
    this.element.setAttribute('aria-labelledby', title.id);
    this.element.setAttribute('aria-describedby', `${this.what.id} ${note.id}`);
    this.allow.type = 'button';
    this.allow.title = '巣が「合体 Grok」の見た目になってから、依頼を送ります（見た目だけ。送り方は変わりません）';
    this.allow.addEventListener('click', (e) => this.pressed(e, true));
    this.skip.type = 'button';
    this.skip.title = '演出なしで、同じ依頼をそのまま送ります（Esc）';
    this.skip.addEventListener('click', (e) => this.pressed(e, false));
    const foot = el('div', 'bnm-foot');
    foot.append(this.allow, this.skip);
    this.element.append(head, this.what, note, foot);
    this.element.addEventListener('keydown', (e) => this.onKey(e));
  }

  get isOpen() {
    return !this.element.hidden;
  }

  // 聞く（true：許可する　false：今回はしない・Esc）
  ask(info: MergeAskInfo): Promise<boolean> {
    if (this.waiting) return this.waiting;
    this.what.textContent =
      info.way === 'lead' ? `みんなに聞く：代表「${info.lead ?? ''}」に ${info.count} 役をまとめて送ります` : `みんなに聞く：${info.count} 体に 1 体ずつ送ります`;
    this.waiting = new Promise<boolean>((resolve) => (this.answer = resolve));
    this.openedAt = performance.now();
    this.element.hidden = false;
    this.allow.focus({ preventScroll: true });
    return this.waiting;
  }

  // ボタンを押した（マウスの押しは、開いてすぐなら見ない。キーボードの Enter・Space は detail が 0）
  private pressed(e: MouseEvent, allowed: boolean) {
    if (e.detail > 0 && performance.now() - this.openedAt < CLICK_GUARD_MS) return;
    this.done(allowed);
  }

  private done(allowed: boolean) {
    const answer = this.answer;
    this.answer = null;
    this.waiting = null;
    this.element.hidden = true;
    answer?.(allowed);
  }

  // Esc：今回はしない（変換中は見ない）。Tab：2つのボタンの間だけを回る。Ctrl+Enter（小窓の送るキー）の続けての押しは選ばない
  private onKey(e: KeyboardEvent) {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.done(false);
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      (document.activeElement === this.allow ? this.skip : this.allow).focus({ preventScroll: true });
    }
  }
}

// 合体の見た目のあいだ、組の依頼が全部終わったかを見る（右は requestId を知らないので、写しの「待っている依頼の数」で見る）
//   ・送った席のボットごとに、送ったときの待っている数（base）を覚える。写しで base より増えたら「依頼ができた」、
//     そのあと base 以下に戻ったら「終わった」（返事・エラー・待つのをやめた。一度終わったら戻さない）
//   ・小窓がまだ送るかもしれない間（A の案内のあいだ）は終わりにしない。閉じたあと、送った席が全部終わったら終わり
//   ・アプリのチャットだけ（記録しない）は数えない。何も数えていなければ、小窓を閉じたときに終わり
//   ・同じボットに前からの依頼が残っていると、そちらの返事で早めに戻ることがある（見た目だけなので、それでよしとする）
export class MergeWatch {
  private readonly seats = new Map<string, { base: number; seen: boolean; done: boolean }>();
  private sending = false;

  // 許可した小窓が送り始める（合体のあいだに、もう一度許可したときも）
  begin() {
    this.sending = true;
  }

  // 1席ぶんを送る部品に渡せた（waiting：そのボットの今の待っている数）。同じボットは最初の分を残す
  add(botId: string, waiting: number) {
    if (!this.seats.has(botId)) this.seats.set(botId, { base: waiting, seen: false, done: false });
  }

  // 小窓を閉じた（もう送らない）
  stop() {
    this.sending = false;
  }

  // 左から写しが届いた（waitingOf：ボットの待っている数）。全部終わったら true
  update(waitingOf: (botId: string) => number): boolean {
    for (const [id, s] of this.seats) {
      if (s.done) continue;
      const w = waitingOf(id);
      if (!s.seen) {
        if (w > s.base) s.seen = true;
      } else if (w <= s.base) s.done = true;
    }
    return this.finished;
  }

  get finished(): boolean {
    return !this.sending && [...this.seats.values()].every((s) => s.done);
  }
}
