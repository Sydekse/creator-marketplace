import * as React from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import type { rightsTerms } from '@/db/schema';

export type RightsTermsRow = typeof rightsTerms.$inferSelect;

export function UsageRightsCard({ terms }: { terms: RightsTermsRow }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage Rights Agreement</CardTitle>
        <CardDescription>Version {terms.version}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="prose prose-sm dark:prose-invert max-h-64 overflow-y-auto rounded-md border p-4 bg-muted/30">
          <p className="whitespace-pre-wrap">{terms.body}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function UsageRightsAgreement({
  terms,
  checked,
  onCheckedChange,
}: {
  terms: RightsTermsRow;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex flex-row items-start space-x-3 rounded-md border p-4 bg-card">
      <Checkbox
        id={`rights-agreement-${terms.version}`}
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
      <div className="space-y-1 leading-none">
        <Label
          htmlFor={`rights-agreement-${terms.version}`}
          className="font-medium"
        >
          I have read and agree to the Usage Rights terms (version{' '}
          {terms.version})
        </Label>
        <p className="text-sm text-muted-foreground">
          You must agree to these terms before accepting the deal offer.
        </p>
      </div>
    </div>
  );
}
