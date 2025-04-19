import redis from '../config/redis'; // Import the Redis instance
import { Middleware } from 'koa';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';

/**
 * Sliding Window Algorythm - Represents a rate-limiting rule. 
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
                `Invalid rate limit rule: points and duration must be positive numbers. Received: ${JSON.stringify(rule)}`
            );
        }
    }

    const limiters = rules.map((rule, idx) => new RateLimiterRedis({
        storeClient: redis,
        keyPrefix: `rl_${idx}`, // each rule gets a different prefix
        points: rule.points,
        duration: rule.duration,
    }));

    return async (ctx, next) => {
        const applicationId = ctx.params?.applicationId || 'unknown';
        const clientKey = `${ctx.ip}:${applicationId}`;

        try {
            // Check if any limiter has already blocked the request
            const limiterStatuses = await Promise.all(limiters.map(limiter => limiter.get(clientKey)));
            const isBlocked = limiterStatuses.some(status => status && status.remainingPoints <= 0);

            if (isBlocked) {
                ctx.status = 429;
                ctx.body = 'Too Many Requests';
                const retryAfter = Math.min(
                    ...limiterStatuses
                        .filter(status => status && status.remainingPoints <= 0)
                        .map(status => status ? status.msBeforeNext : Infinity)
                );
                ctx.set('Retry-After', Math.ceil(retryAfter / 1000).toString());
                const strictest = limiterStatuses
                    .filter(status => status && status.remainingPoints <= 0)
                    .reduce((prev, curr) => {
                        if (!prev) return curr;
                        if (!curr) return prev;
                        return (curr.remainingPoints < prev.remainingPoints) ? curr : prev;
                    });
                if (strictest) {
                    ctx.set('X-RateLimit-Remaining', strictest.remainingPoints.toString());
                    ctx.set('X-RateLimit-Limit', (strictest.consumedPoints + strictest.remainingPoints).toString());
                    ctx.set('X-RateLimit-Reset', Math.ceil(strictest.msBeforeNext / 1000).toString());
                }
                return;
            }

            // Consume points from all limiters
            const results = await Promise.all(limiters.map(limiter => limiter.consume(clientKey)));

            // Pick the strictest result for headers
            const strictest = results.reduce((prev, curr) => {
                return (curr.remainingPoints < prev.remainingPoints) ? curr : prev;
            });

            ctx.set('X-RateLimit-Remaining', strictest.remainingPoints.toString());
            ctx.set('X-RateLimit-Reset', Math.ceil(strictest.msBeforeNext / 1000).toString());
            ctx.set('X-RateLimit-Limit', (strictest.consumedPoints + strictest.remainingPoints).toString());

            await next();
        } catch (error) {
            if (error instanceof RateLimiterRes) {
                // Handle unexpected rate limiter errors
                ctx.status = 429;
                ctx.body = 'Too Many Requests';
                ctx.set('X-RateLimit-Limit', error.consumedPoints.toString());
                ctx.set('X-RateLimit-Remaining', '0');
                ctx.set('Retry-After', Math.ceil(error.msBeforeNext / 1000).toString());
                ctx.set('X-RateLimit-Reset', Math.ceil(error.msBeforeNext / 1000).toString());
            } else {
                throw error; // Re-throw unexpected errors
            }
        }
    };
};

export default rateLimiter;
