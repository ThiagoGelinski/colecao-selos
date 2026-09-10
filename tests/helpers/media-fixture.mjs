import sharp from 'sharp';

export async function imageFixture(format = 'webp', color = { r: 70, g: 110, b: 160 }) {
  let image = sharp({ create: { width: 12, height: 10, channels: 3, background: color } });
  if (format === 'webp') image = image.webp({ lossless: true });
  else if (format === 'png') image = image.png();
  else if (format === 'jpeg') image = image.jpeg();
  else image = image.tiff({ compression: 'lzw' });
  return image.toBuffer();
}
export function memoryStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  const etags = new Map([...data.keys()].map((key) => [key, 'initial']));
  const writes = [];
  let sequence = 0;
  const convert = (value, type) => {
    if (type === 'arrayBuffer') return Uint8Array.from(Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))).buffer;
    if (type === 'json') return Buffer.isBuffer(value) ? JSON.parse(value.toString()) : typeof value === 'string' ? JSON.parse(value) : structuredClone(value);
    return value;
  };
  const store = {
    get: async (key, opts) => data.has(key) ? convert(data.get(key), opts?.type) : null,
    getMetadata: async (key) => data.has(key) ? { etag: etags.get(key) } : null,
    getWithMetadata: async (key, opts) => data.has(key) ? { data: convert(data.get(key), opts?.type), etag: etags.get(key) } : null,
    set: async (key, value, opts = {}) => {
      writes.push({ key, opts });
      if ((opts.onlyIfNew && data.has(key)) || (opts.onlyIfMatch && opts.onlyIfMatch !== etags.get(key))) return { modified: false };
      data.set(key, Buffer.isBuffer(value) ? Buffer.from(value) : structuredClone(value));
      const etag = String(++sequence); etags.set(key, etag);
      return { modified: true, etag };
    },
    setJSON: async (key, value, opts) => store.set(key, value, opts),
    delete: async (key) => { data.delete(key); etags.delete(key); },
    list: async () => ({ blobs: [...data.keys()].map((key) => ({ key })) }),
  };
  return { store, data, etags, writes };
}
