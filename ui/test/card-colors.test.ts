// カードの色の印（MK7。計画 docs/plan-comment-board-marks.md §4.7）：記号と顔の字（純粋な関数）、地の配線（ソースの形の確かめ。DOM を動かす確かめは無い）
//   右クリックの「色」の行と事実の行の中身は memo-card-board-menu.test.ts。テーマの語の値の決まりは themes.test.ts。見た目（地の色・記号の字体と幅・強制色）は開発画面と Windows の確かめ
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { colorTag, MARK_COLOR_KEY, MARK_COLORS, MARK_SYMBOL, withColorSymbol } from '../src/likes';
import { hexFaceInfo, hexFaceInfos } from '../src/memo-card-board-hex';
import { cardFace, markSeatWidth } from '../src/memo-card-board-view';
import { LINK_KINDS } from '../src/memo-card-links';
import type { Reply } from '../src/threads';
import { code } from './helpers';
import { parseCss } from './theme-css';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const tab = read('../src/app/memo-board-tab.ts');
const face = read('../src/app/memo-board-hex.ts');
const css = read('../src/grok-cards.css');

const T = new Date(2026, 10, 2, 9, 5).getTime();
const reply = (id: string, over: Partial<Reply> = {}): Reply => ({ id, parent: null, text: 'あい', createdAt: T, ...over });
const place = { x: 0, y: 0, saved: true };

describe('色の名前・鍵・記号（likes.ts）', () => {
  it('3 色（水・若草・赤紫）。鍵は英字で重ならない（data-mark-color と語 --mark-<鍵>-soft の名前）', () => {
    expect([...MARK_COLORS]).toEqual(['水', '若草', '赤紫']);
    const keys = MARK_COLORS.map((c) => MARK_COLOR_KEY[c]);
    expect(keys).toEqual(['mizu', 'wakakusa', 'akamurasaki']);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z]+$/);
  });

  it('記号は 1 字ずつで重ならない。□ は使わない（小さく見える）。線の矢じりの形 ▲◆● と ◇ は使わない', () => {
    const symbols = MARK_COLORS.map((c) => MARK_SYMBOL[c]);
    expect(symbols).toEqual(['◎', '▢', '☆']);
    expect(new Set(symbols).size).toBe(symbols.length);
    for (const s of symbols) {
      expect([...s]).toHaveLength(1);
      expect(['□', '▲', '◆', '●', '◇']).not.toContain(s);
    }
    expect(LINK_KINDS.map((k) => k.head)).toEqual(['triangle', 'bar', 'chevron', 'none', 'dot', 'diamond']); // 矢じりの形（▲・◆・● に当たる形）が今のまま
  });

  it('withColorSymbol：色があれば記号を頭に（空白でつなぐ）。無ければそのまま', () => {
    expect(withColorSymbol('', '')).toBe('');
    expect(withColorSymbol('❝ 💬2', '')).toBe('❝ 💬2');
    expect(withColorSymbol('', '水')).toBe('◎');
    expect(withColorSymbol('❝ 💬2', '赤紫')).toBe('☆ ❝ 💬2');
  });
});

