(function (global) {
  const SCHEMA_VERSION = 2;
  const STREAK_THRESHOLD_SECONDS = 30 * 60;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  function nowIso(now = new Date()) {
    return now.toISOString();
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function toLocalDayKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function parseDayKey(dayKey) {
    if (!isDayKey(dayKey)) return null;
    const [year, month, day] = dayKey.split('-').map((part) => Number(part));
    return new Date(year, month - 1, day);
  }

  function addDays(dayKey, dayCount) {
    const base = parseDayKey(dayKey);
    if (!base) return null;
    return toLocalDayKey(new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayCount));
  }

  function isDayKey(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  function asNonNegativeInt(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.round(numeric));
  }

  function normalizeRuntime(runtime) {
    const source = runtime && typeof runtime === 'object' ? runtime : {};
    return {
      currentSessionStartTime: Number.isFinite(source.currentSessionStartTime) ? source.currentSessionStartTime : null,
      currentSessionInitialTime: asNonNegativeInt(source.currentSessionInitialTime),
      pausedAt: Number.isFinite(source.pausedAt) ? source.pausedAt : null,
      accumulatedPauseTime: asNonNegativeInt(source.accumulatedPauseTime)
    };
  }

  function normalizeDailyRecord(rawRecord, dateKey) {
    const source = rawRecord && typeof rawRecord === 'object' ? rawRecord : {};
    return {
      dateKey,
      totalFocusSeconds: asNonNegativeInt(source.totalFocusSeconds),
      sessionsCount: asNonNegativeInt(source.sessionsCount),
      waterBreaksTaken: asNonNegativeInt(source.waterBreaksTaken),
      lastUpdatedAt: typeof source.lastUpdatedAt === 'string' ? source.lastUpdatedAt : null
    };
  }

  function createDailyRecord(dateKey, now) {
    return {
      dateKey,
      totalFocusSeconds: 0,
      sessionsCount: 0,
      waterBreaksTaken: 0,
      lastUpdatedAt: nowIso(now)
    };
  }

  function emptyState(now = new Date()) {
    const todayKey = toLocalDayKey(now);
    return {
      schemaVersion: SCHEMA_VERSION,
      createdAt: nowIso(now),
      updatedAt: nowIso(now),
      migratedAt: null,
      migrationSourceVersion: null,
      lastActiveDateKey: todayKey,
      dailyRecords: {
        [todayKey]: createDailyRecord(todayKey, now)
      },
      sessionHistory: [],
      runtime: normalizeRuntime({}),
      totalWaterBreaks: 0,
      lastSessionSeconds: 0,
      lastSessionRecordedAt: null,
      resetAt: null
    };
  }

  function normalizeSession(session) {
    if (!session || typeof session !== 'object') return null;
    const startMs = new Date(session.startTime).getTime();
    const endMs = new Date(session.endTime).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
    const durationSeconds = Number.isFinite(session.durationSeconds)
      ? asNonNegativeInt(session.durationSeconds)
      : asNonNegativeInt(Math.floor((endMs - startMs) / 1000));
    const startTime = new Date(startMs).toISOString();
    const endTime = new Date(endMs).toISOString();
    const fallbackId = `session-${startMs}-${durationSeconds}`;
    return {
      id: typeof session.id === 'string' && session.id.trim() ? session.id : fallbackId,
      startTime,
      endTime,
      durationSeconds,
      type: typeof session.type === 'string' ? session.type : 'focus',
      completed: session.completed !== false,
      createdAt: typeof session.createdAt === 'string' ? session.createdAt : endTime
    };
  }

  function dedupeSessions(sessions) {
    const list = Array.isArray(sessions) ? sessions : [];
    const seen = new Set();
    const normalized = [];
    list.forEach((session) => {
      const item = normalizeSession(session);
      if (!item) return;
      const key = item.id;
      if (seen.has(key)) return;
      seen.add(key);
      normalized.push(item);
    });
    normalized.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    return normalized;
  }

  function parseSessionTimes(session) {
    const startMs = new Date(session.startTime).getTime();
    const endMs = new Date(session.endTime).getTime();
    const durationSeconds = Number.isFinite(session.durationSeconds)
      ? asNonNegativeInt(session.durationSeconds)
      : asNonNegativeInt(Math.floor((endMs - startMs) / 1000));
    return { startMs, endMs, durationSeconds };
  }

  function splitSessionByDay(session) {
    const { startMs, endMs } = parseSessionTimes(session);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      return [];
    }
    const chunks = [];
    let cursor = new Date(startMs);
    const end = new Date(endMs);
    while (cursor < end) {
      const dayStart = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
      const nextDayStart = new Date(dayStart.getTime() + MS_PER_DAY);
      const segmentEnd = nextDayStart < end ? nextDayStart : end;
      const seconds = Math.max(0, Math.floor((segmentEnd.getTime() - cursor.getTime()) / 1000));
      chunks.push({ dayKey: toLocalDayKey(cursor), seconds });
      cursor = segmentEnd;
    }
    return chunks;
  }

  function addHistoryIntoDailyRecords(dailyRecords, sessions, now) {
    sessions.forEach((session) => {
      const startDay = toLocalDayKey(new Date(session.startTime));
      if (!dailyRecords[startDay]) {
        dailyRecords[startDay] = createDailyRecord(startDay, now);
      }
      dailyRecords[startDay].sessionsCount += 1;
      splitSessionByDay(session).forEach((chunk) => {
        if (!dailyRecords[chunk.dayKey]) {
          dailyRecords[chunk.dayKey] = createDailyRecord(chunk.dayKey, now);
        }
        dailyRecords[chunk.dayKey].totalFocusSeconds += asNonNegativeInt(chunk.seconds);
      });
    });
  }

  function ensureDayRecord(state, dayKey, now) {
    if (!isDayKey(dayKey)) return null;
    if (!state.dailyRecords[dayKey]) {
      state.dailyRecords[dayKey] = createDailyRecord(dayKey, now);
    }
    return state.dailyRecords[dayKey];
  }

  function normalizeDailyRecords(rawDailyRecords, now) {
    const source = rawDailyRecords && typeof rawDailyRecords === 'object' ? rawDailyRecords : {};
    const normalized = {};
    Object.keys(source).forEach((dayKey) => {
      if (!isDayKey(dayKey)) return;
      normalized[dayKey] = normalizeDailyRecord(source[dayKey], dayKey);
    });
    if (!Object.keys(normalized).length) {
      const todayKey = toLocalDayKey(now);
      normalized[todayKey] = createDailyRecord(todayKey, now);
    }
    return normalized;
  }

  function mergeLegacyActivityByDay(dailyRecords, activityByDay, now) {
    const source = activityByDay && typeof activityByDay === 'object' ? activityByDay : {};
    Object.keys(source).forEach((dayKey) => {
      if (!isDayKey(dayKey)) return;
      const aggregateSeconds = asNonNegativeInt(source[dayKey]);
      if (!dailyRecords[dayKey]) {
        dailyRecords[dayKey] = createDailyRecord(dayKey, now);
      }
      dailyRecords[dayKey].totalFocusSeconds = Math.max(dailyRecords[dayKey].totalFocusSeconds, aggregateSeconds);
      if (aggregateSeconds > 0 && dailyRecords[dayKey].sessionsCount === 0) {
        dailyRecords[dayKey].sessionsCount = 1;
      }
    });
  }

  function findLatestDayKey(dailyRecords) {
    const keys = Object.keys(dailyRecords).filter((key) => isDayKey(key));
    if (!keys.length) return null;
    keys.sort();
    return keys[keys.length - 1];
  }

  function normalizeV2State(raw, now = new Date()) {
    const base = emptyState(now);
    const source = raw && typeof raw === 'object' ? raw : {};
    base.createdAt = typeof source.createdAt === 'string' ? source.createdAt : base.createdAt;
    base.updatedAt = typeof source.updatedAt === 'string' ? source.updatedAt : nowIso(now);
    base.migratedAt = typeof source.migratedAt === 'string' ? source.migratedAt : null;
    base.migrationSourceVersion = Number.isInteger(source.migrationSourceVersion) ? source.migrationSourceVersion : null;
    base.dailyRecords = normalizeDailyRecords(source.dailyRecords, now);
    base.sessionHistory = dedupeSessions(source.sessionHistory);
    const hasExplicitDailyRecords = source.dailyRecords && typeof source.dailyRecords === 'object'
      && Object.keys(source.dailyRecords).length > 0;
    if (!hasExplicitDailyRecords && base.sessionHistory.length) {
      addHistoryIntoDailyRecords(base.dailyRecords, base.sessionHistory, now);
    }
    base.runtime = normalizeRuntime(source.runtime);
    base.totalWaterBreaks = asNonNegativeInt(source.totalWaterBreaks);
    base.lastSessionSeconds = asNonNegativeInt(source.lastSessionSeconds);
    base.lastSessionRecordedAt = typeof source.lastSessionRecordedAt === 'string' ? source.lastSessionRecordedAt : null;
    base.resetAt = typeof source.resetAt === 'string' ? source.resetAt : null;
    const latestDayKey = findLatestDayKey(base.dailyRecords);
    base.lastActiveDateKey = isDayKey(source.lastActiveDateKey)
      ? source.lastActiveDateKey
      : (latestDayKey || toLocalDayKey(now));
    ensureDayRecord(base, base.lastActiveDateKey, now);
    return base;
  }

  function migrateToV2(raw, now = new Date()) {
    if (raw && typeof raw === 'object' && raw.schemaVersion === SCHEMA_VERSION) {
      const normalized = normalizeV2State(raw, now);
      const changed = JSON.stringify(normalized) !== JSON.stringify(raw);
      return { state: normalized, changed };
    }
    if (!raw || typeof raw !== 'object') {
      return { state: emptyState(now), changed: true };
    }

    const state = emptyState(now);
    const sourceVersion = Number.isInteger(raw.schemaVersion) ? raw.schemaVersion : 0;
    state.migratedAt = nowIso(now);
    state.migrationSourceVersion = sourceVersion;
    state.sessionHistory = dedupeSessions(raw.sessionHistory);
    state.dailyRecords = {};
    addHistoryIntoDailyRecords(state.dailyRecords, state.sessionHistory, now);
    mergeLegacyActivityByDay(state.dailyRecords, raw.activityByDay, now);
    if (raw.dailyRecords && typeof raw.dailyRecords === 'object') {
      Object.keys(raw.dailyRecords).forEach((dayKey) => {
        if (!isDayKey(dayKey)) return;
        if (!state.dailyRecords[dayKey]) {
          state.dailyRecords[dayKey] = createDailyRecord(dayKey, now);
        }
        const incoming = normalizeDailyRecord(raw.dailyRecords[dayKey], dayKey);
        state.dailyRecords[dayKey].totalFocusSeconds = Math.max(
          state.dailyRecords[dayKey].totalFocusSeconds,
          incoming.totalFocusSeconds
        );
        state.dailyRecords[dayKey].sessionsCount = Math.max(
          state.dailyRecords[dayKey].sessionsCount,
          incoming.sessionsCount
        );
        state.dailyRecords[dayKey].waterBreaksTaken = Math.max(
          state.dailyRecords[dayKey].waterBreaksTaken,
          incoming.waterBreaksTaken
        );
      });
    }
    if (!Object.keys(state.dailyRecords).length) {
      const todayKey = toLocalDayKey(now);
      state.dailyRecords[todayKey] = createDailyRecord(todayKey, now);
    }

    const runtimeSource = {
      currentSessionStartTime: raw.currentSessionStartTime,
      currentSessionInitialTime: raw.currentSessionInitialTime,
      pausedAt: raw.pausedAt,
      accumulatedPauseTime: raw.accumulatedPauseTime
    };
    state.runtime = normalizeRuntime(runtimeSource);
    state.totalWaterBreaks = asNonNegativeInt(raw.totalWaterBreaks ?? raw.waterBreaksTaken);
    state.lastSessionSeconds = asNonNegativeInt(raw.lastSessionSeconds);
    state.lastSessionRecordedAt = typeof raw.lastSessionRecordedAt === 'string' ? raw.lastSessionRecordedAt : null;
    state.resetAt = typeof raw.resetAt === 'string' ? raw.resetAt : null;
    state.lastActiveDateKey = isDayKey(raw.lastActiveDateKey)
      ? raw.lastActiveDateKey
      : (isDayKey(raw.lastStatsDate)
        ? raw.lastStatsDate
        : (isDayKey(raw.lastSessionDate) ? raw.lastSessionDate : null));
    if (!state.lastActiveDateKey) {
      state.lastActiveDateKey = findLatestDayKey(state.dailyRecords) || toLocalDayKey(now);
    }
    ensureDayRecord(state, state.lastActiveDateKey, now);
    state.updatedAt = nowIso(now);
    return { state: normalizeV2State(state, now), changed: true };
  }

  function buildActivityMaps(dailyRecords) {
    const day = {};
    const month = {};
    const year = {};
    Object.keys(dailyRecords).forEach((dayKey) => {
      if (!isDayKey(dayKey)) return;
      const seconds = asNonNegativeInt(dailyRecords[dayKey].totalFocusSeconds);
      day[dayKey] = seconds;
      const monthKey = dayKey.slice(0, 7);
      const yearKey = dayKey.slice(0, 4);
      month[monthKey] = (month[monthKey] || 0) + seconds;
      year[yearKey] = (year[yearKey] || 0) + seconds;
    });
    return { day, month, year };
  }

  function getDailyFromState(state, dayKey) {
    if (!isDayKey(dayKey)) {
      return normalizeDailyRecord({}, '');
    }
    const record = state.dailyRecords[dayKey];
    if (!record) {
      return {
        dateKey: dayKey,
        totalFocusSeconds: 0,
        sessionsCount: 0,
        waterBreaksTaken: 0,
        lastUpdatedAt: null
      };
    }
    return normalizeDailyRecord(record, dayKey);
  }

  function computeCurrentStreak(dailyRecords, now = new Date(), thresholdSeconds = STREAK_THRESHOLD_SECONDS) {
    let streak = 0;
    let cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    while (true) {
      const dayKey = toLocalDayKey(cursor);
      const day = dailyRecords[dayKey];
      const total = day ? asNonNegativeInt(day.totalFocusSeconds) : 0;
      if (total < thresholdSeconds) break;
      streak += 1;
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
    }
    return streak;
  }

  function enumerateDayKeys(startKey, endKey) {
    if (!isDayKey(startKey) || !isDayKey(endKey)) return [];
    const startDate = parseDayKey(startKey);
    const endDate = parseDayKey(endKey);
    if (!startDate || !endDate) return [];
    if (startDate.getTime() > endDate.getTime()) return [];
    const keys = [];
    let cursor = new Date(startDate);
    while (cursor.getTime() <= endDate.getTime()) {
      keys.push(toLocalDayKey(cursor));
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    }
    return keys;
  }

  function buildAggregatesView(state, now = new Date()) {
    const todayKey = toLocalDayKey(now);
    const todayRecord = getDailyFromState(state, todayKey);
    const activity = buildActivityMaps(state.dailyRecords);
    return {
      totalFocusTimeSeconds: todayRecord.totalFocusSeconds,
      sessionsCompleted: todayRecord.sessionsCount,
      waterBreaksTaken: todayRecord.waterBreaksTaken,
      currentStreak: computeCurrentStreak(state.dailyRecords, now),
      currentSessionStartTime: state.runtime.currentSessionStartTime,
      currentSessionInitialTime: state.runtime.currentSessionInitialTime,
      pausedAt: state.runtime.pausedAt,
      accumulatedPauseTime: state.runtime.accumulatedPauseTime,
      lastSessionDate: state.lastActiveDateKey,
      lastStatsDate: state.lastActiveDateKey,
      activityByDay: activity.day,
      activityByMonth: activity.month,
      activityByYear: activity.year
    };
  }

  function createStorage(options = {}) {
    const readRawStats = options.readRawStats || (async () => null);
    const writeRawStats = options.writeRawStats || (async () => false);
    const nowProvider = options.now || (() => new Date());
    let cache = null;
    let writeQueue = Promise.resolve();

    async function loadStateInternal() {
      if (cache) return cache;
      const now = nowProvider();
      const raw = await readRawStats();
      const migrated = migrateToV2(raw, now);
      cache = migrated.state;
      if (migrated.changed) {
        await writeRawStats(cache);
      }
      return cache;
    }

    function queueWrite(mutator) {
      writeQueue = writeQueue.then(async () => {
        const state = await loadStateInternal();
        const changed = await mutator(state);
        if (!changed) return clone(state);
        const now = nowProvider();
        state.updatedAt = nowIso(now);
        cache = normalizeV2State(state, now);
        await writeRawStats(cache);
        return clone(cache);
      });
      return writeQueue;
    }

    async function migrateIfNeeded() {
      const state = await loadStateInternal();
      return clone(state);
    }

    async function rolloverIfNeeded(nowInput) {
      const now = nowInput instanceof Date ? nowInput : (Number.isFinite(nowInput) ? new Date(nowInput) : nowProvider());
      const todayKey = toLocalDayKey(now);
      let didRollover = false;
      await queueWrite((state) => {
        if (state.lastActiveDateKey === todayKey) return false;
        ensureDayRecord(state, todayKey, now);
        state.lastActiveDateKey = todayKey;
        didRollover = true;
        return true;
      });
      return didRollover;
    }

    async function loadAggregates(nowInput) {
      const now = nowInput instanceof Date ? nowInput : nowProvider();
      const state = await loadStateInternal();
      return buildAggregatesView(state, now);
    }

    async function saveRuntimeState(runtimeState) {
      const payload = runtimeState && typeof runtimeState === 'object' ? runtimeState : {};
      const normalized = normalizeRuntime(payload);
      await queueWrite((state) => {
        let changed = false;
        Object.keys(normalized).forEach((key) => {
          if (state.runtime[key] !== normalized[key]) {
            state.runtime[key] = normalized[key];
            changed = true;
          }
        });
        return changed;
      });
      return true;
    }

    // Backward-compatible wrapper used by existing renderer logic.
    async function saveAggregates(aggregates) {
      const payload = aggregates && typeof aggregates === 'object' ? aggregates : {};
      const runtimePayload = {
        currentSessionStartTime: payload.currentSessionStartTime,
        currentSessionInitialTime: payload.currentSessionInitialTime,
        pausedAt: payload.pausedAt,
        accumulatedPauseTime: payload.accumulatedPauseTime
      };
      await saveRuntimeState(runtimePayload);
      return true;
    }

    async function loadSessions() {
      const state = await loadStateInternal();
      return clone(state.sessionHistory);
    }

    async function recordCompletedSession(session) {
      const normalizedSession = normalizeSession(session);
      if (!normalizedSession) return false;
      let inserted = false;
      await queueWrite((state) => {
        const exists = state.sessionHistory.some((item) => item.id === normalizedSession.id);
        if (exists) return false;
        state.sessionHistory.push(normalizedSession);
        state.sessionHistory.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
        const chunkTotalsByDay = splitSessionByDay(normalizedSession);
        chunkTotalsByDay.forEach((chunk) => {
          const dayRecord = ensureDayRecord(state, chunk.dayKey, nowProvider());
          dayRecord.totalFocusSeconds += asNonNegativeInt(chunk.seconds);
          dayRecord.lastUpdatedAt = nowIso(nowProvider());
        });
        const sessionStartDayKey = toLocalDayKey(new Date(normalizedSession.startTime));
        const startDayRecord = ensureDayRecord(state, sessionStartDayKey, nowProvider());
        startDayRecord.sessionsCount += 1;
        startDayRecord.lastUpdatedAt = nowIso(nowProvider());
        state.lastActiveDateKey = toLocalDayKey(new Date(normalizedSession.endTime));
        state.lastSessionSeconds = normalizedSession.durationSeconds;
        state.lastSessionRecordedAt = nowIso(nowProvider());
        inserted = true;
        return true;
      });
      return inserted;
    }

    async function recordWaterBreak(atInput) {
      const at = atInput instanceof Date ? atInput : (Number.isFinite(atInput) ? new Date(atInput) : nowProvider());
      const dayKey = toLocalDayKey(at);
      await queueWrite((state) => {
        const record = ensureDayRecord(state, dayKey, at);
        record.waterBreaksTaken += 1;
        record.lastUpdatedAt = nowIso(nowProvider());
        state.totalWaterBreaks += 1;
        state.lastActiveDateKey = dayKey;
        return true;
      });
      return true;
    }

    async function resetAllStats() {
      const now = nowProvider();
      const resetState = emptyState(now);
      resetState.resetAt = nowIso(now);
      await queueWrite((state) => {
        Object.keys(state).forEach((key) => {
          delete state[key];
        });
        Object.assign(state, resetState);
        return true;
      });
      return true;
    }

    async function getDaily(dayKey) {
      const state = await loadStateInternal();
      return getDailyFromState(state, dayKey);
    }

    async function getRange(startDayKey, endDayKey) {
      const state = await loadStateInternal();
      return enumerateDayKeys(startDayKey, endDayKey).map((dayKey) => getDailyFromState(state, dayKey));
    }

    async function getWeeklyAverage(weekStartKey) {
      const endDayKey = addDays(weekStartKey, 6);
      if (!endDayKey) return 0;
      const range = await getRange(weekStartKey, endDayKey);
      if (!range.length) return 0;
      const total = range.reduce((sum, day) => sum + asNonNegativeInt(day.totalFocusSeconds), 0);
      return Math.round(total / range.length);
    }

    async function getMonthlyTotals(year, month) {
      const numericYear = Number(year);
      const numericMonth = Number(month);
      if (!Number.isInteger(numericYear) || !Number.isInteger(numericMonth) || numericMonth < 1 || numericMonth > 12) {
        return 0;
      }
      const state = await loadStateInternal();
      const monthPrefix = `${String(numericYear).padStart(4, '0')}-${String(numericMonth).padStart(2, '0')}`;
      return Object.keys(state.dailyRecords).reduce((sum, dayKey) => {
        if (!dayKey.startsWith(monthPrefix)) return sum;
        return sum + asNonNegativeInt(state.dailyRecords[dayKey].totalFocusSeconds);
      }, 0);
    }

    async function getYearlyTotals(year) {
      const numericYear = Number(year);
      if (!Number.isInteger(numericYear)) return 0;
      const state = await loadStateInternal();
      const yearPrefix = `${String(numericYear).padStart(4, '0')}-`;
      return Object.keys(state.dailyRecords).reduce((sum, dayKey) => {
        if (!dayKey.startsWith(yearPrefix)) return sum;
        return sum + asNonNegativeInt(state.dailyRecords[dayKey].totalFocusSeconds);
      }, 0);
    }

    return {
      migrateIfNeeded,
      rolloverIfNeeded,
      loadAggregates,
      saveAggregates,
      saveRuntimeState,
      loadSessions,
      recordCompletedSession,
      recordWaterBreak,
      resetAllStats,
      getDaily,
      getRange,
      getWeeklyAverage,
      getMonthlyTotals,
      getYearlyTotals
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

  const defaultStore = createStorage({ readRawStats, writeRawStats });

  const api = {
    migrateIfNeeded: defaultStore.migrateIfNeeded,
    rolloverIfNeeded: defaultStore.rolloverIfNeeded,
    loadAggregates: defaultStore.loadAggregates,
    saveAggregates: defaultStore.saveAggregates,
    saveRuntimeState: defaultStore.saveRuntimeState,
    loadSessions: defaultStore.loadSessions,
    recordCompletedSession: defaultStore.recordCompletedSession,
    recordWaterBreak: defaultStore.recordWaterBreak,
    resetAllStats: defaultStore.resetAllStats,
    getDaily: defaultStore.getDaily,
    getRange: defaultStore.getRange,
    getWeeklyAverage: defaultStore.getWeeklyAverage,
    getMonthlyTotals: defaultStore.getMonthlyTotals,
    getYearlyTotals: defaultStore.getYearlyTotals
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      ...api,
      createStorage,
      __private: {
        SCHEMA_VERSION,
        STREAK_THRESHOLD_SECONDS,
        toLocalDayKey,
        parseDayKey,
        addDays,
        splitSessionByDay,
        migrateToV2,
        normalizeV2State,
        enumerateDayKeys,
        buildActivityMaps,
        computeCurrentStreak,
        normalizeSession
      }
    };
  }

  if (global) {
    global.FocusStorage = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
