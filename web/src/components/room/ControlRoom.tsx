import type { Deck } from "../../lib/useDeck";

/** The making view. See DESIGN.md "The control room". */
export function ControlRoom({ deck }: { deck: Deck }) {
  return <main className="room">control room: {deck.state.work.label}</main>;
}
