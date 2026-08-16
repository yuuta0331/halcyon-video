import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAllowlisted,
  isSamplerOrGlFatal,
  populatedWindowImpossible,
  residencyImpossible,
} from '../tools/xr-harness-log.mjs';

test('unrelated HTTP 500 is not allowlisted; /dev-proxy sidecar 500 is', () => {
  const unrelated = { type: 'error', text: 'Failed to load resource: the server responded with a status of 500' };
  assert.equal(isAllowlisted(unrelated, []), false);
  const proxy = { type: 'error', text: 'HTTP 500 http://127.0.0.1:17426/dev-proxy/jellyseerr/foo' };
  assert.equal(isAllowlisted(proxy, []), true);
  assert.equal(isAllowlisted(unrelated, [proxy]), true);
});

test('sampler overflow and context loss are fatal', () => {
  assert.equal(isSamplerOrGlFatal({ text: 'Trying to use 17 texture units while GPU supports only 16' }), true);
  assert.equal(isSamplerOrGlFatal({ text: 'CONTEXT_LOST_WEBGL' }), true);
  assert.equal(isSamplerOrGlFatal({ text: 'webglcontextlost' }), true);
  assert.equal(isSamplerOrGlFatal({ text: 'Could not compile fragment shader' }), true);
});

test('impossible residency (128 slots / 462 residents) fails closed', () => {
  assert.equal(residencyImpossible({
    posterPhysicalSlots: 128,
    posterResidentTitles: 462,
    posterDuplicatePhysicalOwners: 0,
    posterFreeOwnedCollisions: 0,
    posterResidencyInvariantOk: true,
  }), true);
  assert.equal(residencyImpossible({
    posterPhysicalSlots: 128,
    posterResidentTitles: 80,
    posterDuplicatePhysicalOwners: 1,
    posterFreeOwnedCollisions: 0,
    posterResidencyInvariantOk: true,
  }), true);
  assert.equal(residencyImpossible({
    posterPhysicalSlots: 128,
    posterResidentTitles: 80,
    posterDuplicatePhysicalOwners: 0,
    posterFreeOwnedCollisions: 0,
    posterResidencyInvariantOk: true,
  }), false);
  assert.equal(populatedWindowImpossible({
    physicalSlots: 128,
    residentCount: 128,
    uniqueOwners: 128,
    freeCount: 0,
    residencyInvariantOk: true,
    duplicatePhysicalOwners: 0,
    freeOwnedCollisions: 0,
  }), false);
  assert.equal(populatedWindowImpossible({
    physicalSlots: 128,
    residentCount: 200,
    uniqueOwners: 128,
    freeCount: 0,
    residencyInvariantOk: false,
  }), true);
});
