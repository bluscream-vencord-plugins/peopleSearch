/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Flex } from "@components/Flex";
import { OptionType } from "@utils/types";
import { showToast } from "@webpack/common";

import { clearAvatarHashes, clearPeople, clearProfiles } from "./db";
import { forgetMemberLookups, stopJob } from "./jobs";
import { FetchModes, logger } from "./state";

async function clear(what: string, run: () => Promise<void>) {
    stopJob();
    try {
        await run();
        showToast({ text: `People Search forgot ${what}.`, variant: "success" });
    } catch (e) {
        logger.error("Failed to clear the cache.", e);
        showToast({ text: `People Search couldn't forget ${what}.`, variant: "critical" });
    }
}

function forgetPeople() {
    forgetMemberLookups();
    return clearPeople();
}

function ClearButtons() {
    return (
        <Flex flexWrap="wrap" gap="8px">
            <Button variant="dangerPrimary" onClick={() => clear("the people it has seen", forgetPeople)}>
                Forget seen people
            </Button>
            <Button variant="dangerPrimary" onClick={() => clear("the cached bios", clearProfiles)}>
                Forget cached bios
            </Button>
            <Button variant="dangerPrimary" onClick={() => clear("the avatar fingerprints", clearAvatarHashes)}>
                Forget avatar fingerprints
            </Button>
        </Flex>
    );
}

export interface Budget {
    day: string;
    profiles: number;
    members: Record<string, number>;
}

export interface PrivateSettings {
    lastQuery?: string;
    showFilters?: boolean;
    history?: string[];
    grid?: boolean;
    oldAvatars?: boolean;
    similarity?: number;
    budget?: Budget;
}

export const settings = definePluginSettings({
    rememberPeople: {
        type: OptionType.BOOLEAN,
        description: "Remember people I see. Names, avatars, servers and channels are noted from what Discord already sends while you use it, without any extra requests, so they stay searchable later.",
        default: true,
    },
    pruneDays: {
        type: OptionType.SLIDER,
        description: "Days after which someone you haven't seen again is forgotten when Discord starts. 0 keeps everyone.",
        markers: [0, 30, 90, 180, 365],
        default: 90,
        stickToMarkers: true,
    },
    fetchMode: {
        type: OptionType.SELECT,
        description: "How bios you don't have cached yet are fetched. Every bio is cached, so each person is only fetched once.",
        options: [
            { label: "Slow, one profile every 3 to 5 seconds (safest)", value: FetchModes.Slow, default: true },
            { label: "Fast, about one profile every 1 to 1.5 seconds (higher risk of Discord flagging the account)", value: FetchModes.Fast },
            { label: "Cached only, never fetch profiles", value: FetchModes.Cached },
        ],
    },
    cacheDays: {
        type: OptionType.SLIDER,
        description: "Days before a cached bio is considered outdated and fetched again.",
        markers: [1, 7, 14, 30, 90, 365],
        default: 30,
        stickToMarkers: true,
    },
    profileBudget: {
        type: OptionType.SLIDER,
        description: "Most profiles fetched per day. Searches stop when it's used up and continue the next day.",
        markers: [100, 250, 500, 1000, 2000],
        default: 500,
        stickToMarkers: true,
    },
    memberQueryBudget: {
        type: OptionType.SLIDER,
        description: "Most member list lookups per server per day. Loading a big server's member list resumes the next day once it's used up.",
        markers: [100, 300, 600, 1000],
        default: 300,
        stickToMarkers: true,
    },
    clearCache: {
        type: OptionType.COMPONENT,
        component: ClearButtons,
    },
}).withPrivateSettings<PrivateSettings>();
