/** @type {import('tailwindcss').Config} */

// ─────────────────────────────────────────────────────────────────────────────
// Vibrant palette (trial) — inspired by the SheCodes navy/azure/gold look.
// The UI uses standard Tailwind color classes (gray-*, blue-*, orange-*, …)
// plus custom amazon-*. Remapping those scales here recolors every screen at
// once — no component edits. Each scale keeps its 50→950 light→dark ramp so
// contrast/legibility hold. To revert: `git revert` this commit.
// ─────────────────────────────────────────────────────────────────────────────

// Clean cool grays with a faint blue bias → neutrals
const coolGray = {
  50:  '#F5F7FA',
  100: '#EAEEF3',
  200: '#D5DCE5',
  300: '#B3BECD',
  400: '#8695A9',
  500: '#63748B',
  600: '#4B5A6E',
  700: '#3B4757',
  800: '#2A3340',
  900: '#182231',
  950: '#0E141D',
}

// Bright azure → deep navy — the PRIMARY accent (blue/sky/cyan/indigo/teal)
const azure = {
  50:  '#EAF6FD',
  100: '#D0EBFB',
  200: '#A6D9F6',
  300: '#6FC2EF',
  400: '#43ABE7',
  500: '#2091D6',
  600: '#1774B4',
  700: '#175E91',
  800: '#184D74',
  900: '#0B2545',
  950: '#071A33',
}

// Golden amber (orange/amber/yellow)
const gold = {
  50:  '#FEF6E7',
  100: '#FCEBC5',
  200: '#F8D488',
  300: '#F3BC53',
  400: '#EDB04E',
  500: '#E09A2E',
  600: '#C67C1E',
  700: '#A15C1A',
  800: '#82491B',
  900: '#6B3C19',
  950: '#3D2009',
}

// Vibrant purple (violet/purple)
const grape = {
  50:  '#F5EDFB',
  100: '#EAD9F7',
  200: '#D7B8F0',
  300: '#BE8FE6',
  400: '#A566D9',
  500: '#8B44C9',
  600: '#7534AE',
  700: '#5F2C8C',
  800: '#4E2871',
  900: '#40245C',
  950: '#28153D',
}

// Hot pink / magenta (fuchsia/pink/rose)
const magenta = {
  50:  '#FDEDF3',
  100: '#FBD6E4',
  200: '#F7AEC9',
  300: '#F181AB',
  400: '#EC5C90',
  500: '#E23B78',
  600: '#C82861',
  700: '#A61F4F',
  800: '#841B41',
  900: '#6B1937',
  950: '#3F0C1E',
}

// Fresh green (green/emerald/lime) — SUCCESS
const green = {
  50:  '#E9F9F0',
  100: '#C9F2DC',
  200: '#94E4BC',
  300: '#5AD097',
  400: '#2FB877',
  500: '#17A165',
  600: '#0E8151',
  700: '#0E6642',
  800: '#105237',
  900: '#0F4430',
  950: '#04231A',
}

// Coral red (red) — ERROR/DANGER
const coral = {
  50:  '#FEECEC',
  100: '#FCD4D4',
  200: '#F9AEAE',
  300: '#F47E7E',
  400: '#EE5555',
  500: '#E23535',
  600: '#C71F1F',
  700: '#A51A1A',
  800: '#881B1B',
  900: '#711C1C',
  950: '#3D0B0B',
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
        // Neutrals
        gray: coolGray,
        slate: coolGray,
        zinc: coolGray,
        neutral: coolGray,
        stone: coolGray,
        // Primary → bright azure
        blue: azure,
        sky: azure,
        cyan: azure,
        indigo: azure,
        teal: azure,
        // Warm → golden amber
        orange: gold,
        amber: gold,
        yellow: gold,
        // Purple + hot pink accents
        violet: grape,
        purple: grape,
        fuchsia: magenta,
        pink: magenta,
        rose: magenta,
        // Success / error
        green: green,
        emerald: green,
        lime: green,
        red: coral,
        // Brand tokens re-tuned to the vibrant scheme
        amazon: {
          orange: '#EDB04E', // gold
          dark:   '#0B2545', // navy
          blue:   '#2091D6', // azure (primary)
          light:  '#175E91',
        },
      },
    },
  },
  plugins: [],
}
