import React from 'react';

const field =
  'w-full text-[14px] text-ink bg-transparent border border-border rounded-input px-3.5 py-2.5 outline-none transition-colors duration-150 focus:border-ink placeholder:text-ink-light';

interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helpText?: string;
}

export function TextInput({ label, helpText, className = '', ...props }: TextInputProps) {
  return (
    <div className={className}>
      {label && <FormLabel>{label}</FormLabel>}
      <input className={field} {...props} />
      {helpText && <HelpText>{helpText}</HelpText>}
    </div>
  );
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  helpText?: string;
}

export function Textarea({ label, helpText, className = '', ...props }: TextareaProps) {
  return (
    <div className={className}>
      {label && <FormLabel>{label}</FormLabel>}
      <textarea className={`${field} resize-y min-h-[90px] leading-[1.6]`} {...props} />
      {helpText && <HelpText>{helpText}</HelpText>}
    </div>
  );
}

export function FormLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-light mb-2">
      {children}
    </label>
  );
}

export function HelpText({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] text-ink-light mt-1.5">{children}</p>;
}
