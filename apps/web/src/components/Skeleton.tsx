/** A grey bar the width of a line of text. */
export function SkeletonLine({ width = "100%" }: { width?: string }) {
  return <span className="skeleton-line" style={{ width }} aria-hidden="true" />;
}

/** The shape of a card while its content loads (SPEC §14): grey, not a spinner or a gap. */
export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        // Fixed placeholders: they never reorder.
        // biome-ignore lint/suspicious/noArrayIndexKey: static list
        <div key={i} className="card skeleton-card">
          <SkeletonLine width="55%" />
          <SkeletonLine width="85%" />
        </div>
      ))}
    </div>
  );
}

/** The week while it loads: a header, a strip of days and a few blocks. */
export function WeekSkeleton() {
  return (
    <div className="skeleton week-skeleton" aria-hidden="true">
      <div className="skeleton-days">
        {Array.from({ length: 7 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static list
          <span key={i} className="skeleton-day" />
        ))}
      </div>
      <SkeletonCards count={4} />
    </div>
  );
}
