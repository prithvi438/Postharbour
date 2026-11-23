import mammoth from 'mammoth/mammoth.browser';

/** Bound the ZIP's declared expansion before Word parsing. Small compressed files
 * can otherwise expand into huge documents. ZIP64/encrypted archives are not needed
 * for a one-MiB email template and are rejected explicitly. */
function checkArchive(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  let end = buffer.byteLength - 22;
  const minimum = Math.max(0, end - 65535);
  while (end >= minimum && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < minimum) throw new Error('Invalid Word archive.');
  const entries = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true),
    expanded = 0;
  if (entries > 500) throw new Error('Too many files in Word template.');
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error('Invalid Word archive directory.');
    expanded += view.getUint32(offset + 24, true);
    if (expanded > 10 * 1024 * 1024 || view.getUint16(offset + 8, true) & 1)
      throw new Error('Word template is too large or encrypted.');
    offset +=
      46 +
      view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
  }
}

/** Convert structure, not Word's page layout. The caller sanitizes the result before
 * rendering. This function runs inside a worker with a ten-second UI deadline. */
export async function convertWord(buffer: ArrayBuffer) {
  if (buffer.byteLength > 1024 * 1024) throw new Error('Word template exceeds 1 MiB.');
  checkArchive(buffer);
  const result = await mammoth.convertToHtml(
    { arrayBuffer: buffer },
    {
      includeEmbeddedStyleMap: false,
      externalFileAccess: false,
      convertImage: mammoth.images.imgElement(async () => ({ src: '' })),
    },
  );
  if (result.value.length > 50000) throw new Error('Converted template exceeds 50 KB.');
  return result.value;
}
