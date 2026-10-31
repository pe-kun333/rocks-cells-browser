// 順路のパネル（右サイドバー）
//   ・表示中のタブの順路（または一覧で選んだ順路）を、枝分かれの形で見せる。番号は開いた順
//   ・段を押すとそのページへ。「順に読む」で、番号の順に1ページずつたどり直せる
//   ・名前を付けて残す・盤面に並べる・AI の調べもの日誌・六角メモへ送る
//   台帳は左サイドバーが持つので、変えたいときは左に頼む（askLeft）
import { t as tr } from '../i18n';
import { armConfirm } from '../confirm-arm';
import { writeJournal } from '../ai/journal';
import type { OrganizeSettings } from '../ai/organize';
import { type HexMemoTarget, sendToHexMemo } from '../integrations/hexmemo';
import {
  normalizeRouteUrl,
  type Route,
  type RouteJournal,
  routeLayout,
  routeName,
  type RoutesState,
  routeTree,
  stepLabel,
} from '../routes';
import type { Tab } from '../tabs';
import { TAG_PALETTE } from '../tags';
import type { HexMemoRecord, RelayCommand } from '../types';
import { el, hostOf } from '../util';

export interface RoutePanelHost {
  askLeft(action: RelayCommand): void;
  tabs(): Tab[];
  activeTab(): Tab | undefined;
  settings(): OrganizeSettings;
  hexMemoTarget(): HexMemoTarget | null;
}

const LISTED = 12; // 一覧に出す、最近の順路の数

export class RoutePanel {
  readonly element = el('section', 'panel-section route-panel');
  private readonly recordButton = el('button', 'ai-small route-record');
  private readonly body = el('div', 'route-body');
  private readonly listBox = el('div', 'route-list');
  private readonly status = el('div', 'panel-note organize-status');
  private state: RoutesState = { recording: true, routes: [] };
  private shown: string | null = null; // 左の盤面に出している順路
  private selected: string | null = null; // 一覧で選んだ順路（null なら表示中のタブの順路）
  private naming = false; // 名前を直している
  private confirmRemove: string | null = null;
  private journaling = new Set<string>();
  private frame = 0;

  constructor(private readonly host: RoutePanelHost) {
    this.recordButton.addEventListener('click', () => {
      const recording = !this.state.recording;
      this.state = { ...this.state, recording };
      host.askLeft({ command: 'setRouteRecording', recording });
      this.render();
    });
    const head = el('div', 'info-head');
    head.append(el('div', 'panel-subtitle', tr('順路')), this.recordButton);
    this.element.append(
      head,
      this.body,
      this.listBox,
      this.status,
      el(
        'p',
        'panel-note',
        tr('リンクをたどった道を、開いた順の番号と、新しいタブで開いた「枝」の形で覚えます（六角メモの Dendritic Extensions と同じ考え）。覚えるのは URL・題名・時刻だけで、このパソコンの中に保存します。残していない順路は30日で消えます。AI の日誌を書くときだけ、題名・URL・♥・メモを Anthropic に送ります（ページの本文は送りません）。'),
      ),
    );
    this.render();
  }

  setState(state: RoutesState, shown: string | null) {
    this.state = state;
    this.shown = shown;
    if (this.selected && !state.routes.some((r) => r.id === this.selected)) this.selected = null;
    this.requestRender();
  }

  // タブが変わった（いまどの段にいるかの印を描き直す）
  tabsChanged() {
    this.requestRender();
  }

  private requestRender() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private current(): Route | undefined {
    const id = this.selected ?? this.host.activeTab()?.trail?.route ?? null;
    return id ? this.state.routes.find((r) => r.id === id) : undefined;
  }

  render() {
    if (this.naming && this.element.contains(document.activeElement)) return; // 名前を書いている途中
    this.naming = false;
    this.recordButton.textContent = this.state.recording ? tr('● 記録中') : tr('○ 記録を止めています');
    this.recordButton.classList.toggle('off', !this.state.recording);
    this.recordButton.title = this.state.recording ? tr('押すと、順路を記録しないようにします') : tr('押すと、順路の記録を始めます');
    const route = this.current();
    this.body.replaceChildren(route ? this.routeCard(route) : this.emptyCard());
    this.renderList(route);
  }

  private emptyCard() {
    const box = el('div', 'route-card');
    box.append(
      el(
        'div',
        'reminder-empty',
        this.state.recording
          ? tr('このタブには、まだ順路がありません。リンクをたどったり、リンクを新しいタブで開いたりすると、ここに道ができます。')
          : tr('順路の記録を止めています。右上のボタンを押すと、記録を始めます。'),
      ),
    );
    return box;
  }

  // ---------- 今の順路 ----------

