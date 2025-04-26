import Koa from 'koa';
import Router from '@koa/router';
import request from 'supertest';
import { createMockRedis } from './factories/mockRedis';
import { Server, IncomingMessage, ServerResponse } from 'http';
import rateLimiter from '../middlewares/rateLimiter';
import redis from '../config/redis';

jest.mock('../config/redis', () => createMockRedis());

const INTERVALS_MS = {
    ONE_SECOND: 1000,
    ONE_MINUTE: 60 * 1000,
    ONE_HOUR: 60 * 60 * 1000,
    ONE_DAY: 24 * 60 * 60 * 1000,
    ONE_WEEK: 7 * 24 * 60 * 60 * 1000,
};

/**
 * Type for the test environment returned by createTestApp.
 */
type TestEnv = {
    app: Koa;
    router: Router;
    server: Server<typeof IncomingMessage, typeof ServerResponse>;
    client: request.SuperTest<request.Test>;
};

/**
 * Factory to create a test Koa app, router, and client with given rate limiter rules.
 */
function createTestApp(rules = [{ points: 5, duration: 60 }, { points: 20, duration: 300 }]): TestEnv {
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
    const client = request.agent(server) as unknown as request.SuperTest<request.Test>;
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
    let server: Server<typeof IncomingMessage, typeof ServerResponse>;
    let client: request.SuperTest<request.Test>;

    afterEach(() => {
        if (server) server.close();
        jest.useRealTimers();
    });

    it('initializes with custom rules', async () => {
        const testEnv = createTestApp([{ points: 2, duration: 10 }]);
        server = testEnv.server;
        client = testEnv.client;
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
    let server: Server<typeof IncomingMessage, typeof ServerResponse>;
    let client: request.SuperTest<request.Test>;

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

    it('allows up to 5 requests per minute for a single application ID', async () => {
        await performRequests(client, '/test/app1', 5);
    });

    it('X-RateLimit-Remaining decreases with each request', async () => {
        const remainings: number[] = [];
        for (let i = 0; i < 5; i++) {
            const res = await client.get('/test/app1');
            expect(res.status).toBe(200);
            const remaining = Number(res.headers['x-ratelimit-remaining']);
            expect(remaining).toBeGreaterThanOrEqual(0);
            remainings.push(remaining);
        }

        for (let i = 1; i < remainings.length; i++) {
            expect(remainings[i]).toBeLessThanOrEqual(remainings[i - 1]);
        }

        expect(remainings[remainings.length - 1]).toBe(0);
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
        jest.advanceTimersByTime(INTERVALS_MS.ONE_MINUTE);
        const res = await client.get('/test/app1');
        expect(res.status).toBe(200);
    });

    it('returns correct rate limit headers for allowed requests', async () => {
        const before = Date.now();
        const res = await client.get('/test/app1');
        expect(res.status).toBe(200);
        expect(res.headers['x-ratelimit-remaining']).toBe('4');
        expect(res.headers['x-ratelimit-limit']).toBe('5');
        const reset = Number(res.headers['x-ratelimit-reset']);
        expect(reset).toBeGreaterThanOrEqual(before);
        expect(reset).toBeLessThanOrEqual(before + 61_000); // 60s window + 1s margin to account for processing time
    });

    it('returns correct rate limit headers when blocked', async () => {
        await performRequests(client, '/test/app1', 5);
        const before = Date.now();
        const res = await client.get('/test/app1');
        expect(res.status).toBe(429);
        expect(res.headers['x-ratelimit-remaining']).toBe('0');
        expect(res.headers['x-ratelimit-limit']).toBe('5');
        expect(res.headers['retry-after']).toBeDefined();
        const reset = Number(res.headers['x-ratelimit-reset']);
        expect(reset).toBeGreaterThanOrEqual(before);
        expect(reset).toBeLessThanOrEqual(before + 61_000); // 60s window + 1s margin to account for processing time    
    });

    it('allows 20 requests with 12-second intervals due to sliding window', async () => {
        jest.useFakeTimers();
        await performRequests(client, '/test/app1', 20, 12000);
    });
    it('doesn not allows 21 requests with 12-second intervals due to second rule', async () => {
        jest.useFakeTimers();
        await performRequests(client, '/test/app1', 20, 12000);
        const before = Date.now();
        const res = await client.get('/test/app1');
        expect(res.status).toBe(429);
        // The strictest rule should be the second one: { points: 20, duration: 300 }
        expect(res.headers['x-ratelimit-limit']).toBe('20');
        expect(res.headers['x-ratelimit-remaining']).toBe('0');
        const reset = Number(res.headers['x-ratelimit-reset']);
        expect(reset).toBeGreaterThanOrEqual(before);
        expect(reset).toBeLessThanOrEqual(before + 301_000); // 300s window + 1s margin
    });
});

describe('Handles Multiple Application IDs', () => {
    let server: Server<typeof IncomingMessage, typeof ServerResponse>;
    let client: request.SuperTest<request.Test>;
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


    it('tracks limits separately for each application ID AND sets theor headers correctly', async () => {
        // app1: 3 requests, app2: 2 requests
        await performRequests(client, '/test/app1', 3);
        await performRequests(client, '/test/app2', 2);

        // Check headers for app1 (should have 2 remaining)
        let res1 = await client.get('/test/app1');
        expect(res1.status).toBe(200);
        expect(res1.headers['x-ratelimit-remaining']).toBe('1');
        expect(res1.headers['x-ratelimit-limit']).toBe('5');

        let res2 = await client.get('/test/app2');
        expect(res2.status).toBe(200);
        expect(res2.headers['x-ratelimit-remaining']).toBe('2');
        expect(res2.headers['x-ratelimit-limit']).toBe('5');

        await performRequests(client, '/test/app1', 2);
        await performRequests(client, '/test/app2', 3);

        // Both should now be blocked on the next request
        const before = Date.now();
        res1 = await client.get('/test/app1');
        expect(res1.status).toBe(429);
        expect(res1.headers['x-ratelimit-remaining']).toBe('0');
        expect(res1.headers['x-ratelimit-limit']).toBe('5');
        const reset1 = Number(res1.headers['x-ratelimit-reset']);
        expect(reset1).toBeGreaterThanOrEqual(before);
        expect(reset1).toBeLessThanOrEqual(before + 61_000);

        res2 = await client.get('/test/app2');
        expect(res2.status).toBe(429);
        expect(res2.headers['x-ratelimit-remaining']).toBe('0');
        expect(res2.headers['x-ratelimit-limit']).toBe('5');
        const reset2 = Number(res2.headers['x-ratelimit-reset']);
        expect(reset2).toBeGreaterThanOrEqual(before);
        expect(reset2).toBeLessThanOrEqual(before + 61_000);
    });
});

describe('Combined Rate Limiting Rules AND headers', () => {
    let server: Server<typeof IncomingMessage, typeof ServerResponse>;
    let client: request.SuperTest<request.Test>;

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

    it('enforces both per-minute and per-5-minutes limits', async () => {
        await performRequests(client, '/test/app1', 5);
        let res = await client.get('/test/app1');
        expect(res.status).toBe(429);

        jest.useFakeTimers();
        jest.advanceTimersByTime(INTERVALS_MS.ONE_MINUTE);
        await performRequests(client, '/test/app1', 4);
        res = await client.get('/test/app1');
        expect(res.status).toBe(200);
        jest.useRealTimers();
    });

    it('blocks the 21st request within 5 minutes due to the second limit 20/5 minutes', async () => {
        jest.useFakeTimers();
        for (let i = 0; i < 20; i++) {
            if (i > 0 && i % 5 === 0) {
                jest.advanceTimersByTime(INTERVALS_MS.ONE_MINUTE);
            }
            const res = await client.get('/test/app1');
            expect(res.status).toBe(200);
            }

            // 21st request should be blocked by the 20/5min rule
            const res = await client.get('/test/app1');
            expect(res.status).toBe(429);
            jest.useRealTimers();
        });

    it('shows X-RateLimit-Remaining as 0 after 20th request due to second rule {points: 20, duration 300}', async () => {
        jest.useFakeTimers();
        for (let i = 0; i < 19; i++) {
            if (i > 0 && i % 5 === 0) {
                jest.advanceTimersByTime(INTERVALS_MS.ONE_MINUTE);
            }
            const res = await client.get('/test/app1');
            expect(res.status).toBe(200);
        }
        jest.advanceTimersByTime(INTERVALS_MS.ONE_MINUTE);
        const res = await client.get('/test/app1');
        expect(res.status).toBe(200);
        expect(Number(res.headers['x-ratelimit-remaining'])).toBe(0);
        jest.useRealTimers();
    });

    it('allows requests again as soon as enough old requests fall out of the sliding window', async () => {
        jest.useFakeTimers();
        await performRequests(client, '/test/app1', 20, INTERVALS_MS.ONE_SECOND * 12);

        // 21st request should be blocked because the window is full
        let res = await client.get('/test/app1');
        expect(res.status).toBe(429);

        // Advance time just enough for the earliest request to fall out of the window (5 minutes)
        jest.advanceTimersByTime(5 * INTERVALS_MS.ONE_MINUTE);

        // Now a new request should be allowed as the window has space
        res = await client.get('/test/app1');
        expect(res.status).toBe(200);
        jest.useRealTimers();
    });
});
