// C++ 側（ブラウザ本体）とのやりとり
//   UI → C++ : send() で送る（中身は window.chrome.webview.postMessage）
//   C++ → UI : onMessage() に登録した関数に届く
import type {
  HexMemoBoardMemo,
  HexMemoCatalog,
  HexMemoRecord,
  HexMemoSendResult,
  HexMemoState,
  RelayPayload,
  SessionData,
  Side,
  SidebarState,
} from './types';
import type { WindowThemeSlot } from './theme';

export interface TabInfo {
  title?: string;
  url?: string;
  favicon?: string;
  loading?: boolean;
  canGoBack?: boolean;
  canGoForward?: boolean;
  asleep?: boolean; // 休眠中（ページを閉じて URL だけ覚えている）
  suspended?: boolean; // 一時停止中
  audible?: boolean; // 音が出ている
  muted?: boolean;
  sleepBlocked?: 'input' | null; // 休眠を見送った理由（input = 入力途中の文字がある）
  newDocument?: boolean; // URL が変わったとき：新しいページを読み込んだか（false はページの中で URL だけ変わった）。台帳には入れない
}

export type ShortcutAction = 'newTab' | 'closeTab' | 'focusAddress' | 'nextTab' | 'prevTab' | 'hexShot' | 'memoPane' | 'memoQuote' | 'captureCenter';

// ボットのセル：Grok Bot アプリを開けなかったわけ（botAppOpened の error）
//   badId：エージェントの id の形が違う　noApp：grokbot:// が登録されていない（アプリが無い）　failed：OS が開けなかった
export type BotAppError = 'badId' | 'noApp' | 'failed';

// ボットの返事の受け取り口（第2段 S2.1・S2.2。docs/ideas-bot-cells.md §9.4・§9.6）
//   via：運び手。C++ が決める（ファイルの中の文字は信じない）。案イ（中継の道具が置き場に置く）の間は、いつも 'folder'
//     'server' は外の中継のこと。左右の UI のあいだの relay（写し）とは別
export type BotVia = 'folder' | 'mail' | 'server';
// 左の UI の答え：done＝受け取って記録した（灰色のものも含む）　rejected＝形が読めないので受け取らない（reason に理由）
export type BotReplyResult = 'done' | 'rejected';

// C++ が bot-inbox\ から取った返事（左の UI にだけ届く。数字の requestId は付かない）
//   fileId：受け取り口でのファイルの名前（r-＋SHA-256 の 32 字など。^[A-Za-z0-9_-]{1,80}$）
//   reply：JSON のオブジェクトだということだけを C++ が確かめたもの。形・check・二重は左の UI（bots.ts）が確かめる
//   sourceName：置き場でのもとの名前（<requestId>-<id>.json・notice-<bot>-<id>.json）。置き場から取り込んだものだけ
export interface BotReplyEnvelope {
  fileId: string;
  via: BotVia;
  receivedAt: string;
  transportOk: boolean; // 'folder' はいつも false
  reply: unknown;
  sourceName?: string;
}

// AI 用に取り出したページの文章
export interface PageText {
  requestId: number;
  tabId?: number;
  title?: string;
  url?: string;
  text?: string;
  truncated?: boolean; // 長すぎて途中で切った
  length?: number; // 切る前の文字数
  selection?: string; // ページで選んでいる文字
  lang?: string;
  error?: 'noPage' | 'script' | 'timeout';
}

// C++ → UI
export type HostMessage =
  | {
      type: 'hello';
      tabs: ({ id: number } & TabInfo)[];
      activeId: number | null;
      session: unknown; // 前回保存した内容（無ければ null）。読めなかったときは控えの中身（あれば）
      sessionState?: 'ok' | 'missing' | 'unreadable'; // 左だけ。無い・読めないを分ける（session-guard.ts）。古い C++ には無い
      sessionRecovery?: unknown; // 読めなかったとき：理由・写しの名前・使った控え（session-guard.ts の SessionRecovery）
      sidebars: SidebarState;
    }
  | { type: 'sessionSaved'; ok: boolean } // saveSession で session.json を書けたか（左だけ）
  // background：裏で開いたタブ（表示していない。ページはそのまま）
  | { type: 'tabCreated'; id: number; parentId: number | null; requestId: number | null; url: string; asleep: boolean; background?: boolean }
  | { type: 'tabUpdated'; id: number; patch: TabInfo }
  | { type: 'tabActivated'; id: number }
  | { type: 'tabClosed'; id: number }
  | { type: 'tabThumbnail'; id: number; image: string }
  | { type: 'sidebars'; state: SidebarState }
  | { type: 'relayed'; from: Side; payload: RelayPayload }
  | { type: 'shortcut'; action: ShortcutAction }
  | { type: 'openUrl'; url: string } // 外から「このページを開いて」と頼まれた（起動時の引数・すでに動いている窓へ渡された URL）
  // ページの右クリックのメニューで、リンクの「セルに追加（ページはこのまま）」「六角スクショを表紙にして、セルに追加」が押された
  //   askGrok（S3.11）：選んだ文の上の「🔍 Grok に調べてもらう」か Ctrl+Shift+G（src/browser.cpp の kAskGrokPlainCtrlG で Ctrl+G）。
  //     url はページの URL（http・https のときだけ。ほかは空）、text は選んだ文（4,000 字まで。キーのときは空）。id は表示中のタブ（無ければ 0）
  //   memoQuote（M4）：「📝 下のメモに引用」。text は選んだ文（2,000 字まで）。下の区画が見えているときだけメニューに出る
  //   captureCenter（C2）：ページの右クリック「中央の見えている所」。url と text は空でもよい。撮るのは右の「撮影」
  //   captureWindow / captureDesktop / captureRegion（C5）：窓全体・この画面のデスクトップ・範囲
  //   captureImage（依頼① I1）：ページの画像の上の右クリック「🖼 画像を撮影に送る」。url は画像の URL（http・https で 8,192 字以下のときだけ。ほかは空）、text は空
  | { type: 'linkMenu'; action: 'background' | 'shotCover' | 'askGrok' | 'memoQuote' | 'captureCenter' | 'captureWindow' | 'captureDesktop' | 'captureRegion' | 'captureRecord' | 'captureImage' | 'vocabCard'; id: number; url: string; text: string }
  // 開発用（C++ は送らない）。左の偽物 __mockAskMaterials が、材料つきで依頼の小窓を開く
  | { type: 'mockAskMaterials'; items: unknown }
  // ページの Alt+クリック「単語帳へ」。front は単語、example は前後の文。URL はタブの台帳を使う（ページの申告は使わない）
  | { type: 'vocabPick'; id: number; front: string; example: string }
  | ({ type: 'pageText' } & PageText)
  | { type: 'apiKey'; key: string | null; error?: 'save' }
  // webhook「そのまま送る」（依頼の小窓 v2・R11）。botHook は「ある／ない」だけ（宛先の URL・鍵・ホスト名は返さない）。
  //   error：badUrl＝https の URL でない　badKey＝鍵の形が違う（空白・改行・1,024 字より長い）　save・delete＝書けなかった（前の設定のまま）
  //   botHookSent：POST の結果（botRequestId は依頼の requestId）。error：timeout・tls・connect・http（status に番号）・noHook・badRequest
  | { type: 'botHook'; requestId: number; has: boolean; error?: 'badUrl' | 'badKey' | 'save' | 'delete' }
  | { type: 'botHookSent'; requestId: number; botRequestId: string; ok: boolean; status: number; error?: string }
  | { type: 'scroll'; requestId: number; y?: number; h?: number; vh?: number; error?: string }
  | { type: 'dataWritten'; requestId: number; ok: boolean }
  // missing：ファイルが本当に無い（text が null のときだけ付く。撮影の台帳が「無い」と「開けない」を分けるのに使う）
  | { type: 'dataRead'; requestId: number; text: string | null; missing?: boolean }
  | { type: 'dataList'; requestId: number; files: { name: string; size: number; modified: number }[] }
  | ({ type: 'hexMemoCatalog'; requestId: number } & HexMemoCatalog)
  | ({ type: 'hexMemoSent'; requestId: number } & HexMemoSendResult)
  | ({ type: 'hexMemoState'; requestId: number } & HexMemoState)
  | { type: 'hexMemoBoard'; requestId: number; ok: boolean; memos?: HexMemoBoardMemo[]; truncated?: boolean; error?: string }
  | { type: 'clipboard'; requestId: number; text: string; html: string } // クリップボードの文字と HTML（六角メモのマスの写しは HTML の中）
  // 盤面の「画像を貼る」。clipboardHasImage は present（中身は読まない）。clipboardReadImage は長い辺 1600px の JPEG（data URL）
  //   error：empty＝画像が無い　decode＝読めない　big＝渡せない大きさ
  | { type: 'clipboardImage'; requestId: number; present?: boolean; ok?: boolean; image?: string; error?: 'empty' | 'decode' | 'big' }
  // 表示中のページを撮った画像。error は下のメモの区画が理由を出すとき（noPage・popout・notActive・capture・tooBig）
  // via：wgc は Windows.Graphics.Capture（黄色い枠が出る）。gdi は画面のコピー。mock は練習用
  //   rect・cropped・scale・reduced：captureFull に rect を付けたときの成功の返事（依頼① I1）。rect は実際に撮った矩形（CSS ピクセル）、
  //   cropped は見えている範囲に切り詰めたか、scale は倍率（1 まで）、reduced は大きすぎて小さくし直したか
  | { type: 'capture'; requestId: number; ok: boolean; image?: string; error?: string; via?: 'wgc' | 'gdi' | 'mock'; rect?: { x: number; y: number; width: number; height: number }; cropped?: boolean; scale?: number; reduced?: boolean }
  // 中央の録画（C6）。query / start / stop / open / delete の返事。progress と done は requestId を付けない
  | { type: 'record'; requestId: number; ok: boolean; error?: string }
  | { type: 'recordProgress'; seconds: number; limit: number }
  // note：途中で止まったが、そこまでは残したときの理由（'write'・'shot' など）。ok のまま届く
  | { type: 'recordDone'; ok: boolean; id?: string; image?: string; seconds?: number; bytes?: number; times?: number[]; error?: string; note?: string }
  // 文字の読み取り（C7）。query と read の返事。noJapanese のときは台帳を消さない（UI 側）。
  //   返事は頼んだ面へ届く（右の「文字を読む」と、読む画面の画像の書き足しの隠す候補。依頼の小窓 v2・R7c）
  | {
      type: 'captureText';
      requestId: number;
      ok: boolean;
      lines?: { text: string; x: number; y: number; w: number; h: number; table?: boolean; at?: number }[];
      error?: 'unavailable' | 'noJapanese' | 'decode' | 'engine' | 'busy';
    }
  // ページ全体をピクチャのフォルダへ書いた結果（M4）。画像そのものは返さない。name は実際に書いたファイルの名前
  //   error：name・folder・noPage・popout・notActive・metrics・size・shot・write・big
  | { type: 'pageCaptured'; requestId: number; ok: boolean; name?: string; width?: number; height?: number; truncated?: boolean; error?: string }
  // カードの画像を同じフォルダへ書いた結果。error：name・data・big・write・folder
  | { type: 'imageExported'; requestId: number; ok: boolean; name?: string; error?: string }
  | { type: 'liveCaptions'; requestId: number; available: boolean; running: boolean; text: string } // ライブキャプションの文字
  | { type: 'subtitle'; requestId: number; ok: boolean; name?: string; text?: string; error?: string } // メディアの横に置いた字幕
  | { type: 'mediaFile'; requestId: number; path: string | null } // 選んでもらった音声・動画のファイル
  // Grok の提案ファイル（JSON）を開いた。text は UTF-8 の文字（1 MB まで）。error：cancel・notFound・big・read
  | { type: 'jsonFile'; requestId: number; ok: boolean; name?: string; text?: string; error?: string }
  // 画像ファイルを開く。path が null はやめた。image は縮図（JPEG の data URL）。error：type・missing・decode・big
  | { type: 'imageFile'; requestId: number; path: string | null; ok?: boolean; image?: string; error?: 'type' | 'missing' | 'decode' | 'big' }
  // クリップボードの JPEG をピクチャのフォルダへ書いた結果。path は保存したファイル
  | { type: 'imageSaved'; requestId: number; ok: boolean; path?: string; error?: 'data' | 'folder' | 'write' }
  // アプリのセル（A1）：選んだ .exe か .lnk。icon は data:image/png;base64,... か空。起動はまだしない
  //   error：cancel はやめた　type は .exe と .lnk 以外　missing はファイルが無い　dialog は窓を出せない
  | {
      type: 'appPicked';
      requestId: number;
      ok: boolean;
      name?: string;
      launch?: string;
      target?: string;
      args?: string;
      cwd?: string;
      shortcut?: string;
      icon?: string;
      aumid?: string;
      error?: 'cancel' | 'type' | 'missing' | 'dialog';
    }
  // アプリのセル（A5）：ダブルクリックの結果
  //   action：placed＝中央に合わせて最前面　fixed＝大きさを変えず中央寄せ　released＝最前面をやめた
  //     waiting＝起動したが窓がまだ見つからない　store＝特定できなかったストアアプリ（ほかの窓は動かさない）
  //   overlap：fixed の窓が区画の外まではみ出す（サイドバーに重なることがある）
  //   host：掴んだ窓の実行ファイル（起動用と違うとき、台帳が次から探す）。無ければ省略
  //   aumid：アプリ ID。台帳が覚え、次からこの ID でストアの窓を探す。無ければ省略
  //   error：badPath＝ファイルが無い　failed＝起動できない・動かせない　denied＝管理者で窓を動かせない　notFound＝パスを聞けず窓を特定できない
  | {
      type: 'appSummoned';
      requestId: number;
      ok: boolean;
      action?: 'placed' | 'fixed' | 'released' | 'waiting' | 'store';
      overlap?: boolean;
      host?: string;
      aumid?: string;
      error?: 'badPath' | 'failed' | 'denied' | 'notFound';
    }
  // 追従をやめた（窓が閉じた、または動かせなくなった）。メニューの「最前面をやめる」を戻す
  | { type: 'appFollowEnded'; reason?: 'closed' | 'denied' }
  // 追従中に、大きさを変えられない窓がサイドバーへはみ出した（同じアプリでは UI が一度だけ知らせる）
  | { type: 'appFollowOverlap' }
  | { type: 'clipboardWritten'; requestId: number; ok: boolean } // clipboardWrite（文字）と clipboardWriteImage（画像。S3.12）の結果
  // 六角スクショを Grok-Bot へ（S3.12）：bot-shots に保存した結果。path は保存したフルパス（%LOCALAPPDATA%\RocksCellsBrowser\bot-shots\<shotId>.png）
  //   error：badId＝shotId の形が違う　badImage＝PNG でない・大きすぎる　write＝書けなかった
  | { type: 'botShotSaved'; requestId: number; ok: boolean; path?: string; error?: 'badId' | 'badImage' | 'write' }
  | { type: 'evalResult'; requestId: number; ok: boolean; value?: unknown; error?: 'noPage' | 'failed' | 'exception' }
  | { type: 'notified'; requestId: number; ok: boolean }
  // データ置き場：サイドバーの範囲を撮って保存した結果（画像そのものは返さない。bytes は保存した大きさ）
  | { type: 'surfaceCaptured'; requestId: number; ok: boolean; bytes?: number; error?: string }
  | { type: 'vaultUsage'; requestId: number; bytes: number; files: number } // データ置き場のフォルダの大きさ
  // ボットのセル：Grok Bot アプリを開いた結果（openBotApp に requestId を付けたときだけ届く）
  | { type: 'botAppOpened'; requestId: number; ok: boolean; error?: BotAppError }
  // ページ（リンク・新しい窓・iframe）から grokbot:// を開こうとしたので、C++ が止めた（人が押したときだけ届く。S1.11）
  | { type: 'botLinkBlocked'; id: number }
  // ボットの返事が受け取り口に届いた（左だけ。答えは botReplyTaken）。左の UI が読み込み直すと、取ったままのものがもう一度届く
  | ({ type: 'botReply' } & BotReplyEnvelope)
  // 受け取り口の様子（左の ready のたび・受け取る窓が変わったとき・botCheck に requestId を付けたとき）
  //   owner：この窓が受け取る（false＝同じデータフォルダの別の窓が受け取っている。この窓には届かない）
  //   relay：置き場（RocksCellsRelay\inbox\）を見ている（試しのデータフォルダで ROCKSCELLS_RELAY_DIR が無いときは false）
  //   watching：4 秒おきに見回っている（botInboxWatch の on）
  //   lastScanAt：最後に見回った時刻（UTC の ISO。まだ見回っていなければ無い。依頼の小窓 v2・R8 の中継の見張り）
  | { type: 'botInboxState'; owner: boolean; relay: boolean; watching: boolean; lastScanAt?: string; requestId?: number }
  // 窓がほかのアプリから戻った（active true）・ほかのアプリへ移った（false）。左だけ（WM_ACTIVATEAPP。R8：「貼りましたか？」を戻ってから数える）
  | { type: 'appActive'; active: boolean }
  | { type: 'flush' } // 終了直前。今すぐ保存してほしい
  // ダウンロードの棚（左だけ。path は渡さない。開く・フォルダ・外すは id だけ）
  | { type: 'downloads'; items: { id: string; name: string; bytes: number; at: number }[] }
  | { type: 'downloadResult'; id: string; ok: boolean; opened?: boolean; note?: string; error?: 'missing' | 'failed' | 'mock' }
  // ライブの小窓（P2）。id は最初の 1 つ（null は 1 つも出ていない）。list は出ている小窓の全部（slot は窓の番号 0〜3）
  //   error：full（4 つ出ている）・failed（窓を作れなかった）
  | { type: 'popout'; id: number | null; list?: { id: number; slot: number; top: boolean }[]; error?: 'full' | 'failed' }
  // 小窓を動かした・大きさを変えた・最前面を切り替えた・戻した：窓の番号ごとに覚えておく（物理ピクセル）
  | { type: 'popoutPlace'; slot: number; x: number; y: number; w: number; h: number; top: boolean };

