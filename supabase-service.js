(function attachSupabaseService() {
    function getClient() {
        if (!window.supabase) {
            throw new Error('Supabase client not initialized.');
        }

        return window.supabase;
    }

    function buildPublicAppDataPayload(servicesData, settingsData, scheduleData, galleryData) {
        const errors = [
            { scope: 'services', error: servicesData?.error || null },
            { scope: 'settings', error: settingsData?.error || null },
            { scope: 'schedule_config', error: scheduleData?.error || null },
            { scope: 'gallery', error: galleryData?.error || null }
        ].filter(entry => entry.error);

        return {
            services: servicesData?.data || [],
            settings: settingsData?.data || [],
            scheduleRows: scheduleData?.data || [],
            gallery: galleryData?.data || [],
            errors
        };
    }

    function buildProtectedDataPayload(usersData, appointmentsData) {
        const errors = [
            { scope: 'users', error: usersData?.error || null },
            { scope: 'appointments', error: appointmentsData?.error || null }
        ].filter(entry => entry.error);

        return {
            users: usersData?.data || [],
            appointments: appointmentsData?.data || [],
            errors
        };
    }

    window.supabaseService = {
        async fetchEssentialPublicAppData() {
            const client = getClient();
            const [servicesData, settingsData, scheduleData] = await Promise.all([
                client.from('services').select('*'),
                client.from('settings').select('setting_key, setting_value').eq('setting_key', 'profileImg'),
                client.from('schedule_config').select('*').limit(1)
            ]);

            return buildPublicAppDataPayload(servicesData, settingsData, scheduleData, { data: [] });
        },

        async fetchGalleryData() {
            const client = getClient();
            const galleryData = await client
                .from('gallery')
                .select('*')
                .order('created_at', { ascending: false });

            if (galleryData.error) throw galleryData.error;
            return galleryData.data || [];
        },

        async fetchPublicAppData() {
            const client = getClient();
            const [servicesData, settingsData, scheduleData, galleryData] = await Promise.all([
                client.from('services').select('*'),
                client.from('settings').select('setting_key, setting_value').eq('setting_key', 'profileImg'),
                client.from('schedule_config').select('*').limit(1),
                client.from('gallery').select('*').order('created_at', { ascending: false })
            ]);

            return buildPublicAppDataPayload(servicesData, settingsData, scheduleData, galleryData);
        },

        async fetchProtectedData(options) {
            const client = getClient();
            const { currentUserId, isAdmin } = options || {};

            if (!currentUserId) {
                return { users: [], appointments: [] };
            }

            if (isAdmin) {
                const [usersData, appointmentsData] = await Promise.all([
                    client.from('users').select('*').order('created_at', { ascending: false }),
                    client.from('appointments').select('*').order('appointment_date', { ascending: false })
                ]);

                return buildProtectedDataPayload(usersData, appointmentsData);
            }

            const { data: appointmentsData, error } = await client
                .from('appointments')
                .select('*')
                .eq('user_id', currentUserId)
                .order('appointment_date', { ascending: false });

            if (error) throw error;

            return {
                users: [],
                appointments: appointmentsData || [],
                errors: []
            };
        },

        async updateUser(userId, updates) {
            const client = getClient();
            const { data, error } = await client.from('users').update(updates).eq('id', userId).select().single();
            if (error) throw error;
            return data;
        },

        async createAppointment(appointmentData) {
            const client = getClient();
            const { data, error } = await client.from('appointments').insert(appointmentData).select().single();
            if (error) throw error;
            return data;
        },

        async createBookingPayment(payload) {
            const client = getClient();
            const { data, error } = await client.functions.invoke('create-booking-payment', {
                body: payload
            });
            if (error) throw error;
            if (data?.error) throw new Error(data.error);
            return data;
        },

        async fetchBookingPaymentOptions() {
            const client = getClient();
            const { data, error } = await client.functions.invoke('get-booking-payment-options', {
                body: {}
            });
            if (error) throw error;
            if (data?.error) throw new Error(data.error);
            return data;
        },

        async fetchPaymentConfig() {
            const client = getClient();
            const { data, error } = await client
                .from('payment_config')
                .select('deposit_percentage, pix_expiration_minutes, allow_cash, max_installments')
                .eq('id', true)
                .single();

            if (error) throw error;
            return data;
        },

        async updatePaymentConfig(updates) {
            const client = getClient();
            const { data, error } = await client
                .from('payment_config')
                .update(updates)
                .eq('id', true)
                .select('deposit_percentage, pix_expiration_minutes, allow_cash, max_installments')
                .single();

            if (error) throw error;
            return data;
        },

        async fetchPaymentByAppointment(appointmentId) {
            const client = getClient();
            const { data, error } = await client
                .from('payments')
                .select('id, appointment_id, amount, method, status, status_detail, qr_code, qr_code_base64, ticket_url, expires_at, paid_at, updated_at')
                .eq('appointment_id', appointmentId)
                .single();
            if (error) throw error;
            return data;
        },

        async updateService(serviceId, updates) {
            const client = getClient();
            const { data, error } = await client.from('services').update(updates).eq('id', serviceId).select().single();
            if (error) throw error;
            return data;
        },

        async createService(serviceData) {
            const client = getClient();
            const { data, error } = await client.from('services').insert(serviceData).select().single();
            if (error) throw error;
            return data;
        },

        async archiveService(serviceId) {
            const client = getClient();
            const { error } = await client.from('services').update({ is_active: false }).eq('id', serviceId);
            if (error) throw error;
        },

        async saveSetting(key, value) {
            const client = getClient();
            const { data, error } = await client.from('settings').upsert({
                setting_key: key,
                setting_value: value
            }, { onConflict: 'setting_key' }).select().single();

            if (error) throw error;
            return data;
        },

        async updateScheduleConfig(config) {
            const client = getClient();
            const { data, error } = await client.from('schedule_config').update({
                start_time: config.start,
                end_time: config.end,
                slot_duration: config.slotDuration || 3,
                available_days: config.availableDays,
                blocked_dates: config.blockedDates,
                updated_at: new Date().toISOString()
            }).eq('id', '00000000-0000-0000-0000-000000000001').select().single();

            if (error) throw error;
            return data;
        },

        async upsertScheduleConfig(updates) {
            const client = getClient();
            const { data: existingData, error: fetchError } = await client.from('schedule_config').select('id').limit(1);
            if (fetchError) throw fetchError;

            if (existingData && existingData.length > 0) {
                const { error } = await client.from('schedule_config').update(updates).eq('id', existingData[0].id);
                if (error) throw error;
                return;
            }

            const { error } = await client.from('schedule_config').insert([updates]);
            if (error) throw error;
        },

        async fetchAppointments() {
            const client = getClient();
            const { data, error } = await client.from('appointments').select('*').order('appointment_date', { ascending: false });
            if (error) throw error;
            return data || [];
        },

        async fetchUpcomingConfirmedAppointments(startDate, limit = 1, includeUserPhone = false) {
            const client = getClient();
            const userFields = includeUserPhone ? 'name, phone' : 'name';
            const { data, error } = await client
                .from('appointments')
                .select(`*, users(${userFields})`)
                .eq('status', 'Confirmado')
                .gte('appointment_date', startDate)
                .order('appointment_date', { ascending: true })
                .order('appointment_time', { ascending: true })
                .limit(limit);

            if (error) throw error;
            return data || [];
        },

        async deleteUser(userId) {
            const client = getClient();
            const { error } = await client.from('users').delete().eq('id', userId);
            if (error) throw error;
        },

        async fetchAdminAppointmentsAndUsers() {
            const client = getClient();
            const [appointmentsData, usersData] = await Promise.all([
                client.from('appointments').select('*').order('appointment_date', { ascending: false }),
                client.from('users').select('*')
            ]);

            if (appointmentsData.error) throw appointmentsData.error;
            if (usersData.error) throw usersData.error;

            return {
                appointments: appointmentsData.data || [],
                users: usersData.data || []
            };
        },

        async updateAppointmentStatus(appointmentId, status) {
            const client = getClient();
            const { error } = await client.from('appointments').update({ status }).eq('id', appointmentId);
            if (error) throw error;
        },

        async saveGalleryItem(payload) {
            const client = getClient();
            const { id, title, description, imageUrl } = payload;

            if (id) {
                const { error } = await client.from('gallery').update({
                    title,
                    description,
                    image_url: imageUrl
                }).eq('id', id);
                if (error) throw error;
                return;
            }

            const { error } = await client.from('gallery').insert([{
                title,
                description,
                image_url: imageUrl,
                is_active: true
            }]);
            if (error) throw error;
        },

        async archiveGalleryItem(id) {
            const client = getClient();
            const { error } = await client.from('gallery').update({ is_active: false }).eq('id', id);
            if (error) throw error;
        }
    };
})();
