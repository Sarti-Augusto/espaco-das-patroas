// ==========================================
// SUPABASE CONFIGURATION
// ==========================================
const SUPABASE_URL = 'https://ujidqagyllheibmuuboy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqaWRxYWd5bGxoZWlibXV1Ym95Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5NzM2NTUsImV4cCI6MjA5MTU0OTY1NX0.lHX5WB9WCY_pEgXcN4hvve3Pi5xqJgITbESrxiO3Nwk';

let db = {
    users: [],
    services: [],
    settings: { profileImg: "" },
    appointmentsCache: [],
    scheduleConfig: { start: "09:00", end: "18:00", slotDuration: 3, availableDays: [1, 2, 3, 4, 5], blockedDates: [] },
    gallery: [], // Catálogo de unhas
    currentUser: null,
    isAdmin: false
};
let isDbLoaded = false;

async function initSupabase() {
    try {
        window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        await loadAllData();
        isDbLoaded = true;
        console.log('Supabase conectado!');
        updateManuProfilePhoto();
    } catch (error) {
        console.error('Erro ao conectar com Supabase:', error);
    }
}

async function loadAllData() {
    try {
        const [usersData, servicesData, settingsData, scheduleData, appointmentsData, galleryData] = await Promise.all([
            window.supabase.from('users').select('*'),
            window.supabase.from('services').select('*'),
            window.supabase.from('settings').select('*'),
            window.supabase.from('schedule_config').select('*').limit(1),
            window.supabase.from('appointments').select('*').order('appointment_date', { ascending: false }),
            window.supabase.from('gallery').select('*').order('created_at', { ascending: false }) // Busca o catálogo
        ]);

        db.users = usersData.data || [];
        db.services = (servicesData.data || []).filter(s => s.is_active === true || s.is_active === 'true');
        db.settings = { profileImg: "" };
        db.appointmentsCache = appointmentsData.data || [];
        db.gallery = (galleryData.data || []).filter(g => g.is_active === true || g.is_active === 'true');
        
        db.scheduleConfig = { start: "09:00", end: "18:00", slotDuration: 3, availableDays: [1, 2, 3, 4, 5], blockedDates: [] };

        if (settingsData.data && settingsData.data.length > 0) {
            const profileSetting = settingsData.data.find(s => s.setting_key === 'profileImg');
            if (profileSetting && profileSetting.setting_value) db.settings.profileImg = profileSetting.setting_value;
        }

        if (scheduleData.data && scheduleData.data.length > 0) {
            db.scheduleConfig = {
                start: scheduleData.data[0].start_time || "09:00",
                end: scheduleData.data[0].end_time || "18:00",
                slotDuration: scheduleData.data[0].slot_duration || 3,
                availableDays: scheduleData.data[0].available_days || [1, 2, 3, 4, 5],
                blockedDates: scheduleData.data[0].blocked_dates || []
            };
        }

        const savedUserId = localStorage.getItem('espacoPatroas_currentUser');
        if (savedUserId) {
            db.currentUser = db.users.find(u => u.id === savedUserId);
            if (db.currentUser) {
                db.isAdmin = db.currentUser.email === ADMIN_EMAIL;
            }
        }
    } catch (error) {
        console.error('Erro ao carregar dados:', error);
    }
}

function saveSession() {
    if (db.currentUser) {
        localStorage.setItem('espacoPatroas_currentUser', db.currentUser.id);
    }
}

function clearSession() {
    localStorage.removeItem('espacoPatroas_currentUser');
    db.currentUser = null;
    db.isAdmin = false;
}

// ==========================================
// SUPABASE FUNCTIONS
// ==========================================

async function supabaseLogin(email) {
    let user = db.users.find(u => u.email === email);
    
    if (!user) {
        const { data, error } = await window.supabase.from('users').insert({
            name: '',
            email: email,
            type: 'Novo',
            status: 'ok',
            appointments_count: 0
        }).select().single();

        if (error) throw error;
        user = data;
        db.users.push(user);
    }

    db.currentUser = user;
    db.isAdmin = user.email === ADMIN_EMAIL;
    saveSession();

    return user;
}

async function supabaseUpdateUser(userId, updates) {
    const { data, error } = await window.supabase.from('users').update(updates).eq('id', userId).select().single();
    if (error) throw error;
    
    const index = db.users.findIndex(u => u.id === userId);
    if (index !== -1) db.users[index] = data;
    
    if (db.currentUser?.id === userId) {
        db.currentUser = data;
    }
    
    return data;
}

async function supabaseCreateAppointment(appointmentData) {
    const { data, error } = await window.supabase.from('appointments').insert({
        user_id: db.currentUser.id,
        services_names: appointmentData.services,
        price: appointmentData.price,
        appointment_date: appointmentData.date,
        appointment_time: appointmentData.time,
        payment_method: appointmentData.paymentMethod,
        payment_status: 'Pendente',
        payment_date: appointmentData.paymentDate || null,
        status: 'Confirmado'
    }).select().single();

    if (error) throw error;
    return data;
}

async function supabaseUpdateService(serviceId, updates) {
    const { data, error } = await window.supabase.from('services').update(updates).eq('id', serviceId).select().single();
    if (error) throw error;
    
    const index = db.services.findIndex(s => s.id === serviceId);
    if (index !== -1) db.services[index] = data;
    
    return data;
}

async function supabaseCreateService(serviceData) {
    const { data, error } = await window.supabase.from('services').insert({
        name: serviceData.name,
        description: serviceData.desc,
        price: serviceData.price,
        image_url: serviceData.img || '',
        is_active: true
    }).select().single();

    if (error) throw error;
    db.services.push(data);
    return data;
}

async function supabaseDeleteService(serviceId) {
    const { error } = await window.supabase.from('services').update({ is_active: false }).eq('id', serviceId);
    if (error) throw error;
    
    db.services = db.services.filter(s => s.id !== serviceId);
}

async function supabaseSaveSettings(key, value) {
    const { data, error } = await window.supabase.from('settings').upsert({
        setting_key: key,
        setting_value: value
    }, { onConflict: 'setting_key' }).select().single();

    if (error) throw error;
    return data;
}

async function supabaseSaveScheduleConfig(config) {
    const { data, error } = await window.supabase.from('schedule_config').update({
        start_time: config.start,
        end_time: config.end,
        slot_duration: config.slotDuration || 3,
        available_days: config.availableDays,
        blocked_dates: config.blockedDates,
        updated_at: new Date().toISOString()
    }).eq('id', '00000000-0000-0000-0000-000000000001').select().single();

    if (error) throw error;
    return data;
}

async function supabaseGetAppointments() {
    const { data, error } = await window.supabase.from('appointments').select('*').order('appointment_date', { ascending: false });
    if (error) throw error;
    return data || [];
}

// ==========================================
// AUTO-LOGIN
// ==========================================
function checkAutoLogin() {
    if (!isDbLoaded) return false;
    
    const savedUserId = localStorage.getItem('espacoPatroas_currentUser');
    if (savedUserId) {
        const user = db.users.find(u => u.id === savedUserId);
        if (user) {
            db.currentUser = user;
            db.isAdmin = user.email === ADMIN_EMAIL;
            updateManuProfilePhoto();
            const userNameEl = document.getElementById('user-name-display');
            if (userNameEl && user.name) userNameEl.textContent = user.name.split(' ')[0];
            renderServices();
            updateCartFab();
            showPage('page-home');
            updateBottomNav('home');
            showToast(`Bem-vinda de volta, ${user.name?.split(' ')[0] || ''}!`);
            return true;
        }
    }
    return false;
}

