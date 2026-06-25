(function attachBookingFlow() {
    const state = {
        cart: [],
        selectedDate: null,
        selectedTime: null,
        selectedPaymentMethod: null
    };

    function getCartServiceNames() {
        return state.cart.map(service => service?.name).filter(Boolean).join(', ');
    }

    function updateCartFab(options) {
        const { onClick } = options || {};
        const fab = document.getElementById('cart-fab');
        if (!fab) return;

        if (state.cart.length > 0) {
            fab.classList.remove('hidden');
            fab.innerHTML = `<span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">shopping_bag</span><span style="position:absolute; top:-5px; right:-5px; background:#d59f9f; color:white; border-radius:50%; width:22px; height:22px; font-size:12px; display:flex; align-items:center; justify-content:center; font-weight:bold;">${state.cart.length}</span>`;
            fab.onclick = typeof onClick === 'function' ? onClick : null;
            return;
        }

        fab.classList.add('hidden');
    }

    function updateBookingProgress(step) {
        ['booking-stepper', 'payment-stepper'].forEach(containerId => {
            const container = document.getElementById(containerId);
            if (!container) return;

            container.querySelectorAll('[data-step]').forEach(item => {
                const isActive = item.dataset.step === step;
                item.classList.toggle('bg-[#7f5353]', isActive);
                item.classList.toggle('text-white', isActive);
                item.classList.toggle('bg-[#f7f3f2]', !isActive);
                item.classList.toggle('text-[#82756a]', !isActive);
            });
        });
    }

    function updateBookingSummary(options) {
        const {
            servicesLabel = 'Selecione os servicos',
            dateLabel = 'Escolha uma data',
            timeLabel = 'Escolha um horario',
            totalLabel = 'R$ 0,00'
        } = options || {};

        const servicesElement = document.getElementById('booking-summary-services');
        const dateTimeElement = document.getElementById('booking-summary-datetime');
        const totalElement = document.getElementById('booking-summary-total');

        if (servicesElement) servicesElement.textContent = servicesLabel;
        if (dateTimeElement) dateTimeElement.textContent = `${dateLabel} • ${timeLabel}`;
        if (totalElement) totalElement.textContent = totalLabel;
    }

    function updatePaymentSummaryNote(options = {}) {
        const noteElement = document.getElementById('payment-summary-note');
        if (!noteElement) return;

        const depositPercentage = Number(options.depositPercentage || 50);
        const requiresDeposit = options.requiresDeposit !== false;
        const paymentAmountMode = options.paymentAmountMode === 'full' ? 'full' : 'deposit';
        const amountLabel = paymentAmountMode === 'full' ? 'o valor integral' : `${depositPercentage}%`;

        if (!state.selectedPaymentMethod) {
            noteElement.textContent = requiresDeposit
                ? `Escolha pagar ${depositPercentage}% ou o valor integral para reservar o horario.`
                : 'Cliente recorrente: escolha como deseja confirmar o agendamento.';
            return;
        }

        const notes = {
            pix: `Pagamento via PIX de ${amountLabel} para reservar o horario.`,
            card: `Pagamento no cartao de ${amountLabel} para confirmar o agendamento.`,
            cash: 'Pagamento presencial liberado para cliente recorrente.'
        };

        noteElement.textContent = notes[state.selectedPaymentMethod] || 'Escolha a forma de pagamento para concluir o agendamento.';
    }

    function renderSelectedServices(options) {
        const {
            formatCurrency,
            normalizeImageUrl,
            placeholderUrl = 'https://via.placeholder.com/100?text=Servico'
        } = options || {};
        const listEl = document.getElementById('selected-services-list');
        if (!listEl) return;

        listEl.innerHTML = '';
        state.cart.forEach(service => {
            const rawImg = service?.image_url || service?.img || '';
            const imgSrc = typeof normalizeImageUrl === 'function' ? (normalizeImageUrl(rawImg) || placeholderUrl) : (rawImg || placeholderUrl);
            const item = document.createElement('div');
            item.className = 'flex items-center gap-3 p-4 bg-[#f7f3f2] rounded-xl';
            item.innerHTML = `<div class="h-12 w-12 rounded-lg bg-cover bg-center" style="background-image: url('${imgSrc}')"></div><div><p class="font-bold text-sm text-[#1c1b1b]">${service?.name || 'Servico'}</p><p class="text-xs text-[#50453b]">${typeof formatCurrency === 'function' ? formatCurrency(service?.price) : service?.price}</p></div>`;
            listEl.appendChild(item);
        });
    }

    function preparePaymentPage(options) {
        const {
            serviceNames = '',
            dateLabel = '',
            totalLabel = 'R$ 0,00'
        } = options || {};

        const serviceNameEl = document.getElementById('pay-service-name');
        const serviceDateEl = document.getElementById('pay-service-date');
        const servicePriceEl = document.getElementById('pay-service-price');

        if (serviceNameEl) serviceNameEl.textContent = serviceNames;
        if (serviceDateEl) serviceDateEl.textContent = dateLabel;
        if (servicePriceEl) servicePriceEl.textContent = totalLabel;

        document.getElementById('payment-pix-info')?.classList.add('hidden');
        document.getElementById('card-payment-panel')?.classList.add('hidden');
        document.getElementById('confirm-booking-button')?.classList.remove('hidden');
        document.getElementById('confirm-card-booking-button')?.classList.add('hidden');

        state.selectedPaymentMethod = null;
        document.querySelectorAll('input[name="payment"]').forEach(input => {
            input.checked = false;
        });
    }

    function updatePaymentOptions(options = {}) {
        document.getElementById('payment-pix-container')?.classList.remove('hidden');
        document.getElementById('payment-card-container')?.classList.toggle('hidden', !options.mercadoPagoPublicKey);
        document.getElementById('payment-cash-container')?.classList.toggle('hidden', !options.canPayAtAppointment);
    }

    function applyPaymentMethodUi(method) {
        state.selectedPaymentMethod = method || null;
        document.getElementById('payment-pix-info')?.classList.add('hidden');
        document.getElementById('card-payment-panel')?.classList.add('hidden');
        document.getElementById('confirm-booking-button')?.classList.remove('hidden');
        document.getElementById('confirm-card-booking-button')?.classList.add('hidden');

        const radio = document.getElementById(`payment-${method}`);
        if (radio) radio.checked = true;

        if (method === 'pix') {
            document.getElementById('payment-pix-info')?.classList.remove('hidden');
        }

        if (method === 'card') {
            document.getElementById('card-payment-panel')?.classList.remove('hidden');
            document.getElementById('confirm-booking-button')?.classList.add('hidden');
            document.getElementById('confirm-card-booking-button')?.classList.remove('hidden');
        }
    }

    window.bookingFlow = {
        state,
        getCart() {
            return state.cart;
        },
        setCart(nextCart) {
            state.cart = Array.isArray(nextCart) ? nextCart : [];
            return state.cart;
        },
        clearCart() {
            state.cart = [];
            return state.cart;
        },
        toggleCartItem(service) {
            if (!service?.id) return state.cart;

            const index = state.cart.findIndex(item => item.id == service.id);
            if (index > -1) {
                state.cart.splice(index, 1);
            } else {
                state.cart.push(service);
            }

            return state.cart;
        },
        getSelectedDate() {
            return state.selectedDate;
        },
        setSelectedDate(value) {
            state.selectedDate = value || null;
            return state.selectedDate;
        },
        getSelectedTime() {
            return state.selectedTime;
        },
        setSelectedTime(value) {
            state.selectedTime = value || null;
            return state.selectedTime;
        },
        getSelectedPaymentMethod() {
            return state.selectedPaymentMethod;
        },
        setSelectedPaymentMethod(value) {
            state.selectedPaymentMethod = value || null;
            return state.selectedPaymentMethod;
        },
        resetSelection() {
            state.selectedDate = null;
            state.selectedTime = null;
            state.selectedPaymentMethod = null;
        },
        resetAll() {
            state.cart = [];
            state.selectedDate = null;
            state.selectedTime = null;
            state.selectedPaymentMethod = null;
        },
        getCartTotal(getServicePrice) {
            return state.cart.reduce((acc, item) => acc + (typeof getServicePrice === 'function' ? getServicePrice(item) : 0), 0);
        },
        getCartServiceNames,
        updateCartFab,
        updateBookingProgress,
        updateBookingSummary,
        updatePaymentSummaryNote,
        renderSelectedServices,
        preparePaymentPage,
        updatePaymentOptions,
        applyPaymentMethodUi
    };
})();
