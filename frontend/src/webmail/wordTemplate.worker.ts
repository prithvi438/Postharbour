import { convertWord } from './wordConversion';
/** Keep Word conversion off the mailbox UI thread. No source file leaves the browser. */
self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    self.postMessage({ html: await convertWord(event.data) });
  } catch {
    self.postMessage({ error: 'Could not import this document. Use a smaller, valid .docx file.' });
  }
};
