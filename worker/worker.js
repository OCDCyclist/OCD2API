const { parentPort } = require("worker_threads");
const fs = require("fs/promises");
const path = require("path");
const { workerData } = require('worker_threads');
const { Pool } = require('pg');
const { isRiderId } = require("../utility/general");
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

// Navigate relative to the worker.js file's directory (__dirname)
const inputDir = path.resolve(__dirname, "../data/activities/input");
const processedDir = path.resolve(__dirname, "../data/activities/output");

let isShuttingDown = false;

const pool = new Pool(workerData.dbConfig);

const insertMetrics = async (rideid, metrics) => {
  const client = await pool.connect();
  try {
    for (const metric of metrics) {
      await client.query(`
        INSERT INTO rides_metric_detail (
          rideid,
          metric,
          period,
          metric_value,
          startIndex
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (rideid, metric, period)
        DO UPDATE SET
          metric_value = EXCLUDED.metric_value,
          startIndex = EXCLUDED.startIndex
      `, [
        rideid,
        metric.metric,
        metric.period,
        metric.metric_value,
        metric.startIndex
      ]);
    }
  } catch (err) {
    console.error('Database error in insertMetrics:', err);
  } finally {
    client.release();
  }
};

const updateNormalizedPowerMetric = async (riderId, rideid) => {
  const client = await pool.connect();
  try {
    await client.query(`
      UPDATE rides
      SET powernormalized = rmd.metric_value
      FROM rides_metric_detail rmd
      WHERE rides.rideid = rmd.rideid
        AND rmd.metric = 'normalized'
        AND rides.riderId = $1
        AND rides.rideid = $2
    `, [
          riderId,
          rideid,
      ]
    );
  }
  catch(err){
    console.error('Database error in updateNormalizedPowerMetric:', err);
  }
  finally {
    client.release();
}};

const getRiderZones = async (pool, riderId) =>{
  if( !isRiderId(riderId)){
      throw new TypeError("Invalid parameter: riderId must be an integer");
  }

  const client = await pool.connect();
  let query = `Select zonetype, zonevalues from riderzones where riderid = $1;`;
  const params = [riderId];

  try {
      // This will automatically release the one-time-use connection.
      const { rows } = await client.query(query, params);
      if(Array.isArray(rows)){
          return rows;
      }
      throw new Error(`Invalid data for getRiderZones for riderId ${riderId}`);//th

  } catch (error) {
      throw new Error(`Database error fetching getRiderZones with riderId ${riderId}: ${error.message}`);//th
  }
  finally {
      client.release();
  }
}

const updateRideZones = async (rideid, combinedZones) => {
  if( !Array.isArray(combinedZones) || combinedZones.length === 0){
    console.log("CombinedZones must be a non-empty array")
    return;
  }
  const client = await pool.connect();
  try {
    await client.query(
      `
      UPDATE rides
      SET
        hrzones = $2,
        powerzones = $3,
        cadencezones = $4
      WHERE rideid = $1
      `,
      [
        rideid,
        combinedZones.length > 0 ? combinedZones[0] : [],
        combinedZones.length > 1 ? combinedZones[1] : [],
        combinedZones.length > 2 ? combinedZones[2] : [],
      ]
    );
  } catch (err) {
    console.error(
      `Database error in updateRideZones for rideid: ${rideid} combinedZones: ${JSON.stringify(
        combinedZones
      )}`,
      err
    );
  } finally {
    client.release();
  }
};

const defaultZones = {
  HR: "123,136,152,160,9999",
  Power: "190,215,245,275,310,406,9999",
  Cadence: "60,70,80,90,100"
};

function convertZonesToObject(riderZones) {
  const zoneObject = {};

  riderZones.forEach(zone => {
      zoneObject[zone.zonetype] = zone.zonevalues.split(",").map(Number);
  });

  // Add default values for missing zone types
  Object.keys(defaultZones).forEach(zoneType => {
      if (!zoneObject[zoneType]) {
          zoneObject[zoneType] = defaultZones[zoneType].split(",").map(Number);
      }
  });

  return zoneObject;
}
// Function to process files
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

            const riderId = pieces[1];
            const rideId = pieces[2];

            const riderZones = await getRiderZones(pool, Number(riderId));
            const riderZoneObject = convertZonesToObject(riderZones);

            // Read the JSON file
            const jsonData = await fs.readFile(filePath, "utf8");

            // Parse the JSON data
            const data = JSON.parse(jsonData);

            const combinedMetrics = [
              ...(data.watts ? calculatePowerMetrics(data.watts.data) : []),
              ...(data.cadence ? calculateCadenceMetrics(data.cadence.data) : []),
              ...(data.heartrate ? calculateHeartRateMetrics(data.heartrate.data) : []),
              ...(data.temp ? calculateTemperatureMetrics(data.temp.data) : []),
              ...(data.velocity_smooth ? calculateSpeedMetrics(data.velocity_smooth.data) : []),
              ...(data.altitude ? calculateAltitudeMetrics(data.altitude.data) : []),
            ];

            const combinedZones = [
              (data.watts ? calculateZones(data.watts.data, riderZoneObject.Power) : []),
              (data.cadence ? calculateZones(data.cadence.data, riderZoneObject.Cadence) : []),
              (data.heartrate ? calculateZones(data.heartrate.data, riderZoneObject.HR) : []),
            ];

            await insertMetrics(rideId, combinedMetrics);
            await updateNormalizedPowerMetric(riderId, rideId);
            await updateRideZones(rideId, combinedZones);

            console.log(`Finished processing: ${file}.`);

            // Move file to processed directory
            const processedPath = path.join(processedDir, file);
            await fs.rename(filePath, processedPath);
          }
        }
      }
    } catch (error) {
      console.error("Error watching files:", error);
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
