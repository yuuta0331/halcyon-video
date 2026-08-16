import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  locomotionAllowed,
  uiOwnsInput,
  worldSelectAllowed,
  closeUiToWorld,
  openMenuFromWorld,
  openSettingsFromMenu,
  backFromSettings,
} from '../src/xr/ui-mode.ts';
import {
  XR_STANDARD_BUTTON,
  emptyXrButtonSnapshot,
  readXrButtonPressed,
  worldSelectShouldFire,
  xrUiActions,
} from '../src/xr/ui-input.ts';

test('XR UI input mode suppresses locomotion', () => {
  assert.equal(locomotionAllowed('WORLD'), true);
  assert.equal(locomotionAllowed('MENU'), false);
  assert.equal(locomotionAllowed('SETTINGS'), false);
  const actions = xrUiActions({
    mode: 'MENU',
    buttons: emptyXrButtonSnapshot(),
    prevButtons: emptyXrButtonSnapshot(),
    stickX: 1,
    stickY: -1,
    prevStickX: 0,
    prevStickY: 0,
  });
  assert.equal(actions.suppressLocomotion, true);
});

test('XR UI input mode suppresses world slot selection', () => {
  assert.equal(worldSelectAllowed('MENU'), false);
  assert.equal(worldSelectAllowed('SETTINGS'), false);
  assert.equal(worldSelectShouldFire('MENU', true), false);
  assert.equal(worldSelectShouldFire('WORLD', true), true);
  const actions = xrUiActions({
    mode: 'SETTINGS',
    buttons: { ...emptyXrButtonSnapshot(), trigger: true },
    prevButtons: emptyXrButtonSnapshot(),
    stickX: 0, stickY: 0, prevStickX: 0, prevStickY: 0,
  });
  assert.equal(actions.suppressWorldSelect, true);
  assert.equal(actions.activate, true);
});

test('closing menu restores world controls', () => {
  const menu = openMenuFromWorld('WORLD');
  assert.equal(menu, 'MENU');
  assert.equal(uiOwnsInput(menu), true);
  const world = closeUiToWorld(menu);
  assert.equal(world, 'WORLD');
  assert.equal(locomotionAllowed(world), true);
  assert.equal(worldSelectAllowed(world), true);
  const settings = openSettingsFromMenu('MENU');
  assert.equal(backFromSettings(settings), 'MENU');
});

test('gamepad mapping uses named XR-standard indices, not scattered numbers', () => {
  assert.equal(XR_STANDARD_BUTTON.trigger, 0);
  assert.equal(XR_STANDARD_BUTTON.squeeze, 1);
  assert.equal(XR_STANDARD_BUTTON.primary, 4);
  assert.equal(XR_STANDARD_BUTTON.secondary, 5);
  const pad = { buttons: [{ pressed: true }, { pressed: false }, {}, {}, { pressed: true }] };
  assert.equal(readXrButtonPressed(pad, 'trigger'), true);
  assert.equal(readXrButtonPressed(pad, 'primary'), true);
  assert.equal(readXrButtonPressed(pad, 'secondary'), false);
});
