# JP-4A Round 5B.3 HF3-HF4 — XR support probe truth and emulated entry truth

Phase: `ROUND5B3_HF3_HF4_XR_SUPPORT_AND_EMULATED_ENTRY_TRUTH_CORRECTION`

This slice makes the JP-4A diagnostic actually reachable and makes its
"VR ACTIVE" claim true. It does **not** prove black artifact, black membrane,
FPS, FOCUS hitch, stereo, menu, Quest PASS, or JP-4A PASS.

The prior `APPROVE_FOR_SINGLE_QUEST_JP4A_ROUND5B3_DIAGNOSTIC_RETRY` on
`b4ee8e0` is **SUPERSEDED** by the runtime evidence below. READY status is not
preserved merely because the earlier software review passed.

## Provenance (OPTION A)

| Role | SHA |
|---|---|
| Previous independently reviewed HF3-HF3 implementation-under-test | `f92ca7554f9360949130e23f6ebf32458a5045ac` |
| Previous independently reviewed HF3-HF3 evidence / PR HEAD | `b4ee8e033fc2ad03ef1c0522d007560716f778de` |
| Implementation A (source + tests + new harness) | `d07eda1c196a5a64aa4c119ba61a4459d06cba9f` |
| Implementation A2 — **implementation-under-test** | `90123177d7aeeaed9d914404df9910cc93a4233c` |
| Evidence/documentation commit (B) | the commit that added this file |

`A2` changes only `tools/jp4a-round5b3-hf3-hf3-harness.mjs`; `git diff A A2 --
src tests package.json` is empty. Every gate below was executed against
committed `A2`, and the built-in IWER evidence file records
`implementationTestedHead = 90123177d7aeeaed9d914404df9910cc93a4233c`, which
the harness reads from the git-injected build identity — not from this
document. This evidence file does not prove its own commit SHA. Historical
HF3-HF3 / HF3-HF2 / HF3-HF1 / HF3 evidence files are not overwritten.

## User-supplied runtime evidence that superseded the previous approval

Both observations are **USER_SUPPLIED**, not model-generated, and neither is a
visual finding.

### Observation A — Quest 3, on `b4ee8e0`

| Field | Value |
|---|---|
| `QUEST_HARDWARE` | `ATTEMPTED_BUT_DIAGNOSTIC_NOT_STARTED` |
| `reason` | `XR_SUPPORT_CHECK_STALLED` |
| `ROUND5B3_VISUAL_DIAGNOSTIC` | `NOT_EXECUTED` |

`/xr-test/jp4a` stayed on `Checking XR support...` for an abnormally long
time. The diagnostic could not practically proceed.

### Observation B — desktop Chrome + external Immersive Web Emulator

| Field | Value |
|---|---|
| `DESKTOP_EMULATED_DIAGNOSTIC` | `ENTRY_NOT_USABLE` |

The same support check was very slow but eventually reached READY. ENTER VR
changed the console to `VR ACTIVE`, yet no usable visible VR/emulated VR space
appeared.

### Observation C — copied JP-4A state from that attempt

`sourceHead: b4ee8e0`, and:

| Field | Value |
|---|---|
| `xrStartedAt` | `null` |
| `completedAt` | `null` |
| `active` | `true` |
| `testPhase` | `BASELINE` |
| `lockedPoster` | `null` |
| `bankInvariant` | `null` |
| `samples` | `[]` |
| `events` | `session_reset`, `test_started` only — **no `xr_started`** |
| LIVE modes | all `UNKNOWN` |

This proves the intended diagnostic was never established. It is **not** a
black-artifact result, an FPS result, a FOCUS result, a Quest visual FAIL, or a
JP-4A PASS/FAIL. The `UNKNOWN` LIVE verdicts are not visual findings.

## Root cause 1 — the support probe could hang, and lied about when it ran

`probeImmersiveVrSupported()` was:

```ts
return !!(await xr.isSessionSupported('immersive-vr'));
```

inside a `try/catch`, with **no timeout**. `isSessionSupported()` has no
specified upper bound, so a runtime that leaves it pending leaves JP-4A on
`Checking XR support...` forever.

Separately, the JP-4A console is installed at application startup
(`src/main.ts:14`) while the probe was owned by `wireXrEntry` → `scene.probeXr()`
→ `XrRuntime.probe()`, i.e. by StoreScene construction. So the console
displayed `Checking XR support...` during ordinary boot, **before any probe had
started**. Two separate defects; both fixed.

### Old support-probe lifecycle

