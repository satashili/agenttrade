-- CreateTable
CREATE TABLE "AiToolCall" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "toolName" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiToolCall_decisionId_step_idx" ON "AiToolCall"("decisionId", "step");

-- CreateIndex
CREATE INDEX "AiToolCall_agentId_createdAt_idx" ON "AiToolCall"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "AiToolCall_toolName_createdAt_idx" ON "AiToolCall"("toolName", "createdAt");

-- AddForeignKey
ALTER TABLE "AiToolCall" ADD CONSTRAINT "AiToolCall_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "AiDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
