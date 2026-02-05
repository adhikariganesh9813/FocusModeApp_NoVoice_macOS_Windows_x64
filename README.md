# Focus Mode Desktop

Focus Mode is a simple desktop timer for deep work. Set a focus duration, start the countdown, and get clear visual/audio cues when it is time to pause or when the session ends.

Features:
- Focus timer with pause/reset controls
- Optional water break reminders
- Session stats and progress ring
- Natural voice notifications and audio alerts
- Focus totals bar chart with weekly (Mon–Sun), monthly, and yearly views
- Weekly average and week navigation for daily stats

## Motivation

I built this app to remind myself to drink water because I forget to stay hydrated when I am deeply focused on work or study. It helps me keep my energy and focus consistent while I am on my PC and tracks the time I spend on work and study. It also gives me practice in coding and product development.

## Install
Installers are located in the `dist` folder after you build the app (or under GitHub Releases if you download them there).

### macOS (DMG):
1) Download `Focus Mode-<version>-arm64.dmg`.
2) Double-click the DMG to open it.
3) Drag "Focus Mode" into the Applications folder.
4) **Important:** If macOS says the app is "damaged" or can't be opened:
   - Open Terminal
   - Run: `xattr -cr /Applications/Focus\ Mode.app`
   - Or right-click the app, select "Open", then click "Open" in the dialog
5) Launch from Applications or Spotlight.
6) If macOS still blocks the app, allow it in Privacy & Security:
   - Apple menu > System Settings > Privacy & Security
   - Under Security, click "Open Anyway"
   - Confirm Open, then enter your Mac password

### Windows (EXE):
1) Download `Focus Mode Setup <version>-arm64.exe`.
2) Double-click the installer.
3) Follow the on-screen prompts.
4) Launch from the Start Menu.

## Tech Stack

- Electron
- HTML/CSS/JavaScript
- Node.js
- electron-builder (packaging)
