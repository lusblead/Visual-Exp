import { useId } from "react";
import type { PrimaryMaterial } from "../lib/lineage-contracts";

export function PrimaryMaterialBlock({
  material,
}: {
  material: PrimaryMaterial;
}) {
  const titleId = useId();
  const available = material.display !== "unavailable" && material.body;

  return (
    <section
      className={`primary-material primary-material-${material.display}`}
      aria-labelledby={titleId}
    >
      <header className="primary-material-header">
        <p className="primary-material-kicker">
          {material.display === "excerpt" ? "原文摘录" : "原文"}
        </p>
        <h2 id={titleId}>{material.title}</h2>
        {material.creator ? (
          <p className="primary-material-creator">{material.creator}</p>
        ) : null}
      </header>

      {available ? (
        <div className="primary-material-body">{material.body}</div>
      ) : (
        <p className="primary-material-unavailable" role="note">
          {material.omissionReason}
        </p>
      )}

      <footer className="primary-material-source">
        <span>{material.attribution}</span>
        {material.sourceUrl ? (
          <a href={material.sourceUrl} target="_blank" rel="noreferrer">
            来源
            <span aria-hidden="true"> ↗</span>
          </a>
        ) : null}
      </footer>
    </section>
  );
}
