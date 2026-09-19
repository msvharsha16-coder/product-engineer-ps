'use strict';

const STATES = Object.freeze({
  PENDING: 'pending',
  POLICY_CHECK: 'policy_check',
  STREAMING: 'streaming',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
  TIMED_OUT: 'timed_out',
  FAILED: 'failed',
});

const TERMINAL_STATES = new Set([
  STATES.COMPLETED,
  STATES.REJECTED,
  STATES.CANCELLED,
  STATES.TIMED_OUT,
  STATES.FAILED,
]);


const ALLOWED_TRANSITIONS = {
  [STATES.PENDING]: [STATES.POLICY_CHECK],
  [STATES.POLICY_CHECK]: [STATES.STREAMING, STATES.REJECTED],
  [STATES.STREAMING]: [STATES.COMPLETED, STATES.CANCELLED, STATES.TIMED_OUT, STATES.FAILED],
};


class TurnStateMachine {
  constructor(turnId) {
    this.turnId = turnId;
    this.state = STATES.PENDING;
    this.history = [{ state: this.state, at: Date.now() }];
  }

  isTerminal() {
    return TERMINAL_STATES.has(this.state);
  }


  transition(nextState) {
    if (this.isTerminal()) {
      return { ok: false, reason: `already terminal at '${this.state}', cannot move to '${nextState}'` };
    }
    const allowed = ALLOWED_TRANSITIONS[this.state] || [];
    if (!allowed.includes(nextState)) {
      return { ok: false, reason: `illegal transition '${this.state}' -> '${nextState}'` };
    }
    this.state = nextState;
    this.history.push({ state: nextState, at: Date.now() });
    return { ok: true };
  }
}

module.exports = { STATES, TERMINAL_STATES, TurnStateMachine };