  private routeCard(route: Route): HTMLElement {
    const card = el('div', 'route-card');
    card.style.setProperty('--route', route.color);
    const tabs = this.host.tabs();
    const active = this.host.activeTab();

    // 見出し：色・名前・数
    const head = el('div', 'route-head');
    const color = el('button', 'route-color');
    color.title = tr('色を変える');
    color.setAttribute('aria-label', '色を変える');
    color.addEventListener('click', () => {
      const next = TAG_PALETTE[(TAG_PALETTE.indexOf(route.color) + 1) % TAG_PALETTE.length];
      this.update(route, { color: next });
    });
    const title = el('div', 'route-title');
    const branches = route.steps.filter((s) => s.from && route.steps.find((p) => p.id === s.from)?.lane !== s.lane).length;
    title.append(
      el('strong', '', routeName(route)),
      el('span', 'organize-count', tr('{0} ページ{1}・{2}〜', { 0: route.steps.length, 1: branches > 0 ? `・枝 ${branches}` : '', 2: dateTimeOf(route.createdAt) })),
    );
    const rename = el('button', 'reminder-remove', '✎');
    rename.title = tr('名前を付ける');
    rename.setAttribute('aria-label', '名前を付ける');
    rename.addEventListener('click', () => this.startNaming(head, route));
    head.append(color, title, rename);
    card.append(head);

    if (this.selected) {
      const back = el('button', 'route-link', tr('← 表示中のタブの順路に戻る'));
      back.addEventListener('click', () => this.select(null));
      card.append(back);
    }

    // ボタン
    const buttons = el('div', 'route-actions');
    const keep = el('button', 'ai-small', route.saved ? tr('★ 残した') : tr('☆ 残す'));
    keep.title = route.saved ? tr('押すと「残す」をやめます（古くなると消えます）') : tr('名前を付けて残す（古くなっても消えません）');
    keep.classList.toggle('on', route.saved);
    keep.addEventListener('click', () => this.update(route, { saved: !route.saved }));
    const layout = el('button', 'ai-small', tr('盤面に並べる'));
    layout.title = tr('順路の形のまま、眠ったタブとして盤面の島に並べる（もう開いているタブは、その場所へ動かします）');
    layout.disabled = route.steps.length < 2;
    layout.addEventListener('click', () => {
      this.host.askLeft({ command: 'layoutRoute', id: route.id });
      this.setStatus(tr('「{0}」を盤面の島に並べました（眠ったタブは、開くと読み込みます）', { 0: routeName(route) }));
    });
    const journal = el('button', 'ai-small', this.journaling.has(route.id) ? tr('書いています…') : route.journal ? tr('AI で日誌を書き直す') : tr('AI で日誌'));
    journal.title = tr('題名・URL・♥・メモから、調べものの流れとわかったことを AI がまとめます（本文は送りません）');
    journal.disabled = this.journaling.has(route.id) || route.steps.length < 2;
    journal.addEventListener('click', () => void this.writeJournal(route));
    const hex = el('button', 'ai-small', tr('六角メモへ'));
    hex.title = tr('順路の形のまま、六角メモのノートへ送る（1ページ＝1マス。日誌があれば左端に）');
    hex.addEventListener('click', () => void this.sendToHexMemo(route));
    const remove = el('button', 'ai-small route-remove', this.confirmRemove === route.id ? '本当に消す' : tr('消す'));
    if (this.confirmRemove === route.id) armConfirm(remove, () => {
      this.confirmRemove = null;
      this.render();
    });
    remove.addEventListener('click', () => {
      if (this.confirmRemove !== route.id) {
        this.confirmRemove = route.id;
        this.render();
        window.setTimeout(() => {
          if (this.confirmRemove === route.id) {
            this.confirmRemove = null;
            this.render();
          }
        }, 4000);
        return;
      }
      this.confirmRemove = null;
      this.selected = null;
      this.host.askLeft({ command: 'removeRoute', id: route.id });
      this.setStatus(tr('順路を消しました（開いているタブはそのままです）'));
    });
    buttons.append(keep, layout, journal, hex, remove);
    card.append(buttons);

    // 順に読む
    card.append(this.readingBar(route, active));

    // 日誌
    if (route.journal) card.append(this.journalView(route, route.journal));

    // 枝分かれの一覧
    const tree = el('div', 'route-tree');
    const here = new Map<string, number>(); // 段 → そこにいるタブの数
    for (const t of tabs) if (t.trail?.route === route.id) here.set(t.trail.step, (here.get(t.trail.step) ?? 0) + 1);
    for (const row of routeTree(route)) {
      const item = el('button', `route-row${row.branch ? ' branch' : ''}${row.depth > 0 ? ' nested' : ''}`);
      item.style.setProperty('--depth', String(Math.min(row.depth, 6)));
      if (active?.trail?.route === route.id && active.trail.step === row.step.id) item.classList.add('current');
      else if (here.has(row.step.id)) item.classList.add('open');
      item.title = `${row.step.title || row.step.url}\n${row.step.url}`;
      const num = el('span', 'route-num', String(row.n));
      const text = el('span', 'route-text');
      text.append(el('span', 'route-label', stepLabel(row.step)), el('span', 'route-host', tr('{0}・{1}', { 0: hostOf(row.step.url), 1: timeOf(row.step.at) })));
      item.append(num, text);
      const liked = Math.max(0, ...tabs.filter((t) => normalizeRouteUrl(t.url) === row.step.url).map((t) => t.liked));
      if (liked > 0) item.append(el('span', 'route-liked', '♥'.repeat(liked)));
      item.addEventListener('click', () => this.host.askLeft({ command: 'openRouteStep', id: route.id, step: row.step.id, reuse: true }));
      tree.append(item);
    }
    card.append(tree);
    return card;
  }

