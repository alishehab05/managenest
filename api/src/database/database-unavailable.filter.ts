import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
} from '@nestjs/common';
import mongoose from 'mongoose';
import type { Response } from 'express';

@Catch(
  mongoose.Error.MongooseServerSelectionError,
  mongoose.mongo.MongoNetworkError,
)
export class DatabaseUnavailableFilter implements ExceptionFilter<Error> {
  catch(_exception: Error, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(503).json({
      statusCode: 503,
      message: 'Database connection is unavailable. Check MongoDB Atlas network access and try again.',
    });
  }
}
