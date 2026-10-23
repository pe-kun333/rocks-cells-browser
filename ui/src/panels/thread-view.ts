// コメントのスレッドの見た目（X のポストへの返信のように）。メモのセルのカードと、タブのメモの下に出す
//   ・元のポストの下に「💬 返信の数・コメントを追加・コピー・相棒 ▾」、返信ごとに「💬・返信・コピー・相棒 ▾・×」
//   ・返信は何段でもつながる。段ごとに展開・たたむ（元のポストへの返信は、はじめから開いている）
//   ・カードは何度も描き直すので、開閉・書きかけの返信は、ここに覚えておく
//   ・開閉などで見た目を変えるときは、カードの持ち主に描き直してもらう（refresh）。書いている間は描き直しが
//     止まるので、手元の古い返信の一覧から作り直すと、その間に届いた返信が抜けてしまう
import { armConfirm } from '../confirm-arm';
import { CHARACTER_IDS, type CharacterId, HAIKU_UNIT_NAME, isHaiku, nameOf, parseCast, slotsOf, teamOf } from '../ai/characters';
import { childrenOf, countUnder, MAX_REPLIES, MAX_REPLY_TEXT, pathTo, type PendingReply, quoteFragmentUrl, quoteSourceLabel, REPLY_FOLD, type Reply, type ThreadRef, threadKey } from '../threads';
import { el } from '../util';

export interface ThreadActions {
  add(ref: ThreadRef, parent: string | null, text: string): void;
  remove(ref: ThreadRef, replyId: string): void;
  copy(ref: ThreadRef, replyId: string | null): void; // null は元のポスト（下の返信も一緒に）
  ai(ref: ThreadRef, parent: string | null, who: string): void; // 相棒に返信してもらう（who：キャラ・all）
  edit(ref: ThreadRef, replyId: string, text: string): void; // 使う人の返信を書き直す（メモのスレッドだけ。K5）
}

export interface ThreadUi {
  actions: ThreadActions;
  pending: readonly PendingReply[]; // AI が書いている途中
  refresh(): void; // カードを、今の台帳から描き直す
  shot?(id: string): string | undefined; // 画像の data URL（左は MemoStore.image、右は readData。まだなら undefined）
  openSource?(url: string, fragmentUrl: string): void; // 引用元を開く
}

const MAX_INDENT = 3; // これより深い段は字下げしない（「↳ 〇〇へ」と出す）
const collapsedRoots = new Set<string>(); // たたんだスレッド（元のポストへの返信）
const expanded = new Set<string>(); // 開いた返信（その下の返信を見せる）
const openTexts = new Set<string>(); // 全文を開いた長い返信
const openQuotes = new Set<string>(); // 全文を開いた長い引用
const drafts = new Map<string, string>(); // 書きかけの返信（開いている欄）
const edits = new Map<string, string>(); // 書き直しの途中（描き直しても消さない）
const aiMenus = new Set<string>(); // 開いている「相棒 ▾」

const nodeKey = (key: string, id: string | null) => `${key}|${id ?? 'root'}`;
const isLong = (text: string) => text.length > 110 || text.split('\n').length > 4;

// はじめて見せるスレッドを、たたんでおく（右の「メモ」の区画のように、いくつも並べるとき）。そのあと開いた・閉じたは、そのまま
const seenRoots = new Set<string>();
export function collapseOnce(ref: ThreadRef) {
  const key = threadKey(ref);
  if (seenRoots.has(key)) return;
  seenRoots.add(key);
  collapsedRoots.add(key);
}

// コメントのカードから、返信の欄・相棒のメニューを開くための印
export function replyFormKey(ref: ThreadRef, parent: string | null) {
  return nodeKey(threadKey(ref), parent);
}

export function repliesOpen(ref: ThreadRef, parent: string) {
  return expanded.has(nodeKey(threadKey(ref), parent));
}

// カードの「💬」：そのカードの下の返信を開く・たたむ（開いたかどうかを返す）
export function toggleReplies(ref: ThreadRef, parent: string) {
  const key = nodeKey(threadKey(ref), parent);
  if (expanded.has(key)) expanded.delete(key);
  else expanded.add(key);
  return expanded.has(key);
}

export function showReplyForm(ref: ThreadRef, parent: string) {
  const formKey = nodeKey(threadKey(ref), parent);
  if (!drafts.has(formKey)) drafts.set(formKey, '');
  aiMenus.delete(formKey);
}

