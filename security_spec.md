# VeilChat Firestore Security Specification

## 1. Data Invariants
1. **No PII**: `/profiles/{userId}` stores only `uid`, random `username`, `color`, `banned`, `lastUsernameChangeAt`, and `createdAt`.
2. **No Self-Unban or Privilege Escalation**: Users cannot create a profile with `banned: true` or modify `banned`, `uid`, or `createdAt`.
3. **24-Hour Username Rotation Cooldown**: A user may only update `username` and `lastUsernameChangeAt` when `lastUsernameChangeAt == null` or `request.time >= existing.lastUsernameChangeAt + 24h`.
4. **Master Gate Membership**: Messages inside `/chats/{chatId}/messages` can only be read or created by current members verified in `/chats/{chatId}/members/{uid}`.
5. **Immutable Messages**: Messages cannot be updated or deleted by any user (`allow update, delete: if false`).
6. **1000-Char & 5/10s Rate Limit**: Every message body is 1–1000 chars (non-empty after trim) and must atomically advance `/rateLimits/{uid}` (max 5 messages per 10 seconds).
7. **Banned User Restriction**: Banned users cannot create chats, join groups, or send messages.
8. **DM Isolation**: Only `type == 'group'` chats can be listed in group search. DM rooms use deterministic `dm_<minUid>_<maxUid>` IDs and cannot be listed globally.
9. **Reports Privacy**: Regular users can create reports with `reporterId == request.auth.uid`, but cannot read, list, edit, or delete reports.

## 2. Adversarial Test Payloads ("Dirty Dozen")
1. **Shadow Field Injection on Profile**: `{ uid, username: "Fox1234", color: "#6366F1", banned: false, lastUsernameChangeAt: null, createdAt: serverTime, isAdmin: true }` -> Rejected (`hasOnly` check).
2. **Self-Unban / Tamper on Profile Update**: Updating `banned: false` as non-admin -> Rejected (`affectedKeys().hasOnly(['username', 'lastUsernameChangeAt'])`).
3. **Cooldown Bypass on Username Rotation**: Updating `username` within 24 hours of `lastUsernameChangeAt` -> Rejected (`request.time >= existing().lastUsernameChangeAt + duration.value(24, 'h')`).
4. **Profile Spoofing**: Creating `/profiles/victimUid` while signed in as `attackerUid` -> Rejected (`isOwner(userId)`).
5. **Non-Member Message Read / List**: Listing `/chats/{privateDmId}/messages` as a non-member -> Rejected (`isChatMember(chatId)`).
6. **Non-Member Message Write**: Creating a message in `/chats/{groupId}/messages` without membership -> Rejected (`isChatMember(chatId)`).
7. **Message Edit / Delete**: Updating or deleting an existing message -> Rejected (`allow update, delete: if false`).
8. **Oversized Message / Empty Body**: Creating a message with 1001 characters or whitespace-only body -> Rejected (`body.trim().size() >= 1 && body.size() <= 1000`).
9. **Rate Limit Bypass (6th message in 10s)**: Creating a message without updating `/rateLimits/{uid}` or with `count: 6` -> Rejected (`getAfter` + `count <= 5`).
10. **Global DM Scraping**: Listing `/chats` without `where('type', '==', 'group')` -> Rejected (`existing().type == 'group'`).
11. **Self-Block or Missing Target**: Creating `/profiles/{uid}/blocks/{uid}` -> Rejected (`blockedUserId != userId`).
12. **Reading Other Users' Reports**: Calling `getDocs(collection(db, 'reports'))` as non-admin -> Rejected (`isAdmin()`).
