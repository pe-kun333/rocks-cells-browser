// 休眠パネル：タブの状態ごとの数と、自動休眠までの時間の設定
import { sleepStateOf } from '../sleep';
import type { TabStore } from '../tabs';
import type { SleepSettings } from '../types';
import { el } from '../util';

export class SleepPanel {
  readonly element = el('section', 'panel-section sleep-panel');
  private readonly counts = el('div', 'sleep-counts');
  private readonly suspendInput = numberInput('suspend-minutes');
  private readonly discardInput = numberInput('discard-minutes');
  private readonly error = el('div', 'field-error');

  constructor(
    private readonly store: TabStore,
    private readonly onChange: (settings: SleepSettings) => void,
  ) {
    const form = el('form', 'sleep-form');
    form.append(field('一時停止まで', this.suspendInput), field('休眠まで', this.discardInput), this.error);
    form.addEventListener('change', () => this.submit());
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });
    for (const input of [this.suspendInput, this.discardInput]) {
      input.addEventListener('input', () => (this.error.textContent = ''));
    }
    this.element.append(
      el('div', 'panel-subtitle', '休眠'),
      this.counts,
      form,
      el('div', 'panel-note', '表示中・音が出ている・「休眠させない」にしたタブは眠りません。入力途中の文字があるタブは、一時停止のまま休眠を保留します'),
    );
    store.onChange(() => this.renderCounts());
    this.renderCounts();
  }

  setSettings(settings: SleepSettings) {
    if (document.activeElement !== this.suspendInput) this.suspendInput.value = String(settings.suspendMinutes);
    if (document.activeElement !== this.discardInput) this.discardInput.value = String(settings.discardMinutes);
  }

  private submit() {
    const suspend = Number(this.suspendInput.value);
    const discard = Number(this.discardInput.value);
    if (!Number.isInteger(suspend) || !Number.isInteger(discard) || suspend < 1 || discard < 1) {
      this.error.textContent = '1以上の整数（分）を入れてください';
      return;
    }
    if (discard <= suspend) {
      this.error.textContent = '休眠までの時間は、一時停止までより長くしてください';
      return;
    }
    this.error.textContent = '';
    this.onChange({ suspendMinutes: suspend, discardMinutes: discard });
  }

  private renderCounts() {
    const counts = { active: 0, awake: 0, suspended: 0, asleep: 0 };
    for (const tab of this.store.all()) counts[sleepStateOf(tab, this.store.activeId)]++;
    this.counts.replaceChildren(
      stat('起きている', counts.active + counts.awake),
      stat('一時停止', counts.suspended),
      stat('休眠', counts.asleep),
    );
  }
}

function numberInput(name: string) {
  const input = el('input');
  input.type = 'number';
  input.name = name;
  input.min = '1';
  input.max = '1440';
  input.step = '1';
  return input;
}

function field(label: string, input: HTMLInputElement) {
  const row = el('label', 'field');
  row.append(el('span', 'field-label', label), input, el('span', 'field-unit', '分'));
  return row;
}

function stat(label: string, value: number) {
  const box = el('div', 'stat');
  box.append(el('div', 'stat-value', String(value)), el('div', 'stat-label', label));
  return box;
}
