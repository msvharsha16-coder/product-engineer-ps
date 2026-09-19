import React from 'react';

const LABELS = {
  idle: 'Idle',
  pending: 'Pending',
  policy_check: 'Checking policy',
  streaming: 'Streaming',
  completed: 'Completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  timed_out: 'Timed out',
  failed: 'Failed',
};

export default function StatusBadge({ status }) {
  return <span className={`status-badge status-${status}`}>{LABELS[status] || status}</span>;
}
