// Windows 11 の「ライブキャプション」から、聞き取った文を少しずつ受け取る
//   ライブキャプションの窓には、最近の数行だけが出て、新しい言葉が足されていく（直前の言葉は直ることもある）。
//   そこで、区切りの付いた文（と、しばらく変わらない最後の文）を「決まった文」として、まだ渡していないものだけを渡す
import { request } from '../bridge';

export type LiveStatus = 'starting' | 'listening' | 'unavailable' | 'error';

export interface LiveListener {
  onSentence(text: string): void; // 決まった文
  onPartial(text: string): void; // まだ途中の文（表示だけ）
  onStatus(status: LiveStatus): void;
}

const POLL_MS = 600;
const SETTLE_POLLS = 4; // 最後の文がこれだけ変わらなければ、決まったものとする（約2.4秒）
const ENDERS = /(?<=[。．！？!?])\s*|(?<=[.])\s+|\n+/;

export class LiveCaptions {
  private timer = 0;
  private busy = false;
  private recent: string[] = []; // 最近渡した文（重ねて渡さないように）
  private lastTail = '';
  private sameTail = 0;
  private started = false;

  constructor(private readonly listener: LiveListener) {}

  start() {
    this.stop();
    this.started = false;
    this.listener.onStatus('starting');
    this.timer = window.setInterval(() => void this.poll(), POLL_MS);
    void this.poll(true);
  }

  stop() {
    window.clearInterval(this.timer);
    this.timer = 0;
  }

  get active() {
    return this.timer !== 0;
  }

  private async poll(first = false) {
    if (this.busy || document.visibilityState !== 'visible') return;
    this.busy = true;
    try {
      const reply = await request((requestId) => ({ type: 'liveCaptions', requestId, start: first || !this.started }), 4_000);
      if (reply?.type !== 'liveCaptions') {
        this.listener.onStatus('error');
        return;
      }
      if (!reply.available) {
        this.listener.onStatus('unavailable');
        this.stop();
        return;
      }
      if (!reply.running) {
        this.listener.onStatus('starting');
        return;
      }
      if (!this.started) {
        this.started = true;
        this.listener.onStatus('listening');
      }
      this.take(reply.text ?? '');
    } finally {
      this.busy = false;
    }
  }

  private take(text: string) {
    const parts = text
      .split(ENDERS)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) {
      this.listener.onPartial('');
      return;
    }
    const tail = parts[parts.length - 1];
    const ended = /[。．！？!?.]$/.test(tail);
    // 区切りの付いた文はすぐ、最後の途中の文は、しばらく変わらなければ決める
    const stable = ended ? parts : parts.slice(0, -1);
    for (const s of stable) this.commit(s);
    if (!ended) {
      this.sameTail = tail === this.lastTail ? this.sameTail + 1 : 0;
      this.lastTail = tail;
      if (this.sameTail >= SETTLE_POLLS && [...tail].length >= 6) {
        this.commit(tail);
        this.sameTail = 0;
      }
    }
    this.listener.onPartial(ended ? '' : this.remainder(tail));
  }

  // まだ渡していない部分（前に渡した文の続きなら、増えた分だけ）
  private remainder(s: string): string {
    const norm = s.replace(/\s+/g, '');
    for (const r of this.recent) {
      if (norm === r) return '';
      if (norm.startsWith(r)) return s.slice(this.indexAfter(s, r)).trim();
    }
    return s;
  }

  private indexAfter(s: string, normalizedPrefix: string) {
    let count = 0;
    for (let i = 0; i < s.length; i++) {
      if (!/\s/.test(s[i])) count++;
      if (count === normalizedPrefix.length) return i + 1;
    }
    return s.length;
  }

  private commit(s: string) {
    const rest = this.remainder(s);
    if (!rest) return;
    const norm = s.replace(/\s+/g, '');
    this.recent = [norm, ...this.recent.filter((r) => !norm.startsWith(r))].slice(0, 40);
    this.listener.onSentence(rest);
  }
}
