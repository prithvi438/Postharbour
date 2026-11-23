/** Shared API response types. Keep these aligned with backend/internal/model. */
export interface User {
  avatar?: string;
  id: string;
  email: string;
  name: string;
  role: 'platform_admin' | 'tenant_admin';
  tenant_id: string;
}
export interface Session {
  user: User;
  csrf: string;
  mode: 'simulation' | 'stalwart';
  mail_host: string;
  webmail_url: string;
  max_mailboxes: number;
}
export interface Tenant {
  id: string;
  name: string;
  max_mailboxes: number;
  quota_mb: number;
  status: string;
  created_at: string;
}
export interface Domain {
  id: string;
  tenant_id: string;
  name: string;
  verified: boolean;
  verification_token: string;
  status: string;
  created_at: string;
}
export interface Mailbox {
  id: string;
  domain_id: string;
  address: string;
  name: string;
  quota_mb: number;
  status: string;
  created_at: string;
}
export interface AuditEvent {
  id: number;
  actor: string;
  action: string;
  target: string;
  created_at: string;
}
export interface DNSInfo {
  ownership_name: string;
  ownership_value: string;
  mx_host: string;
  mx_matches: boolean;
  zone: string;
  note: string;
}
export type Page = 'overview' | 'domains' | 'mailboxes' | 'activity' | 'settings';

/** Convert allocated MiB into a display label, without implying actual disk use. */
export function storageLabel(mib: number): string {
  return mib >= 1024
    ? `${(mib / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} GiB`
    : `${mib} MiB`;
}
