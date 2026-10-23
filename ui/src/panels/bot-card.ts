// ボットのセルのカード（拡大表示に出す）：ボットの名前・エージェントの id・状態と、できること
//   ・出すのはエージェントの id だけ。リンク（URL）は出さない（覚えてもいない。grokbot:// の URL は C++ が組み立てる）
//   ・「外す」は2段階（押すと「本当に外す」に変わる）。外してもボットは台帳に残り、外したあとのカードの「置き直す」で戻せる
//   ・「コピーしてアプリを開く」「クリップボードの返事をメモにする」（S1.12・Q2）：Webhook が使えるまでの、アプリとの行き来
//     「コピーしてアプリを開く」は依頼（request.v1）を作って覚えてからコピーする（第2段。返事は中継から届き、ボットの欄で読む）
//     返事は外から来た文なので、メモにする前に最初の 200 字を見せて確かめ、相棒の返事の印は付けない（primary.ts）
//   ・portal-card.ts が手本
import { armConfirm } from '../confirm-arm';
import { type BotEntry, type BotFullState, botFullStateHint, botFullStateLabel } from '../bots';
import { drawBotFace, svgEl } from '../cellface';
import type { Hex } from '../hex';
import type { MemoCell } from '../memocells';
import { el } from '../util';

export interface BotActions {
  open(id: string): void; // Grok Bot アプリでこのボットのチャットを開く（id はセル）
  link(id: string): void; // リンクを貼る・貼り直す
  rename(id: string): void; // ボットの名前を変える（台帳の名前。同じボットのセル全部）
  editFace?(id: string): void; // セルの見た目（画像・コメント）
  copyAndOpen?(id: string): void; // 頼む文を書いてクリップボードに入れ、アプリを開く（S1.12）
  pasteReply?(id: string): void; // クリップボードの返事を、このセルの隣にメモのセルとして置く（確かめてから。S1.12）
  thread?(id: string): void; // 右のボットの欄で、このボットのやり取りを見る（S2.4）
  remove(id: string): void; // セルを外す（台帳には残る）
  replace(botId: string, at: { sheet: string; pos: Hex }): void; // 外したセルを置き直す
}

export interface BotCardOptions {
  memo: MemoCell;
  bot: BotEntry | undefined; // 台帳のボット（見つからなければ undefined）
  state: BotFullState; // 第2段の状態（返事あり・待っている など）も
  badges?: { unread: number; waiting: number }; // まだ読んでいない数・待っている数
  image?: string; // セルの画像（data URL）
  compact: boolean;
  actions?: BotActions;
}

