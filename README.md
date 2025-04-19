# Rate Limiting Service

## Prerequisites
- [Docker](https://www.docker.com/) installed on your machine.

## Running Redis Locally with Docker
To run Redis locally for testing, use the following command:
```bash
docker run --name redis -p 6379:6379 -d redis
```

If the Redis container already exists but is stopped, start it with:
```bash
docker start redis
```

This will start a Redis container accessible on `localhost:6379`.

### Stopping and Removing the Redis Container
To stop the Redis container:
```bash
docker stop redis
```

To remove the Redis container:
```bash
docker rm redis
```

## Environment Variables
Ensure the `.env` file is configured as follows:
```properties
PORT=8080
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD= # Leave empty if no password is set
```

## Starting the Application
Run the application in development mode:
```bash
npm run dev
```

Ensure Redis is running before starting the application.
