// The reminder sound, synthesized with the Web Audio API rather than shipped as
// an .mp3: no binary asset, no network fetch, no decode latency — the chime is
// ready the instant the reminder lands.
//
// Deliberately: it plays ONCE per reminder and never loops. A looping alarm an
// agent has to hunt down is the fastest way to get sound turned off forever.

const MUTE_KEY = "ziplod.callbackSound.muted";
const VOLUME_KEY = "ziplod.callbackSound.volume";

export function isMuted(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(MUTE_KEY) === "1";
}
export function setMuted(muted: boolean): void {
  window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
}
export function getVolume(): number {
  if (typeof window === "undefined") return 0.5;
  const v = Number(window.localStorage.getItem(VOLUME_KEY));
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.5;
}
export function setVolume(v: number): void {
  window.localStorage.setItem(VOLUME_KEY, String(Math.max(0, Math.min(1, v))));
}

let ctx: AudioContext | null = null;

// A two-note rising chime (G5 → C6). Short, soft attack/decay so it reads as a
// notification rather than an alarm.
export function playChime(): void {
  if (typeof window === "undefined" || isMuted()) return;
  const volume = getVolume();
  if (volume <= 0) return;
  try {
    type WithWebkit = typeof window & { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext || (window as WithWebkit).webkitAudioContext;
    if (!Ctor) return;
    ctx = ctx ?? new Ctor();
    // Browsers suspend the context until a user gesture; a suspended resume()
    // that never lands simply means no sound, which is the correct outcome.
    if (ctx.state === "suspended") void ctx.resume();

    const now = ctx.currentTime;
    for (const [i, freq] of [784, 1047].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.14;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume * 0.35, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.34);
    }
  } catch {
    /* audio is a nicety — never let it break the reminder itself */
  }
}
