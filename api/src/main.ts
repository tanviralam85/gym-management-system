import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AccountsController, AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { MembersController } from './members.controller.js';
import { PlansController } from './plans.controller.js';
import { BillingController } from './billing.controller.js';
import { OwnerAdjustmentsController } from './owner-adjustments.controller.js';

@Controller('health')
class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])],
  controllers: [HealthController, AuthController, AccountsController, MembersController, PlansController, BillingController, OwnerAdjustmentsController],
  providers: [AuthService],
})
class AppModule {}

const app = await NestFactory.create(AppModule);
app.setGlobalPrefix('api/v1');
app.enableShutdownHooks();
await app.listen(Number(process.env.API_PORT ?? 3000), '127.0.0.1');
