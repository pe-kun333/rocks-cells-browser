// 読み進み具合：表示中のタブのスクロール位置を数秒ごとに見て、六角形の辺（0〜6）で覚える。
// いちばん下まで読んで、しばらくそのページにいたら「読み終えた」と知らせる
import { request } from './bridge';
import type { TabStore } from './tabs';

const INTERVAL = 3000;
const READ_AT = 0.95; // ここまで見えたら最後まで読んだとみなす
const MIN_STAY = 20_000; // そのページを開いてから、これだけたっていること（流し見で知らせないように）

export class ReadingTracker {
  private readonly opened = new Map<number, { url: string; at: number }>(); // タブ → 今のページを開いた時刻
  private readonly announced = new Set<string>(); // 読み終えたと知らせたページ（タブと URL）

  constructor(
    private readonly store: TabStore,
    private readonly onRead: (tabId: number) => void,
  ) {
    window.setInterval(() => void this.check(), INTERVAL);
  }

  // ほかの方法で読み終えた（六角で読む画面で最後まで読んだ）：まだ知らせていなければ知らせる
  announce(tabId: number) {
    const tab = this.store.get(tabId);
    if (!tab) return;
    const key = `${tab.id}|${tab.url}`;
    if (this.announced.has(key)) return;
    this.announced.add(key);
    this.onRead(tabId);
  }

  private async check() {
    const tab = this.store.active;
    if (!tab || tab.asleep || tab.loading || !/^https?:|^data:/.test(tab.url)) return;
    let opened = this.opened.get(tab.id);
    if (!opened || opened.url !== tab.url) {
      opened = { url: tab.url, at: Date.now() };
      this.opened.set(tab.id, opened);
    }
    const reply = await request((requestId) => ({ type: 'getScroll', requestId, id: tab.id }), 5000);
    if (reply?.type !== 'scroll' || reply.error || !reply.h || reply.y === undefined || reply.vh === undefined) return;
    if (this.store.activeId !== tab.id || tab.url !== opened.url) return; // 調べている間に切り替わった
    if (reply.h < reply.vh * 1.3) return; // 1画面に収まるページ（検索のトップなど）は、読み進みを数えない

    const progress = Math.min(1, (reply.y + reply.vh) / reply.h);
    this.store.setReadEdges(tab.id, progress >= READ_AT ? 6 : progress * 6);
    const key = `${tab.id}|${tab.url}`;
    if (progress >= READ_AT && Date.now() - opened.at >= MIN_STAY && !this.announced.has(key)) {
      this.announced.add(key);
      this.onRead(tab.id);
    }
  }
}
