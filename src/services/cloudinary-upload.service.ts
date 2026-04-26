/**
 * Cloudinary uploads for Fixor report artifacts.
 *
 * Phase 5A-7: uploads use `type: "authenticated"` so the asset is not
 * publicly addressable. Delivery URLs are minted via
 * `buildSignedReportUrl` with a TTL (default 1 hour), so a leaked URL
 * stops working soon after.
 *
 * Trade-off: PR reviewers who come back days later get a 401. They
 * re-trigger the scan to regenerate. PILOT.md documents this.
 */
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

function assertCloudinaryEnv(): void {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } =
    process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new Error("Cloudinary environment variables are missing.");
  }
}

const DEFAULT_TTL_SECONDS = 3600;

/**
 * Metadata returned by an upload, used as input to `buildSignedReportUrl`.
 * Contains everything Cloudinary needs to mint a fresh signed delivery
 * URL — no extra HTTP calls.
 */
export interface UploadedReport {
  publicId: string;
  resourceType: "raw" | "image";
  type: "authenticated";
  format: string;
}

export async function uploadPdfBuffer(
  buffer: Buffer,
  publicId: string,
): Promise<UploadedReport> {
  assertCloudinaryEnv();

  return new Promise<UploadedReport>((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        type: "authenticated",
        folder: "fixor-reports",
        public_id: publicId,
        format: "pdf",
      },
      (error, result) => {
        if (error) {
          return reject(
            new Error(`Cloudinary upload failed: ${error.message}`),
          );
        }
        if (!result?.public_id) {
          return reject(
            new Error("Cloudinary upload failed: No public_id returned."),
          );
        }
        resolve({
          publicId: result.public_id,
          resourceType: "raw",
          type: "authenticated",
          format: "pdf",
        });
      },
    );

    uploadStream.end(buffer);
  });
}

export async function uploadSarifText(
  sarifJson: string,
  publicId: string,
): Promise<UploadedReport> {
  assertCloudinaryEnv();

  const buffer = Buffer.from(sarifJson, "utf8");
  return new Promise<UploadedReport>((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        type: "authenticated",
        folder: "fixor-sarif",
        public_id: publicId,
        format: "sarif",
      },
      (error, result) => {
        if (error) {
          return reject(
            new Error(`Cloudinary SARIF upload failed: ${error.message}`),
          );
        }
        if (!result?.public_id) {
          return reject(
            new Error(
              "Cloudinary SARIF upload failed: No public_id returned.",
            ),
          );
        }
        resolve({
          publicId: result.public_id,
          resourceType: "raw",
          type: "authenticated",
          format: "sarif",
        });
      },
    );

    uploadStream.end(buffer);
  });
}

function reportUrlTtlSeconds(): number {
  const raw = process.env.FIXOR_REPORT_URL_TTL_SECONDS;
  if (!raw) return DEFAULT_TTL_SECONDS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_SECONDS;
}

/**
 * Generate a time-limited signed delivery URL for an authenticated
 * upload. Valid for `ttlSeconds` from the moment of generation.
 *
 * `attachment` defaults to false so PDFs render inline in the browser
 * instead of forcing a download. Pass true for SARIF if you want the
 * download dialog (browsers will not preview .sarif files anyway).
 */
export function buildSignedReportUrl(
  report: UploadedReport,
  opts?: { ttlSeconds?: number; attachment?: boolean },
): string {
  const ttl = opts?.ttlSeconds ?? reportUrlTtlSeconds();
  const expiresAt = Math.floor(Date.now() / 1000) + ttl;
  return cloudinary.utils.private_download_url(
    report.publicId,
    report.format,
    {
      resource_type: report.resourceType,
      type: report.type,
      expires_at: expiresAt,
      attachment: opts?.attachment ?? false,
    },
  );
}

export function buildReportPublicId(
  owner: string,
  repo: string,
  pullNumber: number,
  commitSha: string,
): string {
  const rawData = `${owner}-${repo}-pr${pullNumber}-${commitSha.slice(0, 8)}-${Date.now()}`;
  return rawData.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-");
}
