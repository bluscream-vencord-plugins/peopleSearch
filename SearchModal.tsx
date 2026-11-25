/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { BaseText } from "@components/BaseText";
import ErrorBoundary from "@components/ErrorBoundary";
import { classNameFactory } from "@utils/css";
import { proxyLazy } from "@utils/lazy";
import { useIntersection } from "@utils/react";
import { formatDurationMs } from "@utils/text";
import { chooseFile } from "@utils/web";
import { ModalAction, RenderModalProps } from "@vencord/discord-types";
import { Alerts, GuildStore, lodash, Modal, openModal, ScrollerThin, showToast, TextInput, useEffect, useMemo, useRef, useState } from "@webpack/common";
import type { ClipboardEvent, DragEvent, KeyboardEvent } from "react";

import { AvatarGrid } from "./AvatarGrid";
import { HASH_MS, hashAvatars, hashFile, hashToText, MAX_HASHES_PER_RUN, missingHashes, plainTiles, similarTiles, Tile } from "./avatarHash";
import { checkMembers, fetchBios, loadMembers, MAX_PROFILES_PER_RUN, profileDelayMs, stopJob } from "./jobs";
import { guildToken } from "./people";
import { checkCount, describePlan, emptyText, makePlan, statusLine } from "./plan";
import { QueryBuilder } from "./QueryBuilder";
import { setValue } from "./queryEdit";
import { ResultRow } from "./ResultRow";
import { ResultsHeader, useView } from "./ResultsHeader";
import { EMPTY_QUERY, matchesAll, matchesName, parseQuery } from "./search";
import { settings } from "./settings";
import { FetchModes, logger, useJob } from "./state";
import { getSuggestions, Suggestion, SuggestionList } from "./Suggestions";

const cl = classNameFactory("vc-people-search-");
const PAGE_SIZE = 50;
const GRID_PAGE_SIZE = 300;
const HISTORY_KEYS: ["history"] = ["history"];
const FETCH_KEYS: ["fetchMode", "cacheDays"] = ["fetchMode", "cacheDays"];
const SUGGEST_ID = "vc-people-search-suggest";

const CONFIRM_FETCH_ABOVE = 200;
const CONFIRM_HASH_ABOVE = 3000;
const HISTORY_SIZE = 5;

const saveState = proxyLazy(() => lodash.debounce((lastQuery: string, showFilters: boolean) => {
    settings.store.lastQuery = lastQuery;
    settings.store.showFilters = showFilters;
}, 1000));

function addToHistory(query: string) {
    const entry = query.trim();
    if (!entry) return;
    const history = (settings.store.history ?? []).filter(h => h !== entry && !entry.startsWith(h));
    settings.store.history = [entry, ...history].slice(0, HISTORY_SIZE);
}

export function openPeopleSearch(guildId: string | null, query?: string) {
    const guild = guildId ? GuildStore.getGuild(guildId) : null;
    const saved = query ?? settings.store.lastQuery ?? "";
    const initial = guild ? `${setValue(saved, "guild", guildToken(guild))} ` : saved;
    openModal(props => (
        <ErrorBoundary>
            <PeopleSearchModal modalProps={props} initialQuery={initial} />
        </ErrorBoundary>
    ));
}

const imageFrom = (files: FileList) => [...files].find(f => f.type.startsWith("image/"));

interface ModalProps {
    modalProps: RenderModalProps;
    initialQuery: string;
}

