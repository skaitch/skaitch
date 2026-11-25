import { gunzipSync } from 'node:zlib';
import { InputError } from '@skaitch/core/bim/validation';
import { BIM_BODY_LIMIT, BIM_WIRE_LIMIT } from '@skaitch/core/types/bim';
export async function readBody(req: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > BIM_WIRE_LIMIT) throw new InputError('Requête BIM limitée à 4 Mo après compression.', 413);
    chunks.push(bytes);
  }
  let bytes = Buffer.concat(chunks);
  if (req.headers['content-encoding'] === 'gzip') {
    try { bytes = gunzipSync(bytes, { maxOutputLength: BIM_BODY_LIMIT }); }
    catch (error) {
      if ((error as any).code === 'ERR_BUFFER_TOO_LARGE') throw new InputError('Données BIM limitées à 64 Mo après décompression.', 413);
      throw new InputError('Compression BIM invalide.');
    }
  } else if (req.headers['content-encoding']) throw new InputError('Compression non prise en charge.');
  if (!bytes.length) throw new InputError('Données BIM vides.');
  return bytes;
}
