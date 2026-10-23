// テスト用の Rocks-cells Browser の、今のタブで URL を開く（読む画面が開いていれば閉じてから）。record.ps1 から使う
// 使い方: node open.mjs <port> <url>
const [port, url] = process.argv.slice(2);
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const left = targets.find((t) => t.url.includes('surface=left'));
if (!left) throw new Error('左のサイドバーが見つかりません');
const ws = new WebSocket(left.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let n = 0;
const ev = (expression) =>
  new Promise((resolve) => {
    const id = ++n;
    ws.addEventListener('message', function h(e) {
      const m = JSON.parse(e.data);
      if (m.id === id) {
        ws.removeEventListener('message', h);
        resolve(m.result?.result?.value);
      }
    });
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  });
if ((await ev(`document.getElementById('open-reader').getAttribute('aria-pressed')`)) === 'true') {
  await ev(`document.getElementById('open-reader').click(); true`);
  await new Promise((r) => setTimeout(r, 800));
}
await ev(`(() => { const a = document.getElementById('address'); a.value = ${JSON.stringify(url)}; document.getElementById('address-form').requestSubmit(); return true; })()`);
ws.close();
