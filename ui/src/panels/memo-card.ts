// メモのセルのカード（拡大表示に出す）と、メモを書く欄（盤面の上に出す）
import { t } from '../i18n';
import { armConfirm } from '../confirm-arm';
import type { MemoCell } from '../memocells';
import type { Island } from '../types';
import { el } from '../util';
import { tagArea, type TagPad } from './tag-pad';
import { threadBlock, type ThreadUi } from './thread-view';

export interface MemoActions {
  edit(id: string): void;
  remove(id: string): void;
  setLiked(id: string, liked: number): void;
  changeTags(id: string, add: string[], remove: string[]): void; // タグを足す・外す（その時のタグに対して）
  openUrl(url: string): void;
  sendToHexMemo(id: string): void;
  askCompanion(id: string): void; // 右の相棒に見せる（画像があれば画像も）
  openPane(id: string): void; // 下の区画で開く。すでにそのメモなら閉じる
  isPaneOpen(id: string): boolean;
  leaveIsland(id: string): void;
  saveToVault?(id: string): void; // データ置き場（右サイドバーのメモの区画の下）に入れる（相棒が残した考察のメモだけ）
}

export interface MemoCardOptions {
  memo: MemoCell;
  image?: string; // 六角形スクショの data URL
  compact: boolean; // ポップアップ用（ボタンなし）
  actions?: MemoActions;
  island?: Island;
  thread?: ThreadUi; // コメントのスレッド（返信を書く・コピー・相棒に返信してもらう）
  tagPad?: TagPad; // タグのボタン（6つ・セット・その他。小さいカードには出さない）
  toast?: (text: string) => void; // 短いお知らせ（タグが多すぎるときなど）
  pin?: { on: boolean; toggle(): void }; // 📌 固定（M5。タブのカードと同じ）
}

