// ボードのカードのメニューと説明の文の計算（DOM も保存も使わない。ui/test/memo-card-board-menu.test.ts）
//   描くのは app/memo-board-tab.ts。ここで決めるのは：カードの事実の 1 行、乗せた説明の文、カードのメニューの項目
import { t as tr } from './i18n';
import type { MenuButton, MenuEntry } from './panels/cell-menu';
import { markCountNote, visibleTags } from './grok-cards-tags';
import { cardColor, cardLike, colorTag, type LikeLevel, likeTag, MARK_COLORS, markColorLabel, type MarkKind } from './likes';
import { deleteTitle, editCheck, liveSelection, relationsOf } from './memo-card-board-edit';
import { TIDY_LABEL } from './memo-card-board-tidy';
import { cardLines, replyCount } from './memo-card-board-view';
import { cardLabel, type LinkKind, linkKindInfo } from './memo-card-links';
import { parseAiCardText, secLabel } from './reader-ai-card';
import { pasteBlocked, TEMPLATE_MIN_PICK, templateMenuGroups, templateMenuLabel, templateModeNote } from './memo-card-template-store';
import { type CardTemplate, extractHoles, MODE_LABELS, TEMPLATE_LIMITS } from './memo-card-templates';
import { MAX_TAGS_PER_TAB } from './tags';
import { quoteSourceLabel, type Reply } from './threads';

export const TIP_TEXT_MAX = 400; // 乗せた説明に入れる文の字数

// 線のメニュー（CB15）。元へ移る・相手へ移る・種類・この関連を外す（二度押し）。向きを逆にするのは入れない
export interface LineMenuInput {
  sentence: string; // 「A は B の根拠」
  fromLabel: string;
  toLabel: string;
  choices: readonly { kind: LinkKind; name: string; current: boolean; disabled: boolean }[];
  goFrom(): void;
  goTo(): void;
  setKind(kind: LinkKind): void;
  remove(): void;
}

export function lineMenuEntries(o: LineMenuInput): MenuEntry[] {
  const kinds: MenuButton[] = o.choices
    .filter((c) => !c.disabled)
    .map((c) => ({ label: c.name, pressed: c.current, close: true, run: () => (c.current ? undefined : o.setKind(c.kind)) }));
  return [
    { section: o.sentence },
    { label: tr('元へ移る'), hint: o.fromLabel, run: o.goFrom },
    { label: tr('相手へ移る'), hint: o.toLabel, run: o.goTo },
    'sep',
    { row: tr('種類'), buttons: kinds, wrap: true },
    { row: tr('この関連'), buttons: [{ label: tr('外す'), confirm: tr('もう一度で外す'), close: true, run: o.remove }] },
  ];
}

// 書いた日時（下の一覧と同じ形：11/2 09:05）
export function cardDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 引用のページのドメイン。取れなければ空（壊れた url でも例外を外へ出さない）
function domainOf(reply: Reply): string {
  if (!reply.quote) return '';
  try {
    return new URL(reply.quote.url).hostname;
  } catch {
    return '';
  }
}

// カードの事実の 1 行：書き手 · 日時 · 字数（あれば）· 返信 n · 関連 n · いいね n · 色：名前 · ドメイン。項目のつなぎは「 · 」
//   書き手：by があれば（AI のカード）名前。名前が空白だけなら AI。by が無ければ（人のカード）あなた
export function cardFacts(replies: readonly Reply[], reply: Reply): string {
  const items: string[] = [];
  items.push(writerOf(reply));
  items.push(cardDate(reply.createdAt));
  const chars = [...reply.text].length;
  if (chars > 0) items.push(tr('{0} 字', { 0: chars }));
  const replied = replyCount(replies, reply.id);
  if (replied >= 1) items.push(tr('返信 {0}', { 0: replied }));
  const linked = relationsOf(replies, reply.id).length;
  if (linked >= 1) items.push(tr('関連 {0}', { 0: linked }));
  const like = cardLike(reply.tags ?? []);
  if (like > 0) items.push(tr('いいね {0}', { 0: like })); // カードの ♥ の段（MK6。字だけ。乗せた説明 cardTip にも入る）
  const color = cardColor(reply.tags ?? []);
  if (color) items.push(tr('色：{0}', { 0: markColorLabel(color) })); // カードの色の印（MK7。字だけ。乗せた説明 cardTip にも入る）
  const host = domainOf(reply);
  if (host) items.push(host);
  return items.join(' · ');
}

