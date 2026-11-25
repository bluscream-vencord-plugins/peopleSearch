/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { fetchUserProfile } from "@utils/discord";
import { FluxDispatcher, GuildMemberStore, lodash, UserProfileStore, UserStore } from "@webpack/common";

import { memberQueriesLeft, profilesLeft, spendMemberQuery, spendProfile } from "./budget";
import { ingestProfile } from "./collect";
import { flushNow, forgetMembership, getProfile, knownMemberCount, setProfile } from "./db";
import { PATTERNS } from "./patterns";
import { abortJob, beginJob, FetchMode, FetchModes, finishJob, isCurrent, logger, pause, refresh, setJob } from "./state";

interface MemberChunk {
    guildId: string;
    nonce?: string | null;
    members: { user: { id: string; }; }[];
}

let cancelRequest: (() => void) | undefined;
let onChunks: ((chunks: MemberChunk[]) => void) | undefined;

export function stopJob() {
    abortJob("");
    cancelRequest?.();
    flushNow();
}

export function forwardMemberChunks(chunks: MemberChunk[]) {
    onChunks?.(chunks);
}

interface RequestError {
    status?: number;
    body?: { retry_after?: number; };
}

const isRequestError = (e: unknown): e is RequestError => typeof e === "object" && e !== null && "status" in e;

function ingestFromStore(userId: string, guildId: string | null) {
    const profile = UserProfileStore.getUserProfile(userId);
    const guildProfile = guildId ? UserProfileStore.getGuildMemberProfile(userId, guildId) : null;
    if (!profile || "fetchError" in profile && profile.fetchError || (guildId && !guildProfile)) return false;
    ingestProfile({
        user: UserStore.getUser(userId) ?? { id: userId },
        user_profile: { bio: profile.bio, pronouns: profile.pronouns },
        guild_member_profile: guildId && guildProfile ? { guild_id: guildId, bio: guildProfile.bio, pronouns: guildProfile.pronouns } : null,
        connected_accounts: profile.connectedAccounts ?? [],
        badges: profile.badges,
    });
    return true;
}

const MAX_FAILURES = 3;
const MAX_RATE_LIMITS = 3;
const MAX_RATE_LIMIT_WAIT = 300_000;
export const MAX_PROFILES_PER_RUN = 300;

const DELAYS: Record<Exclude<FetchMode, "cached">, [number, number]> = {
    slow: [3000, 5000],
    fast: [1000, 1500],
};

export function staleProfiles(ids: string[], maxAgeMs: number) {
    const now = Date.now();
    return ids.filter(id => {
        const p = getProfile(id);
        return !p || now - p.fetchedAt > maxAgeMs;
    });
}

export const profileDelayMs = (mode: FetchMode) => mode === FetchModes.Cached ? 0 : (DELAYS[mode][0] + DELAYS[mode][1]) / 2;

function markUnavailable(userId: string) {
    const known = getProfile(userId);
    setProfile(userId, known
        ? { ...known, fetchedAt: Date.now() }
        : { bio: "", pronouns: "", guildBios: {}, guildPronouns: {}, connections: [], badges: [], fetchedAt: Date.now() });
}

export async function fetchBios(guildId: string | null, all: string[], mode: FetchMode) {
    if (mode === FetchModes.Cached || !all.length) return true;
    const left = profilesLeft();
    if (!left) return abortJob("Today's profile budget is used up. It resets tomorrow, or raise it in the plugin settings.");

    const limit = Math.min(left, MAX_PROFILES_PER_RUN);
    const todo = all.slice(0, limit);
    const id = beginJob("bios", todo.length);
    const [min, max] = DELAYS[mode];
    let penalty = 1;
    let failures = 0;
    let rateLimits = 0;

    for (let i = 0; i < todo.length && isCurrent(id); i++) {
        if (!getProfile(todo[i]) && ingestFromStore(todo[i], guildId)) {
            setJob({ done: i + 1 });
            continue;
        }
        spendProfile();
        try {
            await fetchUserProfile(todo[i], guildId ? { guild_id: guildId } : undefined, false);
            penalty = Math.max(1, penalty / 2);
            failures = rateLimits = 0;
        } catch (e) {
            FluxDispatcher.dispatch({ type: PATTERNS.events.profileFetchFailure, userId: todo[i], apiError: e, fetchStartedAt: Date.now() });
            if (!isCurrent(id)) break;
            const err: RequestError = isRequestError(e) ? e : {};
            if (err.status === PATTERNS.status.forbidden || err.status === PATTERNS.status.notFound) {
                markUnavailable(todo[i]);
            } else if (err.status === PATTERNS.status.rateLimited) {
                const wait = (err.body?.retry_after ?? 30) * 1000 + 5000;
                if (++rateLimits >= MAX_RATE_LIMITS || wait > MAX_RATE_LIMIT_WAIT)
                    return abortJob(`Stopped because Discord is rate limiting profile requests. Wait ${Math.ceil(wait / 60_000)} minutes or more before running again.`);
                penalty = Math.min(penalty * 2, 16);
                logger.warn(`Rate limited, waiting ${Math.round(wait / 1000)}s and slowing down to ${penalty}x.`);
                setJob({ note: `Rate limited by Discord, pausing for ${Math.round(wait / 1000)} seconds.` });
                await pause(wait);
                if (isCurrent(id)) setJob({ note: "" });
                i--;
                continue;
            } else {
                if (err.status) logger.warn(`Fetching a profile failed with status ${err.status}.`);
                else logger.error("Fetching a profile failed.", e);
                if (++failures >= MAX_FAILURES) return abortJob(`Stopped after ${MAX_FAILURES} failed profile requests in a row. Wait a while before running again.`);
            }
        }
        if (!isCurrent(id)) break;
        setJob({ done: i + 1 });
        await pause((min + Math.random() * (max - min)) * penalty);
    }
    if (!finishJob(id)) return false;
    if (all.length > todo.length) {
        setJob({
            note: todo.length < MAX_PROFILES_PER_RUN
                ? `Fetched ${todo.length} profiles and reached today's profile budget. The other ${all.length - todo.length} are fetched once it resets tomorrow.`
                : `Fetched ${todo.length} profiles, the most per run. Run again for the other ${all.length - todo.length}.`
        });
    }
    return true;
}

