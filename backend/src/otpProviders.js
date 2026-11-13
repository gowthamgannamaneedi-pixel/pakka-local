import { config } from './config.js';
// Provider abstraction: swap WhatsApp / SMS via OTP_PROVIDER or an admin setting. OTPs are never logged.
export const testOutbox = [];   // only populated when NODE_ENV=test

const providers = {
  // PILOT TESTING ONLY: lets a short allow-list of phone numbers log in with a fixed code from the environment.
  // Nothing is sent, and the code is never returned by any API. Anyone not on the list is refused.
  testcode: { fixedFor: (phone) => (config.testOtp.phones.includes(phone) ? config.testOtp.code : null), async send() {} },
  test: { async send(phone, otp) { testOutbox.push({ phone, otp }); } },
  whatsapp: {
    async send(phone, otp) {
      const w = config.whatsapp;
      if (!w.token || !w.phoneId || !w.template) throw new Error('WhatsApp OTP is not configured');
      const res = await fetch(`https://graph.facebook.com/${w.apiVersion}/${w.phoneId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${w.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp', to: phone.replace(/^\+/, ''), type: 'template',
          template: { name: w.template, language: { code: 'en' }, components: [
            { type: 'body', parameters: [{ type: 'text', text: otp }] },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: otp }] }
          ] }
        })
      });
      if (!res.ok) throw new Error(`WhatsApp send failed (${res.status})`);
    }
  }
  // sms: add a provider here and select via OTP_PROVIDER / app_settings
};
export const getOtpProvider = () => providers[config.otpProvider] || providers.whatsapp;
