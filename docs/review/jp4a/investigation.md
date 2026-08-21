# JP-4A content-class investigation

Owner report after JP-3 PASS: posters visible on Quest 3, other store
content appearing not to load, settings unreachable in XR.

This is a **functional parity** issue, not an expected XR_SAFE
limitation. XR_SAFE may drop expensive *effects*; it must not drop
content required to read and use the store.

## Inventory

| Class | Role | DESKTOP_FULL | XR_SAFE | Notes |
|---|---|---|---|---|
| poster | required | allocated / decoded / uploaded / visible | same, 128-slot window | Boot P0/P1 working set |
| wraps | required | hero/inspect sleeve, spine, back | enabled, **selected title only** | Not printed on all 128 shelf instances |
| signage | required | visible | visible | `userData.isSign` + named groups |
| aisleFascia | required | visible | visible | Genre blades (often marked as signs) |
| brandPack | required | ready | ready | Identity ≠ locale |
| canvasTextures | required | allocated | allocated | Procedural carpet/walls/labels |
| fixtureTextures | required | visible | visible | Bins, letterboards, stands |
| storeLogos | required | visible | visible | Storefront marks |
| crt | required | ready | ready | Mesh surface, not DOM |
| floorWallMaterials | required | ready | ready | Materials stay; AO/shadows off |
| mediaSurfaces | required | VideoTexture | mesh VideoTexture | XRMediaBinding stays off |
| decorativeFx | decorative | on | **disabled** | N8AO/GTAO, composer, mirrors, probes, full env bake, clearcoat maps |

## Root cause (non-poster stall)

GPU uploads for posters, wrap/spine restamps, and fixture cover swaps
go through `queueTextureUpload` → `window.requestAnimationFrame`.

Quest Browser often **pauses page rAF** while `renderer.setAnimationLoop`
still runs. Boot posters already on the GPU stay visible. Later async
uploads (wraps, fixture details, working-set posters) sit in the queue
and never drain. Desktop IWER still fires window rAF, so the emulator
can hide this.

Secondary, resource-bounded behaviors (kept):

- `loadAllArtworkForActiveLibrary` does not sweep the full catalog under
  residency bounds. That is intentional. Selected-title wrap decode is
  `prefetchInspectCaseArt` on XR select.
- Shelf faces are the poster array + vertex spine colors. Full wrap
  print lives on the hero/inspect path. JP-4B owns showing that in hand.

## Fix (selective)

1. XR animation loop calls `pumpTextureUploads()` every frame.
2. While presenting, the upload queue does **not** reschedule window rAF.
3. XR select prefetches inspect-quality wrap/spine/back for that title
   only. Hero meshes stay hidden (not JP-4B inspect UI).
4. Diagnostics report class counts/states. No tokens, API keys, or URLs.
   Counts are not inflated to hide missing meshes.

## Intentionally still off in XR_SAFE

- decorativeFx (AO, composer, live mirrors, reflection probes, full bake)
- XRMediaBinding / compositor video layers
- framebuffer scale raise, MSAA, foveation retune → **JP-5**
- wrap art on every physical shelf slot (would break 128-slot / sampler policy)
