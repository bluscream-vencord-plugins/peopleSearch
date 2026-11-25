/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Every string and regex this plugin matches against Discord code, events or user input. */
export const PATTERNS = {
    patch: {
        /** The search results header with the "Filters" button. */
        find: '.FiltersHorizontalIcon,size:"sm"',
        /** Right before that button's jsx call, regardless of its prop order. */
        beforeFiltersButton: /(?=\(0,\i\.jsx\)\(\i\.\i,\{[^}]{0,80}?icon:\i\.FiltersHorizontalIcon)/,
    },

    webpack: {
        searchClasses: ["itemContainer", "item", "filterSublabelTextContainer", "groupWrapper", "groupHeader", "divider", "clearSearchHistory", "clearSearchHistoryIcon"],
        spamRequestStore: "SpamMessageRequestStore",
        searchQueryStore: "SearchQueryStore",
    },

    /** Discord's search context types, keyed the way it stores search state. */
    searchContext: {
        guild: "GUILD",
        dms: "DMS",
    },

    events: {
        memberChunks: "GUILD_MEMBERS_CHUNK_BATCH",
        memberRequest: "GUILD_MEMBERS_REQUEST",
        profileFetchFailure: "USER_PROFILE_FETCH_FAILURE",
    },

    /** Member list update operations that carry members. */
    listOps: {
        sync: "SYNC",
        insert: "INSERT",
        update: "UPDATE",
    },

    /** Prefix of the nonce sent with member lookups by id, so their chunks can be told apart. */
    noncePrefix: "vc-ps-",

    status: {
        forbidden: 403,
        notFound: 404,
        rateLimited: 429,
    },

    /** A connection of this type is a verified website. */
    domainConnection: "domain",

    query: {
        /** One search token: optional minus, optional key:, then a quoted value, a /regex/flags or a bare word. */
        token: /(-)?(?:([a-z]+):)?(?:"([^"]*)"|(\/(?:[^/\\]|\\.)+\/[a-z]*)|(\S*))/gi,
        leadingQuote: /^"/,
        needsQuotes: /[\s"]/,
        repeatedSpace: /\s{2,}/g,
        trailingSpace: /\s$/,
        leadingMinus: /^-/,
        /** "/source/flags" typed as a value. */
        regexValue: /^\/(.+)\/([a-z]*)$/,
        stickyGlobalFlags: /[gy]/g,
        /** Optional comparison then a date, as in joined:>=2024-05. */
        dateValue: /^([<>]=?)?(.+)$/,
        url: /\bhttps?:\/\/[^\s<>()]+|\bwww\.[^\s<>()]+/gi,
        /** A 64 bit avatar fingerprint as 16 hex digits. */
        avatarHash: /^[0-9a-f]{16}$/i,
    },

    /** Characters member names are looked up by, one prefix at a time. */
    memberAlphabet: "abcdefghijklmnopqrstuvwxyz0123456789_.",
};
