// 合図（段階4）。ページが変わった・文を選んだ・同じページに少しいた、のときに印を出す。
//   詳しく：下書きと、いつもの依頼の小窓まで。コピーもアプリも開かない。
//   メモに残す：手元のメモのセルだけ。今は不要：その種類を、そのサイトで控えていく。
//   渡し止めのサイトと、一時停止中と、見守る、では印を出さない。
import type { BotRole } from '../bot-roles';
import { draftFromForm } from '../bot-send';
import {
  type CueKind,
  type CueSettings,
  CUE_DAILY_MAX,
  CUE_KIND_LABEL,
  CUE_SELECTION_MIN,
  CUE_SKIP_LIMIT,
  CUE_STAY_MS,
  canShowCue,
  cueAsk,
  cueHost,
  cueLine,
  cueScope,
  kindQuiet,
  loadCueSettings,
  noteCueAccept,
  noteCueSkip,
  rollCueDay,
  saveCueSettings,
} from '../cues';
import { addSingleDraft, newDraftId, type BotDraft } from '../drafts';
import type { PageText } from '../bridge';
import { el } from '../util';

export interface CueTab {
  id: number;
  url: string;
  title: string;
  loading: boolean;
}

export interface CueTarget {
  id: string;
  name: string;
  roleName?: string;
  role?: BotRole | null;
}

export interface CueHost {
  pageText(tabId: number): Promise<PageText>;
  blocked(url: string): Promise<boolean>;
  target(): CueTarget | null;
  openForm(input: { text: string; url?: string; title?: string; selection?: string; draftId: string }): boolean;
  saveMemo(text: string): void;
  toast(text: string): void;
}

interface CueCard {
  kind: CueKind;
  host: string;
  url: string;
  title: string;
  selection: string;
  line: string;
}

export class CuePanel {
  readonly element = el('section', 'cue-panel');
  private settings: CueSettings = loadCueSettings();
  private tab: CueTab | null = null;
  private card: CueCard | null = null;
  private local = false; // 渡し止め、または http(s) でない
  private settledUrl = '';
  private settled = false; // 渡し止めの判定が終わるまで、文の印は出さない
  private seenOnce = false;
  private generation = 0;
  private stayTimer = 0;
  private pollTimer = 0;
  private selectionSeen = '';
  private quietNote = '';
  private readonly scope = el('p', 'cue-scope');
  private readonly note = el('p', 'cue-note');
  private readonly cardHost = el('div', 'cue-slot');

