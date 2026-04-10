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
          DEFAULT: '#050a18',
          secondary: '#0a1128',
          card: '#0d1530',
          hover: '#142040',
        },
        border: {
          DEFAULT: '#2b3139',
          light: '#3c4451',
        },
        accent: {
          DEFAULT: '#1E6FFF',
          hover: '#1558CC',
        },
        cyber: {
          purple: '#7B61FF',
          cyan: '#00F0FF',
          pink: '#FF2E97',
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