// カードの文（cardLines の行を改行でつなぐ。空なら引用の文・引用の題・画像・空の札の順の最初の空でないもの）
function tipText(reply: Reply): string {
  const body = cardLines(reply).join('\n');
  if (body !== '') return body;
  const quoteText = reply.quote?.text.trim() ?? '';
  if (quoteText !== '') return quoteText;
  const quoteTitle = reply.quote?.title.trim() ?? '';
  if (quoteTitle !== '') return quoteTitle;
  if (reply.image) return tr('（画像）');
  return tr('（空）');
}

// 乗せた説明の文：カードの文の頭（TIP_TEXT_MAX 字まで。超えたら末尾に …）と、改行と、事実の 1 行
export function cardTip(replies: readonly Reply[], reply: Reply): string {
  const text = tipText(reply);
  const chars = [...text];
  const head = chars.length > TIP_TEXT_MAX ? `${chars.slice(0, TIP_TEXT_MAX).join('')}…` : text;
  return `${head}\n${cardFacts(replies, reply)}`;
}

// ---------- カードのメニュー（段 CB4b）：読む＋行く＋編集 の項目を作る。押したときの動きは呼ぶ側が渡す ----------

// 押したときの動き（配線は memo-board-tab.ts）
export interface CardMenuActions {
  page(reply: Reply): void; // ↗ 引用のページ
  video(reply: Reply): void; // ▶ 読む画面のその時刻
  capture(reply: Reply): void; // 撮影へ
  list(reply: Reply): void; // 下の一覧
  cell(): void; // 左の盤面のセル
  read(reply: Reply): void; // 関連の相手をメニューの中で読む
  hop(reply: Reply): void; // そのカードへ移る
  copy(reply: Reply): void; // 全文と出どころをコピー
  pin(reply: Reply): void; // 全文を面に残す（上に出しているときだけ）
  back(): void; // 1 段戻る（読む段から元のメニューへ・移った先から元のカードへ）
  edit(reply: Reply): void; // 書き直す（書く欄を開く。F2 と同じ）
  link(reply: Reply): void; // このカードから線を引き始める
  tags(reply: Reply): void; // タグの段へ替える
  template(reply: Reply): void; // 型の段へ替える（TA2）
  remove(reply: Reply): void; // 消す（押したカードが選びの中で 2 枚以上なら選んだ全部。道具の列の［削除］と同じ道。MK1）
  mark(reply: Reply, kind: MarkKind, value: string): void; // カードの印（♥ は MK6、色は MK7）を value（likes.ts の値。空＝外す）にする。そのカード 1 枚だけ（選びは替えない）
}

export interface CardMenuInput {
  replies: readonly Reply[];
  id: string;
  upper: boolean; // 上に出している
  other: boolean; // 別のメモを見ている
  picture?: string; // 読めた画像（data:image/ の文字列）
  from?: Reply; // 移ってきた元のカード（あれば先頭に「← 元のカードへ」）
  picked?: number; // ［削除］で消す枚数（menuPicked。省くと 1。MK1）
  actions: CardMenuActions;
}

export const MENU_RELATION_MAX = 5; // 関連の行の数（多い分は「ほかに n 本」）
const GONE = tr('このカードは、もうありません');

// 書き手の名（cardFacts と同じ決まり：AI の名前が空白だけなら AI。by が無ければあなた）
function writerOf(reply: Reply): string {
  return reply.by ? reply.by.name.trim() || 'AI' : tr('あなた');
}

// 作った順（createdAt、同じ時刻は id の順）
const compareWritten = (a: Reply, b: Reply) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// カードの見出しの行：書き手 · 日時 · n 字（文が無ければ字数なし）、あれば AI の型番・約 $・書き直し済み
export function cardHead(reply: Reply): string {
  const items = [writerOf(reply), cardDate(reply.createdAt)];
  const chars = [...reply.text].length;
  if (chars > 0) items.push(tr('{0} 字', { 0: chars }));
  const model = reply.by?.model;
  if (model) items.push(model);
  const cost = reply.by?.cost;
  if (cost !== undefined && cost > 0) items.push(tr('約 ${0}', { 0: cost.toFixed(3) }));
  if (reply.editedAt !== undefined) items.push(tr('書き直し済み'));
  return items.join(' · ');
}

// この文の下にぶら下がる返信の全部（返信の返信も。作った順）
function repliesUnder(replies: readonly Reply[], id: string): Reply[] {
  const seen = new Set<string>([id]);
  const out: Reply[] = [];
  const queue = [id];
  while (queue.length > 0) {
    const cur = queue.pop() as string;
    for (const r of replies) {
      if (r.parent === cur && !seen.has(r.id)) {
        seen.add(r.id);
        out.push(r);
        queue.push(r.id);
      }
    }
  }
  return out.sort(compareWritten);
}

