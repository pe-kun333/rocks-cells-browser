// ボードのファイルの読み書き（ui-data\boards\<メモ id>.json。名前は C++ の UiDataFile の検査を通る形）
//   読みは readDataChecked（「無い」と「読めない」を分ける）、書きは writeData（C++ が一時ファイル経由で置き換える）
import { readDataChecked, writeData } from '../data';
import type { BoardIo } from '../memo-card-board-store';

export const boardPaneIo: BoardIo = {
  read: (name) => readDataChecked<unknown>(name),
  write: (name, value) => writeData(name, value),
};