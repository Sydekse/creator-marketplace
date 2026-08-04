/**
 * Resolving a `details` map onto form inputs.
 *
 * Split out of the forms because the prefix rule below is easy to get wrong in
 * a way that shows nothing rather than something wrong — the failure mode is a
 * field that silently looks valid. One definition, imported by every form, is
 * the only way that rule stays true across three of them.
 */

export type FieldErrorMap = Record<string, string[]>;

/**
 * Every message at **or under** a field path, in the shape `<FieldError>` wants.
 *
 * Prefix-matched rather than looked up, because zod reports an invalid array
 * *member* at `audience.topCountries.0` while the input is named
 * `audience.topCountries`. An exact lookup renders nothing for that case.
 *
 * The boundary is deliberate: `name.` matches nested paths, but a sibling field
 * whose name merely starts with the same letters (`companyNameLegacy` under
 * `companyName`) does not, because the dot is required.
 *
 * Returns `undefined` rather than an empty array so the caller can use it as
 * both the error list and the "is this field invalid" test.
 */
export function fieldErrorsAt(
  errors: FieldErrorMap,
  name: string
): { message: string }[] | undefined {
  const messages = Object.entries(errors)
    .filter(([key]) => key === name || key.startsWith(`${name}.`))
    .flatMap(([, value]) => value);

  return messages.length > 0
    ? messages.map((message) => ({ message }))
    : undefined;
}
