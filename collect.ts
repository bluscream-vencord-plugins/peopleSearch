/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { UserStore } from "@webpack/common";

import { Connection, ensurePerson, getPerson, markDirty, MAX_AVATARS, MAX_CHANNELS, PersonRecord, setProfile } from "./db";
import { PATTERNS } from "./patterns";
import { settings } from "./settings";
import { refresh } from "./state";

const SEEN_STEP = 600_000;

interface RawUser {
    id: string;
    username?: string;
    globalName?: string | null;
    global_name?: string | null;
    avatar?: string | null;
    bot?: boolean;
}

interface RawMember {
    nick?: string | null;
    roles?: string[];
    joined_at?: string | null;
    joinedAt?: string | null;
    premium_since?: string | null;
    premiumSince?: string | null;
}

interface MemberWithUser extends RawMember {
    user: RawUser;
}

function rememberAvatar(rec: PersonRecord, avatar: string | null, now: number) {
    const old = rec.avatars.filter(a => a[0] !== avatar && a[0] !== rec.avatar);
    if (rec.avatar) old.push([rec.avatar, rec.avatarSince]);
    rec.avatars = old.slice(-MAX_AVATARS);
    rec.avatar = avatar;
    rec.avatarSince = now;
}

function seeUser(user: RawUser, now: number, at: number) {
    let rec = getPerson(user.id);
    if (!rec) {
        if (typeof user.username !== "string") return undefined;
        rec = ensurePerson(user.id);
    }
    let changed = false;
    if (user.username !== undefined && user.username !== rec.username) {
        rec.username = user.username;
        changed = true;
    }
    const globalName = user.globalName !== undefined ? user.globalName : user.global_name;
    if (globalName !== undefined && (globalName ?? "") !== rec.globalName) {
        rec.globalName = globalName ?? "";
        changed = true;
    }
    if (user.avatar !== undefined && user.avatar !== rec.avatar) {
        rememberAvatar(rec, user.avatar, now);
        changed = true;
    }
    if (user.bot && !rec.bot) {
        rec.bot = true;
        changed = true;
    }
    if (at) {
        if (!rec.firstSeen || at < rec.firstSeen) {
            rec.firstSeen = at;
            changed = true;
        }
        if (at - rec.lastSeen > SEEN_STEP) {
            rec.lastSeen = at;
            changed = true;
        }
    }
    if (changed) markDirty(rec.id);
    return rec;
}

function sameRoles(a: string[], b: string[]) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

function seeMember(guildId: string, user: RawUser, member: RawMember, now: number, at: number) {
    const rec = seeUser(user, now, at);
    if (!rec || !member.roles) return rec;
    const nick = member.nick ?? "";
    const joinedAt = member.joined_at ?? member.joinedAt ?? null;
    const premiumSince = member.premium_since ?? member.premiumSince ?? null;
    const known = rec.guilds[guildId];
    if (known && known.nick === nick && known.joinedAt === joinedAt && known.premiumSince === premiumSince && now - known.lastSeen <= SEEN_STEP && sameRoles(known.roles, member.roles)) return rec;
    rec.guilds[guildId] = { nick, roles: member.roles, joinedAt, premiumSince, lastSeen: now };
    markDirty(rec.id);
    return rec;
}

function seeChannel(rec: PersonRecord, channelId: string, at: number) {
    const { channels } = rec;
    let oldest = 0;
    for (let i = 0; i < channels.length; i++) {
        if (channels[i][0] === channelId) {
            if (at - channels[i][1] <= SEEN_STEP) return;
            channels[i][1] = at;
            return markDirty(rec.id);
        }
        if (channels[i][1] < channels[oldest][1]) oldest = i;
    }
    if (channels.length < MAX_CHANNELS) channels.push([channelId, at]);
    else if (at > channels[oldest][1]) channels[oldest] = [channelId, at];
    else return;
    markDirty(rec.id);
}

function seeId(userId: string, channelId: string, now: number) {
    const user = UserStore.getUser(userId);
    const rec = user ? seeUser(user, now, now) : getPerson(userId);
    if (rec) seeChannel(rec, channelId, now);
}

export function ingestChunk(guildId: string, members: MemberWithUser[]) {
    if (!settings.store.rememberPeople) return;
    const now = Date.now();
    for (const m of members) seeMember(guildId, m.user, m, now, 0);
    refresh();
}

interface ProfilePayload {
    user: RawUser;
    user_profile?: { bio?: string; pronouns?: string; };
    guild_member_profile?: { guild_id: string; bio?: string; pronouns?: string; } | null;
    connected_accounts?: Connection[];
    badges?: { id: string; description: string; }[];
    guild_badges?: { id: string; description: string; }[];
}

