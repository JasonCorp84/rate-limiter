import redis from '../config/redis'; // Import the Redis instance
import { Middleware } from 'koa';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';

/**
 * Represents a rate-limiting rule. 
 * 
 * @property points - The maximum number of requests allowed within the specified duration.
 * @property duration - The time window for the rate limit, in seconds.
 */
interface RateLimitRule {
    /** The maximum number of requests allowed within the duration. */
    points: number;

    /** The time window for the rate limit, specified in seconds. */
    duration: number;
}

const rateLimiter = (rules: RateLimitRule[]): Middleware => {
    if (!Array.isArray(rules) || rules.length === 0) {
    throw new Error('At least one rate limit rule must be provided.');
    }
    for (const rule of rules) {
    if (
        typeof rule.points !== 'number' ||
        typeof rule.duration !== 'number' ||
        rule.points <= 0 ||
        rule.duration <= 0
    ) {
        throw new Error(
        `Invalid rate limit rule: points and duration must be positive numbers. Received: ${JSON.stringify(
            rule
        )}`
        );
    }
    }

    // build one Redis‐backed limiter per rule
    const limiters = rules.map((rule, idx) =>
    new RateLimiterRedis({
        storeClient: redis,
        keyPrefix: `rl_${idx}`,
        points: rule.points,
        duration: rule.duration,
    })
    );

    return async (ctx, next) => {
    const clientKey = `${ctx.ip}:${ctx.params?.applicationId || 'unknown'}`;

    // Fire off all the consumes in parallel, but don't throw
    const settles = await Promise.allSettled(
        limiters.map((limiter) => limiter.consume(clientKey))
    );

    // Turn each settled promise into a RateLimiterRes (either success or failure)
    const responses: RateLimiterRes[] = settles.map((response) => {
        if (response.status === 'fulfilled') {
            return response.value;
        } else {
            // r.reason is a RateLimiterRes when it's a throttling error
            return response.reason as RateLimiterRes;
        }
    });

    // Find the single strictest limiter (smallest remainingPoints)
    const strictest = responses.reduce((prev, curr) =>
        curr.remainingPoints < prev.remainingPoints ? curr : prev
    );

    // Assemble headers
    const limit = strictest.consumedPoints + strictest.remainingPoints;
    const resetSec = Math.ceil(strictest.msBeforeNext / 1000).toString();

    ctx.set('X-RateLimit-Limit', limit.toString());
    ctx.set('X-RateLimit-Remaining', strictest.remainingPoints.toString());
    ctx.set('X-RateLimit-Reset', resetSec);
    ctx.set('Retry-After', resetSec);

    // If _any_ of the consumes failed, we're over one of the limits
    const blocked = settles.some((r) => r.status === 'rejected');
    if (blocked) {
        ctx.status = 429;
        ctx.body = 'Too Many Requests';
        return;
    }

    // Otherwise we’re good to go
    await next();
    };
};

export default rateLimiter;
