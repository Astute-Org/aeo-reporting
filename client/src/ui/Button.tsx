import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = 'primary', children, disabled, className = '', ...props }: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 text-[13px] font-semibold px-4 py-2 rounded-pill transition-colors duration-150 cursor-pointer';

  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-accent text-on-accent hover:bg-accent-hover',
    secondary: 'bg-ink text-on-ink hover:bg-ink-mid',
    ghost: 'bg-surface text-ink-mid border-[1.5px] border-border hover:bg-bg-alt hover:text-ink hover:border-border-strong',
    danger: 'bg-surface text-error border-[1.5px] border-border hover:bg-error-soft',
  };

  return (
    <button
      className={`${base} ${variants[variant]} ${disabled ? 'opacity-40 pointer-events-none' : ''} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
