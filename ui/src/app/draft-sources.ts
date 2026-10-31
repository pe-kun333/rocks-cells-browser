// 段 D3：左のセルと島を材料にする。変換は純粋関数（写しを受けて MaterialSet を返す）。
//   台帳も DOM も知らない。入口・ボット・アプリ・撮ったものは isSpecialCell と同じく除く。
//   ページの本文は入れない。渡し止めの言い回しは blocklist.ts の BLOCK_NOTE（このサイトは渡しません）。
//   ここは data を import しないので、その文字列を下に写している。
// 段 D4：コメントカード。取り方は pickMaterials に揃えるが、あの関数は呼ばない（型の下書きの挙動は変えない）。
import { takeMaterials, type MaterialDraft, type MaterialSet } from '../draft-materials';
import { isCardsBotId, visibleTags } from '../grok-cards-tags';
import { cleanReplyText, orderedTops, type Reply } from '../threads';

export const CELL_ON_MAX = 8;

const BLOCK_NOTE = 'このサイトは渡しません';

export interface CellPos {
  q: number;
  r: number;
}

export interface CellTabCopy {
  uid: string;
  title: string;
  url: string;
  comment?: string;
  pos?: CellPos;
}

export interface CellMemoCopy {
  id: string;
  text: string;
  portal?: string;
  bot?: string;
  app?: string;
  capture?: string;
  pos?: CellPos;
}

export interface CellIslandCopy {
  id: string;
  name: string;
  memos: readonly CellMemoCopy[];
}

export interface CellMaterialsInput {
  tabs?: readonly CellTabCopy[];
  memos?: readonly CellMemoCopy[];
  island?: CellIslandCopy;
  blocked?: (url: string) => boolean;
  hosts?: readonly string[]; // 名前と本文の中のアドレスを伏せる一覧（空なら伏せない）
}

function special(memo: CellMemoCopy): boolean {
  return Boolean(memo.portal || memo.bot || memo.app || memo.capture);
}

function firstLine(text: string): string {
  return text.replace(/\r\n?/g, '\n').split('\n').find((line) => line.trim())?.trim() ?? '';
}

// 位置が全部あるときだけ、盤面の番号順（行、それから列）。欠けていれば渡した順のまま
function byBoard<T extends { pos?: CellPos }>(items: readonly T[]): T[] {
  if (!items.length || items.some((item) => !item.pos)) return [...items];
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const pa = a.item.pos!;
      const pb = b.item.pos!;
      return pa.r - pb.r || pa.q + pa.r / 2 - (pb.q + pb.r / 2) || a.index - b.index;
    })
    .map((row) => row.item);
}

function tabDraft(tab: CellTabCopy, on: boolean): MaterialDraft {
  return {
    key: `tab:${tab.uid}`,
    kind: 'cell',
    label: tab.title,
    ...(tab.comment ? { text: tab.comment } : {}),
    url: tab.url,
    ref: { kind: 'tab', uid: tab.uid },
    on,
  };
}

function memoDraft(memo: CellMemoCopy, on: boolean): MaterialDraft {
  const line = firstLine(memo.text);
  return {
    key: `memo:${memo.id}`,
    kind: 'cell',
    label: line || 'メモ',
    text: memo.text,
    ref: { kind: 'memo', id: memo.id },
    on,
  };
}

function islandDraft(island: CellIslandCopy): MaterialDraft {
  const name = island.name.trim() || '島';
  return {
    key: `island:${island.id}`,
    kind: 'cell',
    label: name,
    text: `島「${name}」`,
    ref: { kind: 'island', id: island.id },
    on: true,
  };
}

export const CellMaterials = {
  // タブ（題名・URL・ひとこと）とメモ（1 行目と本文）。島があるときは、島の名前と入っているメモだけ。
  //   印は先頭 CELL_ON_MAX 件がオン（島の名前は別にオン）。残りはオフで一覧に残す。
  //   オンの合計が 12,000 字を超える件は、takeMaterials が印を外して残す（件数の dropped にはしない）。
  collect(input: CellMaterialsInput): MaterialSet {
    const drafts: MaterialDraft[] = [];
    let blocked = 0;
    if (input.island) {
      drafts.push(islandDraft(input.island));
      let onMemos = 0;
      for (const memo of byBoard(input.island.memos.filter((memo) => !special(memo)))) {
        const on = onMemos < CELL_ON_MAX;
        if (on) onMemos += 1;
        drafts.push(memoDraft(memo, on));
      }
    } else {
      const pieces: ({ kind: 'tab'; tab: CellTabCopy } | { kind: 'memo'; memo: CellMemoCopy })[] = [
        ...(input.tabs ?? []).map((tab) => ({ kind: 'tab' as const, tab })),
        ...(input.memos ?? []).filter((memo) => !special(memo)).map((memo) => ({ kind: 'memo' as const, memo })),
      ];
      const ordered = byBoard(pieces.map((piece) => ({ ...piece, pos: piece.kind === 'tab' ? piece.tab.pos : piece.memo.pos })));
      let onCount = 0;
      for (const piece of ordered) {
        if (piece.kind === 'tab' && piece.tab.url && input.blocked?.(piece.tab.url)) {
          blocked += 1;
          continue;
        }
        const on = onCount < CELL_ON_MAX;
        if (on) onCount += 1;
        drafts.push(piece.kind === 'tab' ? tabDraft(piece.tab, on) : memoDraft(piece.memo, on));
      }
    }
    const notes = blocked > 0 ? [`渡し止めのサイトのタブ ${blocked} 個は外しました（${BLOCK_NOTE}）`] : [];
    const set = takeMaterials(drafts, { blocked, notes, ...(input.hosts?.length ? { hosts: input.hosts } : {}) });
    if (set.dropped > 0) set.notes.push(`上限を超えた ${set.dropped} 件は外しました`);
    return set;
  },
};

