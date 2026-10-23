// 整理のパネル（右サイドバー）：タグと島
//   ・タグの一覧（押すと、そのタグのタブだけを盤面で目立たせる）
//   ・いいね1・2・3（タブとメモの ♥ の段階。押すと、その段階だけを目立たせる。タグとは同時に付かない）
//   ・AI でタグを付ける / 島を提案する → 案を確かめてから反映（島の案は、盤面に点線で寄せた後の形を見せる）
//   ・島の一覧（解散できる）。「この島を頼む」は、選んだメモを依頼の小窓へ入れる（段階16。アプリは開かない）
import { checkBatch, type OrganizeKind, type OrganizeSettings, type PendingBatch, type Proposal, proposeLater, proposeNow } from '../ai/organize';
import type { Tab } from '../tabs';
import { LIKE_COLOR, LIKE_LABEL, type LikeLevel, likeLevel } from '../likes';
import { TAG_PALETTE, tagColor } from '../tags';
import type { Island, IslandDraft, RelayCommand } from '../types';
import { el } from '../util';

export interface OrganizeHost {
  tabs(): Tab[];
  islands(): Island[];
  highlightTag(): string | null;
  highlightLike(): LikeLevel | null;
  memos(): readonly { liked?: number }[] | null; // メモのいいねを数える（まだ届いていなければ null）
  settings(): OrganizeSettings; // AI の設定（キー・練習モード・モデル）
  registeredTags(): Promise<string[]>; // 六角メモに登録してあるタグ
  askLeft(action: RelayCommand): void;
}

const BATCH_KEY = 'honeycomb.organize.batch';
const BATCH_CHECK_MS = 30_000;
const KIND_LABELS: Record<OrganizeKind, string> = { tags: 'タグ付け', islands: '島の提案' };

export class OrganizePanel {
  readonly element = el('section', 'panel-section organize-panel');
  private readonly cloud = el('div', 'organize-cloud');
  private readonly status = el('div', 'panel-note organize-status');
  private readonly proposalBox = el('div', 'organize-proposal');
  private readonly islandList = el('div', 'organize-islands');
  private readonly later = el('input');
  private readonly buttons: HTMLButtonElement[] = [];
  private proposal: Proposal | null = null;
  private rejected = new Set<number>(); // 案の中で、外したもの（タグ：タブの id、島：島の番号）
  private drafts: IslandDraft[] = []; // 島の案（色つき）
  private busy = false;
  private pending: PendingBatch | null = loadPending();
  private ask: { islandId: string; name: string; memos: { id: string; title: string }[]; more: number; checked: Set<string> } | null = null;

  constructor(private readonly host: OrganizeHost) {
    const tagsButton = el('button', 'ai-small', 'AI でタグを付ける');
    tagsButton.addEventListener('click', () => void this.propose('tags'));
    const islandsButton = el('button', 'ai-small', 'AI で島を提案');
    islandsButton.addEventListener('click', () => void this.propose('islands'));
    this.buttons.push(tagsButton, islandsButton);
    const row = el('div', 'ai-row');
    row.append(tagsButton, islandsButton);
    this.later.type = 'checkbox';
    const laterLabel = el('label', 'ai-check');
    laterLabel.append(this.later, document.createTextNode('急がない（バッチで半額。数分〜1時間ほど）'));

    this.element.append(
      el('div', 'panel-subtitle', '整理（タグと島）'),
      this.cloud,
      row,
      laterLabel,
      this.status,
      this.proposalBox,
      this.islandList,
    );
    window.setInterval(() => void this.checkPending(), BATCH_CHECK_MS);
    window.setTimeout(() => void this.checkPending(), 3000);
    this.render();
  }

  // 左が「この島を頼む」のメモ一覧を渡したとき（全文はまだ無い）
  showAsk(pick: { islandId: string; name: string; memos: { id: string; title: string }[]; more: number }) {
    this.ask = { ...pick, checked: new Set(pick.memos.map((memo) => memo.id)) };
    this.render();
    this.element.scrollIntoView({ block: 'nearest' });
  }

  // タブや島が変わったとき（左サイドバーから写しが届いたとき）
  render() {
    this.renderCloud();
    this.renderIslands();
    for (const b of this.buttons) b.disabled = this.busy || this.pending !== null;
    if (this.pending && !this.busy) {
      this.status.textContent = `${KIND_LABELS[this.pending.kind]}をバッチで頼んでいます（${timeOf(this.pending.createdAt)} から。終わると、ここに案が出ます）`;
    }
  }

