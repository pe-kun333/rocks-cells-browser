// ボードのメモ切り替え M4：関連の呼び名をボードだけ B のものにする（一時的な差し替え）／左の知らせの出し先
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import { LINK_KIND_DEFAULT_NAMES, applyLinkKindNames, linkKindInfo, linkSentence, withLinkKindNames } from '../src/memo-card-links';
import { noticeTarget } from '../src/memo-board-pick';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

afterEach(() => applyLinkKindNames(undefined));

describe('withLinkKindNames：呼び名を一時的に差し替えて、必ず戻す', () => {
  it('中では B の呼び名、外へ出たら下の区画（A）の呼び名に戻る', () => {
    applyLinkKindNames({ ground: 'Aの根拠' });
    const inside = withLinkKindNames({ ground: 'Bの根拠', counter: 'Bの反論' }, () => [linkKindInfo('ground').name, linkKindInfo('counter').name, linkSentence('甲', '乙', 'ground')]);
    expect(inside[0]).toBe('Bの根拠');
    expect(inside[1]).toBe('Bの反論');
    expect(inside[2]).toContain('Bの根拠');
    expect(linkKindInfo('ground').name).toBe('Aの根拠');
    expect(linkKindInfo('counter').name).toBe(LINK_KIND_DEFAULT_NAMES.counter);
  });
  it('B が呼び名を持たない（undefined）なら、中は元の名前（A の呼び名は引き継がない）', () => {
    applyLinkKindNames({ ground: 'Aの根拠' });
    expect(withLinkKindNames(undefined, () => linkKindInfo('ground').name)).toBe(LINK_KIND_DEFAULT_NAMES.ground);
    expect(linkKindInfo('ground').name).toBe('Aの根拠');
  });
  it('途中で例外が起きても戻る。戻り値はそのまま返る。入れ子でも外側の値に戻る', () => {
    applyLinkKindNames({ next: 'Aの続き' });
    expect(() =>
      withLinkKindNames({ next: 'Bの続き' }, () => {
        throw new Error('x');
      }),
    ).toThrow('x');
    expect(linkKindInfo('next').name).toBe('Aの続き');
    const v = withLinkKindNames({ next: 'B1' }, () => withLinkKindNames({ next: 'B2' }, () => linkKindInfo('next').name) + linkKindInfo('next').name);
    expect(v).toBe('B2B1');
    expect(linkKindInfo('next').name).toBe('Aの続き');
  });
});

describe('noticeTarget：左の知らせを出す先', () => {
  const base = { memo: 'b', lowerId: 'a', chosenId: 'b' };
  it('ボードが別のメモ（B）を選んでいて、知らせが B のことなら、ボードだけ。A のことなら下の区画だけ', () => {
    expect(noticeTarget(base)).toBe('board');
    expect(noticeTarget({ ...base, memo: 'a' })).toBe('lower');
  });
  it('id が無い・選んでいない・同じメモ・どちらでもないメモなら、今までどおり両方', () => {
    expect(noticeTarget({ ...base, memo: undefined })).toBe('both');
    expect(noticeTarget({ ...base, memo: '' })).toBe('both');
    expect(noticeTarget({ ...base, chosenId: null })).toBe('both');
    expect(noticeTarget({ memo: 'a', lowerId: 'a', chosenId: 'a' })).toBe('both');
    expect(noticeTarget({ ...base, memo: 'c' })).toBe('both');
    expect(noticeTarget({ memo: 'b', lowerId: null, chosenId: 'b' })).toBe('board');
  });
});

describe('配線（ソースの形）', () => {
  const tab = read('../src/app/memo-board-tab.ts');
  const pane = read('../src/app/memo-pane.ts');
  const primary = read('../src/app/primary.ts');
  const types = read('../src/types.ts');
  it('ボードは、別のメモを見ているときだけ呼び名を差し替える（見ていないときは fn をそのまま動かす）。描画・メニュー・道具の列・線の種類・外す線を通す', () => {
    expect(tab).toMatch(/if \(!src\?\.linkNames \|\| !src\.info\?\.\(\)\?\.other\) return fn\(\);\s*return withLinkKindNames\(src\.linkNames\(\), fn\);/);
    for (const m of ['renderBoard', 'paintToolsBoard', 'openKindMenuBoard', 'chooseKindBoard', 'openRemoveLinksBoard']) expect(tab).toMatch(new RegExp(`this\\.named\\(\\(\\) => this\\.${m}\\(`));
  });
  it('下の面：見ているメモ（選んだメモ ?? 下の区画）の呼び名を渡す。呼称セットが変わったらボードにも知らせる。下の区画の applyCurrentLinkNames は今までのまま', () => {
    expect(pane).toContain('linkNames: () => resolvedLinkKindNames(boardMemoView ?? view, linkNameSets.book)');
    expect(pane).toMatch(/function refreshLinkNames\(\) \{\s*boardListeners\.forEach\(\(fn\) => fn\(\)\);/);
    expect(pane).toContain('applyLinkKindNames(resolvedLinkKindNames(view, linkNameSets.book));');
  });
  it('知らせの出し先：memo が付いていれば noticeTarget で決める。付いていなければ（どちらも undefined）今までどおり両方', () => {
    expect(pane).toContain("const to = noticeTarget({ memo: msg.payload.memo, lowerId: view?.id ?? null, chosenId: boardMemoView?.id ?? null });");
    expect(pane).toContain("if (to !== 'board') status.textContent = noticeText;");
    expect(pane).toContain("if (to !== 'lower') boardNoticeListeners.forEach((fn) => fn(noticeText));");
  });
  it('左：memo を付けるのは、メモ id が分かる断り・知らせ（タグ・関連・型の貼り付けの断り・削除の取り消し・＋コメントでマスと結べなかった〈V2b〉）。型の追加は省略できる項目 1 つだけ（後方互換）', () => {
    expect(primary).toContain('...(extra?.memo ? { memo: extra.memo } : {}),');
    expect(primary.match(/\{ memo: action\.(id|to) \}/g)!.length).toBe(9);
    expect(types).toContain("{ kind: 'memoPaneNotice'; text: string; openMemo?: string; undoSend?: string; memo?: string; dropShot?: string }");
  });
  it('ボードの部品は、呼び名の差し替えの道（withLinkKindNames）以外では呼称セットを触らない', () => {
    expect(tab).not.toMatch(/linkNameSets|resolvedLinkKindNames|applyLinkKindNames/);
  });
});