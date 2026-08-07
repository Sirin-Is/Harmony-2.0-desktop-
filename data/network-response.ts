const encoder = new TextEncoder();

export async function readTextResponse(response: Response, maxBytes: number): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Некоректний ліміт відповіді сервера.');
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error('Відповідь сервера перевищує безпечний розмір.');
  }
  if (!response.body) {
    const body = await response.text();
    if (encoder.encode(body).byteLength > maxBytes) throw new Error('Відповідь сервера перевищує безпечний розмір.');
    return body;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const chunks: string[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error('Відповідь сервера перевищує безпечний розмір.');
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    reader.releaseLock();
  }
}

export async function readJsonResponse<T>(response: Response, maxBytes: number): Promise<T> {
  return JSON.parse(await readTextResponse(response, maxBytes)) as T;
}
