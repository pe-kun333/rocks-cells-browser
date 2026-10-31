// メモのセル：盤面に置く、ページではないセル（文章・タグ・♥。六角形スクショの画像も持てる）
//   ・タブと同じ盤面・同じ座標に置く。WebView を持たないので軽く、眠らせることもない
//   ・保存先：ui-data\memocells.json（画像は ui-data\shots\<ID>.json に data URL で）
//   ・持ち主は左サイドバー
//   ・シートへの入口も、メモのセルの一種（portal に行き先のシート。text は入口のコメント、image は入口の画像）
//   ・ボットのセルも、メモのセルの一種（bot にボットの id。名前とリンクの id は台帳 ui-data\bots\index.json（bots.ts）。
//     text はセルのコメント、image はセルの画像）。入口とボットは同じセルに付けない
//   ・アプリのセルも、メモのセルの一種（app にアプリの id。名前とファイルは台帳 ui-data\apps.json（apps.ts））。
//     入口・ボットが付いているセルでは app は残さない
//   ・撮ったもののセルも、メモのセルの一種（capture に撮影の id。画像は ui-data\captures\<id>.json。
//     入口・ボット・アプリとは同じセルに付けない。返信・スクショ・元のページは持たない。version は 1 のまま）
import { isAppId } from './apps';
import { isBotId } from './bots';
import { isCaptureId } from './captures';
import { readData, readDataChecked, writeData } from './data';
import { type Hex, hexKey, nearestFree } from './hex';
import { type LikeLevel, likeLevel } from './likes';
import { parseLinkSetId } from './link-name-sets';
import { changeLinkList, type LinkKindNames, parseLinkKindNames } from './memo-card-links';
import { sendCards, type SendMode } from './memo-card-send';
import { buildPasteDraft, type PasteIdsProblem, pasteIdsProblem, parseTemplate } from './memo-card-templates';
import { isSheetId, MAIN_SHEET } from './sheets';
import { visibleTags } from './grok-cards-tags';
import { changeTagList, normalizeTags } from './tags';
import { parseAuthor, parseReplies, type Reply, type ReplyAuthor, type ReplyExtra, samePage, topSlots, withEdit, withMovedTop, withoutReply, withoutTopOrder, withPackedTops, withPlacedTop, withReply } from './threads';

export interface MemoCell {
  id: string;
  sheet: string; // 置いてあるシート
  pos: Hex; // シートの中の位置
  portal?: string; // シートへの入口なら、行き先のシート
  bot?: string; // ボットのセルなら、ボットの id（台帳 bots\index.json の id。返信・AI の相棒の印・スクショの元のページは持たない）
  app?: string; // アプリのセルなら、アプリの id（台帳 apps.json の id。入口・ボットとは同じセルに付けない）
  capture?: string; // 撮ったもののセルなら、撮影の id（台帳 captures.json。入口・ボット・アプリとは同じセルに付けない）
  text: string;
  tags: string[];
  liked: number; // ♥ の段階（0〜3）
  island: string | null;
  image?: string; // 画像（六角形スクショ）の ID。中身は shots\<ID>.json
  source?: { url: string; title: string }; // スクショを撮ったページなど
  replies?: Reply[]; // コメントのスレッド（メモの文章への返信。何段でもつながる）
  by?: ReplyAuthor; // AI の相棒が残したものなら、書いたキャラ（無ければ使う人のメモ）
  label?: string; // AI の相棒が残したものの種類（考察・レター。無ければ考察）
  linkNames?: LinkKindNames; // 試し：このメモだけの関連の種類の名前（変えたものだけ。呼称セットを選んでいるあいだは、画面では使わない）
  linkSet?: string; // 試し：このメモが使う呼称セットの id（台帳は link-name-sets.json。全部のメモで共通）。無ければ linkNames
  createdAt: number;
  updatedAt: number;
}

// 右サイドバーの「メモ」の区画に送る、右のメモのセルの写し（台帳は左が持つ）
export interface RightMemo {
  id: string;
  pos: Hex;
  text: string;
  createdAt: number;
  replies: Reply[];
  tags: string[];
  by?: ReplyAuthor; // AI の相棒が残したもの
  label?: string;
  image?: boolean; // 画像のメモ（六角形スクショ）
  portal?: string; // シートへの入口（一覧には出さない）
  bot?: string; // ボットのセル（ボットの id）
  app?: string; // アプリのセル（アプリの id）
  capture?: string; // 撮ったもののセル（撮影の id）
}

export function toRightMemo(m: MemoCell): RightMemo {
  return {
    id: m.id,
    pos: { ...m.pos },
    text: m.text,
    createdAt: m.createdAt,
    replies: m.replies ?? [],
    tags: [...m.tags],
    ...(m.by ? { by: m.by, ...(m.label ? { label: m.label } : {}) } : {}),
    ...(m.image ? { image: true } : {}),
    ...(m.portal ? { portal: m.portal } : {}),
    ...(m.bot ? { bot: m.bot } : {}),
    ...(m.app ? { app: m.app } : {}),
    ...(m.capture ? { capture: m.capture } : {}),
  };
}

// 特別なセル（シートへの入口・ボットのセル・アプリのセル・撮ったもの）か。ふつうのメモと違い、コピー・セット・六角メモへ送るものに入れない
//   右の写し（RightMemo）でも使えるよう、portal と bot と app と capture だけを見る
export const isSpecialCell = (m: { portal?: string; bot?: string; app?: string; capture?: string }) => Boolean(m.portal || m.bot || m.app || m.capture);

// 右サイドバーの「タグごとの一覧」に送る、メモのセルの短い写し（すべてのシートのもの。入口は除く）
export interface MemoIndexItem {
  id: string;
  sheet: string;
  title: string; // 1行目（40文字まで）
  tags: string[];
  createdAt: number;
  updatedAt: number;
  image?: boolean; // 画像のメモ（六角形スクショ）
  imageId?: string; // その画像の id（shots の id。単語カードが指すため。K6）
  by?: string; // AI の相棒が残したものなら、書いたキャラの名前
  liked?: LikeLevel; // いいね（1〜3）。無ければ 0。古い写しにも、この項目が無くてよい
}