  // ---------- タグの一覧 ----------

  private renderCloud() {
    const counts = new Map<string, number>();
    for (const tab of this.host.tabs()) for (const tag of tab.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    const likeCounts = new Map<LikeLevel, number>();
    const addLike = (value: unknown) => {
      const level = likeLevel(value);
      if (!level) return;
      likeCounts.set(level, (likeCounts.get(level) ?? 0) + 1);
    };
    for (const tab of this.host.tabs()) addLike(tab.liked);
    for (const memo of this.host.memos() ?? []) addLike(memo.liked);
    const likes = ([1, 2, 3] as const).flatMap((level) => {
      const n = likeCounts.get(level) ?? 0;
      return n > 0 ? [this.likeChip(level, n)] : [];
    });
    const current = this.host.highlightTag();
    if (counts.size === 0 && likes.length === 0) {
      this.cloud.replaceChildren(el('div', 'reminder-empty', 'タグはまだありません。拡大表示のカードの「＋タグ」か、下のボタンで付けられます'));
      return;
    }
    const chips = [...counts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))
      .map(([tag, n]) => {
        const chip = el('button', tag === current ? 'tag-chip tag-button selected' : 'tag-chip tag-button', `${tag} ${n}`);
        chip.style.setProperty('--tag', tagColor(tag));
        chip.title = tag === current ? '絞り込みをやめる' : `「${tag}」のタブだけを盤面で目立たせる`;
        chip.setAttribute('aria-pressed', String(tag === current));
        chip.addEventListener('click', () => this.host.askLeft({ command: 'highlightTag', tag: tag === current ? null : tag }));
        return chip;
      });
    this.cloud.replaceChildren(...likes, ...chips);
  }

  // いいねの丸ボタン。見た目はタグと同じで、印だけ ♥。もう一度押すと外れる
  private likeChip(level: LikeLevel, count: number): HTMLButtonElement {
    const on = this.host.highlightLike() === level;
    const label = LIKE_LABEL[level];
    const chip = el('button', on ? 'tag-chip tag-button like-chip selected' : 'tag-chip tag-button like-chip', `${label} ${count}`);
    chip.type = 'button';
    chip.dataset.like = String(level);
    chip.style.setProperty('--tag', LIKE_COLOR);
    chip.title = on ? '絞り込みをやめる' : `「${label}」のタブとメモだけを盤面で目立たせる`;
    chip.setAttribute('aria-pressed', String(on));
    chip.addEventListener('click', () => this.host.askLeft({ command: 'highlightLike', level: on ? null : level }));
    return chip;
  }

  // ---------- 島の一覧 ----------

  private renderIslands() {
    const counts = new Map<string, number>();
    for (const tab of this.host.tabs()) if (tab.island) counts.set(tab.island, (counts.get(tab.island) ?? 0) + 1);
    const islands = this.host.islands().filter((i) => counts.has(i.id));
    if (this.ask && !this.host.islands().some((island) => island.id === this.ask?.islandId)) this.ask = null;
    if (islands.length === 0 && !this.ask) {
      this.islandList.replaceChildren();
      return;
    }
    const rows = islands.map((island) => {
      const row = el('div', 'organize-row');
      const swatch = el('span', 'island-swatch');
      swatch.style.setProperty('--data', island.color);
      const ask = el('button', 'ai-small', 'この島を頼む');
      ask.title = 'この島の名前と、入っているメモ、今選んでいるメモを、依頼の小窓に入れます。となりのメモは集めません。アプリは開きません';
      ask.addEventListener('click', () => this.host.askLeft({ command: 'openIslandAsk', islandId: island.id }));
      const remove = el('button', 'ai-small', '解散');
      remove.title = '島をなくす（タブはそのまま残ります）';
      remove.addEventListener('click', () => this.host.askLeft({ command: 'removeIsland', id: island.id }));
      row.append(swatch, el('span', 'organize-name', island.name), el('span', 'organize-count', `${counts.get(island.id)} 個`), ask, remove);
      return row;
    });
    this.islandList.replaceChildren(el('div', 'organize-heading', '島'), ...(this.ask ? [this.askBox(this.ask)] : []), ...rows);
  }

