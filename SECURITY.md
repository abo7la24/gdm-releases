# Security

## Reporting a problem

Open an issue on this repository and say **where in the code** the problem is and what it allows. Please do not publish a working exploit in the issue. If you would rather talk first, write that in the issue and say how to reach you.

## What is designed to hold

- The program listens only on `127.0.0.1`. A request needs a secret token; a request from a web page is refused; an add-on other than GDM's own must be approved by the user in a window.
- Updates and helper programs are accepted only if their SHA-256 matches the value published with them. A mismatch deletes the file.
- A link, a title or a file name is never put into a command line text: commands are lists of arguments.
- Only `http`/`https` links are accepted.

## Known weaknesses (today)

- The installer is unsigned. The checksum in `latest.json` protects against a damaged or swapped installer only as far as this repository itself is trusted. A code-signing certificate would close that gap.
- GDM's own add-on is recognised on Chrome-style browsers by its fixed id; any Firefox add-on is accepted without asking when "accept GDM's own add-on automatically" is on (Firefox gives each install a random address).
- Not audited by a third party.
