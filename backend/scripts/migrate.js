import { config } from '../src/config.js';
import { openDb } from '../src/db/index.js';
openDb(config.dbPath).close(); console.log('Migrations applied.');
