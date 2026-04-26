import { expectTypeOf, test } from 'vitest'

import type {
  AgentThreadOptions,
  ApprovalDecision,
  ApprovalRequest,
  OnApprovalRequest,
  OnUserInputRequest,
  RequestKind,
  RuntimeMode
} from './provider'

test('ApprovalRequest has required fields', () => {
  expectTypeOf<ApprovalRequest>().toEqualTypeOf<{
    id: string
    input: unknown
    kind: RequestKind
    summary: string
    tool: string
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

test('AgentThreadOptions accepts onUserInputRequest and runtimeMode', () => {
  expectTypeOf<AgentThreadOptions>()
    .toHaveProperty('onUserInputRequest')
    .toEqualTypeOf<OnUserInputRequest | undefined>()

  expectTypeOf<AgentThreadOptions>()
    .toHaveProperty('runtimeMode')
    .toEqualTypeOf<RuntimeMode | undefined>()
})
