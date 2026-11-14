// ボードの吹き出し（MK8a・MK8b。docs/plan-comment-board-marks.md §4.8）：「［全体］の間」だけ、印のカードの文の頭を、面の左右の空きに番号つきで出す層
//   置き場・順・組・小札の点・頭のダブルクリックの数えの計算は memo-card-board-callouts.ts（純粋。試験あり）。ここは DOM と、止まってから置き直す時計と、頭・「＋n」の受け口。
//   いつ出す・隠すか、押したら何をするか（選ぶ・跳ぶ・メニュー）は app/memo-board-tab.ts が決める
//   層は面（stage）の子で、縮む層（world）のすぐ後ろ（z は付けない：縮む層＜吹き出し＜範囲選択の枠＜📌 の層）。層・吹き出しの体・番号の小札・絵は押しを受けない。
//   押せるのは頭（ボタン。左クリックで選ぶ・ダブルクリックでそのカードへ 100%・右クリックでそのカードのメニュー）と、席の「＋n」（ボタン。次の組へ）。どれも押しで焦点を取らない。
//   右上の札「＋n」（席が無いとき）は押せない札（乗せたときに説明を出すため、押しだけ受ける。面の pointerdown はこの札で戻る：tab）。
//   ホイールとピンチは止めない（面の子なので、面の受け口へそのまま届く）。保存しない
//   頭を押してからダブルクリックの間（PEEK_DOUBLE_MS）は、見ている位置が同じなら作り直さない（1 回目の選びでタグの行が出て面が低くなり、席の数が替わっても、
//   2 回目が同じ頭に当たるように。間が過ぎたら置き直す。そのときは押した頭のカードの入る組を出す：calloutLayout の keep）
//   作り直すと、Tab で焦点を置いた頭・「＋n」が外れるので、同じカードの頭か新しい「＋n」へ焦点を戻す（body に落ちると、次の Enter が面の「カードを足す」になる）
//   画面の字は textContent・属性だけで入れる
import type { BoardView } from '../memo-card-board';
import { CALLOUT, CALLOUT_WAIT_MS, type CalloutBadge, calloutHead, type CalloutInput, calloutLayout, calloutMoreText, calloutMoreTitle, type CalloutOrder, type CalloutRect, calloutTap, type CalloutTap } from '../memo-card-board-callouts';
import { isKeyboardMenu } from '../memo-card-board-keys';
import { PEEK_DOUBLE_MS } from '../sheet-peek-logic';
import { el } from '../util';

// 焦点を持っていたのが席の「＋n」（focusedPart）
const MORE = 'more' as const;

// 吹き出し 1 つの中身（呼ぶ側が作る）
export interface CalloutContent {
  text: string; // 文の頭（calloutText。字の無いカードは空）
  shot: string; // 吹き出しに出す顔の絵（shots の id。字の無い写真のカードだけ。calloutShot。無ければ空）
  url: string | undefined; // その絵の縮めた data:（読めていれば。読めていなければ頭だけで、読めたら setPicture が入れる）。鍵には入れない
}

// 押したときに呼ぶ口（tab）
export interface BoardCalloutsDeps {
  paint(): void; // 置き直す（時計が鳴った・「＋n」で組を進めた。置いてよいかは呼ぶ側が決める）
  pick(id: string): void; // 頭の左クリック（Enter・スペースも）：そのカードを選ぶ
  jump(id: string): void; // 頭のダブルクリック：そのカードを選んで、「［全体］の間」を終えて 100% で真ん中に
  menu(id: string, x: number, y: number, byKey: boolean): void; // 頭の右クリック（メニューキーなら byKey。そのときの x・y は頭の右上）：そのカードのメニュー
}

const placeAt = (node: HTMLElement, r: CalloutRect) => {
  node.style.left = `${r.x}px`;
  node.style.top = `${r.y}px`;
  node.style.width = `${r.w}px`;
  node.style.height = `${r.h}px`;
};

