class DataManager {
    /*
     * Local-first storage:
     * - IndexedDB is the primary database and can comfortably keep years of data.
     * - Existing localStorage data is migrated automatically on first launch.
     * - localStorage remains as a fallback if IndexedDB is unavailable.
     *
     * The in-memory shape stays the same:
     * {
     *   "YYYY-MM-DD": { "0": 1, "1": 4, ... }
     * }
     *
     * A small change log is also kept in IndexedDB so account/cloud sync can
     * be added later without redesigning the local data model.
     */
    constructor() {
        this.data = {};
        this.db = null;
        this.storageMode = 'memory';
        this.ready = this.initialize();
    }

    async initialize() {
        if (!('indexedDB' in window)) {
            this.storageMode = 'localStorage';
            this.data = this.loadLocalStorage();
            return;
        }

        try {
            this.db = await this.openDatabase();

            const stored = await this.readStore('data', 'main');

            if (stored && stored.data && typeof stored.data === 'object') {
                this.data = stored.data;
            } else {
                // Migrate the old app's localStorage database once.
                const legacy = this.loadLocalStorage();

                this.data = legacy;

                const migrationTime = Date.now();

                await this.writeStore('data', {
                    id: 'main',
                    data: this.data,
                    updatedAt: migrationTime
                });

                // Give legacy records a timestamp so cloud sync can compare them safely.
                // storageMode is temporarily set so the metadata is written to IndexedDB.
                this.storageMode = 'indexedDB';

                for (const [date, hours] of Object.entries(this.data)) {
                    for (const hour of Object.keys(hours || {})) {
                        await this.setCellTimestamp(
                            date,
                            hour,
                            migrationTime
                        );
                    }
                }

                await this.setMeta(
                    'cellTimestampsInitialized',
                    true
                );
            }

            this.storageMode = 'indexedDB';

            // Older IndexedDB versions did not have per-cell timestamps or a
            // sync queue. Seed them once so existing history is safely eligible
            // for the first cloud sync.
            const timestampsInitialized =
                await this.getMeta(
                    'cellTimestampsInitialized'
                );

            if (!timestampsInitialized) {
                const baseline =
                    stored?.updatedAt || Date.now();

                for (
                    const [date, hours]
                    of Object.entries(this.data)
                ) {
                    for (
                        const [hour, value]
                        of Object.entries(hours || {})
                    ) {
                        if (value) {
                            await this.setCellTimestamp(
                                date,
                                hour,
                                baseline
                            );

                            await this.addChange({
                                date,
                                hour,
                                value,
                                updatedAt: baseline
                            });
                        }
                    }
                }

                await this.setMeta(
                    'cellTimestampsInitialized',
                    true
                );
            }

            // Ask the browser to protect this local database from automatic
            // storage eviction when the platform supports persistent storage.
            if (
                navigator.storage &&
                navigator.storage.persist
            ) {
                try {
                    await navigator.storage.persist();
                } catch (_) {
                    // Best effort only; the app still works without it.
                }
            }

        } catch (error) {
            console.warn(
                'IndexedDB unavailable; using localStorage.',
                error
            );

            this.storageMode = 'localStorage';
            this.data = this.loadLocalStorage();
        }
    }

