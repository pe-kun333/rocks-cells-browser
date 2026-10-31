// 拡大表示のカード（1つのタブを大きく見せる）。どの置き場所でも、右サイドバーでも同じものを使う
import { t } from '../i18n';
import { armConfirm } from '../confirm-arm';
import { sleepStateOf } from '../sleep';
import type { Tab } from '../tabs';
import type { Island } from '../types';
import { el, initialOf } from '../util';
import { tagArea, type TagPad } from './tag-pad';
import { threadBlock, type ThreadUi } from './thread-view';

// カードのボタンから頼めること
export interface PreviewActions {
  open(id: number): void;
  close(id: number): void;
  setKeepAwake(id: number, keepAwake: boolean): void;
  sleepNow(id: number): void;
  setMuted(id: number, muted: boolean): void;
  removeNote(id: number, noteId: string): void;
  setLiked(id: number, liked: number): void;
  addUserNote(id: number, text: string): void;
  changeTags(id: number, add: string[], remove: string[]): void; // タグを足す・外す（持ち主の、その時のタグに対して）
  leaveIsland(id: number): void;
  readAsCells(id: number): void; // 六角で読む
  editFace(id: number): void; // 見た目（セルに見せる画像・コメント・見え方）
}

export interface PreviewCardOptions {
  tab: Tab;
  activeId: number | null;
  thumbnail?: string; // ページのサムネイル（無ければ大きな六角形のアイコン）
  compact: boolean; // ポップアップ用の小さめの見た目（ボタンなし）
  actions?: PreviewActions;
  island?: Island; // 入っている島
  thread?: ThreadUi; // タブのメモへの返信（コメントのスレッド）
  faceImage?: string; // タブに付けた画像（data URL。あればサムネイルより先に見せる）
  sheetName?: string; // 置いてあるシート（メイン以外のとき）
  tagPad?: TagPad; // タグのボタン（6つ・セット・その他。小さいカードには出さない）
  toast?: (text: string) => void; // 短いお知らせ（タグが多すぎるときなど）
  pin?: { on: boolean; toggle(): void }; // 📌 固定（M5。この起動のあいだだけ）
  cited?: { id: string; title: string }[]; // このページを引用しているメモ（M5）
  openCited?: (id: string) => void; // そのメモを下の区画で開く
}

const STATE_LABELS = { active: t('表示中'), awake: t('待機中'), suspended: t('一時停止中'), asleep: t('休眠中') } as const;

export function previewCard(o: PreviewCardOptions): HTMLElement {
  const { tab } = o;
  const state = sleepStateOf(tab, o.activeId);
  const card = el('div', o.compact ? 'preview-card compact' : 'preview-card');

  const visual = el('div', 'preview-visual');
  if (o.faceImage) {
    visual.classList.add('face');
    const hex = el('div', 'preview-hex face-hex');
    const img = el('img');
    img.src = o.faceImage;
    img.alt = '';
    hex.append(img);
    visual.append(hex);
  } else if (o.thumbnail) {
    visual.classList.add('thumb');
    if (state === 'asleep' || state === 'suspended') visual.classList.add('dim');
    const img = el('img');
    img.src = o.thumbnail;
    img.alt = '';
    visual.append(img);
  } else {
    visual.append(bigHex(tab));
  }

  const meta = el('div', 'preview-meta');
  meta.append(el('span', 'pill', t('{0}番', { 0: tab.order })), el('span', `pill pill-${state}`, STATE_LABELS[state]));
  if (tab.audible) meta.append(el('span', 'pill', tab.muted ? t('ミュート中') : t('♪ 再生中')));
  if (tab.keepAwake) meta.append(el('span', 'pill pill-keep', t('休眠させない')));
  if (tab.sleepBlocked === 'input') meta.append(el('span', 'pill', t('入力途中のため休眠を保留')));
  if (tab.notes.length > 0) meta.append(el('span', 'pill pill-keep', t('メモ {0}', { 0: tab.notes.length })));
  if (o.sheetName) meta.append(el('span', 'pill pill-sheet', t('シート：{0}', { 0: o.sheetName })));
  if (o.island) {
    const pill = el('span', 'pill pill-island', t('島：{0}', { 0: o.island.name }));
    pill.style.setProperty('--island', o.island.color);
    if (!o.compact && o.actions) {
      const leave = el('button', 'pill-remove', '×');
      leave.title = t('この島から出す');
      leave.setAttribute('aria-label', 'この島から出す');
      const actions = o.actions;
      leave.addEventListener('click', () => actions.leaveIsland(tab.id));
      pill.append(leave);
    }
    meta.append(pill);
  }
  if (state !== 'active') meta.append(el('span', 'pill', usedAgo(tab.lastUsed)));

  card.append(visual, el('div', 'preview-title', tab.title || tab.url || t('新しいタブ')));
  if (tab.comment) card.append(el('div', 'preview-comment', tab.comment));
  card.append(el('div', 'preview-url', tab.url), meta);

  const a = o.actions;
  if (tab.tags.length > 0 || (!o.compact && a)) {
    const editable = !o.compact && !!a;
    const target = { tags: tab.tags, what: t('このタブ'), change: (add: string[], remove: string[]) => a?.changeTags(tab.id, add, remove) };
    card.append(tagArea(target, { editable, pad: editable ? o.tagPad : undefined, focusKey: `tab${tab.id}:`, toast: o.toast }));
  }
  if (!o.compact && tab.notes.length > 0) card.append(notesList(tab, a, o.thread));
  if (!o.compact && o.cited && o.cited.length > 0 && o.openCited) card.append(citedBlock(o.cited, o.openCited));
  if (!o.compact && a) {
    const actions = el('div', 'preview-actions');
    if (o.pin) actions.append(pinButton(o.pin));
    if (state !== 'active') actions.append(button(t('開く'), () => a.open(tab.id)));
    const like = button(tab.liked > 0 ? `♥${tab.liked}` : '♡', () => a.setLiked(tab.id, (tab.liked + 1) % 4));
    like.classList.add('preview-like');
    if (tab.liked > 0) like.classList.add('liked');
    like.title = t('いいね（押すたびに 1→2→3→なし）');
    const write = button(t('メモを書く'), () => openNoteForm(card, tab, a));
    const read = button(t('六角で読む'), () => a.readAsCells(tab.id));
    read.title = t('ページの本文を六角セルに組み直して読む');
    const face = button(t('見た目'), () => a.editFace(tab.id));
    face.title = t('盤面のセルに見せる画像・コメントと、見え方を選ぶ');
    actions.append(
      like,
      write,
      face,
      read,
      tab.keepAwake
        ? button(t('休眠を許可'), () => a.setKeepAwake(tab.id, false))
        : button(t('休眠させない'), () => a.setKeepAwake(tab.id, true)),
    );
    if (state === 'awake' || state === 'suspended') actions.append(button(t('今すぐ休眠'), () => a.sleepNow(tab.id)));
    if (tab.audible || tab.muted) {
      actions.append(button(tab.muted ? t('ミュート解除') : t('ミュート'), () => a.setMuted(tab.id, !tab.muted)));
    }
    actions.append(button(t('閉じる'), () => a.close(tab.id)));
    card.append(actions);
  }
  return card;
}

