/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { findStoreLazy } from "@webpack";
import { useStateFromStores } from "@webpack/common";

import { PATTERNS } from "./patterns";
import { openProfile } from "./people";

interface SearchContext { type: string; guildId?: string; channelId?: string; }
interface SearchQuery { author_id?: string[]; mentions?: string[]; }
interface SearchQueryStoreType { getSearchResultsQuery(id: string): SearchQuery | null; }

const SearchQueryStore: SearchQueryStoreType = findStoreLazy(PATTERNS.webpack.searchQueryStore);

const searchId = (ctx: SearchContext) =>
    ctx.type === PATTERNS.searchContext.guild ? ctx.guildId : ctx.type === PATTERNS.searchContext.dms ? ctx.type : ctx.channelId;

export const ProfileButton = ErrorBoundary.wrap(({ searchContext }: { searchContext: SearchContext; }) => {
    const userId = useStateFromStores([SearchQueryStore], () => {
        const id = searchId(searchContext);
        const query = id ? SearchQueryStore.getSearchResultsQuery(id) : null;
        return query?.author_id?.[0] ?? query?.mentions?.[0];
    }, [searchContext]);
    if (!userId) return null;
    return <Button variant="secondary" size="small" onClick={() => openProfile(userId)}>Profile</Button>;
}, { noop: true });
