const { parentPort } = require("worker_threads");
const fs = require("fs/promises");
const path = require("path");
const { workerData } = require('worker_threads');
const { Pool } = require('pg');
const zlib = require("zlib");
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

const compress = (data, type) => {
  const originalData = new type(data);
  const compressedData = zlib.deflateSync(Buffer.from(originalData.buffer));
  return compressedData;
};

const storeRideMetrics = async (rideId, metrics) => {
  const client = await pool.connect();

  const compressedData = {
      watts: metrics.watts ? compress(metrics.watts.data, Uint16Array) : compress([], Uint16Array),
      heartrate: metrics.heartrate ? compress(metrics.heartrate.data, Uint16Array) : compress([], Uint16Array),
      cadence: metrics.cadence ? compress(metrics.cadence.data, Uint16Array) : compress([], Uint16Array),
      velocity_smooth: metrics.velocity_smooth ? compress(metrics.velocity_smooth.data, Float32Array) : compress([], Float32Array),
      altitude: metrics.altitude ? compress(metrics.altitude.data, Uint16Array) : compress([], Uint16Array),
      distance: metrics.distance ? compress(metrics.distance.data, Float32Array) : compress([], Float32Array),
      temperature: metrics.temp ? compress(metrics.temp.data, Uint16Array) : compress([], Uint16Array),
      location: metrics.latlng ? compress(metrics.latlng.data.flat(), Float32Array) : compress([], Float32Array)
  };

  try {
      await client.query(`
        INSERT INTO ride_metrics_binary (rideid, watts, heartrate, cadence, velocity_smooth, altitude, distance, temperature, location)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (rideid) DO UPDATE SET
            watts = EXCLUDED.watts,
            heartrate = EXCLUDED.heartrate,
            cadence = EXCLUDED.cadence,
            velocity_smooth = EXCLUDED.velocity_smooth,
            altitude = EXCLUDED.altitude,
            distance = EXCLUDED.distance,
            temperature = EXCLUDED.temperature,
            location = EXCLUDED.location`,
            [rideId, ...Object.values(compressedData)]
      );
  } catch (err) {
    console.error('Database error in storeRideMetrics:', err);
  } finally {
    client.release();
  }
}

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

const getRiderFTP = async (pool, riderId) =>{
  if( !isRiderId(riderId)){
      throw new TypeError("Invalid parameter: riderId must be an integer");
  }

  const client = await pool.connect();
  let query = `Select propertyvalue from riderpropertyvalues where riderid = $1 and property = 'FTP' order by date desc limit 1;`;
  const params = [riderId];

  try {
      const { rows } = await client.query(query, params);
      if(Array.isArray(rows) && rows.length > 0){
          return Number(rows[0].propertyvalue);
      }
      throw new Error(`Invalid data for getRiderFTP for riderId ${riderId}`);//th

  } catch (error) {
      throw new Error(`Database error fetching getRiderFTP with riderId ${riderId}: ${error.message}`);//th
  }
  finally {
      client.release();
  }
}

const getRiderMatchDefinitions = async (pool, riderId) =>{
  if( !isRiderId(riderId)){
      throw new TypeError("Invalid parameter: riderId must be an integer");
  }

  const client = await pool.connect();
  let query = `Select type, period, targetftp from rider_match_definition where riderid = $1 order by period;`;
  const params = [riderId];

  try {
      const { rows } = await client.query(query, params);
      if(Array.isArray(rows)){
          return rows;
      }
      throw new Error(`Invalid data for getRiderMatchDefinitions for riderId ${riderId}`);//th

  } catch (error) {
      throw new Error(`Database error fetching getRiderMatchDefinitions with riderId ${riderId}: ${error.message}`);//th
  }
  finally {
      client.release();
  }
}

const upsertRideMatch = async (rideid, type, period, targetFtp, startIndex, actualPeriod, maxAveragePower, averagePower, peakPower, averageHeartrate) => {
  const query = `
    INSERT INTO public.rides_matches_new (
      rideid, type, period, targetftp, startindex,
      actualperiod, maxaveragepower, averagepower, peakpower, averageHeartrate
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (rideid, type, period, startindex)
    DO UPDATE SET
      targetftp = EXCLUDED.targetftp,
      actualperiod = EXCLUDED.actualperiod,
      maxaveragepower = EXCLUDED.maxaveragepower,
      averagepower = EXCLUDED.averagepower,
      peakpower = EXCLUDED.peakpower,
      averageHeartrate = EXCLUDED.averageHeartrate,
      insertdttm = CURRENT_TIMESTAMP;
  `;

  const values = [rideid, type, period, targetFtp, startIndex, actualPeriod, maxAveragePower, averagePower, peakPower, averageHeartrate];

  const client = await pool.connect();

  try {
    await client.query(query, values);
  } catch (err) {
    console.error(
      `Database error in upsertRideMatch for rideid: ${rideid} combinedZones: ${JSON.stringify(
        combinedZones
      )}`,
      err
    );
  } finally {
    client.release();
  }
}

