type SkeletonShapeProps = {
  className?: string;
};

type SkeletonLayoutProps = SkeletonShapeProps & {
  ariaLabel?: string;
};

function Shape({ className = "" }: SkeletonShapeProps) {
  return <div aria-hidden="true" className={`animate-shimmer ${className}`} />;
}

export function Rect({ className }: SkeletonShapeProps) {
  return <Shape className={className ?? "h-24 w-full rounded-2xl"} />;
}

export function TextBar({ className }: SkeletonShapeProps) {
  return <Shape className={`h-3 rounded-full${className ? ` ${className}` : " w-full"}`} />;
}

export function Pill({ className }: SkeletonShapeProps) {
  return <Shape className={`h-8 rounded-full${className ? ` ${className}` : " w-24"}`} />;
}

export function Circle({ className }: SkeletonShapeProps) {
  return <Shape className={className ? `rounded-full ${className}` : "h-10 w-10 rounded-full"} />;
}

export function Divider({ className }: SkeletonShapeProps) {
  return <Shape className={`h-px w-full opacity-70${className ? ` ${className}` : ""}`} />;
}

export function MediaCardSkeleton({ className, ariaLabel = "Loading content" }: SkeletonLayoutProps) {
  return (
    <div className={`space-y-5 ${className ?? ""}`} role="status" aria-label={ariaLabel}>
      <Rect className="h-36 w-full rounded-2xl" />
      <div className="flex items-center gap-3">
        <TextBar className="w-1/4" />
        <TextBar className="w-2/5" />
        <Pill className="ml-auto w-20" />
      </div>
      <Divider />
      <div className="space-y-3">
        <TextBar className="w-full" />
        <TextBar className="w-4/5" />
        <TextBar className="w-3/5" />
      </div>
      <Divider />
      <Pill className="w-full" />
    </div>
  );
}

export function PanelCardSkeleton({ className, ariaLabel = "Loading panel" }: SkeletonLayoutProps) {
  return (
    <div className={`space-y-5 ${className ?? ""}`} role="status" aria-label={ariaLabel}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 max-w-48 space-y-2">
          <TextBar className="w-2/3" />
          <TextBar className="w-1/2" />
        </div>
        <Circle />
      </div>
      <Divider />
      <Rect className="h-32 w-full rounded-xl" />
    </div>
  );
}

export function MetricCardSkeleton({ className }: SkeletonShapeProps) {
  return (
    <div
      className={`bg-bg-card/80 rounded-2xl border border-brand-sageBorder/30 px-5 py-4 shadow-sm space-y-3 ${className ?? ""}`}
      aria-hidden="true"
    >
      <div className="flex items-start justify-between gap-3">
        <TextBar className="w-2/3" />
        <Circle className="h-8 w-8" />
      </div>
      <Rect className="h-8 w-2/5 rounded-lg" />
      <TextBar className="w-3/5" />
    </div>
  );
}

type RegistryTableSkeletonProps = SkeletonLayoutProps & {
  columns: number;
  rowCount?: number;
  pillColumns?: number[];
  rowClassName?: string;
};

