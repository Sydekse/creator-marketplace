'use client';

import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  REVISION_CATEGORIES,
  REVISION_CATEGORY_LABELS,
  type RevisionCategory,
} from '@/lib/deliverables/evidence';

export function RevisionCategoryField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: RevisionCategory | null;
  onChange: (value: RevisionCategory | null) => void;
  disabled?: boolean;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>Revision category</FieldLabel>
      <Select
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        items={REVISION_CATEGORIES.map((value) => ({
          value,
          label: REVISION_CATEGORY_LABELS[value],
        }))}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder="Select a reason category" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {REVISION_CATEGORIES.map((category) => (
              <SelectItem key={category} value={category}>
                {REVISION_CATEGORY_LABELS[category]}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <FieldDescription>
        Reported feedback, not an assignment of fault.
      </FieldDescription>
    </Field>
  );
}
