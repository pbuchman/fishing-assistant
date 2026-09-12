# Third-Party Notices

Fishing Assistant is released under the MIT License in `LICENSE`. That license
applies to the project's original code, tests, documentation, and project
graphics. Third-party software remains governed by its own license terms and
notices.

This file highlights dependencies with license terms or notices that should be
easy to find in a source or application distribution. It is not a replacement
for the license files distributed with installed packages or a complete list of
every transitive package in `pnpm-lock.yaml`.

## Project graphics

The maintainer has confirmed that the following bundled graphics were created
for Fishing Assistant as original or AI-generated work and has included them in
the project's MIT license grant to the extent copyrightable rights exist:

- `apps/web/public/icons/icon-192.png`
- `apps/web/public/icons/icon-512.png`
- `apps/web/public/og/fishing-assistant.png`
- `apps/web/public/og/home-preview.svg`
- `apps/web/src/assets/home-hero.webp`

## Selected dependencies

| Package                                                  | Resolved version | License recorded by the package                      |
| -------------------------------------------------------- | ---------------: | ---------------------------------------------------- |
| `pm2`                                                    |           6.0.14 | GNU Affero General Public License v3.0 (`AGPL-3.0`)  |
| `@pm2/agent`                                             |            2.1.1 | GNU Affero General Public License v3.0 (`AGPL-3.0`)  |
| `lightningcss` and its optional native platform packages |           1.32.0 | Mozilla Public License 2.0 (`MPL-2.0`)               |
| `lucide-react`                                           |          0.468.0 | ISC License, including the Feather attribution below |

The exact license texts for the resolved PM2 and Lightning CSS versions are
available from their upstream source tags:

- [PM2 6.0.14 — GNU Affero General Public License v3.0](https://github.com/Unitech/pm2/blob/v6.0.14/GNU-AGPL-3.0.txt)
- [`@pm2/agent` 2.1.1 — GNU Affero General Public License v3.0](https://github.com/keymetrics/pm2-io-agent/blob/v2.1.1/LICENSE)
- [Lightning CSS 1.32.0 — Mozilla Public License 2.0](https://github.com/parcel-bundler/lightningcss/blob/v1.32.0/LICENSE)

The Lightning CSS platform packages represented in the lockfile are
`lightningcss-android-arm64`, `lightningcss-darwin-arm64`,
`lightningcss-darwin-x64`, `lightningcss-freebsd-x64`,
`lightningcss-linux-arm-gnueabihf`, `lightningcss-linux-arm64-gnu`,
`lightningcss-linux-arm64-musl`, `lightningcss-linux-x64-gnu`,
`lightningcss-linux-x64-musl`, `lightningcss-win32-arm64-msvc`, and
`lightningcss-win32-x64-msvc`, all at version 1.32.0.

## Lucide and Feather notice

The following is the license notice distributed verbatim with
[`lucide-react` 0.468.0](https://github.com/lucide-icons/lucide/blob/0.468.0/LICENSE):

```text
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

Other third-party packages keep their own licenses and notices in their
upstream repositories and installed package directories.
