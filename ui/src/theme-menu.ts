// 見た目の小窓（左の表示のバーの「見た目」。計画書 docs/plan-themes.md §2）
// テーマを六角の並び（上の段に明るい 8、下の段に中間と暗い 5）で選ぶ。押すとすぐ全部の面が変わる（保存すると storage で届く）。
// 自動のときは、上の段が「明るいとき」、下の段が「暗いとき」のテーマ。いつも同じのときは 13 から 1 つ。
// 六角の見本は data-theme-swatch でそのテーマの語を受けて描く（色の値は themes.css だけにある）
import { svgEl } from './cellface';
import { currentTheme, DEFAULT_THEME_PREF, loadThemePref, saveThemePref, type ThemePref, type ThemeRef } from './theme';
import { THEMES, type ThemeInfo } from './themes';
import { el } from './util';

// 見本の六角（中心 12,12.25）：選んだ印の輪・地の色・金の芯
const SEL = '12,1.25 21.5,6.75 21.5,17.75 12,23.25 2.5,17.75 2.5,6.75';
const HEX = '12,3.25 19.8,7.75 19.8,16.75 12,21.25 4.2,16.75 4.2,7.75';
const CORE = '12,8 16.1,10.4 16.1,14.1 12,16.5 7.9,14.1 7.9,10.4';

export function startThemeMenu(button: HTMLButtonElement, menu: HTMLElement) {
  const now = menu.querySelector<HTMLElement>('.theme-now') as HTMLElement;
  const slots = menu.querySelector<HTMLElement>('.theme-slots') as HTMLElement;
  const modes = [...menu.querySelectorAll<HTMLButtonElement>('[data-theme-mode]')];
  const pages = menu.querySelector<HTMLButtonElement>('[data-theme-pages]') as HTMLButtonElement;
  const reset = menu.querySelector<HTMLButtonElement>('[data-theme-reset]') as HTMLButtonElement;
  const rows = {
    light: menu.querySelector<HTMLElement>('[data-row="light"]') as HTMLElement,
    dark: menu.querySelector<HTMLElement>('[data-row="dark"]') as HTMLElement,
  };

  const swatches = THEMES.map((t) => {
    const item = el('button', 'theme-swatch');
    item.setAttribute('role', 'menuitemradio');
    item.dataset.id = t.id;
    item.title = t.ja;
    const paint = el('span', 'theme-swatch-paint');
    paint.dataset.themeSwatch = t.id;
    const svg = svgEl('svg', { viewBox: '0 0 24 24.5', 'aria-hidden': 'true' });
    svg.append(
      svgEl('polygon', { class: 'sw-sel', points: SEL }),
      svgEl('polygon', { class: 'sw-out', points: HEX }),
      svgEl('polygon', { class: 'sw-core', points: CORE }),
    );
    paint.append(svg);
    item.append(paint);
    item.addEventListener('click', () => choose(t));
    (t.kind === 'dark' ? rows.dark : rows.light).append(item);
    return { info: t, item };
  });

  // 自動では、その明暗の欄を替える。いつも同じでは、そのテーマにする
  function choose(t: ThemeInfo) {
    const pref = loadThemePref();
    const ref: ThemeRef = { id: t.id, kind: t.kind };
    if (pref.mode === 'fixed') save({ ...pref, fixed: ref });
    else if (t.kind === 'dark') save({ ...pref, dark: ref });
    else save({ ...pref, light: ref });
  }

  function save(pref: ThemePref) {
    saveThemePref(pref);
    render();
  }

  for (const b of modes) {
    b.addEventListener('click', () => {
      const pref = loadThemePref();
      if (b.dataset.themeMode === 'fixed' && pref.mode !== 'fixed') save({ ...pref, mode: 'fixed', fixed: currentTheme() }); // 今見えているテーマのまま固定
      else if (b.dataset.themeMode === 'auto' && pref.mode !== 'auto') save({ ...pref, mode: 'auto' });
    });
  }
  pages.addEventListener('click', () => {
    const pref = loadThemePref();
    if (pref.mode !== 'fixed') return;
    save({ ...pref, pages: pref.pages === 'theme' ? 'os' : 'theme' });
  });
  reset.addEventListener('click', () => save(DEFAULT_THEME_PREF));

  const nameOf = (r: ThemeRef) => THEMES.find((t) => t.id === r.id)?.ja ?? r.id;

  function render() {
    const pref = loadThemePref();
    const shown = currentTheme();
    now.textContent = `今：${nameOf(shown)}`;
    for (const b of modes) b.setAttribute('aria-checked', String(b.dataset.themeMode === pref.mode));
    const fixed = pref.mode === 'fixed';
    rows.light.setAttribute('aria-label', fixed ? 'テーマ（明るい）' : '明るいときのテーマ');
    rows.dark.setAttribute('aria-label', fixed ? 'テーマ（暗い）' : '暗いときのテーマ');
    for (const { info, item } of swatches) {
      const chosen = fixed ? pref.fixed.id === info.id : (info.kind === 'dark' ? pref.dark : pref.light).id === info.id;
      item.setAttribute('aria-checked', String(chosen));
      item.classList.toggle('shown', shown.id === info.id);
      item.setAttribute('aria-label', `${info.ja}（${info.kind === 'dark' ? '暗い' : info.kind === 'hc' ? '明るい・線が濃い' : '明るい'}）`);
    }
    slots.textContent = fixed ? `いつも：${nameOf(pref.fixed)}` : `明るいとき：${nameOf(pref.light)}　暗いとき：${nameOf(pref.dark)}`;
    pages.setAttribute('aria-checked', String(pref.pages === 'theme'));
    pages.setAttribute('aria-disabled', String(!fixed));
    pages.title = fixed
      ? 'ページ（タブ）の明暗も、このテーマの明暗にします。外すと Windows の明暗に従います'
      : '自動のときは、ページも Windows の明暗に従います（いつも同じテーマのときに選べます）';
  }

  function open(show: boolean) {
    menu.hidden = !show;
    button.setAttribute('aria-expanded', String(show));
    if (show) render();
  }

  button.addEventListener('click', () => open(menu.hidden === true));
  // 外を押したら閉じる（選んでいる間は閉じない）。捕まえる段で見るので、ほかのメニューのボタンが伝わりを止めても閉じる
  document.addEventListener(
    'click',
    (e) => {
      const target = e.target as Node;
      if (!menu.hidden && !menu.contains(target) && !button.contains(target)) open(false);
    },
    true,
  );
  menu.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    open(false);
    button.focus();
  });
  // ほかの面・Windows の明暗で替わったときも、開いていれば描き直す
  window.addEventListener('storage', () => !menu.hidden && render());
  new MutationObserver(() => !menu.hidden && render()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