```
main() → boot → login/catalog → fonts → quality calibration
       → StoreScene construction → wireXrEntry → scene.probeXr()
       → XrRuntime.probe() → probeImmersiveVrSupported()  [unbounded await]
```

Console said `Checking XR support...` for that entire span.

### New support-probe lifecycle

```
main()
  → await installXrEmulatorIfRequested()        // IWER may inject navigator.xr
  → ensureXrSupportProbe({ isTauri })           // starts HERE, fire-and-forget
  → (login / catalog / fonts / quality / StoreScene / textures … )
```

`src/xr/xr-support-probe.ts` owns one shared, single-flight, cached probe.
A StoreScene rebuild joins the cached flight; it never restarts it.

| Property | Value |
|---|---|
| Soft timeout | **1500 ms** (`XR_SUPPORT_SOFT_TIMEOUT_MS`) |
| Hard clamp for any caller | **2000 ms** (`XR_SUPPORT_MAX_SOFT_TIMEOUT_MS`) |
| States | `NOT_STARTED` / `PROBING` / `SUPPORTED` / `UNSUPPORTED` / `TIMED_OUT` / `ERROR` |
| Diagnostics | `probeStartedAt`, `probeSettledAt`, `elapsedMs`, `softTimeoutMs`, `lateResult`, `lateSettledAt`, `lateElapsedMs`, `reason`, `error`, `invoked` |

`TIMED_OUT` and `ERROR` are **not** `UNSUPPORTED`. `xrSupportedOrNull()` maps
both to `null` ("no answer"), never to `false`. A late answer is recorded as
`lateResult`; a late `true` is promoted to `SUPPORTED`. The underlying promise
always has both handlers attached, so a late resolution or rejection can never
become an unhandled rejection and can never start a second probe.

### Console wording is now gated on the real API call

| Support state | Console text |
|---|---|
| `NOT_STARTED` | `Preparing XR runtime…` |
| `PROBING` | `Checking XR support…` |
| `UNSUPPORTED` | `Immersive VR unavailable` |
| `TIMED_OUT` / `ERROR` (prereqs met) | `XR CHECK SLOW — READY TO TRY VR` |
| scene absent | `WAITING FOR STORE…` |
| store not visually ready | `Store is still loading…` |

App boot time is no longer labelled as XR support checking.

### Diagnostic fast path after timeout

On the JP-4A route only, when the probe `TIMED_OUT`/`ERROR`ed **and** a
StoreScene exists **and** store visual readiness is satisfied **and**
`navigator.xr.requestSession` is callable, the console offers **TRY ENTER VR**.
`requestSession('immersive-vr', …)` is then the authoritative attempt; a
rejection surfaces as a structured `ENTRY_FAILED` with the real error string.
Support is never reported as `true` on this path
(`XrRuntime.canEnter(allowUnverifiedSupport)` checks the probe state and
`requestSession` availability separately from `immersiveVrSupported`).

Production stays conservative: only an actual `true` from `isSessionSupported`
lights up the production Enter VR buttons, and `main.ts` never passes
`allowUnverifiedSupport`. If the soft-timed-out promise later answers `true`,
`wireXrEntry`'s subscription lights the production button up then.

## Root cause 2 — `VR ACTIVE` was not authoritative

Readiness derived `PRESENTING` from `scene.xr.presenting` alone, so the
operator saw `VR ACTIVE` while the session had `xrStartedAt = null`, `samples
= []` and no `xr_started` event.

### Old VR ACTIVE predicate

```
presenting = !!scene?.xr?.presenting
if (presenting) return 'PRESENTING'   // → "VR ACTIVE"
```

### New authoritative VR ACTIVE predicate

```
presenting && jp4aXrEntryConfirmed(session)

jp4aXrEntryConfirmed(s) =
     s.active
  && s.xrStartedAt != null
  && s.events.some(e => e.type === 'xr_started')
```

Both facts are emitted by `markJp4aXrStarted()` inside `XrRuntime.enter()`,
**after** `requestSession` resolved and Three's `setSession` resolved.
`markJp4aXrStarted()` was **not** moved earlier to make the UI pass.

`presenting === true` with `xrStartedAt === null` now renders
**`VR ENTRY NOT CONFIRMED`**, never `VR ACTIVE`. This is covered by a
deterministic regression fixture built from the user's copied state
(`HF3-HF4 Q`).

### Entry actions can no longer succeed vacuously

