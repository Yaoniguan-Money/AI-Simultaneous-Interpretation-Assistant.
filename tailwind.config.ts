import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#111111', hover: '#333333' },
        surface: { DEFAULT: '#FFFFFF', muted: '#F7F6F3', hover: 'rgba(0,0,0,0.03)' },
        border: { DEFAULT: 'rgba(0,0,0,0.08)', active: 'rgba(0,0,0,0.15)' },
        text: { primary: '#111111', muted: '#787774', faded: '#BBBBBB' },
        accent: {
          green: { bg: 'rgba(52,211,153,0.12)', text: '#047857' },
          red: { bg: 'rgba(248,113,113,0.12)', text: '#991B1B' },
          yellow: { bg: 'rgba(251,191,36,0.12)', text: '#92400E' },
          blue: { bg: 'rgba(99,102,241,0.1)', text: 'rgba(99,102,241,0.8)' },
        },
        subtitle: {
          bg: 'rgba(0, 0, 0, 0.25)',
          text: '#FFFFFF',
          faded: 'rgba(255, 255, 255, 0.6)',
          original: 'rgba(255, 255, 255, 0.35)',
        },
      },
      fontSize: {
        'subtitle-sm': '14px',
        'subtitle-md': '18px',
        'subtitle-lg': '24px',
      },
      borderRadius: {
        card: '12px',
        btn: '10px',
        input: '8px',
        chip: '9999px',
      },
    },
  },
  plugins: [],
} satisfies Config;
