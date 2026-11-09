import type { Settings } from '../shared/types.ts';

/**
 * WebRTC may hand pages the computer's local addresses, and behind a VPN the real public one.
 * Only the default route's public address is then used, which is the one sites already see.
 */
export async function applyWebRtcPolicy(s: Settings): Promise<void> {
  const policy = chrome.privacy?.network?.webRTCIPHandlingPolicy;
  if (!policy) return;
  if (s.enabled && s.privacy.hideLocalIps) {
    await policy.set({ value: 'default_public_interface_only' });
  } else {
    // Gives the setting back to the browser, and to any choice the user made there.
    await policy.clear({});
  }
}
