import React from 'react';

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`px-6 py-5 bg-surface rounded-card border border-border shadow-card ${className}`}>
      {children}
    </div>
  );
}
