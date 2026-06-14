'use client';

import { useState } from 'react';

interface ResponsiveSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  title?: string;
}

export function ResponsiveSheet({ open, onOpenChange, children, title }: ResponsiveSheetProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="w-full max-w-[460px] bg-[var(--surface)] border-l border-[var(--border)] h-full overflow-auto">
        <div className="sticky top-0 bg-[var(--surface)] border-b border-[var(--border)] p-4 flex items-center justify-between">
          <div className="font-medium">{title}</div>
          <button onClick={() => onOpenChange(false)} aria-label="Close" className="text-xl">×</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
