-- Saved views belong to one mailbox. They do not forward, delete, or alter mail.
CREATE TABLE webmail_filters (
 id text PRIMARY KEY,
 mailbox_id text NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
 name text NOT NULL,
 from_text text NOT NULL DEFAULT '',
 to_text text NOT NULL DEFAULT '',
 subject text NOT NULL DEFAULT '',
 has_attachments boolean NOT NULL DEFAULT false,
 unread boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webmail_filters_owner ON webmail_filters(mailbox_id,created_at);