export function RegistryTableSkeleton({
  columns,
  rowCount = 5,
  pillColumns = [columns - 1],
  rowClassName = "px-5 py-4",
  className,
  ariaLabel = "Loading registry data",
}: RegistryTableSkeletonProps) {
  const widths = ["w-4/5", "w-3/5", "w-2/3", "w-full", "w-1/2"];

  return (
    <div className={`divide-y divide-brand-sageBorder/10 ${className ?? ""}`} role="status" aria-label={ariaLabel}>
      {Array.from({ length: rowCount }, (_, rowIndex) => (
        <div
          key={`registry-skeleton-row-${rowIndex}`}
          className={`grid items-center gap-4 ${rowClassName}`}
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: columns }, (_, columnIndex) => (
            <div key={`registry-skeleton-cell-${rowIndex}-${columnIndex}`} className="min-w-0">
              {pillColumns.includes(columnIndex) ? (
                <Pill className={widths[(rowIndex + columnIndex) % widths.length]} />
              ) : (
                <TextBar className={widths[(rowIndex + columnIndex) % widths.length]} />
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

type RegistryPanelSkeletonProps = SkeletonLayoutProps & {
  columns: number;
  pillColumns?: number[];
  rowCount?: number;
  rowClassName?: string;
  tableMinWidthClassName?: string;
};

export function RegistryPanelSkeleton({
  columns,
  pillColumns = [columns - 1],
  rowCount = 5,
  rowClassName = "px-5 py-4",
  tableMinWidthClassName = "min-w-[900px]",
  className,
  ariaLabel = "Loading registry data",
}: RegistryPanelSkeletonProps) {
  return (
    <div className={className} role="status" aria-label={ariaLabel}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-brand-sageBorder/20">
        <div className="flex items-center gap-2.5">
          <Circle className="h-5 w-5" />
          <TextBar className="w-48" />
        </div>
        <Rect className="h-9 w-64 rounded-full" />
      </div>
      <div className="overflow-x-auto">
        <div className={tableMinWidthClassName}>
          <div
            className="grid items-center gap-4 bg-brand-peachBg/40 px-5 py-3 border-b border-brand-sageBorder/20"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            aria-hidden="true"
          >
            {Array.from({ length: columns }, (_, columnIndex) => (
              <TextBar
                key={`registry-skeleton-header-${columnIndex}`}
                className={columnIndex % 3 === 0 ? "w-4/5" : "w-3/5"}
              />
            ))}
          </div>
          <RegistryTableSkeleton
            columns={columns}
            pillColumns={pillColumns}
            rowCount={rowCount}
            rowClassName={rowClassName}
            ariaLabel={ariaLabel}
          />
        </div>
      </div>
      <div className="flex items-center justify-center gap-3 py-5 border-t border-brand-sageBorder/10" aria-hidden="true">
        <Rect className="h-8 w-8 rounded-full" />
        <Circle className="h-2.5 w-2.5" />
        <Circle className="h-2.5 w-2.5" />
        <Circle className="h-2.5 w-2.5" />
        <Rect className="h-8 w-8 rounded-full" />
      </div>
    </div>
  );
}

export function TransactionsTableSkeleton({ rowCount = 4, ariaLabel = "Loading transactions" }: { rowCount?: number; ariaLabel?: string }) {
  return (
    <div className="w-full space-y-2" role="status" aria-label={ariaLabel}>
      <div className="grid grid-cols-12 items-center gap-4 rounded-xl bg-brand-peachBg/30 px-6 py-3.5">
        <TextBar className="col-span-2" />
        <TextBar className="col-span-3" />
        <TextBar className="col-span-4" />
        <TextBar className="col-span-1" />
        <TextBar className="col-span-2" />
      </div>
      <div className="divide-y divide-brand-sageBorder/20">
        {Array.from({ length: rowCount }, (_, rowIndex) => (
          <div key={`transaction-skeleton-row-${rowIndex}`} className="grid grid-cols-12 gap-4 py-5">
            <div className="col-span-2 space-y-2">
              <TextBar className="w-4/5" />
              <TextBar className="w-3/5" />
            </div>
            <div className="col-span-3 space-y-2">
              <TextBar className="w-full" />
              <TextBar className="w-2/3" />
            </div>
            <div className="col-span-7 grid grid-cols-7 items-center gap-4">
              <div className="col-span-4 flex items-center gap-4">
                <Rect className="h-12 w-12 flex-shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1 space-y-2">
                  <TextBar className="w-full" />
                  <TextBar className="w-3/5" />
                </div>
              </div>
              <TextBar className="col-span-1 justify-self-center w-8" />
              <TextBar className="col-span-2 justify-self-end w-20" />
            </div>
            <div className="col-span-12 flex justify-end">
              <Pill className="w-32" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
