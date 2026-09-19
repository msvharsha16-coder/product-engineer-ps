'use strict';


class Store {
  constructor() {
    this.turns = new Map();
    this.messages = [];
  }

  createTurn({ turnId, conversationId, input, createdAt }) {
    const record = {
      turnId,
      conversationId,
      input,
      status: 'pending',
      completedOutput: null,
      partialOutput: null,
      rejectionReason: null,
      error: null,
      createdAt,
      updatedAt: createdAt,
    };
    this.turns.set(turnId, record);
    this.messages.push({ role: 'user', turnId, conversationId, text: input, at: createdAt });
    return record;
  }

  updateTurn(turnId, patch) {
    const record = this.turns.get(turnId);
    if (!record) throw new Error(`unknown turnId: ${turnId}`);
    Object.assign(record, patch, { updatedAt: Date.now() });
    return record;
  }

  commitCompleted(turnId, { conversationId, text, at }) {
    this.updateTurn(turnId, { status: 'completed', completedOutput: text });
    this.messages.push({ role: 'assistant', turnId, conversationId, text, at });
  }

  commitRejected(turnId, reason) {
    this.updateTurn(turnId, { status: 'rejected', rejectionReason: reason });
  }

  commitNonSuccess(turnId, { status, partialOutput, error }) {

    this.updateTurn(turnId, { status, partialOutput: partialOutput ?? null, error: error ?? null });
  }

  getTurn(turnId) {
    return this.turns.get(turnId) || null;
  }

  getConversationMessages(conversationId) {
    return this.messages.filter((m) => m.conversationId === conversationId);
  }
}

module.exports = { Store };
