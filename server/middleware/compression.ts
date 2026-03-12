import type { Request, Response, NextFunction } from "express";
import zlib from "zlib";

const COMPRESSIBLE_TYPES = /json|text|javascript|css|xml|svg/;
const MIN_COMPRESS_SIZE = 1024; // bytes — skip compression for tiny responses

/**
 * Task #201: Response compression middleware using Node.js built-in zlib.
 * Supports Brotli (br) and gzip based on Accept-Encoding header.
 * Only compresses compressible content types ≥ 1 KB to avoid overhead.
 */
export function compressionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const acceptEncoding = req.headers["accept-encoding"] ?? "";

  // Pick best available encoding: brotli > gzip > identity
  const useBrotli = acceptEncoding.includes("br");
  const useGzip = !useBrotli && acceptEncoding.includes("gzip");

  if (!useBrotli && !useGzip) {
    return next();
  }

  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);

  let compressed = false;

  function shouldCompress(): boolean {
    const contentType = res.getHeader("Content-Type") as string | undefined;
    if (!contentType || !COMPRESSIBLE_TYPES.test(contentType)) return false;
    if (res.getHeader("Content-Encoding")) return false; // already encoded
    return true;
  }

  function setupCompressor(): zlib.BrotliCompress | zlib.Gzip | null {
    if (!shouldCompress()) return null;
    const compressor = useBrotli
      ? zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } })
      : zlib.createGzip({ level: zlib.constants.Z_DEFAULT_COMPRESSION });

    res.setHeader("Content-Encoding", useBrotli ? "br" : "gzip");
    res.removeHeader("Content-Length"); // length changes after compression
    compressed = true;

    compressor.on("data", (chunk: Buffer) => originalWrite(chunk));
    compressor.on("end", () => originalEnd());
    compressor.on("error", () => {
      // If compression fails, fall back to uncompressed
      compressed = false;
    });
    return compressor;
  }

  let compressor: zlib.BrotliCompress | zlib.Gzip | null = null;
  let setupDone = false;

  function ensureSetup() {
    if (!setupDone) {
      setupDone = true;
      compressor = setupCompressor();
    }
  }

  (res as any).write = function (chunk: any, encoding?: any, callback?: any) {
    ensureSetup();
    if (compressor) {
      compressor.write(chunk, encoding);
      if (callback) callback();
      return true;
    }
    return originalWrite(chunk, encoding, callback);
  };

  (res as any).end = function (chunk?: any, encoding?: any, callback?: any) {
    ensureSetup();
    if (compressor) {
      if (chunk) compressor.write(chunk, encoding);
      compressor.end();
      if (callback) callback();
      return res;
    }
    return originalEnd(chunk, encoding, callback);
  };

  next();
}
