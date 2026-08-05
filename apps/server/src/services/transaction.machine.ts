import { createMachine } from 'xstate'

// XState v5 state machine defining the transaction lifecycle:
// IDLE -> VALIDATING -> PENDING_CHAIN -> SUBMITTED -> CONFIRMED -> RECONCILED.
// Any state can transition to FAILED on error.
export const transactionMachine = createMachine({
  id: 'transaction',
  initial: 'IDLE',
  states: {
    IDLE: {
      on: {
        VALIDATE: { target: 'VALIDATING' }
      }
    },
    VALIDATING: {
      on: {
        VALID: { target: 'PENDING_CHAIN' },
        INVALID: { target: 'FAILED' }
      }
    },
    PENDING_CHAIN: {
      on: {
        SUBMIT: { target: 'SUBMITTED' },
        FAIL: { target: 'FAILED' }
      }
    },
    SUBMITTED: {
      on: {
        CONFIRM: { target: 'CONFIRMED' },
        FAIL: { target: 'FAILED' }
      }
    },
    CONFIRMED: {
      on: {
        RECONCILE: { target: 'RECONCILED' },
        FAIL: { target: 'FAILED' }
      }
    },
    RECONCILED: {
      type: 'final'
    },
    FAILED: {
      type: 'final'
    }
  }
})
