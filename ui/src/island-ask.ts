// 段階16。島の名前と、人が選んだメモだけを、依頼の下書きの文にする。
//   となりのメモは入れない。ページの本文は入れない。アプリは、この文を作っただけでは開かない。

export const ISLAND_ASK_MAX = 8;
const MEMO_CHARS = 800;

function clip(value: string, max: number): string {
  const text = value.replace(/\r\n?/g, '\n').trim();
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : text;
}

export function islandAskText(name: string, memos: { title: string; text: string }[]): string {
  const lines = [
    `島「${clip(name, 40) || '島'}」について頼みたいです。`,
    'この島のメモと、そのとき選んでいたメモだけです。となりのメモと、ページの本文は入れていません。',
    '',
  ];
  if (memos.length === 0) {
    lines.push('メモは選んでいません。島の名前だけです。');
    return lines.join('\n').trim();
  }
  memos.forEach((memo, i) => {
    const raw = memo.text.replace(/\r\n?/g, '\n').trim();
    const body = clip(raw, MEMO_CHARS);
    lines.push(`${i + 1}. ${clip(memo.title, 40) || 'メモ'}`);
    if (body) lines.push(body);
    lines.push('');
  });
  return lines.join('\n').trim();
}