export function hideReplyForm(ref: ThreadRef, parent: string) {
  const formKey = nodeKey(threadKey(ref), parent);
  drafts.delete(formKey);
  aiMenus.delete(formKey);
}

export function replyDraft(ref: ThreadRef, parent: string) {
  return drafts.get(nodeKey(threadKey(ref), parent));
}

export function toggleCompanion(ref: ThreadRef, parent: string) {
  const formKey = nodeKey(threadKey(ref), parent);
  if (aiMenus.has(formKey)) aiMenus.delete(formKey);
  else aiMenus.add(formKey);
  return aiMenus.has(formKey);
}

// 描き直す直前に、今の欄の文を覚えておく（届いた写しで書きかけを消さない）
export function rememberField(kind: 'form' | 'edit', key: string, value: string) {
  if (kind === 'form') drafts.set(key, value);
  else edits.set(key, value);
}

// カードの下に出す返信（今の返信の部品。開いていれば木、書きかけと相棒のメニューはいつも）
export function cardThread(ref: ThreadRef, replies: readonly Reply[], parent: string, ui: ThreadUi): HTMLElement {
  const box = el('div', 'thread memo-card-thread');
  const open = expanded.has(nodeKey(threadKey(ref), parent));
  const waiting = pendingRows(threadKey(ref), parent, ui);
  if (open) {
    const list = el('div', 'thread-replies');
    for (const child of childrenOf(replies, parent)) list.append(replyNode(ref, replies, child, 1, ui));
    if (list.childElementCount > 0) box.append(list);
  }
  box.append(...waiting, ...openPanels(ref, parent, ui));
  return box;
}

// その返信（null は元のポスト）の下を開く（返信を足したとき・相棒に頼んだとき）
export function expandFor(ref: ThreadRef, parent: string | null) {
  const key = threadKey(ref);
  if (parent === null) collapsedRoots.delete(key);
  else expanded.add(nodeKey(key, parent));
}

// 書きかけがあるか（返信の欄に字がある・返信の書き直しの途中）。下の区画が、右の検索から別のメモを開いてよいかを決めるのに使う
export function hasDrafts(ref: ThreadRef): boolean {
  const head = `${threadKey(ref)}|`;
  for (const [key, value] of drafts) if (key.startsWith(head) && value.trim() !== '') return true;
  for (const key of edits.keys()) if (key.startsWith(head)) return true;
  return false;
}

// その返信まで木を開き、長い文なら全文を開いておく（右の検索から、そのカードへ移るとき）
export function revealReply(ref: ThreadRef, replies: readonly Reply[], id: string): void {
  const key = threadKey(ref);
  const path = pathTo(replies, id);
  const target = path[path.length - 1];
  if (!target || target.id !== id) return;
  for (const above of path.slice(0, -1)) expanded.add(nodeKey(key, above.id));
  if (isLong(target.text)) openTexts.add(nodeKey(key, id));
}

// 見た目の状態を変えたあと、カードを描き直してもらう（書く欄にいたら先に離れる。押したボタンに戻る）
function redraw(ui: ThreadUi, focusKey?: string) {
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement && active.closest('.thread')) active.blur();
  ui.refresh();
  if (focusKey) document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus();
}

// 元のポストの下に出す、スレッドのかたまり（操作の列・書く欄・返信の一覧）
//   compact：ポップアップ用（返信の数だけ）
export function threadBlock(ref: ThreadRef, replies: readonly Reply[], ui: ThreadUi | undefined, compact = false): HTMLElement {
  const key = threadKey(ref);
  const block = el('div', 'thread');
  block.dataset.thread = key;
  const count = replies.length;
  if (compact || !ui) {
    if (count > 0) block.append(el('div', 'thread-count', `💬 返信 ${count}件`));
    return block;
  }
  const open = !collapsedRoots.has(key);
  const bar = el('div', 'thread-bar post');
  if (count > 0) {
    const toggleKey = `${nodeKey(key, null)}|toggle`;
    const toggle = action(open ? `💬 ${count} ▴` : `💬 ${count} ▾`, toggleKey, () => {
      if (open) collapsedRoots.add(key);
      else collapsedRoots.delete(key);
      redraw(ui, toggleKey);
    });
    toggle.classList.add('thread-toggle');
    toggle.title = open ? '返信をたたむ' : `返信 ${count}件を見る`;
    toggle.setAttribute('aria-expanded', String(open));
    bar.append(toggle);
  }
  bar.append(...commonActions(ref, null, ui, 'コメントを追加', replies.length));
  block.append(bar, ...openPanels(ref, null, ui));
  if (open) {
    const list = el('div', 'thread-replies');
    for (const reply of childrenOf(replies, null)) list.append(replyNode(ref, replies, reply, 1, ui));
    list.append(...pendingRows(key, null, ui));
    if (list.childElementCount > 0) block.append(list);
  } else if (ui.pending.some((p) => p.key === key)) {
    block.append(el('div', 'reply pending', '相棒が返信を書いています…'));
  }
  return block;
}

