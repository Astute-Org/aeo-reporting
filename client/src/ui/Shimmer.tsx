export function Shimmer({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-input bg-bg-alt ${className}`}
      style={{
        backgroundImage: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.5s infinite',
      }}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="px-6 py-5 bg-surface rounded-card border border-border shadow-card">
      <Shimmer className="h-4 w-32 mb-3" />
      <Shimmer className="h-3 w-48 mb-2" />
      <Shimmer className="h-3 w-24" />
    </div>
  );
}