const URL_RE = /https?:\/\/[^\s<>"'）」』】]+/i;
const PLACEHOLDER = t('メモ（Ctrl+Enter で残す・Esc でやめる）');
const openMemos = new Set<string>(); // 全文を開いているメモ（カードは何度も描き直すので、ここに覚えておく）

export function memoCard(o: MemoCardOptions): HTMLElement {
  const { memo } = o;
  const card = el('div', o.compact ? 'preview-card memo-card compact' : 'preview-card memo-card');
  card.dataset.memo = memo.id;

  const visual = el('div', 'preview-visual memo-visual');
  if (o.image) {
    const img = el('img');
    img.src = o.image;
    img.alt = '';
    visual.append(img);
  } else {
    visual.append(el('div', 'memo-paper', memo.text ? [...memo.text.trim()][0] : '✎'));
  }
  card.append(visual);

  const meta = el('div', 'preview-meta');
  meta.append(el('span', 'pill pill-memo', o.image ? t('スクショ') : t('メモ')), el('span', 'pill', dateOf(memo.updatedAt)));
  if (o.actions?.isPaneOpen(memo.id)) {
    const mark = el('span', 'pill pill-pane', t('下で開いています'));
    mark.title = t('このメモを、中央の下の区画で開いています');
    meta.append(mark);
  }
  // ボット（外の Grok Bot）から届いた返事をメモにしたもの（ボットの欄の「メモにする」）：相棒の考察とは見た目を変える
  const fromBot = memo.by?.who === 'bot';
  if (memo.by && fromBot) {
    const by = el('span', 'pill pill-bot', t('ボット（{0}）から届いた{1}', { 0: memo.by.name, 1: memo.label ?? '返事' }));
    by.title = t('外の Grok Bot（{0}）から届いた{1}です。相棒（ブラウザの中の AI）が書いたものではありません{2}', { 0: memo.by.name, 1: memo.label ?? '返事', 2: memo.tags.includes('未確認') ? '。「未確認」：依頼と合うか確かめられなかった返事です' : '' });
    meta.append(by);
  } else if (memo.by) {
    // AI の相棒が残した考察・レター（使う人のメモと見分けられるように）
    const kind = memo.label ?? t('考察');
    const by = el('span', 'pill pill-ai', t('{0}・{1}', { 0: kind, 1: memo.by.name }));
    by.title = memo.by.who === 'import' ? t('取り込んだファイル（{0}）のメモです。使う人や相棒が書いたものではありません', { 0: memo.by.name }) : t('AI の相棒（{0}）が残した{1}です', { 0: memo.by.name, 1: kind });
    meta.append(by);
  }
  if (o.island) {
    const pill = el('span', 'pill pill-island', t('島：{0}', { 0: o.island.name }));
    pill.style.setProperty('--island', o.island.color);
    if (!o.compact && o.actions) {
      const leave = el('button', 'pill-remove', '×');
      leave.title = t('この島から出す');
      leave.setAttribute('aria-label', 'この島から出す');
      const actions = o.actions;
      leave.addEventListener('click', () => actions.leaveIsland(memo.id));
      pill.append(leave);
    }
    meta.append(pill);
  }

  const body = el('div', 'preview-note-body memo-body', memo.text || t('（まだ何も書いていません）'));
  if (!memo.text) body.classList.add('empty');
  const long = memo.text.length > 110 || memo.text.split('\n').length > 4;
  card.append(meta, body);
  if (long && !o.compact) {
    body.classList.toggle('open', openMemos.has(memo.id));
    const toggle = el('button', 'preview-note-toggle', openMemos.has(memo.id) ? t('たたむ ▴') : t('続きを読む ▾'));
    const flip = () => {
      if (openMemos.has(memo.id)) openMemos.delete(memo.id);
      else openMemos.add(memo.id);
      body.classList.toggle('open', openMemos.has(memo.id));
      toggle.textContent = openMemos.has(memo.id) ? t('たたむ ▴') : t('続きを読む ▾');
    };
    toggle.addEventListener('click', flip);
    body.classList.add('clickable');
    body.addEventListener('click', () => {
      if (!getSelection()?.toString()) flip();
    });
    card.append(toggle);
  }
  if (memo.source) {
    const source = el('button', 'memo-source', `↗ ${memo.source.title || memo.source.url}`);
    source.title = memo.source.url;
    const actions = o.actions;
    if (actions && !o.compact) source.addEventListener('click', () => actions.openUrl(memo.source?.url ?? ''));
    card.append(source);
  }
  if (memo.tags.length > 0 || (!o.compact && o.actions)) {
    const editable = !o.compact && !!o.actions;
    const actions = o.actions;
    const target = { tags: memo.tags, what: t('このメモ'), change: (add: string[], remove: string[]) => actions?.changeTags(memo.id, add, remove) };
    card.append(tagArea(target, { editable, pad: editable ? o.tagPad : undefined, focusKey: `memo${memo.id}:`, toast: o.toast }));
  }

  const a = o.actions;
  const paneButton = () => {
    if (!a) return null;
    const open = a.isPaneOpen(memo.id);
    const b = button(open ? t('下の区画を閉じる') : t('下で開く ⬓'), () => a.openPane(memo.id));
    b.title = open ? t('下のメモの区画を閉じる') : t('中央を上下に分けて、このメモを下で書く');
    return b;
  };
  if (o.compact && a) {
    const row = el('div', 'preview-actions');
    const pane = paneButton();
    if (pane) row.append(pane);
    card.append(row);
  }
  if (!o.compact && a) {
    const actions = el('div', 'preview-actions');
    if (o.pin) actions.append(pinButton(o.pin));
    const pane = paneButton();
    if (pane) actions.append(pane);
    const like = button(memo.liked > 0 ? `♥${memo.liked}` : '♡', () => a.setLiked(memo.id, (memo.liked + 1) % 4));
    like.classList.add('preview-like');
    if (memo.liked > 0) like.classList.add('liked');
    like.title = t('いいね（押すたびに 1→2→3→なし）');
    actions.append(like, button(t('書き直す'), () => a.edit(memo.id)));
    const url = memo.text.match(URL_RE)?.[0];
    if (url) {
      // ボットの返事のリンクは、押す前にドメインを見せる
      const open = button(fromBot ? t('リンクを開く（{0}）', { 0: hostOf(url) }) : t('リンクを開く'), () => a.openUrl(url));
      open.title = url;
      actions.append(open);
    }
    // ボットの返事は、相棒に見せない（道具なしの別の1回で見せる形は S2.8。ここから渡すと会話に残るため）
    if (!fromBot) {
      const ask = button(t('相棒に見せる'), () => a.askCompanion(memo.id));
      ask.title = o.image ? t('この画像とメモを、右の相棒に見せて話す') : t('このメモについて、右の相棒と話す');
      actions.append(ask);
    }
    actions.append(button(t('六角メモへ'), () => a.sendToHexMemo(memo.id)));
    // 相棒が残した考察（フェイブルレターは除く）は、データ置き場にも残せる（ボットの返事は入れない。Q11）
    if (memo.by && !fromBot && memo.label !== 'レター' && a.saveToVault) {
      const vault = button(t('データ置き場へ'), () => a.saveToVault?.(memo.id));
      vault.title = t('{0}が残したこのメモを、データ置き場（右サイドバーのメモの区画の下）に残す', { 0: memo.by.name });
      actions.append(vault);
    }
    const remove = button(t('消す'), () => {
      if (remove.textContent !== '本当に消す') {
        armConfirm(remove);
        remove.textContent = '本当に消す';
        remove.classList.add('danger');
        return;
      }
      a.remove(memo.id);
    });
    actions.append(remove);
    card.append(actions);
  }
  // 下で開いているメモは、同じスレッドを2か所で書かない（K3）。ほかのメモは今のまま
  const replies = memo.replies ?? [];
  if (o.actions?.isPaneOpen(memo.id)) {
    const n = replies.filter((r) => r.parent === null).length;
    const note = el('div', 'thread-pane-note', t('コメント {0}件（下の区画で見る）', { 0: n }));
    note.title = t('このメモは下の区画で開いています。コメントはそこで見て、書いてください');
    card.append(note);
  } else {
    card.append(threadBlock({ kind: 'memo', id: memo.id }, replies, o.compact ? undefined : o.thread, o.compact));
  }
  return card;
}

// ---------- メモを書く欄（盤面の上。セルの近くに出す） ----------

export class MemoEditor {
  private readonly element = el('form', 'memo-editor');
  private readonly text = el('textarea', 'memo-editor-input');
  private readonly heading = el('div', 'memo-editor-head');
  private readonly save = el('button', 'preview-button', t('残す'));
  private onSave: ((text: string) => void) | null = null;
  private onCancel: (() => void) | null = null;

  constructor(private readonly host: HTMLElement) {
    this.element.hidden = true;
    this.text.rows = 5;
    this.text.placeholder = PLACEHOLDER;
    const save = this.save;
    save.type = 'submit';
    const cancel = el('button', 'preview-button', t('やめる'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.cancel());
    const row = el('div', 'preview-actions');
    row.append(save, cancel);
    this.element.append(this.heading, this.text, row);
    this.element.addEventListener('submit', (e) => {
      e.preventDefault();
      const save = this.onSave;
      this.close();
      save?.(this.text.value);
    });
    this.text.addEventListener('keydown', (e) => {
      e.stopPropagation(); // 盤面のキー（Ctrl+C・V・Esc）に取られないように
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) this.element.requestSubmit();
      if (e.key === 'Escape') this.cancel();
    });
    host.append(this.element);
  }

  get isOpen() {
    return !this.element.hidden;
  }

  // 書きかけの文字があるか（シートを移る前に確かめる）
  get hasText() {
    return this.isOpen && this.text.value.trim() !== '';
  }

  // anchor：セルの画面上の四角。その下（入らなければ上）に出す
  //   options：okLabel（決めるボタンの文字。無ければ「残す」）・placeholder（ボットに頼む文を書くときなど）
  open(anchor: DOMRect, heading: string, initial: string, onSave: (text: string) => void, onCancel?: () => void, options: { okLabel?: string; placeholder?: string } = {}) {
    this.onSave = onSave;
    this.onCancel = onCancel ?? null;
    this.heading.textContent = heading;
    this.save.textContent = options.okLabel ?? t('残す');
    this.text.placeholder = options.placeholder ?? PLACEHOLDER;
    this.text.value = initial;
    this.element.hidden = false;
    const box = this.host.getBoundingClientRect();
    const width = Math.min(260, box.width - 16);
    this.element.style.width = `${width}px`;
    const x = Math.max(8, Math.min(anchor.left + anchor.width / 2 - box.left - width / 2, box.width - width - 8));
    const height = this.element.offsetHeight;
    const below = anchor.bottom - box.top + 6;
    const y = below + height <= box.height ? below : Math.max(8, anchor.top - box.top - height - 6);
    this.element.style.left = `${x}px`;
    this.element.style.top = `${y}px`;
    this.text.focus();
    this.text.setSelectionRange(this.text.value.length, this.text.value.length);
  }

  private cancel() {
    const cancel = this.onCancel;
    this.close();
    cancel?.();
  }

  close() {
    this.element.hidden = true;
    this.onSave = null;
    this.onCancel = null;
  }
}

function pinButton(pin: { on: boolean; toggle(): void }) {
  const b = button(pin.on ? t('📌 固定中') : t('📌 固定'), () => pin.toggle());
  b.classList.toggle('on', pin.on);
  b.title = pin.on ? t('固定を外す。マウスを乗せたセルで、カードが替わるようになります') : t('押しているあいだ、ほかのセルにマウスを乗せても、このカードのままです。起動し直すと外れます');
  b.setAttribute('aria-pressed', String(pin.on));
  return b;
}

function button(label: string, onClick: () => void) {
  const b = el('button', 'preview-button', label);
  b.addEventListener('click', onClick);
  return b;
}

function dateOf(ms: number) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// リンクのドメイン（日本語などのドメインは xn-- の形のまま）
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '？';
  }
}
