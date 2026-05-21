(function attachBookingSchedule() {
    let currentCalendarMonth = new Date();

    function ensureScheduleConfig(scheduleConfig) {
        const nextConfig = scheduleConfig || {};

        if (!nextConfig.start) nextConfig.start = '09:00';
        if (!nextConfig.end) nextConfig.end = '18:00';
        if (!nextConfig.availableDays) nextConfig.availableDays = [1, 2, 3, 4, 5];
        if (!nextConfig.blockedDates) nextConfig.blockedDates = [];

        nextConfig.availableDays = nextConfig.availableDays.map(Number);
        nextConfig.blockedDates = nextConfig.blockedDates.map(String);
        nextConfig.slotDuration = Number(nextConfig.slotDuration) || 3;

        return nextConfig;
    }

    function parseTimeToMinutes(timeStr) {
        const [rawHours, rawMinutes] = String(timeStr || '').split(':');
        const hours = Number(rawHours);
        const minutes = Number(rawMinutes);

        if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
        return (hours * 60) + minutes;
    }

    function formatMinutesToTime(totalMinutes) {
        const safeMinutes = Math.max(0, Number(totalMinutes) || 0);
        const hours = Math.floor(safeMinutes / 60);
        const minutes = safeMinutes % 60;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }

    function getScheduleSlotDurationMinutes(scheduleConfig) {
        const slotDurationHours = Number(scheduleConfig?.slotDuration);
        const safeDurationHours = Number.isFinite(slotDurationHours) && slotDurationHours > 0 ? slotDurationHours : 3;
        return Math.max(30, Math.round(safeDurationHours * 60));
    }

    async function getBookedSlots(options) {
        const { dateStr, supabase } = options || {};
        if (!dateStr || !supabase?.rpc) return [];

        const { data, error } = await supabase.rpc('get_booked_slots', { target_date: dateStr });
        if (error) throw error;

        return (data || []).map(slot => {
            const value = typeof slot === 'string' ? slot : slot?.appointment_time;
            return String(value || '').slice(0, 5);
        }).filter(Boolean);
    }

    function initCalendar(options) {
        const {
            scheduleConfig,
            selectedDate,
            onSelectDate,
            onPopulateTimes,
            toDateInputValue
        } = options || {};

        const container = document.getElementById('dates-container');
        const monthLabel = document.getElementById('current-month-label');
        if (!container || typeof toDateInputValue !== 'function') return;

        const safeConfig = ensureScheduleConfig(scheduleConfig);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (!currentCalendarMonth) {
            currentCalendarMonth = new Date();
        }

        const displayDate = currentCalendarMonth || today;
        const monthNames = ['Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

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
            const dateStr = toDateInputValue(currentDate);
            const dayOfWeek = currentDate.getDay();
            const isBlocked = safeConfig.blockedDates.includes(dateStr);
            const isAvailableDay = safeConfig.availableDays.includes(dayOfWeek);
            const isSelected = selectedDate === dateStr;

            const pill = document.createElement('div');
            pill.className = `flex-shrink-0 w-16 h-20 flex flex-col items-center justify-center rounded-xl border transition-all duration-150 active:scale-95 snap-center ${
                isBlocked || !isAvailableDay
                    ? 'bg-gray-100 text-gray-300 border-transparent cursor-not-allowed'
                    : isSelected
                        ? 'bg-gradient-to-br from-[#7f5353] to-[#d59f9f] text-white shadow-md cursor-pointer'
                        : 'bg-white border-gray-200 hover:border-[#7f5353] cursor-pointer'
            }`;
            pill.innerHTML = `<span class="text-[10px] font-bold uppercase">${dayAbbrev}</span><span class="text-lg font-bold">${dayNum}</span>`;

            if (!isBlocked && isAvailableDay && typeof onSelectDate === 'function') {
                pill.onclick = () => onSelectDate(dateStr, pill);
            }

            container.appendChild(pill);
        }

        if (typeof onPopulateTimes === 'function') {
            onPopulateTimes();
        }
    }

    function prevMonth(options) {
        const { onInitCalendar } = options || {};
        currentCalendarMonth = new Date(currentCalendarMonth.getFullYear(), currentCalendarMonth.getMonth() - 1, 1);
        if (typeof onInitCalendar === 'function') onInitCalendar();
    }

    function nextMonth(options) {
        const { onInitCalendar } = options || {};
        currentCalendarMonth = new Date(currentCalendarMonth.getFullYear(), currentCalendarMonth.getMonth() + 1, 1);
        if (typeof onInitCalendar === 'function') onInitCalendar();
    }

    function selectDate(options) {
        const { dateStr, element, onSelectedDateChange, onSelectedTimeChange, onClearInlineStatus, onUpdateSummary, onPopulateTimes } = options || {};

        if (typeof onSelectedDateChange === 'function') onSelectedDateChange(dateStr);
        if (typeof onSelectedTimeChange === 'function') onSelectedTimeChange(null);
        if (typeof onClearInlineStatus === 'function') onClearInlineStatus();

        document.querySelectorAll('#dates-container > div').forEach(el => {
            el.classList.remove('bg-gradient-to-br', 'from-[#7f5353]', 'to-[#d59f9f]', 'text-white', 'shadow-md');
            el.classList.add('bg-white', 'border-gray-200');
        });

        if (element) {
            element.classList.remove('bg-white', 'border-gray-200');
            element.classList.add('bg-gradient-to-br', 'from-[#7f5353]', 'to-[#d59f9f]', 'text-white', 'shadow-md');
        }

        if (typeof onUpdateSummary === 'function') onUpdateSummary();
        if (typeof onPopulateTimes === 'function') onPopulateTimes();
    }

    async function populateTimes(options) {
        const {
            selectedDate,
            scheduleConfig,
            supabase,
            onTimeSelect,
            onWarnInlineStatus
        } = options || {};

        const container = document.getElementById('times-container');
        if (!container) return;
        container.innerHTML = '';

        if (!selectedDate) {
            container.innerHTML = '<p class="col-span-3 text-center text-gray-400 text-sm">Selecione uma data para liberar os horarios.</p>';
            return;
        }

        const safeConfig = ensureScheduleConfig(scheduleConfig);
        const startMinutes = parseTimeToMinutes(safeConfig.start || '09:00');
        const endMinutes = parseTimeToMinutes(safeConfig.end || '18:00');
        const slotDurationMinutes = getScheduleSlotDurationMinutes(safeConfig);

        let bookedSlots = [];
        try {
            bookedSlots = await getBookedSlots({ dateStr: selectedDate, supabase });
        } catch (error) {
            console.error('Erro ao consultar horarios ocupados:', error);
            if (typeof onWarnInlineStatus === 'function') {
                onWarnInlineStatus('Nao foi possivel conferir os horarios agora. Tente novamente em instantes.');
            }
        }

        if (endMinutes <= startMinutes || slotDurationMinutes <= 0) {
            container.innerHTML = '<p class="col-span-3 text-center text-gray-400 text-sm">Nenhum horario configurado para esta data.</p>';
            return;
        }

        const bookedSlotsSet = new Set(bookedSlots);
        let renderedSlots = 0;

        for (let slotStartMinutes = startMinutes; slotStartMinutes + slotDurationMinutes <= endMinutes; slotStartMinutes += slotDurationMinutes) {
            const timeStr = formatMinutesToTime(slotStartMinutes);
            const isBooked = bookedSlotsSet.has(timeStr);

            const btn = document.createElement('button');
            btn.className = `py-3 px-4 rounded-xl text-sm font-medium transition-all duration-150 active:scale-95 ${
                isBooked ? 'bg-gray-100 text-gray-300 line-through cursor-not-allowed' : 'bg-white border border-gray-200 hover:bg-[#f7f3f2]'
            }`;
            btn.textContent = isBooked ? `${timeStr} (ocupado)` : timeStr;

            if (!isBooked && typeof onTimeSelect === 'function') {
                btn.onclick = () => onTimeSelect(timeStr, btn);
            }

            container.appendChild(btn);
            renderedSlots++;
        }

        if (renderedSlots === 0) {
            container.innerHTML = '<p class="col-span-3 text-center text-gray-400 text-sm">Nenhum horario disponivel nessa data. Escolha outro dia ou ajuste a agenda no painel.</p>';
        }
    }

    function selectTime(options) {
        const { time, element, onSelectedTimeChange, onClearInlineStatus, onUpdateSummary } = options || {};

        if (typeof onSelectedTimeChange === 'function') onSelectedTimeChange(time);
        if (typeof onClearInlineStatus === 'function') onClearInlineStatus();

        document.querySelectorAll('#times-container button').forEach(el => {
            el.classList.remove('bg-[#7f5353]/10', 'border-[#7f5353]', 'text-[#7f5353]', 'font-bold');
            el.classList.add('bg-white', 'border-gray-200');
        });

        if (element) {
            element.classList.remove('bg-white', 'border-gray-200');
            element.classList.add('bg-[#7f5353]/10', 'border-[#7f5353]', 'text-[#7f5353]', 'font-bold');
        }

        if (typeof onUpdateSummary === 'function') onUpdateSummary();
    }

    window.bookingSchedule = {
        initCalendar,
        prevMonth,
        nextMonth,
        selectDate,
        getBookedSlots,
        parseTimeToMinutes,
        formatMinutesToTime,
        getScheduleSlotDurationMinutes,
        populateTimes,
        selectTime
    };
})();
