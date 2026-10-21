/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#060607', 900: '#0a0a0b', 800: '#111113' },
        signal: { green: '#5eead4', red: '#ff5a5f', amber: '#fbbf24', allow: '#6ee7a1' },
      },
      fontFamily: {
        sans: ['"Geist Variable"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono Variable"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        display: ['"Space Grotesk Variable"', '"Geist Variable"', 'system-ui', 'sans-serif'],
        serif: ['"Instrument Serif"', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};