export function botCard(o: BotCardOptions): HTMLElement {
  const { memo, bot, state } = o;
  const card = el('div', o.compact ? 'preview-card bot-card compact' : 'preview-card bot-card');
  card.dataset.memo = memo.id;
  const visual = el('div', 'preview-visual bot-visual');
  const svg = svgEl('svg', { viewBox: '-23 -23 46 47', class: 'bot-card-svg', role: 'img', 'aria-label': 'ボットのセル' });
  const g = svgEl('g', { class: 'cell bot' });
  drawBotFace(g, { x: 0, y: 0 }, 19.5, { state, unread: o.badges?.unread, waiting: o.badges?.waiting }, o.image, memo.text, 'bot-card-clip');
  svg.append(g);
  visual.append(svg);
  card.append(visual, el('div', 'preview-title', bot ? bot.name : 'ボット（台帳に見つかりません）'));
  const meta = el('div', 'preview-meta');
  const off = state === 'noLink' || state === 'noApp' || state === 'botError';
  meta.append(el('span', 'pill pill-bot', 'ボット'), el('span', off ? 'pill pill-bot-off' : 'pill', botFullStateLabel(state)));
  if (o.badges && (o.badges.unread || o.badges.waiting)) meta.append(el('span', 'pill', `まだ読んでいない ${o.badges.unread}・待っている ${o.badges.waiting}`));
  card.append(meta);
  if (bot) card.append(el('div', 'bot-card-id', bot.agentId ? `id：${bot.agentId}` : 'id：まだありません'));
  if (memo.text) card.append(el('div', 'bot-comment', memo.text));
  if (!o.compact) {
    card.append(el('div', off ? 'bot-card-hint warn' : 'bot-card-hint', bot ? botFullStateHint(state) : 'このボットの名前とリンクが台帳にありません。「外す」で片づけられます'));
  }
  const a = o.actions;
  if (!o.compact && a) {
    const actions = el('div', 'preview-actions');
    if (bot) {
      const open = button('アプリを開く', () => a.open(memo.id));
      open.classList.add('primary');
      open.disabled = !bot.agentId;
      open.title = bot.agentId ? 'Grok Bot アプリで、このボットのチャットを開く' : 'リンクを貼ると開けます';
      const link = button(bot.agentId ? 'リンクを貼り直す' : 'リンクを貼る', () => a.link(memo.id));
      link.title = 'Grok Bot アプリの「リンクをコピー」から貼る（覚えるのは id だけ）';
      const rename = button('名前', () => a.rename(memo.id));
      rename.title = 'ボットの名前を変える（このボットのセル全部）';
      actions.append(open);
      if (a.thread) {
        const thread = a.thread;
        const view = button('やり取りを見る', () => thread(memo.id));
        view.title = '右サイドバーのボットの欄で、このボットの依頼と返事を見る';
        actions.append(view);
      }
      actions.append(link, rename);
      if (a.editFace) {
        const editFace = a.editFace;
        actions.append(button('見た目', () => editFace(memo.id)));
      }
    }
    const remove = button('外す', () => {
      if (remove.textContent !== '本当に外す') {
        armConfirm(remove);
        remove.textContent = '本当に外す';
        remove.classList.add('danger');
        remove.title = 'もう一度押すと、このセルを外します（ボットの名前とリンクは台帳に残り、「置き直す」で戻せます）';
        return;
      }
      a.remove(memo.id);
    });
    remove.title = 'このセルを盤面から外す（ボットの名前とリンクは台帳に残ります）';
    actions.append(remove);
    card.append(actions);
    if (bot && (a.copyAndOpen || a.pasteReply)) card.append(relayRow(memo.id, bot, a));
  }
  return card;
}

// アプリとの行き来（コピーで）：頼む文をコピーしてアプリを開く・アプリでコピーした返事をメモにする
function relayRow(memoId: string, bot: BotEntry, a: BotActions): HTMLElement {
  const box = el('div', 'bot-card-relay');
  box.append(el('div', 'bot-card-relay-title', 'アプリとの行き来（コピーで）'));
  const row = el('div', 'preview-actions');
  if (a.copyAndOpen) {
    const copyAndOpen = a.copyAndOpen;
    const copy = button('コピーしてアプリを開く', () => copyAndOpen(memoId));
    copy.disabled = !bot.agentId;
    copy.title = bot.agentId
      ? '頼む文を書くと、依頼（番号つき。返事の決まりと依頼の JSON を添えたもの）にしてクリップボードに入れ、Grok Bot アプリのこのボットのチャットを開きます（貼って送るのは自分で）'
      : 'リンクを貼ると使えます';
    row.append(copy);
  }
  if (a.pasteReply) {
    const pasteReply = a.pasteReply;
    const paste = button('クリップボードの返事をメモにする', () => pasteReply(memoId));
    paste.title = 'アプリでコピーした返事を、このセルの隣にメモのセルとして置きます（最初の 200 字を見せて、確かめてから）';
    row.append(paste);
  }
  box.append(row, el('div', 'bot-card-hint', '返事は外から来た文として、印を付けてメモにします。リンクは押したときだけ開きます'));
  return box;
}

// 外したばかりのセルのカード：台帳に残っていることと「置き直す」
export function removedBotCard(o: { bot: BotEntry; at: { sheet: string; pos: Hex }; actions: BotActions }): HTMLElement {
  const card = el('div', 'preview-card bot-card removed');
  card.append(el('div', 'preview-title', `${o.bot.name}（置いていません）`));
  card.append(el('div', 'bot-card-hint', 'セルを外しました。ボットの名前とリンクは台帳に残っています。空いたセルを右クリック →「ボットのセルを置く…」からも置けます'));
  const actions = el('div', 'preview-actions');
  const replace = button('置き直す', () => o.actions.replace(o.bot.id, o.at));
  replace.classList.add('primary');
  replace.title = '外した所（ふさがっていれば近くの空いたセル）に、もう一度置く';
  actions.append(replace);
  card.append(actions);
  return card;
}

function button(label: string, onClick: () => void) {
  const b = el('button', 'preview-button', label);
  b.addEventListener('click', onClick);
  return b;
}