  constructor(private readonly host: CueHost) {
    this.element.setAttribute('aria-label', '合図');
    this.build();
    this.render();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.ensurePoll();
    });
    this.ensurePoll();
  }

  watch(tab: CueTab | null) {
    this.tab = tab;
    if (!tab || tab.loading) {
      this.render();
      return;
    }
    void this.settle(tab);
  }

  private async settle(tab: CueTab) {
    const gen = ++this.generation;
    if (this.settledUrl !== tab.url) this.settled = false;
    const host = cueHost(tab.url);
    const local = !host || (await this.host.blocked(tab.url));
    if (gen !== this.generation || this.tab?.url !== tab.url) return;
    this.settled = true;
    this.settings = rollCueDay(this.settings);
    this.local = local;
    if (this.settledUrl === tab.url) {
      this.render();
      return;
    }
    const first = !this.seenOnce;
    this.seenOnce = true;
    this.settledUrl = tab.url;
    this.selectionSeen = '';
    this.quietNote = '';
    this.clearStay();
    if (!first && host && !local && canShowCue(this.settings, host, 'page') && !this.card) this.show('page', tab, '');
    if (host && !local) this.armStay(tab);
    this.render();
  }

  private armStay(tab: CueTab) {
    this.clearStay();
    const url = tab.url;
    this.stayTimer = window.setTimeout(() => {
      const host = cueHost(url);
      const current = this.tab;
      if (!host || !current || current.url !== url || current.loading || this.local || this.card) return;
      if (!canShowCue(this.settings, host, 'stay')) return;
      this.show('stay', current, '');
    }, CUE_STAY_MS);
  }

  private clearStay() {
    window.clearTimeout(this.stayTimer);
    this.stayTimer = 0;
  }

  private ensurePoll() {
    if (this.pollTimer) return;
    this.pollTimer = window.setInterval(() => void this.pollSelection(), 5000);
  }

  private async pollSelection() {
    if (document.visibilityState === 'hidden') return;
    this.settings = rollCueDay(this.settings);
    const tab = this.tab;
    const host = tab ? cueHost(tab.url) : '';
    if (!this.settled || !tab || tab.loading || tab.url !== this.settledUrl || !host || this.local) return;
    if (this.settings.mode !== 'cue' || this.settings.paused || this.card) return;
    if (!canShowCue(this.settings, host, 'selection')) return;
    const page = await this.host.pageText(tab.id);
    const selection = (page.selection ?? '').replace(/\s+/g, ' ').trim();
    if (selection.length < CUE_SELECTION_MIN) {
      this.selectionSeen = '';
      return;
    }
    if (selection === this.selectionSeen || this.card || this.tab?.url !== tab.url) return;
    if (page.url && cueHost(page.url) !== host) return;
    this.selectionSeen = selection;
    if (!canShowCue(this.settings, host, 'selection')) return;
    this.show('selection', tab, selection);
  }

  private show(kind: CueKind, tab: CueTab, selection: string) {
    const host = cueHost(tab.url);
    if (!host || !canShowCue(this.settings, host, kind) || this.card) return;
    this.settings = { ...this.settings, shown: this.settings.shown + 1 };
    saveCueSettings(this.settings);
    this.card = { kind, host, url: tab.url, title: tab.title, selection, line: cueLine(kind, tab.title, selection) };
    this.render();
  }

  private build() {
    const mode = el('select', 'cue-mode');
    mode.setAttribute('aria-label', '合図の話し方');
    for (const [value, label] of [
      ['cue', '合図だけ'],
      ['watch', '見守る'],
    ] as const) {
      const option = el('option', '', label);
      option.value = value;
      mode.append(option);
    }
    mode.addEventListener('change', () => {
      this.settings = { ...rollCueDay(this.settings), mode: mode.value === 'watch' ? 'watch' : 'cue' };
      if (this.settings.mode === 'watch') this.dismissCard();
      saveCueSettings(this.settings);
      this.render();
    });
    const pause = el('button', 'ai-small', '');
    pause.type = 'button';
    pause.addEventListener('click', () => {
      this.settings = { ...rollCueDay(this.settings), paused: !this.settings.paused };
      if (this.settings.paused) this.dismissCard();
      else if (this.tab && !this.local) this.armStay(this.tab);
      saveCueSettings(this.settings);
      this.render();
    });
    const limit = el('input', 'cue-limit');
    limit.type = 'number';
    limit.min = '1';
    limit.max = String(CUE_DAILY_MAX);
    limit.addEventListener('change', () => {
      const value = Number(limit.value);
      this.settings = {
        ...rollCueDay(this.settings),
        dailyLimit: Number.isFinite(value) ? Math.min(CUE_DAILY_MAX, Math.max(1, Math.round(value))) : this.settings.dailyLimit,
      };
      limit.value = String(this.settings.dailyLimit);
      saveCueSettings(this.settings);
      this.render();
    });
    const limitLabel = el('label', 'cue-limit-label');
    limitLabel.append(document.createTextNode('1日に'), limit, document.createTextNode('回まで'));
    const head = el('div', 'cue-head');
    head.append(el('span', 'cue-title', '合図'), mode, pause);
    this.note.textContent = '詳しくを押すまで、コピーもアプリも開きません。渡し止めのサイトと、一時停止中は印を出しません。同じサイトで「今は不要」が3回続くと、その種類は控えます。';
    this.element.append(head, this.scope, limitLabel, this.note, this.cardHost);
    mode.dataset.role = 'mode';
    pause.dataset.role = 'pause';
    limit.dataset.role = 'limit';
  }

  private render() {
    this.settings = rollCueDay(this.settings);
    const mode = this.element.querySelector<HTMLSelectElement>('[data-role="mode"]');
    const pause = this.element.querySelector<HTMLButtonElement>('[data-role="pause"]');
    const limit = this.element.querySelector<HTMLInputElement>('[data-role="limit"]');
    if (mode) mode.value = this.settings.mode;
    if (pause) {
      pause.textContent = this.settings.paused ? '再開' : '一時停止';
      pause.title = this.settings.paused ? '合図を再開します' : '合図を一時停止します（印を出さない）';
    }
    if (limit && document.activeElement !== limit) limit.value = String(this.settings.dailyLimit);
    this.scope.textContent = cueScope(this.settings, this.local);
    this.cardHost.replaceChildren();
    if (this.quietNote) this.cardHost.append(el('p', 'cue-quiet', this.quietNote));
    const card = this.card;
    if (!card || this.settings.mode !== 'cue' || this.settings.paused) {
      this.cardHost.hidden = !this.quietNote;
      return;
    }
    this.cardHost.hidden = false;
    const box = el('article', 'cue-card');
    box.append(el('p', 'cue-line', card.line));
    const row = el('div', 'cue-actions');
    const detail = el('button', 'ai-small', '詳しく');
    detail.type = 'button';
    detail.title = '下書きと依頼の小窓を開きます。コピーするまで、アプリは開きません';
    detail.addEventListener('click', () => void this.detail(card));
    const memo = el('button', 'ai-small', 'メモに残す');
    memo.type = 'button';
    memo.title = '手元のメモのセルに残します。アプリは開きません';
    memo.addEventListener('click', () => this.keepMemo(card));
    const skip = el('button', 'ai-small', '今は不要');
    skip.type = 'button';
    skip.title = 'この種類の印を、このサイトでは控えていきます';
    skip.addEventListener('click', () => this.skip(card));
    row.append(detail, memo, skip);
    box.append(row);
    this.cardHost.append(box);
  }

  private async detail(card: CueCard) {
    if (this.card !== card) return;
    this.card = null;
    const blocked = !cueHost(card.url) || (await this.host.blocked(card.url));
    if (this.card) return; // 判定のあいだに、次の印が出た
    if (blocked) {
      this.host.toast('このページは手元だけなので、下書きには残しません');
      this.render();
      return;
    }
    this.settings = noteCueAccept(this.settings, card.host, card.kind);
    saveCueSettings(this.settings);
    const text = cueAsk(card.kind);
    const target = this.host.target();
    const selection = card.kind === 'selection' ? card.selection : '';
    if (!target) {
      this.host.toast('リンクのある Grok Bot がいないので、小窓は開けません。印だけ閉じました');
      this.render();
      return;
    }
    const id = newDraftId();
    const draft: BotDraft = {
      id,
      createdAt: Date.now(),
      text,
      botId: target.id,
      botName: target.name,
      ...(target.roleName ? { roleName: target.roleName } : {}),
      next: true,
      chatOnly: false,
      attach: { title: !!card.title, url: !!card.url, selection: !!selection, body: false, image: false },
      req: draftFromForm(target.id, text, { url: card.url, title: card.title, ...(selection ? { selection } : {}) }, { role: target.role ?? null }),
    };
    await addSingleDraft(draft);
    const opened = this.host.openForm({ text, url: card.url, title: card.title, ...(selection ? { selection } : {}), draftId: id });
    this.host.toast(opened ? '下書きに残しました。コピーするまで、アプリは開きません' : '下書きに残しました。小窓はいま開けません');
    this.render();
  }

  private keepMemo(card: CueCard) {
    if (this.card !== card) return;
    this.settings = noteCueAccept(this.settings, card.host, card.kind);
    saveCueSettings(this.settings);
    this.card = null;
    const lines = [card.line, card.title, card.url, card.selection ? `選んだ文：${card.selection}` : ''].filter(Boolean);
    this.host.saveMemo(lines.join('\n'));
    this.host.toast('メモのセルに残しました。アプリは開いていません');
    this.render();
  }

  private skip(card: CueCard) {
    if (this.card !== card) return;
    this.settings = noteCueSkip(this.settings, card.host, card.kind);
    saveCueSettings(this.settings);
    this.card = null;
    if (kindQuiet(this.settings, card.host, card.kind)) {
      this.quietNote = `このサイトの「${CUE_KIND_LABEL[card.kind]}」は、今は不要が ${CUE_SKIP_LIMIT} 回続いたので控えます`;
    }
    this.render();
  }

  // 見守る・一時停止にしたとき。押したことにはしない
  private dismissCard() {
    this.card = null;
    this.clearStay();
  }
}