// 本文：読む画面の AI のカードは見出しと各行を組み直す（押せないので「▶」は付けない。時刻と技法は読めるように残す）。ほかは文のまま
function bodyText(reply: Reply): string {
  if (reply.by && reply.at?.kind) {
    const body = parseAiCardText(reply.text);
    const rows = body.rows.map((row) => (row.kind === 'timed' ? `${row.label}${row.tech ? `〔${row.tech}〕` : ' '}${row.text}` : row.text));
    return [body.head, ...rows].filter((s) => s !== '').join('\n');
  }
  return reply.text.trim();
}

// 全文（1 つの文にまとめる。区切りは ──）：引用・本文・返信（💬）。全部空なら空文字
export function cardFullText(replies: readonly Reply[], reply: Reply): string {
  const parts: string[] = [];
  const quote = reply.quote?.text.trim() ?? '';
  if (quote !== '') parts.push(`❝ ${quote}`);
  const body = bodyText(reply);
  if (body !== '') parts.push(body);
  const under = repliesUnder(replies, reply.id).map((r) => `💬 ${writerOf(r)}：${r.text.trim()}`);
  if (under.length > 0) parts.push(under.join('\n'));
  return parts.join('\n──\n');
}

// コピー用の文（行を改行でつなぐ）：引用の文（> ）・引用の出どころ・本文・返信（- 。改行は空白に）
export function cardCopyText(replies: readonly Reply[], reply: Reply): string {
  const lines: string[] = [];
  const quote = reply.quote?.text.trim() ?? '';
  if (quote !== '') lines.push(...quote.split('\n').map((l) => `> ${l}`));
  if (reply.quote) lines.push(`— [${reply.quote.title.trim() || tr('ページ')}](${reply.quote.url})`);
  const body = reply.text.trim();
  if (body !== '') lines.push(body);
  for (const r of repliesUnder(replies, reply.id)) lines.push(`- ${r.text.trim().replace(/\r?\n/g, ' ')}`);
  return lines.join('\n');
}

// 書いた順の前と後ろ（一番上のカードどうし。id が見つからなければ両方 null。返信は数えない）
export function writtenNeighbors(replies: readonly Reply[], id: string): { prev: Reply | null; next: Reply | null } {
  const tops = replies.filter((r) => r.parent === null).sort(compareWritten);
  const i = tops.findIndex((r) => r.id === id);
  if (i < 0) return { prev: null, next: null };
  return { prev: i > 0 ? tops[i - 1] : null, next: i + 1 < tops.length ? tops[i + 1] : null };
}

// 引用の url のホスト名（http・https だけ。壊れた url や別の形なら null）
function pageHost(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname : null;
  } catch {
    return null;
  }
}

// 行くの段のボタン（1 段目と読む段で同じ）：↗ ▶ 撮影へ 下の一覧 セル
function goButtons(input: CardMenuInput, reply: Reply): MenuButton[] {
  const { actions, upper, other } = input;
  const buttons: MenuButton[] = [];
  const quote = reply.quote;
  const host = quote ? pageHost(quote.url) : null;
  if (quote && host !== null) {
    buttons.push({
      label: `↗ ${host}`,
      title: upper ? tr('{0}（下に戻して開きます）', { 0: quoteSourceLabel(quote) }) : quoteSourceLabel(quote),
      close: !upper,
      run: () => actions.page(reply),
    });
  }
  if (reply.at) {
    const { spans, title } = reply.at;
    const more = spans.length - 1;
    const tail = upper ? tr('（下に戻して開きます）') : '';
    buttons.push({
      label: `▶ ${secLabel(spans[0].start)}${more > 0 ? ` ほか ${more}` : ''}`,
      title: `${title || tr('読む画面でこの時刻へ')}${tail}`,
      close: !upper,
      run: () => actions.video(reply),
    });
  }
  if (reply.image) buttons.push({ label: tr('撮影へ'), title: tr('右の撮影に送って大きく開きます'), close: true, run: () => actions.capture(reply) });
  buttons.push({
    label: other ? tr('下の一覧（替える）') : upper ? tr('下の一覧') : tr('メモのタブで見る'),
    title: other ? tr('下の区画もこのメモに替えて、そのカードへ移ります') : tr('下の一覧のそのカードへ移ります'),
    close: !other,
    run: () => actions.list(reply),
  });
  buttons.push({ label: tr('セル'), title: tr('左の盤面でこのメモのセルへ移ります'), close: true, run: () => actions.cell() });
  return buttons;
}

