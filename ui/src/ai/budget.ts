// 相棒（Claude 側）の月の料金の目安。Grok Bot の使用量は、このブラウザからは見えないので数えない。
//   上限は空欄（null）なら無し。練習モードは呼ぶ側が数えない。月が替わると合計は 0 に戻る。
//   三つの画面は、送る直前にこのファイルを読み直す。
import { readData, writeData } from '../data';

const FILE = 'budget.json';
const NEAR = 0.8; // 上限の 8割で「近づいた」
export const MAX_CAP = 10_000;

export class BudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetError';
  }
}

export interface BudgetView {
  month: string; // このパソコンの年月（2026-10）
  spent: number; // 今月の目安（ドル）
  cap: number | null; // null は上限なし
  near: boolean;
  blocked: boolean;
}

interface BudgetFile {
  v: 1;
  month: string;
  spent: number;
  cap: number | null;
}

type Listener = (view: BudgetView) => void;
const listeners = new Set<Listener>();

export function onBudget(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(view: BudgetView) {
  for (const listener of listeners) listener(view);
}

export function monthKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(3)}`;
}

export function budgetStopMessage(view: BudgetView): string {
  const cap = view.cap ?? 0;
  // 0 は、月が替わって合計が 0 に戻っても、また止まる
  const again =
    cap <= 0
      ? '上限が $0.000 なので止まります。空欄に戻すか、0 より大きい数字にすると、また呼べます。'
      : '来月になると合計は 0 に戻り、また呼べます。';
  return `今月の料金の目安が上限（${formatUsd(cap)}）に達したので、新しい呼び出しを止めました。${again}表示は目安で、実際の請求とは一致しません。`;
}

export const BUDGET_NEAR_NOTE = '今月の料金の目安が上限に近づいています。⚙ の「今月の料金」を見てください。これは目安で、実際の請求とは一致しません。';

function cleanCap(cap: unknown): number | null {
  if (typeof cap !== 'number' || !Number.isFinite(cap) || cap < 0) return null;
  return Math.round(Math.min(cap, MAX_CAP) * 1000) / 1000;
}

function viewOf(file: BudgetFile | null): BudgetView {
  const month = monthKey();
  const cap = cleanCap(file?.cap);
  const spent = file && file.month === month && typeof file.spent === 'number' && Number.isFinite(file.spent) && file.spent > 0 ? file.spent : 0;
  const blocked = cap !== null && spent >= cap - 1e-9;
  const near = cap !== null && cap > 0 && !blocked && spent >= cap * NEAR;
  return { month, spent, cap, near, blocked };
}

export async function loadBudget(): Promise<BudgetView> {
  const file = await readData<BudgetFile>(FILE);
  return viewOf(file && file.v === 1 ? file : null);
}

async function save(view: Pick<BudgetView, 'month' | 'spent' | 'cap'>): Promise<BudgetView> {
  const file: BudgetFile = { v: 1, month: view.month, spent: view.spent, cap: view.cap };
  await writeData(FILE, file);
  const next = viewOf(file);
  emit(next);
  return next;
}

// 空欄は上限なし。0 なら、次の呼び出しから止まる。
export async function setBudgetCap(cap: number | null): Promise<BudgetView> {
  const current = await loadBudget();
  return save({ month: current.month, spent: current.spent, cap: cleanCap(cap) });
}

// 新しい呼び出しの直前。達していれば送らない。
export async function assertBudget(): Promise<BudgetView> {
  const view = await loadBudget();
  if (view.blocked) throw new BudgetError(budgetStopMessage(view));
  return view;
}

// 呼び出しが終わったあと、目安を足す。練習モードや 0 は足さない。
export async function addBudget(amount: number): Promise<BudgetView> {
  if (!Number.isFinite(amount) || amount <= 0) return loadBudget();
  const current = await loadBudget();
  return save({ month: current.month, spent: current.spent + amount, cap: current.cap });
}
