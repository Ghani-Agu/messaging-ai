import { h, Fragment } from "preact";
import { useState } from "preact/hooks";
import type { Citation } from "../types";

export function Citations({ items }: { items: Citation[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const open = openIndex !== null ? items.find((c) => c.index === openIndex) : null;

  return (
    <Fragment>
      <div class="citations">
        {items.map((c) => (
          <button
            key={c.index}
            type="button"
            class="citation-chip"
            aria-expanded={openIndex === c.index}
            onClick={() => setOpenIndex(openIndex === c.index ? null : c.index)}
          >
            [{c.index}] {c.sourceName}
          </button>
        ))}
      </div>
      {open ? (
        <div class="citation-source">
          {open.sourceUrl ? (
            <a href={open.sourceUrl} target="_blank" rel="noreferrer">
              {open.sourceUrl}
            </a>
          ) : null}
          <div style={{ marginTop: 4 }}>{open.preview}</div>
        </div>
      ) : null}
    </Fragment>
  );
}
