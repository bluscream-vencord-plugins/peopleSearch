/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Budget, settings } from "./settings";

const today = () => new Date().toDateString();

function usage(): Budget {
    const day = today();
    if (settings.store.budget?.day !== day) settings.store.budget = { day, profiles: 0, members: {} };
    return settings.store.budget ?? { day, profiles: 0, members: {} };
}

export const profilesLeft = () => Math.max(0, settings.store.profileBudget - usage().profiles);

export function spendProfile() {
    usage().profiles++;
}

export const memberQueriesLeft = (guildId: string) => Math.max(0, settings.store.memberQueryBudget - (usage().members[guildId] ?? 0));

export function spendMemberQuery(guildId: string) {
    const { members } = usage();
    members[guildId] = (members[guildId] ?? 0) + 1;
}
