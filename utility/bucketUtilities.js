const { PutObjectCommand, GetObjectCommand, CopyObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { isRiderId, isIntegerValue, isSegmentId, isFastify, isEmpty, isValidDate, isValidNumber, POWER_CURVE_INTERVALS } = require("../utility/general");

/**
 * Upload ride activity data JSON to DigitalOcean Spaces
 *
 * @param {FastifyInstance} fastify - The Fastify instance with s3Client decorated
 * @param {number|string} riderId
 * @param {number|string} rideid
 * @param {number|string} stravaId
 * @param {object} data - The JSON data to upload
 * @returns {Promise<string>} - Public URL of the uploaded object
 */
async function writeActivityFileToBucket(fastify, riderId, rideid, stravaId, data) {
  if(!isFastify(fastify)){
    throw new TypeError("Invalid parameter: fastify must be provided");
  }

  if( !isRiderId(riderId)){
    throw new TypeError("Invalid parameter: riderId must be an integer");
  }

  if ( !isIntegerValue(rideid)) {
    throw new TypeError("Invalid parameter: rideid must be an integer");
  }

  const input_key = `activities/input/activity-${riderId}-${rideid}-${stravaId}.json`;
  const jsonData = JSON.stringify(data, null, 2);

  const BUCKET_NAME = "ocdcyclistbucket";

  try {
    await fastify.s3Client.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: input_key,
      Body: jsonData,
      ContentType: "application/json"
    }));

    // Return the full URL
    return `https://${BUCKET_NAME}.sfo2.digitaloceanspaces.com/${input_key}`;
  } catch (err) {
    throw new Error(`Failed to upload file to bucket: ${err.message}`);
  }
}

/**
 * Read ride activity data JSON from DigitalOcean Spaces
 *
 * @param {FastifyInstance} fastify - The Fastify instance with s3Client decorated
 * @param {number|string} riderId
 * @param {number|string} rideid
 * @param {number|string} stravaId
 * @returns {Promise<object>} - Parsed JSON data from the bucket
 */
async function readActivityFileFromBucket(fastify, riderId, rideid, stravaId) {
  if (!isFastify(fastify)) {
    throw new TypeError("Invalid parameter: fastify must be provided");
  }

  if (!isRiderId(riderId)) {
    throw new TypeError("Invalid parameter: riderId must be an integer");
  }

  if (!isIntegerValue(rideid)) {
    throw new TypeError("Invalid parameter: rideid must be an integer");
  }

  const input_key = `activities/input/activity-${riderId}-${rideid}-${stravaId}.json`;
  const BUCKET_NAME = "ocdcyclistbucket";

  try {
    const response = await fastify.s3Client.send(
      new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: input_key,
      })
    );

    // The response.Body is a stream, convert to string
    const bodyContents = await streamToString(response.Body);

    // Parse as JSON
    return JSON.parse(bodyContents);
  } catch (err) {
    throw new Error(`Failed to read file from bucket: ${err.message}`);
  }
}

/**
 * Move ride activity data JSON from processing bucket to output bucket
 *
 * @param {FastifyInstance} fastify - The Fastify instance with s3Client decorated
 * @param {number|string} riderId
 * @param {number|string} rideid
 * @param {number|string} stravaId
 * @returns {Promise<boolean>} - true if successful, false otherwise
 */
async function moveActivityFileToOutputBucket(fastify, riderId, rideid, stravaId) {
  if (!isFastify(fastify)) {
    throw new TypeError("Invalid parameter: fastify must be provided");
  }

  if (!isRiderId(riderId)) {
    throw new TypeError("Invalid parameter: riderId must be an integer");
  }

  if (!isIntegerValue(rideid)) {
    throw new TypeError("Invalid parameter: rideid must be an integer");
  }

  const BUCKET_NAME = "ocdcyclistbucket";
  const processingKey = `activities/processing/activity-${riderId}-${rideid}-${stravaId}.json`;
  const outputKey = `activities/output/activity-${riderId}-${rideid}-${stravaId}.json`;

  try {
    // Copy object from processing to output location
    await fastify.s3Client.send(
      new CopyObjectCommand({
        Bucket: BUCKET_NAME,
        CopySource: `${BUCKET_NAME}/${processingKey}`, // source bucket/key
        Key: outputKey,                                // destination key
      })
    );

    // Delete the original file from processing
    await fastify.s3Client.send(
      new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: processingKey,
      })
    );

    return true;
  } catch (err) {
    fastify.log.error(`Failed to move file from processing to output bucket: ${err.message}`);
    return false;
  }
}

/**
 * Helper: convert Node.js stream to string
 */
function streamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}


module.exports = { writeActivityFileToBucket, readActivityFileFromBucket, moveActivityFileToOutputBucket, streamToString };