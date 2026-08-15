import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORE_UNITS_PER_METER,
  detectPlatform,
  metersFromStoreUnits,
  storeUnitsFromMeters,
} from '../src/platform/index.ts';

test('desktop/browser is the default runtime', () => {
  const p = detectPlatform({ tauri: false, xr: false });
  assert.equal(p.kind, 'browser');
  assert.equal(p.isTauri, false);
  assert.equal(p.xrAvailability, 'unsupported');
  assert.equal(p.isXrSession, false);
  assert.equal(p.requiresAnimationLoop, false);
  assert.equal(p.worldUnits, 'store');
});

test('Tauri is distinct from browser and still not an XR session', () => {
  const p = detectPlatform({ tauri: true, xr: false });
  assert.equal(p.kind, 'tauri');
  assert.equal(p.isTauri, true);
  assert.equal(p.isXrSession, false);
  assert.equal(p.requiresAnimationLoop, false);
});

test('future XR capability is recorded without starting a session', () => {
  const p = detectPlatform({ tauri: false, xr: true });
  assert.equal(p.xrAvailability, 'capable-inactive');
  assert.equal(p.isXrSession, false);
  assert.equal(p.requiresAnimationLoop, false);
});

test('store-unit conversion uses the documented feet-like ratio', () => {
  assert.equal(STORE_UNITS_PER_METER, 3.28084);
  assert.equal(storeUnitsFromMeters(1), 3.28084);
  assert.ok(Math.abs(metersFromStoreUnits(3.28084) - 1) < 1e-9);
});
