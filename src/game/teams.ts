/**
 * Two teams, so that two screens side by side can be told apart (both play left to right): the host is
 * blue, the guest red, and against the computer you are blue. Each phone draws its own side in its team's
 * colour and the enemy in the other, and a halo in the colour of whoever's turn it is shows the same thing
 * on both phones.
 */
export type Team = 'blue' | 'red'

export interface TeamStyle {
  name: string
  /** Main colour: flags, labels, the halo. */
  main: string
  /** Lighter tint, for shot trails and text on dark backgrounds. */
  light: string
  /** Darker shade, for the shadow side of cloth. */
  dark: string
  /** `main` as "r,g,b", for translucent fills. */
  rgb: string
  /** `light` as "r,g,b". */
  lightRgb: string
}

export const TEAMS: Record<Team, TeamStyle> = {
  blue: { name: 'Blue', main: '#3f8cff', light: '#a9ccff', dark: '#1c4fa8', rgb: '63,140,255', lightRgb: '169,204,255' },
  red: { name: 'Red', main: '#ff4f4f', light: '#ffb0b0', dark: '#a82121', rgb: '255,79,79', lightRgb: '255,176,176' },
}

export const otherTeam = (team: Team): Team => (team === 'blue' ? 'red' : 'blue')

/** The host (and anyone playing the computer) is blue; the guest is red. */
export const teamForRole = (role: 'host' | 'guest' | undefined): Team => (role === 'guest' ? 'red' : 'blue')
