// 情報収集のパネル（右サイドバー）
//   ・トピック（調べたいこと・採点の基準・自動で集める間隔）を登録して、Web 検索で集めて採点する
//   ・点数は六角形の辺（6本で満点）と数字で見せる。島に並べると、点数に合わせて ♥ を付ける
//   ・自動で集めるのは、ブラウザを開いている間だけ（1日の回数に上限）
import type { OrganizeSettings } from '../ai/organize';
import { DEFAULT_RUBRIC, mergeItems, newTopic, type ResearchItem, runResearch, type Topic, type TopicStore } from '../ai/research';
import { ensureBlocklist, isBlockedUrl } from '../blocklist';
import { clamp, el } from '../util';
import type { VaultDraft } from '../vault';

export interface InfoPanelHost {
  store: TopicStore;
  settings(): OrganizeSettings;
  interests(): Promise<string[]>; // 使う人の関心（相棒が覚えていること）
  openUrl(url: string, background: boolean): void;
  openAsIsland(name: string, items: { url: string; title: string; liked: number }[]): void;
  announce(text: string): void; // 相棒の吹き出しで知らせる
  toVault?(draft: VaultDraft): Promise<boolean>; // データ置き場（右サイドバーのメモの区画の下）に入れる
  // 話題の名前と、今出ている結果の題名とアドレスを、依頼の小窓へ渡す。コピーまではアプリを開かない。開けたら true
  askBot?(text: string): boolean;
}

const DAILY_KEY = 'honeycomb.info.daily';
const LIMIT_KEY = 'honeycomb.info.limit';
const CHECK_MS = 60_000;
const EVERY_OPTIONS: [number, string][] = [
  [0, '手動だけ'],
  [3, '3時間ごと'],
  [6, '6時間ごと'],
  [12, '12時間ごと'],
  [24, '1日ごと'],
];
const SHOWN = 8;

export class InfoPanel {
  readonly element = el('section', 'panel-section info-panel');
  private readonly list = el('div', 'info-topics');
  private readonly formBox = el('div', 'info-form-box');
  private readonly status = el('div', 'panel-note organize-status');
  private readonly limitInput = el('input');
  private readonly running = new Set<string>();
  private editing: Topic | 'new' | null = null;

  constructor(private readonly host: InfoPanelHost) {
    const add = el('button', 'ai-small', '＋トピック');
    add.addEventListener('click', () => {
      this.editing = 'new';
      this.renderForm();
    });
    const head = el('div', 'info-head');
    head.append(el('div', 'panel-subtitle', '情報収集'), add);

    this.limitInput.type = 'number';
    this.limitInput.min = '0';
    this.limitInput.max = '50';
    this.limitInput.value = String(dailyLimit());
    this.limitInput.addEventListener('change', () => {
      const n = clamp(Math.round(Number(this.limitInput.value) || 0), 0, 50);
      this.limitInput.value = String(n);
      saveNumber(LIMIT_KEY, n);
    });
    const limit = el('label', 'ai-limit');
    limit.append(document.createTextNode('自動で集めるのは1日に'), this.limitInput, document.createTextNode('回まで'));

    this.element.append(
      head,
      this.formBox,
      this.list,
      this.status,
      limit,
      el(
        'p',
        'panel-note',
        '集めるときは、トピックと使う人の関心（相棒が覚えていること）が Anthropic に送られ、Anthropic 側で Web 検索します（1回の検索 約 $0.01 と、読んだ分の料金）。自動で集めるのは、ブラウザと右サイドバーを開いている間だけです。',
      ),
    );
    host.store.onChange(() => this.render());
    window.setInterval(() => void this.checkSchedule(), CHECK_MS);
    window.setTimeout(() => void this.checkSchedule(), 15_000);
    this.render();
  }

  render() {
    const topics = this.host.store.list().sort((a, b) => a.createdAt - b.createdAt);
    if (topics.length === 0) {
      this.list.replaceChildren(el('div', 'reminder-empty', 'まだトピックがありません。「＋トピック」で、追いかけたいこと（例：生成AIの新しいモデル）を登録すると、Web 検索で集めて点数を付けます'));
      return;
    }
    this.list.replaceChildren(...topics.map((t) => this.topicCard(t)));
  }

  // ---------- トピック ----------

