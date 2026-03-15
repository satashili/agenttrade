import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './hooks/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#0B0E11',
          secondary: '#12161c',
          card: '#161a1e',
          hover: '#1e2329',
        },
        border: {
          DEFAULT: '#2b3139',
          light: '#3c4451',
        },
        accent: {
          DEFAULT: '#F0B90B',
          hover: '#d4a50a',
        },
        green: {
          trade: '#0ECB81',
        },
        red: {
          trade: '#F6465D',
        },
      },
      fontFamily: {
        mono: ["'DM Mono'", 'JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
