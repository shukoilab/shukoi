/**
 * @purpose Atomic Redis Lua scripts for concurrency-safe idempotency locking, completion, release, and extension.
 * @rationale Guarantees single-tick atomic evaluation inside the Redis server, eliminating TOCTOU race conditions.
 * @preconditions Redis engine with Lua scripting support (Redis 2.6+ / Valkey).
 * @invariants Atomic evaluation; $O(1)$ time complexity per script execution; resilient pcall JSON parsing.
 */

/**
 * @purpose Atomic Lua script to acquire an idempotency lock or return existing execution state.
 * @rationale Atomically checks if key exists. If missing, sets IN_PROGRESS with worker token and PX TTL. If existing, returns conflict or cached response.
 * @preconditions KEYS[1]: lock key. ARGV[1]: worker token. ARGV[2]: lock TTL (ms). ARGV[3]: now (ms). ARGV[4]: action name. ARGV[5]: idempotency key.
 * @param KEYS Redis keys array containing the lock key.
 * @returns Status array [status, payload].
 * @throws Never throws unhandled; pcall safely handles corrupt JSON.
 * @invariants Single-roundtrip atomic evaluation.
 */
export const ACQUIRE_LUA = `
local current = redis.call('GET', KEYS[1])
if not current then
  local record = cjson.encode({
    actionName = ARGV[4],
    key = ARGV[5],
    status = 'IN_PROGRESS',
    lockToken = ARGV[1],
    expiresAt = tonumber(ARGV[3]) + tonumber(ARGV[2])
  })
  redis.call('SET', KEYS[1], record, 'PX', ARGV[2])
  return { 'ACQUIRED', record }
end

local ok, decoded = pcall(cjson.decode, current)
if not ok or type(decoded) ~= 'table' then
  redis.call('DEL', KEYS[1])
  local record = cjson.encode({
    actionName = ARGV[4],
    key = ARGV[5],
    status = 'IN_PROGRESS',
    lockToken = ARGV[1],
    expiresAt = tonumber(ARGV[3]) + tonumber(ARGV[2])
  })
  redis.call('SET', KEYS[1], record, 'PX', ARGV[2])
  return { 'ACQUIRED', record }
end

if decoded.status == 'IN_PROGRESS' then
  return { 'CONFLICT', current }
elseif decoded.status == 'COMPLETED' then
  return { 'COMPLETED', current }
else
  return { 'UNKNOWN', current }
end
`;

/**
 * @purpose Atomic Lua script to mark an execution as COMPLETED and store the response payload.
 * @rationale Verifies that the completing worker owns the active lock token before updating status and extending retention TTL.
 * @preconditions KEYS[1]: lock key. ARGV[1]: worker token. ARGV[2]: completed JSON record. ARGV[3]: retention TTL (ms).
 * @param KEYS Redis keys array.
 * @returns 1 on success.
 * @throws Never throws unhandled.
 * @invariants Atomic status transition; PX TTL retention.
 */
export const COMPLETE_LUA = `
local current = redis.call('GET', KEYS[1])
if current then
  local ok, decoded = pcall(cjson.decode, current)
  if ok and type(decoded) == 'table' then
    if decoded.lockToken == ARGV[1] or decoded.status == 'IN_PROGRESS' then
      redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
      return 1
    end
  end
end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
return 1
`;

/**
 * @purpose Atomic Lua script to release an in-progress idempotency lock on failure.
 * @rationale Ensures only the lock owner can release the lock, preventing accidental release of other workers' locks.
 * @preconditions KEYS[1]: lock key. ARGV[1]: worker token.
 * @param KEYS Redis keys array.
 * @returns 1 if lock was released, 0 otherwise.
 * @throws Never throws unhandled.
 * @invariants Ownership verification via worker token.
 */
export const RELEASE_LUA = `
local current = redis.call('GET', KEYS[1])
if current then
  local ok, decoded = pcall(cjson.decode, current)
  if ok and type(decoded) == 'table' then
    if decoded.status == 'IN_PROGRESS' and (ARGV[1] == '' or decoded.lockToken == ARGV[1]) then
      redis.call('DEL', KEYS[1])
      return 1
    end
  end
end
return 0
`;

/**
 * @purpose Atomic Lua script to renew/extend an active in-progress lock TTL (heartbeat).
 * @rationale Extends the lock duration while an action is still running to prevent premature timeout expiration.
 * @preconditions KEYS[1]: lock key. ARGV[1]: worker token. ARGV[2]: additional TTL (ms). ARGV[3]: now (ms).
 * @param KEYS Redis keys array.
 * @returns 1 if lock TTL was extended, 0 if lock expired or owned by another worker.
 * @throws Never throws unhandled.
 * @invariants Preserves lock ownership while updating expiresAt and PX TTL.
 */
export const EXTEND_LUA = `
local current = redis.call('GET', KEYS[1])
if current then
  local ok, decoded = pcall(cjson.decode, current)
  if ok and type(decoded) == 'table' then
    if decoded.status == 'IN_PROGRESS' and (ARGV[1] == '' or decoded.lockToken == ARGV[1]) then
      decoded.expiresAt = tonumber(ARGV[3]) + tonumber(ARGV[2])
      local updated = cjson.encode(decoded)
      redis.call('SET', KEYS[1], updated, 'PX', ARGV[2])
      return 1
    end
  end
end
return 0
`;
