// WATCHER MODULE
const {
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");

const { streamToString, moveActivityFileToOutputBucket } = require("../utility/bucketUtilities");
const { processRideData } = require("../processing/processRideData");

const BUCKET_NAME = "ocdcyclistbucket";
let isShuttingDown = false;

async function claimFile(fastify, key) {
  const newKey = key.replace("input/", "processing/");

  try {
    await fastify.s3Client.send(new CopyObjectCommand({
      Bucket: BUCKET_NAME,
      CopySource: `${BUCKET_NAME}/${key}`,
      Key: newKey,
    }));

    await fastify.s3Client.send(new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    }));

    return newKey;
  } catch (err) {
    fastify.log.warn(`Failed to claim file ${key}: ${err.message}`);
    return null;
  }
}

async function watchForBucketItems(fastify) {
  while (!isShuttingDown) {
    try {
      const listResponse = await fastify.s3Client.send(new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: "activities/input/",
      }));

      for (const item of listResponse.Contents || []) {
        if (isShuttingDown) break;
        const key = item.Key;

        if (!key.endsWith(".json")) continue;

        const claimedKey = await claimFile(fastify, key);
        if (!claimedKey) continue;

        try {
          const fileName = key.split("/").pop();
          const pieces = fileName.split("-");
          const riderId = parseInt(pieces[1], 10);
          const rideId = parseInt(pieces[2], 10);

          // read JSON
          const getResp = await fastify.s3Client.send(
            new GetObjectCommand({ Bucket: BUCKET_NAME, Key: claimedKey })
          );
          const jsonData = await streamToString(getResp.Body);
          const data = JSON.parse(jsonData);

          // Use shared logic
          await processRideData(fastify, riderId, rideId, data);

          // Move from processing → output
          await moveActivityFileToOutputBucket(
            fastify,
            riderId,
            rideId,
            pieces[3].replace(".json", "")
          );

        } catch (err) {
          console.error(`Error processing file ${key}:`, err);
        }
      }
    } catch (err) {
      console.error("Error listing bucket items:", err);
    }

    await new Promise(r => setTimeout(r, 10000));
  }
}

function shutdown() {
  console.log("Shutdown signal received. Completing current tasks...");
  isShuttingDown = true;
}

module.exports = { watchForBucketItems, shutdown };
