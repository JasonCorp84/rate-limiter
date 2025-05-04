import Koa from 'koa';
import Router from '@koa/router';
import type { ParameterizedContext } from 'koa';
import * as dotenv from 'dotenv';
import rateLimiter from './middlewares/rateLimiter';

dotenv.config();

if (process.env.NODE_ENV !== 'production') {
    console.log('Environment Variables:', {
        REDIS_HOST: process.env.REDIS_HOST,
        REDIS_PORT: process.env.REDIS_PORT,
    });
}

const app = new Koa();
const router = new Router();
const PORT = process.env.PORT || 3000;

router.get(
    '/emarsys/:applicationId',
    rateLimiter(),
    async (ctx: ParameterizedContext) => {
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