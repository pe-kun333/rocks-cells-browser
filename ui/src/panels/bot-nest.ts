// Grok-Bot の巣（右下。第3段 S3.2：docs/bot-cells/plan-s3-nest.md §3・S3.2、見本 docs/bot-cells/mocks/nest-01-ring.png）
//   ・6つの席を六角形の輪に置く。上から時計回りに 席1〜6 ＝ 台帳の dock の順。空いた席は点線の六角形と ＋（押すと「置く」のメニュー）
//   ・真ん中に「Grok-Bot の巣 n体」の札
//   ・席の顔は役の形（bot-roles.ts の shape を SVG で軽く描く。真ん中に G）。役なしは今の石板の顔（cellface.ts の drawBotFace）。
//     顔の下に役の名前（役なしはボットの名前）、マウスを乗せるとボットの名前
//     同じ役の席が2つ以上あるときは、役の名前の後ろにボットの名前の短い形を付けて区別する（「調査·Lookout」。S3.3b）
//   ・今の状態（待っている・作業中・返事あり・遅れ・エラー・リンクなし・アプリなし）は顔の縁と輪、札の数（まだ読んでいない・待っている）は
//     顔の右上と左下の小さな札（文字を読めるように HTML で重ねる）
//   ・席を押すと選ぶ（輪の下に「役の名前（ボットの名前）・役のひとこと」と「この子に頼む」）。その下に「⬡ みんなに聞く（n体）」
//   ・ダブルクリックでアプリを開く。右クリック・Shift+F10・ContextMenu キーでメニュー。Alt+← → で前の席へ／次の席へ
//   ・ここは描くだけ。台帳の写し・メニュー・頼む文の欄・左への命令は BotDock（bot-dock.ts）が持ち、押されたことを host で伝える
//   ・見出しの右上に ⚙（S3.3）。押すと巣の上に設定の欄（bot-nest-settings.ts。BotDock が持つ）が開く。開いている間、下の輪は押せない（inert）
//   ・「この子に頼む」「⬡ みんなに聞く」は、巣の上に依頼の小窓（S3.5。bot-request-form.ts。BotDock が持つ）を開く。開いている間も、下の輪は押せない
//   ・動き（アニメーション）は合体 Grok（S3.7）だけ。作業中の点線の輪は回さない（点の細かさで分ける）
//   ・合体 Grok（S3.7。merged。許可の確認と、いつ戻すかは BotDock と bot-nest-merge.ts）：席の顔が真ん中へ寄って薄くなり、
//     真ん中に黒い円と光の輪。輪の下に「元に戻す」。動きは CSS だけ（0.4 秒で寄る・光の輪の明るさがゆっくり変わるだけ。
//     回転・粒・カメラの動きは無し。prefers-reduced-motion では動かさず色だけ）。合体のあいだ、席は押せない（inert）
//   ・巣の下端に1行（S3.8）：「Grok Bot：待っている依頼 2 件（#0003 調査中）・受け取り口 ✓」。押すと受け取り箱（右のボットの欄）へ
//   ・依頼の小窓 v2・R8（D17）：頼んでいる席は顔のまわりの点線（今までの輪）、知らせの期限（巣の設定）を過ぎた依頼のある席は赤の点線と赤い札、
//     返事が届いた席は光る（data-glow。影だけ・動きなし）。押すと受け取り箱のその返事へ飛び、「読んだ」で光が消える（BotDock）。新しい状態は増やさない
import type { BotBrief, BotFullState } from '../bots';
import { botFullStateHint, botFullStateLabel, MAX_DOCK_BOTS } from '../bots';
import { CUSTOM_ROLE, roleDef, roleShapeLabel, type BotRole, type BotRoleShape } from '../bot-roles';
import { cardsStageOn, onCardsStore, readArrived, readCardsDevState, readCardsOpen, shownCounts } from '../cards-stages';
import { drawBotFace, svgEl, svgText } from '../cellface';
import { hexCorners } from '../hex';
import { shellButton } from './nest-icon';
import { mergeRowLabel, resolveShellInput, shellDevForArrived, shellSize, shellView, type ShellInput, type ShellSize } from '../nest-shell';
import { el } from '../util';

type At = { x: number; y: number };

// 席に座っている1体（BotDock が台帳の写しと BotBriefState から作る）
export interface BotNestSeat {
  bot: BotBrief;
  state: BotFullState; // いちばん大事な1つ（botFullState と同じ決め方）
  unread: number; // まだ読んでいない返事（右上の札）
  waiting: number; // 待っている依頼（左下の札）
  overdue?: number; // そのうち知らせの期限を過ぎたもの（R8。赤の点線と赤い札）
}

export interface BotNestView {
  seats: BotNestSeat[]; // 席の順（dock の順）。MAX_DOCK_BOTS 体まで
  selected: string | null; // 選んでいるボット
  ready: boolean; // 台帳を読み込んだ（まだなら空いた席の ＋ は押せない）
  cardsOpen?: boolean; // 段 1〜2 の、この面だけの「開いた」印（段 3 からは共有の開閉を見る）
}

