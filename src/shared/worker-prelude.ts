// Fingerprinting scripts often run their canvas and hardware probes in a Worker built from a blob,
// where content scripts never run. Such a worker's code is read synchronously and `code` is put in
// front of it. Workers loaded from a site's own files are left alone: from a blob their relative
// imports would break.

const NativeXHR = XMLHttpRequest;

function withPrefix(url: string | URL, code: string): string | URL {
  const href = String(url);
  if (!href.startsWith('blob:')) return url;
  try {
    const xhr = new NativeXHR();
    xhr.open('GET', href, false);
    xhr.send();
    if (xhr.status !== 200) return url;
    // shortcut: the new blob URL is never revoked (the worker may still be loading it); a few bytes
    // per worker, revisit if a page is seen creating workers in a loop.
    return URL.createObjectURL(
      new Blob([code, '\n', xhr.responseText], { type: 'text/javascript' }),
    );
  } catch {
    // The site keeps working: the worker starts without the prefix.
    return url;
  }
}

/** Runs `code` (a self-contained script) first in every inline Worker and SharedWorker. */
export function prefixInlineWorkers(code: string): void {
  for (const name of ['Worker', 'SharedWorker'] as const) {
    const desc = Object.getOwnPropertyDescriptor(globalThis, name);
    const Native = desc?.value as
      (new (url: string | URL, options?: unknown) => object) | undefined;
    if (typeof Native !== 'function') continue;
    const Wrapped = function (this: unknown, url: string | URL, options?: unknown) {
      // Called without `new`: let the native constructor throw its own TypeError.
      if (!new.target) return Reflect.apply(Native, this, [url, options]) as never;
      return Reflect.construct(Native, [withPrefix(url, code), options], new.target) as object;
    };
    Wrapped.prototype = Native.prototype;
    Object.defineProperty(globalThis, name, { ...desc, value: Wrapped });
  }
}
