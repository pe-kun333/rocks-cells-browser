// 頼み板の純粋な関数（plan-reader-video の V4a-1）：範囲・名前・送る字幕と料金・答えの読み方・練習モード・間・見出し
import { describe, expect, it } from 'vitest';
import {
  ASK_MAX_LINES,
  ASK_SEND_CAP,
  ASK_TAGS,
  ASK_TECH_MAX,
  ASK_TEXT_MAX,
  PAUSE_MAX_LINES,
  askEstimate,
  askHead,
  askPayload,
  askRangeCells,
  askRangeLabel,
  parseAskLines,
  pauseLines,
  practiceAskLines,
  type AskCell,
  type AskSent,
} from '../src/reader-ask';

// 上の例で使うマスの並び（0 は見出し、1・2 は 0〜20 秒、3 は見出し「本ネタ」、4・5 は 80〜110 秒）
const cells: AskCell[] = [
  { text: 'つかみ', head: true, start: 0, end: 0 },
  { text: 'どうもー', start: 0, end: 10 },
  { text: 'よろしく', start: 10.8, end: 20 },
  { text: '本ネタ', head: true, start: 80, end: 80 },
  { text: 'みかんの話', start: 80, end: 95 },
  { text: 'また  みかん', start: 97, end: 110 },
];

describe('askRangeCells（範囲のマスの番号。小さい順・重なりなし）', () => {
  it('例：chapter・one・all', () => {
    expect(askRangeCells(cells, 'chapter', 5, [])).toEqual([4, 5]);
    expect(askRangeCells(cells, 'chapter', 0, [])).toEqual([1, 2]);
    expect(askRangeCells(cells, 'one', 3, [])).toEqual([4]);
    expect(askRangeCells(cells, 'all', 0, [])).toEqual([1, 2, 4, 5]);
  });

  it('one：範囲外（整数でない番号も）は []。時刻のマスなら [そのマス]。見出しの後ろに時刻のマスが無ければ []', () => {
    expect(askRangeCells(cells, 'one', -1, [])).toEqual([]);
    expect(askRangeCells(cells, 'one', 6, [])).toEqual([]);
    expect(askRangeCells(cells, 'one', 1.5, [])).toEqual([]);
    expect(askRangeCells(cells, 'one', 1, [])).toEqual([1]);
    const tail: AskCell[] = [
      { text: '時刻', start: 0, end: 5 },
      { text: '本ネタ', head: true, start: 5, end: 5 },
    ];
    expect(askRangeCells(tail, 'one', 1, [])).toEqual([]);
    expect(askRangeCells([{ text: '文だけ' }], 'one', 0, [])).toEqual([]);
  });

  it('picked：範囲内の整数で時刻のマスだけ。重なりを除き、小さい順', () => {
    expect(askRangeCells(cells, 'picked', 0, [5, 1, 1, 4])).toEqual([1, 4, 5]);
    expect(askRangeCells(cells, 'picked', 0, [-1, 6, 1.5, 3, 0])).toEqual([]); // 範囲外・整数でない・見出し（0 と 3）は入らない
  });

  it('chapter：見出しが無ければ []。最初の見出しより前は 0 から最初の見出しまで。番号は 0〜の範囲に収める', () => {
    const plain: AskCell[] = [
      { text: 'a', start: 0, end: 1 },
      { text: 'b', start: 1, end: 2 },
    ];
    expect(askRangeCells(plain, 'chapter', 1, [])).toEqual([]);
    const early: AskCell[] = [
      { text: 'a', start: 0, end: 1 },
      { text: '本ネタ', head: true, start: 1, end: 1 },
      { text: 'b', start: 1, end: 2 },
    ];
    expect(askRangeCells(early, 'chapter', 0, [])).toEqual([0]);
    expect(askRangeCells(early, 'chapter', 2, [])).toEqual([2]);
    expect(askRangeCells(cells, 'chapter', 99, [])).toEqual([4, 5]);
    expect(askRangeCells(cells, 'chapter', -5, [])).toEqual([1, 2]);
  });

  it('マスが空なら []（all・chapter・one とも）', () => {
    expect(askRangeCells([], 'all', 0, [])).toEqual([]);
    expect(askRangeCells([], 'chapter', 0, [])).toEqual([]);
    expect(askRangeCells([], 'one', 0, [])).toEqual([]);
  });
});

