import Koa from 'koa';
import Router from '@koa/router';
import Redis from 'ioredis';
import * as dotenv from 'dotenv';
import rateLimiter from './middlewares/rateLimiter';

dotenv.config();

console.log('Environment Variables:', {
    REDIS_HOST: process.env.REDIS_HOST,
    REDIS_PORT: process.env.REDIS_PORT,
    REDIS_PASSWORD: process.env.REDIS_PASSWORD,
});

const app = new Koa();
const router = new Router();
const PORT = process.env.PORT || 3000;

const redisPort = Number(process.env.REDIS_PORT);
console.log('Parsed REDIS_PORT:', redisPort);

const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: redisPort, // Use the parsed number
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


router.get(
    '/emarsys/:applicationId',
    rateLimiter([
        { points: 5, duration: 60 },
        { points: 20, duration: 300 }
    ]),
    async (ctx) => {
        ctx.body = `Welcome to Emarsys, applicationId: ${ctx.params.applicationId}`;
    }
);

// Catch-all route should be defined AFTER specific routes
router.all('(.*)', (ctx) => {
    console.log('Unmatched request:', ctx.url);
    ctx.status = 404;
    ctx.body = 'Not Found';
});

app.use(router.routes()).use(router.allowedMethods());

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});