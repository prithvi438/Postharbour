import { useEffect, useRef } from 'react';
import { Download, Mail, Maximize2, MessageCircle, Paperclip } from 'lucide-react';
import { ProfilePhoto } from '../components/ProfilePhoto';
import { cleanHTML } from './RichEditor';
import { initials, isPhoto, messageDate } from './presentation';
import type { MailDetail } from './types';

/** Attachments keep their real filenames; only authenticated raster previews are rendered. */
function Attachments({ message }: { message: MailDetail }) {
  return (
    <div className="wm-chat-files">
      {message.attachment_list.map((file) => {
        const path = `/api/webmail/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(file.id)}`;
        return (
          <div key={file.id} className="wm-chat-file">
            {isPhoto(file.content_type) && (
              <img
                className="wm-chat-photo"
                src={path + '/preview'}
                alt={file.name}
                loading="lazy"
                onError={(event) => {
                  event.currentTarget.hidden = true;
                }}
              />
            )}
            <a href={path} download>
              <Paperclip size={18} />
              <span>
                <strong>{file.name}</strong>
                <small>{Math.max(1, Math.ceil(file.size / 1024))} KB</small>
              </span>
              <Download size={18} />
            </a>
          </div>
        );
      })}
    </div>
  );
}

/** Render authorized emails from a thread or person/topic view. Card expansion
 * reuses the loaded message and keeps nested controls and text selection independent. */
export function Conversation({
  messages,
  address,
  avatar,
  truncated,
  onReply,
  onForward,
  composing,
  onExpand,
  focusMessageId,
}: {
  messages: MailDetail[];
  address: string;
  avatar?: string;
  truncated: boolean;
  onReply: (message: MailDetail) => void;
  onForward?: (message: MailDetail) => void;
  composing: boolean;
  onExpand?: (message: MailDetail) => void;
  focusMessageId?: string;
}) {
  const end = useRef<HTMLDivElement>(null);
  const previousCount = useRef(0);
  const cards = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    if (messages.length > previousCount.current && !composing)
      end.current?.scrollIntoView?.({ block: 'nearest' });
    previousCount.current = messages.length;
  }, [messages.length, composing]);
  // Returning from full screen restores the exact card, including older messages.
  useEffect(() => {
    if (!focusMessageId) return;
    const card = cards.current.get(focusMessageId);
    card?.focus({ preventScroll: true });
    card?.scrollIntoView?.({ block: 'nearest' });
  }, [focusMessageId]);
  return (
    <div className="wm-conversation" aria-label="Email conversation">
      <div className="wm-conversation-intro">
        <Mail size={15} />
        <span>Email, with room for a conversation.</span>
      </div>
      {truncated && (
        <p className="wm-thread-note">Showing the latest 50 messages in this conversation.</p>
      )}
      {messages.map((message) => {
        const mine = message.from.address.toLowerCase() === address.toLowerCase();
        return (
          <article
            key={message.id}
            className={`wm-chat-card ${mine ? 'wm-chat-mine' : ''} ${onExpand && !composing ? 'wm-chat-expandable' : ''}`}
            tabIndex={-1}
            ref={(element) => {
              if (element) cards.current.set(message.id, element);
              else cards.current.delete(message.id);
            }}
            onClick={(event) => {
              if (!onExpand || composing || event.defaultPrevented) return;
              const target = event.target;
              if (
                target instanceof Element &&
                target.closest(
                  'a, button, input, select, textarea, details, [contenteditable], [role="button"]',
                )
              )
                return;
              if (window.getSelection()?.toString()) return;
              onExpand(message);
            }}
            aria-label={`Email from ${message.from.address}`}
          >
            <header>
              <span className="wm-row-avatar">
                {mine && avatar ? (
                  <ProfilePhoto value={avatar} name="Your" />
                ) : (
                  initials(message.from.name || message.from.address)
                )}
              </span>
              <div>
                <strong>{mine ? 'You' : message.from.name || message.from.address}</strong>
                <span>{message.from.address}</span>
              </div>
              {onExpand && (
                <button
                  className="icon-button wm-card-expand"
                  disabled={composing}
                  aria-label={`Expand email: ${message.subject || '(No subject)'} from ${message.from.address}`}
                  title="Open this email full screen"
                  onClick={() => onExpand(message)}
                >
                  <Maximize2 size={17} />
                </button>
              )}
              <time dateTime={message.date}>{messageDate(message.date, true)}</time>
            </header>
            <details className="wm-email-details">
              <summary>Email details</summary>
              <p>
                <strong>To:</strong> {message.to.map((to) => to.address).join(', ')}
              </p>
              <p>
                <strong>Subject:</strong> {message.subject || '(No subject)'}
              </p>
            </details>
            <div className="wm-chat-text">
              {message.html ? (
                <div
                  className="wm-formatted"
                  dangerouslySetInnerHTML={{ __html: cleanHTML(message.html) }}
                />
              ) : (
                message.text
              )}
            </div>
            {message.text_truncated && (
              <p className="wm-thread-note">This long message has been shortened for display.</p>
            )}
            {message.attachment_list.length > 0 && <Attachments message={message} />}
            <footer>
              <span>{mine ? 'Sent email' : 'Received email'}</span>
              <button className="text-button" disabled={composing} onClick={() => onReply(message)}>
                <MessageCircle size={15} />
                Reply
              </button>
              {onForward && (
                <button
                  className="text-button"
                  disabled={composing}
                  onClick={() => onForward(message)}
                >
                  Forward
                </button>
              )}
            </footer>
          </article>
        );
      })}
      <div ref={end} />
    </div>
  );
}
