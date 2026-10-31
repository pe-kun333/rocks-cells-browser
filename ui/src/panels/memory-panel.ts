// 相棒が覚えていること（右サイドバーのパネル）
//   ・置き場所：このパソコン / 六角メモのノート（1つのマス＝1つの記憶。直す・消すのは六角メモで）
//   ・一覧、書き足す、直す・忘れる（このパソコンのときだけ）、会話から覚えることの案を作る
import { t as tr } from '../i18n';
import type { ChatEntry } from '../ai/companion';
import { type Memory, type MemoryStore, type MemorySuggestion, suggestMemories } from '../ai/memory';
import type { OrganizeSettings } from '../ai/organize';
import { type HexMemoTarget, loadCatalog, targetsOf } from '../integrations/hexmemo';
import { el } from '../util';

export interface MemoryPanelHost {
  store: MemoryStore;
  entries(): ChatEntry[]; // 今の会話（案を作るのに使う）
  settings(): OrganizeSettings;
}

export class MemoryPanel {
  readonly element = el('section', 'panel-section memory-panel');
  private readonly place = el('select');
  private readonly list = el('div', 'memory-list');
  private readonly status = el('div', 'panel-note organize-status');
  private readonly suggestions = el('div', 'organize-proposal');
  private readonly copyButton = el('button', 'ai-small', tr('このパソコンの記憶を送る'));
  private targets: HexMemoTarget[] | null = null;
  private editing: string | null = null; // 直している記憶