// つながったカードとして足す枚数（Reply.links は一番上のカードに 10 本まで）
const CARD_LINK_MAX = 10;
// カードの文は利用者の文章なので、材料欄に一行出す（型の下書きの ASK_NOTE と同じ趣旨。渡し止めの文ではない）
const CARD_CAUTION = 'カードの文は、中を見てから貼ってください';
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ASK_ALL_TO = '*all'; // bot-request-form の ASK_ALL と同じ宛て先（みんな）

export interface CardReplyCopy {
  id: string;
  parent: string | null;
  text: string;
  createdAt: number;
  rank?: number;
  tags?: readonly string[];
  links?: readonly { to: string }[];
}

export interface CardMaterialsInput {
  memoId: string;
  replies: readonly CardReplyCopy[];
  ids: readonly string[];
  linked?: 'none' | 'one';
  hosts?: readonly string[]; // 名前と本文の中のアドレスを伏せる一覧（空なら伏せない）
}

function cardKey(memoId: string, replyId: string): string {
  return `card:${memoId}/${replyId}`;
}

export const CardMaterials = {
  // 選んだ一番上のカード（並べた順）。文が空（画像・引用だけ）は empty。下の返信は見ない。
  //   機械のタグは除く。linked が one のとき、選んだカードから直接つながる一番上のカードを 10 枚まで、印を外して足す。
  //   選んだカードと重なる相手は、選んだ側の 1 件のまま。二段先は足さない。
  collect(input: CardMaterialsInput): MaterialSet {
    const byId = new Map(input.replies.filter((reply) => reply.parent === null).map((reply) => [reply.id, reply]));
    const wanted = new Set(input.ids);
    const drafts: MaterialDraft[] = [];
    const picked: CardReplyCopy[] = [];
    for (const id of orderedTops(input.replies as readonly Reply[]).map((reply) => reply.id)) {
      if (!wanted.has(id)) continue;
      const reply = byId.get(id);
      if (!reply) continue;
      const raw = String(reply.text ?? '');
      const text = cleanReplyText(raw);
      const key = cardKey(input.memoId, reply.id);
      if (!text) {
        drafts.push({ key, kind: 'card' });
        continue;
      }
      picked.push(reply);
      const tags = visibleTags([...(reply.tags ?? [])]);
      drafts.push({
        key,
        kind: 'card',
        label: firstLine(text),
        text: raw,
        ...(tags.length ? { tags, detail: `タグ：${tags.join('、')}` } : {}),
        ref: { kind: 'card', memo: input.memoId, reply: reply.id },
        on: true,
        via: 'picked',
      });
    }
    if (input.linked === 'one') {
      const seen = new Set(drafts.map((draft) => draft.key));
      let linked = 0;
      for (const source of picked) {
        if (linked >= CARD_LINK_MAX) break;
        const sourceLine = firstLine(cleanReplyText(String(source.text ?? '')));
        for (const link of source.links ?? []) {
          if (linked >= CARD_LINK_MAX) break;
          const target = byId.get(link.to);
          if (!target) continue;
          const key = cardKey(input.memoId, target.id);
          if (seen.has(key)) continue;
          const raw = String(target.text ?? '');
          if (!cleanReplyText(raw)) continue;
          seen.add(key);
          linked += 1;
          const tags = visibleTags([...(target.tags ?? [])]);
          drafts.push({
            key,
            kind: 'card',
            label: firstLine(cleanReplyText(raw)),
            text: raw,
            detail: `元：カード『${sourceLine}』`,
            ...(tags.length ? { tags } : {}),
            ref: { kind: 'card', memo: input.memoId, reply: target.id },
            on: false,
            via: 'linked',
          });
        }
      }
    }
    const notes = drafts.some((draft) => draft.text) ? [CARD_CAUTION] : [];
    const set = takeMaterials(drafts, { notes, ...(input.hosts?.length ? { hosts: input.hosts } : {}) });
    if (set.dropped > 0) set.notes.push(`上限を超えた ${set.dropped} 件は外しました`);
    return set;
  },
};

export interface AskWithCards {
  memo: string;
  replies: string[];
  linked: 'none' | 'one';
  to?: string;
}

// 下の面から来る命令を、左が使う形に整える。replies は 30 件まで。宛て先が無い空の命令は null
export function cleanAskWithCards(raw: { memo?: unknown; replies?: unknown; linked?: unknown; to?: unknown }): AskWithCards | null {
  const memo = typeof raw.memo === 'string' && ID_RE.test(raw.memo) ? raw.memo : '';
  const replies: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.replies)) {
    for (const id of raw.replies) {
      if (replies.length >= 30) break;
      if (typeof id !== 'string' || !ID_RE.test(id) || seen.has(id)) continue;
      seen.add(id);
      replies.push(id);
    }
  }
  const linked = raw.linked === 'one' ? 'one' : 'none';
  const to = raw.to === ASK_ALL_TO || (typeof raw.to === 'string' && isCardsBotId(raw.to)) ? raw.to : undefined;
  if (replies.length > 0 && !memo) return null;
  if (!memo && replies.length === 0 && !to) return null;
  return { memo, replies, linked, ...(to ? { to } : {}) };
}
