/**
 * Mirrors `docs/legal/license/license-mpl-gba.md` — edit both together. The text is a
 * TS constant rather than a bundled `.md` because Metro would need a custom
 * transformer to import markdown, and this monorepo deliberately runs on
 * Expo's stock Metro config.
 *
 * Note this app's core is *not* GPL like the other two: mGBA is MPL 2.0, and
 * the blip_buf paragraph is not optional — it is compiled into libmgba
 * unconditionally (mGBA's CMakeLists appends it outside every feature guard),
 * so an LGPL 2.1 component ships inside libmgba-jni.so on every build.
 */
export const LICENSE_NOTICE = `This software is partly licensed under the Mozilla Public License 2.0. As per the terms of the MPL 2.0, we provide access to the complete source code for this software.

The emulation is provided by the mGBA core, built unmodified from the 0.10.5 release. You can obtain the full source code for this software, including any modifications made, directly from the GitHub repository at the following link:

https://github.com/mgba-emu/mgba

The source code is available to you free of charge, and you can download, modify and distribute it under the terms of the Mozilla Public License 2.0.

For more information about the MPL 2.0 license, please refer to the official documentation available at:

https://www.mozilla.org/MPL/2.0/

mGBA in turn includes blip_buf by Shay Green, which is licensed under the GNU Lesser General Public License 2.1 and is linked into this software. Its complete source code is part of the mGBA repository linked above, and the terms of the LGPL 2.1 are available at:

https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html

This software also includes inih by Ben Hoyt, licensed under the 3-clause BSD license, and Oboe by Google, licensed under the Apache License 2.0:

https://github.com/google/oboe`;