// ==========================================
// VARIABLES
// ==========================================
let cart = [];
let selectedDate = null;
let selectedTime = null;
let selectedPaymentMethod = null;
let currentAgendaMonth = new Date();
let agendaView = 'month'; // 'month', 'week', 'day'
let allAppointmentsCache = []; // Cache de agendamentos para o calendário admin
let currentCalendarMonth = new Date();

const ADMIN_EMAIL = 'emanuelysarti02@gmail.com';

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
    // Reseta todos os botões do menu inferior do cliente
    const allNavs = document.querySelectorAll('[id^="nav-home"], [id^="nav-gallery"], [id^="nav-appointments"]');
    allNavs.forEach(el => {
        el.classList.remove('bg-gradient-to-br', 'from-[#7f5353]', 'to-[#d59f9f]', 'text-white');
        el.classList.add('text-[#7f5353]/60');
        const icon = el.querySelector('.material-symbols-outlined');
        if(icon) icon.style.fontVariationSettings = "'FILL' 0";
    });

    // Ativa apenas a aba clicada
    const activeNavs = document.querySelectorAll(`[id^="nav-${activeTab}"]`);
    activeNavs.forEach(el => {
        el.classList.remove('text-[#7f5353]/60');
        el.classList.add('bg-gradient-to-br', 'from-[#7f5353]', 'to-[#d59f9f]', 'text-white');
        const icon = el.querySelector('.material-symbols-outlined');
        if(icon) icon.style.fontVariationSettings = "'FILL' 1";
    });
}

function switchToAdminView() {
    hideAllPages();
    document.getElementById('client-view').classList.add('hidden');
    document.getElementById('admin-view').classList.remove('hidden');
    updateManuProfilePhoto();
    renderAdminDashboard();
    showAdminSection('clients');
}

function toggleAdminMenu() {
    const menu = document.getElementById('admin-mobile-menu');
    if (menu) {
        menu.classList.toggle('hidden');
    }
}

function switchToClientView() {
    document.getElementById('admin-view').classList.add('hidden');
    document.getElementById('client-view').classList.remove('hidden');
    cart = [];
    clearSession();
    showLoginStep1();
    showPage('page-login');
}

function goToHome() {
    if (!db.currentUser) {
        showPage('page-login');
        return;
    }
    cart = [];
    selectedDate = null;
    selectedTime = null;
    selectedPaymentMethod = null;
    hideAllPages();
    document.getElementById('page-home').classList.add('active');
    renderServices();
    updateCartFab();
    updateBottomNav('home');
    window.scrollTo(0, 0);
}

function goToMyAppointments() {
    if (!db.currentUser) {
        showPage('page-login');
        return;
    }
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
function handleLoginStep1() {
    const emailInput = document.getElementById('input-login-email');
    const email = sanitizeString(emailInput.value.trim()).toLowerCase();

    if (!email) {
        showToast("Digite seu email.");
        return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        showToast("Digite um email válido.");
        return;
    }

    const btn = document.getElementById('btn-login-step1');
    btn.textContent = 'Aguarde...';

    loadAllData().then(() => {
        return supabaseLogin(email);
    }).then(user => {
        btn.textContent = 'Entrar';

        if (user.email === ADMIN_EMAIL) {
            db.isAdmin = true;
            saveSession();
            switchToAdminView();
            return;
        }

        db.currentUser = user;
        db.isAdmin = false;
        saveSession();

        updateManuProfilePhoto();

        // Verifica se precisa completar cadastro
        if (!user.name || !user.phone || user.name.trim() === '' || user.phone.trim() === '') {
            document.getElementById('input-login-name').value = user.name || '';
            document.getElementById('input-login-phone').value = user.phone || '';
            showLoginStep2();
            return;
        }

        const userNameEl = document.getElementById('user-name-display');
        if (userNameEl) userNameEl.textContent = user.name.split(' ')[0];
        renderServices();
        updateCartFab();
        showPage('page-home');
        updateBottomNav('home');
        showToast(`Bem-vinda!`);
    }).catch(error => {
        btn.textContent = 'Entrar';
        console.error('Erro no login:', error);
        showToast('Erro ao fazer login. Tente novamente.');
    });
}

function showLoginStep1(email) {
    document.getElementById('login-form-step1').classList.remove('hidden');
    document.getElementById('login-form-step2').classList.add('hidden');
    
    if (email) {
        document.getElementById('input-login-email').value = email;
    }
    
    const existingUser = db.users.find(u => u.email === email);
    const btnText = existingUser && existingUser.name ? 'Entrar' : 'Cadastrar';
    document.getElementById('btn-login-step1').textContent = btnText;
}

function showLoginStep2() {
    document.getElementById('login-form-step1').classList.add('hidden');
    document.getElementById('login-form-step2').classList.remove('hidden');
    document.getElementById('input-login-name').value = '';
    document.getElementById('input-login-phone').value = '';
    document.getElementById('input-login-name').focus();
}

async function handleLogin() {
    const nameInput = document.getElementById('input-login-name');
    const emailInput = document.getElementById('input-login-email');
    const phoneInput = document.getElementById('input-login-phone');

    const name = sanitizeString(nameInput.value.trim());
    const email = sanitizeString(emailInput.value.trim()).toLowerCase();
    const phone = phoneInput.value.replace(/\D/g, '');

    if (!name || !phone) {
        showToast("Complete seu cadastro.");
        return;
    }

    if (phone.length < 10) {
        showToast("Digite um telefone válido com DDD.");
        return;
    }

    try {
        const user = await supabaseUpdateUser(db.currentUser.id, { name, phone });
        db.currentUser = user;

        saveSession();
        updateManuProfilePhoto();
        const userNameEl = document.getElementById('user-name-display');
        if (userNameEl) userNameEl.textContent = name.split(' ')[0];
        renderServices();
        updateCartFab();
        showPage('page-home');
        updateBottomNav('home');
        showToast(`Bem-vinda, ${name.split(' ')[0]}!`);
    } catch (error) {
        console.error('Erro ao salvar:', error);
        showToast('Erro ao salvar dados.');
    }
}

function goToLogin() {
    clearSession();
    updateManuProfilePhoto();
    showLoginStep1();
    showPage('page-login');
}

function updateManuProfilePhoto() {
    const src = db.settings.profileImg || 'https://via.placeholder.com/150?text=Manu+Sarti';
    const pics = ['main-profile-pic', 'home-profile-pic', 'admin-avatar', 'admin-settings-photo', 'login-profile-pic'];
    pics.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.src = src;
    });
}

