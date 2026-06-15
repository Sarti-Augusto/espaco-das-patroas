(function attachBookingPayment() {
    async function copyTextToClipboard(text) {
        if (navigator.clipboard?.writeText && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }

        const input = document.createElement('input');
        input.value = text;
        input.setAttribute('readonly', '');
        input.style.position = 'fixed';
        input.style.left = '-9999px';
        document.body.appendChild(input);
        input.select();
        input.setSelectionRange(0, input.value.length);

        try {
            return document.execCommand?.('copy') === true;
        } finally {
            input.remove();
        }
    }

    async function copyPixKey(options) {
        const {
            pixKey = '27997559191',
            showToast
        } = options || {};

        try {
            const copied = await copyTextToClipboard(pixKey);
            if (typeof showToast === 'function') {
                showToast(copied ? `Chave PIX copiada: ${pixKey}` : `Nao foi possivel copiar. Chave PIX: ${pixKey}`);
            }
        } catch (error) {
            if (typeof showToast === 'function') {
                showToast(`Nao foi possivel copiar. Chave PIX: ${pixKey}`);
            }
        }
    }

    function formatPaymentMethod(method) {
        const map = {
            pix: 'PIX',
            cash: 'Dinheiro',
            '50': '50% (Sinal)',
            'full': 'Antecipado',
            'store': 'Na Loja',
            'scheduled': 'Programado'
        };

        return map[method] || method;
    }

    function renderSuccess(options) {
        const {
            appointment,
            formatDate,
            formatCurrency
        } = options || {};

        if (!appointment) return;

        const safeFormatDate = typeof formatDate === 'function' ? formatDate : value => value;
        const safeFormatCurrency = typeof formatCurrency === 'function' ? formatCurrency : value => String(value ?? 0);

        const dateEl = document.getElementById('success-date');
        const timeEl = document.getElementById('success-time');
        const servicesEl = document.getElementById('success-services-list');
        const priceEl = document.getElementById('success-price');
        const paymentEl = document.getElementById('success-payment-method');

        if (dateEl) dateEl.textContent = safeFormatDate(appointment.date);
        if (timeEl) timeEl.textContent = appointment.time;
        if (servicesEl) servicesEl.textContent = (appointment.services || []).join(', ');
        if (priceEl) priceEl.textContent = safeFormatCurrency(appointment.price);
        if (paymentEl) paymentEl.textContent = `Pagamento: ${formatPaymentMethod(appointment.paymentMethod)}`;
    }

    window.bookingPayment = {
        copyTextToClipboard,
        copyPixKey,
        formatPaymentMethod,
        renderSuccess
    };
})();
