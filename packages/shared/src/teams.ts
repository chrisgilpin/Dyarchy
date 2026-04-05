import type { TeamId } from './types.js';
import type { MapConfig } from './maps.js';

/** Centralized team metadata — colors, labels, CSS values for all teams. */
export const TEAM_META: Record<TeamId, {
  label: string;
  cssColor: string;
  hexPrimary: number;
  hexLight: number;
  hexDark: number;
  borderColor: string;
  bgActive: string;
  bgInactive: string;
}> = {
  1: {
    label: 'Blue', cssColor: '#4488dd',
    hexPrimary: 0x3366cc, hexLight: 0x5599ee, hexDark: 0x224488,
    borderColor: '#2255bb', bgActive: 'rgba(34,85,187,0.35)', bgInactive: 'rgba(34,85,187,0.15)',
  },
  2: {
    label: 'Red', cssColor: '#dd4444',
    hexPrimary: 0xcc3333, hexLight: 0xee5555, hexDark: 0x991111,
    borderColor: '#bb2222', bgActive: 'rgba(187,34,34,0.35)', bgInactive: 'rgba(187,34,34,0.15)',
  },
  3: {
    label: 'Green', cssColor: '#44bb44',
    hexPrimary: 0x33aa33, hexLight: 0x55cc55, hexDark: 0x228822,
    borderColor: '#22aa22', bgActive: 'rgba(34,170,34,0.35)', bgInactive: 'rgba(34,170,34,0.15)',
  },
};

/** Get all team IDs active on a given map (sorted). */
export function getTeamIds(config: MapConfig): TeamId[] {
  return (Object.keys(config.teamSpawns).map(Number).filter(n => n >= 1 && n <= 3) as TeamId[]).sort();
}

/** Get all enemy team IDs for a given team on a given map. */
export function getEnemyTeamIds(teamId: TeamId, config: MapConfig): TeamId[] {
  return getTeamIds(config).filter(t => t !== teamId);
}

/** Get team display label. */
export function getTeamLabel(teamId: TeamId | number): string {
  return TEAM_META[teamId as TeamId]?.label ?? `Team ${teamId}`;
}

/** How many teams does this map support? */
export function getTeamCount(config: MapConfig): number {
  return getTeamIds(config).length;
}