  private topicCard(topic: Topic): HTMLElement {
    const card = el('div', 'info-topic');
    const head = el('div', 'info-topic-head');
    const every = EVERY_OPTIONS.find(([h]) => h === topic.everyHours)?.[1] ?? `${topic.everyHours}時間ごと`;
    const last = topic.lastRunAt ? `最終 ${dateTimeOf(topic.lastRunAt)}${topic.lastCost > 0 ? `・約 $${topic.lastCost.toFixed(3)}` : ''}` : 'まだ集めていません';
    const title = el('div', 'info-topic-title');
    title.append(el('strong', '', topic.name), el('span', 'organize-count', `${every}・${last}`));
    const edit = el('button', 'reminder-remove', '✎');
    edit.title = 'このトピックを直す';
    edit.setAttribute('aria-label', 'このトピックを直す');
    edit.addEventListener('click', () => {
      this.editing = topic;
      this.renderForm();
    });
    head.append(title, edit);

    const running = this.running.has(topic.id);
    const runButton = el('button', 'ai-small', running ? '集めています…' : '今すぐ集める');
    runButton.disabled = running;
    runButton.addEventListener('click', () => void this.run(topic, false));
    const items = this.visibleItems(topic);
    const islandButton = el('button', 'ai-small', '島に並べる');
    islandButton.title = '点数の高いものを、眠ったタブとして盤面の島に並べる（点数に合わせて ♥ を付ける）';
    islandButton.disabled = items.length === 0;
    islandButton.addEventListener('click', () => {
      this.host.openAsIsland(
        topic.name,
        items.slice(0, 6).map((i) => ({ url: i.url, title: i.title, liked: likedOf(i.total) })),
      );
      this.status.textContent = `「${topic.name}」の島に並べました（開くと読み込みます）`;
    });
    const buttons = el('div', 'ai-row info-actions');
    if (this.host.askBot) {
      const ask = el('button', 'ai-small', 'ボットに頼む');
      ask.title = '話題の名前と、今出ている結果の題名とアドレスを、依頼の小窓に入れます。コピーするまでアプリは開きません。ページの本文は入れません';
      ask.addEventListener('click', () => void this.askBot(topic));
      buttons.append(ask);
    }
    buttons.append(runButton, islandButton);
    const toVault = this.host.toVault;
    if (toVault) {
      // AI が集めて採点した結果を、データ置き場に残す（今出ているもの。点数の高い順）
      const vaultButton = el('button', 'ai-small', 'データ置き場へ');
      vaultButton.title = 'AI が集めて採点した結果（今出ているもの）を、データ置き場（右サイドバーのメモの区画の下）に残す';
      vaultButton.disabled = items.length === 0;
      vaultButton.addEventListener('click', () => void toVault(researchDraft(topic, items)));
      buttons.append(vaultButton);
    }
    card.append(head, buttons);

    const runs = this.host.store.resultsOf(topic.id).runs;
    if (runs[0]?.error) card.append(el('div', 'ai-msg-note ai-failed', `前回：${runs[0].error}`));
    const lastRunAt = runs[0]?.at ?? 0;
    for (const item of items.slice(0, SHOWN)) card.append(this.itemRow(topic, item, item.firstSeenAt >= lastRunAt && runs.length > 1));
    if (items.length > SHOWN) card.append(el('div', 'organize-count', `ほか ${items.length - SHOWN} 件（点数の低いもの）`));
    return card;
  }

  private visibleItems(topic: Topic): ResearchItem[] {
    return this.host.store
      .resultsOf(topic.id)
      .items.filter((i) => !i.dismissed)
      .sort((a, b) => b.total - a.total || b.firstSeenAt - a.firstSeenAt);
  }