// 引用（文があるときだけ枠。文が無ければ撮り元・リンクの行だけ）と、画像
function quoteBits(reply: Reply, ui: ThreadUi): HTMLElement[] {
  const quote = reply.quote;
  if (!quote) return [];
  const nodes: HTMLElement[] = [];
  if (quote.text) {
    const textKey = `quote|${reply.id}`;
    const long = quote.text.split('\n').length > 4 || [...quote.text].length > 160;
    const block = el('div', 'reply-quote', quote.text);
    if (long && openQuotes.has(textKey)) block.classList.add('open');
    nodes.push(block);
    if (long) {
      const more = el('button', 'preview-note-toggle', openQuotes.has(textKey) ? 'たたむ ▴' : '…続き ▾');
      more.type = 'button';
      more.addEventListener('click', () => {
        if (openQuotes.has(textKey)) openQuotes.delete(textKey);
        else openQuotes.add(textKey);
        block.classList.toggle('open', openQuotes.has(textKey));
        more.textContent = openQuotes.has(textKey) ? 'たたむ ▴' : '…続き ▾';
      });
      nodes.push(more);
    }
  }
  const label = quoteSourceLabel(quote);
  if (ui.openSource) {
    const src = el('button', 'reply-source', label);
    src.type = 'button';
    src.title = 'この文の所を開く';
    src.addEventListener('click', () => ui.openSource?.(quote.url, quoteFragmentUrl(quote.url, quote.text)));
    nodes.push(src);
  } else {
    nodes.push(el('div', 'reply-source', label));
  }
  return nodes;
}

function shotImage(src: string): HTMLImageElement {
  const img = el('img', 'reply-shot');
  img.src = src;
  img.alt = 'カードの画像';
  return img;
}

