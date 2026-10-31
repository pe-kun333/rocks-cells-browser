// コピーする前の下書き（段階3）。受け取り箱の「待っている依頼」とは別。
//   番号と確認用の値は、コピーしてアプリが開いた瞬間に、今までどおり左が作る。下書きには付けない。
//   全文は手元（ui-data\drafts.json）だけ。7日で消える。待っている依頼の30日とは別に数える。
//   依頼の小窓 v2・R8（D18）：受け取り箱では「未送信の箱」として出す（小窓を途中で閉じた依頼と、コピーに失敗した依頼）。
//   コピーに失敗した依頼は、左が failed と why（短いわけ）を付けて入れる（addSingleDraft）。「下書きに戻す」で印を外す（unfailDraft）
import { type AskAllRun, type AskAllTarget, askAllSeatDraft } from './bot-ask-all';
import { type DraftAttach, type DraftRequest } from './bot-send';
import type { MaterialRef } from './draft-materials';
import { readData, writeData } from './data';

export const DRAFT_DAYS = 7;
const FILE = 'drafts.json';
const MAX = 40;
const DAY = 24 * 60 * 60 * 1000;

export interface DraftFlags {
  title: boolean;
  url: boolean;
  selection: boolean;
  body: boolean;
  image: boolean;
  materials: number; // 付けた材料の件数（段 D2。中身は持たない。0 は無し）
}

export interface BotDraft {
  id: string;
  createdAt: number;
  text: string; // 人が書いた頼む文（全文。一覧では切らない）
  botId: string;
  botName: string;
  roleName?: string;
  seat?: number;
  group?: number; // みんなに聞くの組（依頼の group と同じ番号。確認用の値ではない）
  step?: number; // 1 から
  steps?: number;
  next: boolean; // この席が、次にコピーする席
  chatOnly: boolean;
  attach: DraftFlags;
  req: DraftRequest; // コピーするときに、今の送り方へ渡す中身
  failed?: true; // コピーに失敗した（R8。未送信の箱で「送り方を選び直す…」「下書きに戻す」）
  why?: string; // 失敗のわけ（短い文。左が決めたもの）
  materialRefs?: MaterialRef[]; // 閉じたときに付けていた材料の参照だけ（段 D2・Q3。中身は持たない。読み直しは D3・D4）
}

interface DraftFile {
  v: 1;
  drafts: BotDraft[];
}

type Listener = (drafts: BotDraft[]) => void;
const listeners = new Set<Listener>();

export function onDrafts(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let chain: Promise<void> = Promise.resolve();

function emit(drafts: BotDraft[]) {
  for (const listener of listeners) listener(drafts);
}

export function flagsOf(attach: DraftAttach, image = false): DraftFlags {
  return { title: !!attach.title, url: !!attach.url, selection: !!attach.selection, body: !!attach.body, image, materials: attach.materials?.length ?? 0 };
}

function fresh(drafts: BotDraft[], now = Date.now()): BotDraft[] {
  const limit = now - DRAFT_DAYS * DAY;
  return drafts.filter((d) => typeof d.createdAt === 'number' && d.createdAt > limit).slice(0, MAX);
}

function isDraft(value: unknown): value is BotDraft {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const req = v.req;
  if (typeof req !== 'object' || req === null) return false;
  const r = req as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.text === 'string' && typeof v.botId === 'string' && typeof v.botName === 'string' && typeof r.text === 'string' && typeof r.botId === 'string';
}

async function read(): Promise<BotDraft[]> {
  const file = await readData<DraftFile>(FILE);
  const list = file?.v === 1 && Array.isArray(file.drafts) ? file.drafts.filter(isDraft) : [];
  return fresh(list);
}

async function write(drafts: BotDraft[]): Promise<BotDraft[]> {
  const next = fresh(drafts);
  await writeData(FILE, { v: 1, drafts: next } satisfies DraftFile);
  emit(next);
  return next;
}

function update(fn: (drafts: BotDraft[]) => BotDraft[]): Promise<BotDraft[]> {
  const run = chain.then(async () => write(fn(await read())));
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function loadDrafts(): Promise<BotDraft[]> {
  return update((drafts) => drafts);
}

// 読むだけ（書き戻さない）。Grok Cards はこちらを使う。loadDrafts は期限切れを消して書き戻す
export function peekDrafts(): Promise<BotDraft[]> {
  return read();
}

export function newDraftId(): string {
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// みんなに聞く A：組を作った時点の席。依頼はまだ作らない。最初の席が「次」
export function draftsFromAskAll<T extends AskAllTarget>(run: AskAllRun<T>, now = Date.now()): BotDraft[] {
  return run.seats.map((seat, i) => ({
    id: `g${run.group}-${i}`,
    createdAt: now,
    text: run.text,
    botId: seat.id,
    botName: seat.name,
    ...(seat.role?.name ? { roleName: seat.role.name } : {}),
    ...(seat.seat ? { seat: seat.seat } : {}),
    group: run.group,
    step: i + 1,
    steps: run.seats.length,
    next: i === 0,
    chatOnly: run.chatOnly,
    attach: flagsOf(run.attach),
    req: askAllSeatDraft(run, i),
  }));
}

export function putAskAllDrafts<T extends AskAllTarget>(run: AskAllRun<T>): Promise<BotDraft[]> {
  const made = draftsFromAskAll(run);
  return update((list) => [...list.filter((d) => d.group !== run.group), ...made]);
}

// コピーできた席を下書きから外し、残った席の先頭を「次」にする
export function markDraftCopied(group: number, index: number): Promise<BotDraft[]> {
  return update((list) => promote(list.filter((d) => !(d.group === group && d.step === index + 1)), group));
}

export function removeDraft(id: string): Promise<BotDraft[]> {
  return update((list) => {
    const gone = list.find((d) => d.id === id);
    const rest = list.filter((d) => d.id !== id);
    return gone?.group != null && gone.next ? promote(rest, gone.group) : rest;
  });
}

export function addSingleDraft(draft: BotDraft): Promise<BotDraft[]> {
  return update((list) => [draft, ...list.filter((d) => d.id !== draft.id)]);
}

// 「下書きに戻す」（R8）：コピーに失敗した印を外す（中身はそのまま）
export function unfailDraft(id: string): Promise<BotDraft[]> {
  return update((list) =>
    list.map((d) => {
      if (d.id !== id) return d;
      const { failed: _failed, why: _why, ...rest } = d;
      return rest;
    }),
  );
}

function promote(list: BotDraft[], group: number): BotDraft[] {
  for (const draft of list) if (draft.group === group) draft.next = false;
  const next = list.filter((d) => d.group === group).sort((a, b) => (a.step ?? 0) - (b.step ?? 0))[0];
  if (next) next.next = true;
  return list;
}
