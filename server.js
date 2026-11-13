// Entry file for hosts that build from the repository root (Hostinger web apps: set the entry file to server.js).
// Dependencies come from the root package.json, which must list exactly the backend's (checked by backend/test/hosting.test.js).
import './backend/src/server.js';
