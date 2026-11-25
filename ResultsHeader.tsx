/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import { classNameFactory } from "@utils/css";
import { Checkbox, Slider } from "@webpack/common";

import { settings } from "./settings";

const cl = classNameFactory("vc-people-search-");
const VIEW_KEYS: ["grid", "oldAvatars", "similarity"] = ["grid", "oldAvatars", "similarity"];
export const DEFAULT_SIMILARITY = 85;

export function useView() {
    const { grid = false, oldAvatars = false, similarity = DEFAULT_SIMILARITY } = settings.use(VIEW_KEYS);
    return { grid, oldAvatars, similarity };
}

interface Props {
    count: number;
    comparing: boolean;
    onPickImage(): void;
}

export function ResultsHeader({ count, comparing, onPickImage }: Props) {
    const { grid, oldAvatars, similarity } = useView();

    return (
        <div className={cl("header")}>
            <BaseText size="xs" weight="semibold" color="text-subtle" className={cl("count")} aria-live="polite">
                {count === 1 ? "1 Result" : `${count} Results`}
            </BaseText>
            <Button size="small" variant="secondary" onClick={() => { settings.store.grid = !grid; }}>
                {grid ? "Show as list" : "Show avatars"}
            </Button>
            <Button size="small" variant="secondary" onClick={onPickImage}>
                Find similar avatars
            </Button>
            <Checkbox type="inverted" value={oldAvatars} onChange={(_, on) => { settings.store.oldAvatars = on; }}>
                Older avatars too
            </Checkbox>
            {comparing && (
                <div className={cl("similarity")}>
                    <BaseText size="xs" weight="semibold" color="text-subtle">At least this similar</BaseText>
                    <Slider
                        mini
                        initialValue={similarity}
                        minValue={50}
                        maxValue={100}
                        onValueChange={v => { settings.store.similarity = Math.round(v); }}
                        onValueRender={v => `${Math.round(v)}%`}
                    />
                </div>
            )}
        </div>
    );
}
