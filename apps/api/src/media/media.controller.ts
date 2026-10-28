import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Controller, Get, HttpStatus, Inject, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  contentDisposition,
  LocalDiskStorage,
  verifyMediaSignature,
  type StorageDriver,
} from '@kampora/storage';
import { Public } from '../common/auth';
import { ApiError } from '../common/errors';
import type { AppConfig } from '../config';
import { CONFIG, STORAGE } from '../infra/tokens';

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  svg: 'image/svg+xml',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
};

/**
 * Serves local-driver media through HMAC-signed, expiring URLs (the S3 driver uses presigned URLs instead).
 * Supports HTTP Range so browsers can seek in videos.
 */
@ApiExcludeController()
@Controller('v1/media')
export class MediaController {
  constructor(
    @Inject(STORAGE) private readonly storage: StorageDriver,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Get('*path')
  async serve(
    @Req() req: Request,
    @Res() res: Response,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Query('download') download?: string,
  ) {
    if (!(this.storage instanceof LocalDiskStorage) || !this.config.MEDIA_SIGNING_SECRET) {
      throw new ApiError(
        HttpStatus.NOT_FOUND,
        'NOT_FOUND',
        'Media endpoint is only available for local storage',
      );
    }
    const key = decodeURIComponent(req.path.replace(/^\/v1\/media\//, ''));
    if (
      !sig ||
      !verifyMediaSignature(key, Number(exp), sig, this.config.MEDIA_SIGNING_SECRET, download ?? '')
    ) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'INVALID_SIGNATURE', 'Invalid or expired media URL');
    }

    const file = this.storage.resolvePath(key);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Media not found');

    const type = MIME[key.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';
    res.setHeader('Content-Type', type);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (type === 'image/svg+xml')
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    if (download) res.setHeader('Content-Disposition', contentDisposition(download));

    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
      if (start > end || start >= info.size) {
        res.status(416).setHeader('Content-Range', `bytes */${info.size}`).end();
        return;
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.setHeader('Content-Length', String(info.size));
    createReadStream(file).pipe(res);
  }
}
