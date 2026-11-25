/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { Clickable, Tooltip, useState } from "@webpack/common";

import { Tile } from "./avatarHash";
import { avatarUrl, openProfile } from "./people";

const cl = classNameFactory("vc-people-search-");

interface GridTileProps {
    tile: Tile;
}

function GridTile({ tile: { person, avatar, note } }: GridTileProps) {
    const [broken, setBroken] = useState(false);
    if (broken) return null;
    const name = person.globalName || person.username;

    return (
        <Tooltip text={note ? `${name} (${note})` : name}>
            {props => (
                <Clickable {...props} className={cl("tile")} aria-label={name} onClick={() => openProfile(person.id)}>
                    <img className={cl("tile-image")} src={avatarUrl(person.id, avatar, 64)} alt="" loading="lazy" onError={() => setBroken(true)} />
                </Clickable>
            )}
        </Tooltip>
    );
}

interface AvatarGridProps {
    tiles: Tile[];
}

export function AvatarGrid({ tiles }: AvatarGridProps) {
    return (
        <div className={cl("grid")}>
            {tiles.map(tile => <GridTile key={`${tile.person.id}/${tile.avatar}`} tile={tile} />)}
        </div>
    );
}
