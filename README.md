# VeilChat — Anonymous Real-Time Chat

VeilChat is an anonymous chat web application built with React, Vite, TypeScript, Tailwind CSS, Firebase Authentication (Google Sign-In), and Cloud Firestore (`firebase-applet-config.json` + `firestore.rules`).

Real names, emails, and Google profile photos are never stored, logged, or displayed.

---

## Features

- **Google Sign-In with Anonymous Handles**: Signs in via Firebase Google Authentication and generates a random handle (e.g., `SilentFox4821`) and color in `/profiles/{uid}`.
- **Public Groups & Direct Messages**: Create public groups, browse/search groups, join or leave rooms, view the member list, and start 1:1 direct messages.
- **Realtime Single-Chat Subscription**: Loads the latest 50 messages via Firestore `onSnapshot` only for the active chat, unsubscribes on leave/switch, and loads older pages when scrolling up.
- **Safety & Rate Limits**: Enforced in `firestore.rules`—immutable messages (no edit/delete), max 1,000 characters, max 5 messages per 10 seconds, `banned` flag enforcement, per-user blocking, and moderation reports.
- **Settings & Legal**: Rotate username once every 24 hours, toggle dark/light theme, manage blocked users, sign out, and read Terms & Privacy.

---

## Firebase Configuration

Client configuration is automatically loaded from `firebase-applet-config.json` (provisioned for project `gen-lang-client-0737333490` and Firestore database `ai-studio-veilchat-586cd741-9749-4af1-8cb1-8550bc557dab`).

Optional `VITE_FIREBASE_*` overrides can be set in `.env` (see `.env.example`).

---

## Local Development

```bash
npm install
npm run dev
```

## Deploying to Vercel

`vercel.json` is included so Vercel automatically uses the Vite preset (`npm run build`), serves `dist/`, and rewrites routes to `/index.html`.

After deploying, add your Vercel domain (for example `chatv1-tngs.vercel.app`) to **Firebase Console -> Authentication -> Settings -> Authorized domains** for project `gen-lang-client-0737333490` so Google Sign-In works on the live URL.

Security rules live in `firestore.rules` (modeled in `firebase-blueprint.json`) and can be linted with:

```bash
npx eslint firestore.rules
```
