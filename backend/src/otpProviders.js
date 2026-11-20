import { config } from './config.js';
// Customer LOGIN codes only (never delivery / pickup codes). Provider chosen by OTP_PROVIDER. OTP values are never logged.
export const testOutbox = [];   // only populated when NODE_ENV=test

// A send failure the login screen can explain. `kind`: invalid_number | not_allowed | rate_limited | unavailable
export class OtpSendError extends Error { constructor(kind, msg, meta = {}) { super(msg); this.kind = kind; this.meta = meta; } }

// Meta Cloud API error codes -> what the customer is told. Unknown codes count as "unavailable" (our side, retry later).
// https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
const META = {
  131026: 'invalid_number', 131021: 'invalid_number', 131009: 'invalid_number', 100: 'invalid_number',
  131030: 'not_allowed',                                 // test number: recipient is not in the allowed list
  4: 'rate_limited', 80007: 'rate_limited', 130429: 'rate_limited', 131048: 'rate_limited', 131056: 'rate_limited',
};

const providers = {
  // PILOT/STAGING TESTING ONLY: a short allow-list of numbers logs in with a fixed code from the server environment.
  // Nothing is sent and the code is never returned by any API. Refused when APP_ENV=production (see config.js).
  testcode: { fixedFor: (phone) => (config.testOtp.phones.includes(phone) ? config.testOtp.code : null), async send() { return {}; } },
  test: { async send(phone, otp) { testOutbox.push({ phone, otp }); return { messageId: `wamid.test.${testOutbox.length}` }; } },
  // Meta WhatsApp Cloud API, approved AUTHENTICATION template: body {{1}} = code, plus the "Copy code" button (also the code).
  whatsapp: {
    async send(phone, otp) {
      const w = config.whatsapp;
      if (!w.token || !w.phoneId || !w.template) throw new OtpSendError('unavailable', 'WhatsApp OTP is not configured', { config: true });
      const components = [{ type: 'body', parameters: [{ type: 'text', text: otp }] }];
      if (w.copyButton) components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: otp }] });
      let res, j;
      try {
        res = await fetch(`https://graph.facebook.com/${w.apiVersion}/${w.phoneId}/messages`, {
          method: 'POST', signal: AbortSignal.timeout(10_000),
          headers: { Authorization: `Bearer ${w.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: phone.replace(/^\+/, ''), type: 'template',
            template: { name: w.template, language: { code: w.language }, components } })
        });
        j = await res.json().catch(() => null);
      } catch (e) { throw new OtpSendError('unavailable', `WhatsApp request failed (${e.name})`); }
      if (!res.ok) { const code = j?.error?.code, sub = j?.error?.error_subcode;
        throw new OtpSendError(META[code] || 'unavailable', `WhatsApp send failed (HTTP ${res.status}, code ${code ?? '-'}${sub ? '/' + sub : ''})`, { code, sub }); }
      return { messageId: j?.messages?.[0]?.id || null };
    }
  },
  // MSG91 (an Indian WhatsApp provider): same approved authentication template, sent from the WhatsApp number connected
  // in the MSG91 dashboard. https://msg91.com/help/whatsapp/whatsapp-otp
  msg91: {
    async send(phone, otp) {
      const m = config.msg91;
      if (!m.authKey || !m.number || !m.template) throw new OtpSendError('unavailable', 'MSG91 WhatsApp OTP is not configured', { config: true });
      const components = { body_1: { type: 'text', value: otp } };
      if (m.copyButton) components.button_1 = { subtype: 'url', type: 'text', value: otp };
      const template = { name: m.template, language: { code: m.language, policy: 'deterministic' }, to_and_components: [{ to: [phone.replace(/^\+/, '')], components }] };
      if (m.namespace) template.namespace = m.namespace;
      let res, j;
      try {
        res = await fetch('https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/', {
          method: 'POST', signal: AbortSignal.timeout(10_000),
          headers: { authkey: m.authKey, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ integrated_number: m.number, content_type: 'template', payload: { messaging_product: 'whatsapp', type: 'template', template } })
        });
        j = await res.json().catch(() => null);
      } catch (e) { throw new OtpSendError('unavailable', `MSG91 request failed (${e.name})`); }
      const failed = !res.ok || j?.hasError === true || /^(fail|error)/i.test(String(j?.status || j?.type || ''));
      if (failed) { const why = String(j?.errors || j?.message || j?.data || '').slice(0, 160);
        const kind = res.status === 429 || /limit|too many/i.test(why) ? 'rate_limited' : /invalid.*(number|mobile|recipient)|not.*whatsapp|undeliverable/i.test(why) ? 'invalid_number' : 'unavailable';
        throw new OtpSendError(kind, `MSG91 send failed (HTTP ${res.status}${why ? ': ' + why.replace(/\d{4,}/g, '#') : ''})`); }      // digits masked: never log a code or number
      return { messageId: j?.request_id || j?.data?.request_id || null };
    }
  },
  // Fast2SMS (official Meta WhatsApp provider): its documented "send authentication template" route, which takes the same
  // body as Meta's Cloud API, from the number connected in Fast2SMS -> WhatsApp Manager -> Numbers (its Phone Number ID).
  // https://docs.fast2sms.com/reference/sendauthenticationtemplate.md  — the code is still generated and checked by Pakka Local.
  fast2sms: {
    async send(phone, otp) {
      const f = config.fast2sms;
      if (!f.apiKey || !f.phoneNumberId || !f.template) throw new OtpSendError('unavailable', 'Fast2SMS WhatsApp OTP is not configured', { config: true });
      const components = [{ type: 'body', parameters: [{ type: 'text', text: otp }] }];
      if (f.copyButton) components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: otp }] });
      let res, j;
      try {
        res = await fetch(`https://www.fast2sms.com/dev/whatsapp/${encodeURIComponent(f.apiVersion)}/${encodeURIComponent(f.phoneNumberId)}/messages`, {
          method: 'POST', signal: AbortSignal.timeout(10_000),
          headers: { Authorization: f.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: phone.replace(/^\+/, ''), type: 'template',
            template: { name: f.template, language: { code: f.language }, components } })
        });
        j = await res.json().catch(() => null);
      } catch (e) { throw new OtpSendError('unavailable', `Fast2SMS request failed (${e.name})`); }
      const id = j?.messages?.[0]?.id;
      if (!res.ok || !id || j?.return === false || j?.error) {
        const code = j?.error?.code, why = String(j?.error?.message || j?.message || '').slice(0, 160);
        const kind = META[code] || (res.status === 429 || /limit|too many/i.test(why) ? 'rate_limited' : /invalid.*(number|mobile|recipient)|not.*whatsapp|undeliverable/i.test(why) ? 'invalid_number' : 'unavailable');
        throw new OtpSendError(kind, `Fast2SMS send failed (HTTP ${res.status}${code ? ', code ' + code : ''}${why ? ': ' + why.replace(/\d{4,}/g, '#') : ''})`); }   // digits masked: never log a code or number
      return { messageId: id };
    }
  },
  // StartMessaging (SMS, India): sends through its own pre-registered DLT routes and shared approved OTP templates, so Pakka
  // Local needs no DLT registration. Documented in its dashboard (API Docs): POST /otp/send with X-API-Key; we pass our own
  // code in variables.otp. Message: "Your {appName} OTP is {otp}, valid for {expiry} minutes. ... Powered by Start Messaging."
  startmessaging: {
    channel: 'sms',
    async send(phone, otp) {
      const s = config.startMessaging;
      if (!s.apiKey || !s.templateId) throw new OtpSendError('unavailable', 'StartMessaging SMS OTP is not configured', { config: true });
      let res, j;
      try {
        res = await fetch('https://api.startmessaging.com/otp/send', {
          method: 'POST', signal: AbortSignal.timeout(10_000),
          headers: { 'X-API-Key': s.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ phoneNumber: phone, templateId: s.templateId,
            variables: { otp, appName: s.appName, expiry: String(Math.round(config.otp.ttlMs / 60_000)) } })
        });
        j = await res.json().catch(() => null);
      } catch (e) { throw new OtpSendError('unavailable', `StartMessaging request failed (${e.name})`); }
      const id = j?.data?.messageId;
      if (!res.ok || j?.success === false || !id) {
        const why = String(j?.message || j?.error || '').slice(0, 160).replace(/\d{4,}/g, '#');          // never log a code or number
        const kind = res.status === 429 ? 'rate_limited' : res.status === 400 && /phone|number|mobile/i.test(why) ? 'invalid_number' : 'unavailable';
        throw new OtpSendError(kind, `StartMessaging send failed (HTTP ${res.status}${res.status === 402 ? ', insufficient balance' : ''}${why ? ': ' + why : ''})`);
      }
      return { messageId: id };
    },
    // GET /messages/:id -> initiated | queued | sent | delivered | failed
    async status(messageId) {
      const s = config.startMessaging; if (!s.apiKey || !messageId) return null;
      try {
        const res = await fetch(`https://api.startmessaging.com/messages/${encodeURIComponent(messageId)}`, { signal: AbortSignal.timeout(5_000), headers: { 'X-API-Key': s.apiKey, Accept: 'application/json' } });
        if (!res.ok) return null; const j = await res.json().catch(() => null);
        const st = String(j?.data?.status || j?.status || '').toLowerCase();
        return ['initiated', 'queued', 'sent', 'delivered', 'failed'].includes(st) ? st : null;
      } catch { return null; }
    }
  }
};
export const loginChannel = () => { const p = override || providers[config.otpProvider]; return p?.fixedFor ? 'test' : p?.channel || (config.otpProvider === 'test' ? 'test' : 'whatsapp'); };
let override = null;
export const setOtpProvider = (p) => { override = p; };          // tests only
export const getOtpProvider = () => override || providers[config.otpProvider] || providers.whatsapp;
