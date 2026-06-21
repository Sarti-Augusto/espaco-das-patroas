import { createClient } from 'npm:@supabase/supabase-js@2';
import { errorMessage, jsonResponse, requireEnv } from '../_shared/http.ts';
import { getMercadoPagoPayment, normalizePaymentStatus } from '../_shared/mercado-pago.ts';

function parseSignature(header: string): { ts: string; v1: string } | null {
  const parts = Object.fromEntries(
    header.split(',').map(part => part.trim().split('=', 2)).filter(pair => pair.length === 2)
  );
  return parts.ts && parts.v1 ? { ts: parts.ts, v1: parts.v1.toLowerCase() } : null;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

function secureEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

async function sha256(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return jsonResponse(request, { ok: true });

  const rawBody = await request.text();
  let body: Record<string, any> = {};
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return jsonResponse(request, { error: 'Invalid payload' }, 400);
  }

  try {
    const signatureSecret = Deno.env.get('MERCADO_PAGO_WEBHOOK_SECRET')?.trim();
    const signature = parseSignature(request.headers.get('x-signature') || '');
    const requestId = request.headers.get('x-request-id') || '';
    const url = new URL(request.url);
    const dataId = String(url.searchParams.get('data.id') || body?.data?.id || '').toLowerCase();

    if (!dataId) {
      return jsonResponse(request, { error: 'Missing payment identifier' }, 400);
    }

    if (signatureSecret && (!signature || !requestId)) {
      return jsonResponse(request, { error: 'Missing webhook signature' }, 401);
    }

    if (signatureSecret && signature) {
      const manifest = `id:${dataId};request-id:${requestId};ts:${signature.ts};`;
      const expectedSignature = await hmacSha256(signatureSecret, manifest);
      if (!secureEqual(expectedSignature, signature.v1)) {
        return jsonResponse(request, { error: 'Invalid webhook signature' }, 401);
      }
    }

    const eventType = String(body.type || body.action || 'payment');
    if (!eventType.toLowerCase().includes('payment')) return jsonResponse(request, { ok: true, ignored: true });

    const accessToken = requireEnv('MERCADO_PAGO_ACCESS_TOKEN');
    const supabaseUrl = requireEnv('SUPABASE_URL');
    const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const providerPayment = await getMercadoPagoPayment(accessToken, dataId);
    const providerPaymentId = String(providerPayment.id);
    const eventId = String(body.id || `${requestId}:${providerPaymentId}:${providerPayment.status}`);

    const { data: previousEvent } = await admin.from('payment_events')
      .select('id').eq('provider', 'mercado_pago').eq('provider_event_id', eventId).maybeSingle();
    if (previousEvent) return jsonResponse(request, { ok: true, duplicate: true });

    let paymentQuery = admin.from('payments').select('*');
    paymentQuery = providerPayment.external_reference
      ? paymentQuery.eq('id', providerPayment.external_reference)
      : paymentQuery.eq('provider_payment_id', providerPaymentId);
    const { data: payment, error: paymentError } = await paymentQuery.maybeSingle();
    if (paymentError) throw paymentError;
    if (!payment) return jsonResponse(request, { ok: true, unmatched: true });

    const status = normalizePaymentStatus(providerPayment.status);
    const now = new Date().toISOString();
    const paymentUpdates: Record<string, unknown> = {
      provider_payment_id: providerPaymentId,
      status,
      status_detail: providerPayment.status_detail || null,
      updated_at: now
    };
    if (status === 'approved') paymentUpdates.paid_at = providerPayment.date_approved || now;
    if (status === 'refunded') paymentUpdates.refunded_at = now;

    const { error: updatePaymentError } = await admin.from('payments').update(paymentUpdates).eq('id', payment.id);
    if (updatePaymentError) throw updatePaymentError;

    const appointmentUpdates: Record<string, unknown> = { updated_at: now };
    if (status === 'approved') {
      appointmentUpdates.status = 'Confirmado';
      appointmentUpdates.payment_status = 'Pago';
      appointmentUpdates.payment_date = now.slice(0, 10);
      appointmentUpdates.amount_paid = Number(providerPayment.transaction_amount || payment.amount);
      appointmentUpdates.confirmed_at = providerPayment.date_approved || now;
      appointmentUpdates.expires_at = null;
    } else if (['rejected', 'cancelled', 'expired'].includes(status)) {
      appointmentUpdates.status = status === 'expired' ? 'Expirado' : 'Cancelado';
      appointmentUpdates.payment_status = status === 'expired' ? 'Expirado' : 'Recusado';
    } else if (['refunded', 'charged_back'].includes(status)) {
      appointmentUpdates.status = 'Cancelado';
      appointmentUpdates.payment_status = status === 'refunded' ? 'Reembolsado' : 'Contestado';
    } else {
      appointmentUpdates.payment_status = 'Pendente';
    }

    const { error: appointmentError } = await admin.from('appointments')
      .update(appointmentUpdates).eq('id', payment.appointment_id);
    if (appointmentError) throw appointmentError;

    await admin.from('payment_events').insert({
      provider: 'mercado_pago',
      provider_event_id: eventId,
      provider_payment_id: providerPaymentId,
      event_type: eventType,
      payload_hash: await sha256(rawBody),
      result: status
    });

    return jsonResponse(request, { ok: true });
  } catch (error) {
    console.error('mercado-pago-webhook failed:', errorMessage(error));
    return jsonResponse(request, { error: 'Webhook processing failed' }, 500);
  }
});
