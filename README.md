# GDM (Genius Download Manager)

A download manager for Windows: several connections per file, pause and resume that survives a restart, a browser add-on for Chrome, Edge, Brave and Firefox, video and audio from web pages (any quality, or audio only), automatic updates, and English, Arabic and French.

**This repository is public on purpose: you can read every line of the program before you run it.** Nothing here asks you to trust a promise, so below is exactly what the program does on your computer and how to check each claim.

> العربية في آخر الصفحة.

## Download

Latest installer: [`GDM-Setup-0.1.0.exe`](GDM-Setup-0.1.0.exe) (its published SHA-256 is in [`latest.json`](latest.json)).

The installer is **not code-signed**, so Windows SmartScreen will say "unknown publisher". That is expected until a signing certificate is bought. Before you run it, check that your copy is the one published here (PowerShell):

```powershell
(Get-FileHash .\GDM-Setup-0.1.0.exe -Algorithm SHA256).Hash.ToLower()
```

The result must equal the `sha256` in `latest.json`. The program itself checks the same value before it installs any update.

## What the program does on your computer

| It does | To what | Check it in |
| --- | --- | --- |
| Downloads the links you give it (or that your browser add-on sends) | the address you chose, nothing else | `app/main/engine.cjs` |
| Listens on `127.0.0.1:17689` for the browser add-on | this computer only; needs a secret token; refuses web pages; a new add-on needs your approval (GDM's own add-on is recognised by its fixed id) | `app/main/bridge.cjs`, `app/main/trust.cjs` |
| Looks for updates | `https://raw.githubusercontent.com/abo7la24/gdm-releases/main/latest.json`, every day; downloads the installer, checks its SHA-256, installs when you close the program | `app/main/updater.cjs` |
| Fetches the video helper (yt-dlp) and the conversion helper (ffmpeg), only when you first ask for a video | the official release pages on github.com/yt-dlp; each file is checked against the checksum published with the release and thrown away if it differs | `app/main/tools.cjs`, `app/main/media.cjs` |
| Stores its settings and download list | `%APPDATA%\gdm` (a JSON file) and your downloads folder | `app/main/store.cjs` |

It has **no accounts, no analytics, no telemetry and no advertising**, and it sends nothing about you anywhere. You can confirm that by searching the code for network calls (`grep -rn "fetch(" app/main app/extension`): `engine.cjs` (your links), `tools.cjs` and `updater.cjs` (checked helpers and updates), `main.cjs` (the small preview picture of a video, from the video's own site), and the add-on's calls to `127.0.0.1`. When you ask for a video, yt-dlp itself talks to that video's site, as a browser would.

**The browser add-on** (`app/extension/`) asks for: `downloads` (to take over downloads you choose), `cookies` (sent only to the GDM program on your own computer, so logged-in downloads work), `webRequest` (to list the videos on a page), `storage`, `tabs`, `alarms` (to reconnect when GDM starts later) and access to all sites (it needs to see the download links on any page). Its whole code is four small files.

## Read the important parts first

- `app/main/bridge.cjs`: the only door from the browser to the program (origin check, token, one-time approval).
- `app/main/updater.cjs`: how updates are fetched and verified. A wrong checksum, a bad file, or an installer outside its folder is refused.
- `app/main/media.cjs`: the command given to yt-dlp is a list of arguments, with the link after `--`, so a title or link cannot become a command.
- `app/extension/background.js`: everything the add-on does.

## Build it yourself and test it

```powershell
cd app
npm install
npm test          # 97 unit tests
npm run e2e       # 90 end-to-end tests that drive the real app
npm run dist      # builds the installer into release/
```

Builds are not bit-for-bit reproducible, so your installer will not have the same hash as the one published here; compare behaviour (run the tests) rather than the hash. Some tests start a real Chromium (see `app/e2e/extension.spec.mjs`; it looks for a copy in `app/.chromium`, or uses `npx playwright install chromium`).

## Honest limits

- Not code-signed, and not audited by a third party. Reading and running the tests is the check available today.
- Video downloads were tested with a stand-in for yt-dlp, not yet against real sites. DRM-protected video is not supported and nothing here bypasses it.
- The Firefox add-on is built but has not been tried in a real Firefox. Firefox only keeps unsigned add-ons until it closes.
- Please respect each site's terms and copyright when you save videos.

## Folders

- `app/`: the program, its browser add-on, tests and scripts.
- `docs/`: architecture, test plan, build notes and design tokens.
- `latest.json` and the installer: what the updater reads.

## Third-party software

Electron, React, lucide-react and the test tools are open source (MIT/ISC). yt-dlp (Unlicense) and ffmpeg (LGPL build) are **not included**; they are fetched on first use from their own release pages. GDM's own code is released under the [MIT License](LICENSE): you may use, change and share it, keeping the notice.

## Found a problem?

Open an issue on this repository. Please do not post a working exploit; describe where in the code it is. See [SECURITY.md](SECURITY.md).

---

## بالعربية

**GDM (Genius Download Manager)** مدير تنزيل لويندوز: عدة اتصالات للملف الواحد، وإيقاف مؤقت واستئناف يصمد بعد إعادة التشغيل، وإضافة لمتصفحات Chrome وEdge وBrave وFirefox، وتنزيل الفيديو أو الصوت من صفحات الويب بأي جودة، وتحديث تلقائي، وبثلاث لغات: العربية والإنجليزية والفرنسية.

هذا المستودع **عام عمداً** لتقرأ كل سطر من البرنامج قبل تشغيله. ملخص ما يفعله على جهازك:
- ينزّل الروابط التي تعطيه إياها فقط، ويستمع على `127.0.0.1` فقط لإضافة المتصفح (برمز سري، ويرفض صفحات الويب).
- يبحث عن التحديثات من عنوان واحد في هذا المستودع ويتحقق من بصمة SHA-256 قبل أي تثبيت.
- يجلب أداتي الفيديو (yt-dlp) والتحويل (ffmpeg) من صفحاتهما الرسمية عند أول طلب فقط، بعد مطابقة البصمة المنشورة.
- لا حسابات ولا تتبع ولا إعلانات ولا إرسال أي بيانات عنك.

الترخيص: شيفرة GDM بترخيص MIT (ملف `LICENSE`).

للتحقق من المثبّت الذي نزّلته:
```powershell
(Get-FileHash .\GDM-Setup-0.1.0.exe -Algorithm SHA256).Hash.ToLower()
```
يجب أن يساوي حقل `sha256` في `latest.json`.

**حدود صريحة:** المثبّت غير موقّع (سيحذّرك ويندوز "ناشر غير معروف")، ولم يراجعه طرف ثالث بعد، وتنزيل الفيديو جُرّب بأداة محاكية لا بمواقع حقيقية، وإضافة Firefox لم تُجرَّب في Firefox حقيقي. الأدلة المتاحة اليوم هي قراءة الشيفرة وتشغيل الاختبارات (`npm test` و`npm run e2e` داخل مجلد `app`).