export class BoardCallouts {
  readonly layer = el('div', 'memo-board-callouts');
  private readonly badgeBox = el('div', 'memo-board-callout-badges'); // 番号の小札の入れ物（層の頭の子。吹き出しより下に描く。置くたびに中を作り直す）
  private timer = 0; // 止まってから置き直す時計（見ている位置が動いた・つまむ・範囲選択の間は隠して待つ）。頭を押した間のあとに置き直すのも、この時計（隠さない）
  private key = ''; // 描いた中身（JSON）。同じなら作り直さない（選んだ見た目と絵の data: は入れない）
  private at: BoardView | null = null; // 置いたときの見ている位置（実際に替わったかを比べる）
  private order: CalloutOrder | null = null; // 間の中の席の順（印が替わったときのほか並べ替えない）
  private page = 0; // 組の番（席の「＋n」を押すと進む。最後の組のあとは頭の組。MK8b）
  private keep: string | null = null; // 出したい組のカード（押した頭のカード。ほかは今の組の頭）。1 組の枚数が替わっても、このカードの入る組を出す（calloutLayout）
  private tap: CalloutTap | null = null; // 前に頭を押した（ダブルクリックの数え）
  private holdUntil = 0; // この時刻（Date.now）までは作り直さない（頭を押してからダブルクリックの間。show）
  private readonly heads = new Map<string, HTMLButtonElement>(); // 頭（カードの id → 要素）。選んだ見た目は、作り直さずにここから引いて切り替える
  private more: HTMLButtonElement | null = null; // 席の「＋n」（作り直したあと、焦点を戻すため）
  private picked: ReadonlySet<string> = new Set(); // 選んでいるカード（作り直したあとにも当てる）

  constructor(private readonly deps: BoardCalloutsDeps) {
    this.layer.hidden = true;
    this.badgeBox.setAttribute('aria-hidden', 'true'); // 番号は頭と同じ（読み上げで二度言わない）
  }

  // 止まるのを待っている（時計がある）
  get waiting(): boolean {
    return this.timer !== 0;
  }

  // 置いたときから、見ている位置が実際に替わったか（置いていなければ false）
  movedFrom(view: BoardView): boolean {
    const at = this.at;
    return at !== null && (at.x !== view.x || at.y !== view.y || at.zoom !== view.zoom);
  }

