import React from 'react';

const TYPE_COLORS = {
  turn_created: '#64748b',
  policy_check_started: '#64748b',
  policy_accepted: '#0f766e',
  policy_rejected: '#b91c1c',
  provider_invoked: '#1d4ed8',
  provider_chunk: '#334155',
  provider_finished: '#0f766e',
  provider_error: '#b91c1c',
  cancelled: '#b45309',
  cancel_ignored: '#94a3b8',
  timeout: '#b45309',
  completion_ignored: '#94a3b8',
  provider_error_ignored: '#94a3b8',
  terminal: '#111827',
};

function eventLabel(event) {
  switch (event.type) {
    case 'provider_chunk':
      return `provider_chunk (${event.data.length} chars)`;
    case 'terminal':
      return `terminal → ${event.data.status}`;
    case 'timeout':
      return `timeout (${event.data.timeoutMs}ms deadline)`;
    case 'policy_rejected':
      return `policy_rejected: ${event.data.reason}`;
    case 'provider_error':
      return `provider_error: ${event.data.message}`;
    default:
      return event.type;
  }
}

export default function TraceView({ trace }) {
  if (!trace || trace.events.length === 0) {
    return <div className="trace-empty">No trace yet — send a message to start a turn.</div>;
  }
  return (
    <ol className="trace-list">
      {trace.events.map((event) => (
        <li key={event.seq} className="trace-row">
          <span className="trace-seq">{event.seq}</span>
          <span className="trace-dot" style={{ background: TYPE_COLORS[event.type] || '#94a3b8' }} />
          <span className="trace-type">{eventLabel(event)}</span>
        </li>
      ))}
    </ol>
  );
}
