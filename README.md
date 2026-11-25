# PeopleSearch

Equicord user plugin: finds people in a server or across all your servers by words in their bio, pronouns, names, roles, connections or status, filtered by friend status, and can find people whose avatar looks like an image you drop in.

Open it from a server's context menu, the toolbox, or the "Profile" button it adds to Discord's search results header.

## Remembering people

With **Remember people** on (the default), names, avatars, servers and channels are noted from what Discord already sends while you use it, without extra requests, so they stay searchable later. Turning it off stops that, including for member lists and profiles the plugin loads itself; fetched bios are still cached.

People you haven't seen again are forgotten after **Prune days** (90 by default, 0 keeps everyone). Avatar fingerprints nobody uses anymore are removed at the same time. The settings have buttons to forget seen people, cached bios or avatar fingerprints.

## Requests to Discord

Searching bios needs each person's profile, and searching a big server can need its member list. Both are fetched slowly and capped so searches stay gentle on Discord:

- **Profiles:** one every 3 to 5 seconds (Slow) or 1 to 1.5 seconds (Fast), at most 300 per run and at most **500 per day** by default (Profile budget setting). Every profile is cached for **Cache days** (30 by default), so each person is only fetched once in that time. Rate limits slow it down; repeated ones or long waits stop it.
- **Member lists:** a server's members are looked up by name prefix, at most **300 lookups per server per day** by default (Member lookup budget setting). Stopping or reaching the budget keeps the progress, and the next run continues where it stopped.
- **Avatars:** small avatar images are downloaded from Discord's CDN two at a time, at most 5000 per run, and each one only once.

The daily budgets survive restarts and reset at midnight. Closing the search window stops whatever it was fetching.

## Install

```sh
cd src/userplugins
git clone https://github.com/bluscream-vencord-plugins/peopleSearch
```

Rebuild Equicord and enable PeopleSearch. Update with `git pull`.
