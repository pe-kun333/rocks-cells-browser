// アプリのセルの台帳（docs/plan-app-cells.md）
//   ・保存先：ui-data\apps.json（左サイドバーだけが読み書きする）
//   ・セルの位置は memocells.json の app（この id）。セルを外しても台帳は残る（ボットの台帳と同じ）
//   ・A5：summonApp で、中央の区画に合わせて最前面にする。ストアアプリは aumid で窓を探す。release で最前面をやめる
import { t } from './i18n';
import { request } from './bridge';
import { readData, writeData } from './data';

export const MAX_APPS = 100;
export const MAX_APP_NAME = 40;
export const APP_PILL_COUNT = 6; // 空いたセルの右クリックに出す丸いボタン（シートボタン・区画タグと同じ数）
const PATH_MAX = 32767;
const ICON_MAX = 120_000;
const FILE = 'apps.json';

export const APP_ID_RE = /^a[0-9a-z]{4,24}$/;
export const isAppId = (value: unknown): value is string => typeof value === 'string' && APP_ID_RE.test(value);
export const newAppId = () => `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export interface AppEntry {
  id: string;
  name: string;
  launch: string; // A2 が起動するパス（ショートカットを選んだときは .lnk）
  target: string; // 解決できた .exe。空ならまだ分かっていない
  args: string;
  cwd: string;
  shortcut: string; // 選んだ .lnk。実行ファイルを直接選んだときは空
  icon: string; // data:image/png;base64,... か空
  host: string; // 前回、窓を持っていた実行ファイル。空なら未確定。起動用の target と違っても残す
  aumid: string; // ショートカットのアプリ ID（System.AppUserModel.ID）。空ならまだ無い。ストアアプリの窓を探す
  createdAt: number;
  placedAt: number; // 最後にセルへ置いた時刻（丸いボタンは新しい順）
}

export interface PickedApp {
  name: string;
  launch: string;
  target: string;
  args: string;
  cwd: string;
  shortcut: string;
  icon: string;
  aumid: string;
}

export type PickAppError = 'cancel' | 'type' | 'missing' | 'dialog' | 'timeout';
export type PickAppResult = { ok: true; app: PickedApp } | { ok: false; error: PickAppError };

// C++ の summonApp の結果。
//   placed＝区画に合わせて最前面　fixed＝大きさを変えられないので中央寄せ（overlap はサイドバーにはみ出す）
//   released＝最前面をやめた　waiting＝起動したが窓を特定できず、中央に合わせられなかった
//   store＝古い返事（起動だけ。A5 の C++ は出さない）
//   host＝掴んだ窓の実行ファイル（台帳が覚える。無ければ空）
//   aumid＝掴んだ窓、またはショートカットのアプリ ID（台帳が覚える。無ければ空）
export type SummonAction = 'placed' | 'fixed' | 'released' | 'waiting' | 'store';
export type SummonError = 'badPath' | 'failed' | 'timeout' | 'denied' | 'notFound';
export type SummonResult = { ok: true; action: SummonAction; overlap: boolean; host: string; aumid: string } | { ok: false; error: SummonError };

// target が空、または ApplicationFrameHost.exe。ストアアプリは exe では区別できない
export function isStoreTarget(target: string): boolean {
  if (!target) return true;
  const file = target.split(/[/\\]/).pop()?.toLowerCase() ?? '';
  return file === 'applicationframehost.exe';
}

export function cleanAppName(name: unknown): string {
  const text = String(name ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return [...text].slice(0, MAX_APP_NAME).join('');
}

function cleanPath(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\0/g, '');
  if (!text || text.length > PATH_MAX) return '';
  if ([...text].some((ch) => ch.charCodeAt(0) < 32)) return '';
  if (!/^[A-Za-z]:[\\/]/.test(text) && !text.startsWith('\\\\')) return '';
  return text;
}

function cleanNote(value: unknown, max = 2048): string {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\0/g, '');
  if ([...text].some((ch) => ch.charCodeAt(0) < 32 && ch !== '\t')) return '';
  return [...text].slice(0, max).join('');
}

function cleanAumid(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text || text.length > 128) return '';
  if ([...text].some((ch) => ch.charCodeAt(0) < 33 || ch.charCodeAt(0) === 127)) return '';
  if (/[\\/<>"|?*]/.test(text)) return '';
  return text;
}

function cleanIcon(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('data:image/png;base64,')) return '';
  return value.length <= ICON_MAX ? value : '';
}

export function sameLaunch(a: string, b: string) {
  return a.replace(/\//g, '\\').toLowerCase() === b.replace(/\//g, '\\').toLowerCase();
}

// メニューとカードに出す、短いファイル名
export function appFileLabel(app: Pick<AppEntry, 'launch' | 'shortcut' | 'target'>): string {
  const path = app.shortcut || app.target || app.launch;
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path || t('ファイル');
}

export function pickAppErrorText(error: PickAppError): string {
  switch (error) {
    case 'cancel':
      return '';
    case 'type':
      return t('実行ファイル（.exe）か、ショートカット（.lnk）を選んでください');
    case 'missing':
      return t('そのファイルが見つかりませんでした。もう一度選んでください');
    case 'dialog':
      return t('ファイルを選ぶ窓を出せませんでした');
    default:
      return t('ファイルを選べませんでした。もう一度どうぞ');
  }
}

export function summonResultText(name: string, result: SummonResult): string {
  if (!result.ok) {
    if (result.error === 'badPath') return t('「{0}」のファイルが見つかりません。右クリック →「ファイルを選び直す…」', { 0: name });
    if (result.error === 'denied') return t('このアプリは管理者として動いているので、窓を動かせません。アプリを普通の権限で開くと、中央に合わせられます');
    if (result.error === 'notFound') return t('見つけられませんでした。一度閉じてから、このセルでもう一度開いてください');
    if (result.error === 'timeout') return t('「{0}」を開きましたが、返事が来ませんでした', { 0: name });
    return t('「{0}」の窓を中央に出せませんでした', { 0: name });
  }
  switch (result.action) {
    case 'placed':
      return t('「{0}」を中央に出しました', { 0: name });
    case 'fixed':
      return result.overlap
        ? t('「{0}」は大きさを変えられないので、サイドバーに重なることがあります', { 0: name })
        : t('「{0}」は大きさを変えられないので、中央に寄せました', { 0: name });
    case 'released':
      return t('「{0}」の最前面をやめました。位置はそのままです', { 0: name });
    case 'waiting':
      return t('「{0}」を開きましたが、どの窓か分からなかったので、中央には合わせられませんでした', { 0: name });
    case 'store':
      return t('「{0}」の窓を特定できませんでした。ほかのアプリの窓は動かしていません', { 0: name });
  }
}

// C++ の pickApp。やめたときは error cancel（お知らせは出さない）
export async function pickAppFile(): Promise<PickAppResult> {
  const reply = await request((requestId) => ({ type: 'pickApp', requestId }), 10 * 60_000);
  if (!reply || reply.type !== 'appPicked') return { ok: false, error: 'timeout' };
  if (!reply.ok) {
    const error = reply.error;
    return { ok: false, error: error === 'type' || error === 'missing' || error === 'dialog' || error === 'cancel' ? error : 'dialog' };
  }
  const launch = cleanPath(reply.launch);
  if (!launch) return { ok: false, error: 'type' };
  const name = cleanAppName(reply.name) || cleanAppName(appFileLabel({ launch, shortcut: '', target: '' })) || t('アプリ');
  return {
    ok: true,
    app: {
      name,
      launch,
      target: cleanPath(reply.target),
      args: cleanNote(reply.args),
      cwd: cleanPath(reply.cwd),
      shortcut: cleanPath(reply.shortcut),
      icon: cleanIcon(reply.icon),
      aumid: cleanAumid(reply.aumid),
    },
  };
}

// C++ の summonApp。中央の区画に合わせて最前面にする。無ければ起動して、最大約8秒、窓を待つ。
// release のときは最前面をやめる（位置と大きさはそのまま）。
export async function summonApp(
  app: Pick<AppEntry, 'launch' | 'target' | 'args' | 'cwd' | 'name' | 'shortcut'> & { host?: string; aumid?: string },
  options?: { release?: boolean },
): Promise<SummonResult> {
  const reply = await request(
    (requestId) => ({
      type: 'summonApp',
      requestId,
      launch: app.launch,
      target: app.target,
      args: app.args,
      cwd: app.cwd,
      host: app.host ?? '',
      shortcut: app.shortcut,
      name: app.name,
      aumid: app.aumid ?? '',
      release: options?.release === true,
    }),
    12_000,
  );
  if (!reply || reply.type !== 'appSummoned') return { ok: false, error: 'timeout' };
  if (!reply.ok) {
    const error = reply.error;
    if (error === 'badPath' || error === 'denied' || error === 'notFound' || error === 'failed') return { ok: false, error };
    return { ok: false, error: 'failed' };
  }
  if (reply.action === 'placed' || reply.action === 'fixed' || reply.action === 'released' || reply.action === 'waiting' || reply.action === 'store') {
    return { ok: true, action: reply.action, overlap: reply.overlap === true, host: cleanPath(reply.host), aumid: cleanAumid(reply.aumid) };
  }
  return { ok: false, error: 'failed' };
}

function parseApp(raw: unknown): AppEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const a = raw as Record<string, unknown>;
  if (!isAppId(a.id)) return null;
  const launch = cleanPath(a.launch);
  if (!launch) return null;
  const createdAt = typeof a.createdAt === 'number' ? a.createdAt : Date.now();
  return {
    id: a.id,
    name: cleanAppName(a.name) || t('アプリ'),
    launch,
    target: cleanPath(a.target),
    args: cleanNote(a.args),
    cwd: cleanPath(a.cwd),
    shortcut: cleanPath(a.shortcut),
    icon: cleanIcon(a.icon),
    host: cleanPath(a.host),
    aumid: cleanAumid(a.aumid),
    createdAt,
    placedAt: typeof a.placedAt === 'number' ? a.placedAt : createdAt,
  };
}

export class AppStore {
  private apps: AppEntry[] = [];
  private readonly listeners: (() => void)[] = [];
  private loaded = false;
  private saveTimer = 0;

  async load() {
    const saved = await readData<{ version?: unknown; apps?: unknown }>(FILE);
    const list: AppEntry[] = [];
    if (saved && saved.version === 1 && Array.isArray(saved.apps)) {
      for (const raw of saved.apps) {
        const app = parseApp(raw);
        if (app && list.length < MAX_APPS && !list.some((item) => item.id === app.id)) list.push(app);
      }
    }
    this.apps = list;
    this.loaded = true;
    this.emit();
  }

  get ready() {
    return this.loaded;
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  list(): AppEntry[] {
    return [...this.apps];
  }

  // 丸いボタン用。最後に置いたものが先
  recent(limit = APP_PILL_COUNT): AppEntry[] {
    return [...this.apps].sort((a, b) => b.placedAt - a.placedAt || b.createdAt - a.createdAt).slice(0, limit);
  }

  get(id: string | null | undefined) {
    return id ? this.apps.find((app) => app.id === id) : undefined;
  }

  findLaunch(launch: string) {
    return this.apps.find((app) => sameLaunch(app.launch, launch));
  }

  add(picked: PickedApp): AppEntry | null {
    if (this.apps.length >= MAX_APPS) return null;
    let id = newAppId();
    while (this.get(id)) id = newAppId();
    const now = Date.now();
    const app: AppEntry = { id, ...picked, host: '', name: cleanAppName(picked.name) || t('アプリ'), createdAt: now, placedAt: now };
    this.apps.push(app);
    this.changed();
    return app;
  }

  rename(id: string, name: string): boolean {
    const app = this.get(id);
    const clean = cleanAppName(name);
    if (!app || !clean) return false;
    if (app.name === clean) return true;
    app.name = clean;
    this.changed();
    return true;
  }

  // ファイルを選び直す。付けた名前は残す
  replaceFile(id: string, picked: PickedApp): boolean {
    const app = this.get(id);
    if (!app) return false;
    app.launch = picked.launch;
    app.target = picked.target;
    app.args = picked.args;
    app.cwd = picked.cwd;
    app.shortcut = picked.shortcut;
    app.icon = picked.icon;
    app.host = '';
    app.aumid = picked.aumid;
    this.changed();
    return true;
  }

  // 中央に合わせた窓の実行ファイル。次回から、台帳の target と一緒にフルパスで探す
  rememberHost(id: string, host: string) {
    const app = this.get(id);
    const path = cleanPath(host);
    if (!app || !path || sameLaunch(app.host, path)) return;
    app.host = path;
    this.changed();
  }

  // ショートカットか、掴んだ窓のアプリ ID。空のままなら、次の起動でショートカットから読み直す
  rememberAumid(id: string, aumid: string) {
    const app = this.get(id);
    const clean = cleanAumid(aumid);
    if (!app || !clean || app.aumid === clean) return;
    app.aumid = clean;
    this.changed();
  }

  touch(id: string) {
    const app = this.get(id);
    if (!app) return;
    app.placedAt = Date.now();
    this.changed();
  }

  remove(id: string) {
    const next = this.apps.filter((app) => app.id !== id);
    if (next.length === this.apps.length) return;
    this.apps = next;
    this.changed();
  }

  private changed() {
    this.emit();
    if (!this.loaded) return;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flush(), 400);
  }

  flush() {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    if (this.loaded) void writeData(FILE, { version: 1, apps: this.apps });
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}
