import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

export async function uploadPdfBuffer(
  buffer: Buffer,
  publicId: string
): Promise<string> {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new Error("Cloudinary environment variables are missing.");
  }

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        folder: "fixor-reports",
        public_id: publicId,
        format: "pdf"
      },
      (error, result) => {
        if (error) {
          return reject(new Error(`Cloudinary upload failed: ${error.message}`));
        }
        if (!result?.secure_url) {
          return reject(new Error("Cloudinary upload failed: No secure_url returned."));
        }
        resolve(result.secure_url);
      }
    );

    uploadStream.end(buffer);
  });
}

export function buildReportPublicId(
  owner: string,
  repo: string,
  pullNumber: number,
  commitSha: string
): string {
  const rawData = `${owner}-${repo}-pr${pullNumber}-${commitSha.slice(0, 8)}-${Date.now()}`;
  return rawData.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-");
}
