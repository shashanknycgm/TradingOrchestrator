import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#aaff00',
        'primary-muted': '#6a9900',
        'primary-dim': '#3a5500',
        'primary-dark': '#1a2800',
        surface: '#0d0d0a',
        'surface-2': '#141410',
        'surface-3': '#1c1c16',
        border: '#252518',
        'border-bright': '#3a4a00',
      },
      fontFamily: {
        mono: ['"Space Mono"', '"JetBrains Mono"', '"Courier New"', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        blink: 'blink 1s step-end infinite',
      },
      keyframes: {
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