| Situation | Before | After |
|---|---|---|
| `scene.xr` absent | `await scene.xr?.enter()` resolved silently | throws `XR_RUNTIME_NOT_READY` |
| `enterXr()` resolves, runtime not presenting | `{ ok: true, action: 'entered' }` | `{ ok: false, reason: 'SESSION_NOT_PRESENTING' }` |

## Root cause 3 — the console covered the emulated XR view

The console is a fixed full-screen overlay at `z-index:10000` with a nearly
opaque background, and it stayed open after entry.

Worse, hiding it never actually worked: the root carries an inline
`display:flex`, which **beats** the user-agent `[hidden] { display: none }`
rule. Setting `root.hidden = true` left the opaque overlay on screen. The
HF3-HF4 browser gate caught this with `document.elementFromPoint` at the canvas
centre — it returned a `<p>` inside the console, not the canvas.

Now `hideConsole()`/`showConsole()` toggle `display` as well, and:

- confirmed XR entry **auto-hides** the console and shows the compact
  `JP-4A TEST` reopen button;
- a failed **or unconfirmed** entry leaves the console and its failure reason
  visible;
- XR exit / completion brings the console back automatically, with
  COPY RESULT / COPY JSON immediately available.

## START flow

`START` no longer hides the console. The operator stays on it, readiness
updates live, and ENTER VR / TRY ENTER VR becomes usable in place.
`CONTINUE TO STORE` remains as an optional operator action, and the compact
reopen button still restores the console.

## Environment classification

Pre-entry classification was `QUEST_HARDWARE_PENDING` for anything on the JP-4A
route without `?xrEmu=1`, which is how a desktop run got labelled Quest.

| Signal | Classification |
|---|---|
| built-in `?xrEmu=1`, or an active IWER | `IWER_EMULATED` |
| Quest / OculusBrowser UA | `QUEST_HARDWARE_PENDING` |
| anything else, incl. desktop + external Immersive Web Emulator | `DESKTOP_BROWSER` |

An external Immersive Web Emulator extension is not reliably distinguishable
from a plain desktop browser, so `DESKTOP_BROWSER` is used — a false Quest
classification is worse than an under-claim. After confirmed entry, the
runtime's own evidence class (`XrRuntime.classify()`) overrides this.

## Separated timing buckets — no 240 s support acceptance

A JP-4A session now carries `timings`, and the browser gate reports the same
buckets independently:

| Bucket | Meaning | Gate |
|---|---|---|
| `supportProbeMs` | `isSessionSupported()` wall time, or the soft timeout that bounded it | **strict, ≤ 2000 ms** |
| `storeReadyMs` | store visual readiness | large, independent, reported separately |
| `enterActionMs` | ENTER VR click → action result | reported |
| `requestSessionMs` | `requestSession` start → end | reported |
| `setSessionMs` | Three `setSession` start → end | reported |
| `firstWorldRenderMs` | `requestSession` start → first world frame | must be non-null |

No code path and no browser test uses a 240-second deadline as proof that
`Checking XR support...` works. The store readiness wait keeps its own larger
bound and is displayed as `Store is still loading…`, never as XR support
checking. `tests/jp4a-round5b3-hf3-hf4.test.ts` fails the build if a
240 s constant appears in the harness's support section or in the probe module.

## Built-in IWER gate — `npm run test:jp4a-round5b3-hf3-hf4`

Classification: `IWER_EMULATED` / `BROWSER_AUTOMATION`.
`NOT_HARDWARE_VISUAL_PROOF`. It does not prove Quest activation or Quest
visuals.

Input is trusted Puppeteer `page.click()` on the real selectors — not
`page.evaluate(() => btn.click())` — for START, ENTER VR, COPY RESULT,
COPY JSON and RESET. `window.__xrTest.enter()` is never used to enter;
`window.__xrTest.exit()` is used only to end a session.

Measured on `A2` (`docs/review/jp4a/jp4a-round5b3-hf3-hf4-iwer.json`):

