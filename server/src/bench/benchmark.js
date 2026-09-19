#!/usr/bin/env node
'use strict';

/**
 * Verification benchmark (spec: "Verification benchmark").
 *
 * Runs N iterations each of: successful completion, policy rejection,
 * cancellation during streaming, timeout, and provider failure after
 * partial output — all against the deterministic FakeProvider, no live
 * model, no network. For every run it checks:
 *
 *   - exactly one terminal state
 *   - rejected runs never invoke the provider
 *   - cancelled / timed_out / failed runs never contain a successful
 *     persisted assistant response
 *   - no trace events appear after the terminal event
 *
 * Usage: `npm run bench` (from server/), or `node src/bench/benchmark.js [N]`
 */

const crypto = require('crypto');
const { Store } = require('../core/Store');
const { Orchestrator } = require('../core/Orchestrator');
const { FakeProvider } = require('../core/FakeProvider');

const ITERATIONS = Number(process.argv[2]) || 10;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function checkNoEventsAfterTerminal(trace) {
  const idx = trace.events.findIndex((e) => e.type === 'terminal');
  if (idx === -1) return false; // every terminal run must have a terminal event
  return idx === trace.events.length - 1;
}

async function runSuccess() {
  const store = new Store();
  const orchestrator = new Orchestrator({ store });
  const provider = new FakeProvider({ chunks: ['ok', ' ', 'done'], chunkDelayMs: 1 });
  const turnId = crypto.randomUUID();
  const { record, trace } = await orchestrator.execute({
    turnId,
    conversationId: 'bench-success',
    input: 'benchmark success case',
    provider,
  });
  return {
    status: record.status,
    providerInvoked: true,
    hasAssistantMessage: store.getConversationMessages('bench-success').some((m) => m.role === 'assistant'),
    trace,
  };
}

async function runRejection() {
  const store = new Store();
  const orchestrator = new Orchestrator({ store });
  let providerInvoked = false;
  const provider = {
    async *stream() {
      providerInvoked = true;
      yield 'should never run';
    },
  };
  const turnId = crypto.randomUUID();
  const { record, trace } = await orchestrator.execute({
    turnId,
    conversationId: 'bench-rejection',
    input: 'this contains blocked_test_input',
    provider,
  });
  return {
    status: record.status,
    providerInvoked,
    hasAssistantMessage: store.getConversationMessages('bench-rejection').some((m) => m.role === 'assistant'),
    trace,
  };
}

async function runCancellation() {
  const store = new Store();
  const orchestrator = new Orchestrator({ store });
  const provider = new FakeProvider({ chunks: ['a', 'b', 'c', 'd', 'e'], chunkDelayMs: 15 });
  const turnId = crypto.randomUUID();
  const execPromise = orchestrator.execute({
    turnId,
    conversationId: 'bench-cancel',
    input: 'benchmark cancellation case',
    provider,
    timeoutMs: 5000,
  });
  await sleep(25);
  orchestrator.cancel(turnId);
  const { record, trace } = await execPromise;
  return {
    status: record.status,
    providerInvoked: true,
    hasAssistantMessage: store.getConversationMessages('bench-cancel').some((m) => m.role === 'assistant'),
    trace,
  };
}

async function runTimeout() {
  const store = new Store();
  const orchestrator = new Orchestrator({ store });
  const provider = new FakeProvider({
    chunks: ['x', 'y'],
    chunkDelayMs: 5,
    hangAfterChunks: 1,
    hangDelayMs: 5000,
  });
  const turnId = crypto.randomUUID();
  const { record, trace } = await orchestrator.execute({
    turnId,
    conversationId: 'bench-timeout',
    input: 'benchmark timeout case',
    provider,
    timeoutMs: 40,
  });
  return {
    status: record.status,
    providerInvoked: true,
    hasAssistantMessage: store.getConversationMessages('bench-timeout').some((m) => m.role === 'assistant'),
    trace,
  };
}

