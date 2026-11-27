// The look follows the real readings: storm, rain, fog, cloud cover, haze, clear.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/services/weather.js';

const base = { storm: false, rainMm: 0, rainCode: false, visKm: 8, clouds: 10, hazeCode: false };
test('each weather reading maps to the right look', () => {
  assert.equal(classify({ ...base, storm: true }), 'storm');
  assert.equal(classify({ ...base, rainMm: 1.2 }), 'rain');
  assert.equal(classify({ ...base, rainCode: true }), 'rain');
  assert.equal(classify({ ...base, rainMm: 0.1, clouds: 90 }), 'clouds', 'a trace of drizzle under an overcast sky is cloudy, not rain');
  assert.equal(classify({ ...base, visKm: 0.5, hazeCode: true }), 'fog', 'visibility under 1 km is real fog');
  assert.equal(classify({ ...base, clouds: 92, hazeCode: true, visKm: 6 }), 'clouds', 'mostly covered sky reads as cloudy even when the provider says haze');
  assert.equal(classify({ ...base, clouds: 30, hazeCode: true, visKm: 4 }), 'haze');
  assert.equal(classify({ ...base, clouds: 65 }), 'clouds');
  assert.equal(classify({ ...base, clouds: 20 }), 'clear');
});
