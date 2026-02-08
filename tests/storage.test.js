const test = require('node:test');
const assert = require('node:assert/strict');
const { createStorage } = require('../services/storage');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createMemoryAdapter(initialValue = null) {
  let persisted = initialValue ? clone(initialValue) : null;
  let writes = 0;
  return {
    readRawStats: async () => (persisted ? clone(persisted) : null),
    writeRawStats: async (next) => {
      persisted = clone(next);
      writes += 1;
      return true;
    },
    getState: () => (persisted ? clone(persisted) : null),
    getWrites: () => writes
  };
}

function createClock(startIso) {
  let now = new Date(startIso);
  return {
    now: () => new Date(now.getTime()),
    set: (nextIso) => {
      now = new Date(nextIso);
    }
  };
}

function makeSession(id, startIso, endIso, durationSeconds) {
  return {
    id,
    startTime: startIso,
    endTime: endIso,
    durationSeconds
  };
}

test('migration preserves legacy history and date-key totals', async () => {
  const legacyState = {
    schemaVersion: 1,
    sessionHistory: [
      makeSession('legacy-1', '2026-01-26T23:30:00', '2026-01-27T00:30:00', 3600)
    ],
    activityByDay: {
      '2026-01-26': 2400,
      '2026-01-27': 300
    },
    waterBreaksTaken: 5,
    lastStatsDate: '2026-01-27'
  };
  const adapter = createMemoryAdapter(legacyState);
  const clock = createClock('2026-01-27T09:00:00');
  const storage = createStorage({
    readRawStats: adapter.readRawStats,
    writeRawStats: adapter.writeRawStats,
    now: clock.now
  });

  const migrated = await storage.migrateIfNeeded();
  const migratedRaw = adapter.getState();

  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migratedRaw.schemaVersion, 2);
  assert.equal(migratedRaw.dailyRecords['2026-01-26'].totalFocusSeconds, 2400);
  assert.equal(migratedRaw.dailyRecords['2026-01-27'].totalFocusSeconds, 1800);
  assert.equal(migratedRaw.sessionHistory.length, 1);
  assert.equal(migratedRaw.migrationSourceVersion, 1);
});

test('rollover creates a new local-day record and keeps history intact', async () => {
  const adapter = createMemoryAdapter();
  const clock = createClock('2026-02-04T23:58:00');
  const storage = createStorage({
    readRawStats: adapter.readRawStats,
    writeRawStats: adapter.writeRawStats,
    now: clock.now
  });

  await storage.migrateIfNeeded();
  await storage.recordCompletedSession(
    makeSession('s-1', '2026-02-04T21:00:00', '2026-02-04T21:30:00', 1800)
  );

  clock.set('2026-02-05T00:02:00');
  const changed = await storage.rolloverIfNeeded(clock.now());
  const dailyPrev = await storage.getDaily('2026-02-04');
  const dailyNew = await storage.getDaily('2026-02-05');
  const aggregates = await storage.loadAggregates(clock.now());

  assert.equal(changed, true);
  assert.equal(dailyPrev.totalFocusSeconds, 1800);
  assert.equal(dailyNew.totalFocusSeconds, 0);
  assert.equal(aggregates.totalFocusTimeSeconds, 0);
  assert.equal(aggregates.sessionsCompleted, 0);
  assert.equal(aggregates.lastStatsDate, '2026-02-05');
});

test('recordCompletedSession is idempotent across app restarts', async () => {
  const adapter = createMemoryAdapter();
  const clock = createClock('2026-02-05T10:00:00');

  const storageA = createStorage({
    readRawStats: adapter.readRawStats,
    writeRawStats: adapter.writeRawStats,
    now: clock.now
  });

  const session = makeSession('stable-id', '2026-02-05T10:00:00', '2026-02-05T10:25:00', 1500);
  await storageA.recordCompletedSession(session);
  await storageA.recordCompletedSession(session);

  const storageB = createStorage({
    readRawStats: adapter.readRawStats,
    writeRawStats: adapter.writeRawStats,
    now: clock.now
  });

  const sessions = await storageB.loadSessions();
  const day = await storageB.getDaily('2026-02-05');

  assert.equal(sessions.length, 1);
  assert.equal(day.totalFocusSeconds, 1500);
  assert.equal(day.sessionsCount, 1);
});

test('range and weekly/monthly/yearly aggregations are consistent', async () => {
  const adapter = createMemoryAdapter();
  const clock = createClock('2026-02-15T12:00:00');
  const storage = createStorage({
    readRawStats: adapter.readRawStats,
    writeRawStats: adapter.writeRawStats,
    now: clock.now
  });

  await storage.recordCompletedSession(
    makeSession('w-1', '2026-01-26T09:00:00', '2026-01-26T09:30:00', 1800)
  );
  await storage.recordCompletedSession(
    makeSession('w-2', '2026-01-27T09:00:00', '2026-01-27T10:00:00', 3600)
  );
  await storage.recordCompletedSession(
    makeSession('m-1', '2026-02-03T09:00:00', '2026-02-03T09:30:00', 1800)
  );
  await storage.recordCompletedSession(
    makeSession('m-2', '2026-02-15T09:00:00', '2026-02-15T11:00:00', 7200)
  );
  await storage.recordCompletedSession(
    makeSession('y-1', '2025-12-31T09:00:00', '2025-12-31T09:30:00', 1800)
  );

  const range = await storage.getRange('2026-01-26', '2026-01-28');
  const weeklyAverage = await storage.getWeeklyAverage('2026-01-26');
  const januaryTotal = await storage.getMonthlyTotals(2026, 1);
  const yearTotal = await storage.getYearlyTotals(2026);

  assert.deepEqual(
    range.map((day) => day.totalFocusSeconds),
    [1800, 3600, 0]
  );
  assert.equal(weeklyAverage, 771);
  assert.equal(januaryTotal, 5400);
  assert.equal(yearTotal, 14400);
});