  private askBox(ask: NonNullable<OrganizePanel['ask']>): HTMLElement {
    const box = el('div', 'vocab-lesson');
    box.append(el('div', 'route-list-label', `島「${ask.name}」を頼む`));
    box.append(
      el(
        'p',
        'panel-note',
        '入れるメモに印を付けてください。となりのメモは出していません。ページの本文は入れません。小窓へ入れたあと、コピーするまでアプリは開きません。',
      ),
    );
    if (ask.memos.length === 0) box.append(el('p', 'panel-note', 'メモはありません。島の名前だけを小窓に入れます。'));
    for (const memo of ask.memos) {
      const row = el('label', 'vocab-proposal');
      const check = el('input');
      check.type = 'checkbox';
      check.checked = ask.checked.has(memo.id);
      check.addEventListener('change', () => {
        if (check.checked) ask.checked.add(memo.id);
        else ask.checked.delete(memo.id);
      });
      row.append(check, el('span', 'vocab-proposal-text', memo.title));
      box.append(row);
    }
    if (ask.more > 0) box.append(el('p', 'panel-note', `ほか ${ask.more} 件は、一度には入れません。`));
    const go = el('button', 'ai-small', '小窓へ入れる');
    go.type = 'button';
    go.addEventListener('click', () => {
      const memoIds = [...ask.checked];
      const islandId = ask.islandId;
      this.ask = null;
      this.render();
      this.host.askLeft({ command: 'fillIslandAsk', islandId, memoIds });
    });
    const cancel = el('button', 'ai-small', 'やめる');
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      this.ask = null;
      this.render();
    });
    const actions = el('div', 'ai-row');
    actions.append(go, cancel);
    box.append(actions);
    return box;
  }

  // ---------- AI に案を頼む ----------

  private async propose(kind: OrganizeKind) {
    const tabs = this.host.tabs();
    if (tabs.length < (kind === 'islands' ? 2 : 1)) {
      this.status.textContent = kind === 'islands' ? '島に分けるには、タブが2つ以上必要です' : 'タブがありません';
      return;
    }
    const settings = this.host.settings();
    if (!settings.practice && !settings.apiKey) {
      this.status.textContent = 'AI の ⚙ で API キーを設定するか、練習モードにしてください';
      return;
    }
    this.clearProposal();
    this.busy = true;
    this.render();
    try {
      const registered = kind === 'tags' ? await this.host.registeredTags() : [];
      if (this.later.checked && !settings.practice) {
        this.status.textContent = 'バッチで頼んでいます…';
        this.pending = await proposeLater(kind, tabs, registered, settings);
        savePending(this.pending);
      } else {
        this.status.textContent = `${KIND_LABELS[kind]}の案を考えています…（タブ ${tabs.length} 個）`;
        this.show(await proposeNow(kind, tabs, registered, settings));
      }
    } catch (error) {
      this.status.textContent = `うまくいきませんでした：${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async checkPending() {
    const pending = this.pending;
    const settings = this.host.settings();
    if (!pending || this.busy || !settings.apiKey) return;
    try {
      const proposal = await checkBatch(pending, this.host.tabs(), settings.apiKey);
      if (!proposal) return;
      this.pending = null;
      savePending(null);
      this.show(proposal);
    } catch (error) {
      this.pending = null;
      savePending(null);
      this.status.textContent = `バッチがうまくいきませんでした：${error instanceof Error ? error.message : String(error)}`;
    }
    this.render();
  }

  // ---------- 案を見せる・反映する ----------

  private show(proposal: Proposal) {
    this.proposal = proposal;
    this.rejected.clear();
    const cost = proposal.cost > 0 ? `（約 $${proposal.cost.toFixed(3)}${proposal.batch ? '・バッチで半額' : ''}）` : '';
    if (proposal.kind === 'tags') {
      this.status.textContent = proposal.items.length > 0 ? `タグの案ができました${cost}。外したいものは印を消してください` : `足すタグはありませんでした${cost}`;
    } else {
      const used = new Set(this.host.islands().map((i) => i.color));
      const colors = [...TAG_PALETTE.filter((c) => !used.has(c)), ...TAG_PALETTE];
      this.drafts = proposal.islands.map((island, i) => ({ name: island.name, color: colors[i % colors.length], tabIds: island.tabIds, reason: island.reason }));
      this.status.textContent = this.drafts.length > 0 ? `島の案ができました${cost}。盤面に点線で、まとめた後の形を出しています` : `島に分ける案はありませんでした${cost}`;
      this.previewDrafts();
    }
    this.renderProposal();
  }

  private renderProposal() {
    const proposal = this.proposal;
    if (!proposal || (proposal.kind === 'tags' ? proposal.items.length === 0 : this.drafts.length === 0)) {
      this.proposalBox.replaceChildren();
      return;
    }
    const byId = new Map(this.host.tabs().map((t) => [t.id, t]));
    const rows: HTMLElement[] = [];
    if (proposal.kind === 'tags') {
      for (const item of proposal.items) {
        const tab = byId.get(item.id);
        if (!tab) continue;
        const row = el('label', 'organize-row');
        row.append(this.checkbox(item.id), el('span', 'organize-name', tab.title || tab.url));
        for (const tag of item.tags) {
          const chip = el('span', 'tag-chip', tag);
          chip.style.setProperty('--tag', tagColor(tag));
          row.append(chip);
        }
        rows.push(row);
      }
    } else {
      this.drafts.forEach((draft, i) => {
        const row = el('label', 'organize-row organize-island');
        const swatch = el('span', 'island-swatch');
        swatch.style.setProperty('--data', draft.color);
        const titles = draft.tabIds.map((id) => byId.get(id)?.title || byId.get(id)?.url || '').filter(Boolean);
        const text = el('span', 'organize-name');
        text.append(el('strong', '', draft.name), el('span', 'organize-count', ` ${draft.tabIds.length} 個`));
        const detail = el('div', 'organize-detail', `${draft.reason ? `${draft.reason}\n` : ''}${titles.map((t) => `・${t}`).join('\n')}`);
        const body = el('div', 'organize-island-body');
        body.append(text, detail);
        row.append(this.checkbox(i), swatch, body);
        rows.push(row);
      });
    }
    const apply = el('button', 'ai-small ai-yes', proposal.kind === 'tags' ? 'タグを付ける' : '島にする');
    apply.addEventListener('click', () => this.apply());
    const cancel = el('button', 'ai-small', 'やめる');
    cancel.addEventListener('click', () => {
      this.clearProposal();
      this.status.textContent = '';
    });
    const actions = el('div', 'ai-row');
    actions.append(apply, cancel);
    this.proposalBox.replaceChildren(...rows, actions);
  }

  private checkbox(key: number) {
    const box = el('input');
    box.type = 'checkbox';
    box.checked = !this.rejected.has(key);
    box.addEventListener('change', () => {
      if (box.checked) this.rejected.delete(key);
      else this.rejected.add(key);
      if (this.proposal?.kind === 'islands') this.previewDrafts();
    });
    return box;
  }

  private previewDrafts() {
    const chosen = this.drafts.filter((_, i) => !this.rejected.has(i));
    this.host.askLeft({ command: 'previewIslands', islands: chosen.length > 0 ? chosen : null });
  }

  private apply() {
    const proposal = this.proposal;
    if (!proposal) return;
    if (proposal.kind === 'tags') {
      const changes = proposal.items.filter((i) => !this.rejected.has(i.id));
      if (changes.length > 0) this.host.askLeft({ command: 'addTags', changes });
      this.status.textContent = `${changes.length} 個のタブにタグを付けました`;
    } else {
      const chosen = this.drafts.filter((_, i) => !this.rejected.has(i));
      if (chosen.length > 0) this.host.askLeft({ command: 'createIslands', islands: chosen });
      this.status.textContent = `${chosen.length} 個の島を作りました`;
    }
    this.proposal = null;
    this.drafts = [];
    this.proposalBox.replaceChildren();
  }

  private clearProposal() {
    if (this.proposal?.kind === 'islands') this.host.askLeft({ command: 'previewIslands', islands: null });
    this.proposal = null;
    this.drafts = [];
    this.rejected.clear();
    this.proposalBox.replaceChildren();
  }
}

function loadPending(): PendingBatch | null {
  try {
    const saved = JSON.parse(localStorage.getItem(BATCH_KEY) ?? 'null') as PendingBatch | null;
    return saved && typeof saved.id === 'string' && (saved.kind === 'tags' || saved.kind === 'islands') ? saved : null;
  } catch {
    return null;
  }
}

function savePending(pending: PendingBatch | null) {
  try {
    if (pending) localStorage.setItem(BATCH_KEY, JSON.stringify(pending));
    else localStorage.removeItem(BATCH_KEY);
  } catch {
    // 保存できなくても動作は続ける
  }
}

function timeOf(ms: number) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
