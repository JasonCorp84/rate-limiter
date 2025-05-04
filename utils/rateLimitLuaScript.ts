// Lua script for atomic rate limit operations
const rateLimitLuaScript = `
    local key = KEYS[1]
    local now = tonumber(ARGV[1])
    local windowStart = tonumber(ARGV[2])
    local points = tonumber(ARGV[3])
    local expireSec = tonumber(ARGV[4])
    -- Remove old entries
    redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)
    local count = redis.call('ZCARD', key)
    if count < points then
        redis.call('ZADD', key, now, now .. ':' .. math.random())
        redis.call('EXPIRE', key, expireSec)
    end
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    return {count, oldest[2] or now}
`;

export default rateLimitLuaScript;
