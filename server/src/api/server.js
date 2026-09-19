'use strict';

const fs = require('fs');
const path = require('path');


function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

const { createApp } = require('./app');

const PORT = process.env.PORT || 4000;
const { app } = createApp();

const providerMode = process.env.OPENAI_API_KEY
  ? `OpenAI (${process.env.OPENAI_MODEL || 'gpt-4o-mini'})`
  : 'FakeProvider (no OPENAI_API_KEY set)';

app.listen(PORT, () => {
  console.log(`Reliable AI Conversation Runtime server listening on http://localhost:${PORT}`);
  console.log(`Provider: ${providerMode}`);
});
