import React from 'react';

interface AvatarProps {
  username: string;
  color: string;
  size?: 'sm' | 'md' | 'lg';
}

function getInitials(name: string): string {
  const capitals = name.match(/[A-Z]/g);
  if (capitals && capitals.length >= 2) {
    return `${capitals[0]}${capitals[1]}`;
  }
  return name.slice(0, 2).toUpperCase();
}

export const Avatar: React.FC<AvatarProps> = ({ username, color, size = 'md' }) => {
  const sizeClass =
    size === 'sm'
      ? 'h-8 w-8 text-xs'
      : size === 'lg'
        ? 'h-12 w-12 text-base'
        : 'h-9 w-9 text-xs';

  return (
    <div
      aria-hidden="true"
      className={`${sizeClass} shrink-0 rounded-xl flex items-center justify-center font-semibold tracking-tight text-white select-none`}
      style={{ backgroundColor: color }}
    >
      {getInitials(username)}
    </div>
  );
};
