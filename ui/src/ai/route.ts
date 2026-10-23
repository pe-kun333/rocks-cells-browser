// ハイク組の道すじ（段階8・振り分け役）。作戦カード・確かめ役・何通りかは、この段階には入れない。
//   無料の決まりで「ハイク組だけ／＋相談」を決め、迷うときだけハイクに1回聞く。
//   道具の一覧は変えない。道すじは、使う人の発言の注として渡す。

export type RouteKind = 'team' | 'consult';
export type RouteBy = 'rule' | 'judge' | 'setting' | 'user';
export type RouteMode = 'auto' | 'team' | 'consult';
export type StuckMode = 'buttons' | 'auto';
export type RefusalMode = 'plain' | 'advisor';

export interface RouteSettings {
  mode: RouteMode; // おまかせ／いつも組だけ／いつも相談つき
  stuck: StuckMode; // 割れた・詰まったとき：ボタンだけ／Claude 先生に自動
  refusal: RefusalMode; // 断られたあと：先生に聞くボタンを出すか
}

export const DEFAULT_ROUTE: RouteSettings = { mode: 'auto', stuck: 'buttons', refusal: 'plain' };

export interface RouteMark {
  kind: RouteKind;
  reason: string;
  cost: number;
  by: RouteBy;
}

export type PathKind = 'split' | 'stuck' | 'refusal';
export type PathChoice = 'redo' | 'other' | 'advisor' | 'keep';

export interface PathMark {
  kind: PathKind;
  question: string;
  speaker: string;
  reason?: string;
  choice?: PathChoice;
}

export function parseRoute(saved: Record<string, unknown>): RouteSettings {
  const mode: RouteMode = saved.routeMode === 'team' || saved.routeMode === 'consult' ? saved.routeMode : 'auto';
  return {
    mode,
    stuck: saved.routeStuck === 'auto' ? 'auto' : 'buttons',
    refusal: saved.routeRefusal === 'advisor' ? 'advisor' : 'plain',
  };
}

export function routeLabel(kind: RouteKind): string {
  return kind === 'team' ? 'ハイク組だけ' : 'ハイク組＋相談';
}

// 画面の道すじの下に出す、料金の一行
export function routeFoot(mark: RouteMark): string {
  if (mark.cost > 0) return `判定 約 $${mark.cost < 0.0001 ? mark.cost.toFixed(5) : mark.cost.toFixed(4)}`;
  if (mark.by === 'judge') return '判定 $0（練習モード）';
  if (mark.by === 'setting') return '振り分け $0（⚙）';
  if (mark.by === 'user') return '振り分け $0（選び直し）';
  return '振り分け $0（決まり）';
}

// ハイクの履歴に足す短い注。指示文（system）や道具の一覧は変えない
export function routeNote(kind: RouteKind, outlook: boolean): string {
  if (kind === 'team') return '（アプリからの道すじ：この頼みはハイク組だけで答えてください。ask_advisor は使わないでください）\n';
  const who = outlook ? '見通しなら fable（フェイブル先生）' : '数字や事実なら opus（Claude 先生）';
  return `（アプリからの道すじ：この頼みは、先生に相談してよい場面です。自信が持てないところだけ ask_advisor を使ってください。${who}。ふつうに答えられるところは相談しないでください）\n`;
}

export interface RuleHit {
  kind: RouteKind;
  reason: string;
  sure: boolean;
  outlook: boolean;
}

// 無料の決まり。sure が false のときだけ、ハイクの判定を1回使う
export function routeByRule(text: string, page: string): RuleHit {
  const n = [...text.trim()].length;
  const outlook = /10年|将来|見通し|これからどう|どうなる/.test(text);
  if (/本当[？?]|本当に/.test(text)) return { kind: 'consult', reason: '「本当？」と確かめる問い', sure: true, outlook: false };
  if (outlook) return { kind: 'consult', reason: '見通しを聞く問い', sure: true, outlook: true };
  const sample = page.slice(0, 4000);
  const letters = [...sample].filter((ch) => /[A-Za-z]/.test(ch)).length;
  const english = [...sample].length > 1500 && letters / [...sample].length > 0.45;
  if (english && /すごい|教えて|説明|何が|どういう|わかりやすく|やさしく/.test(text)) {
    return { kind: 'consult', reason: '長い英語のページで、評価が要る', sure: true, outlook: false };
  }
  if (n > 0 && n <= 40 && !/なぜ|どうして|比べ|違い|詳しく/.test(text) && !english) {
    return { kind: 'team', reason: '短い質問', sure: true, outlook: false };
  }
  return { kind: 'team', reason: '', sure: false, outlook };
}

// 迷うときの1回。道具は渡さない。この文は会話の履歴に残さない
export const ROUTE_JUDGE_SYSTEM = 'あなたは道すじを1語で分ける係です。道具は使いません。返事は2行までです。';

export function routeJudgeInstruction(text: string): string {
  return [
    'これはハイク組の「道すじ」の判定です。道具は使わないでください。',
    '最初の行は team か consult だけ。2行目は日本語の理由を20字以内。',
    'team はハイク組だけで足りる。consult は先生に聞いた方がよい。',
    '',
    '<ask>',
    [...text.trim()].slice(0, 500).join(''),
    '</ask>',
  ].join('\n');
}

export function parseRouteJudge(text: string): { kind: RouteKind; reason: string } | null {
  const lines = text
    .trim()
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const head = (lines[0] ?? '').toLowerCase();
  const kind: RouteKind | null = head.includes('consult') ? 'consult' : head.includes('team') ? 'team' : null;
  if (!kind) return null;
  const reason = (lines[1] ?? '').replace(/^理由[:：]\s*/, '').slice(0, 40);
  return { kind, reason: reason || (kind === 'consult' ? '判定で、相談した方がよいとなりました' : '判定で、組だけで足りるとなりました') };
}

// 同じ事実の数字が食い違うときだけ「割れた」（無料）。迷うときの判定は道すじの1回だけ
export function numberSplit(texts: string[]): string | null {
  const nums = texts.map((text) => [...text.matchAll(/\d{2,}/g)].map((m) => m[0]));
  for (let i = 0; i < nums.length; i++) {
    for (let j = i + 1; j < nums.length; j++) {
      if (!nums[i].length || !nums[j].length) continue;
      if (!nums[i].some((n) => nums[j].includes(n))) return '数字が食い違っています';
    }
  }
  return null;
}
