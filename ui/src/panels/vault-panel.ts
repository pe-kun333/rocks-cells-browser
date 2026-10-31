// データ置き場（右サイドバーの下のパネルの欄の中、メモの区画のすぐ下）
//   AI の相棒との会話（見たままの画像＋文字のデータ）と、相棒が作ったもの（返事・考察のメモ・情報収集・単語帳の案）の一覧
//   ・見出し：▾ でたたむ（覚えておく）・数・使っている大きさのおよそ・＋会話（今の会話を残す）・📂（フォルダを開く）
//   ・1件を押すと開く：画像・文字・タグ（右のタグのボタン）・六角メモへ・メモのセルとしてコピー・文字をコピー・消す（確かめてから）
import { t as tr } from '../i18n';
import { armConfirm } from '../confirm-arm';
import { type HexMemoTarget, sendToHexMemo } from '../integrations/hexmemo';
import { send } from '../bridge';
import type { HexMemoRecord, RelayCommand } from '../types';
import { el } from '../util';
import { tagColor } from '../tags';
import { captureFull, captureVisible } from '../vault-capture';
import { formatBytes, newVaultId, VAULT_KIND_LABELS, type VaultBody, type VaultDraft, type VaultItem, type VaultStore, vaultImageUrl } from '../vault';
import { tagArea, type TagPad } from './tag-pad';

// 今の会話（AI の相棒の画面から受け取る）
export interface ConversationSnapshot {
  id: string;
  title: string;
  busy: boolean; // 返事の途中
  members: string[];
  startedAt: number;
  width: number; // 会話の欄の幅（画像の幅）
  text: string; // 読める形の文字
  data: unknown; // 元の形（発言ごとの記録）
  render(): HTMLElement[]; // 会話の欄と同じ見た目で、全部の発言を描いたもの
  log: HTMLElement | null; // 今見えている会話の欄（全体を撮れなかったときの予備。会話を開いていなければ null）
}

export interface VaultPanelHost {
  store: VaultStore;
  conversation(): ConversationSnapshot | null;
  hexMemoTarget(): HexMemoTarget | null;
  askLeft(action: RelayCommand): void;
  tagPad: TagPad;
  toast(text: string): void;
}

const FOLD_KEY = 'honeycomb.vault.folded';
const FILTER_MAX = 12; // 絞り込みに出すタグの数

export class VaultPanel {
  readonly element = el('section', 'vault-panel');
  private readonly head = el('div', 'vault-head');
  private readonly status = el('div', 'vault-status');
  private readonly list = el('div', 'vault-list');
  private folded: boolean;
  private openId: string | null = null; // 開いている1件
  private confirmId: string | null = null; // 「消す」を確かめている1件
  private filter: string | null = null; // タグで絞り込み
  private saving = false; // 会話を画像にしている途中
  private readonly sending = new Set<string>(); // 六角メモへ送っている途中
  private readonly bodies = new Map<string, VaultBody | null>(); // 読んだ文字のデータ（null は読めなかった）
  private readonly fullText = new Set<string>(); // 文字を全部見せている
  private statusTimer = 0;
  private dirty = false; // 書いている途中で描き直しを待っている
  private viewer: HTMLElement | null = null;

  constructor(private readonly host: VaultPanelHost) {
    this.folded = loadFolded();
    this.element.setAttribute('aria-label', 'データ置き場');
    this.status.setAttribute('role', 'status');
    this.element.append(this.head, this.status, this.list);
    host.store.onChange(() => this.render());
    host.tagPad.onChange(() => this.render());
    // タグを書いている途中は描き直さない（書き終えて欄を離れたら描き直す）
    this.element.addEventListener('focusout', () => {
      window.setTimeout(() => {
        if (this.dirty && !this.writing()) this.render();
      }, 0);
    });
    this.render();
  }

  // ---------- 入れる ----------

