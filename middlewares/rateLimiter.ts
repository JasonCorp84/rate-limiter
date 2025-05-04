import { Middleware, Context, Next } from 'koa';
import redis from '../config/redis';
import { validateRateLimitRules, RateLimitRule } from '../utils/rateLimitHelpers';
import rateLimitLuaScript from '../utils/rateLimitLuaScript';

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

const rateLimiter = (): Middleware => {
    return async (ctx: Context, next: Next): Promise<void> => {
        const now = Date.now();
        const appId = (ctx.params?.applicationId ?? 'unknown').toLowerCase();
        const clientKey = `${ctx.ip}:${appId}`;
        let rules: RateLimitRule[];

        // Fetch per-appId config from Redis, fallback to default
        try {
            const configStr = await redis.get(`rateLimitConfig:${appId}`) || await redis.get('rateLimitConfig:default');
            if (!configStr) {
                ctx.status = 500;
                ctx.body = 'Rate limit config not found.';
                return;
            }
            const config = JSON.parse(configStr);
            rules = config.rules;
            validateRateLimitRules(rules);
        } catch (err) {
            ctx.status = 503;
            ctx.body = 'Service Unavailable: Rate limiter config error.';
            ctx.set('Retry-After', '10');
            return;
        }

        let blocked = false;
        let strictestRuleIdx = 0;
        let strictestRemaining = Number.POSITIVE_INFINITY;
        let strictestReset = 0;

        try {
            for (let i = 0; i < rules.length; i++) {
                const rule = rules[i];
                const windowStart = now - rule.duration * 1000;
                const redisKey = buildRedisKey(i, clientKey);

                const result = await redis.eval(
                    rateLimitLuaScript,
                    1,
                    redisKey,
                    now,
                    windowStart,
                    rule.points,
                    rule.duration + 1
                ) as [number, string | number];
                const [count, oldestTs] = result;

                if (count >= rule.points) {
                    blocked = true;
                    const reset = Math.ceil((Number(oldestTs) + rule.duration * 1000 - now) / 1000);
                    if (reset > strictestReset) {
                        strictestReset = reset;
                        strictestRuleIdx = i;
                    }
                    strictestRemaining = 0;
                } else {
                    if (rule.points - count - 1 < strictestRemaining) {
                        strictestRemaining = rule.points - count - 1;
                        strictestRuleIdx = i;
                        strictestReset = rule.duration;
                    }
                }
            }
        } catch (err) {
            ctx.status = 503;
            ctx.body = 'Service Unavailable: Rate limiter backend error.';
            ctx.set('Retry-After', '10');
            return;
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
