-- Private mailbox preferences and a separate dashboard profile photo.
CREATE TABLE webmail_settings (
 mailbox_id text PRIMARY KEY REFERENCES mailboxes(id) ON DELETE CASCADE,
 revision integer NOT NULL,
 data jsonb NOT NULL
);
ALTER TABLE users ADD COLUMN avatar text NOT NULL DEFAULT '';
