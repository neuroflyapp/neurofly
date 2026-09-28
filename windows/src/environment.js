// environment.js — senses that need no operating-system access, only arithmetic.
// (The idle-timer and typing senses need Electron's powerMonitor: main.js.)

// Activity of Drosophila over the day, as a multiplier on the network's
// baseline drive: quiet at night, a peak around dawn and one around dusk, a
// dip at midday (siesta). Piecewise linear between these hours.
const ACTIVITY_HOURS = [0, 5, 8, 10, 13, 15, 17, 20, 23, 24];
const ACTIVITY_LEVEL = [0.25, 0.25, 1.0, 1.0, 0.55, 0.55, 1.0, 1.0, 0.3, 0.25];

export function circadianActivity(hour) {
  for (let k = 1; k < ACTIVITY_HOURS.length; k++) {
    const h0 = ACTIVITY_HOURS[k - 1], h1 = ACTIVITY_HOURS[k];
    if (hour >= h0 && hour <= h1) {
      const a = ACTIVITY_LEVEL[k - 1], b = ACTIVITY_LEVEL[k];
      return a + (b - a) * ((hour - h0) / Math.max(0.001, h1 - h0));
    }
  }
  return 0.25;   // outside 0-24 h (or not a number)
}

// A horizontal walkable edge (scene units, origin at the centre).
export const makeLedge = (y, x0, x1, id) => ({ y, x0, x1, id });

// Temperature at a position in a terrarium that is not all one temperature.
// `spanC` is the total difference between the two ends (0 = uniform) and
// `meanC` stays the arena's mean, so widening the gradient makes the world
// more unequal without also making it hotter on average — otherwise a
// thermal-preference reading would be confounded by the mean shifting under
// it. Cool end at u = 0 (west), warm end at u = 1 (east).
//
// This is the classic Drosophila thermal-gradient arena. It adds no new
// mechanism: the same documented thermal responses (cold torpor, locomotor
// tempo, the heat-escape reflex) simply become a function of where she is.
export function localTemperature(meanC, spanC, u) {
  if (!spanC) return meanC;
  const clamped = u < 0 ? 0 : u > 1 ? 1 : u;
  return meanC + (clamped - 0.5) * spanC;
}
