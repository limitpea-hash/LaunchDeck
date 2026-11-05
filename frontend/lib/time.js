const WEEKDAY_EN_TO_INDEX = new Map([
  ['Sun', 0],
  ['Mon', 1],
  ['Tue', 2],
  ['Wed', 3],
  ['Thu', 4],
  ['Fri', 5],
  ['Sat', 6],
]);

const WEEKDAY_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function isValidTimeZone(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 80) return false;
  if (value !== 'UTC' && !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function getBrowserTimeZone() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(zone) ? zone : 'UTC';
  } catch {
    return 'UTC';
  }
}

export function getTimePartsInZone(epochMs, timeZone = 'UTC') {
  const safeZone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: safeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = dtf.formatToParts(new Date(epochMs));
  const map = new Map();
  for (const part of parts) {
    if (part.type !== 'literal') map.set(part.type, part.value);
  }
  const year = Number(map.get('year'));
  const month = Number(map.get('month'));
  const day = Number(map.get('day'));
  const hour = Number(map.get('hour')) % 24;
  const minute = Number(map.get('minute'));
  const second = Number(map.get('second'));
  const weekdayIndex = WEEKDAY_EN_TO_INDEX.get(map.get('weekday')) ?? 0;
  const weekdayZh = WEEKDAY_ZH[weekdayIndex];
  const pad2 = n => String(n).padStart(2, '0');
  const isoDate = `${year}-${pad2(month)}-${pad2(day)}`;
  const timeHM = `${pad2(hour)}:${pad2(minute)}`;
  const timeHMS = `${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;
  const dateLabelZh = `${month}月${day}日 ${weekdayZh}`;
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    weekdayIndex,
    weekdayZh,
    isoDate,
    timeHM,
    timeHMS,
    dateLabelZh,
    timeZone: safeZone,
  };
}

function wallAsUtcMs(epochMs, timeZone) {
  const p = getTimePartsInZone(epochMs, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

export function getZoneOffsetMinutes(epochMs, timeZone) {
  return Math.round((wallAsUtcMs(epochMs, timeZone) - epochMs) / 60000);
}

export function formatUtcOffsetLabel(offsetMinutes) {
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, '0');
  const mins = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${hours}:${mins}`;
}

export function parseWallTimeInTimeZone({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone = 'UTC') {
  if (!isValidTimeZone(timeZone)) {
    return { status: 'invalid', message: '所选时区不合法' };
  }
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    !Number.isInteger(second) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return { status: 'invalid', message: '日期或时间数值超出范围' };
  }

  const checkDate = new Date(Date.UTC(year, month - 1, day));
  if (
    checkDate.getUTCFullYear() !== year ||
    checkDate.getUTCMonth() + 1 !== month ||
    checkDate.getUTCDate() !== day
  ) {
    return { status: 'invalid', message: '所填日期不存在' };
  }

  const desiredWallUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const probes = [-36, -18, -6, -2, 0, 2, 6, 18, 36].map(h => desiredWallUtc + h * 3600000);
  const candidateSet = new Set();

  for (const probe of probes) {
    const offsetMs = wallAsUtcMs(probe, timeZone) - probe;
    candidateSet.add(desiredWallUtc - offsetMs);
  }

  const sortedCandidates = [...candidateSet].sort((a, b) => a - b);
  const exactMatches = sortedCandidates.filter(cand => wallAsUtcMs(cand, timeZone) === desiredWallUtc);

  if (exactMatches.length === 1) {
    const epochMs = exactMatches[0];
    const offsetMinutes = getZoneOffsetMinutes(epochMs, timeZone);
    return {
      status: 'ok',
      epochMs,
      candidates: [
        {
          epochMs,
          offsetMinutes,
          offsetLabel: formatUtcOffsetLabel(offsetMinutes),
          parts: getTimePartsInZone(epochMs, timeZone),
        },
      ],
    };
  }

  if (exactMatches.length >= 2) {
    const candidates = exactMatches.map((epochMs, idx) => {
      const offsetMinutes = getZoneOffsetMinutes(epochMs, timeZone);
      return {
        epochMs,
        offsetMinutes,
        offsetLabel: formatUtcOffsetLabel(offsetMinutes),
        label: idx === 0 ? `夏令时回拨前 (${formatUtcOffsetLabel(offsetMinutes)})` : `夏令时回拨后 (${formatUtcOffsetLabel(offsetMinutes)})`,
        parts: getTimePartsInZone(epochMs, timeZone),
      };
    });
    return {
      status: 'ambiguous',
      epochMs: candidates[0].epochMs,
      candidates,
      message: '该当地时间因夏令时回拨出现两次，请选择要使用的时区偏移时段',
    };
  }

  const fallbackCandidates = sortedCandidates.slice(0, 2).map(epochMs => {
    const offsetMinutes = getZoneOffsetMinutes(epochMs, timeZone);
    const parts = getTimePartsInZone(epochMs, timeZone);
    return {
      epochMs,
      offsetMinutes,
      offsetLabel: formatUtcOffsetLabel(offsetMinutes),
      label: `${parts.isoDate} ${parts.timeHMS} (${formatUtcOffsetLabel(offsetMinutes)})`,
      parts,
    };
  });

  return {
    status: 'nonexistent',
    epochMs: fallbackCandidates[fallbackCandidates.length - 1]?.epochMs ?? desiredWallUtc,
    candidates: fallbackCandidates,
    message: '该当地时间处于夏令时跳变空档，请选择相邻的有效时间',
  };
}

