import { describe, expect, it } from 'vitest';
import { guardLeavePrompt } from '../engines/popup/leave.ts';

// One realm's Event and window, so the real Event.prototype stays untouched.
function realm(edited: () => boolean) {
  const Event = class {
    prevented = false;
    stored: unknown = '';
    constructor(public type: string) {}
    preventDefault() {
      this.prevented = true;
    }
    get returnValue() {
      return this.stored;
    }
    set returnValue(v: unknown) {
      this.stored = v;
    }
  };
  const win = {
    Event,
    native: null as unknown,
    get onbeforeunload() {
      return this.native;
    },
    set onbeforeunload(v: unknown) {
      this.native = v;
    },
  };
  guardLeavePrompt(win as never, edited);
  return { win, Event };
}

describe('guardLeavePrompt', () => {
  it('drops preventDefault and returnValue on beforeunload until the user edits', () => {
    let edited = false;
    const { Event } = realm(() => edited);
    const e = new Event('beforeunload');
    e.preventDefault();
    e.returnValue = 'stay';
    expect(e.prevented).toBe(false);
    expect(e.stored).toBe('');

    edited = true;
    e.preventDefault();
    e.returnValue = 'stay';
    expect(e.prevented).toBe(true);
    expect(e.stored).toBe('stay');
  });

  it('leaves other events alone', () => {
    const { Event } = realm(() => false);
    const click = new Event('click');
    click.preventDefault();
    expect(click.prevented).toBe(true);
  });

  it('wraps onbeforeunload so its returned text asks only after an edit', () => {
    let edited = false;
    const { win } = realm(() => edited);
    const handler = () => 'stay';
    win.onbeforeunload = handler;
    expect(win.onbeforeunload).toBe(handler);
    const native = win.native as (e: { type: string }) => unknown;
    expect(native({ type: 'beforeunload' })).toBeUndefined();
    edited = true;
    expect(native({ type: 'beforeunload' })).toBe('stay');
  });
});
