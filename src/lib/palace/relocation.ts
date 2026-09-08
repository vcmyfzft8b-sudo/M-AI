import type { PalaceLayout, PalaceStation, Vec2 } from './layout.ts';

export type PalaceLocations = Record<string, number>;
export type RelocationSpot = Vec2 & { houseIndex: number };

/** Pavement locations with room to approach from every side. Never roads or roofs. */
export function relocationSpots(layout: PalaceLayout): RelocationSpot[] {
  const spots: RelocationSpot[] = [];
  for (const pavement of layout.pavements) {
    for (let x = pavement.x - pavement.width / 2 + 2.5; x < pavement.x + pavement.width / 2 - 2; x += 6) {
      for (let z = pavement.z - pavement.depth / 2 + 2.5; z < pavement.z + pavement.depth / 2 - 2; z += 6) {
        if (layout.houses.some(house => {
          const sideways = Math.abs(Math.sin(house.facing)) > 0.5;
          return Math.abs(x-house.x) < (sideways ? house.depth : house.width)/2+4 &&
            Math.abs(z-house.z) < (sideways ? house.width : house.depth)/2+4;
        })) continue;
        if (layout.stations.some(station => station.placement === "outside" && Math.hypot(x-station.x,z-station.z) < 4)) continue;
        if (layout.props.some(prop => prop.y < 5 && Math.hypot(x-prop.x,z-prop.z) < 5+prop.scale*2)) continue;
        const houseIndex = layout.houses.reduce((nearest, house, index) =>
          Math.hypot(x-house.x,z-house.z) < Math.hypot(x-layout.houses[nearest].x,z-layout.houses[nearest].z) ? index : nearest, 0);
        spots.push({x,z,houseIndex});
      }
    }
  }
  return spots;
}

export function parsePalaceLocations(raw: string | null, spots: readonly RelocationSpot[], ids: readonly string[]): PalaceLocations {
  try {
    const data: unknown = JSON.parse(raw ?? 'null');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    const validIds = new Set(ids);
    return Object.fromEntries(Object.entries(data).filter(([id,index]) =>
      validIds.has(id) && Number.isInteger(index) && Number(index) >= 0 && Number(index) < spots.length));
  } catch { return {}; }
}

export function relocatedStation(station: PalaceStation, spot: RelocationSpot): PalaceStation {
  return {...station, ...spot, placement: 'outside', originalLocation: station.originalLocation ?? {x:station.x,z:station.z,placement:station.placement}};
}

/** Random among clear spots, separated from the old location and every other marker. */
export function chooseRelocation(station: PalaceStation, stations: readonly PalaceStation[], spots: readonly RelocationSpot[], random = Math.random): number | null {
  const candidates = spots.map((spot,index) => ({spot,index})).filter(({spot}) =>
    Math.hypot(spot.x-station.x,spot.z-station.z) >= 18 &&
    stations.every(other => other.id === station.id || Math.hypot(spot.x-other.x,spot.z-other.z) >= 6));
  if (!candidates.length) return null;
  return candidates[Math.min(candidates.length-1, Math.max(0,Math.floor(random()*candidates.length)))].index;
}

export function practiceAnswerKnown(mark: {marked: boolean; score?: number}): boolean | null {
  return mark.marked && Number.isFinite(mark.score) ? mark.score! > 0 : null;
}