describe('askRangeLabel（頼み板とカードの範囲の名前）', () => {
  it('例：chapter は見出しの名前と時刻の区切り', () => {
    expect(askRangeLabel(cells, 'chapter', [4, 5])).toBe('本ネタ（1:20〜1:50）');
  });

  it('one は始まりの時刻だけ。picked は数と区切り。all は全体', () => {
    expect(askRangeLabel(cells, 'one', [4])).toBe('今のマス（1:20）');
    expect(askRangeLabel(cells, 'picked', [1, 2])).toBe('選んだ 2 の区間（0:00〜0:20）');
    expect(askRangeLabel(cells, 'all', [1, 2, 4, 5])).toBe('全体（0:00〜1:50）');
  });

  it('indices が空なら範囲の名前そのまま', () => {
    expect(askRangeLabel(cells, 'chapter', [])).toBe('このチャプター');
    expect(askRangeLabel(cells, 'all', [])).toBe('全体');
  });

  it('見出しが無いチャプターは「このチャプター」。長い見出しは 20 字で切って …', () => {
    const plain: AskCell[] = [
      { text: 'a', start: 0, end: 10 },
      { text: 'b', start: 10, end: 20 },
    ];
    expect(askRangeLabel(plain, 'chapter', [0, 1])).toBe('このチャプター（0:00〜0:20）');
    const long: AskCell[] = [
      { text: 'あいうえおかきくけこさしすせそたちつてとなにぬねの', head: true, start: 0, end: 0 },
      { text: 'a', start: 0, end: 10 },
    ];
    expect(askRangeLabel(long, 'chapter', [1])).toBe('あいうえおかきくけこさしすせそたちつてと…（0:00〜0:10）');
  });
});

describe('askPayload（送る字幕）', () => {
  it('例：時刻のマスだけを、indices の順に、送る番号つきで。字数は入れた文の合計', () => {
    const p = askPayload(cells, [4, 5]);
    expect(p.sent).toEqual([
      { n: 0, sec: 80, t: '1:20', text: 'みかんの話' },
      { n: 1, sec: 97, t: '1:37', text: 'また みかん' },
    ]);
    expect(p.chars).toBe(11);
    expect(p.clipped).toBe(false);
  });

  it('見出しと時刻でないマスは入らない', () => {
    expect(askPayload(cells, [0, 1, 3])).toEqual({ sent: [{ n: 0, sec: 0, t: '0:00', text: 'どうもー' }], chars: 4, clipped: false });
  });

  it('上限：足すと cap を超えるところで止めて clipped。1 つ目は超えても入る。ちょうど cap なら止めない', () => {
    const cut = askPayload(cells, [4, 5], 5); // 「みかんの話」（5 字）で上限ちょうど。次の 6 字を足すと超える
    expect(cut.sent.map((s) => s.text)).toEqual(['みかんの話']);
    expect(cut.chars).toBe(5);
    expect(cut.clipped).toBe(true);
    const first = askPayload(cells, [4, 5], 3); // 1 つ目（5 字）は上限 3 を超えても入る
    expect(first.sent.map((s) => s.text)).toEqual(['みかんの話']);
    expect(first.clipped).toBe(true);
    expect(askPayload(cells, [4, 5], 11).clipped).toBe(false);
  });

  it('既定の上限は ASK_SEND_CAP。indices が空なら空', () => {
    expect(ASK_SEND_CAP).toBe(60000);
    expect(askPayload(cells, [4, 5]).clipped).toBe(false);
    expect(askPayload(cells, [])).toEqual({ sent: [], chars: 0, clipped: false });
  });
});

