#!/usr/bin/env python3
"""Certbot deploy hook: install the renewed site certificate into Stalwart.

Run as root. Secrets are read from protected files and never printed or placed in
command arguments. Only this site's renewal triggers an update/restart.
"""
import json
import os
from pathlib import Path
import subprocess
import urllib.request


def main():
    """Update the existing certificate object, then reload the mail service."""
    lineage = Path('/etc/letsencrypt/live/postharbor.easyhai.in')
    if os.environ.get('RENEWED_LINEAGE', str(lineage)) != str(lineage):
        return
    values = dict(line.split('=', 1) for line in Path('/etc/postharbor/app.env').read_text().splitlines()
                  if line and not line.startswith('#') and '=' in line)
    metadata = json.loads(Path('/root/postharbor-access.json').read_text())
    certificate_id = metadata['engine_certificate_id']
    payload = {
        'using': ['urn:ietf:params:jmap:core', 'urn:stalwart:jmap'],
        'methodCalls': [['x:Certificate/set', {'update': {certificate_id: {
            'certificate': {'@type': 'Text', 'value': (lineage / 'fullchain.pem').read_text()},
            'privateKey': {'@type': 'Text', 'secret': (lineage / 'privkey.pem').read_text()},
        }}}, 'renew']],
    }
    request = urllib.request.Request('http://127.0.0.1:8085/jmap/', data=json.dumps(payload).encode(),
                                    headers={'Content-Type': 'application/json',
                                             'Authorization': 'Bearer ' + values['STALWART_TOKEN']})
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.load(response)['methodResponses'][0]
    if result[0] != 'x:Certificate/set' or certificate_id not in result[1].get('updated', {}):
        raise SystemExit('Stalwart certificate update failed; inspect the engine configuration.')
    subprocess.run(['systemctl', 'restart', 'stalwart'], check=True)
    print('Postharbor mail certificate synchronized.')


if __name__ == '__main__':
    main()
