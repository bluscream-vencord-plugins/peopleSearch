/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const IS_VALUES = ["friend", "outgoing", "incoming", "pending", "blocked", "dm", "group", "request", "bot", "booster", "owner", "online"] as const;
export const HAS_VALUES = ["bio", "pronouns", "connection", "site", "badge", "nick", "avatar", "oldavatar", "role", "activity"] as const;
export const STATUS_VALUES = ["online", "idle", "dnd", "offline"] as const;
const CONNECTION_VALUES = ["steam", "github", "twitch", "youtube", "spotify", "xbox", "playstation", "reddit", "twitter", "tiktok", "instagram", "domain", "battlenet", "epicgames", "riotgames", "roblox"] as const;

export interface Filter {
    key: string;
    title: string;
    hint: string;
    values?: readonly string[];
    field?: boolean;
    example?: string;
}

export const FILTERS: readonly Filter[] = [
    { key: "guild", title: "In a specific server", hint: "server name" },
    { key: "is", title: "Relationship or where you know them", hint: "friend, outgoing, pending, dm, request", values: IS_VALUES },
    { key: "name", title: "Name or nickname", hint: "text", field: true },
    { key: "bio", title: "Bio contains", hint: "text", field: true },
    { key: "pronouns", title: "Pronouns", hint: "text", field: true },
    { key: "role", title: "Has a role", hint: "role name", field: true },
    { key: "status", title: "Status", hint: "online, idle, dnd, offline (only where Discord shares it)", values: STATUS_VALUES },
    { key: "activity", title: "Playing or custom status", hint: "text", field: true },
    { key: "connection", title: "Linked account", hint: "steam, github, or an account name", values: CONNECTION_VALUES, field: true, example: "steam" },
    { key: "site", title: "Website", hint: "domain or link", field: true },
    { key: "has", title: "Has something set", hint: "bio, pronouns, connection, nick, role", values: HAS_VALUES },
    { key: "badge", title: "Profile badge", hint: "hypesquad, premium", field: true },
    { key: "joined", title: "Joined the server", hint: "2024, >2023-06, <2022", field: true, example: ">2024-01" },
    { key: "created", title: "Account created", hint: "2024, >2023-06, <2022", field: true, example: "<2020" },
    { key: "seen", title: "Last seen by you", hint: "2026, >2026-06, <2025", field: true, example: ">2026-10" },
    { key: "in", title: "Seen in a channel", hint: "channel name or id", field: true },
    { key: "like", title: "Avatar looks like an image", hint: "drop, paste or pick an image" },
];
