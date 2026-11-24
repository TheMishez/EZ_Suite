/* Built-in starter crosshairs. Each is a full design (list of layers). */
window.PRESETS = [
  { name: 'Crosshair 2', layers: [{ name: 'Crosshair 2', style: 'crosshair2', color: '#ff0000', size: 11.8, gap: 5.3, thickness: 4.8, outline: false, outlineThickness: 0 }] },
  { name: 'Dynamic Spread', dynamic: { enabled: true, duration: 120, ease: 'out-quad', move: 4, run: 6, shoot: 3, jump: 5, aim: -2, reload: 0 }, layers: [{ name: 'Cross', style: 'cross', color: '#00ff91', size: 5, gap: 3, thickness: 2, outline: true, outlineThickness: 1, dot: true, dotSize: 2 }] },
  { name: 'Reload Red', rules: [{ trigger: 'reload', color: '#ff2b2b', mode: 'hold', outline: false }, { trigger: 'aim', color: '#ffee00', mode: 'hold', outline: false }], layers: [{ name: 'Cross', style: 'cross', color: '#00e5ff', size: 6, gap: 3, thickness: 2, outline: true, outlineThickness: 1 }] },
  { name: 'Classic Green', layers: [{ style: 'cross', color: '#00ff66', size: 6, gap: 3, thickness: 2, outline: true, outlineThickness: 1 }] },
  { name: 'Cyan Tight', layers: [{ style: 'cross', color: '#00e5ff', size: 4, gap: 2, thickness: 1, outline: false }] },
  { name: 'Hot Pink', layers: [{ style: 'cross', color: '#ff2bd6', size: 5, gap: 6, thickness: 2, outline: true, outlineThickness: 1 }] },
  { name: 'T-Style', layers: [{ style: 'cross', color: '#ffee00', size: 6, gap: 3, thickness: 2, tStyle: true, outline: true, outlineThickness: 1 }] },
  { name: 'Dot', layers: [{ style: 'cross', color: '#ff3b3b', size: 0, gap: 0, thickness: 1, dot: true, dotSize: 3, outline: true, outlineThickness: 1 }] },
  { name: 'Ring + Dot', layers: [
    { name: 'Ring', style: 'circle', color: '#ffffff', size: 8, thickness: 1, outline: true, outlineThickness: 1 },
    { name: 'Dot', style: 'cross', color: '#ff3b3b', size: 0, gap: 0, dot: true, dotSize: 2, outline: false }
  ] },
  { name: 'Neon Glow', layers: [{ style: 'cross', color: '#00e5ff', size: 8, gap: 4, thickness: 2, outline: false, glow: 10 }] },
  { name: 'Spray Reactive', layers: [
    { name: 'Cross', style: 'cross', color: '#00ff66', size: 6, gap: 3, thickness: 2, outline: true, outlineThickness: 1, animation: 'expand', animTrigger: 'shoot', animMode: 'pulse', animEase: 'out-back', animIntensity: 6, animDuration: 150 },
    { name: 'Dot', style: 'cross', color: '#ffffff', size: 0, gap: 0, dot: true, dotSize: 1, outline: false }
  ] },
  { name: 'Scope Hide', layers: [
    { name: 'Cross', style: 'cross', color: '#00ff66', size: 7, gap: 3, thickness: 2, outline: true, outlineThickness: 1, animation: 'hide', animTrigger: 'aim', animMode: 'hold', animIntensity: 10, animDuration: 120 }
  ] },
  { name: 'Run Spread', layers: [
    { name: 'Cross', style: 'cross', color: '#ffee00', size: 5, gap: 3, thickness: 2, outline: true, outlineThickness: 1, animation: 'expand', animTrigger: 'move', animMode: 'hold', animEase: 'out-quad', animIntensity: 8, animDuration: 160 }
  ] },
  // Colorblind-friendly: colors picked from the Okabe-Ito palette, which stays distinct for the common colorblindness types.
  { name: 'CB Orange', layers: [{ style: 'cross', color: '#e69f00', size: 6, gap: 3, thickness: 2, outline: true, outlineColor: '#000000', outlineThickness: 1 }] },
  { name: 'CB Sky Blue', layers: [{ style: 'cross', color: '#56b4e9', size: 6, gap: 3, thickness: 2, outline: true, outlineColor: '#000000', outlineThickness: 1 }] },
  { name: 'CB Yellow', layers: [{ style: 'cross', color: '#f0e442', size: 6, gap: 3, thickness: 2, outline: true, outlineColor: '#000000', outlineThickness: 1 }] },
  { name: 'CB White + Dot', layers: [{ style: 'cross', color: '#ffffff', size: 6, gap: 3, thickness: 2, dot: true, dotSize: 2, outline: true, outlineColor: '#000000', outlineThickness: 1 }] },
  { name: 'X Marker', layers: [{ style: 'x', color: '#ff3b3b', size: 7, gap: 2, thickness: 2, outline: true, outlineThickness: 1 }] }
];
