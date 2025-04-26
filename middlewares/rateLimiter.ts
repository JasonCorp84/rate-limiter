import redis from '../config/redis';
import { Middleware, Context, Next } from 'koa';
import { validateRateLimitRules, RateLimitRule } from '../utils/rateLimitHelpers';

function buildRedisKey(ruleIdx: number, clientKey: string): string {
    return `swl:${ruleIdx}:${clientKey}`;
}

function buildRateLimitHeaders(
    limit: number,
    remaining: number,
    resetSec: number
): Record<string, string> {
    const resetTimestamp = Date.now() + resetSec * 1000;
    return {
        'X-RateLimit-Limit': limit.toString(),
        'X-RateLimit-Remaining': Math.max(remaining, 0).toString(),
        'X-RateLimit-Reset': resetTimestamp.toString(),
        'Retry-After': resetSec.toString(),
    };
}

const rateLimiter = (rules: RateLimitRule[]): Middleware => {
    validateRateLimitRules(rules);

    return async (ctx: Context, next: Next): Promise<void> => {
        const now = Date.now();
        const clientKey = `${ctx.ip}:${ctx.params?.applicationId ?? 'unknown'}`;
        let blocked = false;
        let strictestRuleIdx = 0;
        let strictestRemaining = Number.POSITIVE_INFINITY;
        let strictestReset = 0;

        for (let i = 0; i < rules.length; i++) {
            const rule = rules[i];
            const windowStart = now - rule.duration * 1000;
            const redisKey = buildRedisKey(i, clientKey);

            await redis.zremrangebyscore(redisKey, 0, windowStart);

            const count = await redis.zcard(redisKey);

            if (count >= rule.points) {
                blocked = true;

                const oldest = await redis.zrange(redisKey, 0, 0, 'WITHSCORES');
                if (Array.isArray(oldest) && oldest.length === 2) {
                    const oldestTs = Number(oldest[1]);
                    const reset = Math.ceil((oldestTs + rule.duration * 1000 - now) / 1000);
                    if (reset > strictestReset) {
                        strictestReset = reset;
                        strictestRuleIdx = i;
                    }
                }
                strictestRemaining = 0;
            } else {
                await redis.zadd(redisKey, now, `${now}:${Math.random()}`);
                await redis.expire(redisKey, rule.duration + 1);
                if (rule.points - count - 1 < strictestRemaining) {
                    strictestRemaining = rule.points - count - 1;
                    strictestRuleIdx = i;
                    strictestReset = rule.duration;
                }
            }
        }

        const headers = buildRateLimitHeaders(
            rules[strictestRuleIdx].points,
            strictestRemaining,
            strictestReset
        );
        Object.entries(headers).forEach(([key, value]) => ctx.set(key, value));

        if (blocked) {
            ctx.status = 429;
            ctx.body = 'Too Many Requests';
            return;
        }

        await next();
    };
};

export default rateLimiter;