const MEMBER_QUERY_DELAY = 750;
const QUERY_LIMIT = 100;
const MAX_TIMEOUTS = 3;
const FULL_LIST_LIMIT = 1000;

const checked = new Map<string, Set<string>>();
const crawls = new Map<string, string[]>();

export const isChecked = (guildId: string, userId: string) => !!checked.get(guildId)?.has(userId);
export const isCrawled = (guildId: string) => crawls.get(guildId)?.length === 0;

export function forgetMemberLookups() {
    checked.clear();
    crawls.clear();
}

export async function checkMembers(guildId: string, ids: string[], presences: boolean) {
    const batches = lodash.chunk(ids, QUERY_LIMIT);
    const id = beginJob("members", batches.length, `Checking which of ${ids.length} people are in the server.`);
    let set = checked.get(guildId);
    if (!set) checked.set(guildId, set = new Set());

    for (let i = 0; i < batches.length && isCurrent(id); i++) {
        if (!memberQueriesLeft(guildId)) return abortJob("Today's member lookup budget for this server is used up. It resets tomorrow, or raise it in the plugin settings.");
        spendMemberQuery(guildId);
        const found = await requestMembers({ guildId, userIds: batches[i], presences });
        if (!isCurrent(id)) break;
        if (found) {
            for (const userId of batches[i]) {
                set.add(userId);
                if (!found.has(userId)) forgetMembership(userId, guildId);
            }
        }
        setJob({ done: i + 1 });
        refresh();
        await pause(MEMBER_QUERY_DELAY);
    }
    return finishJob(id);
}

interface MemberRequest {
    guildId: string;
    query?: string;
    limit?: number;
    userIds?: string[];
    presences: boolean;
}

function requestMembers({ guildId, ...request }: MemberRequest) {
    const nonce = request.userIds ? `${PATTERNS.noncePrefix}${Date.now()}` : undefined;
    return new Promise<Set<string> | null>(resolve => {
        let found: Set<string> | null = null;
        let timer = setTimeout(done, 10000);
        function done() {
            clearTimeout(timer);
            cancelRequest = undefined;
            onChunks = undefined;
            resolve(found);
        }
        cancelRequest = done;
        onChunks = chunks => {
            const mine = chunks.filter(c => c.guildId === guildId && (c.nonce ?? undefined) === nonce);
            if (!mine.length) return;
            found ??= new Set();
            for (const c of mine) for (const m of c.members) found.add(m.user.id);
            clearTimeout(timer);
            timer = setTimeout(done, 1500);
        };
        FluxDispatcher.dispatch({ type: PATTERNS.events.memberRequest, guildIds: [guildId], ...request, nonce });
    });
}

const memberCount = (guildId: string) => Math.max(knownMemberCount(guildId), GuildMemberStore.getMembers(guildId).length);

export async function loadMembers(guildId: string, expected: number, presences: boolean) {
    const id = beginJob("members", 1);

    if (expected <= FULL_LIST_LIMIT) {
        if (!memberQueriesLeft(guildId)) return abortJob("Today's member lookup budget for this server is used up. It resets tomorrow, or raise it in the plugin settings.");
        spendMemberQuery(guildId);
        await requestMembers({ guildId, query: "", limit: 0, presences });
        if (!isCurrent(id) || memberCount(guildId) >= expected * 0.95) return finishJob(id);
    }

    let queue = crawls.get(guildId);
    if (!queue) crawls.set(guildId, queue = [...PATTERNS.memberAlphabet]);
    let timeouts = 0;
    for (let done = 0; queue.length && isCurrent(id); done++) {
        if (!memberQueriesLeft(guildId)) return abortJob("Today's member lookup budget for this server is used up. Run again tomorrow to continue where it stopped, or raise it in the plugin settings.");
        spendMemberQuery(guildId);
        const prefix = queue[0];
        const found = await requestMembers({ guildId, query: prefix, limit: QUERY_LIMIT, presences });
        if (!isCurrent(id)) break;
        if (!found) {
            if (++timeouts >= MAX_TIMEOUTS) return abortJob(`Stopped after ${MAX_TIMEOUTS} member lookups in a row got no answer. Run again later to continue.`);
        } else {
            timeouts = 0;
            queue.shift();
            if (found.size >= QUERY_LIMIT && prefix.length < 8) queue.push(...[...PATTERNS.memberAlphabet].map(c => prefix + c));
        }
        setJob({ done: done + 1, total: done + 1 + queue.length, note: `${memberCount(guildId)} of about ${expected} members found.` });
        await pause(MEMBER_QUERY_DELAY);
    }
    return finishJob(id);
}
