import Koa from 'koa';
import Router from '@koa/router';
import request from 'supertest';
import { createMockRedis } from './factories/mockRedis';
import rateLimiter from '../middlewares/rateLimiter';

// Mock Redis using the factory
jest.mock('../config/redis', () => createMockRedis());

const INTERVALS = {
    ONE_SECOND: 1000,
    ONE_MINUTE: 60 * 1000,
    ONE_HOUR: 60 * 60 * 1000,
    ONE_DAY: 24 * 60 * 60 * 1000,
    ONE_WEEK: 7 * 24 * 60 * 60 * 1000,
};

/**
 * Factory to create a test Koa app, router, and client with given rate limiter rules.
 */
function createTestApp(rules = [{ points: 5, duration: 60 }, { points: 20, duration: 300 }]) {
    const app = new Koa();
    const router = new Router();
    router.get(
        '/test/:applicationId',
        rateLimiter(rules),
        async (ctx) => {
            ctx.body = `Hello, applicationId: ${ctx.params.applicationId}`;
        }
    );
    app.use(router.routes()).use(router.allowedMethods());
    const server = app.listen();
    const client = request(server);
    return { app, router, server, client };
}

/**
 * Helper to perform multiple requests with optional interval (ms) between them.
 * @param client - The SuperTest client instance.
 * @param url - The endpoint URL to call.
 * @param count - Number of requests to perform.
 * @param intervalMs - Optional interval in milliseconds between requests (requires jest.useFakeTimers()).
 * @returns Promise<void>
 */
async function performRequests(
    client: request.SuperTest<request.Test>,
    url: string,
    count: number,
    intervalMs?: number
): Promise<void> {
    if (count <= 0) throw new Error('Count must be greater than 0');
    for (let i = 0; i < count; i++) {
        if (intervalMs && i > 0) { // Avoid waiting on the first request
            jest.advanceTimersByTime(intervalMs);
        }
        await client.get(url);
    }
}

describe('Configuration and Initialization', () => {
    let server: any;
    let client: request.SuperTest<request.Test>;

    afterEach(() => {
        if (server) server.close();
        jest.useRealTimers();
    });

    it('initializes with custom rules', async () => {
        const testEnv = createTestApp([{ points: 2, duration: 10 }]);
        server = testEnv.server;
        client = testEnv.client as unknown as request.SuperTest<request.Test>;
        await performRequests(client, '/test/app1', 2);
        const res = await client.get('/test/app1');
        expect(res.status).toBe(429);
    });

    it('throws an error if misconfigured', async () => {
        // Simulate misconfiguration by passing an invalid rule
        expect(() => createTestApp([{ points: -1, duration: 0 }])).toThrow();
    });
});

describe('Rate Limiting per Application ID', () => {
    let server: any;
    let client: any;

    beforeEach(() => {
        // Reset the rate limiter state (mock Redis or in-memory store), so it does not pollute the next session
        const mockRedis = require('../config/redis');
        mockRedis.flushall();
        jest.clearAllTimers();
        const testEnv = createTestApp();
        server = testEnv.server;
        client = testEnv.client;
    });

    afterEach(() => {
        if (server) server.close();
        jest.useRealTimers();
    });

    it('allows up to 5 requests per minute for a single application ID', async () => {
        await performRequests(client, '/test/app1', 5);
    });

    it('blocks the 6th request within a minute for a single application ID', async () => {
        await performRequests(client, '/test/app1', 5);
        const res = await client.get('/test/app1');
        expect(res.status).toBe(429);
        expect(res.text).toBe('Too Many Requests');
    });

    it('resets the limit after the time window for a single application ID', async () => {
        jest.useFakeTimers();
        await performRequests(client, '/test/app1', 5);
        jest.advanceTimersByTime(INTERVALS.ONE_MINUTE);
        const res = await client.get('/test/app1');
        expect(res.status).toBe(200);
    });

    it('returns correct rate limit headers for allowed requests', async () => {
        const res = await client.get('/test/app1');
        expect(res.status).toBe(200);
        expect(res.headers['x-ratelimit-remaining']).toBeDefined();
        expect(res.headers['x-ratelimit-limit']).toBeDefined();
        expect(res.headers['x-ratelimit-reset']).toBeDefined();
    });

    it('returns correct rate limit headers when blocked', async () => {
        await performRequests(client, '/test/app1', 5);
        const res = await client.get('/test/app1');
        expect(res.status).toBe(429);
        expect(res.headers['x-ratelimit-remaining']).toBeDefined();
        expect(res.headers['x-ratelimit-limit']).toBeDefined();
        expect(res.headers['retry-after']).toBeDefined();
    });

    it('allows 20 requests with 12-second intervals due to sliding window', async () => {
        jest.useFakeTimers();
        await performRequests(client, '/test/app1', 20, 12000);
    });
    it('doesn not allows 21 requests with 12-second intervals due to second rule', async () => {
        jest.useFakeTimers();
        await performRequests(client, '/test/app1', 20, 12000);
        const res = await client.get('/test/app1');
        expect(res.status).toBe(429);
    });
});

