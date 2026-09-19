'use strict';

const SECRET_KEYS = new Set([
  'apiKey',
  'api_key',
  'token',
  'secret',
  'password',
  'authorization',
  'hiddenReasoning',
  'hidden_reasoning',
  'chainOfThought',
  'chain_of_thought',
  'reasoning',
]);

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.has(k) ? '[REDACTED]' : redact(v);
    }
    return out;
  }
  return value;
}

/**
 * Trace
 *
 * An append-only, ordered log of operational events for one turn.
 * "Operational" is the key word: event types describe *what the runtime
 * did* (state entered, provider called, chunk received, error raised,
 * terminal reached) — never the model's private reasoning or raw secret
 * config. `record()` redacts known-secret field names before the event
 * is ever stored, so nothing downstream (API responses, logs, the
 * benchmark) can leak them even by accident.
 *
 * Once a terminal event has been recorded, further `record()` calls are
 * refused (AC7 / "no events appear after a terminal event") rather than
 * silently accepted — this is asserted directly in tests.
 */
class Trace {
  constructor(turnId) {
    this.turnId = turnId;
    this.events = [];
    this._sealed = false;
  }

  record(type, data = {}) {
    if (this._sealed) {

      return { ok: false, reason: 'trace is sealed: a terminal event was already recorded' };
    }
    const event = {
      seq: this.events.length,
      type,
      at: Date.now(),
      data: redact(data),
    };
    this.events.push(event);
    if (type === 'terminal') {
      this._sealed = true;
    }
    return { ok: true, event };
  }

  toJSON() {
    return { turnId: this.turnId, events: this.events };
  }
}

module.exports = { Trace, redact, SECRET_KEYS };