export interface BotNestHost {
  select(id: string): void; // 席を押した（選ぶだけ。アプリは開かない）
  open(id: string): void; // 顔をダブルクリックした（Grok Bot アプリで開く）
  menu(id: string, at: At, keyboard: boolean): void; // 右クリック・Shift+F10
  move(id: string, to: number): void; // Alt+← →（to：0 から数えた席）
  add(at: At): void; // 空いた席の ＋
  askOne(id: string, at: At): void; // 「この子に頼む」（BotDock が依頼の小窓を開き、送る部品 bot-send.ts に渡す。左の ClipboardSender が依頼を作る。S3.4・S3.5）
  askAll(at: At): void; // 「⬡ みんなに聞く（n体）」（依頼の小窓を宛て先「みんな」で開く。S3.6：A 1体ずつの案内／B 代表にまとめて）
  askTeam(at: At): void; // 「グループに頼む ▾」（5つのグループから選ぶ。G2）
  settings(): void; // 見出しの ⚙（設定の欄を開く。S3.3）
  unmerge(): void; // 合体 Grok の「元に戻す」（S3.7）
  inbox(): void; // 下の1行（S3.8。受け取り箱の一覧へ移る）
  cards(): void; // 殻（段 1〜）。Grok Cards を開く・閉じる
}

// 巣の下の1行（S3.8。BotDock が受け取り箱の一覧の写しと受け取り口の様子から作る）
export interface BotNestFoot {
  waiting: number; // 待っている依頼の数（全部のボット）
  first?: { no: string; label: string }; // いちばん新しい待っている依頼（#0003・調査中）
  inbox: { text: string; ok: boolean; hint: string }; // 受け取り口の様子（inboxStatusText）
}

const VIEW_BOX = '-22 -22 44 44'; // 顔の SVG（盤面のセルの大きさ 19.5 が入る箱）

// 役の形の板（顔の地。class は bot-plate なので、盤面のボットの顔と同じ状態の色が付く）
//   g：真ん中の G の位置と大きさ（三角・星・十字は中が狭いので、少し下げる・小さくする。半月は丸い側へ寄せる）
const SHAPES: Record<BotRoleShape, { plate: () => SVGElement[]; g: { x?: number; y: number; size: number } }> = {
  hexagon: { plate: () => [svgEl('polygon', { points: hexCorners(0, 0, 19.5) })], g: { y: 0.5, size: 13 } },
  circle: { plate: () => [svgEl('circle', { cx: 0, cy: 0, r: 18.5 })], g: { y: 0.5, size: 13 } },
  triangle: { plate: () => [svgEl('polygon', { points: regular(3, 22, 0, 4) })], g: { y: 6.5, size: 11 } },
  diamond: { plate: () => [svgEl('polygon', { points: '0,-21 17.5,0 0,21 -17.5,0' })], g: { y: 0.5, size: 12 } },
  star: { plate: () => [svgEl('polygon', { points: star(5, 21.5, 9.5, 1.5) })], g: { y: 2.5, size: 9.5 } },
  doubleCircle: {
    plate: () => [svgEl('circle', { cx: 0, cy: 0, r: 19 }), svgEl('circle', { class: 'bot-nest-inner', cx: 0, cy: 0, r: 14.5 })],
    g: { y: 0.5, size: 12 },
  },
  square: { plate: () => [svgEl('rect', { x: -16.5, y: -16.5, width: 33, height: 33, rx: 3 })], g: { y: 0.5, size: 13 } },
  pentagon: { plate: () => [svgEl('polygon', { points: regular(5, 20.5, 0, 1.5) })], g: { y: 2, size: 12.5 } },
  drop: { plate: () => [svgEl('path', { d: 'M0,-21 C4,-13 14,-6 14,5 A14,14 0 0 1 -14,5 C-14,-6 -4,-13 0,-21 Z' })], g: { y: 5, size: 12 } },
  halfMoon: { plate: () => [svgEl('path', { d: 'M-7,-19.5 A19.5,19.5 0 0 1 -7,19.5 Z' })], g: { x: 2.5, y: 0.5, size: 12 } },
  trapezoid: { plate: () => [svgEl('polygon', { points: '-10,-15 10,-15 20.5,15 -20.5,15' })], g: { y: 1.5, size: 12.5 } },
  cross: { plate: () => [svgEl('polygon', { points: cross(20.5, 7.5) })], g: { y: 0.5, size: 10 } },
  gear: { plate: () => [svgEl('polygon', { points: gear(8, 21, 16.5) })], g: { y: 0.5, size: 12.5 } },
};

