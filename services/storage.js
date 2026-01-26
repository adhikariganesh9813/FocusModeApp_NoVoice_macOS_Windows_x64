(function (global) {
  const SCHEMA_VERSION = 1;

  function nowIso() {
    return new Date().toISOString();
  }

  function getEmptyAggregates() {
    return {
      totalFocusTimeSeconds: 0,
      sessionsCompleted: 0,
      waterBreaksTaken: 0,
      currentStreak: 0,
      currentSessionStartTime: null,
      currentSessionInitialTime: 0,
      lastSessionDate: null,
      pausedAt: null,
      accumulatedPauseTime: 0,
      lastActiveAt: null,
      activityByDay: {},
      activityByMonth: {},
      activityByYear: {}
    };
  }

  async function readRawStats() {
    if (global.electronStore && global.electronStore.loadStats) {
      return global.electronStore.loadStats();
    }
    const stored = global.localStorage ? global.localStorage.getItem('focusModeStats') : null;
    return stored ? JSON.parse(stored) : null;
  }

  async function writeRawStats(data) {
    if (global.electronStore && global.electronStore.saveStats) {
      return global.electronStore.saveStats(data);
    }
    if (global.localStorage) {
      global.localStorage.setItem('focusModeStats', JSON.stringify(data));
    }
    return true;
  }

  function ensureSchema(raw) {
    if (!raw || typeof raw !== 'object') {
      return { schemaVersion: SCHEMA_VERSION, sessionHistory: [], ...getEmptyAggregates() };
    }
    if (raw.schemaVersion === SCHEMA_VERSION) {
      return raw;
    }
    return { schemaVersion: SCHEMA_VERSION, sessionHistory: raw.sessionHistory || [], ...raw };
  }

  async function migrateIfNeeded() {
    const raw = await readRawStats();
    const next = ensureSchema(raw);
    if (!raw || raw.schemaVersion !== next.schemaVersion || raw.sessionHistory !== next.sessionHistory) {
      await writeRawStats(next);
    }
    return next;
  }

  async function loadAggregates() {
    const data = await migrateIfNeeded();
    const { sessionHistory, schemaVersion, ...aggregates } = data;
    return aggregates;
  }

  async function saveAggregates(aggregates) {
    const data = ensureSchema(await readRawStats());
    const next = { ...data, ...aggregates, schemaVersion: SCHEMA_VERSION };
    next.sessionHistory = Array.isArray(data.sessionHistory) ? data.sessionHistory : [];
    return writeRawStats(next);
  }

  async function loadSessions() {
    const data = ensureSchema(await readRawStats());
    return Array.isArray(data.sessionHistory) ? data.sessionHistory : [];
  }

  async function recordCompletedSession(session) {
    const data = ensureSchema(await readRawStats());
    const history = Array.isArray(data.sessionHistory) ? data.sessionHistory : [];
    if (session && session.id && history.some((item) => item.id === session.id)) {
      return true;
    }
    history.push(session);
    data.sessionHistory = history;
    data.schemaVersion = SCHEMA_VERSION;
    data.lastSessionRecordedAt = nowIso();
    return writeRawStats(data);
  }

  async function resetAllStats() {
    const payload = {
      schemaVersion: SCHEMA_VERSION,
      sessionHistory: [],
      ...getEmptyAggregates(),
      resetAt: nowIso()
    };
    return writeRawStats(payload);
  }

  const api = {
    loadAggregates,
    saveAggregates,
    loadSessions,
    recordCompletedSession,
    resetAllStats,
    migrateIfNeeded
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.FocusStorage = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