describe('Handles Multiple Application IDs', () => {
    let server: any;
    let client: any;
    beforeEach(() => {
        const mockRedis = require('../config/redis');
        mockRedis.flushall();
        jest.clearAllTimers();
        const testEnv = createTestApp();
        server = testEnv.server;
        client = testEnv.client;
    });

    afterEach(() => {
        if (server) server.close();
        jest.useRealTimers();
    });

    it('enforces limits independently for different application IDs', async () => {
        // Exhaust app1's limit
        await performRequests(client, '/test/app1', 5);
        const res1 = await client.get('/test/app1'); //6th request
        expect(res1.status).toBe(429);

        // app2 should still be allowed
       await performRequests(client, '/test/app2', 4);
        const res2Blocked = await client.get('/test/app2');
        expect(res2Blocked.status).toBe(200);
        
        await performRequests(client, '/test/app3', 4);
        const res3 = await client.get('/test/app3');
        expect(res3.status).toBe(200);

        await performRequests(client, '/test/app4', 5);
        const res4Blocked = await client.get('/test/app4');
        expect(res4Blocked.status).toBe(429);

        await performRequests(client, '/test/app5', 5);
        const res5Blocked = await client.get('/test/app5');
        expect(res5Blocked.status).toBe(429);

        await performRequests(client, '/test/app22', 4);
        const res6 = await client.get('/test/app22');
        expect(res6.status).toBe(200);
    });


    it('tracks limits separately for each application ID', async () => {
        // Make 3 requests for app1 and 2 for app2
        await performRequests(client, '/test/app1', 3);
        await performRequests(client, '/test/app2', 2);

        // Both should still be allowed up to their own limits
        await performRequests(client, '/test/app1', 2); // 5 total for app1
        await performRequests(client, '/test/app2', 3); // 5 total for app2

        // Both should now be blocked on the next request
        const res1 = await client.get('/test/app1');
        expect(res1.status).toBe(429);

        const res2 = await client.get('/test/app2');
        expect(res2.status).toBe(429);
    });
});

