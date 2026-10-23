// 月の窓：「公開してよい」の印を付けたフェイブルレターを、右サイドバーの上の区画に1通ずつ映す（数秒ごとに入れ替わる）
//   ・レターは3段で読む：3行の要点 → 手紙（「手紙を読む」）→ 元の会話（「元の会話を見る」）
//   ・入れ替わらないとき：マウスを乗せている・キーボードで中を選んでいる・手紙や会話を開いている・止めた（⏸）・たたんだ
//   ・動きを減らす設定では、入れ替わるときの「ふわっと出る」動きだけを止める（文字が替わるのは動きではないので、入れ替えは続ける）
//   ・印を付けたレターが無ければ、区画ごと出さない
//   ・将来：右サイドバーのいちばん上が一定時間で入れ替わり、ときどき月の窓が出る／レターを外に公開する（docs/ideas-next.md）
//   ・Grok Visions（第3段 S3.7b。visions.ts）：Grok Bot が自分で「有意義」と判断して残した Vision も、同じ窓に1件ずつ映す
//     レターと Visions は上の札（✉ レター／⬡ Grok Visions）で切り替える（両方あるときだけ札を出す。片方だけなら、そちらだけ）
//     Vision は2段：題名と要点（3行まで見せる）→「要点を開く」で全部と出典。「もとの返事へ」で右のボットの欄のその返事のカードへ（無ければ要点を開く）
//     「消す」は2回押す（1回目で「もう一度押すと消えます」）。巣の設定「月の窓に Visions を出す」がオフなら出さない。1件も無ければ今のまま
//     Visions を映している間は、窓の背景を宇宙にする（S3.8b。.moon-cosmos：星とブラックホール。CSS だけ・明暗の画面で同じ）
//   ・めぐる表示（docs/plan-rotating-display.md。rotate.ts）：⚙ で入れると、札に「⟳ めぐる」が出て、選んだものを使う人の間で1つずつ映す
//     R1 単語帳：表だけを出し「答えを見る」で裏。答えを開いている間は替わらない
//     R2 リマインダー：文と「あと n 分」。まだ時間になっていないものを近い順に。時間になったものは、次に替わるときまで残してから外す
//     両方に印があるときは交互。⚙ を開いている間は替わらない。レターと Visions は8秒のまま
//     入れていれば、レターも Visions も無いときでも区画を出す。めぐる表示そのものは AI を使わない
//   ・ひとこと（R3・R4・R5。rotate-comment.ts、ai/comment.ts）：⚙ の「AI のひとこと」。入れる前の確認のあと
//     練習モードは練習の文。切っているときは、選んだ組（ハイク組かソネット三人組）が1回だけ本物を呼ぶ
//     単語帳の場所は「答えの前」「答えの後」「両方」。標準は答えの後。10秒映して、決めた間と1日の上限と月の上限の8割で止まる
//     「会話に残す」を押したときだけ、相棒の会話に1行残す（呼び出しはしない）
import { armConfirm } from '../confirm-arm';
import type { CommentMaterial } from '../ai/comment';
import { askComment } from '../ai/comment';
import type { OrganizeSettings } from '../ai/organize';
import type { Letter, LetterStore } from '../ai/letters';
import { BudgetError, loadBudget } from '../ai/budget';
import { describeError } from '../ai/client';
import {
  advanceDwell,
  type CommentConsent,
  type CommentPrefs,
  type CommentRecord,
  type CommentSpot,
  type CommentTeam,
  COMMENT_DEFAULT,
  COMMENT_DWELL_MS,
  commentForPlace,
  commentKeepText,
  commentKey,
  commentVisible,
  commentsToday,
  clampCap,
  clampMinutes,
  cleanCommentPrefs,
  cleanConsent,
  consentCovers,
  dayKey,
  failureNote,
  lastCommentAt,
  loadComments,
  nextCommentSpot,
  practiceLines,
  priceText,
  rememberComment,
  teamChoiceLabel,
  spotsFor,
  waitLabel,
  waitMs,
} from '../rotate-comment';
import {
  buildRotateSlots,
  cleanRotatePrefs,
  everyLabel,
  MOON_PREFS_KEY,
  remainingLabel,
  ROTATE_DEFAULT,
  ROTATE_EVERY,
  type RotateGrain,
  type RotateKind,
  type RotatePrefs,
  type RotateSlot,
  rotateTag,
  sameSlot,
  slotKey,
  upcomingReminders,
} from '../rotate';
import { clockOf, dayLabel } from '../reminder-when';
import { reminderLink } from '../reminders';
import {
  hiddenIds,
  loadSnooze,
  moonLit,
  ripeIds,
  type RotateSnooze,
  saveSnooze,
  skipToday,
  snoozeLater,
  takeRipe,
  withDayStart,
} from '../rotate-snooze';
import type { Reminder } from '../types';
import { el } from '../util';
import { formatBytes } from '../vault';
import type { Vision, VisionView } from '../visions';
import { type CardImage, dayOf, type Grade, isDue, type VocabCard } from '../vocab';
import { moonSvg } from './moon';

export interface MoonWindowActions {
  openLetter(id: string): void; // 相棒の「履歴」→「✉ フェイブルレター」で、そのレターを見せる
  openConversation(id: string): void; // 元の会話を開く（元の会話を残していない前のレター）
  openReply?(vision: Vision): void; // Vision のもとの返事（右のボットの欄のカード）へ。出せないときは showVisionPoints で要点を開く
  removeVision?(id: string): void; // Vision を消す（確かめは月の窓で済ませてある。消すのは左）
  openUrl?(url: string): void; // Vision の出典を開く
}

// めぐる表示に映すもの（右に届いている写し）
export interface MoonRotateSource {
  vocab(): readonly VocabCard[];
  reminders(): readonly Reminder[];
  onChange(fn: () => void): void;
  openVocab(id: string): void; // 右の単語帳パネルで、そのカードを開く
  openReminder(): void; // 右のリマインダーパネルへ移る
  grade?(id: string, grade: Grade): void; // 1 枚の「できた」「もう一度」を左に頼む（K1）
  setMark?(id: string, on: boolean): void; // ⟳ の印を付け外す（左に頼む。K1）
  openReminderLink?(reminder: Reminder): void; // リマインダーの指す先へ（K3）
  delayReminder?(reminder: Reminder, ms: number, fired: boolean): void; // 延ばす（K3。fired：もう鳴ったもの〈次に替わるまで残している〉）
  doneReminder?(id: string, fired: boolean): void; // 済み（K3。左の doneReminder）
  image?(image: CardImage): string | null | undefined; // カードの指す画像（K6。読んでいる間は undefined、消えていれば null）
  hereIds?(): readonly string[]; // 左が表示中のページから作ったカード（K6。「このページ n 枚」）
  cellLink?(card: VocabCard): { title: string; open(): void } | null; // リンクの先頭のセル（K6。「セルへ：題名」）
  practice(): boolean; // 相棒の練習モード（入れているあいだは、練習の文だけ。API は呼ばない）
  voices(team: CommentTeam): string[]; // 組の3体までの名前
  aiSettings(): OrganizeSettings; // API キーと練習モード（本物のひとことは、ここを使う）
  keepComment(text: string): void; // 「会話に残す」。呼び出しはしない
  sidebarOpen(): boolean; // 右サイドバーが開いているか
}

type MoonView = 'letters' | 'visions' | 'rotate';

const ROTATE_MS = 8_000; // 1通を映す時間
const PREFS_KEY = MOON_PREFS_KEY; // 左の入れる小窓も「新しく入れたカードに ⟳」を読む（rotate.ts の savedMarkNew）

export class MoonWindow {
  readonly element = el('section', 'moon-window');
  private currentId: string | null = null; // いま映しているレター
  private showBody = false; // 手紙を開いている
  private showChat = false; // 元の会話を開いている
  private hovering = false;
  private focused = false;
  private paused: boolean; // 使う人が止めた
  private collapsed: boolean; // たたんでいる
  private timer = 0;
  private renderedKey = '';
  private fade = false; // 入れ替わった直後（ふわっと出す）
  private readonly reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private view: MoonView; // レターと Visions のどちらを映すか（使う人が札で選ぶ）
  private visionId: string | null = null; // いま映している Vision
  private visionOpen = false; // Vision の要点を開いている
  private confirmRemove: string | null = null; // 「消す」を1回押した Vision
  private timerView: MoonView | null = null; // いま待っている入れ替えの方（同じ方なら、描き直しで待ち直さない）
  private rotatePrefs: RotatePrefs;
  private commentPrefs: CommentPrefs;
  private consent: CommentConsent | null;
  private records: CommentRecord[] = [];
  private recordsReady = false;
  private dwell = { key: null as string | null, ms: 0, ticked: 0 };
  private commentBusy = false;
  private budgetHold = false;
  private budgetChecked = 0;
  private holdNote = ''; // 数えずに止めているわけ（API キーが無い）
  private vocabOrder: string[] = []; // 単語帳の並び（カードの増減まで覚えておく）
  private slots: RotateSlot[] = []; // いまの映す順（時間になったリマインダーは、次に替わるまで残す）
  private slotAt = 0;
  private dueAtOf = new Map<string, number>(); // 写しから外れても、時間になったのか取り消したのかを分ける
  private reminderCache = new Map<string, Reminder>();
  private answerOpen = false; // 答えを開いている
  private settingsOpen = false; // ⚙ を開いている
  private moreOpen = false; // めぐる表示の 1 枚の「…」を開いている（K1）
  private snooze: RotateSnooze = loadSnooze(dayOf(new Date())); // 今日はもう出さない・あとで・今日の初めの枚数（K1）
  private bundle: string | null = null; // 「このページ n 枚」の一時の束（押したときの id の並び。並びが替わると解ける。K6）

