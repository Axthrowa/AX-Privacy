export const FIREFOX_ID = 'ax-privacy@axthrowa.local';
/** First release supporting `data_collection_permissions` (also covers MAIN-world scripts, 128+). */
export const FIREFOX_MIN_VERSION = '140.0';
export const FIREFOX_ANDROID_MIN_VERSION = '142.0';

interface ChromeManifest {
  background: { service_worker: string; type?: string };
  minimum_chrome_version?: string;
  [key: string]: unknown;
}

/** Firefox MV3 has no extension service workers; it runs the same module as a background script. */
export function toFirefoxManifest(chrome: ChromeManifest): Record<string, unknown> {
  const { background, ...rest } = structuredClone(chrome);
  delete rest.minimum_chrome_version;
  // Firefox rejects `use_dynamic_url`; its extension URLs are already random per install.
  const resources = rest.web_accessible_resources as { use_dynamic_url?: boolean }[] | undefined;
  for (const entry of resources ?? []) delete entry.use_dynamic_url;
  return {
    ...rest,
    background: { scripts: [background.service_worker], type: 'module' },
    browser_specific_settings: {
      gecko: {
        id: FIREFOX_ID,
        strict_min_version: FIREFOX_MIN_VERSION,
        data_collection_permissions: { required: ['none'] },
      },
      gecko_android: { strict_min_version: FIREFOX_ANDROID_MIN_VERSION },
    },
  };
}
