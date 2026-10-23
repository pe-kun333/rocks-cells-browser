// デモの台本：テスト用の Rocks-cells Browser を CDP で操作し、字幕・カーソル・キー・見取り図の印の時刻を timeline.json に書く
//   ふつうは record.ps1 から動かす。node drive.mjs <port> <framesDir> <mediaDir>
//   FROM=5 のように付けると、その場面から始める（台本を直すときの試し用。前の場面の状態が要る所もある）
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const [port, framesDir, mediaDir] = process.argv.slice(2);
const SITE = 'http://127.0.0.1:8766/site';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- 記録 ----------
const timeline = [];
const mark = (type, data = {}) => timeline.push({ t: Date.now(), type, ...data });
const caption = (title, text, note = '') => (log(title), 0) || mark('caption', { title, text, note });
const fast = (rate) => mark('speed', { rate }); // 1 = ふつう
const save = () => writeFileSync(`${framesDir}\\timeline.json`, JSON.stringify(timeline));

// ---------- CDP ----------
const targets = async () => {
  try {
    return await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  } catch {
    return [];
  }
};
const soft = (p) => p.catch((e) => log('skip:', e.message));
const logCount = (name) => S[name].eval(`document.querySelectorAll('.ai-log > *').length`);
async function waitFor(fn, label, timeoutMs = 30000) {
  const start = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout: ${label}`);
    await sleep(200);
  }
}
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };
  const ready = new Promise((r) => (ws.onopen = r));
  const call = async (method, params = {}) => {
    await ready;
    const id = ++nextId;
    ws.send(JSON.stringify({ id, method, params }));
    const m = await new Promise((r) => pending.set(id, r));
    if (m.error) throw new Error(`${method}: ${m.error.message}`);
    return m.result;
  };
  return {
    call,
    async eval(expression) {
      const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
      return r.result?.value;
    },
    close: () => ws.close(),
  };
}
const surfaceTarget = (name) => async () => (await targets()).find((t) => t.url.includes(`surface=${name}`));
const pageTarget = (pred) => async () => (await targets()).find((t) => t.type === 'page' && !t.url.includes('surface=') && pred(t.url));

// ---------- 画面の位置（DIP） ----------
const meta = await waitFor(async () => existsSync(`${framesDir}\\meta.json`) && JSON.parse(readFileSync(`${framesDir}\\meta.json`, 'utf8')), 'meta');
const clientW = meta.clientW / meta.scale;
const clientH = meta.clientH / meta.scale;
const S = { left: null, right: null, reader: null, page: null };
async function visible(c) {
  try {
    return c && (await c.eval('document.visibilityState')) === 'visible';
  } catch {
    return false;
  }
}
async function origin(name) {
  if (name === 'left') return { x: 0, y: 0 };
  const L = await S.left.eval('innerWidth');
  let R = 0;
  if (await visible(S.right)) R = await S.right.eval('innerWidth');
  if (name === 'right') return { x: clientW - R, y: 0 };
  if (name === 'reader') {
    const [w, h] = await S.reader.eval('[innerWidth, innerHeight]');
    if (h < clientH - 4) return { x: L, y: clientH - h };
    if (w < clientW - L - R - 4) return { x: clientW - R - w, y: 0 };
    return { x: L, y: 0 };
  }
  return { x: L, y: 0 }; // page
}

// ---------- マウスとキー（本物の入力として送る） ----------
let cursorAbs = { x: 200, y: 600 };
async function moveTo(name, x, y, ms = 450) {
  const o = await origin(name);
  const to = { x: o.x + x, y: o.y + y };
  mark('cursor', { x: cursorAbs.x, y: cursorAbs.y });
  const steps = Math.max(2, Math.round(ms / 50));
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    const ax = cursorAbs.x + (to.x - cursorAbs.x) * k;
    const ay = cursorAbs.y + (to.y - cursorAbs.y) * k;
    const lx = ax - o.x;
    const ly = ay - o.y;
    if (lx >= 0 && ly >= 0) await S[name].call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: lx, y: ly }).catch(() => {});
    await sleep(ms / steps);
  }
  cursorAbs = to;
  mark('cursor', { x: to.x, y: to.y });
}
async function click(name, x, y, { button = 'left', modifiers = 0, ms } = {}) {
  await moveTo(name, x, y, ms);
  mark('click', { x: cursorAbs.x, y: cursorAbs.y, button });
  if (button === 'right') {
    // 盤面の右クリック（ブラウザ自身のメニューを出さないよう、ページの contextmenu として送る）
    await S[name].eval(`(() => { const el = document.elementFromPoint(${x}, ${y}); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: ${x}, clientY: ${y} })); return true; })()`);
    return;
  }
  await S[name].call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1, modifiers });
  await sleep(70);
  await S[name].call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1, modifiers });
}
const center = (name, js) => S[name].eval(`(() => { const el = (${js}); if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
async function clickEl(name, js, opts) {
  const p = await waitFor(() => center(name, js), `element ${js}`, 15000);
  await click(name, p.x, p.y, opts);
}
const button = (text, scope = 'button') => `[...document.querySelectorAll(${JSON.stringify(scope)})].find((b) => !b.hidden && b.offsetParent && b.textContent.trim().startsWith(${JSON.stringify(text)}))`;
const VK = { Enter: 13, Escape: 27, ArrowRight: 39, ArrowLeft: 37, l: 76, a: 65, s: 83 };
async function key(name, k, { label = k, modifiers = 0, code } = {}) {
  mark('key', { label });
  const vk = VK[k] ?? k.toUpperCase().charCodeAt(0);
  const c = code ?? (k.length === 1 ? `Key${k.toUpperCase()}` : k);
  const text = k === 'Enter' ? '\r' : k.length === 1 && !modifiers ? k : undefined;
  const commands = modifiers === 2 && k === 'a' ? ['selectAll'] : undefined;
  await S[name].call('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: k, code: c, windowsVirtualKeyCode: vk, modifiers, text, commands });
  await S[name].call('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: c, windowsVirtualKeyCode: vk, modifiers });
}
async function type(name, text, cps = 14) {
  for (const ch of text) {
    await S[name].call('Input.insertText', { text: ch });
    await sleep(1000 / cps);
  }
}
// 盤面のふちの、空いたマスの位置（今のタブの近く）
async function emptySpot(prefer) {
  return waitFor(
    () =>
      S.left.eval(`(() => {
        const a = document.querySelector('g.cell.active').getBoundingClientRect();
        const cx = a.left + a.width / 2, cy = a.top + a.height / 2, w = a.width;
        const tries = ${JSON.stringify(prefer)}.map(([dx, dy]) => [cx + dx * w, cy + dy * w]);
        for (const [x, y] of tries) {
          if (x < 10 || y < 60 || x > innerWidth - 10) continue;
          const el = document.elementFromPoint(x, y);
          if (el && !el.closest('g.cell') && el.closest('#board')) return { x, y };
        }
        return null;
      })()`),
    'empty spot',
    5000,
  );
}
async function openAddress(url) {
  await clickEl('left', `document.getElementById('address')`);
  await key('left', 'a', { label: 'Ctrl+A', modifiers: 2 });
  await type('left', url, 40);
  await key('left', 'Enter');
}
async function attachPage(pred) {
  S.page?.close();
  S.page = connect((await waitFor(pageTarget(pred), 'page')).webSocketDebuggerUrl);
  await waitFor(() => S.page.eval(`document.readyState === 'complete'`), 'page load');
}
async function attachReader() {
  if (!S.reader) S.reader = connect((await waitFor(surfaceTarget('reader'), 'reader')).webSocketDebuggerUrl);
}
async function attachRight() {
  if (!S.right) S.right = connect((await waitFor(surfaceTarget('right'), 'right')).webSocketDebuggerUrl);
}
// 見取り図の印（あとで番号と説明を描く）
//   list の1つ：[面, 要素を返す式, 説明, 番号の印を目印からずらす量 dx, dy（DIP）]
//   zoom：盤面の小さいセルのように、拡大して見せる印の番号（0 から）
async function callouts(name, list, zoom = []) {
  const out = [];
  for (const [surface, js, label, dx = 0, dy = 0] of list) {
    const p = await center(surface, js).catch(() => null);
    if (!p) continue;
    const o = await origin(surface);
    out.push({ x: o.x + p.x, y: o.y + p.y, label, dx, dy });
  }
  let inset;
  const picked = zoom.map((i) => out[i]).filter(Boolean);
  if (picked.length > 0) {
    // 拡大する範囲：選んだ印のまわりを少し広めに
    const xs = picked.map((p) => p.x);
    const ys = picked.map((p) => p.y);
    const w = Math.max(150, Math.max(...xs) - Math.min(...xs) + 90);
    const h = Math.max(112, Math.max(...ys) - Math.min(...ys) + 70);
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2 + 10;
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    inset = { x: cx - w / 2, y: cy - h / 2, w, h, title: '盤面の拡大', points: zoom };
  }
  mark('mock', { name, points: out, inset });
}

const newest = `[...document.querySelectorAll('g.cell[data-id]')].sort((a, b) => Number(b.dataset.id) - Number(a.dataset.id))[0]`;
const FROM = Number(process.env.FROM || 1); // テスト用：この場面から始める

// ---------- 準備 ----------
S.left = connect((await waitFor(surfaceTarget('left'), 'left')).webSocketDebuggerUrl);
await waitFor(async () => (await S.left.eval(`document.querySelectorAll('g.cell').length`)) >= 1, 'tabs');
await S.left.eval(`(() => { localStorage.setItem('honeycomb.ai', JSON.stringify({ practice: true, second: { enabled: true, name: 'ミツ', role: 'tsukkomi', model: 'claude-sonnet-5-5', banter: true } })); return true; })()`);
await S.left.eval(`location.reload(); true`);
await sleep(2500);
S.left.close();
S.left = connect((await waitFor(surfaceTarget('left'), 'left')).webSocketDebuggerUrl);
await waitFor(async () => (await S.left.eval(`document.querySelectorAll('g.cell').length`)) >= 1, 'tabs again');
mark('start');

// ---------- 1. 六角形のタブ ----------
if (FROM <= 1) {
caption('1. 六角形のタブ', 'タブは左の盤面に、六角形のセルとして並ぶ。開いた元のすぐ隣に置かれる');
await openAddress(`${SITE}/hachi.html`);
await attachPage((u) => u.endsWith('hachi.html'));
await sleep(900);
const ids = {};
ids.hachi = await S.left.eval(`document.querySelector('g.cell.active').dataset.id`);
for (const name of ['hoshi', 'recipe']) {
  await clickEl('left', `document.getElementById('new-tab')`);
  await sleep(500);
  await openAddress(`${SITE}/${name}.html`);
  await attachPage((u) => u.endsWith(`${name}.html`));
  await sleep(700);
  ids[name] = await S.left.eval(`document.querySelector('g.cell.active').dataset.id`);
}
caption('1. 六角形のタブ', '番号の表示・小さい表示と大きい表示（リスト）。触れたタブは、左下の拡大表示で中身を確かめられる');
await clickEl('left', `document.getElementById('toggle-numbers')`);
await sleep(700);
await moveTo('left', ...(Object.values(await center('left', `document.querySelector('g.cell[data-id="${ids.hoshi}"]')`))), 600);
await sleep(2600);
await moveTo('left', ...(Object.values(await center('left', `document.querySelector('g.cell[data-id="${ids.hachi}"]')`))), 500);
await sleep(1600);
await click('left', ...Object.values(await center('left', `document.querySelector('g.cell[data-id="${ids.hachi}"]')`)));
await attachPage((u) => u.endsWith('hachi.html'));
await sleep(1200);
save();

}
// ---------- 2. メモのセル ----------
if (FROM <= 2) {
caption('2. メモのセル', '盤面の空いたところを右クリック →「メモを書く」。軽いメモを、タブと同じ盤面に置ける');
const spot1 = await emptySpot([[1, 0], [0.5, 0.87], [-1, 0], [-0.5, 0.87]]);
await click('left', spot1.x, spot1.y, { button: 'right' });
await sleep(900);
await clickEl('left', button('メモを書く', '.cell-menu button'));
await sleep(500);
await type('left', 'ミツバチの巣は「少ない材料で広い部屋」。日曜のラジオで続きを聞く', 16);
await sleep(400);
await key('left', 'Enter', { label: 'Ctrl+Enter', modifiers: 2 });
await sleep(900);
caption('2. メモのセル', '触れるとカードで読める（書き直す・♡・相棒に見せる・六角メモへ）。コピー・貼り付け・セットもタブと同じ');
await moveTo('left', ...Object.values(await center('left', `document.querySelector('g.cell.memo')`)), 600);
await sleep(2800);
save();

}
// ---------- 3. 六角形スクショ ----------
if (FROM <= 3) {
caption('3. 六角形スクショ', 'Ctrl+Shift+S（または右クリック）で、表示中のページを六角形の枠で切り取る');
const spot2 = await emptySpot([[0.5, 0.87], [-0.5, 0.87], [1, 0], [-1, 0], [0, 1.73]]);
await click('left', spot2.x, spot2.y, { button: 'right' });
await sleep(900);
await clickEl('left', button('スクショを撮って', '.cell-menu button'));
await attachReader();
await waitFor(() => S.reader.eval(`!!document.querySelector('.shot')`), 'shot');
await sleep(900);
const fig = await S.page.eval(`(() => { const r = document.querySelector('figure svg').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
await moveTo('reader', fig.x - 160, fig.y + 120, 700);
await moveTo('reader', fig.x - 20, fig.y, 900);
await sleep(700);
await click('reader', fig.x, fig.y, { ms: 300 });
await sleep(900);
caption('3. 六角形スクショ', 'ひとことを付けて「左のセルに置く」か「相棒に見せる」（画像を見て相棒が説明する）');
await S.reader.eval(`document.querySelector('.shot-comment')?.focus(); true`);
await type('reader', 'ハニカムの図。数学のページと見比べる', 14);
await sleep(500);
await key('reader', 'Enter');
await waitFor(async () => (await S.left.eval(`document.querySelectorAll('g.cell.memo').length`)) >= 2, 'shot memo');
await sleep(900);
await moveTo('left', ...Object.values(await center('left', `[...document.querySelectorAll('g.cell.memo')].find((g) => g.querySelector('image'))`)), 700);
await sleep(2800);
save();

}
// ---------- 4. 六角で読む ----------
if (FROM <= 4) {
caption('4. 六角で読む', '長い文章を、六角メモと同じ決まりで約70字ずつの六角セルに組み直して読む');
await clickEl('left', `document.getElementById('open-reader')`);
await waitFor(async () => (await S.reader.eval(`document.querySelectorAll('.rcell:not(.annot)').length`)) > 4, 'reader cells');
await S.reader.eval(`document.querySelector('.reader').focus(); true`);
await sleep(1500);
caption('4. 六角で読む', '→ で読み進め、L で ♥（押すたびに濃く）。印やしおりはページごとに残る');
for (let i = 0; i < 3; i++) {
  await key('reader', 'ArrowRight', { label: '→' });
  await sleep(750);
}
await key('reader', 'l', { label: 'L' });
await sleep(600);
await key('reader', 'l', { label: 'L' });
await sleep(900);
for (let i = 0; i < 2; i++) {
  await key('reader', 'ArrowRight', { label: '→' });
  await sleep(750);
}
caption('4. 六角で読む：AI で要点', '大事なマスを金色の枠で光らせ、難しい言葉の解説を行の間のマスに置く', 'AI の返事は練習モード（料金なし）のもの');
await clickEl('reader', button('AI で要点', '.reader-tool'));
fast(3);
await soft(waitFor(async () => (await S.reader.eval(`document.querySelectorAll('.rcell.annot').length`)) > 0, 'reader ai', 30000));
fast(1);
await sleep(2600);
caption('4. 六角で読む：相棒に聞く', 'A で、今のマスについて右の相棒に聞く', 'AI の返事は練習モード（料金なし）のもの');
await key('reader', 'a', { label: 'A' });
await attachRight();
await sleep(800);
const before1 = await logCount('right');
fast(3);
await soft(waitFor(async () => (await logCount('right')) >= before1 + 1 && !(await S.right.eval(`document.body.innerText.includes('考えています')`)), 'right answer', 30000));
fast(1);
await sleep(2800);
await key('reader', 'Escape', { label: 'Esc' });
await sleep(900);
save();

}
// ---------- 5. 順路 ----------
if (FROM <= 5) {
caption('5. 順路', 'リンクをたどった道を自動で覚える。リンクから開いたタブは、元のタブの隣に枝として並ぶ');
await clickEl('left', `document.querySelector('g.cell[data-id]')`);
await attachPage((u) => u.endsWith('hachi.html'));
await S.page.eval(`document.querySelector('a[href="sugaku.html"]').scrollIntoView({ block: 'center' }); true`);
await sleep(600);
await clickEl('page', `document.querySelector('a[href="sugaku.html"]')`, { modifiers: 2 });
await waitFor(pageTarget((u) => u.endsWith('sugaku.html')), 'sugaku tab');
await sleep(1400);
await clickEl('left', newest);
await attachPage((u) => u.endsWith('sugaku.html'));
await S.page.eval(`document.querySelector('a[href="tile.html"]').scrollIntoView({ block: 'center' }); true`);
await sleep(600);
await clickEl('page', `document.querySelector('a[href="tile.html"]')`, { modifiers: 2 });
await waitFor(pageTarget((u) => u.endsWith('tile.html')), 'tile tab');
await sleep(1400);
await clickEl('left', newest);
await sleep(1000);
caption('5. 順路', '「順路」のボタンで、盤面の道の線と番号を出す・隠す。順路パネルでたどり直す・六角メモへ送る・AI の調べもの日誌も');
await moveTo('left', ...Object.values(await center('left', `document.querySelector('g.cell.active')`)), 700);
await sleep(1500);
if ((await S.left.eval(`document.getElementById('toggle-route').getAttribute('aria-pressed')`)) === 'true') {
  await clickEl('left', `document.getElementById('toggle-route')`);
  await sleep(1300);
}
await clickEl('left', `document.getElementById('toggle-route')`);
await sleep(3000);
save();

}
// ---------- 6. AI の相棒 ----------
if (FROM <= 6) {
caption('6. AI の相棒', '要約・解説・クイズ。タブの操作・リマインダー・記憶・Web 検索・情報収集の道具も持つ', 'AI の返事は練習モード（料金なし）のもの');
await attachRight();
const before2 = await logCount('right');
await clickEl('right', button('このページを要約', '.ai-quick button'));
fast(3);
await soft(waitFor(async () => (await logCount('right')) >= before2 + 3 && !(await S.right.eval(`document.body.innerText.includes('考えています')`)), 'summary', 40000));
fast(1);
caption('6. AI の相棒：二人目の相棒', '役割の違う二人目（ここでは「ミツ」）が、ひとことを添える掛け合いもできる', 'AI の返事は練習モード（料金なし）のもの');
await sleep(4200);
await callouts(
  'board',
  [
    ['left', `document.querySelector('g.cell.active')`, '六角形のタブ（今のタブ・番号つき）', 0, -48],
    ['left', `document.querySelector('g.cell.memo image')?.closest('g')`, '六角形スクショのメモのセル', -42, 42],
    ['left', `[...document.querySelectorAll('g.cell.memo')].find((g) => !g.querySelector('image'))`, 'メモのセル', 34, 46],
    ['left', `document.getElementById('address')`, 'アドレスバー（ファイルのパスも開ける）', 100, 6],
    ['left', `document.getElementById('open-reader')`, '六角で読む', 16, 46],
    ['left', `document.getElementById('toggle-route')`, '順路の線を出す', -26, 46],
    ['page', `document.querySelector('h1')`, 'ページ（WebView2）'],
    ['right', `document.querySelector('.ai-quick')`, 'AI の相棒（要約・解説・クイズ）', -190, 0],
    ['right', `document.querySelector('.ai-log > *:last-child')`, '相棒の返事（二人目の相棒も）', -185, -30],
  ],
  [0, 1, 2],
);
await sleep(600);
await clickEl('left', `document.getElementById('toggle-right')`);
await sleep(900);
save();

}
// ---------- 7. 自分の音声ファイル ----------
if (FROM <= 7) {
caption('7. 自分の音声ファイル', 'パスをアドレスバーへ。同じ名前の字幕（.srt）があれば、時刻つきの区間セルにする');
await clickEl('left', `document.getElementById('new-tab')`);
await sleep(500);
await openAddress(`${mediaDir}\\六角ラジオ 第12回.wav`);
await attachPage((u) => u.endsWith('.wav'));
await waitFor(() => S.page.eval(`!!document.querySelector('video') && document.querySelector('video').readyState >= 1`), 'media');
await sleep(800);
await clickEl('left', `document.getElementById('open-reader')`);
await attachReader();
await waitFor(async () => (await S.reader.eval(`document.querySelectorAll('.rcell:not(.annot)').length`)) > 4, 'audio cells');
await sleep(1200);
await S.page.eval(`(() => { const v = document.querySelector('video'); v.currentTime = 0; v.play(); return true; })()`);
caption('7. 自分の音声ファイル', '再生に合わせて今のマスが光って動く。マスを押すとその場面へ');
await sleep(3500);
const third = await center('reader', `document.querySelectorAll('.rcell:not(.annot)')[3]`);
await click('reader', third.x, third.y);
await sleep(2500);
caption('7. 下に並べる・流れる表示・AI と見る', '区間セルを下に並べると、下から上へ流れる。「AI と見る」で、流れた部分に相棒がひとこと', 'AI の返事は練習モード（料金なし）のもの。再生は早送り');
await clickEl('reader', button('右に並べる', '.reader-tool'));
await sleep(1600);
await clickEl('reader', button('AI と見る', '.reader-tool'));
await sleep(400);
await clickEl('reader', button('AI と見る', '.reader-tool'));
await sleep(600);
await S.page.eval(`(() => { const v = document.querySelector('video'); v.currentTime = 0; v.playbackRate = 4; v.play(); return true; })()`);
fast(2);
await soft(waitFor(async () => (await S.reader.eval(`document.querySelectorAll('.rcell.annot.ai').length`)) >= 3, 'live comments', 60000));
fast(1);
await sleep(3000);
await callouts('listen', [
  ['reader', `document.querySelector('.rcell.current')`, '今のマス（再生に合わせて流れる）', 95, -20],
  ['reader', `[...document.querySelectorAll('.rcell.annot.ai')].pop()`, 'AI と見る：相棒のひとこと', 0, 80],
  ['reader', `document.querySelector('.reader-time')`, '再生位置', -95, -42],
  ['reader', button('🎧', '.reader-tool'), '🎧 音声から（ライブキャプション）', -45, -45],
  ['page', `document.querySelector('video')`, '自分の音声ファイル（WebView2 で再生）', 0, -55],
]);
await S.page.eval(`document.querySelector('video').pause(); true`);
await sleep(500);
await key('reader', 'Escape', { label: 'Esc' });
await sleep(800);
save();

}
// ---------- 8. ラジオを聞き取る ----------
if (FROM <= 8) {
caption('8. ラジオ・字幕の無い音声', '「🎧 音声から」：Windows 11 のライブキャプションが聞き取った文を、マスにしていく', 'このデモでは、聞き取った文字を模擬で流している');
await clickEl('left', `document.getElementById('new-tab')`);
await sleep(500);
await openAddress(`${SITE}/radio.html`);
await attachPage((u) => u.endsWith('radio.html'));
await sleep(800);
await clickEl('left', `document.getElementById('open-reader')`);
await attachReader();
await waitFor(async () => (await S.reader.eval(`document.querySelectorAll('.rcell').length`)) >= 1, 'radio cells');
await sleep(800);
await S.reader.eval(`(() => {
  const orig = chrome.webview.postMessage.bind(chrome.webview);
  window.__fakeText = '';
  chrome.webview.postMessage = (msg) => {
    if (msg && msg.type === 'liveCaptions') {
      setTimeout(() => chrome.webview.dispatchEvent(new MessageEvent('message', { data: { type: 'liveCaptions', requestId: msg.requestId, available: true, running: true, text: window.__fakeText } })), 20);
      return;
    }
    orig(msg);
  };
  return true;
})()`);
await clickEl('reader', button('🎧', '.reader-tool'));
await sleep(1500);
const said = [
  'こんばんは、六角ラジオです',
  'こんばんは、六角ラジオです。今夜は冬の星空のお話です。',
  'こんばんは、六角ラジオです。今夜は冬の星空のお話です。まずはオリオン座を探して',
  '今夜は冬の星空のお話です。まずはオリオン座を探してみましょう。三つの星が斜めに並んでいます。',
  'まずはオリオン座を探してみましょう。三つの星が斜めに並んでいます。左上の赤い星がベテルギウスです。',
  '左上の赤い星がベテルギウスです。シリウスとプロキオンを結ぶと、冬の大三角になります。',
  'シリウスとプロキオンを結ぶと、冬の大三角になります。シリウスは夜空でいちばん明るい',
];
for (const text of said) {
  await S.reader.eval(`window.__fakeText = ${JSON.stringify(text)}; true`);
  await sleep(1700);
}
await sleep(1500);
caption('8. ラジオ・字幕の無い音声', '聞き取ったマスはページごとに保存。♥・メモ・AI と見る・六角メモへ も同じように使える', '音声を文字にするのは Windows（パソコンの中）。どこにも送らない');
await sleep(3500);
await clickEl('reader', button('🎧', '.reader-tool'));
await sleep(1200);
}
mark('end');
save();
log('done', timeline.length, 'events');
for (const c of Object.values(S)) c?.close();
