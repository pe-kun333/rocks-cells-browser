// 段 CB2c（F14）：出入りする行は面の下に置く。配線（行の並び・タグの行の畳みと戻し）と、CSS の線の向きを、ソースを読んで確かめる
//   DOM の動き（カードの画面の上の位置が動かないこと）は開発画面（docs/wip/2026-11-02/checks/README.md）
import { readFileSync as readFile } from 'node:fs';
import { describe, expect, it } from 'vitest';

const tab = readFile(new URL('../src/app/memo-board-tab.ts', import.meta.url), 'utf8');
const css = readFile(new URL('../src/grok-cards.css', import.meta.url), 'utf8');
const body = (from: string, to: string) => tab.slice(tab.indexOf(from), tab.indexOf(to, tab.indexOf(from)));

// CSS の規則の本体（セレクタ → 本体）。コメントを外し、改行を空白に直して引く（同じセレクタは最初の一つ）
const rules = new Map<string, string>();
for (const chunk of css.replace(/\r/g, '').replace(/\/\*[\s\S]*?\*\//g, '').split('}')) {
  const i = chunk.indexOf('{');
  if (i < 0) continue;
  const selector = chunk.slice(0, i).replace(/\s+/g, ' ').trim();
  if (!rules.has(selector)) rules.set(selector, chunk.slice(i + 1));
}

describe('memo-board-tab.ts：出入りする行の並び', () => {
  it('上は見出し・道具・絞りの札・面のまま。一言・線の帯・タグの行・書く欄は面の下に置く', () => {
    const m = tab.match(/this\.root\.append\(([^)]*)\)/);
    expect(m).not.toBeNull();
    expect(m![1].split(',').map((s) => s.trim())).toEqual([
      'bar',
      'this.tools',
      'this.filterBox',
      'this.stage',
      'this.status',
      'this.note',
      'this.linkBar',
      'this.tidyBar',
      'this.tagRow',
      'this.compose',
    ]);
  });

  it('タグの行は、書く欄を開いている間は出さない（描き直しの条件）', () => {
    const paint = body('private paintToolsBoard(', 'private paintTagRow(');
    expect(paint).toContain('this.paintTagRow(snap.replies, st.tags && this.composing === null);');
  });

  it('書く欄を開くとタグの行を畳み、閉じたら戻す（断られた文を戻すときは、戻した欄が畳みを受け持つ）', () => {
    const show = body('private showCompose(', 'private paintComposeShape() {');
    expect(show).toContain('this.paintTools();');
    expect(show.indexOf('this.compose.hidden = false;')).toBeLessThan(show.indexOf('this.paintTools();'));

    const close = body('private closeCompose(', 'private submitCompose(');
    expect(close).toContain('const wasOpen = this.composing !== null;');
    expect(close).toContain('this.refusedDrafts.shift()');
    expect(close).toContain('this.paintTools()');
    expect(close.indexOf('this.refusedDrafts.shift()')).toBeLessThan(close.indexOf('this.paintTools()'));
  });
});

describe('grok-cards.css：出入りする行の線は上に引く', () => {
  const linesOnTop = [
    '.memo-board-tagrow',
    '.memo-board-compose',
    '.memo-board-linkbar, .memo-board-tidybar',
    '.memo-board-note',
    '.memo-board-status',
  ];
  it.each(linesOnTop)('%s：線は上（border-top）だけ。下（border-bottom）は無い', (selector) => {
    const r = rules.get(selector);
    expect(r, selector).toBeDefined();
    expect(r).toContain('border-top: 1px solid var(--border)');
    expect(r).not.toContain('border-bottom');
  });

  it('.memo-board-filter は上に残るので、線は下（border-bottom）のまま', () => {
    expect(rules.get('.memo-board-filter')).toContain('border-bottom: 1px solid var(--border)');
  });
});