describe('顔の字：記号（六角は上の三角の先頭、四角は右上の印の席の先頭）', () => {
  it('六角：色のカードは印の並びの先頭に記号（入らない印は後ろから落ちるので、記号は残る）。下の三角（タグ・+n）には出さない', () => {
    const a = reply('a', { quote: { text: 'q', url: 'https://example.com/', title: 'T' }, editedAt: T + 1, tags: ['考察', '⬢:若草', '♥:2'] });
    const rs = [a, reply('r1', { parent: 'a' })];
    const info = hexFaceInfo(rs, a, 2);
    expect(info.marks).toEqual(['▢', '❝', '💬1', '🔗2', '✎']);
    expect(info).toMatchObject({ tag: '考察', more: 0, color: '若草', like: 2 });
    const only = reply('b', { tags: ['⬢:水'] });
    expect(hexFaceInfo([only], only, 0)).toEqual({ marks: ['◎'], tag: '', more: 0, who: '', title: '', like: 0, color: '水' });
    const none = reply('c', { tags: ['⬢:青', '色:赤'] }); // 値の一覧に無いタグは印でない（ふつうのタグのまま）
    expect(hexFaceInfo([none], none, 0)).toMatchObject({ marks: [], tag: '⬢:青', more: 1, color: '' });
  });

  it('六角：色を替えると三角の字が替わる（描き直しの鍵に入る）', () => {
    const key = (tags: string[]) => JSON.stringify([...hexFaceInfos([reply('a', { tags })], [{ id: 'a' }], [])]);
    expect(key(['⬢:水'])).not.toBe(key(['⬢:赤紫']));
    expect(key(['⬢:水'])).not.toBe(key([]));
  });

  it('四角：色のカードは右上の印の字の先頭に記号（席の幅もその字で決まる）', () => {
    const q = reply('q', { quote: { text: 'q', url: 'https://example.com/', title: 'T' }, tags: ['⬢:赤紫'] });
    const f = cardFace([q, reply('r', { parent: 'q' })], q, place);
    expect(f).toMatchObject({ mark: '☆ ❝ 💬1', color: '赤紫' });
    // 席は記号と空白の 2 字分（22px）広がる（字数×11＋4。字の実の幅より広めの見込み。写真のカードでは 1 行目が狭くなる。MK7 の記録）
    expect(markSeatWidth(f.mark)).toBe(70);
    expect(markSeatWidth(f.mark) - markSeatWidth('❝ 💬1')).toBe(22);
    const bare = reply('b', { tags: [colorTag('水')] });
    expect(cardFace([bare], bare, place)).toMatchObject({ mark: '◎', color: '水', tags: [], moreTags: 0 });
    const plain = reply('p');
    expect(cardFace([plain], plain, place).mark).toBe('');
  });
});

