// 段 CB4c：カードのメニューの配線（受け口・2 手・下の一覧・移る）を、ソースを読んで確かめる。中身の項目は memo-card-board-menu.test.ts
//   DOM の動きは開発画面（docs/wip/2026-11-02/checks/README.md）
import { readFileSync as readFile } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOARD_CARD, DEFAULT_VIEW } from '../src/memo-card-board';
import { CARD_VISIBLE_ENOUGH, cardVisibleRatio, viewToShowCard } from '../src/memo-card-board-view';
import { code } from './helpers';
import { unwrapT } from './source-text';

const read = (p: string) => unwrapT(readFile(new URL(p, import.meta.url), 'utf8'));
const tab = read('../src/app/memo-board-tab.ts');
const body = (from: string, to: string) => tab.slice(tab.indexOf(from), tab.indexOf(to, tab.indexOf(from)));
// 注釈（/* */ と //）を除いた字（改行は LF）。肯定の確かめはこれに当てる（注釈の中に正しい塊を残したまま生きた所を替えても、通ってしまわないように）
//   注釈を除いたあとの行末の空白と、空になった行も落とす（行末の注釈や注釈だけの行があっても、塊を丸ごと比べられるように）
const live = code(tab.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, ''))
  .replace(/[ \t]+$/gm, '')
  .replace(/\n{2,}/g, '\n');

describe('右クリックの受け口', () => {
  const press = body('private onContextMenu(', 'private cardMenuInput(');
  it('面の全体で 1 本で受ける', () => {
    expect(tab).toContain("this.root.addEventListener('contextmenu', (e) => this.onContextMenu(e));");
  });
  it('文字の欄は標準のメニューを残す。それ以外は止める', () => {
    expect(press.indexOf("closest('input, textarea, select, [contenteditable]')")).toBeLessThan(press.indexOf('e.preventDefault()'));
  });
  it('つまむ・範囲選択・パンの最中は開かない。線を引く途中はやめる', () => {
    expect(press).toContain('if (this.drag || this.marquee || this.pan) return;');
    expect(press).toContain('this.cancelLink();');
  });
  it('選びの外のカードは選び直し、選びの中のカードは選びを保つ', () => {
    expect(press).toContain('if (!this.selected.has(id)) this.setSelected(new Set([id]));');
  });
  it('メニューの項目の上の右クリックを止める。全文の囲みの上は残す', () => {
    const menu = body('private getMenu()', '// ---------- カードのメニュー');
    expect(menu).toContain("this.menu.node.addEventListener('contextmenu'");
    expect(menu).toContain(".closest('.cell-menu-note')");
  });
});

describe('行き先', () => {
  const actions = body('private cardMenuActions(', 'private lowerThen(');
  it('上に出しているときの ↗ ▶ は確かめを挟み、下に戻してから命令を送る', () => {
    expect(actions).toContain('confirmPageEntries(reply, () => this.lowerThen(go))');
    expect(actions).toContain('confirmVideoEntries(() => this.lowerThen(go))');
    const lower = body('private lowerThen(', 'private openInList(');
    expect(lower.indexOf("place?.request('bottom')")).toBeLessThan(lower.indexOf('go()'));
  });
  it('別のメモの［下の一覧］は確かめを挟む', () => {
    expect(actions).toContain('confirmListEntries(info.shownTitle, () => this.openInList(reply.id))');
  });
  it('下の一覧：先に下の帯をメモのタブへ替えてから命令を送る。書きかけの守りを通す', () => {
    const list = body('private openInList(', 'private hopToCard(');
    expect(list.indexOf('showList')).toBeLessThan(list.indexOf("command: 'openMemoPane'"));
    expect(list).toContain("from: 'board'");
    expect(read('../src/app/grok-cards.ts')).toContain('showList: () => this.showMemo()');
    const primary = read('../src/app/primary.ts');
    expect(primary).toContain("(fromSearch || action.from === 'board') && memoPaneDraft");
    expect(primary).toContain("if (fromSearch) tellSearch('下の区画に書きかけがあります");
  });
  it('メニューを組むのは this.named の中（別のメモの関連の呼び名）', () => {
    expect(tab).toContain('this.named(() => cardMenuEntries(input))');
    expect(tab).toContain('this.named(() => readMenuEntries({ ...next, actions }))');
    expect(live).toContain('this.named(() =>\n      tagMenuEntries({');
  });
  it('絵は読み終えたときに同じ段のままなら描き直す', () => {
    const load = body('private loadMenuPicture(', 'private replaceMenu(');
    expect(load).toContain('seq === this.menuSeq');
    expect(load).toContain('menu.update(items(), token)');
  });
  it('移る：見えていなければ滑らせ、今のパンと同じ道で保存し、メニューを置き直す', () => {
    const show = body('private showCard(', 'private hopToCard(');
    expect(show).toContain('viewToShowCard(this.view, at, this.viewport(), this.geo.box)'); // 箱は形ごと（HX4）
    expect(show).toContain('this.slide()');
    expect(show).toContain('this.touchView()');
    const hop = body('private hopToCard(', '// ---------- 足したカード');
    expect(hop).toContain('this.showCard(id, at)');
    expect(hop).toContain('this.openCardMenu(id, rect.left + screen.x + 8, rect.top + screen.y, from)');
    expect(body('private slide(', 'private copyCard(')).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
  });
});

