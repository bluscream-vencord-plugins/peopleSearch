/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PATTERNS } from "./patterns";

export interface Token {
    raw: string;
    negate: boolean;
    key: string | undefined;
    value: string;
    start: number;
    end: number;
}

export function tokenize(query: string): Token[] {
    return [...query.matchAll(PATTERNS.query.token)].filter(m => m[0]).map(m => ({
        raw: m[0],
        negate: m[1] === "-",
        key: m[2]?.toLowerCase(),
        value: m[3] ?? m[4] ?? m[5]?.replace(PATTERNS.query.leadingQuote, "") ?? "",
        start: m.index,
        end: m.index + m[0].length,
    }));
}

export const quote = (value: string) => PATTERNS.query.needsQuotes.test(value) || !value ? `"${value.replaceAll('"', "")}"` : value;
const format = (key: string, value: string, negate: boolean) => `${negate ? "-" : ""}${key}:${quote(value)}`;
const tidy = (query: string) => query.replace(PATTERNS.query.repeatedSpace, " ").trim();

function rewrite(query: string, remove: Token[], insert: string | null) {
    let out = query;
    const [first, ...rest] = remove;
    for (const t of [...rest].reverse()) out = out.slice(0, t.start) + out.slice(t.end);
    if (first) return tidy(out.slice(0, first.start) + (insert ?? "") + out.slice(first.end));
    return insert ? tidy(`${out.trimEnd()} ${insert}`) : tidy(out);
}

const matching = (query: string, key: string, negate: boolean, value?: string) =>
    tokenize(query).filter(t => t.key === key && t.negate === negate && (value === undefined || t.value.toLowerCase() === value));

export const getValue = (query: string, key: string, negate = false) => matching(query, key, negate)[0]?.value ?? "";

export const hasValue = (query: string, key: string, value: string, negate = false) => matching(query, key, negate, value).length > 0;

export function setValue(query: string, key: string, value: string, negate = false) {
    return rewrite(query, matching(query, key, negate), value ? format(key, value, negate) : null);
}

export function toggleValue(query: string, key: string, value: string, on: boolean, negate = false) {
    const existing = matching(query, key, negate, value);
    if (on === existing.length > 0) return query;
    return on ? rewrite(query, [], format(key, value, negate)) : rewrite(query, existing, null);
}
