# Deploy: GDM (Genius Download Manager)

Renamed from Fetchwise on 2026-11-21 and rebuilt; tests rerun (15 unit, 22 end-to-end, all pass). The build now runs from a short path, so the installer step works directly.

Date: 2026-11-21. GDM is a Windows desktop app plus a browser extension, for personal use. There is no server, database, domain, Stripe or email, so "deploy" means building and installing your own copy. **Nothing has been published, installed or signed in anywhere.**

## Preflight (run 2026-11-21)

| check | result |
| --- | --- |
| Unit and integration tests (Vitest) | 15 passed |
| End-to-end tests (Playwright: the app and the extension in real Chromium) | 22 passed |
| Feature parity | 82.7 / 100, must-haves 10 of 10 |
| Brand sweep (name, domain) | clean |
| Listing check | 0 errors, 0 warnings |
| Type check | ok |
| Production build | passes |
| Open S1 or S2 bugs | none (B1, B2 fixed; see `bugs.md`) |

## The build

- **Installer:** `swiftdm/release/Genius Download Manager Setup 0.1.0.exe`, 70.8 MB, SHA-256 `7143045ab9651f79ad172c2348f45e1aa712ad5685e9f3c4aab6079f87de3075`. Not installed or run by me; the unpacked copy beside it (`release/win-unpacked/Genius Download Manager.exe`) launched and drew the window.
- **Not signed.** Windows SmartScreen will warn ("unknown publisher") the first time. Fine for yourself; a code-signing certificate is needed to remove it before sharing.
- Two build snags, fixed: the packager wrote into the same `dist` folder as the web build (now `release/`), and the installer step failed because this project's folder path is too long for NSIS. It worked from a short drive letter (`subst X:`). **After you rename the folder to `gdm/` and move it somewhere short, e.g. `C:\dev\gdm`, `npm run dist` works directly.**
- The logo (a squarish letter G on violet, drawn by `assets/make-icon.cjs`) is in the setup file icon, the app exe, the uninstaller, the wizard header and sidebar images, and the desktop and Start menu shortcuts. The installer wizard itself was not run.

## What the user does

1. Move the project to a short path, rename it to `gdm`, run `npm install` there, then `npm run dist`. (Or use the installer already built.)
2. Run the installer. Check on screen: the tray icon and menu, and a desktop notification when a download finishes. These are the two features never seen working.
3. Add the browser add-on (now guided inside the app: **Add to browser** button, or the blue reminder bar). Manually: in Chrome or Edge open the extensions page, switch on developer mode, "Load unpacked", pick `extension/`. Click the extension icon, press **Connect to GDM**, and choose **Allow** in the GDM window. No token copying needed (the manual way is still under "Connect by hand instead").
4. Try a real download from a site you use, one image (should stay with the browser) and one video on a page.

## Not applicable here

- Production database, env vars, Stripe, OAuth, email DNS, domain and hosting: the app has none. The landing page (`swiftdm/landing/index.html`) is static; host it anywhere (GitHub Pages, Netlify) only if you decide to share, and only with the user's go.
- Privacy policy and terms pages, cookie banner, account deletion: no accounts and no cookies on the site. A privacy note is still needed before a store listing (see `launch-plan.md`).
- Mobile: there is no mobile app.

## Watch in the first week

- Updates: there is no auto-update. Reinstall to upgrade; settings and downloads are kept in the app's data folder.
- Whether the add-on takes anything it should not (YouTube pages, tiny background files). Those are the three promised fixes: minimum size, pause for a site, ask first.
- Whether it works on the sites you use. If one fails, the browser keeps the download; note the site.
- Antivirus: an unsigned installer or the app listening on port 17689 may be flagged by some tools.
- Errors are only visible in the app (no crash reporting is built, by design).

## Still open before sharing it with anyone

Trademark searches, replacing the placeholder icon and comparing it to the original's logo, a code-signing certificate, Edge and Firefox testing, the unchecked dark-mode contrast on the landing page, and the three promised fixes.
