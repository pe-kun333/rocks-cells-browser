// 「六角で読む」画面（ページの上に重ねる中央の面）
//   表示中のページの本文を、六角メモの「分けて並べる」と同じ決まりで六角セルに組み直して、帯のように並べる
//   ・読書モード：今のマスを光らせ、← → で進む。進んだ分はタブの六角形の辺（読み進み）にも反映する
//   ・マスごとの ♥（3段階）とメモ。メモは行の間のマスに置く。URL ごとに保存して、次に開いたときも再現する
//   ・AI で要点のマスを光らせ、難しい語の解説を行の間のマスに置く
//   ・相棒に聞く、♥ とメモを六角メモへ送る
//   ・YouTube の動画なら、字幕（文字起こし）を時刻つきの「区間セル」にする。動画の右に並べ（動画は見えたまま）、
//     再生に合わせて今のマスが動き、マスを押すとその場面へ。くり返し・♥ だけ再生（ダイジェスト）
import { MODELS, type ModelId } from '../ai/client';
import { BLOCK_NOTE, pageIsBlocked } from '../blocklist';
import type { OrganizeSettings } from '../ai/organize';
import { onMessage, request, send } from '../bridge';
import { DIRECTIONS, type Hex, hexKey } from '../hex';
import { type HexMemoTarget, sendToHexMemo } from '../integrations/hexmemo';
import { analyzeCells } from '../reader/ai';
import { translateCells } from '../reader/translate';
import { extractPage } from '../reader/extract';
import { CHUNK, type Chunk, layout, splitText, toAxial } from '../reader/ribbon';
import { LiveCaptions, type LiveStatus } from '../reader/live';
import { fileNameOf, isMediaFileUrl, parseSubtitles, readSidecarSubtitle } from '../reader/media';
import { type CellMark, cellKeys, loadReader, MAX_DRAFT_TEXT, MAX_DRAFTS, parseDrafts, type ReaderAi, type ReaderSaved, saveReader } from '../reader/store';
import {
  canonicalVideoUrl,
  fetchTranscript,
  isVideoUrl,
  seekVideo,
  setPlaybackRate,
  timedUrl,
  timeLabel,
  togglePlay,
  type TranscriptSegment,
  transcriptChunks,
  videoState,
} from '../reader/youtube';
import { startShot } from '../reader/shot';
import { closeCaptureView, openCaptureView, refreshCaptureView, settleCaptureHide } from '../reader/capture-view';
import { closeCropView, openCropView } from '../reader/capture-crop';
import { ReaderAsk } from '../reader/ask';
import { type LiveComment, liveComments, type SecondVoice } from '../reader/live-ai';
import { SECOND_ROLES, type SecondRole } from '../ai/prompts';
import type { HexMemoRecord, RelayCommand } from '../types';
import { MAX_AT_SPANS, MAX_AT_TITLE, type ReaderLinksView, type ReaderNow, type ReaderRefusal, type ReplyAt } from '../reader-links';
import { readerVideoKey } from '../reader/video-key';
import { newReplyId, type ReplyAuthor, type ReplyQuote } from '../threads';
import { cellsOfSpan, countLinksByCell, itemsAtCell } from '../reader-span';
import { cleanLoopOptions, type LoopMode, type LoopOptions, type LoopSet, type LoopStep, MAX_LOOP_SETS, parseLoopSets, planLoop } from '../reader-loop';
import { ASK_KIND_NAME, ASK_LENS_NAME, ASK_RANGE_NAME, askEstimate, askHead, askPayload, askRangeCells, askRangeLabel, type AskKind, type AskLens, type AskRange, pauseLines } from '../reader-ask';
import { ASK_TOPIC_MAX, type AiAskKind, runAsk } from '../reader/ai-ask';
import { TALK_MODE_NAME, TALK_MODES, type TalkMode, talkMaterial } from '../reader-talk';
import { type AiCardLine, aiCardText, splitAiCard } from '../reader-ai-card';
import { capNotice, OVERVIEW_KINDS, type OverviewKind, type OverviewModel, overviewInCut, overviewModel, overviewTime } from '../reader-overview';
import { COMMENT_MAX, commentText, parseExportCards } from '../reader-export';
import { CellMenu, type MenuEntry } from '../panels/cell-menu';
import { clamp, debounce, el } from '../util';

type Spacing = 'normal' | 'roomy';

interface ReaderPrefs {
  size: number; // 六角形の大きさ（中心から頂点まで）
  spacing: Spacing; // ふつう = 行の間に1行、ゆったり = 2行（六角メモと同じ）
  keyOnly: boolean; // 要点のマスだけをたどる
  videoWidth: number; // 動画のとき、区間セルを並べる幅（残りに動画）
  videoSize: number; // 動画のときの六角形の大きさ（狭いので、ふつうより小さめ）
  videoLayout: 'right' | 'bottom'; // 動画の右に並べる・下に並べる
  videoHeight: number; // 下に並べるときの高さ
  flow: boolean; // 流れる表示：今のマスが下に来て、流れたマスが上へ動く（まだのマスは見せない）
  liveAi: LiveLevel; // AI と見る：相棒がひとことずつ返す
  writePlay: WritePlay; // 一行の欄で書くあいだの再生（plan-reader-video の V1b・D8）
  loop: LoopOptions; // 選んだ区間の回し方（最後に使ったもの。V3b-2）
  writeTo: 'note' | 'card'; // 一行の欄の書く先：マスのメモ・カード（このマスと結ぶ）。既定はカード（D1。V1c）
  ask: { range: AskRange; kind: AskKind | TalkMode; lens: AskLens }; // 頼み板で最後に選んだ範囲・頼み（やり取りの型も。V5）・型（plan-reader-video の V4a）
}

// 書くあいだの再生：止める（既定）・0.75 倍にする・そのまま
type WritePlay = 'pause' | 'slow' | 'keep';
const WRITE_PLAY_ORDER: WritePlay[] = ['pause', 'slow', 'keep'];
const WRITE_PLAY_LABEL: Record<WritePlay, string> = { pause: '書くあいだ：止める', slow: '書くあいだ：0.75×', keep: '書くあいだ：そのまま' };

type LiveLevel = 'off' | 'some' | 'often';
const LIVE_LABEL: Record<LiveLevel, string> = { off: 'オフ', some: 'ときどき', often: 'よく' };
const LIVE_EVERY: Record<LiveLevel, number> = { off: Infinity, some: 150, often: 60 }; // 何秒分流れたら、ひとこと
const LIVE_CAP = 40; // 1本で、ひとことを頼む回数の上限

const VIDEO_WIDTHS = [420, 520, 640, 760];
const VIDEO_HEIGHTS = [260, 340, 420, 520];
const POLL_MS = 700;

interface Cell extends Chunk {
  index: number;
  key: string;
  q: number;
  r: number;
  start?: number; // 動画のとき：この区間の始まり（秒）
  end?: number;
}

interface Annotation {
  cell: number; // どのマスについてか
  kind: 'note' | 'term' | 'ai';
  who?: 'main' | 'second'; // AI のひとことの話し手
  text: string;
  title?: string;
  pos: Hex;
}

const PREFS_KEY = 'honeycomb.reader';
const SQRT3 = Math.sqrt(3);
const PAD = 28;
const MAX_CELLS = 900;
const NOTE_MAX = 500; // マスのメモの字数（2 行の欄と同じ）
const MAX_PICKS = 30; // 選べる区間の数（組のキーの上限と同じ）
const LINK_MENU_MAX = 60; // 「カードと結ぶ…」に出すカードの数
const CARD_WAIT_MS = 8000; // カードを足す頼みの返事を待つ時間（過ぎたら書きかけを下書きに残す）