  private itemRow(topic: Topic, item: ResearchItem, isNew: boolean): HTMLElement {
    const row = el('div', 'info-item');
    row.append(scoreBadge(item.total));
    const body = el('div', 'info-item-body');
    const link = el('button', 'info-item-title', item.title || item.url);
    link.title = `${item.url}\n${item.summary}\n${item.scores.map((s) => `${s.criterion}：${s.score}/5`).join('\n')}${item.reason ? `\n${item.reason}` : ''}`;
    link.addEventListener('click', () => this.host.openUrl(item.url, false));
    const meta = el('div', 'organize-count', [isNew ? '新着' : '', item.published, hostOf(item.url)].filter(Boolean).join('・'));
    body.append(link, meta);
    if (item.summary) body.append(el('div', 'info-item-summary', item.summary));
    const later = el('button', 'reminder-remove', '＋');
    later.title = 'あとで読む（眠ったタブとして置く）';
    later.setAttribute('aria-label', 'あとで読む');
    later.addEventListener('click', () => {
      this.host.openUrl(item.url, true);
      this.status.textContent = `あとで読む用に置きました：${item.title}`;
    });
    const remove = el('button', 'reminder-remove', '×');
    remove.title = '要らない（次からも出さない）';
    remove.setAttribute('aria-label', '要らない');
    remove.addEventListener('click', () => void this.host.store.dismiss(topic.id, item.url));
    row.append(body, later, remove);
    return row;
  }

  // 話題の横から、依頼の小窓を開く（段階5）。本文は入れない。渡し止めの結果は題名もアドレスも入れない
  private async askBot(topic: Topic) {
    const ask = this.host.askBot;
    if (!ask) return;
    const shown = this.visibleItems(topic).slice(0, SHOWN);
    const hosts = await ensureBlocklist();
    const kept = shown.filter((item) => item.url && !isBlockedUrl(item.url, hosts));
    const withheld = shown.filter((item) => isBlockedUrl(item.url, hosts)).length;
    if (!ask(topicAskText(topic, kept, withheld))) return;
    this.status.textContent = `「${topic.name}」を依頼の小窓に入れました。コピーするまで、アプリは開きません`;
  }

  // ---------- 集める ----------

  async run(topic: Topic, auto: boolean): Promise<{ ok: boolean; message: string; added: ResearchItem[] }> {
    if (this.running.has(topic.id)) return { ok: false, message: 'いま集めています', added: [] };
    const settings = this.host.settings();
    if (!settings.practice && !settings.apiKey) {
      const message = 'AI の ⚙ で API キーを設定するか、練習モードにしてください';
      this.status.textContent = message;
      return { ok: false, message, added: [] };
    }
    this.running.add(topic.id);
    this.render();
    const store = this.host.store;
    const before = store.resultsOf(topic.id);
    try {
      const interests = await this.host.interests();
      const result = await runResearch(topic, before.items, interests, settings);
      const now = Date.now();
      const { items, added } = mergeItems(before.items, result.items, now);
      await store.saveResults(topic.id, { items, runs: [{ at: now, cost: result.cost, searches: result.searches, found: added.length, auto }, ...before.runs] });
      await store.save({ ...topic, lastRunAt: now, lastCost: result.cost, totalCost: topic.totalCost + result.cost });
      const best = [...added].sort((a, b) => b.total - a.total)[0];
      const message = added.length > 0
        ? `「${topic.name}」で新しい情報が ${added.length} 件（いちばん高いのは ${best.total} 点：${best.title}）`
        : `「${topic.name}」の新しい情報はありませんでした`;
      this.status.textContent = `${message}${result.cost > 0 ? `。約 $${result.cost.toFixed(3)}（検索 ${result.searches} 回）` : ''}`;
      if (auto && added.length > 0) this.host.announce(`🔎 ${message}`);
      return { ok: true, message, added };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await store.saveResults(topic.id, { ...before, runs: [{ at: Date.now(), cost: 0, searches: 0, found: 0, error: message, auto }, ...before.runs] });
      await store.save({ ...topic, lastRunAt: Date.now() });
      this.status.textContent = `「${topic.name}」を集められませんでした：${message}`;
      return { ok: false, message, added: [] };
    } finally {
      this.running.delete(topic.id);
      this.render();
    }
  }

  // 自動で集める（間隔が過ぎたトピックを、1つずつ）
  private async checkSchedule() {
    const now = Date.now();
    const due = this.host.store
      .list()
      .filter((t) => t.everyHours > 0 && !this.running.has(t.id) && (!t.lastRunAt || now - t.lastRunAt >= t.everyHours * 3_600_000))
      .sort((a, b) => (a.lastRunAt ?? 0) - (b.lastRunAt ?? 0))[0];
    if (!due || this.running.size > 0) return;
    const settings = this.host.settings();
    if (!settings.practice && !settings.apiKey) return;
    const count = loadDaily();
    if (count >= dailyLimit()) return;
    saveDaily(count + 1);
    await this.run(due, true);
  }

  // ---------- 登録・直す ----------

