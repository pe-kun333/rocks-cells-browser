// 段 TA2・TA3：カードの右クリックの「型を足す…」の先の、型の段（計画書 docs/plan-comment-board-templates.md）
//   段の中身は純粋な関数（memo-card-board-menu.ts の templateTierEntries）。配線（memo-board-tab.ts）は字面で確かめる
//   パネルを通した動き（段の位置・出してすぐの押しの守り・六角での置き場）は、開発の画面と Windows の確かめ
import { readFileSync } from 'node:fs';
import { unwrapT } from './source-text';
import { describe, expect, it } from 'vitest';
import type { MenuEntry } from '../src/panels/cell-menu';
import { TEMPLATE_ADD_LABEL, TEMPLATE_DELETE_LABEL, TEMPLATE_HOLE_HINT, TEMPLATE_NONE_NOTE, templateDeleteEntries, templateMakeLabel, templateTierEntries, type TemplateTierInput } from '../src/memo-card-board-menu';
import { saveNewTemplate, templateAutoName } from '../src/memo-card-template-store';
import type { CardTemplate } from '../src/memo-card-templates';

const tab = unwrapT(readFileSync(new URL('../src/app/memo-board-tab.ts', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const member = (name: string) => {
  const start = tab.indexOf(`\n  private ${name}(`) >= 0 ? tab.indexOf(`\n  private ${name}(`) : tab.indexOf(`\n  private async ${name}(`);
  if (start < 0) throw new Error(`${name} が無い`);
  const end = tab.indexOf('\n  }\n', start);
  return tab.slice(start, end);
};

const tpl = (id: string, over: Partial<CardTemplate> = {}): CardTemplate => ({
  version: 1,
  id,
  name: `型${id}`,
  folder: '議論',
  mode: 'snapshot',
  cards: [
    { key: 'k0', title: '題 1', body: '', tags: [], dx: 0, dy: 0 },
    { key: 'k1', title: '題 2', body: '', tags: [], dx: 210, dy: 0 },
  ],
  links: [],
  ...over,
});
const input = (over: Partial<TemplateTierInput> = {}): TemplateTierInput => ({ heading: '「題」に型を足す', templates: [], skipped: 0, existing: 0, maker: null, erase: null, back: () => undefined, pick: () => undefined, ...over });
const shape = (es: readonly MenuEntry[]) =>
  es.map((e) => (e === 'sep' ? '区切り' : 'section' in e ? `[${e.section}]` : 'row' in e ? `行:${e.row}` : 'note' in e ? `囲み:${e.note}` : 'label' in e ? `${e.disabled ? '×' : ''}${e.label}${e.hint ? `〈${e.hint}〉` : ''}` : '?'));

describe('型の段の中身（templateTierEntries）', () => {
  it('並び：← 戻る → 見出し → フォルダの見出しと型の行（フォルダの順は決まった順。字は道具の列の「型を貼る ▾」と同じ）', () => {
    const es = templateTierEntries(input({ templates: [tpl('b', { folder: '計画', mode: 'skeleton' }), tpl('a')] }));
    expect(shape(es)).toEqual(['← 戻る', '[「題」に型を足す]', '[議論]', '型a（2枚）', '[計画]', '型b（2枚・骨組み）']);
  });
  it('型の行を押すと pick にその型が渡る。← 戻る は back', () => {
    const calls: string[] = [];
    const es = templateTierEntries(input({ templates: [tpl('a')], back: () => calls.push('back'), pick: (t) => calls.push(`pick:${t.id}`) }));
    for (const e of es) if (e !== 'sep' && 'label' in e) e.run?.();
    expect(calls).toEqual(['back', 'pick:a']);
  });
  it('入りきらない型と、空欄のある穴あきの型は押せない（小さい字に理由）。空欄の無い穴あきの型は押せる', () => {
    const hole = tpl('h', { mode: 'hole', cards: [{ key: 'k0', title: '{{テーマ}}を見る', body: '', tags: [], dx: 0, dy: 0 }, { key: 'k1', title: '題', body: '', tags: [], dx: 210, dy: 0 }] });
    const plain = tpl('p', { mode: 'hole' });
    expect(shape(templateTierEntries(input({ templates: [hole, plain] }))).slice(3)).toEqual([`×型h（2枚・穴あき）〈${TEMPLATE_HOLE_HINT}〉`, '型p（2枚・穴あき）']);
    expect(shape(templateTierEntries(input({ templates: [tpl('a')], existing: 299 }))).slice(3)).toEqual(['×型a（2枚）〈入りきりません〉']);
  });
  it('型が 0 件のときは「まだ型がありません」（道具の列の案内は付けない）。読めない型だけなら、その数', () => {
    expect(shape(templateTierEntries(input()))).toEqual(['← 戻る', '[「題」に型を足す]', `囲み:${TEMPLATE_NONE_NOTE}`]);
    expect(shape(templateTierEntries(input({ skipped: 2 })))).toEqual(['← 戻る', '[「題」に型を足す]', '囲み:読める型がありません（読めない型が 2 件あります）']);
    expect(shape(templateTierEntries(input({ templates: [tpl('a')], skipped: 1 }))).at(-1)).toBe('囲み:読めない型が 1 件あります（出していません）');
  });
  it('いちばん下の「型にする」の行：maker があるときだけ。［そのまま］［骨組み］は押すと閉じる', () => {
    expect(shape(templateTierEntries(input({ templates: [tpl('a')] }))).some((s) => s.startsWith('行:'))).toBe(false);
    const made: string[] = [];
    const es = templateTierEntries(input({ templates: [tpl('a')], maker: { label: '選んだ3枚を型にする', make: (mode) => made.push(mode) } }));
    const row = es.at(-1);
    if (!row || row === 'sep' || !('row' in row)) throw new Error('行が無い');
    expect(row.row).toBe('選んだ3枚を型にする');
    expect(row.buttons.map((b) => ({ label: b.label, close: b.close }))).toEqual([{ label: 'そのまま', close: true }, { label: '骨組み', close: true }]);
    for (const b of row.buttons) b.run();
    expect(made).toEqual(['snapshot', 'skeleton']);
  });
  it('押したカードがもう無いときは、そのことだけを出す', () => {
    expect(shape(templateTierEntries(input({ gone: true, templates: [tpl('a')] })))).toEqual(['[このカードは、もうありません]']);
  });
});

describe('型の段の配線（memo-board-tab.ts の字面）', () => {
  it('編集の行の［型を足す…］は、型の段を開く。← 戻る はカードの段を開き直す', () => {
    expect(TEMPLATE_ADD_LABEL).toBe('型を足す…');
    expect(tab).toContain("template: (reply) => void this.openTemplateTier({ kind: 'card', id: reply.id }, { x, y }, () => this.openCardMenu(id, x, y, from)),");
  });
  it('一覧を読んだあと、隠れた・メモが替わった・メニューが閉じた・別のメニューになった・段が替わったなら、何もしない', () => {
    const open = member('openTemplateTier');
    const guard = 'if (this.hidden || this.memoId !== memoId || menu.isOpen !== wasOpen || menu.token() !== token || this.menuSeq !== seq) return;';
    expect(open).toContain(guard);
    expect(open.indexOf('await hook.list()')).toBeLessThan(open.indexOf(guard));
    expect(open.indexOf(guard)).toBeLessThan(open.indexOf('this.replaceMenu('));
    expect(open).toContain('if (wasOpen) this.replaceMenu(entries);'); // 閉じているときに呼ばれたら（消す段の「← 戻る」）、同じ所に開く
    expect(open).toContain('menu.open(at.x, at.y, entries);');
    expect(open.indexOf('b.textContent === TEMPLATE_ADD_LABEL')).toBeLessThan(open.indexOf('this.replaceMenu(')); // 押したボタンの高さは、替える前に測る
    expect(open).toContain('this.settleTier(menu, top);');
  });
  it('段を出してすぐの押しは受けない（受け口は 1 本だけ。getMenu の中には書かない）', () => {
    const settle = member('settleTier');
    expect(settle).toContain('this.tierAt = Date.now();');
    expect(settle).toContain('if (Date.now() - this.tierAt >= TIER_GUARD_MS) return;');
    expect(tab.split("menu.node.addEventListener(\n        'click',").length - 1).toBe(1);
    expect(tab).toContain('const TIER_GUARD_MS = 400;');
  });
  it('型の行を押したとき：開いている欄や確かめがあれば、何も閉じずに一言で止める（空の足す欄だけなら進む）', () => {
    const pick = member('pickTemplate');
    expect(pick).toContain('if (!this.pasteFree()) {');
    expect(pick).toContain("this.flash('開いている欄や確かめを閉じてから型を足してください', 'info');");
    expect(pick).not.toContain('closeCompose(');
    expect(member('pasteFree')).toContain('this.tidyBar.hidden && this.linkFrom === null && this.templateKey === null && !this.fillOpen && canReturnDraft(this.composing, this.composeText.value)');
  });
});

// ---------- 段 TA3：型の段のいちばん下の「型にする」 ----------

describe('「型にする」の行の名前と、自動の名前（TA3）', () => {
  it('選んだ組か、このボードの全部。枚数は空白なしで書く。2〜30 枚の外では行を出さない', () => {
    expect(templateMakeLabel('selected', 3)).toBe('選んだ3枚を型にする');
    expect(templateMakeLabel('board', 6)).toBe('このボードの6枚を型にする');
    expect(templateMakeLabel('board', 1)).toBeNull();
    expect(templateMakeLabel('selected', 31)).toBeNull();
    expect(templateMakeLabel('board', 30)).toBe('このボードの30枚を型にする');
  });
  it('名前は、元の文の最初の空でない行だけ（40 字まで）。空なら「無題の型」', () => {
    expect(templateAutoName('ハードウェアの部分では\n短期的には')).toBe('ハードウェアの部分では');
    expect(templateAutoName('\n\n  二行目から  \n三行目')).toBe('二行目から');
    expect(templateAutoName('')).toBe('無題の型');
    expect(templateAutoName(undefined)).toBe('無題の型');
    expect([...templateAutoName('あ'.repeat(60))]).toHaveLength(40);
  });
});

describe('番号つきの保存（saveNewTemplate の uniqueName。TA3）', () => {
  const memory = () => {
    const files = new Map<string, unknown>();
    const io = {
      read: async (name: string) => (files.has(name) ? ({ status: 'ok', value: structuredClone(files.get(name)) } as const) : ({ status: 'missing' } as const)),
      write: async (name: string, value: unknown) => {
        files.set(name, structuredClone(value));
        return true;
      },
    };
    return { files, io };
  };
  it('同じ名前の型がもうあれば「名前 (2)」「名前 (3)」。付いた名前は、返る一覧の最後の型', async () => {
    const { io } = memory();
    const a = await saveNewTemplate(io, tpl('t1', { name: '問い' }), { uniqueName: true });
    const b = await saveNewTemplate(io, tpl('t2', { name: '問い' }), { uniqueName: true });
    const c = await saveNewTemplate(io, tpl('t3', { name: '問い' }), { uniqueName: true });
    if (!a.ok || !b.ok || !c.ok) throw new Error('保存できない');
    expect(c.templates.map((t) => t.name)).toEqual(['問い', '問い (2)', '問い (3)']);
    expect(c.count).toBe(3);
  });
  it('既定（uniqueName 無し）は今までどおり、同じ名前でもそのまま足す', async () => {
    const { io } = memory();
    await saveNewTemplate(io, tpl('t1', { name: '問い' }));
    const b = await saveNewTemplate(io, tpl('t2', { name: '問い' }));
    if (!b.ok) throw new Error('保存できない');
    expect(b.templates.map((t) => t.name)).toEqual(['問い', '問い']);
  });
});

describe('「型にする」の配線（字面。TA3）', () => {
  const pane = unwrapT(readFileSync(new URL('../src/app/memo-pane.ts', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  it('範囲：押したカードが 2 枚以上の選びの中なら選んだ組。そうでなければ、描いている全部。保存の口が無ければ行を出さない', () => {
    const open = member('openTemplateTier');
    expect(open).toContain("const scope = picked.length >= 2 && (cardId === null || picked.includes(cardId)) ? 'selected' : 'board';"); // 空きから（cardId が null。TA5）は、2 枚以上選んでいれば選んだ組
    expect(open).toContain("const makeIds = scope === 'selected' ? picked : this.faces.map((f) => f.id);");
    expect(open).toContain('const makeLabel = hook.save && (reply || cardId === null) ? templateMakeLabel(scope, makeIds.length) : null;');
    expect(open).toContain("const nameFrom = cardId === null ? oldestCardText(replies, makeIds) : (reply?.text ?? '');");
  });
  it('登録は、今の位置の差をそのまま渡すだけ。書く欄・選び・六角の守り・小窓の道には触らない', () => {
    const make = member('makeTemplate');
    expect(make).toContain('hook.save([...ids], templateOffsets(ids, this.pos) ?? {}, { name: nameFrom, mode });');
    for (const s of ['closeCompose(', 'openTemplate(', "this.shape === 'hex'", 'setSelected(']) expect(make, s).not.toContain(s);
  });
  it('登録の一言は、あとの位置の保存の成功で消さない', () => {
    expect(tab).toContain("      this.flash(text, ok ? 'info' : 'warn');\n      this.noticeAt = Date.now();");
  });
  it('下の面：ボードが見ているメモから作る。保存の間の 2 回目は受けない。番号つきで保存し、結果はボードへだけ返す', () => {
    const start = pane.indexOf('  async function saveTplFromBoard(');
    const body = pane.slice(start, pane.indexOf('\n  async function saveTplDialog()', start));
    expect(body.indexOf('if (tplSaving) return;')).toBeLessThan(body.indexOf('tplSource(true)'));
    expect(body.indexOf('buildTemplateFromCards(')).toBeLessThan(body.indexOf('await saveNewTemplate('));
    expect(body).toContain("folder: 'その他'");
    expect(body).toContain('saveNewTemplate(templateIo, built.template, { uniqueName: true })');
    expect(body).not.toContain('say(');
    expect(pane).toContain('save: (ids, offsets, opts) => void saveTplFromBoard(ids, offsets, opts),');
  });
});

// ---------- 段 TA8：型の段の「型を消す…」 ----------

describe('型を消す段（TA8）', () => {
  it('型の段のいちばん下に［型を消す…］（押しても閉じない）。型が 0 件・口が無いときは出さない', () => {
    let opened = 0;
    const es = templateTierEntries(input({ templates: [tpl('a')], erase: () => (opened += 1) }));
    const row = es.at(-1);
    if (!row || row === 'sep' || !('row' in row)) throw new Error('行が無い');
    expect(row.buttons.map((b) => ({ label: b.label, close: b.close }))).toEqual([{ label: TEMPLATE_DELETE_LABEL, close: false }]);
    row.buttons[0].run();
    expect(opened).toBe(1);
    expect(shape(templateTierEntries(input({ erase: () => undefined }))).some((s) => s.startsWith('行:'))).toBe(false);
    expect(shape(templateTierEntries(input({ templates: [tpl('a')] }))).some((s) => s.startsWith('行:'))).toBe(false);
  });
  it('消す段：← 戻る → 見出し → フォルダごとに、型の行と［削除］（二度押し）', () => {
    const calls: string[] = [];
    const es = templateDeleteEntries({ templates: [tpl('b', { folder: '計画' }), tpl('a')], back: () => calls.push('back'), remove: (t) => calls.push(`remove:${t.id}`) });
    expect(shape(es)).toEqual(['← 戻る', '[型を消す]', '[議論]', '行:型a（2枚）', '[計画]', '行:型b（2枚）']);
    const row = es[3];
    if (row === 'sep' || !('row' in row)) throw new Error('行が無い');
    expect(row.buttons.map((b) => ({ label: b.label, confirm: b.confirm }))).toEqual([{ label: '削除', confirm: 'もう一度押すと削除' }]);
    row.buttons[0].run();
    expect(calls).toEqual(['remove:a']);
    expect(shape(templateDeleteEntries({ templates: [], back: () => undefined, remove: () => undefined }))).toEqual(['← 戻る', '[型を消す]', `囲み:${TEMPLATE_NONE_NOTE}`]);
  });
  it('配線：消す段も、一覧を読んだあとの守りを通す。消したら同じ段を読み直す。← 戻る は型の段へ', () => {
    const open = member('openDeleteTier');
    const guard = 'if (this.hidden || this.memoId !== memoId || menu.isOpen !== wasOpen || menu.token() !== token || this.menuSeq !== seq) return;';
    expect(open.indexOf('await hook.list()')).toBeLessThan(open.indexOf(guard));
    expect(open).toContain('remove: (t) => void hook.remove?.(t.id, t.name).then(() => this.openDeleteTier(back))');
    expect(member('openTemplateTier')).toContain('erase: hook.remove ? () => void this.openDeleteTier(() => void this.openTemplateTier(from, at, back)) : null,');
  });
});
