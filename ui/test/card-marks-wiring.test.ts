// カードの印（♥・色。MK5）の配線（ソースの形の確かめ。DOM を動かす確かめは無い）
//   左の受け口・Grok の書き出しの呼び口・タグのセットの保存・断りの一言・ボードの元に戻す（mark）と setMark
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { unwrapT } from './source-text';
import { code } from './helpers';

const read = (path: string) => unwrapT(readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n'));
const primary = read('../src/app/primary.ts');
const pane = read('../src/app/memo-pane.ts');
const tab = read('../src/app/memo-board-tab.ts');
const types = read('../src/types.ts');
const count = (s: string, part: string) => s.split(part).length - 1;
const between = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(`見つかりません：${from}`);
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(`見つかりません：${to}`);
  return src.slice(a, b);
};
// クラスの一段目（字下げ 2）の宣言の名前と位置（hex-wiring.test.ts と同じ読み方）
const members = [...tab.matchAll(/^ {2}(?:(?:private|readonly|get|async|static) )*(\w+)\s*\(/gm)].map((m) => ({ name: m[1], at: m.index ?? 0 }));
const memberBody = (name: string) => {
  const i = members.findIndex((m) => m.name === name);
  if (i < 0) throw new Error(`見つかりません：${name}`);
  return tab.slice(members[i].at, members[i + 1]?.at ?? tab.length);
};

describe('命令と左の受け口', () => {
  it('命令 setReplyMark は 1 つ（memo の id・カードの id・種類・値）', () => {
    expect(count(types, "command: 'setReplyMark'")).toBe(1);
    expect(types).toContain("| { command: 'setReplyMark'; id: string; replyId: string; kind: import('./likes').MarkKind; value: string }");
  });

  it('受け口は changeReplyTags のすぐ後ろ（changeReplyLinks の前）。形を確かめ、断ったら種類ごとの文（full）か、タグと同じ文で知らせる', () => {
    const tags = between(primary, "case 'changeReplyTags': {", "case 'setReplyMark': {");
    expect(tags).not.toContain("case 'changeReplyLinks'");
    const mark = between(primary, "case 'setReplyMark': {", "case 'changeReplyLinks': {");
    expect(mark).toContain("(action.kind !== 'like' && action.kind !== 'color') || typeof action.value !== 'string') break;");
    expect(mark).toContain('const done = memos.setReplyMark(action.id, action.replyId, action.kind, action.value);');
    expect(mark).toContain("if (!done.ok) tellMemo(done.why === 'full' ? markFullNote(action.kind, MAX_TAGS_PER_TAB) : 'このカードのタグは変えられませんでした（メモの台帳を読めていないか、カードがもうありません）', { memo: action.id });");
  });

  it('ふつうのタグの受け口：add・remove から印の値を捨てる（dropMarkValues。整えたあとの字で見る。動きは card-marks.test.ts）。上限の断りは、印が付いていれば一言を足す', () => {
    const tags = between(primary, "case 'changeReplyTags': {", "case 'setReplyMark': {");
    expect(tags).toContain('const add = dropMarkValues(action.add);');
    expect(tags).toContain('const remove = dropMarkValues(action.remove);');
    expect(tags.indexOf('dropMarkValues(')).toBeLessThan(tags.indexOf('memos.changeReplyTags(action.id, action.replyId, add, remove)'));
    expect(count(primary, 'dropMarkValues(')).toBe(2);
    expect(tags).toContain(' + markCountNote(memos.get(action.id)?.replies?.find((r) => r.id === action.replyId)?.tags ?? [])');
  });
});

describe('Grok の書き出しの呼び口', () => {
  it('Grok へ送る書き出し（grokExport）だけ dropMarks: true。当てる前の写し（writePatchBefore）は落とさない', () => {
    const send = between(primary, 'async function grokExport(', 'GROK_LIMITS,');
    expect(code(send)).toContain('dropMarks: true,');
    const before = between(primary, 'async function writePatchBefore(', 'GROK_LIMITS,');
    expect(before).toContain('buildExport(');
    expect(before).not.toContain('dropMarks');
    expect(count(code(primary), 'dropMarks')).toBe(1);
  });
});

describe('タグのセットの保存と断りの一言', () => {
  it('「今のタグをセットとして保存…」は件数・押せるか・保存する中身を見えるタグで作る', () => {
    const menu = between(pane, 'function openTagSetMenu(', "entries.push({ label: 'いつものタグを登録…'");
    expect(menu).toContain('const shown = visibleTags(now);');
    expect(menu).toContain("hint: shown.length > TAG_BUTTONS ? tr('はじめの {0} 個', { 0: TAG_BUTTONS }) : `${shown.length}`,");
    expect(menu).toContain('disabled: shown.length === 0 || book.sets.length >= 12,');
    expect(menu).toContain("tagBook.apply({ type: 'addSet', name, tags: shown.slice(0, TAG_BUTTONS) });");
    expect(code(menu)).not.toContain('now.slice(');
  });

  it('カードのタグの上限の断りには、印が付いていれば一言を足す（下の区画のいつものタグ・＋タグ・タグのボタン・タグの段・提案）', () => {
    const add = between(pane, 'function addTags(', 'function quickTags(');
    expect(count(add, ' + markCountNote(now)')).toBe(2);
    const pad = read('../src/panels/tag-pad.ts');
    expect(count(pad, ' + markCountNote(target.tags)')).toBe(2); // ＋タグの書く欄と候補の欄
    expect(count(pad, ' + markCountNote(tags)')).toBe(1); // タグのボタン
    expect(read('../src/memo-card-board-menu.ts')).toContain("ほかのタグを外してから付けてください', { 0: MAX_TAGS_PER_TAB }) + markCountNote(tags)");
    expect(read('../src/grok-patch.ts')).toContain('個までです${markCountNote(now)}');
  });
});

describe('ボードの元に戻す（mark）と setMark', () => {
  it('runUndo：次が印なら、読み込み中・読めないボードでも止めない（覗いてから決める）。形の止めの行は今のまま', () => {
    const run = memberBody('runUndo');
    expect(run).toContain("const blocked = peeked?.kind === 'mark' ? null : undoBlockedNote(this.loaded);");
    expect(run.indexOf('const peeked = ')).toBeLessThan(run.indexOf('const blocked = '));
    expect(run.indexOf('const blocked = ')).toBeLessThan(run.indexOf('const layout = this.undo.peekLayout(dir);'));
    expect(run).toMatch(/if \(layout !== null && peeked && layout !== this\.shape\) \{\s*this\.flash\(undoLayoutNote\(peeked, dir, layout\), 'info'\);\s*return;\s*\}/);
  });

  it('runUndo：mark の case は前の値（やり直しは後の値）を置き直し、写しで値を見てから終える。足すとタグが 10 個を超えるなら送らずに断る。switch の終わりに漏れの検査', () => {
    const run = memberBody('runUndo');
    const mark = between(run, "case 'mark': {", 'default:');
    expect(mark).toContain("const target = dir === 'undo' ? op.before : op.after;");
    expect(mark).toContain('if (now === null) return finish({ ok: false });');
    expect(mark).toContain('if (markFull(replies, op.id, op.mark, target, MAX_TAGS_PER_TAB)) return finish({ ok: false, note: markFullNote(op.mark, MAX_TAGS_PER_TAB) });');
    expect(mark.indexOf('markFull(')).toBeLessThan(mark.indexOf('this.ask(markCommand(memoId, op.id, op.mark, target));'));
    expect(mark).toContain('this.watch(memoId, (rs) => markStateIs(rs, op.id, op.mark, target), (ok) => finish(ok ? { ok: true } : { ok: false }));');
    expect(run).toMatch(/default:\n[^\n]*\n\s*op satisfies never;\n\s*return finish\(\{ ok: false \}\);\n\s*\}\n\s*\}\s*$/);
  });

  it('setMark：今と同じなら送らない。10 個を超えるなら送らずに断る。積むのは写しで値が替わったのを見てから（断られたら積まない）', () => {
    const set = memberBody('setMark');
    expect(set).toContain('setMark(replyId: string, kind: MarkKind, value: string) {');
    expect(set).toContain('if (before === value) return;');
    expect(set.indexOf('markFull(')).toBeLessThan(set.indexOf('this.ask(markCommand(memoId, replyId, kind, value));'));
    expect(set).toContain('this.flash(markFullNote(kind, MAX_TAGS_PER_TAB), \'warn\');');
    const watch = set.slice(set.indexOf('this.watch('));
    expect(watch).toContain('markStateIs(rs, replyId, kind, value)');
    expect(watch).toContain("if (ok) this.pushUndo({ kind: 'mark', id: replyId, mark: kind, before, after: value });");
    expect(count(set, 'this.pushUndo(')).toBe(1);
    expect(set.indexOf('this.pushUndo(')).toBeGreaterThan(set.indexOf('this.watch('));
  });

  it('setMark は、元に戻すの節の前に置く（試験が名前で切っている changeTags〜startLink・replaceMenu〜cardMenuActions・tagMenuItems〜lowerThen の間には入れない）', () => {
    const names = members.map((m) => m.name);
    const at = names.indexOf('setMark');
    expect(at).toBeGreaterThan(-1);
    expect(names[at - 1]).toBe('removeLink');
    expect(names[at + 1]).toBe('resetUndo');
  });
});
