// ==========================================
// SUPABASE CONFIGURATION
// ==========================================
const SUPABASE_URL = 'https://ujidqagyllheibmuuboy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqaWRxYWd5bGxoZWlibXV1Ym95Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5NzM2NTUsImV4cCI6MjA5MTU0OTY1NX0.lHX5WB9WCY_pEgXcN4hvve3Pi5xqJgITbESrxiO3Nwk';
const APP_BASE_URL = 'https://espaco-das-patroas.vercel.app';
const PUBLIC_DATA_CACHE_KEY = 'espacoPatroas_publicDataCache_v1';
const PROFILE_IMAGE_FALLBACK = '/icon-512x512.png';
const SERVICE_IMAGE_PLACEHOLDER = 'https://via.placeholder.com/400x400?text=Servico';
const SERVICE_CARD_PLACEHOLDER = 'https://via.placeholder.com/400x300?text=Servico';
const IMAGE_UPLOAD_BUCKET = 'service-images';
const IMAGE_UPLOAD_MAX_SIZE = 5 * 1024 * 1024;
const IMAGE_SOURCE_MAX_SIZE = 25 * 1024 * 1024;
const IMAGE_UPLOAD_MAX_DIMENSION = 1200;
const IMAGE_UPLOAD_QUALITY = 0.82;
const ALLOWED_UPLOAD_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

let db = {
    users: [],
    services: [],
    settings: { profileImg: "" },
    paymentConfig: { deposit_percentage: 50, pix_expiration_minutes: 15, allow_cash: true, max_installments: 1 },
    appointmentsCache: [],
    scheduleConfig: { start: "09:00", end: "18:00", slotDuration: 3, availableDays: [1, 2, 3, 4, 5], blockedDates: [] },
    gallery: [], 
    currentUser: null,
    isAdmin: false
};
let isDbLoaded = false;
let isPublicDataLoaded = false;
let publicDataPromise = null;
let pendingLoginRole = localStorage.getItem('espacoPatroas_pendingLoginRole') || 'client';
let authListenerAttached = false;
let authProfilePromise = null;
let lastAuthErrorMessage = '';
let selectedServiceImageFile = null;
let selectedGalleryImageFile = null;
let selectedClientProfileImageFile = null;
let selectedPaymentAmountMode = 'deposit';

function getSupabaseService() {
    if (window.supabaseService) {
        return window.supabaseService;
    }

    throw new Error('supabase-service.js nao carregou.');
}

async function initSupabase() {
    try {
        window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
                flowType: 'implicit'
            }
        });
        attachAuthListener();
        hydratePublicDataFromCache();
        isDbLoaded = true;
        console.log('Supabase conectado!');
        loadPublicData();
        updateManuProfilePhoto();
    } catch (error) {
        console.error('Erro ao conectar com Supabase:', error);
    }
}

async function loadPublicData() {
    if (publicDataPromise) return publicDataPromise;

    publicDataPromise = (async () => {
        const service = getSupabaseService();
        const payload = await service.fetchEssentialPublicAppData();
        applyPublicDataPayload(payload, { includeGallery: false });
        isPublicDataLoaded = true;
        cachePublicData();
        updateManuProfilePhoto();
        refreshVisiblePublicData();
        warmGalleryData();
    })().catch(error => {
        console.error('Erro ao carregar dados:', error);
        showToast(error.message || 'Erro ao carregar dados do aplicativo.');
    }).finally(() => {
        publicDataPromise = null;
    });

    return publicDataPromise;
}

function applyPublicDataPayload(payload, options = {}) {
    const { includeGallery = true } = options;
    const { services, settings, scheduleRows, gallery, errors = [] } = payload || {};
    const hasServicesError = errors.some(entry => entry.scope === 'services');
    const hasGalleryError = errors.some(entry => entry.scope === 'gallery');

    if (!hasServicesError) {
        db.services = (services || []).filter(s => s.is_active === true || s.is_active === 'true');
    }
    db.settings = { profileImg: "" };
    if (includeGallery && !hasGalleryError) {
        db.gallery = (gallery || []).filter(g => g.is_active === true || g.is_active === 'true');
    }

    db.scheduleConfig = { start: "09:00", end: "18:00", slotDuration: 3, availableDays: [1, 2, 3, 4, 5], blockedDates: [] };

    if (errors.length > 0) {
        console.warn('Falhas parciais ao carregar dados publicos:', errors);
        if (hasServicesError || (includeGallery && hasGalleryError)) {
            showToast('Nao foi possivel atualizar todo o catalogo agora. Tentando manter os dados anteriores.');
        }
    }

    if (settings && settings.length > 0) {
        const profileSetting = settings.find(s => s.setting_key === 'profileImg');
        if (profileSetting && profileSetting.setting_value) db.settings.profileImg = profileSetting.setting_value;
    }

    if (scheduleRows && scheduleRows.length > 0) {
        db.scheduleConfig = {
            start: scheduleRows[0].start_time || "09:00",
            end: scheduleRows[0].end_time || "18:00",
            slotDuration: Number(scheduleRows[0].slot_duration) || 3,
            availableDays: (scheduleRows[0].available_days || [1, 2, 3, 4, 5]).map(Number),
            blockedDates: (scheduleRows[0].blocked_dates || []).map(String)
        };
    }
}

function hydratePublicDataFromCache() {
    try {
        const cached = JSON.parse(localStorage.getItem(PUBLIC_DATA_CACHE_KEY) || 'null');
        if (!cached || !Array.isArray(cached.services)) return false;
        db.services = cached.services;
        db.settings = cached.settings || { profileImg: "" };
        db.scheduleConfig = cached.scheduleConfig || db.scheduleConfig;
        isPublicDataLoaded = db.services.length > 0;
        return isPublicDataLoaded;
    } catch (error) {
        console.warn('Cache publico invalido:', error);
        localStorage.removeItem(PUBLIC_DATA_CACHE_KEY);
        return false;
    }
}

function cachePublicData() {
    try {
        localStorage.setItem(PUBLIC_DATA_CACHE_KEY, JSON.stringify({
            services: db.services,
            settings: db.settings,
            scheduleConfig: db.scheduleConfig,
            cachedAt: Date.now()
        }));
    } catch (error) {
        console.warn('Nao foi possivel salvar cache publico:', error);
    }
}

async function loadGalleryData() {
    const gallery = await getSupabaseService().fetchGalleryData();
    db.gallery = (gallery || []).filter(g => g.is_active === true || g.is_active === 'true');
    return db.gallery;
}

function warmGalleryData() {
    loadGalleryData()
        .then(() => {
            if (document.getElementById('page-gallery')?.classList.contains('active')) renderClientGallery();
            if (!document.getElementById('admin-view')?.classList.contains('hidden') && currentAdminSection === 'gallery') renderAdminGallery();
        })
        .catch(error => {
            console.warn('Nao foi possivel pre-carregar catalogo:', error);
        });
}

async function loadAllData() {
    await loadPublicData();
    await ensureAuthenticatedProfile();
}

async function ensureAuthenticatedProfile(options = {}) {
    const { includeProtectedData = true, sessionUser = null } = options;
    if (authProfilePromise) return authProfilePromise;

    authProfilePromise = (async () => {
        await syncAuthProfile(sessionUser);
        if (includeProtectedData) {
            await loadProtectedDataForCurrentUser();
        }
        return db.currentUser;
    })().finally(() => {
        authProfilePromise = null;
    });

    return authProfilePromise;
}

function warmProtectedDataForCurrentUser() {
    if (!db.currentUser) return;
    loadProtectedDataForCurrentUser().catch(error => {
        console.warn('Nao foi possivel pre-carregar dados protegidos:', error);
    });
}

function refreshVisiblePublicData() {
    if (document.getElementById('page-home')?.classList.contains('active')) {
        renderServices();
        updateCartFab();
    }
    if (document.getElementById('page-gallery')?.classList.contains('active')) {
        renderClientGallery();
    }
    if (!document.getElementById('admin-view')?.classList.contains('hidden')) {
        if (currentAdminSection === 'portfolio') renderServicesGridAdmin();
        if (currentAdminSection === 'gallery') renderAdminGallery();
        if (currentAdminSection === 'settings') renderAdminSettings();
    }
}

async function loadProtectedDataForCurrentUser() {
    if (!db.currentUser) return;

    const protectedData = await getSupabaseService().fetchProtectedData({
        currentUserId: db.currentUser.id,
        isAdmin: db.isAdmin
    });

    db.users = db.isAdmin ? (protectedData.users || []) : [db.currentUser];
    db.appointmentsCache = protectedData.appointments || [];
}

function saveSession() {
    if (db.currentUser) {
        localStorage.setItem('espacoPatroas_currentUser', db.currentUser.id);
    }
}

async function clearSession() {
    localStorage.removeItem('espacoPatroas_currentUser');
    localStorage.removeItem('espacoPatroas_pendingLoginRole');
    Object.keys(localStorage)
        .filter(key => key.startsWith('sb-') || key.includes('supabase.auth.token'))
        .forEach(key => localStorage.removeItem(key));

    if (window.supabase?.auth?.signOut) {
        try {
            await withTimeout(window.supabase.auth.signOut(), 3000);
        } catch (error) {
            console.warn('Logout remoto nao concluido, sessao local limpa:', error);
        }
    }

    db.currentUser = null;
    db.isAdmin = false;
    stopAdminAppointmentNotifications();
}

// ==========================================
// SUPABASE FUNCTIONS
// ==========================================

async function supabaseLogin(email) {
    showToast('Entre com Gmail para continuar.');
    return null;
}

async function syncAuthProfile(sessionUser = null) {
    if (!window.supabase?.auth) return null;

    let user = sessionUser;
    if (!user?.email) {
        const { data } = await window.supabase.auth.getUser();
        user = data?.user;
    }
    if (!user?.email) {
        db.currentUser = null;
        db.isAdmin = false;
        return null;
    }

    const { data, error } = await window.supabase.rpc('link_current_user_profile');
    if (error) throw error;

    const profile = Array.isArray(data) ? data[0] : data;
    if (!profile) return null;

    const index = db.users.findIndex(u => u.id === profile.id);
    if (index !== -1) db.users[index] = profile;
    else db.users.push(profile);

    db.currentUser = profile;
    db.isAdmin = isAdminProfile(profile);
    saveSession();
    return profile;
}

function isAdminProfile(profile) {
    if (!profile) return false;

    const role = String(profile.role || '').trim().toLowerCase();
    const email = String(profile.email || '').trim().toLowerCase();
    return role === 'admin' || email === ADMIN_EMAIL.toLowerCase();
}

function isAdminEntryPage() {
    const pathname = window.location.pathname.toLowerCase().replace(/\/$/, '');
    return pathname === '/admin' || pathname === '/admin.html';
}

function getDefaultLoginRole() {
    return isAdminEntryPage() ? 'admin' : 'client';
}

function getPendingLoginRole() {
    const storedRole = localStorage.getItem('espacoPatroas_pendingLoginRole');
    if (isAdminEntryPage() && storedRole !== 'admin') return 'admin';
    return storedRole || getDefaultLoginRole();
}

function getRedirectUrl(role) {
    localStorage.setItem('espacoPatroas_pendingLoginRole', role);
    if (!window.location.protocol.startsWith('http')) return undefined;

    const redirectPath = role === 'admin' ? '/admin.html' : '/';
    const url = new URL(redirectPath, getAuthRedirectBaseUrl());
    url.searchParams.set('loginRole', role);
    if (shouldUseLocalAuthRedirect()) url.searchParams.set('devAuth', '1');
    return url.toString();
}

function getPasswordRecoveryRedirectUrl(role) {
    const redirectUrl = getRedirectUrl(role);
    if (!redirectUrl) return undefined;
    const url = new URL(redirectUrl);
    url.searchParams.set('passwordRecovery', '1');
    return url.toString();
}

function shouldUseLocalAuthRedirect() {
    const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
    const params = new URLSearchParams(window.location.search);
    return isLocalhost && (
        params.get('devAuth') === '1' ||
        localStorage.getItem('espacoPatroas_devAuthRedirect') === 'true'
    );
}

function getAuthRedirectBaseUrl() {
    if (shouldUseLocalAuthRedirect()) return window.location.origin;
    return APP_BASE_URL;
}

function withTimeout(promise, timeoutMs = 15000) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Tempo limite excedido. Verifique a conexÃ£o e a configuraÃ§Ã£o de Auth.')), timeoutMs);
        })
    ]);
}

function attachAuthListener() {
    if (authListenerAttached || !window.supabase?.auth) return;
    authListenerAttached = true;

    window.supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'PASSWORD_RECOVERY' && session?.user) {
            showPasswordResetModal();
            return;
        }
        if (event !== 'SIGNED_IN' || !session?.user) return;

        try {
            const expectedRole = getLoginRoleFromUrl() || getPendingLoginRole();
            await ensureAuthenticatedProfile({
                includeProtectedData: expectedRole === 'admin',
                sessionUser: session.user
            });
            if (checkAutoLogin()) {
                if (expectedRole !== 'admin') warmProtectedDataForCurrentUser();
                cleanAuthRedirectUrl();
            }
        } catch (error) {
            console.error('Erro ao processar sessao autenticada:', error);
            showToast(error.message || 'Login autenticado, mas nao foi possivel carregar seu perfil.');
        }
    });
}

function getLoginRoleFromUrl() {
    const role = new URLSearchParams(window.location.search).get('loginRole');
    return role === 'admin' ? 'admin' : role === 'client' ? 'client' : null;
}

function hasAuthRedirectPayload() {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return Boolean(
        query.get('loginRole') ||
        query.get('passwordRecovery') ||
        query.get('code') ||
        query.get('error') ||
        hash.get('access_token') ||
        hash.get('error')
    );
}

function showAuthReturnLoading() {
    if (!hasAuthRedirectPayload()) return false;

    const role = getLoginRoleFromUrl() || getPendingLoginRole();
    hideAllPages();
    const loadingPage = document.getElementById(role === 'admin' ? 'page-admin-login' : 'page-login');
    if (loadingPage) loadingPage.classList.add('active');
    setAuthStatus(null, 'Carregando login de acesso. Aguarde...');
    return true;
}

function getAuthErrorMessageFromUrl() {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return query.get('error_description') || hash.get('error_description') || query.get('error') || hash.get('error');
}

function showAuthError(message) {
    lastAuthErrorMessage = message || '';
    if (!lastAuthErrorMessage) return;
    console.error('Auth:', lastAuthErrorMessage);
    renderAuthDebugPanel(lastAuthErrorMessage);
    showToast(lastAuthErrorMessage);
}

function renderAuthDebugPanel(message = '') {
    const safeUrl = new URL(window.location.href);
    safeUrl.hash = window.location.hash ? '#[conteudo protegido]' : '';
    const safeHash = window.location.hash
        ? (window.location.hash.includes('access_token') ? '[token recebido - ocultado]' : window.location.hash)
        : '(vazio)';

    const details = [
        message,
        `URL: ${safeUrl.toString()}`,
        `Hash: ${safeHash}`,
        `Role: ${new URLSearchParams(window.location.search).get('loginRole') || getPendingLoginRole()}`
    ].filter(Boolean).join('\n');

    ['auth-debug-panel', 'admin-auth-debug-panel'].forEach(id => {
        const panel = document.getElementById(id);
        if (!panel) return;
        if (!message) {
            panel.classList.add('hidden');
            panel.textContent = '';
            return;
        }
        panel.classList.remove('hidden');
        panel.textContent = details;
        panel.style.whiteSpace = 'pre-wrap';
    });
}

function getAuthCodeFromUrl() {
    return new URLSearchParams(window.location.search).get('code');
}

