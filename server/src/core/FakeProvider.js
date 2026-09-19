'use strict';

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * FakeProvider
 *
 * A deterministic, fully controllable stand-in for a real streaming model
 * provider. No network calls, no wall-clock sleeps beyond `setTimeout`
 * (which is why tests can drive it with Jest fake timers instead of real
 * waits). Every scenario the benchmark/tests need is a plain config knob:
 *
 *   chunks            string[]  — chunks to emit, in order
 *   chunkDelayMs       number   — delay before each chunk (default 5)
 *   failAfterChunks    number|null — after emitting this many chunks, throw
 *   failError          Error    — the error to throw (default: generic)
 *   hangAfterChunks    number|null — after this many chunks, delay far
 *                                    longer than any reasonable timeout
 *                                    (used to exercise AC4 deterministically)
 *   hangDelayMs        number   — how long the "hang" delay is
 *
 * `stream()` is an async generator. It checks `signal.aborted` before
 * scheduling each chunk's delay and rejects immediately once aborted, so
 * cancellation stops provider consumption promptly rather than draining
 * the rest of the configured chunks.
 */
class FakeProvider {
  constructor(config = {}) {
    this.config = {
      chunks: ['Hello', ', ', 'world', '!'],
      chunkDelayMs: 5,
      failAfterChunks: null,
      failError: new Error('simulated provider failure'),
      hangAfterChunks: null,
      hangDelayMs: 60_000,
      ...config,
    };
  }

  async *stream({ signal } = {}) {
    const { chunks, chunkDelayMs, failAfterChunks, failError, hangAfterChunks, hangDelayMs } = this.config;

    for (let i = 0; i < chunks.length; i++) {
      if (signal?.aborted) {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      }

      const isHangPoint = hangAfterChunks !== null && i === hangAfterChunks;
      await delay(isHangPoint ? hangDelayMs : chunkDelayMs, signal);

      if (signal?.aborted) {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      }

      yield chunks[i];

      if (failAfterChunks !== null && i + 1 === failAfterChunks) {
        throw failError;
      }
    }
  }
}

module.exports = { FakeProvider };
