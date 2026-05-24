'use client';

import { Wrench } from 'lucide-react';

export default function AskPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 p-8">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-2">
        <Wrench className="h-7 w-7 text-text-tertiary" />
      </div>
      <div className="text-center">
        <h2 className="text-small font-emphasis text-text-primary">Tính năng đang phát triển</h2>
        <p className="mt-2 max-w-sm text-caption text-text-tertiary leading-relaxed">
          Module Hỏi AI đang được xây dựng và sẽ ra mắt sớm. Vui lòng quay lại sau.
        </p>
      </div>
      <span className="rounded-full border border-warning/30 bg-warning/8 px-3 py-1 text-label font-emphasis text-warning">
        Sắp ra mắt
      </span>
    </div>
  );
}
