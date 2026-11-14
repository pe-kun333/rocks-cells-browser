// 先生つきの画面の文の英語版つき（panels/ai-advisor-texts.ts）：日本語のときは、元（ai/trio-advisor.ts）と同じ字になる
import { describe, expect, it } from 'vitest';
import * as base from '../src/ai/trio-advisor';
import * as ui from '../src/panels/ai-advisor-texts';

describe('ai-advisor-texts は元の文と同じ（日本語）', () => {
  it('advisorWaitText・advisorLiveText', () => {
    expect(ui.advisorWaitText('ソネット')).toBe(base.advisorWaitText('ソネット'));
    for (const phase of ['asking', 'done', 'failed', 'stopped'] as const) expect(ui.advisorLiveText('ハイク', phase)).toBe(base.advisorLiveText('ハイク', phase));
  });
  it('elapsedNote', () => {
    for (const ms of [0, 5_000, base.ADVISOR_LONG_WAIT_MS - 1, base.ADVISOR_LONG_WAIT_MS, 600_000]) expect(ui.elapsedNote(ms)).toBe(base.elapsedNote(ms));
  });
  it('advisorConsentLines', () => {
    for (const practice of [false, true]) {
      for (const withFable of [false, true]) {
        const opts = { remaining: 3, limit: 5, withFable, practice, advisorLabel: 'Fable 5.2' };
        expect(ui.advisorConsentLines(opts)).toEqual(base.advisorConsentLines(opts));
      }
    }
  });
});
