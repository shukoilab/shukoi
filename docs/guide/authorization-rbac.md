# Declarative RBAC & ABAC Authorization

> **Granular role boundaries, capability scopes, and dynamic tenant ownership guards that prevent BOLA/IDOR.**

Authentication verifies *who* the caller is; authorization controls *what* they are permitted to do. In modern distributed systems, Broken Object Level Authorization (BOLA/IDOR) is the #1 API security vulnerability.

Shukoi provides declarative, action-level authorization guards directly in `defineAction` that enforce Role-Based Access Control (RBAC) and Attribute-Based Access Control (ABAC) before business logic executes.

---

## 1. Action Authorization Contract

When authoring an action, configure the `auth` block:

```typescript
import { defineAction } from '@shukoi/core';
import { Type } from '@sinclair/typebox';

export const updateInvoiceAction = defineAction({
  name: 'updateInvoice',
  description: 'Updates invoice details with role and tenant boundary check',
  authRequired: true,
  auth: {
    // 1. RBAC: Caller must possess at least one of these roles (OR logic)
    roles: ['admin', 'billing_manager'],

    // 2. Capabilities: Caller must possess all specified permissions (AND logic)
    permissions: ['invoices:write'],

    // 3. ABAC: Dynamic tenant ownership policy (prevents BOLA/IDOR)
    policy: (auth, input) => {
      const user = auth.user as { tenantId?: string } | null;
      return user?.tenantId === input.tenantId;
    },
  },
  input: Type.Object({
    tenantId: Type.String(),
    invoiceId: Type.String(),
    amountCents: Type.Integer({ minimum: 100 }),
  }),
  output: Type.Object({
    success: Type.Boolean(),
  }),
  async handler(input, ctx) {
    ctx.logger.info('Updating invoice', { id: input.invoiceId });
    return { success: true };
  },
});
```

---

## 2. Standard RFC 9457 Error Outcomes

| Condition | HTTP Status | Error Code | Detail Message |
| :--- | :--- | :--- | :--- |
| **Missing / Expired Credentials** | `401 Unauthorized` | `UNAUTHORIZED` | "Authentication is required for this action" |
| **Missing Required Role** | `403 Forbidden` | `FORBIDDEN` | "Insufficient role privileges. Requires one of: admin, billing_manager" |
| **Missing Permission Scope** | `403 Forbidden` | `FORBIDDEN` | "Missing required permission: invoices:write" |
| **ABAC Policy Denied (BOLA/IDOR)** | `403 Forbidden` | `FORBIDDEN` | "Access policy evaluation denied request" |

---

## 3. Wildcard Privilege Matching

For administrative users or superuser service accounts:
- Setting `roles: ['*']` in the user claims satisfies any action role requirement.
- Granting permission scope `*` satisfies any action capability permission requirement.
- ABAC `policy` functions always execute independently of wildcard roles, ensuring that tenant boundaries cannot be bypassed accidentally.
