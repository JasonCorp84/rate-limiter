import Redis from 'ioredis';

const redis = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
});

redis.on('connect', () => {
    console.log('Connected to Redis');
});

redis.on('error', (err) => {
    console.error('Redis connection error:', err);
});

redis.ping()
    .then((res) => {
        console.log('Redis connection test successful:', res); // "PONG"
    })
    .catch((err) => {
        console.error('Redis connection test failed:', err);
});

export default redis;