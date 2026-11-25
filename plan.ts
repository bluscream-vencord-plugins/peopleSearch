/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { formatDurationMs } from "@utils/text";
import { GuildMemberCountStore } from "@webpack/common";

import { HASH_MS, HashTarget, missingHashes } from "./avatarHash";
import { peopleCount, profileCount } from "./db";
import { profileDelayMs, staleProfiles } from "./jobs";
import { collectPeople, Person } from "./people";
import { filterCandidates, matchesAll, Query } from "./search";
import { FetchMode, FetchModes, JobState } from "./state";

export interface Plan {
    candidates: Person[];
    checks: [string, string[]][];
    memberListGuild: string | null;
    expected: number;
    singleGuild: string | null;
    toFetch: string[];
    toHash: HashTarget[];
    known: number;
    needsProfiles: boolean;
}

export function makePlan(q: Query, maxAgeMs: number, oldAvatars: boolean): Plan {
    const expected = q.guildIds?.reduce((n, id) => n + (GuildMemberCountStore.getMemberCount(id) ?? 0), 0) ?? 0;
    const { people, unverified, memberListGuild } = collectPeople(q.guildIds, q.narrow, expected);
    const candidates = filterCandidates(people, q);
    const checks = [...unverified]
        .map(([guildId, pending]): [string, string[]] => [guildId, filterCandidates(pending, q, true).map(p => p.id)])
        .filter(([, ids]) => ids.length);
    const needsProfiles = q.terms.some(t => t.needsProfile);
    const toFetch = needsProfiles ? staleProfiles(candidates.map(p => p.id), maxAgeMs) : [];
    return {
        candidates,
        checks,
        memberListGuild,
        expected,
        singleGuild: q.guildIds?.length === 1 ? q.guildIds[0] : null,
        toFetch,
        toHash: q.like ? missingHashes(toFetch.length ? candidates : candidates.filter(p => matchesAll(p, q)), oldAvatars) : [],
        known: people.length,
        needsProfiles,
    };
}

export const checkCount = (plan: Plan) => plan.checks.reduce((n, [, ids]) => n + ids.length, 0);

export function describePlan(plan: Plan, fetchMode: FetchMode, wantsAvatars: boolean) {
    const steps: string[] = [];
    const checks = checkCount(plan);
    if (checks) steps.push(`check whether ${checks} people are in the server (${plan.checks.reduce((n, [, ids]) => n + Math.ceil(ids.length / 100), 0)} requests)`);
    if (plan.memberListGuild) steps.push(`load the member list (${plan.known} of about ${plan.expected} known, can take minutes in big servers)`);

    const delay = profileDelayMs(fetchMode);
    const fetching = fetchMode !== FetchModes.Cached && plan.needsProfiles;
    if (fetching && plan.memberListGuild) {
        steps.push(`fetch the profiles of whoever fits, up to ${plan.expected} (up to ${formatDurationMs(plan.expected * delay)})`);
    } else if (fetching && checks) {
        steps.push(`fetch the profiles of whoever is in it, up to ${checks + plan.toFetch.length} (up to ${formatDurationMs((checks + plan.toFetch.length) * delay)})`);
    } else if (fetching && plan.toFetch.length) {
        steps.push(`fetch ${plan.toFetch.length} profiles (about ${formatDurationMs(plan.toFetch.length * delay)})`);
    }

    const hashing = `${plan.toHash.length} small avatars (about ${formatDurationMs(plan.toHash.length * HASH_MS)})`;
    if (wantsAvatars && steps.length) {
        steps.push(`download and compare the avatars of whoever fits${plan.toHash.length ? `, about ${hashing}` : ""}`);
    } else if (plan.toHash.length) {
        steps.push(`download and compare ${hashing}`);
    }
    return steps.length ? `Run will ${steps.join(", then ")}.` : "";
}

export function statusLine(plan: Plan, job: JobState, steps: string, fetchMode: FetchMode) {
    if (job.kind === "members") return `Looking up members: ${job.done} of ${job.total}. ${job.note}`;
    if (job.kind === "avatars") return `Comparing avatars: ${job.done} of ${job.total}, about ${formatDurationMs((job.total - job.done) * HASH_MS)} left. ${job.note}`;
    if (job.kind) return `Fetching profiles: ${job.done} of ${job.total}, about ${formatDurationMs((job.total - job.done) * profileDelayMs(fetchMode))} left. ${job.note}`;
    return [job.note, `${plan.candidates.length} people fit the filters, ${peopleCount()} people remembered, ${profileCount()} profiles cached.`, steps].filter(Boolean).join(" ");
}

export function emptyText(query: string, canRun: boolean) {
    if (!query.trim()) return "Type something to search, drop or paste an image to find similar avatars, or click More filters to see what you can search by.";
    if (canRun) return "Nobody matches yet. Click Run to look further.";
    return "Nobody matches.";
}
