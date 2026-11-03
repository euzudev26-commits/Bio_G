type DatabaseErrorShape = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

const asText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export function getDatabaseErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (!error || typeof error !== 'object') return fallback;

  const value = error as DatabaseErrorShape;
  const code = asText(value.code);
  const message = asText(value.message);
  const details = asText(value.details);
  const hint = asText(value.hint);
  const lowerMessage = message.toLowerCase();

  if (code === '23505') {
    return 'This employee code or BioMax user ID is already assigned to another employee. Check the existing employee records and try again.';
  }
  if (code === '23502') {
    return 'A required employee field is missing. Check Employee code and Full name, then try again.';
  }
  if (code === '23514') {
    return 'One of the employee values is not allowed by the database. Check the employment status and other fields.';
  }
  if (code === '42501' && lowerMessage.includes('permission denied')) {
    return 'Supabase denied access to save employee profiles. The authenticated role needs the employee INSERT/UPDATE database grants, while the Admin-only row security policy must remain enabled.';
  }
  if (lowerMessage.includes('row-level security')) {
    return 'Supabase blocked this save under the employee Admin access policy. Refresh the page and sign in again with an Admin account.';
  }

  const diagnostic = [message, details && `Details: ${details}`, hint && `Hint: ${hint}`]
    .filter(Boolean)
    .join(' ');
  return diagnostic || fallback;
}
