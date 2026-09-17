// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * The geolocation sequencing behind "Moja lokacija", tested where it lives.
 * Nothing here touches a map: the helper takes a getCurrentPosition-like
 * function, so a fake answers in the order a real device would.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

/*
 * report-map.ts imports Leaflet at the top, and Leaflet wants a window. One
 * resolve hook answers with an empty module so the pure helpers can be imported
 * under plain Node; nothing in these tests calls into it.
 */
const LEAFLET_STUB = `data:text/javascript,${encodeURIComponent(
  'export const map = () => {};\n' +
    'export const control = {};\n' +
    'export const tileLayer = () => {};\n' +
    'export const divIcon = () => {};\n' +
    'export const marker = () => {};\n' +
    'export const latLng = () => {};\n',
)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'leaflet') return { url: LEAFLET_STUB, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { accuracyMetres, locateBestEffort, LOCATION_FAST, LOCATION_PRECISE } =
  await import('../src/scripts/entry/report-map.ts');

const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;
const TIMEOUT = 3;

function position(latitude, longitude, accuracy) {
  return { coords: { latitude, longitude, accuracy }, timestamp: 0 };
}

/**
 * A fake device. `answers` is read in order, one per attempt; each is either a
 * position or an error code. Every attempt's options are recorded.
 */
function device(answers) {
  const calls = [];
  const queue = [...answers];
  const get = (onSuccess, onError, options) => {
    calls.push(options);
    const answer = queue.shift();
    if (typeof answer === 'number') onError({ code: answer, message: '' });
    else onSuccess(answer);
  };
  return { get, calls };
}

test('a cheap fix is used at once and a better one replaces it', async () => {
  const { get, calls } = device([position(45.149, 13.604, 900), position(45.15, 13.606, 12)]);
  const seen = [];
  const outcome = await locateBestEffort(get, (fix) => seen.push(fix));

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], LOCATION_FAST);
  assert.deepEqual(calls[1], LOCATION_PRECISE);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].accuracy, 900);
  assert.equal(outcome.kind, 'fix');
  assert.equal(outcome.fix.accuracy, 12);
  assert.equal(outcome.fix.lat, 45.15);
});

test('a refinement that is no better leaves the first fix alone', async () => {
  const { get } = device([position(45.149, 13.604, 40), position(45.2, 13.7, 800)]);
  const seen = [];
  const outcome = await locateBestEffort(get, (fix) => seen.push(fix));

  assert.equal(seen.length, 1);
  assert.equal(outcome.kind, 'fix');
  assert.equal(outcome.fix.lon, 13.604);
});

test('a failed refinement is silent', async () => {
  const { get } = device([position(45.149, 13.604, 60), TIMEOUT]);
  const outcome = await locateBestEffort(get);

  assert.equal(outcome.kind, 'fix');
  assert.equal(outcome.fix.accuracy, 60);
});

test('a timeout on the cheap attempt is retried at high accuracy', async () => {
  const { get, calls } = device([TIMEOUT, position(45.149, 13.604, 18)]);
  const seen = [];
  const outcome = await locateBestEffort(get, (fix) => seen.push(fix));

  assert.equal(calls.length, 2);
  assert.equal(calls[1].enableHighAccuracy, true);
  assert.equal(seen.length, 1);
  assert.equal(outcome.kind, 'fix');
});

test('an unavailable position is retried once and then reported as failed', async () => {
  const { get, calls } = device([POSITION_UNAVAILABLE, POSITION_UNAVAILABLE]);
  const outcome = await locateBestEffort(get);

  assert.equal(calls.length, 2);
  assert.deepEqual(outcome, { kind: 'failed' });
});

test('a refused permission is never retried', async () => {
  const { get, calls } = device([PERMISSION_DENIED, position(45.149, 13.604, 10)]);
  const seen = [];
  const outcome = await locateBestEffort(get, (fix) => seen.push(fix));

  assert.equal(calls.length, 1);
  assert.equal(seen.length, 0);
  assert.deepEqual(outcome, { kind: 'denied' });
});

test('a permission refused on the retry is reported as refused, not failed', async () => {
  const { get } = device([TIMEOUT, PERMISSION_DENIED]);
  assert.deepEqual(await locateBestEffort(get), { kind: 'denied' });
});

test('a device that throws is a failure, not an exception', async () => {
  const get = () => {
    throw new Error('no geolocation');
  };
  assert.deepEqual(await locateBestEffort(get), { kind: 'failed' });
});

test('a position without finite coordinates is not a fix', async () => {
  const { get } = device([position(Number.NaN, 13.604, 10), position(Number.NaN, 13.604, 10)]);
  assert.deepEqual(await locateBestEffort(get), { kind: 'failed' });
});

test('a device that answers twice is only heard once', async () => {
  const get = (onSuccess, onError) => {
    onSuccess(position(45.149, 13.604, 30));
    onSuccess(position(1, 1, 1));
    onError({ code: TIMEOUT, message: '' });
  };
  const outcome = await locateBestEffort(get);
  assert.equal(outcome.kind, 'fix');
  assert.equal(outcome.fix.lat, 45.149);
});

test('the accuracy is only said out loud when it is worth saying', () => {
  assert.equal(accuracyMetres(null), null);
  assert.equal(accuracyMetres(12), null);
  assert.equal(accuracyMetres(100), null);
  assert.equal(accuracyMetres(247), 250);
  assert.equal(accuracyMetres(1234), 1200);
  assert.equal(accuracyMetres(Number.NaN), null);
});
