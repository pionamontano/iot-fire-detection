// ─── Responder alarm sound (Web Audio siren) ───
// One AudioContext for the whole app session, not one per page: browsers keep page audio blocked until the user
// clicks or types, and a context made on a page mount started out blocked again on every visit to the dashboard
// and after every sign-in. This one is created (and unlocked) by the first tap anywhere in the app, the sign-in
// button included, and survives page changes and signing out and in again. Only a reload needs a new tap.

let ctx: AudioContext | null = null;
let siren: { oscillator: OscillatorNode; gain: GainNode; interval: ReturnType<typeof setInterval> } | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(fn => fn());

const getContext = (): AudioContext | null => {
  if (ctx && ctx.state !== 'closed') return ctx;
  const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  try {
    ctx = new AudioContextClass();
  } catch (err) {
    console.warn('AudioContext unavailable:', err);
    return null;
  }
  // iOS plays Web Audio in the "ambient" category, which the ring/silent switch mutes; "playback" keeps the
  // siren audible on a phone set to silent (Safari 17+; ignored elsewhere).
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  if (nav.audioSession) {
    try { nav.audioSession.type = 'playback'; } catch { /* unsupported value */ }
  }
  ctx.addEventListener('statechange', notify);
  notify();
  return ctx;
};

/** Makes the context now (if no tap has yet), so isAlarmSoundBlocked can tell before a fire arrives. */
export const prepareAlarmSound = () => { getContext(); };

/** True while the browser blocks the alarm sound ('suspended', or Safari's 'interrupted'). */
export const isAlarmSoundBlocked = (): boolean => ctx?.state === 'suspended' || ctx?.state === 'interrupted';

export const subscribeAlarmSound = (fn: () => void) => {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};

/** Call from a click, tap or key press: that gesture is what the browser accepts to allow sound. */
export const unlockAlarmSound = () => {
  const c = getContext();
  if (!c || c.state === 'running' || c.state === 'closed') return;
  c.resume().catch(console.warn);
  // iOS only unlocks a context that starts a sound inside the gesture itself: play one silent sample.
  try {
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, 22050);
    src.connect(c.destination);
    src.start(0);
  } catch { /* resume() alone suffices elsewhere */ }
};

let installed = false;
/** Once, at app start: every tap or key press anywhere in the app (sign-in page included) unlocks the sound. */
export const installAlarmSoundUnlock = () => {
  if (installed) return;
  installed = true;
  // iOS Safari grants audio only on touchend/click, not on pointerdown (which fires at touch start).
  (['pointerdown', 'touchend', 'click', 'keydown'] as const).forEach(e => window.addEventListener(e, unlockAlarmSound, true));
  // iOS leaves the context 'interrupted' after the app was backgrounded or the phone locked: try to resume on return.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ctx && ctx.state !== 'running' && ctx.state !== 'closed') {
      ctx.resume().catch(console.warn);
    }
  });
};

export const startSiren = () => {
  if (siren) return;
  const c = getContext();
  if (!c) return;
  try {
    // A siren started while the sound is blocked becomes audible on its own once the next tap unlocks it.
    if (c.state !== 'running') c.resume().catch(console.warn);
    const oscillator = c.createOscillator();
    const gain = c.createGain();
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(800, c.currentTime);
    gain.gain.setValueAtTime(0, c.currentTime);
    oscillator.connect(gain);
    gain.connect(c.destination);
    oscillator.start();
    let high = false;
    const interval = setInterval(() => {
      oscillator.frequency.setTargetAtTime(high ? 800 : 1200, c.currentTime, 0.1);
      gain.gain.setTargetAtTime(0.3, c.currentTime, 0.1);
      high = !high;
    }, 500);
    siren = { oscillator, gain, interval };
  } catch (err) {
    console.warn('AudioContext failed to start:', err);
  }
};

export const stopSiren = () => {
  if (!siren) return;
  const { oscillator, gain, interval } = siren;
  siren = null;
  clearInterval(interval);
  try {
    if (ctx) gain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    setTimeout(() => {
      try { oscillator.stop(); } catch { /* already stopped */ }
      oscillator.disconnect();
      gain.disconnect();
    }, 200);
  } catch (err) {
    console.warn('Error stopping audio:', err);
  }
};
