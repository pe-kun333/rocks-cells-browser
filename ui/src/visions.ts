// Grok Visions（第3段 S3.7b）：Grok Bot（合体 Grok で聞いたときも）が「有意義な発言ができた」と自分で判断して、返事の最後に足した
//   「## Vision」の節（短い題名と1〜3行の要点）を取り出して、1件1ファイルで残す。右サイドバーの上の「月の窓」に「Grok Visions」として映す
//   ・返事の決まりの1項目は bots.ts の botRequestCopyText（BOT_VISION_RULE）。中継の項目・request.v1・message.v1 は変えない（text の中だけ）
//   ・返事を受け取って確かめる（check・二重の見分け）のは今のまま（bots.ts の BotInbox・bot-replies.ts の applyBotMessage）。
//     ここは、確かめ終えて記録に書けた「依頼と合う1通目の reply」だけを見る（BotInbox.onReply。灰色・2通目から・エラーは見ない）
//   ・保存先：ui-data\visions\<id>.json（1件1ファイル。letters.ts と同じ readData・writeData）。件数の上限は設けない
//     （データ置き場と同じ決まり：おおよその大きさを出す）
//   ・持ち主は左サイドバー（返事を受け取るのが左なので）。右は写し（relay の visions）を見て、消したいときは命令 removeVision で頼む
//   ・1つの依頼に1件まで。要点が同じもの（空白・記号・全角半角・大文字小文字の違いだけのもの）は重ねて残さない
//   ・題名は 60 字・要点は 3 行であわせて 600 字まで。見えない制御文字・文字の向きを変える文字は消す
//   ・外から来た文：画面には文字としてだけ出す（textContent。HTML にしない）
import { type BotLink, type BotMessage, BOT_MESSAGE_ID_RE, cleanBotLine, cleanBotText, cutChars, FILE_ID_RE, RELAY_REQUEST_ID_RE } from './bot-replies';
import { deleteData, listData, readData, writeData } from './data';

export const VISION_TITLE_MAX = 60; // 題名（文字）
export const VISION_POINTS_MAX = 600; // 要点（あわせて。文字）
export const VISION_POINT_LINES = 3; // 要点の行
const VISION_LINKS = 5; // 出典の URL（返事の links から）
const BOT_NAME_MAX = 40;
const ROLE_MAX = 40;
const DIR = 'visions';
const VISION_ID_RE = /^v[0-9a-z]{4,30}$/;
const BOT_ID_RE = /^b[0-9a-z]{4,24}$/; // bots.ts の BOT_ID_RE と同じ
const WEB_URL_RE = /^https?:\/\/\S+$/;

// 「## Vision」の節から取り出したもの
export interface VisionDraft {
  title: string;
  points: string[]; // 1〜3行
}

// 残した Vision（ui-data\visions\<id>.json の中身）
export interface Vision extends VisionDraft {
  v: 1;
  id: string; // VISION_ID_RE（ファイルの名前と同じ）
  createdAt: number; // 残した時刻
  requestId: string; // もとの依頼（hb-…）
  role?: string; // 依頼に入れた役の名前（役なしなら無し）
  group?: number; // みんなに聞くの組の番号（1体だけに頼んだなら無し）
  botId: string; // どのボットか
  botName: string; // 残したときのボットの名前（あとで名前を変えた・台帳から消したときも読めるように）
  links?: BotLink[]; // 出典の URL（返事の links から 5 つまで）
  source: { fileId: string; messageId: string; at?: string }; // もとの返事の場所（bots\<botId>\log-*.json の fileId・返事の id・ボットが書いた時刻）
}

// BotInbox.onReply から受け取るもの（check は外してある）
export interface VisionReply {
  botId: string;
  botName: string;
  fileId: string;
  message: BotMessage;
  role?: string;
  group?: number;
}

// ---------- 取り出す ----------

