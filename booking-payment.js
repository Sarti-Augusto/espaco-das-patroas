(function attachBookingPayment() {
    function buildPaymentLinkMessage(options) {
        const {
            mode = 'signal',
            totalPrice = 0,
            paymentAmount = 0,
            serviceNames = '',
            formatCurrency
        } = options || {};

        const safeFormatCurrency = typeof formatCurrency === 'function'
            ? formatCurrency
            : value => String(value ?? 0);

        if (mode === 'signal') {
            return `Ol%C3%A1! Vim pelo Espa%C3%A7o das Patroas.%0A%0AGostaria de solicitar o link de pagamento do sinal (50%).%0A%0AServi%C3%A7o: ${serviceNames}%0AValor total: ${safeFormatCurrency(totalPrice)}%0ASinal (50%): ${safeFormatCurrency(paymentAmount)}`;
        }

        return `Ol%C3%A1! Vim pelo Espa%C3%A7o das Patroas.%0A%0AGostaria de solicitar o link de pagamento ${mode}.%0A%0AServi%C3%A7o: ${serviceNames}%0AValor a pagar: ${safeFormatCurrency(paymentAmount)}`;
    }

    function requestPaymentLink(options) {
        const {
            totalPrice = 0,
            serviceNames = '',
            formatCurrency
        } = options || {};

        const partialAmount = Number(totalPrice) / 2;
        const message = buildPaymentLinkMessage({
            mode: 'signal',
            totalPrice,
            paymentAmount: partialAmount,
            serviceNames,
            formatCurrency
        });

        window.open(`https://wa.me/5527997559191?text=${message}`, '_blank');
    }

    function requestCardPayment(options) {
        const {
            selectedPaymentMethod = 'full',
            totalPrice = 0,
            serviceNames = '',
            formatCurrency
        } = options || {};

        const partialAmount = Number(totalPrice) / 2;
        const paymentAmount = selectedPaymentMethod === '50' ? partialAmount : totalPrice;
        const paymentLabel = selectedPaymentMethod === '50' ? 'do sinal (50%)' : 'via cart%C3%A3o';
        const message = buildPaymentLinkMessage({
            mode: paymentLabel,
            totalPrice,
            paymentAmount,
            serviceNames,
            formatCurrency
        });

        window.open(`https://wa.me/5527997559191?text=${message}`, '_blank');
    }

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
        requestPaymentLink,
        requestCardPayment,
        copyTextToClipboard,
        copyPixKey,
        formatPaymentMethod,
        renderSuccess
    };
})();
