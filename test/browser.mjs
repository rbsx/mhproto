import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { parse } from 'yaml';
import { packageRoot } from '../src/core.mjs';
import { serve, exportViewer } from '../src/server.mjs';
import { createBrowserFixture } from './browser-fixture.mjs';

const artifacts = path.join(packageRoot, 'test-results/browser');
const apiRoute = '#/features/example/api/getStatus';
const waitForViewer = async (page, heading) => {
  await page.waitForFunction(
    (title) =>
      globalThis.mhprotoReady && document.querySelector('#content h1')?.textContent === title,
    heading,
  );
  await page.evaluate(() => globalThis.mhprotoReady);
};
const closeServer = (server) =>
  !server.listening
    ? Promise.resolve()
    : new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );

async function attachLink(page, title) {
  const heading = page.locator('.io-heading').last();
  const button = heading.locator('[data-add-visual]');
  await heading.hover();
  await button.focus();
  await page.keyboard.press('Enter');
  const form = page.locator('.visual-form');
  await form.locator('[name=title]').fill(title);
  await form.locator('[name=url]').fill('https://example.com/design');
  await form.getByRole('button', { name: 'Attach', exact: true }).click();
  await page.evaluate(() => globalThis.mhprotoAttachmentReady);
  await waitForViewer(page, 'GET /status');
  assert.equal(await page.locator('.visual').filter({ hasText: title }).count(), 1);
}

