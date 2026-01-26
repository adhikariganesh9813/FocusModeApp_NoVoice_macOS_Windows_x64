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

// Session stats tracking
let sessionStats = {
    totalFocusTimeSeconds: 0,
    sessionsCompleted: 0,
    waterBreaksTaken: 0,
    currentStreak: 0,
    currentSessionStartTime: null,
    currentSessionInitialTime: 0,
    lastSessionDate: null,
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

    // Load stats from local storage (schema-aware)
    async function loadStats() {
        if (window.FocusStorage && window.FocusStorage.loadAggregates) {
            const aggregates = await window.FocusStorage.loadAggregates();
            sessionStats = { ...sessionStats, ...aggregates };
        }
        updateStatsDisplay();
    }

    // Save stats to local storage (schema-aware)
    function saveStats() {
        if (window.FocusStorage && window.FocusStorage.saveAggregates) {
            window.FocusStorage.saveAggregates(sessionStats);
        }
    }

    // Format seconds to readable time
    function formatTimeStats(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    }

    // Update stats display
    function updateStatsDisplay() {
        totalFocusTimeEl.textContent = formatTimeStats(sessionStats.totalFocusTimeSeconds);
        sessionsCompletedEl.textContent = sessionStats.sessionsCompleted;
        waterBreaksTakenEl.textContent = sessionStats.waterBreaksTaken;
        currentStreakEl.textContent = sessionStats.currentStreak;
        updateMotivationMessage();
    }

    function updateSessionStatusText() {
        if (waterBreakActive) {
            sessionStatusEl.textContent = 'Water Break';
        } else {
            sessionStatusEl.textContent = timerId ? 'Active' : 'Paused';
        }
    }

    // Update progress ring
    function updateProgressRing() {
        if (!sessionStats.currentSessionStartTime || sessionStats.currentSessionInitialTime === 0) {
            progressPercentEl.textContent = '0%';
            progressRingCircle.style.strokeDashoffset = 326.73;
            return;
        }

        const elapsed = sessionStats.currentSessionInitialTime - timeLeft;
        const progress = (elapsed / sessionStats.currentSessionInitialTime) * 100;
        const progressClamped = Math.max(0, Math.min(100, progress));
        
        progressPercentEl.textContent = `${Math.round(progressClamped)}%`;
        
        const circumference = 326.73;
        const offset = circumference - (progressClamped / 100) * circumference;
        progressRingCircle.style.strokeDashoffset = offset;

        // Update current session time (excluding paused time)
        let sessionElapsedSeconds;
        if (sessionStats.pausedAt) {
            // Currently paused - don't count time since pause
            sessionElapsedSeconds = Math.floor((sessionStats.pausedAt - sessionStats.currentSessionStartTime - sessionStats.accumulatedPauseTime) / 1000);
        } else {
            // Currently active - count all time except accumulated pauses
            sessionElapsedSeconds = Math.floor((Date.now() - sessionStats.currentSessionStartTime - sessionStats.accumulatedPauseTime) / 1000);
        }
        currentSessionTimeEl.textContent = formatTimeStats(sessionElapsedSeconds);
        
        // Update total focus time in real-time
        if (!sessionStats.pausedAt && timerId) {
            sessionStats.totalFocusTimeSeconds = (sessionStats.totalFocusTimeSeconds || 0);
            totalFocusTimeEl.textContent = formatTimeStats(sessionStats.totalFocusTimeSeconds + sessionElapsedSeconds);
        }
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
            updateProgressRing();
            updateSessionStatusText();
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

    function initStatsDashboard() {
        if (!window.FocusStorage) return;
        window.FocusStorage.migrateIfNeeded();
    }

    // Complete a session
    function completeSession() {
        if (sessionStats.currentSessionStartTime) {
            const totalElapsed = Date.now() - sessionStats.currentSessionStartTime;
            const activeTime = totalElapsed - (sessionStats.accumulatedPauseTime || 0);
            const sessionDuration = Math.floor(activeTime / 1000);
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
            if (window.FocusStorage && window.FocusStorage.recordCompletedSession) {
                window.FocusStorage.recordCompletedSession(sessionRecord);
            }
            const keys = getDateKeys(Date.now());
            sessionStats.activityByDay[keys.day] = (sessionStats.activityByDay[keys.day] || 0) + sessionDuration;
            sessionStats.activityByMonth[keys.month] = (sessionStats.activityByMonth[keys.month] || 0) + sessionDuration;
            sessionStats.activityByYear[keys.year] = (sessionStats.activityByYear[keys.year] || 0) + sessionDuration;
            sessionStats.totalFocusTimeSeconds += sessionDuration;
            sessionStats.sessionsCompleted++;
            sessionStats.currentStreak++;
            sessionStats.currentSessionStartTime = null;
            sessionStats.currentSessionInitialTime = 0;
            sessionStats.pausedAt = null;
            sessionStats.accumulatedPauseTime = 0;
            saveStats();
            updateStatsDisplay();
            updateProgressRing();
        }
    }

    // Reset all stats
    async function resetAllStats() {
        if (confirm('Are you sure you want to reset all stats? This will clear your current session data.')) {
            sessionStats = {
                totalFocusTimeSeconds: 0,
                sessionsCompleted: 0,
                waterBreaksTaken: 0,
                currentStreak: 0,
                currentSessionStartTime: null,
                currentSessionInitialTime: 0,
                lastSessionDate: null,
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
                refreshStatsDashboard();
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
                        updateProgressRing();
                        updateSessionStatusText();
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
        if (!('speechSynthesis' in window)) return;
        timerEndVoiceActive = true;
        if (timerEndVoiceTimeoutId) {
            clearTimeout(timerEndVoiceTimeoutId);
            timerEndVoiceTimeoutId = null;
        }
        window.speechSynthesis.cancel();
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
            window.speechSynthesis.speak(utterance);
        };
        speakLoop();
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
    });

    console.log('Focus mode initialized with time:', timeLeft); // Debug log
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeFocusMode);
} else {
    initializeFocusMode();
}
