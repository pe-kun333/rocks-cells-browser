// 定型の置き場（依頼の小窓 v2・R4a。ui-data\bots\presets.json。形と直し方は bot-presets.ts、計画 docs/bot-cells/plan-request-v2.md §4.1・Q4）
//   ・書くのは左だけ。右と読む画面は写し（relay の bots の presets・botAsk の presets）を見て、使った回数は命令 botPresetUsed で頼む
//   ・ファイルが無ければ、用意した定型（DEFAULT_PRESETS）を書く。版の違うファイルは、用意した定型で動いて書かない（新しい版を消さない）
//   ・押した・取り込んだ定型に、使った時刻と回数を足す（use）。棚から使ったら棚で使った数と、そのときの組も覚える（R4b の入れ替えの声かけ）
//   ・棚（R4b・D10。巣の ⚙ の「定型」タブ）：右の編集は命令 setPresets（edit。数字は左の持ち分のまま混ぜる）、
//     送った依頼から拾うのは命令 presetFromRequest（pick）。1 分おきと読み込んだときに sweep（寿命が切れた・棚で 30 日使わない定型を蔵へ）
//   ・印の数（R9 の当たり／ずれ／宛て先違い）：今ある依頼の印は pending.json にあり、左が一覧の写しの tally（bots.ts の botMarkTally）で数える。
//     presets.json の hits・misses・wrongTo には、pending.json から片づいた依頼（30 日・200 件）の印だけを積む（archiveMarks）。
//     片づいた依頼の印はもう付け外しできないので、戻す必要が無い。写しの数は「積んだ数＋今ある依頼の数」（counts・view）
//   ・鍵らしき文字（R2 の findSecretish）は、定型の文に入れる前に〔鍵1〕に置き換える（生の値をファイルに残さない）
//   ・書くのは 400ms まとめてから（bots.ts の BotStore と同じ）。読み込む前は書かない
import {
  type BotPresets,
  DEFAULT_PRESETS,
  mergePresetEdit,
  newPresetId,
  normalizePresets,
  PRESET_COUNT_MAX,
  PRESET_ID_RE,
  PRESET_TEXT_MAX,
  type PresetMarkCount,
  presetsBrief,
  shelfOf,
  sinkPreset,
} from './bot-presets';
import { type BotMark, findSecretish } from './bot-replies';
import { readData, writeData } from './data';

const FILE = 'bots/presets.json';
const REQUEST_ID_RE = /^hb-[A-Za-z0-9-]{1,60}$/;

const defaults = (): BotPresets => normalizePresets(DEFAULT_PRESETS) ?? { sets: [], presets: [] };

// 定型の文に入れる前に、鍵らしき文字を置き換える（R2・D5。見つからなければそのまま）
const maskSecrets = (text: string) => {
  const found = findSecretish(text);
  return found.count ? found.masked : text;
};

export class BotPresetStore {
  private data: BotPresets = defaults();
  private loaded = false;
  private writable = false; // 版の違うファイルを読んだときは書かない
  private saveTimer = 0;
  private readonly listeners: (() => void)[] = [];

  async load() {
    const saved = await readData<{ version?: unknown }>(FILE);
    if (saved === null) {
      // 無い（か読めない）：用意した定型を書く
      this.data = defaults();
      this.writable = true;
      this.loaded = true;
      this.startReview();
      this.changed();
      return;
    }
    this.writable = saved.version === 1;
    this.data = (this.writable ? normalizePresets(saved) : null) ?? defaults();
    this.loaded = true;
    if (!this.sweep() && !this.startReview()) this.emit();
  }

