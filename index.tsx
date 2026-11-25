/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import { Guild, User } from "@vencord/discord-types";
import { Menu, showToast } from "@webpack/common";
import type { ComponentProps } from "react";

import { hashAvatar, hashToText } from "./avatarHash";
import { ingestChunk, ingestProfile, passiveHandlers } from "./collect";
import { loadCache } from "./db";
import { forwardMemberChunks, stopJob } from "./jobs";
import { PATTERNS } from "./patterns";
import { ProfileButton } from "./ProfileButton";
import { openPeopleSearch } from "./SearchModal";
import { settings } from "./settings";
import { logger } from "./state";

const GuildMenuPatch: NavContextMenuPatchCallback = (children, { guild }: { guild?: Guild; }) => {
    if (!guild) return;
    children.push(
        <Menu.MenuItem
            id="vc-people-search"
            label="Search People"
            action={() => openPeopleSearch(guild.id)}
        />
    );
};

async function findSimilarAvatars(userId: string, avatar: string) {
    try {
        const hash = hashToText(await hashAvatar(userId, avatar));
        settings.store.grid = true;
        openPeopleSearch(null, `like:${hash} `);
    } catch (e) {
        logger.error("Failed to read the avatar.", e);
        showToast({ text: "That avatar couldn't be read.", variant: "critical" });
    }
}

const UserMenuPatch: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    const avatar = user?.avatar;
    if (!user || !avatar) return;
    children.push(
        <Menu.MenuItem
            id="vc-people-search-similar"
            label="Find Similar Avatars"
            action={() => void findSimilarAvatars(user.id, avatar)}
        />
    );
};

export default definePlugin({
    name: "PeopleSearch",
    description: "Finds people in a server or across all your servers by words in their bio, pronouns or names, filtered by friend status, and remembers the people you come across so you can find them later, even by what their avatar looks like. Bios are cached and fetched slowly to stay within Discord's rate limits.",
    authors: [{ name: "Bluscream", id: 467777925790564352n }],
    settings,

    patches: [
        {
            find: PATTERNS.patch.find,
            replacement: {
                match: PATTERNS.patch.beforeFiltersButton,
                replace: "$self.renderProfileButton(arguments[0].searchContext),"
            }
        }
    ],

    renderProfileButton: (searchContext: ComponentProps<typeof ProfileButton>["searchContext"]) => <ProfileButton searchContext={searchContext} />,

    contextMenus: {
        "guild-context": GuildMenuPatch,
        "guild-header-popout": GuildMenuPatch,
        "user-context": UserMenuPatch,
    },

    toolboxActions: {
        "Search People"() {
            openPeopleSearch(null);
        },
    },

    flux: {
        ...passiveHandlers,
        GUILD_MEMBERS_CHUNK_BATCH({ chunks }: { chunks: { guildId: string; nonce?: string | null; members: Parameters<typeof ingestChunk>[1]; }[]; }) {
            for (const c of chunks) ingestChunk(c.guildId, c.members);
            forwardMemberChunks(chunks);
        },
        USER_PROFILE_FETCH_SUCCESS({ userProfile }: { userProfile: Parameters<typeof ingestProfile>[0]; }) {
            ingestProfile(userProfile);
        },
    },

    start() {
        loadCache(settings.store.pruneDays).catch(e => logger.error("Failed to load the cache.", e));
    },

    stop() {
        stopJob();
    },
});
