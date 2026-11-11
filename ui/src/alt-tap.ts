// Alt を単独で押して離したかの見分け（DOM を使わない。ui/test/alt-tap.test.ts）
//   Alt+Tab・Alt+←・Alt+半角/全角・Alt を押したままのクリックは数えない。押した瞬間に動かないのは、Alt+Tab の始まりと区別できないため
export interface AltKeyEvent {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
  repeat: boolean;
}

export class AltTap {
  private armed = false;

  // 押した。Alt を単独で押している間は true
  down(e: AltKeyEvent): boolean {
    if (e.key === 'Alt' && e.repeat) return this.armed; // 押しっぱなしの繰り返しは、押し始めの判定のまま
    this.armed = e.key === 'Alt' && !e.ctrlKey && !e.shiftKey && !e.metaKey && !e.isComposing;
    return this.armed;
  }

  // 離した。Alt を単独で押して離したときだけ true（1 回だけ）
  up(e: Pick<AltKeyEvent, 'key' | 'isComposing'>): boolean {
    if (e.key !== 'Alt') return false;
    const tap = this.armed && !e.isComposing;
    this.armed = false;
    return tap;
  }

  // ほかの窓へ移った・マウスを押した
  reset() {
    this.armed = false;
  }
}