const calculatePowerCurve = async (riderId, rideid) => {
  if ( !isRiderId(riderId)) {
      throw new TypeError("Invalid parameter: riderId must be an integer");
  }

  if (!isIntegerValue(rideid)){
    throw new TypeError("Invalid parameter: rideid must be an integer");
  }

  const client = await pool.connect();
  try {
    // 1. Get the ride data
    let query = `
        SELECT
            b.watts
        FROM
            rides a left outer join ride_metrics_binary b
            on a.rideid = b.rideid
        WHERE
            a.riderid = $1
            and a.rideid = $2;`;

    const params = [riderId, rideid];
    const { rows } = await client.query(query, params);

    if(!Array.isArray(rows) || rows.length === 0){
        throw new Error(`No power data found for riderid: ${riderid} rideId: ${rideid}`);
    }

    const compressedBuffer = rows[0].watts; // Buffer from PostgreSQL
    const decompressedData = zlib.inflateSync(compressedBuffer); // Decompress
    const decompressedUint8Array = new Uint8Array(decompressedData); // Convert to Uint8Array

  // Convert to Uint16Array (Ensure proper alignment)
  if (decompressedUint8Array.length % 2 !== 0) {
    throw new Error('Decompressed byte length is not a multiple of 2');
  }

  const wattsArray = new Uint16Array(decompressedUint8Array.buffer);

    // Define commonly used time intervals (seconds)
    const POWER_CURVE_INTERVALS = [
        1, 2, 5, 10, 15, 20, 30, 45, 60, 120, 180, 240, 300,
        360, 480, 600, 720, 900, 1200, 1500, 1800, 2400, 3000,
        3600, 4500, 5400, 6300, 7200, 9000, 10800, 14400, 18000,
        21600, 25200, 28800, 32400, 36000, 43200
    ];

    // 2. Calculate best power for each duration
    const bestPower = {};
    for (const duration of POWER_CURVE_INTERVALS) {
        if (duration <= wattsArray.length) {
            const { metric_value } = nSecondAverageMax(wattsArray, duration, 0, RollingAverageType.MAX);
            bestPower[duration] = metric_value;
        } else {
            bestPower[duration] = 0;
        }
    }

    // 3. Store computed power curve in ride_metrics_binary
    const powerCurveBuffer = Buffer.from(JSON.stringify(bestPower));
    await client.query(`
        UPDATE
            ride_metrics_binary
        SET
            power_curve = $1
        WHERE
            rideid = $2
        `,
      [powerCurveBuffer, rideid]
    );

    // 4. Retrieve the rider's weight
    const getriderWeightLbs =  await client.query(`
        SELECT
            getriderWeight
        FROM
            getRiderWeight($1, null, $2);
        `,
      [riderId, rideid]
    );

    const weightInKg = getriderWeightLbs?.rows &&  getriderWeightLbs.rows.length > 0 ? 0.45359237 * getriderWeightLbs.rows[0].getriderweight : 150 * 0.45359237;

    // 5. Update overall power curve if new values exceed existing records
    let updatesMade = 0;
    for (const [duration, power] of Object.entries(bestPower)) {
        const wattsPerKg = power / weightInKg;

        const existing = await client.query(`
            SELECT
                max_power_watts
            FROM
                power_curve
            WHERE
                riderid = $1
                AND duration_seconds = $2
                AND period = $3
            `,
          [riderId, duration, 'overall']
        );

        if (existing.rowCount === 0 || power > existing.rows[0].max_power_watts) {
            if( power > 0){
                // Only update if power is greater than 0
                await client.query(`
                  INSERT INTO
                      power_curve (riderid, duration_seconds, max_power_watts, max_power_wkg, period, rideid)
                  VALUES ($1, $2, $3, $4, $5, $6)
                  ON CONFLICT (riderid, duration_seconds, period)
                  DO UPDATE SET max_power_watts = EXCLUDED.max_power_watts,
                      max_power_wkg = EXCLUDED.max_power_wkg,
                      rideid = EXCLUDED.rideid,
                      insertdttm = NOW()`,
                  [riderId, duration, power, wattsPerKg, 'overall', rideid]
                );
                updatesMade++;
            }
        }
    }
    return updatesMade
  } catch (err) {
    console.error(
      `Database error in calculatePowerCurve for rideid: ${rideid} rideid: ${rideid}`,
      err
    );
  } finally {
    client.release();
  }

}

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

            console.log(`Rider data collected for ride ${rideId}`);

            // Read the JSON file
            const jsonData = await fs.readFile(filePath, "utf8");

            // Parse the JSON data
            const data = JSON.parse(jsonData);

            console.log(`Ride data retrieved for ride ${rideId}`);

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

              console.log(`combinedMetrics calculated for ride ${rideId}`);

              const combinedZones = [
                (data.heartrate ? calculateZones(data.heartrate.data, riderZoneObject.HR) : []),
                (data.watts ? calculateZones(data.watts.data, riderZoneObject.Power) : []),
                (data.cadence ? calculateZones(data.cadence.data, riderZoneObject.Cadence) : []),
              ];

              console.log(`combinedZones calculated for ride ${rideId}`);

              const allMatches = riderMatchDefinitions.reduce((acc, definition) => {
                const matches = calculateMatches('watts' in data ? data.watts.data : [], 'heartrate' in data ? data.heartrate.data : [], definition, riderTFP);
                return acc.concat(matches);
              }, []);

              console.log(`allMatches calculated for ride ${rideId}`);

              await insertMetrics(rideId, combinedMetrics);

              console.log(`metrics inserted for ride ${rideId}`);

              await updateNormalizedPowerMetric(riderId, rideId);

              console.log(`updateNormalizedPowerMetric completed for ride ${rideId}`);

              await updateRideZones(rideId, combinedZones);

              console.log(`updateRideZones completed for ride ${rideId}`);

              await allMatches.forEach(async (match) => {
                await upsertRideMatch(Number(rideId), match.type, match.period, match.targetFTP, match.startIndex, match.actualperiod, match.maxaveragepower, match.averagepower, match.peakpower, match.averageheartrate);
              })

              console.log(`upsertRideMatch completed for ride ${rideId}`);
            }
            await storeRideMetrics(rideId, data);
            console.log(`storeRideMetrics completed for ride ${rideId}`);

            await calculatePowerCurve(riderId, rideId);

            console.log(`calculatePowerCurve completed for ride ${rideId}`);

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
