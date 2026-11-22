/** Public mailbox DTOs, deliberately separate from administrator account types. */
export interface MailAddress {
  name: string;
  address: string;
}
export interface MailSession {
  user: { id: string; address: string; name: string };
  csrf: string;
  mode: 'simulation';
}
export interface MailSummary {
  id: string;
  from: MailAddress;
  to: MailAddress[];
  subject: string;
  snippet: string;
  date: string;
  read: boolean;
  attachments: number;
}
export interface MailDetail extends MailSummary {
  text: string;
  html?: string;
  message_id: string;
  attachment_list: { id: string; name: string; size: number; content_type?: string }[];
  text_truncated?: boolean;
}
export type Folder = 'inbox' | 'sent';
export interface Draft {
  to: string;
  subject: string;
  text: string;
  html?: string;
  reply_to?: string;
  attachments?: UploadAttachment[];
}

/** Base64 payloads stay in memory until a message is sent. */
export interface UploadAttachment {
  name: string;
  content_type: string;
  content_base64: string;
}
/** Saved filters are mailbox-owned views, not automatic mail-processing rules. */
export interface MailFilter {
  id: string;
  name: string;
  from: string;
  to: string;
  subject: string;
  has_attachments: boolean;
  unread: boolean;
}
