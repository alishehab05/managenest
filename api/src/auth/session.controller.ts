import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import type { Request } from 'express';
import { getClerkUserId } from './clerk-auth.guard.js';
import { SessionService } from './session.service.js';
import { UpdateSessionEmailDto } from './dto/update-session-email.dto.js';
import { UpdateSessionPhoneDto } from './dto/update-session-phone.dto.js';

@Controller('session')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Get()
  getSession(@Req() request: Request) {
    return this.sessionService.getForClerkUser(getClerkUserId(request));
  }

  @Patch('email')
  updateEmail(
    @Req() request: Request,
    @Body() input: UpdateSessionEmailDto,
  ) {
    return this.sessionService.updateVerifiedEmail(
      getClerkUserId(request),
      input.email,
    );
  }

  @Patch('phone')
  updatePhone(
    @Req() request: Request,
    @Body() input: UpdateSessionPhoneDto,
  ) {
    return this.sessionService.updatePhoneNumber(
      getClerkUserId(request),
      input.phoneNumber,
    );
  }
}
