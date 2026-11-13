import 'dotenv/config';
const env = process.env;
const isProd = env.NODE_ENV === 'production';
const isTest = env.NODE_ENV === 'test';

function required(name) {
  const v = env[name];
  if (!v && isProd) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

// APP_ENV separates a real production deployment from a staging one (hosts usually run both with NODE_ENV=production).
const appEnv = env.APP_ENV || (isProd ? 'production' : isTest ? 'test' : 'development');
if (!['production', 'staging', 'development', 'test'].includes(appEnv)) throw new Error('APP_ENV must be production, staging, development or test');
if (appEnv !== 'production' && isProd && appEnv !== 'staging') throw new Error('With NODE_ENV=production, APP_ENV must be production or staging');

export const config = {
  isProd, isTest, appEnv,
  port: Number(env.PORT || 8080),
  dbPath: env.DB_PATH || (isProd ? '/var/data/pakka-local.sqlite' : './data/pakka-local.sqlite'),
  backupDir: env.BACKUP_DIR || (isProd ? '/var/data/backups' : './data/backups'),
  jwtSecret: required('JWT_SECRET') || (isTest ? 'test-secret-test-secret-test-secret!' : (() => { throw new Error('JWT_SECRET required'); })()),
  allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  staffTokenTtl: '12h',
  customerTokenTtl: '30d',
  otp: { ttlMs: 5 * 60_000, maxAttempts: 5, resendCooldownMs: 45_000 },
  uploadDir: env.UPLOAD_DIR || (isProd ? '/var/data/uploads' : './data/uploads'),
  // 'disabled' = no orders can be placed | 'sandbox' = simulated, never on production | 'phonepe' = reserved: the gateway is NOT integrated yet, so it behaves like 'disabled'
  paymentProvider: env.PAYMENT_PROVIDER || (isProd ? 'disabled' : 'sandbox'),
  sandboxPhones: (env.SANDBOX_PAYMENT_PHONES || '').split(',').map((x) => x.trim()).filter(Boolean),
  // Map tiles (Leaflet). Production must name a provider whose terms allow this use; public OSM tiles are for development only.
  map: { tileUrl: env.MAP_TILE_URL || (isProd ? '' : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'), attribution: env.MAP_TILE_ATTRIBUTION || '&copy; OpenStreetMap contributors' },
  serveFrontend: env.SERVE_FRONTEND === 'true' || (!isProd && !isTest),
  vapid: { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || 'mailto:admin@pakkalocal.example' },
  publicApiUrl: (env.PUBLIC_API_URL || '').replace(/\/$/, ''),
  otpProvider: isTest ? 'test' : (env.OTP_PROVIDER || 'whatsapp'),
  testOtp: { code: env.TEST_OTP_CODE, phones: (env.TEST_OTP_PHONES || '').split(',').map((x) => x.trim()).filter(Boolean) },
  whatsapp: {
    token: env.WHATSAPP_ACCESS_TOKEN, phoneId: env.WHATSAPP_PHONE_NUMBER_ID,
    template: env.WHATSAPP_OTP_TEMPLATE_NAME, apiVersion: env.WHATSAPP_API_VERSION || 'v21.0'
  }
};
if (isProd && config.otpProvider === 'testcode' && env.ALLOW_TEST_OTP !== '1') throw new Error('OTP_PROVIDER=testcode in production requires ALLOW_TEST_OTP=1 (pilot testing only)');
if (config.otpProvider === 'testcode' && !/^\d{6}$/.test(config.testOtp.code || '')) throw new Error('TEST_OTP_CODE must be 6 digits when OTP_PROVIDER=testcode');
if (isProd && config.otpProvider === 'test') throw new Error('OTP_PROVIDER=test is not allowed in production');
if (config.jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
if (!['disabled', 'sandbox', 'phonepe'].includes(config.paymentProvider)) throw new Error('PAYMENT_PROVIDER must be disabled, sandbox or phonepe');
// Simulated payments can never run on a production deployment. There is deliberately no override flag.
if (appEnv === 'production' && config.paymentProvider === 'sandbox') throw new Error('PAYMENT_PROVIDER=sandbox is not allowed in production. Use PAYMENT_PROVIDER=disabled until a real payment gateway is integrated.');
if (appEnv === 'staging' && config.paymentProvider === 'sandbox' && !config.sandboxPhones.length) throw new Error('Staging sandbox payments require SANDBOX_PAYMENT_PHONES (comma-separated tester phone numbers).');
config.sandboxPayments = config.paymentProvider === 'sandbox' && appEnv !== 'production';
