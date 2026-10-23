// 左の盤面の右クリック：登録したシートへ飛ぶボタン（6つまで）
//   覚え方はこの画面の localStorage（左の WebView だけ。再起動しても残る）
//   シートの台帳（session.json）も、右のメモのシートのセット（right-sheets.json）も、セルのセット（cellsets.json）も変えない
import { isSheetId } from './sheets';

export const SHEET_SLOT_COUNT = 6;
const STORE_KEY = 'honeycomb.boardSheetSlots';

// 右サイドバーの区画タグ（section-shelf）と同じ決まり：1つのシートは1つの番号だけ。空いている番号はボタンにしない
export class BoardSheetSlots {
  private slots: (string | null)[] = Array.from({ length: SHEET_SLOT_COUNT }, () => null);

  constructor() {
    this.load();
  }

  get list(): readonly (string | null)[] {
    return this.slots;
  }

  // いまのシートをその番号に入れる。ほかの番号に同じシートがあれば、そこからは外す
  register(id: string, slot: number) {
    if (!isSheetId(id) || slot < 0 || slot >= SHEET_SLOT_COUNT) return;
    const next = this.slots.map((current) => (current === id ? null : current));
    next[slot] = id;
    this.slots = next;
    this.save();
  }

  // 消えたシートを外す（台帳を読み終えてから。読み込む前に外すと、覚えていたボタンが消える）
  prune(exists: (id: string) => boolean) {
    const seen = new Set<string>();
    let changed = false;
    const next = this.slots.map((id) => {
      if (!id || !exists(id) || seen.has(id)) {
        if (id) changed = true;
        return null;
      }
      seen.add(id);
      return id;
    });
    if (!changed) return;
    this.slots = next;
    this.save();
  }

  private load() {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
      if (!raw || typeof raw !== 'object') return;
      const slots = (raw as { slots?: unknown }).slots;
      if (!Array.isArray(slots)) return;
      const seen = new Set<string>();
      this.slots = Array.from({ length: SHEET_SLOT_COUNT }, (_, index) => {
        const value: unknown = slots[index];
        if (!isSheetId(value) || seen.has(value)) return null;
        seen.add(value);
        return value;
      });
    } catch {
      // 覚えられなくても、今は開ける
    }
  }

  private save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ slots: this.slots }));
    } catch {
      // 保存できなくても、今は開ける
    }
  }
}
