const dayjs = require('dayjs');
const xss = require("xss");
const { DateTime } = require('luxon'); // Add Luxon for date parsing

async function ridesRoutes(fastify, options) {

  fastify.get('/rides/lastmonth',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    const params = [id];

    let query = `
      SELECT
        a.rideid,
        a.date,
        a.distance,
        a.speedavg,
        a.speedmax,
        a.cadence,
        a.hravg,
        a.hrmax,
        a.title,
        a.poweravg,
        a.powermax,
        a.bikeid,
        coalesce(b.bikename, 'no bike') as bikename,
        coalesce(b.stravaname, 'no bike') as stravaname,
        a.stravaid,
        a.comment,
        a.elevationgain,
        a.elapsedtime,
        a.powernormalized,
        a.intensityfactor,
        a.tss,
        a.matches,
        a.trainer,
        a.elevationloss,
        a.datenotime,
        a.device_name,
        a.fracdim
      FROM
        rides a left outer join bikes b
        on a.bikeid = b.bikeid
      WHERE a.riderid = $1
        AND a.date >= date_trunc('day', NOW() - INTERVAL '30 days')
        AND a.date < date_trunc('day', NOW() + INTERVAL '1 day')
      ORDER BY a.date DESC;
      `;

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

    const params = [id, years];

    let query = `
      SELECT
        *
      FROM
        get_rides_by_five_years($1, $2::int[]);
      `;

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

    let query = `
      SELECT
        rideid,
        date,
        distance,
        speedavg,
        speedmax,
        cadence,
        hravg,
        hrmax,
        title,
        poweravg,
        powermax,
        bikeid,
        stravaid,
        comment,
        elevationgain,
        elapsedtime,
        powernormalized,
        intensityfactor,
        tss,
        matches,
        trainer,
        elevationloss,
        datenotime,
        device_name,
        fracdim
      FROM
          Rides ${queryConditions}
      ORDER BY date DESC
      `;

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

  fastify.get('/ride/:rideid',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification
    const { rideid } = request.params;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    const params = [id, rideid];

    let query = `
      SELECT
        a.rideid,
        a.date,
        a.distance,
        a.speedavg,
        a.speedmax,
        a.cadence,
        a.hravg,
        a.hrmax,
        a.title,
        a.poweravg,
        a.powermax,
        a.bikeid,
        coalesce(b.bikename, 'no bike') as bikename,
        coalesce(b.stravaname, 'no bike') as stravaname,
        a.stravaid,
        a.comment,
        a.elevationgain,
        a.elapsedtime,
        a.powernormalized,
        a.intensityfactor,
        a.tss,
        a.matches,
        a.trainer,
        a.elevationloss,
        a.datenotime,
        a.device_name,
        a.fracdim
      FROM
        rides a left outer join bikes b
        on a.bikeid = b.bikeid
      WHERE
        a.riderid = $1
        and a.rideid = $2
        limit 1;
      `;

    const client = await fastify.pg.connect();

    try {
      const { rows } = await client.query(query, params);

      if (rows.length === 0) {
        return reply.code(200).send({});
      }

      return reply.code(200).send(rows[0]);

    } catch (err) {
      console.error('Database error:', err);
      return reply.code(500).send({ error: 'Database error' });
    }
    finally{
      client.release();
    }
  });

  fastify.get('/ride/lookback',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    const params = [id];

    let query = `
      Select
        rideid,
        category,
        date,
        distance,
        speedavg,
        elapsedtime,
        elevationgain,
        hravg,
        poweravg
        bikeid,
        stravaid,
        title,
        comment
      From
        get_rider_lookback_this_day($1)
      Order By date asc;
      `;

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
          const updaterideMetrics = 'CALL public.updateAllRiderMetrics($1)';
          await client.query(updaterideMetrics, [riderId]);
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

      const client = await fastify.pg.connect();

      // Update all rider metrics after modification
      setImmediate(async () => {
        try {
          const updateRideMetrics = 'CALL public.updateAllRiderMetrics($1)';
          await client.query(updateRideMetrics, [riderId]);
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
    const { riderId } = request.user; // Extracted from the JWT after authentication
    const { rideid } = request.params;
    const updates = request.body;

    // Define allowed fields for update
    const allowedFields = [
      'date', 'distance', 'speedavg', 'speedmax', 'cadence', 'hravg', 'hrmax',
      'title', 'poweravg', 'powermax', 'bikeid', 'stravaid', 'comment',
      'elevationgain', 'elevationloss', 'elapsedtime', 'powernormalized', 'trainer',
      'tss', 'intensityfactor'
    ];

    // Filter out invalid fields
    const sanitizedUpdates = {};
    for (const key of Object.keys(updates)) {
      if (allowedFields.includes(key)) {
        sanitizedUpdates[key] = updates[key];
      }
    }

    // Check if there are no valid fields to update
    if (Object.keys(sanitizedUpdates).length === 0) {
      return reply.status(400).send({ error: 'No valid fields provided for update' });
    }

    // Input validation
    if (sanitizedUpdates.date) {
      const parsedDate = DateTime.fromFormat(sanitizedUpdates.date, 'yyyy-MM-dd HH:mm:ss');
      if (!parsedDate.isValid) {
        return reply.status(400).send({ error: 'Invalid date format (expected YYYY-MM-DD HH:mm:ss)' });
      }
      sanitizedUpdates.date = parsedDate.toISO(); // Convert to ISO format
    }

    if (sanitizedUpdates.elapsedTime) {
      try {
        const convertElapsedTime = (timeString) => {
          const [hours, minutes, seconds] = timeString.split(':').map(Number);
          return hours * 3600 + minutes * 60 + seconds;
        };
        sanitizedUpdates.elapsedTime = convertElapsedTime(sanitizedUpdates.elapsedTime);
      } catch (error) {
        return reply.status(400).send({ error: 'Invalid elapsedTime format (expected hh:mm:ss)' });
      }
    }

    // Sanitize string fields to protect against XSS
    if (sanitizedUpdates.title) sanitizedUpdates.title = xss(sanitizedUpdates.title);
    if (sanitizedUpdates.comment) sanitizedUpdates.comment = xss(sanitizedUpdates.comment);

    // SQL update query
    const setClause = Object.keys(sanitizedUpdates)
      .map((key, index) => `${key.toLowerCase()} = $${index + 1}`)
      .join(', ');

    const query = `
      UPDATE rides
      SET ${setClause}
      WHERE rideid = $${Object.keys(sanitizedUpdates).length + 1} AND riderid = $${Object.keys(sanitizedUpdates).length + 2}
      RETURNING *;
    `;

    try {
      const client = await fastify.pg.connect();
      const values = [...Object.values(sanitizedUpdates), rideid, riderId];

      const result = await client.query(query, values);
      client.release();

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Ride not found or you do not have permission to update this ride' });
      }

      reply.status(200).send(result.rows[0]);

      // Update all rider metrics after modification
      setImmediate(async () => {
        try {
          const updateRideMetrics = 'CALL public.updateAllRiderMetrics($1)';
          await client.query(updateRideMetrics, [riderId]);
        } catch (updateError) {
          console.error('Error updating ride metrics', updateError);
        }
      });
    } catch (error) {
      console.error('Error updating ride:', error);
      reply.status(500).send({ error: 'An error occurred while updating the ride' });
    }
  });
}

module.exports = ridesRoutes;
