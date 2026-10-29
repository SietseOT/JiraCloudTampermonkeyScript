// ==UserScript==
// @name         Jira Cloud - OT label badges
// @namespace    https://onderwijstransparant.nl/
// @version      1.5.0
// @description  Toont labels als badges in swimlane-koppen (Group: Story), op bordkaarten en in backlog-regels op Jira Cloud, inclusief divider-regels. Klapt in statusvensters "Log Work" open met alleen Time Spent. Wijzigt nooit zelf tickets.
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
    // INSTELLINGEN: zet een onderdeel op false om het uit te schakelen.
    // =====================================================================
    const FEATURES = {
        swimlaneHeaders: true,   // labels in de koppen van swimlanes (bord, Group: Story)
        boardCards: true,        // labels op de kaarten van het bord (bijv. subtaken)
        onHoldDimsCard: true,    // kaart met label "on-hold" iets doorzichtig maken (zoals het oude script)
        backlogRows: true,       // labels in de regel van een ticket in de backlog
        backlogDividers: true,   // ticket met label "divider" als scheidingslijn in de backlog
        flaggedYellow: true,     // geflagd ticket in de backlog geel i.p.v. roze (zoals Jira het op het bord al doet)
        logWorkTimeSpentOnly: true // transitievenster: "Log Work" direct open, alleen Time Spent zichtbaar
    };

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

        // Transitievenster (status wijzigen): sectie "Log Work". Herkend aan data-testid,
        // dus onafhankelijk van de taal van de gebruiker. Eindigt-op ($=) zodat het
        // ook werkt als Jira het voorvoegsel per venster (ticket, bord, lijst) anders noemt.
        worklogSection: '[data-testid$=".field.worklog"]',
        worklogToggle: 'button[aria-expanded]',
        worklogTimeSpent: '[data-testid$="log-work-time-spent"]',
        worklogTimeRemaining: '[data-testid$="log-work-time-remaining"]',
        worklogDateStarted: '[data-testid$="log-work-date-field"]',
        // Link "Learn about logging work"; het blok eromheen bevat ook de uitlegtekst
        worklogHelpLink: 'a[href*="TimeTrackingHelp"]'
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
    const FETCH_FIELDS = `labels,${FLAGGED_FIELD}`;

    // Welk ticket staat open? Jira zet dit in de adresbalk (?selectedIssue=OT-9 of /browse/OT-9)
    const SELECTED_ISSUE_PARAM = 'selectedIssue';
    const BROWSE_PATH_PATTERN = /\/browse\/([A-Z][A-Z0-9_]*-\d+)/;

    // =====================================================================
    // LABELWEERGAVE
    // =====================================================================
    // Labels met een datum erachter, bijv. "deadline:2026-10-12" of "overleg-15-03-2026"
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
    const HIDDEN_LABELS = new Set(['divider', 'small', 'medium', 'large', 'geen-punten', 'onduidelijk-punten']);
    const DIVIDER_LABEL = 'divider';

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
                const data = found[key] || { labels: [], flagged: false };
                cache[key] = { labels: data.labels, flagged: data.flagged, lastFetched: now, lastSeen: now };
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
            const { labels, flagged } = readIssueFields(data.fields);
            const now = Date.now();
            const previous = cache[key];
            cache[key] = { labels, flagged, lastFetched: now, lastSeen: now };
            scheduleSave();
            const changed = !previous || previous.flagged !== flagged
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

    /** Haalt labels en vlag uit de velden die Jira teruggeeft. */
    function readIssueFields(fields) {
        const labels = fields && Array.isArray(fields.labels) ? fields.labels : [];
        const flag = fields && fields[FLAGGED_FIELD];
        const flagged = Array.isArray(flag) ? flag.length > 0 : Boolean(flag);
        return { labels, flagged };
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

    /** Bepaalt icoon, tekst, opmaak en volgorde van één label. compact = kortere tekst voor koppen. */
    function describeLabel(label, compact) {
        const lower = label.toLowerCase();
        for (const def of DATE_PREFIX_LABELS) {
            if (lower.startsWith(def.prefix)) {
                const rest = formatDateText(label.slice(def.prefix.length));
                const text = compact ? (rest || def.title) : `${def.title}${rest ? ' ' + rest : ''}`;
                return { icon: def.icon, text, cls: def.cls, order: 0 };
            }
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
        const lower = label.toLowerCase();
        return DATE_PREFIX_LABELS.some(def => lower.startsWith(def.prefix));
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

            if (FEATURES.backlogRows && !isDivider) {
                upsertBadges(summaryBox, { before: summary }, key, labels, 'row-lead');
                upsertBadges(summaryBox, { after: summary }, key, labels, 'row-tail');
            } else {
                removeBadges(summaryBox);
            }
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
    // TRANSITIEVENSTER: LOG WORK
    // In elk statusvenster met een sectie "Log Work" klappen we die sectie
    // automatisch open en tonen we alleen het veld Time Spent. Time Remaining
    // en Date Started blijven gewoon in het formulier (met Jira's standaard-
    // waarden), ze zijn alleen onzichtbaar. Werkt in elk venster, ongeacht
    // waar het geopend wordt (ticket, paneel, bord, lijst, zoekresultaten).
    // =====================================================================
    const WORKLOG_MAX_CLICKS = 3;   // nooit eindeloos blijven klikken als openklappen niet lukt

    function processLogWork() {
        document.querySelectorAll(SELECTORS.worklogSection).forEach(section => {
            if (!section.classList.contains('otcl-worklog')) section.classList.add('otcl-worklog');

            // Uitlegtekst en link "Learn about logging work" zitten samen in één blok
            const helpLink = section.querySelector(SELECTORS.worklogHelpLink);
            const helpBlock = helpLink && closestChildOf(section, helpLink);
            if (helpBlock && !helpBlock.classList.contains('otcl-worklog-hidden')) {
                helpBlock.classList.add('otcl-worklog-hidden');
            }

            const toggle = section.querySelector(SELECTORS.worklogToggle);
            if (!toggle) return;
            const open = toggle.getAttribute('aria-expanded') === 'true';
            const clicks = Number(section.dataset.otclClicks || 0);
            if (!open && clicks < WORKLOG_MAX_CLICKS) {
                section.dataset.otclClicks = String(clicks + 1);
                toggle.click();
                return; // na het openklappen volgt een nieuwe ronde
            }

            // Kop met de in-/uitklapknop pas verbergen als de sectie echt open is,
            // zodat je bij een mislukte klik nog zelf kunt openklappen.
            // De kop is de knop met de tekst "Log Work" ernaast; bevat die ook het veld, dan alleen de knop.
            const header = toggle.parentElement.querySelector(SELECTORS.worklogTimeSpent) ? toggle : toggle.parentElement;
            if (header.classList.contains('otcl-worklog-hidden') !== open) {
                header.classList.toggle('otcl-worklog-hidden', open);
            }
            [SELECTORS.worklogTimeRemaining, SELECTORS.worklogDateStarted].forEach(selector => {
                const field = section.querySelector(selector);
                if (field && !field.classList.contains('otcl-worklog-hidden')) field.classList.add('otcl-worklog-hidden');
            });
        });
    }

    /** Het kind van `ancestor` waarbinnen `node` ligt (of null). */
    function closestChildOf(ancestor, node) {
        let current = node;
        while (current && current.parentElement !== ancestor) current = current.parentElement;
        return current;
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

            /* Geflagd: zelfde geel als Jira op het bord gebruikt (token background.warning) */
            .otcl-flagged {
                background-color: var(--ds-background-warning, #fff5db) !important;
            }
            .otcl-flagged:hover {
                background-color: var(--ds-background-warning-hovered, #ffe2a8) !important;
            }

            /* Transitievenster: onderdelen van "Log Work" verbergen (blijven in het formulier) */
            .otcl-worklog .otcl-worklog-hidden { display: none !important; }

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
            if (FEATURES.backlogRows || FEATURES.backlogDividers) processBacklogRows();
        } catch (e) {
            console.debug(LOG_PREFIX, 'Fout bij backlog-regels', e);
        }
        try {
            if (FEATURES.logWorkTimeSpentOnly) processLogWork();
        } catch (e) {
            console.debug(LOG_PREFIX, 'Fout bij Log Work in transitievenster', e);
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
                logWorkSectiesGevonden: document.querySelectorAll(SELECTORS.worklogSection).length,
                ticketsInCache: Object.keys(cache).length,
                inWachtrij: queue.size,
                geopendTicket: lastSelectedIssue,
                laatsteFout: lastError ? String(lastError.message || lastError) : null
            };
            console.table(info);
            return info;
        },
        clearCache() {
            cache = {};
            try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* stil */ }
            scheduleRun();
            return 'Cache gewist; labels worden opnieuw opgehaald.';
        }
    };
})();