describe('編集の行（書き直す・関連線を足す・タグを足す…）', () => {
  // live（注釈を除いた字）の from から to の手前まで。どちらかが見つからなければ throw（中身の無い確かめにしない）
  const part = (from: string, to: string) => {
    const a = live.indexOf(from);
    if (a < 0) throw new Error(`見つかりません：${from}`);
    const b = live.indexOf(to, a + from.length);
    if (b < 0) throw new Error(`見つかりません：${to}`);
    return live.slice(a, b);
  };
  const count = (s: string, piece: string) => s.split(piece).length - 1;
  const lines = (...rows: string[]) => rows.join('\n');
  const actions = part('private cardMenuActions(', '\n  private tagMenuItems(');
  const items = part('private tagMenuItems(', '\n  private redrawTagMenu(');
  const redraw = part('private redrawTagMenu(', '\n  private writeTag(');
  const write = part('private writeTag(', '\n  private reopenTagMenu(');
  const reopen = part('private reopenTagMenu(', '\n  private lowerThen(');
  const change = part('private changeTags(', '\n  private startLink(');

  it('書き直す：欄や確かめが開いていれば F2 と同じ一言で止める。そうでなければ選びをそのカード 1 枚にしてから startEdit', () => {
    expect(actions).toContain(
      [
        '      edit: (reply) => {',
        '        if (this.modalOpen) {',
        "          this.flash('開いている欄や確かめを閉じてから書き直してください', 'info');",
        '          return;',
        '        }',
        '        this.setSelected(new Set([reply.id]));',
        '        this.startEdit();',
        '      },',
      ].join('\n'),
    );
    expect(count(live, "this.flash('開いている欄や確かめを閉じてから書き直してください', 'info');")).toBe(2); // F2 とメニューの 2 か所（同じ文）
  });

  it('関連線を足す：欄や確かめが開いていれば一言で止める。そうでなければ選びをそのカード 1 枚にしてから startLink', () => {
    expect(actions).toContain(
      [
        '      link: (reply) => {',
        '        if (this.modalOpen) {',
        "          this.flash('開いている欄や確かめを閉じてから線を足してください', 'info');",
        '          return;',
        '        }',
        '        this.setSelected(new Set([reply.id]));',
        '        this.startLink();',
        '      },',
      ].join('\n'),
    );
  });

  it('タグを足す…：候補（pool）をここで 1 回だけ作り（タグの行と同じ候補から、そのときのカードのタグを除く）、replaceMenu でタグの段へ替える。← 戻る はカードの段を開き直す（読む段と同じ）', () => {
    expect(actions).toContain(
      lines(
        '      tags: (reply) => {',
        '        const replies = this.source?.get()?.replies ?? [];',
        '        const pool = tagMenuPool(cardTagCandidates(replies, [], registeredTagNames()), replies.find((r) => r.id === reply.id)?.tags ?? []);',
        '        this.replaceMenu(this.tagMenuItems(reply.id, pool, () => this.openCardMenu(id, x, y, from), x, y));',
        '      },',
      ),
    );
    expect(actions).toContain('back: () => this.openCardMenu(id, x, y, from)'); // 読む段の戻り方
    expect(count(live, 'tagMenuPool(')).toBe(1); // pool を作るのは段を開くときの 1 回だけ（描き直し・開き直しは受け取ったものを渡す）
    expect(count(live, 'cardTagCandidates(')).toBe(2); // タグの行と、タグの段を開くときだけ
  });

  it('replaceMenu：段を替えるたびに menuSeq を進める（古い段の絵があとから上書きしないように）。焦点がメニューの中なら先頭へ', () => {
    expect(part('private replaceMenu(', '\n  private cardMenuActions(')).toBe(
      lines(
        'private replaceMenu(entries: MenuEntry[]) {',
        '    const menu = this.getMenu();',
        '    this.menuSeq += 1;',
        '    const inside = menu.node.contains(document.activeElement);',
        '    menu.update(entries);',
        '    if (inside) menu.focusFirst();',
        '  }',
      ),
    );
  });

  it('タグの段：頭から丸ごと。this.named の中で組む。候補は受け取った pool のまま。足すのはそのカード 1 枚だけで、選びは替えない。付いたら、押したときと同じ段のままなら描き直す', () => {
    expect(items).toBe(
      lines(
        'private tagMenuItems(id: string, pool: readonly string[], back: () => void, x: number, y: number): MenuEntry[] {',
        '    const replies = this.source?.get()?.replies ?? [];',
        '    return this.named(() =>',
        '      tagMenuEntries({',
        '        replies,',
        '        id,',
        '        pool,',
        '        back,',
        '        add: (tag) => {',
        '          const seq = this.menuSeq;',
        '          const token = this.getMenu().token();',
        '          this.changeTags([id], [tag], [], (ok) => {',
        '            if (ok && seq === this.menuSeq) this.redrawTagMenu(id, pool, back, x, y, token);',
        '          });',
        '        },',
        '        write: () => this.writeTag(id, pool, back, x, y),',
        '      }),',
        '    );',
        '  }',
      ),
    );
    expect(items).not.toContain('setSelected');
    expect(items).not.toContain('this.selected');
  });

  it('描き直し：閉じた・別のメニューを開いた（印が違う）なら入れない。menuSeq は進めない。段の位置は描き直す前のまま（update の置き直しで上へずれない）。焦点がメニューの中なら同じ順番のボタンへ戻す（無ければ先頭）。外なら動かさない', () => {
    expect(redraw).toBe(
      lines(
        'private redrawTagMenu(id: string, pool: readonly string[], back: () => void, x: number, y: number, token: number) {',
        '    const menu = this.getMenu();',
        '    if (!menu.isOpen || menu.token() !== token) return;',
        "    const buttons = () => [...menu.node.querySelectorAll('button')];",
        '    const inside = menu.node.contains(document.activeElement);',
        '    const at = buttons().findIndex((b) => b === document.activeElement);',
        '    const { left, top } = menu.node.style;',
        '    menu.update(this.tagMenuItems(id, pool, back, x, y), token);',
        '    menu.node.style.left = left;',
        '    menu.node.style.top = top;',
        '    if (!inside) return;',
        '    const again = buttons()[at];',
        '    if (again) again.focus();',
        '    else menu.focusFirst();',
        '  }',
      ),
    );
    expect(redraw).not.toContain('menuSeq');
  });

  it('新しいタグを書く欄：関数の終わりまで丸ごと。menuSeq を進めてすぐ prompt。Enter で名前が通ったら、すぐ段を開き直してから、その段の menuSeq と印を控えて足す。付いたら候補と同じ守りで描き直す。空なら一言だけ', () => {
    expect(write).toBe(
      lines(
        'private writeTag(id: string, pool: readonly string[], back: () => void, x: number, y: number) {',
        '    const reply = this.source?.get()?.replies.find((r) => r.id === id && r.parent === null);',
        '    if (!reply) {',
        "      this.flash('カードがもうありません', 'warn');",
        '      return;',
        '    }',
        '    this.menuSeq += 1;',
        '    this.getMenu().prompt(',
        '      tr(\'「{0}」に付けるタグ\', { 0: cardLabel(reply, 12) }),',
        "      '',",
        '      (value) => {',
        '        const tag = normalizeTag(value);',
        '        if (!tag) {',
        "          this.flash('タグの名前が空です（# と空白は名前に入りません）', 'warn');",
        '          return;',
        '        }',
        '        this.reopenTagMenu(id, pool, back, x, y);',
        '        const seq = this.menuSeq;',
        '        const token = this.getMenu().token();',
        '        this.changeTags([id], [tag], [], (ok) => {',
        '          if (ok && seq === this.menuSeq) this.redrawTagMenu(id, pool, back, x, y, token);',
        '        });',
        '      },',
        '      { x, y },',
        "      { maxLength: 30, placeholder: 'タグの名前' },",
        '    );',
        '  }',
      ),
    );
    expect(count(live, 'this.reopenTagMenu(')).toBe(1); // 返事を待ってから開き直す道は無い（Enter のときだけ）
  });

  it('開き直し：menuSeq を進めて、同じ所にタグの段を開き、焦点は［新しいタグを書く…］へ（無ければ先頭）', () => {
    expect(reopen).toBe(
      lines(
        'private reopenTagMenu(id: string, pool: readonly string[], back: () => void, x: number, y: number) {',
        '    const menu = this.getMenu();',
        '    this.menuSeq += 1;',
        '    menu.open(x, y, this.tagMenuItems(id, pool, back, x, y));',
        "    const write = [...menu.node.querySelectorAll('button')].find((b) => b.firstElementChild?.textContent === TAG_WRITE_LABEL);",
        '    if (write) write.focus();',
        '    else menu.focusFirst();',
        '  }',
      ),
    );
    expect(read('../src/panels/cell-menu.ts')).toContain("item.append(el('span', '', entry.label));"); // 項目の最初の子が名前（焦点の行き先の探し方が頼る形）
  });

  it('changeTags：終わりの呼び戻し（done）は省略できる。結果が分かったとき（同じメモのまま）だけ呼ぶ。ほかの動きと、今の 3 か所の呼び出しは変えない', () => {
    expect(change).toBe(
      lines(
        'private changeTags(ids: readonly string[], add: string[], remove: string[], done?: (ok: boolean) => void) {',
        '    const snap = this.source?.get() ?? null;',
        '    const memoId = this.memoId;',
        '    if (!snap || !memoId) return;',
        '    const cmds = tagCommands(memoId, snap.replies, ids, add, remove);',
        '    if (cmds.length === 0) return;',
        '    const full = add.reduce((n, tag) => Math.max(n, tagFullCount(snap.replies, ids, tag, MAX_TAGS_PER_TAB)), 0);',
        '    if (full > 0) this.flash(tr(\'タグは 1 つに {0} 個までです（{1} 枚には付けられません。ほかのタグを外してから付けてください）\', { 0: MAX_TAGS_PER_TAB, 1: full }), \'warn\');',
        '    for (const cmd of cmds) this.ask(cmd);',
        '    if (full > 0) return;',
        '    this.watch(',
        '      memoId,',
        '      (rs) => ids.every((id) => {',
        '        const tags = rs.find((r) => r.id === id)?.tags ?? [];',
        '        return add.every((t) => tags.includes(t)) && remove.every((t) => !tags.includes(t));',
        '      }),',
        '      (ok) => {',
        '        if (this.memoId !== memoId) return;',
        '        if (ok) this.quietSuccess();',
        "        else if (!this.quietAfterNotice()) this.flash('タグを変えられませんでした', 'warn');",
        '        done?.(ok);',
        '      },',
        '    );',
        '  }',
      ),
    );
    expect(count(live, 'done?.(')).toBe(1);
    expect(count(live, 'this.changeTags(')).toBe(3); // タグの行・タグの段の候補・新しいタグの欄
    expect(live).toContain('        change: (add, remove) => this.changeTags(ids, add, remove),\n'); // タグの行は done を渡さない（今のまま）
  });

  it('ボードのメニュー：作るのは初めの 1 回だけで、右クリックの受け口もそのときの 1 本だけ。全文の囲みと、メニューの中の欄（input・textarea）の上だけ標準のメニューを残す', () => {
    expect(part('private getMenu(', '\n  private onContextMenu(')).toBe(
      lines(
        'private getMenu(): CellMenu {',
        '    const first = this.menu === null;',
        '    this.menu ??= new CellMenu({ stopEsc: true });',
        '    if (first) {',
        "      this.menu.node.addEventListener('contextmenu', (e) => {",
        "        if (!(e.target instanceof Element && (e.target.closest('.cell-menu-note') || e.target.closest('input, textarea')))) e.preventDefault();",
        '      });',
        '    }',
        '    return this.menu;',
        '  }',
      ),
    );
    expect(count(live, "this.menu.node.addEventListener('contextmenu'")).toBe(1);
    expect(count(live, 'new CellMenu(')).toBe(1);
  });

  it('新しい所でメニューの出し口（menuAnchor）を使わない', () => {
    for (const s of [actions, items, redraw, write, reopen]) expect(s).not.toContain('menuAnchor');
  });
});