  // 返事・メモ・情報収集などを入れる（ほかのパネル・左サイドバーから）。入れたら開いて見せる
  async add(draft: VaultDraft): Promise<boolean> {
    const item = await this.host.store.add(draft);
    if (!item) {
      this.say(tr('データ置き場に保存できませんでした'));
      return false;
    }
    this.reveal(item.id);
    this.say(tr('「{0}」をデータ置き場に入れました', { 0: item.title }));
    return true;
  }

  // 今の会話を、見たままの画像（全体）と文字のデータで残す
  async saveConversation() {
    if (this.saving) return;
    const snap = this.host.conversation();
    if (!snap) {
      this.say(tr('まだ会話がありません（相棒と話してから押してください）'));
      return;
    }
    if (snap.busy) {
      this.say(tr('相棒が話し終わってから、もう一度押してください'));
      return;
    }
    this.saving = true;
    this.say(tr('会話を画像にしています…（長い会話は何枚かに分けます）'), 0);
    this.render();
    try {
      const id = newVaultId();
      let capture: VaultItem['capture'] = 'full';
      let images = await captureFull(id, snap.width, snap.render(), captionOf(snap)).catch(() => null);
      if (!images && snap.log) {
        images = await captureVisible(id, snap.log).catch(() => null);
        capture = images ? 'visible' : 'none';
      } else if (!images) {
        capture = 'none';
      }
      const item = await this.host.store.add(
        {
          kind: 'conversation',
          title: snap.title,
          text: snap.text,
          data: snap.data,
          sourceAt: snap.startedAt,
          source: { conversationId: snap.id, members: snap.members },
        },
        { id, images: images ?? [], capture },
      );
      if (!item) {
        for (const image of images ?? []) send({ type: 'deleteVaultImage', name: image.name });
        this.say(tr('データ置き場に保存できませんでした'));
        return;
      }
      this.reveal(item.id);
      this.say(
        capture === 'full'
          ? tr('会話を残しました（画像 {0} 枚と文字のデータ）', { 0: item.images.length })
          : capture === 'visible'
            ? tr('会話の全体を画像にできなかったので、見えている範囲の画像と、全体の文字のデータを残しました')
            : tr('会話を画像にできなかったので、文字のデータだけを残しました'),
        8000,
      );
    } finally {
      this.saving = false;
      this.render();
    }
  }

  private onScreen(): boolean {
    const box = this.status.getBoundingClientRect();
    if (box.height === 0) return false;
    const scroller = this.element.closest('.panels-scroll');
    const view = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    return box.bottom > view.top && box.top < view.bottom;
  }

