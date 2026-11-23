# Build log

Project: `swiftdm/` (run with `npm start` inside it, tests with `npm test`).

| ID | date | status | missing / notes |
| --- | --- | --- | --- |
| Shell | 2026-11-21 | done | Electron main + preload + renderer, tokens wired. No seed data: the empty state is the real first-run screen. |
| S01 main window | 2026-11-21 | done | toolbar, filters, sortable table, status bar, empty, loading, error toast. Not checked at small window widths. |
| S02 add dialog | 2026-11-21 | done | link, folder, file name, inline error. No clipboard prefill (could-have). |
| S03 details | 2026-11-21 | done | per-connection bar, pause/resume/cancel. Opens on double-click or Enter. |
| S04 settings | 2026-11-21 | done | General, Connections, Speed, Browser tabs. |
| S05 media popup | 2026-11-21 | partial | lives in the extension popup; direct files only, no HLS/DASH. Not run in a browser. |
| S06 tray | 2026-11-21 | partial | menu built, not seen. Close button hides to tray. |
| S07 history | 2026-11-21 | done | the Done filter in S01, not a separate screen. |
| S08 extension popup | 2026-11-21 | partial | written, not loaded in a browser. |

## Deviations from the plan (and why)

- **JSON file instead of SQLite.** `better-sqlite3` needs native build tools on Windows; a store with the same shape is behind `main/store.cjs`, swap later using `replica/schema.sql`.
- **No Tailwind or Radix.** Plain CSS on the tokens, native `<dialog>` for focus trap and Esc. Fewer dependencies for the same behaviour.
- **Main process is plain CommonJS JavaScript**, renderer is TypeScript. Avoids a build step for main.
- **Capture goes straight to the queue** instead of opening S02 prefilled. Fewer clicks; add a confirm dialog if wanted.
- **No `/v1/media` route.** The popup lists media from the extension itself and sends the chosen one to `/v1/capture`.
- **Some CSS uses raw px** (control heights, 6px bar) instead of tokens; layout sizes are in tokens.css but not every control height.

## Harder than expected

- Electron's binary did not install: npm 11 blocks install scripts and extract-zip silently did nothing on Node 26. I unzipped the cached download by hand. A fresh machine may need the same.
- Cannot confirm the original's exact screens (no screenshots): layout follows the recon map, not pixels.

## Gap-closing pass (2026-11-21)

- Added e2e for open/show/delete, extension e2e in real Chromium, speed-limit test, file-type filter (bridge, extension, Settings field).
- Chromium would not launch from its default install folder (`spawn UNKNOWN`); a copy in `swiftdm/.chromium` works and the extension tests use it automatically if present. It is git-ignored (453 MB).
- S05/S08 now verified in Chromium; S06 tray still not seen.

## Pairing pass (2026-11-21)

The owner found manual token copy-and-paste too fiddly. Added one-click pairing: the extension popup has Connect to GDM, the app shows an Allow prompt naming the extension, and only then is the token handed over (bridge route `/v1/pair`, extension origins only, one prompt at a time). The manual token is still available under "Connect by hand instead". 19 unit and 24 end-to-end tests pass.

## Logo, new-download window and notice window (2026-11-21)

- **Logo everywhere:** `assets/make-icon.cjs` now writes `icon.ico` (16 to 256 px), `tray.png`, `icon.png`, the installer wizard images (`sidebar.bmp` 164x314, `header.bmp` 150x57) and `public/logo.png` (shown in the app windows and toolbar). The installer config uses them for the setup file icon, uninstaller icon, wizard header and sidebar, desktop and Start menu shortcuts. Icon editing of the exe was switched on (it works now from a short path), so the app exe carries the G (checked by extracting the icon from both `Setup.exe` and the app exe). The wizard pages themselves were not run (that would install the app).
- **New-download window** (`main/windows.cjs`, `src/prompt.tsx`): the browser extension's link now opens an always-on-top window with file name (editable), save folder, host, size, and three choices: Download, Let the browser do it, Cancel. Escape or closing it leaves the download to the browser, so nothing is lost. Can be turned off in Settings.
- **Notice window** (`src/toast.tsx`): bottom-right of the screen when a download finishes (Open, Show in folder) or fails (reason, Try again). It stacks, pauses its 9 s (20 s for failures) timer while hovered, and does not take keyboard focus. Replaces the Windows notification. Can be turned off in Settings.
- Error texts like "terminated" are now sentences ("The connection was cut before the file finished.").
- Known edge: if the new-download window is left unanswered for about five minutes, the browser extension's request can time out; the browser then keeps its own copy.
- 23 unit, 35 end-to-end tests pass (one of them runs the built app).