function PeopleSearchModal({ modalProps, initialQuery }: ModalProps) {
    const [query, setQuery] = useState(initialQuery);
    const [showFilters, setShowFilters] = useState(settings.store.showFilters ?? false);

    const [planQuery, setPlanQuery] = useState(initialQuery);
    const updatePlanQuery = useMemo(() => lodash.debounce(setPlanQuery, 250), []);
    const queryRef = useRef(query);
    queryRef.current = query;

    useEffect(() => saveState(query, showFilters), [query, showFilters]);
    useEffect(() => updatePlanQuery(query), [query]);
    useEffect(() => () => {
        updatePlanQuery.cancel();
        stopJob();
        addToHistory(queryRef.current);
        saveState.flush();
    }, []);

    const [focused, setFocused] = useState(true);
    const [selected, setSelected] = useState(-1);
    const inputRef = useRef<HTMLInputElement>(null);
    const history = settings.use(HISTORY_KEYS).history ?? [];
    const suggestions = focused ? getSuggestions(query, history) : [];

    const job = useJob(s => s);
    const { fetchMode, cacheDays } = settings.use(FETCH_KEYS);
    const { grid, oldAvatars, similarity } = useView();

    const error = useMemo(() => {
        const p = parseQuery(query);
        return typeof p === "string" ? p : undefined;
    }, [query]);
    const parsed = useMemo(() => parseQuery(planQuery), [planQuery]);
    const q = typeof parsed === "string" ? EMPTY_QUERY : parsed;
    const maxAgeMs = cacheDays * 86_400_000;

    const plan = useMemo(() => makePlan(q, maxAgeMs, oldAvatars), [parsed, maxAgeMs, oldAvatars, job.version]);
    const tiles = useMemo((): Tile[] => {
        if (!q.terms.length && !q.guildIds && !q.like) return [];
        const matches = plan.candidates.filter(p => matchesAll(p, q));
        if (q.like) return similarTiles(matches, q.like, similarity, oldAvatars);
        return plainTiles(q.nameTests.length ? lodash.sortBy(matches, p => !matchesName(p, q)) : matches, grid && oldAvatars);
    }, [plan, parsed, similarity, oldAvatars, grid]);

    const pageSize = grid ? GRID_PAGE_SIZE : PAGE_SIZE;
    const [shown, setShown] = useState(pageSize);
    const [sentinelRef, sentinelVisible] = useIntersection();
    useEffect(() => setShown(pageSize), [parsed, pageSize]);
    useEffect(() => {
        if (sentinelVisible && shown < tiles.length) setShown(shown + pageSize);
    }, [sentinelVisible, shown, tiles.length]);

    async function execute() {
        addToHistory(planQuery);
        for (const [guildId, ids] of plan.checks) {
            if (!await checkMembers(guildId, ids, q.presences)) return;
        }
        if (plan.memberListGuild && !await loadMembers(plan.memberListGuild, plan.expected, q.presences)) return;
        const fresh = makePlan(q, maxAgeMs, oldAvatars);
        if (!await fetchBios(fresh.singleGuild, fresh.toFetch, fetchMode) || !q.like) return;
        await hashAvatars(missingHashes(makePlan(q, maxAgeMs, oldAvatars).candidates.filter(p => matchesAll(p, q)), oldAvatars));
    }

    const steps = describePlan(plan, fetchMode, !!q.like);

    function start() {
        execute().catch(e => {
            logger.error("Running the search failed.", e);
            stopJob();
        });
    }

    function run() {
        const warnings: string[] = [];
        if (plan.memberListGuild && plan.expected > CONFIRM_FETCH_ABOVE) {
            warnings.push(`This loads the member list of a server with about ${plan.expected} members, which can take minutes and uses up to ${settings.store.memberQueryBudget} member lookups a day.`);
        }
        const profiles = plan.needsProfiles && fetchMode !== FetchModes.Cached
            ? Math.min(plan.memberListGuild ? plan.expected : plan.toFetch.length + checkCount(plan), MAX_PROFILES_PER_RUN)
            : 0;
        if (profiles > CONFIRM_FETCH_ABOVE) {
            warnings.push(`This can fetch up to ${profiles} profiles, which takes about ${formatDurationMs(profiles * profileDelayMs(fetchMode))}. Many profile requests in a row can get an account flagged by Discord. Adding filters like guild:, is: or role: keeps it smaller.`);
        }
        const hashes = Math.min(plan.toHash.length, MAX_HASHES_PER_RUN);
        if (hashes > CONFIRM_HASH_ABOVE) {
            warnings.push(`This downloads ${hashes} small avatar images, which takes about ${formatDurationMs(hashes * HASH_MS)}. Each avatar is only downloaded once.`);
        }
        if (!warnings.length) return start();
        Alerts.show({
            title: "Fetch this much?",
            body: warnings.join(" "),
            confirmText: "Fetch them",
            cancelText: "Cancel",
            onConfirm: start,
        });
    }

    async function findByImage(file: Blob | null | undefined) {
        if (!file) return;
        try {
            const hash = hashToText(await hashFile(file));
            setQuery(current => setValue(current, "like", hash));
            settings.store.grid = true;
        } catch (e) {
            logger.error("Failed to read the image.", e);
            showToast({ text: "That image couldn't be read.", variant: "critical" });
        }
    }

    const onDrop = (e: DragEvent) => {
        const file = imageFrom(e.dataTransfer.files);
        if (!file) return;
        e.preventDefault();
        e.stopPropagation();
        void findByImage(file);
    };

    const onPaste = (e: ClipboardEvent) => {
        const file = imageFrom(e.clipboardData.files);
        if (!file) return;
        e.preventDefault();
        void findByImage(file);
    };

    const pick = (s: Suggestion) => {
        setSelected(-1);
        if (s.more) {
            setShowFilters(true);
            setFocused(false);
            return;
        }
        setQuery(s.insert);
        inputRef.current?.focus();
    };

    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Escape" && query) {
            e.preventDefault();
            e.stopPropagation();
            setQuery("");
        } else if (e.key === "Enter" && selected < 0) {
            if (steps && !job.kind && planQuery === query) run();
        } else if (!suggestions.length) {
            return;
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const next = selected + (e.key === "ArrowDown" ? 1 : -1);
            setSelected(next >= suggestions.length ? -1 : next < -1 ? suggestions.length - 1 : next);
        } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            pick(suggestions[Math.max(selected, 0)]);
        } else if (e.key === "Escape") {
            e.stopPropagation();
            setFocused(false);
        }
    };

    const actions: ModalAction[] = job.kind
        ? [{ text: "Stop", variant: "critical-primary", onClick: stopJob }]
        : [
            { text: showFilters ? "Fewer filters" : "More filters", variant: "secondary", onClick: () => setShowFilters(!showFilters) },
            { text: steps ? "Run" : "Nothing to fetch", variant: "primary", disabled: !steps, onClick: run },
        ];

    return (
        <Modal
            {...modalProps}
            size="lg"
            title="People Search"
            subtitle={statusLine(plan, job, steps, fetchMode)}
            actions={actions}
            input={
                <TextInput
                    autoFocus
                    inputRef={inputRef}
                    value={query}
                    onChange={v => { setQuery(v); setSelected(-1); setFocused(true); }}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onKeyDown={onKeyDown}
                    onPaste={onPaste}
                    placeholder='Search everyone, or filter like guild:name role:mod status:online is:outgoing "exact phrase"'
                    error={error}
                    role="combobox"
                    aria-label="Search people"
                    aria-autocomplete="list"
                    aria-expanded={suggestions.length > 0}
                    aria-controls={suggestions.length ? SUGGEST_ID : undefined}
                    aria-activedescendant={selected >= 0 ? `${SUGGEST_ID}-${selected}` : undefined}
                    autoCorrect="off"
                    spellCheck={false}
                />
            }
        >
            <div onDragOver={e => e.preventDefault()} onDrop={onDrop} onPaste={onPaste}>
                {suggestions.length > 0 && (
                    <SuggestionList
                        id={SUGGEST_ID}
                        suggestions={suggestions}
                        selected={selected}
                        onPick={pick}
                        onClearHistory={() => { settings.store.history = []; }}
                    />
                )}
                {showFilters && <QueryBuilder query={query} setQuery={setQuery} />}
                <ResultsHeader count={tiles.length} comparing={!!q.like} onPickImage={() => void chooseFile("image/*").then(findByImage)} />
                <ScrollerThin className={cl("results")}>
                    {grid
                        ? <AvatarGrid tiles={tiles.slice(0, shown)} />
                        : tiles.slice(0, shown).map(t => <ResultRow key={t.person.id} person={t.person} query={q} />)}
                    {shown < tiles.length && <div ref={sentinelRef} className={cl("sentinel")} />}
                    {!tiles.length && (
                        <BaseText size="md" color="text-muted" className={cl("empty")}>
                            {job.kind ? "Searching…" : emptyText(query, !!steps)}
                        </BaseText>
                    )}
                </ScrollerThin>
            </div>
        </Modal>
    );
}
