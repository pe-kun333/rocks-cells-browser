// 取り込み（hcb-memo-interchange v1）を新しいシートとして当てる・戻す（設計 §10・§11）
//   ・計算は memo-interchange.ts（純粋）。ここは台帳に足す・控え・記録・戻すときの小窓
//   ・当てる：やり直し → 前もって全部確かめる → 写し（patch-backups\<id>-before.json）→ extra → 同期で足す（失敗したら同期で巻き戻す）→ 戻し方と記録
//   ・台帳の保存は 400ms 置いて書く（memocells.ts の saveTimer・session の debounce）。足すのと巻き戻すのを同じ同期の中で済ませるので、途中の様子はディスクに残らない
//   ・戻す：記録の 1 件＝シートと中身。取り込んだあとに変わっていれば小窓（D5：「アーカイブしてから消す」がいちばん上）
import { type BoardLinkStore, MAX_BOARD_LINKS } from '../board-links';
import { type AppliedStep, fingerprint, type ImportSheetUndo, importChanges, importSheetState, type PatchBackup, type PatchHistoryItem, type PatchWorld } from '../grok-patch';
import { type Hex, nearestFree } from '../hex';
import type { IslandStore } from '../islands';
import { type IdMap, importPatchId, INTERCHANGE_REASON_TEXT, type InterchangeDoc, type InterchangePlan, type InterchangeWorld, type IxProblem, newImportId, parseInterchange, planInterchange, problemText } from '../memo-interchange';
import type { MemoCell, MemoStore } from '../memocells';
import type { MenuEntry } from '../panels/cell-menu';
import type { GrokPatchView, InterchangeChoiceState, InterchangeViewGroup } from '../panels/grok-patch-view';
import { MAX_SHEETS, type SheetStore } from '../sheets';
import type { PatchPreview } from '../sidebar';

export const INTERCHANGE_EXTRA_DIR = 'interchange-extra';

export type ArchiveResult = 'ok' | 'tooBig' | 'failed';

export interface InterchangeDeps {
  memos: MemoStore;
  sheets: SheetStore;
  islands: IslandStore;
  boardLinks: BoardLinkStore;
  patchWorld: PatchWorld;
  view: GrokPatchView;
  menu: { open(x: number, y: number, entries: MenuEntry[]): void; close(): void };
  toast(text: string, ms?: number): void;
  setPreview(preview: PatchPreview): void;
  readData<T>(name: string): Promise<T | null>;
  writeData(name: string, value: unknown): Promise<boolean>;
  deleteData(name: string): void;
  writeBefore(id: string): Promise<boolean>; // 当てる前の全部の写し（applyPatch と同じ buildExport）
  readHistory(): Promise<PatchHistoryItem[]>;
  writeHistory(items: PatchHistoryItem[]): Promise<boolean>;
  refusal(): string | null; // 今は当てられない理由（アーカイブの途中・閉じる途中・台帳を読めていない）
  ids: InterchangeWorld['ids'];
  usedIds(): Set<string>; // 手元の台帳にある id（シート・島・メモ・カード）
  maxMemos: number;
  maxIslands: number;
  portalPos(): { sheet: string; pos: Hex } | null; // 今のシートに入口を置く位置
  islandColor(n: number): string;
  sheetColor(): string;
  switchSheet(id: string): boolean;
  canArchive(id: string): boolean;
  archiveSheet(id: string): Promise<ArchiveResult>;
  render(): void;
  sourceText: Record<string, string>;
}

const SOURCE_KINDS = new Set(['file', 'drop', 'inbox', 'mock']);

