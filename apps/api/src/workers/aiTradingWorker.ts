import { PrismaClient } from '@prisma/client';
import { Server as SocketServer } from 'socket.io';

import { processDueAiAgents } from '../services/aiTradingEngine.js';

let isRunning = false;

export function startAiTradingWorker(prisma: PrismaClient, io: SocketServer) {
  const intervalMs = parseInt(process.env.AI_TRADING_WORKER_INTERVAL_MS || '5000', 10);

  setInterval(async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      const processed = await processDueAiAgents(prisma, io);
      if (processed > 0) {
        console.log(`[AiTradingWorker] processed ${processed} due AI agents`);
      }
    } catch (err: any) {
      console.error('[AiTradingWorker] Error:', err.message);
    } finally {
      isRunning = false;
    }
  }, intervalMs);

  console.log(`[AiTradingWorker] Started, scheduler interval=${intervalMs}ms`);
}
