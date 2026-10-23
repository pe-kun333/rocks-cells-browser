// AI 用に、表示中のタブのページの文章を C++ から取り寄せる
import { type PageText, request } from '../bridge';

// tabId を省くと表示中のタブ
export async function requestPageText(tabId?: number): Promise<PageText> {
  const reply = await request((requestId) => ({ type: 'getPageText', requestId, id: tabId }), 10_000);
  return reply?.type === 'pageText' ? reply : { requestId: 0, error: 'timeout' };
}
