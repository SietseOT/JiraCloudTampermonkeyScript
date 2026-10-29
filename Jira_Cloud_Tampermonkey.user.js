// ==UserScript==
// @name         Jira Cloud - OT label badges
// @namespace    https://onderwijstransparant.nl/
// @version      1.5.0
// @description  Toont labels als badges in swimlane-koppen (Group: Story), op bordkaarten en in backlog-regels op Jira Cloud, inclusief divider-regels. Alleen lezen.
// @author       OnderwijsTransparant
// @match        https://onderwijstransparant.atlassian.net/*
// @grant        none
// @run-at       document-idle
// @homepageURL  https://github.com/SietseOT/JiraCloudTampermonkeyScript
// @updateURL    https://raw.githubusercontent.com/SietseOT/JiraCloudTampermonkeyScript/main/Jira_Cloud_Tampermonkey.user.js
// @downloadURL  https://raw.githubusercontent.com/SietseOT/JiraCloudTampermonkeyScript/main/Jira_Cloud_Tampermonkey.user.js
// ==/UserScript==

(function () {
    'use strict';

    // Niet draaien in iframes (bijv. editors of ingesloten vensters)
    if (window.top !== window.self) return;

    const SCRIPT_VERSION = '1.5.0';
    const LOG_PREFIX = '[OT labels]';

    // =====================================================================
    // INSTELLINGEN: standaardwaarden. Elke gebruiker kan onderdelen zelf
    // aan- en uitzetten via het tandwiel rechtsonder in Jira; die keuze
    // wordt in deze browser bewaard (localStorage) en overleeft updates.
    // =====================================================================
    const DEFAULT_FEATURES = {
        swimlaneHeaders: true,   // labels in de koppen van swimlanes (bord, Group: Story)
        boardCards: true,        // labels op de kaarten van het bord (bijv. subtaken)
        onHoldDimsCard: true,    // kaart met label "on-hold" iets doorzichtig maken (zoals het oude script)
        backlogRows: true,       // labels in de regel van een ticket in de backlog
        backlogDividers: true,   // ticket met label "divider" als scheidingslijn in de backlog
        flaggedYellow: true,     // geflagd ticket in de backlog geel i.p.v. roze (zoals Jira het op het bord al doet)
        dueDateColors: true      // kader om het due date-veld in de backlog op basis van labels (zie DUE_DATE_RULES)
    };

    // Teksten in het instellingenvenster (volgorde = volgorde in het venster)
    const FEATURE_INFO = [
        {
            key: 'swimlaneHeaders',
            title: 'Labels in swimlane-koppen',
            help: 'Toont de labels van een story als badges in de kop van de swimlane op het bord (met Group: Story).'
        },
        {
            key: 'boardCards',
            title: 'Labels op bordkaarten',
            help: 'Toont labels als badges op de kaarten van het bord, tussen de titel en de ticketsleutel. Werkt ook voor subtaken.'
        },
        {
            key: 'onHoldDimsCard',
            title: 'On-hold kaarten doorzichtig',
            help: 'Een kaart met het label "on-hold" wordt op het bord iets doorzichtig, zodat je ziet dat er niet aan gewerkt wordt.'
        },
        {
            key: 'backlogRows',
            title: 'Labels in de backlog',
            help: 'Toont labels in de regels van de backlog. Deadline en overleg staan vóór de titel, de overige labels erachter.'
        },
        {
            key: 'backlogDividers',
            title: 'Divider-regels in de backlog',
            help: 'Een ticket met het label "divider" wordt in de backlog een scheidingslijn met de titel in het midden. Slepen en aanklikken blijft werken.'
        },
        {
            key: 'flaggedYellow',
            title: 'Geflagde tickets geel in de backlog',
            help: 'Jira kleurt geflagde tickets in de backlog roze. Met deze optie worden ze geel, net als op het bord.'
        }
    ];

    const SETTINGS_KEY = 'otclSettings.v1';
    const FEATURES = loadSettings();

    function loadSettings() {
        const settings = Object.assign({}, DEFAULT_FEATURES);
        try {
            const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
            for (const key of Object.keys(DEFAULT_FEATURES)) {
                if (typeof saved[key] === 'boolean') settings[key] = saved[key];
            }
        } catch (e) {
            console.debug(LOG_PREFIX, 'Instellingen lezen mislukt', e);
        }
        return settings;
    }

    function saveSettings() {
        // Alleen afwijkingen van de standaard bewaren, zodat nieuwe standaarden in updates doorkomen
        const changed = {};
        for (const key of Object.keys(DEFAULT_FEATURES)) {
            if (FEATURES[key] !== DEFAULT_FEATURES[key]) changed[key] = FEATURES[key];
        }
        try {
            if (Object.keys(changed).length) localStorage.setItem(SETTINGS_KEY, JSON.stringify(changed));
            else localStorage.removeItem(SETTINGS_KEY);
        } catch (e) {
            console.debug(LOG_PREFIX, 'Instellingen opslaan mislukt', e);
        }
    }

    // =====================================================================
    // SELECTORS: alles wat het script in de Jira-pagina zoekt staat hier.
    // Werkt het script niet meer na een Jira-update? Dan is hier meestal
    // één regel aan te passen. Vindt een selector niets, dan doet het
    // script op die plek stil niets.
    // =====================================================================
    const SELECTORS = {
        // Bord (Active sprint) met Group: Story
        swimlane: '[data-testid="platform-board-kit.ui.swimlane.swimlane-wrapper"]',
        swimlaneSummary: '[data-testid="platform-board-kit.ui.swimlane.summary-section"]',
        swimlaneKey: '[data-testid="platform-card.common.ui.key.key"]',

        // Kaart op het bord: de ticketsleutel staat in het id, bijv. id="card-OT-8"
        boardCard: '[data-testid="platform-board-kit.ui.card.card"][id^="card-"]',
        boardCardIdPrefix: 'card-',
        boardCardFooter: '[data-testid="platform-card.ui.card.card-content.footer"]',

        // Backlog: de ticketsleutel staat aan het eind van deze data-testid
        backlogRow: '[data-testid^="software-backlog.card-list.card.content-container."]',
        backlogRowKeyPrefix: 'software-backlog.card-list.card.content-container.',
        backlogCardContainer: '[data-testid="software-backlog.card-list.card.card-contents.card-container"]',
        backlogSummary: '[data-testid="software-backlog.card-list.card.card-contents.summary"]',
        backlogSummaryText: '[data-testid="software-backlog.card-list.card.card-contents.summary-field.summary-field-static.content"]',
        backlogClickLayer: '[data-testid="software-backlog.card-list.card.card-contents.interaction-layer.accessible-card"]',

        // Het zichtbare vakje van het standaard due date-veld in een backlog-regel
        dueDate: '[data-testid="coloured-due-date.ui.colored-due-date-container"]'
    };

    const API = {
        // Nieuwe zoek-endpoint van Jira Cloud (vervangt /rest/api/3/search)
        search: '/rest/api/3/search/jql',
        // Eén ticket direct ophalen (geen vertraging van de zoekindex)
        issue: '/rest/api/3/issue/'
    };

    // Jira-veld "Flagged" (vlag aan = gevuld). Het ID is per Jira-omgeving vast;
    // opzoeken via /rest/api/3/field als het ooit verandert.
    const FLAGGED_FIELD = 'customfield_10021';
    const FETCH_FIELDS = `labels,duedate,${FLAGGED_FIELD}`;

    // Welk ticket staat open? Jira zet dit in de adresbalk (?selectedIssue=OT-9 of /browse/OT-9)
    const SELECTED_ISSUE_PARAM = 'selectedIssue';
    const BROWSE_PATH_PATTERN = /\/browse\/([A-Z][A-Z0-9_]*-\d+)/;

    // =====================================================================
    // LABELWEERGAVE
    // =====================================================================
    // Labels met een datum erachter, bijv. "deadline:2026-10-12" of "overleg-15-03-2026".
    // Alleen het voorvoegsel zonder iets erachter (bijv. "Overleg") is géén datumlabel.
    const DATE_PREFIX_LABELS = [
        { prefix: 'deadline', icon: '📅', title: 'Deadline', cls: 'otcl-badge--deadline' },
        { prefix: 'overleg', icon: '💬', title: 'Overleg', cls: 'otcl-badge--overleg' }
    ];

    // Vaste labels met eigen opmaak (hoofdletterongevoelig). Dit zijn precies de labels
    // die het oude script (v8.7.0) ook al speciaal toonde, met dezelfde teksten.
    // Bij "urgent" toont het oude script de labeltekst zelf (text: null).
    const SPECIAL_LABELS = {
        'hotfix': { icon: '🔥', text: 'Hotfix', cls: 'otcl-badge--hotfix' },
        'tijdskritisch': { icon: '⏰', text: 'Tijdskritisch', cls: 'otcl-badge--time-critical' },
        'urgent': { icon: '', text: null, cls: 'otcl-badge--urgent' },
        'onderzoek': { icon: '🔍', text: 'Onderzoek', cls: 'otcl-badge--research' },
        'on-hold': { icon: '🛑', text: 'On Hold', cls: 'otcl-badge--on-hold' },
        'cross-refinement': { icon: '🤝', text: 'Cross-refinement', short: 'Cross-ref', cls: 'otcl-badge--cross-refinement' }
    };

    // Labels die niet als badge getoond worden (net als in het oude script)
    // "overleg" zonder datum geeft alleen het kader om de due date (zie DUE_DATE_RULES).
    const HIDDEN_LABELS = new Set(['divider', 'small', 'medium', 'large', 'geen-punten', 'onduidelijk-punten', 'overleg']);
    const DIVIDER_LABEL = 'divider';

    // Kader om het standaard due date-veld (alleen als er een due date is ingevuld).
    // Label is hoofdletterongevoelig; de eerste regel die past wint. Een nieuwe
    // combinatie toevoegen: een regel hier en (bij een nieuwe kleur) een CSS-klasse
    // "otcl-due--<kleur>" in injectStyles().
    const DUE_DATE_RULES = [
        { label: 'overleg', cls: 'otcl-due--purple' }
    ];
    const DUE_DATE_CLASSES = [...new Set(DUE_DATE_RULES.map(rule => rule.cls))];

    // =====================================================================
    // CACHE EN OPHALEN
    // =====================================================================
    const ONE_HOUR = 60 * 60 * 1000;
    const ONE_DAY = 24 * ONE_HOUR;
    const REFRESH_AFTER = 2 * 60 * 1000;   // labels ouder dan 2 minuten opnieuw ophalen (wijzigingen door anderen)
    const SELECTED_REFRESH = 4 * 1000;     // geopend ticket hooguit elke 4 seconden opnieuw ophalen
    const FOCUS_REFRESH = 30 * 1000;       // bij terugkeren naar het tabblad: labels ouder dan 30 seconden verversen
    const FORGET_AFTER = 30 * ONE_DAY;     // tickets die een maand niet gezien zijn vergeten
    const TOUCH_INTERVAL = ONE_HOUR;       // "laatst gezien" hooguit eens per uur bijwerken
    const BATCH_SIZE = 50;                 // aantal sleutels per zoekopdracht
    const FETCH_DELAY = 300;               // even wachten zodat sleutels gebundeld worden
    const ERROR_PAUSE = 60 * 1000;         // na een fout een minuut niets ophalen
    const CACHE_KEY = 'otclLabelCache.v1';
    const KEY_PATTERN = /^[A-Z][A-Z0-9_]*-\d+$/;

    let cache = loadCache();
    let saveTimer = null;
    const queue = new Set();
    const inFlight = new Set();
    let fetchTimer = null;
    let pausedUntil = 0;
    let lastError = null;

    function loadCache() {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            const data = raw ? JSON.parse(raw) : {};
            const now = Date.now();
            for (const key of Object.keys(data)) {
                const entry = data[key];
                const malformed = !entry || !Array.isArray(entry.labels)
                    || typeof entry.flagged !== 'boolean'
                    || typeof entry.lastFetched !== 'number' || typeof entry.lastSeen !== 'number';
                if (malformed || now - entry.lastSeen > FORGET_AFTER) delete data[key];
                else if (entry.dueDate === undefined) entry.lastFetched = 0; // cache van vóór v1.5.0: due date nog ophalen
            }
            return data;
        } catch (e) {
            console.debug(LOG_PREFIX, 'Cache lezen mislukt', e);
            return {};
        }
    }

    function scheduleSave() {
        if (saveTimer) return;
        saveTimer = setTimeout(() => {
            saveTimer = null;
            try {
                localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
            } catch (e) {
                console.debug(LOG_PREFIX, 'Cache opslaan mislukt', e);
            }
        }, 1000);
    }

    /**
     * Geeft de labels van een ticket uit de cache (of null als ze nog niet bekend zijn)
     * en zet het ticket in de wachtrij als de labels ontbreken of verouderd zijn.
     */
    function getLabels(key) {
        const entry = cache[key];
        const now = Date.now();
        if (!entry || now - entry.lastFetched > REFRESH_AFTER) requestLabels(key);
        if (!entry) return null;
        if (now - entry.lastSeen > TOUCH_INTERVAL) {
            entry.lastSeen = now;
            scheduleSave();
        }
        return entry.labels;
    }

    function requestLabels(key) {
        if (inFlight.has(key) || queue.has(key)) return;
        queue.add(key);
        scheduleFlush();
    }

    function scheduleFlush() {
        if (fetchTimer || !queue.size) return;
        fetchTimer = setTimeout(flushQueue, Math.max(FETCH_DELAY, pausedUntil - Date.now()));
    }

    async function flushQueue() {
        fetchTimer = null;
        if (Date.now() < pausedUntil) {
            scheduleFlush();
            return;
        }
        const keys = Array.from(queue).slice(0, BATCH_SIZE);
        keys.forEach(key => { queue.delete(key); inFlight.add(key); });
        if (!keys.length) return;

        try {
            const found = await searchLabels(keys);
            const now = Date.now();
            keys.forEach(key => {
                // Niet gevonden (verwijderd, verplaatst of geen rechten): onthouden als "geen labels"
                const data = found[key] || { labels: [], flagged: false, dueDate: null };
                cache[key] = { labels: data.labels, flagged: data.flagged, dueDate: data.dueDate, lastFetched: now, lastSeen: now };
            });
            lastError = null;
            scheduleSave();
            scheduleRun();
        } catch (err) {
            lastError = err;
            pausedUntil = Date.now() + (err.retryAfterMs || ERROR_PAUSE);
            console.debug(LOG_PREFIX, 'Labels ophalen mislukt, opnieuw na pauze', err);
        } finally {
            keys.forEach(key => inFlight.delete(key));
            scheduleFlush();
        }
    }

    // ---------------------------------------------------------------------
    // DIRECT VERVERSEN NA BEWERKEN
    // Opent, wisselt of sluit je een ticket, dan halen we de labels van dat
    // ticket meteen opnieuw op. Zo zie je een labelwijziging direct.
    // ---------------------------------------------------------------------
    let lastSelectedIssue = null;
    let lastSelectedRefresh = 0;
    const singleInFlight = new Set();

    function getSelectedIssue() {
        const fromQuery = new URLSearchParams(location.search).get(SELECTED_ISSUE_PARAM);
        if (fromQuery && KEY_PATTERN.test(fromQuery)) return fromQuery;
        const fromPath = location.pathname.match(BROWSE_PATH_PATTERN);
        return fromPath ? fromPath[1] : null;
    }

    function checkSelectedIssue() {
        const selected = getSelectedIssue();
        if (selected !== lastSelectedIssue) {
            if (lastSelectedIssue) refreshIssueNow(lastSelectedIssue); // net gesloten of gewisseld
            if (selected) refreshIssueNow(selected);
            lastSelectedIssue = selected;
            lastSelectedRefresh = Date.now();
        } else if (selected && Date.now() - lastSelectedRefresh > SELECTED_REFRESH) {
            // Ticket staat open en de pagina verandert (bijv. label opgeslagen)
            lastSelectedRefresh = Date.now();
            refreshIssueNow(selected);
        }
    }

    async function refreshIssueNow(key) {
        if (singleInFlight.has(key) || Date.now() < pausedUntil) return;
        singleInFlight.add(key);
        try {
            const response = await fetch(`${API.issue}${encodeURIComponent(key)}?fields=${FETCH_FIELDS}`, {
                credentials: 'same-origin',
                headers: { Accept: 'application/json' }
            });
            if (response.status === 404) return; // verwijderd of geen rechten
            if (!response.ok) throw new Error(`Jira API gaf status ${response.status}`);
            const data = await response.json();
            const { labels, flagged, dueDate } = readIssueFields(data.fields);
            const now = Date.now();
            const previous = cache[key];
            cache[key] = { labels, flagged, dueDate, lastFetched: now, lastSeen: now };
            scheduleSave();
            const changed = !previous || previous.flagged !== flagged || previous.dueDate !== dueDate
                || previous.labels.join('\u0001') !== labels.join('\u0001');
            if (changed) scheduleRun();
        } catch (err) {
            console.debug(LOG_PREFIX, `Direct verversen van ${key} mislukt`, err);
        } finally {
            singleInFlight.delete(key);
        }
    }

    /** Bij terugkeren naar het tabblad: labels die ouder zijn dan FOCUS_REFRESH als verouderd markeren. */
    function expireOnReturn() {
        const threshold = Date.now() - FOCUS_REFRESH;
        for (const entry of Object.values(cache)) {
            if (entry.lastFetched < threshold) entry.lastFetched = 0;
        }
        scheduleRun();
    }

    /** Haalt labels, vlag en due date uit de velden die Jira teruggeeft. */
    function readIssueFields(fields) {
        const labels = fields && Array.isArray(fields.labels) ? fields.labels : [];
        const flag = fields && fields[FLAGGED_FIELD];
        const flagged = Array.isArray(flag) ? flag.length > 0 : Boolean(flag);
        const dueDate = (fields && fields.duedate) || null;
        return { labels, flagged, dueDate };
    }

    /** Vlag van een ticket uit de cache (null als nog onbekend). */
    function getFlagged(key) {
        const entry = cache[key];
        return entry ? entry.flagged : null;
    }

    /** Haalt de labels van meerdere tickets op met één JQL-zoekopdracht. */
    async function searchLabels(keys) {
        const result = {};
        const jql = `key in (${keys.join(',')})`;
        let nextPageToken;
        do {
            const params = new URLSearchParams({ jql, fields: FETCH_FIELDS, maxResults: '100' });
            if (nextPageToken) params.set('nextPageToken', nextPageToken);
            const response = await fetch(`${API.search}?${params}`, {
                credentials: 'same-origin',
                headers: { Accept: 'application/json' }
            });
            if (!response.ok) {
                const err = new Error(`Jira API gaf status ${response.status}`);
                err.status = response.status;
                if (response.status === 429) {
                    const retryAfter = parseInt(response.headers.get('Retry-After'), 10);
                    err.retryAfterMs = (Number.isFinite(retryAfter) ? retryAfter : 60) * 1000;
                }
                throw err;
            }
            const data = await response.json();
            (data.issues || []).forEach(issue => {
                if (issue && issue.key) result[issue.key] = readIssueFields(issue.fields);
            });
            nextPageToken = data.isLast === false ? data.nextPageToken : undefined;
        } while (nextPageToken);
        return result;
    }

    // =====================================================================
    // BADGES MAKEN
    // =====================================================================
    function formatDateText(raw) {
        const text = raw.replace(/^[\s:_-]+/, '').trim();
        const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return iso ? `${iso[3]}-${iso[2]}-${iso[1]}` : text;
    }

    /** Het datumlabel-type van een label, of undefined. Er moet iets achter het voorvoegsel staan. */
    function findDateLabelDef(label) {
        const lower = label.toLowerCase();
        return DATE_PREFIX_LABELS.find(def => lower.length > def.prefix.length && lower.startsWith(def.prefix));
    }

    /** Bepaalt icoon, tekst, opmaak en volgorde van één label. compact = kortere tekst voor koppen. */
    function describeLabel(label, compact) {
        const lower = label.toLowerCase();
        const def = findDateLabelDef(label);
        if (def) {
            const rest = formatDateText(label.slice(def.prefix.length));
            const text = compact ? (rest || def.title) : `${def.title}${rest ? ' ' + rest : ''}`;
            return { icon: def.icon, text, cls: def.cls, order: 0 };
        }
        const special = SPECIAL_LABELS[lower];
        if (special) {
            const text = (compact && special.short) || special.text || label;
            return { icon: special.icon, text, cls: special.cls, order: 1 };
        }
        return { icon: '', text: label, cls: '', order: 2 };
    }

    function createBadge(label, compact) {
        const info = describeLabel(label, compact);
        const badge = document.createElement('span');
        badge.className = info.cls ? `otcl-badge ${info.cls}` : 'otcl-badge';
        badge.title = label;
        if (info.icon) {
            const icon = document.createElement('span');
            icon.className = 'otcl-badge__icon';
            icon.textContent = info.icon;
            badge.appendChild(icon);
        }
        const text = document.createElement('span');
        text.className = 'otcl-badge__text';
        text.textContent = info.text;
        badge.appendChild(text);
        return { badge, order: info.order };
    }

    function isDateLabel(label) {
        return Boolean(findDateLabelDef(label));
    }

    /** Welke labels in welk vak komen. row-lead = vóór de titel, row-tail = achter de titel. */
    function labelsForMode(labels, mode) {
        const visible = labels.filter(label => !HIDDEN_LABELS.has(label.toLowerCase()));
        if (mode === 'row-lead') return visible.filter(isDateLabel);
        if (mode === 'row-tail') return visible.filter(label => !isDateLabel(label));
        return visible;
    }

    /**
     * Zorgt dat er precies één badge-container per vak (mode) in `parent` staat, op de
     * juiste plek en met de juiste labels. Doet niets als alles al klopt (voorkomt
     * dubbele badges en eindeloze herhaling).
     */
    function upsertBadges(parent, placement, key, labels, mode) {
        const existing = parent.querySelector(`:scope > .otcl-badges--${mode}`);
        if (labels === null) {
            // Labels nog niet binnen: alleen badges van een ánder ticket opruimen (hergebruikt element)
            if (existing && existing.dataset.otclKey !== key) existing.remove();
            return;
        }
        const visible = labelsForMode(labels, mode);
        if (!visible.length) {
            if (existing) existing.remove();
            return;
        }

        const signature = `${key}|${visible.join('\u0001')}`;
        const container = existing || document.createElement('span');
        if (container.dataset.otclSig !== signature) {
            container.className = `otcl-badges otcl-badges--${mode}`;
            container.dataset.otclKey = key;
            container.dataset.otclSig = signature;
            const badges = visible
                .map(label => createBadge(label, mode === 'header'))
                .sort((a, b) => a.order - b.order)
                .map(item => item.badge);
            container.replaceChildren(...badges);
        }

        if (placement.after && placement.after.nextSibling !== container) {
            parent.insertBefore(container, placement.after.nextSibling);
        } else if (placement.before && container.nextSibling !== placement.before) {
            parent.insertBefore(container, placement.before);
        }
    }

    function removeBadges(parent) {
        parent.querySelectorAll(':scope > .otcl-badges').forEach(el => el.remove());
    }

    /** Haalt alles weg wat het script aan de pagina heeft toegevoegd (behalve het tandwiel). */
    function clearPage() {
        document.querySelectorAll('.otcl-badges, .otcl-divider-overlay').forEach(el => el.remove());
        ['otcl-card-on-hold', 'otcl-flagged', 'otcl-divider-host'].forEach(cls => {
            document.querySelectorAll(`.${cls}`).forEach(el => el.classList.remove(cls));
        });
    }

    // =====================================================================
    // VERWERKING PER ONDERDEEL
    // =====================================================================
    function processSwimlaneHeaders() {
        document.querySelectorAll(SELECTORS.swimlane).forEach(lane => {
            const summary = lane.querySelector(SELECTORS.swimlaneSummary);
            const anchor = summary && summary.parentElement;
            const heading = anchor && anchor.parentElement;
            if (!heading) return; // bijv. de swimlane "Everything else"
            const keyElement = heading.querySelector(SELECTORS.swimlaneKey);
            const key = keyElement ? keyElement.textContent.trim() : '';
            if (!KEY_PATTERN.test(key)) {
                removeBadges(heading);
                return;
            }
            upsertBadges(heading, { after: anchor }, key, getLabels(key), 'header');
        });
    }

    function processBoardCards() {
        document.querySelectorAll(SELECTORS.boardCard).forEach(card => {
            const key = card.id.slice(SELECTORS.boardCardIdPrefix.length);
            if (!KEY_PATTERN.test(key)) return;
            const footer = card.querySelector(SELECTORS.boardCardFooter);
            const column = footer && footer.parentElement;
            if (!column) return;

            const labels = getLabels(key);
            // Badges als eigen regel tussen de titel en de voettekst (sleutel/avatar)
            upsertBadges(column, { before: footer }, key, labels, 'card');

            const onHold = FEATURES.onHoldDimsCard && Array.isArray(labels)
                && labels.some(label => label.toLowerCase() === 'on-hold');
            if (card.classList.contains('otcl-card-on-hold') !== onHold) {
                card.classList.toggle('otcl-card-on-hold', onHold);
            }
        });
    }

    function processBacklogRows() {
        document.querySelectorAll(SELECTORS.backlogRow).forEach(row => {
            const key = (row.getAttribute('data-testid') || '').slice(SELECTORS.backlogRowKeyPrefix.length);
            if (!KEY_PATTERN.test(key)) return;
            const container = row.querySelector(SELECTORS.backlogCardContainer);
            const summary = container && container.querySelector(SELECTORS.backlogSummary);
            // Het vak rond de titel is een flex-rij; daar plaatsen we de badges in
            // (de regel zelf is een CSS-grid, daar voegen we niets aan toe).
            const summaryBox = summary && summary.parentElement;
            if (!summaryBox) return;

            const labels = getLabels(key);
            const isDivider = FEATURES.backlogDividers && Array.isArray(labels)
                && labels.some(label => label.toLowerCase() === DIVIDER_LABEL);

            applyDivider(container, key, isDivider);

            // Vlag: Jira kleurt de regel in de backlog roze; wij maken het geel zoals op het bord
            const flagged = FEATURES.flaggedYellow && getFlagged(key) === true && !isDivider;
            if (container.classList.contains('otcl-flagged') !== flagged) {
                container.classList.toggle('otcl-flagged', flagged);
            }

            applyDueDateStyle(row, key);

            if (FEATURES.backlogRows && !isDivider) {
                upsertBadges(summaryBox, { before: summary }, key, labels, 'row-lead');
                upsertBadges(summaryBox, { after: summary }, key, labels, 'row-tail');
            } else {
                removeBadges(summaryBox);
            }
        });
    }

    /** CSS-klasse voor het due date-veld van een ticket, of null (geen due date of geen passende regel). */
    function dueDateClass(key) {
        const entry = cache[key];
        if (!FEATURES.dueDateColors || !entry || !entry.dueDate) return null;
        const labels = entry.labels.map(label => label.toLowerCase());
        const rule = DUE_DATE_RULES.find(r => labels.includes(r.label.toLowerCase()));
        return rule ? rule.cls : null;
    }

    /**
     * Zet het kader om het due date-veld binnen `root`. Elementen die Jira hergebruikt
     * voor een ander ticket worden ook weer opgeschoond.
     */
    function applyDueDateStyle(root, key) {
        const wanted = dueDateClass(key);
        root.querySelectorAll(SELECTORS.dueDate).forEach(field => {
            DUE_DATE_CLASSES.forEach(cls => {
                const on = cls === wanted;
                if (field.classList.contains(cls) !== on) field.classList.toggle(cls, on);
            });
        });
    }

    /**
     * Divider: de regel behoudt zijn hoogte en blijft sleepbaar en klikbaar.
     * De inhoud wordt onzichtbaar gemaakt en er komt een lijn met de titel overheen.
     */
    function applyDivider(container, key, isDivider) {
        let overlay = container.querySelector(':scope > .otcl-divider-overlay');
        if (!isDivider) {
            container.classList.remove('otcl-divider-host');
            if (overlay) overlay.remove();
            return;
        }
        const textElement = container.querySelector(SELECTORS.backlogSummaryText);
        const text = (textElement && textElement.textContent.trim()) || key;
        if (!container.classList.contains('otcl-divider-host')) container.classList.add('otcl-divider-host');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'otcl-divider-overlay';
            overlay.appendChild(document.createElement('span'));
            container.appendChild(overlay);
        }
        if (overlay.dataset.otclKey !== key || overlay.firstChild.textContent !== text) {
            overlay.dataset.otclKey = key;
            overlay.firstChild.textContent = text;
        }
    }

    // =====================================================================
    // INSTELLINGENVENSTER: tandwiel rechtsonder, per gebruiker aan/uit
    // =====================================================================
    function applySetting(key, value) {
        FEATURES[key] = value;
        saveSettings();
        clearPage();
        scheduleRun();
    }

    function createSettingsUi() {
        if (document.querySelector('.otcl-settings-button')) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'otcl-settings-button';
        button.title = 'Instellingen OT label badges';
        button.setAttribute('aria-label', 'Instellingen OT label badges');
        button.setAttribute('aria-expanded', 'false');
        button.textContent = '⚙';

        const panel = document.createElement('div');
        panel.className = 'otcl-settings-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Instellingen OT label badges');
        panel.hidden = true;

        const header = document.createElement('div');
        header.className = 'otcl-settings-header';
        const title = document.createElement('strong');
        title.textContent = 'OT label badges';
        const version = document.createElement('span');
        version.className = 'otcl-settings-version';
        version.textContent = `v${SCRIPT_VERSION}`;
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'otcl-settings-close';
        close.setAttribute('aria-label', 'Sluiten');
        close.textContent = '×';
        header.append(title, version, close);

        const intro = document.createElement('p');
        intro.className = 'otcl-settings-intro';
        intro.textContent = 'Zet onderdelen aan of uit. Je keuze geldt alleen voor jou, in deze browser.';

        const list = document.createElement('div');
        list.className = 'otcl-settings-list';
        const checkboxes = {};
        FEATURE_INFO.forEach(info => {
            const row = document.createElement('label');
            row.className = 'otcl-settings-row';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = FEATURES[info.key];
            checkbox.addEventListener('change', () => applySetting(info.key, checkbox.checked));
            checkboxes[info.key] = checkbox;
            const text = document.createElement('span');
            text.className = 'otcl-settings-text';
            const name = document.createElement('span');
            name.className = 'otcl-settings-name';
            name.textContent = info.title;
            const help = document.createElement('span');
            help.className = 'otcl-settings-help';
            help.textContent = info.help;
            text.append(name, help);
            row.append(checkbox, text);
            list.appendChild(row);
        });

        const footer = document.createElement('div');
        footer.className = 'otcl-settings-footer';
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'otcl-settings-reset';
        reset.textContent = 'Standaard herstellen';
        reset.addEventListener('click', () => {
            Object.assign(FEATURES, DEFAULT_FEATURES);
            Object.keys(checkboxes).forEach(key => { checkboxes[key].checked = FEATURES[key]; });
            saveSettings();
            clearPage();
            scheduleRun();
        });
        footer.appendChild(reset);

        panel.append(header, intro, list, footer);

        function setOpen(open) {
            panel.hidden = !open;
            button.setAttribute('aria-expanded', String(open));
            button.classList.toggle('otcl-settings-button--open', open);
        }
        button.addEventListener('click', () => setOpen(panel.hidden));
        close.addEventListener('click', () => setOpen(false));
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !panel.hidden) setOpen(false);
        });
        document.addEventListener('mousedown', event => {
            if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) setOpen(false);
        });
        // Toetsen in het venster niet doorgeven aan Jira (sneltoetsen)
        panel.addEventListener('keydown', event => {
            event.stopPropagation();
            if (event.key === 'Escape') {
                setOpen(false);
                button.focus();
            }
        });

        document.body.append(panel, button);
        return setOpen;
    }

    // =====================================================================
    // CSS (alleen eigen klassen met prefix "otcl-")
    // =====================================================================
    function injectStyles() {
        if (document.getElementById('otcl-styles')) return;
        const style = document.createElement('style');
        style.id = 'otcl-styles';
        style.textContent = `
            .otcl-badges {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                flex-shrink: 0;
                flex-wrap: nowrap;
                vertical-align: middle;
                pointer-events: none;
            }
            .otcl-badges--header {
                flex-wrap: wrap;
                margin-left: 8px;
                max-width: 450px;
            }
            .otcl-badges--card {
                display: flex;
                flex-wrap: wrap;
                margin: 4px 0 6px;
            }
            .otcl-card-on-hold { opacity: 0.7; }
            .otcl-badges--row-lead,
            .otcl-badges--row-tail {
                overflow: hidden;
            }
            .otcl-badges--row-lead {
                margin-right: 6px;
                max-width: 35%;
            }
            .otcl-badges--row-tail {
                margin: 0 8px 0 auto;
                padding-left: 8px;
                max-width: 40%;
            }
            /* Stijl "Tag" in lijn met Jira Cloud (Atlassian Design System-kleuren,
               met vaste kleuren als terugval; past zich aan in donkere modus) */
            .otcl-badge {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                box-sizing: border-box;
                height: 20px;
                padding: 0 6px;
                border-radius: 4px;
                background: var(--ds-background-neutral, #091e420f);
                color: var(--ds-text, #172b4d);
                font-family: inherit;
                font-size: 12px;
                font-weight: 500;
                line-height: 20px;
                white-space: nowrap;
            }
            .otcl-badge__icon { font-size: 11px; line-height: 1; }
            .otcl-badge--deadline {
                background: var(--ds-background-accent-blue-subtlest, #e9f2ff);
                color: var(--ds-text-accent-blue, #0055cc);
            }
            .otcl-badge--overleg {
                background: var(--ds-background-accent-purple-subtlest, #f3f0ff);
                color: var(--ds-text-accent-purple, #5e4db2);
            }
            .otcl-badge--cross-refinement {
                background: var(--ds-background-accent-green-subtlest, #dcfff1);
                color: var(--ds-text-accent-green, #216e4e);
            }
            .otcl-badge--research {
                background: var(--ds-background-accent-teal-subtlest, #e7f9ff);
                color: var(--ds-text-accent-teal, #206a83);
            }
            .otcl-badge--on-hold {
                background: var(--ds-background-accent-yellow-subtlest, #fff7d6);
                color: var(--ds-text-accent-yellow, #7f5f01);
            }
            .otcl-badge--time-critical {
                background: var(--ds-background-accent-orange-subtler, #fedec8);
                color: var(--ds-text-accent-orange, #a54800);
                font-weight: 600;
            }
            .otcl-badge--hotfix {
                background: var(--ds-background-accent-red-subtler, #ffd5d2);
                color: var(--ds-text-accent-red, #ae2e24);
                font-weight: 600;
            }
            .otcl-badge--urgent {
                background: var(--ds-background-danger-bold, #c9372c);
                color: var(--ds-text-inverse, #ffffff);
                font-weight: 600;
            }

            /* Kader om het standaard due date-veld (zie DUE_DATE_RULES). Jira's eigen
               rand van 1px wordt gekleurd en met een schaduw naar binnen 2px dik
               gemaakt: zo verschuift er niets. */
            .otcl-due--purple {
                border-color: var(--ds-border-accent-purple, #8f7ee7) !important;
                box-shadow: inset 0 0 0 1px var(--ds-border-accent-purple, #8f7ee7);
            }

            /* Geflagd: zelfde geel als Jira op het bord gebruikt (token background.warning) */
            .otcl-flagged {
                background-color: var(--ds-background-warning, #fff5db) !important;
            }
            .otcl-flagged:hover {
                background-color: var(--ds-background-warning-hovered, #ffe2a8) !important;
            }

            .otcl-divider-host { position: relative; }
            .otcl-divider-host > :not(.otcl-divider-overlay):not(${SELECTORS.backlogClickLayer}) {
                visibility: hidden;
            }
            .otcl-divider-overlay {
                position: absolute;
                inset: 0;
                z-index: 1;
                display: flex;
                align-items: center;
                justify-content: center;
                pointer-events: none;
            }
            .otcl-divider-overlay::before {
                content: '';
                position: absolute;
                left: 8px;
                right: 8px;
                top: 50%;
                height: 1px;
                background: var(--ds-border, #c1c7d0);
            }
            .otcl-divider-overlay > span {
                position: relative;
                max-width: 80%;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                padding: 1px 14px;
                border: 1px solid var(--ds-border, #dfe1e6);
                border-radius: 10px;
                background: var(--ds-surface-sunken, #f4f5f7);
                color: var(--ds-text-subtlest, #6b778c);
                font-size: 12px;
                font-weight: 600;
            }

            /* Instellingen: tandwiel rechtsonder en venster erboven */
            .otcl-settings-button {
                position: fixed;
                right: 16px;
                bottom: 16px;
                z-index: 2147483000;
                width: 36px;
                height: 36px;
                padding: 0;
                border: 1px solid var(--ds-border, #dfe1e6);
                border-radius: 50%;
                background: var(--ds-surface-overlay, #ffffff);
                color: var(--ds-icon-subtle, #626f86);
                box-shadow: var(--ds-shadow-raised, 0 1px 2px #091e423f);
                font-size: 20px;
                line-height: 34px;
                text-align: center;
                cursor: pointer;
                opacity: 0.6;
                transition: opacity 0.15s, transform 0.3s;
            }
            .otcl-settings-button:hover,
            .otcl-settings-button:focus-visible,
            .otcl-settings-button--open {
                opacity: 1;
                color: var(--ds-icon, #44546f);
            }
            .otcl-settings-button--open { transform: rotate(60deg); }
            .otcl-settings-button:focus-visible {
                outline: 2px solid var(--ds-border-focused, #388bff);
                outline-offset: 2px;
            }
            .otcl-settings-panel {
                position: fixed;
                right: 16px;
                bottom: 60px;
                z-index: 2147483000;
                box-sizing: border-box;
                width: 360px;
                max-width: calc(100vw - 32px);
                max-height: calc(100vh - 80px);
                overflow-y: auto;
                padding: 12px 16px;
                border-radius: 8px;
                background: var(--ds-surface-overlay, #ffffff);
                color: var(--ds-text, #172b4d);
                box-shadow: var(--ds-shadow-overlay, 0 8px 12px #091e4226, 0 0 1px #091e424f);
                font-size: 14px;
                line-height: 20px;
            }
            .otcl-settings-panel[hidden] { display: none; }
            .otcl-settings-header {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .otcl-settings-version {
                color: var(--ds-text-subtlest, #626f86);
                font-size: 12px;
            }
            .otcl-settings-close {
                margin-left: auto;
                padding: 0 6px;
                border: none;
                border-radius: 4px;
                background: none;
                color: var(--ds-icon-subtle, #626f86);
                font-size: 20px;
                line-height: 24px;
                cursor: pointer;
            }
            .otcl-settings-close:hover { background: var(--ds-background-neutral-subtle-hovered, #091e420f); }
            .otcl-settings-intro {
                margin: 4px 0 8px;
                color: var(--ds-text-subtle, #44546f);
                font-size: 12px;
            }
            .otcl-settings-row {
                display: flex;
                align-items: flex-start;
                gap: 10px;
                padding: 8px 6px;
                border-radius: 4px;
                cursor: pointer;
            }
            .otcl-settings-row:hover { background: var(--ds-background-neutral-subtle-hovered, #091e420f); }
            .otcl-settings-row input {
                flex-shrink: 0;
                width: 16px;
                height: 16px;
                margin: 2px 0 0;
                accent-color: var(--ds-background-brand-bold, #0c66e4);
                cursor: pointer;
            }
            .otcl-settings-text {
                display: flex;
                flex-direction: column;
                gap: 2px;
            }
            .otcl-settings-name { font-weight: 600; }
            .otcl-settings-help {
                color: var(--ds-text-subtle, #44546f);
                font-size: 12px;
                line-height: 16px;
            }
            .otcl-settings-footer {
                display: flex;
                justify-content: flex-end;
                margin-top: 8px;
                padding-top: 8px;
                border-top: 1px solid var(--ds-border, #091e4224);
            }
            .otcl-settings-reset {
                padding: 4px 10px;
                border: none;
                border-radius: 4px;
                background: var(--ds-background-neutral, #091e420f);
                color: var(--ds-text, #172b4d);
                font: inherit;
                font-size: 13px;
                cursor: pointer;
            }
            .otcl-settings-reset:hover { background: var(--ds-background-neutral-hovered, #091e4224); }
        `;
        document.head.appendChild(style);
    }

    // =====================================================================
    // HOOFDLUS: Jira Cloud is een single-page app; we reageren op elke
    // wijziging in de pagina (gebundeld) en werken alles idempotent bij.
    // =====================================================================
    function run() {
        try {
            checkSelectedIssue();
        } catch (e) {
            console.debug(LOG_PREFIX, 'Fout bij controleren geopend ticket', e);
        }
        try {
            if (FEATURES.swimlaneHeaders) processSwimlaneHeaders();
        } catch (e) {
            console.debug(LOG_PREFIX, 'Fout bij swimlane-koppen', e);
        }
        try {
            if (FEATURES.boardCards) processBoardCards();
        } catch (e) {
            console.debug(LOG_PREFIX, 'Fout bij bordkaarten', e);
        }
        try {
            if (FEATURES.backlogRows || FEATURES.backlogDividers || FEATURES.flaggedYellow) processBacklogRows();
        } catch (e) {
            console.debug(LOG_PREFIX, 'Fout bij backlog-regels', e);
        }
    }

    let runTimer = null;
    function scheduleRun() {
        if (runTimer) return;
        runTimer = setTimeout(() => {
            runTimer = null;
            run();
        }, 150);
    }

    function isOwnNode(node) {
        return node.nodeType === 1 && typeof node.className === 'string' && node.className.indexOf('otcl-') !== -1;
    }

    function isOwnMutation(mutation) {
        if (mutation.type !== 'childList') return false;
        const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
        return nodes.length > 0 && nodes.every(isOwnNode);
    }

    injectStyles();
    const setSettingsOpen = createSettingsUi();
    new MutationObserver(mutations => {
        if (mutations.every(isOwnMutation)) return;
        scheduleRun();
    }).observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['data-testid']
    });
    // Terug in dit tabblad (bijv. na bewerken in een ander tabblad): labels verversen
    window.addEventListener('focus', expireOnReturn);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') expireOnReturn();
    });
    // Eens per minuut controleren of labels ververst moeten worden (alleen als het tabblad zichtbaar is)
    setInterval(() => {
        if (document.visibilityState === 'visible') scheduleRun();
    }, 60 * 1000);
    scheduleRun();

    // Hulpje voor de console: typ otclLabels.status() om te zien wat het script doet
    window.otclLabels = {
        version: SCRIPT_VERSION,
        status() {
            const info = {
                versie: SCRIPT_VERSION,
                swimlaneKoppenGevonden: document.querySelectorAll(SELECTORS.swimlane).length,
                bordkaartenGevonden: document.querySelectorAll(SELECTORS.boardCard).length,
                backlogRegelsGevonden: document.querySelectorAll(SELECTORS.backlogRow).length,
                badgesOpPagina: document.querySelectorAll('.otcl-badges').length,
                dividersOpPagina: document.querySelectorAll('.otcl-divider-overlay').length,
                dueDateVeldenGevonden: document.querySelectorAll(SELECTORS.dueDate).length,
                dueDateKaders: document.querySelectorAll(DUE_DATE_CLASSES.map(cls => '.' + cls).join(',') || 'none').length,
                ticketsInCache: Object.keys(cache).length,
                inWachtrij: queue.size,
                geopendTicket: lastSelectedIssue,
                laatsteFout: lastError ? String(lastError.message || lastError) : null,
                instellingen: JSON.stringify(FEATURES)
            };
            console.table(info);
            return info;
        },
        settings() {
            if (setSettingsOpen) setSettingsOpen(true);
        },
        clearCache() {
            cache = {};
            try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* stil */ }
            scheduleRun();
            return 'Cache gewist; labels worden opnieuw opgehaald.';
        }
    };
})();
