const { ListObjectsV2Command, GetObjectCommand } = require("@aws-sdk/client-s3");
const { logDetailMessage } = require("../utility/general");
const { streamToString } = require("../utility/bucketUtilities");
const {moveActivityFileToOutputBucket} = require("../utility/bucketUtilities")
// import your processing functions and DB helpers as before
const {
  calculatePowerMetrics,
  calculateCadenceMetrics,
  calculateHeartRateMetrics,
  calculateTemperatureMetrics,
  calculateSpeedMetrics,
  calculateAltitudeMetrics,
} = require("../processing/calculatePowerData");
const { calculateZones } = require("../processing/calculateZones");
const { calculateMatches } = require("../processing/calculateMatches");
const {
  insertMetrics,
  storeRideMetrics,
  updateNormalizedPowerMetric,
  getRiderZones,
  updateRideZones,
  getRiderFTP,
  getRiderMatchDefinitions,
  upsertRideMatch,
  calculatePowerCurve,
  convertZonesToObject,
} = require("../db/dbHelpers");

const BUCKET_NAME = "ocdcyclistbucket";
let isShuttingDown = false;

/**
 * Main loop to watch for items in the input bucket
 * @param {FastifyInstance} fastify
 */
async function watchForBucketItems(fastify) {
  while (!isShuttingDown) {
    try {
      const listResponse = await fastify.s3Client.send(
        new ListObjectsV2Command({
          Bucket: BUCKET_NAME,
          Prefix: "activities/input/",
        })
      );

      const items = listResponse.Contents || [];
      for (const item of items) {
        if (isShuttingDown) break;

        const key = item.Key;
        if (!key.endsWith(".json")) continue;

        const fileName = key.split("/").pop();

        try {
          console.log(`Started processing: ${fileName}`);

          const pieces = fileName.split("-");
          if (pieces.length !== 4) {
            console.log(`Invalid file name format for ${fileName}`);
            continue;
          }

          const riderId = parseInt(pieces[1], 10);
          const rideId = parseInt(pieces[2], 10);

          const riderZones = await getRiderZones(fastify, riderId);
          const riderFTP = await getRiderFTP(fastify, riderId);
          const riderMatchDefinitions = await getRiderMatchDefinitions(fastify, riderId);
          const riderZoneObject = convertZonesToObject(fastify, riderZones);

          logDetailMessage("Rider data collected", "ride", rideId);

          // Read JSON file from bucket
          const getResp = await fastify.s3Client.send(
            new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key })
          );
          const jsonData = await streamToString(getResp.Body);
          const data = JSON.parse(jsonData);

          logDetailMessage("Ride data retrieved", "ride", rideId);

          // Process metrics
          const combinedMetrics = [
            ...(data.watts ? calculatePowerMetrics(data.watts.data) : []),
            ...(data.cadence ? calculateCadenceMetrics(data.cadence.data) : []),
            ...(data.heartrate ? calculateHeartRateMetrics(data.heartrate.data) : []),
            ...(data.temp ? calculateTemperatureMetrics(data.temp.data) : []),
            ...(data.velocity_smooth ? calculateSpeedMetrics(data.velocity_smooth.data) : []),
            ...(data.altitude ? calculateAltitudeMetrics(data.altitude.data) : []),
          ];
          await insertMetrics(fastify, rideId, combinedMetrics);
          await updateNormalizedPowerMetric(fastify, riderId, rideId);

          const combinedZones = [
            data.heartrate ? calculateZones(data.heartrate.data, riderZoneObject.HR) : [],
            data.watts ? calculateZones(data.watts.data, riderZoneObject.Power) : [],
            data.cadence ? calculateZones(data.cadence.data, riderZoneObject.Cadence) : [],
          ];
          await updateRideZones(fastify, rideId, combinedZones);

          const allMatches = riderMatchDefinitions.reduce((acc, def) => {
            const matches = calculateMatches(
              fastify,
              data.watts?.data || [],
              data.heartrate?.data || [],
              def,
              riderFTP
            );
            return acc.concat(matches);
          }, []);
          for (const match of allMatches) {
            await upsertRideMatch(
              fastify,
              rideId,
              match.type,
              match.period,
              match.targetFTP,
              match.startIndex,
              match.actualperiod,
              match.maxaveragepower,
              match.averagepower,
              match.peakpower,
              match.averageheartrate
            );
          }

          await storeRideMetrics(fastify, rideId, data);
          await calculatePowerCurve(fastify, riderId, rideId);

          logDetailMessage("Finished processing", "ride", rideId);

          // Move file to output folder
          const moved = await moveActivityFileToOutputBucket(
            fastify,
            riderId,
            rideId,
            pieces[3].replace(".json", "")
          );
          if (!moved) {
            console.error(`Failed to move file ${fileName}`);
          }

        } catch (fileErr) {
          console.error(`Error processing file ${fileName}:`, fileErr);
          // Continue to next file even if this one fails
        }
      }
    } catch (err) {
      console.error("Error listing bucket items:", err);
    }

    // Wait a bit before checking again
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  console.log("Stopped processing bucket items.");
}

/**
 * Call this to gracefully stop the process
 */
function shutdown() {
  console.log("Shutdown signal received. Completing current tasks...");
  isShuttingDown = true;
}

module.exports = { watchForBucketItems, shutdown };
