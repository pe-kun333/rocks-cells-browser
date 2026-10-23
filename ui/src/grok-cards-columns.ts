// Grok Cards の列の順（計画 §3）
//   既定：みんな → 席の順のボット → 下書きの宛て先で席にいないボット
//   段 7 の「＋ 列を足す」は withAddedColumn。保存するのは並びと隠しだけ
//   保存した順があればそれを先に、足りない既定を後ろに足す。隠した列は出さない
import { EVERYONE_ADDRESS, isCardsBotId } from './grok-cards-tags';

export interface CardColumn {
  key: string;
  address: string;
  title: string;
  missing: boolean;
}

export function columnKey(address: string): string {
  return address === EVERYONE_ADDRESS ? 'all' : `bot:${address}`;
}

export function validColumnKey(key: string): boolean {
  if (key === 'all') return true;
  return key.startsWith('bot:') && isCardsBotId(key.slice(4));
}

export function orderColumns(input: {
  dock: readonly string[];
  extra: readonly string[];
  savedOrder: readonly string[];
  hidden: readonly string[];
  names: ReadonlyMap<string, string>;
}): CardColumn[] {
  const hidden = new Set(input.hidden);
  const dockIds = input.dock.filter((id) => isCardsBotId(id));
  const dockSet = new Set(dockIds);
  const extraIds: string[] = [];
  for (const id of input.extra) {
    if (!isCardsBotId(id) || dockSet.has(id) || extraIds.includes(id)) continue;
    extraIds.push(id);
  }
  const defaults = ['all', ...dockIds.map((id) => `bot:${id}`), ...extraIds.map((id) => `bot:${id}`)];
  const keys: string[] = [];
  const seen = new Set<string>();
  const push = (key: string) => {
    if (!validColumnKey(key) || hidden.has(key) || seen.has(key)) return;
    seen.add(key);
    keys.push(key);
  };
  for (const key of input.savedOrder) push(key);
  for (const key of defaults) push(key);
  return keys.map((key) => {
    if (key === 'all') return { key, address: EVERYONE_ADDRESS, title: 'みんな', missing: false };
    const id = key.slice(4);
    const name = input.names.get(id);
    if (!name) return { key, address: id, title: `宛て先なし（もと：${id}）`, missing: true };
    return { key, address: id, title: name, missing: false };
  });
}

// 今見えている列のうしろに 1 つ足す。みんなの列は足さない。隠していた列は戻す
export function withAddedColumn(current: readonly string[], hidden: readonly string[], key: string): { order: string[]; hidden: string[] } | null {
  if (!validColumnKey(key) || key === 'all') return null;
  const order = current.includes(key) ? [...current] : [...current, key];
  return { order, hidden: hidden.filter((item) => item !== key) };
}
