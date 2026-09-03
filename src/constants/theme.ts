/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 *
 * El namespace `notes.*` (subobjetos en `Colors.{light,dark}.notes` y los
 * consts `Radii` / `IconSize` / `ZIndex` / `NoteSpacing` / `Typography` /
 * `Shadows`) es la extensión aditiva para Notes v1 (ver docs/sdd/active/centro-control-ia-status/design.md §1).
 * Los 5 colores planos superiores se mantienen para retrocompat con
 * `ThemedText` / `ThemedView` / `CaptureModal` / `AppTabs`.
 */

import '@/global.css';

import { Platform } from 'react-native';

// ── Colors (legacy retrocompat + namespace `notes.*` añadido) ──────────────

// ── Colors (Editorial Warm Linen & Deep Warm Charcoal from jerad-ops + Apple) ──

export const Colors = {
  light: {
    text: '#1A1612', // ink
    background: '#F6F2EA', // warm linen — suave y cálido, altísima legibilidad sin deslumbrar
    backgroundElement: '#FBF8F2', // surface
    backgroundSelected: '#EFEAE0', // surface-2
    textSecondary: '#5A544B', // ink-2
    notes: {
      bg: {
        base: '#F6F2EA',
        surface: '#FBF8F2',
        elevated: '#FFFFFF',
        overlay: 'rgba(0,0,0,0.4)',
        hover: '#EFEAE0',
      },
      border: {
        subtle: 'rgba(26,22,18,0.08)', // line
        strong: 'rgba(26,22,18,0.16)', // line-strong
      },
      text: {
        primary: '#1A1612', // ink
        secondary: '#5A544B', // ink-2
        muted: '#928A7E', // ink-3
        accent: '#B8442B', // rust editorial accent
      },
      accent: {
        primary: '#B8442B',
        primaryDim: 'rgba(184,68,43,0.08)',
        glow: 'rgba(184,68,43,0.18)',
      },
      semantic: {
        success: '#2E6B4F',
        warning: '#C77D2A',
        danger: '#B8442B',
        info: '#3B688C',
      },
      swipe: {
        delete: '#B8442B',
        pin: '#8A3320',
      },
      domains: {
        notas: { primary: '#B8442B', dim: 'rgba(184,68,43,0.08)', text: '#8A3320' },
        ideas: { primary: '#C77D2A', dim: 'rgba(199,125,42,0.08)', text: '#965C1C' },
        tareas: { primary: '#3B688C', dim: 'rgba(59,104,140,0.08)', text: '#2B4D68' },
        gastos: { primary: '#2E6B4F', dim: 'rgba(46,107,79,0.08)', text: '#204C37' },
        habitos: { primary: '#B55D32', dim: 'rgba(181,93,50,0.08)', text: '#8A4423' },
        sueno: { primary: '#5D568C', dim: 'rgba(93,86,140,0.08)', text: '#433E66' },
      },
    },
  },
  dark: {
    text: '#F5F2EA', // pure light ink
    background: '#141312', // editorial warm charcoal — cómodo para la vista, nada agresivo
    backgroundElement: '#1C1B19', // surface
    backgroundSelected: '#252421', // elevated
    textSecondary: '#A8A29A', // ink-2 dark
    notes: {
      bg: {
        base: '#141312',
        surface: '#1C1B19',
        elevated: '#252421',
        overlay: 'rgba(0,0,0,0.55)',
        hover: '#302E2A',
      },
      border: {
        subtle: 'rgba(245,242,234,0.08)',
        strong: 'rgba(245,242,234,0.16)',
      },
      text: {
        primary: '#F5F2EA',
        secondary: '#A8A29A',
        muted: '#767169',
        accent: '#D96B4F', // bright rust editorial accent
      },
      accent: {
        primary: '#D96B4F',
        primaryDim: 'rgba(217,107,79,0.12)',
        glow: 'rgba(217,107,79,0.25)',
      },
      semantic: {
        success: '#46936F',
        warning: '#E29944',
        danger: '#D96B4F',
        info: '#5B8FB8',
      },
      swipe: {
        delete: '#D96B4F',
        pin: '#E29944',
      },
      domains: {
        notas: { primary: '#D96B4F', dim: 'rgba(217,107,79,0.12)', text: '#F29983' },
        ideas: { primary: '#E29944', dim: 'rgba(226,153,68,0.12)', text: '#F6BD80' },
        tareas: { primary: '#5B8FB8', dim: 'rgba(91,143,184,0.12)', text: '#93BEE0' },
        gastos: { primary: '#46936F', dim: 'rgba(70,147,111,0.12)', text: '#80C2A2' },
        habitos: { primary: '#E07748', dim: 'rgba(224,119,72,0.12)', text: '#F0A584' },
        sueno: { primary: '#7C75B5', dim: 'rgba(124,117,181,0.12)', text: '#AAA5D6' },
      },
    },
  },
} as const;