// UI → C++
export type UiMessage =
  | { type: 'ready' }
  | { type: 'setLang'; pref: 'auto' | 'ja' | 'en' } // 言語の設定（C++ が lang.txt に残し、次の起動で C++ 側の言葉にも使う。英語版 E4）
  // lazy：眠ったまま作る　background：裏で読み込む（表示しない）
  | { type: 'createTab'; url: string; parentId: number | null; requestId: number; lazy?: boolean; background?: boolean }
  | { type: 'setLinkOpen'; background: boolean } // ページのリンクから開く新しいタブを、いつも裏で開くか
  // 見た目のテーマ（左からだけ）。窓の地・題名バー・枠・ページの明暗。C++ は theme.json に残し、次の起動では窓を作る前に読む。
  //   current：今付けているのは light と dark のどちらの組か（いつも同じテーマのときは 2 つの組が同じ）
  | { type: 'setTheme'; mode: 'auto' | 'fixed'; pages: 'theme' | 'os'; current: 'light' | 'dark'; light: WindowThemeSlot; dark: WindowThemeSlot }
  | { type: 'activateTab'; id: number }
  | { type: 'closeTab'; id: number }
  | { type: 'navigate'; id: number; url: string }
  | { type: 'goBack' | 'goForward' | 'reload' | 'captureTab' | 'suspendTab' | 'discardTab'; id: number }
  | { type: 'setMuted'; id: number; muted: boolean }
  // split：読む画面をページの右側（true・'right'）か下側（'bottom'）だけに出す（動画）。height は下側のときの高さ
  // place は下のメモだけ（段 9）。送らないあいだは、C++ は今の場所のまま
  | { type: 'setSidebar'; side: Side; visible?: boolean; width?: number; height?: number; split?: boolean | 'right' | 'bottom'; place?: '' | 'upper' }
  | { type: 'relay'; to: Side | 'all'; payload: RelayPayload }
  | { type: 'saveSession'; data?: SessionData; final?: boolean }
  | { type: 'getPageText'; requestId: number; id?: number } // id を省くと表示中のタブ
  | { type: 'getScroll'; requestId: number; id: number }
  // タブの中で UI の決まったスクリプトを動かす（AI の道具用。音楽の再生・一時停止など）
  | { type: 'evalInTab'; requestId: number; id: number; script: string }
  | { type: 'notify'; title: string; body: string; requestId?: number } // Windows の通知
  | { type: 'setApiKey'; key: string }
  | { type: 'getApiKey' | 'deleteApiKey' }
  // webhook「そのまま送る」（R11）：宛先と鍵は C++ の DPAPI（bot-hook.bin）だけに置く。set・get・delete は左と右から、send は左からだけ
  | { type: 'setBotHook'; requestId: number; url: string; key: string }
  | { type: 'getBotHook' | 'deleteBotHook'; requestId: number }
  | { type: 'botHookSend'; requestId: number; botRequestId: string; body: string; agentId?: string }
  // UI の保存場所（データフォルダの ui-data の中だけ。名前は "conversations/abc.json" のような形）
  | { type: 'writeData'; name: string; text: string; requestId?: number }
  | { type: 'readData'; name: string; requestId: number }
  | { type: 'listData'; dir: string; requestId: number }
  | { type: 'deleteData'; name: string }
  // 六角メモ（読むのは一覧だけ。送るときは六角メモの受け取り口に置く）
  | { type: 'hexMemoCatalog'; requestId: number }
  | { type: 'hexMemoSend'; requestId: number; appId: string | null; boardId: string; records: HexMemoRecord[]; offsets?: { dq: number; dr: number }[] }
  | { type: 'hexMemoCheck'; requestId: number; appId: string | null; sendId: string }
  | { type: 'hexMemoReadBoard'; requestId: number; appId: string | null; boardId: string } // ノートのメモを読む（記憶用）
  | { type: 'clipboardRead'; requestId: number }
  // 盤面のセルへ貼る画像（左だけ）。Has は画像があるかだけ。Read は JPEG の data URL（clipboardImage）
  | { type: 'clipboardHasImage'; requestId: number }
  | { type: 'clipboardReadImage'; requestId: number }
  // maxEdge：見えている範囲だけ、長い辺がこれ以下の JPEG（下のメモの区画）。省くと今までどおりの六角形スクショ
  //   rect：その中の矩形だけを撮る（見えている所の左上からの CSS ピクセル。maxEdge と一緒のときだけ。依頼① I1）
  | { type: 'captureFull'; requestId: number; id: number; maxEdge?: number; rect?: { x: number; y: number; width: number; height: number } }
  // ブラウザの窓全体か、その窓があるモニタ（C5）。範囲の切り取りは UI が行う。返事は capture
  | { type: 'captureScreen'; requestId: number; scope: 'window' | 'desktop' }
  // 中央のページの録画（C6）。query は使えるか。start の id は台帳と同じ。open は mp4 を開く。delete はファイルだけ消す
  | { type: 'recordCenter'; requestId: number; command: 'query' | 'stop' }
  | { type: 'recordCenter'; requestId: number; command: 'start' | 'open' | 'delete'; id: string }
  // saved：右が録画のカードを保存し終えた（あきらめた）ことを知らせる。返事は無い。閉じる途中の C++ がこれを待つ
  | { type: 'recordCenter'; command: 'saved'; id: string }
  // 文字の読み取り（C7）。query は使えるか。read の image は JPEG の data URL。times は録画のミリ秒（最大20）
  | { type: 'readCaptureText'; requestId: number; command: 'query' }
  | { type: 'readCaptureText'; requestId: number; command: 'read'; id: string; image: string; times?: number[] }
  // ページ全体を JPEG にして、ピクチャ\Rocks-cells Browser\ に書く（M4）。name は UI が決める。返事は pageCaptured（画像は返らない）
  | { type: 'capturePage'; requestId: number; id: number; name: string }
  // カードの画像（JPEG か PNG の Base64。data: の頭は付けない）を、同じフォルダに書く。返事は imageExported
  | { type: 'exportImage'; requestId: number; name: string; data: string }
  | { type: 'openExported'; name: string } // 書き出した画像を Windows で開く（返事は無い）
  | { type: 'revealExported'; name: string } // フォルダを開いて、その画像を選ぶ（返事は無い）
  | { type: 'liveCaptions'; requestId: number; start: boolean }
  | { type: 'readSubtitle'; requestId: number; path: string }
  | { type: 'openMediaFile'; requestId: number }
  // 画像ファイルを選んでもらう（左の盤面）。返事は imageFile。縮図も付く
  | { type: 'openImageFile'; requestId: number }
  // JSON ファイル（Grok の提案・型の書き出し）を選んでもらう（左と下の区画だけ）。返事は jsonFile
  | { type: 'openJsonFile'; requestId: number }
  // クリップボードの JPEG（data URL か Base64）をピクチャ\Rocks-cells Browser\ に書く。返事は imageSaved。左からだけ
  | { type: 'saveClipboardImage'; requestId: number; data: string }
  // アプリのセル（A1）：.exe か .lnk を選んでもらう。返事は appPicked。左の盤面からだけ。起動はしない
  | { type: 'pickApp'; requestId: number }
  // アプリのセル（A5）：中央の区画に合わせて最前面にする。無ければ launch を起動する。返事は appSummoned。左からだけ
  //   release：最前面をやめる（位置と大きさはそのまま）
  //   host：前回掴んだ窓の実行ファイル。target と違っても、フルパスの一致に使う
  //   shortcut：選んだ .lnk。aumid が空のとき、C++ がここからアプリ ID を読み直す
  //   aumid：ショートカットのアプリ ID。空でもよい。name は、ID が無いストアアプリの題名用
  | {
      type: 'summonApp';
      requestId: number;
      launch: string;
      target: string;
      args: string;
      cwd: string;
      host?: string;
      shortcut?: string;
      name?: string;
      aumid?: string;
      release?: boolean;
    }
  // noHistory：Windows のクリップボード履歴（Win+V）とほかの端末への同期に入れない印を一緒に置く（依頼の小窓 v2・R2・D6。
  //   ボットの依頼と、そのための画像だけ。六角メモ・相棒は付けない〔計画の Q1〕）。clipboardWriteImage も同じ
  | { type: 'clipboardWrite'; requestId: number; text: string; html: string; noHistory?: boolean }
  // 六角スクショを Grok-Bot へ（第3段 S3.12）
  //   clipboardWriteImage：画像（PNG の Base64。data: の頭は付けない）をクリップボードへ。C++ が CF_DIBV5 と PNG の両方を書く。
  //     fill：透明な所の色（white が既定・dark・none＝塗らない）。結果は clipboardWritten
  //     画像と文を一つの貼り付けで（依頼の小窓 v2・R7d・D16。試し）：png の代わりに shotId（bot-shots\<shotId>.png。botShotSave で保存した写し。
  //     依頼の文を作る左は画像を持たない）。text（文だけ）があれば、C++ が同じ Open で CF_UNICODETEXT と HTML Format も書く
  //     （html は文の断片。C++ がその頭に、書く PNG の data: の <img> を足す）。アプリが受けたかは返らない（書けたかだけ）
  //   botShotSave：bot-shots\<shotId>.png に保存する（shotId は英数字とハイフンの 64 字まで。ほかは C++ が断る。7 日より古いものは C++ が消す）。結果は botShotSaved
  //   botShotOpenFolder：bot-shots をエクスプローラーで開く（shotId があれば、その画像を選んだ状態で）
  | { type: 'clipboardWriteImage'; requestId: number; png?: string; shotId?: string; text?: string; html?: string; fill?: 'white' | 'dark' | 'none'; noHistory?: boolean }
  | { type: 'botShotSave'; requestId: number; shotId: string; png: string }
  | { type: 'botShotOpenFolder'; shotId?: string }
  // データ置き場（ui-data\vault\）：この面の clip の範囲（ページの座標）を撮って name（vault/img/<id>.png）に保存する。
  //   beyond：画面の外に描いたものも撮る（会話の全体）。false は見えている範囲だけ
  | { type: 'captureSurface'; requestId: number; name: string; clip: { x: number; y: number; width: number; height: number }; beyond: boolean }
  | { type: 'vaultUsage'; requestId: number }
  | { type: 'deleteVaultImage'; name: string }
  | { type: 'openVaultFolder' }
  // ボットのセル：Grok Bot アプリの、そのボットのチャットを開く。渡すのはエージェントの id だけ
  //   （grokbot:// の URL は C++ が組み立てる。UI は URL を作らない・持たない）。左と右のサイドバーからだけ受け付ける
  | { type: 'openBotApp'; agentId: string; requestId?: number }
  // ボットの返事の受け取り口（左のサイドバーからだけ受け付ける。右と読む画面からは受けない）
  //   botReplyTaken：botReply を記録した（done）か、形が読めず受け取らない（rejected。reason は英数字の短い名前）。C++ が done\・rejected\ へ移す
  //   botCheck：今すぐ受け取り口を見る（requestId を付けると botInboxState が返る）。peek：見回らずに様子だけ返す（R8。最後に見回った時刻を聞く）
  //   botInboxWatch：4 秒おきの見回りを動かす（on）・止める。台帳にボットが1体もいないときは止める
  | { type: 'botReplyTaken'; fileId: string; result: BotReplyResult; reason?: string }
  | { type: 'botCheck'; requestId?: number; peek?: boolean }
  | { type: 'botInboxWatch'; on: boolean }
  // ダウンロードの棚と、最前面の小窓（左だけ。C++ が path を持つ。UI は id だけ送る）
  | { type: 'openDownload'; id: string }
  | { type: 'revealDownload'; id: string }
  | { type: 'forgetDownload'; id: string }
  | { type: 'popout'; id: number; places?: { x: number; y: number; w: number; h: number; top: boolean }[] }
  | { type: 'dockPopout'; id?: number } // id が無ければ、みな戻す
  | { type: 'popoutTop'; id: number; top: boolean };

