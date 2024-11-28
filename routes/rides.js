const xss = require("xss");
const { DateTime } = require('luxon'); // Add Luxon for date parsing
const {
  getRidesLastMonth,
  getRidesHistory,
  getRides,
  getRidesByDate,
  getRidesByYearMonth,
  getRidesByYearDOW,
  getRidesByDOMMonth,
  getRidesforCluster,
  getRideById,
  getLookback,
  updateRide,
  getClusterDefinitions,
} = require('../db/dbQueries');
const { clusterRides } = require('../utility/clustering');

async function ridesRoutes(fastify, options) {

  fastify.get('/rides/lastmonth',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    try {
      const result = await getRidesLastMonth(fastify, riderId);
      request.log.warn(`rides retrieved: ${result.length}`);

      if (!Array.isArray(result)) {
        return reply.code(200).send([]);
      }

      return reply.code(200).send(result);
    } catch (err) {
      console.error('Database error:', err);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  fastify.post('/rides/history',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification
    const { years } = request.body;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    // Validate input to ensure 'years' is an array of integers
    if (!Array.isArray(years) || !years.every(Number.isInteger)) {
      return reply.status(400).send({ error: 'Invalid year list. Must be an array of integers.' });
    }

    try {
      const result = await getRidesHistory(fastify, riderId, years);

      if (!Array.isArray(result)) {
        return reply.code(200).send([]);
      }

      return reply.code(200).send(result);
    } catch (err) {
      console.error('Database error:', err);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  fastify.get('/rides',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
      const { riderId } = request.user;  // request.user is populated after JWT verification
      const { dateFrom, dateTo } = request.query;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    try {
      const result = await getRides(fastify, riderId, dateFrom, dateTo);

      if (!Array.isArray(result)) {
        return reply.code(200).send([]);
      }
      return reply.code(200).send(result);
    } catch (err) {
      console.error('Database error:', err);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  fastify.get('/ridesByDate',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification
    const { date } = request.query;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    // Validate the datetime string (YYYY-MM-DD)
    const parsedDate = DateTime.fromFormat(date, 'yyyy-MM-dd');
    if (!parsedDate.isValid) {
      return reply.status(400).send({ error: 'Invalid date format (expected YYYY-MM-DD)' });
    }

    try {
      const result = await getRidesByDate(fastify, riderId, date);

      if (!Array.isArray(result)) {
        return reply.code(200).send([]);
      }
      return reply.code(200).send(result);
    } catch (err) {
      console.error('Database error:', err);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  fastify.get('/ridesByYearMonth',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification
    const { year, month } = request.query;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    const yearValue = parseInt(year, 10);
    if (isNaN(yearValue)) {
      return reply.code(400).send({ error: 'Invalid or missing year' });
    }

    const monthValue = parseInt(month, 10);
    if (isNaN(monthValue) || monthValue < 0 || monthValue > 12) {
      return reply.code(400).send({ error: 'Invalid or missing month' });
    }

    try {
      const result = await getRidesByYearMonth(fastify, id, yearValue, monthValue);

      if (!Array.isArray(result)) {
        return reply.code(200).send([]);
      }
      return reply.code(200).send(result);
    } catch (err) {
      console.error('Database error:', err);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  fastify.get('/ridesByYearDOW',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;
    const { year, dow } = request.query;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    const yearValue = parseInt(year, 10);
    if (isNaN(yearValue)) {
      return reply.code(400).send({ error: 'Invalid or missing year' });
    }

    const dowValue = parseInt(dow, 10);
    if (isNaN(dowValue) || dowValue < 0 || dowValue > 7) {
      return reply.code(400).send({ error: 'Invalid or missing dow (day of week: Sunday=0, All Days=7)' });
    }

    try {
      const result = await getRidesByYearDOW(fastify, id, yearValue, dowValue);

      if (!Array.isArray(result)) {
        return reply.code(200).send([]);
      }
      return reply.code(200).send(result);
    } catch (err) {
      console.error('Database error:', err);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  fastify.get('/getRidesByDOMMonth',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;
    const { dom, month } = request.query;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    const domValue = parseInt(dom, 10);
    if (isNaN(domValue)) {
      return reply.code(400).send({ error: 'Invalid or missing dom (day of month)' });
    }

    const monthValue = parseInt(month, 10);
    if (isNaN(monthValue) || monthValue < 0 || monthValue > 12) {
      return reply.code(400).send({ error: 'Invalid or missing month' });
    }

    try {
      const result = await getRidesByDOMMonth(fastify, id, domValue, monthValue);

      if (!Array.isArray(result)) {
        return reply.code(200).send([]);
      }
      return reply.code(200).send(result);
    } catch (err) {
      console.error('Database error:', err);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  fastify.get('/getRidesByCluster',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;
    const { startYear, endYear, cluster } = request.query;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    const start = parseInt(startYear, 10);
    if (isNaN(start)) {
      return reply.code(400).send({ error: 'Invalid or missing startYear' });
    }

    const end = parseInt(endYear, 10);
    if (isNaN(end)) {
      return reply.code(400).send({ error: 'Invalid or missing endYear' });
    }

    const clusterValue = parseInt(cluster, 10);
    if (isNaN(clusterValue)) {
      return reply.code(400).send({ error: 'Invalid or missing cluster' });
    }

    try {
      const result = await getRidesforCluster(fastify, id, start, end, clusterValue);

      if (!Array.isArray(result)) {
        return reply.code(200).send([]);
      }
      return reply.code(200).send(result);
    } catch (err) {
      console.error('Database error:', err);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  fastify.get('/ride/:rideid',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification
    const { rideid } = request.params;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    try {
      const result = await getRideById(fastify, riderId, rideid);
      return reply.code(200).send(result);

    } catch (err) {
      console.error('Database error:', err);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  fastify.get('/ride/lookback',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    try {
      const result = await getLookback(fastify, riderId);

      if (!Array.isArray(result)) {
        return reply.code(200).send([]);
      }

      return reply.code(200).send(result);
    } catch (err) {
      console.error('Database error:', err);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  fastify.post('/addRide',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification
    const {
      date,
      distance,
      speedAvg,
      speedMax,
      cadence,
      hrAvg,
      hrMax,
      title,
      powerAvg,
      powerMax,
      bikeID,
      stravaID,
      comment,
      elevationGain,
      elapsedTime,
      powerNormalized,
      trainer,
    } = request.body;

    // Utility to convert elapsed time (hh:mm:ss) to seconds
    const convertElapsedTime = (timeString) => {
      const [hours, minutes, seconds] = timeString.split(':').map(Number);
      return hours * 3600 + minutes * 60 + seconds;
    };

    // Input validation
    if (
      !date ||
      distance == null || speedAvg == null || speedMax == null ||
      cadence == null || hrAvg == null || hrMax == null ||
      powerAvg == null || powerMax == null ||
      elevationGain == null || elapsedTime == null ||
      powerNormalized == null || trainer == null
    ) {
      return reply.status(400).send({ error: 'Missing one or more required fields' });
    }

    // Validate the datetime string (YYYY-MM-DD HH:MM:SS)
    const parsedDate = DateTime.fromFormat(date, 'yyyy-MM-dd HH:mm:ss');
    if (!parsedDate.isValid) {
      return reply.status(400).send({ error: 'Invalid date format (expected YYYY-MM-DD HH:MM:SS)' });
    }

    // Convert to ISO format for PostgreSQL
    const isoDate = parsedDate.toISO();

    // Validate numerical fields
    const numericFields = { distance, speedAvg, speedMax, cadence, hrAvg, hrMax, powerAvg, powerMax, elevationGain, powerNormalized };
    for (const [field, value] of Object.entries(numericFields)) {
      if (value < 0 || isNaN(value)) {
          return reply.status(400).send({ error: `Invalid value for numeric ${field}` });
      }
    }

    // Validate trainer (boolean type)
    if (![0, 1].includes(trainer)) {
      return reply.status(400).send({ error: 'Invalid value for trainer (should be 0 or 1)' });
    }

    // Sanitize string fields to protect against XSS
    const sanitizedTitle = xss(title);
    const sanitizedComment = xss(comment);

    // Convert elapsedTime from hh:mm:ss to seconds
    let elapsedTimeInSeconds;
    try {
      elapsedTimeInSeconds = convertElapsedTime(elapsedTime);
    } catch (error) {
      return reply.status(400).send({ error: 'Invalid elapsedTime format (expected hh:mm:ss)' });
    }

    try {
      // SQL query to insert new ride
      const query = `
          INSERT INTO rides (
              date, distance, speedavg, speedmax, cadence, hravg, hrmax, title,
              poweravg, powermax, bikeid, stravaid, comment, elevationgain, elapsedtime,
              powernormalized, trainer, riderid
          ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
          ) RETURNING rideid, riderid, date, distance, speedavg, speedmax, cadence, hravg, hrmax, title,
              poweravg, powermax, bikeid, stravaid, comment, elevationgain, elapsedtime,
              powernormalized, trainer;
      `;

      // Execute the query with parameterized values
      const values = [
          isoDate, distance, speedAvg, speedMax, cadence, hrAvg, hrMax, sanitizedTitle,
          powerAvg, powerMax, bikeID, stravaID, sanitizedComment, elevationGain,
          elapsedTimeInSeconds, powerNormalized, trainer, riderId
      ];

      const result = await fastify.pg.query(query, values);
      const insertedRide = result.rows[0];

      // Return the newly inserted ride data
      reply.status(201).send(insertedRide);

      // After successfully inserting the new ride, update cummulatives
      setImmediate(async () => {
        try {
          const updaterideMetrics = 'CALL public.updateAllRiderMetrics($1)';
          await fastify.pg.query(updaterideMetrics, [riderId]);
        } catch (updateError) {
          console.error('Error updating ride metrics', updateError);
          // More error handling later.
        }
    });
    } catch (error) {
        console.error('Error inserting new ride:', error);
        reply.status(500).send({ error: 'An error occurred while inserting the ride' });
    }
  });

  fastify.get('/ride/updateMetrics', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user; // Extracted from the JWT after authentication

    try {

      reply.status(200).send({status: true, message: "Metric update request received.  It may take up to 30 seconds to complete"});

      // Update all rider metrics after modification
      setImmediate(async () => {
        try {
          const updateRideMetrics = 'CALL public.updateAllRiderMetrics($1)';
          await fastify.pg.query(updateRideMetrics, [riderId]);
        } catch (updateError) {
          console.error('Error updating ride metrics', updateError);
        }
      });
    } catch (error) {
      console.error('Error updating rider:', error);
      reply.status(500).send({ error: 'An error occurred while updating rider metrics' });
    }
  });

  fastify.post('/ride/:rideid/update', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;
    const { rideid } = request.params;
    const updates = request.body;

    try {
      const result = await updateRide(fastify, riderId, rideid, updates);

      reply.status(200).send(result);

      // Update all rider metrics after modification
      setImmediate(async () => {
        try {
          const updateRideMetrics = 'CALL public.updateAllRiderMetrics($1)';
          await fastify.pg.query(updateRideMetrics, [riderId]);
        } catch (updateError) {
          console.error('Error updating ride metrics', updateError);
        }
      });
    } catch (error) {
      console.error('Error updating ride:', error);
      reply.status(500).send({ error: 'An error occurred while updating the ride' });
    }
  });

  fastify.get('/ride/cluster', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;
    const { startYearBack, endYearBack } = request.query;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    const start = parseInt(startYearBack, 10);
    const end = parseInt(endYearBack, 10);

    if (isNaN(start) || isNaN(end)) {
      return reply.code(400).send({ error: 'Invalid or missing startYearBack or endYearBack. Each must be positive integers and startYearBack > endYearBack' });
    }

    try {
      const result = await clusterRides(fastify, id, start, end);
      if(result){
        reply.status(200).send({status: true, message: "Cluster values have been updated."});
      }
      reply.status(500).send({ error: 'Unable to update cluster values' });

    } catch (error) {
      console.error('Error clustering rides:', error);
      reply.status(500).send({ error: 'An error occurred while clustering rides' });
    }
  });

  fastify.get('/ride/clusterDefinitions', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    try {
      const result = await getClusterDefinitions(fastify, id);

      if (!Array.isArray(result)) {
        return reply.code(200).send([]);
      }
      return reply.code(200).send(result);
    } catch (err) {
      console.error('Database error:', err);
      return reply.code(500).send({ error: 'Database error' });
    }
  });
}

module.exports = ridesRoutes;
