/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { classNameFactory } from "@utils/css";
import { isTruthy } from "@utils/guards";
import { RelationshipType } from "@vencord/discord-types/enums";
import { Avatar, Clickable, GuildStore, moment, PresenceStore, RelationshipStore, Tooltip, useStateFromStores } from "@webpack/common";
import type { ReactNode } from "react";

import { getProfile } from "./db";
import { avatarUrl, openProfile, Person, roleNames } from "./people";
import { Query } from "./search";

const cl = classNameFactory("vc-people-search-");
const MAX_ROLES = 6;

const relationshipLabels: Partial<Record<RelationshipType, string>> = {
    [RelationshipType.FRIEND]: "Friend",
    [RelationshipType.BLOCKED]: "Blocked",
    [RelationshipType.INCOMING_REQUEST]: "Sent you a request",
    [RelationshipType.OUTGOING_REQUEST]: "Request sent",
};

function whereFrom(person: Person) {
    const places = person.memberships.map(m => GuildStore.getGuild(m.guildId)?.name).filter(isTruthy);
    if (person.dm) places.unshift("DMs");
    if (person.groupDm) places.unshift("Group DM");
    if (person.request) places.unshift("Message request");
    return places;
}

function highlight(text: string, patterns: RegExp[]): ReactNode {
    const ranges = patterns
        .flatMap(re => [...text.matchAll(re)].map((m): [number, number] => [m.index, m.index + m[0].length]))
        .filter(([start, end]) => end > start)
        .sort((a, b) => a[0] - b[0]);
    const parts: ReactNode[] = [];
    let pos = 0;
    for (const [start, end] of ranges) {
        if (end <= pos) continue;
        const from = Math.max(start, pos);
        parts.push(text.slice(pos, from), <mark key={from} className={cl("highlight")}>{text.slice(from, end)}</mark>);
        pos = end;
    }
    return [...parts, text.slice(pos)];
}

interface TagProps {
    children: ReactNode;
}

function Tag({ children }: TagProps) {
    return <BaseText tag="span" size="xs" weight="medium" className={cl("tag")}>{children}</BaseText>;
}

interface ResultRowProps {
    person: Person;
    query: Query;
}

export function ResultRow({ person, query }: ResultRowProps) {
    const profile = getProfile(person.id);
    const guildBio = query.guildIds ? person.memberships.map(m => profile?.guildBios[m.guildId]).find(Boolean) : undefined;
    const bio = guildBio || profile?.bio;
    const relation = useStateFromStores([RelationshipStore], () => relationshipLabels[RelationshipStore.getRelationshipType(person.id)], [person.id]);
    const status = useStateFromStores([PresenceStore], () => PresenceStore.getStatus(person.id), [person.id]);
    const mobile = useStateFromStores([PresenceStore], () => PresenceStore.isMobileOnline(person.id), [person.id]);
    const nick = person.memberships.map(m => m.nick).find(Boolean);
    const roles = [...new Set(person.memberships.flatMap(roleNames))];
    const places = whereFrom(person);

    return (
        <Clickable className={cl("row")} onClick={() => openProfile(person.id)}>
            <Avatar
                size="SIZE_40"
                src={avatarUrl(person.id, person.avatar, 80)}
                status={status === "offline" ? undefined : status}
                isMobile={mobile}
                aria-hidden
            />
            <div className={cl("info")}>
                <div className={cl("name")}>
                    <BaseText tag="span" size="md" weight="medium" color="text-strong">{nick || person.globalName || person.username}</BaseText>
                    <BaseText tag="span" size="sm" color="text-muted">{person.username}</BaseText>
                    {profile?.pronouns && <Tag>{profile.pronouns}</Tag>}
                    {relation && <Tag>{relation}</Tag>}
                    {person.bot && <Tag>Bot</Tag>}
                </div>
                {bio && <BaseText size="sm" color="text-default" lineClamp={4} className={cl("bio")}>{highlight(bio, query.highlights)}</BaseText>}
                <div className={cl("meta")}>
                    {places.length > 0 && (
                        <Tooltip text={places.join(", ")}>
                            {props => <span {...props}><Tag>{places.length === 1 ? places[0] : `${places[0]} +${places.length - 1}`}</Tag></span>}
                        </Tooltip>
                    )}
                    {!!person.seen?.lastSeen && <Tag>Seen {moment(person.seen.lastSeen).fromNow()}</Tag>}
                    {roles.slice(0, MAX_ROLES).map(r => <Tag key={r}>{r}</Tag>)}
                    {roles.length > MAX_ROLES && (
                        <Tooltip text={roles.slice(MAX_ROLES).join(", ")}>
                            {props => <span {...props}><Tag>+{roles.length - MAX_ROLES}</Tag></span>}
                        </Tooltip>
                    )}
                    {profile?.connections.map(c => <Tag key={c.type + c.name}>{c.type}: {c.name}</Tag>)}
                </div>
            </div>
        </Clickable>
    );
}
