# Focus Mode Desktop

Focus Mode is a simple desktop timer for deep work. Set a focus duration, start the countdown, and get clear visual/audio cues when it is time to pause or when the session ends.

Features:
- Focus timer with pause/reset controls
- Optional water break reminders
- Session stats and progress ring
- Spoken status cues and end-of-session voice alert

## Install
Installers are located in the `dist` folder after you build the app (or under GitHub Releases if you download them there).

macOS (DMG):
1) Download `Focus.Mode-<version>-universal.dmg`.
2) Double-click the DMG to open it.
3) Drag "Focus Mode" into the Applications folder.
4) Launch from Applications or Spotlight.
5) If macOS blocks the app, allow it in Privacy & Security:
   - Apple menu > System Settings > Privacy & Security.
   - Under Security, click Open Anyway.
   - Confirm Open, then enter your Mac password.

Windows (EXE):
1) Download `Focus.Mode.Setup.<version>-x64.exe`.
2) Double-click the installer.
3) Follow the on-screen prompts.
4) Launch from the Start Menu.

## Tech Stack

- Electron
- HTML/CSS/JavaScript
- Node.js
- electron-builder (packaging)
