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
            card: 'Cartao',
            cash: 'No atendimento',
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

    function renderPixCheckout(options) {
        const { payment, formatCurrency } = options || {};
        if (!payment) return;

        const panel = document.getElementById('pix-checkout-panel');
        const methods = document.getElementById('payment-methods-section');
        const confirmButton = document.getElementById('confirm-booking-button');
        const qrImage = document.getElementById('pix-qr-image');
        const copyCode = document.getElementById('pix-copy-code');
        const amount = document.getElementById('pix-payment-amount');
        const status = document.getElementById('pix-payment-status');

        panel?.classList.remove('hidden');
        methods?.classList.add('hidden');
        confirmButton?.classList.add('hidden');
        if (qrImage && payment.qr_code_base64) qrImage.src = `data:image/png;base64,${payment.qr_code_base64}`;
        if (copyCode) copyCode.value = payment.qr_code || '';
        if (amount) amount.textContent = typeof formatCurrency === 'function' ? formatCurrency(payment.amount) : String(payment.amount);
        if (status) status.textContent = 'Aguardando pagamento...';
    }

    function resetPixCheckoutUi() {
        document.getElementById('pix-checkout-panel')?.classList.add('hidden');
        document.getElementById('payment-methods-section')?.classList.remove('hidden');
        document.getElementById('confirm-booking-button')?.classList.remove('hidden');
        document.getElementById('pix-payment-retry')?.classList.add('hidden');
        const status = document.getElementById('pix-payment-status');
        if (status) status.textContent = 'Aguardando pagamento...';
    }

    function updatePixStatus(message, variant = 'pending') {
        const status = document.getElementById('pix-payment-status');
        if (!status) return;
        status.textContent = message;
        status.classList.remove('text-amber-700', 'text-emerald-700', 'text-red-600');
        status.classList.add(variant === 'approved' ? 'text-emerald-700' : variant === 'error' ? 'text-red-600' : 'text-amber-700');
    }

    let activeCardForm = null;
    let mercadoPagoSdkPromise = null;
    const MERCADO_PAGO_SDK_URL = 'https://sdk.mercadopago.com/js/v2';

    function describeSdkError(error) {
        return error instanceof Error ? error.message : String(error || 'erro desconhecido');
    }

    function setCardStatus(message, variant = 'info') {
        const status = document.getElementById('card-payment-status');
        if (!status) return;
        status.textContent = message || '';
        status.classList.toggle('hidden', !message);
        status.classList.remove('text-amber-700', 'text-emerald-700', 'text-red-600', 'text-[#50453b]');
        status.classList.add(
            variant === 'error' ? 'text-red-600' :
            variant === 'approved' ? 'text-emerald-700' :
            variant === 'warning' ? 'text-amber-700' :
            'text-[#50453b]'
        );
    }

    function loadMercadoPagoSdkByScript() {
        return new Promise((resolve, reject) => {
            document.querySelectorAll(`script[src^="${MERCADO_PAGO_SDK_URL}"]`).forEach(script => script.remove());

            const script = document.createElement('script');
            const timeout = window.setTimeout(() => {
                script.remove();
                reject(new Error('timeout-script'));
            }, 12000);

            script.onload = () => {
                window.clearTimeout(timeout);
                if (window.MercadoPago) {
                    resolve(window.MercadoPago);
                    return;
                }
                script.remove();
                reject(new Error('script-loaded-without-sdk'));
            };
            script.onerror = () => {
                window.clearTimeout(timeout);
                script.remove();
                reject(new Error('script-onerror'));
            };

            script.src = `${MERCADO_PAGO_SDK_URL}?t=${Date.now()}`;
            script.async = true;
            script.dataset.mercadoPagoSdk = 'true';
            document.head.appendChild(script);
        });
    }

    async function loadMercadoPagoSdkByFetch() {
        const response = await fetch(`${MERCADO_PAGO_SDK_URL}?fallback=${Date.now()}`, {
            cache: 'no-store',
            mode: 'cors'
        });
        if (!response.ok) throw new Error(`fetch-http-${response.status}`);

        const code = await response.text();
        const script = document.createElement('script');
        script.dataset.mercadoPagoSdkFallback = 'true';
        script.text = `${code}\n//# sourceURL=mercadopago-sdk-inline.js`;
        document.head.appendChild(script);

        if (!window.MercadoPago) throw new Error('fetch-loaded-without-sdk');
        return window.MercadoPago;
    }

    async function loadMercadoPagoSdk() {
        if (window.MercadoPago) return Promise.resolve(window.MercadoPago);
        if (mercadoPagoSdkPromise) return mercadoPagoSdkPromise;

        mercadoPagoSdkPromise = loadMercadoPagoSdkByScript()
            .catch(async scriptError => {
                console.warn('Mercado Pago SDK script load failed, trying fetch fallback:', scriptError);
                try {
                    return await loadMercadoPagoSdkByFetch();
                } catch (fetchError) {
                    throw new Error(`script:${describeSdkError(scriptError)}; fetch:${describeSdkError(fetchError)}`);
                }
            })
            .catch(error => {
            mercadoPagoSdkPromise = null;
            throw error;
        });

        return mercadoPagoSdkPromise;
    }

    function cardSecureFramesMounted() {
        return ['form-checkout__cardNumber', 'form-checkout__expirationDate', 'form-checkout__securityCode']
            .every(id => Boolean(document.getElementById(id)?.querySelector('iframe')));
    }

    async function initializeCardForm(options = {}) {
        const {
            publicKey,
            amount,
            email = '',
            maxInstallments = 1,
            onSubmit
        } = options;

        if (!publicKey) {
            setCardStatus('Pagamento por cartao indisponivel no momento.', 'error');
            return null;
        }

        let MercadoPagoSdk = null;
        try {
            setCardStatus('Carregando formulario do cartao...', 'info');
            MercadoPagoSdk = await loadMercadoPagoSdk();
        } catch (error) {
            console.error('Mercado Pago SDK unavailable:', error);
            setCardStatus(`Nao foi possivel carregar o pagamento por cartao. Erro tecnico: ${describeSdkError(error)}.`, 'error');
            return null;
        }

        if (activeCardForm?.unmount) {
            activeCardForm.unmount();
        }

        const emailInput = document.getElementById('form-checkout__cardholderEmail');
        if (emailInput && email && !emailInput.value) emailInput.value = email;

        const mp = new MercadoPagoSdk(publicKey, { locale: 'pt-BR' });
        activeCardForm = mp.cardForm({
            amount: String(amount || 0),
            iframe: true,
            form: {
                id: 'card-payment-form',
                cardNumber: { id: 'form-checkout__cardNumber', placeholder: 'Numero do cartao' },
                expirationDate: { id: 'form-checkout__expirationDate', placeholder: 'MM/AA' },
                securityCode: { id: 'form-checkout__securityCode', placeholder: 'CVV' },
                cardholderName: { id: 'form-checkout__cardholderName', placeholder: 'Nome impresso no cartao' },
                issuer: { id: 'form-checkout__issuer', placeholder: 'Banco emissor' },
                installments: { id: 'form-checkout__installments', placeholder: 'Parcelas' },
                identificationType: { id: 'form-checkout__identificationType', placeholder: 'Tipo de documento' },
                identificationNumber: { id: 'form-checkout__identificationNumber', placeholder: 'Numero do documento' },
                cardholderEmail: { id: 'form-checkout__cardholderEmail', placeholder: 'E-mail' }
            },
            callbacks: {
                onFormMounted: error => {
                    if (error) {
                        setCardStatus('Nao foi possivel carregar o formulario do cartao.', 'error');
                        return;
                    }
                    setCardStatus(cardSecureFramesMounted() ? '' : 'Carregando campos seguros do cartao...', 'info');
                    window.setTimeout(() => {
                        if (cardSecureFramesMounted()) setCardStatus('');
                    }, 800);
                },
                onSubmit: event => {
                    event.preventDefault();
                    const data = activeCardForm.getCardFormData();
                    const installments = Math.min(Number(data.installments || 1), Number(maxInstallments || 1));
                    if (!data.token || !data.paymentMethodId) {
                        setCardStatus('Confira os dados do cartao para continuar.', 'error');
                        return;
                    }
                    if (typeof onSubmit === 'function') {
                        onSubmit({
                            token: data.token,
                            paymentMethodId: data.paymentMethodId,
                            issuerId: data.issuerId,
                            installments,
                            identificationType: data.identificationType,
                            identificationNumber: data.identificationNumber
                        });
                    }
                },
                onFetching: () => {
                    setCardStatus('Validando dados do cartao...', 'info');
                    return () => setCardStatus('');
                }
            }
        });

        return activeCardForm;
    }

    window.bookingPayment = {
        copyTextToClipboard,
        copyPixKey,
        formatPaymentMethod,
        renderSuccess,
        renderPixCheckout,
        resetPixCheckoutUi,
        updatePixStatus,
        initializeCardForm,
        setCardStatus
    };
})();
