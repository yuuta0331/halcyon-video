# JP-4A Round 5A.2 — real Quest 3 hardware result (canonical)

**SHA tested:** `216483fac1e77654e005bfc1be6de143c0599318`

**QUEST_HARDWARE = FAILED**

Do not rewrite this SHA as PASS. Do not rewrite it as a software-only failure.
Independent review of the software/emulator package for this SHA passed;
real Quest 3 behavior was not predicted by IWER.

This result supersedes the previous software-only promotion of that HEAD.

## Observed on a real Meta Quest 3

| Item | Result |
|---|---|
| Poster quality | **FAILED** |
| Most-important visual comparison vs prior hardware build | **FAILED** (barely improved) |
| Close-range black / head-linked artifact | **FAILED** |
| Stereo signage (NEW RELEASE / 3D / MUSIC / fascia) | **PASS** |
| Menu / Settings placement | **FAILED** |
| FPS HUD placement | **FAILED** |
| Stability / frame hitching | **FAILED** |
| **QUEST_HARDWARE** | **FAILED** |

### Poster quality

Posters were only marginally better than the previous hardware build. A strong
pixelated / dot-like appearance remained. Title/logo content was often not
recognizable at a useful viewing distance. The primary product requirement —
content must look clear and high quality — was unmet.

Frequent judder/stutters occurred. Getting near posters could cause severe
freezing/stalling.

320×480 is therefore not accepted as a final visual-quality tier.

### Close-range black artifact

The black region/shadow linked to head movement was still present. The previous
near-plane hypothesis did **not** fix the real issue. Near clipping is no longer
accepted as proof or explanation of this artifact.

### Stereo signage

This is the one clearly successful hardware correction. NEW RELEASE / 3D / MUSIC
and related fascia now render in both eyes. **Preserve this fix.**

### Menu / Settings

The menu was even less predictable than before: strange position, strange
orientation, difficult or impossible to recognize where it appeared. IWER looked
correct; hardware did not. IWER visual appearance is not hardware proof.

### FPS HUD

The FPS readout moved to an unusable location (lower-left / outside practical
viewing area). Orientation remained world/body fixed. Most of the contents could
not be read.

### Stability

Overall hardware stability was not acceptable.

## Status of PR #5

Draft. Do not merge.

## Later HEADs

A later implementation HEAD on this branch is **not** a Quest hardware result.
Until a new real Quest session is authorized and executed:

`QUEST_HARDWARE = NOT_EXECUTED / PENDING`

while this SHA remains:

`QUEST_HARDWARE = FAILED`
