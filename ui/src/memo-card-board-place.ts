// 上の入れ物（面の上半分）の持ち主：なし／Grok Cards／ボード（案 C・C1。plan-card-board.md §11.1）
//   DOM も localStorage も使わない（ui/test/memo-card-board-place.test.ts）。**まだ画面からは呼ばれない**（C3 で配線する。旗の段 "2" は C2）
//   決めごと：持ち主は同時に 1 つだけ。あとから「上に出す」を選んだほうが上に出て、先のほうは下へ戻す（U3）。読み込み直しで両方が上と読めたときは Grok Cards を残す
//   段の旗が無いものは、値が残っていても下として読む。旗の段 "2" が無く、ボードを上に出したことも無ければ、ホストへ渡す命令は今まで（grok-cards-place.ts）と同じ
import { t } from './i18n';
import { escAction, boardTabClick, boardTabShown, chromeFor, type Chrome, type ChromeInput, type EscAction, type PaneTab } from './grok-cards-tabs';
import { normalizeCardsPlace, type CardsPlace } from './grok-cards-place';

export type BoardPlace = 'bottom' | 'upper';
export type UpperOwner = 'none' | 'cards' | 'board';

// ボードの置き場。段 "2" が無いときは、残っていても下
export function normalizeBoardPlace(stage2: boolean, raw: unknown): BoardPlace {
  return stage2 && raw === 'upper' ? 'upper' : 'bottom';
}

export interface PlaceGates {
  stage9: boolean; // Grok Cards を上に出せる（cards-stages.ts の段 "9"）
  stage2: boolean; // ボードを上に出せる（card-board-stages.ts の段 "2"。C2 で足す）
}

export interface Places {
  cards: CardsPlace;
  board: BoardPlace;
}

export type PlaceWho = 'cards' | 'board';

// 旗と読んだ値から、いまの置き場を決める。両方が上と読めたら Grok Cards を残し、ボードを下へ戻す（bumped に入る）
export function normalizePlaces(gates: PlaceGates, rawCards: unknown, rawBoard: unknown): { places: Places; bumped: PlaceWho | null } {
  const cards = normalizeCardsPlace(gates.stage9, rawCards);
  const board = normalizeBoardPlace(gates.stage2, rawBoard);
  if (cards === 'upper' && board === 'upper') return { places: { cards, board: 'bottom' }, bumped: 'board' };
  return { places: { cards, board }, bumped: null };
}

// いま上の入れ物を持っているのは誰か（置き場が 1 つに決まっているものとして読む。両方が上なら Grok Cards）
export function upperOwner(places: Places): UpperOwner {
  if (places.cards === 'upper') return 'cards';
  if (places.board === 'upper') return 'board';
  return 'none';
}

export interface PlaceRequest {
  who: PlaceWho;
  to: 'upper' | 'bottom';
}

export interface PlaceChange {
  places: Places;
  changed: boolean;
  bumped: PlaceWho | null; // 取り合いで下へ戻されたほう（知らせの一言が要る）
}

// 利用者が「上に出す」「下に戻す」を押したとき。旗が無いほうは動かさない（変わらない）
export function changePlaces(gates: PlaceGates, current: Places, req: PlaceRequest): PlaceChange {
  const unchanged: PlaceChange = { places: current, changed: false, bumped: null };
  const allowed = req.who === 'cards' ? gates.stage9 : gates.stage2;
  if (!allowed) return unchanged;
  const now = req.who === 'cards' ? current.cards : current.board;
  if (now === req.to) return unchanged;
  if (req.to === 'bottom') return { places: req.who === 'cards' ? { ...current, cards: 'bottom' } : { ...current, board: 'bottom' }, changed: true, bumped: null };
  if (req.who === 'cards') {
    const bumped: PlaceWho | null = current.board === 'upper' ? 'board' : null;
    return { places: { cards: 'upper', board: 'bottom' }, changed: true, bumped };
  }
  const bumped: PlaceWho | null = current.cards === 'upper' ? 'cards' : null;
  return { places: { cards: 'bottom', board: 'upper' }, changed: true, bumped };
}

// 取り合いで下へ戻したときの一言
export const PLACE_BUMP_NOTE: Record<PlaceWho, string> = {
  cards: t('Grok Cards を下に戻しました（ボードを上に出したため）'),
  board: t('ボードを下に戻しました（Grok Cards を上に出したため）'),
};
export const bumpNote = (bumped: PlaceWho | null): string => (bumped === null ? '' : PLACE_BUMP_NOTE[bumped]);

// ホスト（C++）へ渡す場所の命令：持ち主がいれば 'upper'、いなくなったときだけ空（戻す）、何も出したことが無ければ null（送らない）
//   持ち主が Grok Cards だけで段 "2" が無いときは、grok-cards-place.ts の hostPlaceCommand と必ず同じ
export function hostCommandFor(owner: UpperOwner, sentUpper: boolean): '' | 'upper' | null {
  if (owner !== 'none') return 'upper';
  return sentUpper ? '' : null;
}