interface HostWebView {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

declare global {
  interface Window {
    chrome?: { webview?: HostWebView };
    // npm run dev の偽物だけ：ボットの返事の見本を botReply にして届ける（例 __mockBotReply('reply')。kind は ui/src/mock/bot-samples.ts）。
    //   override で項目を上書きできる（例 __mockBotReply('reply', { requestId: 'hb-…', check: '…', id: 'r2' })）。返すのは fileId
    __mockBotReply?: (kind?: string, override?: Record<string, unknown>) => Promise<string | null>;
    // npm run dev の偽物だけ：Grok の提案（patch.v1 の JSON）を受け取り口に届いたことにする（返すのは fileId）
    __mockGrokPatch?: (patch: Record<string, unknown>) => string;
    // npm run dev の偽物だけ（左）：C++ の代わりに linkMenu の askGrok を届ける（S3.11）。
    //   text に選んだ文を渡すと右クリックの「🔍 Grok に調べてもらう」、空なら Ctrl+Shift+G。url はページの URL（http・https 以外は空にして渡す）。
    //   依頼の小窓は読む画面（/?surface=reader を同じブラウザの別のタブで開いておく）に出る
    __mockAskGrok?: (text?: string, url?: string) => void;
    // npm run dev の偽物だけ（左）：材料つきで依頼の小窓を開く（段 D2）。items は makeMaterial に渡す形。
    //   読む画面（/?surface=reader を同じブラウザの別のタブで開いておく）に出る
    __mockAskMaterials?: (items?: unknown[]) => void;
    // npm run dev の偽物だけ（左）：ページの右クリック「単語帳のカードにする」の代わり
    __mockVocabCard?: (text?: string, url?: string) => void;
    // npm run dev の偽物だけ：この面の仮のクリップボードの中身（S3.12 の確かめ用。image は画像が入っているか）。
    //   画像のコピーが失敗するときを試すには localStorage.setItem('honeycomb.mockClipboardImage', 'fail')（元に戻すには removeItem）
    //   「画像を貼る」の見本は localStorage.setItem('honeycomb.mockClipboardImageData', dataUrl)（data:image/…）。外すには removeItem
    //   noHistory は、最後に書いたときに「履歴・同期に入れない印」を頼まれたか（R2。偽物は印を付けず、覚えるだけ）
    __mockClipboard?: () => { text: string; html: string; image: boolean; noHistory: boolean; png: string };
    // npm run dev の偽物だけ（左）：C++ の代わりに六角形スクショのショートカット（Ctrl+Shift+S）を届ける（S3.12 の確かめ用。
    //   ページの画像は偽物の captureFull が描いた見本。撮る画面は読む画面〔/?surface=reader を別のタブで〕に出る）
    __mockHexShot?: () => void;
    // npm run dev の偽物だけ（左）：C++ の代わりに、中央の見えている所を右の「撮影」へ頼む（C2）。
    //   無しか 'key' は Ctrl+Shift+Y。'menu' はページの右クリック「この画面を撮る」。右（/?surface=right）を開いておく
    __mockCaptureCenter?: (from?: 'key' | 'menu') => void;
    // npm run dev の偽物だけ（左）：ページの右クリックの撮影（C5）。window / desktop / region。center は __mockCaptureCenter
    __mockCaptureScope?: (scope?: 'center' | 'window' | 'desktop' | 'region') => void;
    // npm run dev の偽物だけ（左）：ページの右クリック「中央を録画」（C6）。右（/?surface=right）を開いておく
    __mockCaptureRecord?: () => void;
    // npm run dev の偽物だけ（左）：ページの画像の右クリック「🖼 画像を撮影に送る」（I1）。右がページに聞く記録は
    //   localStorage の honeycomb.mockImageRecord に置く。右（/?surface=right）を開いておく
    __mockCaptureImage?: (opts?: { rect?: { x: number; y: number; width: number; height: number }; reason?: string; url?: string; src?: string }) => void;
    // npm run dev の偽物だけ：この面に、別の面から届いたふりでリレーを渡す（Grok Cards の見本）
    __mockRelay?: (payload: RelayPayload) => void;
    // npm run dev の偽物だけ（読む画面）：偽物の動画の今の様子（V1m）。読む画面で __mockRelay({ kind: 'readerOpen', tabId: 1, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: '偽物の動画' }) を呼ぶと区間セルが並ぶ
    __mockVideo?: () => { id: string; title: string; duration: number; time: number; paused: boolean; rate: number; at: number };
    // npm run dev の偽物だけ（読む画面）：偽物の動画の字幕の本数を替える（5 秒ずつ。動画の長さも合わせる。900 マスで切れる形の確かめ用。V6d）。
    //   替えたあと「字幕を読み直す」か readerOpen を流し直す
    __mockVideoSegments?: (n: number) => void;
    // npm run dev の偽物だけ（左）：C++ の代わりに appActive を届ける（R8 の確かめ用。false＝アプリへ移った・true＝戻った）。
    //   届けなければ、偽物ではアプリへ移らなかった扱い（「貼りましたか？」は送ってから askPastedSec 秒あと）
    __mockAppActive?: (active: boolean) => void;
  }
}

// このページが左右どちらのサイドバーとして開かれたか（C++ が URL に ?surface=right を付ける）
const surfaceParam = new URLSearchParams(location.search).get('surface');
export const surface: Side = surfaceParam === 'right' || surfaceParam === 'reader' || surfaceParam === 'memo' ? surfaceParam : 'left';

type Listener = (msg: HostMessage) => void;
const listeners: Listener[] = [];
const host = window.chrome?.webview;

// 返事を待つ頼みごと（request）。番号は、タブ作成の requestId とぶつからないよう大きな数から振る
const waiting = new Map<number, (msg: HostMessage) => void>();
let nextRequestId = 1_000_000;

function deliver(msg: HostMessage) {
  const requestId = 'requestId' in msg ? msg.requestId : null;
  if (msg.type !== 'tabCreated' && typeof requestId === 'number') {
    const resolve = waiting.get(requestId);
    if (resolve) {
      waiting.delete(requestId);
      resolve(msg);
      return;
    }
  }
  for (const fn of listeners) fn(msg);
}

// ブラウザ本体の外（npm run dev で普通のブラウザで開いたとき）は、簡易版の偽物で動かす
const post: (msg: UiMessage) => void = host ? (msg) => host.postMessage(msg) : createMockHost(deliver);
host?.addEventListener('message', (event) => deliver(event.data as HostMessage));

export function send(msg: UiMessage) {
  post(msg);
}

export function onMessage(fn: Listener) {
  listeners.push(fn);
}

// C++ に頼んで、返事（同じ requestId のメッセージ）を待つ。来なければ null
export function request(build: (requestId: number) => UiMessage, timeoutMs = 15_000): Promise<HostMessage | null> {
  const requestId = nextRequestId++;
  return new Promise((resolve) => {
    waiting.set(requestId, resolve);
    send(build(requestId));
    window.setTimeout(() => {
      if (waiting.delete(requestId)) resolve(null);
    }, timeoutMs);
  });
}

function createMockHost(emit: (msg: HostMessage) => void) {
  const SESSION_KEY = 'honeycomb.mockSession';
  let nextId = 1;
  const sleeping = new Set<number>();
  // いま開いている画面は見えている（右だけをブラウザで開いたときも、右は開いている）
  let sidebars: SidebarState = {
    left: { visible: surface === 'left', width: 280 },
    right: { visible: surface === 'right', width: 320 },
    reader: { visible: surface === 'reader', width: 0 },
    memo: { visible: surface === 'memo', width: 0, height: 300 },
  };
  const reply = (msg: HostMessage) => setTimeout(() => emit(msg), 30);
  // C++ と同じ名前の確かめ（英数字・.・_・-、.jpg / .png、`..` は断る）
  const isMockExportName = (name: string) => !name.includes('..') && /^[A-Za-z0-9._-]{1,80}\.(jpg|png)$/.test(name);
  // ふつうのブラウザで試すときの、仮のクリップボード。png：入れた画像の Base64（R7b。書き足した版が焼けているかを img に出して見る）
  const mockClipboard = { text: '', html: '', image: false, noHistory: false, png: '' };
  window.__mockClipboard = () => ({ ...mockClipboard });
  window.__mockRelay = (payload) => {
    const from: Side = surface === 'left' ? 'right' : 'left';
    emit({ type: 'relayed', from, payload });
  };
  // 偽物の動画（V1m。npm run dev だけ。読む画面の区間セルの確かめ用）。時間は、見ている（止まっていない）あいだだけ進む
  const mockVideo = { id: 'dQw4w9WgXcQ', title: '偽物の動画：漫才の練習', duration: 240, time: 0, paused: true, rate: 1, at: 0 };
  // 今の再生位置。止まっていなければ、前に見たときからの経過 × 速さだけ進める。duration で止める
  const mockVideoTime = (): number => {
    const now = Date.now();
    if (!mockVideo.paused) mockVideo.time += ((now - mockVideo.at) / 1000) * mockVideo.rate;
    mockVideo.at = now;
    if (mockVideo.time >= mockVideo.duration) {
      mockVideo.time = mockVideo.duration;
      mockVideo.paused = true;
    }
    return mockVideo.time;
  };
  // 偽物の字幕の文（12 本。掛け合いらしい短い文。同じ文が 4 回ずつ出る）
  const SAMPLE = [
    'どうもー、よろしくお願いしますー。今日もいいネタ持ってきました',
    'いやいや、それはおかしいやろ。なんで急に話が変わるねん',
    'ちょっと待って、今の言い方はひどくないですか',
    '夏休みの宿題、もう全部終わらせたんですよ、ほんまに',
    '嘘つけ、昨日の夜ずっとゲームしてたの知ってるで',
    'お前が言うたんやろ、時間どおりに来いって',
    'ほな、次はあなたの番ですよ、遠慮せんと早よどうぞ',
    'そんなん誰が信じるねん、ちゃんと証拠出してや',
    '証拠ならここにあります、写真も動画もばっちり',
    'もうええわ、二人ともちょっと落ち着いて話しましょか',
    '落ち着いてますよ、冷静すぎて逆にこわいくらい',
    'ありがとうございましたー、また来週もよろしくー',
  ];
  // 偽物の字幕：48 本・5 秒ずつ、チャプターは 3 つ（台本の返事の形は読む画面の transcript と同じ）。本数は __mockVideoSegments で替えられる
  let mockSegments = 48;
  window.__mockVideoSegments = (n) => {
    mockSegments = Math.max(1, Math.min(20_000, Math.floor(n)));
    mockVideo.duration = mockSegments * 5;
    mockVideo.time = Math.min(mockVideo.time, mockVideo.duration);
  };
  const mockTranscript = () => ({
    videoId: mockVideo.id,
    title: mockVideo.title,
    duration: mockVideo.duration,
    chapters: [
      { start: 0, title: 'つかみ' },
      { start: 80, title: '本ネタ' },
      { start: 180, title: 'オチ' },
    ],
    segments: Array.from({ length: mockSegments }, (_, i) => ({ start: i * 5, end: i * 5 + 5, text: SAMPLE[i % SAMPLE.length] })),
    source: 'panel' as const,
  });
  // 今の偽物の動画の様子（確かめ用。window.__mockVideo() で見る）
  window.__mockVideo = () => ({ ...mockVideo, time: mockVideoTime() });
  // 盤面の「画像を貼る」用。localStorage の data URL があればそれ、無ければ画像を入れたふりの小さな JPEG。fetch は使わない
  const mockClipboardPicture = (): string | null => {
    const seeded = localStorage.getItem('honeycomb.mockClipboardImageData');
    if (seeded && seeded.startsWith('data:image/')) return seeded;
    if (!mockClipboard.image) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#c4564a';
    ctx.fillRect(0, 0, 48, 32);
    ctx.fillStyle = '#f6edd6';
    ctx.fillRect(10, 8, 28, 16);
    return canvas.toDataURL('image/jpeg', 0.85);
  };
  // 保存した写しの偽物（R7d。bot-shots の代わり）：localStorage の honeycomb.mockBotShot:<shotId> に新しい 3 枚まで。入らなければ覚えない
  const SHOT_PREFIX = 'honeycomb.mockBotShot:';
  const mockShotKeep = (shotId: string, png: string) => {
    try {
      const old = Object.keys(localStorage).filter((key) => key.startsWith(SHOT_PREFIX) && key !== SHOT_PREFIX + shotId);
      for (const key of old.slice(0, Math.max(0, old.length - 2))) localStorage.removeItem(key);
      localStorage.setItem(SHOT_PREFIX + shotId, png);
    } catch {
      console.info('[bot-shots] 写しを覚えられませんでした（localStorage がいっぱい）');
    }
  };
  const mockShotRead = (shotId: string): string => {
    try {
      return /^[A-Za-z0-9-]{1,64}$/.test(shotId) ? (localStorage.getItem(SHOT_PREFIX + shotId) ?? '') : '';
    } catch {
      return '';
    }
  };
  // ボットの返事の受け取り口の偽物：C++ と同じく、渡した fileId だけを botReplyTaken で受け付ける。鍵も URL も持たない
  const botHanded = new Set<string>();
  let botWatching = false;
  let mockPopouts: { id: number; slot: number; top: boolean }[] = []; // 練習用：ライブの小窓（P2）
  let botSeq = 0;
  let botScanAt = ''; // 最後に見回ったふりをした時刻（R8。見回っている間は今の時刻を返す）
  let activeTab = 0; // 表示中のタブ（askGrok の id に使う）
  const botInboxState = (requestId?: number): HostMessage => {
    if (botWatching) botScanAt = new Date().toISOString();
    return {
      type: 'botInboxState',
      owner: true,
      relay: false,
      watching: botWatching,
      ...(botScanAt ? { lastScanAt: botScanAt } : {}),
      ...(requestId !== undefined ? { requestId } : {}),
    };
  };
  // 左右の写し（relay）の偽物：同じブラウザの別のタブで開いた左（/）と右（/?surface=right）のあいだを BroadcastChannel で運ぶ
  //   （ボットの欄などを npm run dev で見るため。1つのタブだけで開いているときは、今までどおり何も届かない）
  const mockRelay = typeof BroadcastChannel === 'function' ? new BroadcastChannel('honeycomb-mock-relay') : null;
  if (mockRelay) {
    mockRelay.onmessage = (e: MessageEvent) => {
      const data = e.data as { from?: Side; to?: Side | 'all'; payload?: RelayPayload } | null;
      if (data?.payload && data.from && data.from !== surface && (data.to === surface || data.to === 'all')) emit({ type: 'relayed', from: data.from, payload: data.payload });
    };
  }
  if (surface === 'left') {
    window.__mockBotReply = async (kind = 'reply', override = {}) => {
      const { BOT_SAMPLES } = await import('./mock/bot-samples'); // 見本は偽物のときだけ読む
      const sample = BOT_SAMPLES[kind];
      if (!sample) {
        console.warn(`[ボットの受け取り口] 見本 ${kind} はありません。使えるもの：${Object.keys(BOT_SAMPLES).join('・')}`);
        return null;
      }
      const reply = { ...(structuredClone(sample.reply) as Record<string, unknown>), ...override };
      const fileId = `mock-${Date.now().toString(36)}-${++botSeq}`;
      botHanded.add(fileId);
      console.info(`[ボットの受け取り口] 見本 ${kind}（${sample.note}）を ${fileId} として届けます`);
      emit({ type: 'botReply', fileId, via: 'folder', receivedAt: new Date().toISOString(), transportOk: false, reply });
      return fileId;
    };
    window.__mockGrokPatch = (patch) => {
      const fileId = `mock-${Date.now().toString(36)}-${++botSeq}`;
      botHanded.add(fileId);
      emit({ type: 'botReply', fileId, via: 'folder', receivedAt: new Date().toISOString(), transportOk: false, reply: structuredClone(patch) });
      return fileId;
    };
    window.__mockAppActive = (active) => emit({ type: 'appActive', active: active === true });
    window.__mockHexShot = () => emit({ type: 'shortcut', action: 'hexShot' });
    window.__mockCaptureCenter = (from = 'key') => {
      if (from === 'menu') emit({ type: 'linkMenu', action: 'captureCenter', id: activeTab, url: '', text: '' });
      else emit({ type: 'shortcut', action: 'captureCenter' });
    };
    window.__mockCaptureScope = (scope = 'window') => {
      const action = scope === 'desktop' ? 'captureDesktop' : scope === 'region' ? 'captureRegion' : scope === 'center' ? 'captureCenter' : 'captureWindow';
      emit({ type: 'linkMenu', action, id: activeTab, url: '', text: '' });
    };
    window.__mockCaptureRecord = () => emit({ type: 'linkMenu', action: 'captureRecord', id: activeTab, url: '', text: '' });
    window.__mockCaptureImage = (opts = {}) => {
      try {
        localStorage.setItem(
          'honeycomb.mockImageRecord',
          JSON.stringify({ rect: opts.rect ?? { x: 120, y: 80, width: 320, height: 200 }, reason: opts.reason ?? null, src: opts.src ?? opts.url ?? '' }),
        );
      } catch {
        // 保存できなければ、右の偽の evalInTab は none を返す
      }
      emit({ type: 'linkMenu', action: 'captureImage', id: activeTab, url: opts.url ?? '', text: '' });
    };
    window.__mockAskGrok = (text = '', url = 'https://example.com/guide/autumn-sky') => {
      // C++ と同じく、http・https 以外の URL と 4,000 字を超えた分は送らない
      const pageUrl = /^https?:\/\//i.test(url) ? url : '';
      emit({ type: 'linkMenu', action: 'askGrok', id: activeTab, url: pageUrl, text: [...String(text)].slice(0, 4000).join('') });
    };
    window.__mockAskMaterials = (items = []) => {
      emit({ type: 'mockAskMaterials', items });
    };
    window.__mockVocabCard = (text = 'ドーパミン', url = 'https://example.com/guide') => {
      emit({ type: 'linkMenu', action: 'vocabCard', id: activeTab, url, text });
    };
  }
  const titleOf = (url: string) => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  };
  // 盤面の台帳の偽物（C++ の LoadSessionForUi・SaveSessionWithBackups と同じ考え）。
  //   壊れたときを試すには localStorage.setItem('honeycomb.mockSession', '{壊れた')。保存の失敗は localStorage.setItem('honeycomb.mockSessionSaveFail', '1')
  //   控えは honeycomb.mockSession.bak1〜3、写しは honeycomb.mockSession.corrupt
  const usableSession = (v: unknown) => typeof v === 'object' && v !== null && (v as { version?: unknown }).version === 1 && Array.isArray((v as { tabs?: unknown }).tabs);
  const parseOrUndefined = (text: string | null) => {
    if (text === null) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  };
  let mockSessionRotated = false;
  const loadSession = () => {
    const text = localStorage.getItem(SESSION_KEY);
    if (text === null) return { session: null, sessionState: 'missing' as const };
    const value = parseOrUndefined(text);
    if (value !== undefined && usableSession(value)) return { session: value, sessionState: 'ok' as const };
    localStorage.setItem(`${SESSION_KEY}.corrupt`, text);
    const recovery: Record<string, unknown> = { reason: value === undefined ? 'parse' : 'shape', quarantine: 'session.corrupt-mock.json' };
    for (let g = 1; g <= 3; g++) {
      const backup = parseOrUndefined(localStorage.getItem(`${SESSION_KEY}.bak${g}`));
      if (backup === undefined || !usableSession(backup)) continue;
      recovery.backup = `session.bak${g}.json`;
      recovery.backupSavedAt = Number(localStorage.getItem(`${SESSION_KEY}.bak${g}.at`)) || Date.now();
      return { session: backup, sessionState: 'unreadable' as const, sessionRecovery: recovery };
    }
    return { session: null, sessionState: 'unreadable' as const, sessionRecovery: recovery };
  };
  const saveMockSession = (data: unknown): boolean => {
    if (localStorage.getItem('honeycomb.mockSessionSaveFail') === '1') return false;
    if (!mockSessionRotated) {
      mockSessionRotated = true; // 偽物は、ページを開いて初めて書く前だけ回す（1 時間ごとは省く）
      const current = parseOrUndefined(localStorage.getItem(SESSION_KEY));
      if (current !== undefined && usableSession(current)) {
        for (let g = 2; g >= 1; g--) {
          const v = localStorage.getItem(`${SESSION_KEY}.bak${g}`);
          if (v !== null) {
            localStorage.setItem(`${SESSION_KEY}.bak${g + 1}`, v);
            localStorage.setItem(`${SESSION_KEY}.bak${g + 1}.at`, localStorage.getItem(`${SESSION_KEY}.bak${g}.at`) ?? '');
          }
        }
        localStorage.setItem(`${SESSION_KEY}.bak1`, localStorage.getItem(SESSION_KEY) ?? '');
        localStorage.setItem(`${SESSION_KEY}.bak1.at`, localStorage.getItem(`${SESSION_KEY}.at`) ?? String(Date.now()));
      }
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
    localStorage.setItem(`${SESSION_KEY}.at`, String(Date.now()));
    return true;
  };
  // 中央の録画のふり（C6）。mp4 は作らない。赤い印と、代表の JPEG と、時刻の行だけ
  let recordTimer = 0;
  let recordSeconds = 0;
  let recordId = '';
  const finishMockRecord = () => {
    if (!recordId) return;
    if (recordTimer) window.clearInterval(recordTimer);
    recordTimer = 0;
    const seconds = recordSeconds;
    const id = recordId;
    recordId = '';
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#1c2430';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#f4f1ea';
      ctx.font = '20px sans-serif';
      ctx.fillText('録画（練習）', 16, 48);
      ctx.font = '14px sans-serif';
      ctx.fillText(`${seconds}秒`, 16, 80);
    }
    const last = seconds * 1000;
    const times = [0];
    for (let mark = 4000; mark <= last && times.length < 39; mark += 4000) times.push(mark);
    if (times[times.length - 1] !== last && times.length < 40) times.push(last);
    emit({
      type: 'recordDone',
      ok: !!ctx,
      id,
      ...(ctx ? { image: canvas.toDataURL('image/jpeg', 0.85) } : { error: 'shot' }),
      seconds,
      bytes: 12000,
      times,
    });
  };
  return (msg: UiMessage) => {
    switch (msg.type) {
      case 'ready':
        reply({ type: 'hello', tabs: [], activeId: null, ...(surface === 'left' ? loadSession() : { session: null }), sidebars });
        if (surface === 'left') reply(botInboxState());
        break;
      case 'createTab': {
        const id = nextId++;
        const background = !!msg.background && !msg.lazy; // 裏で開く：表示はしない（ページはこのまま）
        reply({ type: 'tabCreated', id, parentId: msg.parentId, requestId: msg.requestId, url: msg.url, asleep: !!msg.lazy, ...(background ? { background } : {}) });
        if (msg.lazy) {
          sleeping.add(id);
        } else if (background) {
          reply({ type: 'tabUpdated', id, patch: { url: msg.url } });
        } else {
          reply({ type: 'tabUpdated', id, patch: { url: msg.url, title: titleOf(msg.url) } });
          reply({ type: 'tabActivated', id });
          activeTab = id;
        }
        break;
      }
      case 'activateTab':
        activeTab = msg.id;
        if (sleeping.delete(msg.id)) reply({ type: 'tabUpdated', id: msg.id, patch: { asleep: false } });
        reply({ type: 'tabUpdated', id: msg.id, patch: { suspended: false } });
        reply({ type: 'tabActivated', id: msg.id });
        break;
      case 'closeTab':
        if (activeTab === msg.id) activeTab = 0;
        reply({ type: 'tabClosed', id: msg.id });
        break;
      case 'navigate':
        reply({ type: 'tabUpdated', id: msg.id, patch: { url: msg.url, title: titleOf(msg.url) } });
        break;
      case 'suspendTab':
        reply({ type: 'tabUpdated', id: msg.id, patch: { suspended: true } });
        break;
      case 'discardTab':
        sleeping.add(msg.id);
        reply({ type: 'tabUpdated', id: msg.id, patch: { asleep: true, suspended: false } });
        break;
      case 'setMuted':
        reply({ type: 'tabUpdated', id: msg.id, patch: { muted: msg.muted } });
        break;
      case 'setSidebar': {
        const prev = sidebars[msg.side];
        const height = msg.height ?? prev?.height;
        sidebars = {
          ...sidebars,
          [msg.side]: {
            visible: msg.visible ?? prev?.visible ?? false,
            width: msg.width ?? prev?.width ?? 0,
            ...(height !== undefined ? { height } : {}),
          },
        };
        reply({ type: 'sidebars', state: sidebars });
        break;
      }
      case 'saveSession':
        if (msg.data) reply({ type: 'sessionSaved', ok: saveMockSession(msg.data) });
        break;
      case 'getPageText':
        reply({
          type: 'pageText',
          requestId: msg.requestId,
          title: '練習用のページ',
          url: 'https://example.com/',
          text: 'これは練習用のページの本文です。習慣は意志の強さよりも、きっかけ・行動・報酬の仕組みで作られます。',
          truncated: false,
          length: 48,
          selection: localStorage.getItem('honeycomb.mockSelection') ?? '', // 練習用。キーが無ければ空（本物は C++ が選んだ文を返す）
        });
        break;
      case 'getApiKey':
        reply({ type: 'apiKey', key: localStorage.getItem('honeycomb.mockApiKey') });
        break;
      case 'getScroll':
        reply({ type: 'scroll', requestId: msg.requestId, y: 0, h: 800, vh: 800 });
        break;
      case 'evalInTab': {
        // 画像の位置を測るスクリプトだけ、__mockCaptureImage が置いた記録を返す（ほかは今までどおり noPage）
        if (typeof msg.script === 'string' && msg.script.includes('__honeycombImage')) {
          let value: unknown = { ok: false, reason: 'none' };
          try {
            const raw = localStorage.getItem('honeycomb.mockImageRecord');
            const rec = raw ? (JSON.parse(raw) as { rect?: unknown; reason?: unknown; src?: unknown }) : null;
            if (rec && typeof rec === 'object') {
              if (typeof rec.reason === 'string' && rec.reason) value = { ok: false, reason: rec.reason };
              else {
                const src = typeof rec.src === 'string' ? rec.src : '';
                value = { ok: true, rect: rec.rect, srcs: [src, src] };
              }
            }
          } catch {
            value = { ok: false, reason: 'none' };
          }
          reply({ type: 'evalResult', requestId: msg.requestId, ok: true, value });
          break;
        }
        // 偽物の動画（V1m）：台本の中の決まった文字列で見分け、上から順に最初に合ったものを返す（字幕・再生の様子・移る・再生と停止・速さ）
        const script = typeof msg.script === 'string' ? msg.script : '';
        if (script.includes('transcript-segment-view-model')) {
          reply({ type: 'evalResult', requestId: msg.requestId, ok: true, value: mockTranscript() });
          break;
        }
        if (script.includes('ad-showing')) {
          const value = { videoId: mockVideo.id, hasMedia: true, time: mockVideoTime(), paused: mockVideo.paused, duration: mockVideo.duration, ad: false };
          reply({ type: 'evalResult', requestId: msg.requestId, ok: true, value });
          break;
        }
        if (script.includes('seekTo(')) {
          // 移る：seekTo(秒, true) の秒と、その後の if (true|false)（再生もするか）を読む
          const to = /seekTo\(([\d.]+), true\)/.exec(script);
          const play = /if \((true|false)\)/.exec(script);
          mockVideoTime();
          const sec = to ? Number(to[1]) : NaN;
          if (Number.isFinite(sec)) mockVideo.time = Math.min(Math.max(sec, 0), mockVideo.duration);
          if (play?.[1] === 'true') mockVideo.paused = false;
          mockVideo.at = Date.now();
          reply({ type: 'evalResult', requestId: msg.requestId, ok: true, value: true });
          break;
        }
        if (script.includes('const play = v.paused')) {
          // 再生と停止：今の状態を反対にし、再生を始めたら true、止めたら false
          mockVideoTime();
          mockVideo.paused = !mockVideo.paused;
          mockVideo.at = Date.now();
          reply({ type: 'evalResult', requestId: msg.requestId, ok: true, value: !mockVideo.paused });
          break;
        }
        if (script.includes('const rate = ')) {
          // 速さ：const rate = 数; を読み、位置を確定してから速さを入れ替える。返事はその数
          const rate = /const rate = ([\d.]+);/.exec(script);
          const next = rate ? Number(rate[1]) : NaN;
          mockVideoTime();
          if (Number.isFinite(next) && next > 0) mockVideo.rate = next;
          reply({ type: 'evalResult', requestId: msg.requestId, ok: true, value: mockVideo.rate });
          break;
        }
        reply({ type: 'evalResult', requestId: msg.requestId, ok: false, error: 'noPage' });
        break;
      }
      case 'notify':
        console.info(`[通知] ${msg.title}: ${msg.body}`);
        if (msg.requestId !== undefined) reply({ type: 'notified', requestId: msg.requestId, ok: true });
        break;
      case 'setApiKey':
        localStorage.setItem('honeycomb.mockApiKey', msg.key);
        reply({ type: 'apiKey', key: msg.key });
        break;
      case 'deleteApiKey':
        localStorage.removeItem('honeycomb.mockApiKey');
        reply({ type: 'apiKey', key: null });
        break;
      // webhook（R11）の偽物：宛先と鍵の値は覚えない（localStorage にも出さない）。「ある」の印だけを honeycomb.mockHookHas に。
      //   送るのは 1 秒後に受けたことにする。honeycomb.mockHook が fail なら HTTP 503、timeout なら答えが無かったことにする
      case 'getBotHook':
        reply({ type: 'botHook', requestId: msg.requestId, has: localStorage.getItem('honeycomb.mockHookHas') === '1' });
        break;
      case 'setBotHook': {
        const has = localStorage.getItem('honeycomb.mockHookHas') === '1';
        const badUrl = !/^https:\/\/[^\s/@]+(\/\S*)?$/.test(msg.url) || msg.url.length > 2048;
        const badKey = !/^[!-~]{1,1024}$/.test(msg.key);
        if (badUrl || badKey) {
          reply({ type: 'botHook', requestId: msg.requestId, has, error: badUrl ? 'badUrl' : 'badKey' });
          break;
        }
        localStorage.setItem('honeycomb.mockHookHas', '1');
        console.info('[webhook] setBotHook：宛先と鍵をしまったふり（偽物は値を覚えません）');
        reply({ type: 'botHook', requestId: msg.requestId, has: true });
        break;
      }
      case 'deleteBotHook':
        localStorage.removeItem('honeycomb.mockHookHas');
        reply({ type: 'botHook', requestId: msg.requestId, has: false });
        break;
      case 'botHookSend': {
        const mode = localStorage.getItem('honeycomb.mockHook');
        const has = localStorage.getItem('honeycomb.mockHookHas') === '1';
        console.info(`[webhook] botHookSend：${msg.botRequestId}（${msg.body.length} 字・agent ${msg.agentId ? 'あり' : 'なし'}）${!has ? '：宛先と鍵が無いので送らない' : mode === 'fail' ? '：届かなかったことにします（偽物の fail）' : mode === 'timeout' ? '：答えが無かったことにします（偽物の timeout）' : 'を中継へ送ったふり'}`);
        const answer: HostMessage = !has
          ? { type: 'botHookSent', requestId: msg.requestId, botRequestId: msg.botRequestId, ok: false, status: 0, error: 'noHook' }
          : mode === 'fail'
            ? { type: 'botHookSent', requestId: msg.requestId, botRequestId: msg.botRequestId, ok: false, status: 503, error: 'http' }
            : mode === 'timeout'
              ? { type: 'botHookSent', requestId: msg.requestId, botRequestId: msg.botRequestId, ok: false, status: 0, error: 'timeout' }
              : { type: 'botHookSent', requestId: msg.requestId, botRequestId: msg.botRequestId, ok: true, status: 202 };
        setTimeout(() => emit(answer), 1000);
        break;
      }
      case 'writeData':
        localStorage.setItem(`honeycomb.mockData:${msg.name}`, msg.text);
        if (msg.requestId !== undefined) reply({ type: 'dataWritten', requestId: msg.requestId, ok: true });
        break;
      case 'readData': {
        const text = localStorage.getItem(`honeycomb.mockData:${msg.name}`);
        reply({ type: 'dataRead', requestId: msg.requestId, text, ...(text === null ? { missing: true } : {}) });
        break;
      }
      case 'listData': {
        const prefix = `honeycomb.mockData:${msg.dir}/`;
        const files = Object.keys(localStorage)
          .filter((k) => k.startsWith(prefix))
          .map((k) => ({ name: k.slice('honeycomb.mockData:'.length), size: localStorage.getItem(k)?.length ?? 0, modified: Date.now() }));
        reply({ type: 'dataList', requestId: msg.requestId, files });
        break;
      }
      case 'deleteData':
        localStorage.removeItem(`honeycomb.mockData:${msg.name}`);
        break;
      case 'hexMemoCatalog':
        reply({
          type: 'hexMemoCatalog',
          requestId: msg.requestId,
          available: true,
          canSignal: true,
          apps: [{ id: null, name: '六角メモ', status: 'stopped', boards: [{ id: 'main', name: 'ノート 1', parentId: null }] }],
        });
        break;
      case 'hexMemoSend': {
        // 書かない。送ったふりをコンソールに出す（R10：自動の写しを見るため。マスの数・タグ・字数・リンクの数・伏せた渡し止めのアドレスの数だけ）。
        //   localStorage の honeycomb.mockHexMemo が fail なら送れなかったことにする
        const fail = localStorage.getItem('honeycomb.mockHexMemo') === 'fail';
        console.info(
          fail
            ? '[六角メモ] hexMemoSend：送れなかったことにします（偽物の fail）'
            : `[六角メモ] hexMemoSend：「${msg.boardId}」へ ${msg.records.length} マスを送ったふり（${msg.records.map((r) => `タグ ${(r.tags ?? []).join('・')}・${[...r.text].length} 字・リンク ${r.urls?.length ?? 0}・伏せ ${(r.text.match(/（渡し止めのアドレス）/g) ?? []).length}`).join('／')}）`,
        );
        reply(
          fail
            ? { type: 'hexMemoSent', requestId: msg.requestId, ok: false, error: '偽物の fail' }
            : { type: 'hexMemoSent', requestId: msg.requestId, ok: true, id: '00000000-0000-0000-0000-000000000000', status: 'stopped', signaled: true },
        );
        break;
      }
      case 'hexMemoReadBoard':
        reply({ type: 'hexMemoBoard', requestId: msg.requestId, ok: true, memos: [], truncated: false });
        break;
      case 'clipboardRead':
        reply({ type: 'clipboard', requestId: msg.requestId, text: mockClipboard.text, html: mockClipboard.html });
        break;
      case 'clipboardHasImage':
        reply({ type: 'clipboardImage', requestId: msg.requestId, present: mockClipboardPicture() !== null });
        break;
      case 'clipboardReadImage': {
        // C++ と同じく、画像を JPEG の data URL で返す。fetch は使わない（CSP で data: が通らない）
        const image = mockClipboardPicture();
        reply(image ? { type: 'clipboardImage', requestId: msg.requestId, ok: true, image } : { type: 'clipboardImage', requestId: msg.requestId, ok: false, error: 'empty' });
        break;
      }
      case 'clipboardWrite':
        mockClipboard.text = msg.text;
        mockClipboard.html = msg.html;
        mockClipboard.image = false;
        mockClipboard.png = '';
        mockClipboard.noHistory = msg.noHistory === true;
        reply({ type: 'clipboardWritten', requestId: msg.requestId, ok: true });
        break;
      case 'clipboardWriteImage': {
        // 画像は png に覚える（目で見るため）。C++ と同じく、入れると文字は消える。'fail' のときは書けなかったことにする
        //   shotId（R7d）：偽物の botShotSave が覚えた写しを読む。text があれば、C++ と同じく文と HTML の断片（頭に画像の data: の <img>）も置く
        const png = typeof msg.png === 'string' ? msg.png : typeof msg.shotId === 'string' ? mockShotRead(msg.shotId) : '';
        const ok = localStorage.getItem('honeycomb.mockClipboardImage') !== 'fail' && /^[A-Za-z0-9+/]+=*$/.test(png);
        const withText = typeof msg.text === 'string';
        const html = withText ? `<img src="data:image/png;base64,${png}" alt=""><br>${msg.html ?? ''}` : '';
        if (ok) Object.assign(mockClipboard, { text: withText ? msg.text : '', html, image: true, noHistory: msg.noHistory === true, png });
        console.info(
          ok
            ? `[クリップボード] 画像${withText ? 'と文（画像入り 1 回）' : ''}を入れたふり（${Math.round((png.length * 3) / 4 / 1024)} KB・透明な所 ${msg.fill ?? 'white'}）`
            : '[クリップボード] 画像を入れられませんでした（偽物の fail・写しが無い）',
        );
        reply({ type: 'clipboardWritten', requestId: msg.requestId, ok });
        break;
      }
      case 'botShotSave': {
        // C++ と同じ形のパスの文字列を返す（shotId の形は C++ と同じく確かめる）。画像は localStorage に新しい 3 枚だけ覚える
        //   （R7d：左の画像入り 1 回貼りが shotId で読む。面ごとの偽物なので、面をまたいで渡すには localStorage を使う）
        const ok = /^[A-Za-z0-9-]{1,64}$/.test(msg.shotId);
        if (ok) mockShotKeep(msg.shotId, msg.png);
        reply(ok ? { type: 'botShotSaved', requestId: msg.requestId, ok, path: `C:\\Users\\you\\AppData\\Local\\RocksCellsBrowser\\bot-shots\\${msg.shotId}.png` } : { type: 'botShotSaved', requestId: msg.requestId, ok, error: 'badId' });
        break;
      }
      case 'botShotOpenFolder':
        console.info(`[bot-shots] フォルダを開いたふり${msg.shotId ? `（${msg.shotId}.png を選んで）` : ''}`);
        break;
      case 'capturePage':
      case 'exportImage': {
        // 保存はしない。名前の形だけ確かめて、渡した名前を返す（`..` やフォルダの外は断る）
        const ok = isMockExportName(msg.name);
        if (msg.type === 'capturePage') {
          reply(ok ? { type: 'pageCaptured', requestId: msg.requestId, ok: true, name: msg.name, width: 800, height: 600, truncated: false } : { type: 'pageCaptured', requestId: msg.requestId, ok: false, error: 'name' });
        } else {
          reply(ok && msg.data.length > 0 ? { type: 'imageExported', requestId: msg.requestId, ok: true, name: msg.name } : { type: 'imageExported', requestId: msg.requestId, ok: false, error: msg.data.length > 0 ? 'name' : 'data' });
        }
        break;
      }
      case 'openExported':
      case 'revealExported':
        console.info(isMockExportName(msg.name) ? `[ピクチャ] ${msg.type === 'openExported' ? '開いた' : 'フォルダで選んだ'}ふり（${msg.name}）` : `[ピクチャ] 名前が違うので開きません（${msg.name}）`);
        break;
      case 'readCaptureText': {
        // localStorage.setItem('honeycomb.mockOcr', 'unavailable') で、読み取りの無いビルドのふり（R7c）
        if (localStorage.getItem('honeycomb.mockOcr') === 'unavailable') {
          reply({ type: 'captureText', requestId: msg.requestId, ok: false, error: 'unavailable' });
          break;
        }
        if (msg.command === 'query') {
          reply({ type: 'captureText', requestId: msg.requestId, ok: true });
          break;
        }
        // localStorage.setItem('honeycomb.mockOcr', 'noJapanese') で、日本語の認識データが無いふり
        if (localStorage.getItem('honeycomb.mockOcr') === 'noJapanese') {
          reply({ type: 'captureText', requestId: msg.requestId, ok: false, error: 'noJapanese' });
          break;
        }
        // localStorage.setItem('honeycomb.mockOcr', 'busy') で、ほかで読んでいる最中のふり（R7c の「探し直す」）
        if (localStorage.getItem('honeycomb.mockOcr') === 'busy') {
          reply({ type: 'captureText', requestId: msg.requestId, ok: false, error: 'busy' });
          break;
        }
        const times = Array.isArray(msg.times) ? msg.times.filter((ms) => typeof ms === 'number') : [];
        const sample = [
          { text: '見出しの行', x: 0.08, y: 0.1, w: 0.5, h: 0.08 },
          { text: '名前', x: 0.08, y: 0.28, w: 0.18, h: 0.06 },
          { text: '値', x: 0.4, y: 0.28, w: 0.16, h: 0.06 },
          { text: '名前 | 値', x: 0.08, y: 0.28, w: 0.5, h: 0.06, table: true },
          { text: '担当：hoshi@example.com', x: 0.66, y: 0.05, w: 0.31, h: 0.06 }, // メールらしき行（R7c の隠す候補）
        ];
        // localStorage.setItem('honeycomb.mockOcr', 'secret') で、鍵らしき文字が写っているふり（C8 の警告）
        if (localStorage.getItem('honeycomb.mockOcr') === 'secret') {
          sample.push({ text: 'sk-ant-secret-sample', x: 0.08, y: 0.7, w: 0.6, h: 0.06 });
        }
        const lines =
          times.length > 0
            ? [
                ...sample.map((line) => ({ ...line, at: times[0] })),
                { text: '次の時刻の行', x: 0.08, y: 0.5, w: 0.4, h: 0.06, at: times[1] ?? times[0] + 4000 },
              ]
            : sample;
        reply({ type: 'captureText', requestId: msg.requestId, ok: true, lines });
        break;
      }
      case 'recordCenter': {
        if (msg.command === 'saved') break; // 返事は無い
        if (msg.command === 'query') reply({ type: 'record', requestId: msg.requestId, ok: true });
        else if (msg.command === 'start') {
          if (recordId) reply({ type: 'record', requestId: msg.requestId, ok: false, error: 'busy' });
          else if (!/^c[0-9a-z]{6,32}$/.test(msg.id)) reply({ type: 'record', requestId: msg.requestId, ok: false, error: 'badId' });
          else {
            recordId = msg.id;
            recordSeconds = 0;
            reply({ type: 'record', requestId: msg.requestId, ok: true });
            emit({ type: 'recordProgress', seconds: 0, limit: 120 });
            recordTimer = window.setInterval(() => {
              recordSeconds += 1;
              emit({ type: 'recordProgress', seconds: recordSeconds, limit: 120 });
              if (recordSeconds >= 120) finishMockRecord();
            }, 1000);
          }
        } else if (msg.command === 'stop') {
          if (!recordId) reply({ type: 'record', requestId: msg.requestId, ok: false, error: 'empty' });
          else {
            reply({ type: 'record', requestId: msg.requestId, ok: true });
            finishMockRecord();
          }
        } else if (msg.command === 'open') {
          const ok = /^c[0-9a-z]{6,32}$/.test(msg.id);
          if (ok) console.info(`[録画] ${msg.id}.mp4 を開いたふり`);
          reply({ type: 'record', requestId: msg.requestId, ok, ...(ok ? {} : { error: 'badId' }) });
        } else reply({ type: 'record', requestId: msg.requestId, ok: true });
        break;
      }
      case 'captureScreen': {
        // 窓かデスクトップのふり。中身は練習用の絵（範囲は、この窓の絵を読んで画面で切り取る）
        const canvas = document.createElement('canvas');
        canvas.width = 960;
        canvas.height = 540;
        const ctx = canvas.getContext('2d');
        if (ctx && msg.scope === 'desktop') {
          const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
          sky.addColorStop(0, '#6ea0d8');
          sky.addColorStop(1, '#f2c27b');
          ctx.fillStyle = sky;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#f7f1e6';
          ctx.fillRect(180, 70, 520, 340);
          ctx.fillStyle = '#222';
          ctx.fillRect(0, canvas.height - 48, canvas.width, 48);
          ctx.fillStyle = '#1d2433';
          ctx.font = '28px sans-serif';
          ctx.fillText('デスクトップ（練習）', 200, 120);
        } else if (ctx) {
          ctx.fillStyle = '#2a2622';
          ctx.fillRect(0, 0, 140, canvas.height);
          ctx.fillStyle = '#3a342c';
          ctx.fillRect(canvas.width - 180, 0, 180, canvas.height);
          ctx.fillStyle = '#f4f0e6';
          ctx.fillRect(140, 0, canvas.width - 320, canvas.height - 70);
          ctx.fillStyle = '#1c1915';
          ctx.fillRect(140, canvas.height - 70, canvas.width - 320, 70);
          ctx.fillStyle = '#1d2433';
          ctx.font = '28px sans-serif';
          ctx.fillText('ブラウザの窓（練習）', 180, 80);
        }
        reply({ type: 'capture', requestId: msg.requestId, ok: !!ctx, image: canvas.toDataURL('image/png'), via: 'mock' });
        break;
      }
      case 'captureFull': {
        // rect があるとき（依頼① I1）：maxEdge が無い・0 なら断る。見えている範囲（頼んだ面の窓）との交わりが 8 CSS ピクセル未満でも断る
        let crop: { x: number; y: number; width: number; height: number } | null = null;
        let cropped = false;
        if (msg.rect) {
          if (!(typeof msg.maxEdge === 'number' && msg.maxEdge > 0)) {
            reply({ type: 'capture', requestId: msg.requestId, ok: false, error: 'rect' });
            break;
          }
          const x0 = Math.max(msg.rect.x, 0);
          const y0 = Math.max(msg.rect.y, 0);
          const x1 = Math.min(msg.rect.x + msg.rect.width, window.innerWidth);
          const y1 = Math.min(msg.rect.y + msg.rect.height, window.innerHeight);
          if (!(x1 - x0 >= 8) || !(y1 - y0 >= 8)) {
            reply({ type: 'capture', requestId: msg.requestId, ok: false, error: 'rect' });
            break;
          }
          crop = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
          cropped = msg.rect.width - crop.width >= 0.5 || msg.rect.height - crop.height >= 0.5;
        }
        // ページは撮れないので、見本の絵（空の色の地に丸と文字）を描いて返す（六角形スクショ・依頼の小窓の後ろの確かめ用）
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(320, Math.round(window.innerWidth * (window.devicePixelRatio || 1)));
        canvas.height = Math.max(240, Math.round(window.innerHeight * (window.devicePixelRatio || 1)));
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
          sky.addColorStop(0, '#2b5c9e');
          sky.addColorStop(1, '#f2c27b');
          ctx.fillStyle = sky;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#fff6d8';
          ctx.beginPath();
          ctx.arc(canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) / 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#1d2433';
          ctx.font = `${Math.round(canvas.height / 14)}px sans-serif`;
          ctx.fillText('練習用のページ（偽物の captureFull）', 24, canvas.height / 8);
        }
        if (crop) {
          // 交わりの部分（× devicePixelRatio）だけを新しい canvas に写す（scale は 1、reduced は無し）
          const dpr = window.devicePixelRatio || 1;
          const out = document.createElement('canvas');
          out.width = Math.max(1, Math.round(crop.width * dpr));
          out.height = Math.max(1, Math.round(crop.height * dpr));
          const outCtx = out.getContext('2d');
          if (ctx && outCtx) outCtx.drawImage(canvas, crop.x * dpr, crop.y * dpr, crop.width * dpr, crop.height * dpr, 0, 0, out.width, out.height);
          reply({ type: 'capture', requestId: msg.requestId, ok: !!(ctx && outCtx), image: out.toDataURL('image/png'), rect: crop, cropped, scale: 1, reduced: false });
          break;
        }
        reply({ type: 'capture', requestId: msg.requestId, ok: !!ctx, image: canvas.toDataURL('image/png') });
        break;
      }
      case 'captureSurface':
        // ふつうのブラウザでは撮れない（データ置き場には文字だけが入る）
        reply({ type: 'surfaceCaptured', requestId: msg.requestId, ok: false, error: 'mock' });
        break;
      case 'vaultUsage': {
        const keys = Object.keys(localStorage).filter((k) => k.startsWith('honeycomb.mockData:vault/'));
        const bytes = keys.reduce((sum, k) => sum + new TextEncoder().encode(localStorage.getItem(k) ?? '').length, 0);
        reply({ type: 'vaultUsage', requestId: msg.requestId, bytes, files: keys.length });
        break;
      }
      case 'deleteVaultImage':
      case 'openVaultFolder':
        break;
      case 'hexMemoCheck':
        reply({ type: 'hexMemoState', requestId: msg.requestId, state: 'done', result: { ok: true, placed: [{}], boardPath: ['ノート 1'] } });
        break;
      case 'openJsonFile': {
        // 練習用の画面ではファイルを選ぶ窓が無い。localStorage の honeycomb.mockJsonFile の文を開いたことにする（無ければ、やめた）
        const text = localStorage.getItem('honeycomb.mockJsonFile');
        reply(text ? { type: 'jsonFile', requestId: msg.requestId, ok: true, name: 'mock-patch.json', text } : { type: 'jsonFile', requestId: msg.requestId, ok: false, error: 'cancel' });
        break;
      }
      case 'openImageFile': {
        // 練習用の画面ではファイルを選ぶ窓が無い。localStorage の honeycomb.mockImageFile が cancel ならやめたことにする
        if (localStorage.getItem('honeycomb.mockImageFile') === 'cancel') {
          reply({ type: 'imageFile', requestId: msg.requestId, path: null });
          break;
        }
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 40;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#2a6f97';
          ctx.fillRect(0, 0, 64, 40);
          ctx.fillStyle = '#f4e7c5';
          ctx.fillRect(12, 8, 28, 24);
        }
        reply({
          type: 'imageFile',
          requestId: msg.requestId,
          path: 'C:\\Users\\you\\Pictures\\sample.png',
          ok: !!ctx,
          ...(ctx ? { image: canvas.toDataURL('image/jpeg', 0.85) } : { error: 'decode' as const }),
        });
        break;
      }
      case 'saveClipboardImage':
        reply(msg.data.startsWith('data:image/jpeg') ? { type: 'imageSaved', requestId: msg.requestId, ok: true, path: 'C:\\Users\\you\\Pictures\\Rocks-cells Browser\\clip.jpg' } : { type: 'imageSaved', requestId: msg.requestId, ok: false, error: 'data' });
        break;
      case 'pickApp': {
        // 練習用の画面ではファイルを選ぶ窓が無いので、メモ帳を選んだふりをする（アイコンは小さな絵）
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#1f6f6a';
          ctx.beginPath();
          ctx.arc(16, 16, 14, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 16px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('A', 16, 17);
        }
        console.info('[アプリのセル] ファイルを選んだふり（練習用のアプリ）');
        reply({
          type: 'appPicked',
          requestId: msg.requestId,
          ok: true,
          name: '練習用のアプリ',
          launch: 'C:\\Windows\\notepad.exe',
          target: 'C:\\Windows\\notepad.exe',
          args: '',
          cwd: '',
          shortcut: '',
          aumid: '',
          icon: canvas.toDataURL('image/png'),
        });
        break;
      }
      case 'summonApp': {
        // 練習用の画面では窓を動かさない（合わせたふり）。見え方を変えるには開発者ツールで
        //   localStorage.setItem('honeycomb.mockSummon', 'fixed' | 'overlap' | 'wait' | 'store' | 'denied' | 'notFound' | 'fail' | 'missing')
        //   戻すには removeItem
        const mode = localStorage.getItem('honeycomb.mockSummon');
        const file = msg.target.split(/[/\\]/).pop()?.toLowerCase() ?? '';
        const frame = !msg.target || file === 'applicationframehost.exe';
        const appId = (msg.aumid ?? '').trim();
        // 練習用：メモ帳は、起動用と窓の exe が違うふり（台帳が host を覚える）
        const windowHost =
          msg.host ||
          (file === 'notepad.exe'
            ? 'C:\\Program Files\\WindowsApps\\Microsoft.WindowsNotepad_11.0.0.0_x64__8wekyb3d8bbwe\\Notepad\\Notepad.exe'
            : msg.target);
        if (msg.release) {
          console.info(`[アプリのセル] 最前面をやめたふり（${msg.launch}）`);
          reply({ type: 'appSummoned', requestId: msg.requestId, ok: true, action: 'released' });
          break;
        }
        if (mode === 'fail') {
          console.info(`[アプリのセル] 中央に出せませんでした（failed）`);
          reply({ type: 'appSummoned', requestId: msg.requestId, ok: false, error: 'failed' });
        } else if (mode === 'missing') {
          console.info(`[アプリのセル] ファイルがありません（badPath）`);
          reply({ type: 'appSummoned', requestId: msg.requestId, ok: false, error: 'badPath' });
        } else if (mode === 'denied') {
          console.info(`[アプリのセル] 管理者なので動かせません（denied）`);
          reply({ type: 'appSummoned', requestId: msg.requestId, ok: false, error: 'denied' });
        } else if (mode === 'notFound') {
          console.info(`[アプリのセル] 窓を特定できません（notFound）`);
          reply({ type: 'appSummoned', requestId: msg.requestId, ok: false, error: 'notFound' });
        } else if (mode === 'wait') {
          console.info(`[アプリのセル] 起動したが窓は見つからないふり（${msg.launch}）`);
          reply({ type: 'appSummoned', requestId: msg.requestId, ok: true, action: 'waiting' });
        } else if (frame) {
          // アプリ ID があるストアアプリは、大きさを変えずに中央へ寄せたふり（電卓）。ID が無いときは特定できない
          if (mode === 'store' || !appId) {
            console.info(`[アプリのセル] ストアアプリの窓を特定できないふり（${msg.launch}）`);
            reply({ type: 'appSummoned', requestId: msg.requestId, ok: true, action: mode === 'store' ? 'store' : 'waiting', ...(appId ? { aumid: appId } : {}) });
          } else {
            console.info(`[アプリのセル] ストアアプリを中央に寄せたふり（${appId}）`);
            reply({
              type: 'appSummoned',
              requestId: msg.requestId,
              ok: true,
              action: 'fixed',
              overlap: mode === 'overlap',
              aumid: appId,
            });
          }
        } else if (mode === 'fixed' || mode === 'overlap') {
          console.info(`[アプリのセル] 大きさを変えず中央に寄せたふり（${msg.launch}）`);
          reply({ type: 'appSummoned', requestId: msg.requestId, ok: true, action: 'fixed', overlap: mode === 'overlap', host: windowHost });
        } else {
          console.info(`[アプリのセル] 中央に出したふり（${msg.launch}）`);
          reply({ type: 'appSummoned', requestId: msg.requestId, ok: true, action: 'placed', host: windowHost });
        }
        break;
      }
      case 'openBotApp': {
        // アプリは開かない（開いたふり）。URL も組み立てない（C++ と同じく id の形だけを確かめる）。
        //   アプリが無いとき・開けなかったときの見え方を試すには、開発者ツールで
        //   localStorage.setItem('honeycomb.mockBotApp', 'missing')（noApp）か 'fail'（failed）。元に戻すには removeItem
        const mode = localStorage.getItem('honeycomb.mockBotApp');
        const error: BotAppError | undefined = !/^[A-Za-z0-9_-]{1,128}$/.test(msg.agentId) ? 'badId' : mode === 'missing' ? 'noApp' : mode === 'fail' ? 'failed' : undefined;
        console.info(error ? `[Grok Bot] 開けませんでした（${error}）` : `[Grok Bot] アプリを開いたふり（エージェント ${msg.agentId}）`);
        if (msg.requestId !== undefined) reply({ type: 'botAppOpened', requestId: msg.requestId, ok: !error, ...(error ? { error } : {}) });
        break;
      }
      case 'botReplyTaken':
        // C++ は done\・rejected\ へ移す。偽物は渡した一覧から消して、コンソールに出すだけ
        if (!botHanded.delete(msg.fileId)) console.warn(`[ボットの受け取り口] 渡していない fileId です（C++ なら動かさない）：${msg.fileId}`);
        else console.info(`[ボットの受け取り口] ${msg.fileId} → ${msg.result}${msg.reason ? `（${msg.reason}）` : ''}`);
        break;
      case 'botCheck':
        // peek（R8）：見回らずに様子だけ。そうでなければ、今見回ったふりをして時刻を新しくする
        if (!msg.peek) botScanAt = new Date().toISOString();
        if (msg.requestId !== undefined) reply(botInboxState(msg.requestId));
        break;
      case 'botInboxWatch':
        botWatching = msg.on;
        break;
      case 'popout':
        if (!mockPopouts.some((p) => p.id === msg.id)) {
          if (mockPopouts.length >= 4) {
            reply({ type: 'popout', id: mockPopouts[0]?.id ?? null, list: mockPopouts.slice(), error: 'full' });
            break;
          }
          const used = new Set(mockPopouts.map((p) => p.slot));
          let slot = 0;
          while (used.has(slot)) slot++;
          mockPopouts.push({ id: msg.id, slot, top: msg.places?.[slot]?.top ?? true });
        }
        reply({ type: 'popout', id: mockPopouts[0]?.id ?? null, list: mockPopouts.slice() });
        break;
      case 'dockPopout':
        mockPopouts = msg.id === undefined ? [] : mockPopouts.filter((p) => p.id !== msg.id);
        reply({ type: 'popout', id: mockPopouts[0]?.id ?? null, list: mockPopouts.slice() });
        break;
      case 'popoutTop':
        mockPopouts = mockPopouts.map((p) => (p.id === msg.id ? { ...p, top: msg.top } : p));
        reply({ type: 'popout', id: mockPopouts[0]?.id ?? null, list: mockPopouts.slice() });
        break;
      case 'openDownload':
      case 'revealDownload':
      case 'forgetDownload':
        reply({ type: 'downloadResult', id: msg.id, ok: false, error: 'mock' });
        break;
      case 'relay':
        mockRelay?.postMessage({ from: surface, to: msg.to, payload: msg.payload });
        break;
      case 'setTheme': // 偽物には窓の枠が無い（受けて何もしない）
        break;
      default:
        break;
    }
  };
}
