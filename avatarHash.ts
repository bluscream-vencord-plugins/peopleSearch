/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { AvatarHash, getAvatarHash, setAvatarHash } from "./db";
import { PATTERNS } from "./patterns";
import { avatarsOf, avatarUrl, Person } from "./people";
import { abortJob, beginJob, finishJob, isCurrent, logger, pause, refresh, setJob } from "./state";

const SIZE = 64;
const COLUMNS = 9;
const ROWS = 8;
const CONCURRENCY = 2;
const HASH_DELAY = 150;
const MAX_FAILURES = 20;
export const MAX_HASHES_PER_RUN = 5000;
export const HASH_MS = 150;

const failed = new Set<string>();

function hashPixels(source: CanvasImageSource, width: number, height: number): AvatarHash {
    const ctx = new OffscreenCanvas(SIZE, SIZE).getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("No 2D canvas is available.");
    const side = Math.min(width, height);
    ctx.imageSmoothingQuality = "high";
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(source, (width - side) / 2, (height - side) / 2, side, side, 0, 0, SIZE, SIZE);
    const { data } = ctx.getImageData(0, 0, SIZE, SIZE);

    const sums = new Float64Array(COLUMNS * ROWS);
    const counts = new Uint16Array(COLUMNS * ROWS);
    for (let y = 0; y < SIZE; y++) {
        const row = Math.floor(y * ROWS / SIZE) * COLUMNS;
        for (let x = 0; x < SIZE; x++) {
            const cell = row + Math.floor(x * COLUMNS / SIZE);
            const i = (y * SIZE + x) * 4;
            sums[cell] += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            counts[cell]++;
        }
    }

    const hash: AvatarHash = [0, 0];
    for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLUMNS - 1; col++) {
            const cell = row * COLUMNS + col;
            if (sums[cell] / counts[cell] > sums[cell + 1] / counts[cell + 1]) hash[row >> 2] |= 1 << ((row & 3) * 8 + col);
        }
    }
    return [hash[0] >>> 0, hash[1] >>> 0];
}

function loadImage(url: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("The image failed to load."));
        img.src = url;
    });
}

export async function hashFile(file: Blob) {
    const bitmap = await createImageBitmap(file);
    try {
        return hashPixels(bitmap, bitmap.width, bitmap.height);
    } finally {
        bitmap.close();
    }
}

export async function hashAvatar(userId: string, avatar: string) {
    const cached = getAvatarHash(avatar);
    if (cached) return cached;
    const img = await loadImage(avatarUrl(userId, avatar, SIZE));
    const hash = hashPixels(img, img.naturalWidth, img.naturalHeight);
    setAvatarHash(avatar, hash);
    return hash;
}

const hex = (n: number) => n.toString(16).padStart(8, "0");
export const hashToText = (hash: AvatarHash) => hex(hash[0]) + hex(hash[1]);

export function parseHash(text: string): AvatarHash | null {
    if (!PATTERNS.query.avatarHash.test(text)) return null;
    return [parseInt(text.slice(0, 8), 16), parseInt(text.slice(8), 16)];
}

function bits(n: number) {
    n -= (n >>> 1) & 0x55555555;
    n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
    return Math.imul((n + (n >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}

const distance = (a: AvatarHash, b: AvatarHash) => bits(a[0] ^ b[0]) + bits(a[1] ^ b[1]);

export interface HashTarget {
    id: string;
    avatar: string;
}

export function missingHashes(people: Person[], includeOld: boolean) {
    const seen = new Set<string>();
    const todo: HashTarget[] = [];
    for (const person of people) {
        for (const avatar of avatarsOf(person, includeOld)) {
            if (seen.has(avatar) || failed.has(avatar) || getAvatarHash(avatar)) continue;
            seen.add(avatar);
            todo.push({ id: person.id, avatar });
        }
    }
    return todo;
}

export async function hashAvatars(all: HashTarget[]) {
    if (!all.length) return true;
    const todo = all.slice(0, MAX_HASHES_PER_RUN);
    const id = beginJob("avatars", todo.length);
    let next = 0;
    let done = 0;
    let failures = 0;

    async function worker() {
        while (isCurrent(id) && next < todo.length) {
            const { id: userId, avatar } = todo[next++];
            try {
                await hashAvatar(userId, avatar);
                failures = 0;
                refresh();
            } catch (e) {
                failed.add(avatar);
                if (++failures >= MAX_FAILURES && isCurrent(id)) {
                    logger.error("Reading avatars keeps failing.", e);
                    failed.clear();
                    abortJob(`Stopped after ${MAX_FAILURES} avatars in a row couldn't be read. Wait a while before running again.`);
                }
            }
            if (!isCurrent(id)) return;
            setJob({ done: ++done });
            await pause(HASH_DELAY);
        }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (!finishJob(id)) return false;
    if (all.length > todo.length) setJob({ note: `Compared ${todo.length} avatars, the most per run. Run again for the other ${all.length - todo.length}.` });
    return true;
}

export interface Tile {
    person: Person;
    avatar: string | null;
    note: string;
}

export function plainTiles(people: Person[], includeOld: boolean): Tile[] {
    if (!includeOld) return people.map(person => ({ person, avatar: person.avatar, note: "" }));
    return people.flatMap(person => [
        { person, avatar: person.avatar, note: "" },
        ...avatarsOf(person, true).filter(a => a !== person.avatar).map(avatar => ({ person, avatar, note: "older avatar" })),
    ]);
}

export function similarTiles(people: Person[], reference: AvatarHash, minSimilarity: number, includeOld: boolean): Tile[] {
    const maxDistance = Math.round((100 - minSimilarity) * 0.64);
    const ranked: [number, Tile][] = [];
    for (const person of people) {
        let best = maxDistance + 1;
        let match: string | undefined;
        for (const avatar of avatarsOf(person, includeOld)) {
            const hash = getAvatarHash(avatar);
            const d = hash ? distance(hash, reference) : best;
            if (d < best) {
                best = d;
                match = avatar;
            }
        }
        if (match === undefined) continue;
        const similar = `${Math.round(100 - best / 0.64)}% similar`;
        ranked.push([best, { person, avatar: match, note: match === person.avatar ? similar : `${similar}, older avatar` }]);
    }
    return ranked.sort((a, b) => a[0] - b[0]).map(r => r[1]);
}
