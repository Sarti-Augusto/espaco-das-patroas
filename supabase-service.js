(function attachSupabaseService() {
    function getClient() {
        if (!window.supabase) {
            throw new Error('Supabase client not initialized.');
        }

        return window.supabase;
    }

    window.supabaseService = {
        async fetchPublicAppData() {
            const client = getClient();
            const [servicesData, settingsData, scheduleData, galleryData] = await Promise.all([
                client.from('services').select('*'),
                client.from('settings').select('*'),
                client.from('schedule_config').select('*').limit(1),
                client.from('gallery').select('*').order('created_at', { ascending: false })
            ]);

            return {
                services: servicesData.data || [],
                settings: settingsData.data || [],
                scheduleRows: scheduleData.data || [],
                gallery: galleryData.data || []
            };
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

                return {
                    users: usersData.data || [],
                    appointments: appointmentsData.data || []
                };
            }

            const { data: appointmentsData } = await client
                .from('appointments')
                .select('*')
                .eq('user_id', currentUserId)
                .order('appointment_date', { ascending: false });

            return {
                users: [],
                appointments: appointmentsData || []
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
