/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { classNameFactory } from "@utils/css";
import { Checkbox, GuildStore, SearchableSelect, Select, TextInput, useMemo } from "@webpack/common";

import { FILTERS, HAS_VALUES, STATUS_VALUES } from "./filters";
import { guildToken, resolveGuilds } from "./people";
import { getValue, hasValue, setValue, toggleValue } from "./queryEdit";

const cl = classNameFactory("vc-people-search-");

interface Choice {
    label: string;
    key: string;
    value: string;
    negate?: boolean;
}

const relationshipChoices: Choice[] = [
    { label: "Friends", key: "is", value: "friend" },
    { label: "Not friends", key: "is", value: "friend", negate: true },
    { label: "Friend request I sent", key: "is", value: "outgoing" },
    { label: "Friend request I received", key: "is", value: "incoming" },
    { label: "Any pending friend request", key: "is", value: "pending" },
    { label: "Blocked", key: "is", value: "blocked" },
];

const whereChoices: Choice[] = [
    { label: "In my DMs", key: "is", value: "dm" },
    { label: "In a group DM with me", key: "is", value: "group" },
    { label: "Sent me a message request", key: "is", value: "request" },
];

const statusChoices: Choice[] = STATUS_VALUES.map(value => ({ label: value === "dnd" ? "Do not disturb" : value[0].toUpperCase() + value.slice(1), key: "status", value }));

const textFilters = FILTERS.filter(f => f.field);
const isFilters = [["bot", "Bots"], ["booster", "Boosters"], ["owner", "Server owners"], ["online", "Online"]] as const;

const choiceId = (c: Choice) => `${c.negate ? "-" : ""}${c.key}:${c.value}`;

interface Props {
    query: string;
    setQuery(query: string): void;
}

interface ChoiceSelectProps extends Props {
    choices: Choice[];
    anyLabel: string;
}

function ChoiceSelect({ query, setQuery, choices, anyLabel }: ChoiceSelectProps) {
    const current = choices.find(c => hasValue(query, c.key, c.value, c.negate));
    const select = (id: string) => {
        let next = choices.reduce((q, c) => toggleValue(q, c.key, c.value, false, c.negate), query);
        const chosen = choices.find(c => choiceId(c) === id);
        if (chosen) next = toggleValue(next, chosen.key, chosen.value, true, chosen.negate);
        setQuery(next);
    };
    return (
        <Select
            options={[{ label: anyLabel, value: "" }, ...choices.map(c => ({ label: c.label, value: choiceId(c) }))]}
            isSelected={v => v === (current ? choiceId(current) : "")}
            select={select}
            serialize={String}
        />
    );
}

export function QueryBuilder({ query, setQuery }: Props) {
    const guildOptions = useMemo(() => Object.values(GuildStore.getGuilds())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(g => ({ label: g.name, value: g.id })), []);

    const guildValue = getValue(query, "guild");
    const guildIds = guildValue ? resolveGuilds(guildValue) : [];

    const setGuild = (id: string | null) => {
        const guild = id ? GuildStore.getGuild(id) : null;
        setQuery(setValue(query, "guild", guild ? guildToken(guild) : ""));
    };

    return (
        <div className={cl("builder")}>
            <div className={cl("builder-row")}>
                <SearchableSelect
                    options={guildOptions}
                    value={guildIds.length === 1 ? guildIds[0] : undefined}
                    placeholder="Every server, friend, DM and request"
                    clearable
                    closeOnSelect
                    onChange={setGuild}
                />
                <ChoiceSelect query={query} setQuery={setQuery} choices={relationshipChoices} anyLabel="Any relationship" />
                <ChoiceSelect query={query} setQuery={setQuery} choices={whereChoices} anyLabel="Anywhere" />
                <ChoiceSelect query={query} setQuery={setQuery} choices={statusChoices} anyLabel="Any status" />
            </div>
            <div className={cl("builder-fields")}>
                {textFilters.map(({ key, title, example }) => (
                    <TextInput
                        key={key}
                        value={getValue(query, key)}
                        placeholder={example ? `${title}, like ${example}` : title}
                        aria-label={title}
                        onChange={v => setQuery(setValue(query, key, v))}
                    />
                ))}
            </div>
            <div className={cl("builder-checks")}>
                <BaseText size="sm" weight="semibold" color="text-muted" className={cl("builder-label")}>Must have</BaseText>
                {HAS_VALUES.map(value => (
                    <Checkbox key={value} type="inverted" value={hasValue(query, "has", value)} onChange={(_, on) => setQuery(toggleValue(query, "has", value, on))}>
                        {value === "nick" ? "nickname" : value === "oldavatar" ? "older avatar" : value}
                    </Checkbox>
                ))}
            </div>
            <div className={cl("builder-checks")}>
                <BaseText size="sm" weight="semibold" color="text-muted" className={cl("builder-label")}>Only</BaseText>
                {isFilters.map(([value, label]) => (
                    <Checkbox key={value} type="inverted" value={hasValue(query, "is", value)} onChange={(_, on) => setQuery(toggleValue(query, "is", value, on))}>
                        {label}
                    </Checkbox>
                ))}
            </div>
            <BaseText size="sm" color="text-muted">Put - in front of any filter in the search box to exclude it, quotes around phrases and /slashes/ around a regex.</BaseText>
        </div>
    );
}
