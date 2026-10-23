// 最初の一瞬：CSS より先に <html> へ data-theme と data-kind を付ける（index.html の <head> から読む。CSP でインラインのスクリプトは動かない）
// 決め方は src/theme.ts の resolveTheme と同じ（ui/test/theme.test.ts で確かめる）。テーマの一覧は持たない（知らない id は theme.ts が読み込んだときに直す）
(function () {
  var pref = null;
  try {
    pref = JSON.parse(localStorage.getItem('honeycomb.theme') || 'null');
  } catch (e) {
    pref = null;
  }
  var dark = false;
  try {
    dark = matchMedia('(prefers-color-scheme: dark)').matches;
  } catch (e) {
    dark = false;
  }
  var light = { id: 'mitsurou', kind: 'light' };
  var slot = dark ? 'dark' : 'light';
  var fallback = dark ? { id: 'sumi', kind: 'dark' } : light;
  if (pref && typeof pref === 'object' && pref.mode === 'fixed') {
    slot = 'fixed';
    fallback = light;
  }
  var pick = pref && typeof pref === 'object' ? pref[slot] : null;
  var ok = pick && typeof pick === 'object' && typeof pick.id === 'string' && (pick.kind === 'light' || pick.kind === 'dark' || pick.kind === 'hc');
  var theme = ok ? pick : fallback;
  var root = document.documentElement;
  root.setAttribute('data-theme', theme.id);
  root.setAttribute('data-kind', theme.kind);
})();