export function createClockController({ nowPerf = () => performance.now(), nowEpoch = () => Date.now() } = {}) {
  let baseServerEpochMs = nowEpoch();
  let baseDisplayEpochMs = baseServerEpochMs;
  let basePerfMs = nowPerf();
  let state = {
    timeZone: getBrowserTimeZone(),
    timeZoneSource: 'browser',
    mode: 'automatic',
    offsetSeconds: 0,
  };
  const subscribers = new Set();

  function applySnapshot(snapshot = {}) {
    const perf = nowPerf();
    const serverMs = typeof snapshot.serverEpochMs === 'number' && Number.isFinite(snapshot.serverEpochMs)
      ? snapshot.serverEpochMs
      : nowEpoch();
    const offsetSeconds = snapshot.mode === 'manual' && Number.isInteger(snapshot.offsetSeconds)
      ? snapshot.offsetSeconds
      : 0;
    const displayMs = typeof snapshot.displayEpochMs === 'number' && Number.isFinite(snapshot.displayEpochMs)
      ? snapshot.displayEpochMs
      : serverMs + offsetSeconds * 1000;

    baseServerEpochMs = serverMs;
    baseDisplayEpochMs = displayMs;
    basePerfMs = perf;
    state = {
      timeZone: isValidTimeZone(snapshot.timeZone) ? snapshot.timeZone : state.timeZone,
      timeZoneSource: snapshot.timeZoneSource || state.timeZoneSource,
      mode: snapshot.mode === 'manual' ? 'manual' : 'automatic',
      offsetSeconds,
    };
    notify();
  }

  function getDisplayEpochMs() {
    const elapsed = Math.max(0, nowPerf() - basePerfMs);
    return baseDisplayEpochMs + elapsed;
  }

  function getServerEpochMs() {
    const elapsed = Math.max(0, nowPerf() - basePerfMs);
    return baseServerEpochMs + elapsed;
  }

  function getSnapshot() {
    const displayEpochMs = getDisplayEpochMs();
    const serverEpochMs = getServerEpochMs();
    return {
      ...state,
      displayEpochMs,
      serverEpochMs,
      parts: getTimePartsInZone(displayEpochMs, state.timeZone),
    };
  }

  function subscribe(listener) {
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  }

  function notify() {
    const snap = getSnapshot();
    for (const listener of subscribers) {
      try {
        listener(snap);
      } catch {
        // Ignore subscriber error
      }
    }
  }

  return {
    applySnapshot,
    getDisplayEpochMs,
    getServerEpochMs,
    getSnapshot,
    subscribe,
  };
}
