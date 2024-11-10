const { DateTime } = require('luxon'); // Add Luxon for date parsing
const { getTags, addTag, removeTag, assignTags} = require('../db/dbTagQueries');
const {isRiderId, isLocationId, isAssignmentId, isValidTagArray} = require('../utility/general')

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

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

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
      const deleteQuery = `Delete from riderweight where riderid = $1 and date = $2;`;

      const query = `
          INSERT INTO riderweight (
              riderid, date, weight, bodyfatfraction, bodyh2ofraction
          ) VALUES (
              $1, $2, $3, $4, $5
          ) RETURNING riderid, date, weight, bodyfatfraction, bodyh2ofraction;
      `;
      const valuesDelete = [
        riderId, isoDate
      ];

      const values = [
        riderId, isoDate, weight, bodyfatfraction, bodyh2ofraction
      ];

      const deleteResult = await fastify.pg.query(deleteQuery, valuesDelete);

      const result = await fastify.pg.query(query, values);
      const insertedWeight = result.rows[0];

      // Return the newly inserted ride data
      reply.status(200).send(insertedWeight);

      // After successfully inserting the weight, update cummulatives
      setImmediate(async () => {
        try {
          const updateCummulativesQuery = 'CALL public.update_riderweight_avg($1)';
          await fastify.pg.query(updateCummulativesQuery, [riderId]);
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

  fastify.get('/weighttracker',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    const params = [id];

    let query = `
      Select
          date,
          weight,
          weight7,
          weight30,
          weight365,
          bodyfatfraction,
          bodyfatfraction7,
          bodyfatfraction30,
          bodyfatfraction365,
          bodyh2ofraction,
          bodyh2ofraction7,
          bodyh2ofraction30,
          bodyh2ofraction365
      from
          riderweight
      WHERE riderid = $1
      order by date desc
      limit 1;
    `;

    try {
      const { rows } = await fastify.pg.query(query, params);

      // If no rider weight tracking is found, return an empty object
      if (rows.length === 0) {
        return reply.code(200).send({});
      }

      // Send the rider weight tracker data
      return reply.code(200).send(rows[0]);

    } catch (err) {
      console.error('Database error:', err);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  fastify.get('/bikes',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    let query = `Select bikeid, bikename, stravaname, isdefault from bikes where riderid = $1 and retired = 0;`;
    const params = [id]; // Array to store query parameters (starting with riderId)

    try {
      const { rows } = await fastify.pg.query(query, params);

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
  });

  fastify.get('/user/tags',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    try {
      const tags = await getTags(fastify, riderId);
      return reply.code(200).send(tags);

    } catch (error) {
      console.error(`Error retrieving tags for riderid ${riderId}: `, error);
      return reply.code(500).send({ error: `Error retrieving tags for riderid ${riderId}: ${error.message}}` });
    }
  });

  fastify.post('/user/addTag',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification
    const {
      name,
      description
    } = request.body;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    // Input validation
    if (
      name === null || description === null
    ) {
      return reply.status(400).send({ error: 'Missing one or more required fields' });
    }

    const invalidItems = [];
    // Validate the name is populated and description is at least a blank string
    if ( typeof(name) !== 'string' || name.trim().length === 0 || name.trim().length > 30) {
      invalidItems.push('Please provide a valid tag name')
    }
    if ( typeof(description) !== 'string' || description.trim().length > 255 ) {
      invalidItems.push('Please provide a description shorter than 255 characters or blank if not required')
    }

    if(invalidItems.length > 0){
      return reply.status(400).send({ error: invalidItems.join(', ') });
    }

    try {
      const tag = await addTag(fastify, riderId, name, description);
      return reply.code(200).send(tag.rows.length > 0 ? tag.rows[0] : null);

    } catch (error) {
      console.error(`Error adding tag for riderid ${riderId}: `, error);
      return reply.code(500).send({ error: `Error adding tag for riderid ${riderId}: ${error.message}` });
    }

  });

  fastify.post('/user/saveTagAssignments',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification
    const {
      locationId,
      assignmentId,
      tags
    } = request.body;

    if (!isRiderId(riderId)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    if (!isLocationId(locationId)) {
      return reply.code(400).send({ error: 'Invalid or missing locationId' });
    }

    if (!isAssignmentId(assignmentId)) {
      return reply.code(400).send({ error: 'Invalid or missing locationId' });
    }

    if (!isValidTagArray(tags)) {
      return reply.code(400).send({ error: 'Tags must be an array of strings' });
    }

    try {
      const tagsAdded = await assignTags(fastify, riderId, locationId, assignmentId, tags);
      return reply.code(200).send(tagsAdded.rows.length > 0 ? tagsAdded.rows : null);
    } catch (error) {
        console.error(`Error adding tag for riderid ${riderId}: `, error);
        return reply.code(500).send({ error: `Error adding tag for riderid ${riderId}: ${error.message}` });
    }
  });


  fastify.delete('/user/removeTag',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;
    const {
      name
    } = request.body;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    const invalidItems = [];
    // Validate the name is populated.
    if ( typeof(name) !== 'string' || name.trim().length === 0 || name.trim().length > 30) {
      invalidItems.push('Please provide a valid tag name that you want to delete')
    }

    if(invalidItems.length > 0){
      return reply.status(400).send({ error: invalidItems.join(', ') });
    }

    try {
      const result = await removeTag(fastify, riderId, name);

      return reply.code(200).send(result);

    } catch (error) {
      console.error(`Error adding tag for riderid ${riderId}: `, error);
      return reply.code(500).send({ error: `Error adding tag for riderid ${riderId}: ${error.message}` });
    }

  });
}

module.exports = userRoutes;
