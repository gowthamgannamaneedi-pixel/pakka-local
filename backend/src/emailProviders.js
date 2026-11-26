// STAGING-ONLY e-mail delivery of customer login codes (see config.emailOtp). Codes and API keys are never logged.
// A code counts as sent only when the provider accepts the message (HTTP 2xx); anything else is reported as a failure.
import { config } from './config.js';

export const testEmailOutbox = [];      // only used when NODE_ENV=test

const body = (code) => ({
  subject: `${code} is your Pakka Local staging login code`,
  text: `Your Pakka Local STAGING login code is ${code}.\n\nIt expires in 5 minutes and works once. If you did not ask for it, ignore this email.\n\nThis is a test system: no real orders or payments.`,
  html: `<p>Your Pakka Local <b>staging</b> login code is</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p><p>It expires in 5 minutes and works once. If you did not ask for it, ignore this email.</p><p style="color:#666">This is a test system: no real orders or payments.</p>`
});

const providers = {
  test: { async send(to, code) { testEmailOutbox.push({ to, code }); } },
  // Brevo transactional e-mail API (free plan). Docs: https://developers.brevo.com/reference/sendtransacemail
  brevo: {
    async send(to, code) {
      const e = config.emailOtp;
      if (!e.apiKey) throw new Error('Email login is not configured (BREVO_API_KEY missing)');
      const m = body(code), ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 10_000);
      try {
        const r = await fetch(e.apiUrl, { method: 'POST', signal: ctl.signal,
          headers: { 'api-key': e.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ sender: { email: e.from, name: e.fromName }, to: [{ email: to }], subject: m.subject, textContent: m.text, htmlContent: m.html, tags: ['pakka-staging-login'] }) });
        if (!r.ok) throw new Error(`Email provider refused the message (HTTP ${r.status})`);      // status only: the reply may echo the address
      } catch (err) { throw new Error(err.name === 'AbortError' ? 'Email provider timed out' : err.message); }
      finally { clearTimeout(t); }
    }
  }
};
export const getEmailProvider = () => providers[config.emailOtp.provider] || null;

// Any other e-mail (admin welcome, admin password-reset code). Works whether or not the staging e-mail LOGIN is switched on.
export const testMailOutbox = [];
export const mailReady = () => config.emailOtp.provider === 'test' || (!!config.emailOtp.apiKey && /\S+@\S+\.\S+/.test(config.emailOtp.from || ''));
export async function sendMail(to, { subject, text, html, tag = 'pakka-admin' }) {
  if (config.emailOtp.provider === 'test') { testMailOutbox.push({ to, subject, text }); return; }
  const e = config.emailOtp; if (!mailReady()) throw new Error('E-mail is not set up on this server.');
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 10_000);
  try {
    const r = await fetch(e.apiUrl, { method: 'POST', signal: ctl.signal, headers: { 'api-key': e.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: { email: e.from, name: e.fromName || 'Pakka Local' }, to: [{ email: to }], subject, textContent: text, htmlContent: html || `<p>${text.replace(/\n/g, '<br>')}</p>`, tags: [tag] }) });
    if (!r.ok) throw new Error(`Email provider refused the message (HTTP ${r.status})`);
  } catch (err) { throw new Error(err.name === 'AbortError' ? 'Email provider timed out' : err.message); }
  finally { clearTimeout(t); }
}
