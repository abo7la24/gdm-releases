# Launch plan: GDM

Audience: you (personal use). This plan is the short version; the full version below only applies if you decide to share it.

## Now (personal use)

1. Rename the `swiftdm/` folder to `gdm/`.
2. Run `npm run dist` inside it to build your own Windows installer (not run yet), install it, and check the tray menu and notifications on screen.
3. Load `extension/` in your own Chrome or Edge ("Load unpacked"), click the extension icon, press Connect to GDM, and choose Allow in the app.
4. Use it for two weeks and note what annoys you. That list beats any research here.

## If you share it

Evidence for the angle is thin (15 reviews, 2 sources, see `fixes.md`), so test it before building more.

- **Before launch:** build the three promised fixes (minimum size, pause for a site, ask first). Get trademark searches done (see `brand.md`). Replace the placeholder icon.
- **Distribution:** a GitHub release with the installer, plus the extension on the Chrome Web Store (about a week of review, needs a developer account the user creates). The Store listing needs the privacy statement: everything stays on the computer; the extension reads cookies only to pass them to the local app for logged-in downloads.
- **Where people talk:** the threads that came up in research: AlternativeTo, the Chrome Web Store review page of the original, and MalwareTips-style "IDM alternative" threads. Reddit was not reachable during research, search it by hand. Reply as a person, not an ad, and do not name or disparage the original in your listing.
- **Announcement:** a Hacker News "Show HN" that leads with the fix: a download manager whose browser add-on only takes what you allow.
- **First 10 users:** ask them to try it for a week and tell you which downloads it took that it should not have. Only use their words in public with their permission.
- **Before any public post:** analytics are not built in (the app sends nothing anywhere). Decide if you want opt-in crash reports.

Store listing text is in `listing.json`. It is shaped for App Store and Play fields because the checker uses them; GDM is a Windows app with a browser extension, so the real targets are the Chrome Web Store and optionally the Microsoft Store.