// 囲み（全文）と絵（1 段目と読む段で同じ）
function bodyEntries(input: CardMenuInput, reply: Reply): MenuEntry[] {
  const out: MenuEntry[] = [];
  const text = cardFullText(input.replies, reply);
  if (text !== '') out.push({ note: text, scroll: true });
  if (input.picture) out.push({ picture: input.picture, alt: tr('カードの画像') });
  return out;
}

// 関連の段：相手が一番上のカードのものの先頭 MENU_RELATION_MAX 本と、ほかの数
function relationEntries(input: CardMenuInput, reply: Reply): MenuEntry[] {
  const linked = relationsOf(input.replies, reply.id).flatMap((rel) => {
    const other = input.replies.find((r) => r.id === rel.other && r.parent === null);
    return other ? [{ rel, other }] : [];
  });
  const out: MenuEntry[] = linked.slice(0, MENU_RELATION_MAX).map(({ rel, other }) => {
    const who = cardLabel(other, 10);
    const name = linkKindInfo(rel.kind).name;
    const row = rel.kind === 'same' ? tr('これと「{0}」は{1}', { 0: who, 1: name }) : rel.outgoing ? tr('これは「{0}」の{1}', { 0: who, 1: name }) : tr('「{0}」はこれの{1}', { 0: who, 1: name });
    return {
      row,
      buttons: [
        { label: tr('読む'), title: tr('移らずに相手の全文を読みます'), run: () => input.actions.read(other) },
        { label: tr('移る'), title: tr('見ている位置を相手へ動かします'), run: () => input.actions.hop(other) },
      ],
    };
  });
  if (linked.length > MENU_RELATION_MAX) out.push({ section: tr('ほかに {0} 本', { 0: linked.length - MENU_RELATION_MAX }) });
  return out;
}

// 書いた順の段（前と後ろ。どちらも無ければ段は出ない）
function writtenEntries(input: CardMenuInput, reply: Reply): MenuEntry[] {
  const { prev, next } = writtenNeighbors(input.replies, reply.id);
  const buttons: MenuButton[] = [];
  if (prev) buttons.push({ label: `← ${cardLabel(prev, 6)}`, title: tr('前に書いた：{0}', { 0: cardLabel(prev, 30) }), run: () => input.actions.hop(prev) });
  if (next) buttons.push({ label: `${cardLabel(next, 6)} →`, title: tr('次に書いた：{0}', { 0: cardLabel(next, 30) }), run: () => input.actions.hop(next) });
  return buttons.length > 0 ? [{ row: tr('書いた順'), wrap: true, buttons }] : [];
}

// 編集の行（1 段目だけ）：書き直す（書き直せるカードだけ。AI のカードには出さない）・関連線を足す・タグを足す…（段を替える）・型を足す…（段を替える。TA2）
function editRow(input: CardMenuInput, reply: Reply): MenuEntry {
  const { actions } = input;
  const buttons: MenuButton[] = [];
  if (editCheck(input.replies, [reply.id]).ok) buttons.push({ label: tr('書き直す'), title: tr('このカードの文を、書く欄で書き直します（F2 と同じ）'), close: true, run: () => actions.edit(reply) });
  buttons.push(
    { label: tr('関連線を足す'), title: tr('このカードから線を引きます。次に相手のカードを左で押すと、種類を選べます'), close: true, run: () => actions.link(reply) },
    { label: tr('タグを足す…'), title: tr('このカードにタグを足します'), close: false, run: () => actions.tags(reply) },
    { label: TEMPLATE_ADD_LABEL, title: tr('このカードの右と下に、型のカードを足します'), close: false, run: () => actions.template(reply) },
  );
  return { row: tr('編集'), wrap: true, buttons };
}

export const LIKE_LEVELS: readonly LikeLevel[] = [1, 2, 3];

// いいねの行（MK6。1 段目だけ。編集の行の下）：［♡1］［♡2］［♡3］（今の段が押された見た目）と、付いていれば［外す］。段を直に押すので、段の押しの止めは要らない
//   押すと閉じる（押された見た目は描き直さないので、開いたままだと古い段が残る）。
//   今の段を押しても送る（同じ値かどうかは setMark が、今の写しと待っている値で決める。開いたときの写しの段は、結果を待っている間に古くなるため。MK6 の見直し）
function likeRow(input: CardMenuInput, reply: Reply): MenuEntry {
  const now = cardLike(reply.tags ?? []);
  const buttons: MenuButton[] = LIKE_LEVELS.map((level) => ({
    label: `♡${level}`,
    pressed: level === now,
    close: true,
    run: () => input.actions.mark(reply, 'like', likeTag(level)),
  }));
  // 読み上げの名前は、元に戻すの名前と同じ字（色の行の［外す］と分ける。MK7 の見直し。§9.2 の字の外は増やさない）
  if (now > 0) buttons.push({ label: tr('外す'), aria: tr('いいねを外す'), close: true, run: () => input.actions.mark(reply, 'like', '') });
  return { row: tr('いいね'), wrap: true, buttons };
}

