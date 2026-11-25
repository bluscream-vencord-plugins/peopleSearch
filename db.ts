/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { proxyLazy } from "@utils/lazy";
import { lodash } from "@webpack/common";

import { bump, logger } from "./state";

export interface Connection {
    type: string;
    name: string;
}

export interface ProfileRecord {
    bio: string;
    pronouns: string;
    guildBios: Record<string, string>;
    guildPronouns: Record<string, string>;
    connections: Connection[];
    badges: string[];
    fetchedAt: number;
}

export interface GuildSeen {
    nick: string;
    roles: string[];
    joinedAt: string | null;
    premiumSince: string | null;
    lastSeen: number;
}

export type Stamped = [id: string, time: number];
export type AvatarHash = [high: number, low: number];

export interface PersonRecord {
    id: string;
    username: string;
    globalName: string;
    avatar: string | null;
    avatarSince: number;
    avatars: Stamped[];
    bot: boolean;
    firstSeen: number;
    lastSeen: number;
    guilds: Record<string, GuildSeen>;
    channels: Stamped[];
    profile?: ProfileRecord;
}

interface LegacyMember {
    id: string;
    username: string;
    globalName: string;
    nick: string;
    avatar: string | null;
    bot: boolean;
    roles?: string[];
    joinedAt: string | null;
    premiumSince: string | null;
}

type Stored = PersonRecord | ProfileRecord | AvatarHash | LegacyMember[];

export const MAX_AVATARS = 5;
export const MAX_CHANNELS = 10;
const DAY = 86_400_000;

const people = new Map<string, PersonRecord>();
const hashes = new Map<string, AvatarHash>();
const dirtyPeople = new Set<string>();
const dirtyHashes = new Set<string>();
let profiles = 0;

let db: DataStore.UseStore | undefined;
const getDb = () => db ??= DataStore.createStore("PeopleSearch", "cache");

async function save() {
    const batch: [string, PersonRecord | AvatarHash][] = [];
    for (const id of dirtyPeople) {
        const rec = people.get(id);
        if (rec) batch.push([`u:${id}`, rec]);
    }
    for (const avatar of dirtyHashes) {
        const hash = hashes.get(avatar);
        if (hash) batch.push([`h:${avatar}`, hash]);
    }
    dirtyPeople.clear();
    dirtyHashes.clear();
    if (batch.length) await DataStore.setMany(batch, getDb());
}

const flush = proxyLazy(() => lodash.debounce(() => {
    save().catch(e => logger.error("Failed to save the cache.", e));
}, 5000, { maxWait: 30_000 }));

export const flushNow = () => flush.flush();

export function markDirty(id: string) {
    dirtyPeople.add(id);
    flush();
}

export const getPerson = (id: string) => people.get(id);
export const allPeople = () => people.values();
export const peopleCount = () => people.size;
export const getProfile = (id: string) => people.get(id)?.profile;
export const profileCount = () => profiles;
export const getAvatarHash = (avatar: string) => hashes.get(avatar);

export function ensurePerson(id: string) {
    let rec = people.get(id);
    if (!rec) people.set(id, rec = { id, username: "", globalName: "", avatar: null, avatarSince: 0, avatars: [], bot: false, firstSeen: 0, lastSeen: 0, guilds: {}, channels: [] });
    return rec;
}

export function setProfile(id: string, profile: ProfileRecord) {
    const rec = ensurePerson(id);
    if (!rec.profile) profiles++;
    rec.profile = profile;
    markDirty(id);
}

export function setAvatarHash(avatar: string, hash: AvatarHash) {
    hashes.set(avatar, hash);
    dirtyHashes.add(avatar);
    flush();
}

export function forgetMembership(userId: string, guildId: string) {
    const rec = people.get(userId);
    if (!rec || !(guildId in rec.guilds)) return;
    delete rec.guilds[guildId];
    markDirty(userId);
}

export function knownMemberCount(guildId: string) {
    let count = 0;
    for (const rec of people.values()) if (guildId in rec.guilds) count++;
    return count;
}

const isHash = (value: AvatarHash | LegacyMember[]): value is AvatarHash => typeof value[0] === "number";
const newer = (a: ProfileRecord | undefined, b: ProfileRecord | undefined) => !a || (b && b.fetchedAt > a.fetchedAt) ? b : a;