## Browser add-on and lighter app (2026-11-21)

**Why the add-on could not be added.** (1) The installer did not contain the add-on folder at all, so after installing there was nothing to load. (2) Current Google Chrome ignores the `--load-extension` flag (checked with the Chrome on this PC: add-on service workers 0), so for Chrome there is no way around Developer mode, Load unpacked. Edge does accept the flag (checked: the add-on ran in Edge). Fixes: the add-on now ships in `resources/extension`, the app copies it to `%APPDATA%\gdm\extension` on every start (a stable path that survives updates), and a new **Add to browser** dialog lists the installed browsers (Chrome, Edge, Brave, Opera, Vivaldi), opens their extensions page, copies the folder path, shows live "Connected" status, and a reminder bar stays on the main window until the add-on has connected once. `release/gdm-extension.zip` is the same add-on packed for a Chrome Web Store upload (needs a developer account, one-time fee, the user creates it), which is the only way to get a one-click install in Chrome.

**Lighter.**

| | before | after |
| --- | --- | --- |
| Installer | 84 MB | 70.8 MB |
| Installed size | 294 MB | 229 MB |
| Memory, window open | 287 MB | 134 MB |
| Memory, window closed to the tray | 287 MB | 105 MB |
| Idle CPU | about 0% | about 0% |

What did it: the packaged app no longer carries React, the icon library and other packages already bundled into the page (about 25 MB), only the English Chromium language pack, maximum installer compression, no hardware-accelerated graphics (saves the 168 MB graphics process), and closing the window now frees the page completely while downloads keep running (tested). A switch that merges the graphics process into the main one saved more memory but crashed the app (access violation) in a test, so it was removed. Further Chromium switches changed nothing measurable. Measured with `scripts/measure.mjs` on the built app.

Honest floor: an Electron app cannot go much below about 65 MB installer and 100 MB memory. A much smaller app (about 10 MB, 40 MB memory) would mean rebuilding the shell on Tauri/WebView2: a rewrite, not done.

23 unit and 41 end-to-end tests pass (including the built app).

## Progress window, dark theme, Firefox (2026-11-21)

