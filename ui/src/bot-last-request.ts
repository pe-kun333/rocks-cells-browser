// 前回送った依頼の「選び方」（依頼の小窓 v2・R6。docs/bot-cells/plan-request-v2.md D14・§4.1。ui-data\bots\last-request.json）
//   ・持つのは選び方だけ：開いた入口・定型の組と押した定型（id）・宛て先（ボットの id と席。みんなは all）・返し先・朱書き（id）・
//     URL／題名／選んだ文を付けたか。頼む文・選んだ文・題名・URL の中身は入れない。本文と画像の印も持たない（戻すときは外したまま）
//   ・書くのは左だけ（BotLastRequestStore）。小窓は送るときに選び方（choice）を DraftRequest に載せ、右と読む画面からは命令 botDraftV2 の choice で左へ。
//     左は依頼をコピーしてアプリを開けたときだけ書く（宛て先と席は、左が台帳で確かめ直す）。右と読む画面は写し（bots・botAsk の lastRequest）を見る
//   ・小窓の「前と同じで」（Ctrl+Shift+G を素早く 2 回でも。左の askGrokFromPage が時刻で見る）は、この写しを小窓に当てる
//   ・朱書きの id（rush・slow・sources・counter・hedge）は小窓の STAMPS（R3）で決めた名前。知らない id は小窓が使わない
import { type BotPresetEntry, PRESET_ENTRY_LABEL, PRESET_ID_RE } from './bot-presets';
import { isBotId } from './bots';
import { readData, writeData } from './data';

export type BotLastReplyTo = 'inbox' | 'chat' | 'memo'; // 受け取り箱（中継）／アプリのチャットだけ／六角メモにも届く（R10）

// 小窓が送るときの選び方（at は左が付ける）
export interface BotLastChoice {
  entry: BotPresetEntry;
  set?: string; // 定型の組の id
  presets: string[]; // 依頼文に入っていた定型の id（依頼文の行の順）
  to: { botId?: string; seat?: number; all?: true }; // 1体なら botId（巣の席なら seat）。みんなに聞くは all
  replyTo: BotLastReplyTo;
  stamps: string[]; // 朱書きの id
  attach: { url: boolean; title: boolean; selection: boolean };
}

export interface BotLastRequest extends BotLastChoice {
  at: string; // 送った時刻（ISO）
}

const PRESETS_MAX = 12;
const STAMPS_MAX = 10;
const STAMP_ID_RE = /^[a-z]{1,20}$/;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function ids(raw: unknown, re: RegExp, max: number): string[] {
  const out: string[] = [];
  for (const id of Array.isArray(raw) ? raw : []) {
    if (out.length >= max) break;
    if (typeof id === 'string' && re.test(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

// 選び方を使える形に直す（形の違うものは null。知らない値は既定に。宛て先のボットがいるかは見ない〔当てる側・書く側が見る〕）
export function normalizeLastChoice(raw: unknown): BotLastChoice | null {
  if (!isRecord(raw)) return null;
  const entry = typeof raw.entry === 'string' && Object.hasOwn(PRESET_ENTRY_LABEL, raw.entry) ? (raw.entry as BotPresetEntry) : 'page';
  const to = isRecord(raw.to) ? raw.to : {};
  const seat = Number.isInteger(to.seat) && (to.seat as number) >= 1 && (to.seat as number) <= 6 ? (to.seat as number) : undefined;
  const attach = isRecord(raw.attach) ? raw.attach : {};
  return {
    entry,
    ...(typeof raw.set === 'string' && PRESET_ID_RE.test(raw.set) ? { set: raw.set } : {}),
    presets: ids(raw.presets, PRESET_ID_RE, PRESETS_MAX),
    to: to.all === true ? { all: true } : { ...(isBotId(to.botId) ? { botId: to.botId } : {}), ...(seat ? { seat } : {}) },
    replyTo: raw.replyTo === 'chat' || raw.replyTo === 'memo' ? raw.replyTo : 'inbox',
    stamps: ids(raw.stamps, STAMP_ID_RE, STAMPS_MAX),
    attach: { url: attach.url === true, title: attach.title === true, selection: attach.selection === true },
  };
}

// 前回送った依頼（時刻が読めないものは null）
export function normalizeLastRequest(raw: unknown): BotLastRequest | null {
  if (!isRecord(raw) || typeof raw.at !== 'string' || raw.at.length > 40) return null;
  const t = Date.parse(raw.at);
  const choice = normalizeLastChoice(raw);
  return Number.isFinite(t) && choice ? { ...choice, at: new Date(t).toISOString() } : null;
}

const FILE = 'bots/last-request.json';

export class BotLastRequestStore {
  private last: BotLastRequest | null = null;
  private loaded = false;
  private writable = true; // 版の違うファイルを読んだときは書かない（新しい版を消さない）
  private readonly listeners: (() => void)[] = [];

  async load() {
    const saved = await readData<{ version?: unknown }>(FILE);
    if (saved !== null && saved.version !== 1) this.writable = false;
    // 読むあいだに送った依頼があれば、そちらが新しい
    if (!this.last && saved?.version === 1) this.last = normalizeLastRequest(saved);
    this.loaded = true;
    this.emit();
  }

  get ready() {
    return this.loaded;
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  // 前回送った依頼の選び方（無ければ null）。写しにもこれを送る
  get(): BotLastRequest | null {
    return this.last ? normalizeLastRequest(this.last) : null;
  }

  // 依頼を送れた：選び方を残す（すぐ書く。1 回の送りで 1 回）。形が違えば false
  set(choice: BotLastChoice): boolean {
    const clean = normalizeLastChoice(choice);
    if (!clean) return false;
    this.last = { ...clean, at: new Date().toISOString() };
    this.emit();
    if (this.writable) void writeData(FILE, { version: 1, ...this.last });
    return true;
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}