  private readingBar(route: Route, active: Tab | undefined): HTMLElement {
    const bar = el('div', 'route-reading');
    const index = active?.trail?.route === route.id ? route.steps.findIndex((s) => s.id === active.trail?.step) : -1;
    const go = (i: number) => {
      const step = route.steps[i];
      if (step) this.host.askLeft({ command: 'openRouteStep', id: route.id, step: step.id, reuse: true });
    };
    if (index < 0) {
      const start = el('button', 'ai-small', tr('▶ 最初から順に読む'));
      start.title = tr('番号の順に、1ページずつたどり直す（新しいタブで開き、◀ ▶ で進みます）');
      start.disabled = route.steps.length < 2;
      start.addEventListener('click', () => go(0));
      bar.append(start);
      return bar;
    }
    const prev = el('button', 'ai-small', tr('◀ 前'));
    prev.disabled = index === 0;
    prev.addEventListener('click', () => go(index - 1));
    const next = el('button', 'ai-small', tr('次 ▶'));
    next.disabled = index >= route.steps.length - 1;
    next.addEventListener('click', () => go(index + 1));
    bar.append(prev, el('span', 'route-position', `${index + 1} / ${route.steps.length}`), next);
    return bar;
  }

  private journalView(route: Route, j: RouteJournal): HTMLElement {
    const box = el('div', 'route-journal');
    box.append(el('div', 'route-journal-title', `📓 ${j.title || tr('調べもの日誌')}`));
    if (j.summary) box.append(el('p', 'route-journal-summary', j.summary));
    const chip = (n: number) => {
      const b = el('button', 'route-chip', String(n));
      b.title = tr('{0} 番のページを開く', { 0: n });
      b.addEventListener('click', () => {
        const step = route.steps[n - 1];
        if (step) this.host.askLeft({ command: 'openRouteStep', id: route.id, step: step.id, reuse: true });
      });
      return b;
    };
    if (j.flow.length > 0) {
      const list = el('ol', 'route-flow');
      for (const f of j.flow) {
        const li = el('li');
        li.append(el('span', '', f.text), ...f.steps.map(chip));
        list.append(li);
      }
      box.append(list);
    }
    const section = (label: string, items: string[]) => {
      if (items.length === 0) return;
      box.append(el('div', 'route-journal-label', label));
      const ul = el('ul', 'route-journal-list');
      for (const item of items) ul.append(el('li', '', item));
      box.append(ul);
    };
    section(tr('わかったこと'), j.findings);
    section(tr('次に調べること'), j.questions);
    box.append(el('div', 'organize-count', tr('日誌：{0}{1}', { 0: dateTimeOf(j.at), 1: j.cost > 0 ? `・約 $${j.cost.toFixed(3)}` : '' })));
    return box;
  }

  // ---------- 一覧 ----------

  private renderList(current: Route | undefined) {
    const routes = this.state.routes.filter((r) => r.saved || r.steps.length >= 2);
    const saved = routes.filter((r) => r.saved);
    const recent = routes.filter((r) => !r.saved).slice(0, LISTED);
    const box: HTMLElement[] = [];
    const group = (label: string, list: Route[]) => {
      if (list.length === 0) return;
      box.push(el('div', 'route-list-label', label));
      for (const r of list) {
        const row = el('button', `route-item${r.id === current?.id ? ' selected' : ''}${r.id === this.shown ? ' shown' : ''}`);
        row.style.setProperty('--route', r.color);
        row.append(el('span', 'route-dot'), el('span', 'route-item-name', routeName(r)), el('span', 'organize-count', tr('{0}・{1}', { 0: r.steps.length, 1: dateTimeOf(r.updatedAt) })));
        if (r.journal) row.title = r.journal.summary;
        row.addEventListener('click', () => this.select(r.id === current?.id && this.selected ? null : r.id));
        box.push(row);
      }
    };
    group(tr('残した順路'), saved);
    group(tr('最近の順路'), recent);
    this.listBox.replaceChildren(...box);
  }