// このページの URL を、引用か撮り元（quote.url）に持つメモ。特別なセルは数えない。新しい順
export function memosCitingPage(list: readonly MemoCell[], pageUrl: string): { id: string; title: string }[] {
  if (!pageUrl) return [];
  return list
    .filter((m) => !isSpecialCell(m) && (m.replies ?? []).some((r) => r.quote && samePage(r.quote.url, pageUrl)))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((m) => ({ id: m.id, title: memoTitle(m) || '（空のメモ）' }));
}

export function toMemoIndexItem(m: MemoCell): MemoIndexItem {
  const liked = likeLevel(m.liked);
  return {
    id: m.id,
    sheet: m.sheet,
    title: memoTitle(m, 40) || (m.image ? '（画像のメモ）' : '（空のメモ）'),
    tags: visibleTags(m.tags),
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    ...(m.image ? { image: true, imageId: m.image } : {}), // imageId：単語カードが画像を指すため（K6）
    ...(m.by ? { by: m.by.name } : {}),
    ...(liked ? { liked } : {}),
  };
}

export type MemoDraft = Pick<MemoCell, 'pos' | 'text'> &
  Partial<Pick<MemoCell, 'tags' | 'liked' | 'island' | 'image' | 'source' | 'replies' | 'by' | 'label' | 'sheet' | 'portal' | 'bot' | 'app' | 'capture'>>;

// カードを別のメモへ送った直後に、元へ戻すための控え（メモリーだけ。台帳には書かない）
interface SendUndo {
  token: string;
  fromId: string | null; // 型の貼り付けは、元のメモが無い（null。元は触らない）
  toId: string;
  created: boolean;
  fromReplies: Reply[] | null;
  toReplies: Reply[];
  fromUpdated: number;
  toUpdated: number;
  fromAfter: string | null;
  toAfter: string;
}

export type SendRepliesResult =
  | { ok: true; toId: string; created: boolean; token: string; tops: number; cut: number; kept: number; added: number; name?: string } // name：型を貼ったときの型の名前
  | { ok: false; why: 'ledger' | 'from' | 'to' | 'same' | 'place' | 'full-memos' | 'empty' | 'missing' | 'full' | 'invalid' | 'ids'; room?: number; need?: number; idsWhy?: PasteIdsProblem }; // ids：呼び出し側が決めた id が使えない（型を貼るときだけ。B3-2a）

// 送る入力：別のメモのカード（from・replyIds）か、型（template。貼り先 toId は今開いているメモ。元のメモは無い）
export type SendRepliesInput =
  | { fromId: string; replyIds: readonly string[]; toId: string | null; mode: SendMode; create?: MemoDraft }
  | { template: unknown; toId: string; ids?: readonly string[] }; // ids：貼る新しいカードの id を呼び出し側が決めたいとき（B3-2a。型のカードと同じ順・同じ数。省略すると今までどおり）

const replyFingerprint = (replies: readonly Reply[] | undefined) => JSON.stringify(replies ?? []);

// 削除の取り消し（B3-3a。restoreReplies）：removeReply に undoToken が付いたとき、消す直前の返信全体を控える（メモリだけ。ファイルには書かない）
export const RESTORE_TOKEN_RE = /^u[A-Za-z0-9_-]{0,63}$/; // u で始まる 64 字以内。区画から来るので形を検査する
export const RESTORE_MAX_ENTRIES = 50; // 控えは 50 件まで（古い順に捨てる）
export const RESTORE_MAX_CHARS = 4_000_000; // 控えの文字数（返信全体の JSON の長さの合計）の上限。超えたら古い順に捨てる
export const isRestoreToken = (token: unknown): token is string => typeof token === 'string' && RESTORE_TOKEN_RE.test(token);

interface RestoreEntry {
  token: string;
  memoId: string;
  before: string; // 消す直前の返信全体の JSON（replyFingerprint と同じ書き方。戻すときに読み直す）
  after: string; // 消した直後の返信全体の指紋
  size: number; // before と after の文字数の合計
}

export type RestoreRepliesResult = { ok: true; count: number } | { ok: false; why: 'ledger' | 'none' | 'stale' }; // count：戻したあとの返信の数

const FILE = 'memocells.json';
const BACKUP = 'memocells-before-memo-split.json'; // 書き直す・引用・画像を初めて書く前の写し（1回だけ）。前の名前 memocells.before-memo-split.json は C++ の名前の検査に通らず、書けていなかった
const CARD_TAGS_BACKUP = 'memocells-before-card-tags.json'; // カードのタグを初めて書く前の写し（1回だけ。依頼②）
const CARD_LINKS_BACKUP = 'memocells-before-card-links.json'; // カードの関連を初めて書く前の写し（1回だけ。plan-memo-card-links の L1）
const CARD_ORDER_BACKUP = 'memocells-before-card-order.json'; // カードの並びを初めて書く前の写し（1回だけ。plan-memo-card-order の O1）
const CARD_SEND_BACKUP = 'memocells-before-card-send.json'; // カードを別のメモへ初めて送る前の写し（1回だけ）
const MAX_MEMOS = 2000;
const LOAD_RETRY_MS = 3000; // AR0：台帳を読めなかったときの読み直しまでの間
export const MAX_MEMO_TEXT = 5000;

