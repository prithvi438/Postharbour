import { useEffect, useRef } from 'react';
import { Download, Mail, MessageCircle, Paperclip } from 'lucide-react';
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

/** The conversation contains real emails connected by reply headers, not arbitrary
 * messages with the same subject. Bodies use sanitized formatting. */
export function Conversation({
  messages,
  address,
  avatar,
  truncated,
  onReply,
  onForward,
  composing,
}: {
  messages: MailDetail[];
  address: string;
  avatar?: string;
  truncated: boolean;
  onReply: (message: MailDetail) => void;
  onForward?: (message: MailDetail) => void;
  composing: boolean;
}) {
  const end = useRef<HTMLDivElement>(null);
  const previousCount = useRef(0);
  useEffect(() => {
    if (messages.length > previousCount.current && !composing)
      end.current?.scrollIntoView?.({ block: 'nearest' });
    previousCount.current = messages.length;
  }, [messages.length, composing]);
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
            className={`wm-chat-card ${mine ? 'wm-chat-mine' : ''}`}
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
