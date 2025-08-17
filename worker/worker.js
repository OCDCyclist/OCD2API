const { parentPort } = require("worker_threads");
const fs = require("fs/promises");
const path = require("path");
const { workerData } = require('worker_threads');
const { Pool } = require('pg');
const { isRiderId, isIntegerValue } = require("../utility/general");
const {
  calculatePowerMetrics,
  calculateCadenceMetrics,
  calculateHeartRateMetrics,
  calculateTemperatureMetrics,
  calculateSpeedMetrics,
  calculateAltitudeMetrics,
} = require("../processing/calculatePowerData");
const {
  calculateZones,
} = require("../processing/calculateZones");
const {calculateMatches} = require("../processing/calculateMatches");
const { nSecondAverageMax, RollingAverageType } = require("../utility/metrics");
const { logDetailMessage, POWER_CURVE_INTERVALS, DEFAULT_ZONES } = require("../utility/general");
const { compress, inflateSync } = require("../utility/compression");

// Navigate relative to the worker.js file's directory (__dirname)
const inputDir = path.resolve(__dirname, "../data/activities/input");
const processedDir = path.resolve(__dirname, "../data/activities/output");

let isShuttingDown = false;

const pool = new Pool(workerData.dbConfig);


async function watchForFiles() {
  while (!isShuttingDown) {
    try {
      const files = await fs.readdir(inputDir);

      for (const file of files) {
        if (isShuttingDown) break;

        const filePath = path.join(inputDir, file);

        if (path.extname(file).toLowerCase() === ".json") {
          const stats = await fs.stat(filePath);
          if (stats.isFile()) {
            console.log(`Started processing: ${file}`);
            const pieces = file.split("-");
            if(pieces.length !== 4){
              console.log(`Invalid file name format for ${file}`);
              continue;
            }

            const riderId =parseInt(pieces[1], 10);;
            const rideId =  parseInt(pieces[2], 10);

            const riderZones = await getRiderZones(pool, Number(riderId));
            const riderTFP = await getRiderFTP(pool, Number(riderId));
            const riderMatchDefinitions = await getRiderMatchDefinitions(pool, Number(riderId));
            const riderZoneObject = convertZonesToObject(riderZones);

            logDetailMessage('Rider data collected for ride', 'ride', rideId);

            // Read the JSON file
            const jsonData = await fs.readFile(filePath, "utf8");

            // Parse the JSON data
            const data = JSON.parse(jsonData);

            logDetailMessage('Ride data retrieved for ride', 'ride', rideId);

            const skip = false;
            if(!skip){
              const combinedMetrics = [
                ...(data.watts ? calculatePowerMetrics(data.watts.data) : []),
                ...(data.cadence ? calculateCadenceMetrics(data.cadence.data) : []),
                ...(data.heartrate ? calculateHeartRateMetrics(data.heartrate.data) : []),
                ...(data.temp ? calculateTemperatureMetrics(data.temp.data) : []),
                ...(data.velocity_smooth ? calculateSpeedMetrics(data.velocity_smooth.data) : []),
                ...(data.altitude ? calculateAltitudeMetrics(data.altitude.data) : []),
              ];

              logDetailMessage('combinedMetrics', 'ride', rideId);

              const combinedZones = [
                (data.heartrate ? calculateZones(data.heartrate.data, riderZoneObject.HR) : []),
                (data.watts ? calculateZones(data.watts.data, riderZoneObject.Power) : []),
                (data.cadence ? calculateZones(data.cadence.data, riderZoneObject.Cadence) : []),
              ];

              logDetailMessage('combinedZones', 'ride', rideId);

              const allMatches = riderMatchDefinitions.reduce((acc, definition) => {
                const matches = calculateMatches('watts' in data ? data.watts.data : [], 'heartrate' in data ? data.heartrate.data : [], definition, riderTFP);
                return acc.concat(matches);
              }, []);

              logDetailMessage('allMatches', 'ride', rideId);

              await insertMetrics(rideId, combinedMetrics);

              logDetailMessage('insertMetrics', 'ride', rideId);

              await updateNormalizedPowerMetric(riderId, rideId);

              logDetailMessage('updateNormalizedPowerMetric', 'ride', rideId);

              await updateRideZones(rideId, combinedZones);

              logDetailMessage('updateRideZones', 'ride', rideId);

              await allMatches.forEach(async (match) => {
                await upsertRideMatch(Number(rideId), match.type, match.period, match.targetFTP, match.startIndex, match.actualperiod, match.maxaveragepower, match.averagepower, match.peakpower, match.averageheartrate);
              })

              logDetailMessage('upsertRideMatch', 'ride', rideId);
            }
            await storeRideMetrics(rideId, data);
            logDetailMessage('storeRideMetrics', 'ride', rideId);

            await calculatePowerCurve(riderId, rideId);

            logDetailMessage('calculatePowerCurve', 'ride', rideId);

            logDetailMessage('Finished processing', 'file', file);

            const processedPath = path.join(processedDir, file);
            await fs.rename(filePath, processedPath);
          }
        }
      }
    } catch (error) {
      logDetailMessage('Error watching files', file, error.message);
    }

    // Wait for a short interval before checking again
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  console.log("Worker thread stopped processing files.");
}

// Listen for messages from the main thread
parentPort.on("message", (msg) => {
  if (msg.type === "shutdown") {
    console.log("Shutdown signal received. Completing current tasks...");
    isShuttingDown = true;
  }
});

// Start watching for files
watchForFiles();
