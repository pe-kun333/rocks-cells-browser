// 右の「検索」の照合の部品（import を持たない、純粋な関数だけ。node でそのまま読めるように、消せる TS の書き方だけを使う）
//   ・fold：検索のための正規化（全角・半角、大文字・小文字、カタカナ・ひらがなの違いを無くす）。元の文での位置も残す
//   ・queryWords：探す字を語に分ける
//   ・hasAll：すべての語を含むか
//   ・snippetOf：当たりの前後を抜き出し、当たりの所に印を付ける

export type SearchSort = 'created' | 'updated';

// 正規化した文と、その UTF-16 の 1 単位ずつが元の文のどこ [starts[i], ends[i]) から来たか
export interface Folded {
  text: string;
  starts: number[];
  ends: number[];
}

// 抜き出し。marks は text の中の [始め, 終わり)（UTF-16 の位置。重ならず、始めの順）。head：前を切った／tail：後ろを切った
export interface Snippet {
  text: string;
  marks: [number, number][];
  head: boolean;
  tail: boolean;
}

// 右へ返す 1 行（メモかコメント）
export interface SearchItem {
  kind: 'memo' | 'reply';
  memoId: string;
  replyId?: string; // kind が reply のとき
  title: string; // メモの題名（40 字）
  sheet: string; // シートの id
  at: number; // 並べ方の時刻（created：作った時刻／updated：更新の時刻）
  where?: 'text' | 'tags' | 'reply' | 'quote' | 'quoteTitle'; // 当たった所（字が空のときは無い）
  snippet?: Snippet;
  by?: string; // AI の相棒が書いたものなら名前
  image?: boolean; // 画像のメモ・画像のカード
  liked?: number; // メモの ♥（1〜3）。メモの行だけ
}

const MARK = /\p{M}/u;

// 結合の印（濁点・半濁点・半角の濁点と半濁点も）か
function isCombining(ch: string): boolean {
  return MARK.test(ch) || ch === 'ﾞ' || ch === 'ﾟ';
}

// 正規化した文を作る。元の文を「かたまり」（1 コードポイント＋後ろに続く結合の印）に分け、かたまりごとに NFKC・小文字にする
export function fold(source: string): Folded {
  let text = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let pos = 0;
  const chars = Array.from(source);
  let i = 0;
  while (i < chars.length) {
    const begin = pos;
    let chunk = chars[i];
    pos += chars[i].length;
    i++;
    // 後ろに続く結合の印を取り込む（文の先頭が結合の印なら、それが土台になって 1 つのかたまりになる）
    while (i < chars.length && isCombining(chars[i])) {
      chunk += chars[i];
      pos += chars[i].length;
      i++;
    }
    const folded = chunk.normalize('NFKC').toLowerCase();
    for (let k = 0; k < folded.length; k++) {
      let unit = folded[k];
      const code = folded.charCodeAt(k);
      if (code >= 0x30a1 && code <= 0x30f6) unit = String.fromCharCode(code - 0x60); // カタカナ → ひらがな（ー はそのまま）
      if (/\s/.test(unit)) {
        if (text === '' || text.endsWith(' ')) continue; // 空白は 1 つにまとめる。先頭の空白は出さない
        unit = ' ';
      }
      text += unit;
      starts.push(begin);
      ends.push(pos);
    }
  }
  if (text.endsWith(' ')) {
    text = text.slice(0, -1);
    starts.pop();
    ends.pop();
  }
  return { text, starts, ends };
}

// 探す字を語に分ける（# は外す。空の語と重なりは捨てる。先頭から max 語まで）
export function queryWords(query: string, max = 8): string[] {
  const words: string[] = [];
  for (const part of fold(query).text.split(' ')) {
    const word = part.replace(/^#+/, '');
    if (word && !words.includes(word)) words.push(word);
    if (words.length >= max) break;
  }
  return words;
}

// すべての語が含まれるか（語が無ければ true）
export function hasAll(folded: string, words: readonly string[]): boolean {
  return words.every((w) => folded.includes(w));
}

// 次のコードポイントの長さ（サロゲートペアの途中で切らないために、1 コードポイントずつ進める）
function stepForward(s: string, index: number): number {
  const code = s.charCodeAt(index);
  if (code >= 0xd800 && code <= 0xdbff && index + 1 < s.length) {
    const next = s.charCodeAt(index + 1);
    if (next >= 0xdc00 && next <= 0xdfff) return index + 2;
  }
  return index + 1;
}

// 前のコードポイントの始め
function stepBack(s: string, index: number): number {
  const code = s.charCodeAt(index - 1);
  if (code >= 0xdc00 && code <= 0xdfff && index - 2 >= 0) {
    const prev = s.charCodeAt(index - 2);
    if (prev >= 0xd800 && prev <= 0xdbff) return index - 2;
  }
  return index - 1;
}

// 当たりの前後を抜き出す（radius：前後それぞれのコードポイントの数）。当たりが無ければ null
export function snippetOf(source: string, folded: Folded, words: readonly string[], radius = 40): Snippet | null {
  // 当たりを全部探して、元の文の位置に直す
  const hits: [number, number][] = [];
  for (const word of words) {
    if (!word) continue;
    let from = 0;
    for (;;) {
      const at = folded.text.indexOf(word, from);
      if (at < 0) break;
      const end = at + word.length;
      hits.push([folded.starts[at], folded.ends[end - 1]]);
      from = end;
    }
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  // いちばん前の当たりを中心に窓を取る
  const first = hits[0];
  let start = first[0];
  for (let n = 0; n < radius && start > 0; n++) start = stepBack(source, start);
  let end = first[1];
  for (let n = 0; n < radius && end < source.length; n++) end = stepForward(source, end);

  // 窓に重なる当たりを窓で切り、窓の始めからの位置にして、重なる・接するものをつなぐ
  const marks: [number, number][] = [];
  for (const [a, b] of hits) {
    const from = Math.max(a, start) - start;
    const to = Math.min(b, end) - start;
    if (from >= to) continue;
    const last = marks[marks.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else marks.push([from, to]);
  }

  return {
    text: source.slice(start, end).replace(/[\r\n\t]/g, ' '),
    marks,
    head: start > 0,
    tail: end < source.length,
  };
}
