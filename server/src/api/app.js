'use strict';

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const { Store } = require('../core/Store');
const { Orchestrator } = require('../core/Orchestrator');
const { FakeProvider } = require('../core/FakeProvider');
const { OpenAIProvider } = require('../core/OpenAIProvider');

function buildProvider() {

  if (process.env.OPENAI_API_KEY) {
    return new OpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      systemPrompt: process.env.OPENAI_SYSTEM_PROMPT || 'You are a concise, helpful assistant.',
    });
  }
  return new FakeProvider({
    chunks: ['Thinking', ' about', ' your', ' request', '...', ' Here', ' is', ' my', ' answer', '.'],
    chunkDelayMs: 120,
  });
}

function createApp({ store = new Store(), orchestrator, provider = buildProvider() } = {}) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const runtime = orchestrator || new Orchestrator({ store });

  app.post('/api/conversations', (req, res) => {
    res.json({ conversationId: crypto.randomUUID() });
  });

  app.get('/api/conversations/:conversationId/messages', (req, res) => {
    res.json({ messages: store.getConversationMessages(req.params.conversationId) });
  });

  app.post('/api/conversations/:conversationId/turns', async (req, res) => {
    const { conversationId } = req.params;
    const { input, timeoutMs } = req.body || {};
    const turnId = crypto.randomUUID();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Turn-Id': turnId,
    });
    res.write(`event: turn_started\ndata: ${JSON.stringify({ turnId })}\n\n`);

    const { record, trace } = await runtime.execute({
      turnId,
      conversationId,
      input,
      provider,
      timeoutMs: timeoutMs || undefined,
      onChunk: (chunk) => {
        res.write(`event: chunk\ndata: ${JSON.stringify({ chunk })}\n\n`);
      },
    });

    res.write(`event: terminal\ndata: ${JSON.stringify({ record, trace: trace.toJSON() })}\n\n`);
    res.end();
  });

  app.post('/api/turns/:turnId/cancel', (req, res) => {
    const result = runtime.cancel(req.params.turnId, 'cancelled via API');
    res.json(result);
  });

  app.get('/api/turns/:turnId', (req, res) => {
    const record = store.getTurn(req.params.turnId);
    if (!record) return res.status(404).json({ error: 'not found' });
    const trace = runtime.getTrace(req.params.turnId);
    res.json({ record, trace: trace ? trace.toJSON() : null });
  });

  return { app, store, runtime };
}

module.exports = { createApp };