function cleanAuthRedirectUrl() {
    if (!window.history?.replaceState || !window.location.protocol.startsWith('http')) return;

    const url = new URL(window.location.href);
    ['loginRole', 'devAuth', 'code', 'error', 'error_code', 'error_description'].forEach(param => {
        url.searchParams.delete(param);
    });
    url.searchParams.delete('passwordRecovery');
    const safeHash = url.hash && !url.hash.includes('access_token') ? url.hash : '';
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${safeHash}`);
}

async function processInitialAuth() {
    const roleFromUrl = getLoginRoleFromUrl();
    if (roleFromUrl) {
        pendingLoginRole = roleFromUrl;
        localStorage.setItem('espacoPatroas_pendingLoginRole', roleFromUrl);
        const loadingPage = document.getElementById(roleFromUrl === 'admin' ? 'page-admin-login' : 'page-login');
        if (loadingPage) loadingPage.classList.add('active');
        setAuthStatus(null, 'Carregando login de acesso. Aguarde...');
    }

    const authError = getAuthErrorMessageFromUrl();
    if (authError) {
        showAuthError(`Erro na autenticacao: ${authError}`);
        return false;
    }

    const authCode = getAuthCodeFromUrl();
    if (authCode) {
        try {
            const currentSession = await withTimeout(window.supabase.auth.getSession(), 5000);
            if (!currentSession.data?.session) {
                const { error: exchangeError } = await withTimeout(
                    window.supabase.auth.exchangeCodeForSession(authCode),
                    10000
                );
                if (exchangeError) throw exchangeError;
            }
        } catch (exchangeError) {
            const fallbackSession = await withTimeout(window.supabase.auth.getSession(), 5000);
            if (!fallbackSession.data?.session) {
                console.error('Erro ao converter codigo de autenticacao:', exchangeError);
                showAuthError(exchangeError.message || 'Login recebido, mas nao foi possivel concluir a sessao.');
                return false;
            }
        }
    }

    const { data, error } = await withTimeout(window.supabase.auth.getSession(), 8000);
    if (error) {
        showAuthError(error.message || 'Nao foi possivel recuperar a sessao de login.');
        return false;
    }

    if (data?.session?.user && !db.currentUser) {
        try {
            const expectedRole = roleFromUrl || getPendingLoginRole();
            await ensureAuthenticatedProfile({
                includeProtectedData: expectedRole === 'admin',
                sessionUser: data.session.user
            });
        } catch (profileError) {
            console.error('Erro ao vincular perfil autenticado:', profileError);
            showAuthError(profileError.message || 'Login realizado, mas nao foi possivel vincular seu perfil.');
            return false;
        }
    }

    if (new URLSearchParams(window.location.search).get('passwordRecovery') === '1' && data?.session?.user) {
        showDefaultLoginPage();
        showPasswordResetModal();
        return true;
    }

    if ((roleFromUrl || window.location.hash.includes('access_token')) && !data?.session?.user) {
        showAuthError('O retorno do login chegou sem sessao ativa. Verifique a configuracao do provedor Google no Supabase/Google Cloud.');
    }

    let routed = false;
    try {
        routed = checkAutoLogin();
    } catch (routeError) {
        console.error('Erro ao encaminhar login autenticado:', routeError);
        showAuthError(routeError.message || 'O login foi autenticado, mas o painel nÃ£o conseguiu abrir.');
        return false;
    }
    if (routed) {
        const expectedRole = roleFromUrl || getPendingLoginRole();
        if (expectedRole !== 'admin') warmProtectedDataForCurrentUser();
        renderAuthDebugPanel('');
        cleanAuthRedirectUrl();
    }
    return routed;
}

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function normalizeLoginIdentifier(value) {
    const raw = String(value || '').trim();
    return raw.includes('@') ? raw.toLowerCase() : raw.replace(/\D/g, '');
}

async function resolveAuthEmail(identifier) {
    const normalized = normalizeLoginIdentifier(identifier);
    if (!normalized) return '';
    if (normalized.includes('@')) return normalized;
    return getSupabaseService().resolveLoginEmail(normalized);
}

async function completePasswordAuth(role, sessionUser = null) {
    const expectedRole = role === 'admin' ? 'admin' : 'client';
    pendingLoginRole = expectedRole;
    localStorage.setItem('espacoPatroas_pendingLoginRole', expectedRole);

    await ensureAuthenticatedProfile({
        includeProtectedData: expectedRole === 'admin',
        sessionUser
    });

    const routed = checkAutoLogin();
    if (routed && expectedRole !== 'admin') warmProtectedDataForCurrentUser();
    return routed;
}

async function handlePasswordLogin(role = 'client', button = null) {
    const identifierInput = document.getElementById(role === 'admin' ? 'admin-auth-email' : 'input-auth-identifier');
    const passwordInput = document.getElementById(role === 'admin' ? 'admin-auth-password' : 'input-auth-password');
    const identifier = identifierInput?.value.trim() || '';
    const password = passwordInput?.value || '';

    setFieldError(identifierInput?.id, !identifier);
    setFieldError(passwordInput?.id, password.length < 6);

    if (!identifier || password.length < 6) {
        setAuthStatus(button, 'Informe e-mail/telefone e senha.');
        return;
    }

    try {
        setButtonLoading(button, true, 'Entrando...');
        setAuthStatus(button, 'Verificando acesso...');
        const email = await resolveAuthEmail(identifier);
        if (!email) throw new Error('Credenciais invalidas.');

        pendingLoginRole = role;
        localStorage.setItem('espacoPatroas_pendingLoginRole', role);
        const { data, error } = await withTimeout(window.supabase.auth.signInWithPassword({
            email,
            password
        }), 12000);
        if (error) throw error;

        await completePasswordAuth(role, data?.user);
        setAuthStatus(button, '');
    } catch (error) {
        console.error('Erro no login por senha:', error);
        setAuthStatus(button, 'Nao foi possivel entrar. Confira os dados.');
        showToast('Nao foi possivel entrar. Confira e-mail/telefone e senha.');
    } finally {
        setButtonLoading(button, false);
    }
}

async function handlePasswordSignUp(button = null) {
    const emailInput = document.getElementById('input-auth-identifier');
    const passwordInput = document.getElementById('input-auth-password');
    const email = normalizeLoginIdentifier(emailInput?.value || '');
    const password = passwordInput?.value || '';

    setFieldError('input-auth-identifier', !isValidEmail(email));
    setFieldError('input-auth-password', password.length < 6);

    if (!isValidEmail(email)) {
        setAuthStatus(button, 'Para criar conta com senha, informe um e-mail valido.');
        return;
    }
    if (password.length < 6) {
        setAuthStatus(button, 'A senha precisa ter pelo menos 6 caracteres.');
        return;
    }

    try {
        setButtonLoading(button, true, 'Criando...');
        setAuthStatus(button, 'Criando sua conta...');
        pendingLoginRole = 'client';
        localStorage.setItem('espacoPatroas_pendingLoginRole', 'client');

        const { data, error } = await withTimeout(window.supabase.auth.signUp({
            email,
            password,
            options: {
                emailRedirectTo: getRedirectUrl('client')
            }
        }), 12000);
        if (error) throw error;

        if (data?.session?.user) {
            await completePasswordAuth('client', data.user);
            setAuthStatus(button, '');
            return;
        }

        setAuthStatus(button, 'Conta criada. Verifique seu e-mail para confirmar o acesso.');
        showToast('Conta criada. Verifique seu e-mail para confirmar o acesso.');
    } catch (error) {
        console.error('Erro ao criar conta por senha:', error);
        setAuthStatus(button, error.message || 'Nao foi possivel criar a conta.');
        showToast(error.message || 'Nao foi possivel criar a conta.');
    } finally {
        setButtonLoading(button, false);
    }
}

async function handlePasswordReset(button = null, role = 'client') {
    const identifierInput = document.getElementById(role === 'admin' ? 'admin-auth-email' : 'input-auth-identifier');
    const identifier = identifierInput?.value.trim() || '';

    setFieldError(identifierInput?.id, !identifier);
    if (!identifier) {
        setAuthStatus(button, 'Informe seu e-mail ou telefone para definir a senha.');
        return;
    }

    try {
        setButtonLoading(button, true, 'Enviando...');
        setAuthStatus(button, 'Preparando recuperacao de senha...');
        const email = await resolveAuthEmail(identifier);
        if (!email) throw new Error('Informe o e-mail cadastrado para recuperar a senha.');

        const { error } = await withTimeout(window.supabase.auth.resetPasswordForEmail(email, {
            redirectTo: getPasswordRecoveryRedirectUrl(role === 'admin' ? 'admin' : 'client')
        }), 12000);
        if (error) throw error;

        setAuthStatus(button, 'Enviamos um link para definir sua senha. Verifique seu e-mail.');
        showToast('Link de senha enviado para o e-mail cadastrado.');
    } catch (error) {
        console.error('Erro ao solicitar recuperacao de senha:', error);
        setAuthStatus(button, error.message || 'Nao foi possivel enviar o link de senha.');
        showToast(error.message || 'Nao foi possivel enviar o link de senha.');
    } finally {
        setButtonLoading(button, false);
    }
}

function showPasswordResetModal() {
    const modal = document.getElementById('password-reset-modal');
    const input = document.getElementById('password-reset-new-password');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
    setInlineStatus('password-reset-status', '');
    setFieldError('password-reset-new-password', false);
    if (input) input.value = '';
    input?.focus();
}

function closePasswordResetModal() {
    const modal = document.getElementById('password-reset-modal');
    modal?.classList.add('hidden');
    modal?.classList.remove('flex');
}

async function updateRecoveredPassword(button = null) {
    const input = document.getElementById('password-reset-new-password');
    const password = input?.value || '';
    setFieldError('password-reset-new-password', password.length < 6);

    if (password.length < 6) {
        setInlineStatus('password-reset-status', 'A senha precisa ter pelo menos 6 caracteres.', 'error');
        return;
    }

    try {
        setButtonLoading(button, true, 'Salvando...');
        setInlineStatus('password-reset-status', 'Salvando nova senha...', 'info');
        const { error } = await withTimeout(window.supabase.auth.updateUser({ password }), 12000);
        if (error) throw error;

        closePasswordResetModal();
        await completePasswordAuth(getPendingLoginRole());
        cleanAuthRedirectUrl();
        showToast('Senha atualizada.');
    } catch (error) {
        console.error('Erro ao atualizar senha:', error);
        setInlineStatus('password-reset-status', error.message || 'Nao foi possivel atualizar a senha.', 'error');
    } finally {
        setButtonLoading(button, false);
    }
}

function setButtonLoading(button, isLoading, loadingText = 'Aguarde...') {
    if (!button) return;
    if (isLoading) {
        if (!button.dataset.originalText) button.dataset.originalText = button.textContent.trim();
        button.textContent = loadingText;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.classList.add('opacity-60', 'pointer-events-none', 'cursor-wait');
    } else {
        button.textContent = button.dataset.originalText || button.textContent;
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.classList.remove('opacity-60', 'pointer-events-none', 'cursor-wait');
    }
}

function setAuthStatus(button, message = '') {
    const targets = button
        ? [button.closest('form')?.querySelector('[data-auth-status]')]
        : Array.from(document.querySelectorAll('[data-auth-status]'));

    targets.filter(Boolean).forEach(status => {
        status.textContent = message;
        status.classList.toggle('hidden', !message);
    });
}

function setInlineStatus(elementId, message = '', variant = 'info') {
    const element = document.getElementById(elementId);
    if (!element) return;

    const variants = {
        info: ['bg-[#f7f3f2]', 'text-[#50453b]', 'border', 'border-[#d4c4b7]/40'],
        success: ['bg-emerald-50', 'text-emerald-700', 'border', 'border-emerald-200'],
        warning: ['bg-amber-50', 'text-amber-700', 'border', 'border-amber-200'],
        error: ['bg-red-50', 'text-red-700', 'border', 'border-red-200']
    };

    Object.values(variants).flat().forEach(className => element.classList.remove(className));

    if (!message) {
        element.textContent = '';
        element.classList.add('hidden');
        return;
    }

    element.textContent = message;
    element.classList.remove('hidden');
    (variants[variant] || variants.info).forEach(className => element.classList.add(className));
}

function setFieldError(inputId, hasError) {
    const input = document.getElementById(inputId);
    if (!input) return;

    input.classList.toggle('border-red-300', hasError);
    input.classList.toggle('focus:border-red-500', hasError);
}

function waitForNextPaint() {
    return new Promise(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
}

async function handleGoogleLogin(role = 'client', button = null) {
    try {
        pendingLoginRole = role;
        setButtonLoading(button, true, 'Acessando...');
        setAuthStatus(button, 'Carregando login de acesso. Aguarde...');
        const options = {
            queryParams: {
                prompt: 'select_account'
            }
        };
        const redirectTo = getRedirectUrl(role);
        if (redirectTo) options.redirectTo = redirectTo;

        await waitForNextPaint();
        const { data, error } = await withTimeout(window.supabase.auth.signInWithOAuth({
            provider: 'google',
            options
        }));
        if (error) throw error;
        if (!data?.url) throw new Error('Google OAuth nÃ£o retornou URL de redirecionamento.');
    } catch (error) {
        console.error('Erro no login Google:', error);
        showToast(error.message || 'NÃ£o foi possÃ­vel iniciar login com Gmail.');
        setButtonLoading(button, false);
        setAuthStatus(button, '');
    }
}

async function handleAdminEmailLogin(button = null) {
    return handlePasswordLogin('admin', button);
}

async function handleAdminPasswordLogin(button = null) {
    return handlePasswordLogin('admin', button);
}

async function supabaseUpdateUser(userId, updates) {
    const isOwnProfile = db.currentUser?.id === userId;
    const ownProfileFields = ['name', 'email', 'phone', 'profile_image_url'];
    const updateKeys = Object.keys(updates || {});

    if (!db.isAdmin && (!isOwnProfile || updateKeys.some(key => !ownProfileFields.includes(key)))) {
        throw new Error('Voce nao tem permissao para atualizar estes dados.');
    }

    const data = await getSupabaseService().updateUser(userId, updates);
    
    const index = db.users.findIndex(u => u.id === userId);
    if (index !== -1) db.users[index] = data;
    
    if (db.currentUser?.id === userId) {
        db.currentUser = data;
    }
    
    return data;
}

async function supabaseCreateAppointment(appointmentData) {
    const data = await getSupabaseService().createAppointment({
        user_id: db.currentUser.id,
        services_names: Array.isArray(appointmentData.services) ? appointmentData.services.join(', ') : appointmentData.services,
        price: appointmentData.price,
        appointment_date: appointmentData.date,
        appointment_time: appointmentData.time,
        payment_method: appointmentData.paymentMethod,
        payment_status: 'Pendente',
        payment_date: appointmentData.paymentDate || null,
        status: 'Confirmado'
    });
    return data;
}

async function supabaseCreateBookingPayment(payload) {
    return getSupabaseService().createBookingPayment(payload);
}

async function supabaseFetchBookingPaymentOptions() {
    return getSupabaseService().fetchBookingPaymentOptions();
}

async function supabaseUpdateService(serviceId, updates) {
    const data = await getSupabaseService().updateService(serviceId, updates);
    
    const index = db.services.findIndex(s => s.id === serviceId);
    if (index !== -1) db.services[index] = data;
    
    return data;
}

async function supabaseCreateService(serviceData) {
    const data = await getSupabaseService().createService({
        name: serviceData.name,
        description: serviceData.desc,
        price: serviceData.price,
        image_url: serviceData.img || '',
        is_active: true
    });
    db.services.push(data);
    return data;
}

async function supabaseDeleteService(serviceId) {
    await getSupabaseService().archiveService(serviceId);
    db.services = db.services.filter(s => s.id !== serviceId);
}

async function supabaseSaveSettings(key, value) {
    return getSupabaseService().saveSetting(key, value);
}

async function supabaseSaveScheduleConfig(config) {
    return getSupabaseService().updateScheduleConfig(config);
}

async function supabaseGetAppointments() {
    return getSupabaseService().fetchAppointments();
}

// ==========================================
// AUTO-LOGIN
// ==========================================
function checkAutoLogin() {
    if (!isDbLoaded) return false;

    const roleFromUrl = new URLSearchParams(window.location.search).get('loginRole');
    const expectedRole = roleFromUrl || getPendingLoginRole();

    if (!db.currentUser) return false;

    if (expectedRole === 'admin') {
        if (!db.isAdmin) {
            showAdminLogin();
            setAuthStatus(null, 'Este e-mail nÃ£o tem permissÃ£o administrativa.');
            showToast('Este e-mail nÃ£o tem permissÃ£o administrativa.');
            localStorage.removeItem('espacoPatroas_pendingLoginRole');
            window.supabase.auth.signOut();
            return true;
        }
        switchToAdminView();
        localStorage.removeItem('espacoPatroas_pendingLoginRole');
        showToast('Bem-vinda ao painel administrativo.');
        return true;
    }

    if (db.isAdmin) {
        showAdminLogin();
        setAuthStatus(null, 'Use a entrada administrativa para acessar este e-mail.');
        showToast('Use a entrada administrativa para acessar este e-mail.');
        localStorage.removeItem('espacoPatroas_pendingLoginRole');
        window.supabase.auth.signOut();
        return true;
    }

    updateManuProfilePhoto();

    if (!db.currentUser.name || !db.currentUser.phone || db.currentUser.name.trim() === '' || db.currentUser.phone.trim() === '') {
        document.getElementById('input-login-name').value = db.currentUser.name || '';
        document.getElementById('input-login-phone').value = db.currentUser.phone || '';
        showLoginStep2();
        return true;
    }

    updateClientProfileUi();
    renderServices();
    updateCartFab();
    showPage('page-home');
    updateBottomNav('home');
    localStorage.removeItem('espacoPatroas_pendingLoginRole');
    showToast(`Bem-vinda de volta, ${db.currentUser.name?.split(' ')[0] || ''}!`);
    return true;
}

// ==========================================
// VARIABLES
// ==========================================
let currentAgendaMonth = new Date();
let agendaView = 'month'; 
let agendaViewTouched = false;
let allAppointmentsCache = []; 
let adminNotificationInterval = null;
let adminNotificationChannel = null;
let adminNotificationBaselineReady = false;
let knownAdminAppointmentIds = new Set();
let currentAdminSection = 'clients';
let lastConfirmedBookingForWhatsApp = null;
let activePixCheckout = null;
let pixStatusInterval = null;
let pixCountdownInterval = null;
let bookingPaymentOptions = null;

const ADMIN_EMAIL = 'emanuelysarti02@gmail.com';
const ADMIN_WHATSAPP_NUMBER = '5527997559191';
const ADMIN_NOTIFICATION_POLL_MS = 20000;

function getBookingFlow() {
    if (!window.bookingFlow) {
        throw new Error('booking-flow.js not initialized.');
    }

    return window.bookingFlow;
}

function getBookingSchedule() {
    if (!window.bookingSchedule) {
        throw new Error('booking-schedule.js not initialized.');
    }

    return window.bookingSchedule;
}

function getBookingPayment() {
    if (!window.bookingPayment) {
        throw new Error('booking-payment.js not initialized.');
    }

    return window.bookingPayment;
}

function getBookingConfirmation() {
    if (!window.bookingConfirmation) {
        throw new Error('booking-confirmation.js not initialized.');
    }

    return window.bookingConfirmation;
}

function getCartItems() {
    return getBookingFlow().getCart();
}

function replaceCartItems(nextCart) {
    return getBookingFlow().setCart(nextCart);
}

function clearCartItems() {
    return getBookingFlow().clearCart();
}

function toggleCartItemState(service) {
    return getBookingFlow().toggleCartItem(service);
}

function getSelectedDateValue() {
    return getBookingFlow().getSelectedDate();
}

function setSelectedDateValue(value) {
    return getBookingFlow().setSelectedDate(value);
}

function getSelectedTimeValue() {
    return getBookingFlow().getSelectedTime();
}

function setSelectedTimeValue(value) {
    return getBookingFlow().setSelectedTime(value);
}

function getSelectedPaymentMethodValue() {
    return getBookingFlow().getSelectedPaymentMethod();
}

function setSelectedPaymentMethodValue(value) {
    return getBookingFlow().setSelectedPaymentMethod(value);
}

function resetBookingSelection() {
    return getBookingFlow().resetSelection();
}

function resetBookingFlowState() {
    selectedPaymentAmountMode = 'deposit';
    return getBookingFlow().resetAll();
}

Object.defineProperties(window, {
    cart: {
        configurable: true,
        get() {
            return getCartItems();
        },
        set(value) {
            replaceCartItems(value);
        }
    },
    selectedDate: {
        configurable: true,
        get() {
            return getSelectedDateValue();
        },
        set(value) {
            setSelectedDateValue(value);
        }
    },
    selectedTime: {
        configurable: true,
        get() {
            return getSelectedTimeValue();
        },
        set(value) {
            setSelectedTimeValue(value);
        }
    },
    selectedPaymentMethod: {
        configurable: true,
        get() {
            return getSelectedPaymentMethodValue();
        },
        set(value) {
            setSelectedPaymentMethodValue(value);
        }
    }
});

// ==========================================
// NAVIGATION E BOTTOM NAV
// ==========================================
function hideAllPages() { 
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active')); 
}

function showPage(pageId) {
    const targetId = pageId.startsWith('page-') ? pageId : 'page-' + pageId;
    hideAllPages();
    const el = document.getElementById(targetId);
    if (el) { el.classList.add('active'); window.scrollTo(0, 0); }
}

function updateBottomNav(activeTab) {
    const allNavs = document.querySelectorAll('[id^="nav-home"], [id^="nav-gallery"], [id^="nav-appointments"]');
    allNavs.forEach(el => {
        el.classList.remove('bg-gradient-to-br', 'from-[#7f5353]', 'to-[#d59f9f]', 'text-white');
        el.classList.add('text-[#7f5353]/60');
        const icon = el.querySelector('.material-symbols-outlined');
        if(icon) icon.style.fontVariationSettings = "'FILL' 0";
    });

    const activeNavs = document.querySelectorAll(`[id^="nav-${activeTab}"]`);
    activeNavs.forEach(el => {
        el.classList.remove('text-[#7f5353]/60');
        el.classList.add('bg-gradient-to-br', 'from-[#7f5353]', 'to-[#d59f9f]', 'text-white');
        const icon = el.querySelector('.material-symbols-outlined');
        if(icon) icon.style.fontVariationSettings = "'FILL' 1";
    });
}

function getClientAvatarUrl() {
    return normalizeImageUrl(db.currentUser?.profile_image_url || '') || PROFILE_IMAGE_FALLBACK;
}

function updateClientProfileUi() {
    const user = db.currentUser || {};
    const displayName = sanitizeString(user.name || '');
    const firstName = displayName ? displayName.split(' ')[0] : '';
    const userNameEl = document.getElementById('user-name-display');
    if (userNameEl) userNameEl.textContent = firstName || '!';

    const headerAvatar = document.getElementById('home-profile-pic');
    if (headerAvatar) {
        headerAvatar.src = getClientAvatarUrl();
        headerAvatar.alt = firstName ? `Foto de ${firstName}` : 'Foto do perfil';
    }
}

function switchToAdminView() {
    hideAllPages();
    setAuthStatus(null, '');
    renderAuthDebugPanel('');
    document.getElementById('client-view').classList.add('hidden');
    document.getElementById('admin-view').classList.remove('hidden');
    updateManuProfilePhoto();
    startAdminAppointmentNotifications();
    try {
        showAdminSection('clients');
    } catch (error) {
        console.error('Erro ao abrir painel administrativo:', error);
        showToast('O login foi concluÃ­do, mas houve erro ao abrir o painel.');
    }
}

function toggleAdminMenu() {
    const menu = document.getElementById('admin-mobile-menu');
    if (menu) {
        menu.classList.toggle('hidden');
        document.body.style.overflow = menu.classList.contains('hidden') ? '' : 'hidden';
    }
}

async function switchToClientView() {
    document.getElementById('admin-view').classList.add('hidden');
    document.getElementById('client-view').classList.remove('hidden');
    stopAdminAppointmentNotifications();
    clearCartItems();
    await clearSession();
    showLoginStep1();
    showPage('page-login');
}

function goToHome() {
    if (!db.currentUser) {
        showPage('page-login');
        return;
    }
    resetBookingFlowState();
    hideAllPages();
    document.getElementById('page-home').classList.add('active');
    updateClientProfileUi();
    renderServices();
    updateCartFab();
    updateBottomNav('home');
    window.scrollTo(0, 0);
}

function requestAdminBrowserNotificationPermission() {
    if (!db.isAdmin || typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
    }
}

function rememberKnownAdminAppointments(appointments = []) {
    knownAdminAppointmentIds = new Set(
        (appointments || [])
            .map(appointment => appointment?.id)
            .filter(Boolean)
    );
    adminNotificationBaselineReady = true;
}

function buildAdminAppointmentNotificationMessage(appointment) {
    const serviceNames = formatServiceNames(appointment.services_names);
    const dateLabel = formatDate(appointment.appointment_date);
    const timeLabel = formatAppointmentTime(appointment.appointment_time);
    return `Novo agendamento: ${serviceNames} em ${dateLabel} \u00e0s ${timeLabel}.`;
}

function buildAdminWhatsAppBookingMessage(booking) {
    const user = booking?.user || db.currentUser || {};
    const services = Array.isArray(booking?.services)
        ? booking.services.join(', ')
        : formatServiceNames(booking?.services || booking?.services_names || '');
    const price = booking?.price !== undefined ? formatCurrency(booking.price) : '-';
    const date = booking?.date ? formatDate(booking.date) : formatDate(booking?.appointment_date);
    const time = booking?.time || formatAppointmentTime(booking?.appointment_time || '');
    const payment = formatPaymentMethod(booking?.paymentMethod || booking?.payment_method || '');

    return [
        'Novo agendamento:',
        '',
        `Cliente: ${user.name || 'Cliente sem nome'}`,
        `WhatsApp: ${user.phone || 'Nao informado'}`,
        `Serviços: ${services || '-'}`,
        `Valor: ${price}`,
        `Data: ${date || '-'}`,
        `Horário: ${time || '-'}`,
        `Forma de pagamento: ${payment || '-'}`
    ].join('\n');
}

function getAdminWhatsAppUrl(booking) {
    return `https://wa.me/${ADMIN_WHATSAPP_NUMBER}?text=${encodeURIComponent(buildAdminWhatsAppBookingMessage(booking))}`;
}

