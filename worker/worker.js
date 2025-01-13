const { parentPort } = require("worker_threads");
const fs = require("fs/promises");
const path = require("path");
const { workerData } = require('worker_threads');
const { Pool } = require('pg');
const {
  calculatePowerMetrics,
  calculateCadenceMetrics,
  calculateHeartRateMetrics,
  calculateTemperatureMetrics,
  calculateSpeedMetrics,
  calculateAltitudeMetrics,
} = require("../processing/calculatePowerData");

// Navigate relative to the worker.js file's directory (__dirname)
const inputDir = path.resolve(__dirname, "../data/activities/input2");
const processedDir = path.resolve(__dirname, "../data/activities/output");

let isShuttingDown = false;

const pool = new Pool(workerData.dbConfig);

async function queryDatabase(query, params) {
  const client = await pool.connect();
  try {
    const result = await client.query(query, params);
    return result;
  } finally {
    client.release();
  }
}

const insertMetrics = async (rideid,  metrics) => {
  const client = await pool.connect();
  try {
    for (const metric of metrics) {
      await client.query(`
        INSERT INTO rides_metric_detail(
          rideid,
          metric,
          period,
          metric_value,
          startIndex
        )
        VALUES ($1, $2, $3, $4, $5)
        `, [
              rideid,
              metric.metric,
              metric.period,
              metric.metric_value,
              metric.startIndex
          ]
      );
    }
  }
  catch(err){
    console.error('Database error in insertMetrics:', err);
  }
  finally {
    client.release();
  }
};

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

            const rideId = pieces[2];

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

            await insertMetrics(rideId, combinedMetrics);

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
