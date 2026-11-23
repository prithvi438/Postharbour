import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { convertWord } from './wordConversion';
import { cleanHTML } from './RichEditor';
import { htmlText } from './settings';

it('imports real Word paragraphs and emphasis into a safe reusable email', async () => {
  const file = readFileSync('src/webmail/fixtures/template.docx');
  const data = new Uint8Array(file).buffer;
  const html = cleanHTML(await convertWord(data));
  expect(html).toContain('<strong>Hello from Word</strong>');
  expect(htmlText(html)).toBe('Hello from Word\nYour reusable email.');
});
it('rejects malformed archives before attempting conversion', async () => {
  await expect(convertWord(new ArrayBuffer(10))).rejects.toThrow();
});