function sendBookingToAdminWhatsApp(booking, options = {}) {
    if (!booking) return false;
    const popup = window.open(getAdminWhatsAppUrl(booking), '_blank', 'noopener,noreferrer');
    const opened = Boolean(popup);
    if (!opened && !options.silent) {
        showToast('Toque em "Notificar Admin no WhatsApp" para enviar a mensagem.');
    }
    return opened;
}

function sendLastBookingToAdminWhatsApp() {
    if (!lastConfirmedBookingForWhatsApp) {
        showToast('Nenhum agendamento recente para notificar.');
        return;
    }
    sendBookingToAdminWhatsApp(lastConfirmedBookingForWhatsApp);
}

function notifyAdminInApp(appointment) {
    const message = buildAdminAppointmentNotificationMessage(appointment);
    showToast(message);

    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
            new Notification('Espa\u00e7o das Patroas', {
                body: message,
                icon: 'icon-192x192.png'
            });
        } catch (error) {
            console.warn('Nao foi possivel exibir notificacao do navegador:', error);
        }
    }
}

function handleAdminAppointmentNotification(appointment) {
    if (!appointment?.id || appointment.status === 'Cancelado' || knownAdminAppointmentIds.has(appointment.id)) {
        return;
    }

    knownAdminAppointmentIds.add(appointment.id);
    db.appointmentsCache = [
        appointment,
        ...db.appointmentsCache.filter(existing => existing.id !== appointment.id)
    ];
    notifyAdminInApp(appointment);
    refreshAdminAfterAppointmentNotification();
}

function refreshAdminAfterAppointmentNotification() {
    if (!db.isAdmin) return;
    renderAdminDashboard();

    if (currentAdminSection === 'clients') {
        renderAdminClients();
        return;
    }

    if (currentAdminSection === 'schedule') {
        renderAdminSchedule();
        renderAdminAppointments();
        renderNextAppointmentCard();
    }
}

async function pollAdminAppointmentNotifications() {
    if (!db.isAdmin) return;

    try {
        const appointments = await supabaseGetAppointments();
        db.appointmentsCache = appointments;

        if (!adminNotificationBaselineReady) {
            rememberKnownAdminAppointments(appointments);
            return;
        }

        const newAppointments = appointments.filter(app => !knownAdminAppointmentIds.has(app.id) && app.status !== 'Cancelado');
        appointments.forEach(app => knownAdminAppointmentIds.add(app.id));

        if (newAppointments.length === 0) return;

        const latestAppointment = newAppointments
            .slice()
            .sort((a, b) => `${b.appointment_date}T${b.appointment_time}`.localeCompare(`${a.appointment_date}T${a.appointment_time}`))[0];

        notifyAdminInApp(latestAppointment);
        refreshAdminAfterAppointmentNotification();
    } catch (error) {
        console.error('Erro ao verificar novos agendamentos para o admin:', error);
    }
}

function subscribeToAdminAppointmentNotifications() {
    if (!db.isAdmin || !window.supabase?.channel) return;

    adminNotificationChannel = window.supabase
        .channel('admin-appointments')
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'appointments'
        }, payload => {
            handleAdminAppointmentNotification(payload?.new);
        })
        .subscribe(status => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                console.warn('Realtime de agendamentos do admin indisponivel. Mantendo fallback por polling.');
            }
        });
}

function startAdminAppointmentNotifications() {
    if (!db.isAdmin) return;
    stopAdminAppointmentNotifications();
    requestAdminBrowserNotificationPermission();
    rememberKnownAdminAppointments(db.appointmentsCache);
    subscribeToAdminAppointmentNotifications();
    pollAdminAppointmentNotifications();
    adminNotificationInterval = window.setInterval(() => {
        pollAdminAppointmentNotifications();
    }, ADMIN_NOTIFICATION_POLL_MS);
}

function stopAdminAppointmentNotifications() {
    if (adminNotificationInterval) {
        clearInterval(adminNotificationInterval);
        adminNotificationInterval = null;
    }
    if (adminNotificationChannel) {
        if (window.supabase?.removeChannel) {
            window.supabase.removeChannel(adminNotificationChannel).catch(() => {});
        } else {
            adminNotificationChannel.unsubscribe?.();
        }
        adminNotificationChannel = null;
    }
    adminNotificationBaselineReady = false;
    knownAdminAppointmentIds = new Set();
}

async function goToMyAppointments() {
    if (!db.currentUser) {
        showPage('page-login');
        return;
    }
    await loadProtectedDataForCurrentUser();
    renderMyAppointments();
    showPage('page-my-appointments');
    updateBottomNav('appointments');
}

function goToGallery() {
    if (!db.currentUser) {
        showPage('page-login');
        return;
    }
    renderClientGallery();
    showPage('page-gallery');
    updateBottomNav('gallery');
}

function goBackFromPayment() {
    showPage('page-booking');
}

// ==========================================
// LOGIN FLOW
// ==========================================
async function handleLoginStep1() {
    await handleGoogleLogin('client', document.querySelector('#login-form-step1 button[type=submit]'));
}

function showLoginStep1(email) {
    document.getElementById('login-form-step1')?.classList.remove('hidden');
    document.getElementById('login-form-step2')?.classList.add('hidden');
    setAuthStatus(null, '');
    setInlineStatus('login-inline-status', '');
    setFieldError('input-auth-identifier', false);
    setFieldError('input-auth-password', false);
    setFieldError('input-login-name', false);
    setFieldError('input-login-phone', false);
}

function showLoginStep2() {
    document.getElementById('login-form-step1').classList.add('hidden');
    document.getElementById('login-form-step2').classList.remove('hidden');
    document.getElementById('input-login-name').value = '';
    document.getElementById('input-login-phone').value = '';
    setInlineStatus('login-inline-status', 'Complete seus dados para liberar o primeiro agendamento.', 'info');
    setFieldError('input-login-name', false);
    setFieldError('input-login-phone', false);
    document.getElementById('input-login-name').focus();
}

async function handleLogin() {
    const nameInput = document.getElementById('input-login-name');
    const phoneInput = document.getElementById('input-login-phone');

    const name = sanitizeString(nameInput.value.trim());
    const phone = phoneInput.value.replace(/\D/g, '');

    setFieldError('input-login-name', !name);
    setFieldError('input-login-phone', !phone);

    if (!name || !phone) {
        setInlineStatus('login-inline-status', 'Preencha nome e telefone para concluir o cadastro.', 'error');
        return;
    }
    if (phone.length < 10) {
        setFieldError('input-login-phone', true);
        setInlineStatus('login-inline-status', 'Digite um telefone vÃ¡lido com DDD.', 'error');
        return;
    }

    try {
        setInlineStatus('login-inline-status', 'Salvando seu cadastro...', 'info');
        if (!db.currentUser) await syncAuthProfile();
        if (!db.currentUser) {
            setInlineStatus('login-inline-status', 'FaÃ§a login novamente para concluir o cadastro.', 'error');
            return;
        }
        const user = await supabaseUpdateUser(db.currentUser.id, { name, phone });
        db.currentUser = user;

        saveSession();
        updateManuProfilePhoto();
        updateClientProfileUi();
        renderServices();
        updateCartFab();
        showPage('page-home');
        updateBottomNav('home');
        setInlineStatus('login-inline-status', '');
        showToast(`Bem-vinda, ${name.split(' ')[0]}!`);
    } catch (error) {
        console.error('Erro ao salvar:', error);
        setInlineStatus('login-inline-status', 'NÃ£o foi possÃ­vel salvar seus dados agora.', 'error');
        showToast('Erro ao salvar dados.');
    }
}

function openClientProfileModal() {
    if (!db.currentUser) {
        showPage('page-login');
        return;
    }

    selectedClientProfileImageFile = null;
    const modal = document.getElementById('client-profile-modal');
    const nameInput = document.getElementById('client-profile-name');
    const emailInput = document.getElementById('client-profile-email');
    const phoneInput = document.getElementById('client-profile-phone');
    const preview = document.getElementById('client-profile-preview');
    const fileInput = document.getElementById('client-profile-avatar-input');

    if (nameInput) nameInput.value = db.currentUser.name || '';
    if (emailInput) emailInput.value = db.currentUser.email || '';
    if (phoneInput) phoneInput.value = db.currentUser.phone || '';
    if (preview) preview.src = getClientAvatarUrl();
    if (fileInput) fileInput.value = '';
    setInlineStatus('client-profile-status', '');
    setFieldError('client-profile-name', false);
    setFieldError('client-profile-email', false);
    setFieldError('client-profile-phone', false);

    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
    nameInput?.focus();
}

function closeClientProfileModal() {
    const modal = document.getElementById('client-profile-modal');
    modal?.classList.add('hidden');
    modal?.classList.remove('flex');
    selectedClientProfileImageFile = null;
}

function previewClientProfileAvatar(input) {
    const file = input.files?.[0];
    if (!file) return;

    try {
        validateImageFile(file);
        selectedClientProfileImageFile = file;
        const preview = document.getElementById('client-profile-preview');
        if (preview) preview.src = URL.createObjectURL(file);
        setInlineStatus('client-profile-status', 'Foto selecionada. Clique em Salvar para atualizar.', 'info');
    } catch (error) {
        input.value = '';
        selectedClientProfileImageFile = null;
        setInlineStatus('client-profile-status', error.message || 'Nao foi possivel carregar a foto.', 'error');
        showToast(error.message || 'Nao foi possivel carregar a foto.');
    }
}

async function saveClientProfile(button = null) {
    if (!db.currentUser) {
        showPage('page-login');
        return;
    }

    const nameInput = document.getElementById('client-profile-name');
    const emailInput = document.getElementById('client-profile-email');
    const phoneInput = document.getElementById('client-profile-phone');
    const name = sanitizeString(nameInput?.value.trim() || '');
    const email = (emailInput?.value || '').trim().toLowerCase();
    const phone = (phoneInput?.value || '').replace(/\D/g, '');

    setFieldError('client-profile-name', !name);
    setFieldError('client-profile-email', !isValidEmail(email));
    setFieldError('client-profile-phone', !phone || phone.length < 10);

    if (!name || !isValidEmail(email) || !phone) {
        setInlineStatus('client-profile-status', 'Preencha nome, e-mail e WhatsApp para salvar.', 'error');
        return;
    }

    if (phone.length < 10) {
        setInlineStatus('client-profile-status', 'Digite um WhatsApp valido com DDD.', 'error');
        return;
    }

    try {
        setButtonLoading(button, true, 'Salvando...');
        setInlineStatus('client-profile-status', 'Salvando perfil...', 'info');
        let profileImageUrl = db.currentUser.profile_image_url || '';

        if (selectedClientProfileImageFile) {
            setInlineStatus('client-profile-status', 'Enviando foto...', 'info');
            profileImageUrl = await uploadImageFile(selectedClientProfileImageFile, 'avatars', db.currentUser.id);
        }

        let profileEmail = String(db.currentUser.email || '').toLowerCase();
        let emailChangePending = false;
        if (email !== profileEmail) {
            setInlineStatus('client-profile-status', 'Atualizando e-mail...', 'info');
            const { data: authEmailData, error: authEmailError } = await window.supabase.auth.updateUser({ email });
            if (authEmailError) throw authEmailError;

            const confirmedAuthEmail = String(authEmailData?.user?.email || '').toLowerCase();
            if (confirmedAuthEmail === email) {
                profileEmail = email;
            } else {
                emailChangePending = true;
            }
        }

        const user = await supabaseUpdateUser(db.currentUser.id, {
            name,
            email: profileEmail,
            phone,
            profile_image_url: profileImageUrl
        });

        db.currentUser = user;
        saveSession();
        updateClientProfileUi();
        closeClientProfileModal();
        showToast(emailChangePending ? 'Perfil atualizado. Confirme o novo e-mail para concluir a troca.' : 'Perfil atualizado!');
    } catch (error) {
        console.error('Erro ao atualizar perfil:', error);
        setInlineStatus('client-profile-status', error.message || 'Nao foi possivel salvar o perfil agora.', 'error');
        showToast(error.message || 'Erro ao salvar perfil.');
    } finally {
        setButtonLoading(button, false);
    }
}

window.openClientProfileModal = openClientProfileModal;
window.closeClientProfileModal = closeClientProfileModal;
window.previewClientProfileAvatar = previewClientProfileAvatar;
window.saveClientProfile = saveClientProfile;
window.handlePasswordLogin = handlePasswordLogin;
window.handlePasswordSignUp = handlePasswordSignUp;
window.handlePasswordReset = handlePasswordReset;
window.handleAdminPasswordLogin = handleAdminPasswordLogin;
window.updateRecoveredPassword = updateRecoveredPassword;

async function goToLogin() {
    await clearSession();
    updateManuProfilePhoto();
    showLoginStep1();
    renderAuthDebugPanel('');
    showPage('page-login');
}

function showAdminLogin() {
    hideAllPages();
    document.getElementById('page-admin-login')?.classList.add('active');
}

function showDefaultLoginPage() {
    const loginPageId = isAdminEntryPage() ? 'page-admin-login' : 'page-login';
    showPage(loginPageId);
}

function updateManuProfilePhoto() {
    const src = normalizeImageUrl(db.settings.profileImg || '') || PROFILE_IMAGE_FALLBACK;
    const pics = ['main-profile-pic', 'admin-avatar', 'admin-settings-photo', 'login-profile-pic', 'admin-login-profile-pic', 'admin-mobile-menu-avatar'];
    pics.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.onerror = () => {
            if (el.src.endsWith(PROFILE_IMAGE_FALLBACK)) return;
            el.src = PROFILE_IMAGE_FALLBACK;
        };
        el.src = src;
    });
    updateClientProfileUi();
}