export function ingestProfile({ user, user_profile, guild_member_profile, connected_accounts, badges, guild_badges }: ProfilePayload) {
    if (settings.store.rememberPeople) seeUser(user, Date.now(), 0);
    const prev = getPerson(user.id)?.profile;
    const guildBios = { ...prev?.guildBios };
    const guildPronouns = { ...prev?.guildPronouns };
    if (guild_member_profile) {
        guildBios[guild_member_profile.guild_id] = guild_member_profile.bio ?? "";
        guildPronouns[guild_member_profile.guild_id] = guild_member_profile.pronouns ?? "";
    }
    setProfile(user.id, {
        bio: user_profile?.bio ?? "",
        pronouns: user_profile?.pronouns ?? "",
        guildBios,
        guildPronouns,
        connections: (connected_accounts ?? []).map(({ type, name }) => ({ type, name })),
        badges: [...badges ?? [], ...guild_badges ?? []].map(b => `${b.id} ${b.description}`),
        fetchedAt: Date.now(),
    });
    refresh();
}

function passive<T>(handler: (event: T, now: number) => void) {
    return (event: T) => {
        if (settings.store.rememberPeople) handler(event, Date.now());
    };
}

interface ListItem {
    member?: MemberWithUser;
}

interface ListOp {
    op: string;
    item?: ListItem;
    items?: ListItem[];
}

interface RawMessage {
    author: RawUser;
    member?: RawMember;
    channel_id: string;
    guild_id?: string;
    webhook_id?: string;
    timestamp: string;
}

export const passiveHandlers = {
    GUILD_MEMBER_LIST_UPDATE: passive(({ guildId, ops }: { guildId: string; ops: ListOp[]; }, now) => {
        const see = (item: ListItem | undefined) => {
            if (item?.member) seeMember(guildId, item.member.user, item.member, now, now);
        };
        for (const op of ops) {
            if (op.op === PATTERNS.listOps.sync) op.items?.forEach(see);
            else if (op.op === PATTERNS.listOps.insert || op.op === PATTERNS.listOps.update) see(op.item);
        }
    }),
    GUILD_MEMBER_ADD: passive((event: MemberWithUser & { guildId: string; }, now) => {
        seeMember(event.guildId, event.user, event, now, now);
    }),
    GUILD_MEMBER_UPDATE: passive((event: MemberWithUser & { guildId: string; }, now) => {
        seeMember(event.guildId, event.user, event, now, 0);
    }),
    GUILD_MEMBER_REMOVE: passive(({ guildId, user }: { guildId: string; user: RawUser; }) => {
        const rec = getPerson(user.id);
        if (!rec || !(guildId in rec.guilds)) return;
        delete rec.guilds[guildId];
        markDirty(rec.id);
    }),
    PASSIVE_UPDATE_V2: passive(({ guildId, members }: { guildId: string; members: MemberWithUser[]; }, now) => {
        for (const m of members) seeMember(guildId, m.user, m, now, now);
    }),
    MESSAGE_CREATE: passive(({ message, optimistic }: { message: RawMessage; optimistic: boolean; }, now) => {
        if (optimistic || message.webhook_id) return;
        const rec = message.member && message.guild_id
            ? seeMember(message.guild_id, message.author, message.member, now, now)
            : seeUser(message.author, now, now);
        if (rec) seeChannel(rec, message.channel_id, now);
    }),
    LOAD_MESSAGES_SUCCESS: passive(({ channelId, messages }: { channelId: string; messages: RawMessage[]; }, now) => {
        for (const message of messages) {
            if (message.webhook_id) continue;
            const at = Date.parse(message.timestamp) || now;
            const rec = seeUser(message.author, now, at);
            if (rec) seeChannel(rec, channelId, at);
        }
    }),
    VOICE_STATE_UPDATES: passive(({ voiceStates }: { voiceStates: { userId: string; channelId?: string | null; }[]; }, now) => {
        for (const { userId, channelId } of voiceStates) if (channelId) seeId(userId, channelId, now);
    }),
    TYPING_START: passive(({ userId, channelId }: { userId: string; channelId: string; }, now) => {
        seeId(userId, channelId, now);
    }),
    PRESENCE_UPDATES: passive(({ updates }: { updates: { user: RawUser; }[]; }, now) => {
        for (const { user } of updates) seeUser(user, now, now);
    }),
    USER_UPDATE: passive(({ user }: { user: RawUser; }, now) => {
        seeUser(user, now, 0);
    }),
};
