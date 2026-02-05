// Setting up initial variables for the timer
let timeLeft = 0;          // Tracks remaining time in seconds
let timerId = null;        // For storing the timer interval ID
let deadline = null;       // Absolute timestamp (ms) when the timer should hit zero
let waterTimeoutId = null; // setTimeout id for precise water break scheduling
let nextBreakAtMs = null;  // next scheduled water break time (ms)
let waterBreakRemainingMs = null; // remaining time until next water break while running
let waterBreakActive = false; // true while water break modal is active
let timerEndVoiceActive = false;
let timerEndVoiceTimeoutId = null;
let sessionRuntimeSeconds = 0;
let lastSessionSeconds = 0;
let suppressAutoStartUntil = 0;

// Session stats tracking
let sessionStats = {
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

// Stats update interval
let statsUpdateInterval = null;

function initializeFocusMode() {
    // Getting all the elements I need to control
    const timeDisplay = document.querySelector('.time');          // Shows the countdown
    const statusDisplay = document.querySelector('.status');      // Shows current timer status
    const startButton = document.getElementById('start');         // Start button
    const pauseButton = document.getElementById('pause');         // Pause button
    const resetButton = document.getElementById('reset');         // Reset button
    const focusHoursInput = document.getElementById('focusHours');      // Hours input
    const focusMinutesInput = document.getElementById('focusMinutes');  // Minutes input
    const waterBreakToggle = document.getElementById('waterBreak');
    const waterBreakHoursInput = document.getElementById('waterBreakHours');
    const waterBreakMinutesInput = document.getElementById('waterBreakMinutes');
    const waterBreakIntervalSetting = document.getElementById('waterBreakIntervalSetting');
    const waterBreakModal = document.getElementById('waterBreakModal');
    const drankButton = document.getElementById('drank');
    const timerEndSound = document.getElementById('timerEndSound');
    const waterBreakSound = document.getElementById('waterBreakSound');
    const timerEndModal = document.getElementById('timerEndModal');
    const closeTimerButton = document.getElementById('closeTimer');

    // Stats elements
    const totalFocusTimeEl = document.getElementById('totalFocusTime');
    const sessionsCompletedEl = document.getElementById('sessionsCompleted');
    const waterBreaksTakenEl = document.getElementById('waterBreaksTaken');
    const currentStreakEl = document.getElementById('currentStreak');
    const progressPercentEl = document.getElementById('progressPercent');
    const currentSessionTimeEl = document.getElementById('currentSessionTime');
    const sessionStatusEl = document.getElementById('sessionStatus');
    const motivationMessageEl = document.getElementById('motivationMessage');
    const progressRingCircle = document.querySelector('.progress-ring-circle');
    const resetStatsButton = document.getElementById('resetStats');
    const focusTotalsChart = document.getElementById('focusTotalsChart');
    const focusInsights = document.getElementById('focusInsights');
    const insightsToggleButtons = focusInsights ? focusInsights.querySelectorAll('.toggle-btn') : [];
    const focusTotalsRange = document.getElementById('focusTotalsRange');
    const dailyRangeControls = document.getElementById('dailyRangeControls');
    const dailyRangeButtons = dailyRangeControls ? dailyRangeControls.querySelectorAll('.nav-btn') : [];
    const weeklyAverageEl = document.getElementById('weeklyAverage');

    let currentChartView = 'daily';
    let sessionHistory = [];
    let dailyWeekOffset = 0;

    async function loadStats() {
        // Load session history first so we can sync today's stats
        if (window.FocusStorage && window.FocusStorage.loadSessions) {
            sessionHistory = await window.FocusStorage.loadSessions();
        }
        if (window.FocusStorage && window.FocusStorage.loadAggregates) {
            const aggregates = await window.FocusStorage.loadAggregates();
            sessionStats = { ...sessionStats, ...aggregates };
        }
        ensureDailyStats();
        updateStatsDisplay();
    }

    function saveStats() {
        if (window.FocusStorage && window.FocusStorage.saveAggregates) {
            window.FocusStorage.saveAggregates(sessionStats);
        }
    }

    // Format seconds to readable time
    function formatTimeStats(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = Math.max(0, Math.floor(seconds % 60));
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        if (minutes > 0) {
            return `${minutes}m`;
        }
        return `${remainingSeconds}s`;
    }

    // Update stats display
    function updateStatsDisplay() {
        totalFocusTimeEl.textContent = formatTimeStats(sessionStats.totalFocusTimeSeconds);
        sessionsCompletedEl.textContent = sessionStats.sessionsCompleted;
        waterBreaksTakenEl.textContent = sessionStats.waterBreaksTaken;
        currentStreakEl.textContent = sessionStats.currentStreak;
        currentSessionTimeEl.textContent = formatTimeStats(lastSessionSeconds);
        updateMotivationMessage();
    }

    function updateSessionStatusText() {
        if (waterBreakActive) {
            sessionStatusEl.textContent = 'Water Break';
        } else {
            sessionStatusEl.textContent = timerId ? 'Active' : 'Paused';
        }
    }

    function formatDurationShort(seconds) {
        const totalSeconds = Math.max(0, Math.round(seconds || 0));
        const minutes = Math.round(totalSeconds / 60);
        if (minutes <= 0) return '0m';
        if (minutes < 60) return `${minutes}m`;
        const hours = totalSeconds / 3600;
        const display = hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10;
        return `${display}h`;
    }

    function formatDurationCompact(seconds) {
        const totalSeconds = Math.max(0, Math.round(seconds || 0));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    }

    function getMondayStart(date) {
        const day = date.getDay();
        const diffToMonday = (day + 6) % 7;
        return new Date(date.getFullYear(), date.getMonth(), date.getDate() - diffToMonday);
    }

    function buildDailyChartData(sessions) {
        const MS_PER_DAY = 24 * 60 * 60 * 1000;
        const now = new Date();
        const weekStart = getMondayStart(new Date(now.getTime() + (dailyWeekOffset * 7 * MS_PER_DAY)));
        const startMs = weekStart.getTime();
        const endMs = startMs + (6 * MS_PER_DAY);
        const fallbackMap = sessionStats.activityByDay || {};
        if (window.FocusAnalytics && window.FocusAnalytics.getDailyTotals) {
            const dailyTotals = window.FocusAnalytics.getDailyTotals(sessions, startMs, endMs);
            return dailyTotals.map((day) => ({
                label: day.date.toLocaleDateString(undefined, { weekday: 'short' }),
                seconds: day.totalSeconds || 0,
                dayKey: day.dayKey,
                date: day.date
            }));
        }
        const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        return labels.map((label, index) => {
            const day = new Date(startMs + (index * MS_PER_DAY));
            const key = window.FocusAnalytics ? window.FocusAnalytics.toDayKey(day) : '';
            return { label, seconds: fallbackMap[key] || 0, dayKey: key, date: day };
        });
    }

    function buildMonthlyChartData(sessions) {
        const year = new Date().getFullYear();
        const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const fallbackMap = sessionStats.activityByMonth || {};
        if (window.FocusAnalytics && window.FocusAnalytics.getMonthlyTotals) {
            const totals = window.FocusAnalytics.getMonthlyTotals(sessions, year);
            return labels.map((label, index) => ({
                label,
                seconds: totals[index] || 0,
                monthKey: `${year}-${String(index + 1).padStart(2, '0')}`
            }));
        }
        return labels.map((label, index) => {
            const key = `${year}-${String(index + 1).padStart(2, '0')}`;
            return { label, seconds: fallbackMap[key] || 0, monthKey: key };
        });
    }

    function buildYearlyChartData(sessions) {
        const currentYear = new Date().getFullYear();
        const startYear = currentYear;
        const endYear = currentYear + 9;
        const totals = new Map();
        for (let year = startYear; year <= endYear; year++) {
            totals.set(year, 0);
        }

        if (window.FocusAnalytics && window.FocusAnalytics.splitSessionByDay) {
            sessions.forEach((session) => {
                const chunks = window.FocusAnalytics.splitSessionByDay(session);
                chunks.forEach((chunk) => {
                    const year = Number(chunk.dayKey.slice(0, 4));
                    if (totals.has(year)) {
                        totals.set(year, totals.get(year) + chunk.seconds);
                    }
                });
            });
        } else {
            sessions.forEach((session) => {
                const year = new Date(session.startTime).getFullYear();
                if (totals.has(year)) {
                    totals.set(year, totals.get(year) + (session.durationSeconds || 0));
                }
            });
        }

        const fallbackMap = sessionStats.activityByYear || {};
        const data = [];
        for (let year = startYear; year <= endYear; year++) {
            data.push({ label: String(year), seconds: totals.get(year) || 0, yearKey: String(year) });
        }
        return data;
    }

    function renderFocusTotalsChart() {
        if (!focusTotalsChart) return;
        const sessionsForChart = sessionHistory.slice();
        let data = [];
        if (currentChartView === 'monthly') {
            data = buildMonthlyChartData(sessionsForChart);
        } else if (currentChartView === 'yearly') {
            data = buildYearlyChartData(sessionsForChart);
        } else {
            data = buildDailyChartData(sessionsForChart);
        }

        if (currentChartView === 'monthly') {
            data = data.map((item) => {
                const aggregate = sessionStats.activityByMonth?.[item.monthKey] || 0;
                return { ...item, seconds: Math.max(item.seconds || 0, aggregate) };
            });
        } else if (currentChartView === 'yearly') {
            data = data.map((item) => {
                const aggregate = sessionStats.activityByYear?.[item.yearKey] || 0;
                return { ...item, seconds: Math.max(item.seconds || 0, aggregate) };
            });
        } else {
            data = data.map((item) => {
                const aggregate = sessionStats.activityByDay?.[item.dayKey] || 0;
                return { ...item, seconds: Math.max(item.seconds || 0, aggregate) };
            });
        }

        const maxSeconds = data.reduce((max, item) => Math.max(max, item.seconds), 0);
        focusTotalsChart.style.gridTemplateColumns = `repeat(${data.length}, 1fr)`;
        focusTotalsChart.innerHTML = '';

        if (!data.length) {
            const empty = document.createElement('div');
            empty.textContent = 'No focus sessions yet.';
            empty.style.gridColumn = '1 / -1';
            empty.style.textAlign = 'center';
            empty.style.color = '#7f8c8d';
            focusTotalsChart.appendChild(empty);
            return;
        }

        data.forEach((item) => {
            const bar = document.createElement('div');
            bar.className = 'insight-bar';

            const value = document.createElement('div');
            value.className = 'insight-bar-value';
            value.textContent = formatDurationShort(item.seconds);

            const fill = document.createElement('div');
            fill.className = 'insight-bar-fill';
            const heightPercent = maxSeconds > 0 ? Math.round((item.seconds / maxSeconds) * 100) : 0;
            fill.style.height = `${heightPercent}%`;

            const label = document.createElement('div');
            label.className = 'insight-bar-label';
            if (currentChartView === 'daily' && item.date instanceof Date) {
                label.textContent = item.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
            } else {
                label.textContent = item.label;
            }

            bar.appendChild(value);
            bar.appendChild(fill);
            bar.appendChild(label);
            focusTotalsChart.appendChild(bar);
        });

        updateRangeHeader(data);
        updateWeeklyAverage(data);
    }

    function updateWeeklyAverage(data) {
        if (!weeklyAverageEl) return;
        if (currentChartView !== 'daily') {
            weeklyAverageEl.style.display = 'none';
            return;
        }
        weeklyAverageEl.style.display = 'inline-flex';
        const totalSeconds = data.reduce((sum, item) => sum + (item.seconds || 0), 0);
        const avgSeconds = data.length ? Math.round(totalSeconds / data.length) : 0;
        weeklyAverageEl.textContent = `Weekly Avg: ${formatDurationCompact(avgSeconds)}`;
    }

    function updateRangeHeader(data) {
        if (!focusTotalsRange) return;
        if (currentChartView === 'daily' && data.length && data[0].date instanceof Date) {
            const start = data[0].date;
            const end = data[data.length - 1].date;
            const startText = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            const endText = end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            const yearText = end.toLocaleDateString(undefined, { year: 'numeric' });
            focusTotalsRange.textContent = `${startText} - ${endText}, ${yearText}`;
        } else if (currentChartView === 'monthly') {
            focusTotalsRange.textContent = new Date().toLocaleDateString(undefined, { year: 'numeric' });
        } else if (currentChartView === 'yearly') {
            const year = new Date().getFullYear();
            focusTotalsRange.textContent = `${year} - ${year + 9}`;
        } else {
            focusTotalsRange.textContent = 'Week';
        }

        if (dailyRangeControls) {
            dailyRangeControls.style.display = currentChartView === 'daily' ? 'inline-flex' : 'none';
        }
    }

    async function loadSessionHistory() {
        if (window.FocusStorage && window.FocusStorage.loadSessions) {
            sessionHistory = await window.FocusStorage.loadSessions();
        }
        rebuildAggregatesFromHistory();
        syncTodayStatsFromHistory();
        saveStats();
        updateStatsDisplay();
    }

    async function refreshStatsDashboard(options = {}) {
        if (!focusTotalsChart) return;
        if (!sessionHistory.length || options.forceReload) {
            await loadSessionHistory();
        }
        renderFocusTotalsChart();
    }

    // Update progress ring
    function updateProgressRing() {
        if (!sessionStats.currentSessionStartTime || sessionStats.currentSessionInitialTime === 0) {
            progressPercentEl.textContent = '0%';
            progressRingCircle.style.strokeDashoffset = 326.73;
            currentSessionTimeEl.textContent = formatTimeStats(lastSessionSeconds);
            return;
        }

        const elapsed = sessionStats.currentSessionInitialTime - timeLeft;
        const progress = (elapsed / sessionStats.currentSessionInitialTime) * 100;
        const progressClamped = Math.max(0, Math.min(100, progress));
        
        progressPercentEl.textContent = `${Math.round(progressClamped)}%`;
        
        const circumference = 326.73;
        const offset = circumference - (progressClamped / 100) * circumference;
        progressRingCircle.style.strokeDashoffset = offset;

        // Show the duration of the last completed session
        currentSessionTimeEl.textContent = formatTimeStats(lastSessionSeconds);
        
        // Keep total focus time static; it updates only when a session completes.
    }

    // Update motivation message based on stats
    function updateMotivationMessage() {
        const messages = [
            { condition: () => sessionStats.sessionsCompleted === 0, text: "Start your first focus session to build momentum!", icon: "fa-rocket" },
            { condition: () => sessionStats.sessionsCompleted >= 5, text: "Amazing! You're on fire! Keep the momentum going!", icon: "fa-fire" },
            { condition: () => sessionStats.sessionsCompleted >= 3, text: "Great job! You're building strong focus habits!", icon: "fa-star" },
            { condition: () => sessionStats.currentStreak >= 3, text: `${sessionStats.currentStreak} session streak! You're unstoppable!`, icon: "fa-bolt" },
            { condition: () => sessionStats.totalFocusTimeSeconds >= 7200, text: "Over 2 hours of focused work! Incredible dedication!", icon: "fa-trophy" },
            { condition: () => sessionStats.totalFocusTimeSeconds >= 3600, text: "You've focused for over an hour! Keep it up!", icon: "fa-award" },
            { condition: () => sessionStats.waterBreaksTaken >= 3, text: "Great hydration! Your brain is thanking you!", icon: "fa-tint" },
            { condition: () => sessionStats.sessionsCompleted >= 1, text: "Nice work! Each session brings you closer to your goals!", icon: "fa-check-circle" }
        ];

        const message = messages.find(m => m.condition()) || messages[0];
        motivationMessageEl.innerHTML = `<i class="fas ${message.icon}"></i><span>${message.text}</span>`;
    }

    // Start live stats tracking
    function startStatsTracking() {
        if (statsUpdateInterval) clearInterval(statsUpdateInterval);
        
        if (!sessionStats.currentSessionStartTime) {
            sessionStats.currentSessionStartTime = Date.now();
            sessionStats.currentSessionInitialTime = timeLeft;
            sessionStats.accumulatedPauseTime = 0;
        }
        sessionStats.pausedAt = null;
        saveStats();

        statsUpdateInterval = setInterval(() => {
            // Check if day has changed and update stats accordingly
            ensureDailyStats({ persist: true, preserveSession: true });
            updateProgressRing();
            updateSessionStatusText();
            updateStatsDisplay();
        }, 1000);
    }

    // Stop stats tracking
    function stopStatsTracking() {
        if (statsUpdateInterval) {
            clearInterval(statsUpdateInterval);
            statsUpdateInterval = null;
        }
    }

    function getDateKeys(timestampMs) {
        const date = new Date(timestampMs);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return {
            day: `${year}-${month}-${day}`,
            month: `${year}-${month}`,
            year: `${year}`
        };
    }

    function getLocalDayKey(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function resetDailyStats(options = {}) {
        const { preserveSession = false } = options;
        sessionStats.totalFocusTimeSeconds = 0;
        sessionStats.sessionsCompleted = 0;
        sessionStats.waterBreaksTaken = 0;
        sessionStats.currentStreak = 0;
        if (!preserveSession) {
            sessionStats.currentSessionStartTime = null;
            sessionStats.currentSessionInitialTime = 0;
            sessionStats.pausedAt = null;
            sessionStats.accumulatedPauseTime = 0;
        }
        lastSessionSeconds = 0;
    }

    function ensureDailyStats(options = {}) {
        const { persist = true, preserveSession = false } = options;
        const todayKey = getLocalDayKey();
        const lastStatsDate = sessionStats.lastStatsDate || sessionStats.lastSessionDate;
        if (lastStatsDate !== todayKey) {
            resetDailyStats({ preserveSession });
            sessionStats.lastStatsDate = todayKey;
            sessionStats.lastSessionDate = todayKey;
            // Restore today's stats from session history after day change
            syncTodayStatsFromHistory();
            if (persist) {
                saveStats();
            }
            return true;
        }
        if (!sessionStats.lastStatsDate) {
            sessionStats.lastStatsDate = todayKey;
            sessionStats.lastSessionDate = todayKey;
            if (persist) {
                saveStats();
            }
        }
        return false;
    }

    function syncTodayStatsFromHistory() {
        if (!window.FocusAnalytics || !window.FocusAnalytics.getDailyTotals) return;
        if (!Array.isArray(sessionHistory)) return;
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const end = new Date(start.getTime() + (24 * 60 * 60 * 1000) - 1);
        const dailyTotals = window.FocusAnalytics.getDailyTotals(sessionHistory, start.getTime(), end.getTime());
        const todayKey = getLocalDayKey(now);
        const today = dailyTotals.find((day) => day.dayKey === todayKey);
        if (!today) return;
        sessionStats.totalFocusTimeSeconds = today.totalSeconds || 0;
        sessionStats.sessionsCompleted = today.sessionsCount || 0;
        // Also update current streak from session history
        if (window.FocusAnalytics.getStreaks) {
            const streaks = window.FocusAnalytics.getStreaks(sessionHistory);
            sessionStats.currentStreak = streaks.current || 0;
        }
    }

    function rebuildAggregatesFromHistory() {
        if (!window.FocusAnalytics || !window.FocusAnalytics.splitSessionByDay) return;
        if (!Array.isArray(sessionHistory)) return;
        if (sessionHistory.length === 0) return;
        const existingDayTotals = sessionStats.activityByDay || {};
        const existingMonthTotals = sessionStats.activityByMonth || {};
        const existingYearTotals = sessionStats.activityByYear || {};
        const dayTotals = {};
        const monthTotals = {};
        const yearTotals = {};
        const sessionCountsByDay = {};
        sessionHistory.forEach((session) => {
            window.FocusAnalytics.splitSessionByDay(session).forEach((chunk) => {
                dayTotals[chunk.dayKey] = (dayTotals[chunk.dayKey] || 0) + chunk.seconds;
                const monthKey = chunk.dayKey.slice(0, 7);
                const yearKey = chunk.dayKey.slice(0, 4);
                monthTotals[monthKey] = (monthTotals[monthKey] || 0) + chunk.seconds;
                yearTotals[yearKey] = (yearTotals[yearKey] || 0) + chunk.seconds;
            });
            const startKey = window.FocusAnalytics.toDayKey
                ? window.FocusAnalytics.toDayKey(new Date(session.startTime))
                : getLocalDayKey(new Date(session.startTime));
            sessionCountsByDay[startKey] = (sessionCountsByDay[startKey] || 0) + 1;
        });
        const mergedDayTotals = { ...existingDayTotals };
        Object.entries(dayTotals).forEach(([key, value]) => {
            mergedDayTotals[key] = Math.max(existingDayTotals[key] || 0, value || 0);
        });
        const mergedMonthTotals = { ...existingMonthTotals };
        Object.entries(monthTotals).forEach(([key, value]) => {
            mergedMonthTotals[key] = Math.max(existingMonthTotals[key] || 0, value || 0);
        });
        const mergedYearTotals = { ...existingYearTotals };
        Object.entries(yearTotals).forEach(([key, value]) => {
            mergedYearTotals[key] = Math.max(existingYearTotals[key] || 0, value || 0);
        });
        sessionStats.activityByDay = mergedDayTotals;
        sessionStats.activityByMonth = mergedMonthTotals;
        sessionStats.activityByYear = mergedYearTotals;

        const todayKey = getLocalDayKey();
        if (dayTotals[todayKey] !== undefined) {
            sessionStats.totalFocusTimeSeconds = dayTotals[todayKey] || 0;
        }
        if (sessionCountsByDay[todayKey] !== undefined) {
            sessionStats.sessionsCompleted = sessionCountsByDay[todayKey] || 0;
        }

        if (window.FocusAnalytics.getStreaks) {
            const streaks = window.FocusAnalytics.getStreaks(sessionHistory);
            sessionStats.currentStreak = streaks.current || 0;
        }
    }

    function initStatsDashboard() {
        if (!window.FocusStorage) return;
        window.FocusStorage.migrateIfNeeded();
    }

    // Complete a session
    async function completeSession() {
        ensureDailyStats({ persist: false, preserveSession: true });
        if (sessionStats.currentSessionStartTime) {
            const totalElapsed = Date.now() - sessionStats.currentSessionStartTime;
            const activeTime = totalElapsed - (sessionStats.accumulatedPauseTime || 0);
            const sessionDuration = Math.max(0, Math.round(activeTime / 1000));
            const sessionStartIso = new Date(sessionStats.currentSessionStartTime).toISOString();
            const sessionEndIso = new Date().toISOString();
            const sessionRecord = {
                id: (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : `session-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                startTime: sessionStartIso,
                endTime: sessionEndIso,
                durationSeconds: sessionDuration,
                type: 'focus',
                completed: true,
                createdAt: sessionEndIso
            };
            const keys = getDateKeys(Date.now());
            sessionStats.activityByDay[keys.day] = (sessionStats.activityByDay[keys.day] || 0) + sessionDuration;
            sessionStats.activityByMonth[keys.month] = (sessionStats.activityByMonth[keys.month] || 0) + sessionDuration;
            sessionStats.activityByYear[keys.year] = (sessionStats.activityByYear[keys.year] || 0) + sessionDuration;
            sessionStats.totalFocusTimeSeconds += sessionDuration;
            sessionStats.sessionsCompleted++;
            sessionStats.currentStreak++;
            sessionRuntimeSeconds += sessionDuration;
            lastSessionSeconds = sessionDuration;
            sessionStats.currentSessionStartTime = null;
            sessionStats.currentSessionInitialTime = 0;
            sessionStats.pausedAt = null;
            sessionStats.accumulatedPauseTime = 0;
            saveStats();
            if (window.FocusStorage && window.FocusStorage.recordCompletedSession) {
                await window.FocusStorage.recordCompletedSession(sessionRecord);
            }
            if (Array.isArray(sessionHistory)) {
                sessionHistory.push(sessionRecord);
            }
            saveStats();
            updateStatsDisplay();
            updateProgressRing();
            refreshStatsDashboard();
        }
    }

    // Reset all stats
    async function resetAllStats() {
        if (confirm('Are you sure you want to reset all stats? This will clear your current session data.')) {
            sessionRuntimeSeconds = 0;
            lastSessionSeconds = 0;
            sessionStats = {
                totalFocusTimeSeconds: 0,
                sessionsCompleted: 0,
                waterBreaksTaken: 0,
                currentStreak: 0,
                currentSessionStartTime: null,
                currentSessionInitialTime: 0,
                lastSessionDate: null,
                lastStatsDate: getLocalDayKey(),
                pausedAt: null,
                accumulatedPauseTime: 0,
                activityByDay: {},
                activityByMonth: {},
                activityByYear: {}
            };
            if (window.FocusStorage && window.FocusStorage.resetAllStats) {
                await window.FocusStorage.resetAllStats();
            }
            saveStats();
            updateStatsDisplay();
            updateProgressRing();
            sessionStatusEl.textContent = 'Not Started';
            if (typeof refreshStatsDashboard === 'function') {
                refreshStatsDashboard({ forceReload: true });
            }
        }
    }

    // Helper function to convert hours, minutes, and seconds into total seconds
    // This helps me work with a single unit (seconds) for the timer
    function calculateTotalSeconds() {
        const hours = parseInt(focusHoursInput.value) || 0;
        const minutes = parseInt(focusMinutesInput.value) || 0;
        return (hours * 3600) + (minutes * 60);  // Converting everything to seconds
    }

    // Similar to above, but for water break intervals
    // Need this separate function because it uses different input fields
    function calculateWaterBreakInterval() {
        const hours = parseInt(waterBreakHoursInput.value) || 0;
        const minutes = parseInt(waterBreakMinutesInput.value) || 0;
        return (hours * 3600) + (minutes * 60);  // Same conversion logic
    }

    function getWaterBreakIntervalMs() {
        return calculateWaterBreakInterval() * 1000;
    }

    // Converts seconds back into HH:MM:SS format for display
    // Added padStart to always show two digits (e.g., 01:05:08)
    function formatTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = seconds % 60;
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    // Updates the timer display with current time left
    function updateDisplay() {
        timeDisplay.textContent = formatTime(timeLeft);
    }

    // Shows the water break reminder and plays the notification sound
    function showWaterBreakModal() {
        waterBreakModal.style.display = 'flex';
        if (waterBreakSound) {
            waterBreakSound.currentTime = 0;  // Reset sound to start
            waterBreakSound.play().catch(e => console.log('Error playing sound:', e));
        }
    }

    // Disable/enable inputs while running
    function setInputsEnabled(enabled) {
        [focusHoursInput, focusMinutesInput,
         waterBreakHoursInput, waterBreakMinutesInput,
         waterBreakToggle].forEach(el => { if (el) el.disabled = !enabled; });
    }

    function scheduleWaterBreak() {
        if (!waterBreakToggle.checked) {
            clearTimeout(waterTimeoutId);
            waterTimeoutId = null;
            nextBreakAtMs = null;
            return;
        }
        const intervalMs = getWaterBreakIntervalMs();
        if (intervalMs <= 0) {
            clearTimeout(waterTimeoutId);
            waterTimeoutId = null;
            nextBreakAtMs = null;
            return;
        }
        if (waterBreakRemainingMs === null || waterBreakRemainingMs <= 0) {
            waterBreakRemainingMs = intervalMs;
        }
        clearTimeout(waterTimeoutId);
        nextBreakAtMs = Date.now() + waterBreakRemainingMs;
        const delay = Math.max(0, waterBreakRemainingMs);
        waterTimeoutId = setTimeout(() => {
            waterBreakRemainingMs = 0;
            triggerWaterBreak();
        }, delay);
    }

    function pauseWaterBreakCountdown() {
        if (!waterTimeoutId || nextBreakAtMs === null) return;
        waterBreakRemainingMs = Math.max(0, nextBreakAtMs - Date.now());
        clearTimeout(waterTimeoutId);
        waterTimeoutId = null;
        nextBreakAtMs = null;
    }

    function triggerWaterBreak() {
        waterBreakActive = true;
        pauseTimer({ forWaterBreak: true });
        showWaterBreakModal();
    }

    // Main timer function - handles starting/resuming the countdown (deadline-based)
    function startTimer() {
        if (waterBreakActive) return;
        if (timerId) return;  // Prevent multiple timers
        if (suppressAutoStartUntil && Date.now() < suppressAutoStartUntil) return;
        ensureDailyStats();
        const isNewSession = !sessionStats.currentSessionStartTime;
        stopTimerEndAlarm();

        // Initialize time if needed
        if (timeLeft <= 0) {
            timeLeft = calculateTotalSeconds();
        }
        if (timeLeft <= 0) {
            statusDisplay.textContent = 'Set a duration first';
            speakStatus('Please set a duration first.');
            return; // nothing to do
        }

        // Compute or recompute deadline
        if (!deadline) {
            deadline = Date.now() + (timeLeft * 1000);
            // Start stats tracking for new session or resume
            if (!sessionStats.currentSessionStartTime) {
                startStatsTracking();
            } else if (sessionStats.pausedAt) {
                // Resuming from pause - accumulate pause time
                const pauseDuration = Date.now() - sessionStats.pausedAt;
                sessionStats.accumulatedPauseTime = (sessionStats.accumulatedPauseTime || 0) + pauseDuration;
                sessionStats.pausedAt = null;
                saveStats();
                // Restart the interval if it was stopped
                if (!statsUpdateInterval) {
                    statsUpdateInterval = setInterval(() => {
                        // Check if day has changed and update stats accordingly
                        ensureDailyStats({ persist: true, preserveSession: true });
                        updateProgressRing();
                        updateSessionStatusText();
                        updateStatsDisplay();
                    }, 1000);
                }
            }
        }

        // Update UI state
        startButton.disabled = true;
        pauseButton.disabled = false;
        statusDisplay.textContent = 'Focus time!';
        speakStatus(`Timer started for ${formatDurationForSpeech(timeLeft)}.`);
        sessionStatusEl.textContent = 'Active';
        setInputsEnabled(false);
        if (isNewSession) {
            waterBreakRemainingMs = null;
        }
        // schedule or reschedule precise water break
        scheduleWaterBreak();

        // Use a shorter tick to improve accuracy, but only update display when whole second changes
        timerId = setInterval(() => {
            const now = Date.now();
            const remainingMs = Math.max(0, deadline - now);
            // Use Math.round instead of Math.ceil for more accurate display
            // Round to nearest second instead of rounding up
            const nextTimeLeft = Math.max(0, Math.round(remainingMs / 1000));

            if (nextTimeLeft !== timeLeft) {
                timeLeft = nextTimeLeft;
                updateDisplay();
            }

            // Water break handled via precise setTimeout; no interval check needed

            // Check if time is truly up (less than 500ms remaining to account for rounding)
            if (remainingMs < 500) {
                clearInterval(timerId);
                timerId = null;
                deadline = null;
                timeLeft = 0;
                updateDisplay();
                statusDisplay.textContent = 'Time\'s up!';
                startButton.disabled = false;
                pauseButton.disabled = true;
                setInputsEnabled(true);
                
                // Complete session and update stats
                completeSession();
                stopStatsTracking();
                sessionStatusEl.textContent = 'Completed';
                
                startTimerEndAlarm();
                timerEndModal.style.display = 'flex';
                suppressAutoStartUntil = Date.now() + 400;
                waterBreakRemainingMs = null;
                waterBreakActive = false;
                clearTimeout(waterTimeoutId); waterTimeoutId = null; nextBreakAtMs = null;
            }
        }, 250);
    }


    // Pause timer
    function pauseTimer(options = {}) {
        const { forWaterBreak = false } = options;
        if (!timerId) return;
        clearInterval(timerId);
        timerId = null;
        // Recompute remaining time precisely based on deadline
        // Use Math.round instead of Math.ceil for consistency
        if (deadline) {
            const remainingMs = Math.max(0, deadline - Date.now());
            timeLeft = Math.max(0, Math.round(remainingMs / 1000));
        }
        deadline = null;
        updateDisplay();
        if (forWaterBreak) {
            startButton.disabled = true;
            pauseButton.disabled = true;
            statusDisplay.textContent = 'Water break';
            sessionStatusEl.textContent = 'Water Break';
            setInputsEnabled(false);
        } else {
            startButton.disabled = false;
            pauseButton.disabled = true;
            statusDisplay.textContent = 'Paused';
        speakStatus('Timer paused.');
            sessionStatusEl.textContent = 'Paused';
            setInputsEnabled(true);
        }
        
        // Track pause time
        if (sessionStats.currentSessionStartTime) {
            sessionStats.pausedAt = Date.now();
            saveStats();
        }
        
        // Pausing cancels scheduled water break; it will be re-scheduled on resume
        pauseWaterBreakCountdown();
    }

    // Reset timer
    function resetTimer() {
        clearInterval(timerId);
        timerId = null;
        deadline = null;
        timeLeft = 0;
        updateDisplay();
        if (focusHoursInput) focusHoursInput.value = 0;
        if (focusMinutesInput) focusMinutesInput.value = 0;
        startButton.disabled = false;
        pauseButton.disabled = true;
        statusDisplay.textContent = 'Ready to focus';
        speakStatus('Timer reset.');
        waterBreakRemainingMs = null;
        waterBreakActive = false;
        if (waterBreakHoursInput) waterBreakHoursInput.value = 0;
        if (waterBreakMinutesInput) waterBreakMinutesInput.value = 0;
        waterBreakToggle.checked = false;
        waterBreakIntervalSetting.style.display = 'none';
        stopTimerEndAlarm();
        if (waterBreakSound) {
            waterBreakSound.pause();
            waterBreakSound.currentTime = 0;
        }
        if (waterBreakModal) {
            waterBreakModal.style.display = 'none';
        }
        setInputsEnabled(true);
        clearTimeout(waterTimeoutId); waterTimeoutId = null; nextBreakAtMs = null;
        
        // Reset session tracking but keep overall stats
        stopStatsTracking();
        sessionStats.currentSessionStartTime = null;
        sessionStats.currentSessionInitialTime = 0;
        sessionStats.currentStreak = 0; // Reset streak on manual reset
        sessionStats.pausedAt = null;
        sessionStats.accumulatedPauseTime = 0;
        saveStats();
        updateStatsDisplay();
        updateProgressRing();
        sessionStatusEl.textContent = 'Not Started';
    }

    // Event listeners for inputs
    function onTimeInputChange() {
        if (!timerId) {  // Only update if timer is not running
            timeLeft = calculateTotalSeconds();
            updateDisplay();
            console.log('Time input changed:', timeLeft); // Debug log
        }
    }

    // Add input event listeners for real-time updates
    focusHoursInput.addEventListener('input', onTimeInputChange);
    focusMinutesInput.addEventListener('input', onTimeInputChange);

    function startTimerEndAlarm() {
        if (timerEndSound) {
            timerEndSound.currentTime = 0;
            timerEndSound.loop = true;
            timerEndSound.play().catch(() => {});
        }
        if (!('speechSynthesis' in window)) return;
        timerEndVoiceActive = true;
        if (timerEndVoiceTimeoutId) {
            clearTimeout(timerEndVoiceTimeoutId);
            timerEndVoiceTimeoutId = null;
        }
        const speech = window.speechSynthesis;
        speech.cancel();
        const speakLoop = () => {
            if (!timerEndVoiceActive) return;
            const utterance = new SpeechSynthesisUtterance('Session End');
            utterance.rate = 1.0;
            utterance.pitch = 1.0;
            utterance.onend = () => {
                if (timerEndVoiceActive) {
                    timerEndVoiceTimeoutId = setTimeout(speakLoop, 1200);
                }
            };
            speech.speak(utterance);
        };
        speakLoop();
        setTimeout(() => {
            if (!timerEndVoiceActive) return;
            if (!speech.speaking) {
                const fallback = new SpeechSynthesisUtterance('Session End');
                fallback.rate = 1.0;
                fallback.pitch = 1.0;
                speech.speak(fallback);
            }
        }, 300);
    }

    function stopTimerEndAlarm() {
        if (timerEndSound) {
            timerEndSound.pause();
            timerEndSound.currentTime = 0;
            timerEndSound.loop = false;
        }
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
        timerEndVoiceActive = false;
        if (timerEndVoiceTimeoutId) {
            clearTimeout(timerEndVoiceTimeoutId);
            timerEndVoiceTimeoutId = null;
        }
    }

    function stopAllAlarms() {
        stopTimerEndAlarm();
        if (waterBreakSound) {
            waterBreakSound.pause();
            waterBreakSound.currentTime = 0;
        }
        if (timerEndModal) {
            timerEndModal.style.display = 'none';
        }
    }


    function speakStatus(message) {
        if (!message) return;
        if (!('speechSynthesis' in window)) return;
        const utterance = new SpeechSynthesisUtterance(message);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
    }

    function formatDurationForSpeech(totalSeconds) {
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const parts = [];
        if (hours) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
        if (minutes) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
        if (!hours && !minutes && seconds) {
            parts.push(`${seconds} ${seconds === 1 ? 'second' : 'seconds'}`);
        }
        return parts.join(' ');
    }

    // Mobile audio unlock: play silent sound on first Start click to enable audio on mobile browsers
    let audioUnlocked = false;
    // Create an AudioContext to help unlock audio on some mobile browsers (iOS/Chrome)
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    let audioCtx = null;
    const enableSoundBtn = document.getElementById('enableSound');
    const soundModal = document.getElementById('soundModal');
    const soundAllowBtn = document.getElementById('soundAllowBtn');
        function unlockAudio(event, forceShowBtn = false) {
            if (audioUnlocked) return;
            // Ensure an AudioContext exists and try to resume it (required on some mobile browsers)
            try {
                if (!audioCtx && AudioContextClass) audioCtx = new AudioContextClass();
                if (audioCtx && audioCtx.state === 'suspended') {
                    // resume inside user gesture when possible
                    if (event) {
                        audioCtx.resume().then(() => console.log('AudioContext resumed')).catch(() => {});
                    }
                }
            } catch (e) {
                console.log('AudioContext not available:', e);
            }

            let unlockAttempts = 0;
            function tryUnlock(syncInEvent = false) {
                // If this was triggered directly by a user event, attempt immediate play inside the handler
                if (syncInEvent && event) {
                    try {
                        // WebAudio short beep/silence to unlock on iOS Safari
                        if (audioCtx && audioCtx.state === 'running') {
                            const osc = audioCtx.createOscillator();
                            const gain = audioCtx.createGain();
                            gain.gain.value = 0.0001; // effectively silent
                            osc.connect(gain).connect(audioCtx.destination);
                            osc.start();
                            osc.stop(audioCtx.currentTime + 0.01);
                        }
                        if (timerEndSound) { timerEndSound.play(); timerEndSound.pause(); timerEndSound.currentTime = 0; }
                        if (waterBreakSound) { waterBreakSound.play(); waterBreakSound.pause(); waterBreakSound.currentTime = 0; }
                        audioUnlocked = true;
                        if (enableSoundBtn) enableSoundBtn.style.display = 'none';
                        if (soundModal) soundModal.style.display = 'none';
                        removeUnlockListeners();
                        console.log('Audio unlocked synchronously in user event');
                        return;
                    } catch (e) {
                        console.log('Sync unlock failed, will try async:', e);
                    }
                }

                // Fallback: try playing via promises (may still be allowed if called from gesture)
                let timerPromise = timerEndSound ? timerEndSound.play() : Promise.resolve();
                let waterPromise = waterBreakSound ? waterBreakSound.play() : Promise.resolve();
                Promise.all([timerPromise, waterPromise]).then(() => {
                    if (timerEndSound) {
                        timerEndSound.pause();
                        timerEndSound.currentTime = 0;
                    }
                    if (waterBreakSound) {
                        waterBreakSound.pause();
                        waterBreakSound.currentTime = 0;
                    }
                    audioUnlocked = true;
                    if (enableSoundBtn) enableSoundBtn.style.display = 'none';
                    if (soundModal) soundModal.style.display = 'none';
                    removeUnlockListeners();
                    console.log('Audio unlocked via Promise.play()');
                }).catch((err) => {
                    unlockAttempts++;
                    console.log('Audio unlock attempt failed:', err, 'attempt', unlockAttempts);
                    if (unlockAttempts < 2 && forceShowBtn) {
                        if (enableSoundBtn) enableSoundBtn.style.display = 'block';
                    }
                    if (soundModal) soundModal.style.display = 'flex';
                });
            }

            // Prefer synchronous unlock if we have the actual event
            tryUnlock(!!event);

            if (soundAllowBtn) {
                soundAllowBtn.addEventListener('click', function(e) {
                    unlockAudio(e, true);
                });
            }
        }

    // Listen for any user interaction to unlock audio
    function unlockListener(e) {
        unlockAudio(e);
    }
    function removeUnlockListeners() {
        window.removeEventListener('touchstart', unlockListener);
        window.removeEventListener('click', unlockListener);
        window.removeEventListener('keydown', unlockListener);
    }
    // Attach handlers to resume/unlock audio on actual user gestures
    window.addEventListener('touchstart', unlockListener, { once: true, passive: true });
    window.addEventListener('click', unlockListener, { once: true });
    window.addEventListener('keydown', unlockListener, { once: true });

    // Show enable sound button on mobile if not unlocked
    if (/Mobi|Android/i.test(navigator.userAgent)) {
        setTimeout(() => {
            if (!audioUnlocked && enableSoundBtn) enableSoundBtn.style.display = 'block';
        }, 1000);
    }
    if (enableSoundBtn) {
        enableSoundBtn.addEventListener('click', function(e) {
            unlockAudio(e, true);
        });
    }

    // Ensure start button triggers unlock inside the same user event
    startButton.addEventListener('click', function(e) {
        unlockAudio(e);
        startTimer();
    });
    pauseButton.addEventListener('click', pauseTimer);
    resetButton.addEventListener('click', resetTimer);

    // Water break related listeners
    waterBreakToggle.addEventListener('change', () => {
        waterBreakIntervalSetting.style.display = waterBreakToggle.checked ? 'block' : 'none';
        // reschedule/cancel precise water break if timer is running
        if (timerId) {
            if (waterBreakToggle.checked) {
                waterBreakRemainingMs = getWaterBreakIntervalMs();
                scheduleWaterBreak();
            } else {
                waterBreakRemainingMs = null;
                clearTimeout(waterTimeoutId); waterTimeoutId = null; nextBreakAtMs = null;
            }
        }
    });

    function onWaterBreakInputChange() {
        if (!waterBreakToggle.checked) return;
        const intervalMs = getWaterBreakIntervalMs();
        if (intervalMs <= 0) {
            waterBreakRemainingMs = null;
            clearTimeout(waterTimeoutId);
            waterTimeoutId = null;
            nextBreakAtMs = null;
            return;
        }
        if (timerId && !waterBreakActive) {
            waterBreakRemainingMs = intervalMs;
            scheduleWaterBreak();
        }
    }

    waterBreakHoursInput.addEventListener('input', onWaterBreakInputChange);
    waterBreakMinutesInput.addEventListener('input', onWaterBreakInputChange);

    drankButton.addEventListener('click', () => {
        if (waterBreakSound) {
            waterBreakSound.pause();
            waterBreakSound.currentTime = 0;
        }
        waterBreakModal.style.display = 'none';
        waterBreakActive = false;
        
        // Track water break in stats
        sessionStats.waterBreaksTaken++;
        speakStatus('Water break recorded.');
        saveStats();
        updateStatsDisplay();
        
        // Reset the water break countdown and resume
        waterBreakRemainingMs = getWaterBreakIntervalMs();
        deadline = null;
        startTimer();  // Resume the timer
        // Ensure next break is precisely scheduled from now
        if (timerId) scheduleWaterBreak();
    });

    // Close timer end modal and stop sound
    closeTimerButton.addEventListener('click', () => {
        stopTimerEndAlarm();
        timerEndModal.style.display = 'none';
        suppressAutoStartUntil = Date.now() + 400;
        updateStatsDisplay();
        updateProgressRing();
    });

    // Reset stats button
    if (resetStatsButton) {
        resetStatsButton.addEventListener('click', resetAllStats);
    }

    // Initialize
    waterBreakToggle.checked = false;
    waterBreakIntervalSetting.style.display = waterBreakToggle.checked ? 'block' : 'none';
    timeLeft = calculateTotalSeconds();
    updateDisplay();
    
    // Load and display stats
    loadStats().then(() => {
        updateProgressRing();
        sessionStatusEl.textContent = 'Not Started';
        initStatsDashboard();
        refreshStatsDashboard();
    });

    if (insightsToggleButtons && insightsToggleButtons.length) {
        insightsToggleButtons.forEach((button) => {
            button.addEventListener('click', () => {
                insightsToggleButtons.forEach((btn) => btn.classList.remove('active'));
                button.classList.add('active');
                currentChartView = button.dataset.view || 'daily';
                if (currentChartView === 'daily') {
                    dailyWeekOffset = 0;
                }
                renderFocusTotalsChart();
            });
        });
    }

    if (dailyRangeButtons && dailyRangeButtons.length) {
        dailyRangeButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const shift = Number(button.dataset.shift || 0);
                if (shift === 0) {
                    dailyWeekOffset = 0;
                } else {
                    dailyWeekOffset += shift;
                }
                renderFocusTotalsChart();
            });
        });
    }

    window.refreshStatsDashboard = refreshStatsDashboard;

    window.addEventListener('focus', () => {
        if (ensureDailyStats()) {
            syncTodayStatsFromHistory();
            updateStatsDisplay();
            updateProgressRing();
            refreshStatsDashboard({ forceReload: true });
        }
    });

    window.addEventListener('beforeunload', () => {
        saveStats();
    });

    console.log('Focus mode initialized with time:', timeLeft); // Debug log
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeFocusMode);
} else {
    initializeFocusMode();
}
