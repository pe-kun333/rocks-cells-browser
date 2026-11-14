// カードの ♥ を付ける口と縁（MK6。計画 docs/plan-comment-board-marks.md §4.6）の配線（ソースの形の確かめ。DOM を動かす確かめは無い）
//   書く欄の ♡（足す → 線 → いいね の一本の順・断られた文と一緒に戻す）・押しが早いときの setMark・倍率の CSS 変数・六角と四角の縁・強制色・下の区画のカードの ♡
//   メニューの「いいね」の行と事実の行の中身は memo-card-board-menu.test.ts。見た目（縁の太さ・強制色・ピンチの間の重さ）は開発画面と Windows の確かめ
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { unwrapT } from './source-text';
import { likeButtonText, likeTag, nextLike } from '../src/likes';
import { code } from './helpers';
import { parseCss } from './theme-css';

const read = (path: string) => unwrapT(readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n'));
const tab = read('../src/app/memo-board-tab.ts');
const face = read('../src/app/memo-board-hex.ts');
const pane = read('../src/app/memo-pane.ts');
const css = read('../src/grok-cards.css');
const paneCss = read('../src/memo-pane.css');
const count = (s: string, part: string) => s.split(part).length - 1;
const between = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(`見つかりません：${from}`);
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(`見つかりません：${to}`);
  return src.slice(a, b);
};
// 字が順に出てくる（どれかが無い・順が違えば落ちる）
const inOrder = (src: string, parts: readonly string[]) => {
  let at = -1;
  for (const p of parts) {
    const i = src.indexOf(p, at + 1);
    expect(i, p).toBeGreaterThan(at);
    at = i;
  }
};
// クラスの一段目（字下げ 2）の宣言の名前と位置（hex-wiring.test.ts と同じ読み方）
const members = [...tab.matchAll(/^ {2}(?:(?:private|readonly|get|async|static) )*(\w+)\s*\(/gm)].map((m) => ({ name: m[1], at: m.index ?? 0 }));
const memberBody = (name: string) => {
  const i = members.findIndex((m) => m.name === name);
  if (i < 0) throw new Error(`見つかりません：${name}`);
  return tab.slice(members[i].at, members[i + 1]?.at ?? tab.length);
};

describe('♡ の回り方と字（likes.ts）', () => {
  it('押すたびに 1→2→3→なし', () => {
    expect([0, 1, 2, 3].map((n) => nextLike(n as 0 | 1 | 2 | 3))).toEqual([1, 2, 3, 0]);
  });
  it('字は なし ♡、付いていれば ♥ と段（今の段が分かる形）', () => {
    expect([0, 1, 2, 3].map((n) => likeButtonText(n as 0 | 1 | 2 | 3))).toEqual(['♡', '♥1', '♥2', '♥3']);
  });
});

describe('書く欄の ♡（tab）', () => {
  it('ボタンは足す欄の［決める］［やめる］・つなぐの後ろ。form の中なので type button。押しで焦点を取らない。説明は計画 §9.2 の字', () => {
    expect(tab).toContain("private readonly composeLike = el('button', 'memo-board-tool memo-board-compose-like', likeButtonText(0));");
    expect(tab).toContain("const COMPOSE_LIKE_TITLE = '次に足すカードにいいねを付けます（押すたびに 1→2→3→なし）';");
    const build = memberBody('buildTools');
    inOrder(build, [
      "this.composeLike.type = 'button';",
      'this.composeLike.title = COMPOSE_LIKE_TITLE;',
      'this.composeLike.hidden = true;',
      "this.composeLike.addEventListener('pointerdown', (e) => e.preventDefault());",
      'this.composeLikeLevel = nextLike(this.composeLikeLevel);',
      'this.paintComposeLike();',
      'actions.append(this.composeOk, cancel, this.linkKindBox, this.composeLike, this.composeHint);',
    ]);
  });

  it('描くのは道具の列を描くたび（つなぐのすぐ後ろ）。足す欄だけに出す。字は今の段、押してあるかは aria-pressed', () => {
    const paint = memberBody('paintComposeLike');
    expect(paint).toContain("this.composeLike.hidden = this.composing?.kind !== 'add';");
    expect(paint).toContain('this.composeLike.textContent = likeButtonText(this.composeLikeLevel);');
    expect(paint).toContain("this.composeLike.setAttribute('aria-pressed', String(this.composeLikeLevel > 0));");
    expect(memberBody('paintToolsBoard')).toMatch(/^ {2}private paintToolsBoard\(\) \{\s*this\.paintLinkKind\(\);\s*this\.paintComposeLike\(\);/);
    expect(code(tab)).not.toMatch(/composeLike\.innerHTML/);
  });

  it('欄を開くたび・閉じるたびに なし へ（1 回ごと。足す欄から書き直しの欄へ替えても持ち越さない）。閉じるときは、待っていた文を戻す前に', () => {
    const show = memberBody('showCompose');
    expect(show.indexOf('this.composeText.value = text;')).toBeLessThan(show.indexOf('this.composeLikeLevel = 0;'));
    expect(show.indexOf('this.composeLikeLevel = 0;')).toBeLessThan(show.indexOf('this.paintTools();'));
    const close = memberBody('closeCompose');
    expect(close.indexOf('this.composeLikeLevel = 0;')).toBeGreaterThan(-1);
    expect(close.indexOf('this.composeLikeLevel = 0;')).toBeLessThan(close.indexOf('this.refusedDrafts.shift()'));
    expect(close).toContain('if (waiting) this.showRefused(waiting.mode, waiting.text, waiting.like);');
  });

  it('submitAdd の頭で値を読む（closeCompose の前）', () => {
    const add = memberBody('submitAdd');
    expect(add).toMatch(/^ {2}private submitAdd\(text: string, dir\?: 'right' \| 'down'\) \{\s*const like = this\.composeLikeLevel;/);
    expect(add.indexOf('const like = this.composeLikeLevel;')).toBeLessThan(add.indexOf('this.closeCompose();'));
  });

  it('断られて文を戻すとき、♡ も戻す（戻す前の待っている文の数を控え、returnDraft のすぐあとで returnLike）', () => {
    const add = memberBody('submitAdd');
    const refused = add.slice(add.indexOf('if (!ok) {'), add.indexOf('this.setSelected(new Set([id]));'));
    expect(refused).toMatch(/const queued = this\.refusedDrafts\.length;\s*this\.returnDraft\(\{ kind: 'add' \}, text\);\s*this\.returnLike\(like, queued\);/);
    const back = memberBody('returnLike');
    expect(back).toContain('if (like === 0) return;');
    expect(back).toContain('if (this.refusedDrafts.length > queued) this.refusedDrafts[this.refusedDrafts.length - 1].like = like;'); // 待たせた文に付ける
    expect(back).toMatch(/else if \(this\.composing\?\.kind === 'add'\) \{\s*this\.composeLikeLevel = like;\s*this\.paintComposeLike\(\);/); // 欄に出した文
    const show = memberBody('showRefused');
    expect(show).toContain('private showRefused(mode: ComposeMode, text: string, like: 0 | LikeLevel = 0) {');
    expect(show.indexOf('this.showCompose(')).toBeLessThan(show.indexOf('this.composeLikeLevel = like;')); // 開いて なし に戻したあとで戻す
    expect(tab).toContain('private readonly refusedDrafts: { mode: ComposeMode; text: string; like?: LikeLevel }[] = [];');
  });

  it('空の足す欄へ断られた文を戻すときは、その欄で押してあった ♡ を残す（断られた文に ♡ があれば、すぐあとの returnLike がそちらにする。見直しのあと）', () => {
    const give = memberBody('returnDraft');
    expect(give).toMatch(/if \(canReturnDraft\(this\.composing, this\.composeText\.value\)\) \{[^]*?const kept = this\.composing\?\.kind === 'add' \? this\.composeLikeLevel : 0;\s*this\.showRefused\(mode, text, kept\);\s*\} else this\.refusedDrafts\.push\(\{ mode, text \}\);/);
  });

  it('足す → 線 → いいね の一本の順：足したのを積んだあと、線を引くなら drawAddedLink に渡し、線が無ければすぐ likeAdded', () => {
    const add = memberBody('submitAdd');
    inOrder(add, [
      "this.pushUndo({ kind: 'add', id,",
      'if (link) this.named(() => this.drawAddedLink(memoId, link.from, id, link.kind, like));',
      'else this.likeAdded(memoId, id, like);',
    ]);
  });

  it('drawAddedLink：線が終わってから（引けなかったときも・送らずに断ったときも）likeAdded へ。線の見張りが止め（undoHeld）を下ろしたすぐあとに渡す（同じ手番）', () => {
    const draw = memberBody('drawAddedLink');
    expect(draw).toContain('private drawAddedLink(memoId: string, from: string, to: string, kind: LinkKind, like: 0 | LikeLevel = 0) {');
    expect(count(draw, 'this.likeAdded(memoId, to, like);')).toBe(2);
    const early = draw.slice(draw.indexOf('if (!plan.ok) {'), draw.indexOf('this.undoHeld += 1;'));
    expect(early).toMatch(/this\.noticeAt = Date\.now\(\);[^\n]*\n\s*this\.likeAdded\(memoId, to, like\);\s*return;/);
    const watch = draw.slice(draw.indexOf('this.watch('));
    inOrder(watch, ['this.undoHeld -= 1;', "this.pushUndo({ kind: 'link',", 'this.paintTools();', 'this.likeAdded(memoId, to, like);']);
  });

  it('Ctrl+Z の止めは数（undoHeld）で持つ。undoBusy は読むだけ（先に終わった見張りが下ろしても、ほかが待っていれば止めたまま。見直しのあと）', () => {
    expect(tab).toMatch(/private undoHeld = 0;[^\n]*\n {2}private get undoBusy\(\): boolean \{\s*return this\.undoHeld > 0;\s*\}/);
    expect(code(tab)).not.toMatch(/this\.undoBusy = /); // 書くのは数だけ
    const held = (dir: string) => count(code(tab), `this.undoHeld ${dir}= 1;`);
    expect(held('+')).toBe(3); // 戻す・線の後送り・いいねの後送り
    expect(held('-')).toBe(3);
    const undo = memberBody('runUndo');
    expect(undo).toContain('this.undoHeld += 1;');
    expect(undo).toMatch(/settled = true;\s*this\.undoAbort = null;\s*this\.undoHeld -= 1;/); // 二重に下ろさない（settled の後ろ）
  });

  it('右クリックのいいね（setMark）の結果を待っている間は、Ctrl+Z を受けない（取り出す前。undoBusy とは別の条件。見直しのあと）', () => {
    const undo = memberBody('runUndo');
    inOrder(undo, ['if (this.undoBusy || this.hidden) return;', 'if (this.markWaits.size > 0) return;', 'const op = this.undo.take(dir);']);
  });

  it('likeAdded：drawAddedLink と startEdit の間。送ってから積むまで止め（undoHeld）を持ち、どの終わり方でも下ろす。積むのは写しで値を見てから。成功の一言は出さない（線の断りの一言を残す）', () => {
    const names = members.map((m) => m.name);
    expect(names[names.indexOf('likeAdded') - 1]).toBe('drawAddedLink');
    expect(names[names.indexOf('likeAdded') + 1]).toBe('startEdit');
    const send = memberBody('likeAdded');
    expect(send).toContain('if (like === 0 || this.memoId !== memoId) return;');
    expect(send).toContain('const value = likeTag(like);');
    inOrder(send, [
      'if (before === null || before === value) return;',
      "if (markFull(snap.replies, id, 'like', value, MAX_TAGS_PER_TAB)) {",
      'this.markWaits.set(key, { value, next: null });',
      'this.undoHeld += 1;',
      "this.ask(markCommand(memoId, id, 'like', value));",
      "this.watch(memoId, (rs) => markStateIs(rs, id, 'like', value), (ok) => {",
      'this.markWaits.delete(key);',
      'this.undoHeld -= 1;',
      "if (ok) this.pushUndo({ kind: 'mark', id, mark: 'like', before, after: value });",
      'this.paintTools();',
    ]);
    const watch = send.slice(send.indexOf('this.watch('));
    expect(watch.indexOf('this.undoHeld -= 1;')).toBeLessThan(watch.indexOf('if (this.memoId === memoId) {')); // メモが替わって終えても下ろす
    expect(count(send, 'this.undoHeld -= 1;')).toBe(1);
    expect(count(send, 'this.undoHeld += 1;')).toBe(1);
    expect(code(send)).not.toContain('this.quietSuccess()');
  });
});

describe('押しが早いときの setMark（MK6。§4.6）', () => {
  const set = memberBody('setMark');
  it('同じカード・同じ種類の印の結果を待っている間は送らず、押された値だけ覚える（待っている値と同じなら何もしない）', () => {
    expect(tab).toContain('const markWaitKey = (memoId: string, id: string, kind: MarkKind): string => `${memoId}\\n${id}\\n${kind}`;');
    expect(set).toMatch(/const key = markWaitKey\(memoId, replyId, kind\);\s*const waiting = this\.markWaits\.get\(key\);\s*if \(waiting\) \{\s*waiting\.next = value === waiting\.value \? null : value;\s*return;\s*\}/);
    expect(set.indexOf('const waiting = this.markWaits.get(key);')).toBeLessThan(set.indexOf('const before = markNow('));
    expect(set.indexOf('this.markWaits.set(key, { value, next: null });')).toBeLessThan(set.indexOf('this.ask(markCommand(memoId, replyId, kind, value));'));
    expect(set.indexOf('markFull(')).toBeLessThan(set.indexOf('this.markWaits.set(')); // 断るときは待ちにしない
  });
  it('結果を見たら待ちを解く（メモが替わって終えたときも。早い return より前）。押された値があれば、そのあとで送り直す（前の値は、いま写しにある値）', () => {
    const watch = set.slice(set.indexOf('this.watch('));
    inOrder(watch, ['const next = this.markWaits.get(key)?.next ?? null;', 'this.markWaits.delete(key);', 'if (this.memoId !== memoId) return;', 'if (next !== null) this.setMark(replyId, kind, next);']);
  });
  it('undoBusy を持たない（線の後送りの見張りと取り合わないように）。成功なら quietSuccess（前の失敗の文を消す）', () => {
    expect(code(set)).not.toContain('undoBusy');
    expect(set).toMatch(/if \(ok\) this\.pushUndo\(\{ kind: 'mark', id: replyId, mark: kind, before, after: value \}\);\s*if \(ok\) this\.quietSuccess\(\);\s*else if \(!this\.quietAfterNotice\(\)\) this\.flash\('タグを変えられませんでした', 'warn'\);/);
  });
  it('右クリックの「いいね」の行は、押したカード 1 枚だけを setMark へ（選びは替えない）', () => {
    const actions = between(tab, 'private cardMenuActions(', '\n  private tagMenuItems(');
    expect(actions).toContain('mark: (reply, kind, value) => this.setMark(reply.id, kind, value),');
    expect(count(code(tab), 'this.setMark(')).toBe(3); // メニュー・setMark の送り直し・likeAdded の次
  });
});

describe('倍率の CSS 変数（applyView）', () => {
  it('倍率が替わったときだけ、縮む層に --board-zoom を書く（前に書いた倍率とそのまま比べる。守りの値は -1 から。zoomShown は使わない）', () => {
    expect(tab).toContain('private zoomVar = -1;');
    const apply = memberBody('applyView');
    expect(apply).toMatch(/if \(v\.zoom !== this\.zoomVar\) \{\s*this\.zoomVar = v\.zoom;\s*this\.world\.style\.setProperty\('--board-zoom', String\(v\.zoom\)\);\s*\}/);
    expect(count(code(tab), "'--board-zoom'")).toBe(1);
    expect(count(code(tab), 'this.zoomVar = ')).toBe(1);
    expect(code(apply)).not.toContain('zoomShown');
  });
});

describe('縁の段を書く所（四角は tab の build、六角は app/memo-board-hex.ts）', () => {
  const build = memberBody('build');
  it('四角：♥ のカードに data-like（段）。強制色の字の席と「♥2」は、♥ のカードだけ作る（ふだんは CSS で隠す）', () => {
    expect(build).toContain("if (f.like > 0) card.dataset.like = String(f.like);");
    expect(build).toContain("const heart = f.like > 0 ? `♥${f.like}` : '';");
    expect(build).toContain("const heartSeat = el('span', 'memo-board-card-seat memo-board-card-heart-seat');");
    expect(build).toContain('heartSeat.style.width = `${markSeatWidth(f.mark ? `${heart} ${f.mark}` : heart) - seat}px`;');
    expect(build).toContain("if (heart) markEl.prepend(el('span', 'memo-board-card-heart', f.mark ? `${heart} ` : heart));");
    expect(build.indexOf("const seatEl = el('span', 'memo-board-card-seat');")).toBeLessThan(build.indexOf('const heartSeat = ')); // 印の席が右端、♥ の席はその左
    expect(build.indexOf('const heartSeat = ')).toBeLessThan(build.indexOf('flow.append(f.bold'));
  });
  it('六角：♥ のカードだけ、顔の後ろに縁の多角形（点は六角の縁 86.6。append は frame・face・ring の順）。data-like に段', () => {
    expect(face).toContain('const FRAME_POINTS = points(HEX.h / 2);');
    expect(face).toMatch(/if \(info\.like > 0\) \{\s*card\.dataset\.like = String\(info\.like\);\s*const frame = document\.createElementNS\(SVG_NS, 'polygon'\);\s*frame\.classList\.add\('memo-board-hex-frame'\);\s*frame\.setAttribute\('points', FRAME_POINTS\);/);
    expect(face).toContain('svg.append(frame, face, ring);');
    expect(face).toContain('} else svg.append(face, ring);');
  });
});

describe('grok-cards.css：縁・強制色・書く欄の ♡', () => {
  const rules = parseCss(css);
  const hx4 = css.indexOf('/* HX4：正六角のカード');
  const m3 = css.indexOf('/* M3：');
  const sel = (r: { selector: string }) => r.selector.split(',').map((s) => s.trim());
  const own = (selector: string, media = '') => rules.filter((r) => (media ? r.at.includes(media) : r.at.length === 0) && sel(r).includes(selector));
  const declsOf = (selector: string, media = '') => Object.assign({}, ...own(selector, media).map((r) => Object.fromEntries(r.decls.map((d) => [d.prop, d.value])))) as Record<string, string>;
  const RING = 'var(--card-heart-ring, 0 0 0 0 transparent)';

  it('四角：box-shadow の並びの最後に ♥ の縁（既定の値つき）。ふだん・選び・選んでつまむ・つまむ・足した光りの 5 か所', () => {
    for (const s of ['.memo-board-card', '.memo-board-card.is-selected', '.memo-board-card.is-selected.is-dragging', '.memo-board-card.is-dragging']) {
      const shadow = declsOf(s)['box-shadow'] ?? '';
      expect(shadow.endsWith(`, ${RING}`), s).toBe(true);
    }
    expect(css).toMatch(/@keyframes memo-board-arrive \{\n  from \{\n    background: var\(--accent-soft\);\n    box-shadow: 0 0 0 3px var\(--accent\), var\(--card-heart-ring, 0 0 0 0 transparent\);\n  \}\n\}/);
    expect(count(css, RING)).toBe(5);
  });

  it('四角：.memo-board-card の規則（六角を除く。@media の中も）で box-shadow を書くものは、どれも並びの最後が ♥ の縁（新しい状態の規則が書き忘れたら落ちる。見直しのあと）', () => {
    const square = rules.filter((r) => !r.at.some((a) => a.startsWith('@keyframes')) && /\.memo-board-card(?![-\w])/.test(r.selector) && !r.selector.includes('.is-hex') && r.decls.some((d) => d.prop === 'box-shadow'));
    expect(square.length).toBeGreaterThanOrEqual(4);
    for (const r of square) {
      const shadow = r.decls.filter((d) => d.prop === 'box-shadow').map((d) => d.value);
      expect(shadow.every((v) => v.endsWith(`, ${RING}`)), r.selector).toBe(true);
    }
  });

  it('段の px は data-like ごとの変数だけ（♥1 2・♥2 3・♥3 4）。色の規則は段ごとに書かない', () => {
    expect(declsOf(".memo-board-card[data-like='1']")).toEqual({ '--card-heart-px': '2px' });
    expect(declsOf(".memo-board-card[data-like='2']")).toEqual({ '--card-heart-px': '3px' });
    expect(declsOf(".memo-board-card[data-like='3']")).toEqual({ '--card-heart-px': '4px' });
    const leveled = rules.filter((r) => /\[data-like='\d'\]/.test(r.selector));
    for (const r of leveled) expect(r.decls.every((d) => d.prop.startsWith('--')), r.selector).toBe(true);
  });

  it('四角の縁の太さは min(8px, 段の px ÷ 倍率)。選んだカードは選びの輪（3px）の外で、輪の下の 3px は面の地（不透明な --bg）で埋める（♥ の色が半透明の輪に透けない）。規則は M3 の塊と HX4 の節より前', () => {
    const width = 'min(8px, var(--card-heart-px) / var(--board-zoom, 1))';
    expect(declsOf('.memo-board-card[data-like]')).toEqual({ '--card-heart-ring': `0 0 0 ${width} var(--heart)` });
    expect(declsOf('.memo-board-card.is-selected[data-like]')).toEqual({ '--card-heart-ring': `0 0 0 3px var(--bg), 0 0 0 calc(3px + ${width}) var(--heart)` });
    expect(declsOf('.memo-board-card.is-selected')['box-shadow']).toMatch(/^0 0 0 3px /); // 選びの輪の太さ（地の帯と合わせる）
    expect(declsOf('.memo-board')).toMatchObject({ background: 'var(--bg)' }); // 地の帯の色＝面の地
    expect(css).not.toContain('--card-heart-gap');
    expect(m3).toBeGreaterThan(0);
    for (const s of ['.memo-board-card[data-like]', ".memo-board-card[data-like='3']", '.memo-board-card.is-selected[data-like]', '.memo-board-card-heart']) {
      for (const r of own(s).concat(own(s, '@media (forced-colors: active)'))) expect(r.decls[0].offset, s).toBeLessThan(Math.min(m3, hx4));
    }
  });

  it('強制色の四角：ふだんは ♥ の字と席を隠し、強制色の塊（後ろ）でだけ出す', () => {
    expect(declsOf('.memo-board-card-heart')).toEqual({ display: 'none' });
    expect(declsOf('.memo-board-card-heart-seat')).toEqual({ display: 'none' });
    expect(declsOf('.memo-board-card-heart', '@media (forced-colors: active)')).toEqual({ display: 'inline' });
    expect(declsOf('.memo-board-card-heart-seat', '@media (forced-colors: active)')).toEqual({ display: 'inline' });
    const normal = own('.memo-board-card-heart')[0].decls[0].offset;
    const forced = own('.memo-board-card-heart', '@media (forced-colors: active)')[0].decls[0].offset;
    expect(normal).toBeLessThan(forced);
  });

  it('六角の縁：塗らない・♥ の色・太さは 2 倍の calc・押しを受けない。強制色では CanvasText の破線（新しい選択子。顔の規則には足さない）', () => {
    expect(declsOf('.memo-board-hex-frame')).toEqual({ fill: 'none', stroke: 'var(--heart)', 'stroke-width': 'calc(2 * min(8px, var(--card-heart-px) / var(--board-zoom, 1)))', 'stroke-linejoin': 'round', 'pointer-events': 'none' }); // round：頂点の張り出しを太さの半分までに（見直しのあと）
    expect(own('.memo-board-hex-frame')[0].decls[0].offset).toBeGreaterThan(hx4);
    expect(declsOf('.memo-board-stage .memo-board-card.is-hex .memo-board-hex-frame', '@media (forced-colors: active)')).toEqual({ stroke: 'CanvasText', 'stroke-dasharray': '3 2' });
  });

  it('顔の塗りは不透明（縁の内側の半分を隠す）：顔の地は --surface（色の印のカードは --card-mark-fill。MK7）、足した光りは --accent-soft のまま（変数の値が #rrggbb なのは themes.test.ts の「面の地と顔の地は不透明」で確かめる。色の印の地の語も入れた）', () => {
    expect(declsOf('.memo-board-hex-face').fill).toBe('var(--card-mark-fill, var(--surface))');
    expect(css).toMatch(/@keyframes memo-board-hex-arrive \{\n  from \{\n    fill: var\(--accent-soft\);/);
  });

  it('書く欄の ♡：段が付いていれば ♥ の色の縁と字', () => {
    expect(declsOf(".memo-board-compose-like[aria-pressed='true']")).toEqual({ 'border-color': 'var(--heart)', color: 'var(--heart)' });
  });
});

describe('下の区画のカードの ♡（app/memo-pane.ts）', () => {
  const card = between(pane, 'function commentCard(', '\n  // 単語カードにする');
  it('押すたびに 1→2→3→なし。今ある橋で setReplyMark（メモの id・カードの id・like・値）。説明は「このカードのいいね」（頭の行のメモの ♡ と分ける）', () => {
    expect(card).toContain('const liked = cardLike(reply.tags ?? []);');
    expect(card).toContain("const like = action(likeButtonText(liked), 'このカードのいいね', () => {");
    // 写しが来る前に続けて押しても 1 段ずつ進む：送った段（sent）から回す（描き直すと写しの値から。見直しのあと）
    expect(card).toMatch(/let sent = liked;\s*const like = action\(/);
    expect(card).toContain('sent = nextLike(sent);');
    expect(card).toContain("ask({ command: 'setReplyMark', id: ref.id, replyId: reply.id, kind: 'like', value: sent === 0 ? '' : likeTag(sent) });");
    expect(code(card)).not.toContain('nextLike(liked)');
    expect(likeTag(2)).toBe('♥:2');
  });
  it('名前は字（段）のまま、押してあるかは aria-pressed、焦点を戻す鍵。見た目は memo-pane.css', () => {
    expect(card).toContain("like.classList.add('memo-pane-card-like');");
    expect(card).toContain("like.removeAttribute('aria-label');");
    expect(card).toContain("like.setAttribute('aria-pressed', String(liked > 0));");
    expect(card).toContain('like.dataset.focusKey = `card:${reply.id}:like`;');
    expect(paneCss).toMatch(/\.memo-pane-card-like\[aria-pressed='true'\] \{\n  color: var\(--heart\);\n\}/);
  });
  it('道具の並び：ふだんは 💬・相棒 ▾ の後ろ、🔗 の前。整頓中は頭の帯の道具の 🔗 の前。ボードの元に戻すには積まない（ボードの setMark を通らない）', () => {
    expect(card).toContain('actions.append(chat, ai, like, link, more, remove);');
    expect(card).toContain('actions.append(like, link, more, remove);');
    expect(code(card)).not.toContain('setMark(');
    expect(code(card)).not.toContain('pushUndo');
  });
});