  constructor(
    private readonly store: LetterStore,
    private readonly actions: MoonWindowActions,
    private readonly visionView?: VisionView,
    private readonly rotateSource?: MoonRotateSource,
  ) {
    const prefs = loadPrefs();
    this.paused = prefs.paused;
    this.collapsed = prefs.collapsed;
    this.view = prefs.view;
    this.rotatePrefs = prefs.rotate;
    this.commentPrefs = prefs.comment;
    this.consent = prefs.consent;
    this.element.setAttribute('role', 'region');
    this.element.setAttribute('aria-label', visionView ? '月の窓（公開してよいフェイブルレターと Grok Visions）' : '月の窓（公開してよいフェイブルレター）');
    this.element.addEventListener('mouseenter', () => this.setHover(true));
    this.element.addEventListener('mouseleave', () => this.setHover(false));
    // 中を操作している間は止める：キーボードで入ったときだけ（マウスで押したボタンにも focus が残るので、それでは止めない）。
    //   ⏸ そのものに focus があるときは止めない（⏸／▶ で決める）
    this.element.addEventListener('focusin', (e) => {
      const target = e.target;
      this.focused = target instanceof HTMLElement && target.matches(':focus-visible') && target.dataset.key !== 'pause';
      this.schedule();
    });
    this.element.addEventListener('focusout', (e) => {
      if (e.relatedTarget instanceof Node && this.element.contains(e.relatedTarget)) return;
      this.focused = false;
      this.schedule();
    });
    this.element.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.confirmRemove) {
        e.stopPropagation();
        this.cancelRemove();
      } else if (e.key === 'Escape' && this.settingsOpen) {
        e.stopPropagation();
        this.closeSettings();
      }
    });
    this.reduceMotion.addEventListener('change', () => this.update());
    document.addEventListener('visibilitychange', () => this.schedule());
    store.onChange(() => this.update());
    visionView?.onChange(() => this.update());
    rotateSource?.onChange(() => this.update());
    // 「あと n 分」を進める。入れ替えの待ち時間は、ここではやり直さない（schedule が同じ方ならそのまま待つ）
    window.setInterval(() => {
      if ((this.rotatePrefs.on && this.shownView === 'rotate') || this.rotatePrefs.nextBand) this.update(); // 帯の「5 分前から金」も（K3）
    }, 15_000);
    window.setInterval(() => this.onCommentTick(), 1_000);
    void this.loadCommentFile();
    this.update();
  }

  private async loadCommentFile() {
    this.records = await loadComments();
    this.recordsReady = true;
    this.update();
  }

  // 単語帳パネルの「月の窓に映す…」から：⚙ を開いて見せる（入れていなくても、区画を出す）
  openSettings() {
    this.settingsOpen = true;
    if (this.collapsed) this.collapsed = false;
    this.savePrefs();
    this.update();
    window.requestAnimationFrame(() => {
      this.element.scrollIntoView({ block: 'nearest' });
      this.element.querySelector<HTMLElement>('[data-key="rotate-on"]')?.focus({ preventScroll: true });
    });
  }

  private setKind(kind: RotateKind, on: boolean) {
    const kinds = on ? [...new Set<RotateKind>([...this.rotatePrefs.kinds, kind])] : this.rotatePrefs.kinds.filter((item) => item !== kind);
    this.setRotate({ ...this.rotatePrefs, kinds });
  }

  private setComment(next: CommentPrefs) {
    this.commentPrefs = next;
    this.savePrefs();
    this.update();
  }

  private setCommentKind(kind: RotateKind, on: boolean) {
    const kinds = on ? [...new Set<RotateKind>([...this.commentPrefs.kinds, kind])] : this.commentPrefs.kinds.filter((item) => item !== kind);
    this.setComment({ ...this.commentPrefs, kinds });
  }

  private acceptComment() {
    if (this.commentPrefs.kinds.length === 0) return;
    this.consent = { kinds: [...this.commentPrefs.kinds], team: this.commentPrefs.team, place: this.commentPrefs.place };
    this.commentPrefs = { ...this.commentPrefs, on: true };
    this.holdNote = '';
    this.savePrefs();
    this.update();
  }

  private cancelComment() {
    if (this.consent) this.commentPrefs = { ...this.commentPrefs, kinds: [...this.consent.kinds], team: this.consent.team, place: this.consent.place };
    else this.commentPrefs = { ...this.commentPrefs, on: false };
    this.savePrefs();
    this.update();
  }

  // 映しているあいだだけ数える。マウスを乗せているあいだも数える（読むのを止めない）。答えを開いていても数える
  private commentGate() {
    return commentVisible({
      sidebarOpen: this.rotateSource?.sidebarOpen() !== false,
      pageVisible: document.visibilityState === 'visible',
      collapsed: this.collapsed,
      paused: this.paused,
      settingsOpen: this.settingsOpen,
      rotateShown: this.shownView === 'rotate' && !this.element.hidden,
    });
  }

  private onCommentTick() {
    if (!this.commentPrefs.on || !this.recordsReady) return;
    const now = Date.now();
    const slot = this.shownView === 'rotate' ? this.slots[this.slotAt] : undefined;
    const key = slot ? slotKey(slot) : null;
    this.dwell = advanceDwell(this.dwell, now, this.commentGate(), key);
    if (this.dwell.key === key && this.dwell.ms >= COMMENT_DWELL_MS) void this.considerComment(now);
    if (this.settingsOpen) this.paintCommentStatus();
  }

  private async considerComment(now: number) {
    if (this.commentBusy || !this.recordsReady) return;
    const prefs = this.commentPrefs;
    if (!prefs.on || !consentCovers(this.consent, prefs)) return;
    const slot = this.slots[this.slotAt];
    if (!slot || !prefs.kinds.includes(slot.kind)) return;
    const cardKey = slotKey(slot);
    if (this.dwell.key !== cardKey || this.dwell.ms < COMMENT_DWELL_MS) return;
    const place = nextCommentSpot(prefs, slot, this.records, now);
    if (!place) return;
    if (waitMs(lastCommentAt(this.records), prefs.everyMs, now) > 0) return;
    if (commentsToday(this.records, new Date(now)) >= prefs.dailyCap) return;
    if (this.budgetHold && now - this.budgetChecked < 60_000) return;
    const practice = this.rotateSource?.practice() === true;
    this.commentBusy = true;
    try {
      const budget = await loadBudget();
      this.budgetChecked = Date.now();
      const near = budget.near || budget.blocked;
      if (near !== this.budgetHold) {
        this.budgetHold = near;
        if (near) this.holdNote = '';
        this.update();
      } else this.budgetHold = near;
      if (near) return;
      if (!this.commentGate() || this.dwell.key !== cardKey) return;
      if (nextCommentSpot(prefs, slot, this.records) !== place) return;
      if (commentsToday(this.records) >= prefs.dailyCap) return;
      if (waitMs(lastCommentAt(this.records), prefs.everyMs, Date.now()) > 0) return;
      if (practice) {
        const lines = practiceLines(this.rotateSource?.voices(prefs.team) ?? [], slot.kind, place);
        await this.storeComment({ key: commentKey(slot, place), team: prefs.team, practice: true, lines });
        return;
      }
      const settings = this.rotateSource?.aiSettings();
      if (!settings?.apiKey) {
        this.setHold('API キーが無いので、呼んでいません');
        return;
      }
      const material = this.materialFor(slot, place, prefs.team);
      if (!material.text.trim()) return;
      const secret = place === 'before' && slot.kind === 'vocab' ? this.cardOf(slot.id)?.back : undefined;
      try {
        const lines = await askComment(material, settings, prefs.team, secret);
        await this.storeComment({ key: commentKey(slot, place), team: prefs.team, practice: false, lines });
      } catch (error) {
        if (error instanceof BudgetError) {
          this.budgetHold = true;
          this.budgetChecked = Date.now();
          this.holdNote = '';
          this.update();
          return;
        }
        // 呼んだあとの失敗は数える。ひとことは出さず、⚙ にわけを1行出す
        await this.storeComment({ key: commentKey(slot, place), team: prefs.team, practice: false, lines: [], note: clipNote(commentErrorNote(error)) });
      }
    } finally {
      this.commentBusy = false;
    }
  }

  private setHold(note: string) {
    if (this.holdNote === note) return;
    this.holdNote = note;
    this.update();
  }

  private async storeComment(record: { key: string; team: CommentTeam; practice: boolean; lines: CommentRecord['lines']; note?: string }) {
    const at = Date.now();
    this.records = await rememberComment({ ...record, day: dayKey(new Date(at)), at });
    this.holdNote = '';
    this.update();
  }

  // 送るもの。単語帳の見つけたページと、ページの中の文は入れない。答えの前は裏も入れない
  private materialFor(slot: RotateSlot, place: CommentSpot, team: CommentTeam): CommentMaterial {
    const names = this.rotateSource?.voices(team) ?? [];
    if (slot.kind === 'reminder') {
      const reminder = this.reminderOf(slot.id);
      return { place: 'after', kind: 'reminder', text: reminder?.text ?? '', remaining: reminder ? remainingLabel(reminder.dueAt) : '', names };
    }
    const card = this.cardOf(slot.id);
    const kind = card?.kind === 'quiz' ? 'quiz' : 'word';
    if (place === 'before') return { place, kind, text: card?.front ?? '', names };
    return { place, kind, text: card?.front ?? '', back: card?.back ?? '', names };
  }

  private commentMark(slot: RotateSlot | undefined): string {
    if (!slot) return '';
    return spotsFor(this.commentPrefs.place, slot.kind)
      .map((place) => {
        const saved = commentForPlace(this.records, slot, place);
        if (!saved) return '';
        return saved.lines.map((line) => line.text).join('/') || saved.note || 'fail';
      })
      .join('|');
  }

  private commentNodes(slot: RotateSlot, place: CommentSpot): HTMLElement | null {
    const saved = commentForPlace(this.records, slot, place);
    if (!saved || saved.lines.length === 0) return null;
    const block = el('div', 'moon-comment');
    block.setAttribute('aria-label', place === 'before' ? '答えの前のひとこと' : 'ひとこと');
    for (const line of saved.lines) {
      const row = el('div', 'moon-comment-line');
      const name = el('span', 'moon-comment-name', line.name);
      row.append(name, document.createTextNode(`：${line.text}`));
      block.append(row);
    }
    const keep = button('会話に残す', 'このひとことを、相棒の会話に1行残します。新しくは呼びません', `keep-${place}`, () => {
      this.rotateSource?.keepComment(commentKeepText(saved.lines));
    });
    block.append(keep);
    return block;
  }

  private paintCommentStatus() {
    const node = this.element.querySelector('[data-key="comment-status"]');
    if (node) node.textContent = this.commentStatusText();
  }

  private commentStatusText(): string {
    const prefs = this.commentPrefs;
    if (!prefs.on) return '';
    if (!consentCovers(this.consent, prefs)) return '「入れる」を押すまで、ひとことは付きません';
    const today = commentsToday(this.records);
    const count = `今日 ${today}/${prefs.dailyCap} 回`;
    if (this.budgetHold) return `${count}。上限に近いので止めています`;
    if (this.holdNote) return `${count}。${this.holdNote}`;
    const failed = failureNote(this.records);
    if (failed) return `${count}。${failed}`;
    if (today >= prefs.dailyCap) return `${count}。この日は、もう付きません`;
    return `${count}。${waitLabel(waitMs(lastCommentAt(this.records), prefs.everyMs, Date.now()))}`;
  }

  private closeSettings() {
    this.settingsOpen = false;
    this.update();
    this.element.querySelector<HTMLElement>('[data-key="settings"]')?.focus({ preventScroll: true });
  }

  private setRotate(next: RotatePrefs) {
    const turnedOn = next.on && !this.rotatePrefs.on;
    this.rotatePrefs = next;
    if (turnedOn) this.view = 'rotate';
    this.answerOpen = false;
    this.clearTimer();
    this.savePrefs();
    this.update();
  }

  // 時間になっていないものだけの並び。単語帳の混ぜ順は vocabOrder に残す
  private freshSlots(now: number): RotateSlot[] {
    const reminders = this.rotateSource?.reminders() ?? [];
    for (const reminder of reminders) {
      this.dueAtOf.set(reminder.id, reminder.dueAt);
      this.reminderCache.set(reminder.id, reminder);
    }
    if (!this.rotatePrefs.on || !this.rotateSource) return [];
    const hidden = hiddenIds(this.snooze, dayOf(new Date(now)), now);
    const here = this.hereBundle();
    if (here) return here.filter((id) => !hidden.has(id)).map((id) => ({ kind: 'vocab', id }));
    const built = buildRotateSlots(this.rotatePrefs.kinds, this.rotateSource.vocab(), this.vocabOrder, reminders, now, this.rotatePrefs.grain);
    this.vocabOrder = built.vocabOrder;
    // 今日はもう出さない・あとでの時間がまだのカードは、並びを作ったあとで外す（混ぜた並びを作り直さない。K1）
    return hidden.size === 0 ? built.slots : built.slots.filter((slot) => slot.kind !== 'vocab' || !hidden.has(slot.id));
  }

  private setSnooze(next: RotateSnooze) {
    this.snooze = next;
    saveSnooze(next);
  }

  // 「このページ n 枚」の束（K6。計画書 §5 の 26）：押したときと同じ並びの間だけ、その id のカードだけを映す。
  //   タブを替えた・このページのカードが増えた・減ったときは解ける（「⟳ の印だけ」などの設定は見ない。今日はもう出さない・あとでは外す）
  private hereBundle(): string[] | null {
    if (this.bundle === null) return null;
    const ids = this.rotateSource?.hereIds?.() ?? [];
    if (ids.length === 0 || ids.join(',') !== this.bundle) {
      this.bundle = null;
      return null;
    }
    const known = new Set((this.rotateSource?.vocab() ?? []).map((card) => card.id));
    return ids.filter((id) => known.has(id));
  }

  private setBundle(on: boolean) {
    this.bundle = on ? (this.rotateSource?.hereIds?.() ?? []).join(',') || null : null;
    this.slots = [];
    this.slotAt = 0;
    this.answerOpen = false;
    this.moreOpen = false;
    this.update();
  }

  // 札「このページ n 枚」（K6）：左が表示中のページから作ったカードがあるときだけ。束にしている間は「戻す」
  private hereNode(): HTMLElement | null {
    const ids = this.rotatePrefs.on ? (this.rotateSource?.hereIds?.() ?? []) : [];
    if (ids.length === 0) return null;
    const box = el('div', 'moon-rotate-note moon-here');
    if (this.bundle !== null) {
      box.append(
        el('span', 'moon-meta', `このページの ${ids.length} 枚を映しています`),
        button('戻す', 'いつもの並びに戻します（タブを替えても戻ります）', 'here-off', () => this.setBundle(false)),
      );
    } else {
      box.append(button(`このページ ${ids.length} 枚`, 'いま左で開いているページから作ったカードだけを映します（タブを替えると戻ります）', 'here-on', () => this.setBundle(true)));
    }
    return box;
  }

  // カードの指す画像（K6。計画書 §5 の 19）：表の下に縮めて出す。読んでいる間は出さない
  private imageState(image: CardImage | undefined): string {
    if (!image || !this.rotateSource?.image) return '';
    const url = this.rotateSource.image(image);
    return `${image.kind}:${image.id}:${url === undefined ? 'loading' : url === null ? 'missing' : 'ok'}`;
  }

  private imageNode(card: VocabCard): HTMLElement | null {
    if (!card.image || !this.rotateSource?.image) return null;
    const url = this.rotateSource.image(card.image);
    if (url === undefined) return null;
    if (url === null) return el('div', 'moon-meta moon-rotate-image-missing', '（消えた画像）');
    const img = el('img', 'moon-rotate-image');
    img.src = url;
    img.alt = '';
    img.decoding = 'async';
    return img;
  }

  // 🔔 あとで の時間が来たカードがあれば、次はそれ（1 回だけ。いま映せないものも予約は消す。K1）
  private ripeSlot(fresh: readonly RotateSlot[], current: RotateSlot | undefined, now: number): number {
    for (const id of ripeIds(this.snooze, dayOf(new Date(now)), now)) {
      this.setSnooze(takeRipe(this.snooze, id));
      const at = fresh.findIndex((slot) => slot.kind === 'vocab' && slot.id === id);
      if (at >= 0 && !(current && sameSlot(current, fresh[at]))) return at;
    }
    return -1;
  }

  // 1 枚の「できた」「もう一度」（K1。計画書 §5 の 3）：左に頼み、今日はもう出さずに次へ
  private gradeRotate(id: string, grade: Grade) {
    this.rotateSource?.grade?.(id, grade);
    this.skipRotate(id);
  }

  // 今日はもう出さない（K1。日が替わると戻る）
  private skipRotate(id: string) {
    this.setSnooze(skipToday(this.snooze, id, dayOf(new Date())));
    this.move(1);
  }

  // 🔔 あとで：1 時間後にもう一度（K1）
  private laterRotate(id: string) {
    this.setSnooze(snoozeLater(this.snooze, id, Date.now()));
    this.move(1);
  }

  // ⟳ の印を外す（印だけを映しているとき。K1）
  private unmarkRotate(id: string) {
    this.rotateSource?.setMark?.(id, false);
    this.move(1);
  }

  // 月の欠け（K1。計画書 §5 の 6）：今日の時期の来たカードの残り ÷ 今日の初めの枚数。単語帳を映していない・カードが無いときは満月
  private moonFraction(now: number): number {
    const cards = this.rotateSource?.vocab() ?? [];
    if (!this.rotatePrefs.on || !this.rotatePrefs.kinds.includes('vocab') || cards.length === 0) return 1;
    const remaining = cards.filter((card) => isDue(card, now)).length;
    const next = withDayStart(this.snooze, dayOf(new Date(now)), remaining);
    if (next !== this.snooze) this.setSnooze(next);
    return moonLit(remaining, next.dayStart?.count ?? remaining);
  }

  // 印だけを映す設定で、印の付いたカードが 1 枚も無い（K1。計画書 §5 の 2。リマインダーは回る）
  private noMarkedCards(): boolean {
    const cards = this.rotateSource?.vocab() ?? [];
    return this.rotatePrefs.grain === 'marked' && this.rotatePrefs.kinds.includes('vocab') && cards.length > 0 && !cards.some((card) => card.rotate === true);
  }

  // 写しの増減を、いま映しているものを飛ばさずに取り込む。時間になったリマインダーだけは、次に替わるまで残す
  private syncSlots(now: number) {
    const fresh = this.freshSlots(now);
    const current = this.slots[this.slotAt];
    if (!current) {
      this.slots = fresh;
      this.slotAt = 0;
      return;
    }
    const still = fresh.findIndex((slot) => sameSlot(slot, current));
    if (still >= 0) {
      this.slots = fresh;
      this.slotAt = still;
    } else if (current.kind === 'reminder' && this.reminderExpired(current.id, now)) {
      const kept = [...fresh];
      const at = Math.min(this.slotAt, kept.length);
      kept.splice(at, 0, current);
      this.slots = kept;
      this.slotAt = at;
    } else {
      // 取り消した・カードを消した：今すぐ外して、残っている隣のものへ
      const neighbor =
        this.slots.slice(this.slotAt + 1).find((slot) => fresh.some((item) => sameSlot(item, slot))) ??
        [...this.slots.slice(0, this.slotAt)].reverse().find((slot) => fresh.some((item) => sameSlot(item, slot)));
      this.slots = fresh;
      this.slotAt = neighbor ? Math.max(0, fresh.findIndex((slot) => sameSlot(slot, neighbor))) : 0;
    }
    if (this.slots[this.slotAt]?.kind !== 'vocab') this.answerOpen = false;
  }

  private reminderExpired(id: string, now: number) {
    const due = this.dueAtOf.get(id);
    return due !== undefined && due <= now;
  }

  private cardOf(id: string) {
    return this.rotateSource?.vocab().find((card) => card.id === id);
  }

  private reminderOf(id: string) {
    return this.rotateSource?.reminders().find((reminder) => reminder.id === id) ?? this.reminderCache.get(id);
  }

  // 札に出す方（中身があるものだけ。めぐる表示は、入れていれば空でも出す）
  private get views(): MoonView[] {
    const out: MoonView[] = [];
    if (this.store.ready && this.letters.length > 0) out.push('letters');
    if (this.visions.length > 0) out.push('visions');
    if (this.rotatePrefs.on) out.push('rotate');
    return out;
  }

  private get letters(): Letter[] {
    return this.store.list().filter((l) => l.publishable);
  }

  // 月の窓に出す Vision（巣の設定でオフ・まだ読み終えていないなら無し）
  private get visions(): readonly Vision[] {
    const v = this.visionView;
    return v && v.enabled && v.ready ? v.list() : [];
  }

  // いま映す方（選んだ方が空なら、出せる最初の方）
  private get shownView(): MoonView {
    const views = this.views;
    return views.includes(this.view) ? this.view : (views[0] ?? 'letters');
  }

  // Vision の要点を開いて見せる（もとの返事のカードが出せなかったとき）
  showVisionPoints(id: string) {
    if (!this.visionView?.get(id)) return;
    this.view = 'visions';
    this.visionId = id;
    this.visionOpen = true;
    this.confirmRemove = null;
    if (this.collapsed) this.collapsed = false;
    this.savePrefs();
    this.update();
  }

  private setView(view: MoonView) {
    if (this.shownView === view) return;
    this.view = view;
    this.showBody = this.showChat = this.visionOpen = this.answerOpen = false;
    this.confirmRemove = null;
    this.savePrefs();
    this.update();
  }

  private setHover(on: boolean) {
    this.hovering = on;
    this.schedule();
  }

  // 描き直して、次に入れ替える時刻を決め直す
  private update() {
    this.render();
    this.schedule();
  }

  // 次のレターへ（step：1 で次、-1 で前）。auto は時間で入れ替わったとき
  private move(step: number, auto = false) {
    this.clearTimer();
    if (this.shownView === 'rotate') {
      const fresh = this.freshSlots(Date.now());
      const current = this.slots[this.slotAt];
      if (fresh.length === 0) {
        this.slots = [];
        this.slotAt = 0;
      } else {
        let next = step > 0 ? this.ripeSlot(fresh, current, Date.now()) : -1; // あとでの時間が来たカードを先に（K1）
        const dir = step >= 0 ? 1 : -1;
        for (let i = this.slotAt + dir; next < 0 && i >= 0 && i < this.slots.length; i += dir) {
          next = fresh.findIndex((slot) => sameSlot(slot, this.slots[i]));
        }
        if (next < 0) {
          const at = current ? fresh.findIndex((slot) => sameSlot(slot, current)) : -1;
          next = at >= 0 ? (at + step + fresh.length) % fresh.length : dir > 0 ? 0 : fresh.length - 1;
        }
        const changed = !current || !sameSlot(current, fresh[next]);
        this.slots = fresh;
        this.slotAt = next;
        this.fade = auto && changed && !this.reduceMotion.matches;
      }
      this.answerOpen = false;
      this.moreOpen = false;
      this.update();
      return;
    }
    if (this.shownView === 'visions') {
      const visions = this.visions;
      if (visions.length === 0) return;
      const at = Math.max(0, visions.findIndex((v) => v.id === this.visionId));
      this.visionId = visions[(at + step + visions.length) % visions.length].id;
      this.visionOpen = false;
      this.confirmRemove = null;
      this.fade = auto && !this.reduceMotion.matches;
      this.update();
      return;
    }
    const letters = this.letters;
    if (letters.length === 0) return;
    const at = Math.max(0, letters.findIndex((l) => l.id === this.currentId));
    this.currentId = letters[(at + step + letters.length) % letters.length].id;
    this.showBody = false;
    this.showChat = false;
    this.fade = auto && !this.reduceMotion.matches;
    this.update();
  }

  private get rotating() {
    const view = this.shownView;
    const many =
      view === 'visions'
        ? this.visions.length > 1 && !this.visionOpen && !this.confirmRemove
        : view === 'rotate'
          ? this.slots.length > 1
            ? !this.answerOpen && !this.moreOpen
            : this.slots.length === 1 && this.slots[0].kind === 'reminder'
          : this.letters.length > 1;
    return (
      many &&
      !this.settingsOpen &&
      !this.paused &&
      !this.collapsed &&
      !this.hovering &&
      !this.focused &&
      !this.showBody &&
      !this.showChat &&
      document.visibilityState === 'visible'
    );
  }

  // 入れ替えを待つ。同じ方をもう待っているなら、そのまま（描き直すたびに待ち直すと、長い間がいつまでも来ない）
  private schedule() {
    if (!this.rotating) {
      this.clearTimer();
      return;
    }
    const view = this.shownView;
    if (this.timer && this.timerView === view) return;
    this.clearTimer();
    this.timerView = view;
    this.timer = window.setTimeout(
      () => {
        this.timer = 0;
        this.move(1, true);
      },
      view === 'rotate' ? this.rotatePrefs.everyMs : ROTATE_MS,
    );
  }

  private clearTimer() {
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.timerView = null;
  }

  private savePrefs() {
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          paused: this.paused,
          collapsed: this.collapsed,
          ...(this.view !== 'letters' ? { view: this.view } : {}),
          rotate: this.rotatePrefs,
          comment: this.commentPrefs,
          ...(this.consent ? { commentConsent: this.consent } : {}),
        }),
      );
    } catch {
      // 保存できなくても動作は続ける
    }
  }

  private render() {
    const letters = this.store.ready ? this.letters : [];
    const visions = this.visions;
    const views = this.views;
    this.element.hidden = views.length === 0 && !this.settingsOpen;
    if (this.element.hidden) {
      this.renderedKey = '';
      return;
    }
    const view = this.shownView;
    if (this.rotatePrefs.on) this.syncSlots(Date.now());
    const slots = this.slots;
    let rotateSlot: RotateSlot | undefined;
    // Visions を映している間だけ、窓の背景を宇宙（星とブラックホール。CSS だけ）にする。レターの夜空はそのまま
    this.element.classList.toggle('moon-cosmos', view === 'visions' && views.includes('visions'));
    let index = 0;
    let total = 0;
    let title: string;
    let itemKey: unknown[];
    if (views.length === 0) {
      title = 'めぐる表示';
      itemKey = ['none'];
    } else if (view === 'rotate') {
      total = slots.length;
      index = total === 0 ? 0 : Math.min(this.slotAt, total - 1);
      this.slotAt = index;
      rotateSlot = this.settingsOpen ? undefined : slots[index];
      if (this.settingsOpen) {
        title = 'めぐる表示';
        itemKey = ['rotate-settings'];
      } else if (rotateSlot?.kind === 'vocab') {
        const card = this.cardOf(rotateSlot.id);
        title = card?.front ?? '映すものがありません';
        itemKey = [
          'vocab',
          slots.map(slotKey).join(','),
          card?.id ?? '',
          card?.front ?? '',
          card?.back ?? '',
          card ? rotateTag(card) : '',
          card?.level ?? '',
          card?.rotate === true,
          this.rotatePrefs.grain,
          this.answerOpen,
          this.moreOpen,
          this.commentMark(rotateSlot),
          this.imageState(card?.image),
          card ? (this.rotateSource?.cellLink?.(card)?.title ?? '') : '',
        ];
      } else if (rotateSlot?.kind === 'reminder') {
        const reminder = this.reminderOf(rotateSlot.id);
        title = reminder?.text ?? '映すものがありません';
        itemKey = ['reminder', slots.map(slotKey).join(','), reminder?.id ?? '', reminder?.text ?? '', reminder ? remainingLabel(reminder.dueAt) : '', this.commentMark(rotateSlot)];
      } else {
        title = '映すものがありません';
        itemKey = ['rotate-empty', this.rotatePrefs.kinds.join(','), this.rotatePrefs.grain];
      }
      itemKey.push(this.noMarkedCards(), `here:${(this.rotatePrefs.on ? (this.rotateSource?.hereIds?.() ?? []) : []).join(',')}:${this.bundle !== null}`);
    } else if (view === 'visions') {
      index = visions.findIndex((v) => v.id === this.visionId);
      if (index < 0) {
        index = 0;
        this.visionId = visions[0].id;
        this.visionOpen = false;
      }
      const vision = visions[index];
      if (this.confirmRemove !== vision.id) this.confirmRemove = null;
      total = visions.length;
      title = vision.title;
      itemKey = ['visions', visions.map((v) => v.id).join(','), vision.id, vision.title, vision.points.join('/'), this.visionOpen, this.confirmRemove, this.visionView?.bytes ?? 0];
    } else {
      index = letters.findIndex((l) => l.id === this.currentId);
      if (index < 0) {
        index = 0;
        this.currentId = letters[0].id;
        this.showBody = false;
        this.showChat = false;
      }
      const letter = letters[index];
      total = letters.length;
      title = letter.title;
      itemKey = [letters.map((l) => l.id).join(','), letter.id, letter.title, (letter.points ?? []).join('/'), letter.body, letter.chat ? 'chat' : '', this.showBody, this.showChat];
    }
    const tabsKey = views.length > 1 ? `tabs:${views.join(',')}:${letters.length}:${visions.length}:${slots.length}` : '';
    const settingsKey = this.settingsOpen ? `settings:${JSON.stringify(this.rotatePrefs)}:${JSON.stringify(this.commentPrefs)}:${JSON.stringify(this.consent)}:${this.budgetHold}:${this.holdNote}:${failureNote(this.records)}:${commentsToday(this.records)}` : '';
    // めぐる表示の月は、今日の残りで欠ける（K1）。ほかの見方は今までどおり満月の形
    const now = Date.now();
    const lit = view === 'rotate' || views.length === 0 ? this.moonFraction(now) : 1;
    const next = this.nextReminder(now); // 「次は 14:30 …」の帯（K3）
    const nextKey = next ? `next:${next.id}:${next.dueAt}:${next.text}:${dayLabel(next.dueAt, now)}:${next.dueAt - now <= 5 * 60_000}` : '';
    // 中身が変わったときだけ描き直す（押したボタンやキーボードの位置が消えないように）
    const key = [...itemKey, tabsKey, settingsKey, this.paused, this.collapsed, this.reduceMotion.matches, lit.toFixed(2), nextKey].join('|');
    if (key === this.renderedKey) return;
    this.renderedKey = key;
    const focusedKey = document.activeElement instanceof HTMLElement && this.element.contains(document.activeElement) ? document.activeElement.dataset.key : undefined;
    const isVision = view === 'visions' && views.length > 0;
    const isRotate = view === 'rotate' || views.length === 0;
    const noun = isRotate ? { prev: '前のもの', next: '次のもの', sr: `${total}件のうち${index + 1}件目` } : isVision
      ? { prev: '前の Vision', next: '次の Vision', sr: `${total}件のうち${index + 1}件目` }
      : { prev: '前のレター', next: '次のレター', sr: `${total}通のうち${index + 1}通目` };

    const head = el('div', 'moon-head');
    const icon = el('span', 'moon-icon');
    icon.innerHTML = moonSvg(lit, 14); // 形だけの SVG（数から作る。文字は入らない）
    if (lit < 1) icon.title = '今日の復習の残りで月が欠けます（全部済むと満月）';
    const label = el('span', 'moon-label', isRotate ? '⟳ めぐる表示' : isVision ? 'Grok Visions' : '月の窓');
    head.append(icon, label);
    if (total > 0) {
      const count = el('span', 'moon-count', `${index + 1}/${total}`);
      count.setAttribute('aria-hidden', 'true');
      head.append(count, el('span', 'sr-only', noun.sr));
    }
    const controls = el('div', 'moon-controls');
    if (total > 1) {
      const prev = button('‹', noun.prev, 'prev', () => this.move(-1), true);
      const next = button('›', noun.next, 'next', () => this.move(1), true);
      controls.append(prev, next);
      const pause = button(this.paused ? '▶' : '⏸', '入れ替えを止める', 'pause', () => {
        this.paused = !this.paused;
        this.savePrefs();
        this.update();
      }, true);
      pause.title = this.paused ? '入れ替えを止めています（押すと再開）' : '入れ替えを止める';
      pause.setAttribute('aria-pressed', String(this.paused)); // 名前は変えず、止めているかを押してあるかで伝える
      controls.append(pause);
    }
    if (this.rotateSource) {
      const gear = button('⚙', 'めぐる表示の設定', 'settings', () => (this.settingsOpen ? this.closeSettings() : this.openSettings()), true);
      gear.setAttribute('aria-expanded', String(this.settingsOpen));
      controls.append(gear);
    }
    const fold = button(this.collapsed ? '▸' : '▾', this.collapsed ? '月の窓を開く' : '月の窓をたたむ', 'fold', () => {
      this.collapsed = !this.collapsed;
      this.savePrefs();
      this.update();
    }, true);
    fold.setAttribute('aria-expanded', String(!this.collapsed));
    controls.append(fold);
    head.append(controls);

    const parts: HTMLElement[] = [head];
    if (next) parts.push(this.nextBandNode(next, now));
    if (views.length > 1 && !this.collapsed) parts.push(this.tabs(view, views, { letters: letters.length, visions: visions.length, rotate: slots.length }));
    if (this.collapsed) {
      // たたんでいる：題名だけ
      parts.push(el('div', 'moon-title moon-title-only', title));
    } else if (this.settingsOpen) {
      parts.push(this.settingsBox());
    } else if (isRotate) {
      const here = this.hereNode();
      if (here) parts.push(here);
      if (this.noMarkedCards() && this.bundle === null) parts.push(this.markedNotice());
      const stack = el('div', 'moon-stack');
      const body = rotateSlot?.kind === 'vocab' ? this.rotateVocab(rotateSlot.id) : rotateSlot?.kind === 'reminder' ? this.rotateReminder(rotateSlot.id) : this.rotateEmpty();
      stack.append(body);
      parts.push(stack);
    } else {
      // 入れ替わっても高さが変わらない（下のパネルが動かない）ように、印を付けたレターを同じ場所に重ねて、
      // いま映すもの以外は見えなくする（区画は、いちばん高いレターの高さになる）。Vision も同じ
      const stack = el('div', 'moon-stack');
      const hide = (ghost: HTMLElement) => {
        ghost.classList.add('moon-ghost');
        ghost.setAttribute('aria-hidden', 'true');
        ghost.inert = true;
        return ghost;
      };
      if (isVision) {
        for (const other of visions) stack.append(other.id === this.visionId ? this.visionCard(other) : hide(this.visionCard(other, true)));
      } else {
        for (const other of letters) stack.append(other.id === this.currentId ? this.card(other) : hide(this.card(other, true)));
      }
      parts.push(stack);
    }
    this.fade = false;
    this.element.replaceChildren(...parts);
    if (focusedKey) this.element.querySelector<HTMLElement>(`[data-key="${focusedKey}"]`)?.focus({ preventScroll: true });
  }

  // 映すものの切り替えの札（2つ以上あるときだけ。← → でも移れる）
  private tabs(view: MoonView, views: MoonView[], counts: Record<MoonView, number>): HTMLElement {
    const row = el('div', 'moon-tabs');
    row.setAttribute('role', 'tablist');
    row.setAttribute('aria-label', '月の窓に映すもの');
    const names: Record<MoonView, { text: string; hint: string }> = {
      letters: { text: `✉ レター ${counts.letters}`, hint: '「公開してよい」の印を付けたフェイブルレター' },
      visions: { text: `⬡ Grok Visions ${counts.visions}`, hint: 'Grok Bot が自分で「有意義」と判断して残した Vision' },
      rotate: { text: `⟳ めぐる ${counts.rotate}`, hint: `${this.kindHint()}を ${everyLabel(this.rotatePrefs.everyMs)}ごとに1つずつ映す` },
    };
    for (const v of views) {
      const b = button(names[v].text, names[v].hint, `tab-${v}`, () => this.setView(v));
      b.classList.add('moon-tab');
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(view === v));
      b.tabIndex = view === v ? 0 : -1;
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const at = views.indexOf(v);
        const other = views[(at + (e.key === 'ArrowRight' ? 1 : -1) + views.length) % views.length];
        this.setView(other);
        this.element.querySelector<HTMLElement>(`[data-key="tab-${other}"]`)?.focus();
      });
      row.append(b);
    }
    return row;
  }

  private kindHint() {
    const names = [this.rotatePrefs.kinds.includes('vocab') ? '単語帳' : '', this.rotatePrefs.kinds.includes('reminder') ? 'リマインダー' : ''].filter(Boolean);
    return names.length > 0 ? names.join('と') : '選んだもの';
  }

  // めぐる表示のカード1枚。表だけを出し、「答えを見る」で裏。高さは、答えを閉じている間はいつも同じ（CSS）
  private rotateVocab(id: string): HTMLElement {
    const card = this.cardOf(id);
    if (!card) return this.rotateEmpty();
    const box = el('article', this.fade ? 'moon-letter moon-rotate moon-fade' : 'moon-letter moon-rotate');
    const tag = rotateTag(card);
    const meta = [card.kind === 'quiz' ? '単語帳・問い' : '単語帳・言葉', tag === 'due' ? '今日の復習' : tag === 'weak' ? '苦手' : '', `習得、発展の度合い ${card.level}/6`].filter(Boolean).join('・');
    box.append(el('div', 'moon-meta', meta), el('div', 'moon-title moon-rotate-front', `${card.kind === 'quiz' ? 'Q. ' : ''}${card.front}`));
    const picture = this.imageNode(card);
    if (picture) box.append(picture);
    const spots = spotsFor(this.commentPrefs.place, 'vocab');
    if (spots.includes('before')) {
      const before = this.commentNodes({ kind: 'vocab', id: card.id }, 'before');
      if (before) box.append(before);
    }
    if (this.answerOpen) {
      box.append(el('div', 'moon-body moon-rotate-back', card.back));
      if (spots.includes('after')) {
        const after = this.commentNodes({ kind: 'vocab', id: card.id }, 'after');
        if (after) box.append(after);
      }
      // 答えのあとの評価（K1。計画書 §5 の 3）：時期の来た 1 枚だけ「できた」。苦手・ほかは「もう一度」だけ（時期前の「できた」で間があかないように）
      if (this.rotateSource?.grade) {
        const grades = el('div', 'moon-actions moon-rotate-grades');
        if (tag === 'due') grades.append(button('できた', '「できた」を付けて次へ（今日はもう出しません）', 'grade-good', () => this.gradeRotate(card.id, 'good')));
        grades.append(button('もう一度', '「もう一度」を付けて次へ（今日はもう出しません）', 'grade-again', () => this.gradeRotate(card.id, 'again')));
        box.append(grades);
      }
    }
    const row = el('div', 'moon-actions');
    const answer = button(this.answerOpen ? '答えをたたむ ▴' : '答えを見る ▾', '', 'answer', () => {
      this.answerOpen = !this.answerOpen;
      this.update();
      if (this.answerOpen) this.revealInStack('.moon-rotate-grades');
    });
    answer.setAttribute('aria-expanded', String(this.answerOpen));
    const more = button('…', 'ほかの操作（今日はもう出さない・印を外す）', 'rotate-more', () => {
      this.moreOpen = !this.moreOpen;
      this.update();
      if (this.moreOpen) this.revealInStack('.moon-rotate-more');
    });
    more.setAttribute('aria-expanded', String(this.moreOpen));
    row.append(
      answer,
      button('単語帳で開く', '右の「単語帳」パネルで、このカードを開く', 'open-vocab', () => this.rotateSource?.openVocab(card.id)),
      button('🔔 あとで', '1 時間後にもう一度映す（それまでは出しません）', 'rotate-later', () => this.laterRotate(card.id)),
      more,
    );
    // リンクの先頭のセルへ（K6。計画書 §2 の「セルへ：題名」）
    const cell = this.rotateSource?.cellLink?.(card);
    if (cell) {
      const name = [...cell.title].length > 12 ? `${[...cell.title].slice(0, 12).join('')}…` : cell.title;
      row.append(button(`セルへ：${name}`, `「${cell.title}」へ`, 'vocab-cell', () => cell.open()));
    }
    box.append(row);
    if (this.moreOpen) {
      const extra = el('div', 'moon-actions moon-rotate-more');
      extra.append(button('今日はもう出さない', 'このカードを今日はもう映しません（明日にはまた出ます）', 'rotate-skip', () => this.skipRotate(card.id)));
      if (this.rotatePrefs.grain === 'marked' && card.rotate === true && this.rotateSource?.setMark) {
        extra.append(button('⟳ の印を外す', 'めぐる表示の印を外します（単語帳の行の ⟳ と同じ）', 'rotate-unmark', () => this.unmarkRotate(card.id)));
      }
      box.append(extra);
    }
    return box;
  }

  // 月の窓は低いと中の欄（moon-stack）が巻物になるので、開いた行が見えるところまで巻く（K1）
  private revealInStack(selector: string) {
    this.element.querySelector<HTMLElement>(selector)?.scrollIntoView({ block: 'nearest' });
  }

  // 印だけを映す設定で、印のカードが 1 枚も無いときの札（K1。リマインダーは回る）
  private markedNotice(): HTMLElement {
    const box = el('div', 'moon-rotate-note');
    box.append(
      el('span', 'moon-meta', '⟳ の印を付けたカードがありません'),
      button('全部を映す', '⚙ の「映すもの」を「全部」に戻します', 'rotate-grain-all', () => this.setRotate({ ...this.rotatePrefs, grain: 'all' })),
    );
    return box;
  }

  // リマインダー1件。文と「あと n 分」。タブの題名は出さない（計画の渡し止めと同じく、ここでも見せない）
  private rotateReminder(id: string): HTMLElement {
    const reminder = this.reminderOf(id);
    if (!reminder) return this.rotateEmpty();
    const box = el('article', this.fade ? 'moon-letter moon-rotate moon-fade' : 'moon-letter moon-rotate');
    box.append(el('div', 'moon-meta', `リマインダー・${remainingLabel(reminder.dueAt)}`), el('div', 'moon-title moon-rotate-front', reminder.text));
    const comment = this.commentNodes({ kind: 'reminder', id: reminder.id }, 'after');
    if (comment) box.append(comment);
    const row = el('div', 'moon-actions');
    row.append(button('リマインダーを見る', '右の「リマインダー」パネルへ移る', 'open-reminder', () => this.rotateSource?.openReminder()));
    // 1 枚の操作（K3。計画書 §2）：そのセルへ・10 分延ばす・済み。もう鳴ったもの（次に替わるまで残している）は、鳴ったものとして扱う
    const src = this.rotateSource;
    const fired = this.reminderExpired(reminder.id, Date.now());
    if (src?.openReminderLink && reminderLink(reminder)) {
      row.append(button('そのセルへ', reminder.title ? `「${reminder.title}」へ` : '指しているセルへ', 'reminder-link', () => src.openReminderLink?.(reminder)));
    }
    if (src?.delayReminder) {
      row.append(button('10 分延ばす', fired ? '10 分後にもう一度知らせます' : '知らせる時刻を 10 分あとにします', 'reminder-delay', () => src.delayReminder?.(reminder, 10 * 60_000, fired)));
    }
    if (src?.doneReminder) {
      row.append(
        button('済み', fired ? '鳴ったものを済みにします' : '鳴る前に済ませます（繰り返しは次の回へ）', 'reminder-done', () => {
          src.doneReminder?.(reminder.id, fired);
          this.move(1);
        }),
      );
    }
    box.append(row);
    return box;
  }

  // 次のリマインダー（K3。帯に出す）
  private nextReminder(now: number): Reminder | undefined {
    return this.rotatePrefs.nextBand ? upcomingReminders(this.rotateSource?.reminders() ?? [], now)[0] : undefined;
  }

  // 「次は 14:30 …」の帯（K3。⚙ で入れたときだけ。5 分前から金に満ちる）。押すと右の「リマインダー」パネルへ
  private nextBandNode(next: Reminder, now: number): HTMLElement {
    const day = dayLabel(next.dueAt, now);
    const band = el('button', `moon-next-band${next.dueAt - now <= 5 * 60_000 ? ' soon' : ''}`);
    band.type = 'button';
    band.dataset.key = 'next-band';
    band.title = `${remainingLabel(next.dueAt, now)}。押すと右の「リマインダー」パネルへ`;
    band.append(el('span', 'moon-next-when', `次は ${day === '今日' ? '' : `${day} `}${clockOf(next.dueAt)}`), el('span', 'moon-next-text', next.text));
    band.addEventListener('click', () => this.rotateSource?.openReminder());
    return band;
  }

  private rotateEmpty(): HTMLElement {
    const kinds = this.rotatePrefs.kinds;
    const hasCards = (this.rotateSource?.vocab().length ?? 0) > 0;
    const hint =
      kinds.length === 0
        ? '⚙ の「映すもの」に印を付けてください'
        : kinds.includes('vocab') && hasCards && this.rotatePrefs.grain === 'marked'
          ? '⟳ の印を付けたカードがありません（今日はもう出さない・あとでのカードは除いています）。右の「単語帳」の行の ⟳ で付けられます'
          : kinds.includes('vocab') && hasCards
            ? '今日はもう映すカードがありません（今日はもう出さない・あとで・⚙ の「映すもの」で除いています）'
            : kinds.includes('reminder') && !kinds.includes('vocab')
          ? 'まだ時間になっていないリマインダーがありません。相棒に「30分後に休憩をリマインドして」のように頼めます'
          : kinds.includes('vocab') && !kinds.includes('reminder')
            ? '単語帳にカードがありません。右の「単語帳」パネルの「＋カード」で足せます'
            : '単語帳にカードを足すか、相棒にリマインダーを頼めます';
    const box = el('div', 'moon-rotate-empty');
    box.append(el('div', 'moon-title', '映すものがありません'), el('div', 'moon-body', hint));
    return box;
  }

  // ⚙：めぐる表示を使う・映すもの・入れ替える間（変えたらすぐ効く）
  private settingsBox(): HTMLElement {
    const box = el('div', 'moon-settings');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'めぐる表示の設定');
    const p = this.rotatePrefs;
    const check = (key: string, text: string, checked: boolean, change: (on: boolean) => void) => {
      const label = el('label', 'moon-check');
      const input = el('input');
      input.type = 'checkbox';
      input.checked = checked;
      input.dataset.key = key;
      input.addEventListener('change', () => change(input.checked));
      label.append(input, document.createTextNode(text));
      return label;
    };
    box.append(
      check('rotate-on', 'めぐる表示を使う', p.on, (on) => this.setRotate({ ...p, on })),
      el('div', 'moon-meta', '選んだものを、決めた間で1つずつ映します。レターと Grok Visions の入れ替え（8秒）は変わりません。ひとことは、下で別に入れます'),
    );
    // 単語帳から映すもの（K1）：全部・⟳ の印だけ・今日の復習と苦手だけ（今の値は p.grain）
    const grainSelect = el('select', 'moon-select');
    grainSelect.dataset.key = 'rotate-grain';
    grainSelect.title = '⟳ の印は、右の「単語帳」の行の ⟳ や、左の「単語帳に入れる」の小窓で付けます';
    const grainOptions: [RotateGrain, string][] = [
      ['all', '全部'],
      ['marked', '⟳ の印だけ'],
      ['due', '今日の復習と苦手だけ'],
    ];
    for (const [value, text] of grainOptions) {
      const o = el('option', '', text);
      o.value = value;
      grainSelect.append(o);
    }
    grainSelect.value = p.grain;
    grainSelect.addEventListener('change', () => this.setRotate({ ...p, grain: grainSelect.value as RotateGrain }));
    const grainRow = el('label', 'moon-check');
    grainRow.append(document.createTextNode('単語帳から　'), grainSelect);
    const kinds = el('fieldset', 'moon-fieldset');
    kinds.append(
      el('legend', 'moon-legend', '映すもの'),
      check('rotate-vocab', '単語帳（表だけを出し、「答えを見る」で裏）', p.kinds.includes('vocab'), (on) => this.setKind('vocab', on)),
      grainRow,
      check('rotate-reminder', 'リマインダー（文と「あと n 分」。時間になったものは、次に替わるときに外れます）', p.kinds.includes('reminder'), (on) =>
        this.setKind('reminder', on),
      ),
      // 新しく入れたカードに ⟳ を付けるか（左の「単語帳に入れる」の小窓の既定。K1）
      check('rotate-mark-new', '新しく入れたカードに ⟳ を付ける（左の「単語帳に入れる」の小窓の既定）', p.markNew, (on) => this.setRotate({ ...p, markNew: on })),
      check('rotate-next-band', '次のリマインダーを帯で出す（「次は 14:30 …」。5 分前から金に）', p.nextBand, (on) => this.setRotate({ ...p, nextBand: on })),
    );
    const every = el('select', 'moon-select');
    every.dataset.key = 'rotate-every';
    for (const e of ROTATE_EVERY) {
      const o = el('option', '', e.label);
      o.value = String(e.ms);
      every.append(o);
    }
    every.value = String(p.everyMs);
    every.addEventListener('change', () => this.setRotate({ ...p, everyMs: Number(every.value) }));
    const everyRow = el('label', 'moon-check');
    everyRow.append(document.createTextNode('入れ替える間 '), every);
    const row = el('div', 'moon-actions');
    row.append(button('閉じる', '設定を閉じる（Esc）', 'settings-close', () => this.closeSettings()));
    box.append(kinds, everyRow, this.commentSettings(check), row);
    return box;
  }

  // AI のひとこと。印を付けただけでは動かない。「入れる」まで待つ。練習モードは練習の文、それ以外は選んだ組を1回呼ぶ
  private commentSettings(check: (key: string, text: string, checked: boolean, change: (on: boolean) => void) => HTMLElement): HTMLElement {
    const prefs = this.commentPrefs;
    const box = el('fieldset', 'moon-fieldset');
    box.append(el('legend', 'moon-legend', 'AI のひとこと'));
    box.append(check('comment-on', 'AI のひとこと（はじめは切ってあります）', prefs.on, (on) => this.setComment({ ...prefs, on })));
    if (!prefs.on) {
      box.append(el('div', 'moon-meta', '入れると、映しているものに短いひとことを付けます。めぐる表示とは別に、ここで入れます'));
      return box;
    }
    const kinds = el('div', 'moon-comment-kinds');
    kinds.append(
      check('comment-vocab', '単語帳に付ける', prefs.kinds.includes('vocab'), (on) => this.setCommentKind('vocab', on)),
      check('comment-reminder', 'リマインダーに付ける', prefs.kinds.includes('reminder'), (on) => this.setCommentKind('reminder', on)),
    );
    const team = el('select', 'moon-select');
    team.dataset.key = 'comment-team';
    for (const value of ['haiku', 'sonnet'] as const) {
      const label = teamChoiceLabel(value);
      const option = el('option', '', label);
      option.value = value;
      team.append(option);
    }
    team.value = prefs.team;
    team.addEventListener('change', () => this.setComment({ ...this.commentPrefs, team: team.value === 'sonnet' ? 'sonnet' : 'haiku' }));
    const teamRow = el('label', 'moon-check');
    teamRow.append(document.createTextNode('組 '), team);
    const place = el('select', 'moon-select');
    place.dataset.key = 'comment-place';
    for (const [value, label] of [
      ['after', '答えの後（今の場所）'],
      ['before', '答えの前'],
      ['both', '両方'],
    ] as const) {
      const option = el('option', '', label);
      option.value = value;
      place.append(option);
    }
    place.value = prefs.place;
    place.addEventListener('change', () => {
      const next = place.value === 'before' || place.value === 'both' ? place.value : 'after';
      this.setComment({ ...this.commentPrefs, place: next });
    });
    const placeRow = el('label', 'moon-check');
    placeRow.append(document.createTextNode('単語帳に付ける場所 '), place);
    const every = el('input', 'moon-number');
    every.type = 'number';
    every.min = '5';
    every.max = '60';
    every.step = '1';
    every.dataset.key = 'comment-every';
    every.value = String(prefs.everyMs / 60_000);
    every.addEventListener('change', () => this.setComment({ ...this.commentPrefs, everyMs: clampMinutes(Number(every.value)) * 60_000 }));
    const everyRow = el('label', 'moon-check');
    everyRow.append(document.createTextNode('ひとことの間 '), every, document.createTextNode(' 分（5〜60）'));
    const cap = el('input', 'moon-number');
    cap.type = 'number';
    cap.min = '1';
    cap.max = '50';
    cap.step = '1';
    cap.dataset.key = 'comment-cap';
    cap.value = String(prefs.dailyCap);
    cap.addEventListener('change', () => this.setComment({ ...this.commentPrefs, dailyCap: clampCap(Number(cap.value)) }));
    const capRow = el('label', 'moon-check');
    capRow.append(document.createTextNode('1日の上限 '), cap, document.createTextNode(' 回（1〜50。0時に戻ります）'));
    const status = el('div', 'moon-meta');
    status.dataset.key = 'comment-status';
    status.textContent = this.commentStatusText();
    box.append(kinds, teamRow, placeRow, el('div', 'moon-meta', '答えの前は、答えを言わずにみんなで考えます。両方は1枚で2回呼びます。リマインダーには場所はありません'), everyRow, capRow, status);
    if (!consentCovers(this.consent, prefs)) {
      const confirm = this.commentConfirm();
      box.append(confirm);
      window.requestAnimationFrame(() => confirm.scrollIntoView({ block: 'nearest' }));
    }
    return box;
  }

  private commentConfirm(): HTMLElement {
    const prefs = this.commentPrefs;
    const box = el('div', 'moon-confirm');
    box.append(el('div', 'moon-title', '入れる前の確認'));
    const send = el('div', 'moon-body');
    const lines = ['渡すもの'];
    if (prefs.kinds.includes('vocab') && prefs.place === 'before') {
      lines.push('・単語帳：表と、言葉か問い、だけ（裏は渡しません）');
      lines.push('・答えの前のひとことは、答え・訳・言い換え・綴りを書きません。使う場面や最初の音で、みんなで考えます');
    } else if (prefs.kinds.includes('vocab') && prefs.place === 'both') {
      lines.push('・単語帳の答えの前：表と、言葉か問い、だけ（裏は渡しません）');
      lines.push('・単語帳の答えのあと：表と裏、言葉か問い、だけ');
      lines.push('・1枚で2回呼びます。料金・1日の回数・ひとことの間も2回ぶんです');
    } else if (prefs.kinds.includes('vocab')) {
      lines.push('・単語帳：表と裏、言葉か問い、だけ（答えを見たあとに出します）');
    }
    if (prefs.kinds.includes('reminder')) lines.push('・リマインダー：文と、あと何分か、だけ');
    if (prefs.kinds.length === 0) lines.push('・まだ種類が選ばれていません');
    lines.push(
      '渡さないもの',
      '・ページのアドレス、題名、ページの中の文',
      '・リマインダーに付いたタブの題名',
      priceText(prefs.team, prefs.dailyCap, prefs.place, prefs.kinds.includes('vocab')),
      '表示は目安です。実際の請求とは一致しません。',
      '練習モードのときは練習の文だけです。切っているときは、選んだ組が本物を1回だけ呼びます。',
    );
    send.textContent = lines.join('\n');
    const row = el('div', 'moon-actions');
    const accept = button('入れる', 'この内容で、ひとことを入れます', 'comment-accept', () => this.acceptComment());
    accept.disabled = prefs.kinds.length === 0;
    row.append(accept, button('やめる', '入れるのをやめます', 'comment-cancel', () => this.cancelComment()));
    box.append(send, row);
    return box;
  }

  // Vision 1件（ghost：高さをそろえるためだけの、見えないもの。いつも閉じた形）。外から来た文は文字としてだけ出す
  private visionCard(vision: Vision, ghost = false): HTMLElement {
    const open = !ghost && this.visionOpen;
    const card = el('article', !ghost && this.fade ? 'moon-letter moon-vision moon-fade' : 'moon-letter moon-vision');
    const by = `${vision.botName}${vision.role ? `（${vision.role}）` : ''}`;
    card.append(el('div', 'moon-title', vision.title), el('div', 'moon-meta', `⬡ ${by}の Vision・${dateOf(vision.createdAt)}`));
    if (open) {
      // 2段目：要点の全部と出典
      const list = el('ul', 'moon-points');
      for (const point of vision.points) list.append(el('li', '', point));
      card.append(list);
      if (vision.links?.length && this.actions.openUrl) {
        const links = el('div', 'moon-links');
        links.append(el('span', 'moon-links-label', '出典'));
        vision.links.forEach((link, i) => {
          links.append(button(hostOf(link.url), link.title ? `${link.title}（${link.url}）` : link.url, `link-${i}`, () => this.actions.openUrl?.(link.url)));
        });
        card.append(links);
      }
    } else {
      // 1段目：題名と要点（3行まで見せる）
      card.append(el('div', 'moon-body moon-clamp', vision.points.map((p) => `・${p}`).join('\n')));
    }
    const row = el('div', 'moon-actions');
    if (this.actions.openReply) {
      row.append(button('もとの返事へ', 'この Vision が書かれた返事のカードを、右の「ボットの欄」で見せる（出せないときは要点を開く）', 'reply', () => this.actions.openReply?.(vision)));
    }
    const toggle = button(open ? '要点をたたむ ▴' : '要点を開く ▾', '', 'points', () => {
      this.visionOpen = !this.visionOpen;
      this.update();
    });
    toggle.setAttribute('aria-expanded', String(open));
    row.append(toggle);
    if (this.actions.removeVision) {
      if (!ghost && this.confirmRemove === vision.id) {
        const yes = button('もう一度押すと消えます', `「${vision.title}」を消す（ui-data\\visions から消します。元に戻せません）`, 'remove', () => {
          this.confirmRemove = null;
          this.actions.removeVision?.(vision.id);
        });
        yes.classList.add('moon-danger');
        armConfirm(yes, () => this.cancelRemove()); // 外を押す（「やめる」も含む）・Esc で、やめる
        row.append(yes, button('やめる', '消さない（Esc）', 'remove-cancel', () => this.cancelRemove()));
      } else {
        row.append(button('消す…', 'この Vision を消す（もう一度押して確かめます）', 'remove', () => {
          this.confirmRemove = vision.id;
          this.update();
        }));
      }
    }
    const bytes = this.visionView?.bytes ?? 0;
    const usage = el('span', 'moon-usage', `約 ${formatBytes(bytes)}`);
    usage.title = `残した Grok Visions ${this.visionView?.list().length ?? 0} 件・約 ${formatBytes(bytes)}（ui-data\\visions）。件数の上限はありません`;
    row.append(usage);
    card.append(row);
    if (ghost) for (const b of card.querySelectorAll<HTMLElement>('[data-key]')) delete b.dataset.key; // 元に戻す focus の先にしない
    return card;
  }

  private cancelRemove() {
    if (!this.confirmRemove) return;
    this.confirmRemove = null;
    this.update();
  }

  // レター1通（ghost：高さをそろえるためだけの、見えないもの。いつも閉じた形）
  private card(letter: Letter, ghost = false): HTMLElement {
    const showBody = !ghost && this.showBody;
    const showChat = !ghost && this.showChat;
    const card = el('article', !ghost && this.fade ? 'moon-letter moon-fade' : 'moon-letter');
    card.append(el('div', 'moon-title', letter.title), el('div', 'moon-meta', `${letter.by.name}からのレター・${dateOf(letter.createdAt)}`));
    // 1段目：3行の要点（前の形のレターは、手紙の始めの3行）
    if (letter.points?.length) {
      const list = el('ul', 'moon-points');
      for (const point of letter.points) list.append(el('li', '', point));
      card.append(list);
    } else if (!showBody) {
      card.append(el('div', 'moon-body moon-clamp', letter.body));
    }
    // 2段目：手紙
    if (showBody) card.append(el('div', 'moon-body', letter.body));
    // 3段目：元の会話
    if (showChat && letter.chat) {
      const chat = el('div', 'moon-chat');
      if (letter.chat.question) chat.append(el('div', 'moon-chat-q', `使う人：${letter.chat.question}`));
      chat.append(el('div', 'moon-chat-a', `${letter.by.name}：${letter.chat.reply}`));
      card.append(chat);
    }
    const row = el('div', 'moon-actions');
    const body = button(showBody ? '手紙をたたむ ▴' : '手紙を読む ▾', '', 'body', () => {
      this.showBody = !this.showBody;
      if (!this.showBody) this.showChat = false;
      this.update();
    });
    body.setAttribute('aria-expanded', String(showBody));
    row.append(body);
    if (showBody && letter.chat) {
      const chat = button(showChat ? '会話をたたむ ▴' : '元の会話を見る ▾', '', 'chat', () => {
        this.showChat = !this.showChat;
        this.update();
      });
      chat.setAttribute('aria-expanded', String(showChat));
      row.append(chat);
    } else if (showBody && letter.conversationId) {
      const id = letter.conversationId;
      row.append(button('元の会話を開く', 'このレターが生まれた会話を、相棒の画面で開く', 'conversation', () => this.actions.openConversation(id)));
    }
    row.append(button('一覧で見る', '相棒の「履歴」→「✉ フェイブルレター」で、このレターを見る', 'list', () => this.actions.openLetter(letter.id)));
    card.append(row);
    if (ghost) for (const b of card.querySelectorAll<HTMLElement>('[data-key]')) delete b.dataset.key; // 元に戻す focus の先にしない
    return card;
  }

  // 上のタグから開く（右クリックの登録先）。たたむボタンは、これまでどおり見出しの ▾
  isCollapsed() {
    return this.collapsed;
  }

  expand() {
    if (!this.collapsed) return;
    this.collapsed = false;
    this.savePrefs();
    this.update();
  }
}