describe('ダブルクリック（段 CB5b）', () => {
  const drop = body('private dropDrag(', '// やめる（Esc・pointercancel');
  it('動かさずに離したときだけ数える。動かしたら数え直す', () => {
    expect(drop.indexOf('this.clicks.reset()')).toBeLessThan(drop.indexOf('this.commitMove('));
    expect(drop.indexOf('return;')).toBeLessThan(drop.indexOf('this.clicks.press('));
  });
  it('書く欄・整理の確かめ・線を引く途中・型の小窓の間は開かない。click・dblclick は使わない', () => {
    expect(drop).toContain('this.clicks.press(d.ref, Date.now()) !== null && !this.modalOpen');
    expect(tab).not.toContain("addEventListener('dblclick'");
    expect(tab).not.toMatch(/stage\.addEventListener\('click'/);
  });
  it('メモを替えたら数え直す', () => {
    const refresh = tab.slice(tab.indexOf('const changed = snap.memoId !== this.memoId;'), tab.indexOf('this.memoId = snap.memoId;'));
    expect(refresh).toContain('this.clicks.reset();');
  });
});

describe('📌（段 CB5b）', () => {
  it('下に戻すと閉じる', () => {
    const place = body('setPlace(available: boolean, upper: boolean) {', '// ---------- 見るメモの名札と選び口');
    expect(place).toContain('if (!upper) this.pins.closeAll();');
  });
  it('描くたびに直し、見ている位置が動いたら置き直す', () => {
    expect(body('private renderBoard(', 'private build(')).toContain('this.pins.refresh(snap?.memoId ?? null);');
    expect(body('private applyView(', 'private fit')).toContain('this.pins.place();');
  });
  it('Esc の順：メニューが先。欄の Esc は欄のもの。📌 は選びを外す段より先に捕まえる', () => {
    const at = tab.indexOf('this.pins.closeNewest(this.memoId);');
    const esc = tab.slice(tab.lastIndexOf('window.addEventListener(', at), tab.indexOf('true,', at));
    expect(esc).toContain('this.menu?.isOpen');
    expect(esc).toContain('e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement');
    expect(esc).toContain('this.keysAllowed(e.target)');
    expect(esc).toContain('e.stopImmediatePropagation();');
  });
});

describe('足したカード（段 CB6c）', () => {
  const note = body('private noteArrivals(', 'private addArrival(');
  it('メモを替えた・タブを開いた直後は数えない。ボードの中から足した分（pending）は数えない', () => {
    expect(tab).toContain('this.noteArrivals(snap.memoId, snap.replies, changed || show);');
    expect(note.indexOf('this.clearArrivals()')).toBeLessThan(note.indexOf('arrivedCards(this.knownTops, replies, this.pending)'));
  });
  it('札は十分に見えていないカードだけ。押すとそのカードへ移る。12 秒で消す', () => {
    const paint = body('private paintArrivals(', '// 短く滑らせる');
    expect(paint).toContain('cardVisibleRatio(this.view, at, viewport, this.geo.box) >= CARD_VISIBLE_ENOUGH'); // 箱は形ごと（HX4）
    expect(paint).toContain('edgeChipAt(this.view, at, viewport, placed, this.geo.box)');
    expect(paint).toContain('this.showCard(id, spot)');
    expect(body('private addArrival(', 'private dropArrival(')).toContain('window.setTimeout(() => this.dropArrival(id), ARRIVAL_MS)');
  });
  it('見ている位置が動いたら置き直す。置き直さない（カードの位置は保存しない）', () => {
    expect(body('private applyView(', 'private fit')).toContain('this.paintArrivals();');
    const block = body('private noteArrivals(', '// 短く滑らせる');
    expect(block).not.toContain('saveBoard');
    expect(block).not.toContain('planMoves');
  });
});

describe('カードへ移るときの見ている位置', () => {
  const vp = { w: 800, h: 400 };
  const view = { ...DEFAULT_VIEW, x: 0, y: 0, zoom: 1 };
  it('全部見えていれば 1、半分なら 0.5、外なら 0', () => {
    expect(cardVisibleRatio(view, { x: 10, y: 10 }, vp)).toBe(1);
    expect(cardVisibleRatio(view, { x: -BOARD_CARD.w / 2, y: 10 }, vp)).toBeCloseTo(0.5);
    expect(cardVisibleRatio(view, { x: 5000, y: 10 }, vp)).toBe(0);
    expect(cardVisibleRatio(view, { x: 10, y: 10 }, { w: 0, h: 0 })).toBe(0);
  });
  it('7 割見えていれば動かさない。足りなければ真ん中へ', () => {
    const justEnough = { x: -BOARD_CARD.w * (1 - CARD_VISIBLE_ENOUGH), y: 10 };
    expect(viewToShowCard(view, justEnough, vp)).toBeNull();
    const next = viewToShowCard(view, { x: 1000, y: 500 }, vp);
    expect(next).not.toBeNull();
    expect(cardVisibleRatio(next!, { x: 1000, y: 500 }, vp)).toBe(1);
    expect(next!.x + 1000 + BOARD_CARD.w / 2).toBeCloseTo(vp.w / 2);
    expect(next!.y + 500 + BOARD_CARD.h / 2).toBeCloseTo(vp.h / 2);
  });
  it('倍率があっても真ん中へ', () => {
    const zoomed = { ...view, zoom: 2 };
    const next = viewToShowCard(zoomed, { x: 1000, y: 500 }, vp);
    expect(next!.x + 1000 * 2 + BOARD_CARD.w).toBeCloseTo(vp.w / 2);
    expect(next!.zoom).toBe(2);
  });
});

// タグの段の候補の行だけ、押された印を太字にしない（幅が変わると後ろの候補がずれる）。行の class は CellMenu の省略できる className で付ける
describe('タグの段の候補の行の見た目（className と CSS）', () => {
  const menuSrc = code(read('../src/panels/cell-menu.ts')).replace(/\r\n/g, '\n');
  const css = read('../src/grok-cards.css').replace(/\r\n/g, '\n');
  it('CellMenu の行は、省略できる className を足すだけ（無ければ今までどおり）', () => {
    expect(menuSrc).toContain('wrap?: boolean; className?: string }');
    expect(menuSrc).toContain("        const row = el('div', 'cell-menu-row');\n        if (entry.wrap) row.classList.add('cell-menu-row-wrap');\n        if (entry.className) row.classList.add(entry.className);\n");
    expect(menuSrc.split('entry.className').length - 1).toBe(2);
  });
  it('grok-cards.css：候補の行の押された印は太字にしない（ほかのメニューの切り替えのボタンは今のまま）', () => {
    expect(css).toContain(".cell-menu-row.memo-board-tagpool .cell-menu-toggle[aria-pressed='true'] {\n  font-weight: inherit;\n}\n");
    expect(css.split('memo-board-tagpool').length - 1).toBe(1);
  });
});
