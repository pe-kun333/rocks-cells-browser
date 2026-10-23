// タブの詳細ポップアップの決まり（画面に関わらない）
//   ・1回押しは詳しいカード。同じタブを短い間にもう一度押したら、そのタブを開く（盤面も小窓も同じ）
//   ・盤面のものをドラッグで動かしているあいだは、詳細カードと吹き出しを出さない（盤面をずらすだけは隠さない）
//   ・固定した詳細の「開く」（サイトを開く）と「下で開く」は、その固定をしまう
//   ・小窓に見えているシートのタブを開いても、盤面はそのシートへ移さない

export interface TabPressMemory {
  id: number;
  at: number;
}

// open：そのタブを開く（2回目）。そうでなければ詳しいカード。last は次に数える1回目（開いたら消す）
export function nextTabPress(last: TabPressMemory | null, id: number, now: number, ms: number): { open: boolean; last: TabPressMemory | null } {
  if (last && last.id === id && now - last.at <= ms) return { open: true, last: null };
  return { open: false, last: { id, at: now } };
}

// 盤面のものを動かし始めたとき true（タブ・メモ・入口・リストの行など。種類では分けない）
//   印は moved。盤面をずらすだけのドラッグは moved を付けないので、ここは false
export function popupsHiddenWhileDragging(drag: object | null): boolean {
  if (!drag || !('moved' in drag)) return false;
  return (drag as { moved?: boolean }).moved === true;
}

export type DetailCardAction = 'open-site' | 'open-below' | 'other';

// 固定した詳細でサイトを開く（「開く」「リンクを開く」）か、下で開くを押したら、固定を外す
export function detailCardActionClosesPin(action: DetailCardAction): boolean {
  return action === 'open-site' || action === 'open-below';
}

// true：盤面をそのタブのシートへ移す。今見ているシートと、小窓で見ているシートは移さない
export function activationMovesBoard(tabSheet: string, currentSheet: string, peekSheet: string | null): boolean {
  if (tabSheet === currentSheet) return false;
  if (peekSheet !== null && tabSheet === peekSheet) return false;
  return true;
}