// 「上に出す／下に戻す」ボタンの名前と説明（ボードの上の帯の右端。上に出せるとき（段 "2"）だけ出す）。上に出すと下の区画のページが隠れるので、説明に書く
export const PLACE_BUTTON_LABEL: Record<BoardPlace, string> = { bottom: t('上に出す'), upper: t('下に戻す') };
export const PLACE_BUTTON_TITLE: Record<BoardPlace, string> = {
  bottom: t('ボードを上の半分に出します（ページは隠れます。下のメモと一緒に見られます）'),
  upper: t('ボードを下の帯に戻します（ページが見えるようになります）'),
};
// 上に出しているときのボードのタブの説明
export const BOARD_TAB_TITLE_UPPER = t('押すと下の面に戻します（ページは隠れています）');
// 上の入れ物の境目（分割線）の読み上げの名前。持ち主ごと
export const SPLIT_LABEL: Record<'cards' | 'board', string> = {
  cards: t('Grok Cards とメモの境目。上下の矢印キーで変わり、ダブルクリックで半分に戻します'),
  board: t('ボードとメモの境目。上下の矢印キーで変わり、ダブルクリックで半分に戻します'),
};

// ボードのタブの名前（上に出しているときは Grok Cards と同じ形）
export const boardTabLabel = (place: BoardPlace): string => (place === 'upper' ? t('↑ 上に出ています') : t('ボード'));

// 「ボード」タブを押したとき：上に出していれば下へ戻す。そうでなければ今までと同じ
export type BoardTabClickFor = 'show-board' | 'stay' | 'place-bottom';
export const boardTabClickFor = (tab: PaneTab, boardUpper: boolean): BoardTabClickFor => (boardUpper ? 'place-bottom' : boardTabClick(tab));

// 「ボード」タブを出すか。上に出しているときは、旗がオンなら出す（押すと下へ戻る）。そうでなければ今までと同じ
export const boardTabShownFor = (flag: boolean, tab: PaneTab, cardsUpper: boolean, boardUpper: boolean): boolean => (boardUpper ? flag : boardTabShown(flag, tab, cardsUpper));

// 上に出しているあいだは、高さを広げる［拡大］を出さない（高さは上の面が決める。U7）
export const boardExpandShown = (boardUpper: boolean): boolean => !boardUpper;

export interface ChromeFor extends Chrome {
  boardInUpper: boolean; // ボードの面を上の入れ物に入れる（上に出している）
}

// 部品の隠す・出す。ボードを上に出しているあいだは「ボードを見ている」状態にならず、下の帯は メモ（または Grok Cards）のまま。ボードの面だけが出ている
//   ボードを上に出していないときは chromeFor と同じ（boardInUpper が false なだけ）
export function chromeForPlaces(input: ChromeInput & { boardUpper: boolean }): ChromeFor {
  const { boardUpper, ...rest } = input;
  if (!boardUpper) return { ...chromeFor(rest), boardInUpper: false };
  const tab: PaneTab = rest.tab === 'board' ? 'memo' : rest.tab; // 上にいるボードは下の帯のタブにならない
  return { ...chromeFor({ ...rest, tab, upper: false }), boardRootHidden: false, boardSelected: false, boardInUpper: true };
}

export interface EscOpts {
  inField: boolean;
  picker: boolean;
  boardExpanded?: boolean;
  boardDragging?: boolean;
  boardSelected?: boolean;
}

// Esc：ボードを上に出していないときは今までと同じ。出しているあいだは、つまむのを取り消す→（文字欄の中なら何もしない）→選びを外す、まで。
//   縮める・メモへ戻す・下へ戻すはしない（誤操作を避ける。戻すのは「下に戻す」のボタンだけ。U9）。Grok Cards を下で見ているときは、Grok Cards の Esc のまま
export function escActionFor(tab: PaneTab, opts: EscOpts, boardUpper: boolean): EscAction {
  if (!boardUpper) return escAction(tab, opts);
  if (opts.boardDragging === true) return 'cancel-drag';
  if (tab === 'cards') return escAction('cards', opts);
  if (opts.inField) return 'ignore';
  return opts.boardSelected === true ? 'clear-selection' : 'ignore';
}

// 旗と読んだ値から、ホストへ渡す命令まで一度に決める入口（配線のときの置き換え先）。段 "2" が無ければ grok-cards-place.ts の hostPlaceCommand と必ず同じ（試験で全組み合わせを確かめる）
export function hostCommandForGates(gates: PlaceGates, places: Places, sentUpper: boolean): '' | 'upper' | null {
  return hostCommandFor(upperOwner(normalizePlaces(gates, places.cards, places.board).places), sentUpper);
}
