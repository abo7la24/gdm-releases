# Architecture: GDM (own version of a download manager)

Reads: `recon.md`, `features.csv`. Schema: `schema.sql`.

## Stack

Desktop app, so the web defaults (Next, Supabase, Stripe, Vercel) are dropped: no accounts, no payments, no server.

| layer | choice | why |
| --- | --- | --- |
| shell | Electron + TypeScript | chosen by user; tray, notifications, installer |
| UI | React + Vite (renderer), Tailwind with tokens from replica-design | fast to build the table and dialogs |
| engine | Node in the main process (`undici` or built-in `fetch` with Range headers, `fs` write streams) | no native deps, easy to test |
| database | SQLite via `better-sqlite3` | one file, survives restarts, zero setup |
| IPC | Electron `ipcMain`/`contextBridge` | renderer never touches Node directly |
| browser bridge | local HTTP server on 127.0.0.1 (random port + token) in the main process | simpler than native messaging for a personal tool |
| extension | Manifest V3 (Chrome/Edge), same code for Firefox | `downloads` + `webRequest` APIs |
| packaging | `electron-builder` (NSIS installer) | your own installer |
| tests | Vitest for engine, a local test HTTP server with Range support | the engine is the risk |

One process owns all state. No microservices.

## Schema

See `schema.sql`: 4 tables (downloads, segments, settings, media_items). Access rules: single local user, so no RLS; the main process is the only writer, the renderer gets data through IPC only. Status fields use check constraints. Deleting a download cascades to its segments.

## API

Internal IPC (renderer to main) and the local bridge (extension to main). No external APIs, no private endpoints of the original.

| method / channel | what it does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| ipc `downloads:add` | validate URL, HEAD probe, create row, start | renderer | url, saveDir?, fileName?, headers? | Download | F01 |
| ipc `downloads:list` | list with filter/sort | renderer | status?, query? | Download[] | F01 |
| ipc `downloads:pause` / `resume` / `cancel` / `retry` | state change | renderer | id | Download | F04 |
| ipc `downloads:remove` | delete row, optionally file | renderer | id, deleteFile | ok | F01 |
| ipc `downloads:openFile` / `openFolder` | shell open | renderer | id | ok | F01 |
| ipc `settings:get` / `set` | read/write settings | renderer | key, value | Setting | F05 |
| event `downloads:progress` | throttled (4/s) progress push | main to renderer | id, bytes, speed | | F01 |
| POST `/v1/capture` | extension hands over a link | extension | url, referer, cookies, filename | `{id}` | F02 |
| POST `/v1/media` | extension reports found media | extension | page_url, items[] | ok | F03 |
| GET `/v1/status` | is the app alive, capture on/off | extension | token | `{capture:bool}` | F02 |

Bridge rules: bind to 127.0.0.1 only, require the shared token in a header, reject requests with a browser `Origin` other than the installed extension's.

Background jobs: queue scheduler (start next queued when slots free, runs on events not a timer); speed limiter (token bucket); crash recovery on launch (rows left in `downloading` become `paused`).

## The parts that bite

- **Range support:** probe with `HEAD` then `Range: bytes=0-0`. No `Accept-Ranges` or no size means single connection and not resumable. Say so in the UI.
- **Segment assembly:** write each segment to its own offset in one pre-allocated temp file; persist segment progress every ~1 s so a crash loses little.
- **Resume validity:** on resume compare `etag`/`last_modified`; if changed, restart instead of corrupting.
- **Rate limiting servers:** many hosts reject 8 connections (429/403). Back off to fewer connections automatically.
- **Redirects and file names:** follow redirects, take name from `Content-Disposition`, then URL path; resolve collisions with `(1)` suffix.
- **Cookies/referrer:** the extension must forward them for logged-in downloads. Treat as secrets, store only for the life of the download, never log them.
- **Security of the bridge:** any local web page can hit localhost. Token plus Origin check is mandatory.
- **Disk full / permission denied:** fail the one download with a clear message, never crash.
- **Windows paths:** reserved names, 260-char limit, illegal characters in file names.
- **Speed limit:** global token bucket shared by all segments.
- **Media:** HLS/DASH needs playlist parsing and muxing (ffmpeg binary); mark DRM streams unsupported.
- **Idempotency:** the extension may send the same capture twice; dedupe on url within 5 s.

## Build order

1. **Vertical slice (M1):** screens S01, S02, S03. Tables downloads, segments. Add URL, probe, segmented download, progress, finish. Proves the engine.
2. **Must-haves (M2):** pause/resume incl. restart recovery, list sort/filter, open file/folder/delete, retry, settings S04 (connections, dirs), Chrome/Edge extension capture with bridge (S08, `/v1/capture`).
3. **Should-haves (M3):** queue with parallel limit, speed limit, history S07, tray S06, notifications, cookies/referrer forwarding, capture file-type filter, media popup S05 + `/v1/media` (direct video/audio URLs).
4. **Could-haves (M4):** clipboard detection, drag and drop, categories, start with Windows, Firefox build, HLS/DASH.
5. **Fixes** from `/replica-entrepreneur` and `/replica-diff`.

## Summary

Stack: Electron + React + TypeScript, SQLite, local HTTP bridge, MV3 extension. 4 tables, 10 routes/channels. Riskiest: segmented download with crash-safe resume; extension-to-app bridge security; HLS/DASH media grabbing. Next: `/replica-design`.