    openDatabase() {
        return new Promise((resolve, reject) => {
            const request =
                indexedDB.open(
                    'EnergyHeatmapDB',
                    1
                );

            request.onupgradeneeded = () => {
                const db = request.result;

                if (
                    !db.objectStoreNames.contains('data')
                ) {
                    db.createObjectStore(
                        'data',
                        { keyPath: 'id' }
                    );
                }

                if (
                    !db.objectStoreNames.contains('changes')
                ) {
                    const changes =
                        db.createObjectStore(
                            'changes',
                            {
                                keyPath: 'id',
                                autoIncrement: true
                            }
                        );

                    changes.createIndex(
                        'date',
                        'date',
                        { unique: false }
                    );

                    changes.createIndex(
                        'updatedAt',
                        'updatedAt',
                        { unique: false }
                    );
                }

                if (
                    !db.objectStoreNames.contains('meta')
                ) {
                    db.createObjectStore(
                        'meta',
                        { keyPath: 'id' }
                    );
                }
            };

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                reject(
                    request.error ||
                    new Error(
                        'Could not open database'
                    )
                );
            };
        });
    }

    readStore(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx =
                this.db.transaction(
                    storeName,
                    'readonly'
                );

            const request =
                tx.objectStore(storeName).get(key);

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    writeStore(storeName, value) {
        return new Promise((resolve, reject) => {
            const tx =
                this.db.transaction(
                    storeName,
                    'readwrite'
                );

            tx.objectStore(storeName).put(value);

            tx.oncomplete = () => {
                resolve();
            };

            tx.onerror = () => {
                reject(tx.error);
            };

            tx.onabort = () => {
                reject(
                    tx.error ||
                    new Error(
                        'Database transaction aborted'
                    )
                );
            };
        });
    }

    addChange(change) {
        if (
            this.storageMode !== 'indexedDB'
        ) {
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            try {
                const tx =
                    this.db.transaction(
                        'changes',
                        'readwrite'
                    );

                tx.objectStore(
                    'changes'
                ).add(change);

                tx.oncomplete = () => {
                    resolve();
                };

                tx.onerror = () => {
                    console.warn(
                        'Could not record local change.',
                        tx.error
                    );

                    resolve();
                };

                tx.onabort = () => {
                    resolve();
                };

            } catch (error) {
                console.warn(
                    'Could not record local change.',
                    error
                );

                resolve();
            }
        });
    }

    getMeta(key) {
        if (
            this.storageMode !== 'indexedDB'
        ) {
            try {
                return Promise.resolve(
                    JSON.parse(
                        localStorage.getItem(
                            `energyMeta:${key}`
                        )
                    )
                );
            } catch (_) {
                return Promise.resolve(null);
            }
        }

        return this.readStore(
            'meta',
            key
        ).then(record => {
            return record
                ? record.value
                : null;
        });
    }

    setMeta(key, value) {
        if (
            this.storageMode !== 'indexedDB'
        ) {
            try {
                if (
                    value === null ||
                    value === undefined
                ) {
                    localStorage.removeItem(
                        `energyMeta:${key}`
                    );
                } else {
                    localStorage.setItem(
                        `energyMeta:${key}`,
                        JSON.stringify(value)
                    );
                }
            } catch (_) {}

            return Promise.resolve();
        }

        return this.writeStore(
            'meta',
            {
                id: key,
                value
            }
        );
    }

    getCellTimestamp(date, hour) {
        return this.getMeta(
            `cell:${date}|${hour}`
        ).then(value => {
            return Number(value) || 0;
        });
    }

    setCellTimestamp(
        date,
        hour,
        timestamp
    ) {
        return this.setMeta(
            `cell:${date}|${hour}`,
            Number(timestamp) || Date.now()
        );
    }

    getPendingChanges() {
        if (
            this.storageMode !== 'indexedDB'
        ) {
            return Promise.resolve([]);
        }

        return new Promise((resolve, reject) => {
            const tx =
                this.db.transaction(
                    'changes',
                    'readonly'
                );

            const request =
                tx.objectStore(
                    'changes'
                ).getAll();

            request.onsuccess = () => {
                resolve(
                    request.result || []
                );
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    removeChange(id) {
        if (
            this.storageMode !== 'indexedDB'
        ) {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            const tx =
                this.db.transaction(
                    'changes',
                    'readwrite'
                );

            tx.objectStore(
                'changes'
            ).delete(id);

            tx.oncomplete = () => {
                resolve();
            };

            tx.onerror = () => {
                reject(tx.error);
            };
        });
    }

    async persistDataOnly() {
        const updatedAt = Date.now();

        if (
            this.storageMode === 'indexedDB'
        ) {
            await this.writeStore(
                'data',
                {
                    id: 'main',
                    data: this.data,
                    updatedAt
                }
            );
        } else {
            localStorage.setItem(
                'energyData',
                JSON.stringify(this.data)
            );
        }
    }

    loadLocalStorage() {
        try {
            return (
                JSON.parse(
                    localStorage.getItem(
                        'energyData'
                    )
                ) || {}
            );
        } catch {
            return {};
        }
    }

    async saveData(
        changedDate = null,
        changedHour = null,
        changedValue = null,
        operationTime = null
    ) {
        const updatedAt =
            operationTime || Date.now();

        if (
            this.storageMode === 'indexedDB'
        ) {
            try {
                await this.writeStore(
                    'data',
                    {
                        id: 'main',
                        data: this.data,
                        updatedAt
                    }
                );

                if (
                    changedDate !== null &&
                    changedHour !== null
                ) {
                    await this.addChange({
                        date: changedDate,
                        hour: String(changedHour),
                        value:
                            changedValue === 0
                                ? null
                                : changedValue,
                        updatedAt
                    });
                }

                return;

            } catch (error) {
                console.warn(
                    'IndexedDB write failed; saving to localStorage.',
                    error
                );
            }
        }

        try {
            localStorage.setItem(
                'energyData',
                JSON.stringify(this.data)
            );
        } catch (error) {
            console.error(
                'Could not save energy data.',
                error
            );
        }
    }

    /*
     * IMPORTANT:
     *
     * Use the device's LOCAL calendar date.
     *
     * Do NOT use toISOString() here because that converts
     * the date to UTC first. For users in timezones such as
     * India (UTC+5:30), that can make the stored date differ
     * from the calendar date shown by the app.
     *
     * Example:
     *
     * Local date: 2026-09-13
     * Stored key: 2026-09-13
     *
     * The key therefore follows the same calendar date that
     * the user sees in the app.
     */
    dateKey(d) {
        const year =
            d.getFullYear();

        const month =
            String(
                d.getMonth() + 1
            ).padStart(2, '0');

        const day =
            String(
                d.getDate()
            ).padStart(2, '0');

        return `${year}-${month}-${day}`;
    }

    dayData(d) {
        return (
            this.data[
                this.dateKey(d)
            ] || {}
        );
    }

    setRating(
        dateObj,
        hour,
        value
    ) {
        const key =
            this.dateKey(dateObj);

        if (!this.data[key]) {
            this.data[key] = {};
        }

        if (value === 0) {
            delete this.data[key][hour];

            if (
                Object.keys(
                    this.data[key]
                ).length === 0
            ) {
                delete this.data[key];
            }

        } else {
            this.data[key][hour] = value;
        }

        // Timestamp the individual cell and queue the exact operation
        // for cloud sync. The UI never waits for the network.
        const updatedAt = Date.now();

        this.setCellTimestamp(
            key,
            hour,
            updatedAt
        );

        this.saveData(
            key,
            hour,
            value,
            updatedAt
        );
    }

    async exportData() {
        await this.ready;

        const backup = {
            format:
                'energy-heatmap-backup',

            version: 2,

            exportedAt:
                new Date().toISOString(),

            data: this.data
        };

        const dataStr =
            JSON.stringify(
                backup,
                null,
                2
            );

        const blob =
            new Blob(
                [dataStr],
                {
                    type:
                        'application/json'
                }
            );

        const url =
            URL.createObjectURL(blob);

        const a =
            document.createElement('a');

        a.href = url;

        a.download =
            `energy_data_${this.dateKey(
                new Date()
            )}.json`;

        document.body.appendChild(a);

        a.click();

        a.remove();

        setTimeout(() => {
            URL.revokeObjectURL(url);
        }, 1000);
    }

    async importData(jsonString) {
        const parsed =
            JSON.parse(jsonString);

        // Accept both the new backup format
        // and old Energy Heatmap exports.
        const importedData =
            parsed &&
            parsed.format ===
                'energy-heatmap-backup' &&
            parsed.data
                ? parsed.data
                : parsed;

        if (
            typeof importedData !==
                'object' ||
            importedData === null ||
            Array.isArray(importedData)
        ) {
            throw new Error(
                'Invalid structure'
            );
        }

        // Validate the basic date/hour/value
        // structure before replacing data.
        for (
            const [
                date,
                hours
            ] of Object.entries(
                importedData
            )
        ) {
            if (
                !/^\d{4}-\d{2}-\d{2}$/.test(
                    date
                ) ||
                typeof hours !==
                    'object' ||
                hours === null ||
                Array.isArray(hours)
            ) {
                throw new Error(
                    'Invalid data structure'
                );
            }

            for (
                const [
                    hour,
                    value
                ] of Object.entries(
                    hours
                )
            ) {
                if (
                    !/^(?:[0-9]|1[0-9]|2[0-3])$/.test(
                        String(hour)
                    )
                ) {
                    throw new Error(
                        'Invalid hour'
                    );
                }

                if (
                    ![
                        1,
                        2,
                        3,
                        4,
                        5
                    ].includes(value)
                ) {
                    throw new Error(
                        'Invalid energy value'
                    );
                }
            }
        }

        this.data =
            importedData;

        const importTime =
            Date.now();

        if (
            this.storageMode ===
            'indexedDB'
        ) {
            await this.writeStore(
                'data',
                {
                    id: 'main',
                    data: this.data,
                    updatedAt: importTime
                }
            );

            for (
                const [
                    date,
                    hours
                ] of Object.entries(
                    this.data
                )
            ) {
                for (
                    const [
                        hour,
                        value
                    ] of Object.entries(
                        hours || {}
                    )
                ) {
                    await this.setCellTimestamp(
                        date,
                        hour,
                        importTime
                    );

                    await this.addChange({
                        date,
                        hour,
                        value,
                        updatedAt:
                            importTime
                    });
                }
            }

        } else {
            localStorage.setItem(
                'energyData',
                JSON.stringify(
                    this.data
                )
            );
        }
    }

    /*
     * These methods are intentionally small and local-only for now.
     * A future sign-in/sync layer can use them to upload/download changes
     * without changing the timeline or graph UI.
     */
    async getSyncSnapshot() {
        await this.ready;

        return structuredClone(
            this.data
        );
    }

    async replaceFromSync(snapshot) {
        if (
            !snapshot ||
            typeof snapshot !==
                'object' ||
            Array.isArray(snapshot)
        ) {
            throw new Error(
                'Invalid sync snapshot'
            );
        }

        this.data =
            snapshot;

        if (
            this.storageMode ===
            'indexedDB'
        ) {
            await this.writeStore(
                'data',
                {
                    id: 'main',
                    data: this.data,
                    updatedAt: Date.now()
                }
            );
        } else {
            localStorage.setItem(
                'energyData',
                JSON.stringify(
                    this.data
                )
            );
        }
    }
}