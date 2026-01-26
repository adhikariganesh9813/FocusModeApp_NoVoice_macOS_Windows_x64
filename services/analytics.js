(function (global) {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  function toLocalDayStart(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function toDayKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function toMonthKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  function toYearKey(date) {
    return `${date.getFullYear()}`;
  }

  function parseSessionTimes(session) {
    const startMs = new Date(session.startTime).getTime();
    const endMs = new Date(session.endTime).getTime();
    const durationSeconds = Number.isFinite(session.durationSeconds)
      ? session.durationSeconds
      : Math.max(0, Math.floor((endMs - startMs) / 1000));
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
      const dayStart = toLocalDayStart(cursor);
      const nextDayStart = new Date(dayStart.getTime() + MS_PER_DAY);
      const segmentEnd = nextDayStart < end ? nextDayStart : end;
      const seconds = Math.max(0, Math.floor((segmentEnd - cursor) / 1000));
      chunks.push({ dayKey: toDayKey(cursor), seconds });
      cursor = segmentEnd;
    }
    return chunks;
  }

  function getDateRange(rangeKey, customStart, customEnd, now = new Date()) {
    const todayStart = toLocalDayStart(now);
    let start = todayStart;
    let end = new Date(todayStart.getTime() + MS_PER_DAY - 1);
    if (rangeKey === 'today') {
      start = todayStart;
    } else if (rangeKey === '7d') {
      start = new Date(todayStart.getTime() - 6 * MS_PER_DAY);
    } else if (rangeKey === '14d') {
      start = new Date(todayStart.getTime() - 13 * MS_PER_DAY);
    } else if (rangeKey === '30d') {
      start = new Date(todayStart.getTime() - 29 * MS_PER_DAY);
    } else if (rangeKey === 'month') {
      start = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
      end = new Date(todayStart.getFullYear(), todayStart.getMonth() + 1, 1);
      end = new Date(end.getTime() - 1);
    } else if (rangeKey === 'year') {
      start = new Date(todayStart.getFullYear(), 0, 1);
      end = new Date(todayStart.getFullYear() + 1, 0, 1);
      end = new Date(end.getTime() - 1);
    } else if (rangeKey === 'custom' && customStart && customEnd) {
      const startDate = new Date(customStart);
      const endDate = new Date(customEnd);
      start = toLocalDayStart(startDate);
      end = new Date(toLocalDayStart(endDate).getTime() + MS_PER_DAY - 1);
    }
    return { startMs: start.getTime(), endMs: end.getTime() };
  }

  function enumerateDays(startMs, endMs) {
    const days = [];
    let cursor = toLocalDayStart(new Date(startMs));
    const end = new Date(endMs);
    while (cursor <= end) {
      days.push(new Date(cursor));
      cursor = new Date(cursor.getTime() + MS_PER_DAY);
    }
    return days;
  }

  function filterSessionsByRange(sessions, startMs, endMs) {
    return sessions.filter((session) => {
      const { startMs: s, endMs: e } = parseSessionTimes(session);
      if (!Number.isFinite(s) || !Number.isFinite(e)) return false;
      return s <= endMs && e >= startMs;
    });
  }

  function getDailyTotals(sessions, startMs, endMs) {
    const days = enumerateDays(startMs, endMs);
    const totals = new Map(days.map((day) => [toDayKey(day), 0]));
    const sessionCounts = new Map(days.map((day) => [toDayKey(day), 0]));
    const longest = new Map(days.map((day) => [toDayKey(day), 0]));

    sessions.forEach((session) => {
      const { startMs: s, durationSeconds } = parseSessionTimes(session);
      if (!Number.isFinite(s)) return;
      const sessionDayKey = toDayKey(new Date(s));
      if (sessionCounts.has(sessionDayKey)) {
        sessionCounts.set(sessionDayKey, sessionCounts.get(sessionDayKey) + 1);
        longest.set(sessionDayKey, Math.max(longest.get(sessionDayKey), durationSeconds));
      }
      splitSessionByDay(session).forEach((chunk) => {
        if (totals.has(chunk.dayKey)) {
          totals.set(chunk.dayKey, totals.get(chunk.dayKey) + chunk.seconds);
        }
      });
    });

    return days.map((day) => {
      const key = toDayKey(day);
      const totalSeconds = totals.get(key) || 0;
      const count = sessionCounts.get(key) || 0;
      const avgSeconds = count ? Math.round(totalSeconds / count) : 0;
      return {
        dayKey: key,
        totalSeconds,
        sessionsCount: count,
        avgSeconds,
        longestSeconds: longest.get(key) || 0,
        date: day
      };
    });
  }

  function getRollingAverage(dailyTotals, windowSize) {
    const result = [];
    for (let i = 0; i < dailyTotals.length; i++) {
      const start = Math.max(0, i - windowSize + 1);
      const slice = dailyTotals.slice(start, i + 1);
      const sum = slice.reduce((acc, day) => acc + day.totalSeconds, 0);
      result.push(Math.round(sum / slice.length));
    }
    return result;
  }

  function getMonthlyTotals(sessions, year) {
    const totals = Array.from({ length: 12 }, () => 0);
    sessions.forEach((session) => {
      splitSessionByDay(session).forEach((chunk) => {
        const date = new Date(`${chunk.dayKey}T00:00:00`);
        if (date.getFullYear() === year) {
          totals[date.getMonth()] += chunk.seconds;
        }
      });
    });
    return totals;
  }

  function getStreaks(sessions, thresholdMinutes = 30) {
    const thresholdSeconds = thresholdMinutes * 60;
    const totalsByDay = new Map();
    sessions.forEach((session) => {
      splitSessionByDay(session).forEach((chunk) => {
        totalsByDay.set(chunk.dayKey, (totalsByDay.get(chunk.dayKey) || 0) + chunk.seconds);
      });
    });
    const dayKeys = Array.from(totalsByDay.keys()).sort();
    if (!dayKeys.length) {
      return { current: 0, longest: 0 };
    }

    const startDate = new Date(`${dayKeys[0]}T00:00:00`);
    const endDate = new Date(`${dayKeys[dayKeys.length - 1]}T00:00:00`);
    let longest = 0;
    let current = 0;
    let cursor = new Date(startDate);
    while (cursor <= endDate) {
      const key = toDayKey(cursor);
      const meets = (totalsByDay.get(key) || 0) >= thresholdSeconds;
      if (meets) {
        current += 1;
        longest = Math.max(longest, current);
      } else {
        current = 0;
      }
      cursor = new Date(cursor.getTime() + MS_PER_DAY);
    }

    let currentStreak = 0;
    cursor = toLocalDayStart(new Date());
    while (true) {
      const key = toDayKey(cursor);
      const meets = (totalsByDay.get(key) || 0) >= thresholdSeconds;
      if (!meets) break;
      currentStreak += 1;
      cursor = new Date(cursor.getTime() - MS_PER_DAY);
    }

    return { current: currentStreak, longest };
  }

  function getInsights(dailyTotals) {
    if (!dailyTotals.length) return [];
    const totalsByWeekday = new Map();
    dailyTotals.forEach((day) => {
      const weekday = day.date.toLocaleDateString(undefined, { weekday: 'short' });
      totalsByWeekday.set(weekday, (totalsByWeekday.get(weekday) || 0) + day.totalSeconds);
    });
    const bestWeekday = Array.from(totalsByWeekday.entries()).sort((a, b) => b[1] - a[1])[0];

    const last7 = dailyTotals.slice(-7);
    const prev7 = dailyTotals.slice(-14, -7);
    const sum = (arr) => arr.reduce((acc, day) => acc + day.totalSeconds, 0);
    const last7Total = sum(last7);
    const prev7Total = sum(prev7);
    const trend = prev7Total > 0 ? ((last7Total - prev7Total) / prev7Total) * 100 : 0;

    const bestDay = dailyTotals.reduce((best, day) => {
      return day.totalSeconds > best.totalSeconds ? day : best;
    }, dailyTotals[0]);
    const worstDay = dailyTotals.reduce((worst, day) => {
      return day.totalSeconds < worst.totalSeconds ? day : worst;
    }, dailyTotals[0]);

    const activeDays = dailyTotals.filter((day) => day.totalSeconds > 0).length;
    const avgPerDay = dailyTotals.length ? Math.round((sum(dailyTotals) / dailyTotals.length) / 60) : 0;

    const insights = [];
    if (bestWeekday) {
      insights.push(`Best weekday: ${bestWeekday[0]} (${Math.round(bestWeekday[1] / 60)} min)`);
    }
    insights.push(`Last 7 days vs previous: ${trend >= 0 ? '+' : ''}${Math.round(trend)}%`);
    insights.push(`Most focused day: ${bestDay.dayKey} (${Math.round(bestDay.totalSeconds / 60)} min)`);
    insights.push(`Lowest day: ${worstDay.dayKey} (${Math.round(worstDay.totalSeconds / 60)} min)`);
    insights.push(`Avg per day: ${avgPerDay} min`);
    insights.push(`Active days in range: ${activeDays}/${dailyTotals.length}`);
    return insights.slice(0, 5);
  }

  function toCsv(sessions) {
    const headers = ['id', 'startTime', 'endTime', 'durationSeconds', 'type', 'tag', 'completed', 'createdAt'];
    const rows = sessions.map((session) =>
      headers.map((key) => (session[key] !== undefined ? String(session[key]) : '')).join(',')
    );
    return [headers.join(','), ...rows].join('\n');
  }

  const api = {
    toDayKey,
    toMonthKey,
    toYearKey,
    parseSessionTimes,
    splitSessionByDay,
    getDateRange,
    filterSessionsByRange,
    getDailyTotals,
    getRollingAverage,
    getMonthlyTotals,
    getStreaks,
    getInsights,
    toCsv
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.FocusAnalytics = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
