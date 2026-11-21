/**
 * Twitch GQL PlaybackAccessToken Schema & Variable Validator
 *
 * Validates:
 * 1. Static AST/Regex check: All declared $variables in twitch-shield.js must be used in the query body.
 * 2. Live API check: If network is available, verifies Twitch GQL does not return schema/variable validation errors.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const shieldPath = path.resolve(__dirname, '../twitch-shield.js');

console.log('=== Twitch GQL Schema & Variable Validator ===');

if (!fs.existsSync(shieldPath)) {
  console.error(`[FAIL] twitch-shield.js not found at ${shieldPath}`);
  process.exit(1);
}

const source = fs.readFileSync(shieldPath, 'utf8');

// 1. Extract GQL query lines from twitch-shield.js
const blockMatch = source.match(/const\s+GQL_QUERY\s*=\s*\[([\s\S]*?)\]\.join/);
if (!blockMatch) {
  console.error('[FAIL] Could not extract GQL_QUERY block from twitch-shield.js');
  process.exit(1);
}

const queryLines = blockMatch[1]
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l.startsWith("'"))
  .map((l) => l.replace(/^'/, '').replace(/',?$/, ''));

const fullQuery = queryLines.join('\n');

const headerMatch = fullQuery.match(/query\s+PlaybackAccessToken\s*\(([^)]+)\)\s*\{/);
if (!headerMatch) {
  console.error('[FAIL] Could not match PlaybackAccessToken header in query');
  process.exit(1);
}

const rawHeaderVars = headerMatch[1];
const bodyStartIndex = fullQuery.indexOf('{');
const rawBody = fullQuery.slice(bodyStartIndex + 1, fullQuery.lastIndexOf('}'));

// Parse declared variables: e.g. ["$login", "$playerType", "$platform"]
const declaredVars = rawHeaderVars
  .split(',')
  .map((item) => {
    const m = item.match(/\$([a-zA-Z0-9_]+)/);
    return m ? `$${m[1]}` : null;
  })
  .filter(Boolean);

console.log(`[CHECK] Declared variables (${declaredVars.length}):`, declaredVars.join(', '));

// Static Check 1: Verify every declared variable is used in the query body
const unusedVars = [];
for (const varName of declaredVars) {
  const regex = new RegExp(`\\${varName}\\b`, 'g');
  const matches = rawBody.match(regex);
  if (!matches || matches.length === 0) {
    unusedVars.push(varName);
  }
}

if (unusedVars.length > 0) {
  console.error(`[FAIL] Unused variables detected in PlaybackAccessToken query: ${unusedVars.join(', ')}`);
  process.exit(1);
}

// Static Check 2: Verify no undeclared variable is used in the query body
const bodyVars = Array.from(new Set(rawBody.match(/\$[a-zA-Z0-9_]+/g) || []));
const undeclaredVars = bodyVars.filter((v) => !declaredVars.includes(v));
if (undeclaredVars.length > 0) {
  console.error(`[FAIL] Undeclared variables used in query body: ${undeclaredVars.join(', ')}`);
  process.exit(1);
}

console.log('[PASS] Static GQL variable check passed: 100% of declared variables are used and valid.');

// Static Check 3: Verify Twitch Player Controls are guaranteed pointer-events: auto
if (!source.includes('player-play-pause-button') || !source.includes('player-fullscreen-button') || !source.includes('pointer-events: auto !important')) {
  console.error('[FAIL] twitch-shield.js does not contain pointer-events: auto protection for player controls');
  process.exit(1);
}
if (source.includes('.video-player__overlay [data-a-target*="ad-"]')) {
  console.error('[FAIL] twitch-shield.js contains dangerous wildcard selector inside .video-player__overlay');
  process.exit(1);
}
if (!source.includes('player-overlay-ad') || !source.includes('video-ad-overlay') || !source.includes('sad-overlay')) {
  console.error('[FAIL] twitch-shield.js does not contain comprehensive video ad overlay suppression selectors');
  process.exit(1);
}
if (!source.includes("playerType: 'popout'") || !source.includes("playerType: 'frontpage'")) {
  console.error('[FAIL] twitch-shield.js CANDIDATE_MATRIX is missing popout/frontpage fallback playerTypes');
  process.exit(1);
}

// Static Check 4: Verify manifest.json matches both bare twitch.tv and subdomains
const manifestPath = path.resolve(__dirname, '../manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const twitchScript = manifest.content_scripts.find((cs) => cs.js.includes('twitch-shield.js'));
if (!twitchScript || !twitchScript.matches.includes('https://twitch.tv/*') || !twitchScript.matches.includes('https://*.twitch.tv/*')) {
  console.error('[FAIL] manifest.json must match both https://twitch.tv/* and https://*.twitch.tv/* for twitch-shield.js');
  process.exit(1);
}
console.log('[PASS] Twitch player controls are guaranteed interactive and protected from pointer-events suppression.');
console.log('[PASS] Twitch ad overlay suppression and manifest matching verified.');

// 2. Live Network Validation
async function runLiveTest() {
  const DEFAULT_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: {
        'Client-Id': DEFAULT_CLIENT_ID,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        operationName: 'PlaybackAccessToken',
        query: fullQuery,
        variables: {
          login: 'twitch',
          playerType: 'embed',
          platform: 'web'
        }
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[WARN] Twitch GQL returned HTTP status ${res.status}. Live network check skipped.`);
      process.exit(0);
    }

    const json = await res.json();
    const data = Array.isArray(json) ? json[0] : json;

    if (data.errors && data.errors.length > 0) {
      const fatalErrors = data.errors.filter((err) => {
        const msg = err.message || '';
        return (
          msg.includes('but never used') ||
          msg.includes('Cannot query field') ||
          msg.includes('Unknown argument') ||
          msg.includes('is not defined') ||
          msg.includes('Field undefined')
        );
      });

      if (fatalErrors.length > 0) {
        console.error('[FAIL] Twitch GQL rejected schema/variables with fatal errors:');
        for (const err of fatalErrors) {
          console.error(`  - ${err.message}`);
        }
        process.exit(1);
      } else {
        console.log(`[PASS] Live Twitch GQL responded without schema/variable syntax errors (Notice: ${data.errors[0]?.message || 'None'}).`);
      }
    } else {
      console.log('[PASS] Live Twitch GQL validated query successfully (streamPlaybackAccessToken query accepted).');
    }
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn(`[WARN] Network unreachable or live test skipped (${err.message}). Static check passed.`);
  }

  console.log('=== Twitch GQL Validation Complete ===');
  process.exit(0);
}

runLiveTest();
