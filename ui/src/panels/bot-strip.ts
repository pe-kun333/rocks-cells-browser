// 巣の上の 1 行（段 2）。下書きと返事の数。0 のときは出さない
//   段 8 では、届きかけの組の「届いた k/n」も同じ行に足す（殻の説明・タブと同じ数）
import { cardsStageOn, onCardsStore, shownCountLine } from '../cards-stages';
import { el } from '../util';

export class BotStrip {
  readonly element = el('div', 'bot-strip');
  private stop = () => {};

  constructor(private readonly anchor: HTMLElement) {
    this.element.setAttribute('role', 'status');
    this.element.hidden = true;
    this.stop = onCardsStore(() => this.refresh());
    this.refresh();
  }

  refresh() {
    if (!cardsStageOn('2')) {
      this.element.hidden = true;
      this.element.remove();
      return;
    }
    if (!this.element.isConnected) this.anchor.before(this.element);
    const line = shownCountLine();
    this.element.textContent = line;
    this.element.hidden = line === '';
  }

  dispose() {
    this.stop();
    this.element.remove();
  }
}
