// supabase.functions.invoke() reports any non-2xx response as a generic
// "Edge Function returned a non-2xx status code". The function's own message
// (e.g. "Email already registered") is in the response body, so read it from
// there when we can.
type InvokeError = { message?: string; context?: { json?: () => Promise<unknown> } };

export type FunctionErrorBody = { error?: string; [key: string]: unknown };

export const readFunctionErrorBody = async (err: InvokeError): Promise<FunctionErrorBody | null> => {
  if (!err.context || typeof err.context.json !== 'function') return null;
  try {
    const body = await err.context.json();
    return body && typeof body === 'object' ? (body as FunctionErrorBody) : null;
  } catch {
    return null;
  }
};

export const readFunctionError = async (err: InvokeError, fallback: string): Promise<string> => {
  const body = await readFunctionErrorBody(err);
  return (typeof body?.error === 'string' && body.error) || fallback;
};
