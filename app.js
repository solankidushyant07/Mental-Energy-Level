class EnergyApp {
    constructor() {
        this.db = new DataManager();
        this.graph = new GraphEngine(this.db);

        this.currentDate = new Date();
        this.toastTimeout = null;

        this.energyLabels = {
            1: 'Very Low',
            2: 'Low',
            3: 'Normal',
            4: 'High',
            5: 'Peak'
        };

        /*
         * Manual locks are deliberately stored separately from the existing
         * mental-energy data structure.
         *
         * Existing data remains:
         * {
         *     "YYYY-MM-DD": {
         *         "hour": value
         *     }
         * }
         *
         * The lock state does not alter that structure.
         */
        this.lockStorageKey = 'mentalEnergyHourLocks_v1';

        this.activeSummaryType = 'Day';
        this.summaryDateOffset = 0;

        this.init();
    }

    async init() {
        // Wait for IndexedDB migration/loading before the first render.
        await this.db.ready;

        this.setupTheme();
        this.setupNav();
        this.setupMenu();
        this.setupFileImport();
        this.setupScrollEffects();

        /*
         * Watch the real clock so the rolling 24-hour window advances while
         * the app is open. The app does not need to rerender every second.
         */
        this.startClockWatcher();

        this.render();

        setTimeout(() => this.scrollToCurrent(false), 50);
    }

    /*
     * The timeline is based on whole hours.
     *
     * If the app is open at 6:59 PM and becomes 7:00 PM, the next render
     * automatically makes 7 PM the current hour and moves the 24-hour
     * editing window forward by one hour.
     */
    startClockWatcher() {
        let lastHourKey = this.getRealHourKey();

        this.clockWatcher = setInterval(() => {
            const nextHourKey = this.getRealHourKey();

            if (nextHourKey === lastHourKey) {
                return;
            }

            lastHourKey = nextHourKey;

            // Only today's timeline follows the real clock.
            if (this.isToday()) {
                this.render();
            }
        }, 30000);
    }

    getRealHourKey() {
        const now = new Date();

        return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
    }

    setupTheme() {
        const savedTheme = localStorage.getItem('energyTheme') || 'dark';

        document.documentElement.setAttribute('data-theme', savedTheme);

        const themeBtn = document.getElementById('themeToggleBtn');

        themeBtn.addEventListener('click', () => {
            const currentTheme =
                document.documentElement.getAttribute('data-theme');

            const newTheme =
                currentTheme === 'dark'
                    ? 'light'
                    : 'dark';

            document.documentElement.setAttribute(
                'data-theme',
                newTheme
            );

            localStorage.setItem('energyTheme', newTheme);
        });
    }

    setupNav() {
        document.getElementById('prevDay').onclick = () => {
            this.currentDate.setDate(
                this.currentDate.getDate() - 1
            );

            this.render();
        };

        document.getElementById('nextDay').onclick = () => {
            this.currentDate.setDate(
                this.currentDate.getDate() + 1
            );

            this.render();
        };

        document.getElementById('todayBtn').onclick = () => {
            this.currentDate = new Date();

            this.render();

            this.scrollToCurrent(true);
        };
    }

    setupMenu() {
        const menuBtn = document.getElementById('menuBtn');
        const summaryMenu = document.getElementById('summaryMenu');
        const summaryModal = document.getElementById('summaryModal');
        const closeSummary = document.getElementById('closeSummary');

        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();

            summaryMenu.classList.toggle('open');
        });

        document.addEventListener('click', (e) => {
            if (
                !summaryMenu.contains(e.target) &&
                summaryMenu.classList.contains('open')
            ) {
                summaryMenu.classList.remove('open');
            }
        });

        const summaryItems =
            document.querySelectorAll('.summary-menu li');

        summaryItems.forEach(item => {
            item.addEventListener('click', () => {
                const action =
                    item.getAttribute('data-action');

                summaryMenu.classList.remove('open');

                if (action === 'Export') {
                    this.db.exportData()
                        .then(() => {
                            this.showToast(
                                'Data Exported',
                                'v5'
                            );
                        })
                        .catch((err) => {
                            console.error(
                                'Export failed:',
                                err
                            );

                            this.showToast(
                                'Export Failed',
                                'v1'
                            );
                        });

                } else if (action === 'Import') {
                    document
                        .getElementById('importFileInput')
                        .click();

                } else if (action === 'Guide') {
                    this.openGuideModal();

                } else if (action !== 'Account') {
                    this.activeSummaryType = action;
                    this.summaryDateOffset = 0;

                    this.openSummaryModal();
                }
            });
        });

        document.getElementById(
            'prevSummaryRange'
        ).onclick = () => {
            this.summaryDateOffset--;
            this.openSummaryModal();
        };

        document.getElementById(
            'nextSummaryRange'
        ).onclick = () => {
            this.summaryDateOffset++;
            this.openSummaryModal();
        };

        closeSummary.addEventListener('click', () => {
            summaryModal.classList.remove('open');
        });

        summaryModal.addEventListener('click', (e) => {
            if (e.target === summaryModal) {
                summaryModal.classList.remove('open');
            }
        });
    }

    setupFileImport() {
        const fileInput =
            document.getElementById('importFileInput');

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];

            if (!file) {
                return;
            }

            const reader = new FileReader();

            reader.onload = (event) => {
                this.db
                    .importData(event.target.result)
                    .then(() => {
                        this.render();

                        this.showToast(
                            'Data Imported',
                            'v5'
                        );
                    })
                    .catch((err) => {
                        console.error(
                            'Import failed:',
                            err
                        );

                        this.showToast(
                            'Import Failed',
                            'v1'
                        );
                    })
                    .finally(() => {
                        fileInput.value = '';
                    });
            };

            reader.readAsText(file);
        });
    }

    setupScrollEffects() {
        window.addEventListener(
            'scroll',
            () => {
                requestAnimationFrame(() => {
                    this.updateScrollEffects();
                });
            },
            { passive: true }
        );
    }

    updateScrollEffects() {
        const header =
            document.getElementById('stickyHeader');

        if (!header) {
            return;
        }

        const headerBottom =
            header.getBoundingClientRect().bottom;

        const rows =
            document.querySelectorAll('.hour-row');

        rows.forEach(row => {
            const rect =
                row.getBoundingClientRect();

            const distance =
                rect.top - headerBottom;

            if (
                distance < 0 &&
                distance > -rect.height
            ) {
                const ratio =
                    1 -
                    (Math.abs(distance) / rect.height);

                row.style.opacity =
                    Math.max(0, ratio * ratio);

                row.style.transform =
                    `translateY(${Math.abs(distance) * 0.4}px) scale(${0.96 + (0.04 * ratio)})`;

                row.style.pointerEvents = 'none';

            } else if (distance <= -rect.height) {
                row.style.opacity = 0;
                row.style.pointerEvents = 'none';

            } else {
                row.style.opacity = '';
                row.style.transform = '';
                row.style.pointerEvents = '';
            }
        });
    }

    scrollToCurrent(smooth = true) {
        if (!this.isToday()) {
            window.scrollTo({
                top: 0,
                behavior: smooth ? 'smooth' : 'auto'
            });

            return;
        }

        const currentEl =
            document.querySelector('.hour-row.current');

        const header =
            document.getElementById('stickyHeader');

        if (currentEl && header) {
            const offset =
                header.offsetHeight + 8;

            currentEl.style.scrollMarginTop =
                `${offset}px`;

            currentEl.scrollIntoView({
                behavior: smooth ? 'smooth' : 'auto',
                block: 'start'
            });

            setTimeout(() => {
                this.updateScrollEffects();
            }, 50);
        }
    }

    render() {
        this.renderDate();
        this.renderHours();
        this.updateScrollEffects();
    }

    renderDate() {
        const opts = {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
        };

        document.getElementById(
            'currentDate'
        ).textContent =
            this.currentDate.toLocaleDateString(
                'en-US',
                opts
            );
    }

    /*
     * Determine which hours belong to the current rolling 24-hour
     * editing window.
     *
     * Current hour + previous 23 complete hours = editable.
     *
     * An hour exactly 24 hours old is no longer editable.
     */
    renderHours() {
        const listContainer =
            document.getElementById('hoursList');

        listContainer.innerHTML = '';

        const dd =
            this.db.dayData(this.currentDate);

        const realNow = new Date();

        const realTimeFloor =
            new Date(realNow);

        realTimeFloor.setHours(
            realNow.getHours(),
            0,
            0,
            0
        );

        for (let h = 0; h <= 23; h++) {
            const rowTime =
                new Date(this.currentDate);

            rowTime.setHours(
                h,
                0,
                0,
                0
            );

            const isCurrent =
                rowTime.getTime() ===
                realTimeFloor.getTime();

            const isFuture =
                rowTime.getTime() >
                realTimeFloor.getTime();

            const diffHours =
                (
                    realTimeFloor.getTime() -
                    rowTime.getTime()
                ) /
                (1000 * 60 * 60);

            const isPast =
                diffHours > 0;

            /*
             * IMPORTANT:
             *
             * The hour must be LESS than 24 hours old.
             *
             * Exactly 24 hours old means it has left the editing window.
             */
            const isLockedPast =
                isPast &&
                diffHours >= 24;

            /*
             * This is the ONLY condition that determines whether the
             * manual lock icon exists.
             *
             * Future hours: false
             * Expired past hours: false
             * Current hour: true
             * Past hours inside 24h: true
             */
            const isWithin24HourWindow =
                !isFuture &&
                !isLockedPast;

            let value = dd[h];

            /*
             * Preserve the existing rule that future hours cannot contain
             * a rating.
             */
            if (isFuture && value > 0) {
                value = 0;

                this.db.setRating(
                    this.currentDate,
                    h,
                    0
                );
            }

            /*
             * A manual lock only matters while the hour is still
             * inside the rolling editing window.
             *
             * Once the hour expires, this becomes false and the lock
             * disappears automatically.
             */
            const manualLocked =
                isWithin24HourWindow &&
                this.isHourManuallyLocked(
                    this.currentDate,
                    h
                );

            /*
             * Actual slider editability:
             *
             * future          -> no
             * expired past    -> no
             * manual lock     -> no
             * editable window -> yes
             */
            const isLocked =
                isFuture ||
                isLockedPast ||
                manualLocked;

            const row =
                this.createHourRow(
                    h,
                    value,
                    isPast,
                    isCurrent,
                    isFuture,
                    isLockedPast,
                    isLocked,
                    manualLocked,
                    isWithin24HourWindow
                );

            listContainer.appendChild(row);
        }
    }

    /*
     * Lock storage uses the same date-key convention as the existing
     * DataManager, so the lock always belongs to the exact same hour
     * as its mental-energy value.
     */
    getDateKeyForLock(date) {
        if (
            this.db &&
            typeof this.db.dateKey === 'function'
        ) {
            return this.db.dateKey(date);
        }

        const y =
            date.getFullYear();

        const m =
            String(
                date.getMonth() + 1
            ).padStart(2, '0');

        const d =
            String(
                date.getDate()
            ).padStart(2, '0');

        return `${y}-${m}-${d}`;
    }

    getManualLocks() {
        try {
            const raw =
                localStorage.getItem(
                    this.lockStorageKey
                );

            if (!raw) {
                return {};
            }

            const parsed =
                JSON.parse(raw);

            return (
                parsed &&
                typeof parsed === 'object'
            )
                ? parsed
                : {};

        } catch (err) {
            console.error(
                'Could not read mental-energy hour locks:',
                err
            );

            return {};
        }
    }

    saveManualLocks(locks) {
        try {
            localStorage.setItem(
                this.lockStorageKey,
                JSON.stringify(locks)
            );

            return true;

        } catch (err) {
            console.error(
                'Could not save mental-energy hour locks:',
                err
            );

            return false;
        }
    }

    getHourLockKey(date, hour) {
        return `${
            this.getDateKeyForLock(date)
        }:${hour}`;
    }

    isHourManuallyLocked(date, hour) {
        const locks =
            this.getManualLocks();

        return (
            locks[
                this.getHourLockKey(
                    date,
                    hour
                )
            ] === true
        );
    }

    setHourManuallyLocked(
        date,
        hour,
        locked
    ) {
        const locks =
            this.getManualLocks();

        const key =
            this.getHourLockKey(
                date,
                hour
            );

        if (locked) {
            locks[key] = true;
        } else {
            delete locks[key];
        }

        return this.saveManualLocks(
            locks
        );
    }

    /*
     * Two separate SVG icons:
     *
     * locked   = completely closed lock
     * unlocked = open shackle
     */
    createLockIcon(locked) {
        if (locked) {
            return `
                <svg
                    class="lock-icon lock-icon-locked"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                >
                    <rect
                        x="5"
                        y="10"
                        width="14"
                        height="11"
                        rx="2"
                    ></rect>

                    <path
                        d="M8 10V7a4 4 0 0 1 8 0v3"
                    ></path>
                </svg>
            `;
        }

        return `
            <svg
                class="lock-icon lock-icon-unlocked"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
            >
                <rect
                    x="5"
                    y="10"
                    width="14"
                    height="11"
                    rx="2"
                ></rect>

                <path
                    d="M8 10V7a4 4 0 0 1 7.2-2.4"
                ></path>
            </svg>
        `;
    }

    /*
     * Build one hour row.
     *
     * The important UI rule is:
     *
     * editable-window:
     *     label | slider | value | lock
     *
     * future / expired past:
     *     label | slider | value
     *
     * Therefore those rows genuinely have no lock element at all.
     */
    createHourRow(
        hour,
        value,
        isPast,
        isCurrent,
        isFuture,
        isLockedPast,
        isLocked,
        manualLocked = false,
        isWithin24HourWindow = false
    ) {
        const row =
            document.createElement('div');

        row.className = 'hour-row';

        if (isCurrent) {
            row.classList.add('current');
        }

        if (isFuture) {
            row.classList.add('future');
        }

        if (isLockedPast) {
            row.classList.add('expired-past');
        }

        if (isWithin24HourWindow) {
            row.classList.add('editable-window');
        }

        if (manualLocked) {
            row.classList.add('manually-locked');
        }

        if (value) {
            row.classList.add('rated');
        }

        /* -------------------------------------------------
         * TIME LABEL
         * ------------------------------------------------- */

        const label =
            document.createElement('div');

        label.className = 'hour-label';

        let labelHTML =
            this.graph.formatHour(hour);

        if (isCurrent) {
            labelHTML +=
                '<span class="sub">now</span>';

        } else if (isPast && !isLocked) {
            labelHTML +=
                '<span class="sub">past</span>';

        } else if (isFuture) {
            labelHTML +=
                '<span class="sub">later</span>';

        } else if (isLockedPast) {
            /*
             * Expired hours are simply past.
             * They do NOT display a manual-lock state.
             */
            labelHTML +=
                '<span class="sub">past</span>';

        } else if (manualLocked) {
            labelHTML +=
                '<span class="sub">locked</span>';
        }

        label.innerHTML = labelHTML;

        /* -------------------------------------------------
         * SLIDER
         * ------------------------------------------------- */

        const slider =
            document.createElement('input');

        slider.type = 'range';
        slider.min = 0;
        slider.max = 5;
        slider.step = 1;

        slider.className =
            'energy-slider';

        slider.value =
            value || 0;

        /*
         * This disables:
         *
         * - future hours
         * - expired past hours
         * - manually locked hours
         */
        slider.disabled =
            isLocked;

        this.applySliderColor(
            slider,
            value || 0,
            row
        );

        /* -------------------------------------------------
         * VALUE
         * ------------------------------------------------- */

        const valEl =
            document.createElement('div');

        valEl.className =
            'hour-value' +
            (value ? '' : ' empty');

        valEl.textContent =
            value || '—';

        valEl.title =
            isLocked
                ? 'Locked'
                : 'Tap to clear';

        valEl.style.cursor =
            isLocked
                ? 'not-allowed'
                : 'pointer';

        /* -------------------------------------------------
         * MANUAL LOCK BUTTON
         * ------------------------------------------------- */
        let lockBtn = null;

        /*
         * No lock button is created at all unless the hour is
         * currently inside the 24-hour editing window.
         */
        if (isWithin24HourWindow) {
            lockBtn = document.createElement('button');

            lockBtn.type = 'button';

            lockBtn.className =
                'hour-lock-btn';

            lockBtn.classList.toggle(
                'is-locked',
                manualLocked
            );

            lockBtn.classList.toggle(
                'is-unlocked',
                !manualLocked
            );

            lockBtn.setAttribute(
                'aria-label',
                manualLocked
                    ? 'Unlock hour'
                    : 'Lock hour'
            );

            lockBtn.setAttribute(
                'aria-pressed',
                manualLocked
                    ? 'true'
                    : 'false'
            );

            lockBtn.title =
                manualLocked
                    ? 'Unlock hour'
                    : 'Lock hour';

            lockBtn.innerHTML =
                this.createLockIcon(
                    manualLocked
                );

            lockBtn.addEventListener(
                'click',
                (e) => {
                    /*
                     * Prevent the button interaction from
                     * bubbling into the row.
                     */
                    e.preventDefault();
                    e.stopPropagation();

                    /*
                     * Recalculate the actual time boundary at
                     * click time.
                     *
                     * This protects against clicking the button
                     * exactly when the hour crosses the 24-hour
                     * boundary.
                     */
                    const now =
                        new Date();

                    const selectedRowTime =
                        new Date(
                            this.currentDate
                        );

                    selectedRowTime.setHours(
                        hour,
                        0,
                        0,
                        0
                    );

                    const nowFloor =
                        new Date(now);

                    nowFloor.setHours(
                        now.getHours(),
                        0,
                        0,
                        0
                    );

                    const ageHours =
                        (
                            nowFloor.getTime() -
                            selectedRowTime.getTime()
                        ) /
                        (1000 * 60 * 60);

                    const stillWithinWindow =
                        selectedRowTime.getTime() <=
                            nowFloor.getTime() &&
                        ageHours < 24;

                    /*
                     * If it just expired, do not allow a lock
                     * operation. Re-render removes the icon.
                     */
                    if (!stillWithinWindow) {
                        this.render();
                        return;
                    }

                    /*
                     * Clicking the icon always toggles:
                     *
                     * OPEN  -> CLOSED
                     * CLOSED -> OPEN
                     */
                    const newLockedState =
                        !this.isHourManuallyLocked(
                            this.currentDate,
                            hour
                        );

                    if (
                        !this.setHourManuallyLocked(
                            this.currentDate,
                            hour,
                            newLockedState
                        )
                    ) {
                        this.showToast(
                            'Could not save lock',
                            'v1'
                        );

                        return;
                    }

                    /*
                     * Re-render immediately.
                     *
                     * Closed:
                     *     slider becomes disabled
                     *     icon becomes closed
                     *
                     * Open:
                     *     slider becomes editable
                     *     icon becomes open
                     */
                    this.render();
                }
            );
        }

        /* -------------------------------------------------
         * SLIDER INPUT
         * ------------------------------------------------- */

        slider.addEventListener(
            'input',
            () => {
                /*
                 * Defensive guard.
                 *
                 * Disabled sliders normally cannot emit input,
                 * but the guard prevents accidental data changes
                 * if something else touches the DOM.
                 */
                if (isLocked) {
                    return;
                }

                const v =
                    parseInt(
                        slider.value,
                        10
                    );

                if (v === 0) {
                    this.db.setRating(
                        this.currentDate,
                        hour,
                        0
                    );

                    valEl.textContent =
                        '—';

                    valEl.classList.add(
                        'empty'
                    );

                    row.classList.remove(
                        'rated'
                    );

                } else {
                    this.db.setRating(
                        this.currentDate,
                        hour,
                        v
                    );

                    valEl.textContent =
                        v;

                    valEl.classList.remove(
                        'empty'
                    );

                    row.classList.add(
                        'rated'
                    );

                    this.showToast(
                        this.energyLabels[v],
                        `v${v}`
                    );
                }

                this.applySliderColor(
                    slider,
                    v,
                    row
                );
            }
        );

        /* -------------------------------------------------
         * TAP VALUE TO CLEAR
         * ------------------------------------------------- */

        valEl.addEventListener(
            'click',
            () => {
                if (isLocked) {
                    return;
                }

                this.db.setRating(
                    this.currentDate,
                    hour,
                    0
                );

                slider.value = 0;

                this.applySliderColor(
                    slider,
                    0,
                    row
                );

                valEl.textContent =
                    '—';

                valEl.classList.add(
                    'empty'
                );

                row.classList.remove(
                    'rated'
                );
            }
        );

        /*
         * Preserve the existing future-hour double-tap behavior.
         */
        if (isFuture) {
            let lastTap = 0;

            const handleDoubleTap = () => {
                const now =
                    Date.now();

                if (
                    now - lastTap <
                    300
                ) {
                    this.scrollToCurrent(
                        true
                    );
                }

                lastTap = now;
            };

            row.addEventListener(
                'click',
                handleDoubleTap
            );

            row.addEventListener(
                'touchstart',
                handleDoubleTap,
                {
                    passive: true
                }
            );
        }

        /*
         * Normal row order:
         *
         * TIME
         * SLIDER
         * VALUE
         * [LOCK only if editable-window]
         */
        row.appendChild(label);
        row.appendChild(slider);
        row.appendChild(valEl);

        /*
         * Appending lockBtn last so it correctly flows into the 4th CSS grid column!
         */
        if (lockBtn) {
            row.appendChild(lockBtn);
        }

        return row;
    }

    applySliderColor(
        slider,
        value,
        row
    ) {
        if (!value) {
            slider.style.background =
                'var(--border)';

            row.style.removeProperty(
                '--row-color'
            );

            return;
        }

        const colorMap = {
            1: 'var(--r1)',
            2: 'var(--r2)',
            3: 'var(--r3)',
            4: 'var(--r4)',
            5: 'var(--r5)'
        };

        const color =
            colorMap[value] ||
            'var(--border)';

        /*
         * Keep the existing visual slider fill.
         */
        const percentage =
            (value / 5) * 100;

        slider.style.background =
            `linear-gradient(
                to right,
                ${color} 0%,
                ${color} ${percentage}%,
                var(--border) ${percentage}%,
                var(--border) 100%
            )`;

        row.style.setProperty(
            '--row-color',
            color
        );
    }

    isToday() {
        const today =
            new Date();

        return (
            this.db.dateKey(
                this.currentDate
            ) ===
            this.db.dateKey(today)
        );
    }

    showToast(
        text,
        styleClass = null
    ) {
        const toast =
            document.getElementById(
                'energyToast'
            );

        toast.textContent =
            text;

        toast.className =
            'toast show';

        if (styleClass) {
            toast.classList.add(
                styleClass
            );
        }

        clearTimeout(
            this.toastTimeout
        );

        this.toastTimeout =
            setTimeout(() => {
                toast.classList.remove(
                    'show'
                );
            }, 1500);
    }

    /*
     * The remainder of the app is the existing summary/account system.
     */

    openSummaryModal() {
        const modal =
            document.getElementById(
                'summaryModal'
            );

        const title =
            document.getElementById(
                'summaryTitle'
            );

        const subtitle =
            document.getElementById(
                'summarySubtitle'
            );

        const body =
            document.getElementById(
                'summaryBody'
            );

        const rangeNavArrows =
            document.querySelectorAll(
                '.summary-nav-arrow'
            );

        rangeNavArrows.forEach(
            el => el.style.display = ''
        );

        if (
            this.activeSummaryType ===
            'Day'
        ) {
            this.renderDaySummary(
                body,
                subtitle
            );

        } else if (
            this.activeSummaryType ===
            'Week'
        ) {
            this.renderWeekSummary(
                body,
                subtitle
            );

        } else if (
            this.activeSummaryType ===
            'Month'
        ) {
            this.renderMonthSummary(
                body,
                subtitle
            );

        } else if (
            this.activeSummaryType ===
            'Year'
        ) {
            this.renderYearSummary(
                body,
                subtitle
            );

        } else if (
            this.activeSummaryType ===
            'Custom'
        ) {
            this.renderCustomSummary(
                body,
                subtitle
            );
        }

        title.textContent =
            `${this.activeSummaryType} Summary`;

        modal.classList.add(
            'open'
        );
    }

    openGuideModal() {
        const modal =
            document.getElementById(
                'summaryModal'
            );

        const title =
            document.getElementById(
                'summaryTitle'
            );

        const subtitle =
            document.getElementById(
                'summarySubtitle'
            );

        const body =
            document.getElementById(
                'summaryBody'
            );

        const rangeNavArrows =
            document.querySelectorAll(
                '.summary-nav-arrow'
            );

        title.textContent =
            'Guide / Help';

        subtitle.textContent =
            '';

        rangeNavArrows.forEach(
            el => el.style.display = 'none'
        );

        body.innerHTML = `
            <div
                style="
                    color: var(--text);
                    line-height: 1.6;
                    font-size: 0.95rem;
                    padding-bottom: 20px;
                "
            >
                <p style="margin-bottom: 16px;">
                    <strong>Mental Energy</strong>
                    helps you map out your natural highs and lows
                    so you can schedule your hardest work when you
                    actually have the gas in the tank.
                </p>

                <h4
                    style="
                        color: var(--accent);
                        margin-top: 20px;
                        margin-bottom: 8px;
                    "
                >
                    📊 How to Track
                </h4>

                <ul
                    style="
                        padding-left: 20px;
                        margin-bottom: 16px;
                        color: var(--muted);
                    "
                >
                    <li style="margin-bottom: 4px;">
                        Drag the slider from 1 (Very Low) to 5 (Peak).
                    </li>

                    <li style="margin-bottom: 4px;">
                        Tap the number on the right to clear a rating.
                    </li>

                    <li style="margin-bottom: 4px;">
                        You can log the current hour, or backfill any
                        empty hours from the past 24 hours.
                    </li>

                    <li style="margin-bottom: 4px;">
                        Use the open lock to freeze an hour manually.
                    </li>

                    <li style="margin-bottom: 4px;">
                        Tap the closed lock to unlock that hour again.
                    </li>
                </ul>

                <h4
                    style="
                        color: var(--accent);
                        margin-top: 20px;
                        margin-bottom: 8px;
                    "
                >
                    ⏳ The Timeline Rules
                </h4>

                <ul
                    style="
                        padding-left: 20px;
                        margin-bottom: 16px;
                        color: var(--muted);
                    "
                >
                    <li style="margin-bottom: 4px;">
                        <strong>Future:</strong>
                        unavailable. You can't predict the future.
                    </li>

                    <li style="margin-bottom: 4px;">
                        <strong>Past 24 hours:</strong>
                        editable and can be manually locked.
                    </li>

                    <li style="margin-bottom: 4px;">
                        <strong>Older than 24 hours:</strong>
                        automatically frozen and shown as ordinary past hours.
                    </li>

                    <li style="margin-bottom: 4px;">
                        A manually locked hour stays frozen until you unlock it,
                        unless it naturally leaves the 24-hour editing window.
                    </li>
                </ul>

                <h4
                    style="
                        color: var(--accent);
                        margin-top: 20px;
                        margin-bottom: 8px;
                    "
                >
                    📈 Summaries & Data
                </h4>

                <ul
                    style="
                        padding-left: 20px;
                        margin-bottom: 16px;
                        color: var(--muted);
                    "
                >
                    <li style="margin-bottom: 4px;">
                        Check your Day, Week, Month, or Year summaries
                        to find your golden hours and mental energy trends.
                    </li>

                    <li style="margin-bottom: 4px;">
                        Use the <strong>Custom Summary</strong>
                        to build specific reports.
                    </li>

                    <li style="margin-bottom: 4px;">
                        Your data is saved locally on your device.
                        Use Import/Export to back it up.
                    </li>
                </ul>
            </div>
        `;

        modal.classList.add(
            'open'
        );
    }

    renderDaySummary(
        body,
        subtitle
    ) {
        const date =
            new Date(
                this.currentDate
            );

        subtitle.textContent =
            date.toLocaleDateString(
                'en-US',
                {
                    weekday: 'long',
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                }
            );

        const data =
            this.db.dayData(
                date
            );

        const values =
            Object.values(data)
                .filter(
                    value =>
                        [1,2,3,4,5]
                            .includes(value)
                );

        const average =
            values.length
                ? (
                    values.reduce(
                        (a,b) => a + b,
                        0
                    ) /
                    values.length
                ).toFixed(1)
                : '—';

        const peak =
            values.length
                ? Math.max(...values)
                : '—';

        const lowest =
            values.length
                ? Math.min(...values)
                : '—';

        body.innerHTML = `
            <div class="dummy-stats">
                <div class="stat-box">
                    <span>Average</span>
                    <strong>${average}</strong>
                </div>

                <div class="stat-box">
                    <span>Peak</span>
                    <strong>${peak}</strong>
                </div>

                <div class="stat-box">
                    <span>Lowest</span>
                    <strong>${lowest}</strong>
                </div>
            </div>

            <div
                id="summaryGraph"
                class="graph-container"
            ></div>
        `;

        const graph =
            document.getElementById(
                'summaryGraph'
            );

        if (!values.length) {
            graph.innerHTML =
                '<div class="empty-graph">No mental energy data for this day.</div>';

            return;
        }

        this.graph.renderDayGraph(
            graph,
            date
        );
    }

    renderWeekSummary(
        body,
        subtitle
    ) {
        const start =
            new Date(
                this.currentDate
            );

        const day =
            start.getDay();

        start.setDate(
            start.getDate() - day
        );

        const end =
            new Date(start);

        end.setDate(
            start.getDate() + 6
        );

        subtitle.textContent =
            `${start.toLocaleDateString(
                'en-US',
                { month: 'short', day: 'numeric' }
            )} – ${end.toLocaleDateString(
                'en-US',
                { month: 'short', day: 'numeric' }
            )}`;

        body.innerHTML = `
            <div
                id="summaryGraph"
                class="graph-container"
            ></div>
        `;

        this.graph.renderWeekGraph(
            document.getElementById(
                'summaryGraph'
            ),
            start
        );
    }

    renderMonthSummary(
        body,
        subtitle
    ) {
        const start =
            new Date(
                this.currentDate
            );

        start.setDate(1);

        const year =
            start.getFullYear();

        const month =
            start.getMonth();

        const end =
            new Date(
                year,
                month + 1,
                0
            );

        subtitle.textContent =
            start.toLocaleDateString(
                'en-US',
                {
                    month: 'long',
                    year: 'numeric'
                }
            );

        body.innerHTML = `
            <div
                id="summaryGraph"
                class="graph-container"
            ></div>
        `;

        this.graph.renderMonthGraph(
            document.getElementById(
                'summaryGraph'
            ),
            start
        );
    }

    renderYearSummary(
        body,
        subtitle
    ) {
        const year =
            this.currentDate.getFullYear();

        subtitle.textContent =
            String(year);

        body.innerHTML = `
            <div
                id="summaryGraph"
                class="graph-container"
            ></div>
        `;

        this.graph.renderYearGraph(
            document.getElementById(
                'summaryGraph'
            ),
            year
        );
    }

    renderCustomSummary(
        body,
        subtitle
    ) {
        subtitle.textContent =
            'Build a custom mental energy report';

        body.innerHTML = `
            <div class="custom-form">

                <div class="form-group">
                    <h4>Date Range</h4>

                    <input
                        id="customStart"
                        class="form-input"
                        type="date"
                    >

                    <input
                        id="customEnd"
                        class="form-input"
                        type="date"
                    >
                </div>

                <div class="form-group">
                    <h4>View</h4>

                    <select
                        id="customView"
                        class="form-select"
                    >
                        <option value="day">
                            Day
                        </option>

                        <option value="week">
                            Week
                        </option>

                        <option value="month">
                            Month
                        </option>

                        <option value="year">
                            Year
                        </option>
                    </select>
                </div>

                <div class="form-group">
                    <h4>Energy Levels</h4>

                    <div class="checkbox-grid">
                        <label class="checkbox-label">
                            <input
                                type="checkbox"
                                value="1"
                                checked
                            >
                            Very Low
                        </label>

                        <label class="checkbox-label">
                            <input
                                type="checkbox"
                                value="2"
                                checked
                            >
                            Low
                        </label>

                        <label class="checkbox-label">
                            <input
                                type="checkbox"
                                value="3"
                                checked
                            >
                            Normal
                        </label>

                        <label class="checkbox-label">
                            <input
                                type="checkbox"
                                value="4"
                                checked
                            >
                            High
                        </label>

                        <label class="checkbox-label">
                            <input
                                type="checkbox"
                                value="5"
                                checked
                            >
                            Peak
                        </label>
                    </div>
                </div>

                <button
                    id="customGenerate"
                    class="confirm-btn"
                >
                    Generate Summary
                </button>

                <div id="customResults"></div>
            </div>
        `;

        const today =
            new Date();

        const endInput =
            document.getElementById(
                'customEnd'
            );

        const startInput =
            document.getElementById(
                'customStart'
            );

        endInput.value =
            this.db.dateKey(
                today
            );

        const defaultStart =
            new Date(today);

        defaultStart.setDate(
            defaultStart.getDate() - 6
        );

        startInput.value =
            this.db.dateKey(
                defaultStart
            );

        document.getElementById(
            'customGenerate'
        ).addEventListener(
            'click',
            () => {
                this.generateCustomSummary();
            }
        );
    }

    generateCustomSummary() {
        const start =
            document.getElementById(
                'customStart'
            ).value;

        const end =
            document.getElementById(
                'customEnd'
            ).value;

        const selected =
            Array.from(
                document.querySelectorAll(
                    '.checkbox-grid input:checked'
                )
            ).map(
                el => Number(el.value)
            );

        const results =
            document.getElementById(
                'customResults'
            );

        if (!start || !end) {
            results.innerHTML =
                '<p class="account-message">Choose a start and end date.</p>';

            return;
        }

        const startDate =
            new Date(
                `${start}T00:00:00`
            );

        const endDate =
            new Date(
                `${end}T23:59:59`
            );

        if (
            startDate.getTime() >
            endDate.getTime()
        ) {
            results.innerHTML =
                '<p class="account-message">Start date must be before the end date.</p>';

            return;
        }

        const values = [];

        const cursor =
            new Date(
                startDate
            );

        while (
            cursor.getTime() <=
            endDate.getTime()
        ) {
            const dayData =
                this.db.dayData(
                    cursor
                );

            Object.values(dayData)
                .forEach(value => {
                    if (
                        selected.includes(
                            Number(value)
                        )
                    ) {
                        values.push(
                            Number(value)
                        );
                    }
                });

            cursor.setDate(
                cursor.getDate() + 1
            );
        }

        if (!values.length) {
            results.innerHTML = `
                <p class="account-message">
                    No matching mental energy data found.
                </p>
            `;

            return;
        }

        const average =
            (
                values.reduce(
                    (a,b) => a + b,
                    0
                ) /
                values.length
            ).toFixed(2);

        const peak =
            Math.max(...values);

        const lowest =
            Math.min(...values);

        results.innerHTML = `
            <div class="custom-stats-grid">

                <div class="custom-stat-box">
                    <span class="custom-stat-label">
                        Matching Hours
                    </span>

                    <span class="custom-stat-value">
                        ${values.length}
                    </span>
                </div>

                <div class="custom-stat-box">
                    <span class="custom-stat-label">
                        Average
                    </span>

                    <span class="custom-stat-value">
                        ${average}
                    </span>
                </div>

                <div class="custom-stat-box">
                    <span class="custom-stat-label">
                        Highest
                    </span>

                    <span class="custom-stat-value">
                        ${peak}
                    </span>
                </div>

                <div class="custom-stat-box">
                    <span class="custom-stat-label">
                        Lowest
                    </span>

                    <span class="custom-stat-value">
                        ${lowest}
                    </span>
                </div>

            </div>
        `;
    }
}

document.addEventListener(
    'DOMContentLoaded',
    () => {
        window.energyApp =
            new EnergyApp();
    }
);