// ==========================================
// SERVICES
// ==========================================
function renderServices() {
    const container = document.getElementById('services-container');
    if (!container) return;
    container.innerHTML = '';

    if (!isPublicDataLoaded) {
        container.innerHTML = '<p class="text-center text-stone-400 col-span-3 py-8">Carregando servicos...</p>';
        return;
    }

    if (!db.services || db.services.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-400 col-span-3">Nenhum servi\u00e7o dispon\u00edvel.</p>';
        return;
    }

    db.services.forEach(s => {
        const isInCart = getCartItems().some(item => item.id === s.id);
        const imgSrc = normalizeImageUrl(s.image_url || s.img || '');
        const displayImg = imgSrc || SERVICE_CARD_PLACEHOLDER;
        
        const card = document.createElement('div');
        card.className = 'group bg-white rounded-xl overflow-hidden shadow-sm transition-all active:scale-[0.98] border border-gray-100';
        card.innerHTML = `
            <div class="aspect-[16/10] overflow-hidden bg-gray-50">
                <img src="${displayImg}" alt="${sanitizeString(s.name || 'Servico')}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" onerror="this.src='${SERVICE_CARD_PLACEHOLDER}'">
            </div>
            <div class="p-6">
                <div class="flex justify-between items-start mb-4">
                    <div><h4 class="font-bold text-lg text-[#1c1b1b]">${sanitizeString(s.name || 'Servi\u00e7o')}</h4><p class="text-[#50453b] text-sm mt-1">${sanitizeString(s.description || s.desc || 'Servi\u00e7o premium')}</p></div>
                    <span class="font-extrabold text-[#7f5353]">${formatCurrency(s.price)}</span>
                </div>
                <button onclick="toggleCart('${s.id}')" class="w-full py-3 ${isInCart ? 'bg-green-500' : 'bg-gradient-to-br from-[#7f5353] to-[#d59f9f]'} text-white font-bold text-xs uppercase tracking-widest rounded-xl active:scale-95 transition-transform">
                    ${isInCart ? "[ok] Adicionado" : "Agendar"}
                </button>
            </div>`;
        container.appendChild(card);
    });
    updateCartFab();
}

function toggleCart(id) {
    if (!db.currentUser) {
        showToast("Fa\u00e7a login para agendar.");
        showPage('page-login');
        return;
    }
    
    const service = db.services.find(s => s.id == id);
    if (!service) return;
    
    toggleCartItemState(service);
    renderServices();
}

function updateCartFab() {
    getBookingFlow().updateCartFab({ onClick: proceedToBooking });
}

function updateBookingProgress(step) {
    getBookingFlow().updateBookingProgress(step);
}


// ==========================================
// BOOKING
// ==========================================
function proceedToBooking() {
    if (cart.length === 0) return showToast("Adicione serviÃ§os.");

    if (!isDbLoaded) {
        showToast("Carregando...");
        const checkDb = setInterval(() => {
            if (isDbLoaded) {
                clearInterval(checkDb);
                proceedToBooking();
            }
        }, 100);
        return;
    }

    if (!db.currentUser) {
        const savedUserId = localStorage.getItem('espacoPatroas_currentUser');
        if (savedUserId && db.users.length > 0) {
            const user = db.users.find(u => u.id === savedUserId);
            if (user) {
                db.currentUser = user;
                db.isAdmin = isAdminProfile(user);
                proceedToBookingActual();
                return;
            }
        } else if (savedUserId) {
            const checkUser = setInterval(() => {
                if (db.users.length > 0) {
                    clearInterval(checkUser);
                    const user = db.users.find(u => u.id === savedUserId);
                    if (user) {
                        db.currentUser = user;
                        db.isAdmin = isAdminProfile(user);
                        proceedToBookingActual();
                    } else {
                        showPage('page-login');
                    }
                }
            }, 100);
            return;
        }
        showPage('page-login');
        return;
    }

    proceedToBookingActual();
}

function proceedToBookingActual() {
    const alertContainer = document.getElementById('alert-blocked-container');
    const mainContent = document.querySelector('#page-booking main');
    const bottomBtn = document.getElementById('btn-continue-booking');
    selectedDate = null;
    selectedTime = null;
    setInlineStatus('booking-inline-status', '');
    updateBookingProgress('schedule');
    updateBookingSummary();

    if (String(db.currentUser.status || '').toLowerCase() === 'pendente') {
        if (alertContainer) { alertContainer.classList.remove('hidden'); alertContainer.classList.add('flex'); }
        if (mainContent) mainContent.classList.add('opacity-30', 'pointer-events-none');
        if (bottomBtn) bottomBtn.classList.add('hidden');
        showPage('page-booking');
    } else {
        if (alertContainer) { alertContainer.classList.add('hidden'); alertContainer.classList.remove('flex'); }
        if (mainContent) mainContent.classList.remove('opacity-30', 'pointer-events-none');
        if (bottomBtn) bottomBtn.classList.remove('hidden');

        getBookingFlow().renderSelectedServices({
            formatCurrency,
            normalizeImageUrl,
            placeholderUrl: 'https://via.placeholder.com/100?text=Servico'
        });
        initCalendar();
        showPage('page-booking');
    }
}

function initCalendar() {
    return getBookingSchedule().initCalendar({
        scheduleConfig: db.scheduleConfig,
        selectedDate,
        onSelectDate: (dateStr, pill) => selectDate(dateStr, pill),
        onPopulateTimes: () => populateTimes(),
        toDateInputValue
    });
}

function prevMonth() {
    return getBookingSchedule().prevMonth({
        onInitCalendar: () => initCalendar()
    });
}

function nextMonth() {
    return getBookingSchedule().nextMonth({
        onInitCalendar: () => initCalendar()
    });
}

function selectDate(dateStr, element) {
    return getBookingSchedule().selectDate({
        dateStr,
        element,
        onSelectedDateChange: value => { selectedDate = value; },
        onSelectedTimeChange: value => { selectedTime = value; },
        onClearInlineStatus: () => setInlineStatus('booking-inline-status', ''),
        onUpdateSummary: () => updateBookingSummary(),
        onPopulateTimes: () => populateTimes()
    });
}

async function getBookedSlots(dateStr) {
    return getBookingSchedule().getBookedSlots({
        dateStr,
        supabase: window.supabase
    });
}

function parseTimeToMinutes(timeStr) {
    return getBookingSchedule().parseTimeToMinutes(timeStr);
}

function formatMinutesToTime(totalMinutes) {
    return getBookingSchedule().formatMinutesToTime(totalMinutes);
}

function getScheduleSlotDurationMinutes() {
    return getBookingSchedule().getScheduleSlotDurationMinutes(db.scheduleConfig);
}

async function populateTimes() {
    return getBookingSchedule().populateTimes({
        selectedDate,
        scheduleConfig: db.scheduleConfig,
        supabase: window.supabase,
        onTimeSelect: (time, btn) => selectTime(time, btn),
        onWarnInlineStatus: message => setInlineStatus('booking-inline-status', message, 'warning')
    });
}

function selectTime(time, element) {
    return getBookingSchedule().selectTime({
        time,
        element,
        onSelectedTimeChange: value => { selectedTime = value; },
        onClearInlineStatus: () => setInlineStatus('booking-inline-status', ''),
        onUpdateSummary: () => updateBookingSummary()
    });
}

// ==========================================
// PAYMENT
// ==========================================
async function confirmBooking(cardPaymentData = null) {
    const confirmButton = selectedPaymentMethod === 'card'
        ? document.getElementById('confirm-card-booking-button')
        : document.getElementById('confirm-booking-button');
    if (!db.currentUser) {
        showPage('page-login');
        return;
    }

    const result = await getBookingConfirmation().confirmBookingFlow({
        currentUser: db.currentUser,
        selectedPaymentMethod,
        paymentAmountMode: selectedPaymentAmountMode,
        selectedDate,
        selectedTime,
        cardPaymentData,
        cartItems: getCartItems(),
        confirmButton,
        setInlineStatus,
        setButtonLoading,
        getBookedSlots,
        populateTimes,
        createBookingPayment: supabaseCreateBookingPayment,
        updateUser: supabaseUpdateUser,
        resetBookingFlowState,
        renderSuccess,
        updateBookingProgress,
        showPage,
        showToast
    });

    if (result?.reason === 'slot-already-booked') {
        selectedTime = result.selectedTime;
    }

    if (result?.ok && result.pendingPayment) {
        startPixCheckout(result);
        return;
    }

    if (result?.ok && result.user) {
        db.currentUser = result.user;
    }

    if (result?.ok && result.appointment) {
        lastConfirmedBookingForWhatsApp = {
            user: result.user || db.currentUser,
            services: result.appointment.services_names,
            price: result.appointment.price,
            date: result.appointment.appointment_date,
            time: result.appointment.appointment_time,
            paymentMethod: result.appointment.payment_method
        };
        setTimeout(() => {
            const opened = sendBookingToAdminWhatsApp(lastConfirmedBookingForWhatsApp, { silent: true });
            if (!opened) {
                showToast('Agendamento confirmado. Envie a notificacao pelo botao do WhatsApp.');
            }
        }, 350);
    }
}

function getServicePrice(service) {
    const price = Number(service?.price);
    return Number.isFinite(price) ? price : 0;
}

function getCartTotal() {
    return getBookingFlow().getCartTotal(getServicePrice);
}

function getCartServiceNames() {
    return getBookingFlow().getCartServiceNames();
}

function updateBookingSummary() {
    getBookingFlow().updateBookingSummary({
        servicesLabel: getCartServiceNames() || 'Selecione os servi\u00e7os',
        dateLabel: getSelectedDateValue() ? formatDate(getSelectedDateValue()) : 'Escolha uma data',
        timeLabel: getSelectedTimeValue() || 'Escolha um hor\u00e1rio',
        totalLabel: formatCurrency(getCartTotal())
    });
}

function updatePaymentSummaryNote() {
    getBookingFlow().updatePaymentSummaryNote({
        ...(bookingPaymentOptions || {}),
        paymentAmountMode: selectedPaymentAmountMode
    });
}

function updatePaymentOptionsForCurrentUser() {
    getBookingFlow().updatePaymentOptions(bookingPaymentOptions || {});
}

function getDepositAmount() {
    const percentage = Number(bookingPaymentOptions?.depositPercentage || 50);
    return Math.round(((getCartTotal() * percentage / 100) + Number.EPSILON) * 100) / 100;
}

function getOnlinePaymentAmount() {
    return selectedPaymentAmountMode === 'full' ? getCartTotal() : getDepositAmount();
}

function updatePaymentAmountModeUi() {
    const requiresDeposit = bookingPaymentOptions?.requiresDeposit !== false;
    const section = document.getElementById('payment-amount-section');
    const depositInput = document.getElementById('payment-amount-deposit');
    const fullInput = document.getElementById('payment-amount-full');
    const depositLabel = document.getElementById('payment-deposit-label');
    const fullLabel = document.getElementById('payment-full-label');
    const pixInfo = document.getElementById('payment-pix-info-text');
    const cardSubtitle = document.getElementById('payment-card-subtitle');
    const cardButton = document.getElementById('confirm-card-booking-button');

    selectedPaymentAmountMode = selectedPaymentAmountMode === 'full' ? 'full' : 'deposit';
    if (!requiresDeposit) selectedPaymentAmountMode = 'deposit';

    section?.classList.toggle('hidden', !requiresDeposit);
    if (depositInput) depositInput.checked = selectedPaymentAmountMode === 'deposit';
    if (fullInput) fullInput.checked = selectedPaymentAmountMode === 'full';

    const depositPercentage = Number(bookingPaymentOptions?.depositPercentage || 50);
    const depositAmount = getDepositAmount();
    const fullAmount = getCartTotal();
    if (depositLabel) depositLabel.textContent = `${depositPercentage}% - ${formatCurrency(depositAmount)}`;
    if (fullLabel) fullLabel.textContent = `100% - ${formatCurrency(fullAmount)}`;

    const amountLabel = selectedPaymentAmountMode === 'full'
        ? `o valor integral de ${formatCurrency(fullAmount)}`
        : `o sinal de ${formatCurrency(depositAmount)}`;
    if (pixInfo) pixInfo.textContent = `Sera gerado um PIX para pagar ${amountLabel} e reservar o horario por 15 minutos.`;
    if (cardSubtitle) cardSubtitle.textContent = selectedPaymentAmountMode === 'full'
        ? 'Pague integral com seguranca'
        : 'Pague o sinal com seguranca';
    if (cardButton) cardButton.textContent = selectedPaymentAmountMode === 'full'
        ? 'Pagar integral e confirmar'
        : 'Pagar sinal e confirmar';

    updatePaymentSummaryNote();
}

async function selectPaymentAmountMode(mode) {
    selectedPaymentAmountMode = mode === 'full' ? 'full' : 'deposit';
    updatePaymentAmountModeUi();

    if (selectedPaymentMethod === 'card') {
        await getBookingPayment().initializeCardForm({
            publicKey: bookingPaymentOptions?.mercadoPagoPublicKey,
            amount: getOnlinePaymentAmount(),
            email: db.currentUser?.email || '',
            maxInstallments: bookingPaymentOptions?.maxInstallments || 1,
            onSubmit: cardData => confirmBooking(cardData)
        });
    }
}

async function goToPayment() {
    if (!selectedDate || !selectedTime) {
        setInlineStatus('booking-inline-status', 'Selecione uma data e um hor\u00e1rio para continuar.', 'error');
        return;
    }
    if (!db.currentUser) return showPage('page-login');

    const totalPrice = getCartTotal();
    const today = new Date();
    const max = new Date();
    max.setDate(today.getDate() + 20);

    setInlineStatus('payment-inline-status', '');
    setInlineStatus('booking-inline-status', 'Carregando formas de pagamento...', 'info');
    try {
        bookingPaymentOptions = await supabaseFetchBookingPaymentOptions();
        setInlineStatus('booking-inline-status', '');
    } catch (error) {
        console.error('Erro ao carregar opcoes de pagamento:', error);
        setInlineStatus('booking-inline-status', 'Nao foi possivel carregar as formas de pagamento. Tente novamente.', 'error');
        return;
    }

    getBookingFlow().preparePaymentPage({
        serviceNames: getCartServiceNames(),
        dateLabel: `${formatDate(selectedDate)} \u00e0s ${selectedTime}`,
        totalLabel: formatCurrency(totalPrice),
        minDate: toDateInputValue(today),
        maxDate: toDateInputValue(max)
    });

    selectedPaymentAmountMode = 'deposit';
    updatePaymentAmountModeUi();
    updatePaymentOptionsForCurrentUser();
    updateBookingProgress('payment');
    updatePaymentSummaryNote();
    showPage('page-payment');
}

async function selectPaymentMethod(method) {
    if (method === 'cash' && !bookingPaymentOptions?.canPayAtAppointment) {
        setInlineStatus('payment-inline-status', 'Pagamento no atendimento fica disponivel apos 1 servico concluido.', 'warning');
        return;
    }
    if (method === 'card' && !bookingPaymentOptions?.mercadoPagoPublicKey) {
        setInlineStatus('payment-inline-status', 'Pagamento por cartao ainda nao esta disponivel.', 'warning');
        return;
    }

    selectedPaymentMethod = method;
    setInlineStatus('payment-inline-status', '');
    getBookingFlow().applyPaymentMethodUi(method);
    updatePaymentSummaryNote();

    if (method === 'card') {
        await getBookingPayment().initializeCardForm({
            publicKey: bookingPaymentOptions?.mercadoPagoPublicKey,
            amount: getOnlinePaymentAmount(),
            email: db.currentUser?.email || '',
            maxInstallments: bookingPaymentOptions?.maxInstallments || 1,
            onSubmit: cardData => confirmBooking(cardData)
        });
    }
}

async function copyPixKey() {
    return getBookingPayment().copyPixKey({
        pixKey: '27997559191',
        showToast
    });
}

function stopPixTracking() {
    if (pixStatusInterval) window.clearInterval(pixStatusInterval);
    if (pixCountdownInterval) window.clearInterval(pixCountdownInterval);
    pixStatusInterval = null;
    pixCountdownInterval = null;
}