export const newMemoId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export class MemoStore {
  private memos = new Map<string, MemoCell>();
  private readonly listeners: (() => void)[] = [];
  private loaded = false; // 読み込みを終えた（読めなかったときも。ready）
  private writable = false; // 台帳に書いてよい（読めた・ファイルが無かった。AR0：読めなかったら書かない）
  private failed = false; // 読み直しても読めなかった（AR0。書かない）
  private saveTimer = 0;
  private loadState: 'ok' | 'missing' | 'unreadable' = 'unreadable'; // 読めた／ファイルが無い（初めて）／あるのに読めない・返事が無い・知らない版
  private readonly backupTasks = new Map<string, Promise<void>>(); // 写しの名前 → 書き終えるまで（もうあれば書かない）
  private sendUndo: SendUndo | null = null; // 直前に送ったカードを元へ戻すための、送る前の返信（1 件だけ）
  private restoreLog: RestoreEntry[] = []; // 削除の取り消しの控え（古い順。50 件・約 400 万字まで。メモリだけ。B3-3a）
  private readonly images = new Map<string, string>(); // 画像の ID → data URL（読み込んだもの）
  private readonly loading = new Set<string>();
  // 今見ているシート（左サイドバーが決める）
  sheetNow: () => string = () => MAIN_SHEET;

  async load() {
    // 「本当に無い」と「あるのに読めない」を分ける（写しは、読めたときだけ作る）
    //   AR0：読めなかったら 3 秒後に 1 回だけ読み直す。それでも読めなければ、この起動では台帳に書かない（空で上書きしない）
    let read = await this.readLedger();
    if (read === 'unreadable') {
      await new Promise((resolve) => window.setTimeout(resolve, LOAD_RETRY_MS));
      read = await this.readLedger();
    }
    this.loadState = read === 'unreadable' ? 'unreadable' : read === 'missing' ? 'missing' : 'ok';
    const early = [...this.memos.values()]; // 読み込みを待つ間に足したメモ
    if (read !== 'unreadable' && read !== 'missing') {
      // 待つ間に足したメモは残す。読んだメモと場所が重なったものだけ、同じシートの近くの空いたセルへ動かす
      this.memos.clear();
      for (const memo of read) this.memos.set(memo.id, memo);
      for (const memo of early) {
        if (this.memos.has(memo.id) || this.memos.size >= MAX_MEMOS) continue;
        const pos = this.at(memo.pos, memo.sheet) ? nearestFree(memo.pos, (h) => !!this.at(h, memo.sheet)) : memo.pos;
        this.memos.set(memo.id, { ...memo, pos });
      }
    }
    this.failed = read === 'unreadable';
    this.writable = !this.failed;
    this.loaded = true;
    this.emit();
    if (this.writable && early.length > 0) this.changed(); // 待つ間に足したメモを書く
  }

  // 台帳を 1 回読む：読めたメモ・missing（ファイルが無い）・unreadable（返事が無い・壊れている・知らない版）
  private async readLedger(): Promise<MemoCell[] | 'missing' | 'unreadable'> {
    const read = await readDataChecked<{ version?: unknown; memos?: unknown }>(FILE);
    if (read.status === 'missing') return 'missing';
    if (read.status === 'failed') return 'unreadable';
    const saved = read.value;
    if (!saved || typeof saved !== 'object' || saved.version !== 1 || !Array.isArray(saved.memos)) return 'unreadable';
    const out: MemoCell[] = [];
    for (const raw of saved.memos) {
      const memo = parseMemo(raw);
      if (memo) out.push(memo);
    }
    return out;
  }

  // アーカイブから戻す（AR1）：parseMemo で確かめ、id と時刻を保ったまま足す。保存は最後に 1 回だけ予約する
  //   位置が埋まっていれば relocate があればその位置へ（入口の置き直し）、無ければ飛ばす。id が既にある・上限を超えるものも飛ばす
  //   約束：上限と衝突は、呼ぶ側（AR3 の戻す流れ）が足す前に全部確かめる。ここで飛ばすのは、その検査をすり抜けた分だけ
  restore(raws: readonly unknown[], relocate?: (memo: MemoCell) => Hex | null): { restored: MemoCell[]; skipped: number } {
    const restored: MemoCell[] = [];
    let skipped = 0;
    if (!this.writable) return { restored, skipped: raws.length };
    for (const raw of raws) {
      const memo = parseMemo(raw);
      if (!memo || this.memos.has(memo.id) || this.memos.size >= MAX_MEMOS) {
        skipped++;
        continue;
      }
      let pos: Hex | null = memo.pos;
      if (this.at(pos, memo.sheet)) pos = relocate ? relocate(memo) : null;
      if (!pos || this.at(pos, memo.sheet)) {
        skipped++;
        continue;
      }
      const cell = { ...memo, pos: { q: pos.q, r: pos.r } };
      this.memos.set(cell.id, cell);
      restored.push(cell);
    }
    if (restored.length > 0) this.changed();
    return { restored, skipped };
  }

  // 台帳に書ける（読み込みを終え、読めなかったのでもない。アーカイブ・戻すの条件）
  get writableLedger() {
    return this.writable;
  }

  // 読み直しても台帳を読めなかった（この起動では書かない）
  get loadFailed() {
    return this.failed;
  }

  get ready() {
    return this.loaded;
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  list(): MemoCell[] {
    return [...this.memos.values()];
  }

  get(id: string | null | undefined) {
    return id ? this.memos.get(id) : undefined;
  }

  // そのシートのメモのセル
  inSheet(sheet: string): MemoCell[] {
    return this.list().filter((m) => m.sheet === sheet);
  }

  at(pos: Hex, sheet = this.sheetNow()) {
    const key = hexKey(pos);
    return this.list().find((m) => m.sheet === sheet && hexKey(m.pos) === key);
  }

  add(draft: MemoDraft): MemoCell | null {
    const sheet = draft.sheet || this.sheetNow();
    if (this.memos.size >= MAX_MEMOS || this.at(draft.pos, sheet)) return null;
    const now = Date.now();
    // ボットのセル・アプリのセル・撮ったもの：id の形を確かめる。入口とは同じセルに付けない。返信・相棒の印・元のページは持たない
    const bot = !draft.portal && isBotId(draft.bot) ? draft.bot : undefined;
    const app = !draft.portal && !bot && isAppId(draft.app) ? draft.app : undefined;
    const capture = !draft.portal && !bot && !app && isCaptureId(draft.capture) ? draft.capture : undefined;
    const plain = !bot && !app && !capture;
    const memo: MemoCell = {
      id: newMemoId(),
      sheet,
      pos: { ...draft.pos },
      ...(draft.portal ? { portal: draft.portal } : {}),
      ...(bot ? { bot } : {}),
      ...(app ? { app } : {}),
      ...(capture ? { capture } : {}),
      text: cleanText(draft.text),
      tags: normalizeTags(capture ? [] : (draft.tags ?? [])),
      liked: capture ? 0 : clampLiked(draft.liked ?? 0),
      island: capture ? null : (draft.island ?? null),
      ...(!capture && draft.image ? { image: draft.image } : {}),
      source: plain ? draft.source : undefined,
      ...(plain && draft.replies?.length ? { replies: parseReplies(draft.replies) } : {}),
      ...(plain && draft.by ? { by: { who: draft.by.who, name: draft.by.name }, ...(draft.label ? { label: cleanLabel(draft.label) } : {}) } : {}),
      createdAt: now,
      updatedAt: now,
    };
    this.memos.set(memo.id, memo);
    this.changed();
    return memo;
  }

  // image：null で外す
  update(id: string, patch: Partial<Pick<MemoCell, 'text' | 'tags' | 'liked' | 'island'>> & { image?: string | null }) {
    const memo = this.memos.get(id);
    if (!memo) return;
    if (patch.text !== undefined) memo.text = cleanText(patch.text);
    if (patch.image !== undefined) {
      if (patch.image) memo.image = patch.image;
      else delete memo.image;
    }
    if (patch.tags !== undefined) memo.tags = normalizeTags(patch.tags);
    if (patch.liked !== undefined) memo.liked = clampLiked(patch.liked);
    if (patch.island !== undefined) memo.island = patch.island;
    memo.updatedAt = Date.now();
    this.changed();
  }

  // コメントのスレッドに返信を足す（足した返信を返す。足せなければ null）
  //   extra：引用・画像・書き出したファイル（付けるのは M3・M4。形が合うものだけ残る）
  //   replyId：id を決めたいとき（B2-3a。省略すると今までどおり）。形が合わない・このメモにもう同じ id があるときは足さない（null）
  addReply(id: string, parent: string | null, text: string, by?: ReplyAuthor, extra?: ReplyExtra, replyId?: string): Reply | null {
    const memo = this.memos.get(id);
    if (!memo || memo.bot || memo.app || memo.capture) return null; // ボット・アプリ・撮ったものは返信を持たない
    const next = withReply(memo.replies ?? [], parent, text, by, extra, replyId);
    if (!next) return null;
    // 引用・画像を初めて書く前に、今の中身を1回だけ写す（第5.4節）
    if (next.reply.quote || next.reply.image) this.backupOnce(BACKUP);
    memo.replies = next.replies;
    this.changed();
    return next.reply;
  }

  // 使う人の返信の文を書き直す（相棒の返信・空の文で引用も画像も無いときは false）
  editReply(id: string, replyId: string, text: string): boolean {
    const memo = this.memos.get(id);
    if (!memo || isSpecialCell(memo) || !memo.replies) return false;
    const next = withEdit(memo.replies, replyId, text);
    if (!next) return false;
    this.backupOnce(BACKUP); // 書き直す印（editedAt）を初めて書く前の写し
    memo.replies = next;
    this.changed();
    return true;
  }

  // カードのタグを足す・外す（一番上のカードだけ。メモの updatedAt は変えない。初めて書く前に 1 回だけ写す）
  //   changed：変えた／same：変わらない／refused：断った（台帳を読めなかった起動・無いメモ・特別なセル・無いカード・一番上でないカード）
  //   over：1 つに 10 個までを超えた分を捨てた
  changeReplyTags(id: string, replyId: string, add: readonly unknown[], remove: readonly unknown[]): { result: 'changed' | 'same' | 'refused'; over: boolean } {
    // 読めなかった台帳に新しい項目を書いて、前の中身を上書きしないように
    if (!this.loaded || this.loadState === 'unreadable') return { result: 'refused', over: false };
    const memo = this.memos.get(id);
    if (!memo || isSpecialCell(memo)) return { result: 'refused', over: false };
    const reply = memo.replies?.find((r) => r.id === replyId);
    if (!reply || reply.parent !== null) return { result: 'refused', over: false };
    const done = changeTagList(reply.tags ?? [], add, remove);
    const tags = done.tags;
    if (!tags) return { result: 'same', over: done.over };
    this.backupOnce(CARD_TAGS_BACKUP);
    memo.replies = (memo.replies ?? []).map((r) => {
      if (r.id !== replyId) return r;
      const { tags: _old, ...rest } = r; // タグが空になったら項目ごと消す
      return tags.length > 0 ? { ...rest, tags } : rest;
    });
    this.changed();
    return { result: 'changed', over: done.over };
  }

  // カードの関連を足す・外す（元は一番上のカードだけ。メモの updatedAt は変えない。初めて書く前に 1 回だけ写す）
  //   changed・same・refused はタグと同じ。over：10 本を超えた分を捨てた。refusedLinks：結べなかった相手の数（相手が一番上のカードに無い・自分・逆向きの「同じ」がある）
  changeReplyLinks(
    id: string,
    replyId: string,
    add: readonly unknown[],
    remove: readonly unknown[],
  ): { result: 'changed' | 'same' | 'refused'; over: boolean; refusedLinks: number } {
    const refused = { result: 'refused' as const, over: false, refusedLinks: 0 };
    if (!this.loaded || this.loadState === 'unreadable') return refused;
    const memo = this.memos.get(id);
    if (!memo || isSpecialCell(memo)) return refused;
    const replies = memo.replies ?? [];
    const reply = replies.find((r) => r.id === replyId);
    if (!reply || reply.parent !== null) return refused;
    const tops = new Map(replies.filter((r) => r.parent === null).map((r) => [r.id, r]));
    const done = changeLinkList(reply.links ?? [], add, remove, (to, kind) => {
      const other = tops.get(to);
      if (!other || to === replyId) return false;
      return kind !== 'same' || !(other.links ?? []).some((l) => l.to === replyId && l.kind === 'same');
    });
    const links = done.links;
    if (!links) return { result: 'same', over: done.over, refusedLinks: done.refused };
    this.backupOnce(CARD_LINKS_BACKUP);
    memo.replies = replies.map((r) => {
      if (r.id !== replyId) return r;
      const { links: _old, ...rest } = r; // 関連が無くなったら項目ごと消す
      return links.length > 0 ? { ...rest, links } : rest;
    });
    this.changed();
    return { result: 'changed', over: done.over, refusedLinks: done.refused };
  }

  // 一番上のカードを、一番上のカード before の前へ（null は最後へ）動かす（並べた順。動かすたびに全部振り直す。
  //   メモの updatedAt は変えない。初めて書く前に 1 回だけ写す）
  //   changed・same（並びが変わらない）・refused はタグと同じ。why：断った理由（ledger＝台帳を読めていない／card＝カードが見つからない）
  moveReply(id: string, replyId: string, before: string | null): { result: 'changed' | 'same' | 'refused'; why?: 'ledger' | 'card' } {
    if (!this.loaded || this.loadState === 'unreadable') return { result: 'refused', why: 'ledger' };
    const memo = this.memos.get(id);
    if (!memo || isSpecialCell(memo)) return { result: 'refused', why: 'card' };
    const replies = memo.replies ?? [];
    const isTop = (rid: string) => replies.some((r) => r.id === rid && r.parent === null);
    if (!isTop(replyId) || before === replyId || (before !== null && !isTop(before))) return { result: 'refused', why: 'card' };
    const next = withMovedTop(replies, replyId, before);
    if (!next) return { result: 'same' };
    this.backupOnce(CARD_ORDER_BACKUP);
    memo.replies = next;
    this.changed();
    return { result: 'changed' };
  }

  // 試し：一番上のカード replyId を、空いた番地 slot（行 × 3 ＋ 列）に置く。埋まっている・置けない番地なら refused（card）
  placeReply(id: string, replyId: string, slot: number): { result: 'changed' | 'same' | 'refused'; why?: 'ledger' | 'card' } {
    if (!this.loaded || this.loadState === 'unreadable') return { result: 'refused', why: 'ledger' };
    const memo = this.memos.get(id);
    if (!memo || isSpecialCell(memo)) return { result: 'refused', why: 'card' };
    const replies = memo.replies ?? [];
    const slots = topSlots(replies);
    if (!slots.has(replyId)) return { result: 'refused', why: 'card' };
    if (slots.get(replyId) === slot) return { result: 'same' };
    const next = withPlacedTop(replies, replyId, slot);
    if (!next) return { result: 'refused', why: 'card' };
    this.backupOnce(CARD_ORDER_BACKUP);
    memo.replies = next;
    this.changed();
    return { result: 'changed' };
  }

  // 試し：カードの空きを詰める（並べた順のまま）。空きが無ければ same
  packReplies(id: string): { result: 'changed' | 'same' | 'refused'; why?: 'ledger' | 'card' } {
    if (!this.loaded || this.loadState === 'unreadable') return { result: 'refused', why: 'ledger' };
    const memo = this.memos.get(id);
    if (!memo || isSpecialCell(memo)) return { result: 'refused', why: 'card' };
    const next = withPackedTops(memo.replies ?? []);
    if (!next) return { result: 'same' };
    this.backupOnce(CARD_ORDER_BACKUP);
    memo.replies = next;
    this.changed();
    return { result: 'changed' };
  }

  // 試し：このメモの関連の種類の名前を置き換える（names が undefined なら元の名前に戻す。updatedAt は変えない）
  setLinkNames(id: string, names: unknown): boolean {
    const memo = this.memos.get(id);
    if (!memo || isSpecialCell(memo)) return false;
    const next = parseLinkKindNames(names);
    if (next) memo.linkNames = next;
    else delete memo.linkNames;
    this.changed();
    return true;
  }

  // 試し：このメモが使う呼称セット（setId が null や空なら外す。壊れた id は断る。updatedAt は変えない）
  //   台帳にそのセットがあるかは、ここでは見ない（台帳は下の区画が持つ）
  setLinkSet(id: string, setId: unknown): boolean {
    const memo = this.memos.get(id);
    if (!memo || isSpecialCell(memo)) return false;
    const clearing = setId === null || setId === undefined || setId === '';
    const next = clearing ? undefined : parseLinkSetId(setId);
    if (!clearing && !next) return false;
    if (memo.linkSet === next) return true;
    if (next) memo.linkSet = next;
    else delete memo.linkSet;
    this.changed();
    return true;
  }

  // 試し：呼称セットを消したとき、その id を使っていたメモ全部から外す（updatedAt は変えない）
  clearLinkSet(setId: unknown): boolean {
    const id = parseLinkSetId(setId);
    if (!id) return false;
    let changed = false;
    for (const memo of this.memos.values()) {
      if (memo.linkSet !== id) continue;
      delete memo.linkSet;
      changed = true;
    }
    if (changed) this.changed();
    return true;
  }

  // 並べた順を消す（作った順に戻す。メモの updatedAt は変えない。初めて書く前に 1 回だけ写す）。rank が一つも無ければ same
  resetReplyOrder(id: string): { result: 'changed' | 'same' | 'refused'; why?: 'ledger' | 'card' } {
    if (!this.loaded || this.loadState === 'unreadable') return { result: 'refused', why: 'ledger' };
    const memo = this.memos.get(id);
    if (!memo || isSpecialCell(memo)) return { result: 'refused', why: 'card' };
    const next = withoutTopOrder(memo.replies ?? []);
    if (!next) return { result: 'same' };
    this.backupOnce(CARD_ORDER_BACKUP);
    memo.replies = next;
    this.changed();
    return { result: 'changed' };
  }

  // 一番上のカードを、別のメモへ移す・写す（下の返信も一緒。保存は 1 回。初めて送る前に 1 回だけ写す）
  //   toId が null のときは create の場所に空のメモを作り、そこへ入れる（作れなければ、元のメモは変えない）
  //   断ったときは何も書かない。成功したら、直前の送りを 1 件だけ覚えて undoSend で戻せる
  sendReplies(input: SendRepliesInput): SendRepliesResult {
    if ('template' in input) return this.pasteTemplate(input.template, input.toId, input.ids);
    if (!this.loaded || this.loadState === 'unreadable') return { ok: false, why: 'ledger' };
    const from = this.memos.get(input.fromId);
    if (!from || isSpecialCell(from)) return { ok: false, why: 'from' };
    let to: MemoCell | undefined;
    let created = false;
    if (input.toId === null) {
      const draft = input.create;
      if (!draft) return { ok: false, why: 'place' };
      if (this.memos.size >= MAX_MEMOS) return { ok: false, why: 'full-memos' };
      const sheet = draft.sheet || this.sheetNow();
      if (this.at(draft.pos, sheet)) return { ok: false, why: 'place' };
      const now = Date.now();
      to = {
        id: newMemoId(),
        sheet,
        pos: { ...draft.pos },
        text: '',
        tags: [],
        liked: 0,
        island: null,
        ...(draft.source ? { source: draft.source } : {}),
        createdAt: now,
        updatedAt: now,
      };
      created = true;
    } else {
      to = this.memos.get(input.toId);
      if (!to || isSpecialCell(to)) return { ok: false, why: 'to' };
      if (to.id === from.id) return { ok: false, why: 'same' };
    }
    const done = sendCards({ from: from.replies ?? [], to: to.replies ?? [], ids: input.replyIds, mode: input.mode });
    if (!done.ok) return done;
    const fromBefore = structuredClone(from.replies ?? []) as Reply[];
    const toBefore = structuredClone(to.replies ?? []) as Reply[];
    const fromUpdated = from.updatedAt;
    const toUpdated = to.updatedAt;
    this.backupOnce(CARD_SEND_BACKUP);
    const now = Date.now();
    if (input.mode === 'move') {
      from.replies = done.from;
      from.updatedAt = now;
    }
    to.replies = done.to;
    to.updatedAt = now;
    if (created) this.memos.set(to.id, to);
    const token = `u${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    this.sendUndo = {
      token,
      fromId: from.id,
      toId: to.id,
      created,
      fromReplies: fromBefore,
      toReplies: toBefore,
      fromUpdated,
      toUpdated,
      fromAfter: replyFingerprint(from.replies),
      toAfter: replyFingerprint(to.replies),
    };
    this.changed();
    return { ok: true, toId: to.id, created, token, tops: done.tops, cut: done.cut, kept: done.kept, added: done.added };
  }

  // 型を、メモの返信の最後に貼る（docs/plan-card-templates.md の Phase 1c）。sendReplies の copy と同じ道：
  //   下書きは buildPasteDraft（新しい id・時刻は今の最新より後・rank なし・型の中の関連だけ）→ sendCards（copy）で足す。
  //   rank を持たないカードは、最後に置いてある番地の次に並ぶので、ほかのカードの rank は変えない。
  //   貼ると 300 枚を超えるときは全体を断る（何も書かない）。元のメモは無いので、元に戻すのは貼り先の返信だけ
  //   ids（B3-2a）：あれば、貼ったカードの id をその順に使う（型のカードと 1 対 1）。使えない指定は全体を断る（何も書かない）。省略したときは今までと同じ
  private pasteTemplate(raw: unknown, toId: string, ids?: readonly string[]): SendRepliesResult {
    if (!this.loaded || this.loadState === 'unreadable') return { ok: false, why: 'ledger' };
    const checked = parseTemplate(raw); // 区画から来たものを信用しない（形・上限・機械のタグ・関連を確かめ直す）
    if (!checked.ok) return { ok: false, why: 'invalid' };
    const to = this.memos.get(toId);
    if (!to || isSpecialCell(to)) return { ok: false, why: 'to' };
    const existing = to.replies ?? [];
    if (ids !== undefined) {
      const bad = pasteIdsProblem(existing, ids, checked.template.cards.length);
      if (bad !== null) return { ok: false, why: 'ids', idsWhy: bad };
    }
    // 指定のとき：下書きの仮の id は REPLY_ID_RE に合わない形にして、指定の id と重ならないようにする。sendCards が新しい id を振るので、そこで指定の id を順に渡す
    let draftSeq = 0;
    const draft = buildPasteDraft(checked.template, { existing, ...(ids !== undefined ? { newId: () => `@draft:${draftSeq++}` } : {}) });
    if (!draft.ok) return draft.why === 'full' ? { ok: false, why: 'full', room: draft.room, need: draft.need } : { ok: false, why: 'invalid' };
    const queue = ids === undefined ? null : [...ids];
    const done = sendCards({ from: draft.replies, to: existing, ids: draft.newTopIds, mode: 'copy', ...(queue ? { newId: () => queue.shift() ?? '' } : {}) });
    if (!done.ok) return done;
    // 念のため：指定のとおりの id で、指定の順に入ったことを書く前に確かめる（食い違えば何も書かない）
    if (ids !== undefined && (done.newTopIds.length !== ids.length || done.newTopIds.some((id, i) => id !== ids[i]))) return { ok: false, why: 'ids', idsWhy: 'count' };
    const toBefore = structuredClone(existing) as Reply[];
    const toUpdated = to.updatedAt;
    this.backupOnce(CARD_SEND_BACKUP);
    const now = Date.now();
    to.replies = done.to;
    to.updatedAt = now;
    const token = `u${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    this.sendUndo = {
      token,
      fromId: null,
      toId: to.id,
      created: false,
      fromReplies: null,
      toReplies: toBefore,
      fromUpdated: 0,
      toUpdated,
      fromAfter: null,
      toAfter: replyFingerprint(to.replies),
    };
    this.changed();
    return { ok: true, toId: to.id, created: false, token, tops: done.tops, cut: 0, kept: done.kept, added: done.added, name: checked.template.name };
  }

  // 直前の送りを元に戻す（送ったあとに返信が変わっていれば断る。新しく作ったメモは、空のままなら消す）
  undoSend(token: string): { ok: true } | { ok: false; why: 'ledger' | 'none' | 'stale' } {
    if (!this.loaded || this.loadState === 'unreadable') return { ok: false, why: 'ledger' };
    const undo = this.sendUndo;
    if (!undo || undo.token !== token) return { ok: false, why: 'none' };
    const from = undo.fromId === null ? null : this.memos.get(undo.fromId);
    const to = this.memos.get(undo.toId);
    if (!to || (undo.fromId !== null && !from)) return { ok: false, why: 'stale' };
    if ((from && replyFingerprint(from.replies) !== undo.fromAfter) || replyFingerprint(to.replies) !== undo.toAfter) return { ok: false, why: 'stale' };
    if (undo.created && to.text.trim()) return { ok: false, why: 'stale' };
    if (from && undo.fromReplies) {
      from.replies = undo.fromReplies;
      from.updatedAt = undo.fromUpdated;
    }
    if (undo.created) this.memos.delete(to.id);
    else {
      to.replies = undo.toReplies;
      to.updatedAt = undo.toUpdated;
    }
    this.sendUndo = null;
    this.changed();
    return { ok: true };
  }

  // 今の台帳を、名前ごとに 1 回だけ写す（ファイルがもうあれば上書きしない。読めた台帳だけを写す）
  private backupOnce(name: string) {
    if (this.backupTasks.has(name) || this.loadState !== 'ok') return;
    const snapshot = JSON.parse(JSON.stringify({ version: 1, memos: this.list() })) as unknown;
    this.backupTasks.set(
      name,
      (async () => {
        const existing = await readDataChecked<unknown>(name);
        if (existing.status !== 'missing') {
          if (existing.status === 'failed') this.backupTasks.delete(name); // 読めなかった：上書きせず、次の書き直しでもう一度
          return;
        }
        const ok = await writeData(name, snapshot);
        if (!ok) this.backupTasks.delete(name); // 書けなければ、次の書き直しでもう一度
      })(),
    );
  }

  // 返信を消す（その下の返信も一緒に）
  //   undoToken（B3-3a。形は呼ぶ側が検査済み）があり、実際に返信が変わるときだけ、消す直前の返信全体を控える（restoreReplies で戻せる）。なければ今までどおり
  removeReply(id: string, replyId: string, undoToken?: string) {
    const memo = this.memos.get(id);
    if (!memo?.replies) return;
    const before = undoToken !== undefined && isRestoreToken(undoToken) && this.loaded && this.loadState !== 'unreadable' ? replyFingerprint(memo.replies) : null;
    memo.replies = withoutReply(memo.replies, replyId);
    if (before !== null && undoToken !== undefined) this.recordRestore(id, undoToken, before, replyFingerprint(memo.replies));
    this.changed();
  }

  // 消す直前の返信全体を控える。変わっていなければ控えない。50 件・約 400 万字を超えたら古い順に捨てる（1 件だけで超えるなら、それも捨てる）
  //   同じ token で続けて消したとき（B3-3b：ボードで何枚かを一度に消す。1 枚ずつ removeReply が届く）：前の控えの「消した直後」が今回の「消す直前」と同じなら、
  //   控えを 1 件にまとめる（最初の消す前〜最後の消した後）。そうでなければ（間に別の変更が入った）置き換える
  private recordRestore(memoId: string, token: string, before: string, after: string) {
    if (before === after) return;
    const prev = this.restoreLog.find((e) => e.token === token && e.memoId === memoId);
    this.restoreLog = this.restoreLog.filter((e) => e.token !== token);
    if (prev && prev.after === before) this.restoreLog.push({ token, memoId, before: prev.before, after, size: prev.before.length + after.length });
    else this.restoreLog.push({ token, memoId, before, after, size: before.length + after.length });
    let total = this.restoreLog.reduce((sum, e) => sum + e.size, 0);
    while (this.restoreLog.length > RESTORE_MAX_ENTRIES || (total > RESTORE_MAX_CHARS && this.restoreLog.length > 0)) {
      const dropped = this.restoreLog.shift();
      total -= dropped?.size ?? 0;
    }
  }

  // 削除の取り消し：token の控えがあり、そのメモの今の返信全体の指紋が「消した直後」と完全に同じときだけ、返信を消す前へ戻して保存する（changed 1 回）
  //   合わない（そのあとメモが変わった）ときは何も変えずに stale。控えが無い・別のメモの token・2 回目は none。読めなかった起動は ledger。メモの updatedAt は変えない（removeReply も変えない）
  //   戻したら、その控えは捨てる（同じメモのもっと古い控えは残す。新しい順に戻せば指紋が合う）
  restoreReplies(id: string, token: string): RestoreRepliesResult {
    if (!this.loaded || this.loadState === 'unreadable') return { ok: false, why: 'ledger' };
    if (!isRestoreToken(token)) return { ok: false, why: 'none' };
    const entry = this.restoreLog.find((e) => e.token === token && e.memoId === id);
    if (!entry) return { ok: false, why: 'none' };
    const memo = this.memos.get(id);
    if (!memo || isSpecialCell(memo)) return { ok: false, why: 'stale' };
    if (replyFingerprint(memo.replies) !== entry.after) return { ok: false, why: 'stale' };
    const restored = JSON.parse(entry.before) as Reply[];
    memo.replies = restored;
    this.restoreLog = this.restoreLog.filter((e) => e !== entry);
    this.changed();
    return { ok: true, count: restored.length };
  }

  setIsland(ids: string[], island: string | null) {
    for (const id of ids) {
      const memo = this.memos.get(id);
      if (memo) memo.island = island;
    }
    this.changed();
  }

  move(id: string, pos: Hex) {
    const memo = this.memos.get(id);
    if (!memo) return;
    memo.pos = { ...pos };
    this.changed();
  }

  setPositions(positions: Map<string, Hex>) {
    for (const [id, pos] of positions) {
      const memo = this.memos.get(id);
      if (memo) memo.pos = { ...pos };
    }
    this.changed();
  }

  // 別のシートへ移す（行き先のセルは空いている前提）
  moveToSheet(positions: Map<string, Hex>, sheet: string) {
    for (const [id, pos] of positions) {
      const memo = this.memos.get(id);
      if (!memo) continue;
      memo.sheet = sheet;
      memo.pos = { ...pos };
    }
    this.changed();
  }

  remove(id: string) {
    const memo = this.memos.get(id);
    if (!memo) return;
    this.memos.delete(id);
    // 画像は、ほかのメモが使っていなければ消す
    if (memo.image && !this.list().some((m) => m.image === memo.image)) this.images.delete(memo.image);
    this.changed();
  }

  // ---------- 画像（六角形スクショ） ----------

  async saveImage(dataUrl: string): Promise<string | null> {
    const id = `shot${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const ok = await writeData(`shots/${id}.json`, { version: 1, data: dataUrl });
    if (!ok) return null;
    this.images.set(id, dataUrl);
    return id;
  }

  // 画像の data URL を、読み終えるまで待って受け取る（見た目の欄を開くときなど）
  async loadImage(id: string | undefined): Promise<string | undefined> {
    if (!id) return undefined;
    const cached = this.images.get(id);
    if (cached) return cached;
    const saved = await readData<{ data?: unknown }>(`shots/${id}.json`);
    if (typeof saved?.data !== 'string' || !saved.data.startsWith('data:image/')) return undefined;
    this.images.set(id, saved.data);
    return saved.data;
  }

  // 画像の data URL（まだ読んでいなければ読み始めて undefined。読み終えたら知らせる）
  image(id: string | undefined): string | undefined {
    if (!id) return undefined;
    const cached = this.images.get(id);
    if (cached || this.loading.has(id)) return cached;
    this.loading.add(id);
    void readData<{ data?: unknown }>(`shots/${id}.json`).then((saved) => {
      this.loading.delete(id);
      if (typeof saved?.data === 'string' && saved.data.startsWith('data:image/')) {
        this.images.set(id, saved.data);
        this.emit();
      }
    });
    return undefined;
  }

  private changed() {
    this.emit();
    if (!this.writable) return; // 読み込む前・読めなかった台帳に書くと、前のメモを消してしまう
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flush(), 400);
  }

  // 待たずに書く（終わるとき。セッションと食い違わないように）
  flush() {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    if (this.writable) void writeData(FILE, { version: 1, memos: this.list() });
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

// メモの見出し（最初の空でない行）
export function memoTitle(memo: Pick<MemoCell, 'text'>, max = 40) {
  const line = memo.text.split('\n').find((l) => l.trim())?.trim() ?? '';
  const chars = [...line];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : line;
}

function cleanText(text: string) {
  return [...String(text ?? '').replace(/\r\n?/g, '\n')].slice(0, MAX_MEMO_TEXT).join('').trim();
}

function cleanLabel(label: string) {
  return [...label.trim()].slice(0, 10).join('');
}

function clampLiked(n: number) {
  return Math.max(0, Math.min(3, Math.round(Number(n) || 0)));
}

export function parseMemo(raw: unknown): MemoCell | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  const pos = m.pos as { q?: unknown; r?: unknown } | undefined;
  if (typeof m.id !== 'string' || !pos || !Number.isInteger(pos.q) || !Number.isInteger(pos.r)) return null;
  const portal = isSheetId(m.portal) ? m.portal : undefined;
  // ボットのセル・アプリのセル：id の形を確かめてから残す（落とすと、起動し直したときにふつうのメモに戻る）。
  //   入口が付いていれば入口を残す。ボットとアプリが両方付いていればボットを残す。どちらも返信・相棒の印・元のページを持たない
  const bot = !portal && isBotId(m.bot) ? m.bot : undefined;
  const app = !portal && !bot && isAppId(m.app) ? m.app : undefined;
  const capture = !portal && !bot && !app && isCaptureId(m.capture) ? m.capture : undefined;
  // 撮影の ID の形が壊れているセルは、空のメモに戻さず落とす（台帳の画像はそのまま）
  if (!capture && typeof m.capture === 'string' && m.capture && !portal && !bot && !app) return null;
  const plain = !bot && !app && !capture;
  const source = plain ? (m.source as { url?: unknown; title?: unknown } | undefined) : undefined;
  const replies = plain ? parseReplies(m.replies) : [];
  const by = plain ? parseAuthor(m.by) : undefined;
  const linkNames = plain ? parseLinkKindNames(m.linkNames) : undefined;
  const linkSet = plain ? parseLinkSetId(m.linkSet) : undefined;
  return {
    id: m.id,
    sheet: isSheetId(m.sheet) ? m.sheet : MAIN_SHEET,
    pos: { q: pos.q as number, r: pos.r as number },
    ...(portal ? { portal } : {}),
    ...(bot ? { bot } : {}),
    ...(app ? { app } : {}),
    ...(capture ? { capture } : {}),
    text: typeof m.text === 'string' ? cleanText(m.text) : '',
    tags: capture ? [] : normalizeTags(m.tags),
    liked: capture ? 0 : clampLiked(Number(m.liked)),
    island: !capture && typeof m.island === 'string' ? m.island : null,
    image: !capture && typeof m.image === 'string' && /^shot[0-9a-z]+$/.test(m.image) ? m.image : undefined,
    source: source && typeof source.url === 'string' && /^https?:\/\//i.test(source.url) ? { url: source.url, title: typeof source.title === 'string' ? source.title : '' } : undefined,
    ...(replies.length > 0 ? { replies } : {}),
    ...(linkNames ? { linkNames } : {}),
    ...(linkSet ? { linkSet } : {}),
    ...(by ? { by, ...(typeof m.label === 'string' && m.label ? { label: cleanLabel(m.label) } : {}) } : {}),
    createdAt: typeof m.createdAt === 'number' ? m.createdAt : Date.now(),
    updatedAt: typeof m.updatedAt === 'number' ? m.updatedAt : Date.now(),
  };
}