// 色の行（MK7。1 段目だけ。いいねの行の下）：色ごとのボタン（字は色の名前。今の色が押された見た目）と、付いていれば［外す］。1 枚に 1 色（替えると前の色は外れる。setReplyMark の置き換え）
//   押すと閉じる・今の色も送る・そのカード 1 枚だけ（いいねの行と同じ。同じ値かどうかは setMark が決める）
function colorRow(input: CardMenuInput, reply: Reply): MenuEntry {
  const now = cardColor(reply.tags ?? []);
  const buttons: MenuButton[] = MARK_COLORS.map((name) => ({
    label: markColorLabel(name),
    pressed: name === now,
    close: true,
    run: () => input.actions.mark(reply, 'color', colorTag(name)),
  }));
  if (now !== '') buttons.push({ label: tr('外す'), aria: tr('色を外す'), close: true, run: () => input.actions.mark(reply, 'color', '') }); // 読み上げの名前（いいねの行の［外す］と分ける）
  return { row: tr('色'), wrap: true, buttons };
}

// ［削除］で消す枚数（MK1）：押したカードが選び（台帳の一番上のカードにあるもの。道具の列と同じ数え方）の中なら選びの数、外なら 1
//   メニューを開くとき（字）と、押したとき（選びの見直し）の両方で使う
export function menuPicked(replies: readonly Reply[], selected: readonly string[], id: string): number {
  const live = liveSelection(replies, selected);
  return live.includes(id) ? live.length : 1;
}

// ［削除］の字（MK1）：2 枚以上なら「選んだ n 枚を削除」
export const menuRemoveLabel = (n: number): string => (n >= 2 ? tr('選んだ {0} 枚を削除', { 0: n }) : tr('削除'));

// 1 段目：カードのメニュー（カードが無ければ、消えたことを一つだけ出す）
export function cardMenuEntries(input: CardMenuInput): MenuEntry[] {
  const reply = input.replies.find((r) => r.id === input.id && r.parent === null);
  if (!reply) return [{ section: GONE }];
  const picked = Math.max(1, input.picked ?? 1);
  const out: MenuEntry[] = [];
  if (input.from) out.push({ label: tr('← 元のカードへ'), hint: cardLabel(input.from, 8), run: () => input.actions.back() });
  out.push(
    { section: cardHead(reply) },
    ...bodyEntries(input, reply),
    { row: tr('行く'), wrap: true, buttons: goButtons(input, reply) },
    ...relationEntries(input, reply),
    ...writtenEntries(input, reply),
    editRow(input, reply),
    likeRow(input, reply),
    colorRow(input, reply),
    {
      row: '',
      buttons: [
        ...(input.upper ? [{ label: tr('📌 留める'), title: tr('閉じずに残して、面を動かしても見ていられるようにします'), close: true, run: () => input.actions.pin(reply) }] : []),
        { label: tr('コピー'), title: tr('全文と出どころをコピーします'), close: true, run: () => input.actions.copy(reply) },
        // ［削除］（MK1）：確かめは無い（道具の列の［削除］・Delete キーと同じ。説明の字も同じ）
        { label: menuRemoveLabel(picked), title: deleteTitle(picked), close: true, run: () => input.actions.remove(reply) },
      ],
    },
  );
  return out;
}

// 読む段（関連の［読む］のあと）：先頭は「← 戻る」、行くの先頭は［移る］。関連・書いた順・コピーは無い
export function readMenuEntries(input: CardMenuInput): MenuEntry[] {
  const reply = input.replies.find((r) => r.id === input.id && r.parent === null);
  if (!reply) return [{ section: GONE }];
  return [
    { label: tr('← 戻る'), run: () => input.actions.back() },
    { section: cardHead(reply) },
    ...bodyEntries(input, reply),
    { row: tr('行く'), wrap: true, buttons: [{ label: tr('移る'), title: tr('見ている位置をこのカードへ動かします'), run: () => input.actions.hop(reply) }, ...goButtons(input, reply)] },
  ];
}

// タグの段（1 段目の［タグを足す…］のあと）：足すのはそのカード 1 枚だけ。外すのは面の下のタグの行のまま（ここには外すボタンを作らない）
export const MENU_TAG_CANDIDATES = 12; // 候補のボタンの数
export const TAG_WRITE_LABEL = tr('新しいタグを書く…'); // 新しいタグの欄を開く項目（開き直したとき、焦点をここへ置く）
export const TAG_POOL_CLASS = 'memo-board-tagpool'; // 候補の行の class（押された印を太字にしない。grok-cards.css）

