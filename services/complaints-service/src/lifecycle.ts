import type { ComplaintStatus } from '@polis/domain';

const TRANSITIONS: Readonly<Record<ComplaintStatus, readonly ComplaintStatus[]>> = {
  submitted: ['assigned'],
  assigned: ['awaiting_information', 'decided'],
  awaiting_information: ['assigned'],
  decided: ['appealed', 'closed'],
  appealed: ['closed'],
  closed: [],
};

export function canComplaintTransition(from: ComplaintStatus, to: ComplaintStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
