// 段 CB2b（J4）：うまくいった操作は一言を出さず、前の文を消す。左の知らせが出ていれば隠さない（配線の確かめ：ソースの形）
//   DOM を動かす確かめは開発画面（docs/wip/2026-11-02/checks/README.md）
import { readFileSync as readFile } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { code } from './helpers';

const tab = readFile(new URL('../src/app/memo-board-tab.ts', import.meta.url), 'utf8');
const body = (from: string, to: string) => tab.slice(tab.indexOf(from), tab.indexOf(to, tab.indexOf(from)));

describe('memo-board-tab.ts：うまくいった操作は一言を出さない', () => {
  it('消えた成功の文は、ソースに無い', () => {
    for (const s of ['カードを足しました', '書き直しました', 'タグを変えました', 'を付けました', '関連を外しました']) {
      expect(code(tab)).not.toContain(s);
    }
  });
  it('残す文（削除・整理・型・戻す・失敗と断り）は、ソースにある', () => {
    for (const s of [
      '削除しました（Ctrl+Z で戻せます）',
      'tidyDoneText(',
      'doneText',
      'undoDoneText',
      "'カードを足せませんでした",
      "'書き直せませんでした",
      "'タグを変えられませんでした",
      "'関連を付けられませんでした",
      "'関連を外せませんでした",
    ]) {
      expect(tab).toContain(s);
    }
  });
  it('quietSuccess の本体：左の知らせが出ていれば隠さず、なければ前の文を消す', () => {
    const quiet = body('private quietSuccess(', '// ---------- ボードでの編集');
    expect(quiet).toContain('this.quietAfterNotice()');
    expect(quiet).toContain('this.clearFlash()');
    expect(quiet.indexOf('this.quietAfterNotice()')).toBeLessThan(quiet.indexOf('this.clearFlash()'));
  });
  it('quietSuccess の呼び出しは 7 か所（HX5：足して位置が変わらなかったときも静かに終える）', () => {
    expect(code(tab).match(/this\.quietSuccess\(\)/g)).toHaveLength(7);
    expect(code(body('private submitAdd(', 'private drawAddedLink(')).match(/this\.quietSuccess\(\)/g)).toHaveLength(2); // 保存できた・もうその位置だった
  });
});
