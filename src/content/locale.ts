// Pages guess the country from the browser's language and time zone; this gives the most common
// answer instead: US English, UTC. Workers keep the real values.
const LANGS = ['en-US', 'en'];
for (const [name, value] of [
  ['language', () => LANGS[0]],
  ['languages', () => Object.freeze([...LANGS])],
] as const) {
  Object.defineProperty(Navigator.prototype, name, {
    configurable: true,
    enumerable: true,
    get: value,
  });
}

const NativeFormat = Intl.DateTimeFormat;
const withUtc = (options?: Intl.DateTimeFormatOptions) => ({ timeZone: 'UTC', ...options });
Intl.DateTimeFormat = new Proxy(NativeFormat, {
  construct: (target, [locales, options]: [string?, Intl.DateTimeFormatOptions?]) =>
    new target(locales, withUtc(options)),
  apply: (target, _this, [locales, options]: [string?, Intl.DateTimeFormatOptions?]) =>
    target(locales, withUtc(options)),
});
// shortcut: only the offset; getHours and Date#toString still show local time. Upgrade if sites
// are found comparing the two.
Date.prototype.getTimezoneOffset = function () {
  return 0;
};
