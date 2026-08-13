/**
 * Mirrors `docs/legal/license/license-gpl-threeds.md` — edit both together. The
 * text is a TS constant rather than a bundled `.md` because Metro would need a custom
 * transformer to import markdown, and this monorepo deliberately runs on
 * Expo's stock Metro config.
 */
export const LICENSE_NOTICE = `This software is partly licensed under the GPL v2 license. As per the terms of the GPL v2, we provide access to the complete source code for this software.

You can obtain the full source code for this software, including any modifications made, directly from the GitHub repository at the following link:

https://github.com/azahar-emu/azahar

The source code is available to you free of charge, and you can download, modify and distribute it under the terms of the GPL v2 license.

For more information about the GPL v2 license, please refer to the official documentation available at:

https://www.gnu.org/licenses/old-licenses/gpl-2.0.html`;
