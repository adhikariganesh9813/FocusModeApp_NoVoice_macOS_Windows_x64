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
      lastStatsDate: null,
      pausedAt: null,
      accumulatedPauseTime: 0,
      activityByDay: {},
      activityByMonth: {},
      activityByYear: {}
    };
  }

  async function readRawStats() {
    if (global.electronStore && global.electronStore.loadStats) {
      return global.electronStore.loadStats();
    }
    return null;
  }

  async function writeRawStats(data) {
    if (global.electronStore && global.electronStore.saveStats) {
      return global.electronStore.saveStats(data);
    }
    return false;
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

  function buildHistoryFromAggregates(aggregates) {
    const activityByDay = aggregates && aggregates.activityByDay ? aggregates.activityByDay : {};
    const entries = Object.entries(activityByDay).filter(([, seconds]) => Number.isFinite(seconds) && seconds > 0);
    if (!entries.length) return [];
    return entries
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dayKey, seconds]) => {
        const start = new Date(`${dayKey}T12:00:00`);
        const durationSeconds = Math.max(0, Math.round(seconds));
        const end = new Date(start.getTime() + (durationSeconds * 1000));
        const startIso = start.toISOString();
        const endIso = end.toISOString();
        return {
          id: `day-${dayKey}`,
          startTime: startIso,
          endTime: endIso,
          durationSeconds,
          type: 'focus',
          completed: true,
          createdAt: endIso
        };
      });
  }

  async function migrateIfNeeded() {
    const raw = await readRawStats();
    const next = ensureSchema(raw);
    if (Array.isArray(next.sessionHistory) && next.sessionHistory.length === 0) {
      const rebuilt = buildHistoryFromAggregates(next);
      if (rebuilt.length) {
        next.sessionHistory = rebuilt;
      }
    }
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
    const data = await migrateIfNeeded();
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
