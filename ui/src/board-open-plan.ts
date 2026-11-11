// メモをボードで開くとき、下の区画とボードを、どう替えるか。2 つある
//   「上のコメントボードで開く」（左のメモのセルの右クリック・右のメモの区画の右クリック）：boardOpenPlan・runBoardOpen
//   「下で開く」（右のメモの区画の右クリック）：lowerBoardPlan・runLowerBoardOpen（このファイルの下のほう）
//
// 「上のコメントボードで開く」
//   下の区画が別のメモを開いている：下はそのまま。ボードだけがそのメモを見る（ボードだけ別のメモを見る M2・M3 と同じ）
//   下の区画が同じメモを開いている：ボードの選びを外す（ボードは下のメモに付いていく）
//   下の区画が閉じている：下にもそのメモを開き（ダブルクリックと同じ）、ボードの選びを外す
//     区画を閉じると、下の面は左に「書きかけ無し」と知らせ、次に開くと欄を空にする（ダブルクリックで開くときと同じ）。
//     openMemoPane の書きかけの守りも、下が開いていて別のメモのときだけなので、閉じているときは守りを足さない
//   選べないメモ（無い・特別なセル）：何もしない（断る）
export type BoardOpenPlan = { ok: false } | { ok: true; open: string | null; boardMemo: string | null };

// lower：下の区画が今開いているメモ（閉じていれば null）　usable：そのメモがあり、特別なセルでない
export function boardOpenPlan(o: { lower: string | null; id: string; usable: boolean }): BoardOpenPlan {
  if (!o.usable) return { ok: false };
  if (o.lower === null) return { ok: true, open: o.id, boardMemo: null };
  if (o.lower === o.id) return { ok: true, open: null, boardMemo: null };
  return { ok: true, open: null, boardMemo: o.id };
}

// 分けて、呼ぶ。順は「ボードの選び（setBoardMemo）→ 閉じていれば下に開く（open）→ ボードを上に出す頼み（askUpper）」
//   断る（使えないメモ・setBoardMemo が断った）ときは refuse だけを呼ぶ。やり終えたら true
export function runBoardOpen(o: {
  lower: string | null;
  id: string;
  usable: boolean;
  setBoardMemo(id: string | null): boolean;
  open(id: string): void;
  askUpper(): void;
  refuse(): void;
}): boolean {
  const plan = boardOpenPlan(o);
  if (!plan.ok || !o.setBoardMemo(plan.boardMemo)) {
    o.refuse();
    return false;
  }
  if (plan.open !== null) o.open(plan.open);
  o.askUpper();
  return true;
}

// 「下で開く」（右のメモの区画の右クリック）：ボードを下の区画で見せて、このメモを見る
//   下の区画が同じメモを開いている：ボードの選びを外す（ボードは下のメモに付いていく）。下は開き直さない
//   下の区画が閉じている：下にそのメモを開き（ダブルクリックと同じ）、ボードの選びを外す
//   下の区画が別のメモを開いていて、書きかけが無い：下もそのメモに替え（左のカードの「下で開く」と同じ）、ボードの選びを外す
//   下の区画が別のメモを開いていて、書きかけがある：下は替えない（書きかけを消さない）。ボードだけがそのメモを見て、そのことを知らせる（keptDraft）
//   選べないメモ（無い・特別なセル）：何もしない（断る）
export type LowerBoardPlan = { ok: false } | { ok: true; open: string | null; boardMemo: string | null; keptDraft: boolean };

// lower：下の区画が今開いているメモ（閉じていれば null）　usable：そのメモがあり、特別なセルでない　draft：下の区画に書きかけがある（下の面が知らせる）
export function lowerBoardPlan(o: { lower: string | null; id: string; usable: boolean; draft: boolean }): LowerBoardPlan {
  if (!o.usable) return { ok: false };
  if (o.lower === o.id) return { ok: true, open: null, boardMemo: null, keptDraft: false };
  if (o.lower === null || !o.draft) return { ok: true, open: o.id, boardMemo: null, keptDraft: false };
  return { ok: true, open: null, boardMemo: o.id, keptDraft: true };
}

// 分けて、呼ぶ。順は「ボードの選び（setBoardMemo）→ 下に開く（open）→ ボードを下に出す頼み（askLower）→ 書きかけで下を替えなかった知らせ（tellKept）」
//   断る（使えないメモ・setBoardMemo が断った）ときは refuse だけを呼ぶ。やり終えたら true
export function runLowerBoardOpen(o: {
  lower: string | null;
  id: string;
  usable: boolean;
  draft: boolean;
  setBoardMemo(id: string | null): boolean;
  open(id: string): void;
  askLower(): void;
  tellKept(): void;
  refuse(): void;
}): boolean {
  const plan = lowerBoardPlan(o);
  if (!plan.ok || !o.setBoardMemo(plan.boardMemo)) {
    o.refuse();
    return false;
  }
  if (plan.open !== null) o.open(plan.open);
  o.askLower();
  if (plan.keptDraft) o.tellKept();
  return true;
}