// ==========================================
// SERVICES
// ==========================================
function renderServices() {
    const container = document.getElementById('services-container');
    if (!container) return;
    container.innerHTML = '';

    if (!db.services || db.services.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-400 col-span-3">Nenhum serviço disponível.</p>';
        return;
    }

    db.services.forEach(s => {
        const isInCart = cart.some(item => item.id === s.id);
        const imgSrc = s.image_url || s.img || '';
        const displayImg = imgSrc || 'https://via.placeholder.com/400x300?text=Serviço';
        
        const card = document.createElement('div');
        card.className = 'group bg-white rounded-xl overflow-hidden shadow-sm transition-all active:scale-[0.98] border border-gray-100';
        card.innerHTML = `
            <div class="aspect-[16/10] overflow-hidden bg-gray-50">
                <img src="${displayImg}" alt="${s.name}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" onerror="this.src='https://via.placeholder.com/400x300?text=Serviço'">
            </div>
            <div class="p-6">
                <div class="flex justify-between items-start mb-4">
                    <div><h4 class="font-bold text-lg text-[#1c1b1b]">${s.name}</h4><p class="text-[#50453b] text-sm mt-1">${s.description || s.desc || 'Serviço premium'}</p></div>
                    <span class="font-extrabold text-[#7f5353]">${formatCurrency(s.price)}</span>
                </div>
                <button onclick="toggleCart('${s.id}')" class="w-full py-3 ${isInCart ? 'bg-green-500' : 'bg-gradient-to-br from-[#7f5353] to-[#d59f9f]'} text-white font-bold text-xs uppercase tracking-widest rounded-xl active:scale-95 transition-transform">
                    ${isInCart ? '✓ Adicionado' : 'Agendar'}
                </button>
            </div>`;
        container.appendChild(card);
    });
    updateCartFab();
}

function toggleCart(id) {
    if (!db.currentUser) {
        showToast("Faça login para agendar.");
        showPage('page-login');
        return;
    }
    
    const service = db.services.find(s => s.id == id);
    if (!service) return;
    
    const index = cart.findIndex(item => item.id == id);
    if (index > -1) {
        cart.splice(index, 1);
    } else {
        cart.push(service);
    }
    renderServices();
}

function updateCartFab() {
    const fab = document.getElementById('cart-fab');
    if (!fab) return;
    if (cart.length > 0) {
        fab.classList.remove('hidden');
        fab.innerHTML = `<span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">shopping_bag</span><span style="position:absolute; top:-5px; right:-5px; background:#d59f9f; color:white; border-radius:50%; width:22px; height:22px; font-size:12px; display:flex; align-items:center; justify-content:center; font-weight:bold;">${cart.length}</span>`;
        fab.onclick = proceedToBooking;
    } else {
        fab.classList.add('hidden');
    }
}

// ==========================================
// BOOKING
// ==========================================
function proceedToBooking() {
    if (cart.length === 0) {
        showToast("Adicione serviços.");
        return;
    }

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
                db.isAdmin = user.email === ADMIN_EMAIL;
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
                        db.isAdmin = user.email === ADMIN_EMAIL;
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

    if (db.currentUser.status === 'pendente') {
        if (alertContainer) { alertContainer.classList.remove('hidden'); alertContainer.classList.add('flex'); }
        if (mainContent) mainContent.classList.add('opacity-30', 'pointer-events-none');
        if (bottomBtn) bottomBtn.classList.add('hidden');
    } else {
        if (alertContainer) { alertContainer.classList.add('hidden'); alertContainer.classList.remove('flex'); }
        if (mainContent) mainContent.classList.remove('opacity-30', 'pointer-events-none');
        if (bottomBtn) bottomBtn.classList.remove('hidden');

        const listEl = document.getElementById('selected-services-list');
        if (listEl) {
            listEl.innerHTML = '';
            cart.forEach(s => {
                const imgSrc = s.image_url || s.img || 'https://via.placeholder.com/100';
                const item = document.createElement('div');
                item.className = 'flex items-center gap-3 p-4 bg-[#f7f3f2] rounded-xl';
                item.innerHTML = `<div class="h-12 w-12 rounded-lg bg-cover bg-center" style="background-image: url('${imgSrc}')"></div><div><p class="font-bold text-sm text-[#1c1b1b]">${s.name}</p><p class="text-xs text-[#50453b]">${formatCurrency(s.price)}</p></div>`;
                listEl.appendChild(item);
            });
        }
        initCalendar();
        showPage('page-booking');
    }
}