// タグの段の候補（pool）。段を開いたときに 1 回だけ作り、段を閉じるまで同じものを使う（付けるたびに並びが替わって、押そうとした所に別のタグが来ないように）
//   candidates（タグの行の「＋タグ」と同じ cardTagCandidates の並び）から、そのカードに付いていないものを、順のまま先頭から MENU_TAG_CANDIDATES 個
export function tagMenuPool(candidates: readonly string[], cardTags: readonly string[]): string[] {
  return candidates.filter((tag) => !cardTags.includes(tag)).slice(0, MENU_TAG_CANDIDATES);
}

export interface TagMenuInput {
  replies: readonly Reply[];
  id: string;
  pool: readonly string[]; // 候補（tagMenuPool。段を開いたときのまま）
  back(): void; // ← 戻る（カードのメニューを開き直す）
  add(tag: string): void; // そのタグを足す（段は開いたまま。付いたら呼ぶ側が描き直す）
  write(): void; // 新しいタグを書く欄を開く
}

// 並び：← 戻る → 見出し → 候補の行 → ［新しいタグを書く…］ → いちばん下に付いているタグ（読むだけ）。タグが増えても、上のボタンの位置は動かない
//   候補は pool の全部を順のまま出す。もう付いているものは、同じ所に同じ名前で、押された印（pressed）で出す（押しても何もしない）。
//   名前に ✓ などを足すとボタンが広がり、後ろの候補がずれて、続けて押すと隣のタグが付くおそれがあるので、字は替えない。全部を pressed 付きにして、見た目の型をそろえる。
//   押された印のふだんの太字も幅を変える（英字の名前）ので、この行には TAG_POOL_CLASS を付け、grok-cards.css で太字にしない（印は枠と地の色）
//   上限のときは一言と付いているタグだけで、候補の行と書く項目は出さない
export function tagMenuEntries(o: TagMenuInput): MenuEntry[] {
  const reply = o.replies.find((r) => r.id === o.id && r.parent === null);
  if (!reply) return [{ section: GONE }];
  const tags = reply.tags ?? [];
  const shown = visibleTags(tags);
  const attached: MenuEntry[] = shown.length > 0 ? [{ note: tr('付いているタグ：{0}', { 0: shown.join('、') }) }] : [];
  const out: MenuEntry[] = [
    { label: tr('← 戻る'), run: () => o.back() },
    { section: tr('「{0}」にタグを足す', { 0: cardLabel(reply, 12) }) },
  ];
  if (tags.length >= MAX_TAGS_PER_TAB) {
    return [...out, { note: tr('タグは 1 つに {0} 個までです。ほかのタグを外してから付けてください', { 0: MAX_TAGS_PER_TAB }) + markCountNote(tags) }, ...attached]; // 印（♥・色）は数えるが見せないので、付いていればそう書く（MK5）
  }
  if (o.pool.length > 0) {
    const buttons: MenuButton[] = o.pool.map((tag) =>
      tags.includes(tag)
        ? { label: tag, pressed: true, title: tr('このカードに付いています'), close: false, run: () => undefined }
        : { label: tag, pressed: false, title: tr('タグ「{0}」を付けます', { 0: tag }), close: false, run: () => o.add(tag) },
    );
    out.push({ row: tr('候補'), wrap: true, className: TAG_POOL_CLASS, buttons });
  }
  out.push({ label: TAG_WRITE_LABEL, hint: tr('Enter で付ける'), run: () => o.write() });
  return [...out, ...attached];
}

// ---------- 型の段（TA2。1 段目の［型を足す…］のあと）：型を選ぶと、押したカードの右と下に足す。計画書 docs/plan-comment-board-templates.md ----------

export const TEMPLATE_ADD_LABEL = tr('型を足す…'); // 編集の行のボタンの字（段を置く高さを決めるとき、このボタンを字で探す）
export const TEMPLATE_HOLE_HINT = tr('ここからは足せません'); // 空欄のある穴あきの型（空欄の小窓を通らないので、ここからは足せない）
export const TEMPLATE_NONE_NOTE = tr('まだ型がありません');
export const TEMPLATE_HERE_HEADING = tr('ここに型を足す'); // 空きから開いた段の見出し（TA5）
export const TEMPLATE_CENTER_HEADING = tr('真ん中に型を足す'); // 題の帯から開いた段の見出し（TA5）

