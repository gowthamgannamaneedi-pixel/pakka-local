// Test helpers for GPS delivery addresses (simulated GPS: these coordinates are typed in, not read from a device).
export const FIX = (o = {}) => ({ label: 'hostel', place_name: 'Test Hostel', building: 'Block A building', room: '101', lat: 17.4401, lng: 78.3489, accuracy_m: 12,
  captured_at: new Date().toISOString(), confirm: true, ...o });

// Older tests send carts in the previous shape ({ location_id } or { lat, lng }). This adapter keeps those business tests
// unchanged: it saves a real address for that customer through POST /api/customer/addresses (same delivery area, so the
// same fee) and sends { address_id, confirm_destination: true } instead. New-contract requests pass through untouched.
export function withAddresses(call) {
  const cache = new Map();
  return async (method, path, body, token, ...rest) => {
    if (method === 'POST' && /^\/api\/customer\/(orders|quote)$/.test(path) && body && !('address_id' in body) && ('location_id' in body || 'lat' in body)) {
      const { location_id, lat, lng, dest_text, ...cart } = body;
      const key = `${token}|${location_id ?? ''}|${lat ?? ''}|${lng ?? ''}`;
      if (!cache.has(key)) {
        const okCoords = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
        const a = await call('POST', '/api/customer/addresses', FIX({ delivery_location_id: location_id ?? null, ...(okCoords ? { lat, lng } : {}) }), token);
        if (a.status !== 201) return a;
        cache.set(key, a.body.address.id);
      }
      body = { ...cart, address_id: cache.get(key), confirm_destination: true };
    }
    return call(method, path, body, token, ...rest);
  };
}