function initCalendar() {
    const container = document.getElementById('dates-container');
    const monthLabel = document.getElementById('current-month-label');
    if (!container) return;

    if (!db.scheduleConfig) db.scheduleConfig = { start: "09:00", end: "18:00", availableDays: [1, 2, 3, 4, 5], blockedDates: [] };
    if (!db.scheduleConfig.blockedDates) db.scheduleConfig.blockedDates = [];
    if (!db.scheduleConfig.availableDays) db.scheduleConfig.availableDays = [1, 2, 3, 4, 5];

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const displayDate = currentCalendarMonth || today;
    const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

    if (monthLabel) monthLabel.textContent = `${monthNames[displayDate.getMonth()]} ${displayDate.getFullYear()}`;
    container.innerHTML = '';

    container.classList.add('snap-x', 'snap-mandatory', 'scroll-smooth');

    const firstDay = new Date(displayDate.getFullYear(), displayDate.getMonth(), 1);
    const lastDay = new Date(displayDate.getFullYear(), displayDate.getMonth() + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay();

    for (let i = 0; i < startDayOfWeek; i++) {
        const empty = document.createElement('div');
        empty.className = 'flex-shrink-0 w-16 h-20 snap-center';
        container.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const currentDate = new Date(displayDate.getFullYear(), displayDate.getMonth(), day);
        currentDate.setHours(0, 0, 0, 0);

        if (currentDate < today) {
            const empty = document.createElement('div');
            empty.className = 'flex-shrink-0 w-16 h-20 flex items-center justify-center snap-center';
            empty.innerHTML = `<span class="text-lg font-bold text-gray-200">${day}</span>`;
            container.appendChild(empty);
            continue;
        }

        const dayAbbrev = currentDate.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').toUpperCase();
        const dayNum = currentDate.getDate();
        const dateStr = currentDate.toISOString().split('T')[0];
        const dayOfWeek = currentDate.getDay();

        const isBlocked = db.scheduleConfig.blockedDates.includes(dateStr);
        const isAvailableDay = db.scheduleConfig.availableDays.includes(dayOfWeek);

        const pill = document.createElement('div');
        pill.className = `flex-shrink-0 w-16 h-20 flex flex-col items-center justify-center rounded-xl border transition-all duration-150 active:scale-95 snap-center cursor-pointer ${
            isBlocked || !isAvailableDay ? 'bg-gray-100 text-gray-300 border-transparent cursor-not-allowed' : 'bg-white border-gray-200 hover:border-[#7f5353]'
        }`;
        pill.innerHTML = `<span class="text-[10px] font-bold uppercase">${dayAbbrev}</span><span class="text-lg font-bold">${dayNum}</span>`;

        if (!isBlocked && isAvailableDay) {
            pill.onclick = () => selectDate(dateStr, pill);
        }
        container.appendChild(pill);
    }
    populateTimes();
}

function prevMonth() {
    currentCalendarMonth = new Date(currentCalendarMonth.getFullYear(), currentCalendarMonth.getMonth() - 1, 1);
    initCalendar();
}

function nextMonth() {
    currentCalendarMonth = new Date(currentCalendarMonth.getFullYear(), currentCalendarMonth.getMonth() + 1, 1);
    initCalendar();
}

function selectDate(dateStr, element) {
    selectedDate = dateStr;
    document.querySelectorAll('#dates-container > div').forEach(el => {
        el.classList.remove('bg-gradient-to-br', 'from-[#7f5353]', 'to-[#d59f9f]', 'text-white', 'shadow-md');
        el.classList.add('bg-white', 'border-gray-200');
    });
    element.classList.remove('bg-white', 'border-gray-200');
    element.classList.add('bg-gradient-to-br', 'from-[#7f5353]', 'to-[#d59f9f]', 'text-white', 'shadow-md');
    populateTimes();
}

function populateTimes() {
    const container = document.getElementById('times-container');
    if (!container) return;
    container.innerHTML = '';

    if (!selectedDate) {
        container.innerHTML = '<p class="col-span-3 text-center text-gray-400 text-sm">Selecione uma data</p>';
        return;
    }

    const start = parseInt(db.scheduleConfig.start.split(':')[0]);
    const end = parseInt(db.scheduleConfig.end.split(':')[0]);
    const slotDuration = db.scheduleConfig.slotDuration || 3;

    const dayAppointments = db.appointmentsCache?.filter(a => a.appointment_date === selectedDate) || [];

    for (let h = start; h < end; h += slotDuration) {
        const timeStr = `${h.toString().padStart(2, '0')}:00`;
        const isBooked = dayAppointments.some(a => a.appointment_time === timeStr);

        const btn = document.createElement('button');
        btn.className = `py-3 px-4 rounded-xl text-sm font-medium transition-all duration-150 active:scale-95 ${isBooked ? 'bg-gray-100 text-gray-300 line-through cursor-not-allowed' : 'bg-white border border-gray-200 hover:bg-[#f7f3f2]'}`;
        btn.textContent = isBooked ? `${timeStr} (ocupado)` : timeStr;
        if (!isBooked) {
            btn.onclick = () => selectTime(timeStr, btn);
        }
        container.appendChild(btn);
    }
}

function selectTime(time, element) {
    selectedTime = time;
    document.querySelectorAll('#times-container button').forEach(el => {
        el.classList.remove('bg-[#7f5353]/10', 'border-[#7f5353]', 'text-[#7f5353]', 'font-bold');
        el.classList.add('bg-white', 'border-gray-200');
    });
    element.classList.remove('bg-white', 'border-gray-200');
    element.classList.add('bg-[#7f5353]/10', 'border-[#7f5353]', 'text-[#7f5353]', 'font-bold');
}

// ==========================================
// PAYMENT
// ==========================================
function goToPayment() {
    if (!selectedDate || !selectedTime) {
        showToast("Selecione data e horário.");
        return;
    }

    if (!db.currentUser) {
        showPage('page-login');
        return;
    }

    const totalPrice = cart.reduce((acc, item) => acc + item.price, 0);

    const serviceNames = cart.map(s => s.name).join(', ');
    document.getElementById('pay-service-name').textContent = serviceNames;
    document.getElementById('pay-service-date').textContent = `${formatDate(selectedDate)} às ${selectedTime}`;
    document.getElementById('pay-service-price').textContent = formatCurrency(totalPrice);

    const payment50Container = document.getElementById('payment-50-container');
    if (payment50Container) {
        if (db.currentUser && (db.currentUser.type === 'Novo' || db.currentUser.appointments_count === 0)) {
            payment50Container.classList.remove('hidden');
        } else {
            payment50Container.classList.add('hidden');
        }
    }

    document.getElementById('payment-50-info')?.classList.add('hidden');
    document.getElementById('payment-full-info')?.classList.add('hidden');
    document.getElementById('scheduled-date-container')?.classList.add('hidden');

    const payInput = document.getElementById('input-pay-date');
    const today = new Date();
    const max = new Date();
    max.setDate(today.getDate() + 20);

    if (payInput) {
        payInput.min = today.toISOString().split('T')[0];
        payInput.max = max.toISOString().split('T')[0];
        payInput.value = '';
    }

    selectedPaymentMethod = null;
    showPage('page-payment');
}

function selectPaymentMethod(method) {
    selectedPaymentMethod = method;

    document.getElementById('payment-50-info')?.classList.add('hidden');
    document.getElementById('payment-full-info')?.classList.add('hidden');
    document.getElementById('scheduled-date-container')?.classList.add('hidden');

    const radio = document.getElementById('payment-' + method);
    if (radio) radio.checked = true;

    if (method === '50') {
        document.getElementById('payment-50-info')?.classList.remove('hidden');
    } else if (method === 'full') {
        document.getElementById('payment-full-info')?.classList.remove('hidden');
    } else if (method === 'scheduled') {
        const dateContainer = document.getElementById('scheduled-date-container');
        if (dateContainer) dateContainer.classList.remove('hidden');
    }
}

function requestPaymentLink() {
    const totalPrice = cart.reduce((acc, item) => acc + item.price, 0);
    const signal = (totalPrice / 2).toFixed(2);
    const services = cart.map(s => s.name).join(', ');

    let message = `Olá! Vim pelo Espaço das Patroas.%0A%0AGostaria de solicitar o link de pagamento do sinal (50%).%0A%0AServiço: ${services}%0AValor total: ${formatCurrency(totalPrice)}%0ASinal (50%): ${formatCurrency(parseFloat(signal))}`;
    window.open(`https://wa.me/5527997559191?text=${message}`, '_blank');
}

function requestCardPayment() {
    const totalPrice = cart.reduce((acc, item) => acc + item.price, 0);
    const services = cart.map(s => s.name).join(', ');

    let message = `Olá! Vim pelo Espaço das Patroas.%0A%0AGostaria de solicitar o link de pagamento via cartão.%0A%0AServiço: ${services}%0AValor total: ${formatCurrency(totalPrice)}`;
    window.open(`https://wa.me/5527997559191?text=${message}`, '_blank');
}

function copyPixKey() {
    navigator.clipboard.writeText('27997559191').then(() => {
        showToast('Chave PIX copiada!');
    }).catch(() => {
        showToast('Erro ao copiar.');
    });
}

async function confirmBooking() {
    if (!selectedPaymentMethod) {
        showToast("Selecione uma forma de pagamento.");
        return;
    }

    if (!db.currentUser) {
        showPage('page-login');
        return;
    }

    let paymentDate = null;
    if (selectedPaymentMethod === 'scheduled') {
        paymentDate = document.getElementById('input-pay-date').value;
        if (!paymentDate) {
            showToast("Selecione a data para o pagamento programado.");
            return;
        }
    }

    const totalPrice = cart.reduce((acc, item) => acc + item.price, 0);

    try {
        const newAppointment = await supabaseCreateAppointment({
            services: cart.map(s => s.name),
            price: totalPrice,
            date: selectedDate,
            time: selectedTime,
            paymentMethod: selectedPaymentMethod,
            paymentDate: paymentDate
        });

        addToGoogleCalendar(newAppointment);

        await supabaseUpdateUser(db.currentUser.id, {
            appointments_count: (db.currentUser.appointments_count || 0) + 1,
            type: 'Recorrente'
        });

        const servicesNames = cart.map(s => s.name);
        cart = [];
        renderSuccess({
            services: servicesNames,
            price: totalPrice,
            date: selectedDate,
            time: selectedTime,
            paymentMethod: selectedPaymentMethod
        });
        showPage('page-success');
        showToast('Agendamento realizado! Verifique o Google Calendar.');
    } catch (error) {
        console.error('Erro ao confirmar:', error);
        showToast('Erro ao confirmar agendamento.');
    }
}

function renderSuccess(app) {
    document.getElementById('success-date').textContent = formatDate(app.date);
    document.getElementById('success-time').textContent = app.time;
    document.getElementById('success-services-list').textContent = app.services.join(', ');
    document.getElementById('success-price').textContent = formatCurrency(app.price);
    document.getElementById('success-payment-method').textContent = `Pagamento: ${formatPaymentMethod(app.paymentMethod)}`;
}

function formatPaymentMethod(method) {
    const map = { '50': '50% (Sinal)', 'full': 'Antecipado', 'store': 'Na Loja', 'scheduled': 'Programado' };
    return map[method] || method;
}

function formatCurrency(value) {
    return `R$ ${parseFloat(value).toFixed(2).replace('.', ',')}`;
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

// ==========================================
// MY APPOINTMENTS
// ==========================================
async function renderMyAppointments() {
    const container = document.getElementById('my-appointments-list');
    if (!container) return;

    if (!db.currentUser) {
        container.innerHTML = '<p class="text-center text-gray-400">Faça login para ver seus agendamentos.</p>';
        return;
    }

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
                    <p class="text-sm text-[#50453b]">Você ainda não tem agendamentos marcados.</p>
                </div>`;
            return;
        }

        container.innerHTML = data.map(app => {
            const statusColors = {
                'Confirmado': 'bg-emerald-100 text-emerald-700',
                'Pendente': 'bg-amber-100 text-amber-700',
                'Concluído': 'bg-gray-100 text-gray-600',
                'Cancelado': 'bg-red-100 text-red-600'
            };
            const statusColor = statusColors[app.status] || 'bg-gray-100 text-gray-600';
            const paymentColor = app.payment_status === 'Pago' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700';

            return `
                <div class="bg-white rounded-xl p-5 shadow-sm border border-[#d4c4b7]/10">
                    <div class="flex justify-between items-start mb-3">
                        <div>
                            <p class="font-headline font-bold text-[#1c1b1b]">${app.services_names}</p>
                            <p class="text-xs text-[#50453b] mt-1">${formatDate(app.appointment_date)} às ${app.appointment_time}</p>
                        </div>
                        <span class="px-3 py-1 ${statusColor} text-[10px] font-bold uppercase rounded-full">${app.status}</span>
                    </div>
                    <div class="pt-3 border-t border-[#d4c4b7]/10">
                        <p class="text-xs text-[#50453b]">Valor: <span class="font-bold text-[#7f5353]">${formatCurrency(app.price)}</span></p>
                        <p class="text-[10px] ${paymentColor} mt-1 px-2 py-0.5 rounded-full inline-block">Pagamento: ${app.payment_status}</p>
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
    document.querySelectorAll('.adm-section').forEach(s => s.classList.add('hidden'));
    const el = document.getElementById(`adm-${section}`);
    if (el) el.classList.remove('hidden');

    const titles = { clients: 'Gestão de Clientes', schedule: 'Agenda', portfolio: 'Serviços', gallery: 'Catálogo', settings: 'Configurações' };
    const titleEl = document.getElementById('admin-page-title');
    if (titleEl) titleEl.textContent = titles[section] || 'Admin';

    document.querySelectorAll('.adm-nav-link').forEach(link => {
        link.classList.remove('text-[#7f5353]', 'font-extrabold', 'border-r-4', 'border-[#7f5353]', 'bg-[#f7f3f2]');
        link.classList.add('text-stone-500');
    });

    const currentLink = document.querySelector(`.adm-nav-link[onclick="showAdminSection('${section}')"]`) || document.querySelector(`.adm-nav-link[onclick="showAdminSection('${section}'); toggleAdminMenu();"]`);
    if (currentLink) {
        currentLink.classList.remove('text-stone-500');
        currentLink.classList.add('text-[#7f5353]', 'font-extrabold', 'border-r-4', 'border-[#7f5353]', 'bg-[#f7f3f2]');
    }

    if (section === 'clients') { renderAdminDashboard(); renderAdminClients(); }
    else if (section === 'schedule') { renderAdminSchedule(); renderAdminAppointments(); renderNextAppointmentCard(); }
    else if (section === 'portfolio') renderServicesGridAdmin();
    else if (section === 'gallery') renderAdminGallery();
    else if (section === 'settings') renderAdminSettings();
}

// ==========================================
// ADMIN DASHBOARD
// ==========================================
async function renderAdminDashboard() {
    await loadAllData();
    const concluidos = db.appointmentsCache.filter(a => a.status !== 'Cancelado').length;
    const recorrentes = db.users.filter(u => db.appointmentsCache.filter(a => a.user_id === u.id).length > 1).length;
    const taxaRetorno = db.users.length > 0 ? Math.round((recorrentes / db.users.length) * 100) : 0;

    document.getElementById('stat-total').textContent = concluidos;
    document.getElementById('stat-return').textContent = taxaRetorno + '%';
    renderNextAppointmentCard();
}

async function renderNextAppointmentCard() {
    const hojeStr = new Date().toISOString().split('T')[0];
    const { data: proximos } = await window.supabase.from('appointments')
        .select('*, users(name)')
        .eq('status', 'Confirmado')
        .gte('appointment_date', hojeStr)
        .order('appointment_date', { ascending: true })
        .order('appointment_time', { ascending: true })
        .limit(1);

    const infoEl = document.getElementById('next-appointment-info');
    if (proximos && proximos.length > 0) {
        const app = proximos[0];
        infoEl.textContent = `${app.appointment_time} - ${app.users?.name || 'Cliente'}`;
        document.getElementById('next-appointment-service').textContent = app.services_names;
    } else {
        infoEl.textContent = 'Nenhum agendamento hoje';
    }
}

async function showNextAppointmentDetails() {
    const hojeStr = new Date().toISOString().split('T')[0];

    try {
        const { data: proximos, error } = await window.supabase.from('appointments')
            .select('*, users(name, phone)')
            .eq('status', 'Confirmado')
            .gte('appointment_date', hojeStr)
            .order('appointment_date', { ascending: true })
            .order('appointment_time', { ascending: true })
            .limit(1);

        if (error) throw error;

        if (proximos && proximos.length > 0) {
            const app = proximos[0];
            const clientName = app.users?.name || 'Cliente não identificado';
            const clientPhone = app.users?.phone || 'Telefone não cadastrado';
            const dataFormatada = formatDate(app.appointment_date);
            
            const detalhes = `📅 DETALHES DO PRÓXIMO AGENDAMENTO\n\n` +
                             `👤 Cliente: ${clientName}\n` +
                             `📱 Telefone: ${clientPhone}\n` +
                             `💅 Serviço: ${app.services_names}\n` +
                             `🕒 Data: ${dataFormatada} às ${app.appointment_time}\n` +
                             `💰 Valor: ${formatCurrency(app.price)}\n` +
                             `💳 Pagamento: ${app.payment_status}`;
            
            alert(detalhes);
        } else {
            alert('Não há agendamentos próximos confirmados para exibir.');
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
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8">Carregando...</td></tr>';

    try {
        const [usersResult, appointmentsResult] = await Promise.all([
            window.supabase.from('users').select('*').order('created_at', { ascending: false }),
            window.supabase.from('appointments').select('*').order('appointment_date', { ascending: false })
        ]);

        if (usersResult.error) throw usersResult.error;

        const users = usersResult.data || [];
        const allAppointments = appointmentsResult.data || [];

        const appointmentsByUser = {};
        allAppointments.forEach(app => {
            if (!appointmentsByUser[app.user_id]) {
                appointmentsByUser[app.user_id] = [];
            }
            appointmentsByUser[app.user_id].push(app);
        });

        tbody.innerHTML = '';

        for (const u of users) {
            const userAppointments = appointmentsByUser[u.id] || [];
            const lastApp = userAppointments.sort((a, b) => new Date(b.appointment_date) - new Date(a.appointment_date))[0];
            const totalAppts = userAppointments.length;

            const statusClass = u.status === 'pendente' ? 'text-error' : 'text-emerald-600';
            const statusDotClass = u.status === 'pendente' ? 'bg-error' : 'bg-emerald-500';
            const profileImg = u.profile_image_url || 'https://via.placeholder.com/40';

            const tr = document.createElement('tr');
            tr.className = "group hover:bg-[#f7f3f2]/50 transition-colors";
            tr.innerHTML = `
                <td class="px-8 py-5 border-t border-[#d4c4b7]/5">
                    <div class="flex items-center gap-4">
                        <img src="${profileImg}" class="w-10 h-10 rounded-full object-cover">
                        <div class="flex flex-col">
                            <span class="font-bold text-[#1c1b1b]">${u.name || 'Sem nome'}</span>
                            <span class="text-xs text-stone-400">${u.email}</span>
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
                    <span class="text-stone-500 font-medium">${lastApp?.services_names || '-'}</span>
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
    } catch (error) {
        console.error('Erro ao carregar clientes:', error);
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-red-400">Erro ao carregar clientes</td></tr>';
    }
}

async function updateUserStatus(userId, newStatus) {
    try {
        await supabaseUpdateUser(userId, { status: newStatus });
        showToast(`Status atualizado.`);
    } catch (error) {
        showToast('Erro ao atualizar.');
    }
}

async function updateUserType(userId, newType) {
    try {
        await supabaseUpdateUser(userId, { type: newType });
        showToast(`Cliente classificado como ${newType}.`);
    } catch (error) {
        showToast('Erro ao atualizar.');
    }
}

async function deleteUser(userId) {
    if (!confirm('Tem certeza que deseja excluir este cliente? Esta ação não pode ser desfeita.')) return;
    try {
        await window.supabase.from('users').delete().eq('id', userId);
        db.users = db.users.filter(u => u.id !== userId);
        renderAdminClients();
        showToast('Cliente excluído.');
    } catch (error) {
        showToast('Erro ao excluir cliente.');
    }
}

// ==========================================
// ADMIN SCHEDULE E APPOINTMENTS
// ==========================================
async function renderAdminAppointments() {
    const tbody = document.getElementById('appointments-table-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8">Carregando...</td></tr>';

    try {
        const { data: appointments } = await window.supabase.from('appointments').select('*').order('appointment_date', { ascending: false });
        const { data: users } = await window.supabase.from('users').select('*');

        if (!appointments || appointments.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-400">Nenhum agendamento encontrado.</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        for (const app of appointments) {
            const user = users?.find(u => u.id === app.user_id);
            const statusColors = {
                'Confirmado': 'bg-emerald-100 text-emerald-700',
                'Pendente': 'bg-amber-100 text-amber-700',
                'Concluído': 'bg-gray-100 text-gray-600',
                'Cancelado': 'bg-red-100 text-red-600'
            };
            const statusColor = statusColors[app.status] || 'bg-gray-100 text-gray-600';

            const tr = document.createElement('tr');
            tr.className = "hover:bg-[#f7f3f2]/50 transition-colors";
            tr.innerHTML = `
                <td class="px-4 py-3 border-t border-[#d4c4b7]/5">
                    <span class="font-medium text-[#1c1b1b]">${user?.name || 'Cliente'}</span>
                    <div class="text-xs text-stone-400">${user?.email || '-'}</div>
                </td>
                <td class="px-4 py-3 border-t border-[#d4c4b7]/5 text-sm">${app.services_names}</td>
                <td class="px-4 py-3 border-t border-[#d4c4b7]/5 text-sm">${formatDate(app.appointment_date)}</td>
                <td class="px-4 py-3 border-t border-[#d4c4b7]/5 text-sm">${app.appointment_time}</td>
                <td class="px-4 py-3 border-t border-[#d4c4b7]/5">
                    <span class="px-2 py-1 ${statusColor} text-[10px] font-bold uppercase rounded-full">${app.status}</span>
                </td>
                <td class="px-4 py-3 border-t border-[#d4c4b7]/5">
                    <select onchange="updateAppointmentStatus('${app.id}', this.value)" class="bg-transparent border border-stone-200 rounded-lg px-2 py-1 text-xs cursor-pointer">
                        <option value="Confirmado" ${app.status === 'Confirmado' ? 'selected' : ''}>Confirmado</option>
                        <option value="Concluído" ${app.status === 'Concluído' ? 'selected' : ''}>Concluído</option>
                        <option value="Cancelado" ${app.status === 'Cancelado' ? 'selected' : ''}>Cancelado</option>
                    </select>
                </td>`;
            tbody.appendChild(tr);
        }
    } catch (error) {
        console.error('Erro ao carregar agendamentos:', error);
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-red-400">Erro ao carregar</td></tr>';
    }
}

async function updateAppointmentStatus(appointmentId, newStatus) {
    try {
        const appointment = db.appointmentsCache.find(a => a.id === appointmentId);
        await window.supabase.from('appointments').update({ status: newStatus }).eq('id', appointmentId);

        const idx = db.appointmentsCache.findIndex(a => a.id === appointmentId);
        if (idx !== -1) db.appointmentsCache[idx].status = newStatus;

        if (newStatus === 'Cancelado' && appointment) {
            removeFromGoogleCalendar(appointment);
        } else {
            showToast('Status atualizado!');
        }
    } catch (error) {
        showToast('Erro ao atualizar.');
    }
}

function searchAppointments() {
    const searchTerm = document.getElementById('search-appointments')?.value.toLowerCase() || '';
    const rows = document.querySelectorAll('#appointments-table-body tr');
    
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(searchTerm) ? '' : 'none';
    });
}

function renderAdminSchedule() {
    if (!db.scheduleConfig) db.scheduleConfig = { start: "09:00", end: "18:00", availableDays: [1, 2, 3, 4, 5], blockedDates: [] };

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

    loadAppointmentsForCalendar();
    renderAgendaCalendar();
    updateAgendaMonthLabel();
}

async function loadAppointmentsForCalendar() {
    try {
        const { data } = await window.supabase.from('appointments').select('*').order('appointment_date', { ascending: false });
        allAppointmentsCache = data || [];
    } catch (error) {
        allAppointmentsCache = [];
    }
}

function renderAgendaCalendar() {
    const grid = document.getElementById('agenda-calendar-grid');
    if (!grid) return;

    grid.innerHTML = '';
    const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
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
        const dateStr = currentDate.toISOString().split('T')[0];
        const dayAppointments = monthAppointments.filter(a => a.appointment_date === dateStr);
        const isToday = currentDate.getTime() === today.getTime();
        const isBlocked = db.scheduleConfig.blockedDates?.includes(dateStr);
        const isPast = currentDate < today;

        const cell = document.createElement('div');
        cell.className = `h-24 border-r border-b border-[#d4c4b7]/10 p-2 ${isToday ? 'bg-[#d59f9f]/10' : 'bg-white'} ${isBlocked ? 'opacity-50' : ''} ${isPast ? 'opacity-40' : ''}`;
        
        let appointmentsHtml = '';
        dayAppointments.slice(0, 2).forEach(app => {
            appointmentsHtml += `<div class="text-[10px] bg-primary/10 text-primary rounded px-1 py-0.5 mb-1 truncate">${app.appointment_time} - ${app.services_names?.split(',')[0] || 'Serviço'}</div>`;
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
        const appDate = new Date(app.appointment_date);
        return appDate.getFullYear() === year && appDate.getMonth() === month;
    });
}

function updateAgendaMonthLabel() {
    const label = document.getElementById('agenda-month-label');
    if (!label) return;
    const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
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
            slot_duration: parseInt(document.getElementById('config-slot-duration').value) || 3,
            available_days: selectedDays.length > 0 ? selectedDays : [1, 2, 3, 4, 5], 
            blocked_dates: db.scheduleConfig.blockedDates || []
        };

        const { data: existingData, error: fetchError } = await window.supabase.from('schedule_config').select('id').limit(1);
        if (fetchError) throw fetchError;

        if (existingData && existingData.length > 0) {
            const { error } = await window.supabase.from('schedule_config').update(updates).eq('id', existingData[0].id);
            if (error) throw error;
        } else {
            const { error } = await window.supabase.from('schedule_config').insert([updates]);
            if (error) throw error;
        }

        db.scheduleConfig = { ...db.scheduleConfig, ...updates };
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

        const imgSrc = s.image_url || s.img || '';
        const displayImg = imgSrc || 'https://via.placeholder.com/400x400?text=Serviço';

        card.innerHTML = `
            <div class="aspect-square w-full overflow-hidden bg-[#ebe7e7] relative">
                <img src="${displayImg}" alt="${s.name}" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" onerror="this.src='https://via.placeholder.com/400x400?text=Serviço'">
            </div>
            <div class="p-6 flex-1 flex flex-col">
                <h3 class="font-headline text-lg font-bold text-[#1c1b1b] mb-2">${s.name}</h3>
                <p class="font-body text-sm text-stone-500 leading-relaxed mb-4 flex-1">${s.description || ''}</p>
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
    document.getElementById('service-preview-img').src = 'https://via.placeholder.com/400x400?text=Serviço';
    document.getElementById('service-modal').classList.remove('hidden');
    document.getElementById('service-modal').classList.add('flex');
}

function openEditServiceModal(id) {
    const service = db.services.find(s => s.id == id);
    if (!service) return;

    const imgSrc = service.image_url || service.img || 'https://via.placeholder.com/400x400?text=Serviço';

    document.getElementById('service-id').value = service.id;
    document.getElementById('service-name').value = service.name;
    document.getElementById('service-desc').value = service.description || service.desc || '';
    document.getElementById('service-price').value = service.price;
    document.getElementById('service-preview-img').src = imgSrc;
    document.getElementById('service-modal').classList.remove('hidden');
    document.getElementById('service-modal').classList.add('flex');
}

function closeServiceModal() {
    document.getElementById('service-modal').classList.add('hidden');
    document.getElementById('service-modal').classList.remove('flex');
}

function previewServiceImage(input) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        if (file.size > 5 * 1024 * 1024) {
            showToast('Imagem muito grande. Máximo 5MB.');
            return;
        }
        const reader = new FileReader();
        reader.onload = function(e) {
            const preview = document.getElementById('service-preview-img');
            if (preview) preview.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }
}

async function saveService() {
    const id = document.getElementById('service-id').value;
    const name = sanitizeString(document.getElementById('service-name').value.trim());
    const desc = sanitizeString(document.getElementById('service-desc').value.trim());
    const price = parseFloat(document.getElementById('service-price').value);
    const imgSrc = document.getElementById('service-preview-img')?.src || '';

    const isPlaceholder = imgSrc.includes('placeholder.com') || !imgSrc;
    const imageUrlToSave = isPlaceholder ? '' : imgSrc;

    if (!name) {
        showToast('Digite o nome do serviço.');
        return;
    }
    if (isNaN(price) || price < 0) {
        showToast('Digite um preço válido.');
        return;
    }

    try {
        if (id) {
            await supabaseUpdateService(id, { name, description: desc, price, image_url: imageUrlToSave });
            showToast('Serviço atualizado!');
        } else {
            await supabaseCreateService({ name, desc, price, img: imageUrlToSave });
            showToast('Novo serviço adicionado!');
        }

        await loadAllData();
        closeServiceModal();
        renderServicesGridAdmin();
        renderServices();
    } catch (error) {
        console.error('Erro ao salvar:', error);
        showToast('Erro ao salvar serviço.');
    }
}

async function confirmDeleteService(id) {
    if (!confirm('Tem certeza que deseja excluir este serviço?')) return;
    try {
        await supabaseDeleteService(id);
        await loadAllData();
        renderServicesGridAdmin();
        renderServices();
        showToast('Serviço removido.');
    } catch (error) {
        showToast('Erro ao remover.');
    }
}

// ==========================================
// ADMIN SETTINGS
// ==========================================
function renderAdminSettings() {
    const el = document.getElementById('admin-settings-photo');
    if (el) el.src = db.settings.profileImg || 'https://via.placeholder.com/150';
}

function handleProfileImageUpload(input) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        if (!file.type.startsWith('image/')) {
            showToast('Selecione um arquivo de imagem.');
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            showToast('Imagem muito grande. Máximo 5MB.');
            return;
        }

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
        container.innerHTML = '<p class="text-center text-stone-400 col-span-2 py-10">O catálogo está sendo atualizado com novas fotos. Volte em breve!</p>';
        return;
    }

    db.gallery.forEach(g => {
        const imgSrc = g.image_url || 'https://via.placeholder.com/400x500?text=Foto';
        const card = document.createElement('div');
        card.className = 'rounded-2xl overflow-hidden shadow-sm relative group bg-white border border-[#d4c4b7]/20 aspect-[4/5]';
        card.innerHTML = `
            <img src="${imgSrc}" class="w-full h-full object-cover" alt="${g.title}">
            <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent flex flex-col justify-end p-3">
                <h4 class="text-white font-bold text-xs shadow-black">${g.title || 'Inspiração'}</h4>
                <p class="text-white/80 text-[10px] truncate">${g.description || ''}</p>
            </div>
        `;
        container.appendChild(card);
    });
}

function renderAdminGallery() {
    const container = document.getElementById('admin-gallery-grid');
    if (!container) return;
    container.innerHTML = '';

    db.gallery.forEach(g => {
        const imgSrc = g.image_url || 'https://via.placeholder.com/400x400?text=Foto';
        const card = document.createElement('div');
        card.className = 'bg-[#f1edec] rounded-2xl overflow-hidden group hover:shadow-lg transition-all duration-300 flex flex-col relative';
        card.innerHTML = `
            <div class="aspect-square w-full overflow-hidden">
                <img src="${imgSrc}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">
            </div>
            <div class="p-4 bg-white flex justify-between items-center border-t border-[#d4c4b7]/20">
                <div class="overflow-hidden">
                    <h3 class="font-bold text-sm text-[#1c1b1b] truncate">${g.title || 'Sem título'}</h3>
                    <p class="text-[10px] text-stone-500 truncate">${g.description || ''}</p>
                </div>
                <div class="flex gap-1 ml-2">
                    <button onclick="openEditGalleryModal('${g.id}')" class="p-1.5 text-stone-400 hover:text-primary transition-colors bg-[#f7f3f2] rounded-lg">
                        <span class="material-symbols-outlined text-[18px]">edit</span>
                    </button>
                    <button onclick="confirmDeleteGalleryItem('${g.id}')" class="p-1.5 text-stone-400 hover:text-red-500 transition-colors bg-[#f7f3f2] rounded-lg">
                        <span class="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                </div>
            </div>`;
        container.appendChild(card);
    });
}

function openAddGalleryModal() {
    document.getElementById('gallery-id').value = '';
    document.getElementById('gallery-title').value = '';
    document.getElementById('gallery-desc').value = '';
    document.getElementById('gallery-preview-img').src = 'https://via.placeholder.com/400x400?text=Sua+Foto';
    document.getElementById('gallery-modal').classList.remove('hidden');
    document.getElementById('gallery-modal').classList.add('flex');
}

function openEditGalleryModal(id) {
    const item = db.gallery.find(g => g.id == id);
    if (!item) return;
    document.getElementById('gallery-id').value = item.id;
    document.getElementById('gallery-title').value = item.title || '';
    document.getElementById('gallery-desc').value = item.description || '';
    document.getElementById('gallery-preview-img').src = item.image_url || 'https://via.placeholder.com/400x400?text=Sua+Foto';
    document.getElementById('gallery-modal').classList.remove('hidden');
    document.getElementById('gallery-modal').classList.add('flex');
}

function closeGalleryModal() {
    document.getElementById('gallery-modal').classList.add('hidden');
    document.getElementById('gallery-modal').classList.remove('flex');
}

function previewGalleryImage(input) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        if (file.size > 5 * 1024 * 1024) return showToast('Imagem muito grande. Máximo 5MB.');
        const reader = new FileReader();
        reader.onload = e => document.getElementById('gallery-preview-img').src = e.target.result;
        reader.readAsDataURL(file);
    }
}

async function saveGalleryItem() {
    const id = document.getElementById('gallery-id').value;
    const title = sanitizeString(document.getElementById('gallery-title').value.trim());
    const description = sanitizeString(document.getElementById('gallery-desc').value.trim());
    const imgSrc = document.getElementById('gallery-preview-img')?.src || '';
    const imageUrlToSave = imgSrc.includes('placeholder.com') ? '' : imgSrc;

    if (!imageUrlToSave) return showToast('Você precisa enviar uma foto!');

    try {
        if (id) {
            await window.supabase.from('gallery').update({ title, description, image_url: imageUrlToSave }).eq('id', id);
            showToast('Foto atualizada!');
        } else {
            await window.supabase.from('gallery').insert({ title, description, image_url: imageUrlToSave, is_active: true });
            showToast('Nova foto adicionada ao Catálogo!');
        }
        await loadAllData();
        closeGalleryModal();
        renderAdminGallery();
    } catch (err) {
        showToast('Erro ao salvar foto.');
    }
}

async function confirmDeleteGalleryItem(id) {
    if (!confirm('Deseja excluir esta foto do catálogo?')) return;
    try {
        await window.supabase.from('gallery').update({ is_active: false }).eq('id', id);
        await loadAllData();
        renderAdminGallery();
        showToast('Foto removida do catálogo.');
    } catch (err) {
        showToast('Erro ao remover foto.');
    }
}

// ==========================================
// LOGOUT - VIA NATIVE BROWSER CONFIRM
// ==========================================
window.confirmLogout = function() {
    const wantsToLogOut = window.confirm("Sair da conta?\n\nVocê será desconectado e precisará fazer login novamente.");
    if (wantsToLogOut) {
        executarLogout();
    }
};

window.executarLogout = function() {
    // Limpa dados de sessão
    clearSession();
    cart = [];

    // Oculta todas as páginas
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    
    // Oculta o Admin e exibe o Client View
    const clientView = document.getElementById('client-view');
    const adminView = document.getElementById('admin-view');
    if (clientView) clientView.classList.remove('hidden');
    if (adminView) adminView.classList.add('hidden');

    // Redireciona para o login
    if (typeof showLoginStep1 === 'function') showLoginStep1();
    if (typeof showPage === 'function') showPage('page-login');
    if (typeof showToast === 'function') showToast('Você saiu da conta com sucesso.');
};

// ==========================================
// INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    await initSupabase();
    hideAllPages();

    // Pequeno delay para garantir que DB carregou
    setTimeout(() => {
        if (!checkAutoLogin()) {
            const loginPage = document.getElementById('page-login');
            if (loginPage) loginPage.classList.add('active');
        }
    }, 500);
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

// ==========================================
// GOOGLE CALENDAR INTEGRATION
// ==========================================
function generateGoogleCalendarUrl(appointment) {
    const title = encodeURIComponent(`Espaço das Patroas - ${appointment.services_names}`);
    const dateStr = appointment.appointment_date.replace(/-/g, '');
    const startTime = appointment.appointment_time.replace(':', '') + '00';
    const endHour = parseInt(appointment.appointment_time.split(':')[0]) + 3;
    const endTime = `${endHour.toString().padStart(2, '0')}${appointment.appointment_time.split(':')[1]}00`;
    const start = `${dateStr}T${startTime}`;
    const end = `${dateStr}T${endTime}`;
    const details = encodeURIComponent(`Cliente: ${appointment.client_name || 'Cliente'}\nServiço: ${appointment.services_names}\nValor: R$ ${appointment.price}\nPagamento: ${appointment.payment_status || 'Pendente'}`);
    const location = encodeURIComponent('Espaço das Patroas');
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}&location=${location}`;
}

function addToGoogleCalendar(appointment) {
    const url = generateGoogleCalendarUrl(appointment);
    window.open(url, '_blank');
}

function removeFromGoogleCalendar(appointment) {
    showToast('Agendamento cancelado. Remova manualmente do Google Calendar se foi adicionado.');
}

function showToast(message) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<div class="toast-message bg-[#1c1b1b] text-white px-6 py-3 rounded-xl shadow-lg text-sm font-medium">${message}</div>`;
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}