| Field | Value |
|---|---|
| `supportGate.state` | `SUPPORTED` (`API_TRUE`, `invoked: true`) |
| `supportProbeMs` | **1 ms** (bound 2000 ms) |
| `checkingOnlyWhileProbing` | `true` |
| `started.consoleHidden` | `false` — START keeps the console up |
| `started.hasEnterWithoutReopen` | `true` — no reopen step |
| `started.environment` | `IWER_EMULATED` |
| `entered.xrStartedAt` | non-null |
| `entered.xrStartedEvent` | `true` |
| `entered.firstWorldRender` | `true` |
| `entered.presenting` | `true` |
| `overlay.consoleHidden` / `consoleDisplay` | `true` / `none` |
| `overlay.centerElement` | `CANVAS` |
| `overlay.occludedBy` | `null` |
| `overlay.canvasUnobstructed` | `true` |
| `telemetry.samples` | `4` (> 0) |
| `invariant.checkedSlots` | `3692`, verdict `PASS` (non-vacuous) |
| `afterExit.consoleVisible` | `true` |
| `copies` | `COPIED RESULT` / `COPIED JSON` |
| `secondEntered.xrStartedAt` | non-null, new session id |
| `storeReadyMs` | ~133.8 s — reported separately, never as support time |
| `requestSessionMs` / `setSessionMs` / `firstWorldRenderMs` | 1.9 / 1.2 / 1810.4 ms |
| `normalControl` | console + reopen + live control absent; production Enter VR present |

The gate fails if the probe stays pending past its bound, if `VR ACTIVE`
appears without `xrStartedAt`, if the real ENTER VR route is bypassed, if
`firstWorldRender` never occurs, if the console still covers the canvas after
confirmed entry, if samples stay empty, if the bank invariant is null or a
zero-slot vacuous PASS, or if the normal URL becomes contaminated.

## Preserved corrections

| Round | Guarantee | Status |
|---|---|---|
| HF3-HF3 | no synthetic production-button `.click()` forwarding | preserved |
| HF3-HF3 | direct JP-4A action bridge, structured entry failures, copy feedback | preserved |
| HF3-HF2 | no app `await` before Three `setSession` listener installation; Three owns `makeXRCompatible` | preserved |
| HF3-HF1 | `connected` event owns object handedness; `disconnect` clears it; no `inputSources[i]` association | preserved |
| HF3 | controller source fidelity; ambiguous simultaneous press fails closed; no opposite-ray fallback | preserved |
| HF2 | first TAP = LOCK ONLY; TAP after lock = verdict; HOLD = approach/focus; HOLD never mutates a verdict | preserved |
| HF2 | FOCUS production select exactly once | preserved |
| Round 5B.3 | 12 m diagnostic reach / 14 ft production reach | preserved |
| Round 5B.3 | LIVE shader modes, FOCUS upload implementation, non-vacuous bank invariant | preserved |

## Pre-existing harness failures (not caused by this change, not fixed here)

Two broad XR harnesses outside the HF3-HF3 validation set fail. To determine
whether HF3-HF4 caused them, each was run in a detached worktree at the
previously reviewed HEAD `b4ee8e0` and compared against `A2`. The failure sets
are identical, so these are pre-existing and out of scope for this correction.
They are surfaced here rather than left silent, and they are **not** claimed as
passing.

| Harness | Baseline `b4ee8e0` | `A2` `9012317` | Regression from HF3-HF4 |
|---|---|---|---|
| `npm run test:xr-emu` | 3 failures: `JP4A_ROUND5A1_XR`, `JP4A_ROUND5A2_XR`, `JP4A_ROUND5B2_XR` | same 3 | no |
| `npm run test:xr-resource` | 1 failure: `JP4A_UPLOAD_POLICY` | same 1 | no |

All other scenarios in both harnesses pass at `A2`, including `CORE_XR`,
`FULL_XR`, `JP4A_UI`, `JP4A_NORMAL_STABLE_STORE`, `BOOT_PERF`,
`JP4A_REAL_GPU_MULTIBANK`, `JP4A_PRELOAD_STABILITY`, `JP4A_FOCUS_QUALITY`,
`JP4A_UPLOAD_ADMISSION` and `JP4A_PRODUCTION_MULTIBANK`.

## Hardware status

| Field | Value |
|---|---|
| `QUEST_HARDWARE` | `ATTEMPTED_BUT_DIAGNOSTIC_NOT_STARTED` |
| `reason` | `XR_SUPPORT_CHECK_STALLED` |
| `NEW_QUEST_RUN_AFTER_HF4` | `NOT_EXECUTED` |
| `JP4A_PASS` | `NOT CLAIMED` |
| `QUEST_PASS` | `NOT CLAIMED` |

No new Quest run was required to prove this software correction, and none was
performed.

## Next step

Independent software review of: support probe timing, the never-resolving
support fake, the actual browser ENTER VR path, `xrStartedAt` / `xr_started`
truth, non-empty samples, the non-vacuous bank invariant, the visible desktop
IWER render, and exact-head CI/provenance.

Only after that approval should exactly one fresh Quest 3 Round 5B.3
diagnostic be attempted. Do not start JP-4B. Do not merge.
