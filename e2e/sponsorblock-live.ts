/**
 * Manual check that the real SponsorBlock API still answers in the format AX parses.
 * Sends one hash-prefix request, as the extension does. Not part of CI.
 * Usage: node e2e/sponsorblock-live.ts [videoId]
 */
import { segmentsFor, segmentsUrl } from '../src/engines/video/sponsorblock.ts';

const id = process.argv[2] ?? 'dQw4w9WgXcQ';
const url = await segmentsUrl(id);
const res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
const body: unknown = res.status === 404 ? [] : await res.json();
console.log(
  JSON.stringify(
    {
      url,
      status: res.status,
      videosInBucket: Array.isArray(body) ? body.length : null,
      // Another video of the same bucket, to try a positive match without a second lookup.
      sameBucket: Array.isArray(body)
        ? (body[0] as { videoID?: string } | undefined)?.videoID
        : null,
      segments: segmentsFor(body, id),
    },
    null,
    2,
  ),
);
