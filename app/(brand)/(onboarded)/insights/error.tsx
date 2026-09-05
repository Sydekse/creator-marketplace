'use client';

import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function InsightsError({ reset }: { reset: () => void }) {
  return (
    <div className="flex flex-col gap-4 py-6">
      <Alert variant="destructive">
        <AlertTitle>Insights could not be loaded</AlertTitle>
        <AlertDescription>
          Your reporting data is unavailable right now. Try again rather than
          relying on incomplete totals.
        </AlertDescription>
      </Alert>
      <Button variant="outline" className="w-fit" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
