// タブの自動休眠：使っていないタブを、時間がたったら順に眠らせる（実際に止めるのは C++）
//   一時停止：ページの動きを止めてメモリを減らす。すぐに戻れる
//   休眠    ：ページを閉じて URL だけ覚えておく。開くと読み込み直す
// 眠らせないタブ：表示中、音が出ている、「休眠させない」にしたもの
import { send } from './bridge';
import type { Tab, TabStore } from './tabs';
import type { SleepSettings } from './types';

const MINUTE = 60_000;

export type SleepState = 'active' | 'awake' | 'suspended' | 'asleep';

export function sleepStateOf(tab: Tab, activeId: number | null): SleepState {
  if (tab.id === activeId) return 'active';
  if (tab.asleep) return 'asleep';
  return tab.suspended ? 'suspended' : 'awake';
}

export class SleepManager {
  private settings: SleepSettings;
  private timer = 0;
  private readonly requested = new Map<number, number>(); // タブ → 最後に頼んだ時刻（何度も頼まないように）
  isPopped: (id: number) => boolean = () => false; // P2：ライブの小窓に出しているタブは眠らせない（C++ も断る）

  constructor(
    private readonly store: TabStore,
    settings: SleepSettings,
  ) {
    this.settings = settings;
    this.restart();
  }

  update(settings: SleepSettings) {
    this.settings = settings;
    this.restart();
  }

  // このタブを自動で眠らせてよいか。ルールを増やすときはここに足す
  canSleep(tab: Tab) {
    return tab.id !== this.store.activeId && !tab.asleep && !tab.audible && !tab.keepAwake && !this.isPopped(tab.id);
  }

  // 時間を見て、眠らせるタブを C++ に頼む
  check(now = Date.now()) {
    const suspendAfter = this.settings.suspendMinutes * MINUTE;
    const discardAfter = this.settings.discardMinutes * MINUTE;
    const retryAfter = Math.min(MINUTE, suspendAfter); // 断られたら、しばらく頼み直さない
    for (const tab of this.store.all()) {
      if (!this.canSleep(tab)) continue;
      const wait = tab.sleepBlocked ? retryAfter * 5 : retryAfter; // 入力途中で見送ったタブは、間をあけて確かめ直す
      if (now - (this.requested.get(tab.id) ?? 0) < wait) continue;
      const idle = now - tab.lastUsed;
      if (idle >= discardAfter) {
        this.requested.set(tab.id, now);
        send({ type: 'discardTab', id: tab.id });
      } else if (idle >= suspendAfter && !tab.suspended && tab.sleepBlocked === null) {
        this.requested.set(tab.id, now);
        send({ type: 'suspendTab', id: tab.id });
      }
    }
  }

  // 確かめる間隔：ふだんは30秒ごと（一時停止までの時間がとても短い設定のときは、それに合わせて短く）
  private restart() {
    window.clearInterval(this.timer);
    const interval = Math.min(30_000, Math.max(1_000, (this.settings.suspendMinutes * MINUTE) / 3));
    this.timer = window.setInterval(() => this.check(), interval);
  }
}
