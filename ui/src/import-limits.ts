// 外から読み込むファイル（Grok の提案 patch.v1・取り込み hcb-memo-interchange）の大きさの上限（決定 D4・D7）
//   ・3 つの入口（ファイルを開く・盤面／下の区画に落とす・受け取り口）を同じ 1 MB（バイト）にそろえる
//   ・C++ 側の同じ数：src/storage.h の kMaxImportFileBytes（ファイルを開く）と src/bots.h の kMaxInboxFileBytes（受け取り口）
//   ・3 MB へ上げるのは、実機で「C++ から面へ送れる大きさ」を測ってから（docs の §3.5。後回し D6）
export const IMPORT_FILE_BYTES = 1024 * 1024;
export const IMPORT_FILE_LABEL = '1 MB';

const encoder = new TextEncoder();

// 文を UTF-8 にしたときのバイト数
export function utf8Bytes(text: string): number {
  return encoder.encode(text).length;
}

// 文が上限の内か（字数でなくバイトで数える。日本語は 1 字 3 バイト）
export function withinImportBytes(text: string): boolean {
  // 早道：UTF-16 の字数が上限の 1/3 以下なら、どんな字でも 3 バイト以内なので必ず内
  if (text.length * 3 <= IMPORT_FILE_BYTES) return true;
  if (text.length > IMPORT_FILE_BYTES) return false; // 1 字 1 バイト以上なので必ず外
  return utf8Bytes(text) <= IMPORT_FILE_BYTES;
}
