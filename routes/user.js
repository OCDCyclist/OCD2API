const { DateTime } = require('luxon'); // Add Luxon for date parsing

async function userRoutes(fastify, options) {
  // Define the user routes

  fastify.post('/addWeight',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification
    const {
      date,
      weight,
      bodyfatfraction,
      bodyh2ofraction,
    } = request.body;


    // Input validation
    if (
      !date ||
      weight == null || bodyfatfraction == null || bodyh2ofraction == null
    ) {
      return reply.status(400).send({ error: 'Missing one or more required fields' });
    }

    // Validate the datetime string (YYYY-MM-DD HH:MM:SS)
    const parsedDate = DateTime.fromFormat(date, 'yyyy-MM-dd');
    if (!parsedDate.isValid) {
      return reply.status(400).send({ error: 'Invalid date format (expected YYYY-MM-DD)' });
    }

    // Convert to ISO format for PostgreSQL
    const isoDate = parsedDate.toISO();

    // Validate numerical fields
    const numericFields = { weight, bodyfatfraction, bodyh2ofraction};
    for (const [field, value] of Object.entries(numericFields)) {
      if (value < 0 || isNaN(value)) {
          return reply.status(400).send({ error: `Invalid value for numeric ${field}` });
      }
    }

    try {
      // SQL query to insert new rider weight value
      const query = `
          INSERT INTO riderweight (
              riderid, date, weight, bodyfatfraction, bodyh2ofraction
          ) VALUES (
              $1, $2, $3, $4, $5
          ) RETURNING riderid, date, weight, bodyfatfraction, bodyh2ofraction;
      `;
      const client = await fastify.pg.connect();

      // Execute the query with parameterized values
      const values = [
        riderId, isoDate ,weight, bodyfatfraction, bodyh2ofraction
      ];

      const result = await client.query(query, values);
      const insertedWeight = result.rows[0];

      // Return the newly inserted ride data
      reply.status(201).send(insertedWeight);

      // After successfully inserting the weight, update cummulatives
      setImmediate(async () => {
        try {
          const updateCummulativesQuery = 'CALL public.update_riderweight_avg($1)';
          await client.query(updateCummulativesQuery, [riderId]);
        } catch (updateError) {
          console.error('Error updating cummulatives:', updateError);
          // More error handling later.
        }
      });
    } catch (error) {
        console.error('Error inserting new ride:', error);
        reply.status(500).send({ error: 'An error occurred while inserting the ride' });
    }
  });

  fastify.get('/bikes',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification

  const id = parseInt(riderId, 10);
  if (isNaN(id)) {
    return reply.code(400).send({ error: 'Invalid or missing riderId' });
  }

  let query = `Select bikeid, bikename, stravaname, isdefault from bikes where riderid = $1 and retired = 0;`;
  const client = await fastify.pg.connect();
  const params = [id]; // Array to store query parameters (starting with riderId)

  try {
    const { rows } = await client.query(query, params);

    // If no bikes are found, return an empty array
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
}

module.exports = userRoutes;
