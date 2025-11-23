// processing/processRideData.js
const {
  calculatePowerMetrics,
  calculateCadenceMetrics,
  calculateHeartRateMetrics,
  calculateTemperatureMetrics,
  calculateSpeedMetrics,
  calculateAltitudeMetrics,
  calculateHeartRateRecoveryMetrics,
} = require("./calculatePowerData"); // <-- Adjust path as needed

const { calculateZones } = require("./calculateZones");
const { calculateMatches } = require("./calculateMatches");

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
  upsertRideRecovery,
} = require("../db/dbHelpers");

const { logDetailMessage } = require("../utility/general");

async function processRideData(fastify, riderId, rideId, data) {
  // --- Fetch rider config ---
  const riderZones = await getRiderZones(fastify, riderId);
  const riderFTP = await getRiderFTP(fastify, riderId);
  const riderMatchDefinitions = await getRiderMatchDefinitions(fastify, riderId);
  const riderZoneObject = convertZonesToObject(fastify, riderZones);

  logDetailMessage("Rider data collected", "ride", rideId);

  // --- Compute metrics ---
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

  // --- Heart Rate Recovery ---
  if (data.heartrate && data.watts) {
    const recoveryMetrics = calculateHeartRateRecoveryMetrics(
      data.heartrate.data,
      data.watts.data
    );
    await upsertRideRecovery(fastify, rideId, recoveryMetrics);
  }

  // --- Zone calculations ---
  const combinedZones = [
    data.heartrate ? calculateZones(data.heartrate.data, riderZoneObject.HR) : [],
    data.watts ? calculateZones(data.watts.data, riderZoneObject.Power) : [],
    data.cadence ? calculateZones(data.cadence.data, riderZoneObject.Cadence) : [],
  ];
  await updateRideZones(fastify, rideId, combinedZones);

  // --- Matches ---
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

  // --- Store full ride and compute power curve ---
  await storeRideMetrics(fastify, rideId, data);
  await calculatePowerCurve(fastify, riderId, rideId);

  logDetailMessage("Finished processing ride data", "ride", rideId);
}

module.exports = { processRideData };
