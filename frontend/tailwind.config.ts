import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 500: '#38bdf8', 600: '#0284c7' },
      },
    },
  },
  plugins: [],
} satisfies Config;
