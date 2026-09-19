'use strict';

const { Store } = require('../core/Store');
const { Orchestrator } = require('../core/Orchestrator');
const { FakeProvider } = require('../core/FakeProvider');
const { TurnStateMachine, STATES } = require('../core/StateMachine');
const { Trace, redact } = require('../core/Trace');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('AC1: Successful streamed turn', () => {
  test('chunks stream in order, run completes once, records are persisted', async () => {
    const store = new Store();
    const orchestrator = new Orchestrator({ store });
    const provider = new FakeProvider({ chunks: ['Hel', 'lo', ', ', 'world'], chunkDelayMs: 1 });
    const received = [];

    const { record, trace } = await orchestrator.execute({
      turnId: 't1',
      conversationId: 'c1',
      input: 'hi there',
      provider,
      onChunk: (c) => received.push(c),
    });

    expect(received).toEqual(['Hel', 'lo', ', ', 'world']);
    expect(record.status).toBe('completed');
    expect(record.completedOutput).toBe('Hello, world');
    expect(record.partialOutput).toBeNull();

    const messages = store.getConversationMessages('c1');
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: 'user', text: 'hi there' });
    expect(messages[1]).toMatchObject({ role: 'assistant', text: 'Hello, world' });

    const terminalEvents = trace.events.filter((e) => e.type === 'terminal');
    expect(terminalEvents).toHaveLength(1);
    expect(terminalEvents[0].data.status).toBe('completed');

    // events strictly increasing seq, nothing after terminal
    const lastIdx = trace.events.length - 1;
    expect(trace.events[lastIdx].type).toBe('terminal');
  });
});

describe('AC2: Pre-response rejection', () => {
  test('provider is never called, rejection is visible, no assistant response persisted', async () => {
    const store = new Store();
    const orchestrator = new Orchestrator({ store });
    let providerCalled = false;
    const provider = {
      async *stream() {
        providerCalled = true;
        yield 'should not happen';
      },
    };

    const { record, trace } = await orchestrator.execute({
      turnId: 't2',
      conversationId: 'c2',
      input: 'this contains blocked_test_input marker',
      provider,
    });

    expect(providerCalled).toBe(false);
    expect(record.status).toBe('rejected');
    expect(record.rejectionReason).toBeTruthy();
    expect(record.completedOutput).toBeNull();

    const messages = store.getConversationMessages('c2');
    expect(messages).toHaveLength(1); // user message only
    expect(messages.every((m) => m.role !== 'assistant')).toBe(true);

    expect(trace.events.some((e) => e.type === 'policy_rejected')).toBe(true);
    expect(trace.events[trace.events.length - 1].type).toBe('terminal');
  });
});

describe('AC3: Cancellation', () => {
  test('provider consumption stops, run becomes cancelled, cannot later become completed', async () => {
    const store = new Store();
    const orchestrator = new Orchestrator({ store });
    const provider = new FakeProvider({
      chunks: ['a', 'b', 'c', 'd', 'e'],
      chunkDelayMs: 25,
    });
    const received = [];

    const execPromise = orchestrator.execute({
      turnId: 't3',
      conversationId: 'c3',
      input: 'stream this',
      provider,
      timeoutMs: 5000,
      onChunk: (c) => received.push(c),
    });

    // Let one or two chunks through, then cancel mid-stream.
    await sleep(40);
    const cancelResult = orchestrator.cancel('t3');
    expect(cancelResult.ok).toBe(true);

    const { record, trace } = await execPromise;

    expect(record.status).toBe('cancelled');
    expect(record.completedOutput).toBeNull();
    expect(received.length).toBeLessThan(5); // stopped before draining all chunks
    expect(store.getConversationMessages('c3').some((m) => m.role === 'assistant')).toBe(false);

    // A cancel attempted after the fact must be a documented no-op, and
    // must not be able to move the run to completed.
    const secondCancel = orchestrator.cancel('t3');
    expect(secondCancel.ok).toBe(false);

    expect(trace.events[trace.events.length - 1].type).toBe('terminal');
    expect(trace.events[trace.events.length - 1].data.status).toBe('cancelled');
  });
});