function restore(stored: PersonRecord) {
    const live = people.get(stored.id);
    if (!live) return void people.set(stored.id, stored);

    const profile = newer(live.profile, stored.profile);
    if (!live.username) {
        people.set(stored.id, { ...stored, guilds: { ...stored.guilds, ...live.guilds }, profile });
    } else {
        if (stored.avatar === live.avatar) {
            live.avatars = stored.avatars;
            live.avatarSince = stored.avatarSince;
        } else {
            const old = stored.avatars.filter(a => a[0] !== live.avatar);
            if (stored.avatar) old.push([stored.avatar, stored.avatarSince]);
            live.avatars = old.slice(-MAX_AVATARS);
        }
        if (stored.firstSeen && (!live.firstSeen || stored.firstSeen < live.firstSeen)) live.firstSeen = stored.firstSeen;
        live.lastSeen = Math.max(live.lastSeen, stored.lastSeen);
        live.bot ||= stored.bot;
        live.guilds = { ...stored.guilds, ...live.guilds };
        live.channels = [...stored.channels.filter(c => !live.channels.some(l => l[0] === c[0])), ...live.channels]
            .sort((a, b) => a[1] - b[1])
            .slice(-MAX_CHANNELS);
        live.profile = profile;
    }
    dirtyPeople.add(stored.id);
}

function migrateMember(guildId: string, m: LegacyMember, now: number) {
    if (!m.roles) return;
    const rec = ensurePerson(m.id);
    if (!rec.username) {
        rec.username = m.username;
        rec.globalName = m.globalName;
        rec.avatar = m.avatar;
        rec.bot = m.bot;
    }
    rec.guilds[guildId] ??= { nick: m.nick, roles: m.roles, joinedAt: m.joinedAt, premiumSince: m.premiumSince, lastSeen: now };
    dirtyPeople.add(m.id);
}

function migrateProfile(id: string, profile: ProfileRecord) {
    const rec = ensurePerson(id);
    rec.profile = newer(rec.profile, profile);
    dirtyPeople.add(id);
}

const lastTouched = (rec: PersonRecord) =>
    Math.max(rec.lastSeen, rec.profile?.fetchedAt ?? 0, ...Object.values(rec.guilds).map(g => g.lastSeen));

async function prune(days: number) {
    const cutoff = Date.now() - days * DAY;
    const stale: string[] = [];
    for (const rec of people.values()) {
        if (lastTouched(rec) < cutoff) stale.push(rec.id);
    }
    for (const id of stale) {
        people.delete(id);
        dirtyPeople.delete(id);
    }
    if (stale.length) {
        await DataStore.delMany(stale.map(id => `u:${id}`), getDb());
        logger.info(`Forgot ${stale.length} people not seen for ${days} days.`);
    }

    const used = new Set<string>();
    for (const rec of people.values()) {
        if (rec.avatar) used.add(rec.avatar);
        for (const [avatar] of rec.avatars) used.add(avatar);
    }
    const orphans = [...hashes.keys()].filter(avatar => !used.has(avatar));
    for (const avatar of orphans) {
        hashes.delete(avatar);
        dirtyHashes.delete(avatar);
    }
    if (orphans.length) await DataStore.delMany(orphans.map(avatar => `h:${avatar}`), getDb());
}

let loaded = false;

export async function loadCache(pruneDays: number) {
    if (loaded) return;
    loaded = true;
    const legacy: string[] = [];
    const now = Date.now();
    for (const [key, value] of await DataStore.entries<string, Stored>(getDb())) {
        const id = key.slice(2);
        if (Array.isArray(value)) {
            if (isHash(value)) {
                hashes.set(id, value);
            } else {
                legacy.push(key);
                for (const m of value) migrateMember(id, m, now);
            }
        } else if ("guilds" in value) {
            restore(value);
        } else {
            legacy.push(key);
            if (value.connections) migrateProfile(id, value);
        }
    }
    await save();
    if (legacy.length) {
        await DataStore.delMany(legacy, getDb());
        logger.info(`Migrated ${legacy.length} cache entries to one record per person.`);
    }
    if (pruneDays > 0) await prune(pruneDays);
    profiles = 0;
    for (const rec of people.values()) if (rec.profile) profiles++;
    bump();
}

export async function clearPeople() {
    flush.cancel();
    const records = [...people.values()];
    people.clear();
    dirtyPeople.clear();
    for (const { id, profile } of records) {
        if (!profile) continue;
        ensurePerson(id).profile = profile;
        dirtyPeople.add(id);
    }
    await DataStore.delMany(records.filter(r => !r.profile).map(r => `u:${r.id}`), getDb());
    await save();
    bump();
}

export async function clearProfiles() {
    flush.cancel();
    const removed: string[] = [];
    for (const rec of people.values()) {
        if (!rec.profile) continue;
        delete rec.profile;
        if (rec.username) {
            dirtyPeople.add(rec.id);
        } else {
            people.delete(rec.id);
            dirtyPeople.delete(rec.id);
            removed.push(`u:${rec.id}`);
        }
    }
    profiles = 0;
    await DataStore.delMany(removed, getDb());
    await save();
    bump();
}

export async function clearAvatarHashes() {
    flush.cancel();
    const removed = [...hashes.keys()].map(avatar => `h:${avatar}`);
    hashes.clear();
    dirtyHashes.clear();
    await DataStore.delMany(removed, getDb());
    await save();
    bump();
}
