'use strict';

class OpenAIProvider {
  constructor({ apiKey = process.env.OPENAI_API_KEY, model = 'gpt-4o-mini', systemPrompt } = {}) {
    if (!apiKey) {
      throw new Error('OpenAIProvider requires an API key (OPENAI_API_KEY env var, or apiKey option)');
    }
    this.apiKey = apiKey;
    this.model = model;
    this.systemPrompt = systemPrompt;
  }

  async *stream({ signal, input } = {}) {
    const text = typeof input === 'string' ? input : String(input?.text ?? input ?? '');
    const messages = [];
    if (this.systemPrompt) messages.push({ role: 'system', content: this.systemPrompt });
    messages.push({ role: 'user', content: text });

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, messages, stream: true }),
      signal,
    });

    if (!res.ok || !res.body) {
      const bodyText = await res.text().catch(() => '');
      // Never let the API key leak into an error message even indirectly.
      throw new Error(`OpenAI request failed: ${res.status} ${res.statusText} ${bodyText}`.trim());
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sepIndex;
        while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, sepIndex);
          buffer = buffer.slice(sepIndex + 2);

          const dataLine = rawEvent.split('\n').find((l) => l.startsWith('data: '));
          if (!dataLine) continue;
          const payload = dataLine.slice('data: '.length).trim();
          if (payload === '[DONE]') return;

          let parsed;
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue; 
          }
          const delta = parsed?.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        }
      }
    } finally {

      try {
        reader.releaseLock();
      } catch {
        /* already released */
      }
    }
  }
}

module.exports = { OpenAIProvider };
