// リマインダーのパネル（右サイドバー）。自分で置く・延ばす・取り消す・元に戻す・指す先へ行く（K2b）
//   台帳は左だけが書く。ここは host に頼む（add・cancel）。AI は呼ばない。画面の文字は textContent で入れる
import { clockOf, dayLabel, MAX_AHEAD_MS, newReminderId, type PresetTime, parseWhen, presetTimes, REPEATS, repeatLabel, siteHost, snoozedCopy, triggeredReminder, triggerLabel } from '../reminder-when';
import { reminderBy, reminderLink, reminderRepeat, reminderTrigger } from '../reminders';
import { remainingLabel } from '../rotate';
import type { FiredReminder, FiredState, Reminder, ReminderTrigger } from '../types';
import { findVocabTab, type VocabLink } from '../vocab';
import { el } from '../util';

export interface ReminderPanelHost {
  add(reminder: Reminder): boolean; // 置く・置き直す（false：いっぱいで置かなかった。知らせは host が出す）
  cancel(id: string): void;
  activeTab(): { id: number; url: string; title: string } | null;
  tabs(): readonly { id: number; title: string; url: string }[];
  memos(): readonly { id: string; title: string }[] | null; // null：まだ届いていない
  openLink(link: VocabLink): void; // そのセルへ（タブが無ければ URL を開く。host が決める）
  openCard?(id: string): void; // カードから置いたリマインダーの「単語帳で開く」（K4）
  done(id: string, fired: boolean): void; // 済み（fired：鳴ったものなら記録を「済み」に。まだなら左が台帳から外す）
  toCard(text: string): void; // 単語カードにする（単語帳の「＋カード」を、その文で開く）
}

const TICK_MS = 30_000; // 「あと n 分」を描き直す間隔
const UNDO_MS = 5_000; // 取り消したあと「元に戻す」を出している時間
const STATUS_MS = 4_000; // 置いたあとの「M/D HH:MM に知らせます」を出している時間
const UNDO_TEXT_MAX = 20; // 元に戻す札に出す文の字数
const FIRED_SHOW = 10; // 鳴ったものの列で先に見せる件数（残りは「もっと見る」で全部）
const FIRED_STATE_LABEL: Record<FiredState, string> = { fired: '鳴った', done: '済み', snoozed: '延ばした', cancelled: '取り消した' };

function option(value: string, label: string): HTMLOptionElement {
  const o = el('option', '', label);
  o.value = value;
  return o;
}

export class ReminderPanel {
  readonly element = el('section', 'panel-section reminder-panel');
  private readonly list = el('div', 'reminder-list');
  private readonly toggle = el('button', 'reminder-add', '＋リマインダー');
  private readonly form = el('form', 'reminder-form');
  private readonly input = el('input');
  private readonly hint = el('div', 'reminder-when-hint');
  private readonly presets = el('div', 'reminder-presets');
  private readonly time = el('input');
  private readonly repeat = el('select', 'reminder-repeat'); // 繰り返し（K3。「繰り返しなし」は空の値）
  private readonly anchor = el('div', 'reminder-anchor');
  private readonly kindSelect = el('select', 'reminder-when-kind'); // いつ知らせるか（K4b。時刻で・次に（今のタブ）を開いたとき・次に起動したとき）
  private readonly linkCheck = el('input');
  private readonly error = el('div', 'reminder-form-error');
  private readonly status = el('div', 'reminder-status');
  private reminders: Reminder[] = []; // host から最後に受けた一覧
  private failed = false; // host から最後に受けた「台帳を読めなかった」
  private presetKey: PresetTime['key'] | null = null; // 置く欄で選んでいる押しボタン
  private snoozeFor: string | null = null; // 延ばす先を開いている行の id
  private undo: { reminder: Reminder; said: string } | null = null; // 取り消し・済みにしたばかりのもの（UNDO_MS の間だけ。said は札の言い方）
  private undoTimer = 0;
  private statusTimer = 0;
  private readonly firedBox = el('div', 'reminder-fired'); // 鳴ったものの列（K3。一覧の後ろ）
  private fired: FiredReminder[] = []; // host から最後に受けた鳴ったものの記録（新しい順）
  private firedFailed = false; // host から最後に受けた「記録を読めなかった」
  private firedOpen = false; // 鳴ったものの列を開いているか（保存しない。はじめは閉じている）
  private firedAll = false; // 「もっと見る」で全部を見せているか
  private firedSnoozeFor: string | null = null; // 延ばす先を開いている鳴ったものの id

