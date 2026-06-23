import { createClient } from 'npm:@supabase/supabase-js@2';
import { hasCompletedService } from '../_shared/booking-policy.ts';
import { corsHeaders, errorMessage, jsonResponse, requireEnv } from '../_shared/http.ts';
import { createMercadoPagoPayment, normalizePaymentStatus } from '../_shared/mercado-pago.ts';

type CheckoutRequest = {
  serviceIds?: string[];
  appointmentDate?: string;
  appointmentTime?: string;
  method?: 'pix' | 'card' | 'cash';
  card?: {
    token?: string;
    paymentMethodId?: string;
    issuerId?: string;
    installments?: number;
    identificationType?: string;
    identificationNumber?: string;
  };
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function toMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(request) });
  }
  if (request.method !== 'POST') return jsonResponse(request, { error: 'Method not allowed' }, 405);

  const supabaseUrl = requireEnv('SUPABASE_URL');
  const anonKey = requireEnv('SUPABASE_ANON_KEY');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization') || '';

  if (!authorization.startsWith('Bearer ')) {
    return jsonResponse(request, { error: 'Authentication required' }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false }
  });
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return jsonResponse(request, { error: 'Invalid session' }, 401);

  let appointmentId: string | null = null;
  let paymentId: string | null = null;

  try {
    const body = await request.json() as CheckoutRequest;
    const serviceIds = [...new Set((body.serviceIds || []).map(String))];
    const appointmentDate = String(body.appointmentDate || '');
    const appointmentTime = String(body.appointmentTime || '').slice(0, 5);
    const method = body.method;

    if (!serviceIds.length || serviceIds.length > 10 || serviceIds.some(id => !isUuid(id))) {
      return jsonResponse(request, { error: 'Invalid services' }, 400);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate) || !/^\d{2}:\d{2}$/.test(appointmentTime)) {
      return jsonResponse(request, { error: 'Invalid appointment date or time' }, 400);
    }
    if (!['pix', 'card', 'cash'].includes(String(method))) {
      return jsonResponse(request, { error: 'Invalid payment method' }, 400);
    }

    const [{ data: profile, error: profileError }, { data: services, error: servicesError }, { data: config, error: configError }] = await Promise.all([
      admin.from('users').select('id, name, email, phone, status, role').eq('auth_user_id', authData.user.id).single(),
      admin.from('services').select('id, name, price').in('id', serviceIds).eq('is_active', true),
      admin.from('payment_config').select('deposit_percentage, pix_expiration_minutes, allow_cash, max_installments').eq('id', true).single()
    ]);

    if (profileError || !profile || profile.role !== 'client' || String(profile.status || '').toLowerCase() === 'pendente') {
      return jsonResponse(request, { error: 'Client profile is not allowed to book' }, 403);
    }
    if (servicesError || !services || services.length !== serviceIds.length) {
      return jsonResponse(request, { error: 'One or more services are unavailable' }, 409);
    }
    if (configError || !config) throw configError || new Error('Payment configuration not found');

    const recurring = await hasCompletedService(admin, profile.id);
    if (method === 'cash' && (!config.allow_cash || !recurring)) {
      return jsonResponse(request, { error: 'Paying at the appointment is only available after a completed service' }, 403);
    }

    const card = body.card || {};
    const installments = Math.max(1, Math.floor(Number(card.installments || 1)));
    if (method === 'card' && (!card.token || !card.paymentMethodId || installments > Number(config.max_installments || 1))) {
      return jsonResponse(request, { error: 'Invalid card payment data' }, 400);
    }

    const totalAmount = toMoney(services.reduce((sum, service) => sum + Number(service.price || 0), 0));
    const depositPercentage = Number(config.deposit_percentage || 50);
    const requiresOnlinePayment = method === 'pix' || method === 'card';
    const amountDue = requiresOnlinePayment ? toMoney(totalAmount * depositPercentage / 100) : totalAmount;
    const expiresAt = requiresOnlinePayment
      ? new Date(Date.now() + Number(config.pix_expiration_minutes || 15) * 60_000).toISOString()
      : null;

    await admin.from('appointments').update({
      status: 'Expirado', payment_status: 'Expirado', updated_at: new Date().toISOString()
    }).eq('appointment_date', appointmentDate)
      .eq('appointment_time', appointmentTime + ':00')
      .eq('status', 'Aguardando pagamento')
      .lte('expires_at', new Date().toISOString());

    const { data: appointment, error: appointmentError } = await admin.from('appointments').insert({
      user_id: profile.id,
      services_names: services.map(service => service.name).join(', '),
      price: totalAmount,
      appointment_date: appointmentDate,
      appointment_time: appointmentTime,
      payment_method: method,
      payment_status: 'Pendente',
      payment_date: null,
      status: requiresOnlinePayment ? 'Aguardando pagamento' : 'Confirmado',
      expires_at: expiresAt,
      confirmed_at: method === 'cash' ? new Date().toISOString() : null,
      amount_due: amountDue,
      amount_paid: 0,
      payment_percentage: requiresOnlinePayment ? depositPercentage : 100
    }).select().single();

    if (appointmentError) {
      if (appointmentError.code === '23505') return jsonResponse(request, { error: 'This time is no longer available' }, 409);
      throw appointmentError;
    }
    appointmentId = appointment.id;

    const { error: itemsError } = await admin.from('appointment_items').insert(
      services.map(service => ({
        appointment_id: appointment.id,
        service_id: service.id,
        service_name: service.name,
        unit_price: Number(service.price),
        quantity: 1
      }))
    );
    if (itemsError) throw itemsError;

    if (method === 'cash') {
      return jsonResponse(request, { kind: 'cash', appointment, eligibility: { requiresDeposit: false } });
    }

    paymentId = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();
    const { error: paymentInsertError } = await admin.from('payments').insert({
      id: paymentId,
      appointment_id: appointment.id,
      user_id: profile.id,
      idempotency_key: idempotencyKey,
      amount: amountDue,
      method,
      status: 'pending',
      expires_at: expiresAt
    });
    if (paymentInsertError) throw paymentInsertError;

    const accessToken = requireEnv('MERCADO_PAGO_ACCESS_TOKEN');
    const providerPayload: Record<string, unknown> = {
      transaction_amount: amountDue,
      description: ('Sinal Espaco das Patroas - ' + services.map(service => service.name).join(', ')).slice(0, 250),
      payment_method_id: method === 'pix' ? 'pix' : card.paymentMethodId,
      external_reference: paymentId,
      notification_url: supabaseUrl + '/functions/v1/mercado-pago-webhook',
      payer: {
        email: profile.email,
        first_name: String(profile.name || 'Cliente').split(' ')[0],
        ...(method === 'card' && card.identificationType && card.identificationNumber ? {
          identification: { type: card.identificationType, number: card.identificationNumber }
        } : {})
      },
      metadata: { payment_id: paymentId, appointment_id: appointment.id }
    };
    if (method === 'pix') providerPayload.date_of_expiration = expiresAt;
    if (method === 'card') {
      providerPayload.token = card.token;
      providerPayload.installments = installments;
      if (card.issuerId) providerPayload.issuer_id = card.issuerId;
    }

    const mpPayment = await createMercadoPagoPayment(accessToken, idempotencyKey, providerPayload);
    const transactionData = mpPayment.point_of_interaction?.transaction_data || {};
    const normalizedStatus = normalizePaymentStatus(mpPayment.status);
    const { data: payment, error: paymentUpdateError } = await admin.from('payments').update({
      provider_payment_id: String(mpPayment.id),
      status: normalizedStatus,
      status_detail: mpPayment.status_detail || null,
      qr_code: transactionData.qr_code || null,
      qr_code_base64: transactionData.qr_code_base64 || null,
      ticket_url: transactionData.ticket_url || null,
      updated_at: new Date().toISOString()
    }).eq('id', paymentId).select().single();
    if (paymentUpdateError) throw paymentUpdateError;

    if (method === 'card') {
      const now = new Date().toISOString();
      if (normalizedStatus === 'approved') {
        const { data: confirmedAppointment, error: confirmError } = await admin.from('appointments').update({
          status: 'Confirmado',
          payment_status: 'Pago',
          payment_date: now.slice(0, 10),
          amount_paid: Number(mpPayment.transaction_amount || amountDue),
          confirmed_at: mpPayment.date_approved || now,
          expires_at: null,
          updated_at: now
        }).eq('id', appointment.id).select().single();
        if (confirmError) throw confirmError;
        return jsonResponse(request, { kind: 'card', outcome: 'approved', appointment: confirmedAppointment, payment });
      }

      if (['rejected', 'cancelled', 'expired'].includes(normalizedStatus)) {
        await admin.from('appointments').update({
          status: 'Cancelado',
          payment_status: 'Recusado',
          updated_at: now
        }).eq('id', appointment.id);
        return jsonResponse(request, { kind: 'card', outcome: 'rejected', appointment, payment });
      }

      return jsonResponse(request, { kind: 'card', outcome: 'pending', appointment, payment });
    }

    return jsonResponse(request, { kind: 'pix', appointment, payment });
  } catch (error) {
    console.error('create-booking-payment failed:', errorMessage(error));
    if (paymentId) {
      await admin.from('payments').update({ status: 'error', status_detail: errorMessage(error), updated_at: new Date().toISOString() }).eq('id', paymentId);
    }
    if (appointmentId) {
      await admin.from('appointments').update({ status: 'Cancelado', payment_status: 'Erro no pagamento', updated_at: new Date().toISOString() }).eq('id', appointmentId);
    }
    const message = errorMessage(error);
    const missingSecret = message.startsWith('Missing required secret:');
    return jsonResponse(request, { error: missingSecret ? 'Payment provider is not configured' : 'Could not create payment' }, missingSecret ? 503 : 500);
  }
});
