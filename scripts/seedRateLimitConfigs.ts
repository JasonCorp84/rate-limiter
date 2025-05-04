import Redis from 'ioredis';

const redis = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
});

async function seedConfigs() {
    // Define all configs in one object for easy editing/testing
    const configs: Record<string, { rules: { points: number, duration: number }[] }> = {
        default: { rules: [ { points: 5, duration: 60 }, { points: 20, duration: 300 } ] },
        testApp: { rules: [ { points: 2, duration: 10 } ] },
        app1: { rules: [ { points: 5, duration: 60 }, { points: 20, duration: 300 } ] },
        appX: { rules: [ { points: 1, duration: 60 } ] },
        easy1: { rules: [ { points: 1, duration: 10 } ] },
        easy2: { rules: [ { points: 2, duration: 15 } ] }
    };

    for (const [appId, config] of Object.entries(configs)) {
        await redis.set(`rateLimitConfig:${appId.toLowerCase()}`, JSON.stringify(config));
    }
    console.log('Seeded rate limit configs in Redis.');
    await redis.quit();
}

seedConfigs().catch(err => {
    console.error('Failed to seed rate limit configs:', err);
    process.exit(1);
});
