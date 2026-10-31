import type { TagButtonBook, TagButtonsOp } from './tagbuttons';
import type { BoardLink } from './board-links';
// いくつかのファイルで共通して使う型
import type { BotLastChoice, BotLastRequest } from './bot-last-request';
import type { BotPreset, BotPresetEntry, BotPresetReview, BotPresets, BotPresetSet } from './bot-presets';
import type { BotRole, BotRoleGroup } from './bot-roles';
import type { BotTeams } from './bot-teams';
import type { BotAnswerLines, BotAwayView, BotBrief, BotBriefState, BotGroupReply, BotInboxStatus, BotNest, BotRecentReply, BotRequestList, BotThreadView } from './bots';
import type { BotPasteAsk } from './bot-send';
import type { Hex } from './hex';
import type { LikeLevel } from './likes';
import type { CaptureBlur, CaptureFromKind, CaptureMark, CaptureStroke, HideRect } from './captures';
import type { HideMode } from './capture-hide';
import type { ReplyLink } from './memo-card-links';
import type { CardTemplate } from './memo-card-templates';
import type { MemoIndexItem, RightMemo } from './memocells';
import type { RouteJournal, RoutesState, TabTrail } from './routes';
import type { SearchItem, SearchSort } from './search';
import type { Sheet } from './sheets';
import type { Tab, TabLook } from './tabs';
import type { PendingReply, Reply, ReplyAuthor, ReplyQuote, ThreadRef } from './threads';
import type { CardDraft, CardLink, CardPatch, Grade, VocabLink, VocabState } from './vocab';
import type { VaultDraft } from './vault';
import type { Vision } from './visions';

// UI の面：left / right はサイドバー、reader はページの上に重ねる「六角で読む」画面、memo はページの下のメモの区画
export type Side = 'left' | 'right' | 'reader' | 'memo';

export interface SidebarState {
  left: { visible: boolean; width: number; height?: number };
  right: { visible: boolean; width: number; height?: number };
  reader?: { visible: boolean; width: number; height?: number };
  memo?: { visible: boolean; width: number; height?: number; place?: 'upper' };
}

// 左から下のメモの区画へ送る、開いているメモの写し（閉じているときは null）
export interface MemoPaneView {
  id: string;
  sheet: string;
  sheetName?: string; // メイン以外のとき
  text: string;
  tags: string[];
  liked: number;
  image?: string; // メモの画像（shots の ID）
  source?: { url: string; title: string };
  by?: ReplyAuthor;
  label?: string;
  replies: Reply[];
  linkNames?: Partial<Record<import('./memo-card-links').LinkKind, string>>; // 試し：このメモだけの関連の種類の名前
  linkSet?: string; // 試し：このメモが使う呼称セットの id（無ければ、このメモの名前）
  createdAt: number;
  updatedAt: number;
  page: { tabId: number | null; url: string; title: string }; // 今の上のページ
  focusReply?: { id: string; n: number }; // 右の検索から：このカードへ移る（n が変わったときだけ移る）
}

// 拡大表示の置き場所
//   dock: 左サイドバーの下に固定 / float: 自由に配置 / popup: マウスを乗せたセルの近く
//   right: 右サイドバー / off: 表示しない
export type PreviewPlacement = 'dock' | 'float' | 'popup' | 'right' | 'off';

// 保存しておくタブの情報（session.json の中身）
export interface SavedTab {
  id: number;
  uid?: string; // 起動し直しても変わらない名前（盤面の関連の線）
  url: string;
  title: string;
  favicon: string;
  pos: Hex;
  order: number;
  keepAwake?: boolean;
  notes?: TabNote[];
  readEdges?: number;
  liked?: number;
  tags?: string[];
  island?: string;
  trail?: TabTrail;
  sheet?: string; // 置いてあるシート（無ければメイン）
  image?: string; // セルに見せる画像の ID
  comment?: string; // セルに見せるひとこと
  look?: TabLook; // このタブだけの見え方
}

// 島：盤面でタブをまとめた集まり（名前と色の枠で囲む）。どのタブが入っているかは、タブの island に持つ
export interface Island {
  id: string;
  name: string;
  color: string;
}

// 島の案（AI の提案・作る前のもの）
export interface IslandDraft {
  name: string;
  color: string;
  tabIds: number[];
  reason?: string;
}

// 相棒が自分から話すきっかけ（左サイドバーで起き、右サイドバーの相棒に届く）
export type CompanionEvent =
  | { type: 'read'; tabId: number; title: string; url: string }
  | { type: 'liked'; tabId: number; title: string; url: string; level: number }
  | { type: 'note'; tabId: number; title: string; url: string; text: string };

// タブに付けるメモ（AI の返事を残したもの・自分で書いたもの）
export interface TabNote {
  id: string;
  text: string;
  createdAt: number;
  source: 'ai' | 'user';
  label?: string; // 要約・解説など
  replies?: Reply[]; // コメントのスレッド（このメモへの返信。何段でもつながる）
}

// リマインダー（AI の相棒が置く。時間になったら Windows の通知と吹き出しで知らせる）
export type ReminderBy = 'user' | 'companion'; // 誰が置いたか（K2）

export interface Reminder {
  id: string;
  text: string;
  dueAt: number; // 知らせる時刻（ミリ秒）
  createdAt: number;
  tabId?: number | null; // 関係するタブ（古い形。K2 からは link を使い、古い版のために相棒の道具では両方を書く）
  title?: string; // 指す先の題名（表示用）
  by?: ReminderBy; // 無いものは相棒（K2 より前に置けたのは相棒だけ。読むときは reminderBy）
  link?: VocabLink; // 指す先（タブかメモのセル。K2。読むときは reminderLink で古い tabId も読み替える）
  repeat?: ReminderRepeat; // 繰り返し（K3。鳴ったら左が同じ id で次の時刻に置き直す。読むときは reminderRepeat）
  snoozedFrom?: string; // 鳴ったものを延ばした写しの元の id（K3。左が鳴ったものの記録を「延ばした」にして、台帳には残さない）
  trigger?: ReminderTrigger; // 引き金（K4。時刻では鳴らさない。dueAt は作った時刻＋400 日〈古い版でも 400 日は鳴らない〉。読むときは reminderTrigger）
  card?: string; // 単語カードの id（K4。カードから「復習を思い出す」で置いたもの。鳴ったら「単語帳で開く」）
}

export type ReminderRepeat = 'daily' | 'weekdays' | 'weekly' | 'monthly';

// 引き金（K4）：このサイト（ホスト。www は外す）を次に開いたとき／次に起動したとき
export type ReminderTrigger = { kind: 'site'; host: string } | { kind: 'startup' };