  // その行を開いて見せる（置き場に入れたとき・右の検索から）
  reveal(id: string) {
    this.openId = id;
    this.confirmId = null;
    this.filter = null;
    if (this.folded) this.setFolded(false);
    this.render();
    this.list.querySelector(`[data-vault="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  // ---------- 表示 ----------

  private writing() {
    const active = document.activeElement;
    return active instanceof HTMLElement && this.element.contains(active) && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement);
  }

  render() {
    if (this.writing()) {
      this.dirty = true;
      return;
    }
    this.dirty = false;
    const store = this.host.store;
    const items = store.items;
    this.element.classList.toggle('folded', this.folded);

    const fold = el('button', 'vault-fold', this.folded ? '▸' : '▾');
    fold.type = 'button';
    fold.title = this.folded ? tr('データ置き場を開く') : tr('データ置き場をたたむ');
    fold.setAttribute('aria-label', fold.title);
    fold.setAttribute('aria-expanded', String(!this.folded));
    fold.addEventListener('click', () => this.setFolded(!this.folded));
    const title = el('span', 'vault-title', tr('データ置き場'));
    const count = el('span', 'vault-count', store.isLoaded ? `${items.length}` : '…');
    count.title = tr('{0} 件', { 0: items.length });
    const usage = el('span', 'vault-usage', store.usage ? tr('約 {0}', { 0: formatBytes(store.usage.bytes) }) : '');
    usage.title = store.usage ? tr('画像と文字のデータ {0} ファイル・約 {1}（ui-data\\vault）', { 0: store.usage.files, 1: formatBytes(store.usage.bytes) }) : '';
    const add = el('button', 'vault-add', this.saving ? tr('保存中…') : tr('＋会話'));
    add.type = 'button';
    add.disabled = this.saving;
    add.title = tr('今の相棒との会話を、見たままの画像（全体）と文字のデータで残す');
    add.addEventListener('click', () => void this.saveConversation());
    const folder = el('button', 'vault-folder', '📂');
    folder.type = 'button';
    folder.title = tr('データ置き場のフォルダを開く（画像をほかのアプリで使うとき）');
    folder.setAttribute('aria-label', 'データ置き場のフォルダを開く');
    folder.addEventListener('click', () => send({ type: 'openVaultFolder' }));
    this.head.replaceChildren(fold, title, count, usage, add, folder);

    if (this.folded) {
      this.list.replaceChildren();
      return;
    }
    const parts: HTMLElement[] = [];
    const filters = this.filterRow(items);
    if (filters) parts.push(filters);
    const shown = this.filter ? items.filter((i) => i.tags.includes(this.filter ?? '')) : items;
    if (!store.isLoaded) parts.push(el('div', 'vault-empty', tr('読み込んでいます…')));
    else if (items.length === 0) {
      parts.push(
        el(
          'div',
          'vault-empty',
          tr('相棒との会話（＋会話）や、相棒の返事の「データ置き場へ」、相棒が残した考察のメモ・情報収集の結果・AI で作った単語帳の案を、ここに残せます'),
        ),
      );
    } else if (shown.length === 0) parts.push(el('div', 'vault-empty', tr('タグ「{0}」の付いたものはありません', { 0: this.filter })));
    for (const item of shown) parts.push(this.itemView(item));
    this.list.replaceChildren(...parts);
  }

  private filterRow(items: readonly VaultItem[]): HTMLElement | null {
    const counts = new Map<string, number>();
    for (const item of items) for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    if (counts.size === 0) {
      this.filter = null;
      return null;
    }
    if (this.filter && !counts.has(this.filter)) this.filter = null;
    const row = el('div', 'vault-filter');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'タグで絞り込む');
    const all = el('button', 'vault-filter-chip', tr('すべて'));
    all.type = 'button';
    all.setAttribute('aria-pressed', String(this.filter === null));
    all.addEventListener('click', () => {
      this.filter = null;
      this.render();
    });
    row.append(all);
    const tags = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja')).slice(0, FILTER_MAX);
    for (const [tag, n] of tags) {
      const chip = el('button', 'vault-filter-chip', `${tag} ${n}`);
      chip.type = 'button';
      chip.style.setProperty('--tag', tagColor(tag));
      chip.setAttribute('aria-pressed', String(this.filter === tag));
      chip.title = tr('タグ「{0}」の付いたものだけを出す', { 0: tag });
      chip.addEventListener('click', () => {
        this.filter = this.filter === tag ? null : tag;
        this.render();
      });
      row.append(chip);
    }
    return row;
  }

  private itemView(item: VaultItem): HTMLElement {
    const open = this.openId === item.id;
    const box = el('div', open ? 'vault-item open' : 'vault-item');
    box.dataset.vault = item.id;
    const row = el('button', 'vault-row');
    row.type = 'button';
    row.setAttribute('aria-expanded', String(open));
    row.title = item.preview;
    const kind = el('span', `vault-kind ${item.kind}`, VAULT_KIND_LABELS[item.kind]);
    const name = el('span', 'vault-name', item.title);
    const meta = el('span', 'vault-meta', `${dateTimeOf(item.createdAt)}${item.images.length > 0 ? tr('・🖼{0}', { 0: item.images.length }) : ''}`);
    row.append(kind, name, meta);
    row.addEventListener('click', () => {
      this.openId = open ? null : item.id;
      this.confirmId = null;
      this.render();
    });
    box.append(row);
    if (item.tags.length > 0 && !open) {
      const tags = el('div', 'vault-row-tags');
      for (const tag of item.tags.slice(0, 4)) {
        const chip = el('span', 'tag-chip', tag);
        chip.style.setProperty('--tag', tagColor(tag));
        tags.append(chip);
      }
      box.append(tags);
    }
    if (open) box.append(this.detail(item));
    return box;
  }

  private detail(item: VaultItem): HTMLElement {
    const box = el('div', 'vault-detail');
    // 画像（会話）：1枚目を小さく。押すと全部を大きく見る
    if (item.images.length > 0) {
      const thumb = el('button', 'vault-thumb');
      thumb.type = 'button';
      thumb.title = tr('画像を大きく見る');
      const img = el('img');
      img.src = vaultImageUrl(item.images[0]);
      img.alt = tr('{0} の画像（1枚目）', { 0: item.title });
      img.loading = 'lazy';
      thumb.append(img);
      if (item.images.length > 1) thumb.append(el('span', 'vault-thumb-count', tr('全 {0} 枚', { 0: item.images.length })));
      thumb.addEventListener('click', () => this.openViewer(item));
      box.append(thumb);
    }
    if (item.kind === 'conversation' && item.capture && item.capture !== 'full') {
      box.append(el('div', 'vault-note', item.capture === 'visible' ? tr('画像は見えていた範囲だけです（全体を撮れませんでした）') : tr('画像はありません（撮れませんでした）。文字のデータは全体です')));
    }
    const info = [
      item.source.members?.length ? tr('メンバー：{0}', { 0: item.source.members.join('・') }) : '',
      item.source.speaker && item.kind !== 'conversation' ? `${item.source.speaker}` : '',
      item.source.topic ? tr('トピック：{0}', { 0: item.source.topic }) : '',
      item.source.pageTitle ? tr('ページ：{0}', { 0: item.source.pageTitle }) : '',
      item.sourceAt ? tr('元：{0}', { 0: dateTimeOf(item.sourceAt) }) : '',
      tr('保存：{0}', { 0: dateTimeOf(item.createdAt) }),
      tr('約 {0}', { 0: formatBytes(item.textBytes + item.images.reduce((s, i) => s + i.bytes, 0)) }),
    ].filter(Boolean);
    box.append(el('div', 'vault-info', info.join(tr('・'))));

    // 文字のデータ（はじめは数行。「全部見る」で全部）
    const body = this.bodies.get(item.id);
    if (body === undefined) {
      box.append(el('div', 'vault-text loading', tr('読んでいます…')));
      void this.host.store.body(item.id).then((b) => {
        this.bodies.set(item.id, b);
        this.render();
      });
    } else if (body === null) {
      box.append(el('div', 'vault-text', tr('文字のデータを読めませんでした')));
    } else {
      const full = this.fullText.has(item.id);
      const text = el('div', full ? 'vault-text full' : 'vault-text', body.text);
      box.append(text);
      if (body.text.length > 200) {
        const more = el('button', 'vault-link', full ? tr('たたむ') : tr('全部見る'));
        more.type = 'button';
        more.addEventListener('click', () => {
          if (full) this.fullText.delete(item.id);
          else this.fullText.add(item.id);
          this.render();
        });
        box.append(more);
      }
    }

    // タグ（右のタグのボタンと同じ欄）
    box.append(
      tagArea(
        { tags: item.tags, what: tr('この項目'), change: (add, remove) => this.host.store.changeTags(item.id, add, remove) },
        { editable: true, pad: this.host.tagPad, focusKey: `vault${item.id}:`, toast: (t) => this.say(t) },
      ),
    );

    if (item.hexMemo) box.append(el('div', item.hexMemo.ok ? 'vault-note' : 'vault-note failed', item.hexMemo.message));

    const actions = el('div', 'vault-actions');
    const sending = this.sending.has(item.id);
    const hex = button(sending ? tr('送っています…') : tr('六角メモへ'), tr('六角メモの送り先のノートへ送る（送り先は相棒の ⚙ で選ぶ。画像は送らず、文字とタグだけ）'), () => void this.sendToHexMemo(item));
    hex.disabled = sending;
    const cell = button(tr('メモのセルとしてコピー'), tr('文字をメモのセル1つとしてコピーする（左の盤面の空いたセルで Ctrl+V。六角メモにも貼れます）'), () => void this.copyAsCell(item));
    const copy = button(tr('文字をコピー'), tr('文字のデータをクリップボードへ'), () => void this.copyText(item));
    actions.append(hex, cell, copy);
    if (item.images.length > 0) actions.append(button(tr('画像を見る'), tr('画像を大きく見る'), () => this.openViewer(item)));
    const remove = button(tr('消す'), tr('この項目を消す（確かめてから消します）'), () => {
      this.confirmId = item.id;
      this.render();
      this.list.querySelector<HTMLElement>(`[data-vault="${item.id}"] .vault-confirm .danger`)?.focus();
    });
    actions.append(remove);
    box.append(actions);
    if (this.confirmId === item.id) box.append(this.confirmBox(item));
    return box;
  }

  private confirmBox(item: VaultItem): HTMLElement {
    const box = el('div', 'vault-confirm');
    box.setAttribute('role', 'alertdialog');
    const what = item.images.length > 0 ? tr('画像 {0} 枚と文字のデータ', { 0: item.images.length }) : tr('文字のデータ');
    box.append(el('div', '', tr('「{0}」を消します。{1}も消え、元に戻せません。', { 0: item.title, 1: what })));
    const row = el('div', 'vault-actions');
    const yes = button(tr('消す'), tr('この項目を消す'), () => {
      this.confirmId = null;
      if (this.openId === item.id) this.openId = null;
      this.bodies.delete(item.id);
      void this.host.store.remove(item.id).then(() => this.say(tr('「{0}」を消しました', { 0: item.title })));
    });
    yes.classList.add('danger');
    const no = button(tr('やめる'), tr('消さない'), () => {
      this.confirmId = null;
      this.render();
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.confirmId = null;
        this.render();
      }
    });
    row.append(yes, no);
    box.append(row);
    // 確かめの枠の外を押す・Esc は「やめる」と同じ
    armConfirm(box, () => {
      this.confirmId = null;
      this.render();
    });
    return box;
  }

  // ---------- 送る・コピー ----------

  private async textOf(item: VaultItem): Promise<string | null> {
    const cached = this.bodies.get(item.id);
    const body = cached ?? (await this.host.store.body(item.id));
    this.bodies.set(item.id, body);
    return body?.text ?? null;
  }

  private async sendToHexMemo(item: VaultItem) {
    const target = this.host.hexMemoTarget();
    if (!target) {
      this.say(tr('相棒の ⚙ で「六角メモの送り先」を選んでから、もう一度押してください'), 8000);
      return;
    }
    const text = await this.textOf(item);
    if (text === null) {
      this.say(tr('文字のデータを読めませんでした'));
      return;
    }
    const record: HexMemoRecord = {
      text: `${item.title}\n\n${text}`,
      createdAt: new Date(item.sourceAt ?? item.createdAt).toISOString(),
      tags: [...new Set([...item.tags, tr('データ置き場'), VAULT_KIND_LABELS[item.kind]])],
    };
    if (item.source.pageUrl && /^https?:\/\//i.test(item.source.pageUrl)) record.urls = [{ url: item.source.pageUrl, title: item.source.pageTitle }];
    this.sending.add(item.id);
    this.render();
    try {
      const outcome = await sendToHexMemo(target, [record]);
      const message = !outcome.ok ? tr('六角メモへ送れませんでした：{0}', { 0: outcome.error }) : 'pending' in outcome ? outcome.message : tr('六角メモ「{0}」に送りました', { 0: outcome.where || target.label });
      await this.host.store.update(item.id, { hexMemo: { at: Date.now(), ok: outcome.ok, message } });
      this.say(message, 8000);
    } finally {
      this.sending.delete(item.id);
      this.render();
    }
  }

  private async copyAsCell(item: VaultItem) {
    const text = await this.textOf(item);
    if (text === null) return this.say(tr('文字のデータを読めませんでした'));
    this.host.askLeft({ command: 'copyMemoCell', text: `${item.title}\n\n${text}`, label: tr('データ置き場の文字') });
    this.say(tr('メモのセル1つとしてコピーしました（左の盤面の空いたセルで Ctrl+V・六角メモにも貼れます）'));
  }

  private async copyText(item: VaultItem) {
    const text = await this.textOf(item);
    if (text === null) return this.say(tr('文字のデータを読めませんでした'));
    const ok = await navigator.clipboard.writeText(text).then(
      () => true,
      () => false,
    );
    this.say(ok ? tr('文字をコピーしました') : tr('コピーできませんでした'));
  }

  // ---------- 画像を大きく見る ----------

  private openViewer(item: VaultItem) {
    this.closeViewer();
    const viewer = el('div', 'vault-viewer');
    viewer.setAttribute('role', 'dialog');
    viewer.setAttribute('aria-label', `${item.title} の画像`);
    const bar = el('div', 'vault-viewer-bar');
    const close = el('button', 'vault-viewer-close', '×');
    close.type = 'button';
    close.title = tr('閉じる（Esc）');
    close.setAttribute('aria-label', '閉じる');
    close.addEventListener('click', () => this.closeViewer());
    bar.append(el('span', 'vault-viewer-title', tr('{0}（{1} 枚）', { 0: item.title, 1: item.images.length })), close);
    const pages = el('div', 'vault-viewer-pages');
    for (const [n, image] of item.images.entries()) {
      const img = el('img');
      img.src = vaultImageUrl(image);
      img.alt = tr('{0} 枚目', { 0: n + 1 });
      pages.append(img);
    }
    viewer.append(bar, pages);
    viewer.tabIndex = -1;
    viewer.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.closeViewer();
      }
    });
    document.body.append(viewer);
    this.viewer = viewer;
    close.focus();
  }

  private closeViewer() {
    this.viewer?.remove();
    this.viewer = null;
  }

  // ---------- 小さな道具 ----------

  // 上のタグから開く（右クリックの登録先）。たたむボタンは、これまでどおり見出しの ▾
  get header() {
    return this.head;
  }

  isCollapsed() {
    return this.folded;
  }

  expand() {
    if (this.folded) this.setFolded(false);
  }

  private setFolded(folded: boolean) {
    this.folded = folded;
    saveFolded(folded);
    this.render();
  }

  private say(text: string, ms = 5000) {
    this.status.textContent = text;
    // 区画は下のパネルの欄（スクロールする）の中にあるので、見えていないときは右のお知らせでも知らせる
    if (!this.onScreen()) this.host.toast(text);
    window.clearTimeout(this.statusTimer);
    if (ms > 0) this.statusTimer = window.setTimeout(() => (this.status.textContent = ''), ms);
  }
}

// 会話の画像のいちばん上に付ける見出し（題名・メンバー・保存した日時）
function captionOf(snap: ConversationSnapshot): HTMLElement {
  const box = el('div', 'vault-export-caption');
  box.append(el('strong', '', snap.title), el('span', '', tr('{0}・{1} から・{2} に保存', { 0: snap.members.join('・'), 1: dateTimeOf(snap.startedAt), 2: dateTimeOf(Date.now()) })));
  return box;
}

function button(label: string, title: string, run: () => void) {
  const b = el('button', 'ai-small', label);
  b.type = 'button';
  b.title = title;
  b.addEventListener('click', run);
  return b;
}

function dateTimeOf(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function loadFolded(): boolean {
  try {
    return localStorage.getItem(FOLD_KEY) === 'folded';
  } catch {
    return false;
  }
}

function saveFolded(folded: boolean) {
  try {
    localStorage.setItem(FOLD_KEY, folded ? 'folded' : 'open');
  } catch {
    // 保存できなくても動作は続ける
  }
}
