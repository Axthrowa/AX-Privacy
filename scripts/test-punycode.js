/**
 * Punycode & Homograph Threat Engine Unit Tests
 */

function decodePunycodeLabel(input) {
  const base = 36;
  const tmin = 1;
  const tmax = 26;
  const skew = 38;
  const damp = 700;
  const initialBias = 72;
  const initialN = 128;

  function adapt(delta, numpoints, firsttime) {
    let k = 0;
    delta = firsttime ? Math.floor(delta / damp) : delta >> 1;
    delta += Math.floor(delta / numpoints);
    while (delta > ((base - tmin) * tmax) >> 1) {
      delta = Math.floor(delta / (base - tmin));
      k += base;
    }
    return k + Math.floor(((base - tmin + 1) * delta) / (delta + skew));
  }

  const output = [];
  let n = initialN;
  let i = 0;
  let bias = initialBias;

  let basic = input.lastIndexOf('-');
  if (basic > 0) {
    for (let j = 0; j < basic; ++j) {
      output.push(input.charCodeAt(j));
    }
  } else {
    basic = 0;
  }

  let index = basic > 0 ? basic + 1 : 0;
  while (index < input.length) {
    const oldi = i;
    let w = 1;
    for (let k = base; ; k += base) {
      if (index >= input.length) return null;
      const c = input.charCodeAt(index++);
      let digit;
      if (c >= 48 && c <= 57) digit = c - 22;
      else if (c >= 65 && c <= 90) digit = c - 65;
      else if (c >= 97 && c <= 122) digit = c - 97;
      else return null;

      i += digit * w;
      const t = k <= bias ? tmin : k >= bias + tmax ? tmax : k - bias;
      if (digit < t) break;
      w *= base - t;
    }
    bias = adapt(i - oldi, output.length + 1, oldi === 0);
    n += Math.floor(i / (output.length + 1));
    i %= output.length + 1;
    output.splice(i, 0, n);
    i++;
  }

  return String.fromCodePoint(...output);
}

function decodeHostname(hostname) {
  if (!hostname || !hostname.includes('xn--')) return hostname;
  return hostname
    .split('.')
    .map((part) => {
      if (part.toLowerCase().startsWith('xn--')) {
        const decoded = decodePunycodeLabel(part.slice(4));
        return decoded || part;
      }
      return part;
    })
    .join('.');
}

function evaluateThreat(hostname) {
  if (hostname.includes('xn--')) {
    const decodedHost = decodeHostname(hostname);
    const TURKISH_ASCII_REGEX = /^[a-zA-Z0-9\-\.çÇğĞıIİiöÖşŞüÜâÂîÎûÛ]+$/;
    if (TURKISH_ASCII_REGEX.test(decodedHost)) {
      return { level: 'safe', decodedHost };
    }
    const hasLatin = /[a-zA-Z]/.test(decodedHost);
    const hasCyrillicOrGreek = /[\u0400-\u04FF\u0370-\u03FF]/.test(decodedHost);
    if (hasLatin && hasCyrillicOrGreek) {
      return { level: 'danger', decodedHost };
    }
    return { level: 'warning', decodedHost };
  }
  return { level: 'safe', decodedHost: hostname };
}

const testCases = [
  { domain: 'xn--trkiye-3ya.gov.tr', expected: 'safe', desc: 'Türkçe güvenilir domain' },
  { domain: 'xn--pple-43d.com', expected: 'danger', desc: 'Kiril karışımlı sahte domain' },
  { domain: 'example.com', expected: 'safe', desc: 'Normal HTTPS domain' }
];

console.log('=== Punycode & Homograph Threat Test Suite ===');
let allPassed = true;

for (const tc of testCases) {
  const result = evaluateThreat(tc.domain);
  const passed = result.level === tc.expected;
  console.log(
    `[${passed ? 'PASS' : 'FAIL'}] ${tc.domain} -> Decoded: "${result.decodedHost}" | Result: ${result.level} (Expected: ${tc.expected}) - ${tc.desc}`
  );
  if (!passed) allPassed = false;
}

if (!allPassed) {
  console.error('Test suite failed!');
  process.exit(1);
} else {
  console.log('All test cases passed successfully!');
}