// 正多角形（頂点 0 が真上）。dy：見た目の真ん中にそろえるために下げる量
function regular(n: number, r: number, cx: number, dy: number): string {
  return Array.from({ length: n }, (_, i) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(dy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
}

// 星（n 個のとがり。外の半径 outer・内の半径 inner）
function star(n: number, outer: number, inner: number, dy: number): string {
  return Array.from({ length: n * 2 }, (_, i) => {
    const a = (Math.PI * i) / n - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    return `${(r * Math.cos(a)).toFixed(1)},${(dy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
}

// 十字（腕の長さ len・腕の太さの半分 w）
function cross(len: number, w: number): string {
  return [
    [-w, -len],
    [w, -len],
    [w, -w],
    [len, -w],
    [len, w],
    [w, w],
    [w, len],
    [-w, len],
    [-w, w],
    [-len, w],
    [-len, -w],
    [-w, -w],
  ]
    .map(([x, y]) => `${x},${y}`)
    .join(' ');
}

// 歯車（teeth 個の歯。歯の先の半径 outer・歯のあいだの半径 inner）
function gear(teeth: number, outer: number, inner: number): string {
  const step = 360 / teeth;
  const points: string[] = [];
  const at = (deg: number, r: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    points.push(`${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`);
  };
  for (let i = 0; i < teeth; i++) {
    const c = i * step;
    at(c - step * 0.3, inner);
    at(c - step * 0.17, outer);
    at(c + step * 0.17, outer);
    at(c + step * 0.3, inner);
  }
  return points.join(' ');
}

// 役の形の顔（板・状態の輪・真ん中の G）。札の数は HTML で重ねるので、ここでは描かない
export function drawRoleFace(g: SVGElement, shape: BotRoleShape, state: BotFullState) {
  const off = state === 'noLink' || state === 'noApp';
  const face = svgEl('g', { class: `bot-face bot-nest-role ${off ? 'bot-off' : 'bot-on'} bot-${state}` });
  const def = SHAPES[shape] ?? SHAPES.hexagon;
  const [plate, ...rest] = def.plate();
  plate.setAttribute('class', 'bot-plate');
  face.append(plate, ...rest);
  // 待っている・作業中・遅れている：形の外まわりの点線の輪（形によって中が狭いので、外に出す）
  if (state === 'accepted' || state === 'working' || state === 'late') face.append(svgEl('circle', { class: 'bot-ring', cx: 0, cy: 0, r: 22.5 }));
  const letter = svgText({ x: def.g.x ?? 0, y: def.g.y }, 'G', 'bot-nest-g');
  letter.setAttribute('font-size', String(def.g.size));
  face.append(letter);
  g.append(face);
}

// 席の顔（役ありは役の形、役なしは今の石板の顔）。石板の顔の札・印は消して、HTML の札にそろえる（設定の欄の小さな顔にも使う）
export function drawSeatFace(svg: SVGElement, bot: BotBrief, state: BotFullState, clipId: string) {
  const g = svgEl('g', { class: 'bot bot-nest-faceg' });
  if (bot.role) {
    drawRoleFace(g, bot.role.shape, state);
  } else {
    drawBotFace(g, { x: 0, y: 0 }, 19.5, { state }, undefined, '', clipId);
    for (const node of g.querySelectorAll('.bot-tag, .bot-tag-text, .bot-badge, .bot-badge-text')) node.remove();
  }
  svg.append(g);
}

// 役のひとこと（用意した役は表の文、自分で作った役は説明の文の最初の行）
export function roleBlurb(role: BotRole | undefined): string {
  if (!role) return '役なし';
  const def = roleDef(role.preset);
  if (def) return def.blurb;
  const first = (role.instructions ?? '').split('\n').find((line) => line.trim())?.trim();
  return first || CUSTOM_ROLE.blurb;
}

// 席の下に出す名前（役の名前。役なしはボットの名前）。bot：同じ役の席が2つ以上あるときだけ、ボットの名前の短い形
interface SeatName {
  role: string;
  bot?: string;
}

const NAME_SHORT_UNITS = 7; // ボットの名前の短い形の幅（全角 2・半角 1 で数える。顔の下の幅 72px に役の名前と並ぶ分）

// 1字の幅（CJK・全角・絵文字は 2、ほかは 1。おおよそで足りる）
const units = (ch: string) => ((ch.codePointAt(0) ?? 0) >= 0x2e80 ? 2 : 1);

// 頭から（tail なら終わりから）NAME_SHORT_UNITS の幅まで。切ったら「…」を付ける（「…」も 1 に数える）
function shortName(name: string, tail = false): string {
  const chars = [...name.trim()];
  if (chars.reduce((n, ch) => n + units(ch), 0) <= NAME_SHORT_UNITS) return chars.join('');
  const list = tail ? [...chars].reverse() : chars;
  const kept: string[] = [];
  let width = 1;
  for (const ch of list) {
    if (width + units(ch) > NAME_SHORT_UNITS) break;
    kept.push(ch);
    width += units(ch);
  }
  const part = (tail ? kept.reverse() : kept).join('').trim();
  return tail ? `…${part}` : `${part}…`;
}

// 席ごとの名前（同じ役か：用意した役は preset、自分で作る役は名前。巣の顔の下では名前が同じなら区別がつかないので、名前で見る）
//   短い形が同じ組でぶつかったら終わりからの短い形、それでもぶつかれば席の番号
function seatNames(seats: readonly BotNestSeat[]): Map<string, SeatName> {
  const names = new Map<string, SeatName>();
  const groups = new Map<string, BotNestSeat[]>();
  for (const seat of seats) {
    const role = seat.bot.role?.name;
    if (!role) {
      names.set(seat.bot.id, { role: seat.bot.name });
      continue;
    }
    names.set(seat.bot.id, { role });
    groups.set(role, [...(groups.get(role) ?? []), seat]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const unique = (list: string[]) => new Set(list).size === list.length;
    const head = group.map((s) => shortName(s.bot.name));
    const tail = group.map((s) => shortName(s.bot.name, true));
    const shorts = unique(head) ? head : unique(tail) ? tail : group.map((s) => `席${seats.indexOf(s) + 1}`);
    group.forEach((s, i) => names.set(s.bot.id, { role: s.bot.role?.name ?? '', bot: shorts[i] }));
  }
  return names;
}

// 顔の下の名前（同じ役の席は「役の名前·ボットの短い名前」。狭い幅なので、つなぎは半角の中黒。役の名前のほうを先に縮める）
function nameLabel(name: SeatName): HTMLElement {
  const label = el('span', 'bot-nest-name');
  if (!name.bot) {
    label.textContent = name.role;
    return label;
  }
  label.dataset.dup = 'true';
  label.append(el('span', 'bot-nest-name-role', name.role), el('span', 'bot-nest-name-bot', `·${name.bot}`));
  return label;
}

// 「まだ読んでいない 1・待っている 2」（どちらも 0 なら空）
const countsText = (seat: BotNestSeat) =>
  (seat.unread || seat.waiting ? `・まだ読んでいない ${seat.unread}・待っている ${seat.waiting}` : '') + (seat.overdue ? `（知らせの期限を過ぎた ${seat.overdue}）` : '');

const small = (n: number) => (n > 9 ? '9+' : String(n));

export class BotNest {
  readonly element = el('div', 'bot-nest');
  private readonly ring = el('div', 'bot-nest-ring');
  private readonly detail = el('div', 'bot-nest-detail');
  private readonly all = el('button', 'bot-nest-all');
  private readonly team = el('button', 'bot-nest-team', 'グループに頼む ▾');
  private readonly asks = el('div', 'bot-nest-asks');
  private readonly gear = el('button', 'bot-nest-gear', '⚙');
  private readonly core = el('div', 'bot-nest-core'); // 合体 Grok の黒い円と光の輪（S3.7。描き直しても同じ要素を使い、動きをやり直さない）
  private readonly mergeBar = el('div', 'bot-nest-merge'); // 合体のあいだの1行と「元に戻す」
  private readonly unmergeButton = el('button', 'brf-button bot-nest-unmerge', '元に戻す');
  private readonly foot = el('button', 'bot-nest-foot'); // 下の1行（S3.8）
  private readonly mergeText = el('span', 'bot-nest-merge-text', '⬡ 合体 Grok：返事を待っています');
  private readonly mergeToggle = el('button', 'bot-nest-merge-toggle');
  private view: BotNestView = { seats: [], selected: null, ready: false };
  private isMerged = false;
  private shellPx: ShellSize = 60;

  constructor(private readonly host: BotNestHost) {
    this.element.setAttribute('role', 'group');
    this.detail.setAttribute('role', 'status'); // 選んだ子の説明・6体のときの「置けない」わけを読み上げる
    this.all.type = 'button';
    this.all.dataset.key = 'all';
    this.all.addEventListener('click', () => this.host.askAll(this.at(this.all)));
    this.team.type = 'button';
    this.team.dataset.key = 'team';
    this.team.setAttribute('aria-haspopup', 'menu');
    this.team.title = '5つのグループから選んで、その役のボットに同じ問いを聞きます';
    this.team.addEventListener('click', () => this.host.askTeam(this.at(this.team)));
    this.asks.append(this.all, this.team);
    this.gear.type = 'button';
    this.gear.dataset.key = 'gear';
    this.gear.title = '巣の設定（並び・役・みんなに聞く・定型・送り方）';
    this.gear.setAttribute('aria-label', 'Grok-Bot の巣の設定（並び・役・みんなに聞く・定型・送り方）');
    this.gear.setAttribute('aria-haspopup', 'dialog');
    this.gear.setAttribute('aria-expanded', 'false');
    this.gear.addEventListener('click', () => this.host.settings());
    this.core.setAttribute('aria-hidden', 'true');
    this.core.append(el('span', 'bot-nest-core-g', 'G'));
    this.mergeBar.hidden = true;
    this.mergeBar.setAttribute('role', 'status');
    this.mergeText.title = '演出です（SuperGrok Heavy の機能とはまだつながっていません）。みんなに聞くの依頼が全部終わると、巣は元の見た目に戻ります';
    this.mergeToggle.type = 'button';
    this.mergeToggle.dataset.key = 'merge-row';
    this.mergeToggle.hidden = true;
    this.mergeToggle.addEventListener('click', () => this.host.cards());
    this.unmergeButton.type = 'button';
    this.unmergeButton.dataset.key = 'unmerge';
    this.unmergeButton.title = '巣を元の見た目に戻します（依頼はそのまま。返事は受け取り箱に届きます）';
    this.unmergeButton.addEventListener('click', () => this.host.unmerge());
    this.mergeBar.append(this.mergeText, this.mergeToggle, this.unmergeButton);
    onCardsStore(() => {
      if (cardsStageOn('1')) this.render(this.view);
    });
    this.foot.type = 'button';
    this.foot.dataset.key = 'foot';
    this.foot.hidden = true;
    this.foot.addEventListener('click', () => this.host.inbox());
    this.element.append(this.ring, this.mergeBar, this.detail, this.asks, this.foot);
  }

  // 合体 Grok の見た目にする・戻す（S3.7。何度呼んでも重ならない：data-merge を切り替えるだけ）
  merged(on: boolean) {
    if (this.isMerged === on) return;
    const hadFocus = this.mergeBar.contains(document.activeElement);
    const shellHad = document.activeElement instanceof HTMLElement && document.activeElement.dataset.key === 'shell';
    this.isMerged = on;
    this.element.dataset.merge = on ? 'on' : '';
    this.mergeBar.hidden = !on;
    for (const b of this.ring.querySelectorAll<HTMLElement>('.bot-nest-seat')) b.inert = on;
    this.syncMergeRow();
    if (on && shellHad) this.focusKey('merge-row');
    else if (!on && hadFocus) this.focusKey('all');
  }

  // 設定の欄が開いた・閉じた（開いている間は、欄の下になった輪・説明・みんなに聞くを押せなくする）
  settingsOpen(open: boolean) {
    this.gear.setAttribute('aria-expanded', String(open));
    this.element.dataset.settings = open ? 'open' : '';
    for (const node of [this.ring, this.mergeBar, this.detail, this.asks, this.foot]) node.inert = open;
  }

  // 下の1行（S3.8）：「Grok Bot：待っている依頼 2 件（#0003 調査中）・受け取り口 ✓」（null なら出さない）
  footer(info: BotNestFoot | null) {
    this.foot.hidden = !info;
    if (!info) return;
    const waiting = info.waiting > 0 ? `待っている依頼 ${info.waiting} 件${info.first ? `（${info.first.no} ${info.first.label}）` : ''}` : '待っている依頼なし';
    const inbox = el('span', `bot-nest-foot-inbox${info.inbox.ok ? ' ok' : ''}`, info.inbox.text);
    this.foot.replaceChildren(el('span', 'bot-nest-foot-g', 'G'), el('span', 'bot-nest-foot-text', `Grok Bot：${waiting}`), el('span', 'bot-nest-foot-sep', '・'), inbox);
    this.foot.firstElementChild?.setAttribute('aria-hidden', 'true');
    this.foot.title = `${waiting}。${info.inbox.hint}\n押すと受け取り箱（依頼の一覧）へ移ります`;
    this.foot.setAttribute('aria-label', `Grok Bot：${waiting}・${info.inbox.text}。押すと受け取り箱の依頼の一覧へ`);
  }

  // 設定の欄を閉じたあと、キーボードの位置を ⚙ に戻す
  focusGear() {
    this.gear.focus({ preventScroll: true });
  }

  // 依頼の小窓が開いた・閉じた（S3.5。開いている間は、小窓の下になった輪・説明・みんなに聞くを押せなくする）
  formOpen(open: boolean) {
    this.element.dataset.form = open ? 'open' : '';
    for (const node of [this.ring, this.mergeBar, this.detail, this.asks, this.foot]) node.inert = open;
  }

  // 小窓を閉じたあと、キーボードの位置を開いたボタンに戻す（key：「この子に頼む」は ask-one・みんなに聞くは all。無ければ選んでいる席）
  focusKey(key: string) {
    const target = this.element.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`) ?? this.ring.querySelector<HTMLElement>('.bot-nest-seat[aria-pressed="true"]');
    target?.focus({ preventScroll: true });
  }

  render(view: BotNestView) {
    this.view = view;
    const { seats, ready } = view;
    const n = seats.length;
    this.element.setAttribute('aria-label', `Grok-Bot の巣（外のアプリ Grok Bot。${n}体・席は ${MAX_DOCK_BOTS} つ）`);
    this.element.dataset.empty = String(n === 0);
    // 描き直しても、キーボードの位置は同じ所に残す（同じボットの席・同じ番号の空いた席・同じボタン）
    const active = document.activeElement instanceof HTMLElement && this.element.contains(document.activeElement) ? document.activeElement.dataset.key : undefined;

    // 輪：見出し・つなぐ線・真ん中の札・6つの席
    const head = el('div', 'bot-nest-head');
    const mark = el('span', 'bot-nest-mark', '↗');
    mark.setAttribute('aria-hidden', 'true');
    head.title = 'Grok Bot（外のアプリ）。席を押すと選び、ダブルクリックで Grok Bot アプリのそのボットのチャットが開きます。上の相棒（ブラウザの中の AI）とは別です';
    head.append(mark, el('span', 'bot-nest-head-text', 'Grok Bot'));
    const lines = svgEl('svg', { class: 'bot-nest-lines', viewBox: '-0.866 -1 1.732 2', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    lines.append(svgEl('polygon', { points: '0,-1 0.866,-0.5 0.866,0.5 0,1 -0.866,0.5 -0.866,-0.5' }));
    const center = this.centerNode(n);
    const cells: HTMLElement[] = [];
    const names = seatNames(seats);
    let firstEmpty = true;
    for (let i = 0; i < MAX_DOCK_BOTS; i++) {
      const seat = seats[i];
      if (seat) cells.push(this.seat(seat, i, n, names.get(seat.bot.id) ?? { role: seat.bot.name }));
      else {
        cells.push(this.emptySeat(i, ready, firstEmpty));
        firstEmpty = false;
      }
    }
    this.gear.disabled = !ready;
    if (this.isMerged) for (const cell of cells) cell.inert = true; // 合体のあいだ、寄せて薄くした席は押せない
    this.ring.replaceChildren(lines, center, ...cells, this.core, head, this.gear);

    this.renderDetail();

    // みんなに聞く（依頼の小窓を宛て先「みんな」で開く。S3.6：送り方は ⚙ の「みんなに聞く」で、A 1体ずつの案内〔既定〕／B 代表にまとめて）
    this.all.replaceChildren(el('span', 'bot-nest-all-text', `⬡ みんなに聞く（${n}体）`));
    this.all.disabled = !ready || n === 0;
    this.all.title = n === 0 ? '席にボットを置くと使えます' : '依頼の小窓を開きます。同じ問いを席のボットみんなに聞きます（送り方は ⚙ の「みんなに聞く」で：1体ずつ順に案内／代表にまとめて）';
    this.all.setAttribute('aria-label', `みんなに聞く（${n}体）。依頼の小窓を開きます`);
    this.all.setAttribute('aria-haspopup', 'dialog');
    this.team.disabled = !ready;
    this.team.setAttribute('aria-label', 'グループに頼む。5つのグループから選びます');

    this.syncMergeRow();
    if (active) this.element.querySelector<HTMLElement>(`[data-key="${CSS.escape(active)}"]`)?.focus({ preventScroll: true });
    this.queueMeasure();
  }

  // 真ん中。旗 "1" が無ければ、今までの札のまま
  private centerNode(n: number): HTMLElement {
    const shell = this.shellInput();
    if (!shell || shell.merged) {
      const center = el('div', 'bot-nest-center');
      const plate = svgEl('svg', { class: 'bot-nest-center-plate', viewBox: '0 0 100 40', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
      plate.append(svgEl('polygon', { points: '12,1 88,1 99,20 88,39 12,39 1,20' }));
      center.append(plate, el('span', 'bot-nest-center-title', 'Grok-Bot の巣'), el('span', 'bot-nest-center-count', `${n}体`));
      center.title =
        n >= MAX_DOCK_BOTS
          ? `席は ${MAX_DOCK_BOTS} つです。どれかを右クリック →「右下から外す」と、ほかのボットを置けます（外しても台帳には残ります）`
          : `席は ${MAX_DOCK_BOTS} つ（あと ${MAX_DOCK_BOTS - n}）`;
      return center;
    }
    return shellButton(shellView(shell), () => this.host.cards());
  }

  private shellInput(): ShellInput | null {
    if (!cardsStageOn('1')) return null;
    const dev = readCardsDevState();
    const counts = shownCounts();
    const stage8 = cardsStageOn('8');
    const snap = stage8 ? readArrived() : null;
    const real: ShellInput = {
      open: cardsStageOn('3') ? readCardsOpen() : this.view.cardsOpen === true,
      merged: this.isMerged || dev.merged === true,
      replies: counts.replies,
      drafts: counts.drafts,
      arrived: snap ? snap.k : 0,
      ...(snap && snap.n > 0 ? { arrivedOf: snap.n } : {}),
      seats: this.view.seats.length,
      error: this.view.seats.some((seat) => seat.state === 'botError'),
      size: this.shellPx,
    };
    return resolveShellInput(real, shellDevForArrived(dev, stage8));
  }

  // 合体のあいだ、段 1 なら下の行が開閉になる（殻は隠す。焦点が殻にあれば行へ）
  private syncMergeRow() {
    const shell = this.shellInput();
    const toggle = !!shell?.merged;
    this.mergeToggle.hidden = !toggle;
    this.mergeText.hidden = toggle;
    if (!shell || !toggle) return;
    if (shell.merged && !this.isMerged) {
      this.element.dataset.merge = 'on';
      this.mergeBar.hidden = false;
    }
    const label = shellView(shell).label;
    this.mergeToggle.textContent = mergeRowLabel(shell);
    this.mergeToggle.title = label;
    this.mergeToggle.setAttribute('aria-label', label);
  }

  private queueMeasure() {
    if (!cardsStageOn('1') || readCardsDevState().size) return;
    requestAnimationFrame(() => {
      const height = this.ring.clientHeight;
      if (!height) return;
      const next = shellSize(height);
      if (next === this.shellPx) return;
      this.shellPx = next;
      this.render(this.view);
    });
  }

  // 選んだ印と説明だけ変える（席は描き直さない。ダブルクリックの2回目が同じボタンに届くように）
  select(id: string | null) {
    this.view = { ...this.view, selected: id };
    for (const b of this.ring.querySelectorAll<HTMLElement>('.bot-nest-seat[data-bot]')) b.setAttribute('aria-pressed', String(b.dataset.bot === id));
    this.renderDetail();
  }

  // 席の場所（メニュー・頼む文の欄を出す所）。いなければ巣の上のあたり
  near(id: string): At {
    const b = this.ring.querySelector<HTMLElement>(`.bot-nest-seat[data-bot="${CSS.escape(id)}"]`);
    if (b) return this.at(b);
    const rect = this.element.getBoundingClientRect();
    return rect.width ? { x: rect.left, y: rect.top } : { x: window.innerWidth / 2 - 120, y: window.innerHeight - 160 };
  }

  // ---------- 内側 ----------

  private at(node: HTMLElement): At {
    const rect = node.getBoundingClientRect();
    return { x: rect.left, y: rect.top };
  }

  // 座っている席（i：0 から数えた席）
  private seat(seat: BotNestSeat, i: number, count: number, name: SeatName): HTMLElement {
    const { bot, state } = seat;
    const counts = countsText(seat);
    const b = el('button', 'bot-nest-seat');
    b.type = 'button';
    b.dataset.seat = String(i + 1);
    b.dataset.bot = bot.id;
    b.dataset.key = `bot:${bot.id}`;
    b.dataset.state = state;
    const overdue = (seat.overdue ?? 0) > 0;
    if (overdue) b.dataset.overdue = 'true'; // 知らせの期限を過ぎた依頼がある（R8。赤の点線）
    if (seat.unread > 0) b.dataset.glow = 'true'; // 返事が届いた（R8。光る。押すとその返事へ・読んだら消える）
    b.setAttribute('aria-pressed', String(this.view.selected === bot.id));
    const role = bot.role ? `${bot.role.name}（${roleShapeLabel(bot.role.shape)}）の` : '役なしの';
    b.setAttribute('aria-label', `席${i + 1}：${role}Grok Bot「${bot.name}」（${botFullStateLabel(state)}${counts}）。押すと選ぶ。ダブルクリックでアプリのチャットを開く。右クリックか Shift+F10 でメニュー`);
    // マウスを乗せるとボットの名前
    b.title = `${bot.name}\n席${i + 1}・${bot.role ? `役：${bot.role.name}` : '役なし'}・${botFullStateLabel(state)}${counts}\n${botFullStateHint(state)}\n押すと選ぶ・ダブルクリックでアプリを開く・右クリックでメニュー`;
    const box = el('span', 'bot-nest-facebox');
    const svg = svgEl('svg', { viewBox: VIEW_BOX, 'aria-hidden': 'true' });
    drawSeatFace(svg, bot, state, `bot-nest-clip-${bot.id}`);
    box.append(svg);
    // 右上：まだ読んでいない数。左下：リンクなし「?」・アプリなし「×」・エラー「!」・待っている数（遅れていれば札の色）
    if (seat.unread > 0) box.append(el('span', 'bot-nest-tag', small(seat.unread)));
    const off = state === 'noLink' || state === 'noApp';
    const mark = off ? (state === 'noLink' ? '?' : '×') : state === 'botError' ? '!' : seat.waiting > 0 ? small(seat.waiting) : '';
    if (mark) {
      const badge = el('span', 'bot-nest-badge', mark);
      badge.dataset.kind = off ? 'off' : state === 'botError' ? 'alert' : overdue ? 'overdue' : state === 'late' ? 'late' : 'wait';
      box.append(badge);
    }
    b.append(box, nameLabel(name));
    // 1回目で選び、2回目（ダブルクリック）でアプリを開く。キーボードの Enter・Space は detail が 0 なので選ぶだけ
    b.addEventListener('click', (e) => {
      if (e.detail === 2) this.host.open(bot.id);
      else if (e.detail < 2) this.host.select(bot.id);
    });
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.host.menu(bot.id, { x: e.clientX, y: e.clientY }, false);
    });
    b.addEventListener('keydown', (e) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        // Alt+← →：前の席へ／次の席へ
        e.preventDefault();
        const to = i + (e.key === 'ArrowLeft' ? -1 : 1);
        if (to >= 0 && to < count) this.host.move(bot.id, to);
      } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        this.host.menu(bot.id, this.at(b), true);
      }
    });
    return b;
  }

  // 空いた席：点線の六角形と ＋。Tab で止まるのは最初の空いた席だけ（どれを押しても同じ「置く」のメニュー）
  private emptySeat(i: number, ready: boolean, first: boolean): HTMLElement {
    const b = el('button', 'bot-nest-seat empty');
    b.type = 'button';
    b.dataset.seat = String(i + 1);
    b.dataset.key = `empty:${i + 1}`;
    b.disabled = !ready;
    b.tabIndex = first ? 0 : -1;
    b.setAttribute('aria-haspopup', 'menu');
    b.setAttribute('aria-label', `空いた席${i + 1}：Grok Bot を置く`);
    b.title = ready ? `空いた席${i + 1}。押すと Grok Bot を置けます（台帳のボット・新しいボット）` : 'ボットの台帳を読み込んでいます';
    const box = el('span', 'bot-nest-facebox');
    const svg = svgEl('svg', { viewBox: VIEW_BOX, 'aria-hidden': 'true' });
    svg.append(svgEl('polygon', { class: 'bot-nest-empty-plate', points: hexCorners(0, 0, 18) }), svgText({ x: 0, y: 0.5 }, '+', 'bot-nest-plus'));
    box.append(svg);
    b.append(box, el('span', 'bot-nest-name', `席${i + 1}`));
    const add = () => this.host.add(this.at(b));
    b.addEventListener('click', add);
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!b.disabled) add();
    });
    return b;
  }

  // 輪の下：選んだ子の説明と「この子に頼む」。選んでいなければ、使い方か「置けない」わけ
  private renderDetail() {
    const { seats, selected } = this.view;
    const seat = selected ? seats.find((s) => s.bot.id === selected) : undefined;
    const activeKey = document.activeElement instanceof HTMLElement && this.detail.contains(document.activeElement) ? document.activeElement.dataset.key : undefined;
    if (!seat) {
      const n = seats.length;
      const hint =
        n === 0
          ? '空いた席の ＋ から Grok Bot を置けます（6体まで）'
          : n >= MAX_DOCK_BOTS
            ? `${MAX_DOCK_BOTS} 体まで座れます。替えるときは、どれかを右クリック →「右下から外す」（台帳には残ります）`
            : '席を押すと、その子の説明と「この子に頼む」が出ます。ダブルクリックで Grok Bot アプリを開きます';
      this.detail.dataset.chosen = 'false';
      this.detail.replaceChildren(el('div', 'bot-nest-hint', hint));
      return;
    }
    const { bot } = seat;
    const index = seats.indexOf(seat);
    const icon = el('span', 'bot-nest-detail-icon');
    const svg = svgEl('svg', { viewBox: VIEW_BOX, 'aria-hidden': 'true' });
    drawSeatFace(svg, bot, seat.state, `bot-nest-detail-clip-${bot.id}`);
    icon.append(svg);
    const text = el('div', 'bot-nest-detail-text');
    const name = bot.role ? `${bot.role.name}（${bot.name}）` : bot.name;
    const blurb = roleBlurb(bot.role);
    const nameLine = el('div', 'bot-nest-detail-name', name);
    nameLine.title = `席${index + 1}：${name}`;
    const blurbLine = el('div', 'bot-nest-detail-blurb', blurb);
    blurbLine.title = blurb;
    text.append(nameLine, blurbLine);
    const ask = el('button', 'bot-nest-ask-one', 'この子に頼む');
    ask.type = 'button';
    ask.dataset.key = 'ask-one';
    // 依頼の text の頭には、この子の役が入る（S3.4。役なしなら何も入らない）
    const roleNote = bot.role ? `（依頼の頭に役「${bot.role.name}」が入ります）` : '';
    ask.title = bot.agentId ? `依頼の小窓を開きます。「${bot.name}」に頼む文を書いて、依頼にしてコピーし、Grok Bot アプリを開きます${roleNote}` : `「${bot.name}」にはリンクがまだありません。右クリック →「リンクを貼る…」`;
    ask.setAttribute('aria-label', `この子に頼む：「${bot.name}」への依頼の小窓を開く`);
    ask.setAttribute('aria-haspopup', 'dialog');
    ask.addEventListener('click', () => this.host.askOne(bot.id, this.at(ask)));
    this.detail.dataset.chosen = 'true';
    this.detail.replaceChildren(icon, text, ask);
    if (activeKey) this.detail.querySelector<HTMLElement>(`[data-key="${CSS.escape(activeKey)}"]`)?.focus({ preventScroll: true });
  }
}