- **Progress window** (`src/progress.tsx`, `main/windows.cjs`): every download that comes from the browser opens its own window with the file name, status, speed, time left, downloaded of total, folder, host, number of connections, a per-connection strip and a progress bar, with Pause or Resume, Cancel download and Hide. It closes itself when the download ends and the corner notice takes over. The main window is never opened by a download. Closing it with Hide or X only hides it. Setting: "Show a progress window for each download that comes from the browser".
- **Smoothness:** the engine now measures five times a second (was once a second) and smooths the speed (so the number and the time left do not jump); progress windows are fed about ten times a second; the bar moves with a 220 ms transform transition instead of resizing; saving the state file is every 2 seconds instead of every tick. Test P2 checks it on a real run.
- **Dark theme:** Settings, General, Appearance: Same as the system (default), Light, Dark. It is applied through Electron's `nativeTheme`, so every window (main, new-download, progress, notice, add-on setup) switches at once and the choice is kept. Dark palette in `replica/design/tokens-dark.json`: 16 contrast pairs, 0 failures. The add-on popup follows the browser's theme.
- **Firefox:** the app builds a Firefox copy of the add-on on every start (`%APPDATA%\gdm\extension-firefox`, manifest version 2, same scripts; the scripts use `browser` when it exists, otherwise `chrome`). The Add to browser dialog has a Firefox tab: open about:debugging, Load Temporary Add-on, choose the shown `manifest.json`, Connect, Allow. **Limits:** (1) I could not test it in a real Firefox (none installed here, and Playwright's Firefox cannot load add-ons), only the manifest, the folder, the script under a pretend `browser` API and the button. (2) Firefox forgets a temporary add-on when it closes. A permanent install needs a file signed by Mozilla: `release/gdm-firefox.xpi` is the unsigned package; to sign it (free, your own addons.mozilla.org account and API keys): `npx web-ext sign --channel=unlisted --source-dir <the add-on folder> --api-key <key> --api-secret <secret>`; then Firefox installs the signed .xpi for good.
- Memory with the window open or closed is unchanged: 134 MB and 105 MB. Each progress window is one more page (about 30 MB) while it is open.
- 29 unit and 56 end-to-end tests pass (1 skipped when the Windows clipboard is held by another program). A theme fade made an accessibility scan flaky; scans now wait for it to finish.

## Add-on accepted without any step from the user (2026-11-21)

Before: the add-on asked to connect, the app showed an Allow window, the user pressed Connect and Allow. Now none of that is needed.

- **How the app knows it is our add-on:** the manifest carries a fixed public key, so Chrome, Edge and Brave always give the add-on the same id (`jnfkkbpkedbeoidjmphenkdhdcgbjmoc`, computed by the app from the key, and checked against what real Chromium reports). Pairing requests from that id are accepted silently. Requests from any other add-on still show the Allow window; web pages and callers with no origin are refused as before. Firefox gives every install a random address, so for Firefox any Firefox add-on is accepted.
- **How it connects:** the add-on tries to pair as soon as it is installed, when the browser starts, when the popup opens, before a download is taken over, and every minute while the app is not reachable. A stale token (for example after reinstalling the app) is renewed by itself. If you refuse a request (setting off), it does not ask again for an hour.
- **Setting:** Settings, Browser, "Accept GDM's own browser add-on automatically, without asking" (on by default). Turn it off to get the question back.
- **What is still manual:** getting the add-on into the browser. Chrome, Edge, Brave and Firefox do not let a program install an add-on that is not from their store without the user (Chrome removed even the launch flag; unsigned Firefox add-ons are refused). The Add to browser dialog does everything else; the only truly one-click way is to publish `release/gdm-extension.zip` to the Chrome Web Store and Edge Add-ons (and sign the Firefox one), after which "Add" is a single click in the browser and, with the stable id, the connection is automatic. When publishing, the store assigns its own id: add it to `isOwnExtension` in `main/trust.cjs`.
- 33 unit and 63 end-to-end tests pass (including the built app).

## Languages, file icon, video and audio from web pages (2026-11-22)

**Languages (English, Arabic, French).** Settings, General, Language: Same as the system (default), English, العربية, Français. The English text is the key and `src/lang-fr.ts` and `src/lang-ar.ts` hold the translations (200 texts). Everything follows at once: main window, new-download, progress and notice windows, the add-on setup dialog, the tray menu and the question about an unknown add-on (`main/i18n.cjs`), the add-on popup (follows GDM's language, else the browser's). Arabic switches the page to right to left (logical CSS properties, the progress bar fills from the right, numbers and units keep their own order). Digits stay Latin in all languages. A test fails if any text has no translation, keeps no placeholder, or is left over. Engine error sentences stay English in the saved state and are translated where shown, so a language change also changes old errors. The translations were written by me, not by a native reviewer: have an Arabic and a French speaker read them. The landing page is still English only.

**File icon.** The progress window and the new-download window show the icon Windows uses for the file type (`app.getFileIcon`, by file ending), a plain file symbol if none. The notice window keeps the program logo.

**Video and audio from web pages.** `main/media.cjs`, `main/tools.cjs`. For a page, GDM runs yt-dlp to read it, lists every quality (heights, 60 fps, size, which need joining), and offers audio only as the original file or MP3. Start from the add-on (button "Download video or audio from this page", or a detected HLS/DASH stream) or from the Add dialog ("Video or audio…"). The helper programs are not in the installer (it stays 70.9 MB): yt-dlp is fetched the first time it is needed and ffmpeg only when a choice needs it (joining picture and sound above the ready-made files, or MP3), each checked against the checksum published with the release, and a download that does not match is thrown away. yt-dlp updates itself about once a week (Settings, Video). The command is built as a list of arguments and the link follows `--`, so a title or link cannot become a command or an option. Pause kills the helper and keeps the half file, resume carries on from it; cancel removes the pieces. The browser add-on sends the browser's cookies and referrer so logged-in videos work. DRM-protected video is not supported and is reported as such.

**What was not verified.** Everything above was tested with a stand-in for yt-dlp (`test/fake-ytdlp.cjs`) that behaves like it, so none of the tests touch a real site or the real helper. Not run: real yt-dlp on a real site, the real helper download from GitHub (the install code is tested against a local server with a checksum file and a small zip), the ffmpeg joining and MP3 conversion. Downloading yt-dlp and a public test video here would be the way to check; it needs your go-ahead.

**Also.** Respect each site's terms and copyright when saving videos; GDM does not get around DRM or logins.

Tests: 77 unit and 80 end-to-end pass (including the built app).

## Automatic updates (2026-11-23)

**The program.** `main/updater.cjs`. A small file `latest.json` on a web address holds `{ version, url, sha256, notes }`. A little after start and then every day (Settings, Updates, "Update GDM automatically"), GDM reads it; if the version is newer it fetches the installer quietly, checks the SHA-256 against the one in the file and keeps it in the app's `updates` folder. It then shows a bar "GDM x is ready. It installs when you close the program, or right now." with Restart now, and the same in Settings, Updates. On close (or Restart now) it checks the file once more and starts the installer silently (`/S --updated --force-run`), so GDM comes back by itself. Safety: the feed and the installer must be https (or this computer); a wrong checksum, a bad feed, an oversized file or a file that changed after the check is refused and nothing is kept; only a file inside its own folder is ever started. The notes shown are in the chosen language when the file has them.

**Where the address comes from.** Settings, Updates, "Address of the update file", or `gdmUpdateUrl` in `package.json` at build time (empty now: **there is no update server yet, so updates stay idle until you set one**). To publish a version: `npm run dist`, then `node scripts/make-update.mjs --base https://your.host/gdm/ --en "..." --fr "..." --ar "..."`, and upload the two files in `release/update/` (any static host, for example GitHub Releases). Bump `version` in `package.json` for each release.

**The helpers.** The video helper (yt-dlp) is compared with the checksum published for the newest release about once a week (also when you press the button in Settings, Video); the conversion helper (ffmpeg) about once a month by the build it was unpacked from. A different checksum means a newer file, which is fetched, checked and swapped in; nothing happens while a video is being fetched, and a helper that was never installed is not installed by an update.

**Not verified.** The silent install of the real installer over an old version (it would change this PC), the updater against a real host over https, and the helper updates against the real GitHub release pages. All of them were tested against local servers. Because the installer is not signed, the checksum in `latest.json` only protects against a damaged or swapped installer if the feed address itself is trustworthy; a code-signing certificate would add the missing protection.

Tests: 97 unit and 90 end-to-end pass.

**Publishing in one command (2026-11-23).** `npm run release -- --repo YOUR-NAME/YOUR-REPO --en "..." --fr "..." --ar "..."` (`scripts/publish-release.mjs`) sets the update address to `https://github.com/YOUR-NAME/YOUR-REPO/releases/latest/download/latest.json`, builds, prepares `latest.json` and creates the GitHub release. It needs a public repository and the GitHub tool signed in once (`winget install GitHub.cli`, `gh auth login`); raise `version` in `package.json` before each release. `--dry-run` does everything but publish and puts `package.json` back; it was tested that way. Not done: nothing has been published, because that needs the owner's GitHub account.

**First release published (2026-11-23).** The repository is public: https://github.com/abo7la24/gdm-releases (an older private repository `abo7la24/gdm` already existed and was left untouched; a private repository cannot serve updates). The installer cannot be attached as a GitHub release through the browser tools (their upload limit is 10 MB, the installer is 70.9 MB), so `GDM-Setup-0.1.0.exe` and `latest.json` were committed to the `main` branch with git, using the git login already on this PC. The program therefore looks at `https://raw.githubusercontent.com/abo7la24/gdm-releases/main/latest.json` (built into this installer as `gdmUpdateUrl`). Each new release adds about 70 MB to the repository history (GitHub warns above 50 MB per file and refuses 100 MB); switch to GitHub Releases or Git LFS when that gets heavy. To publish the next version: raise `version` in `package.json`, `npm run dist`, `node scripts/make-update.mjs --en "..." --fr "..." --ar "..."`, copy the two files in `release/update/` into a clone of the repository, commit and push. The `npm run release` script (GitHub Releases through the `gh` tool) is still there for when `gh` is installed.