  private renderForm() {
    const editing = this.editing;
    if (!editing) {
      this.formBox.replaceChildren();
      return;
    }
    const topic = editing === 'new' ? null : editing;
    const form = el('form', 'info-form');
    const name = input('名前（例：生成AIの新しいモデル）', topic?.name ?? '');
    const query = el('textarea', 'memory-input info-textarea');
    query.rows = 3;
    query.placeholder = '調べたいこと（例：新しいモデルの発表、料金、性能の比較。日本語と英語の情報）';
    query.value = topic?.query ?? '';
    const rubric = el('textarea', 'memory-input info-textarea');
    rubric.rows = 4;
    rubric.value = (topic?.rubric ?? DEFAULT_RUBRIC).join('\n');
    const every = el('select');
    for (const [hours, label] of EVERY_OPTIONS) every.append(new Option(label, String(hours), false, hours === (topic?.everyHours ?? 0)));
    const maxUses = input('', String(topic?.maxUses ?? 5));
    maxUses.type = 'number';
    maxUses.min = '1';
    maxUses.max = '10';
    const domainMode = el('select');
    const mode = topic?.allowedDomains.length ? 'allow' : topic?.blockedDomains.length ? 'block' : 'none';
    for (const [value, label] of [
      ['none', 'サイトを限らない'],
      ['allow', 'このサイトだけ調べる'],
      ['block', 'このサイトは調べない'],
    ]) {
      domainMode.append(new Option(label, value, false, value === mode));
    }
    const domains = input('例：example.com, news.example.jp', (topic?.allowedDomains.length ? topic.allowedDomains : (topic?.blockedDomains ?? [])).join(', '));
    const error = el('div', 'field-error');

    const save = el('button', 'ai-small ai-yes', '保存');
    save.type = 'submit';
    const cancel = el('button', 'ai-small', 'やめる');
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      this.editing = null;
      this.renderForm();
    });
    const actions = el('div', 'ai-row');
    actions.append(save, cancel);
    if (topic) {
      const remove = el('button', 'ai-small', '削除');
      remove.type = 'button';
      remove.addEventListener('click', () => {
        if (!window.confirm(`トピック「${topic.name}」と、集めた結果を削除しますか？`)) return;
        this.editing = null;
        this.renderForm();
        void this.host.store.remove(topic.id);
      });
      actions.append(remove);
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fields = {
        name: [...name.value.trim()].slice(0, 30).join(''),
        query: query.value.trim().slice(0, 600),
        rubric: rubric.value.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 6),
        everyHours: Number(every.value),
        maxUses: clamp(Math.round(Number(maxUses.value) || 5), 1, 10),
        allowedDomains: domainMode.value === 'allow' ? parseDomains(domains.value) : [],
        blockedDomains: domainMode.value === 'block' ? parseDomains(domains.value) : [],
      };
      if (!fields.name || !fields.query) {
        error.textContent = '名前と、調べたいことを入れてください';
        return;
      }
      if (fields.rubric.length === 0) fields.rubric = DEFAULT_RUBRIC;
      void this.host.store.save(topic ? { ...topic, ...fields } : newTopic(fields));
      this.editing = null;
      this.renderForm();
    });

    form.append(
      name,
      query,
      el('div', 'ai-setting-title', '採点の基準（1行に1つ。それぞれ 0〜5 点）'),
      rubric,
      labeled('自動で集める', every),
      labeled('1回に検索する回数（1〜10）', maxUses),
      domainMode,
      domains,
      error,
      actions,
    );
    this.formBox.replaceChildren(form);
    name.focus();
  }
}

// 点数のしるし：六角形の辺（6本で満点）と数字
function scoreBadge(total: number): SVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 30 32');
  svg.setAttribute('class', 'score-badge');
  const corners = [0, 1, 2, 3, 4, 5].map((i) => {
    const a = (Math.PI / 180) * (60 * i - 90);
    return `${(15 + 13 * Math.cos(a)).toFixed(1)},${(16 + 13 * Math.sin(a)).toFixed(1)}`;
  });
  const base = document.createElementNS(ns, 'polygon');
  base.setAttribute('points', corners.join(' '));
  base.setAttribute('class', 'score-hex');
  svg.append(base);
  const edges = Math.round((total / 100) * 6);
  if (edges > 0) {
    const lit = document.createElementNS(ns, 'polyline');
    lit.setAttribute('points', [...corners, corners[0]].slice(0, edges + 1).join(' '));
    lit.setAttribute('class', edges >= 6 ? 'score-edges full' : 'score-edges');
    svg.append(lit);
  }
  const text = document.createElementNS(ns, 'text');
  text.setAttribute('x', '15');
  text.setAttribute('y', '16');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('dominant-baseline', 'central');
  text.textContent = String(total);
  svg.append(text);
  return svg;
}

