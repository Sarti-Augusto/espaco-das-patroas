export type MercadoPagoPayment = {
  id: number | string;
  status: string;
  status_detail?: string;
  date_approved?: string;
  transaction_amount?: number;
  external_reference?: string;
  metadata?: Record<string, unknown>;
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string;
      qr_code_base64?: string;
      ticket_url?: string;
    };
  };
};

async function mercadoPagoRequest<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.message || payload?.error || `Mercado Pago HTTP ${response.status}`;
    throw new Error(String(detail));
  }

  return payload as T;
}

export function createMercadoPagoPayment(
  accessToken: string,
  idempotencyKey: string,
  payload: Record<string, unknown>
): Promise<MercadoPagoPayment> {
  return mercadoPagoRequest<MercadoPagoPayment>(accessToken, '/v1/payments', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': idempotencyKey },
    body: JSON.stringify(payload)
  });
}

export const createPixPayment = createMercadoPagoPayment;

export function getMercadoPagoPayment(
  accessToken: string,
  paymentId: string
): Promise<MercadoPagoPayment> {
  return mercadoPagoRequest<MercadoPagoPayment>(
    accessToken,
    `/v1/payments/${encodeURIComponent(paymentId)}`
  );
}

export function normalizePaymentStatus(status: string): string {
  const normalized = String(status || '').toLowerCase();
  if (['pending', 'in_process', 'approved', 'rejected', 'cancelled', 'refunded', 'charged_back'].includes(normalized)) {
    return normalized;
  }
  return normalized === 'expired' ? 'expired' : 'error';
}
