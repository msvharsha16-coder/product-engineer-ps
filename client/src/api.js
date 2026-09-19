const BASE = '/api';

export async function createConversation() {
  const res = await fetch(`${BASE}/conversations`, { method: 'POST' });
  const data = await res.json();
  return data.conversationId;
}

export async function cancelTurn(turnId) {
  const res = await fetch(`${BASE}/turns/${turnId}/cancel`, { method: 'POST' });
  return res.json();
}

export async function streamTurn(conversationId, input, timeoutMs, { onStarted, onChunk, onTerminal }) {
  const res = await fetch(`${BASE}/conversations/${conversationId}/turns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input, timeoutMs }),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIndex;
    while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);

      const eventLine = rawEvent.split('\n').find((l) => l.startsWith('event: '));
      const dataLine = rawEvent.split('\n').find((l) => l.startsWith('data: '));
      if (!eventLine || !dataLine) continue;

      const type = eventLine.slice('event: '.length).trim();
      const data = JSON.parse(dataLine.slice('data: '.length));

      if (type === 'turn_started' && onStarted) onStarted(data);
      if (type === 'chunk' && onChunk) onChunk(data);
      if (type === 'terminal' && onTerminal) onTerminal(data);
    }
  }
}
