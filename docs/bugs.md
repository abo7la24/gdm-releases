# Bugs

| ID | sev | title | status |
| --- | --- | --- | --- |
| B1 | S3 | Main window had no page heading and the toolbar sat outside any landmark (screen reader users get no structure) | fixed: hidden h1, toolbar inside `<header>`; axe test now passes |
| B2 | S3 | A change could be lost on a hard kill: the save timer restarted on every change, so frequent changes delayed the write indefinitely | fixed in `main/store.cjs` (timer is no longer reset); e2e F01-E4 covers it |

## B1
Steps: run the axe scan on the main window. Expected: no violations. Actual: `page-has-heading-one`, `region`. Evidence: e2e A11Y-1 failure output.

## B2
Steps: add and pause a download, kill the app within 300 ms of the last change. Expected: row survives. Actual: downloads list empty after restart. Evidence: e2e F01-E4 failed with an empty list before the fix. Clean quits were never affected (they flush).

## To check (not reproduced)
- No automatic fewer-connections retry when a server rejects many connections (planned in architecture, not built).
- `Remove` with several rows selected removes without a confirm dialog.
- Browser extension behaviour in real Chrome/Edge.
