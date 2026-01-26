const test = require('node:test');
const assert = require('node:assert/strict');
const analytics = require('../services/analytics');

function makeSession(start, end, durationSeconds) {
  return {
    id: `s-${start}`,
    startTime: start,
    endTime: end,
    durationSeconds
  };
}

test('parseSessionTimes uses durationSeconds when provided', () => {
  const session = makeSession('2024-01-01T10:00:00', '2024-01-01T10:30:00', 1200);
  const parsed = analytics.parseSessionTimes(session);
  assert.equal(parsed.durationSeconds, 1200);
});

test('splitSessionByDay splits across midnight', () => {
  const session = makeSession('2024-01-01T23:00:00', '2024-01-02T01:00:00');
  const chunks = analytics.splitSessionByDay(session);
  const total = chunks.reduce((acc, chunk) => acc + chunk.seconds, 0);
  assert.equal(chunks.length, 2);
  assert.equal(total, 7200);
});

test('filterSessionsByRange includes overlapping sessions', () => {
  const sessions = [
    makeSession('2024-01-01T10:00:00', '2024-01-01T10:30:00'),
    makeSession('2024-01-03T10:00:00', '2024-01-03T10:30:00')
  ];
  const range = analytics.getDateRange('7d', null, null, new Date('2024-01-02T12:00:00'));
  const filtered = analytics.filterSessionsByRange(sessions, range.startMs, range.endMs);
  assert.equal(filtered.length, 1);
});

test('getDailyTotals sums totals in range', () => {
  const sessions = [
    makeSession('2024-01-01T10:00:00', '2024-01-01T11:00:00'),
    makeSession('2024-01-02T10:00:00', '2024-01-02T10:30:00')
  ];
  const range = analytics.getDateRange('7d', null, null, new Date('2024-01-02T12:00:00'));
  const totals = analytics.getDailyTotals(sessions, range.startMs, range.endMs);
  const totalSeconds = totals.reduce((acc, day) => acc + day.totalSeconds, 0);
  assert.equal(totalSeconds, 5400);
});

test('getRollingAverage returns progressive averages', () => {
  const daily = [
    { totalSeconds: 600 },
    { totalSeconds: 1200 },
    { totalSeconds: 1800 }
  ];
  const averages = analytics.getRollingAverage(daily, 2);
  assert.deepEqual(averages, [600, 900, 1500]);
});

test('getMonthlyTotals groups totals by month', () => {
  const sessions = [
    makeSession('2024-01-10T10:00:00', '2024-01-10T11:00:00'),
    makeSession('2024-02-10T10:00:00', '2024-02-10T10:30:00')
  ];
  const totals = analytics.getMonthlyTotals(sessions, 2024);
  assert.equal(totals[0], 3600);
  assert.equal(totals[1], 1800);
});

test('getStreaks calculates current and longest streaks', () => {
  const sessions = [
    makeSession('2024-01-01T10:00:00', '2024-01-01T10:40:00', 2400),
    makeSession('2024-01-02T10:00:00', '2024-01-02T10:40:00', 2400),
    makeSession('2024-01-04T10:00:00', '2024-01-04T10:40:00', 2400)
  ];
  const streaks = analytics.getStreaks(sessions, 30);
  assert.equal(streaks.longest >= 2, true);
});

test('getDateRange month starts on first day', () => {
  const range = analytics.getDateRange('month', null, null, new Date('2024-03-15T12:00:00'));
  const start = new Date(range.startMs);
  assert.equal(start.getDate(), 1);
});

test('getInsights returns up to five items', () => {
  const sessions = [
    makeSession('2024-01-01T10:00:00', '2024-01-01T10:30:00', 1800),
    makeSession('2024-01-02T10:00:00', '2024-01-02T10:30:00', 1800)
  ];
  const range = analytics.getDateRange('7d', null, null, new Date('2024-01-02T12:00:00'));
  const daily = analytics.getDailyTotals(sessions, range.startMs, range.endMs);
  const insights = analytics.getInsights(daily);
  assert.ok(insights.length >= 1 && insights.length <= 5);
});

test('toCsv includes headers and rows', () => {
  const csv = analytics.toCsv([makeSession('2024-01-01T10:00:00', '2024-01-01T10:30:00', 1800)]);
  assert.ok(csv.startsWith('id,startTime,endTime'));
  assert.ok(csv.split('\n').length >= 2);
});
