-- Private address book and message organization, removed with its mailbox.
CREATE TABLE webmail_organizer (
 mailbox_id text PRIMARY KEY REFERENCES mailboxes(id) ON DELETE CASCADE,
 revision integer NOT NULL DEFAULT 0,
 data jsonb NOT NULL
);
