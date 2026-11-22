-- Local webmail credentials are separate from dashboard administrators. Only the
-- simulation provider writes this table; live credentials remain in Stalwart.
CREATE TABLE simulation_mailbox_credentials (
 mailbox_id text PRIMARY KEY REFERENCES mailboxes(id) ON DELETE CASCADE,
 password_hash text NOT NULL
);
CREATE TABLE webmail_sessions (
 token_hash text PRIMARY KEY,
 mailbox_id text NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
 csrf text NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE INDEX webmail_sessions_expiry ON webmail_sessions(expires_at);
-- Read state belongs to a mailbox, not Mailpit's global capture viewer.
CREATE TABLE webmail_read_messages (
 mailbox_id text NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
 message_id text NOT NULL,
 PRIMARY KEY (mailbox_id, message_id)
);
