export const PRO_PRODUCT = 'mori_pro_monthly_v1';
export const PRO_AMOUNT = 2900;
export const BILLING_POLICY = '2026-10-20-v1';
export const TRIAL_DAYS = 14;
export const OFFLINE_DAYS = 7;
export const MAX_DEVICES = 2;
export type Capability = 'reports.ai_generate' | 'reports.template_write';
export const PRO_CAPABILITIES: Capability[] = ['reports.ai_generate', 'reports.template_write'];
export interface BillingDevice { id: string; name: string; lastSeenAt: string }
export interface BillingSummary {
  userId: string; email: string; devices: BillingDevice[];
  trialEnd: string | null; paidUntil: string | null; cancelAtEnd: boolean;
  status: 'free' | 'trial' | 'active' | 'past_due' | 'canceled' | 'unknown';
  nextChargeAt: string | null; card: string | null;
}
export interface BillingState {
  mode: 'beta' | 'commercial'; signedIn: boolean; email?: string; deviceId?: string;
  payments?: BillingPayment[];
  account?: BillingSummary; capabilities: Capability[]; offline: boolean; warning?: string;
}
export interface BillingPayment { id: string; createdAt: string; amount: number; state: 'pending' | 'unknown' | 'done' | 'failed' | 'refunded'; refundRequested: boolean }
export interface AuthTokens { access_token: string; refresh_token: string; expires_at: number; user: { id: string; email: string } }
export interface GrantClaims {
  iss: string; aud: 'mori-desktop'; sub: string; device_id: string;
  capabilities: Capability[]; source: 'trial' | 'subscription';
  valid_until: number; iat: number; exp: number;
}
export interface EntitlementResponse { summary: BillingSummary; receipt: string | null; serverNow: string; payments?: BillingPayment[] }
export const handleBillingEmail = (email: unknown): string => {
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('이메일 주소를 확인해 주세요.');
  return email.trim();
};
export const handleBillingId = (id: unknown): string => {
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new Error('잘못된 요청 ID입니다.');
  return id;
};
/** KST 달력의 최초 anchor day를 유지합니다. DB에서는 UTC로 보관합니다. */
export const handleNextBillingMonth = (start: string, anchorDay?: number): string => {
  const time = new Date(start).getTime();
  if (!Number.isFinite(time)) throw new Error('결제 날짜를 확인해 주세요.');
  const kst = new Date(time + 9 * 3600000);
  const anchor = anchorDay ?? kst.getUTCDate();
  if (!Number.isInteger(anchor) || anchor < 1 || anchor > 31) throw new Error('결제 기준일을 확인해 주세요.');
  const month = kst.getUTCMonth() + 1;
  const last = new Date(Date.UTC(kst.getUTCFullYear(), month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(kst.getUTCFullYear(), month, Math.min(anchor, last), kst.getUTCHours(), kst.getUTCMinutes(), kst.getUTCSeconds(), kst.getUTCMilliseconds()) - 9 * 3600000).toISOString();
};
