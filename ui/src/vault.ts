// データ置き場：AI の相棒との会話（見たままの画像＋文字のデータ）と、相棒が作ったもの（返事・考察のメモ・情報収集・単語帳の案）を残す
//   ・持ち主は右サイドバー（置き場の区画は右のメモの区画のすぐ下）。左からは relay の vaultAdd で頼む
//   ・保存先：ui-data\vault\index.json（目次）・vault\items\<id>.json（文字のデータ）・vault\img\<id>-<n>.png（会話の画像。C++ が撮って書く）
//   ・数や大きさの上限は設けない（区画に、おおよその使っている大きさを出す）
import { t as tr } from './i18n';
import { request, send } from './bridge';
import { deleteData, readData, writeData } from './data';
import { normalizeTags } from './tags';

export type VaultKind = 'conversation' | 'reply' | 'memo' | 'research' | 'vocab';

export const VAULT_KIND_LABELS: Record<VaultKind, string> = {
  conversation: tr('会話'),
  reply: tr('返事'),
  memo: tr('考察のメモ'),
  research: tr('情報収集'),
  vocab: tr('単語帳の案'),
};

// 会話の画像（1枚に収まらない長い会話は、上から順に何枚かに分ける）
export interface VaultImage {
  name: string; // vault/img/<id>-<n>.png
  width: number; // 画像の大きさ（ピクセル。目安）
  height: number;
  bytes: number;
}

// どこから来たか（あるものだけ）
export interface VaultSource {
  conversationId?: string;
  entryId?: number;
  speaker?: string; // 話したキャラ・書いたキャラの名前
  model?: string;
  members?: string[]; // 会話のメンバー
  pageTitle?: string;
  pageUrl?: string;
  memoId?: string;
  topic?: string; // 情報収集のトピック
}

export interface VaultItem {
  id: string;
  kind: VaultKind;
  title: string;
  preview: string; // 一覧に出す、はじめの数行
  createdAt: number; // 置き場に入れた時刻
  sourceAt?: number; // 元のもの（会話・返事・メモ）ができた時刻
  source: VaultSource;
  images: VaultImage[];
  capture?: 'full' | 'visible' | 'none'; // 会話の画像：全体／見えている範囲だけ（全体を撮れなかったとき）／撮れなかった
  textBytes: number;
  tags: string[];
  hexMemo?: { at: number; ok: boolean; message: string }; // 六角メモへ送った結果
}

// 文字のデータ（vault\items\<id>.json）
export interface VaultBody {
  version: 1;
  id: string;
  text: string; // 読める形の文字（六角メモへ送る・コピーするときもこれ）
  data?: unknown; // 元の形のデータ（会話の記録・情報収集の結果など）
}

// 新しく入れるもの
export interface VaultDraft {
  kind: VaultKind;
  title: string;
  text: string;
  data?: unknown;
  sourceAt?: number;
  source?: VaultSource;
  tags?: string[];
}

interface VaultIndex {
  version: 1;
  items: VaultItem[];
}

const INDEX = 'vault/index.json';
const PREVIEW_MAX = 160;

// 画像を UI の <img> で読むときの URL（C++ が ui-data\vault\ を、この仮のドメイン名で見せる）
export function vaultImageUrl(image: VaultImage): string {
  return `https://rockscells-vault.example/${image.name.replace(/^vault\//, '')}`;
}

