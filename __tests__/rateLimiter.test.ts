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
const allServers: Server<typeof IncomingMessage, typeof ServerResponse>[] = [];
function createTestApp(): TestEnv {
    const app = new Koa();
    const router = new Router();
    router.get(
        '/test/:applicationId',
        rateLimiter(),
        async (ctx) => {
            ctx.body = `Hello, applicationId: ${ctx.params.applicationId}`;
        }
    );
    app.use(router.routes()).use(router.allowedMethods());
    const server = app.listen();
    allServers.push(server);
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
    let mockRedis: any;

    beforeEach(() => {
        mockRedis = require('../config/redis');
        mockRedis.flushall();
        jest.clearAllTimers();
        // Set up a config for testApp
        mockRedis.set('rateLimitConfig:testApp', JSON.stringify({ rules: [ { points: 2, duration: 10 } ] }));
        const testEnv = createTestApp();
        server = testEnv.server;
        client = testEnv.client;
    });

    afterEach(() => {
        // Ensure all servers are closed to prevent open handles
        allServers.forEach(s => {
            if (s && s.listening) s.close();
        });
        allServers.length = 0;
        jest.useRealTimers();
    });

    it('initializes with custom rules from Redis config', async () => {
        await performRequests(client, '/test/testApp', 2);
        const res = await client.get('/test/testApp');
        expect(res.status).toBe(429);
    });

    it('throws an error if misconfigured (invalid rules in Redis)', async () => {
        // Set an invalid config for appInvalid
        mockRedis.set('rateLimitConfig:appInvalid', JSON.stringify({ rules: [ { points: -1, duration: 0 } ] }));
        const testEnv = createTestApp();
        const testClient = testEnv.client;
        const res = await testClient.get('/test/appInvalid');
        expect(res.status).toBe(503);
        expect(res.text).toMatch(/Service Unavailable/);
    });
});

