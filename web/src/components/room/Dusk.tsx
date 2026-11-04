import { asset } from "../../lib/env";

/**
 * The handover from daylight to night: pressing produce on the front door, the sky goes down over the day and the
 * control room comes up underneath. About a second and a half; never shown with reduced motion.
 */
export function Dusk({ name, onDone }: { name: string; onDone: () => void }) {
  const who = name.trim().toLowerCase();
  return (
    <div className="dusk" aria-hidden="true" onAnimationEnd={(e) => e.target === e.currentTarget && onDone()}>
      <div className="dusk__sky" style={{ backgroundImage: `url(${asset("sky.jpg")})` }} />
      <div className="dusk__night" />
      <p className="dusk__line">{who ? `${who}'s day goes into the studio.` : "the day goes into the studio."}</p>
    </div>
  );
}