  get ready() {
    return this.loaded;
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  // 右と読む画面に送る写し（組・手元・棚。vault：蔵も入れる〔右の棚〕。tally：今ある依頼の印の数〔一覧の写しの tally.presets〕を足す）
  view(opts: { vault?: boolean; tally?: Readonly<Record<string, PresetMarkCount>> } = {}): BotPresets {
    return presetsBrief(this.data, { vault: opts.vault, counts: opts.tally });
  }

  // 定型ごとの印の数（積んだ数＋今ある依頼の数。R9 の botMarkTally の結果を tally に渡す。数え直しはしない）
  counts(tally: Readonly<Record<string, PresetMarkCount>> = {}): Record<string, PresetMarkCount> {
    const out: Record<string, PresetMarkCount> = {};
    for (const p of this.data.presets) {
      const add = Object.hasOwn(tally, p.id) ? tally[p.id] : null;
      out[p.id] = { hits: p.hits + (add?.hits ?? 0), misses: p.misses + (add?.misses ?? 0), wrongTo: p.wrongTo + (add?.wrongTo ?? 0) };
    }
    return out;
  }

  // 定型を使った（小窓で押した・候補を取り込んだ）：回数を 1 足し、時刻を残す。棚の定型なら棚で使った数も足す。
  //   set：そのときの組（知っている組だけ覚える。入れ替えの相手の手元を決める）。知らない id・読み込む前は false
  use(id: unknown, set?: unknown): boolean {
    if (!this.loaded || typeof id !== 'string' || !PRESET_ID_RE.test(id)) return false;
    const preset = this.data.presets.find((p) => p.id === id);
    if (!preset) return false;
    preset.uses = Math.min(PRESET_COUNT_MAX, preset.uses + 1);
    preset.lastUsedAt = new Date().toISOString();
    if (preset.shelf === 'shelf') preset.shelfUses = Math.min(PRESET_COUNT_MAX, (preset.shelfUses ?? 0) + 1);
    if (typeof set === 'string' && this.data.sets.some((s) => s.id === set)) preset.lastSet = set;
    this.changed();
    return true;
  }

  // 組を入れ替える（今の定型に照らして直す。変わらない・形が違うときは false）
  setSets(sets: unknown): boolean {
    return this.replace(normalizePresets({ sets, presets: this.data.presets, review: this.data.review }));
  }

  // 右の棚の編集（命令 setPresets）：組・定型の文・寿命・置き場・並び・棚卸しの覚え。数字は左の持ち分のまま（mergePresetEdit）
  edit(raw: unknown): boolean {
    if (!this.loaded) return false;
    return this.replace(mergePresetEdit(this.data, raw, Date.now(), maskSecrets));
  }

  // 定型を 1 つ足すか、同じ id を置き換える（数字は左の持ち分のまま。置き換えは文・寿命だけ）
  upsertPreset(raw: { id?: string; text: string; life?: unknown; from?: { requestId?: string } }): string | null {
    if (!this.loaded) return null;
    const text = maskSecrets(String(raw.text ?? '')).slice(0, PRESET_TEXT_MAX * 2);
    const old = raw.id ? this.data.presets.find((p) => p.id === raw.id) : undefined;
    const now = Date.now();
    const stamp = new Date(now).toISOString();
    const presets = old
      ? this.data.presets.map((p) => (p.id === old.id ? { ...p, text, life: raw.life ?? p.life, keptAt: stamp } : p))
      : [
          ...this.data.presets,
          {
            id: newPresetId(this.data.presets, now),
            text,
            createdAt: stamp,
            keptAt: stamp,
            ...(raw.from?.requestId && REQUEST_ID_RE.test(raw.from.requestId) ? { from: { requestId: raw.from.requestId } } : {}),
            uses: 0,
            hits: 0,
            misses: 0,
            wrongTo: 0,
            life: raw.life ?? 'forever',
            shelf: 'shelf',
          },
        ];
    const next = normalizePresets({ sets: this.data.sets, presets, review: this.data.review }, now);
    const id = old?.id ?? presets[presets.length - 1].id;
    if (!next?.presets.some((p) => p.id === id)) return null; // 文が空になった・300 を超えた
    this.replace(next);
    return id;
  }

  // 置き場を変える（hand は組 setId の手元の終わりへ。いっぱいなら false）。置き直したので keptAt を今に
  movePreset(id: string, to: 'hand' | 'shelf' | 'vault', setId?: string): boolean {
    if (!this.loaded) return false;
    const next = normalizePresets(this.data) ?? null;
    const p = next?.presets.find((x) => x.id === id);
    if (!next || !p) return false;
    if (to === 'vault') {
      if (!sinkPreset(next, id)) return false;
    } else {
      const set = next.sets.find((s) => s.id === setId);
      for (const s of next.sets) s.hand = s.hand.filter((x) => x !== id);
      if (to === 'hand') {
        if (!set || set.hand.length >= 6) return false;
        set.hand.push(id);
      }
      p.shelf = to;
    }
    p.keptAt = new Date().toISOString();
    return this.replace(normalizePresets(next));
  }

  // 送った依頼から拾う（命令 presetFromRequest）：文を棚に足す。同じ文の定型があれば足さず、蔵にあれば棚へ戻す。
  //   requestId：受け取り箱の依頼から拾ったとき（from に残す）。拾った・戻した定型の id（文が空なら null）
  pick(text: unknown, requestId?: unknown): string | null {
    if (!this.loaded || typeof text !== 'string') return null;
    const clean = normalizePresets({ sets: [], presets: [{ id: 'x', text: maskSecrets(text) }] })?.presets[0]?.text;
    if (!clean) return null;
    const same = this.data.presets.find((p) => p.text === clean);
    if (same) {
      if (same.shelf === 'vault') this.movePreset(same.id, 'shelf');
      return same.id;
    }
    return this.upsertPreset({ text: clean, ...(typeof requestId === 'string' ? { from: { requestId } } : {}) });
  }

  // 寿命が切れた定型と、棚で 30 日使わなかった定型を蔵へ（消さない）。変えたら true（1 分おきと、読み込んだとき）
  sweep(now = Date.now()): boolean {
    if (!this.loaded) return false;
    let moved = false;
    for (const p of [...this.data.presets]) {
      if (p.shelf !== 'vault' && shelfOf(p, now) === 'vault') moved = sinkPreset(this.data, p.id) || moved;
    }
    if (moved) this.changed();
    return moved;
  }

  // pending.json から片づいた依頼（30 日・200 件）の印を、使った定型の数に積む（bots.ts の BotInbox.onPrunedMarks から）。
  //   今ある依頼の印は一覧の写しの tally で数えるので、ここには入れない（同じ印を二度数えない）
  archiveMarks(requests: readonly { mark?: BotMark; presetIds?: readonly string[] }[]): boolean {
    if (!this.loaded) return false;
    let changed = false;
    for (const r of requests) {
      if (!r.mark) continue;
      const field = r.mark === 'hit' ? 'hits' : r.mark === 'miss' ? 'misses' : 'wrongTo';
      for (const id of new Set(r.presetIds ?? [])) {
        const p = this.data.presets.find((x) => x.id === id);
        if (!p) continue; // 消した定型の印は捨てる
        p[field] = Math.min(PRESET_COUNT_MAX, p[field] + 1);
        changed = true;
      }
    }
    if (changed) this.changed();
    return changed;
  }

  // 棚卸しの覚えが無ければ、今を「前の声かけ」にする（初めての月の終わりに声をかける）。変えたら true
  private startReview(): boolean {
    if (this.data.review?.at) return false;
    this.data = { ...this.data, review: { ...this.data.review, at: new Date().toISOString() } };
    this.changed();
    return true;
  }

  private replace(next: BotPresets | null): boolean {
    if (!this.loaded || !next || JSON.stringify(next) === JSON.stringify(this.data)) return false;
    this.data = next;
    this.changed();
    return true;
  }

  private changed() {
    this.emit();
    if (!this.loaded || !this.writable) return;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flush(), 400);
  }

  // 待たずに書く（終わるとき）。書くことが無ければ何もしない
  flush() {
    if (!this.saveTimer) return;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    if (this.loaded && this.writable) void writeData(FILE, { version: 1, sets: this.data.sets, presets: this.data.presets, ...(this.data.review ? { review: this.data.review } : {}) });
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}
