// みんなに聞く（第3段 S3.6。docs/bot-cells/plan-s3-nest.md §5.1）
//   ・A 1体ずつ（既定）：同じ問いから、巣の席の数だけ依頼を作る（requestId は別々、pending.json の group は同じ番号）。
//     聞く順は席の順で、役のある席から（役の無い席のボットは「役なし」で聞く）。リンクの無い席は飛ばす（アプリを開けない）
//   ・B 代表にまとめて（設定の欄で切り替え）：代表の1体に1つの依頼。text に全員の役を並べる（bot-replies.ts の buildAskLeadText）。
//     代表が台帳から消えている・リンクが無いときは A に戻して、わけを知らせる
//   ・送るのは BotSender（bot-send.ts）だけ。今は ClipboardSender（右では AskLeftSender → 左の ClipboardSender）なので、
//     「組を作る」→「1席ぶんを送る」→（使う人が貼って送り、「次」を押す）→「次の席へ進む」→「1席ぶんを送る」… と、依頼の小窓が1体ずつ案内する。
//     直接送る webhook（依頼の小窓 v2・R12）のときは、案内を飛ばして sendAskAllAtOnce で席の数だけ一度に送る（3つを別の関数にしてあるのはこのため）
//   ・依頼は「1席ぶんを送る」ときに1つずつ作る（左の createRequest）。途中でやめたら、作った分だけが残る（まだの席の依頼は作らない）
//   ・ここは DOM を知らない（見せ方は panels/bot-request-form.ts）。check も知らない（作るのは左）
import type { BotAskAll } from './bots';
import { type BotRole, type BotRoleGroup, roleGroupLabel } from './bot-roles';
import { type BotDeliverTo, buildAskLeadText } from './bot-replies';
import { type BotSender, type DraftAttach, draftFromForm, type DraftRequest, type SendAfter, type SendResult } from './bot-send';
import { type BotTeams, teamPresetRole } from './bot-teams';

// 宛て先の1体（依頼の小窓の BotRequestTarget と同じ形）
export interface AskAllTarget {
  id: string;
  name: string;
  linked: boolean; // リンク（エージェントの id）がある
  role?: BotRole;
  seat?: number; // 巣の席（1〜6）。巣に置いていなければ無し
}

// 巣の設定のうち、みんなに聞くの分（台帳の nest。代表の id は台帳から消えていても届く）
export interface AskAllNest {
  askAll?: BotAskAll;
  lead?: string;
}

export interface AskAllPlan<T extends AskAllTarget = AskAllTarget> {
  way: BotAskAll; // 実際の送り方（B が使えないときは each）
  seats: T[]; // A：聞く順（役のある席 → 役の無い席。それぞれ席の順。リンクのある席だけ）
  skipped: T[]; // A：リンクが無くて聞けない席（席の順）
  roles: T[]; // B：text に並べる席（席の順。リンクの有無によらず全部）
  lead?: T; // B：代表
  notice?: string; // B にしてあったが A に戻したわけ（知らせる）
}

export const roleNameOf = (t: Pick<AskAllTarget, 'role'>) => t.role?.name ?? '役なし';

// 送り方と聞く順を決める（巣の席だけ。巣に置いていない台帳のボットは聞かない）
//   B の代表：設定で選んだボット（巣の外でもよい）。「決めない」なら席1のボット
export function planAskAll<T extends AskAllTarget>(targets: readonly T[], nest: AskAllNest = {}): AskAllPlan<T> {
  const seated = targets.filter((t) => t.seat).sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
  const linked = seated.filter((t) => t.linked);
  const seats = [...linked.filter((t) => t.role), ...linked.filter((t) => !t.role)];
  const skipped = seated.filter((t) => !t.linked);
  const each = (notice?: string): AskAllPlan<T> => ({ way: 'each', seats, skipped, roles: seated, ...(notice ? { notice } : {}) });
  if (nest.askAll !== 'lead' || !seated.length) return each();
  const lead = nest.lead ? targets.find((t) => t.id === nest.lead) : seated[0];
  if (!lead) return each('B（代表にまとめて）の代表のボットが台帳から消えています。今回は A（1体ずつ）で聞きます（⚙ の「みんなに聞く」で代表を選び直せます）');
  if (!lead.linked) return each(`B（代表にまとめて）の代表「${lead.name}」にはリンクがありません。今回は A（1体ずつ）で聞きます`);
  return { way: 'lead', seats, skipped, roles: seated, lead };
}

// ---------- グループに頼む（G2。docs/plan-bot-groups.md） ----------
//   割り当てた役の順。リンクの無いボットは飛ばす。役の文はグループの役（既定の細かい設定・考え方）。まとめ役には送らない

export interface TeamAsk {
  group: BotRoleGroup;
  label: string;
  seats: AskAllTarget[]; // 聞く順（リンクのある役だけ。役はグループの役。席の番号は入れない）
  skipped: string[]; // リンクが無くて聞けない役（「調査・名前」）
}

export function planTeamAsk(group: BotRoleGroup, teams: BotTeams | null | undefined, bots: readonly { id: string; name: string; agentId?: string }[]): TeamAsk {
  const seats: AskAllTarget[] = [];
  const skipped: string[] = [];
  for (const member of teams?.[group]?.members ?? []) {
    const role = teamPresetRole(member.preset);
    const bot = bots.find((b) => b.id === member.botId);
    if (!role || !bot) continue;
    if (!bot.agentId) skipped.push(`${role.name}・${bot.name}`);
    else seats.push({ id: bot.id, name: bot.name, linked: true, role });
  }
  return { group, label: roleGroupLabel(group), seats, skipped };
}

