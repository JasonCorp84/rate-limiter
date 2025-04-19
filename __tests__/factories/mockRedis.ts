import Redis from 'ioredis-mock';

export const createMockRedis = () => {
    return new Redis();
};