async function runFailure() {
  const store = new Store();
  const orchestrator = new Orchestrator({ store });
  const provider = new FakeProvider({
    chunks: ['partial ', 'output ', 'more'],
    chunkDelayMs: 1,
    failAfterChunks: 2,
    failError: new Error('benchmark simulated failure'),
  });
  const turnId = crypto.randomUUID();
  const { record, trace } = await orchestrator.execute({
    turnId,
    conversationId: 'bench-failure',
    input: 'benchmark failure case',
    provider,
  });
  return {
    status: record.status,
    providerInvoked: true,
    hasAssistantMessage: store.getConversationMessages('bench-failure').some((m) => m.role === 'assistant'),
    trace,
  };
}

const SCENARIOS = [
  { name: 'success', run: runSuccess, expectedStatus: 'completed', providerMustBeInvoked: true, assistantMessageAllowed: true },
  { name: 'rejection', run: runRejection, expectedStatus: 'rejected', providerMustBeInvoked: false, assistantMessageAllowed: false },
  { name: 'cancellation', run: runCancellation, expectedStatus: 'cancelled', providerMustBeInvoked: true, assistantMessageAllowed: false },
  { name: 'timeout', run: runTimeout, expectedStatus: 'timed_out', providerMustBeInvoked: true, assistantMessageAllowed: false },
  { name: 'failure', run: runFailure, expectedStatus: 'failed', providerMustBeInvoked: true, assistantMessageAllowed: false },
];

async function main() {
  console.log(`Running verification benchmark: ${ITERATIONS} iterations x ${SCENARIOS.length} scenarios\n`);

  let violations = 0;
  const summary = {};

  for (const scenario of SCENARIOS) {
    const counts = {};
    let providerNeverInvokedViolations = 0;
    let unexpectedAssistantMessageViolations = 0;
    let traceOrderingViolations = 0;
    let notExactlyOneTerminalViolations = 0;

    for (let i = 0; i < ITERATIONS; i++) {
      const result = await scenario.run();
      counts[result.status] = (counts[result.status] || 0) + 1;

      if (result.status !== scenario.expectedStatus) {
        notExactlyOneTerminalViolations += 1;
      }
      if (!scenario.providerMustBeInvoked && result.providerInvoked) {
        providerNeverInvokedViolations += 1;
      }
      if (!scenario.assistantMessageAllowed && result.hasAssistantMessage) {
        unexpectedAssistantMessageViolations += 1;
      }
      if (!checkNoEventsAfterTerminal(result.trace)) {
        traceOrderingViolations += 1;
      }
    }

    const scenarioViolations =
      notExactlyOneTerminalViolations +
      providerNeverInvokedViolations +
      unexpectedAssistantMessageViolations +
      traceOrderingViolations;
    violations += scenarioViolations;

    summary[scenario.name] = {
      terminalStateCounts: counts,
      violations: scenarioViolations,
    };

    console.log(`Scenario: ${scenario.name}`);
    console.log(`  terminal state counts: ${JSON.stringify(counts)}`);
    console.log(`  unexpected-status count: ${notExactlyOneTerminalViolations}`);
    console.log(`  provider-invoked-when-rejected violations: ${providerNeverInvokedViolations}`);
    console.log(`  unexpected-assistant-message violations: ${unexpectedAssistantMessageViolations}`);
    console.log(`  events-after-terminal violations: ${traceOrderingViolations}`);
    console.log('');
  }

  console.log('--- Summary ---');
  console.log(JSON.stringify(summary, null, 2));

  if (violations > 0) {
    console.error(`\nFAILED: ${violations} invariant violation(s) detected.`);
    process.exitCode = 1;
  } else {
    console.log(`\nOK: all invariants held across ${ITERATIONS * SCENARIOS.length} runs.`);
    process.exitCode = 0;
  }
}

main();
