# Mikado Plan: Distributed, Dynamic, and Observable Rate Limiter

## 1. Centralized Rate Limit Counters
- [ ] Refactor rate limiter to use Redis for all counters and state, ensuring all pods/containers share the same data.

## 2. Dynamic Per-appId Config in Redis
- [ ] Design a Redis schema for storing per-appId rate limit configs (e.g., `rateLimitConfig:<appId>` as JSON).
- [ ] Implement logic to fetch the config for each appId from Redis on each request.
- [ ] Implement fallback to a `rateLimitConfig:default` if no appId-specific config is found.

## 3. Atomic Operations with Lua
- [ ] Refactor rate limiting logic to use a Lua script for all Redis operations (cleanup, count, add, expire) in one atomic step.

## 4. Dynamic Config Reload
- [ ] Add a cache/TTL for configs in the app to avoid excessive Redis reads, but allow for quick config updates.
- [ ] Implement a mechanism to invalidate or reload configs when they change (e.g., via pub/sub or TTL).

## 5. Kubernetes Integration
- [ ] Use ConfigMaps/Secrets for static/default configs (e.g., default rate limits, Redis connection info).
- [ ] Document how to update static configs via K8s.

## 6. Observability & Logging
- [ ] Add logging for rate limit events (allowed, blocked, errors) with appId and relevant metadata.
- [ ] Expose metrics (e.g., Prometheus endpoint) for rate limit hits, blocks, and Redis errors.

## 7. Health Checks & Graceful Degradation
- [ ] Implement a health check endpoint that verifies Redis connectivity.
- [ ] If Redis is unavailable, return 503 or fallback to a safe default, and log the event.

## 8. Docker/K8s Readiness
- [ ] Add readiness/liveness probes to your Docker/K8s deployment to ensure the app only starts when Redis is available.

## 9. Config Update API
- [ ] Implement an internal/admin API to update per-appId rate limit configs in Redis.
- [ ] Secure this API (e.g., with authentication/authorization).

## 10. Documentation & Default Config
- [ ] Document the config schema, update process, and fallback/default behavior for your team.
- [ ] Ensure a default config is always present in Redis.
