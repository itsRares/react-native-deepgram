/**
 * Lightweight design tokens for the Deepgram example app.
 * Inspired by Deepgram's brand palette (deep purple + warm accent).
 */

export const colors = {
  // Surfaces
  bg: '#0B0B12',
  surface: '#13131C',
  surfaceElevated: '#1B1B27',
  surfaceMuted: '#22222F',
  border: '#2A2A38',
  divider: '#1F1F2A',

  // Text
  text: '#F4F4F8',
  textMuted: '#9A9AAE',
  textDim: '#6E6E80',

  // Brand
  primary: '#8B5CF6', // violet
  primaryHover: '#7C4FE5',
  primaryMuted: '#3A2A66',
  accent: '#22D3EE', // cyan accent
  accentMuted: '#1E3A4A',

  // Semantic
  success: '#34D399',
  warning: '#FBBF24',
  danger: '#F87171',
  info: '#60A5FA',

  // Bubbles
  userBubble: '#2A1E4F',
  agentBubble: '#1B1B27',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
};

export const type = {
  h1: { fontSize: 26, fontWeight: '700' as const, letterSpacing: -0.4 },
  h2: { fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.2 },
  h3: { fontSize: 16, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  bodyMedium: { fontSize: 15, fontWeight: '500' as const },
  small: { fontSize: 13, fontWeight: '400' as const },
  smallMedium: { fontSize: 13, fontWeight: '600' as const },
  mono: { fontSize: 12, fontFamily: 'Menlo' as const },
};

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
};