export function createInterchangeFlow(d: InterchangeDeps) {
  const world = (): InterchangeWorld => ({
    now: Date.now(),
    ids: d.ids,
    taken: d.usedIds(),
    counts: { sheets: d.sheets.list().length, memos: d.memos.list().length, islands: d.islands.list().length, boardLinks: d.boardLinks.list().length },
    limits: { sheets: MAX_SHEETS, memos: d.maxMemos, islands: d.maxIslands, boardLinks: MAX_BOARD_LINKS },
    sheetColor: d.sheetColor,
    islandColor: d.islandColor,
    portal: d.portalPos(),
  });

  const toChoice = (c: InterchangeChoiceState) => ({ memos: c.memos, skipIslands: c.skipIslands, portal: c.portal });

  // 取り込みファイルを開いて一覧を出す（raw は JSON を読んだもの。text は記録の印に使う）
  function open(raw: unknown, text: string, source: string, after?: () => void): boolean {
    const parsed = parseInterchange(raw);
    if (!parsed.ok) {
      const why = parsed.reason === 'badVersion' && parsed.version !== undefined ? `新しい版（v${parsed.version}）の取り込みファイルです。v1 まで読めます` : INTERCHANGE_REASON_TEXT[parsed.reason];
      d.toast(`取り込みファイルを読めませんでした（${why}）`, 7000);
      return false;
    }
    const refusal = d.refusal();
    if (refusal) {
      d.toast(`${refusal}（取り込みはできません）`, 6000);
      return false;
    }
    d.menu.close();
    const { doc, problems } = parsed;
    const first = planInterchange(doc, world(), {}, undefined, problems);
    const map = first.map;
    const groups = viewGroups(doc, first);
    const when = doc.generatedAt && Number.isFinite(Date.parse(doc.generatedAt)) ? `・作られた日時 ${new Date(doc.generatedAt).toLocaleString()}` : '';
    const portal = first.portal;
    d.view.openInterchange({
      title: first.sheet.name,
      meta: `${d.sourceText[source] ?? source}${when}`,
      ...(doc.requestNote ? { note: doc.requestNote } : {}),
      sheetName: first.sheet.name,
      portalText: portal ? `今のシートに入口を置く（位置 ${portal.pos.q},${portal.pos.r}）` : null,
      groups,
      initial: { memos: new Set(doc.memos.map((m) => m.key)), skipIslands: new Set(), portal: !!portal },
      replan: (choice) => {
        const plan = planInterchange(doc, world(), toChoice(choice), map, problems);
        const t = plan.totals;
        const islandOf = new Map(plan.islands.filter((i) => i.create).map((i) => [i.key, i.color]));
        d.setPreview({ islands: [], links: [], cells: plan.portal ? [{ pos: plan.portal.pos, color: plan.sheet.color, label: '入口' }] : [] });
        return {
          summary: `新しいシートを 1 枚作ります：メモ ${t.memos}・カード ${t.cards}（Grok Bot ${t.botCards}・取り込み ${t.importCards}）・カードの関連 ${t.cardLinks}・盤面の線 ${t.boardLinks}・島 ${t.islands}`,
          warnings: plan.problems.map(problemText),
          links: `${t.boardLinks} 本を引きます（両端のメモを選んだものだけ）`,
          blocked: plan.blocked,
          applyLabel: `反映する（メモ ${t.memos}）`,
          board: {
            memos: plan.rows.map((r) => ({ key: r.key, pos: r.pos, color: r.island && !choice.skipIslands.has(r.island) ? (islandOf.get(r.island) ?? null) : null, selected: r.selected, bot: r.bot, title: r.title })),
            links: plan.boardLinks.map((l) => ({ fromKey: l.fromKey, toKey: l.toKey, kind: l.kind, selected: l.selected })),
          },
          portal: plan.portal,
        };
      },
      onApply: (choice) => void apply(doc, problems, text, map, choice, source).then((ok) => ok && after?.()),
      onClose: () => d.setPreview({ islands: [], links: [] }),
    });
    return true;
  }

  // 一覧のまとまり（島ごと。島なし・作れない島は最後に）
  function viewGroups(doc: InterchangeDoc, plan: InterchangePlan): InterchangeViewGroup[] {
    const rowsByKey = new Map(plan.rows.map((r) => [r.key, r]));
    const cellById = new Map(plan.cells.map((c) => [c.id, c]));
    const viewRow = (key: string) => {
      const r = rowsByKey.get(key);
      if (!r) return null;
      const cell = cellById.get(r.id);
      const tops = (cell?.replies ?? []).filter((x) => x.parent === null).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
      const bits = [`カード ${r.cards}${r.botCards ? `（Grok Bot ${r.botCards}${r.opinions.length ? ` 💬${r.opinions.join('・')}` : ''}）` : ''}`, ...(r.cardLinks ? [`関連 ${r.cardLinks}`] : []), ...(r.tags ? [`タグ ${r.tags}`] : []), ...(r.bot ? ['Grok Bot'] : [])];
      return { key, title: r.title, detail: bits.join('・'), cards: tops.map((x) => [...(x.text.split('\n')[0] ?? '')].slice(0, 40).join('') || '（文なし）') };
    };
    const groups: InterchangeViewGroup[] = [];
    const placed = new Set<string>();
    for (const i of plan.islands) {
      if (!i.create && !i.overLimit) continue;
      const rows = i.memoKeys.map(viewRow).filter((r): r is NonNullable<ReturnType<typeof viewRow>> => !!r);
      for (const r of rows) placed.add(r.key);
      groups.push({ key: i.key, name: i.name, color: i.color, ...(i.overLimit ? { note: '島の上限（50）で作れません。メモは島なしで取り込みます' } : {}), rows });
    }
    const rest = doc.memos.map((m) => m.key).filter((k) => !placed.has(k));
    groups.push({ key: null, name: '島なし', color: null, rows: rest.map(viewRow).filter((r): r is NonNullable<ReturnType<typeof viewRow>> => !!r) });
    return groups;
  }

  // 当てる（§10.2）
  async function apply(doc: InterchangeDoc, problems: IxProblem[], text: string, map: IdMap, choice: InterchangeChoiceState, source: string): Promise<boolean> {
    // 1. やり直し（一覧を出してから変わったかもしれない）
    const plan = planInterchange(doc, world(), toChoice(choice), map, problems);
    // 2. 前もって全部確かめる（足し始めたら止めない）
    const refusal = d.refusal();
    const stop = refusal ?? plan.blocked;
    if (stop) {
      d.toast(`取り込めませんでした：${stop}（何も変えていません）`, 7000);
      return false;
    }
    if (d.islands.list().length + plan.totals.islands > d.maxIslands) {
      d.toast('島が多すぎて取り込めませんでした（何も変えていません）', 7000);
      return false;
    }
    const id = newImportId();
    // 3. 写し
    if (!(await d.writeBefore(id))) {
      d.toast('取り込む前の写しを書けなかったので、取り込みませんでした（ui-data\\patch-backups に書けません）', 7000);
      return false;
    }
    // 4. extra を先に書く
    const sourceKind = SOURCE_KINDS.has(source) ? source : 'file';
    const extraName = `${INTERCHANGE_EXTRA_DIR}/${id}.json`;
    if (!(await d.writeData(extraName, plan.buildExtra(id, sourceKind, Date.now())))) {
      d.toast('取り込みの残りの項目（extra）を書けなかったので、取り込みませんでした（何も変えていません）', 7000);
      return false;
    }
    // 書いている間に変わったかもしれないので、もう一度確かめる（ここから先は同期）
    const late = d.refusal();
    const again = planInterchange(doc, world(), toChoice(choice), plan.map, problems);
    if (late || again.blocked || again.map !== plan.map) {
      d.deleteData(extraName);
      d.toast(`取り込めませんでした：${late ?? again.blocked ?? '書いている間に台帳が変わりました。もう一度開いてください'}（何も変えていません）`, 7000);
      return false;
    }
    // 5. 足す（同期で、間に await を入れない）
    const created = { islands: [] as string[], sheet: null as string | null, memos: [] as string[], portals: [] as string[], links: [] as string[] };
    let linkMisses = 0;
    let failure: string | null = null;
    try {
      for (const i of again.islands) {
        if (!i.create) continue;
        d.islands.add({ id: i.id, name: i.name, color: i.color });
        created.islands.push(i.id);
      }
      // シートは計画の id のまま足す（extra・記録の id と合わせるため。sheets.add は id を作り直すので、アーカイブの戻しと同じ restore を使う）
      const added = d.sheets.restore({ id: again.sheet.id, name: again.sheet.name, color: again.sheet.color, createdAt: Date.now() }, true);
      if (added !== 'added') throw new Error(added === null ? 'シートが多すぎます' : 'シートの id が重なりました');
      const sheet = { id: again.sheet.id };
      created.sheet = sheet.id;
      const cells: MemoCell[] = again.cells;
      const relocate = (m: MemoCell) => nearestFree(m.pos, (h) => !!d.memos.at(h, m.sheet));
      const { restored } = d.memos.restore(cells, relocate);
      for (const m of restored) created.memos.push(m.id);
      if (restored.length !== cells.length) throw new Error('メモを足せませんでした');
      if (again.portal) {
        const portal = d.memos.add({ sheet: again.portal.sheet, pos: again.portal.pos, text: '', portal: sheet.id });
        if (portal) created.portals.push(portal.id);
      }
      for (const l of again.boardLinks) {
        if (!l.selected) continue;
        const done = d.boardLinks.add(l.from, l.to, l.kind);
        if (typeof done === 'object') created.links.push(done.id);
        else linkMisses++;
      }
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }
    if (failure) {
      // 6. 巻き戻し（同期）
      d.boardLinks.removeCells([...created.memos, ...created.portals].map((m) => `m:${m}`));
      for (const m of [...created.memos, ...created.portals]) d.memos.remove(m);
      if (created.sheet) d.sheets.remove(created.sheet);
      for (const i of created.islands) d.islands.remove(i);
      d.deleteData(extraName);
      d.toast(`取り込めませんでした（${failure}。何も変えていません）`, 7000);
      return false;
    }
    const sheetId = created.sheet as string;
    // 7. 戻し方と記録
    const undo: ImportSheetUndo = { r: 'importSheet', sheet: sheetId, memos: created.memos, portals: created.portals, islands: created.islands, boardLinks: created.links, extra: id };
    const step: AppliedStep = { label: `シート「${again.sheet.name}」を取り込み`, undo, after: fingerprint(d.patchWorld, undo) };
    const at = new Date().toISOString();
    const title = `取り込み：${again.sheet.name}`;
    const patchId = importPatchId(doc, text);
    const skipped = again.problems.reduce((n, p) => n + p.count, 0) + linkMisses;
    const backup: PatchBackup = { v: 1, id, patchId, title, source: sourceKind, appliedAt: at, steps: [step], skipped };
    const wrote = await d.writeData(`patch-backups/${id}.json`, backup);
    const history = await d.readHistory();
    history.unshift({ id, patchId, title, source: sourceKind, at, applied: created.memos.length, skipped });
    await d.writeHistory(history.slice(0, 100));
    d.render();
    d.switchSheet(sheetId);
    const t = again.totals;
    d.toast(
      `シート「${again.sheet.name}」を取り込みました（メモ ${created.memos.length}・カード ${t.cards}・線 ${created.links.length}）。${wrote ? '戻すときは、シートの名前 ▾ →「Grok の提案の記録…」' : '戻し方を書けなかったので、この分は記録から戻せません'}`,
      9000,
    );
    return true;
  }

  // 戻す（§11.2）。記録の控えが取り込みのものなら true（提案の戻し方は使わない）
  function isImportBackup(b: PatchBackup): boolean {
    return b.steps.length === 1 && b.steps[0].undo.r === 'importSheet';
  }

  async function undo(b: PatchBackup, x: number, y: number) {
    const step = b.steps[0];
    const u = step.undo as ImportSheetUndo;
    const now = importSheetState(u, d.patchWorld.importView(u));
    if (!now) {
      // シートがもう無い（手で消した・アーカイブした）：作った島が空なら消すだけ。線は触らない（アーカイブから戻せば、またつながる）
      cleanupIslands(u);
      await finish(b, 'gone');
      d.toast('取り込んだシートは、もう消えています（記録を「戻しました」にしました）', 6000);
      return;
    }
    const sheetName = d.sheets.get(u.sheet)?.name ?? '';
    if (JSON.stringify(now) === step.after) {
      d.menu.open(x, y, [
        { section: `シート「${sheetName}」を元に戻します` },
        { note: `取り込んだシートと中身（メモ ${u.memos.length}・入口 ${u.portals.length}・線 ${u.boardLinks.length}・島 ${u.islands.length}）を消します。当てる前の写しは ui-data\\patch-backups に残ります` },
        { label: '消す', run: () => void runUndo(b, u, 'sheet') },
        { label: 'やめる', run: () => d.menu.close() },
      ]);
      return;
    }
    const c = importChanges(u, step.after, now);
    const bits = [
      ...(c.edited ? [`直したメモ ${c.edited}`] : []),
      ...(c.added ? [`足したメモ ${c.added}`] : []),
      ...(c.removed ? [`消した・動かしたメモ ${c.removed}`] : []),
      ...(c.tabs ? [`開いたタブ ${c.tabs}`] : []),
      ...(c.links ? [`足した線 ${c.links}`] : []),
      ...(c.islandMembers ? [`島に足したセル ${c.islandMembers}`] : []),
    ];
    const entries: MenuEntry[] = [{ section: `シート「${sheetName}」は、取り込んだあとに変わっています` }, { note: `・${bits.join('／') || '並べ替えなど'}` }];
    // D5：アーカイブしてから消す（あとで戻せる）がいちばん上・おすすめ
    if (d.canArchive(u.sheet)) entries.push({ label: 'アーカイブしてから消す（おすすめ）', hint: 'あとで戻せます', run: () => void archiveThenUndo(b, u, x, y) });
    entries.push(
      { label: 'シートごと消す', hint: `足したもの・直したもの${c.tabs ? `・タブ ${c.tabs}` : ''}も消えます`, run: () => void runUndo(b, u, 'sheet') },
      { label: '取り込んだものだけ消す', hint: `シートと足したものは残します${c.edited ? `（直したメモ ${c.edited} も消えます）` : ''}`, run: () => void runUndo(b, u, 'imported') },
      { label: 'やめる', run: () => d.menu.close() },
    );
    d.menu.open(x, y, entries);
  }

  async function archiveThenUndo(b: PatchBackup, u: ImportSheetUndo, x: number, y: number) {
    d.menu.close();
    const result = await d.archiveSheet(u.sheet);
    if (result === 'tooBig') {
      // 黙って消す道へ進まない：小窓を出し直す
      d.menu.open(x, y, [
        { section: '大きすぎてアーカイブできません' },
        { note: 'シートごと消すか、やめるを選んでください（シートはそのままです）' },
        { label: 'シートごと消す', run: () => void runUndo(b, u, 'sheet') },
        { label: 'やめる', run: () => d.menu.close() },
      ]);
      return;
    }
    if (result !== 'ok') return; // アーカイブの側が理由を知らせる。シートはそのまま
    // アーカイブで盤面から片付いた（シートと入口は消えた）。線は残す（戻せば、またつながる）。空になった島だけ片付ける（島はアーカイブに入っている）
    cleanupIslands(u);
    await finish(b, 'archive');
    d.toast('取り込んだシートをアーカイブしてから消しました（アーカイブの一覧から戻せます）', 7000);
  }

  async function runUndo(b: PatchBackup, u: ImportSheetUndo, mode: 'sheet' | 'imported') {
    d.menu.close();
    d.patchWorld.removeImport(u, mode);
    await finish(b, mode);
    d.toast(mode === 'sheet' ? '取り込んだシートを消しました' : '取り込んだメモ・入口・線・島を消しました（シートは残しました）', 6000);
  }

  function cleanupIslands(u: ImportSheetUndo) {
    const view = d.patchWorld.importView(u);
    for (const id of u.islands) if (d.islands.get(id) && view.islandMembers(id) === 0) d.islands.remove(id);
  }

  async function finish(b: PatchBackup, mode: 'sheet' | 'imported' | 'archive' | 'gone') {
    const at = new Date().toISOString();
    const u = b.steps[0].undo as ImportSheetUndo;
    await d.writeData(`patch-backups/${b.id}.json`, { ...b, undoneAt: at, undoMode: mode });
    d.deleteData(`${INTERCHANGE_EXTRA_DIR}/${u.extra}.json`);
    const history = await d.readHistory();
    await d.writeHistory(history.map((h) => (h.id === b.id ? { ...h, undoneAt: at } : h)));
    d.render();
  }

  return { open, undo, isImportBackup };
}

