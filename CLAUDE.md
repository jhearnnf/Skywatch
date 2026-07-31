# Skywatch — working notes for Claude

## Browser screenshots

Screenshotting the app with headless Chrome has twice damaged the user's real
browser session. Both causes are listed below with the rule that prevents them.
Follow the template verbatim; do not improvise a shorter version.

### Rules

**1. Always pass `--user-data-dir` pointing at a throwaway directory inside the
session scratchpad.**

Without it, Chrome launches against the user's *real default profile* — signed
in, with their tabs. It then fights the running browser for the profile lock and
floods the terminal with `PHONE_REGISTRATION_ERROR` from
`gcm/registration_request.cc`. A dedicated profile directory keeps the headless
run completely isolated from the browser the user is actually using.

**2. Capture the PID with `-PassThru` and only ever `Stop-Process` that exact
PID. Never sweep by process name.**

In particular, **never run this** — it has already killed a live browser twice:

```powershell
# DESTRUCTIVE. DO NOT USE.
Get-Process chrome | Where-Object { $_.MainWindowTitle -eq '' } | Stop-Process -Force
```

Chrome is multi-process and **only the browser process has a window title**.
Every tab renderer, the GPU process, the network service and every utility
process reports an empty `MainWindowTitle`. That filter therefore selects ~23 of
24 processes — everything *except* the one you meant to leave alone — and
force-kills them, leaving the user's window open with every tab dead.

The same applies to `Stop-Process -Name chrome` and any other name-based match.
If a headless run needs cleaning up, kill its PID and nothing else:

```powershell
if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
```

If a stubborn child process survives, use a PID-scoped tree kill —
`taskkill /PID $($p.Id) /T /F` — never a name-scoped one. With a dedicated
`--user-data-dir` any straggler is isolated and harmless anyway.

**3. Redirect stderr so Chrome's log noise stays out of the terminal.**

Use `-RedirectStandardError` (or `2>$null`). Chrome writes registration, GPU and
sandbox warnings to stderr on every run; they are not errors and they bury real
output.

Also pass `--disable-background-networking`, which stops the
`PHONE_REGISTRATION_ERROR` / `DEPRECATED_ENDPOINT` noise *at source* rather than
just hiding it — a screenshot run has no business talking to Google's push
service, and without the flag Chrome retries it for the life of the process.

### Template

Copy this as-is, changing only the URL, the window size and the output filename.

```powershell
$scratch = "<your session scratchpad dir>"
$profile = Join-Path $scratch "chrome-profile"
$shot    = Join-Path $scratch "shot.png"
New-Item -ItemType Directory -Force -Path $profile | Out-Null

$p = Start-Process -FilePath "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  -ArgumentList '--headless','--disable-gpu','--hide-scrollbars',
                '--no-first-run','--no-default-browser-check',
                '--disable-background-networking','--disable-extensions',
                '--disable-component-update','--disable-sync',
                "--user-data-dir=$profile",
                '--window-size=1440,2400',
                '--virtual-time-budget=10000',
                "--screenshot=$shot",
                'http://localhost:5173/' `
  -PassThru -RedirectStandardError (Join-Path $profile "stderr.log")

$p | Wait-Process -Timeout 180 -ErrorAction SilentlyContinue
if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
Test-Path $shot
```

Notes on the flags:

- `--disable-extensions`, `--disable-component-update` and `--disable-sync` skip
  the first-run setup a brand-new profile would otherwise do. Without them the
  run spends its first minute unpacking component extensions and failing to hash
  them, and produces no screenshot at all before the timeout.
- `--virtual-time-budget` waits for async work (data fetches, chart rendering)
  before the capture. Raise it if a screenshot comes back with empty panels.
- `--window-size` sets the captured viewport. A tall value (e.g. `1440,9000`)
  captures a long page in one shot; crop afterwards with `System.Drawing` rather
  than re-running Chrome.
- Chrome may write the PNG *after* the process returns. If `Test-Path` is false,
  wait briefly and check again before assuming failure.

**Expect this to be slow on the landing page.** `/` mounts nine live CBAT games,
several of them WebGL, and `--disable-gpu` renders them in software — a verified
run took 86 seconds. Hence the 180s timeout; 90s was not enough. Other routes
return in a few seconds.

### Verifying a screenshot did no harm

The user's browser must be untouched afterwards. Before and after the run:

```powershell
(Get-Process chrome -ErrorAction SilentlyContinue).Count
```

The count must return to its starting value, and any process with a non-empty
`MainWindowTitle` must still be alive. Never "clean up" a mismatch by killing
processes you did not start.