export interface TemplateTierInput {
  heading: string; // 見出し（例：「…」に型を足す）
  gone?: boolean; // カードから開いた段で、押したカードがもう無い
  templates: readonly CardTemplate[]; // 読めた型（保存順）
  skipped: number; // 読めない型の数
  existing: number; // 今のメモの返信の数（入りきるかを見る）
  maker: { label: string; make(mode: 'snapshot' | 'skeleton'): void } | null; // いちばん下の「型にする」の行（TA3。出さないときは null）
  erase: (() => void) | null; // 「型を消す…」（TA8。消す段へ替える。出さないときは null）
  back(): void; // ← 戻る
  pick(template: CardTemplate): void; // 型の行を押した
}

// いちばん下の「型にする」の行の名前（TA3）。選んだカードの組か、このボードの全部。2〜30 枚の外なら null（行を出さない）。枚数は、型の行「名前（4枚）」と同じく空白なしで書く
export function templateMakeLabel(scope: 'selected' | 'board', n: number): string | null {
  if (n < TEMPLATE_MIN_PICK || n > TEMPLATE_LIMITS.cards) return null;
  return scope === 'selected' ? tr('選んだ{0}枚を型にする', { 0: n }) : tr('このボードの{0}枚を型にする', { 0: n });
}

// 「型にする」の名前の元（TA5。空きと題の帯から開いた段：押したカードが無い）：登録するカード（ids）のうち、作った順でいちばん古いカードの文。無ければ空
export function oldestCardText(replies: readonly Reply[], ids: readonly string[]): string {
  const wanted = new Set(ids);
  let best: Reply | null = null;
  for (const r of replies) {
    if (!wanted.has(r.id)) continue;
    if (best === null || r.createdAt < best.createdAt || (r.createdAt === best.createdAt && r.id < best.id)) best = r;
  }
  return best?.text ?? '';
}

// 並び：← 戻る → 見出し →（型が 0 件のときの文）→ フォルダの見出しと型の行 →（読めない型の文）→（「型にする」の行）
//   型の行の字は、道具の列の「型を貼る ▾」と同じ（templateMenuLabel）。入りきらない型と、空欄のある穴あきの型は押せない（小さい字に理由）
export function templateTierEntries(o: TemplateTierInput): MenuEntry[] {
  if (o.gone) return [{ section: GONE }];
  const out: MenuEntry[] = [{ label: tr('← 戻る'), run: () => o.back() }, { section: o.heading }];
  if (o.templates.length === 0) out.push({ note: o.skipped > 0 ? tr('読める型がありません（読めない型が {0} 件あります）', { 0: o.skipped }) : TEMPLATE_NONE_NOTE });
  for (const group of templateMenuGroups(o.templates)) {
    out.push({ section: group.folder });
    for (const t of group.items) {
      const full = pasteBlocked(o.existing, t.cards.length) !== null;
      const hole = t.mode === 'hole' && extractHoles(t).length > 0;
      out.push({ label: templateMenuLabel(t), hint: full ? tr('入りきりません') : hole ? TEMPLATE_HOLE_HINT : undefined, disabled: full || hole, run: () => o.pick(t) });
    }
  }
  if (o.templates.length > 0 && o.skipped > 0) out.push({ note: tr('読めない型が {0} 件あります（出していません）', { 0: o.skipped }) });
  const maker = o.maker;
  if (maker) {
    const button = (mode: 'snapshot' | 'skeleton'): MenuButton => ({ label: MODE_LABELS[mode], title: templateModeNote(mode), close: true, run: () => maker.make(mode) });
    out.push({ row: maker.label, wrap: true, buttons: [button('snapshot'), button('skeleton')] });
  }
  const erase = o.erase;
  if (erase && o.templates.length > 0) out.push({ row: '', buttons: [{ label: TEMPLATE_DELETE_LABEL, title: tr('登録してある型を消します'), close: false, run: () => erase() }] });
  return out;
}

// 型を消す段（TA8。型の段の［型を消す…］のあと）：型ごとに［削除］。1 回目で「もう一度押すと削除」に替わり、2 回目で消える（下の区画の型の窓と同じ字）
export const TEMPLATE_DELETE_LABEL = tr('型を消す…');

export interface TemplateDeleteInput {
  templates: readonly CardTemplate[];
  back(): void; // ← 戻る（型の段へ）
  remove(template: CardTemplate): void;
}

export function templateDeleteEntries(o: TemplateDeleteInput): MenuEntry[] {
  const out: MenuEntry[] = [{ label: tr('← 戻る'), run: () => o.back() }, { section: tr('型を消す') }];
  if (o.templates.length === 0) out.push({ note: TEMPLATE_NONE_NOTE });
  for (const group of templateMenuGroups(o.templates)) {
    out.push({ section: group.folder });
    for (const t of group.items) out.push({ row: templateMenuLabel(t), buttons: [{ label: tr('削除'), confirm: tr('もう一度押すと削除'), run: () => o.remove(t) }] });
  }
  return out;
}

