# JP-4A Round 5B.3 root-cause matrix

Apply this table to one locked real shelf poster. `BLACK` and `CLEAN` are human Quest observations; software/IWER cannot fill them in.

| Quest observation | Interpretation | Next priority |
|---|---|---|
| NORMAL black; BASE black; LOD0 clean; one or more lower fixed LODs black | Mip/LOD path strongly implicated | Inspect the first failing level's CPU evidence and Quest sampling. |
| NORMAL black; BASE black; LOD0/1/2/3 and LINEAR all clean | Automatic derivative/minification selection strongly implicated | Compare yaw/distance thresholds and foveation. |
| NORMAL black; BASE black; LOD0 black; DEPTH-ISOLATED clean | Coplanar/nearby rental-shell depth interference strongly implicated | Measure/adjust the production surface relationship. |
| BASE black; UNLIT clean | Lighting/material/glancing-angle behavior strongly implicated | Inspect roughness/clearcoat/environment/direct light without changing texture. |
| NORMAL black; BASE clean | DETAIL, FOCUS, or an additional production tier is implicated | Correlate DETAIL/FOCUS phase and repeat after those phases settle. |
| All LIVE modes black and bank invariant fails | Bank/layer/index/loaded-state addressing is implicated | Use nonzero counters and locked bank/layer fields; do not diagnose mips first. |
| All LIVE modes black and bank invariant passes | Bank mismatch is lowered, not eliminated; texture data, geometry outside the isolated front, Quest driver/compositor remain | Use fixed LOD, unlit, and depth comparisons plus mip evidence. |
| All LIVE modes clean but the original unlocked shelf copy is black | Diagnostic selection/path equivalence is incomplete or the wrong instance was locked | Capture opaque id/index and reproduce on the exact visible slot. |
| LOD2/3 black for every poster, not just the affected subset | Shared low-mip generation/sampling is likely | Compare representative layers and array completeness. |
| Only one bank fails and invariant passes | Bank texture contents/completeness or bank binding remains plausible | Compare bank number, array depth, bind counters, and fixed LOD. |
| Black disappears only after FOCUS becomes ready | BASE/DETAIL data or sampling is implicated; FOCUS itself is not the visual cause | Compare NORMAL/BASE/fixed LOD before focus. |
| Visual modes do not change black but yaw/foveation strongly changes it | Quest runtime/foveation/compositor or view-dependent material remains | `REQUIRES_QUEST`; repeat with recorded effective foveation. |

Several rows may apply. Do not force a single cause when evidence leaves multiple hypotheses.
