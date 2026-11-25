/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { escapeRegExp } from "@utils/text";
import { RelationshipType } from "@vencord/discord-types/enums";
import { ChannelStore, GuildStore, PresenceStore, RelationshipStore, SnowflakeUtils } from "@webpack/common";

import { parseHash } from "./avatarHash";
import { AvatarHash, getProfile, ProfileRecord } from "./db";
import { HAS_VALUES, IS_VALUES } from "./filters";
import { PATTERNS } from "./patterns";
import { avatarsOf, Person, resolveGuilds, roleNames } from "./people";
import { tokenize } from "./queryEdit";

interface Ctx {
    person: Person;
    profile: ProfileRecord | undefined;
    scoped: boolean;
}

type Check = (ctx: Ctx) => boolean;

function perGuild(record: Record<string, string>, { person, scoped }: Ctx) {
    return scoped ? person.memberships.map(m => record[m.guildId] ?? "") : Object.values(record);
}

const nameOf = ({ person: p }: Ctx) => [p.username, p.globalName, ...p.memberships.map(m => m.nick)];
const bioOf = (ctx: Ctx) => ctx.profile ? [ctx.profile.bio, ...perGuild(ctx.profile.guildBios, ctx)] : [];
const relation = (ctx: Ctx) => RelationshipStore.getRelationshipType(ctx.person.id);

const textFields: Record<string, (ctx: Ctx) => string[]> = {
    name: nameOf,
    bio: bioOf,
    pronouns: ctx => ctx.profile ? [ctx.profile.pronouns, ...perGuild(ctx.profile.guildPronouns, ctx)] : [],
    role: ({ person }) => person.memberships.flatMap(roleNames),
    status: ({ person }) => [PresenceStore.getStatus(person.id)],
    activity: ({ person }) => PresenceStore.getActivities(person.id).flatMap(a => [a.name, a.state ?? "", a.details ?? ""]),
    connection: ({ profile }) => profile?.connections.map(c => `${c.type} ${c.name}`) ?? [],
    site: ctx => [
        ...ctx.profile?.connections.filter(c => c.type === PATTERNS.domainConnection).map(c => c.name) ?? [],
        ...bioOf(ctx).flatMap(b => b.match(PATTERNS.query.url) ?? []),
    ],
    badge: ({ profile }) => profile?.badges ?? [],
};

const isChecks: Record<typeof IS_VALUES[number], Check> = {
    friend: ctx => relation(ctx) === RelationshipType.FRIEND,
    pending: ctx => [RelationshipType.INCOMING_REQUEST, RelationshipType.OUTGOING_REQUEST].includes(relation(ctx)),
    incoming: ctx => relation(ctx) === RelationshipType.INCOMING_REQUEST,
    outgoing: ctx => relation(ctx) === RelationshipType.OUTGOING_REQUEST,
    blocked: ctx => relation(ctx) === RelationshipType.BLOCKED,
    dm: ({ person }) => person.dm,
    group: ({ person }) => person.groupDm,
    request: ({ person }) => person.request,
    bot: ({ person }) => person.bot,
    booster: ({ person }) => person.memberships.some(m => m.premiumSince),
    owner: ({ person }) => person.memberships.some(m => GuildStore.getGuild(m.guildId)?.ownerId === person.id),
    online: ({ person }) => PresenceStore.getStatus(person.id) !== "offline",
};

const hasChecks: Record<typeof HAS_VALUES[number], Check> = {
    bio: ctx => bioOf(ctx).some(Boolean),
    pronouns: ctx => textFields.pronouns(ctx).some(Boolean),
    connection: ({ profile }) => !!profile?.connections.length,
    site: ctx => textFields.site(ctx).length > 0,
    badge: ({ profile }) => !!profile?.badges.length,
    nick: ({ person }) => person.memberships.some(m => m.nick),
    avatar: ({ person }) => !!person.avatar,
    oldavatar: ({ person }) => avatarsOf(person, true).length > (person.avatar ? 1 : 0),
    role: ({ person }) => person.memberships.some(m => m.roles.length),
    activity: ({ person }) => PresenceStore.getActivities(person.id).length > 0,
};

const PROFILE_KEYS = new Set(["bio", "pronouns", "connection", "site", "badge"]);
const MEMBERSHIP_KEYS = new Set(["booster", "owner", "nick", "role", "name", "joined"]);
const PRESENCE_KEYS = new Set(["status", "activity", "online"]);
const NARROW_IS = new Set(["friend", "pending", "incoming", "outgoing", "blocked", "dm", "group", "request"]);

interface Term {
    test: Check;
    negate: boolean;
    needsProfile: boolean;
    needsMembership: boolean;
}

export interface Query {
    terms: Term[];
    guildIds: string[] | null;
    narrow: boolean;
    presences: boolean;
    highlights: RegExp[];
    nameTests: ((text: string) => boolean)[];
    like: AvatarHash | null;
}

export const EMPTY_QUERY: Query = { terms: [], guildIds: null, narrow: false, presences: false, highlights: [], nameTests: [], like: null };

const normalize = (text: string) => text.normalize("NFKC").toLowerCase();

interface Matcher {
    test(text: string): boolean;
    highlight: RegExp;
}

