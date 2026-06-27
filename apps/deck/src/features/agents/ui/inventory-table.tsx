import type { ReactNode } from "react";

export type InventoryTableRow = {
  key: string;
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  details?: ReactNode;
};

type InventoryTableProps = {
  title: ReactNode;
  countLabel?: ReactNode;
  action?: ReactNode;
  form?: ReactNode;
  rows: InventoryTableRow[];
  emptyLabel: ReactNode;
};

export function InventoryTable({
  title,
  countLabel,
  action,
  form,
  rows,
  emptyLabel,
}: InventoryTableProps) {
  return (
    <section className="grid content-start gap-3">
      <div className="grid min-h-[var(--control-h-md)] grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3">
        <h3 className="m-0 text-base font-semibold text-foreground">{title}</h3>
        {countLabel ? (
          <span className="text-sm text-muted-foreground">{countLabel}</span>
        ) : null}
        {action}
      </div>
      {form}
      {rows.length ? (
        <ul className="m-0 grid list-none gap-2 p-0">
          {rows.map((row) => (
            <li key={row.key}>
              {row.details ? (
                <details className="wb-pane-sunken group grid gap-0 p-0">
                  <summary className="cursor-pointer list-none marker:hidden [&::-webkit-details-marker]:hidden">
                    <InventoryTableRowContent row={row} interactive />
                  </summary>
                  <div className="grid gap-3 border-t border-border-ghost p-3">
                    {row.details}
                  </div>
                </details>
              ) : (
                <article className="wb-pane-sunken">
                  <InventoryTableRowContent row={row} />
                </article>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid min-h-16 place-items-center rounded-md bg-surface-sunken px-4 text-sm text-muted-foreground">
          {emptyLabel}
        </div>
      )}
    </section>
  );
}

function InventoryTableRowContent({
  row,
  interactive = false,
}: {
  row: InventoryTableRow;
  interactive?: boolean;
}) {
  return (
    <div className="grid min-h-12 grid-cols-[minmax(180px,0.28fr)_minmax(0,1fr)_auto_minmax(120px,auto)_auto] items-center gap-3 p-2.5 text-sm [grid-template-areas:'title_subtitle_badge_meta_actions'] max-xl:grid-cols-[minmax(0,1fr)_auto] max-xl:[grid-template-areas:'title_badge'_'subtitle_actions'_'meta_actions'] max-md:grid-cols-1 max-md:[grid-template-areas:'title'_'subtitle'_'badge'_'meta'_'actions']">
      <div className="flex min-w-0 items-center gap-2 [grid-area:title]">
        {row.icon}
        <strong
          className={`min-w-0 truncate text-section text-foreground ${
            interactive ? "group-open:text-primary group-hover:text-primary" : ""
          }`}
        >
          {row.title}
        </strong>
      </div>
      <div className="min-w-0 [overflow-wrap:anywhere] text-muted-foreground [grid-area:subtitle]">
        {row.subtitle}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 [grid-area:badge] max-xl:justify-start">
        {row.badge}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 text-muted-foreground [grid-area:meta] max-xl:justify-start">
        {row.meta}
      </div>
      {row.actions ? (
        <div className="flex flex-wrap justify-end gap-2 [grid-area:actions] max-md:justify-start">
          {row.actions}
        </div>
      ) : null}
    </div>
  );
}
