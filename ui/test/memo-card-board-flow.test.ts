// 段 CB3c：カードの顔を流し込みで描く・乗せた説明。顔の組み立て・乗せた説明の結びと、CSS の行数・折り返しを、ソースを読んで確かめる
//   見た目（流し込みの行数・タグの札との重なり）は開発画面（主担当が確かめる）
import { readFileSync as readFile } from 'node:fs';
import { describe, expect, it } from 'vitest';

const tab = readFile(new URL('../src/app/memo-board-tab.ts', import.meta.url), 'utf8');
const css = readFile(new URL('../src/grok-cards.css', import.meta.url), 'utf8');
const body = (from: string, to: string) => tab.slice(tab.indexOf(from), tab.indexOf(to, tab.indexOf(from)));

// CSS の規則の本体を、同じセレクタの全部について集める（コメントを外し、セレクタの空白をつめて引く。同じセレクタが二つあるものも全部）
const ruleBodies = (selector: string): string[] =>
  css
    .replace(/\r/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .filter((chunk) => chunk.includes('{') && chunk.slice(0, chunk.indexOf('{')).replace(/\s+/g, ' ').trim() === selector)
    .map((chunk) => chunk.slice(chunk.indexOf('{') + 1));

describe('memo-board-tab.ts：カードの顔を流し込みで描く', () => {
  it('build は顔を流し込みで組み、題と本文の別の要素を作らない', () => {
    const build = body('private build(', 'private renderFilter(');
    for (const s of ['memo-board-card-flow', 'markSeatWidth(f.mark)', 'memo-board-card-first', 'memo-board-card-who', 'is-ai', 'has-tags']) {
      expect(build, s).toContain(s);
    }
    expect(build).not.toContain('memo-board-card-title');
    expect(build).not.toContain('memo-board-card-body');
  });

  it('bindStage は乗せた 1 枚に、memo-card-board-menu の説明の文を入れる', () => {
    const stage = body('private bindStage()', 'private setSelected(');
    expect(stage).toContain("'pointerover'");
    expect(stage).toContain('cardTip(replies, reply)');
    expect(tab).toMatch(/import \{[^}]*\bcardTip\b[^}]*\} from '\.\.\/memo-card-board-menu';/);
  });
});

describe('grok-cards.css：カードの顔を流し込みで描く', () => {
  it('流し込みの本体は行数を変数で受け、字の折り返しを決める', () => {
    const flow = ruleBodies('.memo-board-card-flow');
    expect(flow).toHaveLength(1);
    expect(flow[0]).toContain('-webkit-line-clamp: var(--board-card-lines)');
    expect(flow[0]).toContain('overflow-wrap: anywhere');
    expect(flow[0]).toContain('white-space: pre-line');
  });

  it('既定は 5 行、AI の印・タグの札があるカードは 4 行', () => {
    expect(ruleBodies('.memo-board-card').some((b) => b.includes('--board-card-lines: 5'))).toBe(true);
    expect(ruleBodies('.memo-board-card.is-ai, .memo-board-card.has-tags').some((b) => b.includes('--board-card-lines: 4'))).toBe(true);
  });

  it('旧い題と本文の規則は無い', () => {
    expect(ruleBodies('.memo-board-card-title')).toEqual([]);
    expect(ruleBodies('.memo-board-card-body')).toEqual([]);
  });
});