describe('askEstimate（料金の目安）', () => {
  it('入力は 字数 × 1.2 ＋ 1 マス 15 ＋ 900。低い方は書く分 500、高い方は多いときの書く分（600 ＋ 1 マス 40）', () => {
    const r = askEstimate({ chars: 100, sent: [1, 2] }, { input: 2, output: 10 });
    expect(r.input).toBe(1050);
    expect(r.low).toBeCloseTo(0.0071, 9); // (1050 × 2 ＋ 500 × 10) ÷ 100 万
    expect(r.high).toBeCloseTo(0.0089, 9); // 書く分 600 ＋ 2 × 40 = 680。(2100 ＋ 6800) ÷ 100 万
  });

  it('書く分の高い方は 4000 で頭打ち', () => {
    const r = askEstimate({ chars: 0, sent: new Array(200).fill(0) }, { input: 2, output: 10 });
    expect(r.input).toBe(3900);
    expect(r.low).toBeCloseTo(0.0128, 9);
    expect(r.high).toBeCloseTo(0.0478, 9); // 書く分 4000（600 ＋ 8000 を頭打ち）
  });
});

describe('parseAskLines（AI の答えを本文の行にする）', () => {
  const sent = askPayload(cells, [4, 5]).sent;

  it('例：札は〔〕を除く・文は空白をまとめる・使えない行は捨てる・sec の順', () => {
    const got = parseAskLines({ lines: [{ n: 1, tech: '〔天丼〕', text: ' また\nみかん ' }, { n: 0, tech: '', text: 'みかん' }, { n: 9, tech: 'x', text: 'y' }] }, sent);
    expect(got).toEqual([
      { sec: 80, text: 'みかん' },
      { sec: 97, tech: '天丼', text: 'また みかん' },
    ]);
    expect('tech' in got[0]).toBe(false); // 札が空なら tech を付けない
  });

  it('形が崩れた入力（null・文字列・lines が配列でない・空のオブジェクト）は []', () => {
    expect(parseAskLines(null, sent)).toEqual([]);
    expect(parseAskLines('x', sent)).toEqual([]);
    expect(parseAskLines({ lines: 'x' }, sent)).toEqual([]);
    expect(parseAskLines({}, sent)).toEqual([]);
  });

  it('n は送った番号の範囲内の整数だけ（小数・負・範囲外・文字列は捨てる）。文は空白だけ・文字列でないものは捨てる', () => {
    const bad = [
      { n: 0.5, text: 'a' },
      { n: -1, text: 'a' },
      { n: 2, text: 'a' }, // sent は 2 つ（0・1）
      { n: '0', text: 'a' },
      { n: 0, text: '   \n ' },
      { n: 0, text: 5 },
      null,
      'x',
    ];
    expect(parseAskLines({ lines: bad }, sent)).toEqual([]);
    expect(parseAskLines({ lines: [{ n: 1, text: 'ok' }] }, sent)).toEqual([{ sec: 97, text: 'ok' }]);
  });

  it('使える行を ASK_MAX_LINES 行まで（捨てた行は数えない）', () => {
    const sent41: AskSent[] = Array.from({ length: 41 }, (_, i) => ({ n: i, sec: i, t: '', text: '' }));
    const lines41 = Array.from({ length: 41 }, (_, i) => ({ n: i, text: `t${i}` }));
    const got = parseAskLines({ lines: lines41 }, sent41);
    expect(got).toHaveLength(ASK_MAX_LINES);
    expect(got[ASK_MAX_LINES - 1]).toEqual({ sec: 39, text: 't39' }); // 41 行目（n = 40）は捨てる
    const skipFirst = parseAskLines({ lines: [{ n: 99, text: 'x' }, ...lines41] }, sent41);
    expect(skipFirst).toHaveLength(ASK_MAX_LINES);
    expect(skipFirst[ASK_MAX_LINES - 1]).toEqual({ sec: 39, text: 't39' });
  });

  it('文は ASK_TEXT_MAX 字まで。札は 〔〕を除いて ASK_TECH_MAX 字まで（13 字目以降を切る）', () => {
    const long = parseAskLines({ lines: [{ n: 1, text: 'あ'.repeat(130) }] }, sent)[0];
    expect([...long.text]).toHaveLength(ASK_TEXT_MAX);
    const techCut = parseAskLines({ lines: [{ n: 0, tech: 'あいうえおかきくけこさしすせそ', text: 'x' }] }, sent)[0];
    expect(techCut).toEqual({ sec: 80, tech: 'あいうえおかきくけこさし', text: 'x' });
    expect([...techCut.tech ?? ''].length).toBe(ASK_TECH_MAX);
  });

  it('札が文字列でない・〔〕だけ・空なら札なし', () => {
    expect(parseAskLines({ lines: [{ n: 0, tech: 5, text: 'x' }] }, sent)).toEqual([{ sec: 80, text: 'x' }]);
    expect(parseAskLines({ lines: [{ n: 0, tech: '〔〕', text: 'x' }] }, sent)).toEqual([{ sec: 80, text: 'x' }]);
    expect(parseAskLines({ lines: [{ n: 0, tech: '  ', text: 'x' }] }, sent)).toEqual([{ sec: 80, text: 'x' }]);
  });

  it('同じ sec なら元の順。sec の小さい順に並べる', () => {
    const got = parseAskLines({ lines: [{ n: 1, text: 'b' }, { n: 0, text: 'a' }, { n: 1, text: 'c' }] }, sent);
    expect(got).toEqual([
      { sec: 80, text: 'a' },
      { sec: 97, text: 'b' },
      { sec: 97, text: 'c' },
    ]);
  });
});

