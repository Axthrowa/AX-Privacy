/**
 * Sites where a broken page costs money or locks someone out: payment, 3D Secure, banks,
 * government sign-in, captchas and sign-in providers. No content script runs there, so nothing is
 * hidden and no page function is wrapped. Network rules still apply; they only stop known trackers.
 * Subdomains are covered.
 */
export const PROTECTED_HOSTS = [
  // Payment and 3D Secure
  'iyzico.com',
  'iyzipay.com',
  'paytr.com',
  'stripe.com',
  'stripe.network',
  'paypal.com',
  'checkout.com',
  'adyen.com',
  'klarna.com',
  'payu.com',
  'payu.com.tr',
  'craftgate.io',
  'bkm.com.tr',
  'papara.com',
  // Banks
  'garantibbva.com.tr',
  'isbank.com.tr',
  'akbank.com',
  'yapikredi.com.tr',
  'ziraatbank.com.tr',
  'halkbank.com.tr',
  'vakifbank.com.tr',
  'qnb.com.tr',
  'denizbank.com',
  'teb.com.tr',
  'ing.com.tr',
  'kuveytturk.com.tr',
  'enpara.com',
  // Government
  'turkiye.gov.tr',
  'gib.gov.tr',
  // Captchas
  'challenges.cloudflare.com',
  'hcaptcha.com',
  'recaptcha.net',
  'arkoselabs.com',
  'funcaptcha.com',
  // Sign-in providers
  'accounts.google.com',
  'appleid.apple.com',
  'login.microsoftonline.com',
  'login.live.com',
] as const;

/** reCAPTCHA is a path on google.com, not a host of its own. */
export const PROTECTED_PATTERNS = ['*://www.google.com/recaptcha/*'];
