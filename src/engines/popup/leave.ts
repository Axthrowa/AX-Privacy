interface LeaveGlobals {
  Event: { prototype: Event };
  BeforeUnloadEvent?: { prototype: Event };
  onbeforeunload: unknown;
}

/**
 * Pop-under scripts register `beforeunload` so that their same-tab redirect, or any attempt to
 * leave, asks "Leave site? Changes you made may not be saved". The prompt is honoured only once
 * the user has typed or chosen something on the page (`edited`), which is what it exists for.
 */
export function guardLeavePrompt(win: LeaveGlobals, edited: () => boolean): void {
  const blocks = (e: Event) => e.type === 'beforeunload' && !edited();

  const event = win.Event.prototype;
  const preventDefault = event.preventDefault;
  event.preventDefault = function (this: Event) {
    if (!blocks(this)) preventDefault.call(this);
  };
  for (const proto of [event, win.BeforeUnloadEvent?.prototype]) {
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'returnValue');
    if (!proto || !desc?.set) continue;
    const set = desc.set;
    Object.defineProperty(proto, 'returnValue', {
      ...desc,
      set(this: Event, v: unknown) {
        if (!blocks(this)) set.call(this, v);
      },
    });
  }

  // `onbeforeunload = () => 'text'` asks through its return value, which no setter sees.
  const desc = Object.getOwnPropertyDescriptor(win, 'onbeforeunload');
  if (!desc?.set || !desc.get) return;
  const { get, set } = desc;
  let handler: unknown = get.call(win);
  Object.defineProperty(win, 'onbeforeunload', {
    configurable: true,
    enumerable: desc.enumerable,
    get: () => handler,
    set(fn: unknown) {
      handler = fn;
      set.call(
        win,
        typeof fn === 'function'
          ? function (this: unknown, e: Event) {
              const answer: unknown = fn.call(this, e);
              return blocks(e) ? undefined : answer;
            }
          : fn,
      );
    },
  });
}