// 返信1つ（その下の返信も、開いていれば）
function replyNode(ref: ThreadRef, replies: readonly Reply[], reply: Reply, depth: number, ui: ThreadUi): HTMLElement {
  const key = threadKey(ref);
  const node = el('div', 'reply');
  node.dataset.reply = reply.id;

  const head = el('div', 'reply-head');
  const who = reply.by?.who ?? 'user';
  // 取り込んだカード（by.who が import。memo-interchange.ts）は使う人の色にしない（灰色の印）
  const avatar = CHARACTER_IDS.includes(who as CharacterId) ? who : who === 'import' ? 'import' : 'user';
  head.append(el('span', `reply-avatar ${avatar}`), el('span', 'reply-name', reply.by ? reply.by.name : 'あなた'));
  // 字下げしない深い段では、だれへの返信かを出す
  if (depth > MAX_INDENT && reply.parent) {
    const parent = replies.find((r) => r.id === reply.parent);
    if (parent) head.append(el('span', 'reply-to', `↳ ${parent.by ? parent.by.name : 'あなた'}へ`));
  }
  head.append(el('time', 'reply-time', dateOf(reply.createdAt)));
  if (reply.editedAt) head.append(el('span', 'reply-edited', '書き直し済み'));
  if (reply.by) {
    const cost = reply.by.cost ? `・約 $${reply.by.cost.toFixed(3)}` : '';
    head.title = reply.by.who === 'import' ? `${reply.by.name}（取り込んだファイルのカード）` : `${reply.by.name}（AI の相棒${reply.by.model ? `・${reply.by.model}` : ''}${cost}）`;
  }
  const editKey = nodeKey(key, reply.id);
  node.append(head, ...quoteBits(reply, ui));
  if (edits.has(editKey)) {
    node.append(editForm(ref, reply, ui));
  } else if (reply.text) {
    const body = el('div', 'reply-body', reply.text);
    node.append(body);
    if (isLong(reply.text)) {
      // 全文の開閉は、この返信の中だけで済む（描き直さない）
      const textKey = nodeKey(key, reply.id);
      const flip = () => {
        if (openTexts.has(textKey)) openTexts.delete(textKey);
        else openTexts.add(textKey);
        body.classList.toggle('open', openTexts.has(textKey));
        more.textContent = openTexts.has(textKey) ? 'たたむ ▴' : '続きを読む ▾';
      };
      const more = el('button', 'preview-note-toggle', openTexts.has(textKey) ? 'たたむ ▴' : '続きを読む ▾');
      more.type = 'button';
      body.classList.add('clickable');
      body.classList.toggle('open', openTexts.has(textKey));
      body.addEventListener('click', () => {
        if (!getSelection()?.toString()) flip(); // 文字を選んでいるときは開閉しない（コピーできるように）
      });
      more.addEventListener('click', flip);
      node.append(more);
    }
  }
  const shot = reply.image ? ui.shot?.(reply.image) : undefined;
  if (reply.image) node.append(shot ? shotImage(shot) : el('div', 'reply-shot-wait', '画像'));

  const children = childrenOf(replies, reply.id);
  const isOpen = expanded.has(nodeKey(key, reply.id));
  const bar = el('div', 'thread-bar');
  if (children.length > 0) {
    const total = countUnder(replies, reply.id);
    const toggleKey = `${nodeKey(key, reply.id)}|toggle`;
    const toggle = action(isOpen ? `💬 ${total} ▴` : `💬 ${total} ▾`, toggleKey, () => {
      if (isOpen) expanded.delete(nodeKey(key, reply.id));
      else expanded.add(nodeKey(key, reply.id));
      redraw(ui, toggleKey);
    });
    toggle.classList.add('thread-toggle');
    toggle.title = isOpen ? '返信をたたむ' : `返信 ${total}件を見る`;
    toggle.setAttribute('aria-expanded', String(isOpen));
    bar.append(toggle);
  }
  // 使う人の返信だけ書き直せる（メモのスレッド。タブのメモは、この計画では断る。K5）
  if (!edits.has(editKey) && ref.kind === 'memo' && !reply.by) {
    const edit = action('書き直す', `${editKey}|edit`, () => {
      if (!edits.has(editKey)) edits.set(editKey, reply.text);
      redraw(ui);
      document.querySelector<HTMLTextAreaElement>(`[data-edit="${CSS.escape(editKey)}"] textarea`)?.focus();
    });
    edit.title = 'このコメントの文を書き直す（引用と画像は書き直せません）';
    bar.append(edit);
  }
  bar.append(...commonActions(ref, reply.id, ui, '返信', replies.length));
  const below = countUnder(replies, reply.id);
  const label = below > 0 ? `この返信を消す（その下の返信 ${below} 件も消えます）` : 'この返信を消す';
  const remove = action('×', undefined, () => {
    if (!remove.classList.contains('danger')) {
      // 1回目は確かめるだけ（読み上げにも伝わるように、名前も変える）
      armConfirm(remove);
      const armed = below > 0 ? `もう一度押すと、この返信とその下の返信 ${below} 件を消します` : 'もう一度押すと、この返信を消します';
      remove.classList.add('danger');
      remove.textContent = '消す？';
      remove.title = armed;
      remove.setAttribute('aria-label', armed);
      return;
    }
    ui.actions.remove(ref, reply.id);
  });
  remove.classList.add('reply-remove');
  remove.title = label;
  remove.setAttribute('aria-label', label);
  bar.append(remove);
  node.append(bar, ...openPanels(ref, reply.id, ui));

  const waiting = pendingRows(key, reply.id, ui);
  if (isOpen || waiting.length > 0) {
    const list = el('div', depth >= MAX_INDENT ? 'thread-replies flat' : 'thread-replies');
    if (isOpen) for (const child of children) list.append(replyNode(ref, replies, child, depth + 1, ui));
    list.append(...waiting);
    if (list.childElementCount > 0) node.append(list);
  }
  return node;
}

