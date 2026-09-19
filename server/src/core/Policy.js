'use strict';

const BLOCKED_PATTERNS = [
  /\bhow to build a bomb\b/i,
  /\bblocked_test_input\b/i, // deterministic hook used by tests/benchmark
];

function checkPolicy(input) {
  const text = typeof input === 'string' ? input : String(input?.text ?? '');
  if (!text || !text.trim()) {
    return { accepted: false, reason: 'empty input' };
  }
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(text)) {
      return { accepted: false, reason: `input matched blocked pattern: ${pattern}` };
    }
  }
  return { accepted: true };
}

module.exports = { checkPolicy };
