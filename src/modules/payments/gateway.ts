import { env } from '../../config/env';
import { hmac, randomToken, safeEqual } from '../../common/utils/crypto';

export interface GatewayOrder {
  orderId: string;
  checkout: Record<string, unknown>;
}

export interface PaymentGateway {
  name: string;
  createOrder(input: { amount: number; currency: string; receipt: string }): Promise<GatewayOrder>;
  verify(input: { orderId: string; paymentId: string; signature: string }): boolean;
}

const sign = (orderId: string, paymentId: string) => hmac(`${orderId}|${paymentId}`, env.PAYMENT_WEBHOOK_SECRET);

class MockGateway implements PaymentGateway {
  name = 'mock';
  async createOrder(input: { amount: number; currency: string; receipt: string }): Promise<GatewayOrder> {
    const orderId = `order_${randomToken(8)}`;
    const checkout: Record<string, unknown> = { provider: 'mock', orderId, amount: input.amount, currency: input.currency, receipt: input.receipt };
    if (!env.isProd) {
      const paymentId = `pay_${randomToken(6)}`;
      checkout.devHint = { paymentId, signature: sign(orderId, paymentId), note: 'Submit these to POST /api/v1/user/payments/{id}/verify to simulate a successful gateway payment' };
    }
    return { orderId, checkout };
  }
  verify(input: { orderId: string; paymentId: string; signature: string }) {
    return safeEqual(sign(input.orderId, input.paymentId), input.signature);
  }
}

export const paymentGateway: PaymentGateway = new MockGateway();
export const signGatewayPayload = sign;
