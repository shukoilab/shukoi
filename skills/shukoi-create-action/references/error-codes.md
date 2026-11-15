# Shukoi Domain Error Codes & HTTP Status Mapping

All errors thrown inside Shukoi actions should be instances of `DomainError`:

```typescript
import { DomainError } from '@shukoi/core';

throw new DomainError(code, detail, statusCode?, errors?);
```

| Code | Default HTTP Status | Meaning | Typical Usage |
| :--- | :--- | :--- | :--- |
| `BAD_REQUEST` | 400 | Malformed client request payload | Unparseable query string, malformed body syntax |
| `UNAUTHORIZED` | 401 | Authentication required or failed | Missing/expired Bearer token, invalid API key |
| `FORBIDDEN` | 403 | Authenticated user lacks permission | Insufficient RBAC scopes, DNS-rebinding rejection |
| `NOT_FOUND` | 404 | Resource does not exist | Entity with specified ID does not exist |
| `CONFLICT` | 409 | State conflict or concurrent mutation | Idempotency lock in progress, duplicate unique key |
| `PAYLOAD_TOO_LARGE` | 413 | Body or tool output exceeds ceiling | Stream bytes > maxBodyBytes, tool output > maxMcpOutputBytes |
| `VALIDATION_ERROR` | 422 | Schema contract violation | Input does not satisfy TypeBox schema constraints |
| `INTERNAL_SERVER_ERROR` | 500 | Unhandled server failure | Output failed contract, unhandled database error |
| `SERVICE_UNAVAILABLE` | 503 | External dependency or server draining | JWKS remote fetch failed, server shutting down |
| `GATEWAY_TIMEOUT` | 504 | Execution deadline reached | Action timeout, Lambda container deadline reached |
