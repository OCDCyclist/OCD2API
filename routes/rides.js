const dayjs = require('dayjs');
const { DateTime } = require('luxon'); // Add Luxon for date parsing

async function ridesRoutes(fastify, options) {
  // Define the rides routes
  fastify.get('/rides',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
      const { riderId } = request.user;  // request.user is populated after JWT verification
      const { dateFrom, dateTo } = request.query;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    // Validate dateFrom and dateTo if they are present
    let queryConditions = 'WHERE riderid = $1'; // Initialize base condition
    const params = [id]; // Array to store query parameters (starting with riderId)

    if (dateFrom && dayjs(dateFrom, 'YYYY-MM-DD', true).isValid()) {
      queryConditions += ` AND date >= $2`; // Add condition for dateFrom
      params.push(dateFrom);
    }

    if (dateTo && dayjs(dateTo, 'YYYY-MM-DD', true).isValid()) {
      // Add one day to dateTo and subtract one second
      const adjustedDateTo = dayjs(dateTo).add(1, 'day').subtract(1, 'second').format('YYYY-MM-DD HH:mm:ss');
      queryConditions += ` AND date <= $${params.length + 1}`; // Add condition for dateTo
      params.push(adjustedDateTo); // Add adjusted dateTo to the parameters
    }

    // Adjust the SQL query with the filters applied
    let query = `SELECT * FROM Rides ${queryConditions} ORDER BY date ASC`;
    const client = await fastify.pg.connect();

    try {
      const { rows } = await client.query(query, params);

      // If no rides are found, return an empty array
      if (rows.length === 0) {
        return reply.code(200).send([]);
      }

      // Send the filtered rides
      return reply.code(200).send(rows);

    } catch (err) {
      console.error('Database error:', err);
      return reply.code(500).send({ error: 'Database error' });
    }
    finally{
      client.release();
    }
  });

  fastify.get('/ride',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification
    const { rideid } = request.query;

  const id = parseInt(riderId, 10);
  if (isNaN(id)) {
    return reply.code(400).send({ error: 'Invalid or missing riderId' });
  }

  // Validate dateFrom and dateTo if they are present
  let queryConditions = 'WHERE riderid = $1 and rideid = $2'; // Initialize base condition
  const params = [id, rideid]; // Array to store query parameters (starting with riderId)

  // Adjust the SQL query with the filters applied
  let query = `SELECT * FROM rides ${queryConditions} limit 1;`;
  const client = await fastify.pg.connect();

  try {
    const { rows } = await client.query(query, params);

    // If no ride is found, return an empty array
    if (rows.length === 0) {
      return reply.code(200).send([]);
    }

    // Send the filtered rides
    return reply.code(200).send(rows[0]);

  } catch (err) {
    console.error('Database error:', err);
    return reply.code(500).send({ error: 'Database error' });
  }
  finally{
    client.release();
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
    const sanitizedTitle = title;
    const sanitizedComment = comment;

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
      const client = await fastify.pg.connect();

      // Execute the query with parameterized values
      const values = [
          isoDate, distance, speedAvg, speedMax, cadence, hrAvg, hrMax, sanitizedTitle,
          powerAvg, powerMax, bikeID, stravaID, sanitizedComment, elevationGain,
          elapsedTimeInSeconds, powerNormalized, trainer, riderId
      ];

      const result = await client.query(query, values);
      const insertedRide = result.rows[0];

      // Return the newly inserted ride data
      reply.status(201).send(insertedRide);

      // After successfully inserting the new ride, update cummulatives
      setImmediate(async () => {
        try {
          const updaterideMetrics = 'CALL public.updateRideMetrics($1)';
          await client.query(updaterideMetrics, [riderId]);
        } catch (updateError) {
          console.error('Error updating ride metrics', updateError);
          // More error handling later.
        }

        try {
          const updaterideCummulatives = 'CALL public.update_cummulatives($1)';
          await client.query(updaterideCummulatives, [riderId]);
        } catch (updateError) {
          console.error('Error updating cummulatives', updateError);
          // More error handling later.
        }

        try {
          // this updates data for metrics by year and month such as distance, time, elevation gain, etc.
          const updaterideCummulatives = 'CALL public.metrics_by_year_month_calculate($1)';
          await client.query(updaterideCummulatives, [riderId]);
        } catch (updateError) {
            console.error('Error updating cummulatives', updateError);
          // More error handling later.
        }
    });
    } catch (error) {
        console.error('Error inserting new ride:', error);
        reply.status(500).send({ error: 'An error occurred while inserting the ride' });
    }
  });
}

module.exports = ridesRoutes;
