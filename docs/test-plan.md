# Test plan (GDM)

Tests run against our own app only. Automated: Vitest (engine + bridge, `npm test`) and Playwright driving the real Electron app (`npm run e2e`).

| case | what | how | result |
| --- | --- | --- | --- |
| F01-H1 | add link, finishes, bytes identical | e2e | pass |
| F01-N1 | non-http link: inline error, nothing added | e2e | pass |
| F01-N2 | 404 link: server error shown in dialog | e2e | pass |
| F01-E1 | spaces, accents, emoji in file name | e2e | pass |
| F01-E2 | same link twice: `(1)` suffix, no overwrite | e2e | pass |
| F01-E3 | keyboard only: add, open details, Esc | e2e | pass |
| F01-E4 | hard kill after pause: state on disk, row returns Paused | e2e | pass (after fix B2) |
| F01-E5 | no-range server falls back to one connection | vitest | pass |
| F01-E6 | Windows-reserved names, non-http schemes rejected | vitest | pass |
| F02-H1 | extension capture: bad/missing token rejected | vitest | pass |
| F02-N1 | page origin rejected even with token | vitest | pass |
| F02-E1 | double-sent capture makes one download | vitest | pass |
| F02-N2 | file:// capture refused | vitest | pass |
| F02-H2 | real Chromium: download taken over, cookie forwarded, browser copy erased | e2e | pass |
| F02-N3 | wrong token: browser keeps its download | e2e | pass |
| F02-H3 | one click pairs: Connect, Allow in the app, capture works | e2e | pass |
| F02-N4 | Deny in the app: no token given | e2e | pass |
| PAIR-1..4 | pairing needs app approval, refused for web pages and no origin, one prompt at a time | vitest | pass |
| W1 | link from browser opens its own window with name, host, size; Download starts it | e2e | pass |
| W2 | rename file and change folder in that window | e2e | pass |
| W3-W5b | "Let the browser do it", Cancel, Escape, closing with X | e2e | pass |
| W6-W7 | finished notice: Show in folder, Open | e2e | pass |
| W8 | failed notice shows the reason; Try again | e2e | pass |
| W9 | axe scan of both new windows | e2e | pass |
| PACK-1 | the built app (not the dev build) shows the window and the notice | e2e | pass |
| BRIDGE-R | review hook: cookies/referrer passed, cancel/browser answers, skipped types never reach the window | vitest | pass |
| ERR-1 | network and disk errors turned into sentences | vitest | pass |
| B1-B5 | add-on folder ready with the real files; Copy; installed browsers listed and their extensions page opened (recorded, no real browser); reminder until the add-on connects then gone; axe scan | e2e | pass |
| LIFE-1 | close the window to the tray: download finishes with no window; reopening shows it done | e2e | pass |
| PACK-2 | the built app contains resources/extension and writes the folder copy | e2e | pass |
| MANUAL-1 | real Edge loaded the add-on through its launch flag (service worker running) | script | pass |
| MANUAL-2 | real Chrome (current) ignored the same flag: the add-on has to be added by hand | script | confirms the manual steps are needed |
| P1 | browser download opens a progress window with name, status, speed, time left, folder, host; the main window stays away | e2e | pass |
| P2 | smoothness: bar never goes back, at least 10 steps in 3 s, no stall over 0.5 s, speed does not flicker | e2e | pass |
| P3-P7 | Pause and Resume, Hide (download continues to the end, bytes identical), finishing closes it and opens the notice, Cancel removes the file, setting off | e2e | pass |
| P8 | progress window accessibility in light and dark | e2e | pass |
| T1-T6 | theme choices, Dark and Light apply at once, System follows the OS, other windows follow, remembered after restart, every screen passes axe in dark | e2e | pass |
| B6-B7 | Firefox tab: v2 manifest file ready, opens about:debugging or says Firefox is missing | e2e | pass |
| ADDON-1 | add-on script runs with both the Firefox (`browser`) and Chrome (`chrome`) API; Firefox manifest generator | vitest | pass |
| MANUAL-3 | real Firefox | none | NOT RUN (Firefox is not installed here) |
| A1-A2 | add-on connects by itself on install (token stored, 0 questions), first download captured with nothing pressed; its id equals the one the app computes | e2e | pass |
| A3 | browser started first, app later: first download still captured, 0 questions | e2e | pass |
| A4 | a stale token is renewed by itself | e2e | pass |
| A5 | setting off: the app asks once, a refusal is remembered for an hour | e2e | pass |
| A6 | an unknown add-on is always asked about; web pages refused; our own id accepted | e2e | pass |
| TRUST-1 | id derived from the manifest key; own, Firefox, other add-on, web page, empty origin | vitest | pass |
| I18N-1..4 | every text has a French and an Arabic version, placeholders and bold marks kept, nothing left over, tray and add-on texts too | vitest | pass |
| L1-L8 | French and Arabic switch at once, Arabic reads right to left with the list on the right, other windows follow, kept after restart, errors and the add-on question in the chosen language, accessibility scans | e2e | pass |
| MEDIA-1..4 | quality list from a page (heights, sizes, which need the helper), audio options, login/no-video/list messages, session cookies passed, safe command (no injection) | vitest | pass |
| MEDIA-5..9 | download with and without the helper, picture and sound joined, progress never goes back, pause and resume continue the half file, cancel cleans up, failure in words | vitest | pass |
| TOOLS-1..4 | helper install accepted only with a matching published checksum, no half file left, unpack only ffmpeg | vitest | pass |
| V1-V9 | choice window, 720p download with remembered choice, audio and MP3, no-video and login messages, Add dialog button, file-type icon, Arabic, add-on page button with session | e2e | pass |
| MANUAL-4 | real yt-dlp against a real site | none | NOT RUN (the helper was not fetched here) |
| UPD-1..14 | versions compared as numbers; address must be https (or this computer); newer version fetched and checksum-verified; same or older ignored; bad, wrong, missing and oversized files refused with no half file; a good copy is not fetched twice; installer started silently only after a second check, never from outside its folder | vitest | pass |
| UPD-H | helpers: left alone when equal to the published checksum, replaced only by a verified new file, old one kept on mismatch, skipped while in use, never installed unasked, ffmpeg recognised by its build | vitest | pass |
| U1-U9 | Updates tab and reminder bar, Restart now starts the installer with the silent arguments then closes, installs on close (and not when switched off), bad checksum refused, "latest version" message, address check, missing address message, French, accessibility | e2e | pass |
| MANUAL-5 | the real installer run silently over an old install, GDM starting again afterwards | none | NOT RUN (it would install on this PC) |
| F02-E2 | skipped file type left to the browser | vitest | pass |
| F03-H1 | page video detected, sent to app via the popup message path | e2e | pass (popup buttons not clicked) |
| FILES-1..6 | open file, show in folder, missing file error, remove keeps file, delete file too, Delete key confirm | e2e | pass |
| SPEED-1 | speed limit holds (6 MB at 4 MB/s > 1.1 s) | vitest | pass |
| F04-H1 | pause then resume, bytes identical | e2e + vitest | pass |
| F04-E1 | cancel leaves cancelled row, no file | e2e | pass |
| F04-E2 | restart mid-download, resume to correct file | vitest | pass |
| F05-H1 | settings persist when reopened | e2e | pass |
| F05-N1 | out-of-range setting refused with message | e2e | pass |
| A11Y-1 | axe scan: main window and add dialog | e2e | pass (after fix B1) |
| console | no console errors in any e2e case | e2e | pass |

## Not covered (manual or later)

- Edge and Firefox (Chromium is covered); popup buttons clicked by hand
- Tray menu and desktop notifications on screen
- Server that answers 429/403 to many connections (no automatic back-off yet)
- Disk full, offline mid-download, very large files (>4 GB)
- Screen reader pass; window narrower than 800 px (minimum size enforced)
- Two app instances at once (second one just focuses the first)
