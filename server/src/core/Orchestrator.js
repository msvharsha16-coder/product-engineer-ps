'use strict';

const { STATES, TurnStateMachine } = require('./StateMachine');
const { Trace } = require('./Trace');
const { checkPolicy } = require('./Policy');

const DEFAULT_TIMEOUT_MS = 10_000;

class Orchestrator {
  constructor({ store, policy = checkPolicy } = {}) {
    if (!store) throw new Error('Orchestrator requires a store');
    this.store = store;
    this.policy = policy;
    this.active = new Map(); 
  }

  getTrace(turnId) {
    const entry = this.active.get(turnId);
    return entry ? entry.trace : null;
  }

  
  cancel(turnId, reason = 'cancelled by caller') {
    const entry = this.active.get(turnId);
    if (!entry) return { ok: false, reason: 'unknown or already-cleaned-up turnId' };
    const { machine, trace, controller } = entry;
    const result = machine.transition(STATES.CANCELLED);
    if (!result.ok) {
      trace.record('cancel_ignored', { reason: result.reason });
      return { ok: false, reason: result.reason };
    }
    trace.record('cancelled', { reason });
    controller.abort();
    return { ok: true };
  }


  async execute({ turnId, conversationId, input, provider, timeoutMs = DEFAULT_TIMEOUT_MS, onChunk }) {
    const machine = new TurnStateMachine(turnId);
    const trace = new Trace(turnId);
    const controller = new AbortController();
    this.active.set(turnId, { machine, trace, controller, timeoutHandle: null });

    const createdAt = Date.now();
    this.store.createTurn({ turnId, conversationId, input, createdAt });
    trace.record('turn_created', { turnId, conversationId });

    // --- PENDING -> POLICY_CHECK -------------------------------------
    machine.transition(STATES.POLICY_CHECK);
    trace.record('policy_check_started', {});
    const decision = this.policy(input);

    if (!decision.accepted) {
      machine.transition(STATES.REJECTED);
      this.store.commitRejected(turnId, decision.reason);
      trace.record('policy_rejected', { reason: decision.reason });
      trace.record('terminal', { status: STATES.REJECTED });
      this.active.delete(turnId);
      return { record: this.store.getTurn(turnId), trace };
    }
    trace.record('policy_accepted', {});


    machine.transition(STATES.STREAMING);
    trace.record('provider_invoked', { timeoutMs });

    const timeoutHandle = setTimeout(() => {
      const result = machine.transition(STATES.TIMED_OUT);
      if (result.ok) {
        trace.record('timeout', { timeoutMs });
        controller.abort();
      }

    }, timeoutMs);
    this.active.get(turnId).timeoutHandle = timeoutHandle;

    let accumulated = '';
    try {
      for await (const chunk of provider.stream({ signal: controller.signal, input })) {
        accumulated += chunk;
        trace.record('provider_chunk', { length: chunk.length });
        if (onChunk) onChunk(chunk);
      }

      const result = machine.transition(STATES.COMPLETED);
      clearTimeout(timeoutHandle);
      if (result.ok) {
        this.store.commitCompleted(turnId, { conversationId, text: accumulated, at: Date.now() });
        trace.record('provider_finished', { totalLength: accumulated.length });
        trace.record('terminal', { status: STATES.COMPLETED });
      } else {
        // e.g. timeout fired in the same tick the last chunk resolved.
        trace.record('completion_ignored', { reason: result.reason });
        this.store.commitNonSuccess(turnId, { status: machine.state, partialOutput: accumulated });
        trace.record('terminal', { status: machine.state });
      }
    } catch (err) {
      clearTimeout(timeoutHandle);
      if (err && err.name === 'AbortError') {
       
        this.store.commitNonSuccess(turnId, { status: machine.state, partialOutput: accumulated });
        trace.record('terminal', { status: machine.state, partialLength: accumulated.length });
      } else {
        const result = machine.transition(STATES.FAILED);
        this.store.commitNonSuccess(turnId, {
          status: machine.isTerminal() ? machine.state : STATES.FAILED,
          partialOutput: accumulated,
          error: String(err && err.message ? err.message : err),
        });
        if (result.ok) {
          trace.record('provider_error', { message: String(err && err.message ? err.message : err) });
          trace.record('terminal', { status: STATES.FAILED });
        } else {
          trace.record('provider_error_ignored', { reason: result.reason });
        }
      }
    }

    this.active.delete(turnId);
    return { record: this.store.getTurn(turnId), trace };
  }
}

module.exports = { Orchestrator, DEFAULT_TIMEOUT_MS };