  private select(id: string | null) {
    this.selected = id;
    this.host.askLeft({ command: 'showRoute', id });
    this.render();
  }

  private startNaming(head: HTMLElement, route: Route) {
    const form = el('form', 'route-name-form');
    const input = el('input');
    input.value = route.name || routeName(route);
    input.maxLength = 30;
    input.setAttribute('aria-label', '順路の名前');
    const ok = el('button', 'ai-small', tr('決める'));
    ok.type = 'submit';
    form.append(input, ok);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.naming = false;
      input.blur();
      this.update(route, { name: input.value, saved: true });
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.naming = false;
        input.blur();
        this.render();
      }
    });
    head.replaceChildren(form);
    this.naming = true;
    input.focus();
    input.select();
  }

  private update(route: Route, patch: { name?: string; color?: string; saved?: boolean }) {
    // 左から写しが届くまでの間も、すぐ見た目に出す
    Object.assign(route, patch);
    this.host.askLeft({ command: 'updateRoute', id: route.id, ...patch });
    this.render();
  }

  // ---------- AI の日誌・六角メモ ----------

  private async writeJournal(route: Route) {
    this.journaling.add(route.id);
    this.setStatus(tr('調べものの日誌を書いています…'), 0);
    this.render();
    try {
      const journal = await writeJournal(route, this.host.tabs(), this.host.settings());
      route.journal = journal;
      this.host.askLeft({ command: 'setRouteJournal', id: route.id, journal });
      this.setStatus(tr('日誌を書きました{0}', { 0: journal.cost > 0 ? `（約 $${journal.cost.toFixed(3)}）` : '' }));
    } catch (error) {
      this.setStatus(tr('日誌を書けませんでした：{0}', { 0: error instanceof Error ? error.message : String(error) }), 8000);
    } finally {
      this.journaling.delete(route.id);
      this.render();
    }
  }

  private async sendToHexMemo(route: Route) {
    const target = this.host.hexMemoTarget();
    if (!target) {
      this.setStatus(tr('相棒の ⚙ で「六角メモの送り先」を選んでから、もう一度押してください'), 6000);
      return;
    }
    const { steps, offsets } = routeLayout(route);
    const now = new Date().toISOString();
    const tabs = this.host.tabs();
    const records: HexMemoRecord[] = [];
    const places: { dq: number; dr: number }[] = [];
    const j = route.journal;
    if (j) {
      const lines = [`📓 ${j.title || routeName(route)}`, j.summary];
      if (j.findings.length > 0) lines.push('', tr('わかったこと'), ...j.findings.map((f) => tr('・{0}', { 0: f })));
      if (j.questions.length > 0) lines.push('', tr('次に調べること'), ...j.questions.map((q) => tr('・{0}', { 0: q })));
      records.push({ text: lines.join('\n'), createdAt: now, tags: [tr('調べもの日誌')] });
      places.push({ dq: -1, dr: 0 }); // 最初のページの左
    }
    for (const step of steps) {
      const n = route.steps.indexOf(step) + 1;
      const notes = tabs
        .filter((t) => normalizeRouteUrl(t.url) === step.url)
        .flatMap((t) => t.notes.filter((x) => x.source === 'user').map((x) => x.text))
        .slice(0, 2);
      const text = [`${n}. ${stepLabel(step)}`, ...notes.map((x) => tr('メモ：{0}', { 0: x }))].join('\n');
      records.push({ text, createdAt: new Date(step.at || Date.now()).toISOString(), tags: [tr('順路')], urls: [{ url: step.url, title: step.title || stepLabel(step) }] });
      const o = offsets.get(step.id) ?? { q: 0, r: 0 };
      places.push({ dq: o.q, dr: o.r });
    }
    this.setStatus(tr('六角メモへ送っています…'), 0);
    const outcome = await sendToHexMemo(target, records, places);
    if (!outcome.ok) {
      this.setStatus(tr('送れませんでした：{0}', { 0: outcome.error }), 8000);
      return;
    }
    const more = route.steps.length > steps.length ? tr('（最初の {0} ページ）', { 0: steps.length }) : '';
    this.setStatus('pending' in outcome ? outcome.message : tr('{0} マスを、順路の形のまま「{1}」へ送りました{2}', { 0: records.length, 1: target.label, 2: more }), 8000);
  }

  private statusTimer = 0;
  private setStatus(text: string, ms = 5000) {
    this.status.textContent = text;
    window.clearTimeout(this.statusTimer);
    if (ms > 0) this.statusTimer = window.setTimeout(() => (this.status.textContent = ''), ms);
  }
}

function timeOf(at: number) {
  const d = new Date(at);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function dateTimeOf(at: number) {
  const d = new Date(at);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? timeOf(at) : `${d.getMonth() + 1}/${d.getDate()} ${timeOf(at)}`;
}