// ---------- A：組と案内の進み具合 ----------

// 組（A の1回ぶん）。組を作った時点では、依頼はまだ1つも作らない（1席ぶんを送るたびに、左が1つ作る）
export interface AskAllRun<T extends AskAllTarget = AskAllTarget> {
  readonly group: number; // pending.json の group（席の依頼みんなに同じ番号）
  readonly seats: readonly T[]; // 聞く順
  readonly text: string; // 組を作ったときの頼む文・添付・返し先（途中で変えない）
  readonly attach: DraftAttach;
  readonly chatOnly: boolean;
  readonly deliverTo?: BotDeliverTo; // 返し先「六角メモにも届く」（R10。席ごとの依頼みんなに。アプリのチャットだけのときは無い）
  readonly team?: BotRoleGroup; // グループに頼む（G2）。無ければみんなに聞く
  index: number; // 今の席（0 から）
  readonly sent: boolean[]; // 席ごとに、送る部品へ渡せたか
}

// 組の番号：押した時刻の秒（1 以上の整数。左の pending.json は番号の形だけを見る）。同じ秒に2つの組は作らない（使う人が押すときだけ作る）
export const newAskAllGroup = (now = Date.now()) => Math.max(1, Math.floor(now / 1000));

// 組を作る（依頼はまだ作らない）
export function createAskAllRun<T extends AskAllTarget>(seats: readonly T[], text: string, attach: DraftAttach, opts: { chatOnly?: boolean; now?: number; team?: BotRoleGroup; deliverTo?: BotDeliverTo } = {}): AskAllRun<T> {
  return {
    group: newAskAllGroup(opts.now),
    seats: [...seats],
    text: String(text ?? '').trim(),
    attach: { ...attach },
    chatOnly: opts.chatOnly === true,
    ...(opts.chatOnly !== true && opts.deliverTo === 'hex' ? { deliverTo: opts.deliverTo } : {}),
    ...(opts.team ? { team: opts.team } : {}),
    index: 0,
    sent: seats.map(() => false),
  };
}

// 1席ぶんの依頼（その席のボットの役。役の無い席は役なし。席の番号は左が台帳の巣から入れる）
//   グループ（team）のときは、グループの役の文で、席の番号は入れない（seat: 0。左は 0 を「席なし」として扱う）
export function askAllSeatDraft<T extends AskAllTarget>(run: AskAllRun<T>, index = run.index): DraftRequest {
  const target = run.seats[index];
  return draftFromForm(target.id, run.text, run.attach, {
    chatOnly: run.chatOnly,
    ...(run.deliverTo ? { deliverTo: run.deliverTo } : {}),
    role: target.role ?? null,
    group: run.group,
    planned: run.seats.map((s) => s.id),
    ...(run.team ? { team: run.team, plannedRoles: run.seats.map((s) => s.role?.name ?? ''), seat: 0 } : {}),
  });
}

// 1席ぶんを送る（今の席）。渡せたら、その席に送った印を付ける（進むのは nextAskAllSeat）
export async function sendAskAllSeat<T extends AskAllTarget>(run: AskAllRun<T>, sender: BotSender, after?: SendAfter): Promise<{ result: SendResult; req: DraftRequest; target: T }> {
  const target = run.seats[run.index];
  const req = askAllSeatDraft(run);
  const result = await sender.send(req, after);
  if (result.ok) run.sent[run.index] = true;
  return { result, req, target };
}

// 次の席へ進む（今の席を送ってあるときだけ）。進んだ席を返す。最後の席・まだ送っていないときは進まず null
export function nextAskAllSeat<T extends AskAllTarget>(run: AskAllRun<T>): T | null {
  if (!run.sent[run.index] || run.index >= run.seats.length - 1) return null;
  run.index += 1;
  return run.seats[run.index];
}

// 全部の席に送った
export const askAllFinished = (run: AskAllRun) => run.seats.length > 0 && run.sent.every(Boolean);

// webhook「そのまま送る」（依頼の小窓 v2・R12）：案内を飛ばして、残りの席に一度に送る（送れない席があればそこで止まる）。
//   sender は via: 'hook' を付けて送るもの（小窓が包む）。クリップボードは1つしか無いので、コピーで送るときは使わない（使う人が1体ずつ貼る）
export async function sendAskAllAtOnce<T extends AskAllTarget>(run: AskAllRun<T>, sender: BotSender): Promise<SendResult[]> {
  const results: SendResult[] = [];
  for (;;) {
    if (!run.sent[run.index]) {
      const { result } = await sendAskAllSeat(run, sender);
      results.push(result);
      if (!result.ok) break;
    }
    if (!nextAskAllSeat(run)) break;
  }
  return results;
}

// ---------- B：代表にまとめて ----------

// 代表への1つの依頼（text の頭に全員の役。代表自身の役は入れない＝role: null。組の番号は付けない〔1体だけに頼む〕）
export function askLeadDraft<T extends AskAllTarget>(plan: AskAllPlan<T>, text: string, attach: DraftAttach, opts: { chatOnly?: boolean; deliverTo?: BotDeliverTo } = {}): DraftRequest | null {
  if (plan.way !== 'lead' || !plan.lead) return null;
  const joined = buildAskLeadText(text, plan.roles.map((t) => ({ seat: t.seat ?? 0, role: t.role ?? null })));
  return joined ? draftFromForm(plan.lead.id, joined, attach, { chatOnly: opts.chatOnly, role: null, ...(opts.deliverTo ? { deliverTo: opts.deliverTo } : {}) }) : null;
}