// 元のポストと返信に共通のボタン：返信を書く・コピー・相棒に返信してもらう
function commonActions(ref: ThreadRef, target: string | null, ui: ThreadUi, writeLabel: string, total: number): HTMLElement[] {
  const formKey = nodeKey(threadKey(ref), target);
  const full = total >= MAX_REPLIES;
  const write = action(writeLabel, `${formKey}|write`, () => {
    if (!drafts.has(formKey)) drafts.set(formKey, '');
    aiMenus.delete(formKey);
    redraw(ui);
    // 描き直したあとの欄に入る
    document.querySelector<HTMLTextAreaElement>(`[data-form="${CSS.escape(formKey)}"] textarea`)?.focus();
  });
  write.disabled = full;
  write.title = full ? `返信は1つのスレッドに ${MAX_REPLIES} 件までです` : target === null ? 'このコメントに返信を書く' : 'この返信に返信を書く';
  const copy = action('コピー', undefined, () => ui.actions.copy(ref, target));
  copy.title = '盤面の空いたセルに貼ると（Ctrl+V・右クリック →「貼り付け」）、メモのセルになります（下の返信も一緒に）';
  const aiKey = `${formKey}|ai`;
  const ai = action('相棒 ▾', aiKey, () => {
    if (aiMenus.has(formKey)) aiMenus.delete(formKey);
    else aiMenus.add(formKey);
    redraw(ui, aiKey);
  });
  ai.disabled = full;
  ai.title = '相棒（今の会話のメンバー）に返信してもらう';
  ai.setAttribute('aria-expanded', String(aiMenus.has(formKey)));
  return [write, copy, ai];
}

// 開いている「返信を書く欄」と「相棒 ▾」
function openPanels(ref: ThreadRef, target: string | null, ui: ThreadUi): HTMLElement[] {
  const formKey = nodeKey(threadKey(ref), target);
  const out: HTMLElement[] = [];
  if (aiMenus.has(formKey)) out.push(aiMenu(ref, target, ui));
  if (drafts.has(formKey)) out.push(replyForm(ref, target, ui));
  return out;
}

// 返信の文を、その場で書き直す（Ctrl+Enter で残す・Esc でやめる）。引用と画像は変えない
function editForm(ref: ThreadRef, reply: Reply, ui: ThreadUi): HTMLElement {
  const editKey = nodeKey(threadKey(ref), reply.id);
  const form = el('form', 'reply-form');
  form.dataset.edit = editKey;
  const text = el('textarea', 'reply-input');
  text.rows = 3;
  text.value = edits.get(editKey) ?? reply.text;
  text.setAttribute('aria-label', 'コメントを書き直す');
  const meter = el('span', 'reply-meter', '');
  const paintMeter = () => {
    const n = [...text.value].length;
    meter.textContent = `${n} / ${REPLY_FOLD}`;
    meter.classList.toggle('long', n > REPLY_FOLD);
    meter.title = n > REPLY_FOLD ? '長め：カードでは 280字まで見せて、続きは開きます' : '';
  };
  paintMeter();
  const close = () => {
    edits.delete(editKey);
    redraw(ui, `${editKey}|edit`);
  };
  const save = () => {
    const clean = [...text.value].slice(0, MAX_REPLY_TEXT).join('').trim();
    if (!clean && !reply.quote && !reply.image) {
      text.focus();
      return;
    }
    edits.delete(editKey);
    text.blur();
    form.remove();
    ui.actions.edit(ref, reply.id, text.value);
    ui.refresh();
  };
  text.addEventListener('input', () => {
    if ([...text.value].length > MAX_REPLY_TEXT) text.value = [...text.value].slice(0, MAX_REPLY_TEXT).join('');
    edits.set(editKey, text.value);
    paintMeter();
  });
  text.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
      e.preventDefault();
      save();
    }
    if (e.key === 'Escape' && !e.isComposing) {
      e.preventDefault();
      close();
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    save();
  });
  const send = el('button', 'preview-button', '残す');
  send.type = 'submit';
  const cancel = el('button', 'preview-button', 'やめる');
  cancel.type = 'button';
  cancel.addEventListener('click', close);
  const row = el('div', 'reply-form-row');
  row.append(meter, send, cancel);
  form.append(text, row);
  return form;
}