test('browser release flows', { timeout: 120000 }, async (t) => {
  await mkdir(artifacts, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const [name, options] of [
      ['desktop', { viewport: { width: 1440, height: 1000 } }],
      ['mobile', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
    ])
      await t.test(name, async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'mhproto-browser-'));
        const context = await browser.newContext({ ...options, acceptDownloads: true });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        let live, portable;
        try {
          await createBrowserFixture(root);
          live = await serve(root, 0);
          const base = `http://127.0.0.1:${live.address().port}/`;
          assert.equal((await fetch(base + 'api/model')).status, 200);
          assert.equal(
            (
              await fetch(base + 'api/baseline', {
                method: 'POST',
                headers: {
                  origin: 'https://untrusted.example',
                  'content-type': 'application/json',
                },
                body: '{}',
              })
            ).status,
            403,
          );
          await page.goto(base);
          await waitForViewer(page, 'Status');
          assert.equal(await page.locator('.endpoint').count(), 2);
          assert.equal(await page.locator('h1').textContent(), 'Status');
          await page.screenshot({
            path: path.join(artifacts, name + '-overview.png'),
            fullPage: true,
          });
          await page.locator('.endpoint[data-operation=getStatus] .endpoint-heading a').click();
          await page.waitForURL('**/' + apiRoute);
          await waitForViewer(page, 'GET /status');
          assert.equal(await page.locator('.diagram-canvas svg').count(), 1);
          const owner = page
            .locator('.inline-object')
            .filter({ has: page.locator('summary a.type-link[href$="/types/User"]') })
            .first();
          assert.equal(await owner.getAttribute('open'), null);
          assert.equal(await owner.locator('.object-pill').textContent(), '{...}');
          assert.ok((await owner.locator('summary').textContent()).includes('| null'));
          await owner.locator('.object-pill').click();
          assert.notEqual(await owner.getAttribute('open'), null);
          assert.ok((await owner.textContent()).includes('email'));
          assert.equal(
            await page
              .locator('.signature [data-add-visual], .inline-object [data-add-visual]')
              .count(),
            0,
          );
          for (const section of await page.locator('.io-grid > section').all())
            assert.equal(await section.locator('[data-add-visual]').count(), 1);
          await owner.locator('summary a.type-link').click();
          await page.waitForURL('**/#/features/example/types/User');
          await waitForViewer(page, 'User');
          assert.equal(await page.locator('h1').textContent(), 'User');
          assert.equal(await page.locator('.type-usage-list a').count(), 2);
          await page.reload();
          await waitForViewer(page, 'User');
          assert.equal(await page.locator('h1').textContent(), 'User');
          await page.locator('.type-usage-list a[href$="/api/getStatus"]').click();
          await page.waitForURL('**/' + apiRoute);
          await waitForViewer(page, 'GET /status');
          await page.locator('.io-heading').last().hover();
          if (!options.isMobile)
            assert.equal(
              await page.locator('[data-add-visual]').evaluateAll(
                (buttons) =>
                  buttons.filter((button) => {
                    const style = getComputedStyle(button);
                    return (
                      !button.hidden &&
                      Number(style.opacity) > 0 &&
                      style.visibility !== 'hidden' &&
                      button.getClientRects().length
                    );
                  }).length,
              ),
              1,
            );
          const add = page.locator('.io-heading [data-add-visual]').last();
          await add.focus();
          await page.keyboard.press('Enter');
          await page.locator('[data-cancel-visual]').click();
          assert.equal(await add.evaluate((button) => document.activeElement === button), true);
          await attachLink(page, 'Persisted design');
          const stored = parse(await readFile(path.join(root, 'mhproto/visuals.yaml'), 'utf8'));
          assert.equal(stored.visuals[0].title, 'Persisted design');
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            true,
          );
          await page.screenshot({
            path: path.join(artifacts, name + '-endpoint.png'),
            fullPage: true,
          });
          await page.locator('#changes-link').click();
          await waitForViewer(page, 'Changes');
          assert.ok((await page.locator('#content').textContent()).includes('User'));
          const changedType = page
            .locator('a[href^="#/changes/"]')
            .filter({ hasText: 'User' })
            .first();
          await changedType.click();
          await waitForViewer(page, 'User');
          assert.ok((await page.locator('.diff-table').textContent()).includes('email'));
          await page.screenshot({
            path: path.join(artifacts, name + '-changes.png'),
            fullPage: true,
          });
          await exportViewer(root, path.join(root, 'preview'));
          let savedHTML;
          portable = createServer(async (request, response) => {
            try {
              const html =
                request.url === '/saved'
                  ? savedHTML
                  : request.url === '/'
                    ? await readFile(path.join(root, 'preview/viewer.html'))
                    : null;
              if (!html) return response.writeHead(404).end();
              response.writeHead(200, { 'content-type': 'text/html' }).end(html);
            } catch {
              response.writeHead(500).end();
            }
          });
          await new Promise((resolve, reject) => {
            portable.once('error', reject);
            portable.listen(0, '127.0.0.1', resolve);
          });
          const offline = `http://127.0.0.1:${portable.address().port}/`;
          const blocked = [];
          await page.route('**/*', (route) => {
            const url = route.request().url();
            if ([offline, offline + 'saved'].includes(url)) return route.continue();
            blocked.push(url);
            return route.abort();
          });
          await page.goto(offline + apiRoute);
          await waitForViewer(page, 'GET /status');
          assert.equal(await page.locator('.diagram-canvas svg').count(), 1);
          await attachLink(page, 'Offline design');
          const downloadEvent = page.waitForEvent('download');
          await page.locator('#save-preview').click();
          const download = await downloadEvent;
          const downloaded = path.join(root, 'saved.html');
          await download.saveAs(downloaded);
          savedHTML = await readFile(downloaded);
          await page.goto(offline + 'saved' + apiRoute);
          await waitForViewer(page, 'GET /status');
          assert.equal(
            await page.locator('.visual').filter({ hasText: 'Offline design' }).count(),
            1,
          );
          assert.deepEqual(blocked, []);
          await page.screenshot({
            path: path.join(artifacts, name + '-offline.png'),
            fullPage: true,
          });
          assert.deepEqual(errors, []);
        } catch (error) {
          await page
            .screenshot({ path: path.join(artifacts, name + '-failure.png'), fullPage: true })
            .catch(() => {});
          throw error;
        } finally {
          await writeFile(
            path.join(artifacts, name + '-console.json'),
            JSON.stringify(errors, null, 2),
          );
          await context.close();
          if (live) await closeServer(live);
          if (portable) await closeServer(portable);
          await rm(root, { recursive: true, force: true });
        }
      });
  } finally {
    await browser.close();
  }
});
