import { createHmac } from "node:crypto";

/** Seeded randomness is stable across retries and reproducible from the server seed. */
export function createSeededRandom(seed: string) {
  let counter = 0;
  return () => {
    const bytes = createHmac("sha256", seed).update(String(counter++)).digest();
    return bytes.readUInt32BE(0) / 0x1_0000_0000;
  };
}