  constructor(private readonly host: ReminderPanelHost) {
    this.input.type = 'text';
    this.input.maxLength = 300;
    this.input.placeholder = '例：30分後に休憩／明日9時 会議';
    this.input.autocomplete = 'off';
    this.input.setAttribute('aria-label', '知らせる文（頭に時刻を書いてもよい）');
    this.time.type = 'datetime-local';
    this.time.setAttribute('aria-label', '知らせる時刻');
    this.linkCheck.type = 'checkbox';
    this.error.setAttribute('role', 'alert');
    this.form.setAttribute('aria-label', '置くリマインダー');
    this.form.hidden = true;
    this.toggle.type = 'button';
    this.toggle.setAttribute('aria-expanded', 'false');
    this.anchor.hidden = true;
    this.kindSelect.setAttribute('aria-label', 'いつ知らせるか');
    this.kindSelect.replaceChildren(option('time', '時刻で'), option('startup', '次に起動したとき')); // 開くたびに、サイトの選びを作り直す（buildKinds）

    const cancel = el('button', 'reminder-cancel', 'やめる');
    cancel.type = 'button';
    const submit = el('button', 'reminder-submit', '置く');
    submit.type = 'submit';
    const buttons = el('div', 'reminder-form-buttons');
    buttons.append(cancel, submit);
    this.repeat.setAttribute('aria-label', '繰り返し');
    const noRepeat = el('option', '', '繰り返しなし');
    noRepeat.value = '';
    this.repeat.append(noRepeat, ...REPEATS.map(([key, name]) => {
      const option = el('option', '', name);
      option.value = key;
      return option;
    }));
    this.form.append(this.input, this.kindSelect, this.hint, this.presets, this.time, this.repeat, this.anchor, this.error, buttons);

    this.toggle.addEventListener('click', () => {
      if (this.form.hidden) this.openForm();
      else this.closeForm();
    });
    cancel.addEventListener('click', () => this.closeForm());
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.place();
    });
    this.form.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      this.closeForm();
      this.toggle.focus();
    });
    this.input.addEventListener('input', () => {
      this.updateHint();
      this.clearError();
    });
    this.time.addEventListener('input', () => {
      this.presetKey = null; // 時刻の欄を打ったら、押しボタンの選びを外す
      this.syncPresets();
      this.clearError();
    });
    this.kindSelect.addEventListener('change', () => {
      this.syncKind();
      this.updateHint();
      this.clearError();
    });

    const toolbar = el('div', 'reminder-toolbar');
    toolbar.append(this.toggle);
    this.element.append(el('div', 'panel-subtitle', 'リマインダー'), toolbar, this.form, this.status, this.list, this.firedBox);
    this.render([]);
    this.renderFired([]);
    window.setInterval(() => this.renderList(), TICK_MS); // 「あと n 分」を進める（一覧だけ。置く欄は作り直さない）
  }

  // host から受けた一覧で、一覧だけを描き直す
  render(reminders: Reminder[], failed = false) {
    this.reminders = [...reminders];
    this.failed = failed;
    if (this.snoozeFor !== null && !this.reminders.some((r) => r.id === this.snoozeFor)) this.snoozeFor = null;
    this.renderList();
  }

  // ---------- 置く欄 ----------

  private openForm() {
    const now = Date.now();
    this.presetKey = null;
    this.form.hidden = false;
    this.toggle.setAttribute('aria-expanded', 'true');
    this.presets.replaceChildren(...this.presetButtons(now));
    this.buildAnchor();
    this.buildKinds();
    this.syncKind();
    this.updateHint();
    this.input.focus();
  }

  // 閉じるときは書きかけも消す（次に開いたときは空から）
  private closeForm() {
    this.form.hidden = true;
    this.toggle.setAttribute('aria-expanded', 'false');
    this.input.value = '';
    this.time.value = '';
    this.repeat.value = ''; // 閉じたら「繰り返しなし」に戻す
    this.linkCheck.checked = false;
    this.presetKey = null;
    this.kindSelect.value = 'time'; // 閉じたら「時刻で」に戻す（K4b）
    this.syncKind();
    this.hint.textContent = '';
    this.clearError();
  }

  // いつ知らせるか：サイトの選びは、今のタブがサイトのときだけ出す（開くたびに作り直す）
  private buildKinds() {
    const tab = this.host.activeTab();
    const options = [option('time', '時刻で')];
    const host = tab ? siteHost(tab.url) : null;
    if (host !== null) options.push(option('site', triggerLabel({ kind: 'site', host }))); // 「次に example.com を開いたとき」
    options.push(option('startup', '次に起動したとき'));
    this.kindSelect.replaceChildren(...options);
    this.kindSelect.value = 'time';
  }

  // 時刻以外を選んだら、時刻の欄・押しボタン・繰り返しは押せなくする
  private syncKind() {
    const timed = this.kindSelect.value === 'time';
    for (const button of this.presets.querySelectorAll<HTMLButtonElement>('button.reminder-preset')) button.disabled = !timed;
    this.time.disabled = !timed;
    this.repeat.disabled = !timed;
  }

  // 引き金の選び（今のタブを引き直す）。時刻のときや、今のタブがサイトでないときは null
  private triggerOf(kind: string): ReminderTrigger | null {
    if (kind === 'startup') return { kind: 'startup' };
    if (kind !== 'site') return null;
    const tab = this.host.activeTab();
    const host = tab ? siteHost(tab.url) : null;
    return host === null ? null : { kind: 'site', host };
  }

  private presetButtons(now: number): HTMLButtonElement[] {
    return presetTimes(now).map((preset) => {
      const button = el('button', 'reminder-preset', preset.label);
      button.type = 'button';
      button.dataset.key = preset.key;
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => this.pickPreset(preset.key));
      return button;
    });
  }

  // 押しボタン：もう一度押すと外れる。選んだら時刻の欄は空にする（どちらか一つで決める）
  private pickPreset(key: PresetTime['key']) {
    this.presetKey = this.presetKey === key ? null : key;
    if (this.presetKey !== null) this.time.value = '';
    this.syncPresets();
    this.clearError();
  }

  private syncPresets() {
    for (const button of this.presets.querySelectorAll<HTMLButtonElement>('button.reminder-preset')) {
      button.setAttribute('aria-pressed', String(button.dataset.key === this.presetKey));
    }
  }

  // 「今のタブに結ぶ」の印。今のタブがあるときだけ出し、題名を添える（結ぶかどうかは開くたびに外して始める）
  private buildAnchor() {
    const tab = this.host.activeTab();
    this.linkCheck.checked = false;
    this.anchor.hidden = tab === null;
    if (tab === null) {
      this.anchor.replaceChildren();
      return;
    }
    const name = el('span', 'reminder-anchor-name', tab.title);
    name.title = tab.title;
    const label = el('label', 'reminder-anchor-label');
    label.append(this.linkCheck, el('span', '', '今のタブに結ぶ'), name);
    this.anchor.replaceChildren(label);
  }

  // 文の頭に時刻があれば、その時刻を見せる（打つたびに）
  private updateHint() {
    if (this.kindSelect.value !== 'time') {
      const trigger = this.triggerOf(this.kindSelect.value);
      this.hint.textContent = trigger ? `${triggerLabel(trigger)}に知らせます` : '今のタブはサイトではありません（http・https のページで置いてください）';
      return;
    }
    const now = Date.now();
    const parsed = parseWhen(this.input.value, now);
    this.hint.textContent = parsed
      ? `${dayLabel(parsed.dueAt, now)} ${clockOf(parsed.dueAt)} に知らせます（文の頭の時刻を使います）`
      : '時刻は下で選びます';
  }

  // 置く：時刻は「文の頭」→「押しボタン」→「時刻の欄」の順に決める。文は、読んだ時刻の後ろの残り（読めなければ打った文）
  private place() {
    if (this.kindSelect.value !== 'time') {
      this.placeTriggered();
      return;
    }
    const now = Date.now();
    const parsed = parseWhen(this.input.value, now);
    const text = parsed ? parsed.text : this.input.value.trim();
    if (text === '') {
      this.fail('知らせる文を書いてください');
      return;
    }
    let dueAt: number | null = parsed ? parsed.dueAt : null;
    if (dueAt === null && this.presetKey !== null) {
      const key = this.presetKey;
      dueAt = presetTimes(now).find((preset) => preset.key === key)?.dueAt ?? null;
    }
    if (dueAt === null && this.time.value !== '') {
      const at = new Date(this.time.value).getTime();
      dueAt = Number.isNaN(at) ? null : at;
    }
    if (dueAt === null || dueAt <= now || dueAt > now + MAX_AHEAD_MS) {
      this.fail('時刻を選んでください（今より後、400 日まで）');
      return;
    }

    const repeat = REPEATS.find(([key]) => key === this.repeat.value)?.[0]; // 選んでいれば繰り返す（K3）
    const reminder: Reminder = { id: newReminderId(now), text, dueAt, createdAt: now, by: 'user', ...(repeat ? { repeat } : {}) };
    if (this.linkCheck.checked) {
      const tab = this.host.activeTab();
      if (tab) {
        reminder.link = { kind: 'tab', id: tab.id, url: tab.url };
        reminder.title = tab.title;
      }
    }
    if (!this.host.add(reminder)) return; // いっぱい（知らせは host が出す）。欄はそのまま
    this.closeForm();
    const at = new Date(dueAt);
    this.showStatus(`${at.getMonth() + 1}/${at.getDate()} ${clockOf(dueAt)} に知らせます`);
  }

  // 引き金で置く（K4b）：文は打ったまま（頭の時刻も読まない）。時刻では鳴らさない。繰り返しは使わない
  private placeTriggered() {
    const text = this.input.value.trim();
    if (text === '') {
      this.fail('知らせる文を書いてください');
      return;
    }
    const trigger = this.triggerOf(this.kindSelect.value);
    if (trigger === null) {
      this.fail('今のタブはサイトではありません（http・https のページで置いてください）');
      return;
    }
    const extra: Partial<Reminder> = { by: 'user' };
    if (this.linkCheck.checked) {
      const tab = this.host.activeTab();
      if (tab) {
        extra.link = { kind: 'tab', id: tab.id, url: tab.url };
        extra.title = tab.title;
      }
    }
    if (!this.host.add(triggeredReminder(text, trigger, Date.now(), extra))) return; // いっぱい（知らせは host が出す）。欄はそのまま
    this.closeForm();
    this.showStatus(`${triggerLabel(trigger)}に知らせます`);
  }

  private fail(message: string) {
    this.error.textContent = message;
  }

  private clearError() {
    this.error.textContent = '';
  }

  private showStatus(text: string) {
    window.clearTimeout(this.statusTimer);
    this.status.textContent = text;
    this.statusTimer = window.setTimeout(() => {
      this.status.textContent = '';
    }, STATUS_MS);
  }

  // ---------- 一覧 ----------

  // 一覧だけを作り直す（置く欄と書きかけの文は作り直さない）
  private renderList() {
    const now = Date.now();
    // 台帳を読めなかったときは、一覧の先頭に帯を出す（K0b。0 件のときも出す）
    const band = this.failed
      ? [el('div', 'panel-note field-error', 'リマインダーの台帳を読めませんでした。いま置いたリマインダーは保存されません。ブラウザを開き直してください')]
      : [];
    const undo = this.undo ? [this.undoCard(this.undo)] : [];
    if (this.reminders.length === 0) {
      this.list.replaceChildren(...band, ...undo, el('div', 'reminder-empty', 'まだありません。「＋リマインダー」で置くか、相棒に「30分後に休憩をリマインドして」のように頼めます'));
      return;
    }
    const rows: HTMLElement[] = [];
    let day = '';
    // 時刻で鳴るものは日ごとに。引き金のものは、その後ろに「引き金」としてまとめる（作った順。K4b）
    const timed = this.reminders.filter((r) => reminderTrigger(r) === undefined);
    for (const reminder of [...timed].sort((a, b) => a.dueAt - b.dueAt)) {
      const key = new Date(reminder.dueAt).toDateString();
      if (key !== day) {
        day = key;
        rows.push(el('div', 'reminder-day', dayLabel(reminder.dueAt, now)));
      }
      rows.push(this.row(reminder, now));
      if (this.snoozeFor === reminder.id) rows.push(this.snoozeRow(reminder, now));
    }
    const triggered = this.reminders.filter((r) => reminderTrigger(r) !== undefined).sort((a, b) => a.createdAt - b.createdAt);
    if (triggered.length > 0) {
      rows.push(el('div', 'reminder-day', '引き金'));
      for (const reminder of triggered) rows.push(this.row(reminder, now));
    }
    this.list.replaceChildren(...band, ...undo, ...rows);
  }

  private row(reminder: Reminder, now: number): HTMLElement {
    const row = el('div', 'reminder-item');
    const text = el('div', 'reminder-text');

    const trigger = reminderTrigger(reminder);
    const head = el('div', 'reminder-head');
    if (trigger) {
      head.append(el('span', 'reminder-trigger', triggerLabel(trigger))); // 引き金のもの：時刻と残りの代わりに札（K4b）
    } else {
      const time = el('span', 'reminder-time', clockOf(reminder.dueAt));
      time.title = remainingLabel(reminder.dueAt, now);
      head.append(time, el('span', 'reminder-left', remainingLabel(reminder.dueAt, now)));
    }
    const repeat = reminderRepeat(reminder);
    if (repeat) head.append(el('span', 'reminder-repeat', `↻ ${repeatLabel(repeat)}`)); // 繰り返し（K3）

    const by = reminderBy(reminder);
    const mark = el('span', `reminder-by ${by}`);
    mark.title = by === 'user' ? '自分で置きました' : '相棒が置きました';
    const main = el('div', 'reminder-main');
    main.append(mark, el('span', 'reminder-message', reminder.text));

    text.append(head, main);
    const link = reminderLink(reminder);
    if (link) text.append(this.linkButton(link, reminder.title));
    if (reminder.card) text.append(this.cardButton(reminder.card)); // カードから置いたもの（K4b）

    const later = el('button', 'reminder-snooze-toggle', '⏲');
    later.type = 'button';
    later.title = '延ばす';
    later.setAttribute('aria-label', '延ばす');
    later.setAttribute('aria-expanded', String(this.snoozeFor === reminder.id));
    later.addEventListener('click', () => {
      this.snoozeFor = this.snoozeFor === reminder.id ? null : reminder.id;
      this.renderList();
    });

    const done = el('button', 'reminder-done', '✓'); // 済み（K3）：鳴る前に済ませる。繰り返しは左が次の回を送り返す
    done.type = 'button';
    done.title = '済みにする（繰り返しは次の回へ）';
    done.setAttribute('aria-label', '済みにする（繰り返しは次の回へ）');
    done.addEventListener('click', () => this.doneOne(reminder));

    const remove = el('button', 'reminder-remove', '×');
    remove.type = 'button';
    remove.title = 'このリマインダーを取り消す';
    remove.setAttribute('aria-label', 'このリマインダーを取り消す');
    remove.addEventListener('click', () => this.cancelOne(reminder));

    row.append(text, ...(trigger ? [] : [later]), done, remove); // 引き金のものは延ばさない（⏲ は出さない）
    return row;
  }

  // 指す先の札（題名は、置いたときの題名。鳴ったものの列でも同じ）
  private linkButton(link: VocabLink, title?: string): HTMLButtonElement {
    const button = el('button', 'reminder-link', this.linkName(link, title));
    button.type = 'button';
    button.title = 'そのセルへ行く';
    button.addEventListener('click', () => this.host.openLink(link));
    return button;
  }

  // 単語カードの札（K4b）：押すと、右の「単語帳」でそのカードを開く（host が決める）
  private cardButton(id: string): HTMLButtonElement {
    const button = el('button', 'reminder-link', '📇 単語帳で開く');
    button.type = 'button';
    button.title = '右の「単語帳」で、このカードを開きます';
    button.addEventListener('click', () => this.host.openCard?.(id));
    return button;
  }

  // 札の名前：今のタブ・メモの題名。見つからなければ置いたときの題名。それも無ければ種類の名（「（見つかりません）」を添える）
  private linkName(link: VocabLink, title?: string): string {
    if (link.kind === 'tab') {
      const tab = findVocabTab(this.host.tabs(), link);
      if (tab?.title) return tab.title;
    } else {
      const memo = this.host.memos()?.find((m) => m.id === link.id);
      if (memo?.title) return memo.title;
    }
    if (title) return title;
    const kind = link.kind === 'tab' ? 'タブ' : 'メモ';
    // メモの一覧がまだ届いていないときは、見つからないとは言わない
    if (link.kind === 'memo' && this.host.memos() === null) return kind;
    return `${kind}（見つかりません）`;
  }

  // 延ばす先の行（来週は出さない）。同じ id で置き直す
  private snoozeRow(reminder: Reminder, now: number): HTMLElement {
    return this.presetSnoozeRow(now, (dueAt) => this.snooze(reminder, dueAt));
  }

  // 延ばす先の押しボタンの行（一覧の行と鳴ったものの列で同じ見た目）
  private presetSnoozeRow(now: number, pick: (dueAt: number) => void): HTMLElement {
    const row = el('div', 'reminder-snooze');
    row.append(el('span', 'reminder-snooze-label', '延ばす'));
    for (const preset of presetTimes(now)) {
      if (preset.key === 'week') continue;
      const button = el('button', 'reminder-snooze-btn', preset.label);
      button.type = 'button';
      button.addEventListener('click', () => pick(preset.dueAt));
      row.append(button);
    }
    return row;
  }

  private snooze(reminder: Reminder, dueAt: number) {
    if (!this.host.add({ ...reminder, dueAt })) return; // いっぱい（知らせは host が出す）。行は開いたまま
    this.snoozeFor = null;
    this.renderList();
  }

  // ✓：一覧からすぐ外して、五秒の間だけ「元に戻す」を出す（繰り返しは左が次の回を送り返す）
  private doneOne(reminder: Reminder) {
    if (this.snoozeFor === reminder.id) this.snoozeFor = null;
    this.reminders = this.reminders.filter((r) => r.id !== reminder.id);
    this.showUndo(reminder, '済みにしました');
    this.host.done(reminder.id, false);
    this.renderList();
  }

  // ×：取り消して、五秒の間だけ「元に戻す」を出す
  private cancelOne(reminder: Reminder) {
    if (this.snoozeFor === reminder.id) this.snoozeFor = null;
    this.reminders = this.reminders.filter((r) => r.id !== reminder.id);
    this.showUndo(reminder);
    this.host.cancel(reminder.id);
    this.renderList();
  }

  private showUndo(reminder: Reminder, said = '取り消しました') {
    window.clearTimeout(this.undoTimer);
    this.undo = { reminder, said };
    this.undoTimer = window.setTimeout(() => {
      this.undo = null;
      this.renderList();
    }, UNDO_MS);
  }

  private undoCard({ reminder, said }: { reminder: Reminder; said: string }): HTMLElement {
    const chars = [...reminder.text];
    const short = chars.length > UNDO_TEXT_MAX ? `${chars.slice(0, UNDO_TEXT_MAX).join('')}…` : reminder.text;
    const card = el('div', 'reminder-undo');
    const button = el('button', 'reminder-undo-btn', '元に戻す');
    button.type = 'button';
    button.addEventListener('click', () => this.restore(reminder));
    card.append(el('span', 'reminder-undo-text', `「${short}」を${said}`), button);
    return card;
  }

  private restore(reminder: Reminder) {
    if (!this.host.add(reminder)) return; // いっぱい（知らせは host が出す）。札はそのまま
    window.clearTimeout(this.undoTimer);
    this.undo = null;
    this.renderList();
  }

  // ---------- 鳴ったものの列（K3） ----------

  // 鳴ったものの一覧を受けて、その列だけを描き直す（最後に受けたものを覚える）
  renderFired(items: FiredReminder[], failed = false) {
    this.fired = [...items].sort((a, b) => b.firedAt - a.firedAt);
    this.firedFailed = failed;
    if (this.firedSnoozeFor !== null && !this.fired.some((f) => f.id === this.firedSnoozeFor)) this.firedSnoozeFor = null;
    this.paintFired();
  }

  // 見出し（開く・閉じる）と、開いているときの中身を作り直す
  private paintFired() {
    const now = Date.now();
    const unfinished = this.fired.filter((f) => f.state === 'fired').length;
    const head = el('button', 'reminder-fired-head', `鳴ったもの ${this.fired.length} 件${unfinished > 0 ? `（済んでいない ${unfinished} 件）` : ''}`);
    head.type = 'button';
    head.setAttribute('aria-expanded', String(this.firedOpen));
    head.addEventListener('click', () => {
      this.firedOpen = !this.firedOpen;
      this.paintFired();
    });
    const parts: HTMLElement[] = [head];
    if (this.firedOpen) parts.push(this.firedBody(now));
    this.firedBox.replaceChildren(...parts);
  }

  private firedBody(now: number): HTMLElement {
    const body = el('div', 'reminder-fired-body');
    const notes: HTMLElement[] = [];
    if (this.firedFailed) notes.push(el('div', 'panel-note field-error', '鳴ったものの記録を読めませんでした。この起動では残りません'));
    if (this.fired.length === 0) notes.push(el('div', 'reminder-empty', '鳴ったものはまだありません'));
    const shown = this.firedAll ? this.fired : this.fired.slice(0, FIRED_SHOW);
    const rows: HTMLElement[] = [];
    for (const item of shown) {
      rows.push(this.firedRow(item, now));
      if (this.firedSnoozeFor === item.id) rows.push(this.firedSnoozeRow(item, now));
    }
    body.append(...notes, ...rows);
    if (!this.firedAll && this.fired.length > FIRED_SHOW) {
      const more = el('button', 'reminder-snooze-btn', `もっと見る（あと ${this.fired.length - FIRED_SHOW} 件）`);
      more.type = 'button';
      more.addEventListener('click', () => {
        this.firedAll = true;
        this.paintFired();
      });
      body.append(more);
    }
    return body;
  }

  // 鳴ったものの一行：時刻・状態・繰り返し・文・指す先。操作は状態で変わる
  private firedRow(item: FiredReminder, now: number): HTMLElement {
    const row = el('div', `reminder-fired-item ${item.state}`);
    const text = el('div', 'reminder-text');

    const head = el('div', 'reminder-head');
    head.append(el('span', 'reminder-time', `${dayLabel(item.firedAt, now)} ${clockOf(item.firedAt)}`), el('span', 'reminder-state', FIRED_STATE_LABEL[item.state]));
    const repeat = reminderRepeat(item);
    if (repeat) head.append(el('span', 'reminder-repeat', `↻ ${repeatLabel(repeat)}`));
    const trigger = reminderTrigger(item);
    if (trigger) head.append(el('span', 'reminder-trigger', triggerLabel(trigger))); // 引き金の札は、状態の札の横に（K4b）
    const main = el('div', 'reminder-main');
    main.append(el('span', 'reminder-message', item.text));
    text.append(head, main);
    if (item.link) text.append(this.linkButton(item.link, item.title));
    if (item.card) text.append(this.cardButton(item.card)); // カードから置いたもの（K4b）

    const acts = el('div', 'reminder-fired-acts');
    if (item.state === 'fired') {
      const done = el('button', 'reminder-snooze-btn reminder-fired-act', '✓ 済み');
      done.type = 'button';
      done.title = '済みにします（「鳴ったもの」に残ります）';
      done.addEventListener('click', () => this.host.done(item.id, true));
      const later = el('button', 'reminder-snooze-toggle', '⏲');
      later.type = 'button';
      later.title = '延ばす';
      later.setAttribute('aria-label', '延ばす');
      later.setAttribute('aria-expanded', String(this.firedSnoozeFor === item.id));
      later.addEventListener('click', () => {
        this.firedSnoozeFor = this.firedSnoozeFor === item.id ? null : item.id;
        this.paintFired();
      });
      acts.append(done, later);
    }
    const card = el('button', 'reminder-snooze-btn reminder-fired-act', 'カードに');
    card.type = 'button';
    card.title = 'この文を単語カードにします';
    card.addEventListener('click', () => this.host.toCard(item.text));
    const again = el('button', 'reminder-snooze-btn reminder-fired-act', 'もう一度');
    again.type = 'button';
    again.title = 'この文で、時刻を選び直して置きます';
    again.addEventListener('click', () => this.again(item.text));
    acts.append(card, again);
    text.append(acts);

    row.append(text);
    return row;
  }

  // 延ばす先の行。鳴ったものは写しで延ばす（記録は「延ばした」になり、台帳には残さない）
  private firedSnoozeRow(item: FiredReminder, now: number): HTMLElement {
    return this.presetSnoozeRow(now, (dueAt) => this.snoozeFired(item, dueAt));
  }

  private snoozeFired(item: FiredReminder, dueAt: number) {
    const copy: Reminder = {
      id: item.id,
      text: item.text,
      dueAt: item.dueAt,
      createdAt: item.firedAt,
      ...(item.link ? { link: item.link } : {}),
      ...(item.by ? { by: item.by } : {}),
      ...(item.title ? { title: item.title } : {}),
    };
    if (!this.host.add(snoozedCopy(copy, dueAt, Date.now()))) return; // いっぱい（知らせは host が出す）。行は開いたまま
    this.firedSnoozeFor = null;
    this.paintFired();
  }

  // もう一度：置く欄を開いて、文の欄にその文を入れる（時刻は選び直す）
  private again(text: string) {
    if (this.form.hidden) this.openForm();
    this.input.value = text;
    this.presetKey = null;
    this.time.value = '';
    this.kindSelect.value = 'time'; // 時刻を選び直して置く（K4b。引き金のままでは時刻の欄が押せない）
    this.syncKind();
    this.syncPresets();
    this.clearError();
    this.updateHint();
    this.input.focus();
  }
}