// 自分でメモを書く欄（AI の相棒もこのメモを読む）。書いている間は、カードを描き直さない（preview-host・secondary）
function openNoteForm(card: HTMLElement, tab: Tab, actions: PreviewActions) {
  card.querySelector('.preview-note-form')?.remove();
  const form = el('form', 'preview-note-form');
  const text = el('textarea', 'preview-note-input');
  text.rows = 2;
  text.placeholder = t('このページにメモ（AI の相棒も読みます。Ctrl+Enter で残す）');
  const save = el('button', 'preview-button', t('残す'));
  save.type = 'submit';
  const cancel = el('button', 'preview-button', t('やめる'));
  cancel.type = 'button';
  const error = el('div', 'field-error');
  const row = el('div', 'preview-actions');
  row.append(save, cancel);
  form.append(text, error, row);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = text.value.trim();
    if (!value) {
      error.textContent = t('メモを入れてください');
      text.focus();
      return;
    }
    form.remove(); // 先に閉じる（入力中はカードを描き直さないので、閉じてから残す）
    actions.addUserNote(tab.id, value);
  });
  text.addEventListener('input', () => (error.textContent = ''));
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) form.requestSubmit();
    if (e.key === 'Escape') form.remove();
  });
  cancel.addEventListener('click', () => form.remove());
  card.append(form);
  text.focus();
}

// カードの中で文字を書いている途中か（その間はカードを描き直さない）
export function isWritingIn(container: Element) {
  const active = document.activeElement;
  const writing = active instanceof HTMLTextAreaElement || (active instanceof HTMLInputElement && active.classList.contains('preview-tag-input')); // 返信を書く欄も textarea
  return writing && container.contains(active);
}

// 開いたメモ・すべて見ているタブ（カードは何度も描き直すので、ここに覚えておく）
const openNotes = new Set<string>();
const allNotesOf = new Set<number>();
const NOTES_SHOWN = 3;

// 長いメモ（4行に収まらないもの）
const isLong = (text: string) => text.length > 110 || text.split('\n').length > 4;