function updatePixCountdown() {
    const countdown = document.getElementById('pix-payment-countdown');
    const expiresAt = activePixCheckout?.payment?.expires_at;
    if (!countdown || !expiresAt) return;

    const remaining = Math.max(0, new Date(expiresAt).getTime() - Date.now());
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    countdown.textContent = remaining > 0
        ? `Expira em ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        : 'PIX expirado';

    if (remaining === 0) {
        getBookingPayment().updatePixStatus('PIX expirado. Escolha outra forma de pagamento.', 'error');
        document.getElementById('pix-payment-retry')?.classList.remove('hidden');
        stopPixTracking();
    }
}

async function checkPixPaymentStatus() {
    if (!activePixCheckout?.appointment?.id) return;

    try {
        const payment = await getSupabaseService().fetchPaymentByAppointment(activePixCheckout.appointment.id);
        activePixCheckout.payment = payment;

        if (payment.status === 'approved') {
            stopPixTracking();
            sessionStorage.removeItem('espacoPatroas_activePix');
            getBookingPayment().updatePixStatus('Pagamento aprovado!', 'approved');

            const appointment = activePixCheckout.appointment;
            renderSuccess({
                services: formatServiceNames(appointment.services_names).split(', '),
                price: appointment.price,
                date: appointment.appointment_date,
                time: appointment.appointment_time,
                paymentMethod: 'pix'
            });
            updateBookingProgress('success');
            resetBookingFlowState();
            showPage('page-success');
            showToast('Pagamento aprovado e horario confirmado!');
            warmProtectedDataForCurrentUser();
            return;
        }

        if (['rejected', 'cancelled', 'expired', 'refunded', 'charged_back', 'error'].includes(payment.status)) {
            stopPixTracking();
            sessionStorage.removeItem('espacoPatroas_activePix');
            getBookingPayment().updatePixStatus('O PIX nao foi aprovado. Escolha outra forma de pagamento.', 'error');
            document.getElementById('pix-payment-retry')?.classList.remove('hidden');
        }
    } catch (error) {
        console.warn('Nao foi possivel atualizar o status do PIX:', error);
    }
}

function startPixCheckout(result) {
    activePixCheckout = {
        appointment: result.appointment,
        payment: result.payment,
        services: result.services || []
    };
    sessionStorage.setItem('espacoPatroas_activePix', JSON.stringify(activePixCheckout));
    getBookingPayment().renderPixCheckout({ payment: result.payment, appointment: result.appointment, formatCurrency });
    stopPixTracking();
    updatePixCountdown();
    pixCountdownInterval = window.setInterval(updatePixCountdown, 1000);
    pixStatusInterval = window.setInterval(checkPixPaymentStatus, 3000);
    checkPixPaymentStatus();
}

async function copyGeneratedPixCode() {
    const code = document.getElementById('pix-copy-code')?.value || '';
    if (!code) return showToast('Codigo PIX indisponivel.');
    const copied = await getBookingPayment().copyTextToClipboard(code);
    showToast(copied ? 'Codigo PIX copiado!' : 'Nao foi possivel copiar o codigo PIX.');
}

function resetPixCheckout() {
    stopPixTracking();
    activePixCheckout = null;
    sessionStorage.removeItem('espacoPatroas_activePix');
    getBookingPayment().resetPixCheckoutUi();
    selectedPaymentMethod = null;
    document.querySelectorAll('input[name="payment"]').forEach(input => { input.checked = false; });
    updatePaymentSummaryNote();
}

window.copyGeneratedPixCode = copyGeneratedPixCode;
window.resetPixCheckout = resetPixCheckout;
window.selectPaymentAmountMode = selectPaymentAmountMode;

function renderSuccess(app) {
    return getBookingPayment().renderSuccess({
        appointment: app,
        formatDate,
        formatCurrency
    });
}

function formatPaymentMethod(method) {
    return getBookingPayment().formatPaymentMethod(method);
}

function formatServiceNames(value) {
    if (Array.isArray(value)) return value.join(', ');
    if (!value) return 'Servi\u00e7o';

    const text = String(value).trim();
    if ((text.startsWith('[') && text.endsWith(']')) || (text.startsWith('"') && text.endsWith('"'))) {
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) return parsed.join(', ');
            if (typeof parsed === 'string') return parsed;
        } catch (error) {
            return text.replace(/^\[|\]$/g, '').replace(/^["']|["']$/g, '').replace(/["']/g, '');
        }
    }

    return text;
}

function formatAppointmentTime(value) {
    return String(value || '').slice(0, 5);
}

function formatCurrency(value) {
    const amount = Number(value);
    return `R$ ${(Number.isFinite(amount) ? amount : 0).toFixed(2).replace('.', ',')}`;
}

function toDateInputValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function parseDateInputValue(dateStr) {
    if (!dateStr) return null;
    const [year, month, day] = dateStr.split('-').map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

function getPaymentDisplayInfo(appointment = {}) {
    const rawStatus = String(appointment.payment_status || 'Pendente');
    const normalizedStatus = rawStatus.toLowerCase();
    const price = Number(appointment.price || 0);
    const amountPaid = Number(appointment.amount_paid || 0);
    const percentage = Number(appointment.payment_percentage || 0);
    const isPaid = normalizedStatus === 'pago' || amountPaid > 0;
    const isFullPayment = isPaid && (
        percentage >= 100 ||
        (price > 0 && amountPaid >= price - 0.01)
    );

    if (isFullPayment) {
        return {
            label: 'Pago integral',
            color: 'bg-emerald-100 text-emerald-700',
            detail: ''
        };
    }

    if (isPaid) {
        const partialPercentage = percentage > 0 && percentage < 100 ? Math.round(percentage) : null;
        return {
            label: partialPercentage ? `Sinal pago (${partialPercentage}%)` : 'Sinal pago',
            color: 'bg-emerald-100 text-emerald-700',
            detail: amountPaid > 0 ? `Pago: ${formatCurrency(amountPaid)}` : ''
        };
    }

    const statusColors = {
        pendente: 'bg-amber-100 text-amber-700',
        expirado: 'bg-red-100 text-red-600',
        recusado: 'bg-red-100 text-red-600',
        reembolsado: 'bg-gray-100 text-gray-600',
        contestado: 'bg-red-100 text-red-600'
    };

    return {
        label: rawStatus,
        color: statusColors[normalizedStatus] || 'bg-amber-100 text-amber-700',
        detail: ''
    };
}

// ==========================================
// MY APPOINTMENTS
// ==========================================
async function renderMyAppointments() {
    const container = document.getElementById('my-appointments-list');
    if (!container) return;

    if (!db.currentUser) return container.innerHTML = '<p class="text-center text-gray-400">FaÃ§a login para ver seus agendamentos.</p>';

    try {
        const { data, error } = await window.supabase
            .from('appointments')
            .select('*')
            .eq('user_id', db.currentUser.id)
            .order('appointment_date', { ascending: false });

        if (error) throw error;

        if (!data || data.length === 0) {
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center py-12 text-center">
                    <div class="w-20 h-20 rounded-full bg-[#f7f3f2] flex items-center justify-center mb-4">
                        <span class="material-symbols-outlined text-4xl text-[#d59f9f]">calendar_month</span>
                    </div>
                    <h3 class="font-headline font-bold text-lg text-[#1c1b1b] mb-2">Nenhum agendamento</h3>
                    <p class="text-sm text-[#50453b]">VocÃª ainda nÃ£o tem agendamentos marcados.</p>
                </div>`;
            return;
        }

        container.innerHTML = data.map(app => {
            const statusColors = {
                'Confirmado': 'bg-emerald-100 text-emerald-700',
                'Pendente': 'bg-amber-100 text-amber-700',
                'ConcluÃ­do': 'bg-gray-100 text-gray-600',
                'Cancelado': 'bg-red-100 text-red-600'
            };
            const statusColor = statusColors[app.status] || 'bg-gray-100 text-gray-600';
            const paymentInfo = getPaymentDisplayInfo(app);
            const serviceNames = formatServiceNames(app.services_names);
            const appointmentTime = formatAppointmentTime(app.appointment_time);

            return `
                <div class="bg-white rounded-xl p-5 shadow-sm border border-[#d4c4b7]/10">
                    <div class="flex justify-between items-start mb-3">
                        <div>
                            <p class="font-headline font-bold text-[#1c1b1b]">${serviceNames}</p>
                            <p class="text-xs text-[#50453b] mt-1">${formatDate(app.appointment_date)} Ã s ${appointmentTime}</p>
                        </div>
                        <span class="px-3 py-1 ${statusColor} text-[10px] font-bold uppercase rounded-full">${app.status}</span>
                    </div>
                    <div class="pt-3 border-t border-[#d4c4b7]/10">
                        <p class="text-xs text-[#50453b]">Valor: <span class="font-bold text-[#7f5353]">${formatCurrency(app.price)}</span></p>
                        <p class="text-[10px] ${paymentInfo.color} mt-1 px-2 py-0.5 rounded-full inline-block">Pagamento: ${paymentInfo.label}</p>
                        ${paymentInfo.detail ? `<p class="text-[10px] text-[#50453b] mt-1">${paymentInfo.detail}</p>` : ''}
                    </div>
                </div>`;
        }).join('');
    } catch (error) {
        console.error('Erro ao carregar:', error);
        container.innerHTML = '<p class="text-center text-red-400">Erro ao carregar agendamentos.</p>';
    }
}

// ==========================================
// ADMIN NAVIGATION
// ==========================================
function showAdminSection(section) {
    currentAdminSection = section;
    document.querySelectorAll('.adm-section').forEach(s => s.classList.add('hidden'));
    const el = document.getElementById(`adm-${section}`);
    if (el) el.classList.remove('hidden');

    const titles = { clients: 'GestÃ£o de Clientes', schedule: 'Agenda', portfolio: 'ServiÃ§os', gallery: 'CatÃ¡logo', settings: 'ConfiguraÃ§Ãµes' };
    const titleEl = document.getElementById('admin-page-title');
    if (titleEl) titleEl.textContent = titles[section] || 'Admin';
    const mobileTitleEl = document.getElementById('admin-mobile-title');
    if (mobileTitleEl) mobileTitleEl.textContent = titles[section] || 'Admin';
    const mobileSubtitleEl = document.getElementById('admin-mobile-subtitle');
    if (mobileSubtitleEl) mobileSubtitleEl.textContent = section === 'schedule' ? 'VisÃ£o rÃ¡pida da agenda' : 'Painel administrativo';

    document.querySelectorAll('.adm-nav-link').forEach(link => {
        link.classList.remove('text-[#7f5353]', 'font-extrabold', 'bg-[#f7f3f2]', 'shadow-sm');
        link.classList.add('text-stone-500');
    });

    document.querySelectorAll(`.adm-nav-link[data-admin-section="${section}"]`).forEach(currentLink => {
        currentLink.classList.remove('text-stone-500');
        currentLink.classList.add('text-[#7f5353]', 'font-extrabold', 'bg-[#f7f3f2]', 'shadow-sm');
    });

    document.querySelectorAll('.adm-mobile-chip').forEach(chip => {
        chip.classList.remove('bg-gradient-to-br', 'from-[#7f5353]', 'to-[#d59f9f]', 'text-white', 'border-transparent', 'shadow-sm');
        chip.classList.add('bg-white', 'text-stone-500', 'border', 'border-[#d4c4b7]/20');
    });
    document.querySelectorAll(`.adm-mobile-chip[data-admin-section="${section}"]`).forEach(chip => {
        chip.classList.remove('bg-white', 'text-stone-500', 'border', 'border-[#d4c4b7]/20');
        chip.classList.add('bg-gradient-to-br', 'from-[#7f5353]', 'to-[#d59f9f]', 'text-white', 'border-transparent', 'shadow-sm');
    });

    if (section === 'clients') {
        refreshAdminClientsSection().catch(error => {
            console.error('Erro ao carregar seÃ§Ã£o de clientes admin:', error);
            showToast('O painel abriu, mas a Ã¡rea de clientes nÃ£o carregou por completo.');
        });
    }
    else if (section === 'schedule') {
        renderAdminSchedule().catch(error => {
            console.error('Erro ao renderizar agenda admin:', error);
            showToast('A agenda do painel nÃ£o carregou por completo.');
        });
        renderAdminAppointments().catch(error => {
            console.error('Erro ao renderizar agendamentos admin:', error);
            showToast('A lista de agendamentos nÃ£o carregou por completo.');
        });
        renderNextAppointmentCard().catch(error => {
            console.error('Erro ao carregar prÃ³ximo agendamento:', error);
        });
    }
    else if (section === 'portfolio') renderServicesGridAdmin();
    else if (section === 'gallery') renderAdminGallery();
    else if (section === 'settings') renderAdminSettings();
}

// ==========================================
// ADMIN DASHBOARD
// ==========================================
async function refreshAdminClientsSection() {
    await loadProtectedDataForCurrentUser();
    await Promise.all([
        renderAdminDashboard(),
        renderAdminClients()
    ]);
}

async function renderAdminDashboard() {
    const concluidos = db.appointmentsCache.filter(a => a.status !== 'Cancelado').length;
    const recorrentes = db.users.filter(u => db.appointmentsCache.filter(a => a.user_id === u.id).length > 1).length;
    const taxaRetorno = db.users.length > 0 ? Math.round((recorrentes / db.users.length) * 100) : 0;

    document.getElementById('stat-total').textContent = concluidos;
    document.getElementById('stat-return').textContent = taxaRetorno + '%';
    renderNextAppointmentCard();
}

async function renderNextAppointmentCard() {
    const hojeStr = toDateInputValue(new Date());
    const proximos = await getSupabaseService().fetchUpcomingConfirmedAppointments(hojeStr);

    const infoEl = document.getElementById('next-appointment-info');
    if (proximos && proximos.length > 0) {
        const app = proximos[0];
        infoEl.textContent = `${app.appointment_time} - ${app.users?.name || 'Cliente'}`;
        document.getElementById('next-appointment-service').textContent = formatServiceNames(app.services_names);
    } else {
        infoEl.textContent = 'Nenhum agendamento hoje';
    }
}

async function showNextAppointmentDetails() {
    const hojeStr = toDateInputValue(new Date());

    try {
        const proximos = await getSupabaseService().fetchUpcomingConfirmedAppointments(hojeStr, 1, true);

        if (proximos && proximos.length > 0) {
            const app = proximos[0];
            const clientName = app.users?.name || 'Cliente nÃ£o identificado';
            const clientPhone = app.users?.phone || 'Telefone nÃ£o cadastrado';
            const dataFormatada = formatDate(app.appointment_date);
            
            const detalhes = `ðŸ“… DETALHES DO PRÃ“XIMO AGENDAMENTO\n\n` +
                             `ðŸ‘¤ Cliente: ${clientName}\n` +
                             `ðŸ“± Telefone: ${clientPhone}\n` +
                             `ðŸ’… ServiÃ§o: ${formatServiceNames(app.services_names)}\n` +
                             `ðŸ•’ Data: ${dataFormatada} Ã s ${app.appointment_time}\n` +
                             `ðŸ’° Valor: ${formatCurrency(app.price)}\n` +
                             `ðŸ’³ Pagamento: ${getPaymentDisplayInfo(app).label}`;
            
            alert(detalhes);
        } else {
            alert('NÃ£o hÃ¡ agendamentos prÃ³ximos confirmados para exibir.');
        }
    } catch (err) {
        console.error("Erro ao buscar detalhes:", err);
        showToast("Erro ao buscar os detalhes do agendamento.");
    }
}

// ==========================================
// ADMIN CLIENTS
// ==========================================
async function renderAdminClients() {
    const tbody = document.getElementById('clients-table-body');
    const mobileList = document.getElementById('clients-mobile-list');
    if (!tbody && !mobileList) return;
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8">Carregando...</td></tr>';
    if (mobileList) mobileList.innerHTML = '<div class="rounded-2xl border border-[#d4c4b7]/10 bg-[#f7f3f2] px-4 py-6 text-center text-sm text-stone-500">Carregando clientes...</div>';

    try {
        const users = db.users || [];
        const allAppointments = db.appointmentsCache || [];

        const appointmentsByUser = {};
        allAppointments.forEach(app => {
            if (!appointmentsByUser[app.user_id]) appointmentsByUser[app.user_id] = [];
            appointmentsByUser[app.user_id].push(app);
        });

        if (tbody) tbody.innerHTML = '';
        if (mobileList) mobileList.innerHTML = '';

        if (users.length === 0) {
            if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-400">Nenhum cliente encontrado.</td></tr>';
            if (mobileList) mobileList.innerHTML = '<div class="rounded-2xl border border-[#d4c4b7]/10 bg-[#f7f3f2] px-4 py-6 text-center text-sm text-stone-500">Nenhum cliente encontrado.</div>';
            return;
        }

        for (const u of users) {
            const userAppointments = appointmentsByUser[u.id] || [];
            const lastApp = userAppointments.sort((a, b) => new Date(b.appointment_date) - new Date(a.appointment_date))[0];
            const totalAppts = userAppointments.length;

            const statusClass = u.status === 'pendente' ? 'text-error' : 'text-emerald-600';
            const statusDotClass = u.status === 'pendente' ? 'bg-error' : 'bg-emerald-500';
            const profileImg = normalizeImageUrl(u.profile_image_url || '') || 'https://via.placeholder.com/40';
            const clientName = sanitizeString(u.name || 'Sem nome');
            const clientEmail = sanitizeString(u.email || '-');
            const lastServiceName = sanitizeString(lastApp ? formatServiceNames(lastApp.services_names) : '-');

            if (tbody) {
                const tr = document.createElement('tr');
                tr.className = "group hover:bg-[#f7f3f2]/50 transition-colors";
                tr.innerHTML = `
                    <td class="px-8 py-5 border-t border-[#d4c4b7]/5">
                        <div class="flex items-center gap-4">
                            <img src="${profileImg}" class="w-10 h-10 rounded-full object-cover">
                            <div class="flex flex-col">
                                <span class="font-bold text-[#1c1b1b]">${clientName}</span>
                                <span class="text-xs text-stone-400">${clientEmail}</span>
                            </div>
                        </div>
                    </td>
                    <td class="px-8 py-5 border-t border-[#d4c4b7]/5">
                        <span class="text-stone-500 font-medium">${totalAppts}</span>
                    </td>
                    <td class="px-8 py-5 border-t border-[#d4c4b7]/5">
                        <select onchange="updateUserType('${u.id}', this.value)" class="bg-transparent border border-stone-200 rounded-lg px-2 py-1 text-xs cursor-pointer">
                            <option value="Novo" ${u.type === 'Novo' ? 'selected' : ''}>Novo</option>
                            <option value="Recorrente" ${u.type === 'Recorrente' ? 'selected' : ''}>Recorrente</option>
                        </select>
                    </td>
                    <td class="px-8 py-5 border-t border-[#d4c4b7]/5">
                        <span class="text-stone-500 font-medium">${lastServiceName}</span>
                        <div class="text-[10px] text-stone-400">${lastApp ? formatDate(lastApp.appointment_date) : '-'}</div>
                    </td>
                    <td class="px-8 py-5 border-t border-[#d4c4b7]/5">
                        <div class="flex items-center gap-2 ${statusClass} font-bold text-xs">
                            <span class="w-2 h-2 rounded-full ${statusDotClass}"></span>
                            ${u.status === 'pendente' ? 'Pendente' : 'OK'}
                        </div>
                    </td>
                    <td class="px-8 py-5 border-t border-[#d4c4b7]/5">
                        <select onchange="updateUserStatus('${u.id}', this.value)" class="bg-transparent border border-stone-200 rounded-lg px-2 py-1 text-xs cursor-pointer mb-1">
                            <option value="ok" ${u.status === 'ok' ? 'selected' : ''}>OK</option>
                            <option value="pendente" ${u.status === 'pendente' ? 'selected' : ''}>Pendente</option>
                        </select>
                        <button onclick="deleteUser('${u.id}')" class="text-red-500 hover:text-red-700 text-xs underline">Excluir</button>
                    </td>`;
                tbody.appendChild(tr);
            }

            if (mobileList) {
                const card = document.createElement('article');
                card.className = 'rounded-2xl border border-[#d4c4b7]/10 bg-white p-4 shadow-sm';
                card.innerHTML = `
                    <div class="flex items-start justify-between gap-3">
                        <div class="flex items-center gap-3 min-w-0">
                            <img src="${profileImg}" class="w-12 h-12 rounded-full object-cover">
                            <div class="min-w-0">
                                <p class="font-bold text-[#1c1b1b] truncate">${clientName}</p>
                                <p class="text-xs text-stone-400 truncate">${clientEmail}</p>
                            </div>
                        </div>
                        <div class="flex items-center gap-2 ${statusClass} font-bold text-[11px] whitespace-nowrap">
                            <span class="w-2 h-2 rounded-full ${statusDotClass}"></span>
                            ${u.status === 'pendente' ? 'Pendente' : 'OK'}
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-3 mt-4 text-sm">
                        <div class="rounded-xl bg-[#f7f3f2] px-3 py-3">
                            <p class="text-[10px] font-bold uppercase tracking-widest text-stone-400">Atendimentos</p>
                            <p class="mt-1 font-bold text-[#1c1b1b]">${totalAppts}</p>
                        </div>
                        <div class="rounded-xl bg-[#f7f3f2] px-3 py-3">
                            <p class="text-[10px] font-bold uppercase tracking-widest text-stone-400">Ãšltimo serviÃ§o</p>
                            <p class="mt-1 font-bold text-[#1c1b1b]">${lastServiceName}</p>
                            <p class="text-[11px] text-stone-400 mt-1">${lastApp ? formatDate(lastApp.appointment_date) : '-'}</p>
                        </div>
                    </div>
                    <div class="grid grid-cols-1 gap-3 mt-4">
                        <div>
                            <label class="block text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-2">Tipo</label>
                            <select onchange="updateUserType('${u.id}', this.value)" class="w-full bg-[#f7f3f2] border border-stone-200 rounded-xl px-3 py-3 text-sm cursor-pointer">
                                <option value="Novo" ${u.type === 'Novo' ? 'selected' : ''}>Novo</option>
                                <option value="Recorrente" ${u.type === 'Recorrente' ? 'selected' : ''}>Recorrente</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-2">Status</label>
                            <select onchange="updateUserStatus('${u.id}', this.value)" class="w-full bg-[#f7f3f2] border border-stone-200 rounded-xl px-3 py-3 text-sm cursor-pointer">
                                <option value="ok" ${u.status === 'ok' ? 'selected' : ''}>OK</option>
                                <option value="pendente" ${u.status === 'pendente' ? 'selected' : ''}>Pendente</option>
                            </select>
                        </div>
                    </div>
                    <button onclick="deleteUser('${u.id}')" class="mt-4 w-full rounded-xl border border-red-200 px-4 py-3 text-sm font-bold text-red-600">Excluir cliente</button>`;
                mobileList.appendChild(card);
            }
        }
    } catch (error) {
        console.error('Erro ao carregar clientes:', error);
        if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-red-400">Erro ao carregar clientes</td></tr>';
        if (mobileList) mobileList.innerHTML = '<div class="rounded-2xl border border-red-200 bg-red-50 px-4 py-6 text-center text-sm text-red-600">Erro ao carregar clientes.</div>';
    }
}

