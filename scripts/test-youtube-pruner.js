/**
 * YouTube Response Pruner Unit Tests
 * Validates that pruneAdData in youtube-shield.js strips ad placements and anti-adblock modals
 * while safely preserving video playback structures (videoDetails, streamingData, playabilityStatus).
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const shieldPath = path.resolve(__dirname, '../youtube-shield.js');

console.log('=== YouTube Player Response Pruner Test Suite ===');

if (!fs.existsSync(shieldPath)) {
  console.error(`[FAIL] youtube-shield.js not found at ${shieldPath}`);
  process.exit(1);
}

const source = fs.readFileSync(shieldPath, 'utf8');

// Extract pruneAdData function from youtube-shield.js
const pruneFnMatch = source.match(/function\s+pruneAdData\s*\([\s\S]*?return\s+obj;\s*\}/);
if (!pruneFnMatch) {
  console.error('[FAIL] Could not locate pruneAdData function in youtube-shield.js');
  process.exit(1);
}

const context = {};
vm.runInNewContext(`${pruneFnMatch[0]}; prune = pruneAdData;`, context);
const pruneAdData = context.prune;

if (typeof pruneAdData !== 'function') {
  console.error('[FAIL] Extracted pruneAdData is not a function');
  process.exit(1);
}

// Test Case 1: Standard Player Response with ads & critical playback fields
const mockPlayerResponse = {
  videoDetails: {
    videoId: 'dQw4w9WgXcQ',
    title: 'Never Gonna Give You Up',
    lengthSeconds: '213'
  },
  streamingData: {
    expiresInSeconds: '21599',
    formats: [{ itag: 18, mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"' }]
  },
  playabilityStatus: {
    status: 'OK',
    playableInEmbed: true
  },
  adPlacements: [
    { adPlacementRenderer: { config: { kind: 'AD_PLACEMENT_KIND_START' } } }
  ],
  playerAds: [
    { playerAdRenderer: { adId: 'ad-xyz-123' } }
  ],
  adSlots: [
    { slotId: 'slot-midroll-1' }
  ],
  adBreakHeartbeatParams: 'test_heartbeat_params',
  auxiliaryUi: {
    messageRenderers: {
      bkaEnforcementMessageViewModel: {
        title: 'Ad blockers violate YouTube Terms of Service'
      },
      enforcementMessageViewModel: {
        title: 'Playback blocked'
      },
      legitimateNotification: {
        text: 'Join channel membership'
      }
    }
  }
};

const result = pruneAdData(JSON.parse(JSON.stringify(mockPlayerResponse)));

// Assertions
let failed = false;

// 1. Ads removed
if (result.adPlacements !== undefined) {
  console.error('[FAIL] adPlacements was not deleted');
  failed = true;
} else {
  console.log('[PASS] adPlacements successfully deleted');
}

if (result.playerAds !== undefined) {
  console.error('[FAIL] playerAds was not deleted');
  failed = true;
} else {
  console.log('[PASS] playerAds successfully deleted');
}

if (result.adSlots !== undefined) {
  console.error('[FAIL] adSlots was not deleted');
  failed = true;
} else {
  console.log('[PASS] adSlots successfully deleted');
}

if (result.adBreakHeartbeatParams !== undefined) {
  console.error('[FAIL] adBreakHeartbeatParams was not deleted');
  failed = true;
} else {
  console.log('[PASS] adBreakHeartbeatParams successfully deleted');
}

// 2. Anti-adblock enforcement modal removed
if (result.auxiliaryUi?.messageRenderers?.bkaEnforcementMessageViewModel !== undefined) {
  console.error('[FAIL] bkaEnforcementMessageViewModel was not deleted');
  failed = true;
} else {
  console.log('[PASS] bkaEnforcementMessageViewModel successfully deleted');
}

if (result.auxiliaryUi?.messageRenderers?.enforcementMessageViewModel !== undefined) {
  console.error('[FAIL] enforcementMessageViewModel was not deleted');
  failed = true;
} else {
  console.log('[PASS] enforcementMessageViewModel successfully deleted');
}

// 3. Normal UI preserved
if (result.auxiliaryUi?.messageRenderers?.legitimateNotification?.text !== 'Join channel membership') {
  console.error('[FAIL] Legitimate auxiliary message was inadvertently modified');
  failed = true;
} else {
  console.log('[PASS] Legitimate auxiliary UI preserved');
}

// 4. Critical playback structures preserved
if (
  !result.videoDetails ||
  result.videoDetails.videoId !== 'dQw4w9WgXcQ' ||
  !result.streamingData ||
  result.streamingData.formats.length === 0 ||
  result.playabilityStatus?.status !== 'OK'
) {
  console.error('[FAIL] Critical playback data (videoDetails/streamingData/playabilityStatus) was damaged');
  failed = true;
} else {
  console.log('[PASS] Playback structures (videoDetails, streamingData, playabilityStatus) intact and unchanged');
}

// Test Case 2: Nested playerResponse structure
const mockNextResponse = {
  responseContext: { visitorData: 'test' },
  playerResponse: {
    videoDetails: { videoId: 'abc-123' },
    adPlacements: [{ dummy: true }],
    auxiliaryUi: {
      messageRenderers: {
        bkaEnforcementMessageViewModel: { alert: true }
      }
    }
  }
};

const nextResult = pruneAdData(JSON.parse(JSON.stringify(mockNextResponse)));
if (
  nextResult.playerResponse?.adPlacements !== undefined ||
  nextResult.playerResponse?.auxiliaryUi?.messageRenderers?.bkaEnforcementMessageViewModel !== undefined
) {
  console.error('[FAIL] Nested playerResponse ad structures were not deleted');
  failed = true;
} else if (nextResult.playerResponse?.videoDetails?.videoId !== 'abc-123') {
  console.error('[FAIL] Nested videoDetails was damaged');
  failed = true;
} else {
  console.log('[PASS] Nested playerResponse structures correctly sanitized');
}

// Test Case 3: Verify YouTube critical domain exemption from filter parsing
import { parseFilterLine } from '../background.js';
const testCriticalDomains = [
  '||youtube.com^',
  '||www.youtube.com^',
  '||m.youtube.com^',
  '||music.youtube.com^',
  '||googlevideo.com^',
  '||ytimg.com^',
  '||ggpht.com^',
  '||youtubei.googleapis.com^'
];
for (const raw of testCriticalDomains) {
  const parsed = parseFilterLine(raw);
  if (parsed !== null) {
    console.error(`[FAIL] parseFilterLine should exclude critical YouTube host: ${raw}`);
    failed = true;
  }
}
console.log('[PASS] Critical YouTube domains are exempted from filter parsing');

// Test Case 4: Verify youtube-shield.js cosmetic protection contains sidebar visibility
if (
  source.includes('ytd-guide-renderer') &&
  source.includes('tp-yt-app-drawer') &&
  source.includes('#guide') &&
  source.includes('visibility: visible !important')
) {
  console.log('[PASS] YouTube shield contains sidebar and guide visibility protection rules');
} else {
  console.error('[FAIL] Missing sidebar/guide visibility protection rules in youtube-shield.js');
  failed = true;
}

if (failed) {
  console.error('=== YouTube Pruner Tests FAILED ===');
  process.exit(1);
} else {
  console.log('=== All YouTube Pruner Tests PASSED (0 errors) ===');
  process.exit(0);
}
