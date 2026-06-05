'use client';

import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getGenerationErrorCopy, type FriendlyGenerationError } from '@/lib/polling-utils';

type GenerationErrorAlertProps = {
  error: unknown;
  className?: string;
  compact?: boolean;
};

export function GenerationErrorAlert({
  error,
  className,
  compact = false,
}: GenerationErrorAlertProps) {
  const copy: FriendlyGenerationError = getGenerationErrorCopy(error);

  return (
    <div
      className={cn(
        'rounded-xl border border-red-500/30 bg-red-500/10 text-red-100',
        compact ? 'px-3 py-2' : 'px-4 py-3',
        className
      )}
    >
      <div className="flex gap-3">
        <AlertCircle className={cn('shrink-0 text-red-300', compact ? 'h-4 w-4 mt-0.5' : 'h-5 w-5 mt-0.5')} />
        <div className="min-w-0 space-y-1">
          <p className={cn('font-medium text-red-200', compact ? 'text-sm' : 'text-base')}>
            {copy.title}
          </p>
          <p className={cn('text-red-100/85', compact ? 'text-xs' : 'text-sm')}>
            {copy.reason}
          </p>
          <p className={cn('text-red-100/65', compact ? 'text-xs' : 'text-sm')}>
            {copy.suggestion}
          </p>
        </div>
      </div>
    </div>
  );
}
