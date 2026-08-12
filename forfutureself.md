# to implement

- expo haptics (from settings)
- portrait
- saves
- customization (pad layout/opacity)
- physical / bluetooth controller (MgbaCoreView handles no key events yet)

# to fix

- emulation and audio keeps running with the screen off / app backgrounded
  (the gamepad already releases held buttons on background, but the core is never paused — see the AppState listener in GamepadOverlay.tsx)

# to test

- gamepad: hold left + tap A together, diagonals, rolling around the d-pad,
  drag off A and release, start/select, menu pause/reset/exit, background and
  return mid-press, screen stays awake