export function startReader() {
  document.body.classList.add('surface-reader');
  const prefs = loadPrefs();
  let apiKey: string | null = null;

  // ---------- 画面の組み立て ----------
  const root = el('div', 'reader');
  const titleBox = el('div', 'reader-title');
  const tools = el('div', 'reader-tools');
  const keyOnlyButton = toolButton('要点だけ', '要点のマスだけをたどる（K）');
  const aiButton = toolButton('AI で要点', 'AI に読んでもらい、要点のマスを光らせ、難しい語に解説を付ける');
  // 頼み板（plan-reader-video の V4a）：範囲 × 頼み（技法の色・話の骨組み・天丼と伏線・間・この型で別の話題）。押す前に料金の目安
  const askAiButton = toolButton('AI…', '範囲と頼み（技法の色・話の骨組み・天丼と伏線・間・この型で別の話題）を選び、料金の目安を見てから AI に頼む');
  askAiButton.setAttribute('aria-haspopup', 'menu');
  const translateButton = toolButton('日本語にする', '字幕の区間の下に日本語を出す（Haiku。練習モードなら料金はかかりません。渡し止めのサイトでは訳しません）');
  translateButton.hidden = true;
  const spacingButton = toolButton('', '行の間のあけ方');
  const smaller = toolButton('−', '小さく');
  const bigger = toolButton('＋', '大きく');
  const hexButton = toolButton('六角メモへ', '♥ とメモを付けたマスを、六角メモへ送る');
  const vocabButton = toolButton('単語帳へ', 'AI の言葉の解説を、すべて単語帳のカードにする（W で今のマスの言葉だけ）');
  const digestButton = toolButton('♥ だけ再生', '♥ を付けた区間だけを、順に続けて再生する（ダイジェスト）');
  const widthButton = toolButton('幅', '区間セルを並べる幅・高さを変える（残りに動画）');
  const layoutButton = toolButton('', '区間セルを、動画の右に並べるか、下に並べるか');
  const flowButton = toolButton('流れる表示', '今のマスを下に出し、流れたマスを上へ動かす（まだのマスは見せない）');
  const liveButton = toolButton('', 'AI と一緒に見る：流れた部分に、相棒がひとことずつ返す（Sonnet 5.5 で、1回 約 $0.005）');
  const listenButton = toolButton('🎧 音声から', 'Windows 11 のライブキャプションで、流れている音声（ラジオ・字幕の無い動画や音声）を文字にしながら区間セルを作る');
  const reloadButton = toolButton('字幕を読み直す', 'YouTube の文字起こしを読み直す（字幕の言語を YouTube で切り替えたあとなど）');
  const closeButton = toolButton('ページに戻る ×', 'ページの表示に戻る（Esc）');
  const pickButton = toolButton('選ぶ', '押したマスを選ぶ（もう一度押すと外す。Ctrl+クリック・Shift+クリックでも選べます）');
  tools.append(pickButton, listenButton, liveButton, layoutButton, flowButton, keyOnlyButton, aiButton, askAiButton, translateButton, digestButton, spacingButton, smaller, bigger, widthButton, reloadButton, vocabButton, hexButton, closeButton);
  const head = el('header', 'reader-head');
  head.append(titleBox, tools);

  const choices = el('div', 'reader-choices-box'); // 字幕が無いときの選ぶ欄
  const listening = el('div', 'reader-listening'); // 聞き取り中の、まだ途中の文
  listening.hidden = true;
  const scroller = el('div', 'reader-scroll');
  const canvas = el('div', 'reader-canvas');
  scroller.append(canvas);

  const info = el('div', 'reader-info');
  const bar = el('footer', 'reader-bar');
  const prevButton = toolButton('‹', '前へ（←）');
  const nextButton = toolButton('›', '次へ（→・Space）');
  const count = el('span', 'reader-count');
  const heading = el('span', 'reader-heading');
  const progress = el('div', 'reader-progress');
  const progressFill = el('div', 'reader-progress-fill');
  progress.append(progressFill);
  const likeButton = toolButton('♡', 'このマスに ♥（L・押すたびに ♥1→♥2→♥3→なし）');
  const noteButton = toolButton('メモ', 'このマスにメモを書く（C。動画のときは下の一行の欄へ）');
  const askButton = toolButton('相棒に聞く', 'このマスについて、右の相棒に聞く（A）');
  const playButton = toolButton('▶', '再生・一時停止（Space）');
  const timeBox = el('span', 'reader-time');
  const repeatButton = toolButton('くり返す', 'このマスの区間をくり返し再生する（R。区間を選んでいれば回し方を選ぶ）');
  const setsButton = toolButton('組', '名前つきの組（選んだ区間と回し方）を呼ぶ');
  const SPEEDS = [0.75, 1, 1.25] as const;
  const speedButtons = SPEEDS.map((rate) => {
    const b = toolButton(rate === 1 ? '1×' : `${rate}×`, `再生の速さ ${rate} 倍。くり返しと一緒に使えます`);
    b.dataset.rate = String(rate);
    return b;
  });
  const liveBox = el('span', 'reader-live');
  bar.append(prevButton, count, nextButton, playButton, timeBox, liveBox, heading, progress, likeButton, noteButton, repeatButton, setsButton, ...speedButtons, askButton);
  const status = el('div', 'reader-status');
  // 一行の欄（plan-reader-video の V1。時刻のあるマスのときだけ）：打ち始めた時刻のマスに固定して書き、Enter でそのマスのメモに残す
  const line = el('form', 'reader-line');
  line.hidden = true;
  const pinBox = el('span', 'reader-line-pin');
  const pinPrev = toolButton('‹', '書く先のマスを一つ前へ');
  const pinNext = toolButton('›', '書く先のマスを一つ後ろへ');
  const lineInput = el('input', 'reader-line-input');
  lineInput.type = 'text';
  lineInput.maxLength = MAX_DRAFT_TEXT;
  lineInput.placeholder = '今のマスに書く（打ち始めた時刻のマスに残ります。Enter で残す・Esc で抜ける）';
  lineInput.setAttribute('aria-label', '今のマスに書く一行の欄');
  const writePlayButton = toolButton('', '書くあいだの再生（止める・0.75×・そのまま）。押すたびに替わります');
  const wideButton = toolButton('広げる', '2 行の欄で長く書く（今のメモも直せます）');
  // 書く先（V1c）：マスのメモ｜カード（このマスと結ぶ）。カードのときは結ぶ先のメモ（左の写しから。替えると下の区画もそのメモを開く）
  const toNote = toolButton('マス', '書く先：このマスのメモ（読む画面の記録に残る）');
  const toCard = toolButton('カード', '書く先：下の区画のカード（このマスと結ぶ）');
  const writeToBox = el('span', 'reader-line-to');
  writeToBox.append(toNote, toCard);
  const targetBox = el('label', 'reader-line-target');
  const targetSelect = el('select', 'reader-line-target-select');
  targetSelect.title = '結ぶ先のメモ（替えると、下の区画もそのメモを開きます）';
  targetBox.append(el('span', '', '結ぶ先'), targetSelect);
  // 書いたマスのほかの結び方（V2a-2b）：結ぶ先のカードを選んで結ぶ・このマスの字幕だけで結んだカードを作る
  const linkCardButton = toolButton('カードと結ぶ…', '結ぶ先のメモのカードを選んで、このマスと結ぶ（カードの文は変えません。✓ のカードは押すと外します）');
  const cellCardButton = toolButton('マスをカードに', 'このマスの字幕を、このマスと結んだカードにする（文は書きません）');
  const linkMenu = new CellMenu();
  line.append(pinBox, pinPrev, pinNext, lineInput, writeToBox, targetBox, linkCardButton, cellCardButton, writePlayButton, wideButton);
  // 選んだ区間の棚（plan-reader-video の V3b。区間セルと下の帯のあいだ）
  const shelf = el('div', 'reader-shelf');
  shelf.hidden = true;
  const shelfCount = el('span', 'reader-shelf-count');
  const shelfCard = toolButton('結んだカードを作る', '選んだ区間と結んだカードを 1 枚作る（一行の欄に書きかけがあれば、それを文にします）');
  const shelfLink = toolButton('カードと結ぶ…', '結ぶ先のメモのカードを選んで、選んだ区間を結ぶ（✓ のカードは押すと外す）');
  const shelfClear = toolButton('選ぶのをやめる', '選んだ区間を外す（Esc）');
  const shelfLoop = toolButton('くり返す…', '選んだ区間を、回し方を決めてくり返す（R）');
  const shelfSave = toolButton('組に保存…', '選んだ区間と今の回し方に名前を付けて残す（この動画の記録に。20 まで）');
  const shelfAsk = toolButton('AI に頼む…', '選んだ区間を範囲にして、頼み板を開く');
  shelf.append(shelfCount, shelfLoop, shelfCard, shelfLink, shelfAsk, shelfSave, shelfClear);
  // 全体の地図（plan-reader-video の V6d。考察の 全2）：動画全体の細い帯に ♥・メモ・結んだカードの点、チャプターの区切り、
  //   900 マスの外（斜線）、今の位置。押すとその時刻のマスへ。時刻のあるマスのときだけ
  const overview = el('div', 'reader-overview');
  overview.hidden = true;
  const mapBar = el('div', 'reader-map');
  mapBar.setAttribute('aria-label', '動画全体の地図（押すとその時刻のマスへ）');
  const mapNow = el('div', 'reader-map-now');
  const mapLegend = el('span', 'reader-map-legend');
  const exportButton = toolButton('コメント用に写す…', 'この動画と結んだ自分のカードを「3:04 …」の行にして、YouTube のコメント用に写す（貼って投稿するのは自分の手で）');
  overview.append(mapBar, mapLegend, exportButton);
  // 900 マスで切れたことの知らせ（V6d。考察の 全1・D13：まず知らせるだけ）
  const capNote = el('div', 'reader-cap');
  capNote.hidden = true;
  const capText = el('span', 'reader-cap-text');
  const capClose = toolButton('閉じる', 'この知らせを閉じる（読む画面が動いている間は、このページでは出しません）');
  capNote.append(capText, capClose);
  // YouTube のコメント用に写す（V6e。考察の 出1）：この動画と結んだ自分のカードを「m:ss 文」の行に。貼って投稿するのは自分の手で（§4）
  const exportBox = el('div', 'reader-export');
  exportBox.hidden = true;
  const exportText = el('textarea', 'reader-export-text');
  exportText.rows = 5;
  exportText.setAttribute('aria-label', 'YouTube のコメント用の文（直してから写せます）');
  const exportCount = el('span', 'reader-export-count');
  const exportCopy = toolButton('写す', '欄の文をクリップボードへ写す');
  const exportRedo = toolButton('作り直す', '今のカードから作り直す（欄で直した所は消えます）');
  const exportClose = toolButton('閉じる', 'この欄を閉じる（Esc）');
  const exportRow = el('div', 'reader-export-row');
  exportRow.append(exportCount, exportCopy, exportRedo, exportClose);
  exportBox.append(
    el('p', 'reader-export-note', 'この動画の区間と結んだ自分のカードを、時刻の順に「3:04 …」の行にします（字幕の本文と AI のカードは入れません）。直してから写せます。YouTube のコメント欄に貼って投稿するのは、自分の手で'),
    exportText,
    exportRow,
  );
  root.append(head, overview, capNote, exportBox, choices, scroller, listening, shelf, info, bar, line, status);
  document.body.append(root);

  // 「🔍 Grok に調べてもらう」の依頼の小窓（S3.11。reader/ask.ts）。ページの上に出すときは、読む画面（root）を隠して小窓だけにする
  let askHidRoot = false; // 小窓のために root を隠した（閉じたら戻す）
  const ask = new ReaderAsk({
    askLeft: (action) => askLeft(action),
    closed: (leaveReader) => {
      if (askHidRoot) root.hidden = false;
      askHidRoot = false;
      if (leaveReader) send({ type: 'setSidebar', side: 'reader', visible: false });
      else if (!root.hidden) root.focus();
    },
  });
  document.body.append(ask.element);

  // ---------- 状態 ----------
  let tabId: number | null = null;
  let url = '';
  let title = '';
  let cells: Cell[] = [];
  let current = 0;
  let maxReached = -1;
  let lastEdges = -1;
  let marks = new Map<string, CellMark>();
  let ai: ReaderAi | null = null;
  let perLine = 0;
  let writing = false; // メモを書いている途中
  // 一行の欄（V1）
  let pin: number | null = null; // 書く先のマス（打ち始めたときの今のマス。‹ › で付け替え。残すかやめるまで動かない）
  let held = false; // 書くあいだの再生を当てた（書き終えたら戻す）
  let pausedForWriting = false; // 書くために止めた
  let slowedFrom: (typeof SPEEDS)[number] | null = null; // 書くために遅くした前の速さ
  let escNoted = false; // 欄を抜けた直後の Esc で読む画面が閉じることを、一度知らせた
  let drafts = new Map<string, string>(); // 下書き（マスの指紋 → 書きかけ。古い順・10 まで）
  let links: ReaderLinksView | null = null; // 左が押す結んだカードの写し（D16。V1c）
  let cardSeq = 0; // 左への頼みの番号（readerCardDone で照らす）
  // 返事を待っているカード（番号 → 書いた文と書いたマス）。断られた・返事が無いときは下書きに戻す（D18）
  const waitingCards = new Map<number, { replyId: string; key: string; text: string; timer: number; late: boolean; ai?: true }>(); // ai：頼み板の AI のカード（V4b）
  const waitingLinks = new Map<number, { replyId: string; head: string; remove: boolean; many: boolean }>(); // 線を足す・外す頼み（番号 → カードの題）
  let targetSig = ''; // 結ぶ先の選び口の中身（同じなら作り直さない）
  let picked: number[] = []; // 選んだマスの番号（選んだ順。V3b）
  let sets: LoopSet[] = []; // 名前つきの組（この動画の記録。V3b-3）
  let pickMode = false; // 「選ぶ」を押してある（普通のクリックで選ぶ）
  let pickAnchor: number | null = null; // Shift+クリックの起点
  // 選んだ区間のくり返し（V3b-2）。休みと秒読みは見張り（700ms）とは別の時計で進める
  let loop: { cells: Cell[]; steps: LoopStep[]; pos: number; resting: boolean; restTimer: number; seekedAt: number; speedFrom: (typeof SPEEDS)[number] } | null = null;
  let seekAfterOpen: { video: string; start: number } | null = null; // 開き終えたら移る時刻（カードの「▶ 時刻」。V2a-3）
  // 下の区画との落ちてもよい連絡（V2b）：送った今のマスとチャプター（同じなら送らない）、カードの「マスで見る」で光らせているカード
  let readerShown = false; // 読む画面を出している（readerOpen で出し、閉じる・隠れた知らせで外す）
  let nowSig = '';
  let chaptersSig = '';
  let glow: { memoId: string; replyId: string; shown: boolean } | null = null; // shown：光らせて、知らせた
  // 頼み板（V4a）：この動画で使った AI の目安（読む画面の記録の aiSpent。見せるだけ。D6）、頼んでいる途中か、応用の題（次に聞くときの初めの文）
  let aiSpent = 0;
  let askBusy = false;
  let askTopic = '';
  // 900 マスで切れたこと（V6d）：end＝字幕の後ろを切った（at＝切った所、to＝字幕の終わり）、start＝聞き取りで古いマスを外した（at＝残った最初のマス）。
  //   total は切る前のマスの数
  let cut: { side: 'end' | 'start'; at: number; to: number; total: number } | null = null;
  let liveDropped = 0; // 聞き取りで外したマスの数（この聞き取りの間）
  const capClosed = new Set<string>(); // 知らせを閉じたページ（読む画面が動いている間だけ。覚えない）
  let mapModel: OverviewModel | null = null; // 今描いている全体の地図
  let exportSeq = 0; // 写す頼みの番号（readerExportDone で照らす）
  let exportTimer = 0;
  let openToken = 0;
  // 動画のとき
  // 時刻のあるマス（動画・音声）のとき。kind：YouTube・自分のファイル・ライブキャプションで聞き取り中
  let video: { kind: 'youtube' | 'file' | 'live'; id: string; duration: number } | null = null;
  let mediaPresent = false; // ページに動画・音声がある（聞き取りの時刻に使う）
  let liveSaved: NonNullable<ReaderSaved['liveCells']> = []; // このページで前に聞き取ったマス（字幕や文章を見ているあいだも残す）
  let playing = false;
  let videoTime = 0;
  let repeat = false; // 今のマスをくり返す
  let speed: (typeof SPEEDS)[number] = 1; // 再生の速さ（くり返しや場面の移動でも、ページ側が戻したら付け直す）
  let ja = new Map<string, string>(); // 区間セルの日本語（マスの指紋）
  let digest: number[] | null = null; // ♥ だけ再生：再生するマスの番号
  let digestPos = 0;
  let lastUserMove = 0; // 自分でマスを動かした時刻（直後は、再生位置に合わせて動かさない）
  let pollTimer = 0;
  let polling = false;
  // AI と一緒に見る
  let comments: LiveComment[] = [];
  let lastLiveIndex = -1; // ひとことを頼んだ最後のマス
  let liveBusy = false;
  let liveCount = 0;
  let liveCost = 0;
  let liveError = '';

  const saveSoon = debounce(() => void persist(), 800);

  // ---------- 開く・閉じる ----------
  async function open(id: number, pageUrl: string, pageTitle: string) {
    const token = ++openToken;
    Object.assign(prefs, loadPrefs()); // 左サイドバーが同じ設定（動画の幅）を読んでいるので、開くたびに読み直す
    // 一行の欄の書きかけは、前のページの下書きに残してから開く（文を黙って落とさない）
    if (lineInput.value.trim() && url && cells.length > 0) {
      stashLine();
      void persist();
    }
    resetLine();
    drafts = new Map();
    links = null;
    targetSig = '';
    seekAfterOpen = null;
    picked = [];
    pickAnchor = null;
    sets = [];
    stopLoop(false);
    tabId = id;
    url = pageUrl;
    title = pageTitle;
    cells = [];
    stopPolling();
    stopLive();
    video = null;
    liveSaved = [];
    repeat = false;
    speed = 1;
    ja = new Map();
    digest = null;
    glow = null;
    aiSpent = 0;
    cut = null;
    liveDropped = 0;
    mapModel = null;
    overview.hidden = true;
    capNote.hidden = true;
    closeExport();
    askMenu.close();
    canvas.replaceChildren();
    choices.replaceChildren();
    info.replaceChildren();
    sendNow();
    if (isVideoUrl(pageUrl)) {
      await openVideo(token, id, pageTitle);
      return;
    }
    if (isMediaFileUrl(pageUrl)) {
      await openFile(token, id, pageUrl);
      return;
    }
    setStatus('本文を取り出しています…');
    renderHead();
    const page = await extractPage(id);
    if (token !== openToken) return;
    if (!page) {
      setStatus('このページからは本文を取り出せませんでした。「ページに戻る」で元の表示に戻れます');
      return;
    }
    url = page.url || pageUrl;
    title = page.title || pageTitle;
    const chunks = splitText(page.text).slice(0, MAX_CELLS);
    const keys = cellKeys(chunks.map((c) => c.text));
    cells = chunks.map((c, index) => ({ ...c, index, key: keys[index], q: 0, r: 0 }));
    const saved = await loadReader(url);
    if (token !== openToken) return;
    marks = new Map(Object.entries(saved?.marks ?? {}));
    ai = saved?.ai ?? null;
    liveSaved = saved?.liveCells ?? [];
    const resume = saved?.position ? cells.findIndex((c) => c.key === saved.position) : -1;
    current = resume > 0 ? resume : 0;
    maxReached = current;
    lastEdges = -1;
    layoutCells();
    render();
    scrollToCurrent(false);
    setStatus(
      resume > 0
        ? `前回の続きから（${resume + 1} / ${cells.length}）`
        : `${cells.length} マスに分けました${page.truncated ? '（長いページなので、最初の部分だけ）' : ''}。← → で読み進めます`,
      4000,
    );
    if (liveSaved.length > 0) setStatus(`このページで前に聞き取った ${liveSaved.length} マスがあります。「🎧 音声から」で、その続きから聞き取れます`, 6000);
    reportProgress();
  }

  // YouTube の動画：字幕を時刻つきの区間セルにする
  async function openVideo(token: number, id: number, pageTitle: string) {
    video = { kind: 'youtube', id: '', duration: 0 };
    setStatus('YouTube の文字起こしを読み込んでいます…');
    renderHead();
    const t = await fetchTranscript(id);
    if (token !== openToken) return;
    if ('error' in t) {
      title = t.title || pageTitle;
      renderHead();
      setStatus(
        t.error === 'noTranscript'
          ? '文字起こし（字幕）を読めませんでした。字幕の無い動画か、YouTube がまだ用意できていません。YouTube の字幕（CC）をオンにしてから「字幕を読み直す」を押すと、読めることがあります'
          : '文字起こしを読み込めませんでした。動画のページを読み込み終えてから、「字幕を読み直す」を押してください',
      );
      if ('videoId' in t && t.videoId) url = canonicalVideoUrl(t.videoId);
      showChoices('字幕が読めないときは、ライブキャプションで音声から聞き取れます。');
      await showListened(token);
      return;
    }
    video = { kind: 'youtube', id: t.videoId, duration: t.duration };
    url = canonicalVideoUrl(t.videoId);
    title = t.title || pageTitle;
    await useTimedText(token, id, t, '字幕');
  }

  // 自分の音声・動画のファイル：横に同じ名前の字幕（.srt / .vtt）があれば読む。無ければ、読み込むか聞き取るかを選んでもらう
  async function openFile(token: number, id: number, pageUrl: string) {
    video = { kind: 'file', id: pageUrl, duration: 0 };
    title = fileNameOf(pageUrl);
    setStatus('同じ名前の字幕のファイルを探しています…');
    renderHead();
    const side = await readSidecarSubtitle(pageUrl);
    if (token !== openToken) return;
    const segments = side ? parseSubtitles(side.text) : [];
    if (segments.length > 0) {
      await useTimedText(token, id, { segments, chapters: [], duration: 0 }, `字幕のファイル「${side?.name}」`);
      return;
    }
    setStatus('');
    showChoices('字幕のファイル（.srt / .vtt など）を読み込むか、ライブキャプションで音声から聞き取ります。');
    await showListened(token);
  }

  // 字幕が無いページで、前に聞き取ったマスがあれば並べる（聞き取りは「🎧 音声から」で続きから）
  async function showListened(token: number) {
    renderPlayback();
    const saved = await loadReader(url);
    if (token !== openToken) return;
    liveSaved = saved?.liveCells ?? [];
    if (liveSaved.length === 0 || !saved) return;
    if (await enterLive(saved)) setStatus(`前に聞き取った ${cells.length} マスです。「🎧 音声から」で、その続きから聞き取れます`, 6000);
  }

  // 時刻つきの字幕から区間セルを作って、再生に合わせて動かし始める（YouTube・自分のファイル）
  async function useTimedText(token: number, id: number, t: { segments: TranscriptSegment[]; chapters: { start: number; title: string }[]; duration: number }, label: string) {
    stopLive();
    choices.replaceChildren();
    if (video?.kind === 'live') video = { kind: url.startsWith('file:') || isMediaFileUrl(url) ? 'file' : 'youtube', id: url, duration: 0 };
    const all = transcriptChunks({ videoId: '', title, duration: t.duration, chapters: t.chapters, segments: t.segments, source: 'captions' });
    const chunks = all.slice(0, MAX_CELLS);
    // 900 マスを超える字幕は後ろを切る（D13：まず知らせるだけ。切った所から字幕の終わりまでを、全体の地図の斜線に）
    cut =
      all.length > MAX_CELLS
        ? { side: 'end', at: all[MAX_CELLS].start, to: all.slice(MAX_CELLS).reduce((m, c) => Math.max(m, c.start, c.end), 0), total: all.length }
        : null;
    liveDropped = 0;
    const keys = cellKeys(chunks.map((c) => c.text));
    cells = chunks.map((c, index) => ({ ...c, index, key: keys[index], q: 0, r: 0 }));
    const saved = await loadReader(url);
    if (token !== openToken) return;
    marks = new Map(Object.entries(saved?.marks ?? {}));
    ai = saved?.ai ?? null;
    ja = new Map(Object.entries(saved?.ja ?? {}));
    drafts = parseDrafts(saved?.drafts);
    sets = parseLoopSets(saved?.sets);
    aiSpent = typeof saved?.aiSpent === 'number' && Number.isFinite(saved.aiSpent) && saved.aiSpent > 0 ? saved.aiSpent : 0;
    liveSaved = saved?.liveCells ?? [];
    const state = await videoState(id);
    if (token !== openToken) return;
    if (video && state?.duration) video.duration = state.duration;
    const resume = saved?.position ? cells.findIndex((c) => c.key === saved.position) : -1;
    const here = state ? cellAt(state.time) : -1;
    if (resume > 0 && (!state || state.time < 5)) {
      // 見始めたばかり：前回の続きへ
      current = resume;
      void seekVideo(id, cells[resume].start ?? 0);
      setStatus(`前回の続き（${timeLabel(cells[resume].start ?? 0)}）から`, 4000);
    } else {
      current = Math.max(0, here);
      setStatus(`${label}を ${cells.length} の区間セルにしました。マスを押すとその場面へ・Space で再生と一時停止`, 5000);
    }
    playing = !!state && !state.paused;
    videoTime = state?.time ?? 0;
    comments = saved?.comments ?? [];
    lastLiveIndex = current;
    liveCount = 0;
    liveCost = 0;
    liveError = '';
    maxReached = current;
    lastEdges = -1;
    layoutCells();
    render();
    renderCap();
    scrollToCurrent(false);
    reportProgress();
    startPolling();
    sendChapters();
    sendNow();
    if (seekAfterOpen) seekTo(seekAfterOpen.video, seekAfterOpen.start);
  }

  // 字幕が無いとき：字幕のファイルを読み込む・ライブキャプションで聞き取る
  function showChoices(message: string) {
    const box = el('div', 'reader-choices');
    box.append(el('p', '', message));
    const row = el('div', 'reader-choices-row');
    const file = el('input');
    file.type = 'file';
    file.accept = '.srt,.vtt,.json,.txt';
    file.hidden = true;
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (!f) return;
      void f.text().then((text) => {
        const segments = parseSubtitles(text);
        if (segments.length === 0) {
          setStatus('この字幕のファイルは読めませんでした（.srt・.vtt・Whisper の JSON・「0:05 本文」の行が読めます）', 6000);
          return;
        }
        if (tabId !== null) void useTimedText(openToken, tabId, { segments, chapters: [], duration: video?.duration ?? 0 }, `字幕のファイル「${f.name}」`);
      });
    });
    const pick = toolButton('字幕のファイルを読み込む…', '.srt・.vtt・Whisper の JSON・「0:05 本文」の行（YouTube の文字起こしのコピー）');
    pick.addEventListener('click', () => file.click());
    const listen = toolButton('🎧 ライブキャプションで聞き取る', 'Windows 11 のライブキャプションで、流れている音声を文字にしながら区間セルを作る');
    listen.addEventListener('click', () => void startLive());
    row.append(pick, listen, file);
    box.append(
      row,
      el('p', 'reader-choices-note', 'ライブキャプションは Windows 11 の機能です（Win+Ctrl+L でも開けます）。音声はパソコンの中で文字になり、どこにも送りません。初めてのときは、Windows の案内に従って言語（日本語など）を準備してください。'),
    );
    choices.replaceChildren(box);
  }

  // ---------- ライブキャプションで聞き取る（ラジオ・字幕の無い動画や音声） ----------
  let liveStartedAt = 0;
  let liveBase = 0; // 前に聞き取った分の続きの時刻
  // マスの時刻：ページの動画・音声の再生位置（押すとその場面へ）か、聞き始めてからの秒数
  let liveClock: 'media' | 'wall' = 'wall';
  const wallTime = () => liveBase + (captions.active ? (Date.now() - liveStartedAt) / 1000 : 0);
  let livePartial = '';
  let liveStatus: LiveStatus | null = null;
  const captions = new LiveCaptions({
    onSentence: (text) => addLiveText(text),
    onPartial: (text) => {
      livePartial = text;
      renderListening();
    },
    onStatus: (status) => {
      liveStatus = status;
      if (status === 'starting') setStatus('ライブキャプションを開いています…（初めてのときは、Windows の案内に従って言語を準備してください）');
      else if (status === 'unavailable') setStatus('この Windows にはライブキャプションがありません（Windows 11 22H2 以降の機能です）', 8000);
      else if (status === 'error') setStatus('ライブキャプションの文字を読めませんでした', 6000);
      else setStatus('聞き取りを始めました。流れている音声が、区間セルになっていきます', 5000);
      renderHead();
      renderListening();
    },
  });

  // 聞き取りのマスにする。saved があれば、前に聞き取ったマスを並べる（null なら、いまのマスのまま）。
  // あわせて、マスの時刻をページの再生位置にするか（自分のファイルなど）、聞き始めてからの秒数にするか（ラジオの生放送など）を決める
  async function enterLive(saved: ReaderSaved | null) {
    const id = tabId;
    if (id === null) return false;
    const token = openToken;
    if (saved !== null) {
      const list = (saved?.liveCells ?? []).filter((c) => c.text);
      const keys = cellKeys(list.map((c) => c.text));
      cells = list.map((c, index) => ({ text: c.text, head: false, para: c.para ?? false, start: c.start, end: c.end, index, key: keys[index], q: 0, r: 0 }));
      marks = new Map(Object.entries(saved?.marks ?? {}));
      ja = new Map(Object.entries(saved.ja ?? {}));
      drafts = parseDrafts(saved.drafts);
      sets = parseLoopSets(saved.sets);
      comments = saved?.comments ?? [];
      const resume = saved?.position ? cells.findIndex((c) => c.key === saved.position) : -1;
      current = resume >= 0 ? resume : Math.max(0, cells.length - 1);
      maxReached = current;
      repeat = false;
      digest = null;
      cut = null; // 字幕から切り替えたとき・前の聞き取りを並べ直したとき（外したマスは、この聞き取りの間だけ数える）
      liveDropped = 0;
      renderCap();
    }
    video = { kind: 'live', id: url, duration: 0 };
    const state = await videoState(id);
    if (token !== openToken || tabId !== id) return false;
    mediaPresent = !!state?.hasMedia;
    liveClock = mediaPresent && (state?.duration ?? 0) > 0 ? 'media' : 'wall';
    if (state) {
      videoTime = state.time;
      playing = !state.paused;
      if (liveClock === 'media') video.duration = state.duration;
    }
    lastEdges = -1;
    layoutCells();
    render();
    scrollToCurrent(false);
    renderHead();
    renderPlayback();
    startPolling();
    return true;
  }

  async function startLive() {
    if (tabId === null) return;
    choices.replaceChildren();
    let ok: boolean;
    if (video?.kind !== 'live') {
      // 字幕やページの文章のマスから切り替える：前に聞き取ったマスがあれば、その続きに足す
      await persist();
      const saved = await loadReader(url);
      ok = await enterLive(saved ?? { version: 1, url, title, savedAt: 0, position: null, marks: {} });
    } else {
      ok = await enterLive(null);
    }
    if (!ok) return;
    liveBase = liveClock === 'wall' && cells.length > 0 ? (cells[cells.length - 1].end ?? 0) + 1 : 0;
    liveStartedAt = Date.now();
    current = Math.max(0, cells.length - 1);
    lastLiveIndex = cells.length - 1; // 聞き取った分だけに、ひとことを返す
    liveCount = 0;
    liveCost = 0;
    liveError = '';
    render();
    scrollToCurrent(false);
    captions.start();
  }

  function stopLive() {
    if (!captions.active) return;
    captions.stop();
    liveStatus = null;
    livePartial = '';
    renderListening();
  }

  // 聞き取った文を、約70字までのマスに足していく（時刻は、ページの動画・音声があればその位置、無ければ聞き始めてからの秒数）
  function addLiveText(text: string) {
    if (video?.kind !== 'live') return;
    const now = liveClock === 'media' ? videoTime : wallTime();
    // 文が決まるのは話し終えてから：その文を話し始めたころを、マスの始まりにする
    const t = Math.max(0, now - Math.min(15, [...text].length / 8) - 1);
    const last = cells[cells.length - 1];
    const fits = last && !last.head && last.start !== undefined && [...last.text].length + [...text].length <= CHUNK && t >= last.start && t - last.start < 30;
    if (fits && last) {
      last.text = /[\x21-\x7e]$/.test(last.text) && /^[\x21-\x7e]/.test(text) ? `${last.text} ${text}` : last.text + text;
      last.end = now;
      last.key = cellKeys(cells.map((c) => c.text))[last.index];
    } else {
      const gap = last?.end !== undefined ? t - last.end > 6 || t < last.start! : true; // 間があいたら（戻したら）、段落を分ける
      cells.push({ text, head: false, para: gap, start: t, end: now, index: cells.length, key: '', q: 0, r: 0 });
      const keys = cellKeys(cells.map((c) => c.text));
      cells.forEach((c, i) => (c.key = keys[i]));
    }
    if (cells.length > MAX_CELLS) {
      // 900 マスを超えたら古いマスを外す（外したマスは記録にも残らない）。D13：知らせるだけ
      liveDropped += cells.length - MAX_CELLS;
      cells = cells.slice(-MAX_CELLS).map((c, i) => ({ ...c, index: i }));
      const first = cells[0].start ?? 0;
      cut = { side: 'start', at: first, to: first, total: MAX_CELLS + liveDropped };
      renderCap();
    }
    const follow = Date.now() - lastUserMove > 4000 || current >= cells.length - 2;
    layoutCells();
    if (follow) current = cells.length - 1;
    render();
    if (follow) scrollToCurrent(true);
    maybeComment();
    saveSoon();
  }

  // 聞き取り中の、まだ途中の文
  function renderListening() {
    const live = video?.kind === 'live' && captions.active;
    listening.hidden = !live;
    if (!live) return;
    listening.textContent = liveStatus === 'listening' ? `🎧 ${livePartial || '聞き取っています…'}` : '🎧 ライブキャプションを待っています…';
  }

  // その時刻の区間（見出しではないマス）
  function cellAt(time: number): number {
    let found = -1;
    for (const c of cells) {
      if (c.head || c.start === undefined) continue;
      if (c.start <= time + 0.3) found = c.index;
      else break;
    }
    return found;
  }

  function close() {
    openToken++;
    stopPolling();
    stopLive();
    digest = null;
    stopLoop(false);
    stashLine(); // 一行の欄の書きかけは下書きに残す
    resetLine();
    closeExport();
    void persist();
    hideNow();
    send({ type: 'setSidebar', side: 'reader', visible: false });
  }

  // ---------- 動画：再生位置を見る ----------
  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(() => void poll(), POLL_MS);
  }

  function stopPolling() {
    window.clearInterval(pollTimer);
    pollTimer = 0;
  }

  async function poll() {
    if (polling || !video?.id || tabId === null || document.visibilityState !== 'visible') return;
    polling = true;
    const id = tabId;
    try {
      const s = await videoState(id);
      if (!s || !video?.id || tabId !== id) return;
      mediaPresent = s.hasMedia;
      if (video.kind === 'youtube' && s.videoId && s.videoId !== video.id) {
        // ページの中で別の動画へ移った：その動画の区間セルを作り直す
        void persist();
        void open(id, canonicalVideoUrl(s.videoId), '');
        return;
      }
      if (s.ad) {
        // 広告の間は動かさない（移る場面は、広告のあとで YouTube が反映する）
        timeBox.textContent = '広告中…';
        return;
      }
      if (playing !== !s.paused || Math.floor(videoTime) !== Math.floor(s.time) || (video.kind === 'live' && liveClock === 'wall')) {
        playing = !s.paused;
        videoTime = s.time;
        renderPlayback();
      }
      if (s.paused) return;
      if (loop) {
        // 選んだ区間のくり返し：段の終わりか、段の外へ出たら次へ（移った直後は古い時刻を読むことがあるので見ない）
        const step = loop.steps[loop.pos];
        if (!loop.resting && step && Date.now() - loop.seekedAt > 1200 && (s.time >= step.end - 0.2 || s.time < step.start - 1.5)) void advanceLoop(id);
        return;
      }
      if (digest) {
        const target = cells[digest[digestPos]];
        if (target && s.time >= (target.end ?? 0) - 0.2) {
          digestPos++;
          if (digestPos >= digest.length) {
            digest = null;
            void togglePlay(id);
            renderHead();
            setStatus('♥ を付けた区間を、最後まで再生しました', 4000);
          } else {
            playCell(digest[digestPos]);
          }
        }
        return;
      }
      const cell = cells[current];
      if (repeat && cell?.start !== undefined && cell.end !== undefined) {
        if (s.time >= cell.end - 0.15 || s.time < cell.start - 1) {
          void seekVideo(id, cell.start).then(() => {
            if (speed !== 1 && tabId === id) void setPlaybackRate(id, speed);
          });
        }
        return;
      }
      if (video.kind !== 'live' && Date.now() - lastUserMove >= 1500) {
        const i = cellAt(s.time);
        if (i >= 0 && i !== current) go(i, true, false);
      }
      if (video.kind !== 'live') maybeComment(); // 聞き取りのときは、文が届くたびに
    } finally {
      polling = false;
    }
  }

  // ---------- AI と一緒に見る ----------
  function maybeComment() {
    if (prefs.liveAi === 'off' || liveBusy || liveCount >= LIVE_CAP || current <= lastLiveIndex) return;
    const from = cells.slice(lastLiveIndex + 1, current + 1).find((c) => !c.head);
    const to = cells[current];
    if (!from || from.start === undefined || to.start === undefined) return;
    const span = (to.end ?? to.start) - from.start;
    const chapterTurned = cells.slice(lastLiveIndex + 1, current + 1).some((c) => c.head);
    if (span >= LIVE_EVERY[prefs.liveAi] || (chapterTurned && span >= 30)) void runLive(lastLiveIndex + 1, current);
  }

  async function runLive(fromIndex: number, toIndex: number) {
    liveBusy = true;
    lastLiveIndex = toIndex;
    renderPlayback();
    const part = cells.slice(fromIndex, toIndex + 1).filter((c) => !c.head);
    const before = cells.slice(Math.max(0, fromIndex - 3), fromIndex).filter((c) => !c.head);
    const chapter = [...cells.slice(0, toIndex + 1)].reverse().find((c) => c.head)?.text;
    const second = secondVoice();
    try {
      if (await pageIsBlocked(url)) return; // 字幕の自動送信は、渡し止めなら黙ってやめる
      const p = readAiPrefs();
      const result = await liveComments(
        {
          title,
          chapter,
          earlier: before.map((c) => c.text).join(' ').slice(-400),
          excerpt: part.map((c) => c.text).join(' ').slice(0, 2400),
          recent: comments.slice(-4).map((c) => ({ name: c.name, text: c.text })),
        },
        second,
        { apiKey, practice: p.practice },
      );
      const key = cells[toIndex]?.key;
      if (!key) return;
      for (const c of result.comments) {
        comments.push({ key, who: c.who, name: c.who === 'second' && second ? second.name : 'Claude', text: c.text, at: Date.now() });
      }
      comments = comments.slice(-300);
      liveCount += 1;
      liveCost += result.cost;
      liveError = '';
      render();
      saveSoon();
    } catch (error) {
      liveError = error instanceof Error ? error.message : String(error);
    } finally {
      liveBusy = false;
      renderPlayback();
    }
  }

  // 二人目の相棒（右の相棒の「メンバー」に入っているとき。前の形では ⚙ の「二人目の相棒を出す」）
  function secondVoice(): SecondVoice | null {
    try {
      const s = JSON.parse(localStorage.getItem('honeycomb.ai') ?? '{}') as { members?: unknown; second?: { enabled?: unknown; name?: unknown; role?: unknown } };
      const v = s.second;
      const joined = Array.isArray(s.members) ? s.members.includes('second') : v?.enabled === true;
      if (!v || !joined) return null;
      const role = typeof v.role === 'string' && v.role in SECOND_ROLES ? (v.role as SecondRole) : 'tsukkomi';
      return { name: typeof v.name === 'string' && v.name.trim() ? v.name.trim().slice(0, 12) : 'ミツ', role };
    } catch {
      return null;
    }
  }

  // 流れる表示（動画のとき）
  const flowing = () => !!video?.id && (prefs.flow || video.kind === 'live');
  const hidesFuture = () => flowing() && video?.kind !== 'live'; // 聞き取りのときは、まだのマスが無い

  // このマスへ移って、その区間を再生する
  function playCell(index: number) {
    const cell = cells[index];
    if (!cell || tabId === null) return;
    go(index, true, false);
    lastUserMove = Date.now();
    const id = tabId;
    void seekVideo(id, cell.start ?? 0, true).then(() => {
      if (speed !== 1 && tabId === id) void setPlaybackRate(id, speed);
    });
  }

  async function setSpeed(rate: (typeof SPEEDS)[number]) {
    if (tabId === null || !video) return;
    const applied = await setPlaybackRate(tabId, rate);
    if (applied === null || Math.abs(applied - rate) > 0.05) {
      setStatus('このページの再生の速さは変えられませんでした', 4000);
      return;
    }
    speed = rate;
    renderPlayback();
    setStatus(rate === 1 ? '再生の速さを 1 倍に戻しました' : `再生の速さを ${rate} 倍にしました。くり返しと一緒に使えます`, 2500);
  }

  async function playPause() {
    if (tabId === null) return;
    const started = await togglePlay(tabId);
    if (started === null) return;
    playing = started;
    renderPlayback();
  }

  function toggleRepeat() {
    if (!video?.id) return;
    if (loop) {
      stopLoop(true);
      return;
    }
    if (picked.length > 0) {
      openLoopMenu(repeatButton);
      return;
    }
    repeat = !repeat;
    digest = null;
    renderPlayback();
    renderHead();
    setStatus(repeat ? 'このマスの区間をくり返します（R でやめる）' : 'くり返しをやめました', 2500);
  }

  function toggleDigest() {
    if (!video?.id || tabId === null) return;
    if (digest) {
      digest = null;
      renderHead();
      setStatus('♥ だけ再生をやめました', 2500);
      return;
    }
    const list = cells.filter((c) => !c.head && (marks.get(c.key)?.liked ?? 0) > 0).map((c) => c.index);
    if (list.length === 0) {
      setStatus('♥ を付けたマスがありません（L で付けられます）', 4000);
      return;
    }
    digest = list;
    digestPos = 0;
    repeat = false;
    renderHead();
    renderPlayback();
    setStatus(`♥ を付けた ${list.length} の区間を、順に再生します`, 3000);
    playCell(list[0]);
  }

  function renderPlayback() {
    playButton.textContent = playing ? '❚❚' : '▶';
    repeatButton.setAttribute('aria-pressed', String(repeat || loop !== null));
    setsButton.hidden = !lineUsable();
    setsButton.textContent = sets.length > 0 ? `組 ${sets.length}` : '組';
    for (const b of speedButtons) b.setAttribute('aria-pressed', String(Number(b.dataset.rate) === speed));
    timeBox.textContent = !video?.id
      ? ''
      : video.kind === 'live' && liveClock === 'wall'
        ? `🎧 ${timeLabel(wallTime())}`
        : `${timeLabel(videoTime)}${video.duration ? ` / ${timeLabel(video.duration)}` : ''}`;
    // AI と一緒に見ているときの様子
    const live = video?.id && prefs.liveAi !== 'off';
    liveBox.hidden = !live;
    if (live) {
      const names = secondVoice() ? `Claude と ${secondVoice()?.name}` : 'Claude';
      liveBox.textContent = liveBusy
        ? `💬 ${names}：考えています…`
        : liveError
          ? `💬 うまくいきませんでした：${liveError}`
          : liveCount >= LIVE_CAP
            ? `💬 この動画のひとことは ${LIVE_CAP} 回まで`
            : `💬 ${names}と見ています${liveCost > 0 ? `（約 $${liveCost.toFixed(3)}）` : ''}`;
    }
    renderMapNow();
  }

  // ---------- 並べる ----------
  function geometry() {
    const R = video ? prefs.videoSize : prefs.size;
    // 動画の横に並べるときは狭いので、まわりの余白を小さく
    return { R, W: SQRT3 * R, P: video ? 12 : PAD };
  }

  function layoutCells() {
    const { W, P } = geometry();
    const width = scroller.clientWidth || 900;
    perLine = clamp(Math.floor((width - P * 2 - W / 2) / W), 2, 12);
    const [lineStep, headStep] = prefs.spacing === 'roomy' ? [3, 4] : [2, 3];
    const positions = layout(cells, perLine, lineStep, headStep);
    cells.forEach((cell, i) => Object.assign(cell, toAxial(positions[i])));
  }

  // メモと解説を、行の間の空いたマスに置く
  function annotations(): Annotation[] {
    const taken = new Set(cells.map((c) => hexKey(c)));
    const out: Annotation[] = [];
    const place = (cell: Cell): Hex | null => {
      const order = [DIRECTIONS[5], DIRECTIONS[4], DIRECTIONS[0], DIRECTIONS[3], DIRECTIONS[2], DIRECTIONS[1]]; // 下 → 左下 → 右 → 左 → 上
      const seen = new Set([hexKey(cell)]);
      const queue: Hex[] = [{ q: cell.q, r: cell.r }];
      for (let i = 0; i < queue.length && i < 60; i++) {
        for (const d of order) {
          const h = { q: queue[i].q + d.q, r: queue[i].r + d.r };
          const key = hexKey(h);
          if (seen.has(key)) continue;
          seen.add(key);
          const column = h.q + Math.floor(h.r / 2);
          if (!taken.has(key) && h.r >= 0 && column >= 0 && column < perLine) return h;
          queue.push(h);
        }
      }
      return null;
    };
    for (const cell of cells) {
      const mark = marks.get(cell.key);
      const notes: Omit<Annotation, 'pos'>[] = [];
      if (mark?.note) notes.push({ cell: cell.index, kind: 'note', text: mark.note });
      for (const t of ai?.terms ?? []) {
        if (t.key === cell.key) notes.push({ cell: cell.index, kind: 'term', title: t.term, text: t.explanation });
      }
      for (const c of comments) {
        if (c.key === cell.key) notes.push({ cell: cell.index, kind: 'ai', who: c.who, title: c.name, text: c.text });
      }
      for (const n of notes) {
        const pos = place(cell);
        if (!pos) continue;
        taken.add(hexKey(pos));
        out.push({ ...n, pos });
      }
    }
    return out;
  }

  // ---------- 描く ----------
  function render() {
    const { R, W, P } = geometry();
    // マスの中心。左端・上端のマスがはみ出さないよう、半マス分ずらす
    const xy = (h: Hex) => ({ x: P + W / 2 + W * (h.q + h.r / 2), y: P + R + 1.5 * R * h.r });
    const notes = annotations();
    const maxRow = Math.max(0, ...cells.map((c) => c.r), ...notes.map((n) => n.pos.r));
    canvas.style.width = `${P * 2 + W * (perLine + 0.5)}px`;
    canvas.style.height = `${P * 2 + 1.5 * R * maxRow + 2 * R + scroller.clientHeight / 2}px`;
    canvas.style.setProperty('--r', `${R}px`);
    const nodes: HTMLElement[] = [];
    for (const cell of cells) {
      const { x, y } = xy(cell);
      const node = hexNode('rcell', x, y, W, R);
      node.dataset.index = String(cell.index);
      if (cell.head) node.classList.add('head');
      const mark = marks.get(cell.key);
      if (mark?.liked) node.classList.add(`liked-${mark.liked}`);
      const level = ai?.levels[cell.key] ?? 0;
      if (level) node.classList.add(`key-${level}`);
      if (prefs.keyOnly && !level && !cell.head) node.classList.add('faint');
      if (cell.index === current) node.classList.add('current');
      if (hidesFuture() && cell.index > current) node.classList.add('future');
      const inner = node.firstElementChild as HTMLElement;
      const num = cell.start !== undefined ? timeLabel(cell.start) : String(cell.index + 1);
      inner.append(el('span', cell.start !== undefined ? 'rcell-num time' : 'rcell-num', num), el('div', 'rcell-text', cell.text));
      const line = ja.get(cell.key);
      if (line) inner.append(el('div', 'rcell-ja', line));
      if (mark?.liked) inner.append(el('span', 'rcell-like', '♥'.repeat(mark.liked)));
      nodes.push(node);
    }
    for (const n of notes) {
      const { x, y } = xy(n.pos);
      const node = hexNode(`rcell annot ${n.kind}${n.who ? ` ${n.who}` : ''}`, x, y, W, R);
      node.dataset.index = String(n.cell);
      if (hidesFuture() && n.cell > current) node.classList.add('future');
      const inner = node.firstElementChild as HTMLElement;
      if (n.title) inner.append(el('div', 'rcell-term', n.kind === 'ai' ? `💬 ${n.title}` : n.title));
      inner.append(el('div', 'rcell-text', n.kind === 'note' ? `✎ ${n.text}` : n.text));
      node.title = n.kind === 'note' ? `${n.cell + 1} 番のマスへのメモ` : n.kind === 'ai' ? `${n.title} のひとこと` : `${n.cell + 1} 番のマスの「${n.title}」の解説`;
      nodes.push(node);
    }
    canvas.replaceChildren(...nodes);
    renderLinkBadges();
    renderGlow();
    renderPicks();
    requestAnimationFrame(fitText);
    renderMap();
    renderBar();
    renderHead();
  }

  // 入りきらない文字は、少し小さくする
  function fitText() {
    for (const text of canvas.querySelectorAll<HTMLElement>('.rcell-text')) {
      let size = Number.parseFloat(getComputedStyle(text).fontSize);
      for (let i = 0; i < 8 && text.scrollHeight > text.clientHeight + 1 && size > 9; i++) {
        size -= 0.75;
        text.style.fontSize = `${size}px`;
      }
    }
  }

  function renderHead() {
    let host = '';
    try {
      host = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      host = '';
    }
    const size = cells.length ? (video ? `${cells.length} の区間セル` : `${cells.length} マス`) : '';
    titleBox.replaceChildren(el('strong', '', title || 'ページ'), el('span', '', [host, size].filter(Boolean).join('・')));
    // 動画のときだけのボタン
    const isVideo = !!video;
    for (const b of [digestButton, widthButton, reloadButton, playButton, repeatButton, ...speedButtons, layoutButton, flowButton, liveButton]) b.hidden = !isVideo;
    translateButton.hidden = !cells.some((c) => c.start !== undefined && !c.head);
    translateButton.textContent = ja.size > 0 ? '日本語にする ✓' : '日本語にする';
    reloadButton.hidden = !(video?.kind === 'youtube' || video?.kind === 'file');
    askAiButton.hidden = videoKeyNow() === null; // 結果はこの動画と結んだカードになるので、YouTube・自分のファイルだけ（S1）
    if (video?.kind === 'live') flowButton.hidden = true; // 聞き取りのときは、いつも流れる表示
    listenButton.textContent = captions.active ? '🎧 聞き取りをやめる' : '🎧 音声から';
    listenButton.setAttribute('aria-pressed', String(captions.active));
    timeBox.hidden = !isVideo;
    digestButton.setAttribute('aria-pressed', String(!!digest));
    widthButton.textContent = prefs.videoLayout === 'bottom' ? `高さ ${prefs.videoHeight}` : `幅 ${prefs.videoWidth}`;
    layoutButton.textContent = prefs.videoLayout === 'bottom' ? '下に並べる' : '右に並べる';
    flowButton.setAttribute('aria-pressed', String(prefs.flow));
    liveButton.textContent = `AI と見る：${LIVE_LABEL[prefs.liveAi]}`;
    liveButton.setAttribute('aria-pressed', String(prefs.liveAi !== 'off'));
    keyOnlyButton.setAttribute('aria-pressed', String(prefs.keyOnly));
    keyOnlyButton.disabled = !ai;
    vocabButton.disabled = !ai?.terms.length;
    aiButton.textContent = ai ? 'AI の要点 ✓' : 'AI で要点';
    spacingButton.textContent = prefs.spacing === 'roomy' ? '間：ゆったり' : '間：ふつう';
  }

  function renderBar() {
    renderPlayback();
    renderLine();
    const cell = cells[current];
    count.textContent = cells.length ? `${current + 1} / ${cells.length}` : '';
    const lastHead = [...cells.slice(0, current + 1)].reverse().find((c) => c.head);
    heading.textContent = lastHead?.text ?? '';
    progressFill.style.width = cells.length ? `${((maxReached + 1) / cells.length) * 100}%` : '0';
    const mark = cell ? marks.get(cell.key) : undefined;
    likeButton.textContent = mark?.liked ? `♥${mark.liked}` : '♡';
    likeButton.classList.toggle('on', !!mark?.liked);
    if (!writing) renderInfo();
  }

  // 今のマスのメモと、言葉の解説
  function renderInfo() {
    const cell = cells[current];
    if (!cell) {
      info.replaceChildren();
      return;
    }
    const parts: HTMLElement[] = [];
    const mark = marks.get(cell.key);
    if (mark?.note) parts.push(el('div', 'reader-note', `✎ ${mark.note}`));
    for (const t of ai?.terms ?? []) {
      if (t.key === cell.key) {
        const row = el('div', 'reader-term');
        const add = toolButton('＋単語帳', 'この言葉を単語帳のカードにする');
        add.classList.add('reader-term-add');
        add.addEventListener('click', () => addTerms([t]));
        row.append(el('strong', '', t.term), document.createTextNode(`：${t.explanation}`), add);
        parts.push(row);
      }
    }
    const level = ai?.levels[cell.key];
    if (level) parts.unshift(el('div', 'reader-keymark', `要点 ${'★'.repeat(level)}`));
    info.replaceChildren(...parts);
    info.hidden = parts.length === 0;
  }

  // 言葉の解説を、単語帳のカードにする（同じ言葉がもうあれば、単語帳が入れない）
  function addTerms(terms: ReaderAi['terms']) {
    if (terms.length === 0) {
      setStatus('このマスには言葉の解説がありません（「AI で要点」で付けられます）', 4000);
      return;
    }
    const cards = terms.map((t) => {
      const cell = cells.find((c) => c.key === t.key);
      const link = cell?.start !== undefined ? timedUrl(url, cell.start) : url;
      return {
        kind: 'word' as const,
        front: t.term,
        back: t.explanation,
        example: cell?.text.slice(0, 300),
        source: /^https?:\/\//i.test(link) ? { url: link, title } : undefined,
      };
    });
    askLeft({ command: 'addCards', cards });
    setStatus(`${cards.length === 1 ? `「${cards[0].front}」` : `言葉 ${cards.length} 個`}を単語帳に入れました（同じ言葉がもうあれば入れません）`, 5000);
  }

  function setStatus(text: string, hideAfter = 0) {
    status.textContent = text;
    status.hidden = !text;
    if (hideAfter) {
      window.setTimeout(() => {
        if (status.textContent === text) status.hidden = true;
      }, hideAfter);
    }
  }

  // ---------- 全体の地図・900 マスの知らせ（plan-reader-video の V6d） ----------
  const MAP_NAME: Record<OverviewKind, string> = { heart: '♥', note: 'メモ', card: 'カード', ai: 'AI' };
  const mapPct = (f: number) => `${(f * 100).toFixed(3)}%`;

  // 時刻のあるマスのときだけ。点・区切り・斜線は描き直し、今の位置は renderMapNow（再生の見張りのたびに）
  function renderMap() {
    const items = linksNow()?.items ?? [];
    const mapCells = lineUsable()
      ? cells.map((c) => {
          const mark = marks.get(c.key);
          return { head: c.head, start: c.start, end: c.end, liked: !!mark?.liked, note: !!mark?.note };
        })
      : [];
    const model = overviewModel({
      duration: video?.duration ?? 0,
      cells: mapCells,
      cards: items.map((item) => ({ spans: item.spans, ai: item.ai })),
      cut: cut ? (cut.side === 'end' ? { from: cut.at, to: cut.to } : { from: 0, to: cut.at }) : null,
    });
    mapModel = mapCells.length > 0 && model.length > 0 ? model : null;
    overview.hidden = !mapModel;
    exportButton.hidden = video?.kind !== 'youtube' || videoKeyNow() === null;
    if (!mapModel) {
      mapBar.replaceChildren();
      return;
    }
    const nodes: HTMLElement[] = [];
    if (mapModel.cut) {
      const part = el('div', 'reader-map-cut');
      part.style.left = mapPct(mapModel.cut.from);
      part.style.width = `max(3px, ${mapPct(mapModel.cut.to - mapModel.cut.from)})`;
      nodes.push(part);
    }
    for (const c of mapModel.chapters) {
      const tick = el('i', 'reader-map-chapter');
      tick.style.left = mapPct(c.at);
      nodes.push(tick);
    }
    for (const p of mapModel.points) {
      const dot = el('i', `reader-map-pt ${p.kind}`);
      dot.style.left = mapPct(p.at);
      nodes.push(dot);
    }
    nodes.push(mapNow);
    mapBar.replaceChildren(...nodes);
    // 凡例と数（♥・メモはマスの数、カード・AI は結んだカードの枚数）
    const sums: Record<OverviewKind, number> = {
      heart: mapCells.filter((c) => c.liked && !c.head).length,
      note: mapCells.filter((c) => c.note && !c.head).length,
      card: items.filter((i) => !i.ai).length,
      ai: items.filter((i) => i.ai).length,
    };
    mapLegend.replaceChildren(
      ...OVERVIEW_KINDS.map((kind) => {
        const item = el('span');
        item.append(el('i', `reader-map-key ${kind}`), `${MAP_NAME[kind]} ${sums[kind]}`);
        return item;
      }),
    );
    renderMapNow();
  }

  function renderMapNow() {
    if (!mapModel) return;
    const t = video?.kind === 'live' && liveClock === 'wall' ? wallTime() : videoTime;
    mapNow.style.left = mapPct(clamp(t / mapModel.length, 0, 1));
  }

  // 帯の上の位置（0〜1）
  function mapFraction(e: MouseEvent): number {
    const r = mapBar.getBoundingClientRect();
    return r.width > 0 ? (e.clientX - r.left) / r.width : 0;
  }

  const cutLabel = () => (cut?.side === 'start' ? '外した古いマスの所' : '900 マスの外');

  // 900 マスの知らせ：切れたときだけ。閉じたら、読む画面が動いている間はこのページでは出さない
  function renderCap() {
    capNote.hidden = !cut || capClosed.has(url);
    if (!cut || capNote.hidden) return;
    capText.textContent = capNotice({ side: cut.side, at: cut.at, duration: video?.duration ?? 0, total: cut.total, kept: MAX_CELLS });
  }

  // ---------- YouTube のコメント用に写す（plan-reader-video の V6e。考察の 出1） ----------
  //   左に readerExport で頼み、台帳全体からこの動画と結んだ自分のカード（AI・やり取りのカード、文の無いカードは入れない）を受けて
  //   「m:ss 文」の行にする。欄は直せる。写すのは C++ のクリップボード（clipboardWrite。今の道）。貼って投稿するのは利用者（§4）
  function openExport() {
    const key = videoKeyNow();
    if (video?.kind !== 'youtube' || !key) return;
    exportBox.hidden = false;
    exportText.value = '';
    exportCopy.disabled = true;
    exportCount.classList.remove('over');
    exportCount.textContent = 'カードを集めています…';
    const seq = ++exportSeq;
    window.clearTimeout(exportTimer);
    exportTimer = window.setTimeout(() => {
      if (seq === exportSeq) exportCount.textContent = '左サイドバーから返事がありませんでした。「作り直す」でもう一度頼めます';
    }, 5000);
    askLeft({ command: 'readerExport', seq, video: key });
  }

  function onExportDone(done: { seq: number; cards: unknown }) {
    if (done.seq !== exportSeq || exportBox.hidden) return;
    window.clearTimeout(exportTimer);
    const cards = parseExportCards(done.cards);
    if (!cards) {
      exportCount.textContent = 'メモの台帳をまだ読めていません。少し待ってから「作り直す」を押してください';
      return;
    }
    if (cards.length === 0) {
      exportCount.textContent = 'この動画と結んだ、自分の書いたカードがありません（AI のカード・やり取りのカード・字幕だけのカードは入れません）';
      return;
    }
    exportText.value = commentText(cards).text;
    renderExportCount();
    exportText.focus();
    exportText.setSelectionRange(0, 0);
  }

  // 欄の行の数と字数（直したら数え直す）。YouTube のコメントの上限の目安を超えたら知らせる（切らない）
  function renderExportCount(done = '') {
    const value = exportText.value;
    const lines = value.split('\n').filter((s) => s.trim()).length;
    const chars = [...value].length;
    const over = chars > COMMENT_MAX;
    exportCopy.disabled = !value.trim();
    exportCount.classList.toggle('over', over);
    exportCount.textContent = `${done}${lines} 行・${chars} 字${over ? `（YouTube のコメントは ${COMMENT_MAX} 字までの目安なので、長すぎます）` : ''}`;
  }

  async function copyExport() {
    const text = exportText.value;
    if (!text.trim()) return;
    const reply = await request((requestId) => ({ type: 'clipboardWrite', requestId, text, html: '' }), 8_000).catch(() => null);
    if (reply?.type === 'clipboardWritten' && reply.ok) {
      renderExportCount('写しました（貼って投稿するのは自分の手で）：');
      return;
    }
    exportText.focus();
    exportText.select();
    exportCount.textContent = '写せませんでした。文を選んだので、Ctrl+C で写せます';
  }

  function closeExport(focus = false) {
    exportSeq++; // 遅れて来た返事は使わない
    window.clearTimeout(exportTimer);
    exportBox.hidden = true;
    exportText.value = '';
    if (focus) root.focus();
  }

  // ---------- 読み進める ----------
  // seekToo：動画のとき、その場面へ移す（再生位置に合わせて動かすときは false）
  function go(index: number, smooth = true, seekToo = true) {
    if (!cells.length) return;
    current = clamp(index, 0, cells.length - 1);
    if (video?.id && (video.kind !== 'live' || liveClock === 'media') && seekToo && tabId !== null) {
      lastUserMove = Date.now();
      digest = null;
      if (loop) stopLoop(true);
      lastLiveIndex = current - 1; // 飛ばした部分には、ひとことを返さない
      void seekVideo(tabId, cells[current].start ?? 0);
    }
    maxReached = Math.max(maxReached, current);
    for (const node of canvas.querySelectorAll('.rcell.current')) node.classList.remove('current');
    canvas.querySelector(`.rcell:not(.annot)[data-index="${current}"]`)?.classList.add('current');
    if (hidesFuture()) {
      // まだのマスは見せない（流れて来たら下に出る）
      for (const node of canvas.querySelectorAll<HTMLElement>('.rcell[data-index]')) node.classList.toggle('future', Number(node.dataset.index) > current);
    }
    renderBar();
    scrollToCurrent(smooth);
    reportProgress();
    saveSoon();
    sendNow();
  }

  function step(delta: number) {
    if (!prefs.keyOnly || !ai) {
      go(current + delta);
      return;
    }
    // 要点だけ：要点のマス（と見出し）をたどる
    for (let i = current + delta; i >= 0 && i < cells.length; i += delta) {
      if (ai.levels[cells[i].key] || cells[i].head) {
        go(i);
        return;
      }
    }
  }

  function scrollToCurrent(smooth: boolean) {
    const cell = cells[current];
    if (!cell) return;
    const { R, P } = geometry();
    const y = P + 1.5 * R * cell.r + R;
    // 流れる表示では、今のマスを下の方に（流れたマスが上へ動いていく）
    const at = flowing() ? scroller.clientHeight - R * 1.6 : scroller.clientHeight / 2;
    scroller.scrollTo({ top: Math.max(0, y - at), behavior: smooth ? 'smooth' : 'auto' });
  }

  // 読み進みを、タブの六角形の辺に（最後まで読んだら、相棒にも伝わる）
  function reportProgress() {
    if (tabId === null || cells.length === 0) return;
    const finished = maxReached >= cells.length - 1;
    const edges = finished ? 6 : Math.floor(((maxReached + 1) / cells.length) * 6);
    if (edges === lastEdges) return;
    lastEdges = edges;
    askLeft({ command: 'readerProgress', id: tabId, edges, finished: finished && cells.length >= 6 });
  }

  // ---------- 印 ----------
  function setMark(cell: Cell, patch: Partial<CellMark>) {
    const next = { liked: 0, ...marks.get(cell.key), ...patch };
    if (!next.liked && !next.note) marks.delete(cell.key);
    else marks.set(cell.key, next);
    render();
    saveSoon();
  }

  function cycleLike() {
    const cell = cells[current];
    if (!cell) return;
    setMark(cell, { liked: ((marks.get(cell.key)?.liked ?? 0) + 1) % 4 });
  }

  // 2 行の欄（target：書くマス。無ければ今のマス。extra：一行の欄から「広げる」で持ってきた書きかけ）
  function openNoteForm(target?: Cell, extra = '') {
    const cell = target ?? cells[current];
    if (!cell) return;
    writing = true;
    const form = el('form', 'reader-note-form');
    const text = el('textarea', 'reader-note-input');
    text.rows = 2;
    text.placeholder = `${cell.index + 1} 番のマスへのメモ（Ctrl+Enter で残す・Esc でやめる）`;
    text.value = [marks.get(cell.key)?.note ?? '', extra].filter(Boolean).join('\n');
    const save = el('button', 'reader-tool', '残す');
    save.type = 'submit';
    const remove = el('button', 'reader-tool', 'メモを消す');
    remove.type = 'button';
    remove.hidden = !marks.get(cell.key)?.note;
    const cancel = el('button', 'reader-tool', 'やめる');
    cancel.type = 'button';
    const done = () => {
      writing = false;
      renderInfo();
      root.focus();
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const note = text.value.trim().slice(0, 500);
      writing = false;
      setMark(cell, { note: note || undefined });
      root.focus();
    });
    remove.addEventListener('click', () => {
      writing = false;
      setMark(cell, { note: undefined });
      root.focus();
    });
    cancel.addEventListener('click', done);
    text.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) form.requestSubmit();
      if (e.key === 'Escape') done();
    });
    const row = el('div', 'reader-note-actions');
    row.append(save, remove, cancel);
    form.append(text, row);
    info.hidden = false;
    info.replaceChildren(form);
    text.focus();
  }

  // ---------- 一行の欄（plan-reader-video の V1a・V1b） ----------
  //   打ち始めたときの今のマスに固定し（‹ › で付け替え）、Enter でそのマスのメモに足す。書くあいだの再生は設定のとおり止める・遅くする・そのまま
  //   Esc で書きかけを下書きに残して欄を抜ける（抜けると一文字のキーが効く）。下書きは読む画面の記録に、マスごとに 10 件まで
  let holdTask: Promise<void> | null = null; // 書くあいだの再生を当てている途中（戻す前に待つ）
  const lineUsable = () => !!video && cells.some((c) => c.start !== undefined && !c.head);
  // 書く先のマスの番号：固定していればそのマス。無ければ今のマス（見出しのマスなら、その次のマス）
  const writeIndex = (): number => pin ?? (cells[current]?.head ? writableCell(current, 0) : current);
  const pinnedCell = (): Cell | undefined => cells[writeIndex()];
  const cellTime = (cell: Cell) => (cell.start !== undefined ? timeLabel(cell.start) : `${cell.index + 1} 番`);

  function renderLine() {
    const usable = lineUsable();
    line.hidden = !usable;
    for (const node of canvas.querySelectorAll('.rcell.pinned')) node.classList.remove('pinned');
    if (!usable) return;
    const cell = pinnedCell();
    pinBox.textContent = cell ? `${pin === null ? '今' : '▸'} ${cellTime(cell)}` : '';
    pinBox.title = pin === null || !cell ? '打ち始めると、そのときのマスに固定します' : `${cell.index + 1} 番のマス（${cellTime(cell)}）に書いています。‹ › で付け替え`;
    pinPrev.disabled = !cell;
    pinNext.disabled = !cell;
    line.classList.toggle('pinned', pin !== null);
    writePlayButton.textContent = WRITE_PLAY_LABEL[prefs.writePlay];
    renderWriteTo();
    if (pin !== null) canvas.querySelector(`.rcell:not(.annot)[data-index="${pin}"]`)?.classList.add('pinned');
  }

  // 見出し（チャプター）でないマス。from から delta の向きへ探す（delta が 0 なら from から後ろへ）。無ければ from
  function writableCell(from: number, delta: number): number {
    const step = delta < 0 ? -1 : 1;
    for (let i = from + delta; i >= 0 && i < cells.length; i += step) if (!cells[i].head) return i;
    return from;
  }

  // 打ち始めた：今のマスに固定し、書くあいだの再生を当てる（一度だけ）
  function beginWriting() {
    if (pin === null) pin = writeIndex();
    if (!held) {
      held = true;
      holdTask = holdPlayback();
    }
    renderLine();
  }

  async function holdPlayback() {
    if (tabId === null || !video?.id) return;
    const id = tabId;
    if (prefs.writePlay === 'pause' && playing) {
      const started = await togglePlay(id);
      if (started === false && tabId === id) {
        playing = false;
        pausedForWriting = true;
        renderPlayback();
      }
    } else if (prefs.writePlay === 'slow' && speed !== 0.75) {
      const before = speed;
      const applied = await setPlaybackRate(id, 0.75);
      if (applied !== null && Math.abs(applied - 0.75) <= 0.05 && tabId === id) {
        slowedFrom = before;
        speed = 0.75;
        renderPlayback();
      }
    }
  }

  // 書き終えた・やめた：書くために止めた・遅くした再生を戻す（自分で再生し直していたら、そのまま）
  async function releasePlayback() {
    if (!held) return;
    held = false;
    const id = tabId;
    await holdTask;
    holdTask = null;
    const resume = pausedForWriting;
    const back = slowedFrom;
    pausedForWriting = false;
    slowedFrom = null;
    if (id === null || tabId !== id) return;
    if (resume && !playing) {
      const started = await togglePlay(id);
      if (started) {
        playing = true;
        renderPlayback();
      }
    }
    if (back !== null) {
      const applied = await setPlaybackRate(id, back);
      if (applied !== null) {
        speed = back;
        renderPlayback();
      }
    }
  }

  // 下書きに残す（同じマスは置き換え。古いものから捨てて 10 件まで）
  function keepDraft(key: string, text: string) {
    drafts.delete(key);
    drafts.set(key, [...text].slice(0, MAX_DRAFT_TEXT).join(''));
    while (drafts.size > MAX_DRAFTS) drafts.delete(drafts.keys().next().value as string);
    saveSoon();
  }

  // 欄の書きかけを下書きに残して空にする（閉じる・別のページを開くとき。再生は戻さない）
  function stashLine() {
    const text = lineInput.value.trim();
    const cell = pinnedCell();
    if (text && cell) keepDraft(cell.key, text);
    lineInput.value = '';
  }

  // 欄の状態を初めに戻す（ページが替わったとき）
  function resetLine() {
    pin = null;
    held = false;
    holdTask = null;
    pausedForWriting = false;
    slowedFrom = null;
    lineInput.value = '';
  }

  // ---------- 書く先と結ぶ先（plan-reader-video の V1c）・カードに書く（V2a-2） ----------
  // 線を結べる動画か（YouTube・自分のファイル。聞き取りのページは結ばない。S1）
  const videoKeyNow = (): string | null => (video && video.kind !== 'live' ? readerVideoKey(url) : null);
  // 今の写し（開いている動画のものだけ）
  const linksNow = (): ReaderLinksView | null => (links && links.video === videoKeyNow() ? links : null);
  const writesCard = () => prefs.writeTo === 'card' && videoKeyNow() !== null;

  function renderWriteTo() {
    const usable = videoKeyNow() !== null;
    writeToBox.hidden = !usable;
    toNote.setAttribute('aria-pressed', String(!writesCard()));
    toCard.setAttribute('aria-pressed', String(writesCard()));
    targetBox.hidden = !writesCard();
    linkCardButton.hidden = !writesCard();
    cellCardButton.hidden = !writesCard();
    lineInput.placeholder = writesCard()
      ? 'カードに書く（打ち始めた時刻のマスと結びます。Enter で残す・Esc で抜ける）'
      : '今のマスに書く（打ち始めた時刻のマスに残ります。Enter で残す・Esc で抜ける）';
    if (writesCard()) renderTarget();
  }

  // 結ぶ先の選び口：今の結ぶ先・この動画のカードがあるメモ・新しいメモ（作り直すのは中身が変わったときだけ）
  function renderTarget() {
    const view = linksNow();
    const target = view?.target ?? null;
    const others = (view?.memos ?? []).filter((m) => m.memoId !== target?.memoId);
    const left = target ? Math.max(0, target.max - target.replies) : null;
    const options: [string, string][] = [
      target ? [target.memoId, `メモ「${target.title}」${left !== null && left <= 20 ? `（あと ${left}）` : ''}`] : ['', '（動画のメモを新しく作る）'],
      ...others.map((m): [string, string] => [m.memoId, `メモ「${m.title}」`]),
      ['__new', '＋ 新しいメモに書く'],
    ];
    const sig = JSON.stringify(options);
    if (sig === targetSig) return;
    targetSig = sig;
    targetSelect.replaceChildren(
      ...options.map(([value, label]) => {
        const option = el('option', '', label);
        option.value = value;
        return option;
      }),
    );
    targetSelect.value = options[0][0];
  }

  // カードの「▶ 時刻」（readerSeek。V2a-3）：開いている動画ならその時刻のマスへ移って再生する。開いている途中なら、開き終えてから
  function seekTo(video: string, start: number) {
    const ready = cells.some((c) => c.start !== undefined) && tabId !== null;
    if (!ready || videoKeyNow() !== video) {
      seekAfterOpen = { video, start };
      return;
    }
    seekAfterOpen = null;
    const i = cellAt(start);
    if (i >= 0) go(i, true, false);
    lastUserMove = Date.now();
    const id = tabId as number;
    void seekVideo(id, start, true).then(() => {
      if (speed !== 1 && tabId === id) void setPlaybackRate(id, speed);
    });
    setStatus(`${timeLabel(start)} へ移りました`, 2500);
  }

  // ---------- AI の頼み板（plan-reader-video の V4a。D5・D6・D12・D17・D22） ----------
  //   範囲 × 頼みを選び、送る字数と料金の目安・この動画で使った額を見てから頼む。間は字幕の時刻だけで数える（AI に送らない・料金なし）
  //   鍵・練習モード・月の上限・渡し止めは「AI で要点」と同じ道。失敗はカードにせず、状態の文で知らせる（D17）
  const askMenu = new CellMenu();
  const ASK_RANGES: readonly AskRange[] = ['one', 'picked', 'chapter', 'all'];

  function openAskMenu(anchor: HTMLElement, range?: AskRange) {
    if (range) {
      prefs.ask = { ...prefs.ask, range };
      savePrefs(prefs);
    }
    const rect = anchor.getBoundingClientRect();
    const y = rect.top > window.innerHeight / 2 ? rect.top - 4 : rect.bottom + 4;
    const reopen = () => askMenu.open(rect.left, y, askEntries());
    const set = (patch: Partial<ReaderPrefs['ask']>) => {
      prefs.ask = { ...prefs.ask, ...patch };
      savePrefs(prefs);
      reopen();
    };
    const askEntries = (): MenuEntry[] => {
      const o = prefs.ask;
      const indices = askRangeCells(cells, o.range, current, picked);
      const label = askRangeLabel(cells, o.range, indices);
      const entries: MenuEntry[] = [
        { section: 'AI に頼む（結果は下の区画の AI のカード）' },
        { row: '範囲', buttons: ASK_RANGES.map((r) => ({ label: r === 'picked' ? `選んだマス ${picked.length}` : ASK_RANGE_NAME[r], pressed: o.range === r, run: () => set({ range: r }) })) },
        { row: '型', buttons: (['comedy', 'lecture'] as const).map((l) => ({ label: ASK_LENS_NAME[l], pressed: o.lens === l, run: () => set({ lens: l }) })) },
        {
          row: '分ける',
          buttons: (['tech', 'bones', 'tendon', 'pause'] as const).map((k) => ({ label: k === 'pause' ? '間（料金なし）' : ASK_KIND_NAME[k], pressed: o.kind === k, run: () => set({ kind: k }) })),
        },
        { row: '応用', buttons: [{ label: ASK_KIND_NAME.apply, pressed: o.kind === 'apply', run: () => set({ kind: 'apply' }) }] },
        { row: 'やり取り（右の相棒）', buttons: TALK_MODES.map((m) => ({ label: TALK_MODE_NAME[m], pressed: o.kind === m, run: () => set({ kind: m }) })) },
      ];
      if (isTalk(o.kind)) {
        // やり取りの型（V5）：ツッコむ・当てるは今のマスで止める（範囲は使わない）。ふりかえる・掛け合いは範囲
        const stops = o.kind === 'tsukkomi' || o.kind === 'guess';
        const talk = talkFor(o.kind);
        entries.push({
          note: stops
            ? talk
              ? `今のマス（${talk.label}）で止めて、右の相棒と練習します。このあとの本物の字幕は相棒にだけ渡し、答えるまで見せません（範囲は使いません）`
              : '今のマスのあとに字幕が無いので、隠す本物がありません'
            : `範囲：${label}${talk ? '' : '（時刻のマスがありません）'}`,
        });
        entries.push({ note: '右の相棒で話します（料金は相棒の設定のモデル。今月の料金の目安に入ります）' });
        entries.push('sep', { label: '右の相棒で始める', disabled: !talk, run: () => void startTalk(o.kind as TalkMode) });
        return entries;
      }
      const noChapter = o.range === 'chapter' && !cells.some((c) => c.head);
      entries.push({ note: `範囲：${label}${indices.length === 0 ? (noChapter ? '（チャプターの無い動画です）' : '（時刻のマスがありません）') : ''}` });
      if (o.kind === 'pause') {
        entries.push({ note: '字幕の時刻だけで、マスとマスの空き（間）を数えます（AI に送らない・料金なし）' });
      } else if (indices.length > 0) {
        const p = readAiPrefs();
        const model = MODELS.find((m) => m.id === p.model) ?? MODELS[0];
        const payload = askPayload(cells, indices);
        const est = askEstimate(payload, model);
        entries.push({
          note: `送る字幕：約 ${payload.chars.toLocaleString()} 字（${payload.sent.length} マス${payload.clipped ? '。長いので最初の約 6 万字だけ' : ''}）・${model.label}・約 $${est.low.toFixed(3)}〜$${est.high.toFixed(3)}（目安）`,
        });
        if (p.practice) entries.push({ note: '練習モードです：料金はかからず、決まった返事が返ります（相棒の ⚙ で切り替え）' });
        if (o.kind === 'apply') entries.push({ note: '頼むと、作る話の題を聞きます' });
      }
      entries.push({ note: `この動画で使った AI：約 $${aiSpent.toFixed(3)}（この機能だけの上限はありません。月の上限は今までどおり）` });
      entries.push('sep', { label: askBusy ? '考え中…' : '頼む', hint: o.kind === 'pause' ? '料金なし' : undefined, disabled: askBusy || indices.length === 0, run: () => startAsk() });
      return entries;
    };
    reopen();
  }

  // やり取りの型か（頼み板の頼みのうち、右の相棒で話すもの。V5）
  function isTalk(kind: AskKind | TalkMode): kind is TalkMode {
    return (TALK_MODES as readonly string[]).includes(kind);
  }

  // やり取りの材料（ツッコむ・当てるは今のマス〈見出しならその次〉、ふりかえる・掛け合いは頼み板の範囲）。組めなければ null
  function talkFor(mode: TalkMode) {
    const video = videoKeyNow();
    if (!video) return null;
    const indices = askRangeCells(cells, prefs.ask.range, current, picked);
    const anchor = cells[current]?.head ? writableCell(current, 0) : current;
    return talkMaterial(cells, mode, anchor, indices, video, title, askRangeLabel(cells, prefs.ask.range, indices), secondVoice()?.name);
  }

  // 右の相棒とのやり取りの型を始める（plan-reader-video の V5）：材料を左を通して右へ渡す（左が渡し止めを見る）。
  //   ツッコむ・当てるときは、本物が聞こえないよう再生を止める
  async function startTalk(mode: TalkMode) {
    askMenu.close();
    const talk = talkFor(mode);
    if (!talk) return;
    if (await pageIsBlocked(url)) {
      setStatus(BLOCK_NOTE, 6000);
      return;
    }
    const stops = mode === 'tsukkomi' || mode === 'guess';
    if (stops && playing) await playPause();
    askLeft({ command: 'readerTalk', talk, url: timedUrl(url, talk.sec) });
    setStatus(`右の相棒で「${TALK_MODE_NAME[mode]}」を始めました（${talk.label}）${stops ? '。右の欄に書いて送ってください' : ''}`, 6000);
  }

  // 「頼む」：間はその場で数える。応用は題を聞いてから。ほかはそのまま AI へ
  function startAsk() {
    const o = prefs.ask;
    if (isTalk(o.kind)) return;
    const indices = askRangeCells(cells, o.range, current, picked);
    if (indices.length === 0) return;
    const label = askRangeLabel(cells, o.range, indices);
    if (o.kind === 'pause') {
      askMenu.close();
      finishAsk('pause', askHead('pause', o.lens, label), pauseLines(cells, indices), 0, false, indices);
      return;
    }
    if (o.kind === 'apply') {
      const lens = o.lens;
      askMenu.prompt(`この型で作る話の題（${ASK_TOPIC_MAX} 字まで）`, askTopic, (value) => void sendAsk('apply', lens, indices, label, value), undefined, { maxLength: ASK_TOPIC_MAX, placeholder: '例：職場の飲み会' });
      return;
    }
    void sendAsk(o.kind, o.lens, indices, label);
  }

  // AI に頼む（読む画面で走らせる。D17）。開いている動画が途中で替わったら、結果は捨てる
  async function sendAsk(kind: AiAskKind, lens: AskLens, indices: readonly number[], label: string, topic?: string) {
    if (askBusy) return;
    askMenu.close();
    if (await pageIsBlocked(url)) {
      setStatus(BLOCK_NOTE, 6000);
      return;
    }
    if (topic !== undefined) askTopic = topic;
    const key = videoKeyNow();
    const token = openToken;
    const s = settings();
    const payload = askPayload(cells, indices);
    askBusy = true;
    setStatus(`AI に頼みました（${ASK_KIND_NAME[kind]}・${label}）。考え中です…（失敗したときはカードを作らず、ここで知らせます）`);
    // 考え中の印（D17）：結ぶ先のメモがあれば、左の PendingReply に載せる（下の区画と右に出る）。無ければ、カードを足すときに左がメモを作る
    const pendingMemo = linksNow()?.target?.memoId;
    if (pendingMemo) askLeft({ command: 'readerAiPending', memoId: pendingMemo, on: true, who: 'main', name: 'Claude' });
    try {
      const result = await runAsk(kind, lens, { title, range: label, sent: payload.sent, topic }, s);
      if (token !== openToken || videoKeyNow() !== key) {
        setStatus('開いている動画が替わったので、AI の結果は使いませんでした', 6000);
        return;
      }
      if (!s.practice && result.cost > 0) {
        aiSpent += result.cost;
        saveSoon();
      }
      finishAsk(kind, askHead(kind, lens, label, topic), result.lines, result.cost, s.practice, indices, s.model);
    } catch (error) {
      setStatus(`AI に頼めませんでした（カードは作りません）：${error instanceof Error ? error.message : String(error)}`, 8000);
    } finally {
      askBusy = false;
      if (pendingMemo) askLeft({ command: 'readerAiPending', memoId: pendingMemo, on: false, who: 'main', name: 'Claude' }); // カードを足す頼みのあとに外す
    }
  }

  // 結果を AI のカードにする（plan-reader-video の V4b。D5・D17・D18）：本文は「見出し＋▶ 時刻〔札〕文」の行。2,000 字を超えるならチャプターごとに分ける
  //   at は頼んだ範囲を 1 本（分けたときは、その一枚の行の範囲）と種類、by は書いた AI と目安の料金（料金は 1 枚目だけ。間は読む画面）。
  //   結ぶ先は今の結ぶ先のメモ（無ければ左が動画のメモを作る。Q2）。断られたときは知らせるだけ（AI の文は下書きに戻さない）
  function finishAsk(kind: AskKind, head: string, lines: readonly AiCardLine[], cost: number, practice: boolean, indices: readonly number[], model?: string) {
    const money = practice ? '（練習モード）' : cost > 0 ? `（約 $${cost.toFixed(3)}）` : '';
    if (lines.length === 0) {
      setStatus(`「${head}」：見つかったものはありませんでした${money}（カードは作りません）`, 6000);
      return;
    }
    const video = videoKeyNow();
    const range = indices.flatMap((i) => (cells[i] && cells[i].start !== undefined ? [cells[i]] : []));
    if (!video || range.length === 0) return;
    const parts = splitAiCard(head, lines, chapterNameAt);
    const memoId = linksNow()?.target?.memoId;
    const author = (first: boolean): ReplyAuthor =>
      kind === 'pause'
        ? { who: 'reader', name: '読む画面（字幕の時刻）' }
        : { who: 'main', name: practice ? 'Claude（練習モード）' : 'Claude', ...(model && !practice ? { model } : {}), ...(first && cost > 0 ? { cost } : {}) };
    parts.forEach((part, n) => {
      // 分けたときは、その一枚の行の秒にかかる範囲のマス
      const lo = part.lines[0]?.sec ?? 0;
      const hi = part.lines[part.lines.length - 1]?.sec ?? lo;
      const inPart = parts.length === 1 ? range : range.filter((c) => (c.start ?? 0) >= lo && (c.start ?? 0) <= hi);
      const span = inPart.length > 0 ? inPart : range;
      const first = span[0];
      const last = span[span.length - 1];
      const at: ReplyAt = { video, ...(title ? { title } : {}), spans: [{ key: first.key, start: first.start ?? 0, end: last.end ?? last.start ?? 0 }], kind };
      const seq = ++cardSeq;
      const replyId = newReplyId();
      const timer = window.setTimeout(() => cardTimedOut(seq), CARD_WAIT_MS);
      waitingCards.set(seq, { replyId, key: first.key, text: '', timer, late: false, ai: true });
      askLeft({ command: 'readerCard', seq, replyId, ...(memoId ? { memoId } : {}), text: aiCardText(part.head, part.lines), by: author(n === 0), at });
    });
    setStatus(`「${head}」を AI のカード${parts.length > 1 ? ` ${parts.length} 枚` : ''}にしています…${money}`, 4000);
  }

  // 秒が入るチャプターの名前（その秒より前で一番近い見出しのマスの文。無ければ null。AI のカードを分けるとき）
  function chapterNameAt(sec: number): string | null {
    let name: string | null = null;
    for (const c of cells) {
      if (!c.head || c.start === undefined) continue;
      if (c.start > sec) break;
      name = [...c.text.replace(/\s+/g, ' ').trim()].slice(0, 20).join('') || null;
    }
    return name;
  }

  // ---------- 下の区画との落ちてもよい連絡（plan-reader-video の V2b。D16） ----------
  // 下の区画へ送る今のマス：動画（YouTube・自分のファイル）を出しているときだけ。見出しのマスなら、その次のマス
  //   replyIds：そのマスと結んだカード（左の写しで、▤n と同じ数え方。下の区画はそのカードを光らせる）
  function nowPayload(): ReaderNow | null {
    const key = videoKeyNow();
    if (!readerShown || !key) return null;
    const index = cells[current]?.head ? writableCell(current, 0) : current;
    const cell = cells[index];
    if (!cell || cell.head || cell.start === undefined) return null;
    const view = linksNow();
    const replyIds = view ? itemsAtCell(cells, view.items, index).map((n) => view.items[n].replyId) : [];
    const head = [...title.trim()].slice(0, MAX_AT_TITLE).join('');
    return { video: key, ...(head ? { title: head } : {}), key: cell.key, start: cell.start, end: cell.end ?? cell.start, replyIds };
  }

  // 今のマスを下の区画へ（マスか、そのマスと結んだカードが変わったときだけ。force：頼まれたとき）
  function sendNow(force = false) {
    const now = nowPayload();
    const sig = now ? `${now.video}|${now.key}|${now.replyIds.join(',')}` : 'none';
    if (!force && sig === nowSig) return;
    nowSig = sig;
    send({ type: 'relay', to: 'memo', payload: { kind: 'readerNow', now } });
  }

  // 読む画面を閉じた・隠れた：光りをやめ、下の区画に「今のマスは無い」と一度だけ送る
  function hideNow() {
    readerShown = false;
    glow = null;
    renderGlow();
    sendNow();
  }

  // チャプターの一覧（見出しのマスの始まりと題）を下の区画へ（時刻順の仕切り）。区間セルができたとき・頼まれたとき
  function sendChapters(force = false) {
    const key = videoKeyNow();
    if (!key) return;
    const chapters = cells.flatMap((c) => (c.head && c.start !== undefined ? [{ start: c.start, title: [...c.text].slice(0, 80).join('') }] : [])).slice(0, 300);
    const sig = `${key}|${chapters.map((c) => `${c.start}:${c.title}`).join('|')}`;
    if (!force && sig === chaptersSig) return;
    chaptersSig = sig;
    send({ type: 'relay', to: 'memo', payload: { kind: 'readerChapters', video: key, chapters } });
  }

  // カードの「マスで見る」（readerGlow）：光らせるカードを替える（null で消す）。写しがまだなら、届いたときに光らせる
  function setGlow(memoId: string, replyId: string | null) {
    if (replyId === null) {
      if (glow) setStatus('マスの光りを消しました', 2500);
      glow = null;
    } else {
      glow = { memoId, replyId, shown: false };
    }
    renderGlow();
  }

  // 光らせているカードと結んだマスに印（AI のカードは範囲のマス全部）。初めて光らせたときは、最初のマスが見える所へ動かして知らせる
  function renderGlow() {
    for (const node of canvas.querySelectorAll('.rcell.glow')) node.classList.remove('glow');
    const want = glow;
    if (!want) return;
    const item = linksNow()?.items.find((i) => i.memoId === want.memoId && i.replyId === want.replyId);
    if (!item) return; // 写しがまだ（開いた直後）か、この動画のカードではない
    const hit = new Set<number>();
    for (const span of item.spans) for (const i of cellsOfSpan(cells, span)) hit.add(i);
    for (const i of hit) canvas.querySelector(`.rcell:not(.annot)[data-index="${i}"]`)?.classList.add('glow');
    if (want.shown) return;
    want.shown = true;
    if (hit.size === 0) {
      setStatus(`カード「${item.head}」と結んだマスが、今の字幕に見つかりません`, 5000);
      return;
    }
    const first = cells[Math.min(...hit)];
    const { R, P } = geometry();
    scroller.scrollTo({ top: Math.max(0, P + 1.5 * R * first.r + R - scroller.clientHeight / 2), behavior: 'smooth' });
    setStatus(`カード「${item.head}」と結んだマス ${hit.size} 個を光らせています（下の区画の「マスで見る」をもう一度押すと消えます）`, 5000);
  }

  // 断った理由（左の readerCardDone）を、状態の文に
  const REFUSAL_TEXT: Record<ReaderRefusal, string> = {
    full: 'メモのコメントがいっぱい（300）です',
    special: '結ぶ先が入口やボットのセルです',
    gone: '結ぶ先のメモかカードが、もうありません',
    ledger: 'メモの台帳を読めていません',
    form: '形が合いませんでした',
    video: '開いている動画が替わりました',
    over: '一枚のカードに結べる区間は 12 までです',
  };

  // カードに書く（readerCard）：書いたマスと結ぶ。YouTube なら最初の区間の字幕と時刻つきの URL を引用に（自分のファイルは引用が付かないので、字幕を本文の頭に「」で）
  //   欄はすぐ空にし、返事を待つ。断られた・8 秒返事が無いときは、書きかけを下書きに戻す（D18）
  function commitCard(cell: Cell, text: string) {
    if (!sendCard(cell, text)) return;
    drafts.delete(cell.key);
    lineInput.value = '';
    pin = null;
    void releasePlayback();
    renderLine();
    setStatus(`${cellTime(cell)} のマスと結んだカードを書いています…`, 3000);
  }

  // 結んだカードを足す頼みを送る（欄は触らない）。送れたら true。文が空なら、YouTube は引用だけのカード、自分のファイルは字幕だけのカード
  //   also：ほかにも結ぶマス（選んだ区間。V3b）。区間は書いたマスを先に、12 本まで
  function sendCard(cell: Cell, text: string, also: readonly Cell[] = []): boolean {
    const key = videoKeyNow();
    if (!key || cell.start === undefined) return false;
    const at: ReplyAt = { video: key, ...(title ? { title } : {}), spans: spansOf([cell, ...also]) };
    const quote: ReplyQuote | undefined = video?.kind === 'youtube' ? { text: cell.text, url: timedUrl(url, cell.start), title } : undefined;
    const caption = `「${[...cell.text].slice(0, 80).join('')}」`;
    const body = quote ? text : text ? `${caption}\n${text}` : caption;
    const seq = ++cardSeq;
    const replyId = newReplyId();
    const memoId = linksNow()?.target?.memoId;
    const timer = window.setTimeout(() => cardTimedOut(seq), CARD_WAIT_MS);
    waitingCards.set(seq, { replyId, key: cell.key, text, timer, late: false });
    askLeft({ command: 'readerCard', seq, replyId, ...(memoId ? { memoId } : {}), text: body, ...(quote ? { quote } : {}), at });
    return true;
  }

  function cardTimedOut(seq: number) {
    const wait = waitingCards.get(seq);
    if (!wait || wait.late) return;
    wait.late = true;
    if (wait.text) keepDraft(wait.key, wait.text);
    setStatus(wait.text ? '左から返事がありません。書きかけは下書きに残しました（C で欄へ）' : '左から返事がありません（カードは足せていないかもしれません）', 6000);
  }

  // 左の返事（readerCardDone）。足せたら知らせる。断られたら下書きに戻す。返事が遅れて足せていたら、戻した下書きを消す
  function onCardDone(done: { seq: number; ok: boolean; replyId: string; memoId?: string; reason?: ReaderRefusal }) {
    const link = waitingLinks.get(done.seq);
    if (link && link.replyId === done.replyId) {
      waitingLinks.delete(done.seq);
      setStatus(
        done.ok
          ? `カード「${link.head}」${link.remove ? `から${link.many ? '選んだ区間' : 'このマス'}を外しました` : `と${link.many ? '選んだ区間' : 'このマス'}を結びました`}`
          : `カード「${link.head}」と結べませんでした（${REFUSAL_TEXT[done.reason ?? 'form']}）`,
        done.ok ? 3000 : 6000,
      );
      return;
    }
    const wait = waitingCards.get(done.seq);
    if (!wait || wait.replyId !== done.replyId) return;
    waitingCards.delete(done.seq);
    window.clearTimeout(wait.timer);
    if (done.ok) {
      if (wait.late && drafts.get(wait.key) === wait.text) {
        drafts.delete(wait.key);
        saveSoon();
      }
      const memo = linksNow()?.target;
      setStatus(`${wait.ai ? 'AI のカードを残しました' : 'カードに残しました'}${memo && memo.memoId === done.memoId ? `（メモ「${memo.title}」）` : ''}`, 3000);
      return;
    }
    if (!wait.late && wait.text) keepDraft(wait.key, wait.text);
    setStatus(`カードに残せませんでした（${REFUSAL_TEXT[done.reason ?? 'form']}）${wait.text ? '。書きかけは下書きに戻しました（C で欄へ）' : ''}`, 7000);
  }

  toNote.addEventListener('click', () => {
    prefs.writeTo = 'note';
    savePrefs(prefs);
    renderLine();
    lineInput.focus();
  });
  toCard.addEventListener('click', () => {
    prefs.writeTo = 'card';
    savePrefs(prefs);
    renderLine();
    lineInput.focus();
  });
  // 結ぶ先を替える：下の区画でそのメモを開く（S6）。「新しいメモ」は今の newMemoForPane（空のメモを作って開く）
  targetSelect.addEventListener('change', () => {
    const value = targetSelect.value;
    if (value === '__new') {
      askLeft({ command: 'newMemoForPane' });
      setStatus('新しいメモを作って、下の区画で開きます', 3000);
    } else if (value && value !== linksNow()?.target?.memoId) {
      askLeft({ command: 'openMemoPane', id: value });
      setStatus('結ぶ先のメモを下の区画で開きます', 3000);
    }
    targetSig = ''; // 左の写しが届くまでは今の結ぶ先に戻しておく
    renderTarget();
  });

  // ---------- マスの ▤n・「カードと結ぶ…」・「マスをカードに」（plan-reader-video の V2a-2b） ----------
  // マスごとの結んだカードの数（左の写しから。AI のカードは範囲の始まりのマスだけ。S7）
  function renderLinkBadges() {
    for (const node of canvas.querySelectorAll('.rcell-links')) node.remove();
    const items = linksNow()?.items ?? [];
    if (items.length === 0) return;
    const counts = countLinksByCell(cells, items);
    counts.forEach((n, i) => {
      if (n === 0) return;
      const inner = canvas.querySelector(`.rcell:not(.annot)[data-index="${i}"] .rcell-inner`);
      if (!inner) return;
      const badge = el('span', 'rcell-links', `▤${n}`);
      badge.title = `このマスと結んだカード ${n} 枚`;
      inner.append(badge);
    });
  }

  // 結ぶ先のメモのカードの一覧。押すとこのマス（選んだ区間なら全部）と結ぶ（全部と結んであれば外す）。別の動画と結んだカードは選べない（1 枚のカードは 1 本の動画だけ）
  function openLinkMenu(list?: Cell[], anchor: HTMLElement = linkCardButton) {
    const first = pinnedCell();
    const targets = list ?? (first ? [first] : []);
    const cell = targets[0];
    const view = linksNow();
    const target = view?.target ?? null;
    if (!cell || cell.start === undefined || !view) return;
    if (!target) {
      setStatus('結ぶ先のメモがまだありません（カードに一枚書くか、「結ぶ先」で選んでください）', 5000);
      return;
    }
    const mine = new Set(
      view.items.filter((i) => i.memoId === target.memoId && targets.every((c) => i.spans.some((s) => s.key === c.key))).map((i) => i.replyId),
    );
    const what = targets.length === 1 ? `${cellTime(cell)} のマス` : `選んだ ${targets.length} の区間`;
    const entries: MenuEntry[] = [{ section: `メモ「${target.title}」のカード（${what}と結ぶ）` }];
    for (const top of target.tops.slice(0, LINK_MENU_MAX)) {
      const other = top.video !== undefined && top.video !== view.video;
      const linked = mine.has(top.replyId);
      entries.push(
        other
          ? { label: top.head, hint: '別の動画と結んであります', disabled: true }
          : { label: `${linked ? '✓ ' : ''}${top.head}`, hint: linked ? '押すと外す' : undefined, run: () => linkCellToCard(target.memoId, top.replyId, top.head, targets, linked) },
      );
    }
    if (target.tops.length === 0) entries.push({ note: 'このメモにはカードがありません' });
    if (target.tops.length > LINK_MENU_MAX) entries.push({ note: `ほか ${target.tops.length - LINK_MENU_MAX} 枚（下の区画で探して、そのメモを結ぶ先にしてください）` });
    const rect = anchor.getBoundingClientRect();
    linkMenu.open(rect.left, rect.top - 4, entries);
  }

  // 今あるカードに、このマス（選んだ区間なら全部）の線を足す・外す（readerLink。返事は readerCardDone）
  function linkCellToCard(memoId: string, replyId: string, head: string, list: readonly Cell[], remove: boolean) {
    const video = videoKeyNow();
    if (!video || list.length === 0) return;
    const seq = ++cardSeq;
    waitingLinks.set(seq, { replyId, head, remove, many: list.length > 1 });
    askLeft({
      command: 'readerLink',
      seq,
      memoId,
      replyId,
      video,
      ...(title ? { title } : {}),
      ...(remove ? { remove: list.map((c) => c.key) } : { add: spansOf(list) }),
    });
  }

  linkCardButton.addEventListener('click', () => openLinkMenu());
  cellCardButton.addEventListener('click', () => {
    const cell = pinnedCell();
    if (!cell || !sendCard(cell, '')) return;
    setStatus(`${cellTime(cell)} のマスの字幕を、結んだカードにしています…`, 3000);
  });

  // ---------- 複数選びと選んだ区間の棚（plan-reader-video の V3b-1） ----------
  // マスの区間（時刻のあるマスだけ・同じ指紋は一つ・12 本まで）
  function spansOf(list: readonly Cell[]) {
    const out: { key: string; start: number; end: number }[] = [];
    for (const c of list) {
      if (c.start === undefined || out.some((s) => s.key === c.key) || out.length >= MAX_AT_SPANS) continue;
      out.push({ key: c.key, start: c.start, end: c.end ?? c.start });
    }
    return out;
  }
  // 選んだマス（時刻の順）
  const pickedCells = (): Cell[] => [...picked].sort((a, b) => a - b).flatMap((i) => (cells[i] ? [cells[i]] : []));

  // マスを選ぶ・外す。range：Shift+クリック（起点からこのマスまでを足す）。見出しと時刻の無いマスは選ばない。30 まで
  function pickCell(index: number, range: boolean) {
    const ok = (i: number) => !!cells[i] && !cells[i].head && cells[i].start !== undefined;
    if (!ok(index)) return;
    if (range && pickAnchor !== null) {
      const [from, to] = pickAnchor < index ? [pickAnchor, index] : [index, pickAnchor];
      for (let i = from; i <= to; i++) if (ok(i) && !picked.includes(i)) picked.push(i);
    } else if (picked.includes(index)) {
      picked = picked.filter((i) => i !== index);
    } else {
      picked.push(index);
    }
    pickAnchor = index;
    if (picked.length > MAX_PICKS) {
      picked = picked.slice(0, MAX_PICKS);
      setStatus(`選べるのは ${MAX_PICKS} の区間までです`, 4000);
    }
    renderPicks();
  }

  function clearPicks() {
    picked = [];
    pickAnchor = null;
    renderPicks();
  }

  // 選んだマスの番号（選んだ順）と棚
  function renderPicks() {
    for (const node of canvas.querySelectorAll('.rcell.picked')) node.classList.remove('picked');
    for (const node of canvas.querySelectorAll('.rcell-pick')) node.remove();
    picked.forEach((i, n) => {
      const node = canvas.querySelector(`.rcell:not(.annot)[data-index="${i}"]`);
      if (!node) return;
      node.classList.add('picked');
      node.querySelector('.rcell-inner')?.append(el('span', 'rcell-pick', String(n + 1)));
    });
    const usable = lineUsable();
    pickButton.hidden = !usable;
    pickButton.setAttribute('aria-pressed', String(pickMode));
    shelf.hidden = !usable || picked.length === 0;
    if (shelf.hidden) return;
    const total = pickedCells().reduce((sum, c) => sum + Math.max(0, (c.end ?? c.start ?? 0) - (c.start ?? 0)), 0);
    shelfCount.textContent = `選んだ区間 ${picked.length}（合わせて ${timeLabel(total)}）`;
    const cardable = videoKeyNow() !== null;
    shelfCard.disabled = !cardable;
    shelfLink.disabled = !cardable;
  }

  pickButton.addEventListener('click', () => {
    pickMode = !pickMode;
    renderPicks();
    setStatus(pickMode ? 'マスを押すと選びます（もう一度押すと外す）。終わったら「選ぶ」をもう一度' : '選ぶのをやめました（選んだ区間は残っています）', 4000);
  });
  shelfClear.addEventListener('click', () => {
    clearPicks();
    pickMode = false;
    renderPicks();
  });
  // 選んだ区間と結んだカードを 1 枚（一行の欄に書きかけがあれば、それを文にして欄を空にする）
  shelfCard.addEventListener('click', () => {
    const list = pickedCells();
    if (list.length === 0) return;
    if (list.length > MAX_AT_SPANS) {
      setStatus(`一枚のカードに結べる区間は ${MAX_AT_SPANS} までです（選んだ区間は ${list.length}）`, 5000);
      return;
    }
    const text = lineInput.value.replace(/\s+/g, ' ').trim();
    if (!sendCard(list[0], text, list.slice(1))) return;
    if (text) {
      drafts.delete(pinnedCell()?.key ?? '');
      lineInput.value = '';
      pin = null;
      void releasePlayback();
      renderLine();
    }
    setStatus(`選んだ ${list.length} の区間と結んだカードを作っています…`, 3000);
  });
  shelfLink.addEventListener('click', () => {
    const list = pickedCells();
    if (list.length > MAX_AT_SPANS) {
      setStatus(`一枚のカードに結べる区間は ${MAX_AT_SPANS} までです（選んだ区間は ${list.length}）`, 5000);
      return;
    }
    if (list.length > 0) openLinkMenu(list, shelfLink);
  });

  // ---------- 選んだ区間のくり返し（plan-reader-video の V3b-2） ----------
  const loopMenu = new CellMenu();
  const LOOP_MODE_LABEL: Record<LoopMode, string> = { seq: '順に一周', each: '一つずつ', shuffle: 'まぜる' };

  // 回し方の選び口（押すたびに選び直し、「▶ くり返す」で始める。決めた回し方は設定に覚える）
  function openLoopMenu(anchor: HTMLElement) {
    const rect = anchor.getBoundingClientRect();
    const reopen = () => loopMenu.open(rect.left, rect.top - 4, loopEntries());
    const set = (patch: Partial<LoopOptions>) => {
      prefs.loop = cleanLoopOptions({ ...prefs.loop, ...patch });
      savePrefs(prefs);
      reopen();
    };
    const choice = <T,>(row: string, values: readonly T[], label: (v: T) => string, now: T, patch: (v: T) => Partial<LoopOptions>): MenuEntry => ({
      row,
      buttons: values.map((v) => ({ label: label(v), pressed: v === now, run: () => set(patch(v)) })),
    });
    const loopEntries = (): MenuEntry[] => {
      const o = prefs.loop;
      return [
        { section: `選んだ ${picked.length} の区間をくり返す` },
        choice('回し方', ['seq', 'each', 'shuffle'] as const, (m) => LOOP_MODE_LABEL[m], o.mode, (mode) => ({ mode })),
        choice('回数', [1, 2, 3, 5, 10], (n) => `${n}`, o.times, (times) => ({ times })),
        choice('休み', [0, 1, 2, 3, 5], (n) => (n === 0 ? 'なし' : `${n} 秒`), o.gap, (gap) => ({ gap })),
        choice('のりしろ', [0, 0.5, 1], (n) => (n === 0 ? 'なし' : `${n} 秒`), o.pad, (pad) => ({ pad })),
        choice('速さの段上げ', [false, true], (v) => (v ? '0.75→1→1.25' : 'しない'), o.steps, (steps) => ({ steps })),
        'sep',
        { label: '▶ くり返す', hint: 'R でやめる', run: () => startLoop(pickedCells(), prefs.loop) },
      ];
    };
    reopen();
  }

  function startLoop(list: Cell[], options: LoopOptions) {
    if (tabId === null || !video?.id) return;
    const spans = list.map((c) => ({ start: c.start ?? 0, end: c.end ?? c.start ?? 0 }));
    const steps = planLoop(spans, options, (Date.now() >>> 0) % 100_000, video.duration || undefined);
    if (steps.length === 0) {
      setStatus('くり返せる区間がありません（時刻のあるマスを選んでください）', 4000);
      return;
    }
    stopLoop(false);
    repeat = false;
    digest = null;
    loop = { cells: list, steps, pos: 0, resting: false, restTimer: 0, seekedAt: 0, speedFrom: speed };
    renderHead();
    setStatus(`くり返します：${LOOP_MODE_LABEL[options.mode]}・${options.times} 回（${steps.length} 段）。R でやめる`, 4000);
    playStep();
  }

  // 今の段へ移って再生する（段上げなら速さも）
  function playStep() {
    if (!loop || tabId === null) return;
    const step = loop.steps[loop.pos];
    const cell = loop.cells[step.span];
    if (cell) go(cell.index, true, false);
    lastUserMove = Date.now();
    loop.seekedAt = Date.now();
    const id = tabId;
    const rate = (step.rate ?? speed) as (typeof SPEEDS)[number];
    void seekVideo(id, step.start, true).then(async () => {
      if (tabId !== id) return;
      if (rate !== 1 || speed !== 1) {
        const applied = await setPlaybackRate(id, rate);
        if (applied !== null) speed = rate;
      }
      playing = true;
      renderPlayback();
    });
    if (loop.steps.length > 1) setStatus(`くり返し ${loop.pos + 1} / ${loop.steps.length}${step.rate !== null ? `・${step.rate}×` : ''}`, 2000);
  }

  // 段が終わった：最後なら止めて終える。休みがあれば止めて秒読みし（別の時計）、次の段へ
  async function advanceLoop(id: number) {
    if (!loop) return;
    const step = loop.steps[loop.pos];
    if (loop.pos + 1 >= loop.steps.length) {
      const started = await togglePlay(id); // 最後の段のあとは止める
      if (started === false) playing = false;
      stopLoop(false);
      setStatus('くり返しを終えました', 3000);
      return;
    }
    if (step.gapAfter <= 0) {
      loop.pos += 1;
      playStep();
      return;
    }
    loop.resting = true;
    const started = await togglePlay(id);
    if (started === false) playing = false;
    renderPlayback();
    const until = Date.now() + step.gapAfter * 1000;
    const current = loop;
    const tick = () => {
      if (loop !== current) return;
      const left = Math.ceil((until - Date.now()) / 1000);
      if (left > 0) {
        setStatus(`休み ${left}…`, 1200);
        return;
      }
      window.clearInterval(current.restTimer);
      current.resting = false;
      current.pos += 1;
      playStep();
    };
    current.restTimer = window.setInterval(tick, 250);
    tick();
  }

  // くり返しをやめる（told：やめたと知らせる）。段上げで替えた速さは元に戻す
  function stopLoop(told: boolean) {
    const ending = loop;
    if (!ending) return;
    window.clearInterval(ending.restTimer);
    loop = null;
    if (tabId !== null && speed !== ending.speedFrom) {
      const id = tabId;
      void setPlaybackRate(id, ending.speedFrom).then((applied) => {
        if (applied !== null && tabId === id) speed = ending.speedFrom;
        renderPlayback();
      });
    }
    renderPlayback();
    renderHead();
    if (told) setStatus('くり返しをやめました', 2500);
  }

  shelfLoop.addEventListener('click', () => {
    if (loop) stopLoop(true);
    else openLoopMenu(shelfLoop);
  });

  // ---------- 名前つきの組（plan-reader-video の V3b-3）：選んだ区間（マスの指紋）と回し方を、この動画の記録に 20 まで ----------
  // 組に保存：名前を聞く小さな欄。同じ名前があれば置き換える
  function openSaveSet(anchor: HTMLElement) {
    const list = pickedCells();
    if (list.length === 0) return;
    const form = el('form', 'reader-set-form');
    const name = el('input', 'reader-set-name');
    name.type = 'text';
    name.maxLength = 30;
    name.value = `組 ${sets.length + 1}`;
    name.setAttribute('aria-label', '組の名前');
    const save = el('button', 'reader-tool', '残す');
    save.type = 'submit';
    form.append(el('span', '', `選んだ ${list.length} の区間・${LOOP_MODE_LABEL[prefs.loop.mode]} ${prefs.loop.times} 回`), name, save);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const clean = parseLoopSets([{ ...prefs.loop, name: name.value, keys: list.map((c) => c.key) }])[0];
      if (!clean) {
        setStatus('組の名前を入れてください', 3000);
        return;
      }
      const same = sets.findIndex((s) => s.name === clean.name);
      if (same < 0 && sets.length >= MAX_LOOP_SETS) {
        setStatus(`組は ${MAX_LOOP_SETS} までです（「組」から要らない組を消してください）`, 5000);
        return;
      }
      sets = same >= 0 ? sets.map((s, i) => (i === same ? clean : s)) : [...sets, clean];
      loopMenu.close();
      saveSoon();
      renderPlayback();
      setStatus(`組「${clean.name}」に残しました${same >= 0 ? '（同じ名前の組を置き換えました）' : ''}`, 3000);
    });
    name.addEventListener('keydown', (e) => e.stopPropagation());
    const rect = anchor.getBoundingClientRect();
    loopMenu.showForm(form, { x: rect.left, y: rect.top - 4 });
    name.select();
  }

  // 組の区間を選ぶ（字幕を読み直して指紋が変わったマスは選べない。選べた数を返す）
  function pickSet(set: LoopSet): number {
    const index = new Map(cells.map((c) => [c.key, c.index]));
    picked = set.keys.flatMap((k) => (index.has(k) ? [index.get(k) as number] : []));
    pickAnchor = picked[picked.length - 1] ?? null;
    renderPicks();
    return picked.length;
  }

  // 帯の「組」：組の一覧（選ぶ・▶ くり返す・消す）
  function openSetsMenu() {
    const entries: MenuEntry[] = [{ section: 'この動画の組' }];
    if (sets.length === 0) entries.push({ note: 'まだ組がありません（区間を選んで、棚の「組に保存…」で残せます）' });
    for (const set of sets) {
      entries.push({
        row: set.name,
        hint: `${set.keys.length} の区間・${LOOP_MODE_LABEL[set.mode]} ${set.times} 回`,
        buttons: [
          {
            label: '選ぶ',
            close: true,
            run: () => {
              const n = pickSet(set);
              setStatus(n === set.keys.length ? `組「${set.name}」の ${n} の区間を選びました` : `組「${set.name}」の区間のうち ${n} を選びました（ほかは字幕が変わって見つかりません）`, 4000);
            },
          },
          {
            label: '▶',
            aria: `組「${set.name}」をくり返す`,
            close: true,
            run: () => {
              if (pickSet(set) === 0) {
                setStatus(`組「${set.name}」の区間が見つかりません（字幕が変わったかもしれません）`, 5000);
                return;
              }
              prefs.loop = cleanLoopOptions(set);
              savePrefs(prefs);
              startLoop(pickedCells(), prefs.loop);
            },
          },
          {
            label: '消す',
            confirm: 'もう一度押すと消す',
            close: true,
            run: () => {
              sets = sets.filter((s) => s !== set);
              saveSoon();
              renderPlayback();
              setStatus(`組「${set.name}」を消しました`, 3000);
            },
          },
        ],
      });
    }
    const rect = setsButton.getBoundingClientRect();
    loopMenu.open(rect.left, rect.top - 4, entries);
  }

  shelfSave.addEventListener('click', () => openSaveSet(shelfSave));
  shelfAsk.addEventListener('click', () => openAskMenu(shelfAsk, 'picked'));
  askAiButton.addEventListener('click', () => (askMenu.isOpen ? askMenu.close() : openAskMenu(askAiButton)));
  setsButton.addEventListener('click', openSetsMenu);

  // Enter：固定したマスのメモに一行足す（500 字を超えるなら足さずに知らせる）
  function commitLine() {
    const text = lineInput.value.replace(/\s+/g, ' ').trim();
    const cell = pinnedCell();
    if (!text || !cell) return;
    if (writesCard()) {
      commitCard(cell, text);
      return;
    }
    const before = marks.get(cell.key)?.note;
    const note = before ? `${before}\n${text}` : text;
    if ([...note].length > NOTE_MAX) {
      setStatus(`このマスのメモは ${NOTE_MAX} 字までです（「広げる」で今のメモを直せます）`, 5000);
      return;
    }
    drafts.delete(cell.key);
    lineInput.value = '';
    pin = null;
    setMark(cell, { note });
    void releasePlayback();
    setStatus(`${cellTime(cell)} のマスにメモを残しました`, 2500);
  }

  // Esc：書きかけを下書きに残して欄を抜ける。欄を抜けた直後の Esc で読む画面が閉じることを、一度だけ知らせる
  function leaveLine() {
    const text = lineInput.value.trim();
    stashLine();
    pin = null;
    void releasePlayback();
    renderLine();
    root.focus();
    const parts = [text ? '書きかけを下書きに残しました（このマスで欄に戻ると出ます）' : '欄を抜けました', escNoted ? '' : 'もう一度 Esc で読む画面を閉じます（欄へ戻るには C）'];
    escNoted = true;
    setStatus(parts.filter(Boolean).join('。'), 5000);
  }

  // 一行の欄へ（C・「メモ」）。動画でなければ今までの 2 行の欄
  function focusLine() {
    if (!lineUsable()) {
      openNoteForm();
      return;
    }
    prefillDraft();
    lineInput.focus();
  }

  // 欄が空で、今のマスに下書きがあれば出す（書く先もそのマスに固定する）
  function prefillDraft() {
    if (lineInput.value || pin !== null) return;
    const index = writeIndex();
    const cell = cells[index];
    const draft = cell ? drafts.get(cell.key) : undefined;
    if (!cell || !draft) return;
    lineInput.value = draft;
    pin = index;
    renderLine();
  }

  // 書く先を ‹ › で付け替える（見出しのマスは飛ばす）
  function movePin(delta: number) {
    if (!cells.length) return;
    pin = writableCell(pin ?? current, delta);
    renderLine();
    lineInput.focus();
  }

  line.addEventListener('submit', (e) => {
    e.preventDefault();
    commitLine();
  });
  lineInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      commitLine();
    } else if (e.key === 'Escape' && !e.isComposing) {
      e.preventDefault();
      leaveLine();
    }
  });
  lineInput.addEventListener('input', () => {
    if (lineInput.value.trim()) beginWriting();
  });
  // 欄に入ったとき（押して入ったときも）：空で、今のマスに下書きがあれば出す
  lineInput.addEventListener('focus', prefillDraft);
  // 空のまま欄を離れたら、固定と再生を戻す（空にした下書きは捨てる）。書きかけがあれば、そのまま（マスを押してから戻って続けられる）
  lineInput.addEventListener('blur', () => {
    if (lineInput.value.trim() || pin === null) return;
    const cell = pinnedCell();
    if (cell && drafts.delete(cell.key)) saveSoon();
    pin = null;
    void releasePlayback();
    renderLine();
  });
  pinPrev.addEventListener('click', () => movePin(-1));
  pinNext.addEventListener('click', () => movePin(1));
  writePlayButton.addEventListener('click', () => {
    prefs.writePlay = WRITE_PLAY_ORDER[(WRITE_PLAY_ORDER.indexOf(prefs.writePlay) + 1) % WRITE_PLAY_ORDER.length];
    savePrefs(prefs);
    renderLine();
    setStatus(`${WRITE_PLAY_LABEL[prefs.writePlay]}（次に書き始めたときから）`, 2500);
  });
  // 広げる：書きかけを持って 2 行の欄へ（書くあいだの再生は戻す）
  wideButton.addEventListener('click', () => {
    const cell = pinnedCell();
    if (!cell) return;
    const extra = lineInput.value.trim();
    if (extra) drafts.delete(cell.key);
    lineInput.value = '';
    pin = null;
    void releasePlayback();
    renderLine();
    openNoteForm(cell, extra);
  });

  async function askCompanion() {
    const cell = cells[current];
    if (!cell) return;
    if (await pageIsBlocked(url)) {
      setStatus(BLOCK_NOTE, 6000);
      return;
    }
    const text = cell.start !== undefined ? `[${timeLabel(cell.start)}] ${cell.text}` : cell.text;
    askLeft({ command: 'askCompanion', text, title, url: cell.start !== undefined ? timedUrl(url, cell.start) : url });
    setStatus('右の相棒に聞いています', 2500);
  }

  async function runAi() {
    if (!cells.length) return;
    if (await pageIsBlocked(url)) {
      setStatus(BLOCK_NOTE, 6000);
      return;
    }
    aiButton.disabled = true;
    setStatus('AI がページを読んでいます…（長いページは1分ほどかかります）');
    try {
      const result = await analyzeCells(title, cells, settings());
      const levels: Record<string, number> = {};
      for (const [index, level] of result.levels) levels[cells[index].key] = level;
      ai = {
        at: Date.now(),
        levels,
        terms: result.terms.map((t) => ({ key: cells[t.index].key, term: t.term, explanation: t.explanation })),
        cost: result.cost,
      };
      render();
      void persist();
      setStatus(`要点のマス ${result.levels.size} 個と、言葉の解説 ${result.terms.length} 個を付けました${result.cost > 0 ? `（約 $${result.cost.toFixed(3)}）` : ''}`, 6000);
    } catch (error) {
      setStatus(`うまくいきませんでした：${error instanceof Error ? error.message : String(error)}`, 8000);
    } finally {
      aiButton.disabled = false;
    }
  }

  async function translateCaptions() {
    if (!cells.some((c) => c.start !== undefined && !c.head)) return;
    if (await pageIsBlocked(url)) {
      setStatus(BLOCK_NOTE, 6000);
      return;
    }
    translateButton.disabled = true;
    setStatus('字幕を日本語にしています…');
    try {
      const result = await translateCells(
        cells.map((c) => ({ text: c.text, head: c.head })),
        settings(),
      );
      const next = new Map<string, string>();
      for (const [index, line] of result.lines) {
        const cell = cells[index];
        if (cell && !cell.head) next.set(cell.key, line);
      }
      ja = next;
      render();
      void persist();
      const cost = result.cost > 0 ? `（約 $${result.cost.toFixed(3)}）` : '';
      const clip = result.clipped ? '長いので、最初の部分だけ訳しました。' : '';
      setStatus(`区間の下に日本語を出しました${cost}${clip}`, 6000);
    } catch (error) {
      setStatus(`うまくいきませんでした：${error instanceof Error ? error.message : String(error)}`, 8000);
    } finally {
      translateButton.disabled = false;
    }
  }

  async function sendMarksToHexMemo() {
    const target = hexMemoTarget();
    if (!target) {
      setStatus('右の相棒の ⚙ で「六角メモの送り先」を選んでから、もう一度押してください', 6000);
      return;
    }
    const marked = cells.filter((c) => {
      const m = marks.get(c.key);
      return !!m && (m.liked > 0 || !!m.note);
    });
    if (marked.length === 0) {
      setStatus('♥ かメモを付けたマスがありません', 4000);
      return;
    }
    setStatus('六角メモへ送っています…');
    const now = new Date().toISOString();
    const records: HexMemoRecord[] = marked.map((c) => {
      const m = marks.get(c.key);
      const lines = [c.start !== undefined ? `[${timeLabel(c.start)}] ${c.text}` : c.text];
      if (m?.note) lines.push('', `メモ：${m.note}`);
      const link = c.start !== undefined ? timedUrl(url, c.start) : url;
      return {
        text: lines.join('\n'),
        createdAt: now,
        tags: ['ハイライト', ...(m?.liked ? [`いいね${m.liked}`] : [])],
        urls: /^https?:\/\//i.test(link) ? [{ url: link, title }] : undefined,
      };
    });
    for (let i = 0; i < records.length; i += 50) {
      const outcome = await sendToHexMemo(target, records.slice(i, i + 50));
      if (!outcome.ok) {
        setStatus(`送れませんでした：${outcome.error}`, 8000);
        return;
      }
    }
    setStatus(`${records.length} マスを、六角メモ「${target.label}」へ送りました`, 6000);
  }

  async function persist() {
    if (!url || cells.length === 0) return;
    const saved: ReaderSaved = {
      version: 1,
      url,
      title,
      savedAt: Date.now(),
      position: cells[current]?.key ?? null,
      marks: Object.fromEntries(marks),
      ai: ai ?? undefined,
      comments: comments.length > 0 ? comments : undefined,
      ja: ja.size > 0 ? Object.fromEntries(ja) : undefined,
      drafts: drafts.size > 0 ? [...drafts].map(([key, text]) => ({ key, text })) : undefined,
      sets: sets.length > 0 ? sets : undefined,
      aiSpent: aiSpent > 0 ? Math.round(aiSpent * 1_000_000) / 1_000_000 : undefined,
      liveCells:
        video?.kind === 'live'
          ? cells.filter((c) => c.start !== undefined).map((c) => ({ text: c.text, start: c.start ?? 0, end: c.end ?? c.start ?? 0, para: c.para || undefined }))
          : liveSaved.length > 0
            ? liveSaved
            : undefined,
    };
    await saveReader(saved);
  }

  function settings(): OrganizeSettings {
    const p = readAiPrefs();
    return { apiKey, practice: p.practice, model: p.model };
  }

  // ---------- 操作 ----------
  // 全体の地図（V6d）：押すとその時刻のマスへ移って再生（今の go）。900 マスの外は知らせるだけ
  mapBar.addEventListener('click', (e) => {
    if (!mapModel) return;
    const f = mapFraction(e);
    if (overviewInCut(mapModel, f)) {
      setStatus(`${cut?.side === 'start' ? 'ここは外した古いマスの所です' : 'ここは 900 マスの外です'}（区間セルに入っていません）`, 4000);
      return;
    }
    const at = cellAt(overviewTime(mapModel, f));
    const index = at >= 0 ? at : cells.findIndex((c) => !c.head && c.start !== undefined);
    if (index >= 0) go(index);
  });
  mapBar.addEventListener('mousemove', (e) => {
    if (!mapModel) return;
    const f = mapFraction(e);
    const t = overviewTime(mapModel, f);
    const chapter = chapterNameAt(t);
    mapBar.title = overviewInCut(mapModel, f) ? `${timeLabel(t)}・${cutLabel()}（区間セルに入っていません）` : `${timeLabel(t)}${chapter ? `・${chapter}` : ''}（押すとその場面へ）`;
  });
  capClose.addEventListener('click', () => {
    capClosed.add(url);
    capNote.hidden = true;
    root.focus();
  });
  // コメント用に写す（V6e）
  exportButton.addEventListener('click', () => (exportBox.hidden ? openExport() : closeExport(true)));
  exportRedo.addEventListener('click', openExport);
  exportClose.addEventListener('click', () => closeExport(true));
  exportCopy.addEventListener('click', () => void copyExport());
  exportText.addEventListener('input', () => renderExportCount());
  exportText.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    closeExport(true);
  });

  canvas.addEventListener('click', (e) => {
    const node = (e.target as Element).closest<HTMLElement>('.rcell');
    if (!node?.dataset.index) return;
    const index = Number(node.dataset.index);
    // 選ぶ（V3b）：Ctrl・Shift+クリック、または「選ぶ」を押してあるとき。時刻のあるマスだけ
    if (lineUsable() && (e.ctrlKey || e.metaKey || e.shiftKey || pickMode)) {
      pickCell(index, e.shiftKey);
      return;
    }
    go(index);
  });
  prevButton.addEventListener('click', () => step(-1));
  nextButton.addEventListener('click', () => step(1));
  likeButton.addEventListener('click', cycleLike);
  noteButton.addEventListener('click', focusLine);
  askButton.addEventListener('click', askCompanion);
  aiButton.addEventListener('click', () => void runAi());
  translateButton.addEventListener('click', () => void translateCaptions());
  hexButton.addEventListener('click', () => void sendMarksToHexMemo());
  vocabButton.addEventListener('click', () => addTerms(ai?.terms ?? []));
  digestButton.addEventListener('click', toggleDigest);
  playButton.addEventListener('click', () => void playPause());
  repeatButton.addEventListener('click', toggleRepeat);
  speedButtons.forEach((b, i) => b.addEventListener('click', () => void setSpeed(SPEEDS[i])));
  reloadButton.addEventListener('click', () => {
    if (tabId !== null) void open(tabId, url, title);
  });
  // 区間セルの置き場所（右・下）と、その幅・高さ
  const placeSurface = () =>
    send({ type: 'setSidebar', side: 'reader', visible: true, split: prefs.videoLayout, width: prefs.videoWidth, height: prefs.videoHeight });
  widthButton.addEventListener('click', () => {
    if (prefs.videoLayout === 'bottom') prefs.videoHeight = VIDEO_HEIGHTS[(VIDEO_HEIGHTS.indexOf(prefs.videoHeight) + 1) % VIDEO_HEIGHTS.length];
    else prefs.videoWidth = VIDEO_WIDTHS[(VIDEO_WIDTHS.indexOf(prefs.videoWidth) + 1) % VIDEO_WIDTHS.length];
    savePrefs(prefs);
    renderHead();
    placeSurface();
  });
  layoutButton.addEventListener('click', () => {
    prefs.videoLayout = prefs.videoLayout === 'bottom' ? 'right' : 'bottom';
    prefs.flow = prefs.videoLayout === 'bottom'; // 下に並べるときは流れる表示が見やすい（あとで切り替えられる）
    savePrefs(prefs);
    renderHead();
    placeSurface();
    render();
    scrollToCurrent(false);
  });
  flowButton.addEventListener('click', () => {
    prefs.flow = !prefs.flow;
    savePrefs(prefs);
    renderHead();
    render();
    scrollToCurrent(false);
  });
  listenButton.addEventListener('click', () => {
    if (captions.active) {
      stopLive();
      renderHead();
      setStatus('聞き取りをやめました（聞き取ったマスは残ります）', 3000);
      return;
    }
    // ページ（ラジオなど）が見えるよう、右か下に並べてから聞き取る
    placeSurface();
    void startLive();
  });
  liveButton.addEventListener('click', () => {
    const order: LiveLevel[] = ['off', 'some', 'often'];
    prefs.liveAi = order[(order.indexOf(prefs.liveAi) + 1) % order.length];
    savePrefs(prefs);
    lastLiveIndex = Math.max(lastLiveIndex, current - 1); // 今の場所から先に返す
    renderHead();
    renderPlayback();
  });
  closeButton.addEventListener('click', close);
  keyOnlyButton.addEventListener('click', () => {
    prefs.keyOnly = !prefs.keyOnly;
    savePrefs(prefs);
    render();
  });
  spacingButton.addEventListener('click', () => {
    prefs.spacing = prefs.spacing === 'roomy' ? 'normal' : 'roomy';
    savePrefs(prefs);
    relayout();
  });
  smaller.addEventListener('click', () => resize(0.88));
  bigger.addEventListener('click', () => resize(1 / 0.88));

  function resize(factor: number) {
    if (video) prefs.videoSize = clamp(Math.round(prefs.videoSize * factor), 50, 170);
    else prefs.size = clamp(Math.round(prefs.size * factor), 60, 170);
    savePrefs(prefs);
    relayout();
  }

  function relayout() {
    if (!cells.length) return;
    layoutCells();
    render();
    scrollToCurrent(false);
  }

  root.tabIndex = -1;
  window.addEventListener('keydown', (e) => {
    if (root.hidden) return;
    if (linkMenu.isOpen || loopMenu.isOpen) return; // 一覧の Esc は一覧だけ閉じる（CellMenu が受ける）
    if (ask.isOpen || writing || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const keys: Record<string, () => void> = {
      ArrowRight: () => step(1),
      ArrowDown: () => step(1),
      Enter: () => step(1),
      ' ': () => (video?.id ? void playPause() : step(e.shiftKey ? -1 : 1)),
      r: toggleRepeat,
      R: toggleRepeat,
      ArrowLeft: () => step(-1),
      ArrowUp: () => step(-1),
      Home: () => go(0),
      End: () => go(cells.length - 1),
      Escape: () => (picked.length > 0 ? clearPicks() : close()),
      l: cycleLike,
      L: cycleLike,
      c: focusLine,
      C: focusLine,
      a: askCompanion,
      A: askCompanion,
      k: () => keyOnlyButton.click(),
      K: () => keyOnlyButton.click(),
      w: () => addTerms((ai?.terms ?? []).filter((t) => t.key === cells[current]?.key)),
      W: () => addTerms((ai?.terms ?? []).filter((t) => t.key === cells[current]?.key)),
    };
    const action = keys[e.key];
    if (!action) return;
    e.preventDefault();
    action();
  });
  // ピンチ（Ctrl+ホイール）で大きさを変える
  scroller.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      resize(e.deltaY > 0 ? 0.94 : 1 / 0.94);
    },
    { passive: false },
  );
  // 背が低いとき（動画の下に並べるなど）は、見出しとボタンを1行にまとめる
  const fitHeight = () => root.classList.toggle('short', window.innerHeight < 480);
  window.addEventListener('resize', fitHeight);
  fitHeight();
  let lastWidth = 0;
  new ResizeObserver(() => {
    if (Math.abs(scroller.clientWidth - lastWidth) < 20) return;
    lastWidth = scroller.clientWidth;
    relayout();
  }).observe(scroller);

  // ---------- C++ と左サイドバーからの連絡 ----------
  const askLeft = (action: RelayCommand) => send({ type: 'relay', to: 'left', payload: { kind: 'command', action } });
  onMessage((msg) => {
    if (msg.type === 'hello') {
      send({ type: 'relay', to: 'left', payload: { kind: 'requestState' } });
    } else if (msg.type === 'apiKey') {
      apiKey = msg.key;
    } else if (msg.type === 'relayed' && msg.payload.kind === 'readerLinks') {
      links = msg.payload.view;
      renderLine();
      renderLinkBadges();
      renderGlow();
      renderMap();
      sendNow(); // 今のマスと結んだカードが変わったかもしれない
    } else if (msg.type === 'relayed' && msg.payload.kind === 'readerSeek') {
      seekTo(msg.payload.video, msg.payload.start);
    } else if (msg.type === 'relayed' && msg.payload.kind === 'readerGlow') {
      setGlow(msg.payload.memoId, msg.payload.replyId);
    } else if (msg.type === 'relayed' && msg.payload.kind === 'readerPing') {
      sendNow(true); // 下の区画が動き出した：今のマスとチャプターを送り直す
      sendChapters(true);
    } else if (msg.type === 'relayed' && msg.payload.kind === 'readerCardDone') {
      onCardDone(msg.payload);
    } else if (msg.type === 'relayed' && msg.payload.kind === 'readerExportDone') {
      onExportDone(msg.payload);
    } else if (msg.type === 'relayed' && msg.payload.kind === 'readerOpen') {
      ask.dismiss();
      closeCaptureView();
      closeCropView();
      root.hidden = false;
      readerShown = true;
      void open(msg.payload.tabId, msg.payload.url, msg.payload.title);
      root.focus();
    } else if (msg.type === 'relayed' && msg.payload.kind === 'shotStart') {
      // 六角形スクショ：読む画面は隠して、撮る画面を出す
      ask.dismiss();
      closeCaptureView();
      closeCropView();
      openToken++;
      stopPolling();
      root.hidden = true;
      startShot(
        msg.payload.image,
        msg.payload.title,
        (result) => {
          // Grok に送る（S3.12）：読む画面は隠したまま。左が依頼の小窓（画像のサムネイルつき）を開いてもらう（botAsk の shot）。
          //   小窓を閉じたら読む画面も閉じる（over: page）。root は小窓が閉じたときに戻す
          if (result?.to === 'grok') askHidRoot = true;
          else root.hidden = false;
          askLeft(result ? { command: 'shotDone', ...result } : { command: 'shotCancel' });
        },
        msg.payload.purpose,
      );
    } else if (msg.type === 'relayed' && msg.payload.kind === 'captureCrop') {
      ask.dismiss();
      closeCaptureView();
      openToken++;
      stopPolling();
      root.hidden = true;
      const image = msg.payload.image;
      openCropView(image, {
        onDone: (cropped) => askLeft({ command: 'cropDone', image: cropped }),
        onCancel: () => askLeft({ command: 'cropCancel' }),
      });
    } else if (msg.type === 'relayed' && msg.payload.kind === 'captureOpen') {
      ask.dismiss();
      closeCropView();
      openToken++;
      stopPolling();
      root.hidden = true;
      const opened = msg.payload;
      openCaptureView(opened, {
        onMarks: (marks) => askLeft({ command: 'captureMarks', id: opened.id, marks }),
        onStrokes: (strokes) => askLeft({ command: 'captureStrokes', id: opened.id, strokes }),
        onHide: (rects, mode, seq) => askLeft({ command: 'captureHide', id: opened.id, rects, mode, seq }),
        onUnhide: (seq) => askLeft({ command: 'captureUnhide', id: opened.id, seq }),
        onClose: () => askLeft({ command: 'captureClose' }),
      });
    } else if (msg.type === 'relayed' && msg.payload.kind === 'captureChanged') {
      refreshCaptureView(msg.payload.id, msg.payload.image, msg.payload.blur, msg.payload.undo); // 隠した・取り消した（どこから隠しても）。画像と隠した場所を新しくする
    } else if (msg.type === 'relayed' && msg.payload.kind === 'captureHideDone') {
      settleCaptureHide(msg.payload.id, msg.payload.seq, msg.payload.ok, msg.payload.reason); // 頼んだ隠す・取り消すの返事。ここで初めて「隠しました」と言う
    } else if (msg.type === 'relayed' && msg.payload.kind === 'botAsk') {
      // 「🔍 Grok に調べてもらう」（S3.11）：ページの上なら読む画面は隠して、依頼の小窓だけを出す。六角で読んでいる上なら重ねる
      if (msg.payload.over !== 'reader' && !root.hidden) {
        openToken++;
        stopPolling();
        root.hidden = true;
        askHidRoot = true;
      }
      ask.open(msg.payload);
    } else if (msg.type === 'relayed' && msg.payload.kind === 'botAnswerLines') {
      ask.answerLines(msg.payload); // 小窓の「続きとして」の要点の行（R5。頼んだものだけを使う）
    } else if (msg.type === 'relayed' && msg.payload.kind === 'botHookResult') {
      ask.hookResult(msg.payload); // 小窓の webhook「そのまま送る」の結果（R11。頼んだものだけを使う）
    } else if (msg.type === 'sidebars' && !msg.state.reader?.visible) {
      ask.dismiss(); // 読む画面が閉じられた（左の「六角で読む」のボタンなど）：小窓も片づける
      closeCaptureView();
      closeCropView();
      hideNow();
    } else if (msg.type === 'flush') {
      void persist();
    }
  });
  send({ type: 'getApiKey' });
  setStatus('');
  send({ type: 'ready' });
}

