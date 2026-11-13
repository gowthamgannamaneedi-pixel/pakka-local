// Test harness only (never deployed): app + a route that reveals the last login OTP to the browser test.
import express from 'express';
import { config } from '../src/config.js';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { testOutbox } from '../src/otpProviders.js';
import { setPushSender } from '../src/services/push.js';
setPushSender(async () => {});            // harness: pretend the push service accepts everything
const db = openDb(config.dbPath), app = express();
app.get('/__test/otp', (req, res) => res.json(testOutbox.at(-1) || null));
app.use(createApp(db));
app.listen(Number(process.env.PORT || 8123), () => console.log('ready'));
