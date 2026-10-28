import type { PipeTransform } from '@nestjs/common';
import { z } from 'zod';

/** Validates a request body with a shared Zod contract (ZodError → 400 via ApiExceptionFilter). */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: z.ZodType<T>) {}
  transform(value: unknown): T {
    return this.schema.parse(value);
  }
}

/** JSON Schema for OpenAPI docs, generated from the same Zod contract. */
export function openApiSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' }) as Record<string, unknown>;
}

export class UuidPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    return z.string().uuid().parse(value);
  }
}
