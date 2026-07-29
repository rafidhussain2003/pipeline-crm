// The Fresh Leads new-arrival alert sound — synthesized with the Web Audio API
// (no shipped asset, no fetch/decode latency), like the callback chime.
//
// This one is deliberately DIFFERENT from the callback chime: a fresh lead is
// time-sensitive and easy to miss, so instead of a single note it plays a
// short *sequence* of attention beeps over a few seconds. But it is bounded
// and interruptible:
//   • A single sequence at a time — startNewLeadAlert() while one is already
//     playing is a no-op, so a burst of arrivals never stacks overlapping
//     sounds on top of each other.
//   • It stops on its own after ~4s, and stopNewLeadAlert() cuts it short the
//     instant the manager acknowledges (opens/assigns/dismisses).
// A sound the manager can't silence is the fastest way to get sound muted
// forever, so both exits matter.

const MUTE_KEY = "ziplod.newLeadSound.muted";

export function isNewLeadSoundMuted(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(MUTE_KEY) === "1";
}
export function setNewLeadSoundMuted(muted: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
}

const BEEP_INTERVAL_MS = 750; // gap between beeps in the sequence
const SEQUENCE_MS = 4_000; // total sequence length (~5-6 beeps)

let ctx: AudioContext | null = null;
let playing = false;
let intervalId: ReturnType<typeof setInterval> | null = null;
let stopTimer: ReturnType<typeof setTimeout> | null = null;

export function isNewLeadAlertPlaying(): boolean {
  return playing;
}

function beep(): void {
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  const now = ctx.currentTime;
  // A brisk two-note blip (C6 -> E6) — short attack/decay so it reads as a
  // notification, not an alarm.
  for (const [i, freq] of [1047, 1319].entries()) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const start = now + i * 0.09;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.3, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.2);
  }
}

// Start the alert sequence. No-op if one is already playing (single,
// non-overlapping sequence) or if the manager muted the sound.
export function startNewLeadAlert(): void {
  if (typeof window === "undefined" || playing || isNewLeadSoundMuted()) return;
  try {
    type WithWebkit = typeof window & { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext || (window as WithWebkit).webkitAudioContext;
    if (!Ctor) return;
    ctx = ctx ?? new Ctor();
    playing = true;
    beep(); // fire the first beep immediately
    intervalId = setInterval(beep, BEEP_INTERVAL_MS);
    stopTimer = setTimeout(stopNewLeadAlert, SEQUENCE_MS);
  } catch {
    // Audio is a nicety — never let it break the alert itself.
    playing = false;
  }
}

// Stop the sequence immediately (on acknowledge, or when the timer elapses).
export function stopNewLeadAlert(): void {
  playing = false;
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (stopTimer) {
    clearTimeout(stopTimer);
    stopTimer = null;
  }
}
