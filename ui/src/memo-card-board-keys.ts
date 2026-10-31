// ボード全体で効くキー（B4-2）の決め事と案内の文（DOM を使わない。ui/test/memo-card-board-keys.test.ts）
//   効くキー：Ctrl+A＝全選択／Ctrl+Z＝元に戻す／Ctrl+Shift+Z・Ctrl+Y＝やり直す／Delete＝選んだカードを消す／Esc＝選びを外す（Esc は grok-cards の escAction が決める）／スペース押しながらドラッグ＝移動
//   C++（browser.cpp の WatchShortcuts）が先に取るのは Ctrl＋英字・Tab などだけ。Delete・Esc は取らない。Ctrl+Shift+Y は左（C++）が使う
//   Delete は、文字を書く欄（input・textarea・select・contenteditable）にフォーカスがないときだけ。つまんでいる最中・範囲選択の最中・小窓や確認が開いているあいだ・線を引く途中は効かない
//   C4：ボードを「上に出している」あいだは、下のメモの帯も同時に見える。そこで Ctrl+A・Ctrl+Z 系・Delete・スペース（移動）は、フォーカスがボードの面の中、またはどこにも無い（かつ、最後に押した所が下の帯でない）ときだけ効かせる。境目（tabindex=0 の分割線）・下の帯・その小窓にフォーカスがあるときは効かせない。下に出しているとき（今まで）は、場所を問わず今までどおり
import { t } from './i18n';

export const BOARD_KEY_HINT = t('ホイール：拡大縮小／空きをドラッグ：移動／Shift＋ドラッグ：範囲選択／Ctrl+A：全選択／Delete：削除／Ctrl+Z：元に戻す／Esc：選びを外す');

// ボタンに付ける aria-keyshortcuts
export const KEYSHORTCUTS = { remove: 'Delete', undo: 'Control+Z', redo: 'Control+Shift+Z Control+Y' } as const;

export interface BoardKeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing: boolean;
  repeat: boolean;
  typing: boolean; // 文字を書く欄にフォーカスがある
  busy: boolean; // つまんでいる最中・範囲選択の最中
  modal: boolean; // 書く小窓・確認・型の小窓・線を引く途中など、先にそちらを片づけるもの
}

// Delete が「選んだカードを消す」になるか。ほかのキーはここでは決めない（null）
export function boardKeyAction(i: BoardKeyInput): 'delete' | null {
  if (i.key !== 'Delete') return null;
  if (i.ctrlKey || i.metaKey || i.shiftKey || i.altKey) return null; // 修飾キーつきは別の意味（Shift+Delete は切り取りなど）
  if (i.isComposing || i.repeat || i.typing || i.busy || i.modal) return null;
  return 'delete';
}
// ---------- C4：上に出しているあいだの、キーを受ける場所 ----------
// フォーカスのある所：ボードの面の中／ボードの外（下のメモの帯・境目・その小窓）／どこにも無い（body など）
export type KeyFocus = 'board' | 'outside' | 'none';

export function keyFocusOf(inBoard: boolean, bare: boolean): KeyFocus {
  if (inBoard) return 'board';
  return bare ? 'none' : 'outside';
}

// ボード全体のキー（Ctrl+A・Ctrl+Z 系・Delete・スペース）を受けるか。
//   下に出している（boardUpper が偽）ときは、場所を問わず常に受ける（今までと同じ）
//   上に出しているときは、フォーカスが下の帯・境目など、ボードの外にあれば受けない。ボードの中・どこにも無いときは、最後に押した（クリックした）所が下の帯でなければ受ける
//     （ボードの面を押しても、下の帯にあったフォーカスは動かないことがある。そこで押した所を覚え、ボードを押したときは下の帯のフォーカスを外す〔memo-board-tab.ts〕）
export function boardKeysActive(boardUpper: boolean, focus: KeyFocus, pointerOutside: boolean): boolean {
  if (!boardUpper) return true;
  if (focus === 'outside') return false;
  return !pointerOutside;
}
