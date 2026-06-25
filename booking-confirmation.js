(function attachBookingConfirmation() {
    async function confirmBookingFlow(options) {
        const {
            currentUser,
            selectedPaymentMethod,
            paymentAmountMode = 'deposit',
            selectedDate,
            selectedTime,
            cardPaymentData = null,
            cartItems = [],
            confirmButton = null,
            setInlineStatus,
            setButtonLoading,
            getBookedSlots,
            populateTimes,
            createBookingPayment,
            resetBookingFlowState,
            renderSuccess,
            updateBookingProgress,
            showPage,
            showToast
        } = options || {};

        if (!selectedPaymentMethod) {
            setInlineStatus?.('payment-inline-status', 'Selecione uma forma de pagamento para continuar.', 'error');
            return { ok: false, reason: 'missing-payment-method' };
        }

        if (!currentUser) {
            return { ok: false, reason: 'missing-user' };
        }

        if (!['pix', 'card', 'cash'].includes(selectedPaymentMethod)) {
            setInlineStatus?.('payment-inline-status', 'Selecione PIX, cartao ou pagamento no atendimento para continuar.', 'error');
            return { ok: false, reason: 'invalid-payment-method' };
        }

        if (selectedPaymentMethod === 'card' && !cardPaymentData?.token) {
            setInlineStatus?.('payment-inline-status', 'Preencha os dados do cartao para continuar.', 'error');
            return { ok: false, reason: 'missing-card-data' };
        }

            const totalPrice = cartItems.reduce((acc, item) => acc + (Number(item?.price) || 0), 0);
            const servicesNames = cartItems.map(service => service?.name).filter(Boolean);
            const serviceIds = cartItems.map(service => service?.id).filter(Boolean);

        try {
            setInlineStatus?.('payment-inline-status', 'Confirmando seu agendamento...', 'info');
            setButtonLoading?.(confirmButton, true, 'Confirmando...');

            const bookedSlots = await getBookedSlots(selectedDate);
            if (bookedSlots.includes(selectedTime)) {
                await populateTimes?.();
                setInlineStatus?.('payment-inline-status', 'Esse horário acabou de ser reservado. Escolha outro.', 'warning');
                setButtonLoading?.(confirmButton, false);
                return { ok: false, reason: 'slot-already-booked', selectedTime: null };
            }

            const checkout = await createBookingPayment({
                serviceIds,
                appointmentDate: selectedDate,
                appointmentTime: selectedTime,
                method: selectedPaymentMethod,
                paymentAmountMode: paymentAmountMode === 'full' ? 'full' : 'deposit',
                card: selectedPaymentMethod === 'card' ? cardPaymentData : undefined
            });

            if (checkout?.kind === 'pix') {
                setInlineStatus?.('payment-inline-status', 'PIX gerado. Pague para confirmar o horario.', 'info');
                setButtonLoading?.(confirmButton, false);
                return {
                    ok: true,
                    pendingPayment: true,
                    appointment: checkout.appointment,
                    payment: checkout.payment,
                    services: servicesNames,
                    totalPrice
                };
            }

            if (checkout?.kind === 'card' && checkout?.outcome === 'rejected') {
                setInlineStatus?.('payment-inline-status', 'Pagamento recusado. Confira os dados ou use outra forma.', 'error');
                setButtonLoading?.(confirmButton, false);
                return { ok: false, reason: 'card-rejected', payment: checkout.payment };
            }

            if (checkout?.kind === 'card' && checkout?.outcome === 'pending') {
                setInlineStatus?.('payment-inline-status', 'Pagamento em analise. Acompanhe a confirmacao pelo aplicativo.', 'warning');
            }

            const newAppointment = checkout?.appointment;
            if (!newAppointment) throw new Error('Agendamento nao retornado pelo servidor.');

            resetBookingFlowState?.();
            renderSuccess?.({
                services: servicesNames,
                price: totalPrice,
                date: selectedDate,
                time: selectedTime,
                paymentMethod: selectedPaymentMethod
            });
            updateBookingProgress?.('success');
            setInlineStatus?.('payment-inline-status', '');
            setButtonLoading?.(confirmButton, false);
            showPage?.('page-success');
            showToast?.('Agendamento realizado! A administradora será avisada pelo aplicativo.');

            return {
                ok: true,
                appointment: newAppointment,
                user: currentUser
            };
        } catch (error) {
            console.error('Erro ao confirmar:', error);
            setInlineStatus?.('payment-inline-status', 'Não foi possível confirmar o agendamento agora. Tente novamente.', 'error');
            setButtonLoading?.(confirmButton, false);
            showToast?.('Erro ao confirmar agendamento.');
            return { ok: false, reason: 'unexpected-error', error };
        }
    }

    window.bookingConfirmation = {
        confirmBookingFlow
    };
})();