export function newVaultId() {
  return `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function previewOf(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  return chars.length > PREVIEW_MAX ? `${chars.slice(0, PREVIEW_MAX).join('')}…` : flat;
}

const byteLength = (text: string) => new TextEncoder().encode(text).length;

export class VaultStore {
  private list: VaultItem[] = [];
  private loaded = false;
  private queue: Promise<unknown> = Promise.resolve(); // 目次の書き換えが重ならないように順番に
  private readonly listeners: (() => void)[] = [];
  usage: { bytes: number; files: number } | null = null; // 置き場のフォルダの大きさ（まだ測っていなければ null）
  readonly ready: Promise<void>;

  constructor() {
    this.ready = this.load();
  }

  get items(): readonly VaultItem[] {
    return this.list;
  }

  get isLoaded() {
    return this.loaded;
  }

  get(id: string) {
    return this.list.find((i) => i.id === id);
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private async load() {
    const saved = await readData<VaultIndex>(INDEX);
    this.list = saved && Array.isArray(saved.items) ? saved.items.filter(isItem).map(cleanItem) : [];
    this.loaded = true;
    this.emit();
    void this.refreshUsage();
  }

  private saveIndex(): Promise<unknown> {
    const snapshot: VaultIndex = { version: 1, items: [...this.list] };
    this.queue = this.queue.then(() => writeData(INDEX, snapshot));
    return this.queue;
  }

  // 新しく入れる。id は、画像を先に撮ったときはその id（画像の名前と合わせる）
  async add(draft: VaultDraft, extra: { id?: string; images?: VaultImage[]; capture?: VaultItem['capture'] } = {}): Promise<VaultItem | null> {
    await this.ready;
    const id = extra.id ?? newVaultId();
    const body: VaultBody = { version: 1, id, text: draft.text, ...(draft.data !== undefined ? { data: draft.data } : {}) };
    const json = JSON.stringify(body);
    if (!(await writeData(`vault/items/${id}.json`, body))) return null;
    const item: VaultItem = {
      id,
      kind: draft.kind,
      title: [...(draft.title.trim() || VAULT_KIND_LABELS[draft.kind])].slice(0, 80).join(''),
      preview: previewOf(draft.text),
      createdAt: Date.now(),
      ...(draft.sourceAt ? { sourceAt: draft.sourceAt } : {}),
      source: draft.source ?? {},
      images: extra.images ?? [],
      ...(extra.capture ? { capture: extra.capture } : {}),
      textBytes: byteLength(json),
      tags: normalizeTags(draft.tags ?? []),
    };
    this.list = [item, ...this.list];
    this.emit();
    await this.saveIndex();
    void this.refreshUsage();
    return item;
  }

  async update(id: string, patch: Partial<Pick<VaultItem, 'tags' | 'hexMemo' | 'title'>>) {
    const index = this.list.findIndex((i) => i.id === id);
    if (index < 0) return;
    const next = { ...this.list[index], ...patch };
    if (patch.tags) next.tags = normalizeTags(patch.tags);
    this.list = this.list.map((i, n) => (n === index ? next : i));
    this.emit();
    await this.saveIndex();
  }

  // タグを足す・外す（その時のタグに対して）
  changeTags(id: string, add: string[], remove: string[]) {
    const item = this.get(id);
    if (!item) return;
    const tags = [...item.tags.filter((t) => !remove.includes(t)), ...add.filter((t) => !item.tags.includes(t))];
    void this.update(id, { tags });
  }

  // 消す（画像・文字のデータ・目次から）
  async remove(id: string) {
    const item = this.get(id);
    if (!item) return;
    for (const image of item.images) send({ type: 'deleteVaultImage', name: image.name });
    deleteData(`vault/items/${id}.json`);
    this.list = this.list.filter((i) => i.id !== id);
    this.emit();
    await this.saveIndex();
    void this.refreshUsage();
  }

  async body(id: string): Promise<VaultBody | null> {
    const saved = await readData<VaultBody>(`vault/items/${id}.json`);
    return saved && typeof saved.text === 'string' ? saved : null;
  }

  async refreshUsage() {
    const reply = await request((requestId) => ({ type: 'vaultUsage', requestId }), 10_000);
    if (reply?.type !== 'vaultUsage') return;
    this.usage = { bytes: reply.bytes, files: reply.files };
    this.emit();
  }
}

function isItem(v: unknown): v is VaultItem {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(o.id) && typeof o.kind === 'string' && o.kind in VAULT_KIND_LABELS && typeof o.createdAt === 'number';
}

function cleanItem(v: VaultItem): VaultItem {
  return {
    ...v,
    title: typeof v.title === 'string' ? v.title : '',
    preview: typeof v.preview === 'string' ? v.preview : '',
    source: typeof v.source === 'object' && v.source !== null ? v.source : {},
    images: Array.isArray(v.images) ? v.images.filter((i) => typeof i?.name === 'string' && /^vault\/img\/[A-Za-z0-9_-]+\.(png|webp|jpg)$/.test(i.name)) : [],
    textBytes: typeof v.textBytes === 'number' ? v.textBytes : 0,
    tags: normalizeTags(v.tags),
  };
}

// おおよその大きさ（約 1.2 MB など）
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
