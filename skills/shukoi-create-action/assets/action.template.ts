/**
 * @purpose Declarative action boilerplate template.
 * @rationale Single-file tri-transport exposure adhering to the 12 Architectural Laws.
 * @preconditions @sinclair/typebox and @shukoi/core available.
 * @invariants Pure web-standard action; 7-tag docstring annotated.
 */

import { Type, type Static } from '@sinclair/typebox';
import { defineAction, DomainError } from '@shukoi/core';

export const ActionInputSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, description: 'Entity identifier' }),
    amount: Type.Number({ minimum: 0, description: 'Transaction amount' }),
  },
  { additionalProperties: false },
);

export const ActionOutputSchema = Type.Object(
  {
    success: Type.Boolean({ description: 'Operation status' }),
    transactionId: Type.String({ description: 'Generated transaction ID' }),
  },
  { additionalProperties: false },
);

export const sampleAction = defineAction({
  name: 'processTransaction',
  summary: 'Processes financial transaction',
  description: 'Validates and executes payment with atomic idempotency and composite cancellation',
  authRequired: true,
  requiredScopes: ['payments:write'],
  timeoutMs: 15000,
  http: {
    method: 'POST',
    path: '/transactions',
    successStatus: 201,
    requireIdempotencyKey: true,
  },
  mcp: {
    enabled: true,
    entityType: 'tool',
    annotations: {
      destructiveHint: true,
      idempotentHint: true,
    },
  },
  input: ActionInputSchema,
  output: ActionOutputSchema,
  async handler(input, ctx) {
    ctx.logger.info('Executing transaction', { id: input.id });

    if (ctx.signal.aborted) {
      throw new DomainError('GATEWAY_TIMEOUT', 'Transaction aborted prior to execution', 504);
    }

    ctx.onFinally(async () => {
      ctx.logger.debug('Cleaning up transaction handles', { id: input.id });
    });

    return {
      success: true,
      transactionId: `tx-${input.id}-${Date.now()}`,
    };
  },
});
