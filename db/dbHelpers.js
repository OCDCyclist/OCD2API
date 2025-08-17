
const {
  isRiderId,
  isIntegerValue,
  isSegmentId,
  isFastify,
  isEmpty,
  isValidDate,
  isValidNumber,
  logDetailMessage,
  POWER_CURVE_INTERVALS,
  DEFAULT_ZONES
} = require("../utility/general");

const { compress, inflateSync } = require("../utility/compression");
const { nSecondAverageMax, RollingAverageType } = require("../utility/metrics");

const calculatePowerCurve = async (fastify, riderId, rideid) => {
  if(!isFastify(fastify)){
    throw new TypeError("Invalid parameter: fastify must be provided");
  }

  if (!isRiderId(riderId)) {
      throw new TypeError("Invalid parameter: riderId must be an integer");
  }

  if (!isIntegerValue(rideid)){
    throw new TypeError("Invalid parameter: rideid must be an integer");
  }

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
    const { rows } = await fastify.pg.query(query, params);

    if(!Array.isArray(rows) || rows.length === 0){
        throw new Error(`No power data found for riderid: ${riderid} rideId: ${rideid}`);
    }

    const compressedBuffer = rows[0].watts; // Buffer from PostgreSQL
    const decompressedData = inflateSync(compressedBuffer); // Decompress
    const decompressedUint8Array = new Uint8Array(decompressedData); // Convert to Uint8Array

    // Convert to Uint16Array (Ensure proper alignment)
    if (decompressedUint8Array.length % 2 !== 0) {
      throw new Error('Decompressed byte length is not a multiple of 2');
    }

    const wattsArray = new Uint16Array(decompressedUint8Array.buffer);

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
    await fastify.pg.query(`
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
    const getriderWeightLbs =  await fastify.pg.query(`
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

        const existing = await fastify.pg.query(`
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
                await fastify.pg.query(`
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
  }
}

function convertZonesToObject(fastify, riderZones) {
  if(!isFastify(fastify)){
    throw new TypeError("Invalid parameter: fastify must be provided");
  }

  const zoneObject = {};

  riderZones.forEach(zone => {
      zoneObject[zone.zonetype] = zone.zonevalues.split(",").map(Number);
  });

  // Add default values for missing zone types
  Object.keys(DEFAULT_ZONES).forEach(zoneType => {
      if (!zoneObject[zoneType]) {
          zoneObject[zoneType] = DEFAULT_ZONES[zoneType].split(",").map(Number);
      }
  });

  return zoneObject;
}

const getRiderFTP = async (fastify, riderId) =>{
  if(!isFastify(fastify)){
    throw new TypeError("Invalid parameter: fastify must be provided");
  }

  if( !isRiderId(riderId)){
      throw new TypeError("Invalid parameter: riderId must be an integer");
  }

  let query = `Select propertyvalue from riderpropertyvalues where riderid = $1 and property = 'FTP' order by date desc limit 1;`;
  const params = [riderId];

  try {
      const { rows } = await fastify.pg.query(query, params);
      if(Array.isArray(rows) && rows.length > 0){
          return Number(rows[0].propertyvalue);
      }
      throw new Error(`Invalid data for getRiderFTP for riderId ${riderId}`);//th

  } catch (error) {
      throw new Error(`Database error fetching getRiderFTP with riderId ${riderId}: ${error.message}`);//th
  }
}

const getRiderMatchDefinitions = async (fastify, riderId) =>{
  if(!isFastify(fastify)){
    throw new TypeError("Invalid parameter: fastify must be provided");
  }

  if( !isRiderId(riderId)){
      throw new TypeError("Invalid parameter: riderId must be an integer");
  }

  let query = `Select type, period, targetftp from rider_match_definition where riderid = $1 order by period;`;
  const params = [riderId];

  try {
      const { rows } = await fastify.pg.query(query, params);
      if(Array.isArray(rows)){
          return rows;
      }
      throw new Error(`Invalid data for getRiderMatchDefinitions for riderId ${riderId}`);//th

  } catch (error) {
      throw new Error(`Database error fetching getRiderMatchDefinitions with riderId ${riderId}: ${error.message}`);//th
  }
}

const getRiderZones = async (fastify, riderId) =>{
  if(!isFastify(fastify)){
    throw new TypeError("Invalid parameter: fastify must be provided");
  }

  if( !isRiderId(riderId)){
      throw new TypeError("Invalid parameter: riderId must be an integer");
  }

  let query = `Select zonetype, zonevalues from riderzones where riderid = $1;`;
  const params = [riderId];

  try {
      const { rows } = await fastify.pg.query(query, params);
      if(Array.isArray(rows)){
          return rows;
      }
      throw new Error(`Invalid data for getRiderZones for riderId ${riderId}`);//th

  } catch (error) {
      throw new Error(`Database error fetching getRiderZones with riderId ${riderId}: ${error.message}`);//th
  }
}

const insertMetrics = async (fastify, rideid, metrics) => {
  if(!isFastify(fastify)){
    throw new TypeError("Invalid parameter: fastify must be provided");
  }

  try {
    for (const metric of metrics) {
      await fastify.pg.query(`
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
  }
};

const storeRideMetrics = async (fastify, rideId, metrics) => {
  if(!isFastify(fastify)){
    throw new TypeError("Invalid parameter: fastify must be provided");
  }

  const compressedData = {
      watts: metrics.watts ? compress(metrics.watts.data, Uint16Array) : compress([], Uint16Array),
      heartrate: metrics.heartrate ? compress(metrics.heartrate.data, Uint16Array) : compress([], Uint16Array),
      cadence: metrics.cadence ? compress(metrics.cadence.data, Uint16Array) : compress([], Uint16Array),
      velocity_smooth: metrics.velocity_smooth ? compress(metrics.velocity_smooth.data, Float32Array) : compress([], Float32Array),
      altitude: metrics.altitude ? compress(metrics.altitude.data, Uint16Array) : compress([], Uint16Array),
      distance: metrics.distance ? compress(metrics.distance.data, Float32Array) : compress([], Float32Array),
      temperature: metrics.temp ? compress(metrics.temp.data, Uint16Array) : compress([], Uint16Array),
      location: metrics.latlng ? compress(metrics.latlng.data.flat(), Float32Array) : compress([], Float32Array),
      time: metrics.time ? compress(metrics.time.data, Uint16Array) : compress([], Uint16Array),
  };

  try {
      await fastify.pg.query(`
        INSERT INTO ride_metrics_binary (rideid, watts, heartrate, cadence, velocity_smooth, altitude, distance, temperature, location, time)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (rideid) DO UPDATE SET
            watts = EXCLUDED.watts,
            heartrate = EXCLUDED.heartrate,
            cadence = EXCLUDED.cadence,
            velocity_smooth = EXCLUDED.velocity_smooth,
            altitude = EXCLUDED.altitude,
            distance = EXCLUDED.distance,
            temperature = EXCLUDED.temperature,
            location = EXCLUDED.location,
            time = EXCLUDED.time`,
            [rideId, ...Object.values(compressedData)]
      );
  } catch (err) {
    console.error('Database error in storeRideMetrics:', err);
  }
}

const updateNormalizedPowerMetric = async (fastify, riderId, rideid) => {
  if(!isFastify(fastify)){
    throw new TypeError("Invalid parameter: fastify must be provided");
  }

  try {
    await fastify.pg.query(`
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
};

const upsertRideMatch = async (fastify, rideid, type, period, targetFtp, startIndex, actualPeriod, maxAveragePower, averagePower, peakPower, averageHeartrate) => {
  if(!isFastify(fastify)){
    throw new TypeError("Invalid parameter: fastify must be provided");
  }

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

  try {
    await fastify.pg.query(query, values);
  } catch (err) {
    console.error(
      `Database error in upsertRideMatch for rideid: ${rideid} combinedZones: ${JSON.stringify(
        combinedZones
      )}`,
      err
    );
  }
}

const updateRideZones = async (fastify, rideid, combinedZones) => {
  if(!isFastify(fastify)){
    throw new TypeError("Invalid parameter: fastify must be provided");
  }

  if( !Array.isArray(combinedZones) || combinedZones.length === 0){
    console.log("CombinedZones must be a non-empty array")
    return;
  }

  try {
    await fastify.pg.query(
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
  }
};

module.exports = {
    calculatePowerCurve,
    convertZonesToObject,
    getRiderFTP,
    getRiderMatchDefinitions,
    getRiderZones,
    insertMetrics,
    storeRideMetrics,
    updateNormalizedPowerMetric,
    upsertRideMatch,
    updateRideZones,
};

