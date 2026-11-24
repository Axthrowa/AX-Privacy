/**
 * Request listeners (detailed reports, AX-Brain tracker learning, the filter log) need
 * `webRequest`, which is optional: asked for only when the user turns one of them on. The filter
 * log also reads which rule matched (`declarativeNetRequestFeedback`).
 */
export const REQUEST_PERMISSIONS: chrome.permissions.Permissions = {
  permissions: ['webRequest'],
};
export const LOG_PERMISSIONS: chrome.permissions.Permissions = {
  permissions: ['webRequest', 'declarativeNetRequestFeedback'],
};

export const hasPermissions = (p: chrome.permissions.Permissions): Promise<boolean> =>
  chrome.permissions.contains(p).catch(() => false);

/** Must run inside a click handler: browsers ask only during a user gesture. */
export const askPermissions = (p: chrome.permissions.Permissions): Promise<boolean> =>
  chrome.permissions.request(p).catch(() => false);
