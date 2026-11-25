# Buddy Chat Firestore Security Specification

## 1. Data Invariants
1. **No PII**: `/profiles/{userId}` stores only `uid`, random `username`, `color`, optional `bio` (`<= 240` chars), optional `avatarUrl` (compressed data URL `<= 220 KB`), `usernameHistory` (`<= 20` entries), `banned`, `lastUsernameChangeAt`, and `createdAt`. Real Google name, email, and photo URL are never stored.
2. **No Self-Unban or Privilege Escalation**: Users cannot create a profile with `banned: true` or modify `banned`, `uid`, or `createdAt`.
3. **24-Hour Username Rotation Cooldown & History**: A user may only update `username`, `lastUsernameChangeAt`, and `usernameHistory` when `lastUsernameChangeAt == null` or `request.time >= existing.lastUsernameChangeAt + 24h`.
4. **Master Gate Membership**: Messages, attachments, and view-once records inside `/chats/{chatId}` can only be read or created by current members verified in `/chats/{chatId}/members/{uid}`.
5. **Private Groups & Admin Approval**: Private groups (`visibility == 'private'`) block direct self-join (`members` / `memberCount`). Non-members must create a pending `/chats/{chatId}/joinRequests/{uid}` doc, and only the group creator (`createdBy == request.auth.uid`) can approve or decline requests.
6. **Immutable 24-Hour Messages & 5 MB Attachments**: Messages cannot be updated or deleted by any user (`allow update, delete: if false`), include `expiresAt` (24h window), allow `body` up to 1000 chars (with `body` optional when an `attachment` is present), and enforce `attachment.sizeBytes <= 5242880` (5 MB) split into <= 16 chunks (`<= 900000` chars per chunk).
7. **View-Once Photo Enforcement**: Once a member records `/chats/{chatId}/messages/{messageId}/views/{uid}`, Firestore rules deny subsequent `get` reads on view-once attachment chunks (`isViewOnce == true`) for that user.
8. **5/10s Rate Limit & Banned Guard**: Every message must atomically advance `/rateLimits/{uid}` (max 5 messages per 10 seconds). Banned users cannot create chats, join groups, request private groups, or send messages or attachments.
9. **DM Isolation & Reports Privacy**: Only `type == 'group'` chats can be listed globally. Reports are create-only for signed-in users and readable only by admins.

## 2. Adversarial Test Payloads
1. **Shadow Field Injection on Profile**: Adding `isAdmin: true` or arbitrary keys -> Rejected (`hasOnly` check).
2. **Self-Unban / Tamper on Profile Update**: Updating `banned: false` as non-admin -> Rejected (`affectedKeys().hasOnly(...)`).
3. **Cooldown Bypass on Username Rotation**: Updating `username` within 24 hours of `lastUsernameChangeAt` -> Rejected.
4. **Direct Join on Private Group**: Self-adding `/chats/{privateGroupId}/members/{uid}` -> Rejected (`visibility == 'public'` check).
5. **Non-Admin Approval on Join Request**: Non-creator updating `joinRequests/{userId}` status to `approved` -> Rejected (`isGroupAdmin(chatId)`).
6. **Oversized Attachment (> 5 MB)**: Message `attachment.sizeBytes > 5242880` or chunk `index >= 16` / `data.size() > 900000` -> Rejected.
7. **Re-Reading Opened View-Once Photo**: Calling `getDoc` on a chunk with `isViewOnce: true` after `/views/{uid}` exists -> Rejected (`!exists(.../views/$(request.auth.uid))`).
8. **Rate Limit Bypass (6th message in 10s)**: Creating a message without updating `/rateLimits/{uid}` or with `count: 6` -> Rejected.
9. **Global DM Scraping**: Listing `/chats` without `where('type', '==', 'group')` -> Rejected.
10. **Reading Other Users' Reports**: Calling `getDocs(collection(db, 'reports'))` as non-admin -> Rejected (`isAdmin()`).