describe('Rate Limiting per Application ID', () => {
    let server: Server<typeof IncomingMessage, typeof ServerResponse>;
    let client: request.SuperTest<request.Test>;

    beforeEach(() => {
        const mockRedis = require('../config/redis');
        mockRedis.flushall();
        jest.clearAllTimers();
        // Set up configs for all appIds used in this suite
        mockRedis.set('rateLimitConfig:app1', JSON.stringify({
            rules: [
                { points: 5, duration: 60 },
                { points: 20, duration: 300 }
            ]
        }));
        mockRedis.set('rateLimitConfig:app2', JSON.stringify({
            rules: [
                { points: 5, duration: 60 },
                { points: 20, duration: 300 }
            ]
        }));
        mockRedis.set('rateLimitConfig:app3', JSON.stringify({
            rules: [
                { points: 5, duration: 60 },
                { points: 20, duration: 300 }
            ]
        }));
        mockRedis.set('rateLimitConfig:app4', JSON.stringify({
            rules: [
                { points: 5, duration: 60 },
                { points: 20, duration: 300 }
            ]
        }));
        mockRedis.set('rateLimitConfig:app5', JSON.stringify({
            rules: [
                { points: 5, duration: 60 },
                { points: 20, duration: 300 }
            ]
        }));
        mockRedis.set('rateLimitConfig:app22', JSON.stringify({
            rules: [
                { points: 5, duration: 60 },
                { points: 20, duration: 300 }
            ]
        }));
        const testEnv = createTestApp();
        server = testEnv.server;
        client = testEnv.client;
    });

    afterEach(() => {
        // Ensure all servers are closed to prevent open handles
        allServers.forEach(s => {
            if (s && s.listening) s.close();
        });
        allServers.length = 0;
        jest.useRealTimers();
    });

    it('allows exactly the configured number of requests per minute for a single application ID', async () => {
        await performRequests(client, '/test/app1', 5);
    });

    it('decrements X-RateLimit-Remaining header with each successful request', async () => {
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

    it('blocks requests that exceed the configured limit for a single application ID', async () => {
        await performRequests(client, '/test/app1', 5);
        const res = await client.get('/test/app1');
        expect(res.status).toBe(429);
        expect(res.text).toBe('Too Many Requests');
    });

    it('resets the rate limit after the configured time window for a single application ID', async () => {
        jest.useFakeTimers();
        await performRequests(client, '/test/app1', 5);
        jest.advanceTimersByTime(INTERVALS_MS.ONE_MINUTE);
        const res = await client.get('/test/app1');
        expect(res.status).toBe(200);
    });

    it('returns correct rate limit headers for allowed requests (status 200)', async () => {
        const before = Date.now();
        const res = await client.get('/test/app1');
        expect(res.status).toBe(200);
        expect(res.headers['x-ratelimit-remaining']).toBe('4');
        expect(res.headers['x-ratelimit-limit']).toBe('5');
        const reset = Number(res.headers['x-ratelimit-reset']);
        expect(reset).toBeGreaterThanOrEqual(before);
        expect(reset).toBeLessThanOrEqual(before + 61_000); // 60s window + 1s margin to account for processing time
    });

    it('returns correct rate limit headers when the request is blocked (status 429)', async () => {
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

    it('allows 20 requests with 12-second intervals due to sliding window rule', async () => {
        jest.useFakeTimers();
        await performRequests(client, '/test/app1', 20, 12000);
    });

    it('blocks the 21st request with 12-second intervals due to the second sliding window rule', async () => {
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
        // Set up configs for all appIds used in this suite
        mockRedis.set('rateLimitConfig:app1', JSON.stringify({
            rules: [
                { points: 5, duration: 60 },
                { points: 20, duration: 300 }
            ]
        }));
        mockRedis.set('rateLimitConfig:app2', JSON.stringify({
            rules: [
                { points: 5, duration: 60 },
                { points: 20, duration: 300 }
            ]
        }));
        mockRedis.set('rateLimitConfig:app3', JSON.stringify({
            rules: [
                { points: 5, duration: 60 },
                { points: 20, duration: 300 }
            ]
        }));
        mockRedis.set('rateLimitConfig:app4', JSON.stringify({
            rules: [
                { points: 5, duration: 60 },
                { points: 20, duration: 300 }
            ]
        }));
        mockRedis.set('rateLimitConfig:app5', JSON.stringify({
            rules: [
                { points: 5, duration: 60 },
                { points: 20, duration: 300 }
            ]
        }));
        mockRedis.set('rateLimitConfig:app22', JSON.stringify({
            rules: [
                { points: 5, duration: 60 },
                { points: 20, duration: 300 }
            ]
        }));
        const testEnv = createTestApp();
        server = testEnv.server;
        client = testEnv.client;
    });

    afterEach(() => {
        // Ensure all servers are closed to prevent open handles
        allServers.forEach(s => {
            if (s && s.listening) s.close();
        });
        allServers.length = 0;
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


    it('tracks limits separately for each application ID AND sets their headers correctly', async () => {
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
        // Set up config for app1 used in this suite
        mockRedis.set('rateLimitConfig:app1', JSON.stringify({
            rules: [
                { points: 5, duration: 60 },
                { points: 20, duration: 300 }
            ]
        }));
        const testEnv = createTestApp();
        server = testEnv.server;
        client = testEnv.client;
    });

    afterEach(() => {
        // Ensure all servers are closed to prevent open handles
        allServers.forEach(s => {
            if (s && s.listening) s.close();
        });
        allServers.length = 0;
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

describe('Distributed Consistency (Multiple Pods/Containers)', () => {
    let serverA: Server<typeof IncomingMessage, typeof ServerResponse>;
    let clientA: request.SuperTest<request.Test>;
    let serverB: Server<typeof IncomingMessage, typeof ServerResponse>;
    let clientB: request.SuperTest<request.Test>;

    beforeEach(() => {
        const mockRedis = require('../config/redis');
        mockRedis.flushall();
        jest.clearAllTimers();
        mockRedis.set('rateLimitConfig:app1', JSON.stringify({
            rules: [
                { points: 5, duration: 60 },
                { points: 20, duration: 300 }
            ]
        }));
        // Simulate two pods/containers with two app instances
        const testEnvA = createTestApp();
        serverA = testEnvA.server;
        clientA = testEnvA.client;
        const testEnvB = createTestApp();
        serverB = testEnvB.server;
        clientB = testEnvB.client;
    });

    afterEach(() => {
        if (serverA) serverA.close();
        if (serverB) serverB.close();
        jest.useRealTimers();
    });

    it('enforces global rate limit across multiple app instances (pods)', async () => {
        for (let i = 0; i < 3; i++) {
            const res = await clientA.get('/test/app1');
            expect(res.status).toBe(200);
        }
        for (let i = 0; i < 2; i++) {
            const res = await clientB.get('/test/app1');
            expect(res.status).toBe(200);
        }
        const resBlocked = await clientA.get('/test/app1');
        expect(resBlocked.status).toBe(429);
        const resBlockedB = await clientB.get('/test/app1');
        expect(resBlockedB.status).toBe(429);
    });
});

describe('Dynamic per-appId config from Redis', () => {
    let server: Server<typeof IncomingMessage, typeof ServerResponse>;
    let client: request.SuperTest<request.Test>;
    let mockRedis: any;

    beforeEach(() => {
        mockRedis = require('../config/redis');
        mockRedis.flushall();
        jest.clearAllTimers();
        // Set default config in Redis
        mockRedis.set('rateLimitConfig:default', JSON.stringify({ rules: [ { points: 2, duration: 60 } ] }));
        const testEnv = createTestApp();
        server = testEnv.server;
        client = testEnv.client;
    });

    afterEach(() => {
        // Ensure all servers are closed to prevent open handles
        allServers.forEach(s => {
            if (s && s.listening) s.close();
        });
        allServers.length = 0;
        jest.useRealTimers();
    });

    it('uses per-appId config if present in Redis', async () => {
        // Set a custom config for appX
        mockRedis.set('rateLimitConfig:appX', JSON.stringify({ rules: [ { points: 1, duration: 60 } ] }));
        // First request should be allowed
        let res = await client.get('/test/appX');
        expect(res.status).toBe(200);
        // Second request should be blocked (limit is 1)
        res = await client.get('/test/appX');
        expect(res.status).toBe(429);
    });

    it('falls back to default config if per-appId config is missing', async () => {
        // appY has no config, should use default (2 requests allowed)
        let res = await client.get('/test/appY');
        expect(res.status).toBe(200);
        res = await client.get('/test/appY');
        expect(res.status).toBe(200);
        // Third request should be blocked
        res = await client.get('/test/appY');
        expect(res.status).toBe(429);
    });
});

describe('Different rules for appId 90 and 91', () => {
    let server: Server<typeof IncomingMessage, typeof ServerResponse>;
    let client: request.SuperTest<request.Test>;
    let mockRedis: any;

    beforeEach(() => {
        mockRedis = require('../config/redis');
        mockRedis.flushall();
        jest.clearAllTimers();
        // appId 90: 3 requests per 30 seconds
        mockRedis.set('rateLimitConfig:90', JSON.stringify({ rules: [ { points: 3, duration: 30 } ] }));
        // appId 91: 5 requests per 60 seconds
        mockRedis.set('rateLimitConfig:91', JSON.stringify({ rules: [ { points: 5, duration: 60 } ] }));
        const testEnv = createTestApp();
        server = testEnv.server;
        client = testEnv.client;
    });

    afterEach(() => {
        allServers.forEach(s => {
            if (s && s.listening) s.close();
        });
        allServers.length = 0;
        jest.useRealTimers();
    });

    it('enforces different rate limits and headers for appId 90 and 91 (exact values)', async () => {
        // appId 90: 3 requests allowed, 4th blocked
        let before = Date.now();
        for (let i = 1; i <= 3; i++) {
            const res = await client.get('/test/90');
            expect(res.status).toBe(200);
            expect(res.headers['x-ratelimit-limit']).toBe('3');
            expect(res.headers['x-ratelimit-remaining']).toBe((3 - i).toString());
            const reset = Number(res.headers['x-ratelimit-reset']);
            expect(reset).toBeGreaterThanOrEqual(before);
            expect(reset).toBeLessThanOrEqual(before + 31_000); // 30s window + 1s margin
        }
        before = Date.now();
        const blocked90 = await client.get('/test/90');
        expect(blocked90.status).toBe(429);
        expect(blocked90.headers['x-ratelimit-limit']).toBe('3');
        expect(blocked90.headers['x-ratelimit-remaining']).toBe('0');
        expect(Number(blocked90.headers['retry-after'])).toBeGreaterThanOrEqual(0);
        const resetBlocked90 = Number(blocked90.headers['x-ratelimit-reset']);
        expect(resetBlocked90).toBeGreaterThanOrEqual(before);
        expect(resetBlocked90).toBeLessThanOrEqual(before + 31_000);

        // appId 91: 5 requests allowed, 6th blocked
        before = Date.now();
        for (let i = 1; i <= 5; i++) {
            const res = await client.get('/test/91');
            expect(res.status).toBe(200);
            expect(res.headers['x-ratelimit-limit']).toBe('5');
            expect(res.headers['x-ratelimit-remaining']).toBe((5 - i).toString());
            const reset = Number(res.headers['x-ratelimit-reset']);
            expect(reset).toBeGreaterThanOrEqual(before);
            expect(reset).toBeLessThanOrEqual(before + 61_000); // 60s window + 1s margin
        }
        before = Date.now();
        const blocked91 = await client.get('/test/91');
        expect(blocked91.status).toBe(429);
        expect(blocked91.headers['x-ratelimit-limit']).toBe('5');
        expect(blocked91.headers['x-ratelimit-remaining']).toBe('0');
        expect(Number(blocked91.headers['retry-after'])).toBeGreaterThanOrEqual(0);
        const resetBlocked91 = Number(blocked91.headers['x-ratelimit-reset']);
        expect(resetBlocked91).toBeGreaterThanOrEqual(before);
        expect(resetBlocked91).toBeLessThanOrEqual(before + 61_000);
    });
});

describe('Default rate limit config for unknown appIds', () => {
    let server: Server<typeof IncomingMessage, typeof ServerResponse>;
    let client: request.SuperTest<request.Test>;
    let mockRedis: any;

    beforeEach(() => {
        mockRedis = require('../config/redis');
        mockRedis.flushall();
        jest.clearAllTimers();
        // Set default config: 2 requests per 20 seconds
        mockRedis.set('rateLimitConfig:default', JSON.stringify({ rules: [ { points: 2, duration: 20 } ] }));
        const testEnv = createTestApp();
        server = testEnv.server;
        client = testEnv.client;
    });

    afterEach(() => {
        allServers.forEach(s => {
            if (s && s.listening) s.close();
        });
        allServers.length = 0;
        jest.useRealTimers();
    });

    it('applies default rate limit to appId 123 and 456 (not explicitly configured)', async () => {
        for (const appId of ['123', '456']) {
            let before = Date.now();
            // First request
            let res = await client.get(`/test/${appId}`);
            expect(res.status).toBe(200);
            expect(res.headers['x-ratelimit-limit']).toBe('2');
            expect(res.headers['x-ratelimit-remaining']).toBe('1');
            let reset = Number(res.headers['x-ratelimit-reset']);
            expect(reset).toBeGreaterThanOrEqual(before);
            expect(reset).toBeLessThanOrEqual(before + 21_000);

            // Second request
            res = await client.get(`/test/${appId}`);
            expect(res.status).toBe(200);
            expect(res.headers['x-ratelimit-limit']).toBe('2');
            expect(res.headers['x-ratelimit-remaining']).toBe('0');
            reset = Number(res.headers['x-ratelimit-reset']);
            expect(reset).toBeGreaterThanOrEqual(before);
            expect(reset).toBeLessThanOrEqual(before + 21_000);

            // Third request should be blocked
            before = Date.now();
            res = await client.get(`/test/${appId}`);
            expect(res.status).toBe(429);
            expect(res.headers['x-ratelimit-limit']).toBe('2');
            expect(res.headers['x-ratelimit-remaining']).toBe('0');
            expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(0);
            reset = Number(res.headers['x-ratelimit-reset']);
            expect(reset).toBeGreaterThanOrEqual(before);
            expect(reset).toBeLessThanOrEqual(before + 21_000);
        }
    });
});

describe('Changing a rule mid-test and verifying new rule is enforced', () => {
    let server: Server<typeof IncomingMessage, typeof ServerResponse>;
    let client: request.SuperTest<request.Test>;
    let mockRedis: any;

    beforeEach(() => {
        mockRedis = require('../config/redis');
        mockRedis.flushall();
        jest.clearAllTimers();
        // Initial rule: 2 requests per 30 seconds
        mockRedis.set('rateLimitConfig:77', JSON.stringify({ rules: [ { points: 2, duration: 30 } ] }));
        const testEnv = createTestApp();
        server = testEnv.server;
        client = testEnv.client;
    });

    afterEach(() => {
        allServers.forEach(s => {
            if (s && s.listening) s.close();
        });
        allServers.length = 0;
        jest.useRealTimers();
    });

    it('enforces new rule after config is changed in Redis', async () => {
        // Use up the initial limit
        await client.get('/test/77'); // 1st
        await client.get('/test/77'); // 2nd
        let blocked = await client.get('/test/77'); // 3rd, should be blocked
        expect(blocked.status).toBe(429);
        expect(blocked.headers['x-ratelimit-limit']).toBe('2');
        expect(blocked.headers['x-ratelimit-remaining']).toBe('0');

        // Change the rule: now allow 4 requests per 30 seconds
        mockRedis.set('rateLimitConfig:77', JSON.stringify({ rules: [ { points: 4, duration: 30 } ] }));

        // The limiter should now allow 2 more requests before blocking again
        let res = await client.get('/test/77'); // 4th overall, 3rd in new rule
        expect(res.status).toBe(200);
        expect(res.headers['x-ratelimit-limit']).toBe('4');
        expect(res.headers['x-ratelimit-remaining']).toBe('1');

        res = await client.get('/test/77'); // 5th overall, 4th in new rule
        expect(res.status).toBe(200);
        expect(res.headers['x-ratelimit-limit']).toBe('4');
        expect(res.headers['x-ratelimit-remaining']).toBe('0');

        blocked = await client.get('/test/77'); // 6th, should be blocked again
        expect(blocked.status).toBe(429);
        expect(blocked.headers['x-ratelimit-limit']).toBe('4');
        expect(blocked.headers['x-ratelimit-remaining']).toBe('0');
    });
});

afterAll(() => {
    // Close any lingering Redis connections (if any)
    if (typeof redis.quit === 'function') {
        redis.quit();
    }
    // Ensure all servers are closed to prevent open handles
    allServers.forEach(s => {
        if (s && s.listening) s.close();
    });
    allServers.length = 0;
    jest.clearAllTimers();
});
