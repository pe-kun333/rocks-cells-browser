import { describe, expect, it } from 'vitest';
import { IMPORT_FILE_BYTES, utf8Bytes, withinImportBytes } from '../src/import-limits';
import { parsePatchText } from '../src/grok-patch';

describe('import-limits（1 MB はバイトで数える）', () => {
  it('ASCII は 1 字 1 バイト', () => {
    expect(withinImportBytes('a'.repeat(IMPORT_FILE_BYTES))).toBe(true);
    expect(withinImportBytes('a'.repeat(IMPORT_FILE_BYTES + 1))).toBe(false);
  });
  it('日本語は 1 字 3 バイト（字数では 1/3 で上限）', () => {
    const n = Math.floor(IMPORT_FILE_BYTES / 3);
    expect(utf8Bytes('あ')).toBe(3);
    expect(withinImportBytes('あ'.repeat(n))).toBe(true);
    expect(withinImportBytes('あ'.repeat(n + 1))).toBe(false);
  });
  it('提案の文もバイトで断る', () => {
    const big = JSON.stringify({ v: 1, type: 'patch', note: 'あ'.repeat(IMPORT_FILE_BYTES / 3), ops: [] });
    expect(parsePatchText(big)).toEqual({ ok: false, reason: 'tooBig' });
  });
});
