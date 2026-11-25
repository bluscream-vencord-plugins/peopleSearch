/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { openUserProfile } from "@utils/discord";
import { isTruthy } from "@utils/guards";
import { Guild } from "@vencord/discord-types";
import { ChannelType } from "@vencord/discord-types/enums";
import { findStoreLazy } from "@webpack";
import { ChannelStore, GuildMemberStore, GuildRoleStore, GuildStore, IconUtils, MessageRequestStore, RelationshipStore, UserStore } from "@webpack/common";

import { allPeople, getPerson, PersonRecord } from "./db";
import { isChecked, isCrawled } from "./jobs";
import { PATTERNS } from "./patterns";
import { logger } from "./state";

const SpamMessageRequestStore: { getSpamChannelIds(): Set<string>; } = findStoreLazy(PATTERNS.webpack.spamRequestStore);

interface AvatarOwner {
    id: string;
    avatar: string | null;
    discriminator: string;
}

const AvatarUrls: { getUserAvatarURL(user: AvatarOwner, canAnimate?: boolean, size?: number): string; } = IconUtils;

export const avatarUrl = (id: string, avatar: string | null, size: number) =>
    AvatarUrls.getUserAvatarURL({ id, avatar, discriminator: "0" }, false, size);

export const openProfile = (id: string) => void openUserProfile(id).catch(e => logger.error("Failed to open the profile.", e));

export interface Membership {
    guildId: string;
    nick: string;
    roles: string[];
    joinedAt: string | null;
    premiumSince: string | null;
}

export interface Person {
    id: string;
    username: string;
    globalName: string;
    avatar: string | null;
    bot: boolean;
    memberships: Membership[];
    dm: boolean;
    groupDm: boolean;
    request: boolean;
    seen: PersonRecord | undefined;
}

export interface Collected {
    people: Person[];
    unverified: Map<string, Person[]>;
    memberListGuild: string | null;
}

export const roleNames = (m: Membership) => m.roles.map(r => GuildRoleStore.getRole(m.guildId, r)?.name).filter(isTruthy);

export function avatarsOf({ avatar, seen }: Person, includeOld: boolean) {
    const avatars = avatar ? [avatar] : [];
    if (!includeOld || !seen) return avatars;
    for (const [old] of seen.avatars) if (!avatars.includes(old)) avatars.push(old);
    if (seen.avatar && !avatars.includes(seen.avatar)) avatars.push(seen.avatar);
    return avatars;
}

function ensure(people: Map<string, Person>, id: string) {
    let person = people.get(id);
    if (person) return person;
    const seen = getPerson(id);
    const known = UserStore.getUser(id) ?? (seen?.username ? seen : undefined);
    if (!known) return undefined;
    people.set(id, person = {
        id,
        username: known.username,
        globalName: known.globalName ?? "",
        avatar: known.avatar,
        bot: known.bot,
        memberships: [],
        dm: false,
        groupDm: false,
        request: false,
        seen,
    });
    return person;
}

function getMember(guildId: string, userId: string): Membership | undefined {
    const live = GuildMemberStore.getMember(guildId, userId);
    if (live) return { guildId, nick: live.nick ?? "", roles: live.roles, joinedAt: live.joinedAt ?? null, premiumSince: live.premiumSince ?? null };
    const seen = getPerson(userId)?.guilds[guildId];
    return seen && { guildId, ...seen };
}

function addLive(people: Map<string, Person>, guildId: string) {
    for (const m of GuildMemberStore.getMembers(guildId)) {
        ensure(people, m.userId)?.memberships.push({ guildId, nick: m.nick ?? "", roles: m.roles, joinedAt: m.joinedAt ?? null, premiumSince: m.premiumSince ?? null });
    }
}

function addSeen(people: Map<string, Person>, guildIds: string[] | null) {
    for (const rec of allPeople()) {
        if (!rec.username) continue;
        for (const guildId in rec.guilds) {
            if (guildIds && !guildIds.includes(guildId)) continue;
            const person = ensure(people, rec.id);
            if (person && !person.memberships.some(m => m.guildId === guildId)) person.memberships.push({ guildId, ...rec.guilds[guildId] });
        }
        if (!guildIds) ensure(people, rec.id);
    }
}

function addPersonal(people: Map<string, Person>) {
    for (const id of RelationshipStore.getMutableRelationships().keys()) ensure(people, id);

    const requestChannels = new Set([...MessageRequestStore.getMessageRequestChannelIds(), ...SpamMessageRequestStore.getSpamChannelIds()]);
    for (const channel of Object.values(ChannelStore.getMutablePrivateChannels())) {
        for (const id of channel.recipients) {
            const person = ensure(people, id);
            if (!person) continue;
            if (requestChannels.has(channel.id)) person.request = true;
            else if (channel.type === ChannelType.DM) person.dm = true;
            else person.groupDm = true;
        }
    }
}

export function collectPeople(guildIds: string[] | null, narrow: boolean, memberCounts: number): Collected {
    const people = new Map<string, Person>();
    const unverified = new Map<string, Person[]>();

    if (!guildIds) {
        for (const id of Object.keys(GuildStore.getGuilds())) addLive(people, id);
        addSeen(people, null);
        addPersonal(people);
        return { people: [...people.values()], unverified, memberListGuild: null };
    }

    if (narrow) {
        addPersonal(people);
        for (const person of people.values()) {
            for (const guildId of guildIds) {
                const member = getMember(guildId, person.id);
                if (member) person.memberships.push(member);
                else if (!isChecked(guildId, person.id)) {
                    const list = unverified.get(guildId);
                    if (list) list.push(person);
                    else unverified.set(guildId, [person]);
                }
            }
        }
        return { people: [...people.values()].filter(p => p.memberships.length), unverified, memberListGuild: null };
    }

    for (const id of guildIds) addLive(people, id);
    addSeen(people, guildIds);
    const incomplete = guildIds.length === 1 && !isCrawled(guildIds[0]) && people.size < memberCounts * 0.95;
    return { people: [...people.values()], unverified, memberListGuild: incomplete ? guildIds[0] : null };
}

export function guildToken(guild: Guild) {
    const unique = Object.values(GuildStore.getGuilds()).filter(g => g.name === guild.name).length === 1;
    return unique && !guild.name.includes('"') ? guild.name : guild.id;
}

export function resolveGuilds(value: string): string[] {
    const guilds = Object.values(GuildStore.getGuilds());
    if (guilds.some(g => g.id === value)) return [value];
    const needle = value.toLowerCase();
    const exact = guilds.filter(g => g.name.toLowerCase() === needle);
    return (exact.length ? exact : guilds.filter(g => g.name.toLowerCase().includes(needle))).map(g => g.id);
}
