import { expect, test } from './fixtures.ts';

/**
 * Zero telemetry: while the user browses and opens the popup and dashboard, nothing the extension
 * runs (service worker, popup, dashboard) requests anything but its own files. List downloads are
 * the one allowed exception and only run on the update schedule, which this test does not reach.
 */
test('the extension itself sends no requests while browsing', async ({
  context,
  extensionId,
  origin,
}) => {
  const own = `chrome-extension://${extensionId}/`;
  // Playwright reports the service worker's requests too, with no frame.
  const seen: string[] = [];
  context.on('request', (r) => {
    const from = r.serviceWorker()?.url() ?? r.frame().url();
    if (from.startsWith(own)) seen.push(r.url());
  });

  const page = await context.newPage();
  await page.goto(`${origin}/`);
  await page.reload();
  const popup = await context.newPage();
  await popup.goto(`${own}popup.html`);
  await popup.waitForLoadState('networkidle');
  const dash = await context.newPage();
  for (const tab of ['overview', 'lists', 'privacy', 'advanced', 'brain']) {
    await dash.goto(`${own}dashboard.html#${tab}`);
    await dash.waitForLoadState('networkidle');
  }
  await page.goto(`${origin}/?again`);
  await page.waitForTimeout(1500);

  const outside = seen.filter(
    (u) => !u.startsWith(own) && !u.startsWith('data:') && !u.startsWith('blob:'),
  );
  expect(outside).toEqual([]);
  expect(seen.length).toBeGreaterThan(0);
});