// 点数 → ♥ の段階（島に並べるとき）
function likedOf(total: number) {
  return total >= 80 ? 3 : total >= 65 ? 2 : total >= 50 ? 1 : 0;
}

function input(placeholder: string, value: string) {
  const node = el('input', 'memory-input');
  node.placeholder = placeholder;
  node.value = value;
  return node;
}

function labeled(text: string, control: HTMLElement) {
  const label = el('label', 'ai-limit');
  label.append(document.createTextNode(text), control);
  return label;
}

function parseDomains(text: string): string[] {
  return text
    .split(/[\s,、]+/)
    .map((d) => d.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, ''))
    .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(d))
    .slice(0, 20);
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function dateTimeOf(ms: number) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function loadDaily(): number {
  try {
    const saved = JSON.parse(localStorage.getItem(DAILY_KEY) ?? 'null') as { date?: string; count?: number } | null;
    return saved?.date === today() && typeof saved.count === 'number' ? saved.count : 0;
  } catch {
    return 0;
  }
}

function saveDaily(count: number) {
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify({ date: today(), count }));
  } catch {
    // 保存できなくても動作は続ける
  }
}

function dailyLimit(): number {
  try {
    const n = Number(localStorage.getItem(LIMIT_KEY));
    return localStorage.getItem(LIMIT_KEY) !== null && Number.isFinite(n) ? n : 6;
  } catch {
    return 6;
  }
}

function saveNumber(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // 保存できなくても動作は続ける
  }
}

// 小窓に入れる文。話題の名前と、今出ている結果の題名とアドレスだけ。要約も本文も入れない
function topicAskText(topic: Topic, items: ResearchItem[], withheld: number): string {
  const lines = [`話題「${topic.name.trim() || 'この話題'}」について、短く教えてください。`];
  const query = topic.query.trim();
  if (query) lines.push(`調べたいこと：${query}`);
  lines.push('');
  if (items.length === 0 && withheld === 0) {
    lines.push('今出ている結果はまだありません。ページの本文は入れていません。');
  } else if (items.length === 0) {
    lines.push('今出ている結果は渡し止めのため、題名もアドレスも入れていません。ページの本文は入れていません。');
  } else {
    lines.push('今出ている結果です。題名とアドレスだけ入れています。ページの本文は入れていません。');
    lines.push('');
    for (const [i, item] of items.entries()) {
      lines.push(`${i + 1}. ${item.title.trim() || '（題名なし）'}`);
      lines.push(item.url.trim());
    }
    if (withheld > 0) lines.push('', `渡し止めのページが ${withheld} 件あるので、その題名とアドレスは入れていません。`);
  }
  const text = lines.join('\n');
  const max = 6000;
  return [...text].length <= max ? text : `${[...text].slice(0, max).join('')}\n…（長すぎるので、ここまで）`;
}

// データ置き場に入れる形（情報収集の結果）
function researchDraft(topic: Topic, items: ResearchItem[]): VaultDraft {
  const lines = [`「${topic.name}」の情報収集`, `調べたいこと：${topic.query}`, ''];
  items.forEach((item, n) => {
    lines.push(`${n + 1}. [${item.total} 点] ${item.title || item.url}`, `   ${item.url}`);
    if (item.published) lines.push(`   ${item.published}`);
    if (item.summary) lines.push(`   ${item.summary}`);
    if (item.reason) lines.push(`   （${item.reason}）`);
    lines.push('');
  });
  return {
    kind: 'research',
    title: `情報収集：${topic.name}（${items.length} 件）`,
    text: lines.join('\n').trim(),
    data: { version: 1, topic: { name: topic.name, query: topic.query, rubric: topic.rubric }, items: items.map(({ dismissed: _, ...i }) => i) },
    sourceAt: topic.lastRunAt ?? undefined,
    source: { topic: topic.name },
  };
}
