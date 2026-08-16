import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendXrJournal,
  installXrStartupJournal,
  lastXrStartup,
  resetXrStartupJournalForTests,
  xrStartupJournal,
} from '../src/xr/startup-journal.ts';

test('startup journal records secret-free transitions', () => {
  resetXrStartupJournalForTests();
  installXrStartupJournal('HALCYON');
  appendXrJournal('requestSession-start', {
    phase: 'requesting',
    requestedOptionalFeatures: ['local-floor'],
  }, { requestedOptionalFeatures: 'local-floor' });
  appendXrJournal('window-blur', {}, { blurCount: 1 });
  appendXrJournal('setSession-end', { phase: 'projecting', compositorBackend: 'xr-webgl-layer' });
  appendXrJournal('first-world-frame', { firstWorldFrameAt: 42 });
  const last = lastXrStartup();
  assert.equal(last.mode, 'HALCYON');
  assert.equal(last.phase, 'projecting');
  assert.equal(last.firstWorldFrameAt, 42);
  assert.equal(last.compositorBackend, 'xr-webgl-layer');
  assert.deepEqual(last.requestedOptionalFeatures, ['local-floor']);
  const types = xrStartupJournal().map((e) => e.type);
  assert.ok(types.includes('journal-start'));
  assert.ok(types.includes('requestSession-start'));
  assert.ok(types.includes('first-world-frame'));
  const blob = JSON.stringify({ last, events: xrStartupJournal() });
  assert.equal(/jellyfin|token|password|username/i.test(blob), false);
});
