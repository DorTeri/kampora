import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { InvalidTransitionError } from '@kampora/shared';
import { ReasoningStepError } from '@kampora/creative-engine';
import { TimelineBuildError } from '@kampora/production-engine';

/**
 * API errors carry a stable machine `code`. The web app maps codes to Hebrew copy, so customer-facing
 * language never depends on server English strings.
 */
export class ApiError extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export const notFound = (what: string) =>
  new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} not found`);

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const send = (status: number, code: string, message: string, details?: unknown) =>
      res.status(status).json({ statusCode: status, code, message, details });

    if (exception instanceof ApiError) {
      return send(exception.getStatus(), exception.code, exception.message, exception.details);
    }
    if (exception instanceof ZodError) {
      return send(400, 'VALIDATION_FAILED', 'Request validation failed', exception.issues);
    }
    if (exception instanceof InvalidTransitionError) {
      return send(409, 'INVALID_STATE', exception.message);
    }
    if (exception instanceof ReasoningStepError) {
      this.logger.error(exception.message);
      return send(502, 'AI_STEP_FAILED', exception.message);
    }
    if (exception instanceof TimelineBuildError) {
      return send(409, 'TIMELINE_INCOMPLETE', exception.message);
    }
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const message =
        typeof body === 'string' ? body : ((body as { message?: string }).message ?? exception.message);
      return send(
        exception.getStatus(),
        exception.getStatus() === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR',
        String(message),
      );
    }
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    return send(500, 'INTERNAL', 'Internal server error');
  }
}
