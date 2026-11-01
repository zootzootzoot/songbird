import type { Photo } from "../../lib/useSongbird";
import { HalftonePhoto } from "./Halftone";

const SLOTS = [0, 1, 2, 3, 4, 5];

/**
 * The photo strip: six spring clips in a recessed channel. Photographs clip in
 * as small two-ink prints, and the strip advances one frame at a time while the
 * deck reads them.
 */
export function PhotoStrip({
  photos,
  reading,
  working,
}: {
  photos: Photo[];
  reading: number;
  working: boolean;
}) {
  return (
    <div className="strip" aria-label={`photo strip, ${photos.length} of 6 pictures`}>
      <div className="strip__rail" aria-hidden="true" />
      <ol className="strip__frames">
        {SLOTS.map((slot) => {
          const photo = photos[slot];
          const isReading = working && reading === slot;
          const isDone = working && reading > slot;
          return (
            <li
              key={slot}
              className="clip"
              data-filled={Boolean(photo)}
              data-reading={isReading}
              data-read={isDone}
            >
              <span className="strip__clip" aria-hidden="true">
                <span className="strip__clip-wire" />
              </span>
              {photo ? (
                <HalftonePhoto src={photo.src} alt={photo.alt} className="clip__print" />
              ) : (
                <span className="clip__empty" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>
      <span className="strip__led" data-reading={working} aria-hidden="true" />
    </div>
  );
}