function textMatcher(value: string): Matcher | string {
    const regex = PATTERNS.query.regexValue.exec(value);
    if (!regex) {
        const needle = normalize(value);
        return { test: text => normalize(text).includes(needle), highlight: new RegExp(escapeRegExp(value), "gi") };
    }
    try {
        const flags = regex[2].replace(PATTERNS.query.stickyGlobalFlags, "");
        const re = new RegExp(regex[1], flags.includes("i") ? flags : flags + "i");
        return { test: text => re.test(text.normalize("NFKC")), highlight: new RegExp(re.source, re.flags + "g") };
    } catch (e) {
        return e instanceof Error ? e.message : "That regular expression is invalid.";
    }
}

function dateMatcher(value: string): ((iso: string | null) => boolean) | string {
    const [, cmp, rest] = PATTERNS.query.dateValue.exec(value) ?? [];
    const time = Date.parse(rest);
    if (Number.isNaN(time)) return `"${rest}" isn't a date. Use something like 2024, 2024-05 or 2024-05-17.`;
    if (!cmp) return iso => !!iso && iso.startsWith(rest);
    return iso => {
        if (!iso) return false;
        const t = Date.parse(iso);
        return cmp === ">" ? t > time : cmp === ">=" ? t >= time : cmp === "<" ? t < time : t <= time;
    };
}

export function parseQuery(query: string): Query | string {
    const q: Query = { ...EMPTY_QUERY, terms: [], highlights: [], nameTests: [] };
    const guildIds: string[] = [];

    for (const { raw, negate, key, value } of tokenize(query)) {
        if (!value) continue;
        const lower = value.toLowerCase();
        const term = (test: Check, flagKey = key ?? ""): Term =>
            ({ test, negate, needsProfile: PROFILE_KEYS.has(flagKey), needsMembership: MEMBERSHIP_KEYS.has(flagKey) });

        if (key === "guild") {
            const ids = resolveGuilds(value);
            if (!ids.length) return `You aren't in a server matching "${value}".`;
            if (negate) q.terms.push({ ...term(({ person }) => person.memberships.some(m => ids.includes(m.guildId))), needsMembership: true });
            else guildIds.push(...ids);
            continue;
        }

        if (key === "is" || key === "has") {
            const checks: Record<string, Check> = key === "is" ? isChecks : hasChecks;
            if (!Object.hasOwn(checks, lower)) return `Unknown ${key}: value "${value}". Try one of: ${Object.keys(checks).join(", ")}.`;
            q.terms.push({ ...term(checks[lower], lower), needsProfile: key === "has" && PROFILE_KEYS.has(lower) });
            q.narrow ||= key === "is" && !negate && NARROW_IS.has(lower);
            q.presences ||= PRESENCE_KEYS.has(lower);
            continue;
        }

        if (key === "joined" || key === "created" || key === "seen") {
            const match = dateMatcher(value);
            if (typeof match === "string") return match;
            q.terms.push(term(key === "joined"
                ? ({ person }) => person.memberships.some(m => match(m.joinedAt))
                : key === "seen"
                    ? ({ person }) => match(person.seen?.lastSeen ? new Date(person.seen.lastSeen).toISOString() : null)
                    : ({ person }) => match(new Date(SnowflakeUtils.extractTimestamp(person.id)).toISOString())));
            continue;
        }

        if (key === "in") {
            const match = textMatcher(value);
            if (typeof match === "string") return match;
            q.terms.push(term(({ person }) => !!person.seen?.channels.some(([id]) => id === value || match.test(ChannelStore.getChannel(id)?.name ?? ""))));
            continue;
        }

        if (key === "like") {
            const hash = parseHash(value);
            if (negate) return "like: can't be excluded with a minus.";
            if (!hash) return `"${value}" isn't an image fingerprint. Drop, paste or pick an image instead of typing one.`;
            q.like = hash;
            continue;
        }

        const field = key !== undefined && Object.hasOwn(textFields, key) ? textFields[key] : undefined;
        const match = textMatcher(field || key === undefined ? value : raw.replace(PATTERNS.query.leadingMinus, ""));
        if (typeof match === "string") return match;

        if (field) {
            q.terms.push(term(ctx => field(ctx).some(match.test)));
            q.presences ||= PRESENCE_KEYS.has(key ?? "");
        } else {
            q.terms.push({ ...term(ctx => Object.values(textFields).some(f => f(ctx).some(match.test))), needsProfile: true, needsMembership: false });
        }
        if (!negate && (!field || key === "bio")) q.highlights.push(match.highlight);
        if (!negate && (!field || key === "name")) q.nameTests.push(match.test);
    }
    if (guildIds.length) q.guildIds = [...new Set(guildIds)];
    return q;
}

export function filterCandidates(people: Person[], { terms, guildIds }: Query, membershipUnknown = false) {
    const wantsBots = terms.some(t => !t.negate && t.test === isChecks.bot);
    const cheap = terms.filter(t => !t.needsProfile && !(membershipUnknown && t.needsMembership));
    return people.filter(person => {
        if (person.bot && !wantsBots) return false;
        const ctx = { person, profile: undefined, scoped: !!guildIds };
        return cheap.every(t => t.test(ctx) !== t.negate);
    });
}

export function matchesAll(person: Person, { terms, guildIds }: Query) {
    const ctx = { person, profile: getProfile(person.id), scoped: !!guildIds };
    return terms.every(t => t.test(ctx) !== t.negate);
}

export const matchesName = (person: Person, { nameTests }: Query) =>
    nameTests.some(test => nameOf({ person, profile: undefined, scoped: false }).some(test));
