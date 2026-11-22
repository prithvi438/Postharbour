#!/usr/bin/env python3
"""Exercise local mailbox conversations, files/photos, saved filters, and logout.

Run against a seeded native demo. This adds two .test messages to Mailpit and
ends the two demo mailbox sessions; it never deletes captured messages.
"""

import base64
import http.cookiejar
import json
import os
import sys
import struct
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zlib


def sample_photo():
    """Generate a tiny valid PNG in memory; no external fixture or image library needed."""
    def chunk(kind, data):
        """Encode one PNG chunk with its required CRC checksum."""
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', 1, 1, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(b'\x00\x39\xb5\x98\xff')) + chunk(b'IEND', b''))


class MailboxClient:
    """Keep an independent browser-like cookie jar and CSRF token per mailbox."""

    def __init__(self, base):
        """Connect only through the app's same-origin webmail endpoints."""
        self.base = base
        self.csrf = ""
        self.opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}),
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
        )

    def request(self, path, method="GET", body=None):
        """Send JSON with session cookies and origin/CSRF protection enabled."""
        request = urllib.request.Request(
            self.base + "/api/webmail" + path,
            data=None if method == "GET" else json.dumps(body or {}).encode(),
            method=method,
            headers={"Content-Type": "application/json", "Origin": self.base,
                     "X-CSRF-Token": self.csrf},
        )
        with self.opener.open(request, timeout=15) as response:
            return json.load(response)

    def login(self, address):
        """Sign in with documented local mailbox credentials, not an admin login."""
        result = self.request("/login", "POST", {
            "email": address, "password": "local-mailbox-password",
        })
        self.csrf = result["csrf"]
        session = self.request("/session")
        assert session["user"]["address"] == address
        assert session["mode"] == "simulation"

    def download(self, path):
        """Fetch an authenticated file/preview without treating binary data as JSON."""
        with self.opener.open(self.base + '/api/webmail' + path, timeout=15) as response:
            return response.read(), response.headers

    def message(self, folder, subject):
        """Find this run's captured message in an authenticated folder listing."""
        messages = self.request("/messages?folder=" + folder)["messages"]
        found = next((item for item in messages if item["subject"] == subject), None)
        assert found is not None, f"Message was not found in {folder}"
        return found


def main():
    """Send Alex → Hello → Alex through the actual application and Mailpit APIs."""
    base = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
    url = urllib.parse.urlparse(base)
    if url.scheme != "http" or url.hostname not in ("localhost", "127.0.0.1") or url.path or url.query or url.fragment or url.username:
        raise SystemExit("Webmail checks require a local HTTP origin without a path.")
    alex, hello = MailboxClient(base), MailboxClient(base)
    subject = "Webmail check " + uuid.uuid4().hex[:8]
    filter_id = None
    try:
        alex.login("alex@harbor.test")
        hello.login("hello@harbor.test")
        # A successful UI flow must not bypass the local-only recipient boundary.
        try:
            alex.request("/send", "POST", {"to": "blocked@example.com", "subject": subject,
                                           "text": "This request must be rejected before capture."})
            raise AssertionError("The sandbox accepted a non-.test recipient")
        except urllib.error.HTTPError as error:
            assert error.code == 400
        files = [('hello.txt', 'text/plain', b'A file attached to a real local test message.\n'),
                 ('photo.png', 'image/png', sample_photo())]
        delivery = alex.request("/send", "POST", {"to": "hello@harbor.test", "subject": subject, "html": "<p><b>Formatted check</b><script>blocked()</script></p>",
                                       "text": "A compose check from the Postharbor mailbox UI API.",
                                       "attachments": [{"name": name, "content_type": kind,
                                                        "content_base64": base64.b64encode(data).decode()}
                                                       for name, kind, data in files]})
        sent = alex.message("sent", subject)
        received = hello.message("inbox", subject)
        assert sent["id"] == received["id"]
        assert delivery['id'] == sent['id'], 'Send did not return the captured conversation anchor'
        assert received["from"]["address"] == "alex@harbor.test"
        detail = hello.request("/messages/" + received["id"])
        assert "compose check" in detail["text"]
        assert "<b>Formatted check</b>" in detail["html"]
        assert "<script" not in detail["html"]
        assert len(detail['attachment_list']) == 2
        for name, kind, expected in files:
            attachment = next(item for item in detail['attachment_list'] if item['name'] == name)
            path = '/messages/' + urllib.parse.quote(received['id'], safe='') + '/attachments/' + urllib.parse.quote(attachment['id'], safe='')
            actual, headers = hello.download(path)
            assert actual == expected and 'attachment' in headers['Content-Disposition']
            if kind == 'image/png':
                photo, headers = hello.download(path + '/preview')
                assert photo == expected and headers['Content-Type'] == 'image/png'
        hello.request("/messages/" + received["id"] + "/read", "POST")
        assert hello.message("inbox", subject)["read"] is True
        hello.request("/send", "POST", {"to": "alex@harbor.test", "subject": "Re: " + subject,
                                        "text": "Received. This is the local reply check.",
                                        "reply_to": received["id"]})
        assert alex.message("inbox", "Re: " + subject)["from"]["address"] == "hello@harbor.test"
        conversation = alex.request('/messages/' + sent['id'] + '/conversation')['messages']
        assert len(conversation) == 2 and conversation[0]['id'] == sent['id']
        assert conversation[1]['subject'] == 'Re: ' + subject
        rule = {'name': 'Smoke check ' + subject[-8:], 'from': 'hello@harbor.test',
                'to': '', 'subject': subject, 'has_attachments': False, 'unread': False}
        saved = alex.request('/filters', 'POST', rule)
        filter_id = saved['id']
        assert any(item['id'] == filter_id for item in alex.request('/filters')['filters'])
        assert all(item['id'] != filter_id for item in hello.request('/filters')['filters'])
        updated = alex.request('/filters/' + filter_id, 'PUT', {**rule, 'name': 'Updated smoke check'})
        assert updated['name'] == 'Updated smoke check'
        try:
            hello.request('/filters/' + filter_id, 'DELETE')
            raise AssertionError('Another mailbox could delete a saved filter')
        except urllib.error.HTTPError as error:
            assert error.code == 404
        alex.request('/filters/' + filter_id, 'DELETE')
        filter_id = None
        print("Passed: compose, files/photo roundtrip, safe photo preview, conversation replies, read state, and isolated saved-filter CRUD.")
        alex.request("/logout", "POST")
        alex.csrf = ""
        try:
            alex.request("/session")
            raise AssertionError("Logout did not revoke the mailbox session")
        except urllib.error.HTTPError as error:
            assert error.code == 401
        print("Passed: logout revokes the mailbox session. Messages remain available for inspection.")
        return 0
    except (AssertionError, KeyError, OSError, urllib.error.URLError) as error:
        print(f"Webmail check failed: {error}", file=sys.stderr)
        print("Start the updated native demo with seeding and MAILPIT_URL enabled first.", file=sys.stderr)
        return 1
    finally:
        # Remove only the disposable rule created by this check, never user rules.
        if filter_id and alex.csrf:
            try:
                alex.request('/filters/' + filter_id, 'DELETE')
            except (OSError, urllib.error.URLError):
                pass
        for client in (alex, hello):
            if client.csrf:
                try:
                    client.request("/logout", "POST")
                except (OSError, urllib.error.URLError):
                    pass


if __name__ == "__main__":
    sys.exit(main())
