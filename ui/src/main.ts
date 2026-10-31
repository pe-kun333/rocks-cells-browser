// UI の入口。同じ画面を左右のサイドバー・「六角で読む」・下のメモの区画で使い回し、役割は URL の ?surface= で切り替える
import './style.css';
import './themes.css';
import './sheets.css';
import './haiku.css';
import './tagbuttons.css';
import './search.css';
import './vault.css';
import './capture.css';
import './bot-panel.css';
import './memo-pane.css';
import './grok-patch.css';
import './grok-cards.css';
import './data-colors.css'; // データの色をテーマの明るさの帯へ（同じ選択子の上書きなので、いちばん後）
import { startMemoPane } from './app/memo-pane';
import { startPrimary } from './app/primary';
import { startReader } from './app/reader';
import { startSecondary } from './app/secondary';
import { surface } from './bridge';
import { startI18n } from './i18n';
import { startTheme } from './theme';

// トラックパッドのピンチは Ctrl 付きのホイールとして届く。止めないとサイドバー全体が拡大されてしまう
// （盤面の上では、盤面が自分で受け取って拡大縮小に使う）
window.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey) e.preventDefault();
  },
  { passive: false },
);

// 見た目のテーマ（最初の一瞬は public/theme-boot.js が付けている。ここで付け直し、変化を受ける）
startTheme();

// 画面の言語（英語版 E0）：<html lang> を付け、index.html の最初からある文字を辞書で訳す（日本語のときは何もしない）
startI18n();

if (surface === 'left') startPrimary();
else if (surface === 'reader') startReader();
else if (surface === 'memo') startMemoPane();
else if (surface === 'right') startSecondary();
