// Test helper: fills a delivery-agent application through the real API (save, uploads, phone code, consent, submit).
import assert from 'node:assert/strict';
import { testOutbox } from '../../src/otpProviders.js';

export const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
export const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
export const fullApplication = (n = 1) => ({
  legal_name: `Test Agent ${'ABCDEFGHIJ'[n % 10]}`, date_of_birth: '1995-04-12', address: '12 Test Street, Test Nagar, Hyderabad 500075', emergency_phone: '+919800000000',
  id_type: 'voter_id', id_last4: '1234', vehicle_category: 'Scooter', vehicle_make: 'Honda', vehicle_model: 'Activa', vehicle_reg_no: `TS 09 AB ${1000 + n}`,
  licence_no: `TS0920190000${n}`, licence_expiry: '2035-01-01', payout_method: 'upi', payout_upi: `agent${n}@okbank`, consent: true
});
export async function completeApplication(call, token, n = 1, { submit = true } = {}) {
  assert.equal((await call('PUT', '/api/rider/application', fullApplication(n), token)).status, 200);
  for (const kind of ['photo', 'id_front', 'id_back', 'licence', 'rc', 'vehicle_photo'])
    assert.equal((await call('POST', '/api/rider/application/documents', { kind, data: kind === 'licence' ? PDF : PNG }, token)).status, 200, kind);
  if (!(await call('GET', '/api/rider/application', null, token)).body.application.phone_verified) {
    assert.equal((await call('POST', '/api/rider/application/phone/request', {}, token)).status, 200);
    assert.equal((await call('POST', '/api/rider/application/phone/verify', { otp: testOutbox.at(-1).otp }, token)).status, 200);
  }
  if (submit) { const s = await call('POST', '/api/rider/application/submit', {}, token); assert.equal(s.status, 200, JSON.stringify(s.body)); }
}
