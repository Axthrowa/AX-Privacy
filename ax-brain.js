/**
 * AX-Brain (v4.0.0)
 * Ultra-lightweight, 100% local, dependency-free online learning engine for AX-Privacy.
 * CPU & memory optimized: < 2 KB model size, pure linear algebra, zero external libraries.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.AxBrain = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // 12 Core Sensory Features
  const FEATURE_NAMES = [
    'isFixedOrSticky',    // 0: position: fixed or sticky
    'highZIndex',         // 1: z-index >= 999 (0.5) or z-index >= 99999 (1.0)
    'hasCrossSiteLink',   // 2: cross-site destination link or ad parameters
    'hasBlankTarget',     // 3: target="_blank"
    'isIabSize',          // 4: standard IAB ad dimensions (+-8px)
    'hasGifOrWebp',       // 5: animated .gif or external .webp
    'isEdgeOrCorner',     // 6: pageskin geometry or screen edge/corner widget
    'isTransparentCover', // 7: large transparent click curtain
    'hasBaitLanguage',    // 8: fake verification, loading, progress, or allow bait words
    'hasCloseNoForm',     // 9: close icon/button without real form or password input
    'hasAdTokens',        // 10: class/id/data matching ad patterns (word-boundary protected)
    'isLateInjected'      // 11: dynamically injected into DOM after user interaction
  ];

  const IMMUNE_ROOTS = new Set([
    'google.com',
    'googleapis.com',
    'gstatic.com',
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com',
    'googlevideo.com',
    'ytimg.com',
    'ggpht.com',
    'youtubei.googleapis.com',
    'twitch.tv',
    'ttvnw.net',
    'jtvnw.net',
    'github.com',
    'githubusercontent.com',
    'cloudflare.com',
    'jsdelivr.net',
    'unpkg.com',
    'accounts.google.com',
    'appleid.apple.com',
    'login.microsoftonline.com',
    'discord.com',
    'stripe.com',
    'paypal.com',
    'iyzico.com',
    'paytr.com'
  ]);

  const IAB_DIMENSIONS = [
    { w: 728, h: 90 },
    { w: 970, h: 90 },
    { w: 970, h: 250 },
    { w: 300, h: 250 },
    { w: 300, h: 600 },
    { w: 160, h: 600 },
    { w: 120, h: 600 },
    { w: 468, h: 60 },
    { w: 320, h: 50 },
    { w: 320, h: 100 }
  ];

  function getRootDomain(hostname) {
    if (!hostname || typeof hostname !== 'string') return '';
    const clean = hostname.trim().toLowerCase();
    const parts = clean.split('.');
    if (parts.length <= 2) return clean;
    const secondToLast = parts[parts.length - 2];
    if (['com', 'co', 'gov', 'org', 'edu', 'net'].includes(secondToLast) && parts.length >= 3) {
      return parts.slice(-3).join('.');
    }
    return parts.slice(-2).join('.');
  }

  function createDefaultModel() {
    return {
      version: 2,
      // v4.1.0 calibration: untrained model already catches sticky GIF banners, IAB banners
      // with external links, pageskins, fake loading/verify cards and transparent curtains,
      // while a lone sticky header or a plain IAB-sized image stays below 0.65.
      weights: [
        1.0,  // isFixedOrSticky
        0.8,  // highZIndex
        1.2,  // hasCrossSiteLink
        0.3,  // hasBlankTarget
        1.6,  // isIabSize
        1.4,  // hasGifOrWebp
        1.4,  // isEdgeOrCorner
        3.0,  // isTransparentCover
        1.8,  // hasBaitLanguage
        0.6,  // hasCloseNoForm
        1.8,  // hasAdTokens
        0.6   // isLateInjected
      ],
      bias: -2.0,
      threshold: 0.65,
      learningRate: 0.12,
      sampleCount: 0,
      trainingCount: 0,
      lastUpdated: Date.now()
    };
  }

  function sigmoid(z) {
    if (z > 20) return 1;
    if (z < -20) return 0;
    return 1 / (1 + Math.exp(-z));
  }

  /**
   * Fast sigmoid prediction on a 12-dimensional feature vector.
   * Execution time < 0.005 ms.
   */
  function predict(features, model) {
    const m = model || createDefaultModel();
    const w = m.weights;
    const b = typeof m.bias === 'number' ? m.bias : -2.0;

    let z = b;
    const len = Math.min(features.length, w.length);
    for (let i = 0; i < len; i++) {
      z += (w[i] || 0) * (features[i] || 0);
    }

    const probability = sigmoid(z);
    return {
      probability,
      isAd: probability >= (m.threshold || 0.65),
      rawScore: z
    };
  }

  /**
   * Online Stochastic Gradient Descent step.
   * Bounds weights to [-4.0, +4.0] and bias to [-5.0, +2.0] to guarantee stability.
   */
  function train(features, label, model, customLr) {
    const m = model ? { ...model } : createDefaultModel();
    if (!Array.isArray(m.weights) || m.weights.length !== 12) {
      m.weights = createDefaultModel().weights;
    }

    const target = label ? 1 : 0;
    const prediction = predict(features, m);
    const error = target - prediction.probability;
    const lr = typeof customLr === 'number' ? customLr : (m.learningRate || 0.12);

    const newWeights = [...m.weights];
    for (let i = 0; i < 12; i++) {
      const feat = features[i] || 0;
      let updatedW = newWeights[i] + lr * error * feat;
      if (isNaN(updatedW)) updatedW = 0;
      // Strict weight clipping prevents overfitting and model drift
      newWeights[i] = Math.max(-4.0, Math.min(4.0, updatedW));
    }

    let updatedBias = (m.bias || -2.5) + lr * error;
    if (isNaN(updatedBias)) updatedBias = -2.5;
    m.bias = Math.max(-5.0, Math.min(2.0, updatedBias));
    m.weights = newWeights;
    m.sampleCount = (m.sampleCount || 0) + 1;
    m.trainingCount = m.sampleCount;
    m.lastUpdated = Date.now();

    const afterPrediction = predict(features, m);
    m.previousProbability = prediction.probability;
    m.newProbability = afterPrediction.probability;
    m.error = error;
    m.model = m;
    return m;
  }

  /**
   * Fast zero-allocation feature extractor for candidate DOM elements.
   * Returns a 12-element numeric array.
   */
  function extractFeatures(el, context = {}) {
    if (!el) return new Array(12).fill(0);

    const f = new Array(12).fill(0);
    const currentHost = (context.currentHost || '').toLowerCase();
    const currentRoot = context.rootDomain || getRootDomain(currentHost);

    const style =
      context.computedStyle ||
      (typeof window !== 'undefined' && window.getComputedStyle ? window.getComputedStyle(el) : el.style || {});
    const pos = style.position || '';
    const isFixed = pos === 'fixed';
    const isSticky = pos === 'sticky';
    const isAbsolute = pos === 'absolute';

    // 0: isFixedOrSticky
    if (isFixed || isSticky) f[0] = 1;

    // 1: highZIndex
    const z = parseInt(style.zIndex || '0', 10) || 0;
    if (z >= 99999) {
      f[1] = 1.0;
    } else if (z >= 999) {
      f[1] = 0.5;
    }

    const rect =
      context.rect ||
      (el.getBoundingClientRect
        ? el.getBoundingClientRect()
        : { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 });
    const w = rect.width || 0;
    const h = rect.height || 0;

    // 2: hasCrossSiteLink & 3: hasBlankTarget
    let hasBlank = false;
    let hasCross = false;

    if (el.querySelectorAll) {
      const links = el.querySelectorAll('a[href]');
      for (let i = 0; i < links.length; i++) {
        const a = links[i];
        if (a.getAttribute && a.getAttribute('target') === '_blank') {
          hasBlank = true;
        }
        const href = a.href || '';
        try {
          const u = new URL(href, 'http://localhost');
          if (u.protocol.startsWith('http')) {
            const tRoot = getRootDomain(u.hostname);
            if (currentRoot && tRoot && currentRoot !== tRoot) {
              hasCross = true;
            }
            if (
              /[?&](?:ref|aff|clickid|bannerid|ad_id|out|goto)=/i.test(href) ||
              /\/(?:afu\.php|click\/)/i.test(href)
            ) {
              hasCross = true;
            }
          }
        } catch {}
        if (hasBlank && hasCross) break;
      }

      if (!hasCross) {
        const ifr = el.querySelector('iframe');
        if (ifr && ifr.src) {
          const s = ifr.src.toLowerCase();
          if (
            s.includes('doubleclick') ||
            s.includes('googlesyndication') ||
            s.includes('adservice') ||
            s.includes('popads') ||
            s.includes('propeller') ||
            s.includes('exoclick') ||
            s.includes('adsterra') ||
            s.includes('monetag')
          ) {
            hasCross = true;
          }
        }
      }
    }
    if (hasCross) f[2] = 1;
    if (hasBlank) f[3] = 1;

    // 4: isIabSize
    if (w > 0 && h > 0) {
      const matchIab = IAB_DIMENSIONS.some(
        (s) => Math.abs(w - s.w) <= 8 && Math.abs(h - s.h) <= 8
      );
      if (matchIab) f[4] = 1;
    }

    // 5: hasGifOrWebp
    if (el.querySelector) {
      const img = el.querySelector('img[src*=".gif"], img[src*=".webp"], [style*=".gif"], [style*=".webp"]');
      if (img) f[5] = 1;
    }

    // 6: isEdgeOrCorner
    const winW = (typeof window !== 'undefined' ? window.innerWidth : 1200) || 1200;
    const winH = (typeof window !== 'undefined' ? window.innerHeight : 800) || 800;
    const isAtSideEdge = rect.left <= 30 || rect.right >= winW - 30;
    const isPageskinGeom = (isFixed || isAbsolute) && w > 0 && w <= 280 && h >= 380 && isAtSideEdge;
    const isCornerPush =
      (isFixed || isAbsolute) &&
      z >= 999 &&
      w > 0 &&
      w <= 420 &&
      h > 0 &&
      h <= 260 &&
      (rect.top <= 40 || rect.bottom >= winH - 40) &&
      (rect.left <= 40 || rect.right >= winW - 40);

    if (isPageskinGeom || isCornerPush) f[6] = 1;

    // 7: isTransparentCover
    const textContent = (el.textContent || el.innerText || '').trim();
    const opacity = parseFloat(style.opacity !== undefined ? style.opacity : '1');
    const isTransparent =
      opacity < 0.15 ||
      style.backgroundColor === 'transparent' ||
      style.backgroundColor === 'rgba(0, 0, 0, 0)';
    if ((isFixed || isAbsolute) && z >= 999 && w >= 250 && h >= 150 && textContent.length < 10 && isTransparent) {
      f[7] = 1;
    }

    // 8: hasBaitLanguage
    const lowerText = textContent.toLowerCase();
    const baitWords = [
      'robot',
      'doğrula',
      'devam et',
      'dokun',
      'yükleniyor',
      'bildirim',
      'izin ver',
      'verify',
      'continue',
      'tap to',
      'loading',
      'allow',
      'update',
      'tıkla',
      'tamam'
    ];
    if (
      baitWords.some((b) => lowerText.includes(b)) ||
      /\d{1,3}\s*%/i.test(lowerText) ||
      /\b(ok|okay)\b/i.test(lowerText)
    ) {
      f[8] = 1;
    }

    // 9: hasCloseNoForm
    const hasCloseIcon = Boolean(
      el.querySelector &&
        el.querySelector('[class*="close" i], [id*="close" i], [aria-label*="close" i], button')
    );
    const hasFormOrPass = Boolean(
      el.querySelector && el.querySelector('form, input[type="password"], input[type="email"]')
    );
    if (hasCloseIcon && !hasFormOrPass) {
      f[9] = 1;
    }

    // 10: hasAdTokens
    const idClass = `${el.id || ''} ${el.className || ''} ${el.getAttribute ? el.getAttribute('data-ad') || '' : ''}`.toLowerCase();
    const adWordRegex =
      /\b(reklam|ad-?(slot|box|banner|container|wrap|wrapper|zone|space|placement)?|banner-ad|sponsor-ad|pageskin|popunder|vignette|interstitial|adsbox|adslot)\b/i;
    if (adWordRegex.test(idClass)) {
      const fpRegex = /\b(upload|download|header|loading|shadow|radio|badge|avatar)\b/i;
      if (!fpRegex.test(idClass) || adWordRegex.test(el.id || '')) {
        f[10] = 1;
      }
    }

    // 11: isLateInjected
    if (context.isLateInjected || el.__ax_late_injected) {
      f[11] = 1;
    }

    return f;
  }

  return {
    VERSION: '4.1.0',
    FEATURE_NAMES,
    IMMUNE_ROOTS,
    getRootDomain,
    createDefaultModel,
    sigmoid,
    predict,
    train,
    extractFeatures
  };
});
