import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';

export interface GoogleClient { clientId: string; clientSecret: string }
export interface OAuthCode { code: string; verifier: string; redirectUri: string }
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
];

export const handleReadGoogleClient = (text: string): GoogleClient => {
  let value: { installed?: { client_id?: unknown; client_secret?: unknown } };
  try { value = JSON.parse(text); } catch { throw new Error('올바른 Google 클라이언트 JSON 파일을 선택해 주세요.'); }
  const clientId = value?.installed?.client_id;
  const clientSecret = value?.installed?.client_secret;
  if (typeof clientId !== 'string' || !/^[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId) || clientId.length > 300 ||
    typeof clientSecret !== 'string' || !clientSecret || clientSecret.length > 500 || /[\r\n]/.test(clientSecret)) {
    throw new Error('Google OAuth 유형이 데스크톱 앱인 JSON 파일이 필요합니다.');
  }
  return { clientId, clientSecret };
};

/** 시스템 브라우저와 loopback 주소로 인증하며 코드와 state를 화면에 출력하지 않습니다. */
export const handleGoogleAuthorization = (client: GoogleClient, open: (url: string) => Promise<void>, signal: AbortSignal, timeoutMs = 180_000): Promise<OAuthCode> =>
  new Promise((resolve, reject) => {
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    let redirectUri = '';
    let settled = false;
    const server = createServer((request, response) => {
      const url = new URL(request.url || '/', redirectUri || 'http://127.0.0.1');
      if (request.method !== 'GET' || url.pathname !== '/oauth2callback' || url.searchParams.get('state') !== state) {
        response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('유효하지 않은 인증 요청입니다.'); return;
      }
      const code = url.searchParams.get('code');
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'" });
      response.end(url.searchParams.has('error') || !code ? '연결이 취소되었습니다. MORI로 돌아가 주세요.' : '인증 응답을 받았습니다. MORI로 돌아가 연결 결과를 확인하세요.');
      if (url.searchParams.has('error') || !code) handleFinish(new Error('Google 로그인을 취소했거나 권한을 허용하지 않았습니다.'));
      else handleFinish(undefined, { code, verifier, redirectUri });
    });
    const handleFinish = (error?: Error, result?: OAuthCode) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal.removeEventListener('abort', handleAbort);
      server.close(); server.closeAllConnections();
      if (error) reject(error); else resolve(result!);
    };
    const handleAbort = () => handleFinish(new Error('Google 연결을 취소했습니다.'));
    const timer = setTimeout(() => handleFinish(new Error('로그인 시간이 지났습니다. 다시 연결해 주세요.')), timeoutMs);
    signal.addEventListener('abort', handleAbort, { once: true });
    server.on('error', () => handleFinish(new Error('Google 로그인 응답을 받을 로컬 연결을 열지 못했습니다.')));
    if (signal.aborted) { handleAbort(); return; }
    server.listen(0, '127.0.0.1', () => {
      if (settled) { server.close(); return; }
      const address = server.address();
      if (!address || typeof address === 'string') { handleFinish(new Error('로그인 연결을 열지 못했습니다.')); return; }
      redirectUri = 'http://127.0.0.1:' + address.port + '/oauth2callback';
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({
        client_id: client.clientId, redirect_uri: redirectUri, response_type: 'code',
        scope: GOOGLE_SCOPES.join(' '), state, access_type: 'offline', prompt: 'consent select_account',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
      }).toString();
      void open(url.href).catch(() => handleFinish(new Error('브라우저를 열지 못했습니다.')));
    });
  });
