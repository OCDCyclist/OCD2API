const { PutObjectCommand } = require("@aws-sdk/client-s3");
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

  const key = `activities/input/activity-${riderId}-${rideid}-${stravaId}.json`;
  const jsonData = JSON.stringify(data, null, 2);

  const BUCKET_NAME = "ocdcyclistbucket";

  try {
    await fastify.s3Client.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: jsonData,
      ContentType: "application/json"
    }));

    // Return the full URL
    return `https://${BUCKET_NAME}.sfo2.digitaloceanspaces.com/${key}`;
  } catch (err) {
    throw new Error(`Failed to upload file to bucket: ${err.message}`);
  }
}

module.exports = { writeActivityFileToBucket };