async function updateUserStatus(userId, newStatus) {
    try {
        await supabaseUpdateUser(userId, { status: newStatus });
        await renderAdminDashboard();
        await renderAdminClients();
        showToast(`Status atualizado.`);
    } catch (error) {
        showToast('Erro ao atualizar.');
    }
}

async function updateUserType(userId, newType) {
    try {
        await supabaseUpdateUser(userId, { type: newType });
        await renderAdminDashboard();
        await renderAdminClients();
        showToast(`Cliente classificado como ${newType}.`);
    } catch (error) {
        showToast('Erro ao atualizar.');
    }
}

async function deleteUser(userId) {
    const appointmentsForUser = db.appointmentsCache.filter(app => app.user_id === userId && app.status !== 'Cancelado');
    if (appointmentsForUser.length > 0) {
        showToast("N\u00e3o exclua clientes com agendamentos vinculados. Cancele os agendamentos primeiro.");
        return;
    }
    if (!confirm("Tem certeza que deseja excluir este cliente? Esta a\u00e7\u00e3o n\u00e3o pode ser desfeita.")) return;
    try {
        await getSupabaseService().deleteUser(userId);
        db.users = db.users.filter(u => u.id !== userId);
        await renderAdminDashboard();
        await renderAdminClients();
        showToast("Cliente exclu\u00eddo.");
    } catch (error) {
        showToast('Erro ao excluir cliente.');
    }
}

// ==========================================
// ADMIN SCHEDULE E APPOINTMENTS
// ==========================================
async function renderAdminAppointments() {
    const tbody = document.getElementById('appointments-table-body');
    const mobileList = document.getElementById('appointments-mobile-list');
    if (!tbody && !mobileList) return;
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8">Carregando...</td></tr>';
    if (mobileList) mobileList.innerHTML = '<div class="rounded-2xl border border-[#d4c4b7]/10 bg-[#f7f3f2] px-4 py-6 text-center text-sm text-stone-500">Carregando agendamentos...</div>';

    try {
        const { appointments, users } = await getSupabaseService().fetchAdminAppointmentsAndUsers();
        db.appointmentsCache = appointments || [];

        if (!appointments || appointments.length === 0) {
            if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-400">Nenhum agendamento encontrado.</td></tr>';
            if (mobileList) mobileList.innerHTML = '<div class="rounded-2xl border border-[#d4c4b7]/10 bg-[#f7f3f2] px-4 py-6 text-center text-sm text-stone-500">Nenhum agendamento encontrado.</div>';
            return;
        }

        if (tbody) tbody.innerHTML = '';
        if (mobileList) mobileList.innerHTML = '';
        for (const app of appointments) {
            const user = users?.find(u => u.id === app.user_id);
            const statusColors = {
                "Confirmado": "bg-emerald-100 text-emerald-700",
                "Pendente": "bg-amber-100 text-amber-700",
                "Conclu\u00eddo": "bg-gray-100 text-gray-600",
                "Cancelado": "bg-red-100 text-red-600"
            };
            const statusColor = statusColors[app.status] || 'bg-gray-100 text-gray-600';

            const clientName = sanitizeString(user?.name || "Cliente");
            const clientEmail = sanitizeString(user?.email || "-");
            const serviceNames = sanitizeString(formatServiceNames(app.services_names));
            const appointmentDate = formatDate(app.appointment_date);
            const appointmentTime = sanitizeString(app.appointment_time);
            const appointmentStatus = sanitizeString(app.status);

            if (tbody) {
                const tr = document.createElement('tr');
                tr.className = "hover:bg-[#f7f3f2]/50 transition-colors";
                tr.dataset.search = `${clientName} ${clientEmail} ${serviceNames} ${appointmentDate} ${appointmentTime} ${appointmentStatus}`.toLowerCase();
                tr.innerHTML = `
                    <td class="px-4 py-3 border-t border-[#d4c4b7]/5">
                        <span class="font-medium text-[#1c1b1b]">${clientName}</span>
                        <div class="text-xs text-stone-400">${clientEmail}</div>
                    </td>
                    <td class="px-4 py-3 border-t border-[#d4c4b7]/5 text-sm">${serviceNames}</td>
                    <td class="px-4 py-3 border-t border-[#d4c4b7]/5 text-sm">${appointmentDate}</td>
                    <td class="px-4 py-3 border-t border-[#d4c4b7]/5 text-sm">${appointmentTime}</td>
                    <td class="px-4 py-3 border-t border-[#d4c4b7]/5">
                        <span class="px-2 py-1 ${statusColor} text-[10px] font-bold uppercase rounded-full">${appointmentStatus}</span>
                    </td>
                    <td class="px-4 py-3 border-t border-[#d4c4b7]/5">
                        <select onchange="updateAppointmentStatus('${app.id}', this.value)" class="bg-transparent border border-stone-200 rounded-lg px-2 py-1 text-xs cursor-pointer">
                            <option value="Confirmado" ${app.status === "Confirmado" ? "selected" : ""}>Confirmado</option>
                            <option value="Conclu\u00eddo" ${app.status === "Conclu\u00eddo" ? "selected" : ""}>Conclu\u00eddo</option>
                            <option value="Cancelado" ${app.status === "Cancelado" ? "selected" : ""}>Cancelado</option>
                        </select>
                    </td>`;
                tbody.appendChild(tr);
            }

            if (mobileList) {
                const card = document.createElement('article');
                card.className = 'rounded-2xl border border-[#d4c4b7]/10 bg-[#fdf8f8] p-4 shadow-sm';
                card.dataset.search = `${clientName} ${clientEmail} ${serviceNames} ${appointmentDate} ${appointmentTime} ${appointmentStatus}`.toLowerCase();
                card.innerHTML = `
                    <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                            <p class="font-bold text-[#1c1b1b] truncate">${clientName}</p>
                            <p class="text-xs text-stone-400 truncate">${clientEmail}</p>
                        </div>
                        <span class="px-2 py-1 ${statusColor} text-[10px] font-bold uppercase rounded-full whitespace-nowrap">${appointmentStatus}</span>
                    </div>
                    <div class="mt-4 space-y-3">
                        <div class="rounded-xl bg-white px-3 py-3">
                            <p class="text-[10px] font-bold uppercase tracking-widest text-stone-400">ServiÃ§o</p>
                            <p class="mt-1 text-sm font-bold text-[#1c1b1b]">${serviceNames}</p>
                        </div>
                        <div class="grid grid-cols-2 gap-3">
                            <div class="rounded-xl bg-white px-3 py-3">
                                <p class="text-[10px] font-bold uppercase tracking-widest text-stone-400">Data</p>
                                <p class="mt-1 text-sm font-bold text-[#1c1b1b]">${appointmentDate}</p>
                            </div>
                            <div class="rounded-xl bg-white px-3 py-3">
                                <p class="text-[10px] font-bold uppercase tracking-widest text-stone-400">HorÃ¡rio</p>
                                <p class="mt-1 text-sm font-bold text-[#1c1b1b]">${appointmentTime}</p>
                            </div>
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-2">Atualizar status</label>
                            <select onchange="updateAppointmentStatus('${app.id}', this.value)" class="w-full bg-white border border-stone-200 rounded-xl px-3 py-3 text-sm cursor-pointer">
                                <option value="Confirmado" ${app.status === "Confirmado" ? "selected" : ""}>Confirmado</option>
                                <option value="Conclu\u00eddo" ${app.status === "Conclu\u00eddo" ? "selected" : ""}>Conclu\u00eddo</option>
                                <option value="Cancelado" ${app.status === "Cancelado" ? "selected" : ""}>Cancelado</option>
                            </select>
                        </div>
                    </div>`;
                mobileList.appendChild(card);
            }
        }
    } catch (error) {
        console.error('Erro ao carregar agendamentos:', error);
        if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-red-400">Erro ao carregar</td></tr>';
        if (mobileList) mobileList.innerHTML = '<div class="rounded-2xl border border-red-200 bg-red-50 px-4 py-6 text-center text-sm text-red-600">Erro ao carregar agendamentos.</div>';
    }
}

async function updateAppointmentStatus(appointmentId, newStatus) {
    try {
        await getSupabaseService().updateAppointmentStatus(appointmentId, newStatus);

        const idx = db.appointmentsCache.findIndex(a => a.id === appointmentId);
        if (idx !== -1) db.appointmentsCache[idx].status = newStatus;

        showToast('Status atualizado!');
    } catch (error) {
        showToast('Erro ao atualizar.');
    }
}

function searchAppointments() {
    const searchTerm = document.getElementById('search-appointments')?.value.toLowerCase() || '';
    const rows = document.querySelectorAll('#appointments-table-body tr, #appointments-mobile-list [data-search]');
    
    rows.forEach(row => {
        const text = (row.dataset.search || row.textContent || '').toLowerCase();
        row.style.display = text.includes(searchTerm) ? '' : 'none';
    });
}

async function renderAdminSchedule() {
    if (!db.scheduleConfig) db.scheduleConfig = { start: "09:00", end: "18:00", slotDuration: 3, availableDays: [1, 2, 3, 4, 5], blockedDates: [] };

    if (isAgendaMobileViewport() && !agendaViewTouched && agendaView === 'month') {
        agendaView = 'week';
    } else if (!isAgendaMobileViewport() && !agendaViewTouched && agendaView !== 'month') {
        agendaView = 'month';
    }

    const startInput = document.getElementById('config-start-time');
    const endInput = document.getElementById('config-end-time');
    const slotInput = document.getElementById('config-slot-duration');
    if (startInput) startInput.value = db.scheduleConfig.start;
    if (endInput) endInput.value = db.scheduleConfig.end;
    if (slotInput) slotInput.value = db.scheduleConfig.slotDuration || 3;

    document.querySelectorAll('.day-checkbox').forEach(cb => {
        cb.checked = db.scheduleConfig.availableDays.includes(parseInt(cb.value));
    });

    const list = document.getElementById('blocked-dates-list');
    if (list) {
        list.innerHTML = '';
        (db.scheduleConfig.blockedDates || []).forEach(d => {
            const li = document.createElement('li');
            li.className = "py-2 flex justify-between items-center";
            li.innerHTML = `<span>${formatDate(d)}</span> <button onclick="removeBlockedDate('${d}')" class="text-red-500 text-xs hover:underline">Remover</button>`;
            list.appendChild(li);
        });
    }

    await loadAppointmentsForCalendar();
    const todayCount = getAppointmentsForDate(toDateInputValue(startOfDay(new Date()))).filter(app => app.status !== 'Cancelado').length;
    const todayCountEl = document.getElementById('stat-today-count');
    if (todayCountEl) todayCountEl.textContent = String(todayCount);
    renderAgendaViewButtons();
    renderAgendaCalendar();
    updateAgendaMonthLabel();
}

async function loadAppointmentsForCalendar() {
    try {
        allAppointmentsCache = await getSupabaseService().fetchAppointments();
    } catch (error) {
        allAppointmentsCache = [];
    }
}

