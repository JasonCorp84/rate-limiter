/**
 * Sliding Window Algorithm - Represents a rate-limiting rule.
 * 
 * @property points - The maximum number of requests allowed within the specified duration.
 * @property duration - The time window for the rate limit, in seconds.
 */
export interface RateLimitRule {
    /** The maximum number of requests allowed within the duration. */
    points: number;

    /** The time window for the rate limit, specified in seconds. */
    duration: number;
}


/**
 * Validates an array of rate limit rules.
 * Throws an error if any rule is invalid. 
 * Example.: negative points or duration.
 */
export function validateRateLimitRules(rules: RateLimitRule[]): void {
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
}
