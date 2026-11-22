import { expect, it } from 'vitest';
import { cleanHTML } from './RichEditor';
it('keeps text formatting while removing executable markup and tracking', () => {
  const safe = cleanHTML(
    '<p onclick="evil()">Hi <b>team</b><img src="https://tracker.test/x"><script>evil()</script><svg onload="evil()"></svg></p>',
  );
  expect(safe).toBe('<p>Hi <b>team</b></p>');
});

it('preserves table structure while stripping all sender styles and attributes', () => {
  expect(
    cleanHTML(
      '<table style="position:fixed"><tbody><tr><td onclick="evil()">Cell</td></tr></tbody></table>',
    ),
  ).toBe('<table><tbody><tr><td>Cell</td></tr></tbody></table>');
});

it('restores the selected text when applying a formatting command from its panel', async () => {
  const { render, screen, fireEvent } = await import('@testing-library/react');
  const { RichEditor } = await import('./RichEditor');
  let selected = '';
  let applied = '';
  const original = Object.getOwnPropertyDescriptor(document, 'execCommand');
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: (command: string) => {
      selected = window.getSelection()?.toString() || '';
      applied = command;
      return true;
    },
  });
  try {
    render(
      <RichEditor
        text="Hello team"
        disabled={false}
        onChange={() => {}}
        toolsTarget={document.body}
      />,
    );
    const editor = screen.getByRole('textbox', { name: 'Message' });
    const range = document.createRange();
    range.setStart(editor.firstChild!, 6);
    range.setEnd(editor.firstChild!, 10);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent(document, new Event('selectionchange'));
    fireEvent.click(screen.getByRole('button', { name: 'Formatting options' }));
    window.getSelection()?.removeAllRanges();
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(applied).toBe('bold');
    expect(selected).toBe('team');
  } finally {
    if (original) Object.defineProperty(document, 'execCommand', original);
    else Reflect.deleteProperty(document, 'execCommand');
  }
});
