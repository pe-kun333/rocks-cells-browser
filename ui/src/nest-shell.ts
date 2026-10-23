// ダイソンの殻の見え方（計画 §4・§5）。描く前の決まりだけ。色と SVG は nest-icon.ts
//   3 つの軸を混ぜない：開く／閉じる、届いた 0〜6、合体（殻は隠して、下の行が開閉になる）
import { arrivedLabel } from './grok-cards-arrived';
import { countLine } from './grok-cards-count';

export type ShellSize = 26 | 40 | 60;

export interface ShellInput {
  open: boolean;
  merged: boolean;
  replies: number;
  drafts: number;
  arrived: number;
  arrivedOf?: number; // 段 8 の分母。無いときは説明を「k/6」のまま（段 1〜7）
  seats: number;
  error: boolean;
  size: ShellSize;
}

export interface ShellPlate {
  empty: boolean;
  arrived: boolean;
}

export interface ShellView {
  size: ShellSize;
  open: boolean;
  merged: boolean;
  plates: ShellPlate[];
  badge: 'none' | 'count' | 'alert';
  badgeText: string;
  caption: string;
  label: string;
}

// 輪の高さから。通常の輪（約 155）は 60、低い画面で詰めた輪（約 129）は 40、それより低ければ 26
export function shellSize(ringHeight: number): ShellSize {
  if (ringHeight < 118) return 26;
  if (ringHeight < 145) return 40;
  return 60;
}

function arrivedText(arrived: number, arrivedOf?: number): string {
  const k = Math.max(0, Math.floor(arrived));
  if (arrivedOf === undefined || arrivedOf <= 0) return `届いた ${Math.min(6, k)}/6`;
  return arrivedLabel(k, arrivedOf);
}

export function shellCaption(input: Pick<ShellInput, 'open' | 'arrived' | 'drafts' | 'replies' | 'arrivedOf'>): string {
  if (input.open) return '開いています';
  if (input.arrived > 0) return arrivedText(input.arrived, input.arrivedOf);
  return countLine(input.drafts, input.replies);
}

export function shellLabel(open: boolean, drafts: number, replies: number, arrived?: { k: number; of: number }): string {
  if (open) return 'Grok Cards を閉じる';
  const line = countLine(drafts, replies);
  const extra = arrived && arrived.k > 0 && arrived.of > 0 ? arrivedLabel(arrived.k, arrived.of) : '';
  const body = [line, extra].filter(Boolean).join('・');
  return body ? `Grok Cards を開く（${body}）` : 'Grok Cards を開く';
}

export function shellView(input: ShellInput): ShellView {
  const seats = Math.max(0, Math.min(6, Math.floor(input.seats)));
  const arrived = Math.max(0, Math.min(6, Math.floor(input.arrived)));
  const plates = Array.from({ length: 6 }, (_, i) => ({
    empty: i >= seats,
    arrived: i < seats && i < arrived,
  }));
  let badge: ShellView['badge'] = 'none';
  let badgeText = '';
  if (!input.merged && !input.open) {
    if (input.error) {
      badge = 'alert';
      badgeText = '!';
    } else if (input.replies > 0) {
      badge = 'count';
      badgeText = input.replies > 9 ? '9+' : String(input.replies);
    }
  }
  const named = input.arrivedOf !== undefined && input.arrived > 0 ? { k: Math.floor(input.arrived), of: input.arrivedOf } : undefined;
  const label = shellLabel(input.open, input.drafts, input.replies, named) + (badge === 'alert' ? '（エラー）' : '');
  return {
    size: input.size,
    open: input.open,
    merged: input.merged,
    plates,
    badge,
    badgeText,
    caption: input.size === 26 ? '' : shellCaption(input),
    label,
  };
}

// 合体の行。数と、届いていれば「届いた k/n」。うしろに ▸。何も無ければ「合体 Grok ▸」
//   分母は段 8 の組の席数。段 1〜7 は 6 のまま
export function mergeRowLabel(input: Pick<ShellInput, 'drafts' | 'replies' | 'arrived' | 'arrivedOf'>): string {
  const parts: string[] = [];
  const line = countLine(input.drafts, input.replies);
  if (line) parts.push(line);
  if (input.arrived > 0) parts.push(arrivedText(input.arrived, input.arrivedOf));
  const body = parts.join('・');
  return body ? `${body} ▸` : '合体 Grok ▸';
}

export interface ShellDev {
  open?: boolean;
  merged?: boolean;
  replies?: number;
  drafts?: number;
  arrived?: number;
  occupied?: number;
  error?: boolean;
  size?: ShellSize;
}

// 段 8 は本当の届いた数を使う。開発用の arrived は、そのときだけ渡さない
//   段 1〜7 は、渡した arrived で上書きしたまま
export function shellDevForArrived(dev: ShellDev, stage8: boolean): ShellDev {
  if (!stage8 || typeof dev.arrived !== 'number') return dev;
  const next: ShellDev = { ...dev };
  delete next.arrived;
  return next;
}

export function resolveShellInput(real: ShellInput, dev: ShellDev | null): ShellInput {
  if (!dev) return real;
  const size = dev.size === 26 || dev.size === 40 || dev.size === 60 ? dev.size : real.size;
  return {
    open: dev.open ?? real.open,
    merged: dev.merged ?? real.merged,
    replies: typeof dev.replies === 'number' ? dev.replies : real.replies,
    drafts: typeof dev.drafts === 'number' ? dev.drafts : real.drafts,
    arrived: typeof dev.arrived === 'number' ? dev.arrived : real.arrived,
    ...(real.arrivedOf !== undefined ? { arrivedOf: real.arrivedOf } : {}),
    seats: typeof dev.occupied === 'number' ? dev.occupied : real.seats,
    error: dev.error ?? real.error,
    size,
  };
}
