import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#0f1117',
          secondary: '#161b27',
          card: '#1a2035',
          hover: '#1e2640',
        },
        border: {
          DEFAULT: '#1f2d40',
          light: '#2a3a50',
        },
        accent: {
          DEFAULT: '#6366f1',
          hover: '#4f52d3',
        },
        green: {
          trade: '#10b981',
        },
        red: {
          trade: '#ef4444',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
