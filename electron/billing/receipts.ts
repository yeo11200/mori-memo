import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { OFFLINE_DAYS, PRO_CAPABILITIES, type GrantClaims } from '../../shared/billing';

export const handleSignGrant = (claims: GrantClaims, privateKey: string, kid: string): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.${sign(null, Buffer.from(`${header}.${payload}`), createPrivateKey(privateKey)).toString('base64url')}`;
};
export const handleVerifyGrant = (receipt: string, keys: Record<string, string>, issuer: string, userId: string, deviceId: string, now = Date.now()): GrantClaims => {
  try {
    if (typeof receipt !== 'string' || receipt.length > 16000) throw new Error();
    const parts = receipt.split('.');
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    if (header.alg !== 'EdDSA' || header.typ !== 'JWT' || typeof header.kid !== 'string' || !Object.hasOwn(keys, header.kid)) throw new Error();
    if (!verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey(keys[header.kid]), Buffer.from(parts[2], 'base64url'))) throw new Error();
    const grant: GrantClaims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    const seconds = Math.floor(now / 1000);
    if (grant.iss !== issuer || grant.aud !== 'mori-desktop' || grant.sub !== userId || grant.device_id !== deviceId || !['trial', 'subscription'].includes(grant.source) || !Array.isArray(grant.capabilities) || !grant.capabilities.length || grant.capabilities.some(value => !PRO_CAPABILITIES.includes(value)) || ![grant.iat, grant.exp, grant.valid_until].every(Number.isSafeInteger) || grant.iat > seconds + 60 || grant.exp <= seconds || grant.exp <= grant.iat || grant.exp > grant.valid_until || grant.exp - grant.iat > OFFLINE_DAYS * 86400) throw new Error();
    return grant;
  } catch { throw new Error('Pro 권한을 확인하지 못했습니다. 온라인에서 구매를 복원해 주세요.'); }
};
