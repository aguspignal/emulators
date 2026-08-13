# Tuning the on-screen gamepad

Where to change the size, position, and look of every pad element. All of it is pure TypeScript — Metro Fast Refresh picks up edits instantly, no rebuild.

Two files own everything:

- [`layout.ts`](../packages/ui/src/components/gamepad/layout.ts) — **all geometry**: how the window splits between game and pad, and every button's size and position.
- [`GamepadOverlay.tsx`](../packages/ui/src/components/gamepad/GamepadOverlay.tsx) — **all appearance**: colours, opacity, label text size.

---

## Button sizes

Every size is `Math.min(fraction-of-area, hard-cap)`. Raise the **fraction** to scale up on larger screens; raise the **cap** to lift the ceiling. All of these live in `buildGamepadLayout` in [`layout.ts`](../packages/ui/src/components/gamepad/layout.ts).

| What | Constant | Current |
| --- | --- | --- |
| **D-pad** | `dpadSize` | `min(usableHeight * 0.5, 150)` |
| **A / B / X / Y** | `faceSize` | `min(usableHeight * 0.2, 68)` |
| Gap between face buttons | `faceGap` | `faceSize * 0.28` |
| **Start / Select** | `smallWidth`, `smallHeight` | `min(usableHeight * 0.22, 64)`, `min(usableHeight * 0.1, 28)` |
| Gap around the menu button | `menuGap` | `smallGap + HIT_SLOP * 2` = `34` |
| Baseline gap | `smallGap` | `14` |
| **L / R / ZL / ZR** | `shoulderWidth`, `shoulderHeight` | `min(usableHeight * 0.22, 64)`, `min(usableHeight * 0.13, 36)` |
| Gap from L/R to ZL/ZR | `zGap` | `shoulderWidth + 12` |
| **Menu button** | `menuSize` | `min(usableHeight * 0.12, 36)` |
| Distance from every pad edge | `margin` | `max(16, usableHeight * 0.06)` |

`usableHeight` is the **pad area's** height, not the screen's — in portrait that is the band below the game, so the same numbers give a sensibly smaller pad there automatically.

**To scale the whole pad at once**, nudge the three main caps together: `150` (D-pad) / `68` (face) / `64` (Start·Select).

### If a number seems to do nothing

Check which side of the `Math.min` is binding on that device. A cap only has an effect while the fraction term is *above* it — if `usableHeight * 0.22` comes out at 45 and the cap is 64, the cap is dead and you need to raise the fraction instead.

This is exactly why every size here derives from the pad area's **height** and never its width. The area is about as tall in portrait as in landscape (band ≈ 370 vs. whole window ≈ 390) while its width more than doubles (≈ 410 vs. ≈ 870). Sizes derived from width landed on opposite sides of the `min` in the two orientations — the cap bound in landscape, the fraction bound in portrait — so editing the cap changed landscape only. `smallWidth` and `shoulderWidth` used to have this bug.

### Positions

- D-pad — bottom-left, anchored by `margin`.
- Face cluster — bottom-right. `clusterCx` / `clusterCy` set the diamond's centre; the `face(button, dx, dy)` calls place each button as a multiple of `spread` from it. For GB/GBA the `±0.75, ∓0.45` pair is A and B's diagonal offset.
- Select · Menu · Start — one centred row, in that order, with the menu button between the two pills. It sits along the bottom **if it fits** between the D-pad and the face cluster (`rowFits`), otherwise the whole row moves up into the empty middle. That check is what stops it colliding with the D-pad in a narrow portrait band, and it accounts for the full row width via `rowHalfWidth` — so widening `smallWidth`, `menuSize`, or `menuGap` can flip the row to the middle position.
- L / R / ZL / ZR — top edge.

---

## Game / pad split

Constants at the top of [`layout.ts`](../packages/ui/src/components/gamepad/layout.ts), used by `buildEmulatorLayout`:

| What | Constant | Current |
| --- | --- | --- |
| Portrait band height | `PORTRAIT_PAD_RATIO` | `0.9` × usable **width** |
| ...floor | `PORTRAIT_PAD_MIN_PX` | `260` |
| ...ceiling | `PORTRAIT_PAD_MAX_PX` | `460` |
| ...never more than this much of the screen | `PORTRAIT_PAD_MAX_RATIO` | `0.62` × usable height |

The band is derived from **width**, not height: a comfortable pad follows how far a thumb reaches across the device, not how tall the screen is.

Landscape has no band — the game is full-bleed and the pad floats over it, so there is nothing to tune there.

---

## Feel (invisible, but matters more than looks)

| What | Where | Current |
| --- | --- | --- |
| Touch margin around **every** button | `HIT_SLOP` in [`layout.ts`](../packages/ui/src/components/gamepad/layout.ts) | `10` px |
| D-pad dead zone (no-input radius at centre) | `deadZone` | `dpadSize * 0.14` |
| How far a thumb can roll past the D-pad edge and still steer | the `grow(dpadVisual, …)` call | `dpadSize * 0.18` |

Raise `HIT_SLOP` to make buttons easier to hit **without** making them look bigger. Shrink `deadZone` for a twitchier D-pad, grow it if neutral is hard to find.

Diagonals are eight equal octants around the D-pad centre — see `OCTANTS` in [`hitTest.ts`](../packages/ui/src/components/gamepad/hitTest.ts). Narrowing the diagonal wedges means changing that function, not a constant.

---

## Appearance

Top of [`GamepadOverlay.tsx`](../packages/ui/src/components/gamepad/GamepadOverlay.tsx):

| What | Constant | Current |
| --- | --- | --- |
| Button fill | `PAD_FILL` | `rgba(242, 242, 245, 0.16)` |
| Pressed fill | `PAD_FILL_PRESSED` | `rgba(230, 0, 18, 0.62)` |
| Button outline | `PAD_BORDER` | `rgba(242, 242, 245, 0.30)` |

The alphas are the ones to touch if the pad reads too strong or too faint over real game scenes — it sits directly on the video in landscape.

Label text sizes are in the `StyleSheet` at the bottom of the same file: `label` (A/B/X/Y, `20`), `labelSmall` (START/SELECT/L/R, `11`), `dpadArrow` (`16`).

---

## One rule if you move things around

`hitRegion` returns the **first** matching region, and `buildGamepadLayout` deliberately pushes the D-pad **last** because its hit area is oversized. If you reorder the `regions.push(...)` calls so the D-pad comes earlier, its slop will start swallowing touches aimed at Select and B.

Related: [`packages/ui/CLAUDE.md`](../packages/ui/CLAUDE.md) explains why the pad must stay a single responder view.
