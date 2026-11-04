export type Lamp = { name: string; role: string; on: boolean; read: string };

type Props = {
  live: boolean;
  halted: boolean;
  session: string;
  started: string;
  timecode: string;
  progress: number;
  lamps: Lamp[];
  onStop: () => void;
};

export function TopStrip({ live, halted, session, started, timecode, progress, lamps, onStop }: Props) {
  return (
    <header className="rm-top">
      <div className="rm-brand">
        <span className="wordmark rm-brand__mark">songbird</span>
        <i className="rm-brand__dot" data-on={live || undefined} />
      </div>

      <dl className="rm-meta">
        <div>
          <dt className="label">Session</dt>
          <dd className="num">{session}</dd>
        </div>
        <div>
          <dt className="label">In</dt>
          <dd className="num">{started}</dd>
        </div>
        <div>
          <dt className="label">Done</dt>
          <dd className="num">{String(Math.round(progress * 100)).padStart(3, "0")}%</dd>
        </div>
      </dl>

      <div className="rm-rec" data-on={live || undefined} data-halted={halted || undefined}>
        <span className="rm-rec__tally">
          <i />
          {halted ? "HALT" : "REC"}
        </span>
        <span className="rm-rec__tc num">{timecode}</span>
      </div>

      <ul className="rm-lamps" aria-label="models">
        {lamps.map((l) => (
          <li key={l.name} className="rm-lamp" data-on={l.on || undefined}>
            <i className="rm-lamp__bulb" />
            <span className="rm-lamp__name">{l.name}</span>
            <span className="rm-lamp__meta">
              <span className="rm-lamp__role label">{l.role}</span>
              <span className="rm-lamp__read num">{l.read}</span>
            </span>
          </li>
        ))}
      </ul>

      <button type="button" className="rm-stop" onClick={onStop}>
        <i />
        <span className="label">Stop</span>
      </button>
    </header>
  );
}