describe('Combined Rate Limiting Rules', () => {
    let server: any;
    let client: request.SuperTest<request.Test>;

    beforeEach(() => {
        const mockRedis = require('../config/redis');
        mockRedis.flushall();
        jest.clearAllTimers();
        // Both per-minute and per-5-minutes limits
        const testEnv = createTestApp([
            { points: 5, duration: 60 },
            { points: 20, duration: 300 }
        ]);
        server = testEnv.server;
        client = testEnv.client as unknown as request.SuperTest<request.Test>; // Ensure correct type
    });

    afterEach(() => {
        if (server) server.close();
        jest.useRealTimers();
    });

    it('enforces both per-minute and per-5-minutes limits', async () => {
        await performRequests(client, '/test/app1', 5);
        let res = await client.get('/test/app1');
        expect(res.status).toBe(429);

        // Advance time by 1 minute, should allow 5 more
        jest.useFakeTimers();
        jest.advanceTimersByTime(INTERVALS.ONE_MINUTE);
        await performRequests(client, '/test/app1', 4);
        // 5th request in this minute should be allowed
        res = await client.get('/test/app1');
        expect(res.status).toBe(200);
        jest.useRealTimers();
    });

    it('blocks the 21st request within 5 minutes due to the second limit 20/5 minutes', async () => {
        jest.useFakeTimers();
        // Make 20 requests, spaced so both limits are respected
        for (let i = 0; i < 20; i++) {
            if (i > 0 && i % 5 === 0) {
                jest.advanceTimersByTime(INTERVALS.ONE_MINUTE); // advance 1 minute after each 5
            }
            const res = await client.get('/test/app1');
            expect(res.status).toBe(200);
        }
        // 21st request should be blocked by the 20/5min rule
        const res = await client.get('/test/app1');
        expect(res.status).toBe(429);
        jest.useRealTimers();
    });

    it('allows requests again after the global window resets', async () => {
        jest.useFakeTimers();
        // Make 20 requests, spaced so both limits are respected
        await performRequests(client, '/test/app1', 20, INTERVALS.ONE_SECOND * 12);

        let res = await client.get('/test/app1');
        expect(res.status).toBe(429);

        jest.advanceTimersByTime(5 * INTERVALS.ONE_MINUTE);
        res = await client.get('/test/app1');
        expect(res.status).toBe(200);
        jest.useRealTimers();
    });

    it('returns correct rate limit headers for combined rules', async () => {
        const res = await client.get('/test/app1');
        expect(res.status).toBe(200);
        expect(res.headers['x-ratelimit-remaining']).toBeDefined();
        expect(res.headers['x-ratelimit-limit']).toBeDefined();
        expect(res.headers['x-ratelimit-reset']).toBeDefined();
    });
});

describe('Edge Cases and Error Handling', () => {
    let server: any;
    let client: request.SuperTest<request.Test>;

    beforeEach(() => {
        const mockRedis = require('../config/redis');
        mockRedis.flushall();
        jest.clearAllTimers();
        const testEnv = createTestApp();
        server = testEnv.server;
        client = testEnv.client as unknown as request.SuperTest<request.Test>;
    });

    afterEach(() => {
        if (server) server.close();
        jest.useRealTimers();
    });

    it('handles invalid or missing application IDs gracefully', async () => {
        // Missing applicationId param
        const res = await client.get('/test/');
        expect([404, 400]).toContain(res.status); // 404 if route not matched, 400 if handled
        // Invalid applicationId (e.g., empty string)
        const res2 = await client.get('/test/');
        expect([404, 400]).toContain(res2.status);
    });

    it('returns appropriate headers when rate limit is exceeded', async () => {
        await performRequests(client, '/test/app1', 5);
        const res = await client.get('/test/app1');
        expect(res.status).toBe(429);
        expect(res.headers['x-ratelimit-remaining']).toBeDefined();
        expect(res.headers['x-ratelimit-limit']).toBeDefined();
        expect(res.headers['retry-after']).toBeDefined();
    });
});

describe('Concurrency and Race Conditions', () => {
    let server: any;
    let client: request.SuperTest<request.Test>;

    beforeEach(() => {
        const mockRedis = require('../config/redis');
        mockRedis.flushall();
        jest.clearAllTimers();
        const testEnv = createTestApp();
        server = testEnv.server;
        client = testEnv.client as unknown as request.SuperTest<request.Test>;
    });

    afterEach(() => {
        if (server) server.close();
        jest.useRealTimers();
    });

    it('correctly limits concurrent requests from the same application ID', async () => {
        // Simulate 10 concurrent requests
        const requests = [];
        for (let i = 0; i < 10; i++) {
            requests.push(client.get('/test/app1'));
        }
        const results = await Promise.all(requests);
        // Only 5 should be allowed, the rest should be blocked
        const allowed = results.filter(res => res.status === 200).length;
        const blocked = results.filter(res => res.status === 429).length;
        expect(allowed).toBe(5);
        expect(blocked).toBe(5);
    });

    it('does not allow more than the allowed number of requests under high concurrency', async () => {
        // Simulate 100 concurrent requests
        const requests = [];
        for (let i = 0; i < 100; i++) {
            requests.push(client.get('/test/app1'));
        }
        const results = await Promise.all(requests);
        // Only 5 should be allowed, the rest should be blocked
        const allowed = results.filter(res => res.status === 200).length;
        const blocked = results.filter(res => res.status === 429).length;
        expect(allowed).toBe(5);
        expect(blocked).toBe(95);
    });
});