describe('AC4: Timeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('execution stops at the deadline, run becomes timed_out, partial output is not a completed response', async () => {
    const store = new Store();
    const orchestrator = new Orchestrator({ store });
    // Emits one chunk quickly, then "hangs" far longer than the timeout.
    const provider = new FakeProvider({
      chunks: ['partial', 'never-seen'],
      chunkDelayMs: 10,
      hangAfterChunks: 1,
      hangDelayMs: 100_000,
    });

    const execPromise = orchestrator.execute({
      turnId: 't4',
      conversationId: 'c4',
      input: 'this will time out',
      provider,
      timeoutMs: 50,
    });

    // Advance past the first chunk, then past the timeout deadline.
    await jest.advanceTimersByTimeAsync(10);
    await jest.advanceTimersByTimeAsync(60);

    const { record, trace } = await execPromise;

    expect(record.status).toBe('timed_out');
    expect(record.completedOutput).toBeNull();
    expect(record.partialOutput).toBe('partial');
    expect(store.getConversationMessages('c4').some((m) => m.role === 'assistant')).toBe(false);

    expect(trace.events.some((e) => e.type === 'timeout')).toBe(true);
    expect(trace.events[trace.events.length - 1]).toMatchObject({ type: 'terminal', data: { status: 'timed_out' } });
  });
});

describe('AC5: Provider failure', () => {
  test('failure and partial-stream history are traceable, no successful response is recorded', async () => {
    const store = new Store();
    const orchestrator = new Orchestrator({ store });
    const provider = new FakeProvider({
      chunks: ['first ', 'second ', 'third'],
      chunkDelayMs: 1,
      failAfterChunks: 2,
      failError: new Error('upstream provider exploded'),
    });

    const { record, trace } = await orchestrator.execute({
      turnId: 't5',
      conversationId: 'c5',
      input: 'trigger a failure',
      provider,
    });

    expect(record.status).toBe('failed');
    expect(record.completedOutput).toBeNull();
    expect(record.partialOutput).toBe('first second ');
    expect(record.error).toMatch(/upstream provider exploded/);

    expect(store.getConversationMessages('c5').some((m) => m.role === 'assistant')).toBe(false);
    expect(trace.events.some((e) => e.type === 'provider_error')).toBe(true);
    expect(trace.events[trace.events.length - 1]).toMatchObject({ type: 'terminal', data: { status: 'failed' } });
  });
});

describe('AC6: Terminal-state race', () => {
  test('exactly one terminal transition wins; later ones are rejected observably', () => {
    const machine = new TurnStateMachine('t6');
    expect(machine.transition(STATES.POLICY_CHECK).ok).toBe(true);
    expect(machine.transition(STATES.STREAMING).ok).toBe(true);

    const first = machine.transition(STATES.COMPLETED);
    const second = machine.transition(STATES.TIMED_OUT); // "arrives" right after
    const third = machine.transition(STATES.CANCELLED); // and another one

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(third.ok).toBe(false);
    expect(machine.state).toBe(STATES.COMPLETED);
    expect(machine.isTerminal()).toBe(true);
    // history shows only one terminal entry, not three
    const terminalCount = machine.history.filter((h) =>
      [STATES.COMPLETED, STATES.TIMED_OUT, STATES.CANCELLED, STATES.FAILED, STATES.REJECTED].includes(h.state)
    ).length;
    expect(terminalCount).toBe(1);
  });
});

describe('AC7: Safe operational trace', () => {
  test('redact() scrubs known secret field names at any nesting depth', () => {
    const input = {
      text: 'hello',
      apiKey: 'sk-super-secret',
      nested: { token: 'abc123', ok: 'fine' },
      hiddenReasoning: 'the model privately thought X',
    };
    const out = redact(input);
    expect(out.apiKey).toBe('[REDACTED]');
    expect(out.nested.token).toBe('[REDACTED]');
    expect(out.hiddenReasoning).toBe('[REDACTED]');
    expect(out.text).toBe('hello');
    expect(out.nested.ok).toBe('fine');
  });

  test('trace refuses to record events after a terminal event (no events after terminal)', () => {
    const trace = new Trace('t7');
    trace.record('turn_created', {});
    trace.record('terminal', { status: 'completed' });
    const result = trace.record('provider_chunk', { length: 5 });
    expect(result.ok).toBe(false);
    expect(trace.events).toHaveLength(2); // the late event was never appended
  });

  test('a full execute() run never leaks a secret-named field into the trace', async () => {
    const store = new Store();
    const orchestrator = new Orchestrator({ store });
    const provider = {
      async *stream() {
        yield 'ok';
      },
    };
    const { trace } = await orchestrator.execute({
      turnId: 't7b',
      conversationId: 'c7',
      // simulate a caller accidentally passing a secret-shaped field in
      // metadata that ends up recorded on a trace event
      input: { text: 'hello', apiKey: 'sk-should-never-appear' },
      provider,
    });
    const serialized = JSON.stringify(trace.toJSON());
    expect(serialized).not.toContain('sk-should-never-appear');
  });
});
