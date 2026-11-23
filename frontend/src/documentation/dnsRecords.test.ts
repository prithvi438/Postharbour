import { describe, expect, it } from 'vitest';
import { customerMailRecords, mailRecords, relativeName } from './dnsRecords';

describe('generated DNS record presentation', () => {
  it('preserves DKIM chunks and semicolons while separating MX priority', () => {
    const rows = mailRecords(`; provider output
example.com. 3600 IN MX 10 mail.example.net.
example.com. 3600 IN TXT "v=spf1 mx -all" ; comment
s1._domainkey.example.com. 3600 IN TXT (
 "v=DKIM1; k=rsa; p=ABC"
 "DEF=="
)
_dmarc.example.com. IN TXT "v=DMARC1; p=none"
`);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ priority: '10', value: 'mail.example.net', type: 'MX' });
    expect(rows[2].value).toBe('v=DKIM1; k=rsa; p=ABCDEF==');
    expect(relativeName(rows[2].name, 'example.com')).toBe('s1._domainkey');
    expect(relativeName('example.com.', 'example.com')).toBe('@');
    expect(relativeName('outside.example.net.', 'example.com')).toBe('outside.example.net');
  });
  it('keeps server and optional security records out of customer setup cards', () => {
    const rows = mailRecords(
      'example.com. IN TXT \"v=spf1 mx -all\"\nmail.example.com. IN TXT \"v=spf1 a -all\"\n_mta-sts.example.com. IN TXT \"v=STSv1; id=123\"',
    );
    expect(customerMailRecords(rows, 'example.com').map((r) => r.name)).toEqual(['example.com.']);
  });
  it('does not guess malformed records, inherited owners, or decimal escapes', () => {
    expect(mailRecords('example.com. TXT "unfinished')).toEqual([]);
    expect(
      mailRecords('  IN TXT "inherited"\n$ORIGIN example.com.\nexample.com. TXT "a\\032b"'),
    ).toEqual([]);
    expect(mailRecords('example.com. MX mail.example.com')).toEqual([]);
  });
});
