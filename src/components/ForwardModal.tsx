import React, { useMemo, useState } from 'react';
import { CornerUpRight, Hash, Lock, Search, Send, X } from 'lucide-react';
import { Avatar } from './Avatar';
import { getDisplayName, sendMessage } from '../lib/api';
import type { ChatMessage, ChatSummary, Profile } from '../types';

interface ForwardModalProps {
  message: ChatMessage | null;
  chats: ChatSummary[];
  currentUser: Profile;
  nicknames?: Record<string, string>;
  onClose: () => void;
  onForwarded: (targetChatId: string, label: string) => void;
}

export const ForwardModal: React.FC<ForwardModalProps> = ({
  message,
  chats,
  currentUser,
  nicknames = {},
  onClose,
  onForwarded,
}) => {
  const [query, setQuery] = useState('');
  const [sendingToId, setSendingToId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filteredChats = useMemo(() => {
    const q = query.trim().toLowerCase();
    return chats.filter((c) => {
      if (!q) return true;
      const label =
        c.type === 'dm'
          ? getDisplayName(c.partner?.id, c.partner?.username ?? 'Direct chat', nicknames)
          : c.name ?? 'Group';
      const handle = c.type === 'dm' ? c.partner?.username ?? '' : '';
      return label.toLowerCase().includes(q) || handle.toLowerCase().includes(q);
    });
  }, [chats, query, nicknames]);

  if (!message) return null;

  const forwardBody =
    message.body.trim() ||
    (message.attachment
      ? `[${message.attachment.kind === 'photo' ? 'Photo' : 'File'}: ${message.attachment.fileName}]`
      : '');

  const handleForward = async (target: ChatSummary) => {
    if (!forwardBody || sendingToId) return;
    setSendingToId(target.id);
    setError(null);
    const label =
      target.type === 'dm'
        ? getDisplayName(target.partner?.id, target.partner?.username ?? 'Direct chat', nicknames)
        : target.name ?? 'Group';
    try {
      await sendMessage(
        target.id,
        currentUser,
        forwardBody.slice(0, 1000),
        undefined,
        target.type === 'dm' ? target.partner?.id ?? null : null,
        { forwarded: true },
      );
      onForwarded(target.id, label);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to forward message.');
    } finally {
      setSendingToId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 dark:bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Forward message"
    >
      <div
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#141414] border border-slate-200 dark:border-white/[0.1] shadow-2xl overflow-hidden flex flex-col max-h-[82vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-100 dark:border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CornerUpRight className="w-4 h-4 text-[#2B84F6]" />
            <h2 className="text-base font-semibold tracking-tight">Forward message</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close forward modal"
            className="min-h-[40px] min-w-[40px] -mr-2 rounded-full flex items-center justify-center text-slate-500 dark:text-neutral-400 hover:bg-slate-100 dark:hover:bg-white/[0.08]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 pt-3 pb-2 space-y-3">
          <div className="p-3 rounded-2xl bg-slate-50 dark:bg-[#1C1C1E] border border-slate-200/80 dark:border-white/[0.08] min-w-0 overflow-hidden">
            <p className="text-xs font-medium text-slate-500 dark:text-neutral-400 truncate">
              From {getDisplayName(message.senderId, message.senderUsername, nicknames)}
            </p>
            <p className="text-sm text-slate-800 dark:text-neutral-200 line-clamp-2 break-words [overflow-wrap:anywhere] mt-0.5">
              {forwardBody}
            </p>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 dark:text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats..."
              className="w-full min-h-[42px] pl-10 pr-4 py-2 rounded-2xl bg-slate-100 dark:bg-[#1C1C1E] border border-transparent focus:border-[#2B84F6]/40 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#2B84F6]"
            />
          </div>

          {error && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400 px-1">
              {error}
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto chat-scroll px-3 pb-5">
          {filteredChats.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-neutral-400">
              No matching chats found.
            </p>
          ) : (
            <ul className="space-y-1">
              {filteredChats.map((c) => {
                const isDm = c.type === 'dm';
                const isPrivate = c.visibility === 'private';
                const label = isDm
                  ? getDisplayName(c.partner?.id, c.partner?.username ?? 'Direct chat', nicknames)
                  : c.name ?? 'Group';
                const busy = sendingToId === c.id;

                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      disabled={Boolean(sendingToId) || currentUser.banned}
                      onClick={() => handleForward(c)}
                      className="w-full min-h-[56px] px-3 py-2 rounded-2xl hover:bg-slate-100 dark:hover:bg-white/[0.06] flex items-center justify-between gap-3 text-left transition-colors disabled:opacity-50"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {isDm ? (
                          <Avatar
                            username={label}
                            color={c.partner?.color ?? '#2B84F6'}
                            avatarUrl={c.partner?.avatarUrl}
                            size="sm"
                          />
                        ) : (
                          <div className="h-9 w-9 rounded-full bg-slate-200 dark:bg-[#242426] text-slate-600 dark:text-neutral-300 flex items-center justify-center shrink-0">
                            {isPrivate ? (
                              <Lock className="w-4 h-4 text-amber-500" />
                            ) : (
                              <Hash className="w-4 h-4" />
                            )}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">{label}</p>
                          <p className="text-xs text-slate-500 dark:text-neutral-400">
                            {isDm ? 'Direct chat' : isPrivate ? 'Private group' : 'Public group'}
                          </p>
                        </div>
                      </div>
                      <span className="min-h-[34px] px-3 py-1 rounded-full bg-[#2B84F6] text-white text-xs font-semibold inline-flex items-center gap-1.5 shrink-0">
                        <Send className="w-3 h-3" />
                        <span>{busy ? 'Sending...' : 'Send'}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