// ---------- 空きのメニュー（TA4b・TA5・TA6。面の空きと、題の帯の右クリック）。計画書 docs/plan-comment-board-templates.md ----------

export const WRITE_HERE_LABEL = tr('ここに書く');
export const WRITE_HERE_HINT = tr('ダブルクリック'); // 空きのダブルクリックでも同じ動き（TA7）
export const WRITE_CARD_LABEL = tr('カードを書く'); // 題の帯から（押した所が無いので、今の「足す」と同じ置き方）
export const ASK_LABEL = tr('Grok に頼む'); // 道具の列のボタンと同じ字

// 「選んだ n 枚」の行の名前（TA6）。枚数は、型の段の行と同じく空白なしで書く
export const selectedRowLabel = (n: number): string => tr('選んだ{0}枚', { 0: n });

export interface BoardMenuInput {
  where: 'stage' | 'bar'; // 面の空き・題の帯
  write(): void; // 面：ここに書く（押した所を置き場にして、足す欄を開く）。帯：カードを書く（足す欄を開く）
  template: (() => void) | null; // 型を足す…（TA5。型の段へ。型の口が無ければ null で、項目を出さない）
  selected: { n: number; title: string; ask(): void } | null; // 選んだ n 枚［Grok に頼む］（TA6。今ある依頼の小窓を開く入口。選びが無ければ null で、行を出さない）
  tidy: { n: number; run(): void } | null; // 整理（TA6。消えたカードの位置が n 件。0 件のとき・書く欄が開いているときは null で、項目を出さない）
}

// 並び：ここに書く（小さい字 ダブルクリック。帯からは カードを書く・小さい字 Enter）→ 型を足す… →（区切り）→ 選んだ n 枚［Grok に頼む］→ 整理。見出しは置かない。
//   下の 2 つは、条件が合うときだけ出る。条件が合わない行は出さない（押せない形で残さない）。どちらも無ければ、区切りも出さない
export function boardMenuEntries(o: BoardMenuInput): MenuEntry[] {
  const out: MenuEntry[] = [o.where === 'bar' ? { label: WRITE_CARD_LABEL, hint: 'Enter', run: () => o.write() } : { label: WRITE_HERE_LABEL, hint: WRITE_HERE_HINT, run: () => o.write() }];
  const template = o.template;
  if (template) out.push({ label: TEMPLATE_ADD_LABEL, run: () => template() });
  const lower: MenuEntry[] = [];
  const selected = o.selected;
  if (selected) lower.push({ row: selectedRowLabel(selected.n), buttons: [{ label: ASK_LABEL, title: selected.title, close: true, run: () => selected.ask() }] });
  const tidy = o.tidy;
  if (tidy) lower.push({ label: TIDY_LABEL, hint: tr('{0} 件', { 0: tidy.n }), run: () => tidy.run() });
  if (lower.length > 0) out.push('sep', ...lower);
  return out;
}

// ページを開く前の確かめ（上に出している間はページがボードの裏に隠れている）
export function confirmPageEntries(reply: Reply, run: () => void): MenuEntry[] {
  const quote = reply.quote;
  return [
    { section: tr('ページはボードの裏に隠れています') },
    { note: tr('上に出している間はページが見えません。ボードを下に戻してからページを開きます。{0}', { 0: quote ? `\n${quoteSourceLabel(quote)}` : '' }) },
    { label: tr('下に戻して開く'), run },
    { label: tr('やめる'), run: () => undefined },
  ];
}

// 読む画面を開く前の確かめ（上に出している間は読む画面がボードの裏に開く）
export function confirmVideoEntries(run: () => void): MenuEntry[] {
  return [
    { section: tr('読む画面はボードの裏に開きます') },
    { note: tr('ボードを下に戻してから読む画面を開きます。') },
    { label: tr('下に戻して開く'), run },
    { label: tr('やめる'), run: () => undefined },
  ];
}

// 下の一覧を替える前の確かめ（見ているメモが下の区画と別のとき）
export function confirmListEntries(memoTitle: string, run: () => void): MenuEntry[] {
  return [
    { section: tr('下の一覧は別のメモです') },
    { note: tr('下の区画を「{0}」に替えてから、そのカードへ移ります。下に書きかけがあるときは替えません。', { 0: memoTitle }) },
    { label: tr('下の区画もこのメモに替えて見る'), run },
    { label: tr('やめる'), run: () => undefined },
  ];
}