// 鳴ったものの記録（K3。ui-data\reminders-fired.json。左が書く。新しい順に 50 件）
//   fired：鳴った／done：済み／snoozed：延ばした／cancelled：鳴る前に取り消した
export type FiredState = 'fired' | 'done' | 'snoozed' | 'cancelled';
export interface FiredReminder {
  id: string;
  text: string;
  dueAt: number; // 知らせる時刻だったもの
  firedAt: number; // 鳴った（取り消した・済ませた）時刻
  state: FiredState;
  link?: VocabLink;
  by?: ReminderBy;
  title?: string;
  repeat?: ReminderRepeat;
  trigger?: ReminderTrigger; // K4
  card?: string; // K4
}

// ---------- 六角メモ ----------

export interface HexMemoBoard {
  id: string;
  name: string;
  parentId: string | null;
}

export interface HexMemoApp {
  id: string | null; // null は大もとの六角メモ
  name: string;
  status: 'stopped' | 'ready' | 'old';
  boards: HexMemoBoard[];
}

export interface HexMemoCatalog {
  available: boolean;
  canSignal?: boolean;
  apps: HexMemoApp[];
  tags?: { name: string; color?: string }[]; // 六角メモに登録してあるタグ
}

// 六角メモへ送るメモ1件（六角メモの memos.json のマスと同じ形の一部）
export interface HexMemoRecord {
  text: string;
  createdAt: string;
  tags?: string[];
  urls?: { url: string; title?: string }[];
  due?: string; // 期限（YYYY-MM-DD）
  progress?: number; // 六角形の進み具合（1〜6）
  likedLevel?: number; // いいねの段階（0〜3）
  updatedAt?: string;
  liked?: boolean;
  bookmarked?: boolean;
  comments?: unknown[];
}

// ノートの中のメモ1件（読むだけ。記憶のノート用）
export interface HexMemoBoardMemo {
  id?: string;
  text: string;
  createdAt: string;
  tags: string[];
}

export interface HexMemoSendResult {
  ok: boolean;
  id?: string;
  status?: string;
  signaled?: boolean;
  error?: string;
}

export interface HexMemoState {
  state: 'done' | 'taking' | 'waiting' | 'gone';
  result?: { ok: boolean; error?: string; placed?: unknown[]; boardPath?: string[] };
  reason?: string;
}

// 自動休眠までの時間
export interface SleepSettings {
  suspendMinutes: number; // 使わなくなってから一時停止するまで
  discardMinutes: number; // 使わなくなってから休眠するまで
}

export interface SessionData {
  version: 1;
  activeId: number | null;
  tabs: SavedTab[];
  islands?: Island[];
  sheets?: Sheet[]; // シートの台帳（メインも含む）
  sheet?: string; // 見ていたシート
  boardLinks?: BoardLink[]; // 盤面の関連の線
}

