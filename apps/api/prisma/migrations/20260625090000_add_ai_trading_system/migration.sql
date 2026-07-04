-- CreateEnum
CREATE TYPE "AiAgentStatus" AS ENUM ('active', 'paused', 'stopped');

-- CreateEnum
CREATE TYPE "AiTradeAction" AS ENUM ('hold', 'buy', 'sell', 'close', 'reduce', 'increase');

-- CreateEnum
CREATE TYPE "AiPositionSide" AS ENUM ('none', 'long', 'short');

-- CreateEnum
CREATE TYPE "AiDecisionStatus" AS ENUM ('held', 'rejected', 'executed', 'failed');

-- CreateTable
CREATE TABLE "AiAgent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "personality" TEXT NOT NULL,
    "investmentStyle" TEXT NOT NULL,
    "riskPreference" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'local-ai-v1',
    "promptVersion" TEXT NOT NULL DEFAULT 'ai-trader-v1',
    "status" "AiAgentStatus" NOT NULL DEFAULT 'active',
    "decisionIntervalSeconds" INTEGER NOT NULL DEFAULT 1800,
    "cooldownSeconds" INTEGER NOT NULL DEFAULT 1800,
    "lastDecisionAt" TIMESTAMP(3),
    "nextDecisionAt" TIMESTAMP(3),
    "lastTradeAt" TIMESTAMP(3),
    "cooldownUntil" TIMESTAMP(3),
    "totalDecisions" INTEGER NOT NULL DEFAULT 0,
    "totalTrades" INTEGER NOT NULL DEFAULT 0,
    "totalPnl" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAgent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiDecision" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "action" "AiTradeAction" NOT NULL,
    "side" "AiPositionSide" NOT NULL DEFAULT 'none',
    "confidence" DOUBLE PRECISION NOT NULL,
    "sizePct" DOUBLE PRECISION NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "reasonSummary" VARCHAR(1000) NOT NULL,
    "langfuseTraceId" TEXT,
    "status" "AiDecisionStatus" NOT NULL DEFAULT 'held',
    "rejectReason" TEXT,
    "orderId" TEXT,
    "intendedSize" DECIMAL(20,8),
    "fillPrice" DECIMAL(20,8),
    "realizedPnl" DECIMAL(20,8),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "AiDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMarketSnapshot" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "price" DECIMAL(20,8) NOT NULL,
    "positionSize" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "positionAvgCost" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "cashBalance" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "totalEquity" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "ema20" DECIMAL(20,8),
    "ema60" DECIMAL(20,8),
    "rsi14" DECIMAL(20,8),
    "atr14" DECIMAL(20,8),
    "priceChangePct" DECIMAL(20,8),
    "trendScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "volatilityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMarketSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRiskCheck" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiRiskCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAgentScoreDaily" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "decisions" INTEGER NOT NULL DEFAULT 0,
    "trades" INTEGER NOT NULL DEFAULT 0,
    "winCount" INTEGER NOT NULL DEFAULT 0,
    "pnl" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "maxDrawdown" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "inverseScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stableWinner" BOOLEAN NOT NULL DEFAULT false,
    "stableLoser" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAgentScoreDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiAgent_userId_status_idx" ON "AiAgent"("userId", "status");

-- CreateIndex
CREATE INDEX "AiAgent_status_nextDecisionAt_idx" ON "AiAgent"("status", "nextDecisionAt");

-- CreateIndex
CREATE INDEX "AiAgent_symbol_status_idx" ON "AiAgent"("symbol", "status");

-- CreateIndex
CREATE INDEX "AiDecision_agentId_createdAt_idx" ON "AiDecision"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "AiDecision_userId_createdAt_idx" ON "AiDecision"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiDecision_symbol_createdAt_idx" ON "AiDecision"("symbol", "createdAt");

-- CreateIndex
CREATE INDEX "AiDecision_status_createdAt_idx" ON "AiDecision"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AiDecision_orderId_idx" ON "AiDecision"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "AiMarketSnapshot_decisionId_key" ON "AiMarketSnapshot"("decisionId");

-- CreateIndex
CREATE INDEX "AiMarketSnapshot_symbol_createdAt_idx" ON "AiMarketSnapshot"("symbol", "createdAt");

-- CreateIndex
CREATE INDEX "AiRiskCheck_decisionId_idx" ON "AiRiskCheck"("decisionId");

-- CreateIndex
CREATE INDEX "AiRiskCheck_passed_createdAt_idx" ON "AiRiskCheck"("passed", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiAgentScoreDaily_agentId_day_key" ON "AiAgentScoreDaily"("agentId", "day");

-- CreateIndex
CREATE INDEX "AiAgentScoreDaily_day_score_idx" ON "AiAgentScoreDaily"("day", "score");

-- CreateIndex
CREATE INDEX "AiAgentScoreDaily_stableWinner_idx" ON "AiAgentScoreDaily"("stableWinner");

-- CreateIndex
CREATE INDEX "AiAgentScoreDaily_stableLoser_idx" ON "AiAgentScoreDaily"("stableLoser");

-- AddForeignKey
ALTER TABLE "AiAgent" ADD CONSTRAINT "AiAgent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDecision" ADD CONSTRAINT "AiDecision_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AiAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMarketSnapshot" ADD CONSTRAINT "AiMarketSnapshot_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "AiDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRiskCheck" ADD CONSTRAINT "AiRiskCheck_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "AiDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAgentScoreDaily" ADD CONSTRAINT "AiAgentScoreDaily_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AiAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
