import type { Config } from '@ghostery/adblocker';

/**
 * Shared by the build (built-in lists) and the runtime (user lists) so engines can be merged.
 * Network filters must load for `$elemhide`/`$generichide` exceptions to work, so callers feed
 * the engine only cosmetic lines and those exceptions (see `filters/custom.ts`).
 */
export const COSMETIC_ENGINE_CONFIG: Partial<Config> = {
  loadNetworkFilters: true,
  loadCSPFilters: false,
  loadCosmeticFilters: true,
  loadGenericCosmeticsFilters: true,
  loadExtendedSelectors: true,
  loadExceptionFilters: true,
  enableHtmlFiltering: false,
  loadPreprocessors: false,
};
