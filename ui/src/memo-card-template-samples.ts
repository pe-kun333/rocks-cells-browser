// 内蔵サンプルの型（計画書 docs/plan-card-templates.md の Phase 2。モックの 5 件をアプリの関連の種類で作り直したもの）
//   ・（骨組み・穴あきのモードは Phase 3。骨組み：賛成・反対・結論／調査メモ、穴あき：同（穴あき）／6観点レビュー）
//   ・id は決まった名前（sample-…）。「初期サンプルを復元」は、この id がまだ無いものだけを足す（名前を変えた・中身を直したものは触らない）
//   ・関連の向きは §4.3：続き（next）・根拠（ground）・反論（counter）はカードが持つ側から相手へ。「派生」は子が親へ next
//   ・フォルダは決まった 4 つ（議論・調査・計画・その他）。各カードには種類名のタグを 1 つ付ける
import type { LinkKind } from './memo-card-links';
import { type CardTemplate, parseTemplate, type TemplateFolder, type TemplateMode } from './memo-card-templates';

type SampleCard = [tag: string, title: string, body: string, dx: number, dy: number];
type SampleLink = [from: number, to: number, kind: LinkKind];

function sample(id: string, name: string, folder: TemplateFolder, mode: TemplateMode, cards: SampleCard[], links: SampleLink[]): CardTemplate {
  const raw: CardTemplate = {
    version: 1,
    id,
    name,
    folder,
    mode,
    cards: cards.map(([tag, title, body, dx, dy], i) => ({ key: `k${i}`, title, body, tags: [tag], dx, dy })),
    links: links.map(([from, to, kind]) => ({ from: `k${from}`, to: `k${to}`, kind })),
  };
  const done = parseTemplate(raw);
  if (!done.ok) throw new Error(`内蔵サンプルが読めません：${id}（${done.why}）`);
  return done.template;
}

// 呼ぶたびに新しい写しを返す（呼ぶ側が書き換えても、もとは変わらない）
export function sampleTemplates(): CardTemplate[] {
  return [
    sample(
      'sample-proscons',
      '賛成・反対・結論',
      '議論',
      'skeleton',
      [
        ['論点', '論点', '', 240, 0],
        ['賛成', '賛成', '', 0, 150],
        ['反対', '反対', '', 480, 150],
        ['結論', '結論', '', 240, 300],
      ],
      [
        [1, 0, 'next'],
        [2, 0, 'next'],
        [2, 1, 'counter'],
        [1, 3, 'ground'],
        [2, 3, 'ground'],
      ],
    ),
    sample(
      'sample-proscons-hole',
      '賛成・反対・結論（穴あき）',
      '議論',
      'hole',
      [
        ['論点', '{{テーマ}}をどうするか', '{{テーマ}}について議論したい。', 240, 0],
        ['賛成', '賛成の立場', '{{賛成理由}}', 0, 150],
        ['反対', '反対の立場', '{{反対理由}}', 480, 150],
        ['結論', '結論', '{{結論}}', 240, 300],
      ],
      [
        [1, 0, 'next'],
        [2, 0, 'next'],
        [2, 1, 'counter'],
        [1, 3, 'ground'],
        [2, 3, 'ground'],
      ],
    ),
    sample(
      'sample-cause',
      '原因→対策→確認',
      '計画',
      'snapshot',
      [
        ['原因', '原因', 'なぜ起きたのかを書く', 0, 0],
        ['対策', '対策', '何を変えるかを書く', 270, 0],
        ['確認', '確認', 'いつ・何で効果を確かめるか', 540, 0],
      ],
      [
        [1, 0, 'next'],
        [2, 1, 'next'],
      ],
    ),
    sample(
      'sample-review6',
      '6観点レビュー',
      '調査',
      'hole',
      [
        ['論点', '{{テーマ}}をレビュー', '対象：{{テーマ}}', 240, 130],
        ['課題', '目的', '{{テーマ}}の目的は明確か', 120, 0],
        ['課題', '正確性', '{{テーマ}}の内容に誤りはないか', 360, 0],
        ['課題', '網羅性', '{{テーマ}}に抜けはないか', 0, 130],
        ['課題', '分かりやすさ', '{{テーマ}}は読み手に伝わるか', 480, 130],
        ['課題', 'リスク', '{{テーマ}}の懸念点は何か', 120, 260],
        ['課題', '次の一手', '{{テーマ}}の次のアクションは？', 360, 260],
      ],
      [
        [1, 0, 'next'],
        [2, 0, 'next'],
        [3, 0, 'next'],
        [4, 0, 'next'],
        [5, 0, 'next'],
        [6, 0, 'next'],
      ],
    ),
    sample(
      'sample-research',
      '調査メモ：問い→出典→要約',
      '調査',
      'skeleton',
      [
        ['論点', '問い', '', 240, 0],
        ['根拠', '出典A', '', 0, 150],
        ['根拠', '出典B', '', 480, 150],
        ['結論', '要約', '', 240, 300],
      ],
      [
        [1, 0, 'next'],
        [2, 0, 'next'],
        [1, 3, 'ground'],
        [2, 3, 'ground'],
      ],
    ),
  ];
}

// まだ無い内蔵サンプルだけ（id で見分ける）。list に同じ id があれば足さない
export function missingSamples(list: readonly CardTemplate[]): CardTemplate[] {
  const have = new Set(list.map((t) => t.id));
  return sampleTemplates().filter((t) => !have.has(t.id));
}