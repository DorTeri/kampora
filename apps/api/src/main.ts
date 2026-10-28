import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import pinoHttp from 'pino-http';
import { AppModule } from './app.module';
import { loadConfig } from './config';

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  // Structured request logs with a request id (propagated from x-request-id when present).
  app.use(
    pinoHttp({
      level: config.LOG_LEVEL,
      genReqId: (req, res) => {
        const id = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      redact: ['req.headers.authorization'],
      autoLogging: { ignore: (req) => req.url?.startsWith('/v1/media/') ?? false },
    }),
  );
  app.enableCors({ origin: config.WEB_ORIGIN, credentials: false });
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Kampora API')
      .setDescription('Creative Studio API (Increment 1). Auth: dev bearer token.')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('docs', app, document);

  await app.listen(config.API_PORT);
  new Logger('Bootstrap').log(`Kampora API on http://localhost:${config.API_PORT} (docs: /docs)`);
}

void bootstrap();
