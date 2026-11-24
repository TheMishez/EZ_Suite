# EZ Suite

**EZ Soundboard + EZ Reticle in one app**, rebuilt on a small Rust backend (Tauri 2) so it barely touches your PC while you play.

| | Before (2 Electron apps) | EZ Suite (expected) |
|---|---|---|
| Processes in the background | ~8–10 (two full Chromium copies) | 1, plus the window only while it's open |
| Memory with the window closed | ~300–500 MB | ~20–40 MB |
| Audio engine | Web Audio in a browser renderer + a bridge process | Rust on WASAPI, written straight into the mic plugin |
| Hotkeys | Low-level keyboard hook (Windows waits on it) | Raw Input (a copy of the key, after the game got it) |
| Static crosshair | A browser window | A native layered window: one bitmap, zero CPU |

## Features
Everything from both apps, in one window with **Soundboard** and **Crosshair** tabs:

**Soundboard**: plays sounds straight into your real mic with the built-in mic plugin (no VB-CABLE needed; cable mode is still there as a fallback), voice ducking, auto push-to-talk, pass-through hotkeys incl. Mouse 4/5, per-sound trim/volume/speed/loop/normalize, play modes, limiter, boards, favorites, recent, search, waveforms, text to speech, add from link, Stream Deck plugin, starter sounds.

**Crosshair**: designer with layers, shapes, images/GIFs, text, animations with shoot/aim/reload/jump/move/run triggers, pro crosshairs with CS2 share codes, saved crosshairs with hotkeys, per-game switching, follow game window, game-only mode, hide from capture, multi-monitor, alignment guide, backups.

Closing the window frees its memory. Hotkeys, sounds, push-to-talk, the Stream Deck and the crosshair keep running from the tray.

## Moving from the old apps
1. **Uninstall the old EZ Soundboard and EZ Reticle first.** The old soundboard's uninstaller removes the mic plugin, so if it runs *after* EZ Suite is installed it would switch EZ Suite's mic plugin off too. (If that happens: Settings → Microphone → tick your mic → Apply.)
2. Install EZ Suite. On first start it copies your sounds, boards and settings from EZ Soundboard and your crosshairs and settings from EZ Reticle. The old files are left untouched.
3. Audio devices are picked again (the old app's device ids don't carry over). Cable-mode users get the VB-CABLE setup again automatically.

## How it's built
```
src-tauri/src/
  lib.rs            app start-up, windows, tray, shared commands
  input.rs          the one native worker thread: Raw Input hotkeys + animation triggers, game detection
  keys.rs           hotkey strings -> virtual keys (both apps' formats)
  perf.rs           below-normal priority, Efficiency mode when idle, MMCSS for audio threads
  updater.rs        in-app updates from GitHub Releases
  tray.rs           tray icon and menu
  crosshair/mod.rs  crosshair config, overlay modes, per-game profiles, commands
  crosshair/still.rs native layered window for static crosshairs
  sound/engine.rs   mixer + WASAPI streams (headphones, mic plugin / virtual cable, mic input)
  sound/decode.rs   decoding (symphonia) and the decoded-audio cache
  sound/apo.rs      shared memory with the mic plugin + the setup tool
  sound/mod.rs      library, play modes, push-to-talk, commands
  sound/{ptt,tts,link,remote}.rs  push-to-talk keys, text to speech, add from link, Stream Deck server
ui/
  shared/           app bar (tabs + window buttons) used by both pages
  soundboard/       the soundboard UI (from EZ Soundboard), js/api.js connects it to Rust
  crosshair/        the designer UI (from EZ Reticle), api.js connects it to Rust
  overlay/          the animated-crosshair overlay page
native/             the C++ mic plugin (EZSoundboardApo.dll) and its setup tool
streamdeck/         the Stream Deck plugin (talks to 127.0.0.1:41720, unchanged)
```

## Building
**Easiest:** push to GitHub. `.github/workflows/build.yml` builds the installer on GitHub's Windows machines; download it from the run's **Artifacts**.

**To ship an update:** bump `version` in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, then publish a GitHub release tagged `vX.Y.Z`. The workflow attaches the installer and installed copies offer the update.

**On your PC:** install Rust, Node.js 20+ and Visual Studio 2022 Build Tools (Desktop development with C++), then:
```
npm install
npm run build       # mic plugin, Stream Deck plugin, then the installer in src-tauri/target/release/bundle/nsis
npm run dev         # development (run `npm run native` once first)
```

## Notes
- Data lives in `%APPDATA%\EZ Suite\` (`library.json`, `sounds\`, `crosshair.json`, `suite.json`, `error.log`).
- Mic plugin logs: `%ProgramData%\EZSoundboard\`.
- Formats the Rust decoder can't read (mainly Opus) are converted to WAV once, the first time you add them.
- Some anti-cheat systems (FACEIT, Vanguard) may ignore auto push-to-talk key presses. Sounds still go into the mic.
- Exclusive fullscreen hides every overlay; use borderless / fullscreen windowed.

## Code signing
Free code signing by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org), once the project is accepted.
