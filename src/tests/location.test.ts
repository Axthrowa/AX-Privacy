import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyBrowserPrivacy } from '../background/location.ts';
import { DEFAULT_SETTINGS } from '../storage/settings.ts';
import type { Settings } from '../shared/types.ts';

const setting = () => ({ set: vi.fn(async () => undefined), clear: vi.fn(async () => undefined) });

function stubPrivacy() {
  const prediction = setting();
  const ping = setting();
  vi.stubGlobal('chrome', {
    privacy: {
      network: { networkPredictionEnabled: prediction },
      websites: { hyperlinkAuditingEnabled: ping },
    },
  });
  return { prediction, ping };
}

describe('applyBrowserPrivacy', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('turns off link preloading and pings with the link cleaner', async () => {
    const { prediction, ping } = stubPrivacy();
    await applyBrowserPrivacy(structuredClone(DEFAULT_SETTINGS) as Settings);
    expect(prediction.set).toHaveBeenCalledWith({ value: false });
    expect(ping.set).toHaveBeenCalledWith({ value: false });
  });

  it('gives both back to the browser when protection is off', async () => {
    const { prediction, ping } = stubPrivacy();
    await applyBrowserPrivacy({ ...structuredClone(DEFAULT_SETTINGS), enabled: false } as Settings);
    expect(prediction.clear).toHaveBeenCalled();
    expect(ping.clear).toHaveBeenCalled();
    expect(prediction.set).not.toHaveBeenCalled();
  });
});
