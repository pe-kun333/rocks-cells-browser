// 穴 3：ボードで書いた文が、左に断られても消えない（欄へ戻す）。戻し方の決まりの純関数と、配線（ソースの形）の確かめ
//   DOM を動かす確かめは headless の dev 画面（docs/wip/2026-11-02/checks/README.md）
import { readFileSync as readFile } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { canReturnDraft, type ComposeMode, returnMode } from '../src/memo-card-board-edit';
import type { Reply } from '../src/threads';

const tab = readFile(new URL('../src/app/memo-board-tab.ts', import.meta.url), 'utf8');
const body = (from: string, to: string) => tab.slice(tab.indexOf(from), tab.indexOf(to, tab.indexOf(from)));

const card = (id: string, parent: string | null = null): Reply => ({ id, parent, text: id, createdAt: 1 });
const ADD: ComposeMode = { kind: 'add' };
const EDIT: ComposeMode = { kind: 'edit', id: 'a' };

describe('canReturnDraft：断られた文を、いま欄へ戻せるか', () => {
  it('欄が閉じていれば戻す', () => {
    expect(canReturnDraft(null, '')).toBe(true);
  });
  it('足す欄が空のまま開いていれば戻す（空白だけも空のうち）', () => {
    expect(canReturnDraft(ADD, '')).toBe(true);
    expect(canReturnDraft(ADD, ' \n　')).toBe(true);
  });
  it('足す欄に書いている最中は待つ（書きかけを壊さない・変換を切らない）', () => {
    expect(canReturnDraft(ADD, '次のカード')).toBe(false);
  });
  it('書き直す欄が開いていれば、空でも待つ（どのカードの文かが替わってしまう）', () => {
    expect(canReturnDraft(EDIT, '')).toBe(false);
    expect(canReturnDraft(EDIT, '書き直し中')).toBe(false);
  });
});

describe('returnMode：戻す欄の種類', () => {
  it('足す文は足す欄へ', () => {
    expect(returnMode(ADD, [card('a')])).toEqual(ADD);
    expect(returnMode(ADD, [])).toEqual(ADD);
  });
  it('書き直す文は、そのカードがあれば書き直す欄へ', () => {
    expect(returnMode(EDIT, [card('a'), card('b')])).toEqual(EDIT);
  });
  it('書き直すカードがもう無ければ足す欄へ（決めると「カードがもうありません」で文が消えるので）', () => {
    expect(returnMode(EDIT, [card('b')])).toEqual(ADD);
    expect(returnMode(EDIT, [])).toEqual(ADD);
  });
  it('一番上のカードでなくなっていたら足す欄へ（ボードで書き直せるのは一番上のカードだけ）', () => {
    expect(returnMode(EDIT, [card('b'), card('a', 'b')])).toEqual(ADD);
  });
});

describe('memo-board-tab.ts の配線', () => {
  it('足す：断られたら、同じメモを見ているときだけ、書いたままの文を足す欄へ戻す', () => {
    const add = body('private submitAdd(', 'private startEdit(');
    const refused = add.slice(add.indexOf('if (!ok) {'), add.indexOf('this.setSelected(new Set([id]));'));
    expect(refused).toMatch(/if \(this\.memoId === memoId\) \{[\s\S]*this\.returnDraft\(\{ kind: 'add' \}, text\);[\s\S]*\}/);
    expect(refused.indexOf('this.memoId === memoId')).toBeLessThan(refused.indexOf('this.returnDraft'));
  });
  it('足す：足せたときは戻さない', () => {
    const add = body('private submitAdd(', 'private startEdit(');
    expect(add.match(/this\.returnDraft\(/g)).toHaveLength(1);
  });
  it('書き直す：断られたら、書いたままの文をそのカードの書き直す欄へ戻す。メモが替わったら戻さない', () => {
    const edit = body('private submitEdit(', '// ---- 消す');
    expect(edit).toContain('if (this.memoId !== memoId) return;');
    expect(edit.indexOf('if (this.memoId !== memoId) return;')).toBeLessThan(edit.indexOf('this.returnDraft'));
    expect(edit).toContain("this.returnDraft({ kind: 'edit', id }, text);");
    expect(edit.match(/this\.returnDraft\(/g)).toHaveLength(1);
    expect(edit.indexOf('this.quietSuccess()')).toBeLessThan(edit.indexOf('this.returnDraft'));
  });
  it('書いている最中で待った文は、欄が閉じたときに戻す。メモを替えたら持ち越さない', () => {
    const giveBack = body('private returnDraft(', 'private submitCompose(');
    expect(giveBack).toContain('canReturnDraft(this.composing, this.composeText.value)');
    expect(giveBack).toContain('this.refusedDrafts.push({ mode, text })');
    const close = body('private closeCompose(', 'private submitCompose(');
    expect(close).toContain('this.refusedDrafts.shift()');
    expect(close.indexOf("this.composeText.value = ''")).toBeLessThan(close.indexOf('this.refusedDrafts.shift()'));
    const changed = body('if (changed) {', 'this.memoId = snap.memoId;');
    expect(changed.indexOf('this.refusedDrafts.length = 0')).toBeGreaterThan(-1);
    expect(changed.indexOf('this.refusedDrafts.length = 0')).toBeLessThan(changed.indexOf('this.closeCompose()'));
  });
  it('戻すときは焦点がどこにも無いときだけ欄へ移す（下の帯やほかの欄で書いている最中は奪わない）', () => {
    const show = body('private showRefused(', 'private closeCompose(');
    expect(show).toMatch(/\(!active \|\| active === document\.body\) && this\.keysAllowed\(active\)\) this\.composeText\.focus\(\)/);
  });
  it('戻す道は「足せない」の検査を通さない（検査で止まると文が消える。決めるときに同じ検査が欄を残したまま断る）', () => {
    const show = body('private showRefused(', 'private closeCompose(');
    expect(show).not.toContain('openCompose');
    expect(show).not.toContain('addBlockedNote');
  });
});
