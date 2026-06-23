import { createClient } from 'npm:@supabase/supabase-js@2';
import { hasCompletedService } from '../_shared/booking-policy.ts';
import { corsHeaders, errorMessage, jsonResponse, requireEnv } from '../_shared/http.ts';

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return jsonResponse(request, { error: 'Method not allowed' }, 405);

  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return jsonResponse(request, { error: 'Authentication required' }, 401);

  try {
    const supabaseUrl = requireEnv('SUPABASE_URL');
    const userClient = createClient(supabaseUrl, requireEnv('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false }
    });
    const admin = createClient(supabaseUrl, requireEnv('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return jsonResponse(request, { error: 'Invalid session' }, 401);

    const [{ data: profile, error: profileError }, { data: config, error: configError }] = await Promise.all([
      admin.from('users').select('id, role, status').eq('auth_user_id', authData.user.id).single(),
      admin.from('payment_config').select('deposit_percentage, pix_expiration_minutes, allow_cash, max_installments').eq('id', true).single()
    ]);

    if (profileError || !profile || profile.role !== 'client' || String(profile.status || '').toLowerCase() === 'pendente') {
      return jsonResponse(request, { error: 'Client profile is not allowed to book' }, 403);
    }
    if (configError || !config) throw configError || new Error('Payment configuration not found');

    const recurring = await hasCompletedService(admin, profile.id);
    return jsonResponse(request, {
      requiresDeposit: !recurring,
      canPayAtAppointment: recurring && Boolean(config.allow_cash),
      depositPercentage: Number(config.deposit_percentage || 50),
      pixExpirationMinutes: Number(config.pix_expiration_minutes || 15),
      maxInstallments: Number(config.max_installments || 1),
      mercadoPagoPublicKey: Deno.env.get('MERCADO_PAGO_PUBLIC_KEY')?.trim() || null
    });
  } catch (error) {
    console.error('get-booking-payment-options failed:', errorMessage(error));
    return jsonResponse(request, { error: 'Could not load payment options' }, 500);
  }
});