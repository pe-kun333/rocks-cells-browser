// 段 CB6a：下の一覧の返信の欄を残す（答え 5）。返信を送っても欄を閉じず、空の欄に焦点が戻ることを、ソースを読んで確かめる
//   画面の動き（送ったあとの欄の位置・焦点）は開発画面で確かめる（主担当）
import { readFileSync as readFile } from 'node:fs';
import { describe, expect, it } from 'vitest';

const thread = readFile(new URL('../src/panels/thread-view.ts', import.meta.url), 'utf8');
const memoPane = readFile(new URL('../src/app/memo-pane.ts', import.meta.url), 'utf8');
const primary = readFile(new URL('../src/app/primary.ts', import.meta.url), 'utf8');
const secondary = readFile(new URL('../src/app/secondary.ts', import.meta.url), 'utf8');
const body = (src: string, from: string, to: string) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));

describe('thread-view.ts：ThreadUi の印', () => {
  it('ThreadUi に keepReplyForm?: boolean がある（openSource? の次）', () => {
    const ui = body(thread, 'export interface ThreadUi {', 'const MAX_INDENT');
    expect(ui.indexOf('openSource?(')).toBeGreaterThan(-1);
    expect(ui).toContain('keepReplyForm?: boolean;');
    expect(ui.indexOf('keepReplyForm?: boolean;')).toBeGreaterThan(ui.indexOf('openSource?('));
  });
});

describe('thread-view.ts：返信の欄（replyForm）を送ったときの動き', () => {
  const reply = body(thread, 'function replyForm(', '// 相棒（今の会話のメンバー）を選んで');
  const submit = reply.slice(reply.indexOf("form.addEventListener('submit'"));

  it('keepReplyForm のときだけ、送ったあと空の欄を残す（form.remove のあと・ui.actions.add の前）', () => {
    const remove = submit.indexOf('form.remove();');
    const keep = submit.indexOf("if (ui.keepReplyForm) drafts.set(formKey, '');");
    expect(remove).toBeGreaterThan(-1);
    expect(keep).toBeGreaterThan(remove);
    expect(keep).toBeLessThan(submit.indexOf('ui.actions.add(ref, target, value);'));
  });

  it('drafts.delete は、空の欄を残す drafts.set より前', () => {
    const del = submit.indexOf('drafts.delete(formKey);');
    expect(del).toBeGreaterThan(-1);
    expect(del).toBeLessThan(submit.indexOf("drafts.set(formKey, '');"));
  });

  it('描き直したあと（ui.refresh のあと）に、keepReplyForm のときだけ空の欄に焦点を戻す', () => {
    const refresh = submit.indexOf('ui.refresh();');
    const focus = submit.indexOf('if (ui.keepReplyForm) document.querySelector');
    expect(refresh).toBeGreaterThan(-1);
    expect(focus).toBeGreaterThan(refresh);
    const line = submit.slice(focus, submit.indexOf('\n', focus));
    expect(line).toContain('.focus()');
    expect(line).toContain('[data-form="${CSS.escape(formKey)}"] textarea');
  });

  it('keepReplyForm の判定は、送る受け口の中の二つだけ', () => {
    expect(reply.match(/ui\.keepReplyForm/g)).toHaveLength(2);
  });
});

describe('memo-pane.ts：下の一覧だけが返信の欄を残す', () => {
  it('threadUi に keepReplyForm: true があり、印はこの一か所だけ', () => {
    const ui = body(memoPane, 'const threadUi: ThreadUi = {', '\n  };');
    expect(ui).toContain('keepReplyForm: true');
    expect(memoPane.match(/keepReplyForm/g)).toHaveLength(1);
  });
});

describe('primary.ts・secondary.ts：ほかの面は今のまま閉じる', () => {
  it.each([
    ['primary.ts', primary],
    ['secondary.ts', secondary],
  ])('%s に keepReplyForm が無い', (_name, src) => {
    expect(src).not.toContain('keepReplyForm');
  });
});
