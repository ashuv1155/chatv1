import type { NotificationSettings } from '../types';

const SETTINGS_STORAGE_KEY = 'buddychat_notif_settings';

const DEFAULT_SETTINGS: NotificationSettings = {
  browserNotifications: true,
  soundEnabled: true,
  typingIndicators: true,
};

export function loadNotificationSettings(): NotificationSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<NotificationSettings>;
    return {
      browserNotifications:
        typeof parsed.browserNotifications === 'boolean'
          ? parsed.browserNotifications
          : DEFAULT_SETTINGS.browserNotifications,
      soundEnabled:
        typeof parsed.soundEnabled === 'boolean'
          ? parsed.soundEnabled
          : DEFAULT_SETTINGS.soundEnabled,
      typingIndicators:
        typeof parsed.typingIndicators === 'boolean'
          ? parsed.typingIndicators
          : DEFAULT_SETTINGS.typingIndicators,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveNotificationSettings(settings: NotificationSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore storage errors in private mode
  }
}

export type BrowserNotifPermission = NotificationPermission | 'unsupported';

export function getBrowserNotificationPermission(): BrowserNotifPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotifPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  try {
    const result = await Notification.requestPermission();
    return result;
  } catch {
    return Notification.permission;
  }
}

export function showBrowserNotification(
  title: string,
  body: string,
  onClick?: () => void,
): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  try {
    const notif = new Notification(title, {
      body: body.slice(0, 140),
      tag: `buddychat-${title}`,
      silent: true,
    });
    notif.onclick = () => {
      try {
        window.focus();
      } catch {
        // ignore focus restrictions
      }
      notif.close();
      onClick?.();
    };
    window.setTimeout(() => notif.close(), 5000);
  } catch {
    // Some mobile browsers require ServiceWorkerRegistration.showNotification
  }
}

let sharedAudioCtx: AudioContext | null = null;

export function playNotificationChime(): void {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    if (!sharedAudioCtx) {
      sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx.state === 'suspended') {
      void sharedAudioCtx.resume().catch(() => {});
    }

    const now = sharedAudioCtx.currentTime;
    const notes = [587.33, 880]; // D5 -> A5 gentle chime
    notes.forEach((freq, idx) => {
      if (!sharedAudioCtx) return;
      const osc = sharedAudioCtx.createOscillator();
      const gain = sharedAudioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);
      gain.gain.setValueAtTime(0.0001, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.06, now + idx * 0.08 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.08 + 0.22);
      osc.connect(gain);
      gain.connect(sharedAudioCtx.destination);
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.24);
    });
  } catch {
    // Ignore audio context blocked errors prior to user interaction
  }
}