describe('practiceAskLines（練習モードの決まった返事。料金なし）', () => {
  const eight: AskSent[] = Array.from({ length: 8 }, (_, i) => ({ n: i, sec: i * 10, t: '', text: 'あいうえおかきくけこさしすせそたちつてと' }));

  it('行の数は min(6, 文の数)。sec は文を均等に拾う', () => {
    expect(practiceAskLines('tech', 'comedy', eight).map((l) => l.sec)).toEqual([0, 10, 20, 40, 50, 60]);
    expect(practiceAskLines('tech', 'comedy', eight.slice(0, 3)).map((l) => l.sec)).toEqual([0, 10, 20]);
    expect(practiceAskLines('tech', 'comedy', eight.slice(0, 1)).map((l) => l.sec)).toEqual([0]);
  });

  it('札は回す（comedy の tech は 7 つ。6 行まで）・応用は話の骨組みの札・6 行目で一周', () => {
    expect(practiceAskLines('tech', 'comedy', eight).map((l) => l.tech)).toEqual(['フリ', 'ボケ', 'ツッコミ', '天丼', '回収', 'すかし']);
    expect(practiceAskLines('bones', 'lecture', eight).map((l) => l.tech)).toEqual(['問い', '主張', '根拠', '例', 'まとめ', '問い']);
    expect(practiceAskLines('apply', 'comedy', eight).map((l) => l.tech)).toEqual(['前振り', '重ねる', '期待させる', '裏切る', '回収', '前振り']);
    expect(ASK_TAGS.comedy.bones).toHaveLength(5);
  });

  it('文：決まった形（応用は題。題が空なら「別の話題」）', () => {
    const tech = practiceAskLines('tech', 'comedy', eight.slice(0, 1));
    expect(tech[0].text).toBe('（練習モード）「あいうえおかきくけこさしすせそた」について、ここに説明が入ります');
    const withTopic = practiceAskLines('apply', 'comedy', eight.slice(0, 1), '  ごみ  出し ');
    expect(withTopic[0].text).toBe('（練習モード）「ごみ 出し」の前振りにあたる一文が入ります');
    const noTopic = practiceAskLines('apply', 'comedy', eight.slice(0, 1));
    expect(noTopic[0].text).toBe('（練習モード）「別の話題」の前振りにあたる一文が入ります');
  });

  it('文が空なら []', () => {
    expect(practiceAskLines('tech', 'comedy', [])).toEqual([]);
  });
});

