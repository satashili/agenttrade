import path from 'node:path';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

import {
  defaultMatchxLeverage,
  initialMatchxBalance,
  toMatchxOrderSide,
  toMatchxOrderType,
  toMatchxSymbol,
  type AgentOrderSide,
  type AgentOrderType,
} from './matchxMapper.js';

type GrpcClient = grpc.Client & Record<string, any>;

export interface MatchxAccountInfo {
  userId: number;
  walletBalance: number;
  initialBalance: number;
  totalEquity: number;
  unrealizedPnl: number;
  totalInitialMargin: number;
  availableBalance: number;
}

export interface MatchxPositionInfo {
  symbol: string;
  positionSide: 'LONG' | 'SHORT' | string;
  leverage: number;
  size: number;
  entryPrice: number;
  avgPrice: number;
  markPrice: number;
  margin: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  liquidationPrice: number;
}

export interface MatchxOrderInfo {
  orderId: number;
  userId: number;
  symbol: string;
  type: string;
  side: string;
  positionSide: string;
  quantity: number;
  stopPrice: number;
  leverage: number;
  status: string;
  createTime: number;
  filledQty: number;
  avgFillPrice: number;
  commission: number;
}

export interface MatchxTradeInfo {
  tradeId: number;
  orderId: number;
  userId: number;
  symbol: string;
  side: string;
  positionSide: string;
  price: number;
  quantity: number;
  commission: number;
  realizedPnl: number;
  tradeTime: number;
  closeReason: string;
  leverage: number;
}

export interface MatchxPlaceOrderInput {
  userId: number;
  symbol: string;
  side: AgentOrderSide;
  type: AgentOrderType;
  quantity: number;
  price?: number;
  leverage?: number;
  positionSide: 'LONG' | 'SHORT';
}

export interface MatchxPlaceOrderResult {
  order?: MatchxOrderInfo;
  trades: MatchxTradeInfo[];
}

class MatchxClient {
  private service: GrpcClient;
  private streamService: GrpcClient;

  constructor() {
    const protoDir = process.env.MATCHX_PROTO_DIR || '/home/ubuntu/111/matchx-engine/proto';
    const protoPath = path.join(protoDir, 'matchx_service.proto');
    const grpcUrl = process.env.MATCHX_GRPC_URL || '127.0.0.1:6012';

    const packageDef = protoLoader.loadSync(protoPath, {
      includeDirs: [protoDir],
      keepCase: false,
      longs: Number,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const loaded = grpc.loadPackageDefinition(packageDef) as any;
    const matchx = loaded.matchx;
    if (!matchx?.MatchXService || !matchx?.MatchXStreamService) {
      throw new Error(`MatchX services not found in proto: ${protoPath}`);
    }

    this.service = new matchx.MatchXService(grpcUrl, grpc.credentials.createInsecure());
    this.streamService = new matchx.MatchXStreamService(grpcUrl, grpc.credentials.createInsecure());
  }

  close() {
    this.service.close();
    this.streamService.close();
  }

  async health(): Promise<any> {
    return this.unary('Health', {});
  }

  async createAccount(userId: number, initialBalance = initialMatchxBalance()): Promise<MatchxAccountInfo> {
    const response = await this.unary('CreateAccount', {
      userId,
      initialBalance,
      contractType: 'USDT_MARGINED',
    });
    this.assertOk(response, 'CreateAccount');
    return response.account;
  }

  async getAccount(userId: number): Promise<MatchxAccountInfo> {
    const response = await this.unary('GetAccount', { userId });
    this.assertOk(response, 'GetAccount');
    return response.account;
  }

  async getPositions(userId: number, symbol?: string): Promise<MatchxPositionInfo[]> {
    const response = await this.unary('GetPositions', {
      userId,
      symbol: symbol ? toMatchxSymbol(symbol) : '',
    });
    this.assertOk(response, 'GetPositions');
    return response.positions || [];
  }

  async getOpenOrders(userId: number): Promise<MatchxOrderInfo[]> {
    const response = await this.unary('GetOpenOrders', { userId });
    this.assertOk(response, 'GetOpenOrders');
    return response.orders || [];
  }

  async placeOrder(input: MatchxPlaceOrderInput): Promise<MatchxPlaceOrderResult> {
    const request: Record<string, any> = {
      userId: input.userId,
      symbol: toMatchxSymbol(input.symbol),
      side: toMatchxOrderSide(input.side),
      positionSide: input.positionSide,
      type: toMatchxOrderType(input.type),
      quantity: input.quantity,
      leverage: input.leverage || defaultMatchxLeverage(),
      workingType: 'CONTRACT_PRICE',
    };

    if (input.type === 'stop' || input.type === 'limit') {
      request.stopPrice = input.price || 0;
    }

    const response = await this.unary('PlaceOrder', request);
    this.assertOk(response, 'PlaceOrder');
    return {
      order: response.order,
      trades: response.trades || [],
    };
  }

  async cancelOrder(userId: number, orderId: number, symbol: string): Promise<any> {
    const response = await this.unary('CancelOrder', {
      userId,
      orderId,
      symbol: toMatchxSymbol(symbol),
    });
    this.assertOk(response, 'CancelOrder');
    return response;
  }

  subscribeAccountEvents(userId: number): grpc.ClientReadableStream<any> {
    const fn = this.getMethod(this.streamService, 'SubscribeAccountEvents');
    return fn.call(this.streamService, { userId });
  }

  private unary(method: string, request: Record<string, any>): Promise<any> {
    const fn = this.getMethod(this.service, method);
    const timeoutMs = Number(process.env.MATCHX_GRPC_TIMEOUT_MS || '5000');
    const deadline = new Date(Date.now() + (Number.isFinite(timeoutMs) ? timeoutMs : 5000));

    return new Promise((resolve, reject) => {
      fn.call(this.service, request, new grpc.Metadata(), { deadline }, (err: grpc.ServiceError | null, response: any) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(response);
      });
    });
  }

  private getMethod(client: GrpcClient, method: string) {
    const lower = method.charAt(0).toLowerCase() + method.slice(1);
    const fn = client[method] || client[lower];
    if (typeof fn !== 'function') {
      throw new Error(`MatchX gRPC method not found: ${method}`);
    }
    return fn;
  }

  private assertOk(response: any, method: string) {
    const header = response?.header;
    if (!header) return;
    if (Number(header.code) !== 0) {
      throw new Error(`MatchX ${method} failed: ${header.message || header.code}`);
    }
  }
}

let singleton: MatchxClient | null = null;

export function getMatchxClient(): MatchxClient {
  if (!singleton) singleton = new MatchxClient();
  return singleton;
}
