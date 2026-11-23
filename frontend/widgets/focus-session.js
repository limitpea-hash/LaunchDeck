// Shared, mount-independent focus countdown sessions.
// One live session per widget id; survives widget moves/unmounts so compact,
// detail renders and external launchers all observe the same countdown.

const DEFAULT_ID = 'focus-timer';
const TICK_MS = 250;
const sessions = new Map();

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n === 0) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeFocusConfig(config, base = { workMinutes: 25, breakMinutes: 5 }) {
  return {
    workMinutes: clampInt(config?.workMinutes, 1, 180, base.workMinutes),
    breakMinutes: clampInt(config?.breakMinutes, 1, 60, base.breakMinutes),
  };
}

function createFocusSession(initialConfig) {
  let config = normalizeFocusConfig(initialConfig);
  let phase = 'work';
  let running = false;
  let totalSeconds = config.workMinutes * 60;
  let remainingSeconds = totalSeconds;
  let deadline = 0;
  let intervalId = null;
  const listeners = new Set();

  const phaseSeconds = (p) => (p === 'work' ? config.workMinutes : config.breakMinutes) * 60;

  function getState() {
    return { phase, running, totalSeconds, remainingSeconds };
  }

  function notify() {
    const state = getState();
    for (const fn of Array.from(listeners)) {
      try {
        fn(state);
      } catch (err) {
        console.error('[focus-session] listener failed', err);
      }
    }
  }

  function clearTick() {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function computeRemaining() {
    return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  }

  function finish() {
    clearTick();
    running = false;
    phase = phase === 'work' ? 'break' : 'work';
    totalSeconds = phaseSeconds(phase);
    remainingSeconds = totalSeconds;
  }

  function tick() {
    if (!running) {
      clearTick();
      return;
    }
    const next = computeRemaining();
    if (next <= 0) {
      finish();
      notify();
      return;
    }
    if (next !== remainingSeconds) {
      remainingSeconds = next;
      notify();
    }
  }

  function pause() {
    if (!running) return false;
    remainingSeconds = computeRemaining();
    running = false;
    clearTick();
    if (remainingSeconds <= 0) finish();
    return true;
  }

  function start() {
    if (running) return;
    if (remainingSeconds <= 0) {
      totalSeconds = phaseSeconds(phase);
      remainingSeconds = totalSeconds;
    }
    running = true;
    deadline = Date.now() + remainingSeconds * 1000;
    clearTick();
    intervalId = setInterval(tick, TICK_MS);
  }

  return {
    getState,
    getConfig() {
      return { ...config };
    },
    subscribe(fn, { immediate = true } = {}) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      if (immediate) {
        try {
          fn(getState());
        } catch (err) {
          console.error('[focus-session] listener failed', err);
        }
      }
      return () => {
        listeners.delete(fn);
      };
    },
    toggle() {
      if (running) pause();
      else start();
      notify();
    },
    reset() {
      pause();
      totalSeconds = phaseSeconds(phase);
      remainingSeconds = totalSeconds;
      notify();
    },
    setPhase(nextPhase) {
      if (nextPhase !== 'work' && nextPhase !== 'break') return;
      pause();
      phase = nextPhase;
      totalSeconds = phaseSeconds(phase);
      remainingSeconds = totalSeconds;
      notify();
    },
    setConfig(nextConfig) {
      const next = normalizeFocusConfig(nextConfig, config);
      if (next.workMinutes === config.workMinutes && next.breakMinutes === config.breakMinutes) {
        return;
      }
      config = next;
      if (!running) {
        totalSeconds = phaseSeconds(phase);
        remainingSeconds = totalSeconds;
      }
      notify();
    },
  };
}

export function getFocusSession(id = DEFAULT_ID, config) {
  const key = id == null || id === '' ? DEFAULT_ID : String(id);
  let session = sessions.get(key);
  if (!session) {
    session = createFocusSession(config);
    sessions.set(key, session);
  } else if (config) {
    session.setConfig(config);
  }
  return session;
}