// このタブのメモ（新しい順に3件。「ほか n 件を見る」ですべて）。長いメモは「続きを読む」で開く
function notesList(tab: Tab, actions?: PreviewActions, thread?: ThreadUi) {
  const list = el('div', 'preview-notes');
  const showAll = allNotesOf.has(tab.id);
  const notes = [...tab.notes].reverse();
  for (const note of showAll ? notes : notes.slice(0, NOTES_SHOWN)) {
    const row = el('div', 'preview-note');
    const head = el('div', 'preview-note-head');
    head.append(el('span', 'preview-note-label', note.label ?? (note.source === 'ai' ? 'AI' : t('メモ'))), el('span', '', dateOf(note.createdAt)));
    if (actions) {
      const remove = el('button', 'preview-note-remove', '×');
      const replies = note.replies?.length ?? 0;
      const label = replies > 0 ? t('このメモを消す（返信 {0} 件も消えます）', { 0: replies }) : t('このメモを消す');
      remove.title = label;
      remove.setAttribute('aria-label', label);
      remove.addEventListener('click', () => {
        // 返信が付いていたら、1回目は確かめるだけ（読み上げにも伝わるように、名前も変える）
        if (replies > 0 && !remove.classList.contains('danger')) {
          armConfirm(remove);
          const armed = t('もう一度押すと、このメモと返信 {0} 件を消します', { 0: replies });
          remove.classList.add('danger');
          remove.textContent = t('消す？');
          remove.title = armed;
          remove.setAttribute('aria-label', armed);
          return;
        }
        actions.removeNote(tab.id, note.id);
      });
      head.append(remove);
    }
    const body = el('div', 'preview-note-body', note.text);
    row.append(head, body);
    if (isLong(note.text)) {
      const open = openNotes.has(note.id);
      body.classList.toggle('open', open);
      const toggle = el('button', 'preview-note-toggle', open ? t('たたむ ▴') : t('続きを読む ▾'));
      const flip = () => {
        if (openNotes.has(note.id)) openNotes.delete(note.id);
        else openNotes.add(note.id);
        const now = openNotes.has(note.id);
        body.classList.toggle('open', now);
        toggle.textContent = now ? t('たたむ ▴') : t('続きを読む ▾');
      };
      toggle.addEventListener('click', flip);
      // 文字を選んでいるときは開閉しない（コピーできるように）
      body.addEventListener('click', () => {
        if (!getSelection()?.toString()) flip();
      });
      body.classList.add('clickable');
      row.append(toggle);
    }
    // このメモへの返信（コメントのスレッド）
    row.append(threadBlock({ kind: 'note', tabId: tab.id, noteId: note.id }, note.replies ?? [], thread));
    list.append(row);
  }
  if (tab.notes.length > NOTES_SHOWN) {
    const more = el('button', 'preview-note-more', showAll ? t('新しい3件だけにする ▴') : t('ほか {0} 件を見る ▾', { 0: tab.notes.length - NOTES_SHOWN }));
    more.addEventListener('click', () => {
      if (allNotesOf.has(tab.id)) allNotesOf.delete(tab.id);
      else allNotesOf.add(tab.id);
      list.replaceWith(notesList(tab, actions, thread));
    });
    list.append(more);
  }
  return list;
}

function dateOf(ms: number) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function usedAgo(lastUsed: number) {
  const minutes = Math.floor((Date.now() - lastUsed) / 60_000);
  if (minutes < 1) return t('さっき使用');
  if (minutes < 60) return t('{0}分前に使用', { 0: minutes });
  return t('{0}時間前に使用', { 0: Math.floor(minutes / 60) });
}

function bigHex(tab: Tab) {
  const hex = el('div', 'preview-hex');
  if (tab.favicon) {
    const img = el('img');
    img.src = tab.favicon;
    img.alt = '';
    img.addEventListener('error', () => img.replaceWith(el('span', 'letter', initialOf(tab))), { once: true });
    hex.append(img);
  } else {
    hex.append(el('span', 'letter', initialOf(tab)));
  }
  return hex;
}

function pinButton(pin: { on: boolean; toggle(): void }) {
  const b = button(pin.on ? t('📌 固定中') : t('📌 固定'), () => pin.toggle());
  b.classList.toggle('on', pin.on);
  b.title = pin.on ? t('固定を外す。マウスを乗せたセルで、カードが替わるようになります') : t('押しているあいだ、ほかのセルにマウスを乗せても、このカードのままです。起動し直すと外れます');
  b.setAttribute('aria-pressed', String(pin.on));
  return b;
}

function citedBlock(items: { id: string; title: string }[], open: (id: string) => void) {
  const wrap = el('div', 'preview-cited');
  const n = items.length;
  if (n === 1) {
    const b = button(t('このページから引用したメモ 1件'), () => open(items[0].id));
    b.classList.add('preview-cited-btn');
    b.title = t('そのメモを、下の区画で開く');
    wrap.append(b);
    return wrap;
  }
  const menu = el('div', 'preview-cited-menu');
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  const b = button(t('このページから引用したメモ {0}件', { 0: n }), () => {
    menu.hidden = !menu.hidden;
    b.setAttribute('aria-expanded', String(!menu.hidden));
  });
  b.classList.add('preview-cited-btn');
  b.title = t('下の区画で開くメモを選びます');
  b.setAttribute('aria-haspopup', 'menu');
  b.setAttribute('aria-expanded', 'false');
  for (const item of items) {
    const row = button(item.title || t('（空のメモ）'), () => {
      menu.hidden = true;
      b.setAttribute('aria-expanded', 'false');
      open(item.id);
    });
    row.classList.add('preview-cited-item');
    row.title = t('このメモを、下の区画で開く');
    menu.append(row);
  }
  wrap.append(b, menu);
  return wrap;
}

function button(label: string, onClick: () => void) {
  const b = el('button', 'preview-button', label);
  b.addEventListener('click', onClick);
  return b;
}
