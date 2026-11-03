import type { Health } from "../../lib/api";
import type { Deck } from "../../lib/useDeck";
import type { TapeSummary } from "../../lib/types";

export function Front(props: { deck: Deck; shelf: TapeSummary[]; health: Health | null; online: boolean; onOpen: (id: string) => void }) {
  return <main className="front">songbird {props.shelf.length}</main>;
}