export type ThemeColor =
  | 'text'
  | 'background'
  | 'backgroundElement'
  | 'backgroundSelected'
  | 'textSecondary';

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

// ── Tokens aditivos para Notes v1 (design.md §1) ───────────────────────────

// Tetra de capa: base (lista) > surface (cards) > elevated (modals) > hover
// Radii nítidos y minimalistas estilo editorial/jerad-ops
export const Radii = {
  sm: 4, // chips, inputs
  md: 8, // cards, bottom sheets
  lg: 12, // modals, hero sections
  pill: 999, // botones capsula, tag pills
  full: 999, // iconos circulares, dots
} as const;

export const IconSize = {
  sm: 16, // chips, inline icons
  md: 20, // header actions, toolbar
  lg: 28, // FAB, hero icons
} as const;

export const ZIndex = {
  base: 0, // contenido scrollable
  sticky: 10, // search bar, header sticky, markdown toolbar
  modal: 100, // bottom sheets, modals
  toast: 1000, // toast overlay
} as const;

// ponytail: 48 = 2xl es el único valor nuevo; el resto alias sobre Spacing
// existente (one=4, two=8, three=16, four=24, five=32).
export const NoteSpacing = {
  xs: 4, // intra-chip padding, gaps finos
  sm: 8, // gap entre cards, padding interior fino
  md: 16, // padding interior card, gap entre secciones
  lg: 24, // padding header, separador entre módulos
  xl: 32, // padding hub, separador grande
  '2xl': 48, // hero spacing, footer cushion sobre tab bar
} as const;

// Tipografía: la fuente para body es system-ui (ya en Fonts).
// NO cargamos custom fonts v1 (Ponytail). Fonts.mono cubre native; web vía global.css.
export const Typography = {
  display: { size: 32, weight: '700', lineHeight: 38, letterSpacing: -0.5 },
  title: { size: 22, weight: '600', lineHeight: 28, letterSpacing: -0.2 },
  subtitle: { size: 17, weight: '600', lineHeight: 22, letterSpacing: 0 },
  body: { size: 16, weight: '400', lineHeight: 23, letterSpacing: 0 },
  bodyMono: { size: 15, weight: '500', lineHeight: 22, letterSpacing: 0 }, // inline code
  codeBlock: { size: 14, weight: '400', lineHeight: 20, letterSpacing: 0 }, // ``` blocks
  caption: { size: 13, weight: '400', lineHeight: 18, letterSpacing: 0 },
  eyebrow: { size: 11, weight: '700', lineHeight: 14, letterSpacing: 0.5 }, // section headers, all-caps
} as const;

// Sombras: iOS usa shadow* / Android usa elevation (los componentes APPLY
// Platform.select — ponytail: no en tema, evita acoplar el token a la plataforma).
export const Shadows = {
  none: {},
  sm: Platform.select({
    ios: { shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
    android: { elevation: 2 },
    default: {},
  }),
  md: Platform.select({
    ios: { shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
    android: { elevation: 6 },
    default: {},
  }),
  lg: Platform.select({
    ios: { shadowColor: '#000', shadowOpacity: 0.36, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
    android: { elevation: 12 },
    default: {},
  }),
} as const;

// ponytail: glass-effect solo iOS via expo-glass-effect (ya instalado). v1 no
// lo usa en notas — NativeTabs blurEffect ya cubre el tab bar. Modal/Sheet
// que quiera "glass" → BlurView con platform-check. v1: toast con bg sólido.
