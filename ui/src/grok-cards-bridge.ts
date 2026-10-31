// 左が Grok Cards の台帳を書く（下の面と右は写しを見る）
//   段の旗が空のときは、何も書かない・送らない
import type { BotCardOrigin } from './bot-replies';
import { send } from './bridge';
import { CARDS_STAGES_KEY, cardsStageOn, publishArrived, publishCardTags, publishReplies, readCardsOpen } from './cards-stages';
import { shellArrived } from './grok-cards-arrived';
import { heldGroups } from './grok-cards-face';
import { looksLikeSecret, parseAddress, parseSent, CHAT_SENT } from './grok-cards-tags';
import { addGrokCard, clearGrokCardSent, grokCardBriefs, markGrokCardPasted, markGrokCardSent, removeGrokCard, setGrokCardText } from './grok-cards-store';
import type { MemoStore } from './memocells';
import type { MemoPaneHost } from './memo-pane-host';
import type { SheetStore } from './sheets';
import type { RelayPayload } from './types';

interface BotList {
  list(): { id: string; name: string }[];
  docked(): string[];
}

export interface CardRequestSnap {
  requestId: string;
  botId: string;
  state: string;
  createdAt: number;
  no: string;
  group?: number;
  fileId?: string;
  origin?: BotCardOrigin[];
}

export interface CardGroupSnap {
  group: number;
  states: string[];
}

interface CardInbox {
  ready(): boolean;
  requests(): CardRequestSnap[];
  groups(): CardGroupSnap[];
  replyText(botId: string, fileId: string): Promise<string | null>;
}

