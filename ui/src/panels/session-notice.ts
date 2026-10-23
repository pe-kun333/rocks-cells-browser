// 盤面の上の帯：盤面の台帳（session.json）を読めなかったときの決めごとと、保存できていないことの知らせ
//   文は session-guard.ts。帯は消えず（知らせの toast と違う）、使う人が選ぶまで残る
import type { SessionNoticeText } from '../session-guard';
import { el } from '../util';

export class SessionNotice {
  private readonly root = el('div', 'session-notice');
  private readonly recovery = el('div', 'session-notice-box');
  private readonly saveFailed = el('div', 'session-notice-box session-notice-fail');

  constructor(host: HTMLElement) {
    this.root.setAttribute('role', 'alert');
    this.recovery.hidden = true;
    this.saveFailed.hidden = true;
    this.root.append(this.recovery, this.saveFailed);
    this.root.hidden = true;
    host.append(this.root);
  }

  // 読めなかった：選ぶまで残る。accept は保存を始める、decline はこの起動では保存しない
  showRecovery(text: SessionNoticeText, on: { accept(): void; decline(): void }) {
    const accept = el('button', text.recommend === 'accept' ? 'primary' : '', text.accept);
    const decline = el('button', text.recommend === 'decline' ? 'primary' : '', text.decline);
    accept.type = 'button';
    decline.type = 'button';
    accept.addEventListener('click', () => on.accept());
    decline.addEventListener('click', () => on.decline());
    const actions = el('div', 'session-notice-actions');
    actions.append(text.recommend === 'accept' ? accept : decline, text.recommend === 'accept' ? decline : accept);
    this.recovery.replaceChildren(el('strong', '', text.title), ...text.body.map((line) => el('p', '', line)), actions);
    this.recovery.hidden = false;
    this.sync();
  }

  // 保存しないで続ける：小さな帯にして、あとから保存を始められる
  showHeld(onResume: () => void) {
    const resume = el('button', '', '保存を始める');
    resume.type = 'button';
    resume.addEventListener('click', () => onResume());
    const actions = el('div', 'session-notice-actions');
    actions.append(resume);
    this.recovery.replaceChildren(el('p', '', 'この起動では盤面（session.json）を保存しません。閉じたあと、データフォルダの session.json を確かめてください。'), actions);
    this.recovery.hidden = false;
    this.sync();
  }

  hideRecovery() {
    this.recovery.hidden = true;
    this.recovery.replaceChildren();
    this.sync();
  }

  setSaveFailed(text: string | null) {
    this.saveFailed.textContent = text ?? '';
    this.saveFailed.hidden = text === null;
    this.sync();
  }

  private sync() {
    this.root.hidden = this.recovery.hidden && this.saveFailed.hidden;
  }
}
