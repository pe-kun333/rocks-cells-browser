// 下の区画の「メモ｜Grok Cards｜ボード」の切り替えの決まり（DOM も localStorage も使わない。ui/test/grok-cards-tabs.test.ts）
//   grok-cards.ts の GrokCardsView が、どの部品を隠す・どのタブを選んだ表示にするか・クリックや Esc で何をするかを、ここの関数で決める
//   B1-3 の前に、今の動き（メモ⇄Grok Cards⇄上に出す）をそのまま関数にして試験で固めた。「ボード」タブはその上に足した（ボードを見ていないとき、メモ・Grok Cards の値は足す前と同じ）
export type PaneTab = 'memo' | 'cards' | 'board';

export interface ChromeInput {
  tab: PaneTab;
  upper: boolean; // Grok Cards を上の半分に出している（段 9）
  memoOpen: boolean; // メモを開いている
  sheetEmpty: boolean; // シート名の欄が空
}

// hidden の値（true＝隠す）と、タブの「選んでいる」印
export interface Chrome {
  cardsRootHidden: boolean;
  cardsSelected: boolean; // 「Grok Cards」タブ（上に出しているときは false）
  memoSelected: boolean; // 「メモ」タブ（タイトルのボタン。上に出しているときは true）
  boardRootHidden: boolean; // ボードの面（ボードを見ているときだけ出す）
  boardSelected: boolean; // 「ボード」タブ
  band: boolean;
  main: boolean;
  scroll: boolean;
  tools: boolean;
  countline: boolean;
  status: boolean;
  empty: boolean;
  sheet: boolean;
  page: boolean;
}

export function chromeFor(input: ChromeInput): Chrome {
  const { tab, upper, memoOpen, sheetEmpty } = input;
  const show = tab === 'cards' && !upper;
  const board = tab === 'board';
  const base = {
    cardsRootHidden: upper ? false : !show,
    cardsSelected: show,
    memoSelected: board ? false : upper || !show,
    boardRootHidden: !board,
    boardSelected: board,
  };
  if (show || board) {
    // Grok Cards（またはボード）を下の面に出している：メモの部品はみな隠し、主の枠（札の根・ボードの面の入れ物）だけ出す
    return { ...base, band: false, main: false, scroll: true, tools: true, countline: true, status: true, empty: true, sheet: true, page: true };
  }
  // メモが無くても帯は出す（この面から Grok Cards を開ける）
  return {
    ...base,
    band: false,
    main: !memoOpen,
    scroll: !memoOpen,
    tools: !memoOpen,
    countline: !memoOpen,
    status: !memoOpen,
    empty: memoOpen,
    sheet: memoOpen ? sheetEmpty : true,
    page: !memoOpen,
  };
}

// 「Grok Cards」タブを押したとき：上に出していれば下の面へ戻す。そうでなければ Grok Cards を開く
export type CardsTabClick = 'place-bottom' | 'show-cards';
export const cardsTabClick = (upper: boolean): CardsTabClick => (upper ? 'place-bottom' : 'show-cards');

// 「メモ」タブ（タイトルのボタン）を押したとき：Grok Cards・ボードを見ているあいだは、メモへ戻す（ふだんのタイトルの働き〈一覧の窓〉は呼ばない）
export type TitleClick = 'show-memo' | 'pass';
export const titleClick = (tab: PaneTab): TitleClick => (tab === 'memo' ? 'pass' : 'show-memo');

// Esc：Grok Cards を見ているとき、欄の中なら何もしない／選び窓が開いていれば閉じる／そうでなければメモへ戻る。見ていなければ何もしない
//   ボードを見ているとき：カードをつまんで（範囲選択して）いれば取り消す。そうでなければ、選んだカードがあれば選びを外す。それも無ければ、広げてあれば縮める。それも無ければメモへ戻る（欄の中なら何もしない）
export type EscAction = 'ignore' | 'close-picker' | 'show-memo' | 'shrink-board' | 'cancel-drag' | 'clear-selection';
export function escAction(tab: PaneTab, opts: { inField: boolean; picker: boolean; boardExpanded?: boolean; boardDragging?: boolean; boardSelected?: boolean }): EscAction {
  if (tab === 'memo') return 'ignore';
  if (tab === 'board' && opts.boardDragging === true) return 'cancel-drag'; // カードをつまんでいる間の Esc は、まずつまむのを取り消す（広げた高さ・タブはそのまま）
  if (opts.inField) return 'ignore';
  if (tab === 'board') return opts.boardSelected === true ? 'clear-selection' : opts.boardExpanded === true ? 'shrink-board' : 'show-memo';
  return opts.picker ? 'close-picker' : 'show-memo';
}

// 「ボード」タブを押したとき：もうボードを見ていれば何もしない。そうでなければ開く
export type BoardTabClick = 'show-board' | 'stay';
export const boardTabClick = (tab: PaneTab): BoardTabClick => (tab === 'board' ? 'stay' : 'show-board');

// 「ボード」タブを出すか（旗がオン、かつ Grok Cards を上の半分に出していない）
//   上に出しているときは、下の帯の「メモ」のとなりに並べない（上と下で二重にならないように）。ただしボードを見ている最中は出しておく
export const boardTabShown = (flag: boolean, tab: PaneTab, upper: boolean): boolean => flag && (!upper || tab === 'board');