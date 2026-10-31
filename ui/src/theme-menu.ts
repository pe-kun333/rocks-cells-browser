// 見た目の小窓（左の表示のバーの「見た目」。計画書 docs/plan-themes.md §2）
// テーマを六角の並び（上の段に明るい 8、下の段に中間と暗い 5）で選ぶ。押すとすぐ全部の面が変わる（保存すると storage で届く）。
// 自動のときは、上の段が「明るいとき」、下の段が「暗いとき」のテーマ。いつも同じのときは 13 から 1 つ。
// 六角の見本は data-theme-swatch でそのテーマの語を受けて描く（色の値は themes.css だけにある）
import { send } from './bridge';
import { svgEl } from './cellface';
import { lang, loadLangPref, type LangPref, resolveLang, saveLangPref, t } from './i18n';
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

  const swatches = THEMES.map((info) => {
    const item = el('button', 'theme-swatch');
    item.setAttribute('role', 'menuitemradio');
    item.dataset.id = info.id;
    item.title = t(info.ja);
    const paint = el('span', 'theme-swatch-paint');
    paint.dataset.themeSwatch = info.id;
    const svg = svgEl('svg', { viewBox: '0 0 24 24.5', 'aria-hidden': 'true' });
    svg.append(
      svgEl('polygon', { class: 'sw-sel', points: SEL }),
      svgEl('polygon', { class: 'sw-out', points: HEX }),
      svgEl('polygon', { class: 'sw-core', points: CORE }),
    );
    paint.append(svg);
    item.append(paint);
    item.addEventListener('click', () => choose(info));
    (info.kind === 'dark' ? rows.dark : rows.light).append(item);
    return { info, item };
  });

  // 自動では、その明暗の欄を替える。いつも同じでは、そのテーマにする
  function choose(info: ThemeInfo) {
    const pref = loadThemePref();
    const ref: ThemeRef = { id: info.id, kind: info.kind };
    if (pref.mode === 'fixed') save({ ...pref, fixed: ref });
    else if (info.kind === 'dark') save({ ...pref, dark: ref });
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

  // 言語（英語版 E0）：自動（Windows の言語）・日本語・English。切り替えは次に起動したときから
  const langButtons = [...menu.querySelectorAll<HTMLButtonElement>('[data-lang]')];
  const langNote = menu.querySelector<HTMLElement>('.lang-note');
  for (const b of langButtons) {
    b.addEventListener('click', () => {
      const pref = (b.dataset.lang ?? 'auto') as LangPref;
      saveLangPref(pref);
      send({ type: 'setLang', pref }); // C++ 側の言葉（ダイアログ・右クリックなど）も次の起動から合わせる
      renderLang();
    });
  }
  function renderLang() {
    const pref = loadLangPref();
    for (const b of langButtons) b.setAttribute('aria-checked', String(b.dataset.lang === pref));
    if (!langNote) return;
    const next = resolveLang(pref, typeof navigator === 'undefined' ? undefined : navigator.languages);
    langNote.textContent = next !== lang() ? t('次に起動したときから切り替わります') : t('今の言語：{lang}', { lang: lang() === 'en' ? 'English' : '日本語' });
  }

  const nameOf = (r: ThemeRef) => {
    const found = THEMES.find((x) => x.id === r.id);
    return found ? t(found.ja) : r.id;
  };

  function render() {
    const pref = loadThemePref();
    const shown = currentTheme();
    now.textContent = t('今：{name}', { name: nameOf(shown) });
    for (const b of modes) b.setAttribute('aria-checked', String(b.dataset.themeMode === pref.mode));
    const fixed = pref.mode === 'fixed';
    rows.light.setAttribute('aria-label', fixed ? t('テーマ（明るい）') : t('明るいときのテーマ'));
    rows.dark.setAttribute('aria-label', fixed ? t('テーマ（暗い）') : t('暗いときのテーマ'));
    for (const { info, item } of swatches) {
      const chosen = fixed ? pref.fixed.id === info.id : (info.kind === 'dark' ? pref.dark : pref.light).id === info.id;
      item.setAttribute('aria-checked', String(chosen));
      item.classList.toggle('shown', shown.id === info.id);
      const name = t(info.ja);
      item.setAttribute('aria-label', info.kind === 'dark' ? t('{name}（暗い）', { name }) : info.kind === 'hc' ? t('{name}（明るい・線が濃い）', { name }) : t('{name}（明るい）', { name }));
    }
    slots.textContent = fixed ? t('いつも：{name}', { name: nameOf(pref.fixed) }) : t('明るいとき：{light}　暗いとき：{dark}', { light: nameOf(pref.light), dark: nameOf(pref.dark) });
    pages.setAttribute('aria-checked', String(pref.pages === 'theme'));
    pages.setAttribute('aria-disabled', String(!fixed));
    pages.title = fixed
      ? t('ページ（タブ）の明暗も、このテーマの明暗にします。外すと Windows の明暗に従います')
      : t('自動のときは、ページも Windows の明暗に従います（いつも同じテーマのときに選べます）');
    renderLang();
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