// 右サイドバーから左サイドバーへの頼みごと（台帳や設定は左が持っているので）
export type RelayCommand =
  | { command: 'setKeepAwake'; id: number; keepAwake: boolean }
  | { command: 'setSleep'; settings: SleepSettings }
  | { command: 'addNote'; tabId: number; note: TabNote }
  | { command: 'removeNote'; tabId: number; noteId: string }
  | { command: 'setLiked'; id: number; liked: number }
  | { command: 'addUserNote'; tabId: number; text: string }
  | { command: 'openUrl'; url: string; background: boolean }
  | { command: 'addReminder'; reminder: Reminder }
  | { command: 'cancelReminder'; id: string }
  // 済み（K3）。fired：鳴ったものの記録を済みにする（台帳は触らない）。無ければ、まだ鳴っていないものを済ませる（繰り返しは次の回へ進める）
  | { command: 'doneReminder'; id: string; fired?: boolean }
  | { command: 'setTags'; id: number; tags: string[] }
  | { command: 'addTags'; changes: { id: number; tags: string[] }[] }
  | { command: 'createIslands'; islands: IslandDraft[] } // 島を作って、入るタブを寄せる
  | { command: 'removeIsland'; id: string } // 島をなくす（タブはそのまま）
  | { command: 'openIslandAsk'; islandId: string } // この島を頼む：入れるメモを右に見せる（アプリは開かない）
  | { command: 'fillIslandAsk'; islandId: string; memoIds: string[] } // 選んだメモの文を、依頼の小窓へ入れる
  | { command: 'leaveIsland'; id: number } // タブを島から出す
  | { command: 'previewIslands'; islands: IslandDraft[] | null } // 島の案を盤面に点線で見せる
  | { command: 'grokPatchText'; text: string; name: string } // 下の区画に落とした Grok の提案ファイル（JSON）の文。左で一覧を出す
  | { command: 'highlightTag'; tag: string | null } // このタグのタブだけを目立たせる
  | { command: 'highlightLike'; level: LikeLevel | null } // このいいねのタブとメモだけを目立たせる（タグの強調とは同時に付かない）
  // タグを足す・外す（右のカードのタグのボタン・右の「メモ」の区画のコメント。左の、その時のタグに対して）
  | { command: 'changeTags'; tab?: number; memo?: string; add: string[]; remove: string[] }
  | { command: 'showMemo'; id: string } // このメモのセルを左で見せる（そのシートへ移って、拡大表示に出す）
  // 集めた情報を、眠ったタブとして島に並べる（同じ名前の島があれば、そこに足す）
  | { command: 'openAsIsland'; name: string; items: { url: string; title: string; liked: number }[] }
  // 六角で読む
  | { command: 'openReader'; id: number } // このタブを六角で読む
  | { command: 'readerProgress'; id: number; edges: number; finished: boolean } // 読む画面での読み進み
  | { command: 'askCompanion'; text: string; title: string; url: string } // 相棒に聞く（右サイドバーを開いて渡す）
  // 順路
  | { command: 'setRouteRecording'; recording: boolean }
  | { command: 'showRoute'; id: string | null } // 盤面にこの順路を出す（null は表示中のタブの順路）
  | { command: 'updateRoute'; id: string; name?: string; color?: string; saved?: boolean }
  | { command: 'removeRoute'; id: string }
  | { command: 'setRouteJournal'; id: string; journal: RouteJournal | null }
  | { command: 'openRouteStep'; id: string; step: string; reuse: boolean } // 段を開く（reuse：順路にいる表示中のタブで開く）
  | { command: 'layoutRoute'; id: string } // 眠ったタブとして、順路の形のまま盤面の島に並べる
  // 単語帳
  | { command: 'addCards'; cards: CardDraft[] }
  | ({ command: 'updateCard'; id: string } & CardPatch) // 表・裏は両方来たときだけ直す。rotate はめぐる表示の印（K1）。note・due・level・reviews・lapses（K5b）
  | { command: 'removeCard'; id: string }
  | { command: 'gradeCard'; id: string; grade: Grade }
  | { command: 'markCardsSent'; ids: string[] }
  | { command: 'setVocabNotify'; notify: boolean }
  | { command: 'linkCard'; id: string; link: VocabLink | null; links?: CardLink[] } // 単語カードに、盤面のタブかメモのセルを1つ登録する（null で外す）。links があれば並び全体を入れかえる（K6）
  | { command: 'openVocabCell'; link: VocabLink } // そのセルのあるシートへ移り、セルを目立たせる（メモなら下の区画も開く）
  // 六角形スクショ（読む画面で撮り終えた・やめた）。grok：Grok-Bot 1体に画像とコメントを送る（S3.12。左が読む画面に依頼の小窓を開いてもらう）
  | { command: 'shotDone'; image: string; comment: string; to: 'cell' | 'companion' | 'both' | 'grok' }
  | { command: 'shotCancel' }
  // 撮影を読む画面に出す（C3）。画像とスタンプは右が持ち、左は読む画面を開いて渡すだけ
  //   askedAt：AI に最後に送った時刻　video：録画の mp4 がある　undo：「隠すのを取り消す」で戻せるものがある（どれも省いてよい）
  | { command: 'openCapture'; id: string; image: string; marks: CaptureMark[]; strokes: CaptureStroke[]; blur: CaptureBlur[]; title: string; askedAt?: number; video?: boolean; undo?: boolean }
  | { command: 'captureCardImage'; id: string; replyId: string } // 下の区画のカードの画像を、右の撮影に送る（I4）。左がカードを確かめてから右へ
  | { command: 'captureMarks'; id: string; marks: CaptureMark[] } // 読む画面で置いたスタンプ。台帳へ書くのは右
  | { command: 'captureStrokes'; id: string; strokes: CaptureStroke[] } // 矢印・四角・蛍光ペン・文字。台帳へ書くのは右。画像は変えない
  | { command: 'captureHide'; id: string; rects: HideRect[]; mode: HideMode; seq: number } // 隠す。画像は送らない（右がファイルの画像に塗る）。seq は返事の照合用
  | { command: 'captureUnhide'; id: string; seq: number } // 最後に隠した 1 か所を戻す
  | { command: 'captureClose' } // 撮った画像の面を閉じる
  | { command: 'openCrop'; image: string } // 窓を撮ったあと、読む画面で範囲を囲んでもらう（C5）。カードにはまだしない
  | { command: 'cropDone'; image: string } // 囲んだ中だけの JPEG。台帳へ書くのは右
  | { command: 'cropCancel' }
  // コメントのスレッド（右サイドバーのカードの、タブのメモへの返信）
  | { command: 'addReply'; ref: ThreadRef; parent: string | null; text: string; by?: ReplyAuthor } // by：相棒のキャラが書いた返信（考察を残す道具）
  | { command: 'addMemoCell'; text: string; by?: ReplyAuthor; label?: string } // 盤面にメモのセルを置く（相棒の考察を残す道具・フェイブルレター）
  | { command: 'addRightMemo'; text: string; pos?: Hex; sheet?: string } // 右の「メモ」の区画で書いたコメント：見ているシート（sheet）に、新しいメモのセルとして置く（pos：空いたセルをダブルクリックした場所）
  | { command: 'moveRightMemo'; id: string; pos: Hex; sheet?: string } // 右の「メモ」の区画でセルを動かした（左の盤面と同じ決まりで落とす）
  | { command: 'addRightSheet'; id: string; name: string } // 右の「メモ」の区画の ＋：新しいシートを作る（id は右が決める）
  | { command: 'showRightSheet'; id: string } // 右の「メモ」の区画で見るシートが変わった（そのシートの写しを送ってもらう）
  | { command: 'dropEmptySheet'; id: string } // 右で作ったシートが、何も書かずにタブから外れた（空なら片づける）
  | { command: 'removeMemo'; id: string } // メモのセルを消す（右の「メモ」の区画から）
  | { command: 'copyMemoCell'; text: string; by?: ReplyAuthor; label?: string } // メモのセル1つとしてコピーする（フェイブルレター）
  | { command: 'removeReply'; ref: ThreadRef; replyId: string; undoToken?: string } // undoToken（B3-3a。省略できる）：u で始まる 64 字以内の [A-Za-z0-9_-]。付けると、左は消す直前の返信全体をメモリに控え、restoreReplies で戻せる。形が悪ければ何も消さずに断る。省略すると今までどおり
  | { command: 'restoreReplies'; id: string; token: string } // 削除の取り消し（B3-3a。id はメモ）。removeReply に付けた undoToken で、消す直前の返信全体へ戻す。そのあとメモが変わっていれば（指紋が合わなければ）何もしない
  | { command: 'copyComment'; ref: ThreadRef; replyId: string | null } // null は元のポスト
  | { command: 'aiReply'; ref: ThreadRef; parent: string | null; who: string } // who は相棒のキャラ（all はメンバーみんな）
  // タブの見た目（右サイドバーのカードの「見た目」：左の盤面で、画像とコメントの欄を開く）
  | { command: 'editTabFace'; id: number }
  // 右下の Grok Bot（ボットの台帳を書くのは左だけなので、右は頼むだけ。左が確かめてから台帳を変え、写しを送り直す）
  | { command: 'dockBot'; botId: string } // 台帳のボットを右下の並びの最後に置く（6体まで）
  | { command: 'undockBot'; botId: string } // 右下から外す（台帳には残る）
  | { command: 'moveDockBot'; botId: string; to: number } // 右下の並びを変える（to：0 から数えた場所）
  | { command: 'newDockBot'; name: string; agentId: string } // 新しいボットを台帳に入れて右下に置く（同じ id のボットがいれば、そのボットを置く）
  | { command: 'setBotLink'; botId: string; agentId: string } // リンク（エージェントの id だけ）を付ける・付け直す
  | { command: 'renameBot'; botId: string; name: string } // ボットの名前を変える（盤面のボットのセルも同じ名前になる）
  // Grok-Bot の巣（第3段。plan-s3-nest.md §4）：役と巣の設定も台帳に書くのは左だけ。左が normalizeRole・normalizeNest で直してから書く
  | { command: 'setBotRole'; botId: string; role: BotRole | null } // ボットの役を付ける・変える（null で外す ＝ 役なし）。考え方の段階は role.thinking（S3.3b）
  | { command: 'setNest'; nest: BotNest } // 巣の設定（みんなに聞くの送り方・代表・合体 Grok の演出）
  | { command: 'setBotTeams'; teams: BotTeams } // グループの割り当て（groups.json。左が normalizeTeams で直してから書く。plan-bot-groups.md G1）
  // 依頼の小窓で定型を押した・候補を取り込んだ（依頼の小窓 v2・R4a）。左が presets.json のその定型に、使った時刻と回数を足す。
  //   set：そのときの組の id（R4b。棚から使ったら、入れ替えの声かけの相手の手元にする。知らない組は覚えない）
  | { command: 'botPresetUsed'; id: string; set?: string }
  // 定型の棚（依頼の小窓 v2・R4b・D10。巣の ⚙ の「定型」タブ）：組・定型・棚卸しの覚えを丸ごと渡す。
  //   左は mergePresetEdit で直して混ぜる（文・寿命・置き場・並び・手元・入れ替えに答えた印・棚卸しの覚えだけを取る。
  //   使った回数・時刻・印の数は左の持ち分のまま。無くなった id は消す。鍵らしき文字は〔鍵1〕に置き換える）
  | { command: 'setPresets'; sets: BotPresetSet[]; presets: BotPreset[]; review?: BotPresetReview }
  // 送った依頼から拾う（R4b）：受け取り箱の依頼（頭の 40 字。requestId）か下書き（draftId）から作った定型の文を棚に足す。
  //   左は文を直し（200 字・鍵らしき文字の置き換え）、同じ文があれば足さない（蔵にあれば棚へ戻す）。requestId は形の合うものだけ from に残す
  | { command: 'presetFromRequest'; requestId?: string; draftId?: string; text: string }
  // 右下からアプリを開いた結果（missing：アプリが見つからなかった・開けた）と、はじめての「外のアプリを開きます」を確かめ終えたこと
  | { command: 'botAppSeen'; missing?: boolean; confirmed?: boolean }
  // 六角スクショを Grok-Bot へ（S3.12）の ①：読む画面が画像をクリップボードに入れたので、そのボットのチャットを開く
  //   （読む画面は openBotApp を使えないので左に頼む。依頼は作らない。はじめての確かめは小窓で済ませてある）
  | { command: 'botOpenApp'; botId: string }
  // 右下の Grok Bot の「コピーしてアプリを開く」：頼む文を左に渡す。左が依頼（request.v1）を作って pending.json に覚え、
  //   クリップボードに入れてからアプリを開く（依頼を作るのは左だけ。右は check を知らない）
  | { command: 'botDraft'; botId: string; text: string; cardId?: string }
  // 依頼の小窓（S3.5。panels/bot-request-form.ts）から：頼む文・添付・宛て先・役・組を左に渡す（botDraft は頼む文だけのまま残す）
  //   page・body：付けると決めたものだけ（外したものは入れない。URL の ? と # から後ろは左の buildBotRequest でも消す）
  //   role：宛て先のボットの役（無ければ台帳の役。null なら役なし。左が normalizeRole で直す）　group：みんなに聞くの組の番号（S3.6）
  //   chatOnly：返し先「アプリのチャットだけ」（返事の決まりと JSON を付けず、依頼を作らない＝pending.json に記録しない）
  | {
      command: 'botDraftV2';
      botId: string;
      text: string;
      page?: { title: string; url: string; selection?: string };
      body?: string;
      role?: BotRole | null;
      // 小窓で直した役の文（依頼の小窓 v2・R3・D7）。あれば役の文の代わりに頭に入れる（空なら役の部分なし）。
      //   左は文字列かを確かめ、cleanRoleText で ROLE_TEXT_MAX 字までにする。role は役の名前を覚えるためにそのまま
      roleText?: string;
      seat?: number; // 役の見出しの席（0 は席なし＝グループの役。無ければ左が巣の席を入れる）
      group?: number;
      planned?: string[]; // みんなに聞くの組で、聞くと決めた席のボットの id（S3.8。受け取り箱の組のカードの「送信前」の点。左はメモリーにだけ覚える）
      team?: BotRoleGroup; // グループに頼む（G2。group があるときだけ。pending.json に覚える）
      summary?: boolean; // まとめ役に渡す依頼（G3。席の点には数えない）
      plannedRoles?: string[]; // planned と同じ順の役の名前（グループの「送信前」の点。メモリーだけ）
      chatOnly?: boolean;
      cardId?: string; // Grok Cards の札（段 5）。依頼ができたら、左が「送った:」を 1 件付ける。組がある席では付けない
      // 小窓の選び方（依頼の小窓 v2・R6。文は入れない）。左は normalizeLastChoice で直し、宛て先と席を台帳で確かめ直して、
      //   送れたときだけ last-request.json に書く（「前と同じで」）
      choice?: BotLastChoice;
      // 続きとして頼んだ元の依頼（依頼の小窓 v2・R5・D11）。左は requestId の形と、覚えている依頼かを確かめて pending.json にだけ覚える（糸の元）。
      //   前の返事の要点の行は、小窓が text の「添えた情報」の枠に入れてある（依頼の JSON には入れない）
      parentRequestId?: string;
      // 言い換えてもう一回の元の依頼（R9・D19。受け取り箱の回答カードの「もう一度 ▾」から）。左は形と、覚えている依頼かを確かめて pending.json にだけ覚える（表示は #0010-2）
      retryOf?: string;
      // 小窓で使った定型の id（R9。依頼文の行と同じ文になっていた定型）。左は cleanPresetIds で直して pending.json にだけ覚える（印を定型へ戻すため）
      presetIds?: string[];
      // 画像と文を一つの貼り付けで（依頼の小窓 v2・R7d・D16。巣の設定 pasteMode が html のときだけ）：読む画面が先に保存した写し
      //   bot-shots\<shotId>.png（渡す画像。書き足した版なら黒塗りを焼き込んだもの）の名前と、透明な所の色。左は形を確かめ、依頼の文と一緒に
      //   clipboardWriteImage（shotId・text・html）で 1 回で書く。依頼（request.v1）にも pending.json にも入れない
      withImage?: { shotId: string; fill?: 'white' | 'dark' };
      // 返し先「六角メモにも届く」（依頼の小窓 v2・R10・D13）。左は 'hex' だけ通し、chatOnly のときは捨てる。pending.json にだけ覚え、
      //   確かめが通った返事を六角メモ（相棒の設定で選んだノート）に 1 マス写す。依頼（request.v1）には入れない
      deliverTo?: 'hex';
      // webhook「そのまま送る」（依頼の小窓 v2・R11・D20）：hook なら左は WebhookSender で中継へ直接（chatOnly・withImage とは両立しない。左が断る）。
      //   ticket：結果を relay の botHookResult で返すときの合い札（右と読む画面の AskLeftSender が待つ。英数字 6〜40 字）
      via?: 'hook';
      ticket?: string;
    }
  // 「続きとして」の要点の行（依頼の小窓 v2・R5）：左がその依頼の確かめが通った返事を記録から読み、要点の行（botAnswerPoints）と
  //   頭の 1 行（botAnswerLine）を relay の botAnswerLines で右と読む画面へ返す（渡し止めのアドレスは伏せる。check は入れない）
  | { command: 'botAnswerLines'; botId: string; requestId: string }
  // 送ったあと（依頼の小窓 v2・R8・D17・D18）。受け取り箱（右）から左へ
  //   botPasted：「貼りましたか？」の札の答え（yes：貼った＝pasted を yes にし、預かっておいた前のクリップボードの中身に戻す
  //     no：消す＝クリップボードの依頼を消して前の中身に戻し、pasted を no に〔待つのもやめる〕　again：もう一度アプリを開く〔戻ってからもう 1 回聞く〕）。
  //     左は札を出している依頼と同じものだけ受ける
  | { command: 'botPasted'; botId: string; requestId: string; answer: 'yes' | 'no' | 'again' }
  // 画像の貼り方（依頼の小窓 v2・R7d・D16）：画像入り 1 回で貼った依頼の「貼りましたか？」の札の「次から 2 回貼りに戻す」から。
  //   左は巣の設定の pasteMode だけを替える（ほかの設定はそのまま。替わらなければ写しを送り直す）。botId：知らせを出すボット（札の依頼の宛て先）
  | { command: 'botPasteMode'; mode: 'two' | 'html'; botId?: string }
  // 試し便（D18）：決まった一文だけの依頼（request.v1 の type: "ping"）を作ってコピーし、アプリを開く（貼るのは人）。出すのは往復の時間と照合の合否だけ
  | { command: 'botPing'; botId: string }
  // 中継の見張りの「いま取りに行く」（D18）：C++ に今すぐ見回ってもらい、最後に見回った時刻を新しくする
  | { command: 'botInboxCheck' }
  // webhook「そのまま送る」（依頼の小窓 v2・R11・D20）
  //   botHookFallback：中継へ届かなかった依頼を、同じ依頼（requestId・check は同じ。attempt を 1 増やす）で「コピーしてアプリを開く」に切り替える
  //     （小窓の切り替えのボタン・受け取り箱の伝票から。左は覚えている依頼だけ。窓を開き直したあとは同じ依頼は作れない）
  //   botHookChanged：巣の ⚙「送り方」で宛先と鍵をしまった・消した（右は C++ に直接頼む。左は getBotHook で「ある／ない」を読み直す）
  | { command: 'botHookFallback'; botId: string; requestId: string }
  | { command: 'botHookChanged' }
  // 受け取り箱 v2（依頼の小窓 v2・R9・D19）：回答カードの印（hit 当たり・miss ずれ・wrongTo 宛て先違い。null で外す）。
  //   左は形と、終わりの返事が届いた依頼かを確かめて pending.json の mark と記録（kind: 'mark'）に書く（使った定型と役の印の数は一覧の写しの tally）
  | { command: 'botMark'; botId: string; requestId: string; mark: 'hit' | 'miss' | 'wrongTo' | null }
  // 右のボットの欄（S2.4。pending.json と記録を書くのは左だけ。右は写しを見て、これを頼む）
  | { command: 'botSelect'; botId: string | null } // 欄で見ているボット（そのボットのやり取りの写し botThread を送ってもらう）
  | { command: 'botStopWaiting'; botId: string; requestId: string } // 待つのをやめる（あとから届いた返事は薄く出す）
  | { command: 'botMarkRead'; botId: string; requestIds: string[] } // 欄で見た終わりの返事を「読んだ」に（右上の札から外す）
  | { command: 'botGroupRead'; group: number } // 受け取り箱の組のカードの「まとめて読む」（S3.8。左が記録から返事を読み、botGroupReplies で送る）
  | { command: 'botTeamHandoff'; group: number } // まとめ役に渡す（G3。左が文を作り、botTeamHandoff で小窓へ渡す。コピーするまでは送らない）
  // 返事をメモにする（押したときだけ）。to：cell＝ボットのセルの隣のメモのセル・right＝右のメモ・hex＝六角メモ。
  //   memo：返事の「メモにしてね」の提案の何番目か（無ければ返事の全体）。fileId は記録の中の返事（左が記録から読み直す）
  | { command: 'botToMemo'; botId: string; fileId: string; to: 'cell' | 'right' | 'hex'; memo?: number }
  // 回答カードの「タブに残す」（S3.10）：依頼に付けたページのタブがまだあれば、そのタブのメモに要約と出典を残す（無ければ右のメモへ）。左が記録から読み直す
  | { command: 'botToTab'; botId: string; fileId: string }
  // Grok Visions（S3.7b。visions.ts）：残した Vision を1件消す（使う人が月の窓・ボットの欄の札で確かめてから。ファイルを消すのは左だけ）
  | { command: 'removeVision'; id: string }
  // 下のメモの区画（M1）。見える・隠すを C++ に言うのは左。高さだけは下の面が直接送る
  | { command: 'memoPaneReady' } // 下の面の準備ができた。左は開いているメモの写しを送る
  | { command: 'memoPaneDraft'; busy: boolean } // 下の区画に書きかけ（コメント・カードの書き直し・返信）があるか。変わったときだけ下の面が送る
  | { command: 'memoPaneClose' } // 下の区画を閉じる
  | { command: 'focusMemoPaneCell'; id: string } // 下の区画から、左の盤面のそのメモのセルへ移る（別シートなら切り替え、見える所まで動かし、少し光らせる）
  | { command: 'setMemoText'; id: string; text: string } // 本文を変える
  // 下の区画でコメントのカードを足す（parent は null。引用・画像は M3 で付ける。形は左が確かめる）
  //   replyId：新しいカードの id を呼び出し側が決めたいとき（B2-3a。ボードがカードを足す位置を、足す前に保存するため）。省略すると左が決める（今までどおり）。
  //   形は [A-Za-z0-9_-]{1,64}。形が違う・そのメモにもう同じ id があるときは、付け替えずにこの命令を断る（知らせを出す）
  | { command: 'addMemoComment'; id: string; text: string; quote?: ReplyQuote; image?: string; file?: string; replyId?: string }
  | { command: 'changeReplyTags'; id: string; replyId: string; add: string[]; remove: string[] } // 下の区画のカードのタグを足す・外す（一番上のカードだけ。足し引きの差分。左が断ることもある。依頼② T1。画面は T2）
  // 下の区画のカードの関連を足す・外す（replyId が元の一番上のカード。差分。外すのは同じ相手・同じ種類だけ。同じ相手に別の種類を足すと置き換え。
  //   左が断ることもある：台帳を読めていない・相手が一番上のカードに無い・逆向きの「同じ」がある・10 本を超える。計画 docs/plan-memo-card-links.md の L1）
  | { command: 'changeReplyLinks'; id: string; replyId: string; add: ReplyLink[]; remove: ReplyLink[] }
  // 下の区画のカードを並べ替える（一番上のカード replyId を、一番上のカード before の前へ。null は最後へ。番号では送らない）。
  //   左が断ることもある：台帳を読めていない・カードが一番上に無い・before が一番上のカードに無い・before が自分。
  //   断った・変わらなかったときも、左は写しを送り直す（下の区画の待ちの並びを戻すため）。計画 docs/plan-memo-card-order.md の O1
  | { command: 'moveReply'; id: string; replyId: string; before: string | null }
  | { command: 'setMemoLinkNames'; id: string; names: Partial<Record<import('./memo-card-links').LinkKind, string>> | null } // 試し：このメモだけの関連の種類の名前（セットを選んでいないときに使う）
  | { command: 'setMemoLinkSet'; id: string; setId: string | null } // 試し：このメモが使う呼称セット。null で外す（ほかのメモは変えない）
  | { command: 'clearMemoLinkSet'; setId: string } // 試し：呼称セットを消したとき、その id を使っていたメモ全部から外す
  | { command: 'placeReply'; id: string; replyId: string; slot: number } // 試し：一番上のカードを空いた番地（行 × 3 ＋ 列）へ（断った・変わらなかったときも写しを送り直す）
  | { command: 'packReplies'; id: string } // 試し：カードの空きを詰める（並べた順のまま）
  | { command: 'resetReplyOrder'; id: string } // 下の区画のカードの並べた順を消す（作った順に戻す。断った・変わらなかったときも写しを送り直す）
  | { command: 'editReply'; ref: ThreadRef; replyId: string; text: string } // 書き直す（memo のスレッドだけ。タブのメモは断る）
  | { command: 'setMemoLiked'; id: string; liked: number } // 下の区画の ♥（メモのいいね。タブの setLiked とは別）
  | { command: 'openQuote'; url: string; fragmentUrl: string } // 引用元を開く（同じページのタブがあればそこへ。M3）
  // 下の区画でこのメモを開く（M5 の一覧）。replyId：下の区画でそのカードへ移る　from：右の検索から（書きかけがあれば、左が別のメモを開かずに知らせる。S1b）
  | { command: 'openMemoPane'; id: string; replyId?: string; from?: 'search' }
  | { command: 'searchMemos'; seq: number; query: string; sort: SearchSort; limit: number } // 右の「検索」の区画：メモとコメントを探して（左が台帳を読むだけで探し、searchResults で返す）
  | { command: 'newMemoForPane' } // 新しいメモを作って、下で開く（M5）
  | { command: 'setBoardMemo'; id: string | null } // ボードが見るメモを、下の区画とは別に選ぶ（null で外す＝下と同じ）。左が memoBoardView で写しを送る。選べない（無い・特別なセル）ときは断る（plan-board-memo-switch の M1。画面からはまだ送らない）
  // 下の区画のカードを、別のメモへ移す・写す（to が null なら新しいメモを作って入れる。左が一度に確かめて、台帳へは 1 回だけ書く）
  | { command: 'sendReplies'; from: string; replyIds: string[]; to: string | null; mode: 'move' | 'copy'; template?: CardTemplate; ids?: string[] } // template があるときは型を貼る（from は空・replyIds は空・to は貼り先のメモ・mode は copy）。ids（B3-2a。型を貼るときだけ）：貼る新しいカードの id を呼び出し側が決める（型のカードと同じ順・同じ数・30 枚まで・[A-Za-z0-9_-]{1,64}・指定の中でも台帳にも重ならない）。使えなければ全体を断る。省略すると左が決める（今までどおり）
  | { command: 'undoSendReplies'; token: string } // 直前の送りを元に戻す（知らせの「元に戻す」）
  // Grok Cards（段 1〜4。旗が空のときは左は何もしない。C++ はコマンド名を見ない）
  | { command: 'openGrokCards' }
  | { command: 'closeGrokCards' }
  | { command: 'addGrokCard'; address: string; text: string }
  | { command: 'setGrokCardText'; id: string; text: string }
  | { command: 'openNestForm'; address: string }
  | { command: 'copyGrokCard'; id: string } // 段 5。依頼の小窓を、札の文入りで開く（ここでは送らない）
  | { command: 'openGrokCardApp'; id: string } // 段 5・6。アプリを開くだけ（コピーしない）
  | { command: 'markGrokCardSent'; id: string; sent: string } // 段 5。みんなの組ができたとき（gN）
  | { command: 'markGrokCardPasted'; id: string } // 段 6。貼った ✓（依頼の記録には欄を足さない）
  | { command: 'clearGrokCardSent'; id: string } // 段 7。もう一度下書きにする（文は残す）
  | { command: 'removeGrokCard'; id: string } // 段 7。期限の切れた札を外す
  | { command: 'showGrokReply'; id: string }; // 段 7。返事の文字だけ（札には写さない）

