import { expectTypeOf, test } from 'vitest'

import type {
  AgentThreadOptions,
  ApprovalDecision,
  ApprovalRequest,
  OnApprovalRequest
} from './provider'

test('ApprovalRequest has required fields', () => {
  expectTypeOf<ApprovalRequest>().toEqualTypeOf<{
    id: string
    tool: string
    input: unknown
    summary: string
  }>()
})

test('ApprovalDecision discriminates by decision', () => {
  expectTypeOf<ApprovalDecision>().toEqualTypeOf<
    | { decision: 'approve' }
    | { decision: 'reject'; reason?: string }
  >()
})

test('AgentThreadOptions accepts onApprovalRequest', () => {
  expectTypeOf<AgentThreadOptions>()
    .toHaveProperty('onApprovalRequest')
    .toEqualTypeOf<OnApprovalRequest | undefined>()
})