const FENCE_RE = /^\s{0,3}(```|~~~)/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s/;
// 「## Vision」「## Vision：題名」「### Grok Vision」など（Visionary などの別の語は通さない）
const VISION_HEAD_RE = /^\s{0,3}(#{1,6})\s*(?:grok\s*)?visions?\b\s*[:：\-–—]?\s*(.*)$/i;
const RULE_RE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/; // ---（区切りの線）

// 1行を整える：見出しの #・引用の >・箇条書きの印・番号・太字の ** を外し、空白をまとめる（見えない制御文字も消える）
function cleanVisionLine(line: string): string {
  return cleanBotLine(
    line
      .replace(/^\s*>+\s*/, '')
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/^\s*(?:[-*+・•●◆◇■□]\s+|[・•●◆◇■□]\s*|\d{1,2}[.)）](?!\d)\s*|[（(]\d{1,2}[)）]\s*)/, '')
      .replace(/\*\*|__/g, ''),
  );
}

// 先頭の「題名：」「要点：」などの札を外す
const stripLabel = (line: string, labels: RegExp) => line.replace(labels, '').trim();
const TITLE_LABEL_RE = /^(?:題名|タイトル|表題|title)\s*[:：]\s*/i;
const POINTS_LABEL_RE = /^(?:要点|ポイント|points?|summary)\s*[:：]\s*/i;

// 要点を 3 行・あわせて 600 字までにする（はみ出す行は切る。空の行は落とす）
function clipPoints(lines: readonly string[]): string[] {
  const out: string[] = [];
  let left = VISION_POINTS_MAX;
  for (const line of lines) {
    if (out.length >= VISION_POINT_LINES || left <= 0) break;
    const cut = cutChars(line, left).text.trim();
    if (!cut) continue;
    out.push(cut);
    left -= [...cut].length;
  }
  return out;
}

// 返事の text から「## Vision」の節だけを取り出す（無い・中身が空なら null）
//   ・いちばん最後の「## Vision」を使う（決まりは「本文の最後に」。コードの囲み ``` の中の見出しは見ない）
//   ・節は、同じか上の段の見出し（Vision が ## なら # か ##）か、中身のあとの区切りの線 --- まで
//   ・最初の行が題名（「## Vision：題名」のように見出しの行にあれば、それ）、残りが要点（3 行まで）。題名だけなら、その行を要点にもする
export function extractVision(text: string): VisionDraft | null {
  if (typeof text !== 'string' || !text) return null;
  const lines = cleanBotText(text).split('\n');
  let start = -1;
  let level = 0;
  let inline = '';
  let fence = false;
  lines.forEach((line, i) => {
    if (FENCE_RE.test(line)) {
      fence = !fence;
      return;
    }
    if (fence) return;
    const m = VISION_HEAD_RE.exec(line);
    if (m) {
      start = i;
      level = m[1].length;
      inline = m[2];
    }
  });
  if (start < 0) return null;
  const body: string[] = [];
  fence = false;
  for (const line of lines.slice(start + 1)) {
    if (FENCE_RE.test(line)) {
      fence = !fence;
      continue;
    }
    if (!fence) {
      const h = HEADING_RE.exec(line);
      if (h && h[1].length <= level) break;
      if (RULE_RE.test(line)) {
        if (body.some((l) => cleanVisionLine(l))) break;
        continue;
      }
    }
    body.push(line);
  }
  const items = body.map(cleanVisionLine).filter(Boolean);
  const head = stripLabel(cleanVisionLine(inline), TITLE_LABEL_RE);
  const titleFull = head || stripLabel(items.shift() ?? '', TITLE_LABEL_RE);
  const points = clipPoints(items.map((l) => stripLabel(l, POINTS_LABEL_RE)));
  if (!titleFull) return null;
  const title = cutChars(titleFull, VISION_TITLE_MAX).text.trim();
  return { title, points: points.length ? points : clipPoints([titleFull]) };
}

// 要点の見分け（同じ要点を重ねて残さない）：全角半角・大文字小文字をそろえ、空白と記号を外したもの
export function visionKey(points: readonly string[]): string {
  return points
    .join('')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

// 受け取った返事から、残す Vision を作る（節が無い・reply でない・形が違うときは null。同じものがあるかはここでは見ない）
export function buildVision(reply: VisionReply, now: number, id: string): Vision | null {
  const m = reply.message;
  if (!m || m.type !== 'reply' || !m.requestId || !RELAY_REQUEST_ID_RE.test(m.requestId)) return null;
  if (!BOT_ID_RE.test(reply.botId) || !FILE_ID_RE.test(reply.fileId) || !BOT_MESSAGE_ID_RE.test(m.id)) return null;
  const draft = extractVision(m.text);
  if (!draft || !visionKey(draft.points)) return null;
  const links = (m.links ?? []).filter((l) => typeof l?.url === 'string' && WEB_URL_RE.test(l.url)).slice(0, VISION_LINKS);
  const role = cleanBotLine(reply.role ?? '');
  return {
    v: 1,
    id,
    ...draft,
    createdAt: now,
    requestId: m.requestId,
    ...(role ? { role: cutChars(role, ROLE_MAX).text } : {}),
    ...(Number.isInteger(reply.group) && (reply.group ?? 0) >= 1 ? { group: reply.group } : {}),
    botId: reply.botId,
    botName: cutChars(cleanBotLine(reply.botName) || 'ボット', BOT_NAME_MAX).text,
    ...(links.length ? { links: links.map((l) => ({ url: l.url, ...(l.title ? { title: cutChars(cleanBotLine(l.title), 200).text } : {}) })) } : {}),
    source: { fileId: reply.fileId, messageId: m.id, ...(m.at ? { at: cutChars(cleanBotLine(m.at), 64).text } : {}) },
  };
}

// 読んだファイル・届いた写しを確かめる（形の違うものは null。長すぎる文は切り、見えない文字は消す）
export function parseVision(raw: unknown): Vision | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const src = (typeof r.source === 'object' && r.source !== null ? r.source : {}) as Record<string, unknown>;
  if (r.v !== 1 || typeof r.id !== 'string' || !VISION_ID_RE.test(r.id)) return null;
  if (typeof r.requestId !== 'string' || !RELAY_REQUEST_ID_RE.test(r.requestId) || typeof r.botId !== 'string' || !BOT_ID_RE.test(r.botId)) return null;
  if (typeof src.fileId !== 'string' || !FILE_ID_RE.test(src.fileId) || typeof src.messageId !== 'string' || !BOT_MESSAGE_ID_RE.test(src.messageId)) return null;
  const title = cutChars(cleanBotLine(typeof r.title === 'string' ? r.title : ''), VISION_TITLE_MAX).text;
  const points = clipPoints((Array.isArray(r.points) ? r.points : []).filter((p): p is string => typeof p === 'string').map(cleanBotLine));
  if (!title || !points.length) return null;
  const line = (v: unknown, max: number) => (typeof v === 'string' ? cutChars(cleanBotLine(v), max).text : '');
  const links = (Array.isArray(r.links) ? r.links : [])
    .filter((l): l is { url: string; title?: unknown } => typeof l === 'object' && l !== null && typeof (l as { url?: unknown }).url === 'string')
    .filter((l) => l.url.length <= 2048 && WEB_URL_RE.test(l.url))
    .slice(0, VISION_LINKS)
    .map((l) => ({ url: l.url, ...(line(l.title, 200) ? { title: line(l.title, 200) } : {}) }));
  const role = line(r.role, ROLE_MAX);
  const at = line(src.at, 64);
  return {
    v: 1,
    id: r.id,
    title,
    points,
    createdAt: typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : 0,
    requestId: r.requestId,
    ...(role ? { role } : {}),
    ...(Number.isInteger(r.group) && (r.group as number) >= 1 ? { group: r.group as number } : {}),
    botId: r.botId,
    botName: line(r.botName, BOT_NAME_MAX) || 'ボット',
    ...(links.length ? { links } : {}),
    source: { fileId: src.fileId, messageId: src.messageId, ...(at ? { at } : {}) },
  };
}

const newVisionId = () => `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6).padEnd(4, '0')}`;
const fileOf = (id: string) => `${DIR}/${id}.json`;
const byteLength = (text: string) => new TextEncoder().encode(text).length;

// ---------- 左：残す・消す（ui-data\visions\） ----------

export class VisionStore {
  private visions: Vision[] = []; // 新しい順
  private readonly sizes = new Map<string, number>(); // ファイルの大きさ（バイト。おおよその使っている大きさを出す）
  private readonly listeners: (() => void)[] = [];
  private loaded = false;
  private loading: Promise<void> | null = null;

  // 起動のときに1回（返事が先に届いても、読み終えるまで待ってから重なりを見る）
  load(): Promise<void> {
    this.loading ??= (async () => {
      const files = (await listData(DIR))
        .map((f) => ({ id: /(?:^|\/)(v[0-9a-z]{4,30})\.json$/.exec(f.name)?.[1], size: f.size }))
        .filter((f): f is { id: string; size: number } => !!f.id);
      const read = await Promise.all(files.map((f) => readData<unknown>(fileOf(f.id))));
      const seen = new Set<string>();
      const list: Vision[] = [];
      read.forEach((raw, i) => {
        const vision = parseVision(raw);
        if (!vision || vision.id !== files[i].id || seen.has(vision.id)) return;
        seen.add(vision.id);
        list.push(vision);
        this.sizes.set(vision.id, Number.isFinite(files[i].size) && files[i].size > 0 ? files[i].size : byteLength(JSON.stringify(vision)));
      });
      // 読んでいる間に足したもの（あれば）を残す
      this.visions = [...this.visions.filter((v) => !seen.has(v.id)), ...list].sort((a, b) => b.createdAt - a.createdAt);
      this.loaded = true;
      this.emit();
    })();
    return this.loading;
  }

  get ready() {
    return this.loaded;
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  list(): readonly Vision[] {
    return this.visions;
  }

  // おおよその使っている大きさ（バイト）
  get bytes(): number {
    let sum = 0;
    for (const id of this.visions.map((v) => v.id)) sum += this.sizes.get(id) ?? 0;
    return sum;
  }

  // 受け取った返事に「## Vision」の節があれば残す（残したものを返す。無い・同じ依頼のものがある・要点が同じものがある・書けないときは null）
  async addReply(reply: VisionReply, now = Date.now()): Promise<Vision | null> {
    if (reply.message?.type !== 'reply') return null;
    await this.load();
    const vision = buildVision(reply, now, newVisionId());
    if (!vision) return null;
    if (this.visions.some((v) => v.requestId === vision.requestId)) return null; // 1つの依頼に1件まで
    const key = visionKey(vision.points);
    if (this.visions.some((v) => visionKey(v.points) === key)) return null; // 要点が同じものは重ねない
    this.visions.unshift(vision);
    this.sizes.set(vision.id, byteLength(JSON.stringify(vision)));
    this.emit();
    if (await writeData(fileOf(vision.id), vision)) return vision;
    // 書けなかった：残さない（月の窓からも外す）
    this.visions = this.visions.filter((v) => v.id !== vision.id);
    this.sizes.delete(vision.id);
    this.emit();
    return null;
  }

  // 使う人が消す（確かめは画面で済ませてある）
  remove(id: string): boolean {
    if (!VISION_ID_RE.test(id) || !this.visions.some((v) => v.id === id)) return false;
    this.visions = this.visions.filter((v) => v.id !== id);
    this.sizes.delete(id);
    deleteData(fileOf(id));
    this.emit();
    return true;
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

// ---------- 右：左から届く写し（relay の visions）と、月の窓に出すかどうか（巣の設定 visions） ----------

export class VisionView {
  private items: Vision[] = [];
  private shown = true; // 巣の設定「月の窓に Visions を出す」（既定オン）
  private loaded = false;
  private size = 0;
  private readonly listeners: (() => void)[] = [];

  set(payload: { visions?: unknown; bytes?: unknown; ready?: unknown }) {
    const seen = new Set<string>();
    this.items = (Array.isArray(payload.visions) ? payload.visions : [])
      .map(parseVision)
      .filter((v): v is Vision => !!v && !seen.has(v.id) && !!seen.add(v.id))
      .sort((a, b) => b.createdAt - a.createdAt);
    this.size = typeof payload.bytes === 'number' && Number.isFinite(payload.bytes) && payload.bytes > 0 ? payload.bytes : 0;
    this.loaded = payload.ready === true;
    this.emit();
  }

  setEnabled(on: boolean) {
    if (on === this.shown) return;
    this.shown = on;
    this.emit();
  }

  get ready() {
    return this.loaded;
  }

  get enabled() {
    return this.shown;
  }

  get bytes() {
    return this.size;
  }

  list(): readonly Vision[] {
    return this.items;
  }

  get(id: string | undefined): Vision | undefined {
    return id ? this.items.find((v) => v.id === id) : undefined;
  }

  // この返事（記録の fileId）から残した Vision（ボットの欄の「Vision」札）
  byFile(botId: string, fileId: string): Vision | undefined {
    return this.items.find((v) => v.botId === botId && v.source.fileId === fileId);
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}