  constructor(private readonly host: MemoryPanelHost) {
    void this.loadTargets();
    this.place.addEventListener('change', () => void this.changePlace());
    const reload = el('button', 'ai-small', tr('読み直す'));
    reload.title = tr('置き場所から読み直す（六角メモで直したものを取り込む）');
    reload.addEventListener('click', () => void host.store.refresh());
    const placeRow = el('div', 'memory-place');
    placeRow.append(el('span', 'organize-count', tr('置き場所')), this.place, reload);

    const form = el('form', 'memory-form');
    const input = el('input', 'memory-input');
    input.placeholder = tr('覚えてほしいことを書く（Enter）');
    form.append(input);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      void this.run(() => host.store.add(text, 'user'));
    });

    const suggest = el('button', 'ai-small', tr('今の会話から提案'));
    suggest.title = tr('今の会話から、覚えておくとよいことの案を作る');
    suggest.addEventListener('click', () => void this.suggest());
    this.copyButton.title = tr('このパソコンに覚えていた記憶を、選んだ六角メモのノートへ送る');
    this.copyButton.addEventListener('click', () => void this.run(() => host.store.copyLocalToHexMemo()));
    const buttons = el('div', 'ai-row');
    buttons.append(suggest, this.copyButton);

    this.element.append(
      el('div', 'panel-subtitle', tr('相棒が覚えていること')),
      placeRow,
      this.list,
      form,
      buttons,
      this.status,
      this.suggestions,
      el('p', 'panel-note', tr('新しい会話を始めるとき、覚えていることを相棒に渡します（Anthropic に送られます）。相棒は、頼まれたときやはっきりした好みがわかったときに、自分で覚えることもあります。')),
    );
    host.store.onChange(() => this.render());
    this.renderPlaceOptions();
    this.render();
  }

  render() {
    const store = this.host.store;
    this.renderPlaceOptions();
    const items = store.list();
    if (this.editing && !items.some((m) => m.id === this.editing)) this.editing = null;
    if (items.length === 0) {
      this.list.replaceChildren(el('div', 'reminder-empty', tr('まだ何も覚えていません。下の欄に書くか、相棒に「〜を覚えて」と頼めます')));
    } else {
      this.list.replaceChildren(...items.map((m) => this.row(m)));
    }
    this.copyButton.hidden = store.place.kind !== 'hexmemo' || store.localCount === 0;
    if (store.status) this.status.textContent = store.status;
  }

  private row(memory: Memory): HTMLElement {
    const store = this.host.store;
    const row = el('div', memory.pending ? 'memory-item pending' : 'memory-item');
    if (this.editing === memory.id) {
      const input = el('input', 'memory-input');
      input.value = memory.text;
      input.addEventListener('keydown', (e) => {
        if (e.isComposing) return;
        if (e.key === 'Enter') {
          this.editing = null;
          void store.update(memory.id, input.value);
        } else if (e.key === 'Escape') {
          this.editing = null;
          this.render();
        }
      });
      row.append(input);
      queueMicrotask(() => input.focus());
      return row;
    }
    const text = el('div', 'memory-text', memory.text);
    if (memory.pending) text.append(el('span', 'organize-count', tr('（六角メモへ送った。取り込み待ち）')));
    row.append(text);
    if (store.editable) {
      const edit = el('button', 'reminder-remove', '✎');
      edit.title = tr('直す');
      edit.setAttribute('aria-label', 'この記憶を直す');
      edit.addEventListener('click', () => {
        this.editing = memory.id;
        this.render();
      });
      const remove = el('button', 'reminder-remove', '×');
      remove.title = tr('忘れる');
      remove.setAttribute('aria-label', 'この記憶を忘れる');
      remove.addEventListener('click', () => void this.run(() => store.remove(memory.id)));
      row.append(edit, remove);
    }
    return row;
  }

  // ---------- 置き場所 ----------

  private renderPlaceOptions() {
    const place = this.host.store.place;
    const options = [new Option(tr('このパソコン'), 'local', false, place.kind === 'local')];
    const targets = this.targets ?? (place.kind === 'hexmemo' ? [place.target] : []);
    targets.forEach((t, i) => {
      const selected = place.kind === 'hexmemo' && place.target.appId === t.appId && place.target.boardId === t.boardId;
      options.push(new Option(t.label, String(i), false, selected));
    });
    if (this.place.options.length === options.length && [...this.place.options].every((o, i) => o.text === options[i].text)) {
      this.place.value = options.find((o) => o.selected)?.value ?? 'local';
      return;
    }
    this.place.replaceChildren(...options);
  }

  private async loadTargets() {
    const catalog = await loadCatalog();
    this.targets = catalog.available ? targetsOf(catalog) : [];
    this.renderPlaceOptions();
  }

  private async changePlace() {
    const value = this.place.value;
    if (value === 'local') {
      await this.host.store.setPlace({ kind: 'local' });
      this.status.textContent = tr('このパソコンに置きます');
      return;
    }
    const targets = this.targets ?? [];
    const target = targets[Number(value)];
    if (!target) return;
    await this.host.store.setPlace({ kind: 'hexmemo', target });
    if (!this.host.store.status) this.status.textContent = tr('「{0}」の1つのマスを、1つの記憶として読みます。直す・消すのは六角メモで', { 0: target.label });
  }

  // ---------- 会話から案を作る ----------

  private async suggest() {
    const entries = this.host.entries();
    this.status.textContent = tr('今の会話から、覚えることを探しています…');
    this.suggestions.replaceChildren();
    try {
      const { items, cost } = await suggestMemories(entries, this.host.store.list(), this.host.settings());
      const costText = cost > 0 ? tr('（約 ${0}）', { 0: cost.toFixed(3) }) : '';
      if (items.length === 0) {
        this.status.textContent = tr('覚えることは見つかりませんでした{0}', { 0: costText });
        return;
      }
      this.status.textContent = tr('覚えることの案です{0}。外したいものは印を消してください', { 0: costText });
      this.showSuggestions(items);
    } catch (error) {
      this.status.textContent = tr('うまくいきませんでした：{0}', { 0: error instanceof Error ? error.message : String(error) });
    }
  }

  private showSuggestions(items: MemorySuggestion[]) {
    const chosen = new Set(items.map((_, i) => i));
    const rows = items.map((item, i) => {
      const row = el('label', 'organize-row organize-island');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = true;
      box.addEventListener('change', () => (box.checked ? chosen.add(i) : chosen.delete(i)));
      const body = el('div', 'organize-island-body');
      body.append(el('div', '', item.text), el('div', 'organize-detail', item.reason));
      row.append(box, body);
      return row;
    });
    const save = el('button', 'ai-small ai-yes', tr('覚える'));
    save.addEventListener('click', () => {
      const picked = items.filter((_, i) => chosen.has(i));
      this.suggestions.replaceChildren();
      void this.run(async () => {
        let last = { ok: true, message: '' };
        for (const item of picked) {
          last = await this.host.store.add(item.text, 'ai');
          if (!last.ok) return last;
        }
        return { ok: true, message: tr('{0} 件を覚えました（{1}）', { 0: picked.length, 1: this.host.store.placeLabel }) };
      });
    });
    const cancel = el('button', 'ai-small', tr('やめる'));
    cancel.addEventListener('click', () => {
      this.suggestions.replaceChildren();
      this.status.textContent = '';
    });
    const actions = el('div', 'ai-row');
    actions.append(save, cancel);
    this.suggestions.replaceChildren(...rows, actions);
  }

  private async run(task: () => Promise<{ ok: boolean; message: string }>) {
    this.status.textContent = '…';
    const result = await task();
    this.status.textContent = result.message;
  }
}
