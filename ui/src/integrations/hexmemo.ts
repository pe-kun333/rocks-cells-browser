// 六角メモへ送る。六角メモの「コピーして送る」と同じ受け取り口（inbox）を使い、取り込むのは六角メモ自身
//   送り先は「ノート」で、そのノートの原点の下の階層の空いたマスに置かれる
import { request } from '../bridge';
import { normalizeTag, setRegisteredTagColors } from '../tags';
import type { HexMemoBoardMemo, HexMemoCatalog, HexMemoRecord } from '../types';

export interface HexMemoTarget {
  appId: string | null;
  boardId: string;
  label: string; // 「六角メモ › ノート 1」のような見出し
}

export async function loadCatalog(): Promise<HexMemoCatalog> {
  const reply = await request((requestId) => ({ type: 'hexMemoCatalog', requestId }));
  return reply?.type === 'hexMemoCatalog' ? reply : { available: false, apps: [] };
}

// ノートのメモをすべて読む（読むだけ）
export async function readBoard(target: HexMemoTarget): Promise<{ ok: true; memos: HexMemoBoardMemo[]; truncated: boolean } | { ok: false; error: string }> {
  const reply = await request((requestId) => ({ type: 'hexMemoReadBoard', requestId, appId: target.appId, boardId: target.boardId }));
  if (reply?.type !== 'hexMemoBoard') return { ok: false, error: '六角メモのノートを読めませんでした' };
  if (!reply.ok) return { ok: false, error: reply.error ?? '六角メモのノートを読めませんでした' };
  return { ok: true, memos: reply.memos ?? [], truncated: reply.truncated === true };
}

// 六角メモに登録してあるタグを読み、色をそろえる。タグの名前の一覧を返す（六角メモが無ければ空）
export async function loadTagRegistry(): Promise<string[]> {
  const catalog = await loadCatalog();
  const tags = (catalog.tags ?? [])
    .map((t) => ({ name: normalizeTag(t.name), color: t.color }))
    .filter((t) => t.name);
  setRegisteredTagColors(tags);
  return tags.map((t) => t.name);
}

// 相棒の ⚙ で選んだ送り先（どの面からでも同じ保存場所を読む）
export function savedHexMemoTarget(): HexMemoTarget | null {
  try {
    const s = JSON.parse(localStorage.getItem('honeycomb.ai') ?? '{}') as { hexMemoTarget?: Partial<HexMemoTarget> | null };
    const t = s.hexMemoTarget;
    return t && typeof t.boardId === 'string' && typeof t.label === 'string' ? { appId: t.appId ?? null, boardId: t.boardId, label: t.label } : null;
  } catch {
    return null;
  }
}

// 送り先の選択肢（メモアプリ › 親のノート › ノート）
export function targetsOf(catalog: HexMemoCatalog): HexMemoTarget[] {
  const out: HexMemoTarget[] = [];
  for (const app of catalog.apps) {
    const byId = new Map(app.boards.map((b) => [b.id, b]));
    const pathOf = (id: string, depth = 0): string[] => {
      const board = byId.get(id);
      if (!board || depth > 10) return [];
      return board.parentId ? [...pathOf(board.parentId, depth + 1), board.name] : [board.name];
    };
    for (const board of app.boards) {
      out.push({ appId: app.id, boardId: board.id, label: [app.name, ...pathOf(board.id)].join(' › ') });
    }
  }
  return out;
}

export type SendOutcome =
  | { ok: true; placed: number; where: string }
  | { ok: true; pending: true; message: string }
  | { ok: false; error: string };

// 送って、六角メモが取り込むのを少し待つ
//   offsets：マスどうしの並び（records と同じ数）。渡すと、その形のまま置いてもらう（空きが無ければ近くに1つずつ）
export async function sendToHexMemo(target: HexMemoTarget, records: HexMemoRecord[], offsets?: { dq: number; dr: number }[]): Promise<SendOutcome> {
  const sent = await request((requestId) => ({ type: 'hexMemoSend', requestId, appId: target.appId, boardId: target.boardId, records, offsets }));
  if (sent?.type !== 'hexMemoSent') return { ok: false, error: 'ブラウザ本体から返事がありませんでした' };
  if (!sent.ok || !sent.id) return { ok: false, error: sent.error ?? '送れませんでした' };
  if (sent.status === 'old') {
    return { ok: true, pending: true, message: '六角メモが古い版のまま動いています。六角メモを起動し直すと受け取ります' };
  }
  if (!sent.signaled) {
    return { ok: true, pending: true, message: '受け取り口に置きました。次に六角メモを開いたときに受け取ります' };
  }
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    await new Promise((r) => setTimeout(r, 500));
    const state = await request((requestId) => ({ type: 'hexMemoCheck', requestId, appId: target.appId, sendId: sent.id ?? '' }));
    if (state?.type !== 'hexMemoState') continue;
    if (state.state === 'done') {
      const result = state.result;
      if (!result?.ok) return { ok: false, error: `六角メモが受け取れませんでした：${result?.error ?? '不明なエラー'}` };
      return { ok: true, placed: result.placed?.length ?? 0, where: (result.boardPath ?? []).join(' › ') };
    }
    if (state.state === 'waiting' && state.reason) return { ok: true, pending: true, message: `六角メモがあとで受け取ります（${state.reason}）` };
    if (state.state === 'gone') break;
  }
  return { ok: true, pending: true, message: '受け取り口に置きました。六角メモが取り込むまで少しかかっています' };
}
