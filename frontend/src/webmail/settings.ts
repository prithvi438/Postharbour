import { cleanHTML } from './RichEditor';
export interface MailTemplate {
  id: string;
  name: string;
  subject: string;
  html: string;
}
export interface MailSettings {
  revision: number;
  avatar: string;
  signature: string;
  signature_enabled: boolean;
  templates: MailTemplate[];
}
export const emptySettings: MailSettings = {
  revision: 0,
  avatar: '',
  signature: '',
  signature_enabled: false,
  templates: [],
};
/** Preserve paragraph breaks when inserting a rich template into a plain-text draft. */
export function htmlText(value: string) {
  const html = cleanHTML(value).replace(/<br\s*\/?\s*>|<\/(?:p|div|li|tr|h[123])>/gi, '\n');
  return new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() || '';
}
export function textHTML(value: string) {
  const element = document.createElement('div');
  element.textContent = value;
  return '<p>' + element.innerHTML.replace(/\n/g, '<br>') + '</p>';
}
/** Word parsing runs off the UI thread with a deadline. Only sanitized HTML leaves
 * the importer; macros, external resources and source documents are never uploaded. */
export async function importTemplate(file: File): Promise<string> {
  if (file.size > 1024 * 1024) throw new Error('Choose a template smaller than 1 MiB.');
  if (/\.docx$/i.test(file.name)) {
    const buffer = await file.arrayBuffer();
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./wordTemplate.worker.ts', import.meta.url), {
        type: 'module',
      });
      const stop = () => {
        clearTimeout(timer);
        worker.terminate();
      };
      const timer = window.setTimeout(() => {
        stop();
        reject(
          new Error('This Word document is too complex to import. Try copying its text instead.'),
        );
      }, 10000);
      worker.onmessage = (e) => {
        stop();
        if (e.data.error) reject(new Error(e.data.error));
        else resolve(cleanHTML(e.data.html));
      };
      worker.onerror = () => {
        stop();
        reject(new Error('Could not import this Word document.'));
      };
      worker.postMessage(buffer, [buffer]);
    });
  }
  if (/\.html?$/i.test(file.name)) return cleanHTML(await file.text());
  if (/\.txt$/i.test(file.name)) return textHTML(await file.text());
  throw new Error(
    'Choose an HTML, TXT or Word .docx file. Older .doc files must be saved as .docx first.',
  );
}
