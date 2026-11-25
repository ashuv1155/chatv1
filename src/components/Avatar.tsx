import React, { useEffect, useState } from 'react';

interface AvatarProps {
  username: string;
  color: string;
  avatarUrl?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

function getInitials(name: string): string {
  const capitals = name.match(/[A-Z]/g);
  if (capitals && capitals.length >= 2) {
    return `${capitals[0]}${capitals[1]}`;
  }
  return name.slice(0, 2).toUpperCase();
}

export const Avatar: React.FC<AvatarProps> = ({
  username,
  color,
  avatarUrl,
  size = 'md',
}) => {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [avatarUrl]);

  const sizeClass =
    size === 'xs'
      ? 'h-6 w-6 text-[10px] rounded-full'
      : size === 'sm'
        ? 'h-9 w-9 text-xs rounded-full'
        : size === 'lg'
          ? 'h-12 w-12 text-base rounded-full'
          : size === 'xl'
            ? 'h-20 w-20 text-2xl rounded-full'
            : 'h-11 w-11 text-xs rounded-full';

  if (avatarUrl && !imgFailed) {
    return (
      <img
        src={avatarUrl}
        alt={`${username} avatar`}
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
        className={`${sizeClass} shrink-0 object-cover border border-slate-200 dark:border-white/[0.1] select-none bg-slate-200 dark:bg-neutral-800`}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className={`${sizeClass} shrink-0 flex items-center justify-center font-semibold tracking-tight text-white select-none`}
      style={{ backgroundColor: color }}
    >
      {getInitials(username)}
    </div>
  );
};
