# Contributing

Pull requests are welcome. Everything in this repository is under the MIT
licence (see `LICENSE`), and every contribution is accepted under the same
terms: what comes in is licensed exactly as what goes out. There is no
contributor licence agreement to sign.

## Sign your commits

Every commit needs a Developer Certificate of Origin sign-off
(https://developercertificate.org, version 1.1): `git commit -s` adds the
`Signed-off-by: Your Name <you@example.com>` line. The sign-off says you
wrote the change, or have the right to submit it, under MIT. Pull requests
with unsigned commits are not merged.

The name in the sign-off is the name you go by on GitHub: a real name or a
consistent pseudonym, as long as it is yours and not misleading. Anonymous
sign-offs are not accepted. If you do not want your own email address in
the history, use GitHub's private no-reply address (Settings, Emails, "Keep
my email addresses private"). The sign-off, the name and the address become
part of this repository's public git history, are copied into every fork
and clone, and cannot be removed afterwards (Developer Certificate of
Origin 1.1, clause (d)). Decide what you put in before you sign.

### Keep your email address private

Before you open a pull request, turn on two settings on GitHub
(Settings, Emails): "Keep my email addresses private" and "Block command
line pushes that expose my email". Then commit and sign off with the
no-reply address GitHub shows there. Here is why. When a pull request is
squash-merged, GitHub writes the merge commit under the email address your
account uses for changes made on the website: your primary address, unless
"Keep my email addresses private" is on. The address you committed with
does not carry over. Git history is public, copied into every fork and
clone, and cannot be changed afterwards, so choose the address before you
open the pull request.

## Before you open a pull request

- Open an issue first for anything bigger than a small fix, so the shape is
  agreed before the work.
- One issue per pull request, and keep it small. A pull request that is
  readable in one pass gets merged; one that mixes concerns gets bounced
  with a `too-big` label.
- Add or update tests for the behaviour you change.
- Edit `src/main.js` and `src/styles.css`, never the root `main.js` or
  `styles.css`: those are built. Run `npm run build` and commit the result
  with your change; CI fails if the committed files differ from the build.
- Run the gate locally and paste its output into the pull request:
  `npm test`.
- Do not bump the version. Leave `manifest.json`, `package.json` and
  `versions.json` alone, and do not edit `CHANGELOG.md`: we bump the version
  and write the changelog at release, on our own cadence. A pull request
  that bumps the version is bounced.
- No new runtime dependency without an issue that agrees to it first.
- Say so in the description if the change touches credentials, a network
  host, a spawned process, a workflow file or a dependency. Those get a
  security read before the review.

## How a change ships

Contributors do not push to `main`; every outside change arrives as a pull
request. Merging a pull request ships nothing: releases are cut from a
version tag by the maintainer, never from a push to `main`, so your change
reaches members with the next tagged release.

## Where this project comes from

ReadOut is forked from the ICOR for Life SQLite Viewer by myICOR (MIT
licence; its authors are credited in `LICENSE`). A fix that also applies to
the original is welcome there too.

A project that forks ReadOut ships under its own plugin id and its own name,
never `readout` or "ReadOut": the MIT licence grants you the code, not the
listing and not the name. Do not use the marks named in `TRADEMARK.md` either.

## Security

For a security problem, use the process in `SECURITY.md` instead of a public
issue or pull request.
