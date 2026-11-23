import { useRef, useState } from 'react';

/** Shared private avatar display; no remote avatar service receives account details. */
export function ProfilePhoto({ value, name }: { value?: string; name: string }) {
  return value ? (
    <img className="profile-photo" src={value} alt={`${name} profile`} />
  ) : (
    <>{name.slice(0, 2).toUpperCase()}</>
  );
}

/** Resize a selected raster locally before uploading. The API independently
 * decodes/re-encodes it, so a spoofed MIME type cannot become executable content. */
export async function preparePhoto(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 5 * 1024 * 1024)
    throw new Error('Choose a PNG or JPEG photo smaller than 5 MiB.');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Photo editing is unavailable in this browser.');
    const size = Math.min(bitmap.width, bitmap.height);
    context.drawImage(
      bitmap,
      (bitmap.width - size) / 2,
      (bitmap.height - size) / 2,
      size,
      size,
      0,
      0,
      256,
      256,
    );
    return canvas.toDataURL('image/png');
  } finally {
    bitmap.close();
  }
}

/** Reusable upload/remove control for both dashboard and mailbox settings. */
export function PhotoPicker({
  value,
  name,
  disabled = false,
  onChange,
  onBusyChange,
}: {
  value: string;
  name: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function choose(file?: File) {
    if (!file) return;
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    try {
      onChange(await preparePhoto(file));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  return (
    <div className="profile-photo-picker">
      <span className="avatar profile-photo-large">
        <ProfilePhoto value={value} name={name} />
      </span>
      <button
        type="button"
        className="button secondary"
        disabled={disabled || busy}
        onClick={() => input.current?.click()}
      >
        {busy ? 'Preparing photo…' : 'Upload photo'}
      </button>
      {value && (
        <button
          type="button"
          className="text-button"
          disabled={disabled || busy}
          onClick={() => onChange('')}
        >
          Remove photo
        </button>
      )}
      <input
        ref={input}
        className="wm-sr-only"
        hidden
        type="file"
        accept="image/png,image/jpeg"
        aria-label="Profile photo"
        onChange={(e) => {
          void choose(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
