# Mikado Plan for Rate Limiting Service

## Goal
Implement a configurable rate-limiting middleware for a Koa-based Node.js application. The middleware should support multiple rate-limiting rules (e.g., per minute, hourly, daily) and use Redis for distributed storage. The implementation should follow test-driven development (TDD) principles.

---

## Steps

### 1. Set Up the Environment
- [x] Install required dependencies: `koa`, `@koa/router`, `ioredis`, `rate-limiter-flexible`, `jest`, `supertest`.
- [x] Configure Redis locally for development.

---

### 2. Define Middleware Requirements
- [x] Identify rate-limiting rules (e.g., per minute, hourly, daily).
  - Each application can send:
    - **5 requests per minute**.
    - **20 requests per 5 minutes**.
- [x] Ensure middleware is configurable for different endpoints and rules.

---

### 3. Implement Basic Middleware
- [x] Create a Koa middleware that integrates with `rate-limiter-flexible`.
- [x] Use Redis as the backend for rate-limiting counters.
- [x] Return HTTP 429 with appropriate headers (`Retry-After`, `X-RateLimit-*`) when limits are exceeded.

---

### 4. Add Configuration Support
- [x] Support adding new rules (e.g., weekly limits) without modifying core logic.

---

### 5. Write Unit Tests
- [x] Mock Redis and test middleware behavior for different scenarios:
  - [x] Requests within limits.
  - [x] Requests exceeding limits.
  - [x] Multiple rules applied simultaneously.
- [x] Test edge cases (e.g., invalid configurations, Redis unavailability).

---

### 6. Write Integration Tests
- [x] Use `supertest` to test middleware in a running Koa application.
- [x] Simulate real-world scenarios (e.g., multiple clients hitting the same endpoint).

---

### 7. Optimize and Refactor
- [x] Refactor middleware for clarity and maintainability.
- [x] Ensure clean code principles (e.g., single responsibility, DRY). // so-so
- [x] Add comments and documentation.
