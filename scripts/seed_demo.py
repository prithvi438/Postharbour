#!/usr/bin/env python3
"""Create disposable local demo data through the same API used by React.

This refuses non-local URLs and real mail providers. It does not send email.
Set BASE_URL, BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD to match your local server.
"""
import http.cookiejar
import json
import os
import urllib.error
import urllib.parse
import urllib.request


def main():
    """Log in, assert simulation, and idempotently create a sample business."""
    base = os.environ.get('BASE_URL', 'http://localhost:8080').rstrip('/')
    if urllib.parse.urlparse(base).hostname not in ('localhost', '127.0.0.1'):
        raise SystemExit('Demo seeding is only allowed on localhost.')
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    csrf = ''

    def request(path, method='GET', body=None):
        """Make a same-origin API call with cookie and CSRF protection enabled."""
        req = urllib.request.Request(base + '/api' + path, method=method,
            data=None if method == 'GET' else json.dumps(body or {}).encode(),
            headers={'Content-Type': 'application/json', 'Origin': base, 'X-CSRF-Token': csrf})
        try:
            with opener.open(req, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            raise SystemExit(f'API {error.code}: {error.read().decode()}') from error

    request('/login', 'POST', {'email': os.environ.get('BOOTSTRAP_EMAIL', 'owner@example.test'),
        'password': os.environ.get('BOOTSTRAP_PASSWORD', 'local-development-password')})
    session = request('/session')
    csrf = session['csrf']
    if session['mode'] != 'simulation':
        raise SystemExit('Refusing to create demo data on a real mail provider.')
    tenants = request('/tenants')
    tenant = next((item for item in tenants if item['name'] == 'Harbor Studio'), None)
    if tenant is None:
        tenant = request('/tenants', 'POST', {'name': 'Harbor Studio', 'admin_name': 'Studio admin',
            'admin_email': 'admin@harbor.test', 'password': 'local-business-password',
            'max_mailboxes': 5, 'quota_mb': 25600})
    root = '/tenants/' + tenant['id']
    domains = request(root + '/domains')
    domain = next((item for item in domains if item['name'] == 'harbor.test'), None)
    if domain is None:
        domain = request(root + '/domains', 'POST', {'name': 'harbor.test'})
    if domain['status'] != 'active':
        domain = request(root + '/domains/' + domain['id'] + '/verify', 'POST', {'simulate': True})
    existing = {item['address']: item for item in request(root + '/mailboxes')}
    for local, name in [('alex', 'Alex Morgan'), ('hello', 'Studio enquiries')]:
        if local + '@harbor.test' not in existing:
            request(root + '/mailboxes', 'POST', {'domain_id': domain['id'], 'local_part': local,
                'name': name, 'password': 'local-mailbox-password', 'quota_mb': 5120})
        else:
            # Older simulation databases had no mailbox login hash. Re-seeding
            # deliberately restores only these two documented demo credentials.
            mailbox = existing[local + '@harbor.test']
            request(root + '/mailboxes/' + mailbox['id'] + '/password', 'POST',
                {'password': 'local-mailbox-password'})
    request('/logout', 'POST')
    print('Local simulation ready: Harbor Studio, harbor.test, and two mailboxes.')
    print('Sign in again in the browser. Demo administrator: admin@harbor.test')
    print('Webmail: /mail — alex@harbor.test or hello@harbor.test / local-mailbox-password')
    print('The demo credentials are documented in README.md; never use them in production.')


if __name__ == '__main__':
    main()
