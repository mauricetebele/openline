/** @type {import('tailwindcss').Config} */

// ─────────────────────────────────────────────────────────────────────────────
// Earthy palette (trial). The whole UI uses standard Tailwind color classes
// (gray-*, blue-*, orange-*, …) plus custom amazon-*. Remapping those scales to
// warm, muted tones here recolors every screen at once — no component edits.
// Each scale keeps its 50→950 light→dark ramp so contrast/legibility hold.
// To revert: `git revert` this commit.
// ─────────────────────────────────────────────────────────────────────────────

// Warm beige → espresso — replaces the cool neutrals (gray/slate/zinc/neutral/stone)
const warmNeutral = {
  50:  '#FAF6EF',
  100: '#F1E9DA',
  200: '#E3D6BF',
  300: '#D0BD9C',
  400: '#B7A07C',
  500: '#97805F',
  600: '#79654A',
  700: '#5C4D39',
  800: '#40362A',
  900: '#2A231B',
  950: '#1B1611',
}

// Forest green — the primary accent (replaces blue/sky/cyan/indigo/teal)
const forest = {
  50:  '#EDF3EA',
  100: '#D8E6D0',
  200: '#B7D0A9',
  300: '#8FB47C',
  400: '#6A9556',
  500: '#4E7A3C',
  600: '#3E6230',
  700: '#324E27',
  800: '#2A3F22',
  900: '#23341D',
  950: '#121C0E',
}

// Terracotta / ochre — warm secondary (replaces orange/amber/yellow)
const terracotta = {
  50:  '#F8EFE7',
  100: '#F0DECB',
  200: '#E2BE9E',
  300: '#D19D71',
  400: '#C4854F',
  500: '#AE6C39',
  600: '#91552C',
  700: '#714224',
  800: '#543220',
  900: '#3F271B',
  950: '#221310',
}

// Muted clay / rose-brown (replaces violet/purple/fuchsia/pink/rose)
const clay = {
  50:  '#F5EEEC',
  100: '#EBD9D4',
  200: '#D9B8AE',
  300: '#C59284',
  400: '#B4735F',
  500: '#9E5B47',
  600: '#834839',
  700: '#67392E',
  800: '#4C2C24',
  900: '#38211C',
  950: '#1F110E',
}

// Warm olive / sage — SUCCESS. Yellow-green so it stays distinct from the
// blue-green forest primary while fitting the earthy scheme.
const olive = {
  50:  '#F1F3E7',
  100: '#E1E6C9',
  200: '#C8D19E',
  300: '#ABB872',
  400: '#909E51',
  500: '#74813A',
  600: '#5C672D',
  700: '#485026',
  800: '#3B4122',
  900: '#31371F',
  950: '#1A1D0E',
}

// Muted brick — ERROR/DANGER. Clearly red, but earthy rather than harsh.
const brick = {
  50:  '#F8ECEA',
  100: '#F0D5CF',
  200: '#E0AEA4',
  300: '#CE8377',
  400: '#C06150',
  500: '#A94636',
  600: '#8C3629',
  700: '#6E2B22',
  800: '#52221D',
  900: '#3E1B18',
  950: '#210D0B',
}

module.exports = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Warm neutrals
        gray: warmNeutral,
        slate: warmNeutral,
        zinc: warmNeutral,
        neutral: warmNeutral,
        stone: warmNeutral,
        // Cool accents → forest green
        blue: forest,
        sky: forest,
        cyan: forest,
        indigo: forest,
        teal: forest,
        // Warm accents → terracotta
        orange: terracotta,
        amber: terracotta,
        yellow: terracotta,
        // Purples/pinks → muted clay
        violet: clay,
        purple: clay,
        fuchsia: clay,
        pink: clay,
        rose: clay,
        // Success → warm olive; error → muted brick (both softened to match)
        green: olive,
        emerald: olive,
        lime: olive,
        red: brick,
        // Brand tokens re-tuned to the earthy scheme
        amazon: {
          orange: '#AE6C39', // ochre
          dark:   '#2A231B', // espresso
          blue:   '#3E6230', // forest (primary)
          light:  '#40362A', // dark taupe
        },
      },
    },
  },
  plugins: [],
}
