// UI の保存場所（C++ がデータフォルダの ui-data\ の中に読み書きする）
//   名前は「英数字・-・_」を / でつないだもの（4段まで）で、.json だけ。例：conversations/c1abc.json
import { request, send } from './bridge';

export async function readData<T>(name: string): Promise<T | null> {
  const reply = await request((requestId) => ({ type: 'readData', name, requestId }));
  if (reply?.type !== 'dataRead' || reply.text === null) return null;
  try {
    return JSON.parse(reply.text) as T;
  } catch {
    return null;
  }
}

// 「無い」と「読めない」を分けて読む（AR0）
//   ok：読めた（JSON として）／missing：ファイルが無い（C++ の返事の missing）／failed：返事が来ない（時間切れ）・JSON が壊れている・ほかの理由で読めない
export type CheckedRead<T> = { status: 'ok'; value: T } | { status: 'missing' } | { status: 'failed' };

export async function readDataChecked<T>(name: string): Promise<CheckedRead<T>> {
  const reply = await request((requestId) => ({ type: 'readData', name, requestId }));
  if (reply?.type !== 'dataRead') return { status: 'failed' };
  if (reply.text === null) return reply.missing === true ? { status: 'missing' } : { status: 'failed' };
  try {
    return { status: 'ok', value: JSON.parse(reply.text) as T };
  } catch {
    return { status: 'failed' };
  }
}

export async function writeData(name: string, value: unknown): Promise<boolean> {
  const reply = await request((requestId) => ({ type: 'writeData', name, text: JSON.stringify(value), requestId }));
  return reply?.type === 'dataWritten' && reply.ok;
}

export async function listData(dir: string) {
  const reply = await request((requestId) => ({ type: 'listData', dir, requestId }));
  return reply?.type === 'dataList' ? reply.files : [];
}

export function deleteData(name: string) {
  send({ type: 'deleteData', name });
}