function renderAgendaCalendar() {
    const grid = document.getElementById('agenda-calendar-grid');
    if (!grid) return;

    grid.innerHTML = '';
    const monthNames = ["Janeiro", "Fevereiro", "MarÃ§o", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    const displayDate = currentAgendaMonth;
    const year = displayDate.getFullYear();
    const month = displayDate.getMonth();

    const yearSelect = document.getElementById('agenda-year-select');
    if (yearSelect) {
        yearSelect.innerHTML = '';
        for (let y = year - 2; y <= year + 2; y++) {
            const opt = document.createElement('option');
            opt.value = y;
            opt.textContent = y;
            if (y === year) opt.selected = true;
            yearSelect.appendChild(opt);
        }
    }

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const monthAppointments = getAppointmentsForMonth(year, month);

    for (let i = 0; i < startDayOfWeek; i++) {
        const empty = document.createElement('div');
        empty.className = 'h-24 bg-[#f7f3f2]/30 border-r border-b border-[#d4c4b7]/10';
        grid.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const currentDate = new Date(year, month, day);
        currentDate.setHours(0, 0, 0, 0);
        const dateStr = toDateInputValue(currentDate);
        const dayAppointments = monthAppointments.filter(a => a.appointment_date === dateStr);
        const isToday = currentDate.getTime() === today.getTime();
        const isBlocked = db.scheduleConfig.blockedDates?.includes(dateStr);
        const isPast = currentDate < today;

        const cell = document.createElement('div');
        cell.className = `h-24 border-r border-b border-[#d4c4b7]/10 p-2 ${isToday ? 'bg-[#d59f9f]/10' : 'bg-white'} ${isBlocked ? 'opacity-50' : ''} ${isPast ? 'opacity-40' : ''}`;
        
        let appointmentsHtml = '';
        dayAppointments.slice(0, 2).forEach(app => {
            appointmentsHtml += `<div class="text-[10px] bg-primary/10 text-primary rounded px-1 py-0.5 mb-1 truncate">${formatAppointmentTime(app.appointment_time)} - ${formatServiceNames(app.services_names).split(',')[0] || 'ServiÃ§o'}</div>`;
        });
        if (dayAppointments.length > 2) {
            appointmentsHtml += `<div class="text-[10px] text-stone-400">+${dayAppointments.length - 2} mais</div>`;
        }

        cell.innerHTML = `
            <div class="flex justify-between items-start mb-1">
                <span class="text-xs font-bold ${isToday ? 'text-primary' : 'text-stone-500'}">${day}</span>
                ${isBlocked ? '<span class="text-[8px] text-red-400">Bloqueado</span>' : ''}
            </div>
            <div class="space-y-1">${appointmentsHtml}</div>
        `;

        grid.appendChild(cell);
    }

    const totalCells = startDayOfWeek + daysInMonth;
    const remainingCells = 7 - (totalCells % 7);
    if (remainingCells < 7) {
        for (let i = 0; i < remainingCells; i++) {
            const empty = document.createElement('div');
            empty.className = 'h-24 bg-[#f7f3f2]/30 border-r border-b border-[#d4c4b7]/10';
            grid.appendChild(empty);
        }
    }
}

function getAppointmentsForMonth(year, month) {
    return allAppointmentsCache.filter(app => {
        const appDate = parseDateInputValue(app.appointment_date);
        if (!appDate) return false;
        return appDate.getFullYear() === year && appDate.getMonth() === month;
    });
}

function updateAgendaMonthLabel() {
    const label = document.getElementById('agenda-month-label');
    if (!label) return;
    const monthNames = ["Janeiro", "Fevereiro", "MarÃ§o", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    label.textContent = `${monthNames[currentAgendaMonth.getMonth()]}, ${currentAgendaMonth.getFullYear()}`;
}

function prevAgendaMonth() {
    currentAgendaMonth = new Date(currentAgendaMonth.getFullYear(), currentAgendaMonth.getMonth() - 1, 1);
    renderAgendaCalendar();
    updateAgendaMonthLabel();
}

function nextAgendaMonth() {
    currentAgendaMonth = new Date(currentAgendaMonth.getFullYear(), currentAgendaMonth.getMonth() + 1, 1);
    renderAgendaCalendar();
    updateAgendaMonthLabel();
}

function changeAgendaYear(year) {
    currentAgendaMonth = new Date(parseInt(year), currentAgendaMonth.getMonth(), 1);
    renderAgendaCalendar();
    updateAgendaMonthLabel();
}

function setAgendaView(view) {
    agendaView = view;
    document.getElementById('btn-view-month').className = `px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest ${view === 'month' ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-stone-400 hover:text-primary transition-colors'}`;
    document.getElementById('btn-view-week').className = `px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest ${view === 'week' ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-stone-400 hover:text-primary transition-colors'}`;
    document.getElementById('btn-view-day').className = `px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest ${view === 'day' ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-stone-400 hover:text-primary transition-colors'}`;
    renderAgendaCalendar();
}

function isAgendaMobileViewport() {
    return window.innerWidth <= 768;
}

function startOfDay(date) {
    const normalized = new Date(date || new Date());
    normalized.setHours(0, 0, 0, 0);
    return normalized;
}

function addDays(date, amount) {
    const shifted = startOfDay(date);
    shifted.setDate(shifted.getDate() + amount);
    return shifted;
}

function getWeekStart(date) {
    const weekStart = startOfDay(date);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    return weekStart;
}

function getAppointmentsForDate(dateStr) {
    return allAppointmentsCache.filter(app => app.appointment_date === dateStr);
}

function sortAppointmentsByTime(appointments) {
    return [...appointments].sort((a, b) => formatAppointmentTime(a.appointment_time).localeCompare(formatAppointmentTime(b.appointment_time)));
}

function renderAgendaViewButtons() {
    const monthBtn = document.getElementById('btn-view-month');
    const weekBtn = document.getElementById('btn-view-week');
    const dayBtn = document.getElementById('btn-view-day');
    if (monthBtn) monthBtn.className = `px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest ${agendaView === 'month' ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-stone-400 hover:text-primary transition-colors'}`;
    if (weekBtn) weekBtn.className = `px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest ${agendaView === 'week' ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-stone-400 hover:text-primary transition-colors'}`;
    if (dayBtn) dayBtn.className = `px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest ${agendaView === 'day' ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-stone-400 hover:text-primary transition-colors'}`;
}

function renderAgendaYearSelect(year) {
    const yearSelect = document.getElementById('agenda-year-select');
    if (!yearSelect) return;

    yearSelect.innerHTML = '';
    for (let currentYear = year - 2; currentYear <= year + 2; currentYear++) {
        const option = document.createElement('option');
        option.value = currentYear;
        option.textContent = currentYear;
        if (currentYear === year) option.selected = true;
        yearSelect.appendChild(option);
    }
}

function renderAgendaCalendar() {
    const grid = document.getElementById('agenda-calendar-grid');
    if (!grid) return;

    const header = document.getElementById('agenda-calendar-header');
    const displayDate = startOfDay(currentAgendaMonth || new Date());

    renderAgendaYearSelect(displayDate.getFullYear());
    grid.innerHTML = '';

    if (agendaView === 'month') {
        if (header) header.classList.remove('hidden');
        renderAgendaMonthView(grid, displayDate);
        return;
    }

    if (header) header.classList.add('hidden');

    if (agendaView === 'week') {
        renderAgendaWeekView(grid, displayDate);
        return;
    }

    renderAgendaDayView(grid, displayDate);
}

function renderAgendaMonthView(grid, displayDate) {
    grid.className = 'grid grid-cols-7';
    const year = displayDate.getFullYear();
    const month = displayDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay();
    const today = startOfDay(new Date());
    const monthAppointments = getAppointmentsForMonth(year, month);

    for (let i = 0; i < startDayOfWeek; i++) {
        const empty = document.createElement('div');
        empty.className = 'h-24 bg-[#f7f3f2]/30 border-r border-b border-[#d4c4b7]/10';
        grid.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const currentDate = new Date(year, month, day);
        currentDate.setHours(0, 0, 0, 0);
        const dateStr = toDateInputValue(currentDate);
        const dayAppointments = monthAppointments.filter(app => app.appointment_date === dateStr);
        const isToday = currentDate.getTime() === today.getTime();
        const isBlocked = db.scheduleConfig.blockedDates?.includes(dateStr);
        const isPast = currentDate < today;

        const cell = document.createElement('div');
        cell.className = `h-24 border-r border-b border-[#d4c4b7]/10 p-2 ${isToday ? 'bg-[#d59f9f]/10' : 'bg-white'} ${isBlocked ? 'opacity-50' : ''} ${isPast ? 'opacity-40' : ''}`;

        let appointmentsHtml = '';
        dayAppointments.slice(0, 2).forEach(app => {
            appointmentsHtml += `<div class="text-[10px] bg-primary/10 text-primary rounded px-1 py-0.5 mb-1 truncate">${formatAppointmentTime(app.appointment_time)} - ${formatServiceNames(app.services_names).split(',')[0] || 'Servico'}</div>`;
        });
        if (dayAppointments.length > 2) {
            appointmentsHtml += `<div class="text-[10px] text-stone-400">+${dayAppointments.length - 2} mais</div>`;
        }

        cell.innerHTML = `
            <div class="flex justify-between items-start mb-1">
                <span class="text-xs font-bold ${isToday ? 'text-primary' : 'text-stone-500'}">${day}</span>
                ${isBlocked ? '<span class="text-[8px] text-red-400">Bloqueado</span>' : ''}
            </div>
            <div class="space-y-1">${appointmentsHtml}</div>
        `;

        grid.appendChild(cell);
    }

    const totalCells = startDayOfWeek + daysInMonth;
    const remainingCells = 7 - (totalCells % 7);
    if (remainingCells < 7) {
        for (let i = 0; i < remainingCells; i++) {
            const empty = document.createElement('div');
            empty.className = 'h-24 bg-[#f7f3f2]/30 border-r border-b border-[#d4c4b7]/10';
            grid.appendChild(empty);
        }
    }
}

function renderAgendaWeekView(grid, referenceDate) {
    grid.className = 'grid grid-cols-1 gap-3 p-4 bg-[#fdf8f8]';
    const weekStart = getWeekStart(referenceDate);

    for (let offset = 0; offset < 7; offset++) {
        grid.appendChild(buildAgendaPeriodCard(addDays(weekStart, offset)));
    }
}

function renderAgendaDayView(grid, referenceDate) {
    grid.className = 'grid grid-cols-1 gap-3 p-4 bg-[#fdf8f8]';
    grid.appendChild(buildAgendaPeriodCard(referenceDate, true));
}

function buildAgendaPeriodCard(currentDate, expanded = false) {
    const dateStr = toDateInputValue(currentDate);
    const today = startOfDay(new Date());
    const isToday = currentDate.getTime() === today.getTime();
    const isBlocked = db.scheduleConfig.blockedDates?.includes(dateStr);
    const isPast = currentDate < today;
    const weekdayLabel = currentDate.toLocaleDateString('pt-BR', { weekday: expanded ? 'long' : 'short' });
    const appointments = sortAppointmentsByTime(getAppointmentsForDate(dateStr));

    const card = document.createElement('article');
    card.className = `rounded-2xl border border-[#d4c4b7]/10 p-4 shadow-sm ${isToday ? 'bg-[#fff4f4]' : 'bg-white'} ${isBlocked ? 'opacity-60' : ''} ${isPast ? 'opacity-75' : ''}`;

    let appointmentsHtml = appointments.map(app => `
        <div class="rounded-xl border border-[#d4c4b7]/10 bg-white px-3 py-3">
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <p class="font-bold text-[#1c1b1b]">${formatAppointmentTime(app.appointment_time)}</p>
                    <p class="text-sm text-[#50453b] mt-1">${sanitizeString(formatServiceNames(app.services_names))}</p>
                </div>
                <span class="px-2 py-1 rounded-full text-[10px] font-bold uppercase ${getAgendaStatusPillClass(app.status)}">${sanitizeString(app.status)}</span>
            </div>
        </div>
    `).join('');

    if (!appointmentsHtml) {
        appointmentsHtml = `<div class="rounded-xl bg-[#f7f3f2] px-3 py-4 text-sm text-stone-500">${isBlocked ? 'Data bloqueada para atendimento.' : 'Nenhum agendamento neste periodo.'}</div>`;
    }

    card.innerHTML = `
        <div class="flex items-start justify-between gap-3 mb-4">
            <div>
                <p class="text-[11px] font-bold uppercase tracking-widest ${isToday ? 'text-primary' : 'text-stone-400'}">${weekdayLabel}</p>
                <p class="text-lg font-extrabold text-[#1c1b1b] mt-1">${formatDate(dateStr)}</p>
            </div>
            <div class="text-right">
                ${isToday ? '<span class="inline-flex rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase text-primary">Hoje</span>' : ''}
                ${isBlocked ? '<span class="inline-flex rounded-full bg-red-50 px-2 py-1 text-[10px] font-bold uppercase text-red-500 ml-2">Bloqueado</span>' : ''}
                <p class="text-xs text-stone-400 mt-2">${appointments.length} agendamento(s)</p>
            </div>
        </div>
        <div class="space-y-3">${appointmentsHtml}</div>
    `;

    return card;
}

function getAgendaStatusPillClass(status) {
    const pillClasses = {
        Confirmado: 'bg-emerald-100 text-emerald-700',
        Pendente: 'bg-amber-100 text-amber-700',
        Concluido: 'bg-gray-100 text-gray-600',
        'ConcluÃ­do': 'bg-gray-100 text-gray-600',
        Cancelado: 'bg-red-100 text-red-600'
    };

    return pillClasses[status] || 'bg-gray-100 text-gray-600';
}

function updateAgendaMonthLabel() {
    const label = document.getElementById('agenda-month-label');
    const title = document.getElementById('agenda-view-title');
    if (!label) return;

    const referenceDate = startOfDay(currentAgendaMonth || new Date());

    if (agendaView === 'week') {
        const weekStart = getWeekStart(referenceDate);
        const weekEnd = addDays(weekStart, 6);
        if (title) title.textContent = 'Agenda da Semana';
        label.textContent = `${formatDate(toDateInputValue(weekStart))} ate ${formatDate(toDateInputValue(weekEnd))}`;
        return;
    }

    if (agendaView === 'day') {
        if (title) title.textContent = 'Agenda do Dia';
        label.textContent = referenceDate.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
        return;
    }

    if (title) title.textContent = 'Agenda Mensal';
    const monthNames = ["Janeiro", "Fevereiro", "Marco", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    label.textContent = `${monthNames[referenceDate.getMonth()]}, ${referenceDate.getFullYear()}`;
}

function prevAgendaMonth() {
    if (agendaView === 'week') {
        currentAgendaMonth = addDays(currentAgendaMonth, -7);
    } else if (agendaView === 'day') {
        currentAgendaMonth = addDays(currentAgendaMonth, -1);
    } else {
        currentAgendaMonth = new Date(currentAgendaMonth.getFullYear(), currentAgendaMonth.getMonth() - 1, 1);
    }
    renderAgendaCalendar();
    updateAgendaMonthLabel();
}

function nextAgendaMonth() {
    if (agendaView === 'week') {
        currentAgendaMonth = addDays(currentAgendaMonth, 7);
    } else if (agendaView === 'day') {
        currentAgendaMonth = addDays(currentAgendaMonth, 1);
    } else {
        currentAgendaMonth = new Date(currentAgendaMonth.getFullYear(), currentAgendaMonth.getMonth() + 1, 1);
    }
    renderAgendaCalendar();
    updateAgendaMonthLabel();
}

function changeAgendaYear(year) {
    currentAgendaMonth = new Date(parseInt(year, 10), currentAgendaMonth.getMonth(), currentAgendaMonth.getDate() || 1);
    renderAgendaCalendar();
    updateAgendaMonthLabel();
}

function setAgendaView(view) {
    agendaViewTouched = true;
    agendaView = view;
    renderAgendaViewButtons();
    renderAgendaCalendar();
    updateAgendaMonthLabel();
}

function addBlockedDate() {
    const val = document.getElementById('input-block-date').value;
    if (!val) return;
    if (!db.scheduleConfig.blockedDates.includes(val)) {
        db.scheduleConfig.blockedDates.push(val);
        supabaseSaveScheduleConfig(db.scheduleConfig).then(() => {
            renderAdminSchedule();
            showToast('Data bloqueada.');
        });
    }
}

function removeBlockedDate(date) {
    db.scheduleConfig.blockedDates = db.scheduleConfig.blockedDates.filter(d => d !== date);
    supabaseSaveScheduleConfig(db.scheduleConfig).then(() => {
        renderAdminSchedule();
        showToast('Data desbloqueada.');
    });
}

window.addBlockedDate = addBlockedDate;
window.removeBlockedDate = removeBlockedDate;

async function saveScheduleSettings() {
    try {
        const checkboxes = document.querySelectorAll('.day-checkbox:checked');
        const selectedDays = Array.from(checkboxes).map(cb => parseInt(cb.value));

        const updates = {
            start_time: document.getElementById('config-start-time').value,
            end_time: document.getElementById('config-end-time').value,
            slot_duration: parseFloat(document.getElementById('config-slot-duration').value) || 3,
            available_days: selectedDays.length > 0 ? selectedDays : [1, 2, 3, 4, 5], 
            blocked_dates: db.scheduleConfig.blockedDates || []
        };

        await getSupabaseService().upsertScheduleConfig(updates);

        db.scheduleConfig = {
            start: updates.start_time,
            end: updates.end_time,
            slotDuration: updates.slot_duration,
            availableDays: updates.available_days,
            blockedDates: updates.blocked_dates
        };
        showToast('Agenda atualizada com sucesso!');
        renderAdminSchedule();
    } catch (error) {
        showToast('Erro ao salvar no banco.');
    }
}

window.saveScheduleSettings = saveScheduleSettings;

// ==========================================
// ADMIN SERVICES
// ==========================================
function renderServicesGridAdmin() {
    const container = document.getElementById('services-grid-admin');
    if (!container) return;
    container.innerHTML = '';

    db.services.forEach(s => {
        const card = document.createElement('div');
        card.className = 'bg-[#f1edec] rounded-2xl overflow-hidden group hover:shadow-2xl transition-all duration-500 flex flex-col';

        const imgSrc = normalizeImageUrl(s.image_url || s.img || "");
        const displayImg = imgSrc || SERVICE_IMAGE_PLACEHOLDER;

        card.innerHTML = `
            <div class="aspect-square w-full overflow-hidden bg-[#ebe7e7] relative">
                <img src="${displayImg}" alt="${sanitizeString(s.name || 'Servi\u00e7o')}" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" onerror="this.src='${SERVICE_IMAGE_PLACEHOLDER}'">
            </div>
            <div class="p-6 flex-1 flex flex-col">
                <h3 class="font-headline text-lg font-bold text-[#1c1b1b] mb-2">${sanitizeString(s.name || 'Servi\u00e7o')}</h3>
                <p class="font-body text-sm text-stone-500 leading-relaxed mb-4 flex-1">${sanitizeString(s.description || "")}</p>
                <div class="flex justify-between items-center pt-4 border-t border-[#d4c4b7]/30">
                    <span class="font-headline text-2xl font-extrabold text-[#7f5353]">${formatCurrency(s.price)}</span>
                    <div class="flex gap-2">
                        <button onclick="openEditServiceModal('${s.id}')" class="p-2 text-stone-400 hover:text-[#7f5353] transition-colors" title="Editar">
                            <span class="material-symbols-outlined">edit_note</span>
                        </button>
                        <button onclick="confirmDeleteService('${s.id}')" class="p-2 text-stone-400 hover:text-red-500 transition-colors" title="Excluir">
                            <span class="material-symbols-outlined">delete</span>
                        </button>
                    </div>
                </div>
            </div>`;
        container.appendChild(card);
    });
}

function openAddServiceModal() {
    document.getElementById('service-id').value = '';
    document.getElementById('service-name').value = '';
    document.getElementById('service-desc').value = '';
    document.getElementById('service-price').value = '';
    document.getElementById("service-preview-img").src = SERVICE_IMAGE_PLACEHOLDER;
    resetServiceImageInput();
    document.getElementById('service-modal').classList.remove('hidden');
    document.getElementById('service-modal').classList.add('flex');
}

function openEditServiceModal(id) {
    const service = db.services.find(s => s.id == id);
    if (!service) return;

    const imgSrc = normalizeImageUrl(service.image_url || service.img || "") || SERVICE_IMAGE_PLACEHOLDER;

    document.getElementById('service-id').value = service.id;
    document.getElementById('service-name').value = service.name;
    document.getElementById('service-desc').value = service.description || service.desc || '';
    document.getElementById('service-price').value = service.price;
    document.getElementById('service-preview-img').src = imgSrc;
    resetServiceImageInput('Imagem atual mantida. Importe outra para substituir.');
    document.getElementById('service-modal').classList.remove('hidden');
    document.getElementById('service-modal').classList.add('flex');
}

function closeServiceModal() {
    document.getElementById('service-modal').classList.add('hidden');
    document.getElementById('service-modal').classList.remove('flex');
}

async function previewServiceImage(input) {
    const file = input.files?.[0];
    if (!file) return;

    try {
        validateImageFile(file);
        selectedServiceImageFile = file;
        const preview = document.getElementById("service-preview-img");
        if (preview) preview.src = URL.createObjectURL(file);
        setImageUploadStatus('service', 'Imagem selecionada. Clique em Salvar para enviar.', 'success');
    } catch (error) {
        input.value = "";
        selectedServiceImageFile = null;
        setImageUploadStatus('service', error.message || 'Nao foi possivel carregar a imagem.', 'error');
        showToast(error.message || 'Nao foi possivel carregar a imagem.');
    }
}

function resetServiceImageInput(message = 'Imagem ate 25MB. Fotos grandes serao otimizadas automaticamente.') {
    const input = document.getElementById('service-img-input');
    if (input) input.value = '';
    selectedServiceImageFile = null;
    setImageUploadStatus('service', message);
}

function resetGalleryImageInput(message = 'Imagem ate 25MB. Fotos grandes serao otimizadas automaticamente.') {
    const input = document.getElementById('gallery-img-input');
    if (input) input.value = '';
    selectedGalleryImageFile = null;
    setImageUploadStatus('gallery', message);
}

function setImageUploadStatus(scope, message, type = 'neutral') {
    const status = document.getElementById(`${scope}-image-status`);
    if (!status) return;

    status.textContent = message;
    status.classList.remove('text-stone-500', 'text-green-700', 'text-red-700');
    const colorClass = type === 'success' ? 'text-green-700' : type === 'error' ? 'text-red-700' : 'text-stone-500';
    status.classList.add(colorClass);
}

function validateImageFile(file) {
    if (!file.type.startsWith('image/')) {
        throw new Error('Selecione um arquivo de imagem valido.');
    }

    if (file.size > IMAGE_SOURCE_MAX_SIZE) {
        throw new Error('Imagem muito grande. Maximo 25MB.');
    }
}

function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Nao foi possivel ler a imagem.'));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('Arquivo de imagem invalido.'));
            img.onload = () => resolve({ img, dataUrl: reader.result });
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

async function optimizeImageFile(file) {
    const { img, dataUrl } = await loadImageFromFile(file);
    const shouldKeepOriginal = file.type === 'image/gif';
    if (shouldKeepOriginal) return dataUrl;

    const scale = Math.min(1, IMAGE_UPLOAD_MAX_DIMENSION / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);

    const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    return canvas.toDataURL(outputType, IMAGE_UPLOAD_QUALITY);
}

async function optimizeImageFileToBlob(file) {
    const { img } = await loadImageFromFile(file);
    const scale = Math.min(1, IMAGE_UPLOAD_MAX_DIMENSION / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);

    const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(result => {
            if (result) resolve(result);
            else reject(new Error('Nao foi possivel otimizar a imagem.'));
        }, outputType, IMAGE_UPLOAD_QUALITY);
    });

    if (blob.size > IMAGE_UPLOAD_MAX_SIZE) {
        throw new Error('Imagem muito grande mesmo apos otimizacao. Tente outra foto.');
    }

    return blob;
}

function dataUrlToBlob(dataUrl) {
    const [header, base64] = dataUrl.split(',');
    const mimeType = header.match(/data:(.*?);base64/)?.[1] || 'image/jpeg';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }

    return new Blob([bytes], { type: mimeType });
}

function getImageExtension(mimeType) {
    const extensions = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif'
    };
    return extensions[mimeType] || 'jpg';
}

