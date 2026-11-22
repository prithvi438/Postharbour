#!/usr/bin/env python3
"""Send a local SMTP conversation and verify that Mailpit captured each message.

Uses only Python's standard library. Connections are always to 127.0.0.1 and
addresses must end in .test. This does not use Stalwart or dashboard mailbox
credentials: Mailpit is a shared email catcher, not a set of real user inboxes.
"""

import argparse
from email.message import EmailMessage
from email.policy import SMTP
from email.utils import formatdate, make_msgid
import html
import json
import re
import smtplib
import sys
import time
import urllib.error
import urllib.request
import uuid


def test_address(value):
    """Accept simple .test addresses, keeping this demo clearly fictional."""
    pattern = r"[a-zA-Z0-9][a-zA-Z0-9._+-]{0,63}@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+test"
    if not re.fullmatch(pattern, value) or len(value) > 254:
        raise argparse.ArgumentTypeError("Use an address on a reserved .test domain, e.g. alex@harbor.test.")
    return value


def port_number(value):
    """Validate a local port before opening SMTP or HTTP connections."""
    try:
        port = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError("Port must be an integer from 1 to 65535.") from None
    if not 1 <= port <= 65535:
        raise argparse.ArgumentTypeError("Port must be an integer from 1 to 65535.")
    return port


def build_message(sender, recipient, subject, body, *, reply_to=None):
    """Create a standards-based MIME email with text, HTML, and reply headers.

    All HTML content is escaped. The first message also includes a harmless text
    attachment so the mail viewer's HTML, plain text, and attachment tabs can be tried.
    """
    message = EmailMessage(policy=SMTP)
    message["From"] = sender
    message["To"] = recipient
    message["Subject"] = subject
    message["Date"] = formatdate(localtime=False)
    message["Message-ID"] = make_msgid(domain="harbor.test")
    if reply_to:
        message["In-Reply-To"] = reply_to
        message["References"] = reply_to
    message.set_content(body + "\n\nLocal test only. Captured by Mailpit; no public delivery.\n")
    safe_body = html.escape(body).replace("\n", "<br>")
    message.add_alternative(
        '<!doctype html><html lang="en"><body style="font-family:system-ui,sans-serif;'
        'line-height:1.6;padding:24px;color:#173c35;background:#f2fbf7">'
        '<p style="font-size:12px;letter-spacing:2px">POSTHARBOR · LOCAL DEMO</p>'
        f'<h1 style="font-size:24px">{html.escape(subject)}</h1><p>{safe_body}</p>'
        '<hr><p>Captured by Mailpit. This is a test message, with no public delivery.</p>'
        '</body></html>',
        subtype="html",
    )
    if not reply_to:
        message.add_attachment(
            b"Hello from Postharbor! This attachment is generated for local testing only.\n",
            maintype="text", subtype="plain", filename="demo-note.txt",
        )
    return message


class NoRedirects(urllib.request.HTTPRedirectHandler):
    """Keep Mailpit checks on the selected loopback endpoint, even on redirects."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        """Refuse redirects instead of following a different host or port."""
        return None


def captured_messages(ui_port):
    """Read the newest captured messages directly, bypassing HTTP proxy settings."""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirects())
    with opener.open(f"http://127.0.0.1:{ui_port}/api/v1/messages?limit=100", timeout=5) as response:
        data = json.load(response)
    messages = data.get("messages")
    if not isinstance(messages, list):
        raise ValueError("The local HTTP service did not return Mailpit's message list.")
    return messages


def verify_capture(messages, ui_port):
    """Confirm this run's unique subjects are stored, rather than assuming delivery."""
    expected = {str(message["Subject"]) for message in messages}
    deadline = time.monotonic() + 5
    while True:
        actual = {item.get("Subject") for item in captured_messages(ui_port)}
        if expected <= actual:
            return
        if time.monotonic() >= deadline:
            raise RuntimeError("SMTP accepted the messages, but not all appeared in the selected Mailpit viewer.")
        time.sleep(0.2)


def main():
    """Send the requested message plus an automatic sample reply, then report results."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from", dest="sender", type=test_address, default="alex@harbor.test")
    parser.add_argument("--to", dest="recipient", type=test_address, default="hello@harbor.test")
    parser.add_argument("--subject", default="Hello from your local email demo")
    parser.add_argument("--body", default="Hi Studio team,\nThis is Alex's first local test email. Can you see the attachment?")
    parser.add_argument("--no-reply", action="store_true", help="Capture only the first message, without a generated reply.")
    parser.add_argument("--smtp-port", type=port_number, default=1025)
    parser.add_argument("--ui-port", type=port_number, default=8025)
    args = parser.parse_args()
    if "\n" in args.subject or "\r" in args.subject:
        parser.error("Subject must be a single line.")

    # A unique marker distinguishes this run from old or concurrently sent mail.
    subject = f"[Local demo {uuid.uuid4().hex[:8]}] {args.subject}"
    first = build_message(args.sender, args.recipient, subject, args.body)
    messages = [first]
    if not args.no_reply:
        messages.append(build_message(
            args.recipient, args.sender, "Re: " + subject,
            "Received! This reply was generated by the local demo script.\n"
            "You can inspect both directions in Mailpit. No real recipient was contacted.",
            reply_to=str(first["Message-ID"]),
        ))

    try:
        captured_messages(args.ui_port)
        with smtplib.SMTP("127.0.0.1", args.smtp_port, timeout=10) as smtp:
            for message in messages:
                smtp.send_message(message)
        verify_capture(messages, args.ui_port)
    except (OSError, smtplib.SMTPException, ValueError, RuntimeError, urllib.error.URLError) as error:
        print(f"Local mail demo did not finish: {error}", file=sys.stderr)
        print("Start Mailpit with: docker compose --profile demo up -d mailpit", file=sys.stderr)
        print("If some messages were already accepted, retrying adds a new conversation.", file=sys.stderr)
        return 1

    for message in messages:
        print(f"Captured: {message['From']} → {message['To']} | {message['Subject']}")
    print(f"Verified {len(messages)} messages in Mailpit: http://localhost:{args.ui_port}")
    print("These are SMTP captures, not delivery into the dashboard's simulated mailbox accounts.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
