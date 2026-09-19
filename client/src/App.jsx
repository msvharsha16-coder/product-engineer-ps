import React, { useEffect, useRef, useState } from 'react';
import { createConversation, streamTurn, cancelTurn } from './api.js';
import TraceView from './components/TraceView.jsx';
import StatusBadge from './components/StatusBadge.jsx';

export default function App() {
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]); 
  const [input, setInput] = useState('');
  const [timeoutMs, setTimeoutMs] = useState(10000);

  const [status, setStatus] = useState('idle');
  const [currentTurnId, setCurrentTurnId] = useState(null);
  const [streamingText, setStreamingText] = useState('');
  const [lastOutcome, setLastOutcome] = useState(null); 
  const [trace, setTrace] = useState(null);

  const busy = status === 'pending' || status === 'streaming';
  const bottomRef = useRef(null);

  useEffect(() => {
    createConversation().then(setConversationId);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  async function handleSend() {
    if (!input.trim() || busy || !conversationId) return;
    const userText = input;
    setMessages((m) => [...m, { role: 'user', text: userText }]);
    setInput('');
    setStreamingText('');
    setLastOutcome(null);
    setTrace(null);
    setStatus('pending');

    await streamTurn(conversationId, userText, Number(timeoutMs) || undefined, {
      onStarted: ({ turnId }) => {
        setCurrentTurnId(turnId);
        setStatus('streaming');
      },
      onChunk: ({ chunk }) => {
        setStreamingText((prev) => prev + chunk);
      },
      onTerminal: ({ record, trace: finalTrace }) => {
        setTrace(finalTrace);
        setStatus(record.status);
        setCurrentTurnId(null);
        if (record.status === 'completed') {
          setMessages((m) => [...m, { role: 'assistant', text: record.completedOutput }]);
          setStreamingText('');
        } else {
          setLastOutcome({
            status: record.status,
            reason: record.rejectionReason,
            error: record.error,
            partialOutput: record.partialOutput,
          });
        }
      },
    });
  }

  async function handleCancel() {
    if (!currentTurnId) return;
    await cancelTurn(currentTurnId);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Caygnus  AI</h1>
        <p className="subtitle">
         Problem 5: Reliable AI Conversation Runtime
        </p>
      </header>

      <main className="layout">
        <section className="chat-panel">
          <div className="messages">
            {messages.map((m, i) => (
              <div key={i} className={`bubble bubble-${m.role}`}>
                <div className="bubble-role">{m.role === 'user' ? 'You' : 'Assistant'}</div>
                <div className="bubble-text">{m.text}</div>
              </div>
            ))}

            {status === 'streaming' && (
              <div className="bubble bubble-assistant bubble-streaming">
                <div className="bubble-role">Assistant</div>
                <div className="bubble-text">
                  {streamingText}
                  <span className="cursor">▍</span>
                </div>
              </div>
            )}

            {lastOutcome && lastOutcome.status !== 'completed' && (
              <div className={`outcome outcome-${lastOutcome.status}`}>
                <StatusBadge status={lastOutcome.status} />
                {lastOutcome.status === 'rejected' && <span> — {lastOutcome.reason}</span>}
                {lastOutcome.status === 'failed' && <span> — {lastOutcome.error}</span>}
                {(lastOutcome.status === 'cancelled' || lastOutcome.status === 'timed_out') &&
                  lastOutcome.partialOutput && (
                    <div className="partial-output">
                      Partial output received before {lastOutcome.status.replace('_', ' ')} (not saved to the
                      conversation):
                      <div className="partial-output-text">{lastOutcome.partialOutput}</div>
                    </div>
                  )}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="composer">
            <div className="composer-row">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder='Try a normal message, or "blocked_test_input" to see a policy rejection...'
                rows={2}
                disabled={busy}
              />
            </div>
            <div className="composer-controls">
              <label className="timeout-label">
                Timeout (ms)
                <input
                  type="number"
                  value={timeoutMs}
                  onChange={(e) => setTimeoutMs(e.target.value)}
                  min={100}
                  step={100}
                  disabled={busy}
                />
              </label>
              <StatusBadge status={status} />
              {busy ? (
                <button className="btn btn-danger" onClick={handleCancel}>
                  Cancel
                </button>
              ) : (
                <button className="btn btn-primary" onClick={handleSend} disabled={!input.trim()}>
                  Send
                </button>
              )}
            </div>
          </div>
        </section>

        <aside className="trace-panel">
          <h2>Operational trace</h2>
          <p className="trace-hint">Ordered runtime events for the current or most recent turn.</p>
          <TraceView trace={trace} />
        </aside>
      </main>
    </div>
  );
}
