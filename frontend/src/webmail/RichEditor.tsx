import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Type, Smile, X } from 'lucide-react';
import { popoverPosition } from './popoverPosition';
import { EmojiPicker } from './EmojiPicker';
/** Rebuild pasted markup without attributes, scripts, images, URLs or inline styles. */
export function cleanHTML(value: string): string {
  const source = new DOMParser().parseFromString(value, 'text/html');
  const allowed = new Set([
    'B',
    'STRONG',
    'I',
    'EM',
    'U',
    'S',
    'P',
    'DIV',
    'BR',
    'UL',
    'OL',
    'LI',
    'H1',
    'H2',
    'H3',
    'BLOCKQUOTE',
    'TABLE',
    'THEAD',
    'TBODY',
    'TFOOT',
    'TR',
    'TD',
    'TH',
    'HR',
  ]);
  function copy(node: Node): Node {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent || '');
    const el = node as Element;
    if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'SVG', 'MATH'].includes(el.tagName))
      return document.createTextNode('');
    const target = allowed.has(el.tagName)
      ? document.createElement(el.tagName)
      : document.createDocumentFragment();
    node.childNodes.forEach((child) => target.appendChild(copy(child)));
    return target;
  }
  const out = document.createElement('div');
  source.body.childNodes.forEach((n) => out.appendChild(copy(n)));
  return out.innerHTML;
}
/** Native editing preserves selection/undo. Only allowlisted formatting crosses the API. */
export function RichEditor({
  html,
  toolsTarget,
  text,
  disabled,
  onChange,
}: {
  html?: string;
  toolsTarget?: HTMLElement | null;
  text: string;
  disabled: boolean;
  onChange: (text: string, html: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const range = useRef<Range | null>(null);
  const tools = useRef<HTMLDivElement>(null);
  const floating = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8, width: 320, maxHeight: 300 });
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [panel, setPanel] = useState<'format' | 'emoji' | null>(null);
  const [markup, setMarkup] = useState('');
  function closePanel() {
    setPanel(null);
    trigger.current?.focus();
  }
  useEffect(() => {
    const remember = () => {
      const selection = window.getSelection();
      if (
        selection?.rangeCount &&
        ref.current?.contains(selection.anchorNode) &&
        ref.current?.contains(selection.focusNode)
      )
        range.current = selection.getRangeAt(0).cloneRange();
    };
    document.addEventListener('selectionchange', remember);
    return () => document.removeEventListener('selectionchange', remember);
  }, []);
  useEffect(() => {
    if (!panel) return;
    const outside = (event: PointerEvent) => {
      if (
        !tools.current?.contains(event.target as Node) &&
        !floating.current?.contains(event.target as Node)
      )
        setPanel(null);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [panel]);
  // Portal out of the scrolling/glass composer so no ancestor clips the panel.
  useLayoutEffect(() => {
    if (!panel) return;
    const update = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      const element = floating.current;
      if (!anchor || !element) return;
      const visual = window.visualViewport;
      const viewport = {
        left: visual?.offsetLeft ?? 0,
        top: visual?.offsetTop ?? 0,
        width: visual?.width ?? window.innerWidth,
        height: visual?.height ?? window.innerHeight,
      };
      const next = popoverPosition(anchor, viewport, element.scrollHeight);
      setPosition((previous) =>
        Object.keys(next).every(
          (key) => previous[key as keyof typeof next] === next[key as keyof typeof next],
        )
          ? previous
          : next,
      );
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (floating.current) observer?.observe(floating.current);
    window.addEventListener('resize', update);
    document.addEventListener('scroll', update, true);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      document.removeEventListener('scroll', update, true);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, [panel]);
  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = cleanHTML(html || '');
      if (!html) ref.current.textContent = text;
    }
  }, []);
  function changed() {
    if (ref.current)
      onChange(
        ref.current.innerText ?? ref.current.textContent ?? '',
        cleanHTML(ref.current.innerHTML),
      );
  }
  function command(name: string, value?: string) {
    ref.current?.focus();
    const selection = window.getSelection();
    if (range.current && ref.current?.contains(range.current.commonAncestorContainer)) {
      selection?.removeAllRanges();
      selection?.addRange(range.current);
    }
    document.execCommand(name, false, value);
    if (selection?.rangeCount) range.current = selection.getRangeAt(0).cloneRange();
    changed();
  }
  const controls = (
    <div
      className="wm-editor-tools"
      ref={tools}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          closePanel();
        }
        if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.preventDefault();
      }}
    >
      {(['format', 'emoji'] as const).map((kind) => (
        <button
          key={kind}
          type="button"
          className="icon-button"
          aria-label={kind === 'format' ? 'Formatting options' : 'Choose emoji'}
          title={kind === 'format' ? 'Formatting' : 'Emoji'}
          aria-expanded={panel === kind}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            trigger.current = e.currentTarget;
            setPanel(panel === kind ? null : kind);
          }}
        >
          {kind === 'format' ? <Type size={20} /> : <Smile size={20} />}
        </button>
      ))}
      {panel &&
        createPortal(
          <div
            ref={floating}
            style={position}
            className="wm-editor-popover"
            role="dialog"
            aria-label={panel === 'format' ? 'Formatting options' : 'Emoji picker'}
          >
            <header>
              <strong>{panel === 'format' ? 'Format your message' : 'Emojis'}</strong>
              <button
                type="button"
                className="icon-button"
                aria-label="Close editor options"
                onClick={closePanel}
              >
                <X size={18} />
              </button>
            </header>
            {panel === 'emoji' ? (
              <EmojiPicker
                disabled={disabled}
                onPick={(emoji) => {
                  command('insertText', emoji);
                  setPanel(null);
                }}
              />
            ) : (
              <>
                <div className="wm-format-toolbar" role="toolbar" aria-label="Message formatting">
                  {[
                    ['Bold', 'bold'],
                    ['Italic', 'italic'],
                    ['Underline', 'underline'],
                    ['Bullets', 'insertUnorderedList'],
                    ['Numbered list', 'insertOrderedList'],
                    ['Undo', 'undo'],
                    ['Redo', 'redo'],
                  ].map(([label, cmd]) => (
                    <button
                      key={cmd}
                      type="button"
                      disabled={disabled}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => command(cmd)}
                    >
                      {label}
                    </button>
                  ))}
                  {['p', 'h3', 'h2', 'h1'].map((tag, i) => (
                    <button
                      key={tag}
                      type="button"
                      disabled={disabled}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => command('formatBlock', tag)}
                    >
                      {['Normal', 'Medium', 'Large', 'Heading'][i]}
                    </button>
                  ))}
                </div>
                <details>
                  <summary>Insert HTML</summary>
                  <textarea
                    aria-label="HTML to insert"
                    placeholder="Paste HTML markup"
                    value={markup}
                    disabled={disabled}
                    onChange={(e) => setMarkup(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={disabled || !markup}
                    onClick={() => {
                      command('insertHTML', cleanHTML(markup));
                      setMarkup('');
                      closePanel();
                    }}
                  >
                    Insert formatting
                  </button>
                  <small>Scripts, styles and remote images are removed.</small>
                </details>
              </>
            )}
          </div>,
          toolsTarget?.closest('.wm-app') ?? document.body,
        )}
    </div>
  );
  return (
    <div className="wm-editor">
      {!toolsTarget && controls}
      {toolsTarget && createPortal(controls, toolsTarget)}
      <div
        ref={ref}
        className="wm-rich-input"
        role="textbox"
        aria-label="Message"
        aria-multiline="true"
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={changed}
        onPaste={(e) => {
          e.preventDefault();
          const html = e.clipboardData.getData('text/html');
          if (html) command('insertHTML', cleanHTML(html));
          else command('insertText', e.clipboardData.getData('text/plain'));
        }}
      />
    </div>
  );
}
