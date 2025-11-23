// processing/processExistingFile.js
const { GetObjectCommand } = require("@aws-sdk/client-s3");
const { streamToString } = require("../utility/bucketUtilities");
const { processRideData } = require("./processRideData");

async function processExistingRideFile(fastify, key) {
  const fileName = key.split("/").pop();
  const pieces = fileName.replace(".json", "").split("-");

  if (pieces.length !== 4) {
    throw new Error(`Invalid file name format: ${fileName}`);
  }

  const riderId = parseInt(pieces[1], 10);
  const rideId = parseInt(pieces[2], 10);

  // Read the JSON directly (no moving)
  const getResp = await fastify.s3Client.send(
    new GetObjectCommand({ Bucket: "ocdcyclistbucket", Key: key })
  );
  const jsonData = await streamToString(getResp.Body);
  const data = JSON.parse(jsonData);

  console.log(`Reprocessing existing file: ${key}`);

  // Process the ride using the shared logic
  await processRideData(fastify, riderId, rideId, data);

  console.log(`Reprocessing complete for: ${key}`);
  return `Reprocessing complete for: ${key}`;
}

module.exports = { processExistingRideFile };