// icon：記号だけのボタン（‹ › ⏸ ▾）は、title を名前にする。文字のボタンは、見えている文字が名前
function button(text: string, title: string, key: string, run: () => void, icon = false): HTMLButtonElement {
  const b = el('button', icon ? 'moon-button moon-icon-button' : 'moon-button', text);
  b.type = 'button';
  b.dataset.key = key;
  if (title) b.title = title;
  if (icon && title) b.setAttribute('aria-label', title);
  b.addEventListener('click', run);
  return b;
}

// ドメイン（出典のボタン）
function hostOf(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

function clipNote(text: string): string {
  return [...text.replace(/\s+/g, ' ').trim()].slice(0, 80).join('');
}

// こちらで投げた文（「答えが混ざっていた」など）はそのまま出す。通信の失敗は、いつもの短いわけにする
function commentErrorNote(error: unknown): string {
  if (error instanceof Error && error.name === 'Error' && error.message) return error.message;
  return describeError(error);
}

function dateOf(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function loadPrefs(): { paused: boolean; collapsed: boolean; view: MoonView; rotate: RotatePrefs; comment: CommentPrefs; consent: CommentConsent | null } {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    const s = (typeof saved === 'object' && saved !== null ? saved : {}) as Record<string, unknown>;
    const view: MoonView = s.view === 'visions' || s.view === 'rotate' ? s.view : 'letters';
    return {
      paused: s.paused === true,
      collapsed: s.collapsed === true,
      view,
      rotate: cleanRotatePrefs(s.rotate),
      comment: cleanCommentPrefs(s.comment),
      consent: cleanConsent(s.commentConsent),
    };
  } catch {
    return { paused: false, collapsed: false, view: 'letters', rotate: { ...ROTATE_DEFAULT }, comment: { ...COMMENT_DEFAULT, kinds: [...COMMENT_DEFAULT.kinds] }, consent: null };
  }
}
