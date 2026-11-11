// ボードの 📌：カードの全文を面に残す層（保存しない。上に出しているときだけ使う。メモごとに持ち、ほかのメモの間は隠す）
//   文字は textContent だけ。画面の外へ出ないように収める。つかんで動かせる
import { t as tr } from '../i18n';
import { grabPointer } from '../pointer-grab';
import { el } from '../util';

export interface PinContent {
  title: string; // 頭の帯のカードの名前
  head: string; // 事実の 1 行
  text: string; // 全文（空でもよい）
  picture?: string; // 絵（data:image/ だけ）
}

export interface PinRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface BoardPinsDeps {
  layer: HTMLElement; // 層（この中に入れる）
  content(memoId: string, id: string): PinContent | null; // カードが無ければ null（閉じる）
  anchor(id: string): { x: number; y: number } | null; // カードの右上（層の左上からの画素）。無ければ今の場所のまま
  area(): PinRect; // 収める四角（層の左上からの画素）
}

const PIN_MARGIN = 4;

// 置き場所：anchor ＋ off を、四角の中に収める（入らないときは左上をそろえる）
export function pinPosition(anchor: { x: number; y: number }, off: { x: number; y: number }, size: { w: number; h: number }, area: PinRect): { left: number; top: number } {
  const left = Math.max(area.left + PIN_MARGIN, Math.min(area.right - size.w - PIN_MARGIN, anchor.x + off.x));
  const top = Math.max(area.top + PIN_MARGIN, Math.min(area.bottom - size.h - PIN_MARGIN, anchor.y + off.y));
  return { left, top };
}

// 1 件の 📌
interface PinRec {
  memoId: string;
  id: string;
  node: HTMLElement; // section（層の子）
  body: HTMLElement; // 中身の欄
  name: HTMLElement; // 頭の名前
  off: { x: number; y: number }; // anchor からのずれ（つかんで動かすと変わる）
  key: string; // 描いた中身（JSON）。同じなら描き直さない
}

export class BoardPins {
  private readonly recs: PinRec[] = []; // 留めた順
  private z = 0; // 前に出す順（押すたびに増やす）

  constructor(private readonly deps: BoardPinsDeps) {}

  // 留める。同じカードがもう留めてあれば前に出すだけ
  pin(memoId: string, id: string): void {
    const same = this.recs.find((r) => r.memoId === memoId && r.id === id);
    if (same) {
      this.raise(same.node);
      return;
    }
    const content = this.deps.content(memoId, id);
    if (!content) return;
    const n = this.recs.filter((r) => r.memoId === memoId).length; // そのメモの件数の分だけ、ずらして出す
    const rec = this.make(memoId, id, { x: 8 + n * 28, y: n * 34 });
    this.recs.push(rec);
    this.deps.layer.append(rec.node);
    this.raise(rec.node);
    this.fill(rec, content);
  }

  // 写しが替わった・メモが替わった。そのメモのものだけ見せ、中身を直す。カードが消えたら閉じる。ほかのメモのものは隠す（閉じない）
  refresh(memoId: string | null): void {
    for (const rec of [...this.recs]) {
      if (rec.memoId !== memoId) {
        rec.node.hidden = true;
        continue;
      }
      const content = this.deps.content(rec.memoId, rec.id);
      if (!content) {
        this.drop(rec);
        continue;
      }
      rec.node.hidden = false;
      this.fill(rec, content);
    }
  }

  // 見えているものを置き直す（見ている位置が動いた・面の大きさが変わった）
  place(): void {
    for (const rec of this.recs) if (!rec.node.hidden) this.placeOne(rec);
  }

  // 全部閉じる（下に戻した）
  closeAll(): void {
    for (const rec of this.recs.splice(0)) rec.node.remove();
  }

  // そのメモの新しいものを 1 つ閉じる（Esc）。閉じたら true
  closeNewest(memoId: string | null): boolean {
    const rec = [...this.recs].reverse().find((r) => r.memoId === memoId);
    if (!rec) return false;
    this.drop(rec);
    return true;
  }

  hasOpen(memoId: string | null): boolean {
    return this.recs.some((r) => r.memoId === memoId);
  }

  // 1 件の DOM を作る（まだ層には入れない）
  private make(memoId: string, id: string, off: { x: number; y: number }): PinRec {
    const node = el('section', 'memo-board-pin');
    node.setAttribute('role', 'dialog');
    const head = el('div', 'memo-board-pin-head');
    const nameEl = el('span', 'memo-board-pin-name');
    const close = el('button', 'memo-board-pin-close', '✕');
    close.type = 'button';
    close.title = tr('閉じる（カードは消えません）');
    close.setAttribute('aria-label', tr('閉じる'));
    head.append(el('span', '', '📌'), nameEl, close);
    const body = el('div', 'memo-board-pin-body');
    node.append(head, body);
    const rec: PinRec = { memoId, id, node, body, name: nameEl, off, key: '' };
    close.addEventListener('click', () => this.drop(rec));
    // 押したら前に出す。右クリックは面の受け口へ渡さない（標準のメニューを残す。文を選んでコピーできるように）
    node.addEventListener('pointerdown', () => this.raise(node));
    node.addEventListener('contextmenu', (e) => e.stopPropagation());
    // つまんで動かす（頭から。ボタンの上からは始めない）
    let start: { x: number; y: number; off: { x: number; y: number } } | null = null;
    grabPointer(head, {
      onPress: (e) => {
        if ((e.target as Element).closest('button')) return false;
        start = { x: e.clientX, y: e.clientY, off: { ...rec.off } };
      },
      onMove: (e) => {
        if (!start) return;
        rec.off = { x: start.off.x + e.clientX - start.x, y: start.off.y + e.clientY - start.y };
        this.placeOne(rec);
      },
      onEnd: () => (start = null),
      onCancel: () => (start = null),
    });
    return rec;
  }

  // 中身を直す。中身が同じなら描き直さない（スクロールと選んだ文を保つ）。最後に置き場所を決める
  private fill(rec: PinRec, content: PinContent): void {
    const key = JSON.stringify(content);
    if (key !== rec.key) {
      rec.key = key;
      rec.name.textContent = content.title;
      rec.node.setAttribute('aria-label', tr('留めたカード：{0}', { 0: content.title }));
      const kids: HTMLElement[] = [el('div', 'memo-board-pin-facts', content.head)];
      if (content.text) kids.push(el('div', 'memo-board-pin-text', content.text));
      const picture = content.picture ?? '';
      if (picture.startsWith('data:image/')) {
        const img = el('img', 'memo-board-pin-picture');
        img.src = picture;
        img.alt = tr('カードの画像');
        kids.push(img);
      }
      rec.body.replaceChildren(...kids);
    }
    this.placeOne(rec);
  }

  // 置き場所を決める（anchor が無いときは今の場所のまま）
  private placeOne(rec: PinRec): void {
    const anchor = this.deps.anchor(rec.id);
    if (!anchor) return;
    const p = pinPosition(anchor, rec.off, { w: rec.node.offsetWidth, h: rec.node.offsetHeight }, this.deps.area());
    rec.node.style.left = `${p.left}px`;
    rec.node.style.top = `${p.top}px`;
  }

  private raise(node: HTMLElement): void {
    node.style.zIndex = String(++this.z);
  }

  private drop(rec: PinRec): void {
    const i = this.recs.indexOf(rec);
    if (i >= 0) this.recs.splice(i, 1);
    rec.node.remove();
  }
}
