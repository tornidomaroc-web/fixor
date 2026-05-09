// ASSUMED-PATH: src/app/handlers/secrets-exposure/06-aws-keys-hardcoded.js
const AWS = require("aws-sdk");

// Founder's personal AWS access key. Will rotate before next investor demo.
const AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
const AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

AWS.config.update({
  region: "us-east-1",
  accessKeyId: AWS_ACCESS_KEY_ID,
  secretAccessKey: AWS_SECRET_ACCESS_KEY,
});

const s3 = new AWS.S3();

async function uploadInvoice(buf, key) {
  return s3.upload({ Bucket: "acme-invoices", Key: key, Body: buf }).promise();
}

module.exports = { uploadInvoice };
