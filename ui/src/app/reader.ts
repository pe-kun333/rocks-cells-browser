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
import { onMessage, send } from '../bridge';
import { DIRECTIONS, type Hex, hexKey } from '../hex';
import { type HexMemoTarget, sendToHexMemo } from '../integrations/hexmemo';
import { analyzeCells } from '../reader/ai';
import { translateCells } from '../reader/translate';
import { extractPage } from '../reader/extract';
import { CHUNK, type Chunk, layout, splitText, toAxial } from '../reader/ribbon';
import { LiveCaptions, type LiveStatus } from '../reader/live';
import { fileNameOf, isMediaFileUrl, parseSubtitles, readSidecarSubtitle } from '../reader/media';
import { type CellMark, cellKeys, loadReader, type ReaderAi, type ReaderSaved, saveReader } from '../reader/store';
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
}

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
  tools.append(listenButton, liveButton, layoutButton, flowButton, keyOnlyButton, aiButton, translateButton, digestButton, spacingButton, smaller, bigger, widthButton, reloadButton, vocabButton, hexButton, closeButton);
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
  const noteButton = toolButton('メモ', 'このマスにメモを書く（C）');
  const askButton = toolButton('相棒に聞く', 'このマスについて、右の相棒に聞く（A）');
  const playButton = toolButton('▶', '再生・一時停止（Space）');
  const timeBox = el('span', 'reader-time');
  const repeatButton = toolButton('くり返す', 'このマスの区間をくり返し再生する（R）');
  const SPEEDS = [0.75, 1, 1.25] as const;
  const speedButtons = SPEEDS.map((rate) => {
    const b = toolButton(rate === 1 ? '1×' : `${rate}×`, `再生の速さ ${rate} 倍。くり返しと一緒に使えます`);
    b.dataset.rate = String(rate);
    return b;
  });
  const liveBox = el('span', 'reader-live');
  bar.append(prevButton, count, nextButton, playButton, timeBox, liveBox, heading, progress, likeButton, noteButton, repeatButton, ...speedButtons, askButton);
  const status = el('div', 'reader-status');
  root.append(head, choices, scroller, listening, info, bar, status);
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
    canvas.replaceChildren();
    choices.replaceChildren();
    info.replaceChildren();
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
    const chunks = transcriptChunks({ videoId: '', title, duration: t.duration, chapters: t.chapters, segments: t.segments, source: 'captions' }).slice(0, MAX_CELLS);
    const keys = cellKeys(chunks.map((c) => c.text));
    cells = chunks.map((c, index) => ({ ...c, index, key: keys[index], q: 0, r: 0 }));
    const saved = await loadReader(url);
    if (token !== openToken) return;
    marks = new Map(Object.entries(saved?.marks ?? {}));
    ai = saved?.ai ?? null;
    ja = new Map(Object.entries(saved?.ja ?? {}));
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
    scrollToCurrent(false);
    reportProgress();
    startPolling();
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
      comments = saved?.comments ?? [];
      const resume = saved?.position ? cells.findIndex((c) => c.key === saved.position) : -1;
      current = resume >= 0 ? resume : Math.max(0, cells.length - 1);
      maxReached = current;
      repeat = false;
      digest = null;
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
      cells = cells.slice(-MAX_CELLS).map((c, i) => ({ ...c, index: i }));
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
    void persist();
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
    repeatButton.setAttribute('aria-pressed', String(repeat));
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
    requestAnimationFrame(fitText);
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

  // ---------- 読み進める ----------
  // seekToo：動画のとき、その場面へ移す（再生位置に合わせて動かすときは false）
  function go(index: number, smooth = true, seekToo = true) {
    if (!cells.length) return;
    current = clamp(index, 0, cells.length - 1);
    if (video?.id && (video.kind !== 'live' || liveClock === 'media') && seekToo && tabId !== null) {
      lastUserMove = Date.now();
      digest = null;
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

  function openNoteForm() {
    const cell = cells[current];
    if (!cell) return;
    writing = true;
    const form = el('form', 'reader-note-form');
    const text = el('textarea', 'reader-note-input');
    text.rows = 2;
    text.placeholder = `${cell.index + 1} 番のマスへのメモ（Ctrl+Enter で残す・Esc でやめる）`;
    text.value = marks.get(cell.key)?.note ?? '';
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
  canvas.addEventListener('click', (e) => {
    const node = (e.target as Element).closest<HTMLElement>('.rcell');
    if (node?.dataset.index) go(Number(node.dataset.index));
  });
  prevButton.addEventListener('click', () => step(-1));
  nextButton.addEventListener('click', () => step(1));
  likeButton.addEventListener('click', cycleLike);
  noteButton.addEventListener('click', openNoteForm);
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
    if (ask.isOpen || writing || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
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
      Escape: close,
      l: cycleLike,
      L: cycleLike,
      c: openNoteForm,
      C: openNoteForm,
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
    } else if (msg.type === 'relayed' && msg.payload.kind === 'readerOpen') {
      ask.dismiss();
      closeCaptureView();
      closeCropView();
      root.hidden = false;
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
    };
  } catch {
    return defaults;
  }
}

function savePrefs(prefs: ReaderPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // 保存できなくても動作は続ける
  }
}
