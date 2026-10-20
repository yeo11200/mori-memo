import { _electron as electron, expect } from '@playwright/test';
import { build } from 'esbuild';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = await mkdtemp(join(tmpdir(), 'mori-billing-smoke-'));
const modulePath = join(directory, 'fixture.mjs');
await build({ entryPoints: ['Tests/billing-server-fixture.ts'], bundle: true, platform: 'node', format: 'esm', outfile: modulePath });
const { startBillingFixture } = await import(pathToFileURL(modulePath).href);
const fixture = await startBillingFixture();
const app = await electron.launch({ args: [resolve('.')], env: { ...process.env, WIKI_DATA_DIR: directory, MORI_COMMERCIAL_BUILD: '1', MORI_BILLING_URL: fixture.url, MORI_BILLING_PUBLIC_KEYS: JSON.stringify(fixture.keys) } });
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.wiki);
  const bypass = await page.evaluate(async () => {
    try { await window.wiki.handleSaveReportTemplate({ id: '', name: '우회 시도', headings: ['성과'], instruction: '' }); return true; }
    catch { return false; }
  });
  expect(bypass).toBe(false);
  await page.getByTitle('설정', { exact: true }).click();
  const account = page.getByRole('region', { name: '계정 및 Pro' });
  await account.getByLabel('MORI 계정 이메일').fill('billing@example.com');
  await account.getByRole('button', { name: '이메일 인증 코드 받기' }).click();
  await account.getByLabel('MORI 이메일 인증 코드').fill('123456');
  await account.getByRole('button', { name: '이메일로 로그인', exact: true }).click();
  await expect(account.getByRole('button', { name: '14일 무료 체험 시작' })).toBeVisible();
  await account.getByRole('checkbox').check();
  await account.getByRole('button', { name: '14일 무료 체험 시작' }).click();
  await expect(account).toContainText('Pro 무료 체험');
  const granted = await page.evaluate(() => window.wiki.handleBillingState(true));
  expect(granted.capabilities).toContain('reports.ai_generate');
  expect(granted.capabilities).toContain('reports.template_write');
  expect(await readFile(join(directory, 'auth', 'session.bin'), 'utf8')).not.toContain('fixture-refresh');
  await page.evaluate(() => window.wiki.handleSaveReportTemplate({ id: '', name: '구매 전 체험 양식', headings: ['성과'], instruction: '간결하게' }));
  // Simulate the hosted browser/PG round trip through the real billing service, without any external payment.
  const checkout = await fixture.service.checkout(fixture.user, crypto.randomUUID(), granted.deviceId, '2026-10-20-v1', 'purchase');
  await fixture.service.callback(fixture.user, checkout.id, new URL(checkout.url).searchParams.get('token'), (await fixture.store.get(fixture.user)).customerKey, 'fixture-auth');
  await account.getByRole('button', { name: '구매 복원·상태 확인' }).click();
  await expect(account).toContainText('Pro 이용 중');
  await account.getByRole('button', { name: '다음 결제 해지' }).click();
  await expect(account).toContainText('해지 예약');
  expect(fixture.gateway.payments.size).toBe(1);
  await page.screenshot({ path: join(directory, 'account.png') });
  await account.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(account.getByLabel('MORI 계정 이메일')).toBeVisible();
  const locked = await page.evaluate(() => window.wiki.handleBillingState());
  expect(locked.capabilities).toEqual([]);
  const templates = await page.evaluate(() => window.wiki.handleReportTemplates());
  expect(templates.some(item => item.name === '구매 전 체험 양식')).toBe(true);
  console.log(JSON.stringify({ ok: true, directory, checks: ['main-process gate', 'email OTP', 'trial', 'encrypted session', 'template grant', 'payment restore', 'cancel retains time', 'logout clears grant', 'existing templates readable'] }));
} finally {
  await app.close(); await fixture.close();
}