function createRandomImageId() {
    return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createStorageImagePath(folder, entityId, mimeType) {
    const safeFolder = String(folder || 'catalog').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
    const safeId = String(entityId || createRandomImageId()).replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
    return `${safeFolder}/${safeId}/${Date.now()}-${createRandomImageId()}.${getImageExtension(mimeType)}`;
}

async function uploadImageDataUrl(dataUrl, folder, entityId) {
    if (!dataUrl.startsWith('data:image/')) return dataUrl;
    if (!window.supabase?.storage) {
        throw new Error('Supabase Storage nao esta disponivel.');
    }

    const blob = dataUrlToBlob(dataUrl);
    const path = createStorageImagePath(folder, entityId, blob.type);
    const { error } = await window.supabase.storage
        .from(IMAGE_UPLOAD_BUCKET)
        .upload(path, blob, {
            contentType: blob.type,
            cacheControl: '31536000',
            upsert: false
        });

    if (error) throw error;

    const { data } = window.supabase.storage.from(IMAGE_UPLOAD_BUCKET).getPublicUrl(path);
    if (!data?.publicUrl) throw new Error('Nao foi possivel gerar a URL publica da imagem.');
    return data.publicUrl;
}

async function uploadImageFile(file, folder, entityId) {
    validateImageFile(file);
    if (!window.supabase?.storage) {
        throw new Error('Supabase Storage nao esta disponivel.');
    }

    const canUploadOriginal = file.size <= IMAGE_UPLOAD_MAX_SIZE && ALLOWED_UPLOAD_MIME_TYPES.includes(file.type);
    const body = canUploadOriginal ? file : await optimizeImageFileToBlob(file);
    const contentType = body.type || 'image/jpeg';
    const path = createStorageImagePath(folder, entityId, contentType);
    const { error } = await window.supabase.storage
        .from(IMAGE_UPLOAD_BUCKET)
        .upload(path, body, {
            contentType,
            cacheControl: '31536000',
            upsert: false
        });

    if (error) throw error;

    const { data } = window.supabase.storage.from(IMAGE_UPLOAD_BUCKET).getPublicUrl(path);
    if (!data?.publicUrl) throw new Error('Nao foi possivel gerar a URL publica da imagem.');
    return data.publicUrl;
}
async function saveService() {
    const id = document.getElementById("service-id").value;
    const name = sanitizeString(document.getElementById("service-name").value.trim());
    const desc = sanitizeString(document.getElementById("service-desc").value.trim());
    const price = parseFloat(document.getElementById("service-price").value);
    const imgSrc = document.getElementById("service-preview-img")?.src || "";
    const isPlaceholder = imgSrc.includes("placeholder.com") || !imgSrc;
    let imageUrlToSave = isPlaceholder ? "" : imgSrc;
    if (!name) return showToast("Digite o nome do servi\u00e7o.");
    if (isNaN(price) || price < 0) return showToast("Digite um pre\u00e7o v\u00e1lido.");
    try {
        if (selectedServiceImageFile) {
            setImageUploadStatus('service', 'Enviando imagem...', 'neutral');
            imageUrlToSave = await uploadImageFile(selectedServiceImageFile, 'services', id || createRandomImageId());
            setImageUploadStatus('service', 'Imagem enviada com sucesso.', 'success');
        } else if (imageUrlToSave.startsWith('data:image/')) {
            setImageUploadStatus('service', 'Enviando imagem...', 'neutral');
            imageUrlToSave = await uploadImageDataUrl(imageUrlToSave, 'services', id || createRandomImageId());
            setImageUploadStatus('service', 'Imagem enviada com sucesso.', 'success');
        }

        if (id) {
            await supabaseUpdateService(id, { name, description: desc, price, image_url: imageUrlToSave });
            showToast("Servi\u00e7o atualizado!");
        } else {
            await supabaseCreateService({ name, desc, price, img: imageUrlToSave });
            showToast("Novo servi\u00e7o adicionado!");
        }
        await loadAllData();
        closeServiceModal();
        renderServicesGridAdmin();
        renderServices();
    } catch (error) {
        console.error("Erro ao salvar:", error);
        setImageUploadStatus('service', error.message || 'Erro ao salvar servico.', 'error');
        showToast(error.message || "Erro ao salvar servi\u00e7o.");
    }
}
async function confirmDeleteService(id) {
    if (!confirm("Tem certeza que deseja excluir este servi\u00e7o?")) return;
    try {
        await supabaseDeleteService(id);
        await loadAllData();
        renderServicesGridAdmin();
        renderServices();
        showToast("Servi\u00e7o removido.");
    } catch (error) {
        showToast('Erro ao remover.');
    }
}

// ==========================================
// ADMIN SETTINGS
// ==========================================
function renderAdminSettings() {
    const el = document.getElementById('admin-settings-photo');
    if (el) el.src = normalizeImageUrl(db.settings.profileImg || '') || PROFILE_IMAGE_FALLBACK;
    loadAdminPaymentSettings();
}

function setPaymentSettingsStatus(message = '', type = 'info') {
    const status = document.getElementById('payment-settings-status');
    if (!status) return;
    status.textContent = message;
    status.className = `mt-3 text-sm font-medium ${type === 'error' ? 'text-red-600' : 'text-stone-500'}`;
    status.classList.toggle('hidden', !message);
}

function clampInstallments(value) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 1;
    return Math.min(12, Math.max(1, parsed));
}

function updateMaxInstallmentsPreview() {
    const input = document.getElementById('admin-max-installments');
    const preview = document.getElementById('admin-max-installments-preview');
    if (!input) return;

    const installments = clampInstallments(input.value);
    input.value = installments;
    if (preview) {
        preview.textContent = installments === 1
            ? '1 parcela'
            : `Até ${installments} parcelas`;
    }
}

async function loadAdminPaymentSettings() {
    const input = document.getElementById('admin-max-installments');
    if (!input) return;

    try {
        const config = await getSupabaseService().fetchPaymentConfig();
        db.paymentConfig = {
            deposit_percentage: Number(config.deposit_percentage) || 50,
            pix_expiration_minutes: Number(config.pix_expiration_minutes) || 15,
            allow_cash: Boolean(config.allow_cash),
            max_installments: clampInstallments(config.max_installments)
        };
        input.value = db.paymentConfig.max_installments;
        updateMaxInstallmentsPreview();
        setPaymentSettingsStatus('');
    } catch (error) {
        console.error('Erro ao carregar configuracoes de pagamento:', error);
        input.value = db.paymentConfig.max_installments || 1;
        updateMaxInstallmentsPreview();
        setPaymentSettingsStatus('Nao foi possivel carregar as configuracoes de pagamento.', 'error');
    }
}

async function savePaymentSettings(button = null) {
    const input = document.getElementById('admin-max-installments');
    if (!input) return;

    const previousText = button?.innerHTML;
    const maxInstallments = clampInstallments(input.value);
    input.value = maxInstallments;
    updateMaxInstallmentsPreview();

    try {
        if (button) {
            button.disabled = true;
            button.innerHTML = '<span class="material-symbols-outlined animate-spin">progress_activity</span> Salvando';
        }

        const config = await getSupabaseService().updatePaymentConfig({
            max_installments: maxInstallments
        });

        db.paymentConfig = {
            deposit_percentage: Number(config.deposit_percentage) || db.paymentConfig.deposit_percentage,
            pix_expiration_minutes: Number(config.pix_expiration_minutes) || db.paymentConfig.pix_expiration_minutes,
            allow_cash: Boolean(config.allow_cash),
            max_installments: clampInstallments(config.max_installments)
        };
        setPaymentSettingsStatus('Parcelamento atualizado.');
        showToast('Parcelamento atualizado!');
    } catch (error) {
        console.error('Erro ao salvar configuracoes de pagamento:', error);
        setPaymentSettingsStatus('Erro ao salvar o parcelamento.', 'error');
        showToast('Erro ao salvar configuracao de pagamento.');
    } finally {
        if (button) {
            button.disabled = false;
            button.innerHTML = previousText;
        }
    }
}

function handleProfileImageUpload(input) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        if (!file.type.startsWith('image/')) return showToast('Selecione um arquivo de imagem.');
        if (file.size > 5 * 1024 * 1024) return showToast('Imagem muito grande. MÃ¡ximo 5MB.');

        const reader = new FileReader();
        reader.onload = function(e) {
            db.settings.profileImg = e.target.result;
            supabaseSaveSettings('profileImg', e.target.result).then(() => {
                renderAdminSettings();
                updateManuProfilePhoto();
                showToast('Foto atualizada!');
            });
        };
        reader.readAsDataURL(file);
    }
}

// ==========================================
// GALLERY / PORTFOLIO (CLIENT & ADMIN)
// ==========================================

function renderClientGallery() {
    const container = document.getElementById('client-gallery-grid');
    if (!container) return;
    container.innerHTML = '';

    if (!db.gallery || db.gallery.length === 0) {
        container.innerHTML = '<p class="text-center text-stone-400 col-span-2 py-10">O catÃ¡logo estÃ¡ sendo atualizado com novas fotos. Volte em breve!</p>';
        return;
    }

    db.gallery.forEach(g => {
        const imgSrc = g.image_url || 'https://via.placeholder.com/400x500?text=Foto';
        const title = (g.title || 'InspiraÃ§Ã£o').replace(/'/g, "\\'");
        const desc = (g.description || '').replace(/'/g, "\\'");

        const card = document.createElement('div');
        card.className = 'rounded-2xl overflow-hidden shadow-sm relative group bg-white border border-[#d4c4b7]/20 aspect-[4/5] cursor-pointer';
        
        card.addEventListener('click', function(e) {
            e.preventDefault();
            openImageModal(imgSrc, title, desc);
        });

        card.innerHTML = `
            <img src="${imgSrc}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 pointer-events-none" alt="${title}">
            <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent flex flex-col justify-end p-3 pointer-events-none">
                <h4 class="text-white font-bold text-xs shadow-black">${title}</h4>
                <p class="text-white/80 text-[10px] truncate">${desc}</p>
            </div>
        `;
        container.appendChild(card);
    });
}

function openImageModal(imgSrc, title, desc) {
    const modal = document.getElementById('image-view-modal');
    const img = document.getElementById('expanded-image');
    const titleEl = document.getElementById('expanded-image-title');
    const descEl = document.getElementById('expanded-image-desc');

    if (modal && img) {
        img.src = imgSrc;
        titleEl.textContent = title;
        descEl.textContent = desc;
        
        modal.style.setProperty('display', 'flex', 'important');
    }
}

function closeImageModal() {
    const modal = document.getElementById('image-view-modal');
    if (modal) {
        modal.style.setProperty('display', 'none', 'important');
        
        setTimeout(() => { 
            document.getElementById('expanded-image').src = ''; 
        }, 300);
    }
}

function renderAdminGallery() {
    const container = document.getElementById('admin-gallery-grid');
    if (!container) return;
    container.innerHTML = '';

    db.gallery.forEach(g => {
        const imgSrc = g.image_url || 'https://via.placeholder.com/400x400?text=Foto';
        const title = (g.title || 'Sem tÃ­tulo').replace(/'/g, "\\'");
        const desc = (g.description || '').replace(/'/g, "\\'");

        const card = document.createElement('div');
        card.className = 'bg-[#f1edec] rounded-2xl overflow-hidden group hover:shadow-lg transition-all duration-300 flex flex-col relative';
        
        const imgContainer = document.createElement('div');
        imgContainer.className = 'aspect-square w-full overflow-hidden cursor-pointer';
        imgContainer.addEventListener('click', function(e) {
            e.preventDefault();
            openImageModal(imgSrc, title, desc);
        });
        imgContainer.innerHTML = `<img src="${imgSrc}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 pointer-events-none">`;

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'p-4 bg-white flex justify-between items-center border-t border-[#d4c4b7]/20';
        actionsDiv.innerHTML = `
            <div class="overflow-hidden">
                <h3 class="font-bold text-sm text-[#1c1b1b] truncate">${title}</h3>
                <p class="text-[10px] text-stone-500 truncate">${desc}</p>
            </div>
            <div class="flex gap-1 ml-2">
                <button onclick="openEditGalleryModal('${g.id}')" class="p-1.5 text-stone-400 hover:text-primary transition-colors bg-[#f7f3f2] rounded-lg">
                    <span class="material-symbols-outlined text-[18px]">edit</span>
                </button>
                <button onclick="confirmDeleteGalleryItem('${g.id}')" class="p-1.5 text-stone-400 hover:text-red-500 transition-colors bg-[#f7f3f2] rounded-lg">
                    <span class="material-symbols-outlined text-[18px]">delete</span>
                </button>
            </div>
        `;
        
        card.appendChild(imgContainer);
        card.appendChild(actionsDiv);
        container.appendChild(card);
    });
}

function openAddGalleryModal() {
    document.getElementById('gallery-id').value = '';
    document.getElementById('gallery-title').value = '';
    document.getElementById('gallery-desc').value = '';
    document.getElementById('gallery-preview-img').src = 'https://via.placeholder.com/400x400?text=Sua+Foto';
    resetGalleryImageInput();
    document.getElementById('gallery-modal').classList.remove('hidden');
    document.getElementById('gallery-modal').classList.add('flex');
}

window.updateMaxInstallmentsPreview = updateMaxInstallmentsPreview;
window.savePaymentSettings = savePaymentSettings;

function openEditGalleryModal(id) {
    const item = db.gallery.find(g => g.id == id);
    if (!item) return;
    document.getElementById('gallery-id').value = item.id;
    document.getElementById('gallery-title').value = item.title || '';
    document.getElementById('gallery-desc').value = item.description || '';
    document.getElementById('gallery-preview-img').src = item.image_url || 'https://via.placeholder.com/400x400?text=Sua+Foto';
    resetGalleryImageInput('Imagem atual mantida. Importe outra para substituir.');
    document.getElementById('gallery-modal').classList.remove('hidden');
    document.getElementById('gallery-modal').classList.add('flex');
}

function closeGalleryModal() {
    document.getElementById('gallery-modal').classList.add('hidden');
    document.getElementById('gallery-modal').classList.remove('flex');
}

async function previewGalleryImage(input) {
    const file = input.files?.[0];
    if (!file) return;

    try {
        validateImageFile(file);
        selectedGalleryImageFile = file;
        const preview = document.getElementById('gallery-preview-img');
        if (preview) preview.src = URL.createObjectURL(file);
        setImageUploadStatus('gallery', 'Imagem selecionada. Clique em Salvar para enviar.', 'success');
    } catch (error) {
        input.value = '';
        selectedGalleryImageFile = null;
        setImageUploadStatus('gallery', error.message || 'Nao foi possivel carregar a imagem.', 'error');
        showToast(error.message || 'Nao foi possivel carregar a imagem.');
    }
}

async function saveGalleryItem() {
    const id = document.getElementById('gallery-id').value;
    const title = sanitizeString(document.getElementById('gallery-title').value.trim());
    const description = sanitizeString(document.getElementById('gallery-desc').value.trim());
    const imgSrc = document.getElementById('gallery-preview-img')?.src || '';
    let imageUrlToSave = imgSrc.includes('placeholder.com') ? '' : imgSrc;

    if (!imageUrlToSave) return showToast('VocÃª precisa enviar uma foto!');

    try {
        if (selectedGalleryImageFile) {
            setImageUploadStatus('gallery', 'Enviando imagem...', 'neutral');
            imageUrlToSave = await uploadImageFile(selectedGalleryImageFile, 'gallery', id || createRandomImageId());
            setImageUploadStatus('gallery', 'Imagem enviada com sucesso.', 'success');
        } else if (imageUrlToSave.startsWith('data:image/')) {
            setImageUploadStatus('gallery', 'Enviando imagem...', 'neutral');
            imageUrlToSave = await uploadImageDataUrl(imageUrlToSave, 'gallery', id || createRandomImageId());
            setImageUploadStatus('gallery', 'Imagem enviada com sucesso.', 'success');
        }

        await getSupabaseService().saveGalleryItem({
            id,
            title,
            description,
            imageUrl: imageUrlToSave
        });

        showToast(id ? 'Foto atualizada!' : 'Nova foto adicionada ao CatÃ¡logo!');
        
        await loadGalleryData();
        closeGalleryModal();
        renderAdminGallery();
    } catch (err) {
        console.error('Erro detalhado do Supabase:', err);
        
        if (err.code === '42P01') {
            showToast('Erro: A tabela "gallery" nÃ£o foi criada no Supabase.');
        } else if (err.code === '42501') {
            showToast('Erro: RLS Bloqueando. VÃ¡ no Supabase e clique em "Disable RLS" na tabela gallery.');
        } else if (err.code === '42703') {
            showToast('Erro: O nome de alguma coluna (title, description, image_url) estÃ¡ incorreto no banco.');
        } else if (err.message && err.message.toLowerCase().includes('payload too large')) {
            showToast('Erro: A imagem escolhida Ã© muito pesada para o banco de dados.');
        } else {
            setImageUploadStatus('gallery', err.message || 'Erro ao salvar foto.', 'error');
            showToast(err.message || 'Erro desconhecido ao salvar. Pressione F12 e veja o Console.');
        }
    }
}

async function confirmDeleteGalleryItem(id) {
    if (!confirm('Deseja excluir esta foto do catÃ¡logo?')) return;
    try {
        await getSupabaseService().archiveGalleryItem(id);
        await loadGalleryData();
        renderAdminGallery();
        showToast('Foto removida do catÃ¡logo.');
    } catch (err) {
        showToast('Erro ao remover foto.');
    }
}

// ==========================================
// LOGOUT - VIA NATIVE BROWSER CONFIRM
// ==========================================
window.confirmLogout = function() {
    executarLogout();
};

window.executarLogout = async function() {
    showToast('Saindo da conta...');
    closeClientProfileModal();
    resetBookingFlowState();

    await clearSession();

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    
    const clientView = document.getElementById('client-view');
    const adminView = document.getElementById('admin-view');
    if (clientView) clientView.classList.remove('hidden');
    if (adminView) adminView.classList.add('hidden');

    if (typeof showLoginStep1 === 'function') showLoginStep1();
    if (isAdminEntryPage()) {
        showAdminLogin();
    } else if (typeof showPage === 'function') {
        showPage('page-login');
    }
    updateManuProfilePhoto();
    if (typeof showToast === 'function') showToast('VocÃª saiu da conta com sucesso.');
};

// ==========================================
// INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    const isAuthReturn = showAuthReturnLoading();

    try {
        await initSupabase();

        const didRoute = await processInitialAuth();
        if (!didRoute && !isAuthReturn) {
            showDefaultLoginPage();
        }
    } catch (error) {
        console.error('Erro ao inicializar aplicativo:', error);
        showDefaultLoginPage();
        showToast('Nao foi possivel carregar sua sessao agora. Tente novamente.');
    }
});

// ==========================================
// HELPERS
// ==========================================
function sanitizeString(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function normalizeImageUrl(url) {
    const value = String(url || '').trim();
    if (!value) return '';
    if (value.startsWith('data:image/')) return value;
    if (value.startsWith('https://') || value.startsWith('http://')) return value.replace(/["'()\\]/g, '');
    return "";
}

function showToast(message) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast fixed left-4 right-4 bottom-24 z-[9999] flex justify-center transition-all duration-300 opacity-0 translate-y-3 pointer-events-none';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.setAttribute('aria-atomic', 'true');
    const messageEl = document.createElement('div');
    messageEl.className = 'toast-message bg-[#1c1b1b] text-white px-6 py-3 rounded-xl shadow-lg text-sm font-medium';
    messageEl.textContent = message;
    toast.appendChild(messageEl);
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.remove('opacity-0', 'translate-y-3'), 10);
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-3');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
