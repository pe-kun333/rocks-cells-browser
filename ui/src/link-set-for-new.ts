// 新しいメモに付ける呼称セット（試し）
//   直前に下の区画で使っていたセット＝開いているメモの linkSet。閉じていれば、最後に開いたメモ
//   （そのメモで選び直した・外したあとは、メモに保存してある選択が「直前」）
//   カードを新しいメモへ送るときは、送り元のメモのセット（選んでいなければ既定。覚えていた別のセットには戻さない）
//   台帳にその id が無い（消した・まだ台帳を知らない）ときは付けない。既存のメモはここでは変えない
import { chosenLinkNameSet, emptyLinkNameBook, MAX_LINK_NAME_SETS, parseLinkSetId, type LinkNameBook } from './link-name-sets';

export type NewMemoLinkInput =
  | { book: LinkNameBook | null; remembered: string | null } // ふつうの新しいメモ
  | { book: LinkNameBook | null; source: { linkSet?: string | null } | null }; // カードを新しいメモへ送る

// 新しいメモに書く id。付けないときは undefined（既定＝このメモの名前、無ければ元の名前）
export function linkSetForNewMemo(input: NewMemoLinkInput): string | undefined {
  if (!input.book) return undefined; // 台帳をまだ知らないあいだは、消えた id を書き込まない
  const raw = 'source' in input ? input.source?.linkSet : input.remembered;
  const id = parseLinkSetId(raw);
  if (!id || !chosenLinkNameSet(input.book, id)) return undefined;
  return id;
}

// 直前のセットを持っているメモは、開いていればそのメモ。閉じていれば最後に開いたメモ
//   開いているメモがセットを選んでいなければ null（最後に開いた別のメモのセットには戻さない）
export function rememberedLinkSet(o: {
  openId: string | null;
  lastMemoId: string | null;
  linkSetOf(id: string): string | null | undefined;
}): string | null {
  const id = o.openId || o.lastMemoId;
  if (!id) return null;
  return parseLinkSetId(o.linkSetOf(id)) ?? null;
}

// 下の区画が知らせた id の一覧を、台帳の形にする（名前は見ない。壊れた id は捨てる）
export function linkNameBookOfIds(ids: readonly unknown[]): LinkNameBook {
  const book = emptyLinkNameBook();
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = parseLinkSetId(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    book.sets.push({ id, name: id, names: {} });
    if (book.sets.length >= MAX_LINK_NAME_SETS) break;
  }
  return book;
}