  // 隠して、止まってから置き直す（呼ぶたびに待ち直す）。中身と順は捨てない
  later(): void {
    this.layer.hidden = true;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      this.deps.paint();
    }, CALLOUT_WAIT_MS);
  }

  // 置く（待っている時計は消す）。content：カードの文の頭と、字の無いカードの絵（CalloutContent）
  //   番号の小札は置くたびに作り直す（見ている位置で動く。押しを受けないので、作り直しても押しは崩れない）。吹き出しは中身が同じなら作り直さない
  show(input: CalloutInput, content: (id: string) => CalloutContent): void {
    window.clearTimeout(this.timer);
    this.timer = 0;
    // 頭を押してからダブルクリックの間：見ている位置が同じなら、今の吹き出しを残して（面の大きさ・写しが替わっても作り直さない）、間が過ぎたら置き直す。
    //   隠れている・まだ置いていない層は待たない。見ている位置が替わった（［全体］で合わせ直した）ら待たない（頭が動くので、2 回目は数えない）
    const hold = this.holdUntil - Date.now();
    if (hold > 0 && !this.layer.hidden && !this.movedFrom(input.view)) {
      this.timer = window.setTimeout(() => {
        this.timer = 0;
        this.deps.paint();
      }, hold);
      return;
    }
    this.holdUntil = 0;
    this.at = { ...input.view };
    const layout = calloutLayout(input, this.order, this.page, this.keep);
    this.order = layout.order;
    this.page = layout.page;
    if (this.keep === null || !layout.items.some((i) => i.id === this.keep)) this.keep = layout.items[0]?.id ?? null; // 押した頭が出ていなければ、今の組の頭
    const urls = new Map<string, string | undefined>();
    const items = layout.items.map((item) => {
      const c = content(item.id);
      urls.set(item.id, c.url);
      return { ...item, head: calloutHead(item.n, item.like, item.color), text: c.text, shot: c.shot };
    });
    this.badgeBox.replaceChildren(...layout.badges.map((b) => this.badgeEl(b)));
    const key = JSON.stringify([items, layout.more, layout.corner, input.viewport.w]);
    this.layer.hidden = items.length === 0 && layout.more === null && layout.corner === 0;
    if (key === this.key) return;
    this.key = key;
    const focused = this.focusedPart(); // 作り直す前に、焦点を持っていた頭・「＋n」（作り直したあとに戻す）
    this.heads.clear();
    this.more = null;
    const nodes: HTMLElement[] = [];
    for (const item of items) {
      const box = el('div', 'memo-board-callout');
      box.dataset.callout = item.id;
      placeAt(box, item);
      const body = el('div', 'memo-board-callout-text');
      body.append(this.headEl(item.id, item.head));
      if (item.text) body.append(document.createTextNode(item.text));
      box.append(body);
      if (item.shot) {
        box.classList.add('has-picture');
        box.append(this.pictureEl(item.shot, urls.get(item.id)));
      }
      nodes.push(box);
    }
    if (layout.more) nodes.push(this.moreEl(layout.more.n, layout.more));
    if (layout.corner > 0) nodes.push(this.cornerEl(layout.corner));
    this.layer.replaceChildren(this.badgeBox, ...nodes);
    this.paintSelected(this.picked);
    const back = focused === null ? null : focused === MORE ? this.more : (this.heads.get(focused.id) ?? null);
    back?.focus({ preventScroll: true }); // 焦点を戻す（同じカードの頭が無い・「＋n」が無くなったら戻さない）
  }

  // 消す（間が終わった・隠れた）。時計・順・組・頭の押しの数えも捨てる（次の間は並べ直す）
  clear(): void {
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.at = null;
    this.order = null;
    this.page = 0;
    this.keep = null;
    this.key = '';
    this.tap = null;
    this.holdUntil = 0;
    this.heads.clear();
    this.more = null;
    this.layer.replaceChildren();
    this.layer.hidden = true;
  }

  // 選んだ見た目（頭。MK8b）：作り直さずに、id から頭を引いて class を切り替える（show の鍵に入れない。鍵に入れると 1 回目の押しで頭が入れ替わり、
  //   ダブルクリックの 2 回目が別の要素に当たる）。選んだ見た目では作り直さない（ただし選ぶとタグの行が出て面が低くなり、頭を押した間のあとに席が組み直されることはある：show）。
  //   呼ぶのは tab の paintSelect と、作り直したあとの show
  paintSelected(selected: ReadonlySet<string>): void {
    this.picked = new Set(selected);
    for (const [id, head] of this.heads) head.classList.toggle('is-selected', this.picked.has(id));
  }

  // 顔の絵が読めた（tab の loadFace。カードの img を替える所と同じ継ぎ目）：その絵を待っている吹き出しの img に入れて見せる（作り直さない）
  setPicture(shot: string, url: string): void {
    for (const img of this.layer.querySelectorAll<HTMLImageElement>('.memo-board-callout-picture')) {
      if (img.dataset.shot !== shot) continue;
      img.src = url;
      img.hidden = false;
    }
  }

  // 頭（ボタン）：左クリックで選ぶ。ダブルクリック（calloutTap）でそのカードへ跳ぶ。右クリックはここで受けて止め、そのカードのメニューへ（空きのメニューへ行かない）
  private headEl(id: string, text: string): HTMLButtonElement {
    const head = el('button', 'memo-board-callout-head', text);
    head.type = 'button';
    head.addEventListener('pointerdown', (e) => e.preventDefault()); // 押しで焦点を取らない（矢印・Enter がボードに効くまま。面の pointerdown はボタンの上で戻る）
    head.addEventListener('click', () => this.press(id));
    head.addEventListener('contextmenu', (e) => {
      e.preventDefault(); // 標準のメニューを出さない
      e.stopPropagation(); // 面の右クリックの受け口（root の onContextMenu。空きのメニュー）へ渡さない（📌 と同じ。app/memo-board-pins.ts）
      const byKey = isKeyboardMenu(e);
      const r = byKey ? head.getBoundingClientRect() : null;
      this.deps.menu(id, r ? r.right : e.clientX, r ? r.top : e.clientY, byKey);
    });
    this.heads.set(id, head);
    return head;
  }

  // 頭の左クリック：ダブルクリックならそのカードへ跳ぶ。そうでなければ、そのカードを選ぶ（ダブルクリックの間は作り直さない。置き直しても、そのカードの組を出す）
  private press(id: string): void {
    const t = calloutTap(this.tap, { id, at: Date.now() });
    this.tap = t.next;
    this.holdUntil = t.next ? t.next.at + PEEK_DOUBLE_MS : 0;
    this.keep = id;
    if (t.jump !== null) this.deps.jump(t.jump);
    else this.deps.pick(id);
  }

  // 焦点を持っている頭（カードの id）・席の「＋n」（MORE）。層の中に焦点が無ければ null
  private focusedPart(): { id: string } | typeof MORE | null {
    const active = document.activeElement;
    if (active === null) return null;
    if (active === this.more) return MORE;
    for (const [id, head] of this.heads) if (head === active) return { id };
    return null;
  }

  // 字の無い写真のカードの絵（縮めた顔の絵）。読めていなければ隠して頭だけ（読めたら setPicture）。押しを受けない
  private pictureEl(shot: string, url: string | undefined): HTMLImageElement {
    const img = el('img', 'memo-board-callout-picture');
    img.alt = '';
    img.draggable = false;
    img.dataset.shot = shot;
    if (url) img.src = url;
    img.hidden = !url;
    return img;
  }

  // 番号の小札（中心を点に合わせるのは CSS の translate）。押しを受けない
  private badgeEl(b: CalloutBadge): HTMLElement {
    const node = el('span', 'memo-board-callout-badge', String(b.n));
    node.style.left = `${b.x}px`;
    node.style.top = `${b.y}px`;
    return node;
  }

  // 席の「＋n」：押せるボタン（説明に件数）。押すと次の組（最後の組のあとは頭の組。calloutPage が回して収める）。押しで焦点を取らない。
  //   頭を押した間の待ち（時計）・ダブルクリックの数え・出したい組のカードは捨てて、すぐ置き直す（前の頭の押しと続けて数えない。組の番で出す）
  private moreEl(n: number, r: CalloutRect): HTMLElement {
    const node = el('button', 'memo-board-callout-more', calloutMoreText(n));
    node.type = 'button';
    node.title = calloutMoreTitle(n);
    placeAt(node, r);
    node.addEventListener('pointerdown', (e) => e.preventDefault());
    node.addEventListener('click', () => {
      window.clearTimeout(this.timer);
      this.timer = 0;
      this.holdUntil = 0;
      this.tap = null;
      this.keep = null;
      this.page += 1;
      this.deps.paint();
    });
    this.quietMenu(node);
    this.more = node;
    return node;
  }

  // 面の右上の札「＋n」（席が無いとき）：押せない札。乗せたとき説明が出るように押しだけ受ける（CSS）。面の pointerdown はこの札で戻る（tab）
  private cornerEl(n: number): HTMLElement {
    const corner = el('div', 'memo-board-callout-more', calloutMoreText(n));
    corner.title = calloutMoreTitle(n);
    corner.classList.add('is-corner');
    corner.style.top = `${CALLOUT.pad}px`;
    corner.style.right = `${CALLOUT.inset}px`;
    this.quietMenu(corner);
    return corner;
  }

  // 「＋n」の上の右クリックは何もしない（標準のメニューも、面の空きのメニューも出さない）
  private quietMenu(node: HTMLElement): void {
    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  }
}
