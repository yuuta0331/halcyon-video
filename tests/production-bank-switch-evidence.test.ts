import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  adversarialWrongBank,
  beginBindDrawBankRecording,
  isBindDrawBankRecording,
  noteBindDrawBank,
  observedBanks,
  resetBindDrawBankObserverForTests,
  takeBindDrawBankRecording,
} from '../src/perf/poster-bank-bind-observer.ts';
import {
  drainGlErrors,
  glErrorName,
  glFatalFrom,
} from '../src/perf/gl-error-drain.ts';

test('bindDrawBank observer records then delegates without choosing banks', () => {
  resetBindDrawBankObserverForTests();
  assert.equal(isBindDrawBankRecording(), false);
  noteBindDrawBank(2);
  assert.equal(takeBindDrawBankRecording().length, 0);
  beginBindDrawBankRecording();
  assert.equal(isBindDrawBankRecording(), true);
  noteBindDrawBank(0);
  noteBindDrawBank(1);
  noteBindDrawBank(2);
  noteBindDrawBank(2);
  const calls = takeBindDrawBankRecording();
  assert.equal(isBindDrawBankRecording(), false);
  assert.deepEqual(calls.map((c) => c.bank), [0, 1, 2, 2]);
  assert.deepEqual(observedBanks(calls), [0, 1, 2]);
  noteBindDrawBank(7);
  assert.equal(takeBindDrawBankRecording().length, 0);
});

test('adversarial wrong-bank is never the expected target when multiple banks exist', () => {
  assert.equal(adversarialWrongBank(2, 3), 0);
  assert.equal(adversarialWrongBank(1, 3), 0);
  assert.equal(adversarialWrongBank(0, 3), 1);
  assert.notEqual(adversarialWrongBank(2, 3), 2);
  assert.notEqual(adversarialWrongBank(0, 3), 0);
});

test('production probe source never pre-binds the expected bank before render', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../src/perf/production-multibank-probe.ts', import.meta.url)),
    'utf8',
  );
  assert.equal(/\bbindDrawBank\(\s*bank\s*\)/.test(src), false);
  assert.equal(/\bbindDrawBank\(\s*targetBank\s*\)/.test(src), false);
  assert.equal(/\bbindDrawBank\(\s*rec\.bank\s*\)/.test(src), false);
  assert.match(src, /bindDrawBank\(wrongBank\)/);
  assert.match(src, /probeAssistedExpectedBind: false/);
  assert.match(src, /suppressProductionBind/);
  assert.match(src, /drainGlErrors/);
});

test('glFatal is derived from measured getError codes', () => {
  assert.equal(glErrorName(0), 'NO_ERROR');
  assert.equal(glErrorName(0x0502), 'INVALID_OPERATION');
  assert.equal(glErrorName(0x0505), 'OUT_OF_MEMORY');
  assert.equal(glFatalFrom([]), false);
  assert.equal(glFatalFrom([{ code: 0x0502, name: 'INVALID_OPERATION' }]), true);
  const seq = [0x0500, 0];
  const gl = { getError() { return seq.shift() ?? 0; } };
  const drained = drainGlErrors(gl, 8);
  assert.deepEqual(drained.map((e) => e.name), ['INVALID_ENUM']);
  assert.equal(glFatalFrom(drained), true);
  assert.deepEqual(drainGlErrors(gl, 8), []);
});