export function attachGrokCards(o: { memos: MemoStore; sheets: SheetStore; bots: BotList; memoPane: MemoPaneHost; replies(): number; inbox: CardInbox }) {
  let wanted = false;
  let timer = 0;

  const payload = (): RelayPayload => {
    const stage7 = cardsStageOn('7');
    const stage8 = cardsStageOn('8');
    const ready = o.inbox.ready();
    const share = (stage7 || stage8) && ready;
    return {
      kind: 'grokCardsData',
      cards: grokCardBriefs(o.memos, o.sheets),
      bots: o.bots.list().map((bot) => ({ id: bot.id, name: bot.name })),
      dock: o.bots.docked(),
      refused: !o.memos.writableLedger || o.memos.loadFailed,
      ...(stage7 || stage8
        ? {
            ...(stage7 ? { requestsReady: share } : {}),
            requests: share ? o.inbox.requests() : [],
            groups: share ? o.inbox.groups() : [],
          }
        : {}),
    };
  };

  const wrote = (done: { notice: string; keep: boolean; id?: string }, address?: string) => {
    if (done.notice) tell(done.notice, done.keep, address, done.id);
    publishNow();
  };

  const publishNow = () => {
    if (cardsStageOn('8')) {
      const held = heldGroups(grokCardBriefs(o.memos, o.sheets));
      const groups = o.inbox.ready() ? o.inbox.groups().filter((item) => held.has(item.group)) : [];
      publishArrived(shellArrived(groups));
    }
    if (!cardsStageOn('2') && !cardsStageOn('3') && !cardsStageOn('4')) return;
    publishCardTags(grokCardBriefs(o.memos, o.sheets));
    publishReplies(o.replies());
    if (!cardsStageOn('3')) return;
    send({ type: 'relay', to: 'memo', payload: payload() });
  };

  const publish = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(publishNow, 80);
  };

  const tell = (text: string, keep: boolean, address?: string, id?: string) => {
    send({ type: 'relay', to: 'memo', payload: { kind: 'grokCardsNotice', text, keep, ...(address ? { address } : {}), ...(id ? { id } : {}) } });
  };

  const api = {
    publish,
    open() {
      if (!cardsStageOn('3')) return;
      wanted = true;
      o.memoPane.showAside();
      publishNow();
      send({ type: 'relay', to: 'memo', payload: { kind: 'grokCards', open: true } });
    },
    close() {
      if (!cardsStageOn('3')) return;
      wanted = false;
      send({ type: 'relay', to: 'memo', payload: { kind: 'grokCards', open: false } });
      if (!o.memoPane.openId) o.memoPane.close();
    },
    onMemoReady() {
      if (!cardsStageOn('3')) return;
      if (wanted || readCardsOpen()) this.open();
    },
    add(address: string, text: string) {
      if (!cardsStageOn('4') || typeof address !== 'string' || typeof text !== 'string') return;
      const done = addGrokCard({ memos: o.memos, sheets: o.sheets, address, text });
      tell(done.notice, done.keep, address, done.id);
      publishNow();
    },
    setText(id: string, text: string) {
      if (!cardsStageOn('4') || typeof id !== 'string' || typeof text !== 'string') return;
      const done = setGrokCardText({ memos: o.memos, sheets: o.sheets, id, text });
      tell(done.notice, done.keep, undefined, id);
      publishNow();
    },
    form(address: string) {
      if (!cardsStageOn('3') || cardsStageOn('4') || typeof address !== 'string') return;
      send({ type: 'relay', to: 'right', payload: { kind: 'nestForm', address } });
    },
    openApp(id: string) {
      if (!cardsStageOn('5') || typeof id !== 'string') return;
      const card = grokCardBriefs(o.memos, o.sheets).find((item) => item.id === id);
      const address = card ? parseAddress(card.tags).address : null;
      if (!address || address === 'all') return;
      send({ type: 'relay', to: 'right', payload: { kind: 'cardApp', botId: address } });
    },
    copy(id: string) {
      if (!cardsStageOn('5') || typeof id !== 'string') return;
      const card = grokCardBriefs(o.memos, o.sheets).find((item) => item.id === id);
      if (!card) return;
      const parsed = parseAddress(card.tags);
      send({
        type: 'relay',
        to: 'right',
        payload: { kind: 'cardForm', cardId: card.id, address: parsed.address ?? 'all', text: card.text, secret: looksLikeSecret(card.text) },
      });
    },
    markSent(id: string, sent: string) {
      if (!cardsStageOn('5') || typeof id !== 'string' || typeof sent !== 'string') return;
      wrote(markGrokCardSent({ memos: o.memos, sheets: o.sheets, id, sent }));
    },
    markPasted(id: string) {
      if (!cardsStageOn('6') || typeof id !== 'string') return;
      wrote(markGrokCardPasted({ memos: o.memos, sheets: o.sheets, id }));
    },
    clearSent(id: string) {
      if (!cardsStageOn('7') || typeof id !== 'string') return;
      wrote(clearGrokCardSent({ memos: o.memos, sheets: o.sheets, id }));
    },
    remove(id: string) {
      if (!cardsStageOn('7') || typeof id !== 'string') return;
      wrote(removeGrokCard({ memos: o.memos, sheets: o.sheets, id }));
    },
    async showReply(id: string) {
      if (!cardsStageOn('7') || typeof id !== 'string') return;
      const card = grokCardBriefs(o.memos, o.sheets).find((item) => item.id === id);
      const sent = card ? parseSent(card.tags) : null;
      if (!sent || sent.group !== null || sent.raw === CHAT_SENT) {
        tell('この札の返事は、受け取り箱で開いてください', false, undefined, id);
        return;
      }
      const req = o.inbox.requests().find((item) => item.requestId === sent.raw);
      if (!req?.fileId) {
        tell('まだ返事がありません', false, undefined, id);
        return;
      }
      const text = await o.inbox.replyText(req.botId, req.fileId);
      if (!text) {
        tell('返事の文が記録に見つかりませんでした', false, undefined, id);
        return;
      }
      send({ type: 'relay', to: 'memo', payload: { kind: 'grokReply', id, text } });
    },
  };
  window.addEventListener('storage', (e) => {
    if (e.key === CARDS_STAGES_KEY) publish();
  });
  publish();
  return api;
}
