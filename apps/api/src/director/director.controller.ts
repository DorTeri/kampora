import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  DirectorApprovalDecisionSchema,
  DirectorMessageRequestSchema,
  FactDecisionRequestSchema,
  type DirectorApprovalDecision,
  type DirectorMessageRequest,
  type FactDecisionRequest,
} from '@kampora/shared';
import { Auth, type AuthContext } from '../common/auth';
import { UuidPipe, ZodPipe, openApiSchema } from '../common/zod';
import { DirectorService } from './director.service';

const CreateConversationSchema = z.object({ businessId: z.string().uuid().optional() }).strict();
type CreateConversation = z.infer<typeof CreateConversationSchema>;

@ApiTags('director')
@ApiBearerAuth()
@Controller('v1/director')
export class DirectorController {
  constructor(private readonly director: DirectorService) {}

  @Get('conversations')
  @ApiOperation({ summary: 'Recent Campaign Director conversations' })
  list(@Auth() ctx: AuthContext) {
    return this.director.listConversations(ctx);
  }

  @Post('conversations')
  @ApiOperation({ summary: 'Start a conversation (optionally for an existing business)' })
  @ApiBody({ schema: openApiSchema(CreateConversationSchema) })
  create(@Auth() ctx: AuthContext, @Body(new ZodPipe(CreateConversationSchema)) body: CreateConversation) {
    return this.director.createConversation(ctx, body.businessId);
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'Conversation and workspace panel (memory, approvals, status, work, recommendations)' })
  get(@Auth() ctx: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.director.workspace(ctx, id);
  }

  @Post('conversations/:id/messages')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send the owner message; a resend with the same clientMessageId returns the stored reply' })
  @ApiBody({ schema: openApiSchema(DirectorMessageRequestSchema) })
  send(
    @Auth() ctx: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(DirectorMessageRequestSchema)) body: DirectorMessageRequest,
  ) {
    return this.director.send(ctx, id, body);
  }

  @Post('conversations/:id/facts')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm or reject a fact the Director inferred' })
  @ApiBody({ schema: openApiSchema(FactDecisionRequestSchema) })
  decideFact(
    @Auth() ctx: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(FactDecisionRequestSchema)) body: FactDecisionRequest,
  ) {
    return this.director.decideFact(ctx, id, body);
  }

  @Post('approvals/:id/decision')
  @HttpCode(200)
  @ApiOperation({ summary: "The owner's explicit approval decision (the only way an approval-gated action runs)" })
  @ApiBody({ schema: openApiSchema(DirectorApprovalDecisionSchema) })
  decide(
    @Auth() ctx: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(DirectorApprovalDecisionSchema)) body: DirectorApprovalDecision,
  ) {
    return this.director.decide(ctx, id, body);
  }
}
