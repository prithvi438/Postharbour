-- Credentials for live mailbox sessions are authenticated-encrypted with a key
-- kept outside PostgreSQL. The existing expiry/logout/reset paths remove them.
ALTER TABLE webmail_sessions ADD COLUMN encrypted_credentials text NOT NULL DEFAULT '';