// 六角形のマス（外側が枠の色、内側が中身。どちらも六角形に切り抜く）
function hexNode(className: string, x: number, y: number, w: number, r: number): HTMLElement {
  const node = el('div', className);
  node.style.left = `${x - w / 2}px`;
  node.style.top = `${y - r}px`;
  node.style.width = `${w}px`;
  node.style.height = `${2 * r}px`;
  node.append(el('div', 'rcell-inner'));
  return node;
}

function toolButton(label: string, title: string) {
  const b = el('button', 'reader-tool', label);
  b.type = 'button';
  b.title = title;
  return b;
}

// 相棒の設定（モデル・練習モード・六角メモの送り先）は、右サイドバーの ⚙ のものを使う（同じ保存場所）
function readAiPrefs(): { model: ModelId; practice: boolean; hexMemoTarget: HexMemoTarget | null } {
  try {
    const s = JSON.parse(localStorage.getItem('honeycomb.ai') ?? '{}') as Record<string, unknown>;
    const target = s.hexMemoTarget as HexMemoTarget | null | undefined;
    return {
      model: MODELS.some((m) => m.id === s.model) ? (s.model as ModelId) : MODELS[0].id,
      practice: s.practice === true,
      hexMemoTarget: target && typeof target.boardId === 'string' && typeof target.label === 'string' ? target : null,
    };
  } catch {
    return { model: MODELS[0].id, practice: false, hexMemoTarget: null };
  }
}

