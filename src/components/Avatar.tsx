import { useState } from 'react';
import { getInitials } from '../utils/formatters';

interface AvatarProps {
  name: string;
  avatarUrl?: string | null;
  isOnline?: boolean;
  showPresenceDot?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'h-9 w-9 text-xs',
  md: 'h-11 w-11 text-sm',
  lg: 'h-12 w-12 text-base',
};

const DOT_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'h-2.5 w-2.5',
  md: 'h-3 w-3',
  lg: 'h-3.5 w-3.5',
};

export function Avatar({
  name,
  avatarUrl,
  isOnline = false,
  showPresenceDot = false,
  size = 'md',
}: AvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div className="relative inline-flex shrink-0">
      {avatarUrl && !imgFailed ? (
        <img
          src={avatarUrl}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className={`${SIZE_CLASSES[size]} rounded-full object-cover border border-slate-200 bg-slate-100`}
        />
      ) : (
        <div
          aria-label={name}
          className={`${SIZE_CLASSES[size]} rounded-full bg-teal-50 text-teal-800 border border-teal-200/80 flex items-center justify-center font-semibold select-none`}
        >
          {getInitials(name)}
        </div>
      )}

      {showPresenceDot && (
        <span
          title={isOnline ? 'Online' : 'Offline'}
          className={`${DOT_CLASSES[size]} absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-white ${
            isOnline ? 'bg-emerald-600' : 'bg-slate-400'
          }`}
        />
      )}
    </div>
  );
}
