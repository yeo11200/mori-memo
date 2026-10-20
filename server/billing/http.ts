import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { BILLING_POLICY, PRO_AMOUNT, handleBillingEmail, handleBillingId, type AuthTokens } from '../../shared/billing';
import { BillingError, BillingService } from './service';
import { RemoteError, handleJSONRequest } from './adapters';

export interface HTTPConfig {
  origin: string; supabaseURL: string; anonKey: string; tossClientKey: string;
  cronSecret: string; termsURL: string; privacyURL: string; fetcher?: typeof fetch;
}
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
const html = (body: string, nonce = '') => new Response(body, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}' https://js.tosspayments.com; connect-src https://*.tosspayments.com; frame-src https://*.tosspayments.com; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` } });
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const tokenEqual = (a: string, b: string) => { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); };
const safeSession = (data: any): AuthTokens => {
  if (typeof data?.access_token !== 'string' || typeof data?.refresh_token !== 'string' || !Number.isFinite(data.expires_in) || typeof data.user?.email !== 'string') throw new BillingError('로그인 응답을 확인하지 못했습니다.', 502);
  return { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Math.floor(Date.now() / 1000) + data.expires_in, user: { id: handleBillingId(data.user.id), email: handleBillingEmail(data.user.email) } };
};
export const handleBillingHTTP = (service: BillingService, config: HTTPConfig) => {
  const fetcher = config.fetcher || fetch;
  const auth = (path: string, method: string, body?: unknown, accessToken?: string) => handleJSONRequest(fetcher, config.supabaseURL + '/auth/v1/' + path, { method, headers: { apikey: config.anonKey, 'Content-Type': 'application/json', ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return async (request: Request, remoteIP = 'local'): Promise<Response> => {
    try {
      const url = new URL(request.url); const path = url.pathname;
      // Browser JSON callers must not be able to use this desktop API cross-site.
      const origin = request.headers.get('origin');
      if (origin && origin !== config.origin) return reply({ error: '허용되지 않은 요청입니다.' }, 403);
      const ipHash = createHash('sha256').update(config.cronSecret + remoteIP).digest('hex');
      await service.store.rateLimit('ip:' + ipHash, 180, 60);
      const readBody = async () => {
        const text = await request.text();
        if (text.length > 16000) throw new BillingError('요청이 너무 큽니다.', 413);
        try { const data = JSON.parse(text || '{}'); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); return data; }
        catch { throw new BillingError('요청 형식을 확인해 주세요.'); }
      };
      if (path === '/health' && request.method === 'GET') return reply({ ok: true });
      if (path === '/auth/email-code' && request.method === 'POST') {
        const email = handleBillingEmail((await readBody()).email);
        await service.store.rateLimit('email:' + createHash('sha256').update(email.toLowerCase()).digest('hex'), 1, 60);
        try { await auth('otp', 'POST', { email, create_user: true }); }
        catch (error) { if (!(error instanceof RemoteError) || error.status === 429 || error.status >= 500) throw error; }
        return reply({ ok: true });
      }
      if (path === '/auth/verify' && request.method === 'POST') {
        const body = await readBody(); const email = handleBillingEmail(body.email);
        if (typeof body.code !== 'string' || !/^\d{6,10}$/.test(body.code)) throw new BillingError('이메일 인증 코드를 확인해 주세요.');
        await service.store.rateLimit('verify:' + createHash('sha256').update(email.toLowerCase()).digest('hex'), 5, 600);
        return reply(safeSession(await auth('verify', 'POST', { email, token: body.code, type: 'email' })));
      }
      if (path === '/auth/refresh' && request.method === 'POST') {
        const body = await readBody();
        if (typeof body.refresh_token !== 'string' || body.refresh_token.length > 10000) throw new BillingError('다시 로그인해 주세요.', 401);
        return reply(safeSession(await auth('token?grant_type=refresh_token', 'POST', { refresh_token: body.refresh_token })));
      }
      if (path.startsWith('/jobs/')) {
        if (!tokenEqual(request.headers.get('authorization') || '', 'Bearer ' + config.cronSecret)) throw new BillingError('인증이 필요합니다.', 401);
        if (path === '/jobs/billing' && request.method === 'POST') return reply(await service.job());
        if (path === '/jobs/refund' && request.method === 'POST') { await service.approveRefund(handleBillingId((await readBody()).userId)); return reply({ ok: true }); }
        throw new BillingError('요청을 찾을 수 없습니다.', 404);
      }
      if (path.startsWith('/checkout/') && request.method === 'GET') {
        const [id, checkoutId] = path.slice('/checkout/'.length).split('/');
        const token = url.searchParams.get('token') || '';
        if (token.length > 120) throw new BillingError('결제 링크를 확인해 주세요.');
        const page = await service.checkoutPage(id, checkoutId, token);
        const nonce = randomBytes(18).toString('base64');
        const successURL = config.origin + '/billing/callback?user=' + id + '&session=' + checkoutId + '&nonce=' + encodeURIComponent(token);
        const data = JSON.stringify({ client: config.tossClientKey, customer: page.customerKey, success: successURL, failure: config.origin + '/billing/result' }).replace(/</g, '\\u003c');
        return html(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>MORI Pro 결제</title><style nonce="${nonce}">body{max-width:540px;margin:10vh auto;padding:24px;font:16px/1.8 system-ui;color:#172c42}button{padding:12px;margin:20px 0}label{display:block}</style><h1>${page.purpose === 'purchase' ? 'MORI Pro · 월 2,900원' : '결제수단 변경'}</h1><p>매월 자동 갱신하며, 갱신 실패 시 24시간·72시간 뒤 최대 두 번 재시도합니다. 설정에서 언제든 다음 결제를 중단할 수 있습니다. AI 제공자 이용료는 별도입니다.${page.purpose === 'purchase' ? ' 지금 결제하면 무료 체험이 끝나고 유료 한 달이 시작됩니다.' : ' 카드 변경만으로 추가 결제하지 않습니다.'}</p><p><a href="${escape(config.termsURL)}" target="_blank" rel="noreferrer">이용·환불 조건</a> · <a href="${escape(config.privacyURL)}" target="_blank" rel="noreferrer">개인정보 처리</a></p><label><input id="consent" type="checkbox">위 조건과 월 2,900원 정기결제에 동의합니다.</label><button id="pay" disabled>카드 등록하기</button><p id="status" role="status"></p><script src="https://js.tosspayments.com/v2/standard"></script><script nonce="${nonce}">const c=${data};const b=document.getElementById('pay');document.getElementById('consent').onchange=e=>b.disabled=!e.target.checked;b.onclick=async()=>{b.disabled=true;try{await TossPayments(c.client).payment({customerKey:c.customer}).requestBillingAuth({method:'CARD',successUrl:c.success,failUrl:c.failure})}catch{document.getElementById('status').textContent='카드 등록이 완료되지 않았습니다. 앱에서 다시 확인해 주세요.';b.disabled=false}}</script></html>`, nonce);
      }
      if (path === '/billing/callback' && request.method === 'GET') {
        try { await service.callback(url.searchParams.get('user') || '', url.searchParams.get('session') || '', url.searchParams.get('nonce') || '', url.searchParams.get('customerKey') || '', url.searchParams.get('authKey') || ''); }
        catch { /* Outcome is read through the authenticated desktop API. Never reflect callback secrets. */ }
        return new Response(null, { status: 303, headers: { ...headers, Location: config.origin + '/billing/result' } });
      }
      if (path === '/billing/result' && request.method === 'GET') return html('<!doctype html><html lang="ko"><meta charset="utf-8"><title>MORI 구매 확인</title><h1>MORI 앱에서 구매를 확인해 주세요</h1><p>앱의 ‘구매 복원·상태 확인’을 누르세요. 이 화면만으로 결제 성공을 의미하지는 않습니다.</p></html>');
      if (path === '/webhooks/toss' && request.method === 'POST') {
        const body = await readBody(); const order = body?.data?.orderId;
        if (typeof order === 'string' && /^mori-[a-f0-9-]{36}$/.test(order)) {
          const owner = await service.store.ownerOfOrder(order);
          if (owner) await service.reconcile(owner, order);
        }
        return reply({ ok: true });
      }
      const bearer = request.headers.get('authorization');
      if (!bearer?.startsWith('Bearer ') || bearer.length > 16000) throw new BillingError('이메일로 로그인해 주세요.', 401);
      const user = await auth('user', 'GET', undefined, bearer.slice(7));
      if (!user?.email_confirmed_at) throw new BillingError('이메일 인증이 필요합니다.', 401);
      const id = handleBillingId(user.id);
      await service.store.rateLimit('user:' + id, 120, 60);
      await service.ensure(id, handleBillingEmail(user.email));
      const deviceId = url.searchParams.get('device') || undefined;
      if (deviceId) handleBillingId(deviceId);
      if (path === '/me' && request.method === 'GET') return reply(await service.entitlements(id, deviceId));
      if (path === '/entitlements' && request.method === 'GET') return reply(await service.entitlements(id, deviceId));
      if (path === '/devices' && request.method === 'POST') { const body = await readBody(); await service.register(id, body.id, body.name); return reply(await service.entitlements(id, body.id)); }
      if (path.startsWith('/devices/') && request.method === 'DELETE') { await service.revoke(id, path.slice(9)); return reply({ ok: true }); }
      if (path === '/trials' && request.method === 'POST') { const body = await readBody(); if (body.policy !== BILLING_POLICY) throw new BillingError('체험 조건을 확인해 주세요.'); return reply(await service.trial(id, handleBillingId(body.deviceId))); }
      if (path === '/checkout-sessions' && request.method === 'POST') {
        const body = await readBody(); return reply(await service.checkout(id, body.requestId, body.deviceId, body.policy, body.purpose));
      }
      if (path === '/subscription/cancel' && request.method === 'POST') { await service.cancel(id); return reply(await service.entitlements(id, deviceId)); }
      if (path === '/subscription/resume' && request.method === 'POST') { await service.cancel(id, true); return reply(await service.entitlements(id, deviceId)); }
      if (path === '/purchase-restore' && request.method === 'POST') { await service.reconcile(id); return reply(await service.entitlements(id, deviceId)); }
      if (path === '/refund-requests' && request.method === 'POST') { const body = await readBody(); await service.requestRefund(id, handleBillingId(body.paymentId)); return reply({ received: true }, 202); }
      if (path === '/auth/logout' && request.method === 'POST') { await auth('logout?scope=local', 'POST', undefined, bearer.slice(7)); return reply({ ok: true }); }
      throw new BillingError('요청을 찾을 수 없습니다.', 404);
    } catch (error) {
      if (error instanceof BillingError) return reply({ error: error.message }, error.status);
      if (error instanceof RemoteError) return reply({ error: error.status === 429 ? '요청이 많습니다. 잠시 뒤 다시 시도해 주세요.' : error.status === 401 || error.status === 403 ? '인증이 만료되었거나 코드를 확인하지 못했습니다. 다시 로그인해 주세요.' : '외부 연결을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' }, error.status === 429 ? 429 : error.status === 401 || error.status === 403 ? 401 : 503);
      return reply({ error: '요청을 완료하지 못했습니다. 입력과 연결 상태를 확인해 주세요.' }, 400);
    }
  };
};
