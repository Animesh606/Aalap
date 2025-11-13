import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { RedisIoAdapter } from './sockets/redis-io-adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const redisIOAdapter = new RedisIoAdapter(app);
  await redisIOAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIOAdapter);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
