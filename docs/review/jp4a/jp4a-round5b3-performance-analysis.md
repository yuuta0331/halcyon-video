# JP-4A Round 5B.3 performance analysis

New-head Quest result: **NOT_EXECUTED**. Any GPU-bound classification below that depends on Quest is `REQUIRES_QUEST`.

## Software-confirmed classification

| Area | Classification | Evidence / change |
|---|---|---|
| Baseline duplicate work | CPU / scene-traversal, confirmed | Removed `publishXrContent(scene)` full traversal from the per-XR-frame locomotion callback. Poster working-set reconciliation remains. |
| FOCUS transition | upload-stall risk, confirmed | The old queue completed after CPU `data.set` + `needsUpdate`; actual 640×960 upload was deferred to render. New queued chunks call `texSubImage2D` directly. |
| FOCUS decode | main-thread CPU risk, confirmed | Decode, resize, and RGBA extraction moved to a lazy worker with fallback. |
| Stationary completion | state-machine wake risk, confirmed | Rejected queued chunks retain decoded pixels and retry without movement; final chunk requests render. |
| GPU vertex/fragment/draw-call/texture bandwidth | `REQUIRES_QUEST` | Software/IWER cannot reproduce Quest compositor cost or driver scheduling. |
| Post-processing | not an XR contributor in source | Immersive XR skips `EffectComposer` and renders the world directly. |

No poster resolution, catalog count, or FOCUS dimensions were reduced.

## Actual-upload semantics

FOCUS slots remain 640×960 RGBA, two bounded resident slots. They are zero-filled/preallocated before selection. Each upload has 15 chunks at 64 rows for a full-height source, totaling 2,457,600 bytes. The expensive queue owns each actual `gl.texSubImage2D`; `ready`/active is impossible before the final chunk. Stale generation, deselection, or eviction cancels the task.

`gpuUploadSubmitMs` measures CPU-blocking time spent issuing GL calls. It is intentionally labelled `CPU_BLOCKING_GL_SUBMIT_NOT_GPU_EXECUTION`; it is not a timer-query measurement of GPU execution. Quest GPU/compositor duration remains `REQUIRES_QUEST`.

## Diagnostic telemetry

The existing XR frame loop records at most 4 samples/s only while JP-4A Test is active:

- FPS, mean, 1% low, p95, p99, worst, frame count, target/supported Hz;
- framebuffer dimensions/scale and effective foveation;
- renderer calls, triangles, textures, programs;
- bank count and render batch count;
- DETAIL/FOCUS phases, queue counts, upload progress/bytes/submit time, decode time;
- locked opaque id, index/bank/layer/flag, distance, and relative yaw.

The test HUD uses the same frame loop and follows the viewer. The FPS number is the primary large text at center-bottom; the guide/mode panel is center-top, with projected bounds tested not to overlap.

## Quest decision points

Use copied JSON to compare baseline, approach, focus_transition, and focus_settled. If calls/triangles are stable while frame time rises with upload progress, texture submission/bandwidth remains likely. If baseline remains near 25 FPS with queues empty, use Quest-only renderer/compositor evidence to classify fragment, vertex, bandwidth, or runtime scaling. Do not infer GPU execution time from submit time alone.
