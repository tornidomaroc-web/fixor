// ASSUMED-PATH: src/app/handlers/secrets-exposure/06-aws-keys-from-env.js
const AWS = require("aws-sdk");

if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  throw new Error("AWS credentials missing -- refuse to start");
}

AWS.config.update({
  region: process.env.AWS_REGION || "us-east-1",
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

const s3 = new AWS.S3();

async function uploadInvoice(buf, key) {
  return s3.upload({ Bucket: "acme-invoices", Key: key, Body: buf }).promise();
}

module.exports = { uploadInvoice };