function hexMemoTarget() {
  return readAiPrefs().hexMemoTarget;
}

function loadPrefs(): ReaderPrefs {
  const defaults: ReaderPrefs = {
    size: 92,
    spacing: 'normal',
    keyOnly: false,
    videoWidth: 520,
    videoSize: 76,
    videoLayout: 'right',
    videoHeight: 340,
    flow: false,
    liveAi: 'off',
    writePlay: 'pause',
    writeTo: 'card',
    loop: cleanLoopOptions(null),
    ask: { range: 'chapter', kind: 'tech', lens: 'comedy' },
  };
  try {
    const s = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Record<string, unknown>;
    return {
      size: typeof s.size === 'number' ? clamp(s.size, 60, 170) : defaults.size,
      spacing: s.spacing === 'roomy' ? 'roomy' : 'normal',
      keyOnly: s.keyOnly === true,
      videoWidth: VIDEO_WIDTHS.includes(Number(s.videoWidth)) ? Number(s.videoWidth) : defaults.videoWidth,
      videoSize: typeof s.videoSize === 'number' ? clamp(s.videoSize, 50, 170) : defaults.videoSize,
      videoLayout: s.videoLayout === 'bottom' ? 'bottom' : 'right',
      videoHeight: VIDEO_HEIGHTS.includes(Number(s.videoHeight)) ? Number(s.videoHeight) : defaults.videoHeight,
      flow: s.flow === true,
      liveAi: s.liveAi === 'some' || s.liveAi === 'often' ? s.liveAi : 'off',
      writePlay: s.writePlay === 'slow' || s.writePlay === 'keep' ? s.writePlay : 'pause',
      writeTo: s.writeTo === 'note' ? 'note' : 'card',
      loop: cleanLoopOptions(s.loop),
      ask: cleanAskPrefs(s.ask),
    };
  } catch {
    return defaults;
  }
}

// 頼み板の設定（形の合わないものは既定：このチャプター・技法の色・お笑い）
function cleanAskPrefs(raw: unknown): ReaderPrefs['ask'] {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const range: AskRange = o.range === 'one' || o.range === 'picked' || o.range === 'all' ? o.range : 'chapter';
  const talk = (TALK_MODES as readonly unknown[]).includes(o.kind) ? (o.kind as TalkMode) : null;
  const kind: AskKind | TalkMode = talk ?? (o.kind === 'bones' || o.kind === 'tendon' || o.kind === 'pause' || o.kind === 'apply' ? o.kind : 'tech');
  const lens: AskLens = o.lens === 'lecture' ? 'lecture' : 'comedy';
  return { range, kind, lens };
}

function savePrefs(prefs: ReaderPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // 保存できなくても動作は続ける
  }
}