describe('pauseLines（間。AI を使わない）', () => {
  it('例：隣り合うマスの空き（0.8 秒と 2.0 秒）。隣り合わない 2→4 は数えない。sec の順', () => {
    expect(pauseLines(cells, [1, 2, 4, 5])).toEqual([
      { sec: 10.8, tech: '間 0.8秒', text: '「よろしく」の前' },
      { sec: 97, tech: '間 2.0秒', text: '「また みかん」の前' },
    ]);
  });

  it('空きが PAUSE_MIN_GAP（0.6 秒）未満は捨てる。見出しや隣でない組も入らない', () => {
    const tight: AskCell[] = [
      { text: 'a', start: 0, end: 1 },
      { text: 'b', start: 1.5, end: 2 }, // 空き 0.5 秒
      { text: '見出し', head: true, start: 2, end: 2 },
      { text: 'c', start: 5, end: 6 },
    ];
    expect(pauseLines(tight, [0, 1])).toEqual([]);
    expect(pauseLines(tight, [1, 2, 3])).toEqual([]); // 2 は見出し
    expect(pauseLines(tight, [0, 3])).toEqual([]); // 隣でない
  });

  it('文は cells[b] の文の頭 24 字', () => {
    const long: AskCell[] = [
      { text: 'a', start: 0, end: 1 },
      { text: 'い'.repeat(30), start: 5, end: 6 },
    ];
    expect(pauseLines(long, [0, 1])).toEqual([{ sec: 5, tech: '間 4.0秒', text: `「${'い'.repeat(24)}」の前` }]);
  });

  it('上限は PAUSE_MAX_LINES 個。空きの大きい順に選び、残りを sec の順に並べる（一番小さい空きは捨てる）', () => {
    // 空きが 1〜13 秒の 13 組（マスは 14 個）
    const chain: AskCell[] = [{ text: 't0', start: 0, end: 1 }];
    let end = 1;
    for (let g = 1; g <= 13; g++) {
      const start = end + g;
      chain.push({ text: `t${g}`, start, end: start + 1 });
      end = start + 1;
    }
    const out = pauseLines(chain, chain.map((_, i) => i));
    expect(out).toHaveLength(PAUSE_MAX_LINES);
    const tech = out.map((l) => l.tech);
    expect(tech).not.toContain('間 1.0秒');
    expect(tech).toContain('間 13.0秒');
    const secs = out.map((l) => l.sec);
    expect(secs).toEqual([...secs].sort((a, b) => a - b));
  });
});

describe('askHead（カードの見出し）', () => {
  it('技法・話の骨組み・天丼と伏線は「種類・範囲」（講義のときは「（講義）」）', () => {
    expect(askHead('tech', 'comedy', '本ネタ（1:20〜1:50）')).toBe('技法の色・本ネタ（1:20〜1:50）');
    expect(askHead('bones', 'lecture', '全体（0:00〜1:50）')).toBe('話の骨組み（講義）・全体（0:00〜1:50）');
    expect(askHead('tendon', 'comedy', '今のマス（1:20）')).toBe('天丼と伏線・今のマス（1:20）');
  });

  it('間は「間・範囲」', () => {
    expect(askHead('pause', 'lecture', '全体（0:00〜1:50）')).toBe('間・全体（0:00〜1:50）');
  });

  it('この型は題（まとめて空なら「別の話題」）と範囲。講義の付けは付けない', () => {
    expect(askHead('apply', 'lecture', '全体（0:00〜1:50）', ' 別の  話題 ')).toBe('この型で「別の 話題」・全体（0:00〜1:50）');
    expect(askHead('apply', 'comedy', '全体（0:00〜1:50）')).toBe('この型で「別の話題」・全体（0:00〜1:50）');
  });
});

describe('入力を変えない', () => {
  it('マス・番号・指定の配列は変わらない', () => {
    const cellsBefore = JSON.stringify(cells);
    const picked = [5, 1, 4];
    const pickedBefore = [...picked];
    const idx = [1, 2, 4, 5];
    const idxBefore = [...idx];
    askRangeCells(cells, 'picked', 0, picked);
    askRangeCells(cells, 'all', 0, picked);
    askRangeLabel(cells, 'all', idx);
    askPayload(cells, idx);
    pauseLines(cells, idx);
    expect(JSON.stringify(cells)).toBe(cellsBefore);
    expect(picked).toEqual(pickedBefore);
    expect(idx).toEqual(idxBefore);
  });

  it('AI の答えの値・送る文は変わらない', () => {
    const sentNow = askPayload(cells, [4, 5]).sent;
    const sentBefore = JSON.stringify(sentNow);
    const raw = { lines: [{ n: 1, tech: '〔天丼〕', text: 'a' }, { n: 0, text: 'b' }] };
    const rawBefore = JSON.stringify(raw);
    parseAskLines(raw, sentNow);
    practiceAskLines('tech', 'comedy', sentNow);
    expect(JSON.stringify(sentNow)).toBe(sentBefore);
    expect(JSON.stringify(raw)).toBe(rawBefore);
  });
});
