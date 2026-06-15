(function attachBookingConfirmation() {
    async function confirmBookingFlow(options) {
        const {
            currentUser,
            selectedPaymentMethod,
            selectedDate,
            selectedTime,
            cartItems = [],
            confirmButton = null,
            setInlineStatus,
            setButtonLoading,
            getBookedSlots,
            populateTimes,
            createAppointment,
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

        if (!['pix', 'cash'].includes(selectedPaymentMethod)) {
            setInlineStatus?.('payment-inline-status', 'Selecione PIX ou dinheiro para continuar.', 'error');
            return { ok: false, reason: 'invalid-payment-method' };
        }

        const totalPrice = cartItems.reduce((acc, item) => acc + (Number(item?.price) || 0), 0);
        const servicesNames = cartItems.map(service => service?.name).filter(Boolean);

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

            const newAppointment = await createAppointment({
                services: servicesNames,
                price: totalPrice,
                date: selectedDate,
                time: selectedTime,
                paymentMethod: selectedPaymentMethod,
                paymentDate: null
            });

            const nextAppointmentsCount = (currentUser.appointments_count || 0) + 1;
            const nextUser = {
                ...currentUser,
                appointments_count: nextAppointmentsCount,
                type: 'Recorrente'
            };

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
                user: nextUser
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
