import { STEPS, pad2, type Step, type StepId } from "./model";

type Props = {
  steps: Record<StepId, Step>;
  clocks: Record<StepId, string>;
  elapsed: string;
};

export function Transport({ steps, clocks, elapsed }: Props) {
  // the playhead sits on the furthest stage that is running (CAST and PRODUCE overlap: SAM cuts while the producer writes)
  let head = -1;
  STEPS.forEach((s, i) => {
    const st = steps[s.id].state;
    if (st === "active" || st === "fault") head = i;
    else if (st === "done" && head < i) head = i + 1;
  });
  head = Math.min(head, STEPS.length);
  const at = head >= 0 && head < STEPS.length ? steps[STEPS[head].id] : null;
  const frac = at && at.state === "active" && at.frac !== null ? Math.min(0.98, at.frac) : 0;
  const pos = head < 0 ? 0 : ((head + frac) / STEPS.length) * 100;

  return (
    <footer className="rm-transport" aria-label="transport">
      <div className="rm-transport__lead">
        <span className="label">Transport</span>
        <span className="num">{elapsed}</span>
      </div>
      <ol className="rm-transport__track">
        {STEPS.map((s, i) => {
          const st = steps[s.id];
          const fill = st.state === "done" ? 1 : st.state === "active" ? st.frac ?? 0 : 0;
          return (
            <li key={s.id} className="rm-step" data-state={st.state}>
              <div className="rm-step__top">
                <span className="num rm-step__no">{pad2(i + 1)}</span>
                <span className="rm-step__label">{s.label}</span>
                <i className="rm-step__lamp" />
              </div>
              <div className="rm-step__bot">
                <span className="rm-step__model label">{s.model}</span>
                <span className="num rm-step__read">{st.state === "idle" ? "" : st.read}</span>
                <span className="num rm-step__clock">{clocks[s.id]}</span>
              </div>
              <span className="rm-step__bar" style={{ transform: `scaleX(${fill})` }} />
            </li>
          );
        })}
        <span className="rm-playhead" style={{ left: `${pos}%` }} data-on={head >= 0 && head < STEPS.length ? true : undefined} />
      </ol>
    </footer>
  );
}
