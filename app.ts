import Koa from 'koa';
import Router from '@koa/router';
import Redis from 'ioredis';
import * as dotenv from 'dotenv';
import rateLimiter from './middlewares/rateLimiter';
import redis from './config/redis';

dotenv.config();

console.log('Environment Variables:', {
    REDIS_HOST: process.env.REDIS_HOST,
    REDIS_PORT: process.env.REDIS_PORT,
    REDIS_PASSWORD: process.env.REDIS_PASSWORD,
});

const app = new Koa();
const router = new Router();
const PORT = process.env.PORT || 3000;

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