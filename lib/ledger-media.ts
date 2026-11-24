import { env } from "cloudflare:workers";
import type { Ledger } from "../app/ledger";

export const photoKey = (scopeId: string, photoId: string) => "cars/" + encodeURIComponent(scopeId) + "/" + photoId;
export const getPhotoBucket = () => env.BUCKET;

export function removedPhotos(previous: Ledger, next: Ledger) {
  const live = new Set(next.cars.flatMap(car => (car.photos ?? []).map(photo => photo.id)));
  return previous.cars.flatMap(car => (car.photos ?? []).filter(photo => !live.has(photo.id)).map(photo => photo.id));
}

export function hasOnlyStoredPhotos(previous: Ledger | undefined, next: Ledger) {
  return next.cars.every(car => {
    const stored = new Map(previous?.cars.find(before => before.id === car.id)?.photos?.map(photo => [photo.id, photo]));
    return (car.photos ?? []).every(photo => {
      const before = stored.get(photo.id);
      return before && photo.phase === before.phase && photo.workId === before.workId;
    });
  });
}
