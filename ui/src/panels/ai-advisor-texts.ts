// 三人組の先生つきの、画面に出す文の英語版つき（Ver0.033β の英語化）
//   元の文は ai/trio-advisor.ts（node の確かめ ui/checks がそのまま読むので、値の import を持てない＝t() を使えない）。
//   ここは同じ文を t() で包んだもの。日本語のときは元と同じ字になる（ui/test/ai-advisor-texts.test.ts が元と比べる）
import { t as tr } from '../i18n';
import { ADVISOR_LONG_WAIT_MS } from '../ai/trio-advisor';

// 先生が見ている間の、状態の行の文（元：advisorWaitText）
export function advisorWaitText(name: string): string {
  return tr('{0}の返事を先生が見ています…（中身は見えません。止めると、返事ごと止まります）', { 0: name });
}

// 読み上げに伝える文（元：advisorLiveText）
export function advisorLiveText(name: string, phase: 'asking' | 'done' | 'failed' | 'stopped'): string {
  if (phase === 'asking') return tr('{0}の返事を、先生が見ています', { 0: name });
  if (phase === 'done') return tr('先生が見終わりました。{0}が返事の続きを書いています', { 0: name });
  if (phase === 'failed') return tr('先生は使えませんでした。{0}は、そのまま返事を続けます', { 0: name });
  return tr('先生が見ている途中で、{0}の返事が止まりました', { 0: name });
}

// 待ちが長いときに、経過時間の後ろに足すひとこと（元：elapsedNote）
export function elapsedNote(ms: number): string {
  return ms >= ADVISOR_LONG_WAIT_MS ? tr('・長くかかっています') : '';
}

// 「先生つきで始めますか」の欄に出す文（元：advisorConsentLines）
export function advisorConsentLines(opts: { remaining: number; limit: number; withFable: boolean; practice: boolean; advisorLabel: string }): string[] {
  return [
    ...(opts.practice ? [tr('練習モードです。どこにも送りません（先生に見てもらうふりだけを見せます）。練習で始めた先生つきの会話は、本物のキーで開いても先生なしで動きます')] : []),
    tr('この会話では、これから入るページの中身や発言も、先生つきの体が返事をするたびに {0} に渡り、Anthropic 側に 30 日保存されます', { 0: opts.advisorLabel }),
    tr('許可を聞くのは、この会話ではこの 1 回だけです。話し始めたあとは外せません'),
    tr('助言の中身は画面に出ません。ページの中の指示に引っぱられていないかを、後から確かめられません'),
    tr('先生が見るのは、あなたが自分で送った発言への返事だけです。掛け合いと、出来事への反応では、先生つきの体は道具（Web 検索なども）を使いません'),
    tr('料金：1 回 約 $0.1〜1（長いページが入るほど増えます）。1 体の 1 つの返事で、ふつう 1 回まで。「みんなへ」は、先生つきの体の数だけ（ふつう最大 3 回）かかることがあります。決めた回数を超えて見てもらったら「今日の枠の外」と出して、その会話ではその体の道具を止めます'),
    tr('今日の枠は あと {0} 回（1 日 {1} 回）。枠は体への頼みで、超えることがあります。確かな上限は月の上限です', { 0: opts.remaining, 1: opts.limit }),
    ...(opts.withFable ? [tr('会話のフェイブルとは別の呼び出しです（フェイブルの返事とは別に料金がかかります）')] : []),
  ];
}