describe('地の配線（四角は tab の build、六角は app/memo-board-hex.ts）', () => {
  const members = [...tab.matchAll(/^ {2}(?:(?:private|readonly|get|async|static) )*(\w+)\s*\(/gm)].map((m) => ({ name: m[1], at: m.index ?? 0 }));
  const memberBody = (name: string) => {
    const i = members.findIndex((m) => m.name === name);
    if (i < 0) throw new Error(`見つかりません：${name}`);
    return tab.slice(members[i].at, members[i + 1]?.at ?? tab.length);
  };

  it('四角：色のカードに data-mark-color（鍵）。記号は f.mark の先頭なので、印の席と字の行は今のまま', () => {
    const build = memberBody('build');
    expect(build).toContain('if (f.color) card.dataset.markColor = MARK_COLOR_KEY[f.color];');
    expect(build).toContain('const seat = markSeatWidth(f.mark);');
    expect(build).toContain("const markEl = el('span', 'memo-board-card-mark', f.mark);");
  });

  it('六角：色のカードの div に data-mark-color（鍵）。顔の多角形は同じ（地は CSS の変数で替わる）。記号は info.marks の先頭なので、上の三角の行は今のまま', () => {
    expect(face).toContain('if (info.color) card.dataset.markColor = MARK_COLOR_KEY[info.color];');
    expect(face.indexOf('card.dataset.markColor')).toBeLessThan(face.indexOf('if (info.like > 0) {'));
    expect(face).toContain("for (const mark of info.marks) top.append(el('span', 'memo-board-hex-mark', mark));");
    expect(code(face)).not.toContain('MARK_SYMBOL'); // 記号は計算の側（hexFaceInfo）で入れる。下の三角には出さない
  });

  it('メニューの囲みの上限は innerHeight − 250（MK6 の 220 に、色の行の見込み 30 を足した。測っていない）', () => {
    const open = memberBody('openCardMenu');
    expect(open).toContain('window.innerHeight - 250');
    expect(code(tab)).not.toContain('innerHeight - 220');
  });
});

describe('grok-cards.css：色の印の地（MK7）', () => {
  const rules = parseCss(css);
  const hx4 = css.indexOf('/* HX4：正六角のカード');
  const m3 = css.indexOf('/* M3：');
  const b42 = css.indexOf('/* B4-2：');
  const sel = (r: { selector: string }) => r.selector.split(',').map((s) => s.trim());
  const own = (selector: string, media = '') => rules.filter((r) => (media ? r.at.includes(media) : r.at.length === 0) && sel(r).includes(selector));
  const declsOf = (selector: string, media = '') => Object.assign({}, ...own(selector, media).map((r) => Object.fromEntries(r.decls.map((d) => [d.prop, d.value])))) as Record<string, string>;
  const FILL = 'var(--card-mark-fill, var(--surface))';

  it('色ごとの規則は、鍵の data-mark-color で --card-mark-fill に地の語を入れるだけ（変数だけ。詳しさで強制色や状態の規則に勝たない）', () => {
    for (const c of MARK_COLORS) {
      const key = MARK_COLOR_KEY[c];
      expect(declsOf(`.memo-board-card[data-mark-color='${key}']`), c).toEqual({ '--card-mark-fill': `var(--mark-${key}-soft)` });
    }
    const marked = rules.filter((r) => r.selector.includes('data-mark-color'));
    expect(marked).toHaveLength(MARK_COLORS.length + 1); // 色ごと＋強制色
    for (const r of marked) expect(r.decls.every((d) => d.prop === '--card-mark-fill'), r.selector).toBe(true);
  });

  it('四角の地（background）と六角の顔の地（fill）は、変数があればその色、無ければ --surface', () => {
    expect(declsOf('.memo-board-card').background).toBe(FILL);
    expect(declsOf('.memo-board-hex-face').fill).toBe(FILL);
    expect(count(css, 'var(--card-mark-fill')).toBe(2);
  });

  it('強制色：色のカードの地は Canvas に戻す（色ごとの規則より後ろ・同じ詳しさ）。六角の顔の強制色の規則は今のまま', () => {
    expect(declsOf('.memo-board-card[data-mark-color]', '@media (forced-colors: active)')).toEqual({ '--card-mark-fill': 'Canvas' });
    const forced = own('.memo-board-card[data-mark-color]', '@media (forced-colors: active)')[0].decls[0].offset;
    for (const c of MARK_COLORS) expect(own(`.memo-board-card[data-mark-color='${MARK_COLOR_KEY[c]}']`)[0].decls[0].offset).toBeLessThan(forced);
    expect(declsOf('.memo-board-stage .memo-board-card.is-hex .memo-board-hex-face', '@media (forced-colors: active)')).toEqual({ fill: 'Canvas', stroke: 'CanvasText' });
  });

  // 値の決まりを守るのは、この試験の正規表現だけ（theme-literals.test.ts は --card-* の宣言を部品の語として数えないので、
  //   --card-mark-fill に決め打ちの色を書いても落ちない。MK7 の見直し）
  it('規則の置き場は M3 の塊・B4-2・HX4 の節より前（四角の規則の並び）。値は語だけ（決め打ちの色も oklch( も書かない）', () => {
    expect(Math.min(m3, b42, hx4)).toBeGreaterThan(0);
    const marked = rules.filter((x) => x.selector.includes('data-mark-color'));
    for (const r of marked) expect(r.decls[0].offset, r.selector).toBeLessThan(Math.min(m3, b42, hx4));
    for (const d of marked.flatMap((r) => r.decls)) expect(d.value, d.prop).toMatch(/^(var\(--mark-[a-z]+-soft\)|Canvas)$/);
  });

  it('足した光りと薄くする絞りは今の規則のまま（光りは終わると印の地に戻る。絞りは地ごと薄くする）', () => {
    expect(css).toMatch(/@keyframes memo-board-arrive \{\n  from \{\n    background: var\(--accent-soft\);/);
    expect(css).toMatch(/@keyframes memo-board-hex-arrive \{\n  from \{\n    fill: var\(--accent-soft\);/);
    expect(declsOf('.memo-board-card.is-dim')).toEqual({ opacity: '0.28' });
  });
});

function count(s: string, part: string): number {
  return s.split(part).length - 1;
}
