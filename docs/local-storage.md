# Local Storage Design (v2)

## Storage location

The app persists user data locally at:

- `~/Library/Application Support/Focus Mode/focus-stats.json` on macOS
- Equivalent `app.getPath('userData')/focus-stats.json` on each platform

Each device has its own file. No server or shared remote database is used.

## Schema

```json
{
  "schemaVersion": 2,
  "lastActiveDateKey": "YYYY-MM-DD",
  "dailyRecords": {
    "YYYY-MM-DD": {
      "dateKey": "YYYY-MM-DD",
      "totalFocusSeconds": 0,
      "sessionsCount": 0,
      "waterBreaksTaken": 0,
      "lastUpdatedAt": "ISO-8601"
    }
  },
  "sessionHistory": [],
  "runtime": {
    "currentSessionStartTime": null,
    "currentSessionInitialTime": 0,
    "pausedAt": null,
    "accumulatedPauseTime": 0
  },
  "totalWaterBreaks": 0,
  "lastSessionSeconds": 0
}
```

`dailyRecords` is the source of truth for daily and history totals. One key per day prevents duplicates for the same day.

## Rollover behavior

- On launch/focus/timer tick, the app computes local `todayKey` (`YYYY-MM-DD`).
- If `lastActiveDateKey !== todayKey`, it:
  - Preserves history,
  - Ensures a record exists for `todayKey`,
  - Resets in-memory daily counters for the current day view,
  - Updates `lastActiveDateKey`.
- If a timer is active at midnight, the running session is split at local midnight so the previous day is finalized and the current day continues cleanly.

## Migration

Migration runs once when loading old data:

- Detects non-v2 formats.
- Converts legacy `sessionHistory` + `activityByDay` into `dailyRecords`.
- Merges totals conservatively (`max`) to avoid losing existing day totals.
- Deduplicates sessions by session id.
- Persists back as `schemaVersion: 2` with migration metadata.

## Crash safety

Writes use atomic local file updates:

1. Write JSON to temp file.
2. `fsync` temp file.
3. Rename temp file to target file.
4. `fsync` parent directory.

This avoids partial/corrupted file states on force-close or OS restart.
