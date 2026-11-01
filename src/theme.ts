/**
 * FactoryTalk View-inspired color palette.
 *
 * Rockwell Automation brand red ("Valentine Red") #CD163F and brand orange
 * #F58025 anchor the palette, rounded out with the classic industrial HMI
 * colors (dark slate background, panel grays, status green/amber/red).
 */
export const ftColors = {
  // Rockwell brand
  brandRed: '#CD163F',
  brandRedDark: '#A01030',
  brandOrange: '#F58025',

  // HMI surfaces
  background: '#14181D',
  panel: '#1E252C',
  panelRaised: '#2A333C',
  border: '#3A454F',

  // Text
  textPrimary: '#E8ECF0',
  textSecondary: '#9AA7B2',
  textMuted: '#6B7884',

  // Status (classic HMI)
  statusGreen: '#2FBF4B',
  statusAmber: '#F2B01E',
  statusRed: '#E23B3B',
  statusBlue: '#2E9BD6',
} as const

export type FtColors = typeof ftColors
