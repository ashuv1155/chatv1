import React from 'react';

interface RichMessageTextProps {
  text: string;
  isOwn?: boolean;
}

const URL_REGEX =
  /(https?:\/\/[^\s<>"'`]+|www\.[^\s<>"'`]+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|org|net|edu|gov|io|co|ai|app|dev|me|in|uk|us|ca|de|fr|jp|au|info|biz|tv|gg|xyz|ly|be|gl|sh|to)(?::\d{1,5})?(?:\/[^\s<>"'`]*)?)/gi;
const TRAILING_PUNCT_REGEX = /[.,!?;:'"<>]+$/;
const MAX_VISIBLE_LINK_CHARS = 60;

function splitTrailingPunctuation(rawUrl: string): { urlPart: string; trailing: string } {
  let urlPart = rawUrl;
  let trailing = '';

  const punctMatch = urlPart.match(TRAILING_PUNCT_REGEX);
  if (punctMatch) {
    trailing = punctMatch[0];
    urlPart = urlPart.slice(0, -trailing.length);
  }

  // Strip unmatched closing parentheses/brackets (e.g., "(https://example.com)")
  while (urlPart.endsWith(')')) {
    const opens = (urlPart.match(/\(/g) ?? []).length;
    const closes = (urlPart.match(/\)/g) ?? []).length;
    if (closes > opens) {
      trailing = ')' + trailing;
      urlPart = urlPart.slice(0, -1);
    } else {
      break;
    }
  }

  while (urlPart.endsWith(']')) {
    const opens = (urlPart.match(/\[/g) ?? []).length;
    const closes = (urlPart.match(/\]/g) ?? []).length;
    if (closes > opens) {
      trailing = ']' + trailing;
      urlPart = urlPart.slice(0, -1);
    } else {
      break;
    }
  }

  return { urlPart, trailing };
}

function toSafeHttpHref(candidate: string): string | null {
  const normalized = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function formatLinkDisplay(urlPart: string): string {
  if (urlPart.length <= MAX_VISIBLE_LINK_CHARS) return urlPart;
  return `${urlPart.slice(0, MAX_VISIBLE_LINK_CHARS - 3)}...`;
}

export const RichMessageText: React.FC<RichMessageTextProps> = ({ text, isOwn = false }) => {
  if (!text) return null;

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;

  const regex = new RegExp(URL_REGEX.source, 'gi');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const start = match.index;
    const rawMatch = match[0];

    // Skip matches preceded by '@' or word characters (e.g. emails like name@domain.com)
    if (start > 0 && !/[\s([{"'`]/.test(text[start - 1])) {
      continue;
    }

    if (start > lastIndex) {
      nodes.push(text.slice(lastIndex, start));
    }

    const { urlPart, trailing } = splitTrailingPunctuation(rawMatch);
    const safeHref = urlPart ? toSafeHttpHref(urlPart) : null;

    if (safeHref && urlPart) {
      const displayLabel = formatLinkDisplay(urlPart);
      nodes.push(
        <a
          key={`${start}-${urlPart}`}
          href={safeHref}
          target="_blank"
          rel="noopener noreferrer nofollow"
          title={urlPart}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className={`inline cursor-pointer font-medium underline underline-offset-2 decoration-1 break-all [overflow-wrap:anywhere] transition-opacity hover:opacity-80 ${
            isOwn
              ? 'text-white decoration-white/80'
              : 'text-[#2B84F6] dark:text-[#60A5FA] decoration-[#2B84F6]/65'
          }`}
        >
          {displayLabel}
        </a>,
      );
      if (trailing) {
        nodes.push(trailing);
      }
    } else {
      nodes.push(rawMatch);
    }

    lastIndex = start + rawMatch.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return (
    <p className="text-sm sm:text-[15px] leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] max-w-full">
      {nodes}
    </p>
  );
};
