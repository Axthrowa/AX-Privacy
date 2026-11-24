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

/**
 * The browser's own ad features (Chromium): interest topics, on-device ad auctions and ad
 * measurement, plus `<a ping>` click reports and link preloading. Off while AX asks for it; given back otherwise.
 * Firefox has none of these, so nothing happens there.
 */
export async function applyBrowserPrivacy(s: Settings): Promise<void> {
  const w = chrome.privacy?.websites as Partial<typeof chrome.privacy.websites> | undefined;
  const choices: [chrome.types.ChromeSetting<boolean> | undefined, boolean][] = [
    [w?.topicsEnabled, s.privacy.browserAdApis],
    [w?.fledgeEnabled, s.privacy.browserAdApis],
    [w?.adMeasurementEnabled, s.privacy.browserAdApis],
    [w?.hyperlinkAuditingEnabled, s.privacy.cleanLinks],
    // Preloading links the user never opened tells their sites about the visit anyway.
    [chrome.privacy?.network?.networkPredictionEnabled, s.privacy.cleanLinks],
  ];
  await Promise.all(
    choices.map(async ([setting, off]) => {
      if (!setting) return;
      await (s.enabled && off ? setting.set({ value: false }) : setting.clear({})).catch(
        () => undefined,
      );
    }),
  );
}
