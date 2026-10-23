// 送る前の1枚（段階3）。ボットの依頼の小窓と、相棒の短いボタンで、同じ形で見せる。
//   宛先、付けるもの、字数、渡し止めの理由、料金の目安（相棒のとき）。新しい通信は無い。
import { MODELS } from './ai/client';
import { el } from './util';

export interface SendPreviewItem {
  label: string;
  on: boolean;
  detail?: string;
}

export interface SendPreview {
  to: string;
  items: SendPreviewItem[];
  chars: number;
  blocked?: string;
  cost?: string;
  note?: string;
}

export const BOT_COST_NOTE = 'Grok Bot の使用量は、このブラウザからは分かりません';

// 相棒の短いボタンの料金の目安。文字数から大まかに見る（実際の請求とは一致しない）
export function companionCostNote(chars: number, modelId: string, practice: boolean): string {
  if (practice) return '練習モードなので料金はかかりません';
  const price = MODELS.find((m) => modelId.startsWith(m.id)) ?? MODELS[0];
  const input = Math.max(0, Math.ceil(chars / 2)) + 500;
  const output = 800;
  const usd = (input * price.input + output * price.output) / 1_000_000;
  return `約 $${usd.toFixed(3)}（目安です。実際の請求とは一致しません）`;
}

// ボットの依頼の小窓の「送る前の 1 行」（依頼の小窓 v2・R1。docs/bot-cells/plan-request-v2.md D2）。
//   宛て先｜付けるもの｜字数｜返し先 の 4 つの区切りを 1 行に並べ、前回送った依頼（無ければ開いたとき）から変わった区切りに色を付ける。
//   字数には色を付けない（打つたびに変わるので）。上限に近い字数は赤。渡し止めの理由があれば後ろに足す
export interface BotLineSeg {
  key: string;
  text: string;
  changed?: boolean;
  bad?: boolean;
}

export function renderBotLine(root: HTMLElement, segs: BotLineSeg[], blocked?: string) {
  root.classList.add('bot-line');
  root.classList.remove('send-preview');
  const nodes: Node[] = [];
  segs.forEach((seg, i) => {
    if (i) nodes.push(el('span', 'bot-line-sep', '｜'));
    nodes.push(el('span', `bot-line-seg${seg.changed ? ' changed' : ''}${seg.bad ? ' bad' : ''}`, seg.text));
  });
  if (blocked) nodes.push(el('span', 'bot-line-block', blocked));
  root.replaceChildren(...nodes);
}

export function renderSendPreview(root: HTMLElement, preview: SendPreview) {
  root.classList.add('send-preview');
  const list = el('ul', 'send-preview-items');
  for (const item of preview.items) {
    const li = el('li', item.on ? 'on' : 'off');
    const mark = el('span', 'send-preview-mark', item.on ? '付ける' : '付けない');
    li.append(mark, document.createTextNode(item.label));
    if (item.detail) li.append(el('span', 'send-preview-detail', item.detail));
    list.append(li);
  }
  root.replaceChildren(
    el('div', 'send-preview-to', `宛先：${preview.to}`),
    list,
    el('div', 'send-preview-chars', `字数：${preview.chars.toLocaleString('ja-JP')} 字`),
  );
  if (preview.blocked) root.append(el('div', 'send-preview-block', preview.blocked));
  if (preview.cost) root.append(el('div', 'send-preview-cost', `料金の目安：${preview.cost}`));
  if (preview.note) root.append(el('div', 'send-preview-note', preview.note));
}
