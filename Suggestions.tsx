/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { TrashIcon } from "@components/Icons";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { findCssClassesLazy } from "@webpack";
import { Clickable, GuildRoleStore, GuildStore, React, Tooltip } from "@webpack/common";

import { FILTERS } from "./filters";
import { PATTERNS } from "./patterns";
import { resolveGuilds } from "./people";
import { getValue, quote, tokenize } from "./queryEdit";

const cl = classNameFactory("vc-people-search-");
const SearchClasses = findCssClassesLazy(...PATTERNS.webpack.searchClasses);
const MAX_SUGGESTIONS = 8;

export interface Suggestion {
    label: string;
    filterKey?: string;
    hint?: string;
    insert: string;
    group: "recent" | "filters" | "values";
    more?: boolean;
}

function valuesFor(key: string, query: string): readonly string[] {
    if (key === "guild") return Object.values(GuildStore.getGuilds()).map(g => g.name).sort();
    if (key === "role") {
        const scoped = getValue(query, "guild");
        const guildIds = scoped ? resolveGuilds(scoped) : Object.keys(GuildStore.getGuilds());
        return [...new Set(guildIds.flatMap(id => GuildRoleStore.getSortedRoles(id).map(r => r.name)).filter(n => n !== "@everyone"))].sort();
    }
    return FILTERS.find(f => f.key === key)?.values ?? [];
}

export function getSuggestions(query: string, history: string[]): Suggestion[] {
    const recent: Suggestion[] = query.trim() ? [] : history.map(h => ({ label: h, insert: `${h} `, group: "recent" }));
    return [...recent, ...filterAndValueSuggestions(query)];
}

function filterAndValueSuggestions(query: string): Suggestion[] {
    const tokens = tokenize(query);
    const last = PATTERNS.query.trailingSpace.test(query) ? undefined : tokens[tokens.length - 1];
    const before = last ? query.slice(0, last.start) : "";
    const after = query.trim() ? `${query.trimEnd()} ` : "";
    const prefix = last?.negate ? "-" : "";

    if (last?.key && FILTERS.some(f => f.key === last.key)) {
        const needle = last.value.toLowerCase();
        return valuesFor(last.key, query)
            .filter(v => v.toLowerCase().includes(needle) && v.toLowerCase() !== needle)
            .slice(0, MAX_SUGGESTIONS)
            .map((v): Suggestion => ({ label: v, insert: `${before}${prefix}${last.key}:${quote(v)} `, group: "values" }));
    }

    const typed = last && !last.key ? last.value.toLowerCase() : "";
    const filters = FILTERS
        .filter(f => !typed || f.key.startsWith(typed) || f.title.toLowerCase().includes(typed))
        .map((f): Suggestion => ({ label: f.title, filterKey: f.key, hint: f.hint, insert: `${typed ? before : after}${prefix}${f.key}:`, group: "filters" }));
    return filters.length ? [...filters, { label: "More filters", hint: "Every filter as fields and checkboxes", insert: query, group: "filters", more: true }] : [];
}

const GROUPS = ["recent", "filters", "values"] as const;
const HEADINGS: Record<Suggestion["group"], string> = { recent: "History", filters: "Search Options", values: "Suggestions" };

interface Props {
    id: string;
    suggestions: Suggestion[];
    selected: number;
    onPick(s: Suggestion): void;
    onClearHistory(): void;
}

export function SuggestionList({ id, suggestions, selected, onPick, onClearHistory }: Props) {
    return (
        <div id={id} role="listbox" aria-label="Search suggestions" tabIndex={-1} className={cl("suggest")} onMouseDown={e => e.preventDefault()}>
            {GROUPS.map(group => ({ group, rows: suggestions.filter(s => s.group === group) })).filter(g => g.rows.length).map(({ group, rows }, i) => (
                <React.Fragment key={group}>
                    {i > 0 && <div className={SearchClasses.divider} />}
                    <div role="group" aria-labelledby={`${id}-${group}`} className={SearchClasses.groupWrapper}>
                        <div id={`${id}-${group}`} className={classes(SearchClasses.groupHeader, cl("suggest-heading"))}>
                            <BaseText size="xs" weight="semibold" color="text-subtle">{HEADINGS[group]}</BaseText>
                            {group === "recent" && (
                                <Tooltip text="Clear Search History">
                                    {props => (
                                        <Clickable {...props} className={SearchClasses.clearSearchHistory} aria-label="Clear Search History" onClick={onClearHistory}>
                                            <TrashIcon width={18} height={18} className={SearchClasses.clearSearchHistoryIcon} />
                                        </Clickable>
                                    )}
                                </Tooltip>
                            )}
                        </div>
                        {rows.map(s => {
                            const index = suggestions.indexOf(s);
                            return (
                                <div
                                    key={s.insert + s.label}
                                    id={`${id}-${index}`}
                                    role="option"
                                    aria-selected={index === selected}
                                    tabIndex={-1}
                                    className={classes(SearchClasses.itemContainer, cl("suggest-row"))}
                                    ref={index === selected ? el => el?.scrollIntoView({ block: "nearest" }) : undefined}
                                    onClick={() => onPick(s)}
                                >
                                    <div className={SearchClasses.item}>
                                        <div>
                                            <BaseText size="sm" weight="medium" color="text-strong">{s.label}</BaseText>
                                            {s.hint && (
                                                <div className={SearchClasses.filterSublabelTextContainer}>
                                                    {s.filterKey && <BaseText size="sm" weight="semibold" color="text-subtle">{s.filterKey}:</BaseText>}
                                                    <BaseText size="sm" weight="medium" color="text-muted">{s.hint}</BaseText>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </React.Fragment>
            ))}
        </div>
    );
}