// サイドバー同士の連絡（C++ が中継する）
export type RelayPayload =
  | { kind: 'threadPending'; pending: PendingReply[] } // AI の相棒が返信を書いている途中のスレッド
  | {
      kind: 'state';
      tabs: Tab[];
      activeId: number | null;
      placement: PreviewPlacement;
      sleep: SleepSettings;
      reminders: Reminder[];
      remindersFailed?: boolean; // リマインダーの台帳を読めなかった（K0。この起動では書かない。右の区画が帯で知らせる）
      islands: Island[];
      highlightTag: string | null;
      highlightLike?: LikeLevel | null; // 無ければ、いいねの強調はしていない（古い写し）
      sheets: Sheet[]; // シートの台帳
      sheet: string; // 左で見ているシート
      tagButtons?: { name: string; tags: (string | null)[] }; // 左のタグのボタン（使っているセット。右の「タグごとの一覧」の並び）
    }
  | { kind: 'focus'; id: number | null }
  | { kind: 'thumbnails'; images: [number, string][] }
  | { kind: 'event'; event: CompanionEvent }
  | { kind: 'reminder'; reminder: Reminder; late: boolean } // 時間になった（late = 起動していない間に過ぎていた）
  | { kind: 'remindersFired'; items: FiredReminder[]; failed?: boolean } // 鳴ったものの記録の写し（K3。failed：記録を読めなかった）
  | { kind: 'readerOpen'; tabId: number; url: string; title: string } // 読む画面に、このタブを読んでもらう
  // 読む画面で、六角形スクショを撮ってもらう（tabImage：タブの画像にする　linkCover：表紙にして、リンクをセルに追加する）
  | { kind: 'shotStart'; image: string; title: string; purpose?: 'tabImage' | 'linkCover' }
  // 読む画面の重ね窓に、依頼の小窓を開いてもらう（S3.11。ページの右クリック・Ctrl+Shift+G・メモのセルの「🔍 Grok に調べてもらう」）
  //   bots・dock・nest・confirmed：右へ送るボットの写し（bots）と同じもの（名前・エージェントの id・役だけ）
  //   to：はじめに選ぶ宛て先（巣で選んでいるボット、無ければ席1）　context：付けられるもの（ページの URL・題名・選んだ文。本文は付けない）
  //   image：ページを撮った画像（小窓の後ろに薄く出す。撮れなければ無し）
  //   over：page＝この小窓のために読む画面を出した（閉じたら読む画面も閉じる）・reader＝六角で読んでいる上に出す（閉じても読む画面は残す）
  | {
      kind: 'botAsk';
      bots: BotBrief[];
      dock: string[];
      nest: BotNest;
      confirmed: boolean;
      to?: string;
      context: { url?: string; title?: string; selection?: string };
      image?: string;
      over: 'page' | 'reader';
      note?: string; // 渡し止めの一行（添付を外したとき）
      text?: string; // 画像を付けないとき、はじめに入れておく頼む文（人が書いたコメント）
      // 六角スクショを Grok-Bot へ（S3.12）：切り取った六角形（data URL）と、撮る画面で書いたコメント（頼む文の最初の行に）。
      //   あれば小窓は画像のサムネイルつきの二段（① 画像を貼る → ② 文を貼る）で、宛て先は1体だけ（みんなは選べない）
      shot?: { image: string; comment: string };
      // クリップボードの画像の候補（依頼の小窓 v2・R7a・D15）：左が開くときに読んだ画像（長い辺 1600px の JPEG の data URL。Base64 90 万字まで）。
      //   小窓は印を外した状態のカードで出し、付けたときだけ写しを取って 2 回貼りで送る。六角スクショ（shot）・渡し止めのときは無い
      candidate?: { image: string };
      // 定型（依頼の小窓 v2・R4a。presets.json の組・手元・棚の写し。左が読み終えるまでは無い）と、開いた入口（page・memo・shot。はじめの組を決める）
      presets?: BotPresets;
      entry?: Exclude<BotPresetEntry, 'nest' | 'follow'>;
      // 前回送った依頼の選び方（R6。last-request.json の写し。無ければ無し）と、Ctrl+Shift+G を素早く 2 回押した（開いたらすぐ「前と同じで」を当てる）
      lastRequest?: BotLastRequest;
      same?: boolean;
      // 「続きとして」の選び口（R5。受け取り箱の一覧の写しの、確かめが通った返事 5 件。文は入れない）
      replies?: BotRecentReply[];
      hook?: boolean; // webhook「そのまま送る」の宛先と鍵があるか（R11。「ある／ない」だけ。値は持たない）
    }
  // 相棒に、この部分について聞く（from：六角で読む画面から・メモのセルから。image：見せる画像の data URL）
  | { kind: 'askCompanion'; text: string; title: string; url: string; from?: 'reader' | 'memo' | 'shot'; image?: string }
  | { kind: 'routes'; state: RoutesState; shown: string | null } // 順路の写し（shown：盤面に出している順路）
  | { kind: 'vocab'; state: VocabState } // 単語帳の写し
  | { kind: 'vocabHere'; ids: string[] } // 表示中のタブのページから作ったカード（K6。「このページ n 枚」の札。タブが替わると送り直す）
  | { kind: 'vocabFilter'; ids: string[]; label: string } // 盤面のセルの右クリック「つながったカードを見る」（K6。右の単語帳をそのカードに絞る）
  | { kind: 'vocabDue'; count: number } // 復習の時期のカードがある（相棒が知らせる）
  // 右の「メモ」の区画で見ているシート（sheetId）の写し。sheet が無ければ、まだ作っていない。counts：シートごとのメモのセルの数
  | { kind: 'rightMemos'; sheetId: string; sheet: { id: string; name: string } | null; memos: RightMemo[]; counts: Record<string, number> }
  // 右の「タグごとの一覧」に送る、すべてのメモのセルの短い写し（入口は除く）
  | { kind: 'memoIndex'; memos: MemoIndexItem[] }
  // 右の「検索」の区画への結果（ready：左がメモの台帳を読み終えた）
  | { kind: 'searchResults'; seq: number; ready: boolean; items: SearchItem[]; total: number }
  | { kind: 'searchNotice'; text: string } // 右の「検索」の区画に出す短い知らせ（左が決めた文だけ）
  | { kind: 'memoRev'; rev: number } // メモの台帳が変わった印（右の検索が探し直す。コメントの足し引きは memoIndex に出ないため）
  | { kind: 'command'; action: RelayCommand }
  | { kind: 'captureCenter' } // ページの右クリックか Ctrl+Shift+Y（C2）。右の「撮影」が中央の見えている所を残す。台帳を書くのは右
  // 盤面・下の区画の画像を右の「撮影」に残して大きく開く（I4）。画像は運ばず shots\<id>.json の ID だけ（右が自分で読む）。台帳を書くのは右
  | { kind: 'captureShot'; shot: string; from: CaptureFromKind; name?: string }
  // ページの画像の右クリック「🖼 画像を撮影に送る」（I1）。url は画像の URL（http/https のときだけ。空なら照合しない）。
  //   tabUrl は押したときのタブの URL、at は左が受けた時刻。画像は運ばない（右がページに測ってもらい、自分で撮る）。台帳を書くのは右
  | { kind: 'captureImage'; tabId: number; url: string; tabUrl: string; at: number }
  | { kind: 'captureScope'; scope: 'window' | 'desktop' | 'region' } // ページの右クリック（C5）。窓全体・デスクトップ・範囲。台帳を書くのは右
  | { kind: 'captureRecord' } // ページの右クリック「中央を録画」（C6）。録画中なら右が止める。台帳と mp4 は右と C++
  | { kind: 'captureOpen'; id: string; image: string; marks: CaptureMark[]; strokes: CaptureStroke[]; blur: CaptureBlur[]; title: string; askedAt?: number; video?: boolean; undo?: boolean } // 読む画面に、撮った画像だけを出す（C3）
  // 右の台帳の短い一覧（C9）。画像は送らない。左がシート「撮ったもの」のセルを、この ID に合わせる
  | { kind: 'captureBoard'; items: { id: string; marks: number; createdAt: number }[] }
  | { kind: 'captureReveal'; id: string } // 左の六角形をダブルクリック（C9）。右の「撮影」がそのカードを開く。新しくは撮らない
  | { kind: 'captureCrop'; image: string } // 読む画面で範囲を囲む（C5）。画像はまだカードではない
  | { kind: 'captureCropped'; image: string } // 囲んだ JPEG。右が region として残す
  | { kind: 'captureCropCancel' }
  | { kind: 'captureMarks'; id: string; marks: CaptureMark[] } // 右が台帳の marks を書き直す
  | { kind: 'captureStrokes'; id: string; strokes: CaptureStroke[] } // 右が台帳の strokes を書き直す（C4）。画像ファイルは変えない
  | { kind: 'captureHide'; id: string; rects: HideRect[]; mode: HideMode; seq: number } // 読む画面が頼んだ「隠す」（左→右）
  | { kind: 'captureUnhide'; id: string; seq: number } // 読む画面が頼んだ「隠すのを取り消す」（左→右）
  | { kind: 'captureChanged'; id: string; image: string; blur: CaptureBlur[]; undo: boolean } // 隠す・取り消すの成功のたび、どこから隠しても（右→左→読む画面）
  | { kind: 'captureHideDone'; id: string; seq: number; ok: boolean; reason?: string } // 読む画面が頼んだ隠す・取り消すの返事（右→左→読む画面）
  | { kind: 'captureViewClosed'; id: string } // 読む画面の撮影の画面を閉じた（左→右。取り消しの写しを捨てる）
  | { kind: 'vaultAdd'; draft: VaultDraft } // データ置き場に入れる（右サイドバーが持つ。左からは相棒が残した考察のメモ）
  // 右下の Grok Bot へ、ボットの台帳の写し（名前とエージェントの id と役だけ）。dock：右下に置いているボットの id（並びの順・6体まで）
  //   nest：巣の設定（台帳に無ければ既定 each・effect）
  //   appMissing：Grok Bot アプリが見つからなかった　confirmed：「外のアプリを開きます」を確かめ終えた　ready：台帳を読み終えた
  //   states：ボットごとの状態と札の数（盤面の全部のボット。本文は入れない）　inbox：受け取り口の様子（owner が false なら別の窓で使っている）
  //   requests：受け取り箱の一覧（S3.8。依頼ごとの要約と組の状態。check・頼む文は入れない。頼む文の最初の 40 字は設定でオンのときだけ）
  //   teams：グループの割り当て（groups.json。読み終えるまでは無い。plan-bot-groups.md G1）
  //   presets：定型の組・手元・棚・蔵（presets.json。依頼の小窓 v2・R4a。読み終えるまでは無い。R4b から蔵も入れ、印の数は今ある依頼の印〔tally〕を足した数）
  //   lastRequest：前回送った依頼の選び方（last-request.json。R6。まだ送っていなければ無い。文は入れない）
  //   pasteAsk：いま出してほしい「貼りましたか？」の札（R8。1 枚だけ。無ければ出さない。held は預かった前の中身の種類だけ〔中身は送らない〕）
  //   away：受け取り箱の「まず 1 枚」の表（R9。前の「読んだ」より後に届いた、まだ読んでいない返事と、同じあいだの灰色の返事の数。返事の一言は左が記録から作る）
  | {
      kind: 'bots';
      bots: BotBrief[];
      dock: string[];
      nest: BotNest;
      teams?: BotTeams;
      presets?: BotPresets;
      lastRequest?: BotLastRequest;
      appMissing: boolean;
      confirmed: boolean;
      ready: boolean;
      states?: BotBriefState[];
      inbox?: BotInboxStatus | null;
      requests?: BotRequestList;
      pasteAsk?: BotPasteAsk;
      away?: BotAwayView;
      hook?: boolean; // webhook「そのまま送る」の宛先と鍵があるか（R11。C++ の getBotHook の has だけ。値は持たない）
    }
  // 受け取り箱の組のカードの「まとめて読む」（S3.8）：組の返事を席の順に（文は 4,000 字まで。check は入れない）
  | { kind: 'botGroupReplies'; group: number; replies: BotGroupReply[] }
  // まとめ役に渡す文（G3）。右は依頼の小窓に入れるだけ（コピーするまでアプリは開かない）
  | { kind: 'botTeamHandoff'; group: number; botId: string; team: BotRoleGroup; text: string }
  // 右のボットの欄で見ているボットの、やり取りの写し（check は入れない。文は 4,000 字まで）
  | { kind: 'botThread'; thread: BotThreadView }
  // 「続きとして」の要点の行（R5。命令 botAnswerLines の返事。右と読む画面の両方へ送る。頼んだ面だけが使う）
  | ({ kind: 'botAnswerLines' } & BotAnswerLines)
  // webhook「そのまま送る」の結果（R11。botDraftV2 の ticket への返事。右と読む画面の両方へ送る。頼んだ面だけが使う）。鍵・URL は入れない
  | { kind: 'botHookResult'; ticket: string; botId: string; ok: boolean; requestId?: string; no?: string; message?: string; fallback?: boolean }
  // 盤面のボットのセルのカードの「やり取りを見る」：右のボットの欄でこのボットを開く
  | { kind: 'botOpen'; botId: string }
  // 段階16。この島を頼む：入れるメモの一覧（全文はまだ渡さない）。more は一度に出せなかった件数
  | { kind: 'islandAskPick'; islandId: string; name: string; memos: { id: string; title: string }[]; more: number }
  // 選んだメモの文。依頼の小窓に入れるだけ（コピーもアプリも開かない）
  | { kind: 'islandAsk'; text: string }
  // ボットのことで、右に出してほしい短い知らせ（依頼をコピーした・アプリを開いた・メモにした など。文は左が決めたものだけ）
  //   bubble：相棒の吹き出しで知らせる（頼んだ依頼への返事が届いたときだけ。決まった文。そのボットのやり取りが見えていれば出さない）
  //   notice：absent＝不在票（R8。ブラウザを閉じている間に届いた返事の数。受け取り箱の上に 1 枚。botId は空のことがある）
  | { kind: 'botNotice'; botId: string; text: string; bubble?: boolean; fileId?: string; notice?: 'absent' } // fileId：どの返事のことか（回答カードの下に、結果の1行を出す。S3.10）
  // Grok Visions（S3.7b）の写し（新しい順・全部。bytes：おおよその使っている大きさ　ready：ui-data\visions\ を読み終えた）
  | { kind: 'visions'; visions: Vision[]; bytes: number; ready: boolean }
  | { kind: 'memoPane'; view: MemoPaneView | null } // 下のメモの区画へ、開いているメモの写し（閉じていれば null）
  // ボードが見るメモの写し（下の区画の memoPane とは別。setBoardMemo で選んだメモ。選んでいる間だけ送り、外した・消えたときは null を一度だけ送る。M1：送るだけ・受け口は M2）
  | { kind: 'memoBoardView'; view: MemoPaneView | null }
  | { kind: 'memoPaneNotice'; text: string; openMemo?: string; undoSend?: string; memo?: string } // 下の区画に出してほしい短いお知らせ（openMemo・undoSend は、送ったあとの「送り先を開く」「元に戻す」）
  // 下の区画のカードから、右のタグのボタン（セット）を変えてと頼む・右が変えたあとの台帳を返す
  | { kind: 'tagButtonsOp'; op: TagButtonsOp; seq: number }
  | { kind: 'tagButtonsDone'; seq: number; book: TagButtonBook }
  // 下の区画の一覧（M5）。items は開いているメモと同じシート（新しい順・200件まで）。recent は最近開いたメモ（10件）
  | { kind: 'memoPaneList'; items: MemoIndexItem[]; recent: MemoIndexItem[]; sheetName: string }
  // Grok Cards。開くのは下の面の札。全文はリレーだけ（localStorage にはタグと数だけ）
  | { kind: 'grokCards'; open: boolean }
  | {
      kind: 'grokCardsData';
      cards: { id: string; text: string; tags: string[] }[];
      bots: { id: string; name: string }[];
      dock: string[];
      refused: boolean;
      requests?: { requestId: string; botId: string; state: string; createdAt: number; no: string; group?: number; fileId?: string }[];
      groups?: { group: number; states: string[] }[];
      requestsReady?: boolean;
    }
  | { kind: 'grokCardsNotice'; text: string; keep: boolean; address?: string; id?: string }
  | { kind: 'grokReply'; id: string; text: string }
  | { kind: 'nestForm'; address: string }
  | { kind: 'cardForm'; cardId: string; address: string; text: string; secret: boolean }
  | { kind: 'cardApp'; botId: string }
  | { kind: 'requestState' };