function replyForm(ref: ThreadRef, target: string | null, ui: ThreadUi): HTMLElement {
  const formKey = nodeKey(threadKey(ref), target);
  const form = el('form', 'reply-form');
  form.dataset.form = formKey;
  const text = el('textarea', 'reply-input');
  text.rows = 2;
  text.maxLength = 2000;
  text.value = drafts.get(formKey) ?? '';
  text.placeholder = target === null ? 'コメントを書く（Ctrl+Enter で追加・Esc でやめる）' : '返信を書く（Ctrl+Enter で返信・Esc でやめる）';
  text.setAttribute('aria-label', target === null ? 'コメントを書く' : '返信を書く');
  const send = el('button', 'preview-button', target === null ? '追加する' : '返信する');
  send.type = 'submit';
  const cancel = el('button', 'preview-button', 'やめる');
  cancel.type = 'button';
  const close = () => {
    drafts.delete(formKey);
    redraw(ui, `${formKey}|write`);
  };
  cancel.addEventListener('click', close);
  text.addEventListener('input', () => drafts.set(formKey, text.value));
  text.addEventListener('keydown', (e) => {
    e.stopPropagation(); // 盤面のキー（Ctrl+C・V・Esc）に取られないように
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) form.requestSubmit();
    if (e.key === 'Escape') close();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = text.value.trim();
    if (!value) {
      text.focus();
      return;
    }
    drafts.delete(formKey);
    expandFor(ref, target);
    text.blur(); // 先に欄を離れる（書いている間は、カードを描き直さないので）
    form.remove();
    ui.actions.add(ref, target, value);
    ui.refresh(); // 返信が足せなかったとき（右サイドバーから頼んだとき）も、今の台帳で描き直す
  });
  const row = el('div', 'reply-form-row');
  row.append(send, cancel);
  form.append(text, row);
  return form;
}

// 相棒（今の会話のメンバー）を選んで、返信してもらう
function aiMenu(ref: ThreadRef, target: string | null, ui: ThreadUi): HTMLElement {
  const formKey = nodeKey(threadKey(ref), target);
  const menu = el('div', 'reply-ai-menu');
  menu.setAttribute('role', 'group');
  menu.setAttribute('aria-label', '返信してもらう相棒');
  for (const choice of aiChoices()) {
    const b = el('button', `reply-ai-choice ${choice.who}`, choice.name);
    b.type = 'button';
    b.addEventListener('click', () => {
      aiMenus.delete(formKey);
      expandFor(ref, target);
      ui.actions.ai(ref, target, choice.who);
      redraw(ui, `${formKey}|ai`);
    });
    menu.append(b);
  }
  const cancel = el('button', 'reply-ai-choice cancel', 'やめる');
  cancel.type = 'button';
  cancel.addEventListener('click', () => {
    aiMenus.delete(formKey);
    redraw(ui, `${formKey}|ai`);
  });
  menu.append(cancel);
  return menu;
}

// 今の会話のメンバー（右の相棒の設定から）。2枠以上なら「みんな」も。
// ハイク組は「ハイク組」の1つ（会話と同じく、3体までは全員、4体からは代表か最初の班が返信する）
export function aiChoices(): { who: string; name: string }[] {
  let saved: Record<string, unknown> = {};
  try {
    const raw: unknown = JSON.parse(localStorage.getItem('honeycomb.ai') ?? '{}');
    if (typeof raw === 'object' && raw !== null) saved = raw as Record<string, unknown>;
  } catch {
    // 読めなければ Claude だけ
  }
  const cast = parseCast(saved);
  const team = teamOf(cast.members);
  const list: { who: string; name: string }[] = cast.members.filter((id) => !isHaiku(id)).map((id) => ({ who: id, name: nameOf(cast, id) }));
  if (team.length > 0) list.push({ who: 'team', name: HAIKU_UNIT_NAME });
  if (slotsOf(cast.members) > 1) list.push({ who: 'all', name: list.length === 2 && team.length === 0 ? '二人とも' : 'みんな' });
  return list;
}

function pendingRows(key: string, parent: string | null, ui: ThreadUi): HTMLElement[] {
  return ui.pending
    .filter((p) => p.key === key && p.parent === parent)
    .map((p) => {
      const row = el('div', 'reply pending');
      row.append(el('span', `reply-avatar ${CHARACTER_IDS.includes(p.who as CharacterId) ? p.who : 'main'}`), el('span', '', `${p.name}が返信を書いています…`));
      return row;
    });
}

// focusKey：描き直したあと、同じボタンに戻るための印
function action(label: string, focusKey: string | undefined, onClick: () => void) {
  const b = el('button', 'thread-action', label);
  b.type = 'button';
  if (focusKey) b.dataset.focusKey = focusKey;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

function dateOf(ms: number) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
