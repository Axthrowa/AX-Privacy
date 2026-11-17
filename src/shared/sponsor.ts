import { L } from './i18n.ts';

/** SponsorBlock categories (https://wiki.sponsor.ajay.app/w/Segment_Categories), as the dashboard lists them. */
export const SPONSOR_CATEGORIES = [
  'sponsor',
  'selfpromo',
  'interaction',
  'intro',
  'outro',
  'preview',
  'hook',
  'filler',
  'music_offtopic',
  'poi_highlight',
  'exclusive_access',
  'chapter',
] as const;
export type SponsorCategory = (typeof SPONSOR_CATEGORIES)[number];

/** Off, marked on the timeline only, a button to skip, or skipped on its own. */
export const SKIP_MODES = ['off', 'show', 'manual', 'auto'] as const;
export type SkipMode = (typeof SKIP_MODES)[number];

export const isSponsorCategory = (v: unknown): v is SponsorCategory =>
  (SPONSOR_CATEGORIES as readonly unknown[]).includes(v);
export const isSkipMode = (v: unknown): v is SkipMode =>
  (SKIP_MODES as readonly unknown[]).includes(v);

export const DEFAULT_SPONSOR_MODES: Readonly<Record<SponsorCategory, SkipMode>> = {
  sponsor: 'auto',
  selfpromo: 'auto',
  interaction: 'auto',
  intro: 'manual',
  outro: 'manual',
  preview: 'manual',
  hook: 'off',
  filler: 'off',
  // Only music videos carry this category, so "auto" acts on YouTube Music and music videos alone.
  music_offtopic: 'auto',
  poi_highlight: 'manual',
  exclusive_access: 'show',
  chapter: 'off',
};

/** Full mode map from untrusted input: unknown keys dropped, bad values back to the default. */
export function sponsorModes(raw: unknown): Record<SponsorCategory, SkipMode> {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_SPONSOR_MODES };
  for (const c of SPONSOR_CATEGORIES) {
    const m = r[c];
    if (isSkipMode(m)) out[c] = m;
  }
  return out;
}

const MAX_CHANNELS = 500;

/**
 * A channel as the exception list stores it: "@handle" (lower case, YouTube treats it so) or a
 * channel ID. Accepts a bare value or a channel URL; anything else is null.
 */
export function channelKey(raw: string): string | null {
  const s = raw.trim();
  const handle = /(?:^|\/)(@[\w.-]{3,30})(?:[/?#]|$)/.exec(s)?.[1];
  if (handle) return handle.toLowerCase();
  return /(?:^|\/)(UC[\w-]{22})(?:[/?#]|$)/.exec(s)?.[1] ?? null;
}

export function channelList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const keys = raw.map((v) => (typeof v === 'string' ? channelKey(v) : null));
  return [...new Set(keys.filter((k): k is string => k !== null))].slice(0, MAX_CHANNELS);
}

/** Names and SponsorBlock's own colors, shared by the dashboard and the player UI. */
export const SPONSOR_LABELS: Readonly<Record<SponsorCategory, { name: string; color: string }>> = {
  sponsor: { name: 'Sponsor', color: '#00d400' },
  selfpromo: { name: L('Kendi tanıtımı', 'Self-promotion'), color: '#ffff00' },
  interaction: {
    name: L('Abone ol / beğen hatırlatması', 'Subscribe / like reminder'),
    color: '#cc00ff',
  },
  intro: { name: L('Giriş', 'Intro'), color: '#00ffff' },
  outro: { name: L('Bitiş ve jenerik', 'Outro and credits'), color: '#0202ed' },
  preview: { name: L('Ön izleme / özet', 'Preview / recap'), color: '#008fd6' },
  hook: { name: L('Dikkat çekme / selamlama', 'Hook / greeting'), color: '#395699' },
  filler: { name: L('Konu dışı', 'Filler / tangent'), color: '#7300ff' },
  music_offtopic: {
    name: L('Müzik videosunda müzik dışı bölüm', 'Non-music part of a music video'),
    color: '#ff9900',
  },
  poi_highlight: { name: L('Videonun önemli anı', 'Highlight'), color: '#ff1684' },
  exclusive_access: {
    name: L('Tüm video sponsorlu / özel erişim', 'Whole video sponsored / exclusive access'),
    color: '#008a5c',
  },
  chapter: { name: L('Gönüllü bölüm başlıkları', 'Volunteer chapter titles'), color: '#ffd679' },
};
