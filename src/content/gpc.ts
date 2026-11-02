// The `Sec-GPC` request header comes from a DNR rule; this is the same signal for page scripts.
if (!('globalPrivacyControl' in navigator)) {
  Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', {
    configurable: true,
    enumerable: true,
    get: () => true,
  });
}
